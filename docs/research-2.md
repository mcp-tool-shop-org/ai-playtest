# The evidence base, wave 2

Research dispatched 2026-09-14 at the close of the first dogfood swarm, aimed at
the next slice rather than at the code that already shipped. Each section ends in
a build list: what to do, concretely enough to implement.

Where wave-2 evidence **contradicts** wave 1 or contradicts something already
shipped, it says so at the top of the section. That is the most valuable thing
in this file.

Companion to [`research.md`](research.md), which covers the evidence behind what
already shipped.

---

## A. Multi-run statistics — the floor is 6, not 3

### ⚠ This contradicts something shipped

`README.md` argues for a cross-family jury partly on
[Verga et al. 2024](https://arxiv.org/abs/2404.18796) (PoLL: κ 0.763 vs 0.627,
7–8× cheaper). **[Kohli 2026](https://arxiv.org/abs/2605.29800) measured the
opposite where it matters most for this design:**

| measurement | number |
|---|---|
| 9 judges, 7 families → Kish effective sample size | **n_eff = 2.18** [2.07–2.31] |
| panel accuracy vs best *single* judge | 72.0% vs **71.8%** — no gain |
| mean pairwise φ, **cross**-family | **0.389** |
| mean pairwise φ, **same** family | 0.437 |
| most-correlated pair of all | **Claude × Gemini, φ = 0.603** |
| gap closed by Dawid-Skene / weighted / Markowitz aggregation, *with oracle labels* | **≤ 11%** |

At this repo's `panelSize: 3` with cross-family φ ≈ 0.39, the jury is worth
**≈1.68 independent votes**.

**What this does and does not overturn.** It does *not* undo taking the author
off its own jury — that rests on Panickssery/Stechly/Huang, which Kohli does not
touch. It *does* undercut the claim that **family diversity purchases
independence**, and it says no clever aggregator rescues a correlated panel. The
actionable read: **budget moved from judges to runs is strictly better.**
1 judge × 3 runs beats 3 judges × 1 run at identical cost.

### The arithmetic that settles run count

An exact two-sided sign-flip permutation test over *n* paired runs has a minimum
achievable p of `2 / 2^n`:

| n | minimum achievable p |
|---|---|
| 3 | 0.25 |
| 5 | 0.0625 |
| **6** | **0.031** ← first n that can clear α = 0.05 |

**n = 3 can never reach p < 0.05, however clean the result.** Power-wise,
resolving a 5pp effect against SD 5.4pp needs ≈18 unpaired runs, ≈9 paired at
ρ = 0.5.

### Variance is worse for long sessions than the cited number suggests

| measurement | number | source |
|---|---|---|
| 23 reruns, one fixed config | mean 69.4%, SD **5.4pp**, range 57.9–76.8 | Bhat 2026, [arXiv:2607.02577](https://arxiv.org/abs/2607.02577) |
| variance amplification, long vs short horizon | **≥ 2.37×** | Khanal 2026, [arXiv:2603.29231](https://arxiv.org/abs/2603.29231) |
| lmgame-Bench 2048 over 3 runs | `57.8 ± 16.4` — SD is 28% of the mean | [arXiv:2505.15146](https://arxiv.org/abs/2505.15146) |
| τ-bench GPT-4o, pass@1 → pass^8 | **61% → 25%** | Yao et al. 2024, [arXiv:2406.12045](https://arxiv.org/abs/2406.12045) |
| temperature 0 is **not** deterministic: 1,000 greedy completions | **80 unique outputs**, first divergence at token 103 | He, Thinking Machines 2025 |
| agentic benchmarks satisfying every reporting criterion | **0 of 10** | Zhu et al. 2025, [arXiv:2507.02825](https://arxiv.org/abs/2507.02825) |

Temperature 0 does not save you — reduction kernels are not batch-invariant, so
the batch you share with strangers changes your logits. Unfixable through
OpenRouter.

### Do not bootstrap small n

Bootstrap coverage of a nominal 95% interval collapses to **81–83% at n = 5**.
Use a Beta-Binomial posterior: `Beta(s+1, n−s+1)`, mean `(s+1)/(n+2)`, which
shrinks 3/3 away from a fake 100% ([Hariri et al.](https://arxiv.org/abs/2510.04265)).

### BUILD LIST

1. **`--runs 3` default (descriptive); refuse significance claims below n=6.** The
   CLI should print *why*, naming `2/2^n`.
2. **Per-criterion Beta-Binomial posterior**, not bootstrap. `invBetaCDF` by
   bisection on a continued-fraction regularized incomplete beta — ~60 lines, no
   dependency. Plus the label that needs no statistics at all:
   `STABLE_PASS` (s=n) / `STABLE_FAIL` (s=0) / `UNSTABLE` (0<s<n).
3. **Build-vs-build paired on identical seeds** (common random numbers), exact
   sign-flip permutation, McNemar for per-criterion binary flips. Report ρ(A,B) —
   if ρ < 0.3 the seeds are not controlling anything, which is itself a finding.
4. **Print jury `n_eff`**: `n_eff = k / (1 + (k−1)·φ̄)`. Warn when `n_eff/k < 0.5`.
5. **Header block:** pre-registered criteria hash + the **minimum detectable
   effect** for the n actually run. One line that tells a reader, before any
   number, how big a difference the run was even capable of detecting.
6. Report `worst-of-n` beside the mean. A build averaging 64% with a 51% floor is
   a different product from one averaging 64% with a 62% floor.

---

## B. Persona conditioning — ship presets, but measure them

### ⚠ This corrected a shipped comment

`coverage.ts`, `README.md` and `research.md` described the 63.4% → 24.9% repeat-rate
contrast as task- vs "exploration-**conditioned**" agents, which reads as a
prompting effect. In [Ye et al.](https://arxiv.org/abs/2605.16143) that contrast
is an **RL training regime**. Prompt-only effect is
[Englander's](https://arxiv.org/html/2604.17609) **+2.57** average pass@1.
Corrected in all three places 2026-09-14.

### The result that justifies presets anyway

**PersonaTester** (Yu et al., ACM FSE 2026, [arXiv:2603.24160](https://arxiv.org/abs/2603.24160)) —
9 personas mined from **1,500 real human traces**, 15 apps:

| | personas | baseline |
|---|---|---|
| crash bugs | **29–38** | 22 |
| functional bugs | 6 / 4 / 4 | 3 |
| personas each finding >20 bugs the baseline missed | **6** | — |
| bugs unique to the baseline | — | **zero** |

That is behaviour change *and* outcome change — the only result in this
literature that converts persona diversity into more distinct defects.

### And the result that says most presets will be dead weight

Holmgård et al. scored designer personas against 380 human playtraces:
**Treasure Collector was the best match for 326/380 traces; Runner matched 0/380.**
A gallery collapses onto one persona. Expect ~40% of presets to be inert and
plan to delete them.

### Drift is real and fast

Significant instruction drift within **8 rounds** of self-chat
([arXiv:2402.10962](https://arxiv.org/abs/2402.10962)); CharacterEval dialogues
average 9.28 turns and decline across them; ContextEcho found drift is
org-independent, **compaction does not reset it**, but a **single-shot re-anchor
restores register**. At 40 turns this matters.

Taxonomies: **Bartle is folk taxonomy**, never psychometrically tested. Yee
(n=3200) extracted components that are *largely uncorrelated* (r≈.10) and states
explicitly they are **not player types** — Achievement and Social are *positively*
correlated, the opposite of Bartle's opposite-corners claim. Borrow motivation
dials, never types.

### BUILD LIST

Four presets on orthogonal axes **of the act of testing** (PersonaTester's
design), each ≤80 words, plus a mandatory no-persona control:

| preset | targets | expected `Coverage` signature |
|---|---|---|
| **Cartographer** — exhaust every exit/object/verb before advancing; report what the game describes but won't let you touch | unreachable content, described-but-unimplemented objects | high `novelStates`, late `turnOfLastNovelState`, high entropy |
| **Closer** — shortest route to the objective, decline optional content, say precisely what blocked you | soft-locks on the fast path, missing prerequisites, pacing cliffs | **`thin` by design — must not be penalised** |
| **Boundary Pusher** — assume the parser is fragile; empty input, absurd quantities, malformed commands; report exact input and exact response | parser crashes, silent no-ops, bad error messages | **high `selfLoopRate` expected, not a warning** |
| **Continuity Auditor** — track what you were told, re-examine after events, quote both statements on a mismatch | state/narrative contradictions, stale descriptions, counter desync | **elevated `repeatRate` on inspect verbs expected** |
| *(control)* no persona | — | baseline; required to compute unique-finding yield |

- **Re-anchor every 10 turns** (~15 tokens). Drift is significant by round 8.
- **Measure adherence behaviourally, never by self-report** (InCharacter: 78.9%).
  Pre-register each preset's expected signature; compute inter-persona centroid
  separation vs within-persona spread. **If separation < spread, the preset is
  decorative — cut it.**
- **Delete any preset with zero unique findings across 3 builds.**
- ⚠ **`computeCoverage`'s global confidence grade will systematically mis-grade
  Closer (thin by design) and Continuity Auditor (high repeat by design).** Grade
  against a per-persona expected signature, or the presets and the metrics will
  fight each other.
- **Separate noticing from reporting.** Agents discover at 81/98/97% and act at
  37/17/0.5%, never mentioning the discovery in 78–99% of misses. A
  mentioned-but-unreported anomaly is a *report-generation* defect, not an
  exploration defect — a different fix.

---

## C. The browser driver — and the honest answer about canvas

**A canvas game must cooperate or it cannot be playtested well.** One element,
empty accessibility tree; set-of-marks degenerates to a box around the game.

### Library

**`playwright-core` ^1.60** as an optional dependency (ships no browsers). Three
deciding factors over Puppeteer: `page.ariaSnapshot()` gained a **`boxes` option
in 1.60** documented as "useful for AI consumption" — a built-in set-of-marks
primitive; `page.clock` exists; and Playwright launches Chromium with
`--disable-background-timer-throttling` and friends by default, which is exactly
what stops a backgrounded game being throttled to ~1 Hz.

**`page.accessibility.snapshot()` is dead** — deprecated ~3 years, its docs page
404s. Use `ariaSnapshot()` or raw CDP `Accessibility.getFullAXTree`.

**Headless matters for games:** headless Chrome disables the GPU and falls back
to SwiftShader (disabled entirely on ARM). Run headed, or `--use-angle=vulkan`.
Never screenshot WebGL with `canvas.toDataURL()` — with the default
`preserveDrawingBuffer:false` you get black. CDP `Page.captureScreenshot`
captures the composited surface and works.

### Set-of-marks, settled

| benchmark | a11y tree | + SoM | verdict |
|---|---|---|---|
| VisualWebArena | 15.05% | **16.37%** | SoM helps |
| AndroidWorld (M3A) | **30.6%** | 25.4% | SoM **costs 5.2 points** |
| MobileMiniWoB++ | 59.7% | **67.7%** | SoM gains 8 |

The authors' own explanation is the design lesson: Android app trees are
"generally better populated… reducing the value of SoM." **SoM repairs a missing
tree; it does not upgrade a complete one.**

### Input and timing — two hard limits

- **Gamepad cannot be synthesized. Confirmed.** No CDP `dispatchGamepadEvent`;
  `window.gamepadController` is content_shell only; W3C Gamepad PR #224
  (WebDriver BiDi) still in review as of Sept 2025.
- **Pointer lock fails** in Chromium+Playwright ([playwright#20956](https://github.com/microsoft/playwright/issues/20956)).
- **`page.clock` cannot step a game**: after `fastForward()`, rAF callbacks do
  not fire for the skipped window ([playwright#37635](https://github.com/microsoft/playwright/issues/37635)).
  Use CDP **`Emulation.setVirtualTimePolicy`** instead — Chrome's own
  deterministic-rendering mechanism — with a wall-clock watchdog, because budgets
  can hang.
- CDP `Input.dispatchKeyEvent` enters upstream of the renderer's trust decision,
  so `isTrusted === true` — unlike `element.dispatchEvent`, which is always false.
  Use `keyboard.down()`/`up()` separately with a real hold so frame-polled input
  registers.

### Cooperative hooks, per engine

- **Godot 4 web export** — `JavaScriptBridge` (`create_callback` takes exactly
  one Array arg), ~20 lines to install `window.__playtest`. Same shape as the
  existing autoload minus the socket.
- **Phaser 3** — cheapest, but nothing is exposed automatically: the dev must
  write `window.game = new Phaser.Game(cfg)`. Then `game.scene`, `game.registry`,
  first-class pause/resume.
- **Unity Web** — worst. `SendMessage` is **one-way, void, one arg**; getting
  state *out* needs a `.jslib` merged into `LibraryManager.library` plus
  `[DllImport("__Internal")]`. Costs an afternoon, not an hour.

Non-cooperative, honestly costed: pixels+VLM ≈ zero (VideoGameBench 0.48%); OCR
reads HUD digits and nothing semantic; Spector.js yields draw calls and shaders —
renderer telemetry, not "HP is 12."

### BUILD LIST

Config `{ kind:'browser', url, mode:'dom'|'canvas', headed?, hook?:'__playtest', frameBudgetMs?:250 }`.

- **DOM mode** — `ariaSnapshot()` *without* `boxes`; add boxes only when an
  `image` is also attached. Prune `generic`/`none` roles with no name; cap bytes
  and say so in-band (`[…N nodes elided]`) rather than truncating silently.
- **Canvas mode** — read only from `window.__playtest.observe()`, returning the
  *same result object* `docs/engine-bridge.md` already defines. No hook →
  **refuse**.
- **Turn-taking, three tiers:** `sentinel` (hook's `act()` resolves only when
  ready — identical contract to the RPC driver) → `prompt` (two identical
  consecutive `ariaSnapshot()`s) → `idle` (virtual-time budget, labelled a guess).
- **Refuse rather than degrade:** canvas with no hook; gamepad action space;
  `requestPointerLock()`; DOM mode where a `<canvas>` fills ≥50% of viewport and
  the tree has almost no interactive nodes; `playwright-core` present but no
  browser installed (name the exact `npx playwright install chromium` line).
- New `docs/browser-bridge.md`, sibling to `engine-bridge.md`, same "the two
  functions that are actually yours" framing, three engines.

---

## D. Deterministic transcript verifiers

*Pending — agent still running at the time of writing. If this section is still
empty, that question is open and the prompt is reconstructable from the heading.*

---

## E. Godot / Unreal bridge reality-check

### ⚠ This found real bugs in a doc that shipped

`docs/engine-bridge.md` was written from reasoning and had never been run against
an engine. Verified against Godot 4.7.2 and UE 5.8; all corrections are applied.

**The protocol SHAPE is validated** — three independent projects converged on it.
`godot-bridge` runs "an in-game `McpInteractionServer` autoload listening on
127.0.0.1:9090, speaking newline-delimited JSON" — independently identical.
`godot_rl_agents`' `sync.gd` is the mature version of the same pause → observe →
block-on-read → apply → unpause loop. VideoGameBench reports the same premise.

**What was wrong in the Godot autoload:**

| # | defect | consequence |
|---|---|---|
| 1 | Autoload `process_mode` is INHERIT, root is PAUSABLE | **`get_tree().paused = true` stopped the bridge's own `_process`.** The doc's own pause snippet deafened the bridge. Fatal. |
| 2 | `get_utf8_string(available)` decodes whatever bytes arrived | **Multi-byte characters straddling a TCP segment are mangled** — every em-dash and accented name in JRPG prose. *The same defect class already fixed in `stdio-game.ts` via `setEncoding`, reintroduced in GDScript.* |
| 3 | `--playtest-port=7777` without a bare `--` | `get_cmdline_user_args()` returns only what follows `--`, so the bridge **silently never starts**. |
| 4 | `_reply()` had no peer guard | crash after a client drop |
| 5 | no `set_no_delay(true)` | Nagle adds ~40 ms to every turn |
| 6 | `_advance_frames(15)` fixed count | wrong for anything resolving over a variable number of frames — i.e. most combat |

Not a bug: `is_connection_available()` merely moved from `TCPServer` to the new
`SocketServer` base in 4.6/4.7. The sketch was fine.

**What was wrong about Unreal — twice:**

- **`UGameInstanceSubsystem` does not tick.** It has no tick interface. The
  recommendation omitted `FTickableGameObject`, so the subsystem would exist and
  never run. Biggest error in the doc.
- **"The Remote Control API is editor-oriented" is false.** `-RCWebControlEnable`
  force-enables it in `-game` and packaged builds. The genuine objections are
  Beta status and RPC-shaped rather than turn-shaped semantics.
- "Gauntlet is heavy to stand up" was also overstated — Epic states it needs no
  game-side automation code. Right conclusion, wrong reason: it is the wrong
  *layer*, process-level puppeteering where this needs in-frame turn-taking.

**Determinism, which the doc said nothing about:** Godot `--fixed-fps N
--disable-render-loop`; UE `-deterministic` (= `-UseFixedTimeStep -FixedSeed`).
Godot's pause stops physics/process/input/animation/audio/particles; UE's leaves
Slate/UMG, the render thread, and `bTickEvenWhenPaused` actors running.

### BUILD LIST

All ten Godot corrections and the UE mechanism are **applied** to
`docs/engine-bridge.md`. Protocol additions applied: `hello` handshake with
version + capabilities, `reset` (a five-seat run should not need five process
launches), and a typed `done` reason (`win`/`lose`/`quit`/`stuck`/`timeout`) so
the critic can tell a finished run from a bridge that gave up.

Still open: **length-prefixed framing as an optional v2 transport.** It is what
the Godot prior art actually uses and it eliminates defect 2 structurally rather
than by discipline. Newline stays the default for debuggability — `nc` works.
