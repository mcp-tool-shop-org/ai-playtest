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
{"id":1,"method":"observe"}
{"id":2,"method":"act","params":{"kind":"choose","id":"attack"}}
{"id":3,"method":"quit"}
```

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
waits is not being played, it is being watched. Pause, apply, advance a fixed
number of frames, then reply:

```gdscript
get_tree().paused = true
_apply(action)
await _advance_frames(15)   # action-repeat: one decision covers ~250ms
get_tree().paused = false
_reply(id, _observation())
```

## Godot 4 — the whole thing

Add this as an autoload and you are done. Guard it behind a flag so it never
ships to players.

```gdscript
# playtest_bridge.gd — autoload. Enable with: --playtest-port=7777
extends Node

var _server := TCPServer.new()
var _peer: StreamPeerTCP = null
var _buffer := ""

func _ready() -> void:
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
    for arg in OS.get_cmdline_user_args():
        if arg.begins_with("--playtest-port="):
            return int(arg.split("=")[1])
    return 0

func _process(_delta: float) -> void:
    if _peer == null and _server.is_connection_available():
        _peer = _server.take_connection()
    if _peer == null:
        return
    _peer.poll()
    if _peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
        _peer = null
        return
    var available := _peer.get_available_bytes()
    if available > 0:
        _buffer += _peer.get_utf8_string(available)
    while "\n" in _buffer:
        var split := _buffer.split("\n", true, 1)
        var line: String = split[0].strip_edges()
        _buffer = split[1] if split.size() > 1 else ""
        if line != "":
            _handle(line)

func _handle(line: String) -> void:
    var msg: Variant = JSON.parse_string(line)
    if typeof(msg) != TYPE_DICTIONARY:
        return
    var id: int = int(msg.get("id", 0))
    match msg.get("method", ""):
        "observe":
            _reply(id, _observation())
        "act":
            _apply(msg.get("params", {}))
            _reply(id, _observation())      # only once you are ready again
        "quit":
            var final := _observation()
            final["done"] = true
            _reply(id, final)
            get_tree().quit()

func _reply(id: int, result: Dictionary) -> void:
    _peer.put_data((JSON.stringify({"id": id, "result": result}) + "\n").to_utf8_buffer())

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

`_observation()` and `_apply()` are the only parts that are yours. Everything
above them is boilerplate you can paste unchanged.

## Unreal Engine 5

The same protocol; the transport choices differ.

- **A `UGameInstanceSubsystem` with an `FSocket` listener** is the recommended
  route. It works identically in the editor and in a packaged build, and it is
  the only option that does not drag the editor along.
- **The Remote Control API** (WebSocket, `RemoteControl` plugin) is a reasonable
  second choice if you already have it enabled, but it is editor-oriented.
- **Gauntlet** is the official automation framework and is heavy to stand up —
  worth it if you already run it in CI, not worth adopting for this alone.

Pause with `UGameplayStatics::SetGamePaused`, or a custom time dilation if you
need certain subsystems to keep ticking. Serialise with `FJsonObjectConverter`.

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
