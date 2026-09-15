# The engine bridge

How to let `ai-playtest` drive a Godot, Unreal, or any other engine-based game.

This is the strongest way to be playtested, and it is worth the hour it takes to
wire up. A game that describes itself does not make the harness guess when a turn
began, does not need a regex to find its prompt, and can say exactly which
actions are legal — so an illegal action is rejected before a turn is spent on
it. It is also the only arrangement that works for a game with no terminal at
all.

## The protocol

Newline-delimited JSON over TCP. No dependency on either side: Godot has
`StreamPeerTCP` and `JSON` in core, Unreal has `FSocket` and `FJsonSerializer`,
and everything else has a socket. Request/response, one message per line.

The harness sends:

```json
{"id":0,"method":"hello","params":{"protocol":1}}
{"id":1,"method":"observe"}
{"id":2,"method":"act","params":{"kind":"choose","id":"attack"}}
{"id":3,"method":"reset"}
{"id":4,"method":"quit"}
```

`hello` is a version handshake — answer
`{"protocol":1,"game":"...","capabilities":[...]}`. Both mature Godot bridges in
the wild carry one, and the reason is worth stating: without it a protocol change
fails as a mystery stall rather than a clear mismatch.

`reset` returns the game to a fresh session without relaunching the process. A
five-seat run should not need five process launches.

Your game answers each one, matching `id`:

```json
{"id":1,"result":{"text":"...","state":{...},"actions":{...},"done":false}}
```

or, when something went wrong on your side:

```json
{"id":2,"error":{"message":"no active encounter"}}
```

You may also push an unsolicited `{"method":"log","params":...}` at any time. It
lands in the run's diagnostics and is never shown to the player model — use it
for your own tracing.

### The result object

| field | required | meaning |
|---|---|---|
| `text` | strongly preferred | What the player sees, as prose. This is the channel the model actually reads. |
| `state` | | Structured state. If `text` is absent it is serialised as the text, which works but reads worse. |
| `actions` | | What is legal right now (see below). |
| `done` | | `true` when the session is over. |
| `reason` | | `"win"` / `"lose"` / `"quit"` / `"stuck"` / `"timeout"` — lets the critic tell a finished run from a bridge that gave up. |
| `image` | | `{mime, base64}`. An attachment only — never send this instead of `text`. |

`actions` takes one of four shapes:

```json
{"kind":"free-text"}
{"kind":"keys","keys":["w","a","s","d","e"]}
{"kind":"choice","options":[{"id":"attack","label":"Attack the thing in the dark"}]}
{"kind":"schema","schema":{ ...JSON Schema... }}
```

Prefer `choice` where the game genuinely has a menu. It is the least ambiguous
for a model to answer and the easiest for you to validate.

### Turn-taking is the shape of the exchange

**Reply to `act` only when you are ready for the next input.** That is the whole
turn-taking rule, and it is why nothing here has to guess about quiet time.

For a real-time game this is also the pause protocol, and you need one: a model
takes roughly 0.5–2 seconds to answer, so a game that keeps running while it
waits is not being played, it is being watched. Pause, apply, advance until the
game says it is ready, then reply:

```gdscript
get_tree().paused = true
_apply(action)
# NOT a fixed frame count — most combat resolves over a variable number of
# frames. Poll a predicate the game supplies, and cap it.
var hit_cap := await _advance_until(is_ready_for_input, 600)
get_tree().paused = false
_reply(id, _observation())
```

⚠ **This only works if the bridge node is `PROCESS_MODE_ALWAYS`.** An autoload
inherits its process mode from the root, which is pausable — so without that one
line, `get_tree().paused = true` stops the bridge's own `_process` and it goes
deaf at exactly the moment the pause protocol needs it listening. The listing
below sets it first, for that reason.

## Godot 4 — the whole thing

Add this as an autoload and you are done. Guard it behind a flag so it never
ships to players.

> **Read the four notes under the listing before you paste it.** Three of them
> are the difference between a bridge that works and one that silently never
> starts or deadlocks the moment you pause.

```gdscript
# playtest_bridge.gd — autoload. Enable with:
#   godot --headless -- --playtest-port=7777        <-- the bare `--` is REQUIRED
extends Node

var _server := TCPServer.new()
var _peer: StreamPeerTCP = null
var _buf := PackedByteArray()

func _ready() -> void:
    # (1) WITHOUT THIS THE BRIDGE DEADLOCKS. An autoload's process_mode is
    # INHERIT, and the root is PAUSABLE — so `get_tree().paused = true` stops
    # this node's own _process, and the bridge goes deaf exactly when the pause
    # protocol needs it awake.
    process_mode = Node.PROCESS_MODE_ALWAYS

    var port := _port_from_args()
    if port == 0:
        set_process(false)
        return
    if _server.listen(port, "127.0.0.1") != OK:
        push_error("playtest bridge could not listen on %d" % port)
        set_process(false)
        return
    print("PLAYTEST_BRIDGE_PORT=%d" % port)

func _port_from_args() -> int:
    # (2) get_cmdline_user_args() returns ONLY what follows a bare `--`.
    # Launch without it and this silently returns 0 and the bridge never starts.
    var args := OS.get_cmdline_user_args()
    if args.is_empty():
        args = OS.get_cmdline_args()        # tolerate the mistake
    for arg in args:
        if arg.begins_with("--playtest-port="):
            return int(arg.split("=")[1])
    return 0

func _process(_delta: float) -> void:
    if _peer == null and _server.is_connection_available():
        _peer = _server.take_connection()
        _peer.set_no_delay(true)            # (3) Nagle adds ~40ms to every turn
    if _peer == null:
        return
    _peer.poll()
    if _peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
        _peer = null
        _buf.clear()
        return

    # (4) Buffer BYTES and decode only complete lines. TCP splits wherever it
    # likes, so decoding each arrival with get_utf8_string() mangles any
    # multi-byte character that straddles a segment boundary — every em-dash and
    # accented name in your prose. This is the same defect class as decoding
    # stdout chunks independently; it bites here for the same reason.
    var available := _peer.get_available_bytes()
    if available > 0:
        var chunk: Array = _peer.get_data(available)
        if chunk[0] == OK:
            _buf.append_array(chunk[1])

    while true:
        var nl := _buf.find(0x0A)           # '\n'
        if nl < 0:
            break
        var line := _buf.slice(0, nl).get_string_from_utf8().strip_edges()
        _buf = _buf.slice(nl + 1)
        if line != "":
            _handle(line)

func _handle(line: String) -> void:
    var msg: Variant = JSON.parse_string(line)
    if typeof(msg) != TYPE_DICTIONARY:
        return
    var id: int = int(msg.get("id", 0))
    match msg.get("method", ""):
        "hello":
            _reply(id, {"protocol": 1, "game": ProjectSettings.get_setting("application/config/name"),
                        "capabilities": ["step_until"]})
        "observe":
            _reply(id, _observation())
        "act":
            _apply(msg.get("params", {}))
            # Only once you are ready again — see _advance_until below.
            var hit_cap := await _advance_until(is_ready_for_input, 600)
            var obs := _observation()
            if hit_cap:
                obs["reason"] = "timeout"   # the game never came back; say so
            _reply(id, obs)
        "reset":
            _reset()
            _reply(id, _observation())
        "quit":
            var final := _observation()
            final["done"] = true
            _reply(id, final)
            _peer.disconnect_from_host()
            _server.stop()
            get_tree().quit()

func _reply(id: int, result: Dictionary) -> void:
    # Guard: after a client drop _peer is dead and put_data crashes.
    if _peer == null or _peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
        return
    _peer.put_data((JSON.stringify({"id": id, "result": result}) + "\n").to_utf8_buffer())

## Advance frames until the game says it is ready, capped. A fixed frame count
## is wrong for anything whose actions resolve over a variable number of frames
## — which is most combat.
func _advance_until(ready: Callable, max_frames: int) -> bool:
    for i in max_frames:
        await get_tree().process_frame
        if ready.call():
            return false
    return true    # hit the cap

# ---- the two functions that are actually yours ----

func _observation() -> Dictionary:
    var p := get_tree().get_first_node_in_group("player")
    return {
        "text": Narrator.current_scene_text(),     # your prose, if you have any
        "state": {
            "room": p.current_room_name,
            "hp": p.hp,
            "party": p.party_summary(),
        },
        "actions": {
            "kind": "choice",
            "options": Encounter.available_actions(),  # [{id, label}, ...]
        },
        "done": GameState.is_over,
    }

func _apply(action: Dictionary) -> void:
    match action.get("kind", ""):
        "choose": Encounter.choose(action.get("id", ""))
        "line":   Parser.submit(action.get("line", ""))
        "key":    Input.parse_input_event(_key_event(action.get("key", "")))
```

`_observation()`, `_apply()` and `is_ready_for_input()` are the only parts that
are yours. Everything above them is boilerplate you can paste unchanged.

**Under `--headless` there is no display server**, so `get_viewport().get_texture()`
returns nothing and the `image` field is unavailable. Text and state are
unaffected — which is the channel that matters.

For reproducible runs: `--fixed-fps N --disable-render-loop`, and
`Engine.time_scale` / `Engine.physics_ticks_per_second` to run faster than
real time.

## Unreal Engine 5

Same protocol; the mechanism differs, and two things commonly believed about it
are wrong.

**Use a `UGameInstanceSubsystem` that ALSO inherits `FTickableGameObject`**, with
`IsTickableWhenPaused()` returning true and `GetTickableTickType()` returning
`Conditional`, holding a non-blocking `FSocket` listener built with
`FTcpSocketBuilder` and pumped from `Tick`.

The `FTickableGameObject` half is not optional and is easy to miss: **a
`UGameInstanceSubsystem` has no tick interface of its own.** Without it the
subsystem exists and never runs. `UTickableWorldSubsystem` ticks but dies on
level travel, and a playtest crosses maps — GameInstance scope is the one that
survives. `IsTickableWhenPaused` is the direct analogue of Godot's
`PROCESS_MODE_ALWAYS` above, and it matters for the same reason.

Guard construction with `#if !UE_BUILD_SHIPPING` and run playtests as
**Development**. UnrealCV demonstrates this exact pattern working in a compiled
game binary.

Rejected, with the real reasons:

- **Remote Control API** — *not* editor-only; `-RCWebControlEnable` force-enables
  it in `-game` and packaged builds. The genuine objections are that it is Beta
  (Epic advises caution shipping with it) and that it is RPC-shaped rather than
  turn-shaped, so it gives you no place to hang the pause protocol.
- **Gauntlet** — *not* heavy to stand up; Epic states it needs no game-side
  automation code and its TestController is optional. It is simply the wrong
  *layer*: process-level puppeteering, where this needs in-frame turn-taking.
- **`UFUNCTION(Exec)` console commands** — fine in Development, stripped in
  Shipping without a source build.
- **UnrealEnginePython** — dead. Epic's own Python plugin is editor-only.

Pause with `UGameplayStatics::SetGamePaused`. Note that UE's pause leaves
Slate/UMG, the render thread, and anything with `bTickEvenWhenPaused` still
running — unlike Godot's, which stops physics, process, input, animation, audio
and particles. Serialise with `FJsonObjectConverter`. For determinism,
`-deterministic` is shorthand for `-UseFixedTimeStep -FixedSeed`.

**Your three functions:** `FString Observe()`, `void Apply(const FPlaytestAction&)`,
`bool IsReadyForInput()`.

## Configuring the playtest

```json
{
  "name": "Fractured Road — chapter 1",
  "driver": { "kind": "rpc", "port": 7777 },
  "seats": [ /* ... */ ],
  "criteria": [ /* ... */ ]
}
```

Start the game with its bridge enabled, then run the playtest against it.

## What this buys you over the stdio driver

- Turn-taking is exact instead of inferred from output going quiet.
- The legal action set is known, so a model's illegal answer is a *harness*
  event rather than a wasted turn — and the report can tell you which it was.
- Structured state means the report can cite `hp` or `room` rather than quoting
  prose at you.
- It works for a game with no terminal, which is the point.
