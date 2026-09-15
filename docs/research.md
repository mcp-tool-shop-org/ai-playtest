# The evidence base

Every load-bearing design choice in this tool traces to something measured. This
file is where those measurements live, so the claims in the README and the
comments in the source can be audited rather than taken on faith.

Assembled 2026-09-14 by a parallel research wave during the first dogfood swarm.
Where the evidence is thin or contested, it says so — that is the point of
writing it down.

---

## 1. Observation channel — why structured text, not pixels

This is the decision that shaped the driver ladder. "Support more game kinds"
reads like "add a pixel driver"; the evidence says pixels are the worst channel
available and adding them frequently *lowers* performance.

| measurement | number | source |
|---|---|---|
| accessibility-tree vs screenshot-only success | **12.24% vs 5.26%** | OSWorld, Xie et al. 2024, [arXiv:2404.07972](https://arxiv.org/abs/2404.07972) |
| screenshot **+** tree vs tree alone (GPT-4V) | 12.17% vs 12.24% — no gain | OSWorld |
| adding vision to language (GPT-4o) | **32.34% → 22.56%** (worse) | BALROG, Paglieri et al. 2024, [arXiv:2411.13543](https://arxiv.org/abs/2411.13543) |
| raw-pixel frontier VLM game completion | **0.48%** (1.6% paused) | VideoGameBench, [arXiv:2505.18134](https://arxiv.org/abs/2505.18134) |
| structured API + code-as-action | 3.3× unique items, 15.3× faster milestones | Voyager, [arXiv:2305.16291](https://arxiv.org/abs/2305.16291) |
| perception scaffold effect on run **variance** | **±29.2 → ±4.9** | lmgame-Bench, [arXiv:2505.15146](https://arxiv.org/abs/2505.15146) |
| unharnessed runs failing to beat random | **40%** | lmgame-Bench |
| GPT-4o click-grounding, small targets | **0.8%** | ScreenSpot-Pro, 2025 |
| single-turn → multi-turn degradation | **−39% avg** | Laban et al. 2025, [arXiv:2505.06120](https://arxiv.org/abs/2505.06120) |
| action chunking vs one primitive per turn | +7.0–31.3% success, −78.9% calls | [arXiv:2609.02042](https://arxiv.org/abs/2609.02042) |
| a11y observation token cost | ~6000 tokens for 90% of cases | OSWorld |

**Contested:** Set-of-Marks helps where the accessibility tree is *incomplete*
(VisualWebArena 16.37% vs 15.05%, [arXiv:2401.13649](https://arxiv.org/abs/2401.13649))
and *hurts* where it is complete (AndroidWorld, [arXiv:2405.14573](https://arxiv.org/abs/2405.14573)).
No study found does a clean four-way pixels/text/a11y/JSON comparison inside one
game — OSWorld is closest and omits native JSON state.

**Consequence in this repo:** `Observation.text` is mandatory; `image` is an
optional attachment no driver may use alone. Driver build order is `stdio` →
`pty` → `rpc` → (`browser`) → pixels last.

---

## 2. Who may judge — the self-critique problem

The tool originally had each seat critique its own transcript while the README
cited the self-preference literature as justification.

| measurement | number | source |
|---|---|---|
| GPT-4 self-recognition, zero-shot | **73.5%** | Panickssery, Bowman & Feng 2024, [arXiv:2404.13076](https://arxiv.org/abs/2404.13076) |
| self-preference NOT explained by evaluator quality | only **10.4%** of 37,448 pairs | Roytburg et al. 2026, [arXiv:2601.22548](https://arxiv.org/html/2601.22548) |
| …but the residual survives in **subjective** domains, vanishes in verifiable ones | — | Roytburg 2026 |
| self-scaffold favouritism | **76.7% win rate, 24.7pp gap** | [arXiv:2508.05929](https://arxiv.org/pdf/2508.05929) |
| GPT-4 self-correction rounds (GSM8K) | **95.5% → 91.5% → 89.0%** | Huang et al. ICLR 2024, [arXiv:2310.01798](https://arxiv.org/abs/2310.01798) |
| self-critique vs **sound verifier** (Game-of-24) | **5% → 3% → 38%** | Stechly/Valmeekam/Kambhampati 2024, [arXiv:2402.08115](https://arxiv.org/abs/2402.08115) |
| …Graph Colouring / Blocksworld | 16→2→37 / 40→55→87 | same |
| panel-of-LLMs vs single GPT-4 judge (κ) | **0.763 vs 0.627**, 7–8× cheaper | Verga et al. 2024 (PoLL), [arXiv:2404.18796](https://arxiv.org/abs/2404.18796) |
| judge–human agreement is reliability without validity | Cohen κ **0.376–0.511** | Norman et al. 2026, [arXiv:2606.19544](https://arxiv.org/html/2606.19544v1) |
| intra-rater run-to-run instability | "rating roulette" | Haldar & Hockenmaier EMNLP 2025, [arXiv:2510.27106](https://arxiv.org/abs/2510.27106) |
| privileged self-access is real but fails out-of-distribution | — | Binder et al. 2024, [arXiv:2410.13787](https://arxiv.org/abs/2410.13787) |
| verbalized confidence beats token probabilities | ~50% relative ECE reduction | Tian et al. EMNLP 2023, [arXiv:2305.14975](https://arxiv.org/abs/2305.14975) |
| coincident failure across agent-written versions | 387.44 → 130.99 (majority triples) | Ron/Baudry/Monperrus 2026, [arXiv:2606.20158](https://arxiv.org/abs/2606.20158) |
| the evaluator effect — agreement between human evaluators | only **20%** of 93 problems found by all, **46%** by one only | Hertzum & Jacobsen 2003, [doi:10.1207/S15327590IJHC1501_14](https://www.tandfonline.com/doi/abs/10.1207/S15327590IJHC1501_14) |

**The nuance that matters:** most self-preference is competence, not narcissism —
*except* in subjective domains, and "did the world feel alive" is maximally
subjective. That is precisely where this tool operates.

**Consequence in this repo:** `panel.ts`. A transcript is judged by up to
`panelSize` seats from other families; the author's reading is kept as testimony;
ties resolve to not-met; dispersion is reported because disagreement is
information about the *criterion*. `pickJurors` returns an empty jury rather than
ever falling back to the author.

---

## 3. Coverage — did the session see enough to judge?

| measurement | number | source |
|---|---|---|
| repetitive-action rate, task-oriented agents | **63.4%** (loop rate 16.0%) | Ye et al. 2026, [arXiv:2605.16143](https://arxiv.org/html/2605.16143) |
| …agents **trained** for exploration | 24.9% / 7.7% | same |
| …effect of merely **prompting** an agent to explore | **+2.57** avg pass@1 | Englander et al. 2026, [arXiv:2604.17609](https://arxiv.org/html/2604.17609) |
| Exploration Checkpoint Coverage by model | Qwen2.5-7B 22.2% · GPT-4.1 49.3% · Opus-4.5 89.5% | same |
| discovered-but-unused affordances | seen 79–81%, used **37–50%** | Englander et al. 2026, [arXiv:2604.17609](https://arxiv.org/html/2604.17609) |
| synthetic vs human-authored IF | TextWorld 100% vs **Jericho 15.7%** | TALES, Cui et al. 2025, [arXiv:2504.14128](https://arxiv.org/abs/2504.14128) |
| 23 repeated runs of ONE fixed config | 57.9–76.8%, SD 5.4pp, **spread 18.9pp** | [arXiv:2607.02577](https://arxiv.org/html/2607.02577) |
| CI width by run count | 14.1% (n=1) → 2.97% (n=3) → 0.56% (n=28) | same |
| low action entropy tracks **low** success | 0.389 vs 0.778 | [arXiv:2606.05872](https://arxiv.org/html/2606.05872v2) |
| NetHack best-model progression | **1.5%** | BALROG |

⚠ **Correction (2026-09-14, study-swarm #2).** An earlier revision of this file,
`README.md` and `coverage.ts` described the 63.4% → 24.9% contrast as
task- vs "exploration-**conditioned**" agents, which reads as a prompting
effect. It is not: in Ye et al. that contrast is an **RL training regime**. Read
the band as what agent repetition looks like in the wild. The prompt-only effect
size is Englander's **+2.57** average pass@1 — real, but an order of magnitude
smaller, and it bounds what a `persona` string can be expected to buy.

**Consequence in this repo:** `coverage.ts` — novelty curve and half-life,
repeat / loop / self-loop rates, action entropy, thin/moderate/broad. All from
turn records; no instrumentation, no model calls.

---

## 4. How a verdict may speak — rank, don't score

Two independent literatures converge here, which is why the README leads with it.

| measurement | number | source |
|---|---|---|
| LLM judges, narrative quality: **system-level** τ | **≈0.70** (human ceiling 0.73) | Chhun et al. 2024, [arXiv:2405.13769](https://arxiv.org/abs/2405.13769) |
| …**story-level** τ | **0.16–0.25** (barely above BERTScore) | same |
| AI vs human pass rate, 95,266 players | Spearman **ρ = 0.80** | Roohi et al., [arXiv:2107.12061](https://arxiv.org/abs/2107.12061) |
| LLM agents track human difficulty (Wordle) | Pearson **r = 0.624** | Xiao & Yang 2024, [arXiv:2410.02829](https://arxiv.org/abs/2410.02829) |
| deep-learning playtester vs human success rates | MAE **4.0%** (no correlation coefficient reported) | Gudmundsson et al. CIG 2018, [doi:10.1109/CIG.2018.8490442](https://ieeexplore.ieee.org/document/8490442/) |
| LLM agents vs 3 experienced human QA testers | **82% vs 18%** detection — *complementary, not concordant* | TITAN 2025, [arXiv:2509.22170](https://arxiv.org/abs/2509.22170) |
| rubric-guided judging vs humans | Pearson **0.897** (vs GPT-4 0.882, ChatGPT 0.392) | Prometheus, [arXiv:2310.08491](https://arxiv.org/abs/2310.08491) |
| validated binary expert rubric, LLM assessors vs experts | **≈zero correlation** | TTCW, Chakrabarty et al. CHI 2024, [arXiv:2309.14556](https://arxiv.org/abs/2309.14556) |

**Rule of thumb this produces:** relative ordering transfers; absolute skill does
not. Ship "build B scored worse than build A on *reacts-to-player*", never "this
game is alive: yes".

---

## 5. Rubrics — ship a taxonomy, not a scale

| finding | source |
|---|---|
| Game heuristics fail inter-rater reliability: Krippendorff **α = 0.343** | White, Mirza-Babaei, McAllister & Good, CHI EA 2011, [doi:10.1145/1979742.1979788](https://dl.acm.org/doi/10.1145/1979742.1979788) |
| GEQ's postulated 7-factor structure: **no evidence** (N=633) | Law, Brühlmann & Mekler, CHI PLAY 2018, [doi:10.1145/3242671.3242683](https://dl.acm.org/doi/abs/10.1145/3242671.3242683) |
| PXI is the best-validated PX instrument (64 experts + N=529), independently replicated at **N=1518** | Vanden Abeele et al. 2020, [doi:10.1016/j.ijhcs.2019.102370](https://www.sciencedirect.com/science/article/pii/S1071581919301302); Perrig et al. CHI 2024, [doi:10.1145/3613904.3642270](https://dl.acm.org/doi/10.1145/3613904.3642270) |
| Pinelle's 12 usability-problem classes are empirically *derived* (108 game reviews) but never validated as a scoring instrument | Pinelle, Wong & Stach, CHI 2008, [doi:10.1145/1357054.1357282](https://dl.acm.org/doi/10.1145/1357054.1357282) |
| GameFlow was never operationalised into a validated measure — by its own authors' later account | Sweetser & Wyeth 2005; Sweetser et al. OzCHI 2019 |
| **No validated measure of NPC/world "aliveness" exists.** Best available protocol is comparative ablation + forced ranking + TrueSkill | Generative Agents, Park et al. 2023, [arXiv:2304.03442](https://arxiv.org/abs/2304.03442) |
| Generative Agents result: full architecture 29.89 > no-reflection 26.88 > **human crowdworkers 22.95** > fully ablated 21.21 | same |
| IEQ/GEQ/PENS substantially converge — picking three measures one thing three times | Denisova, Nordin & Cairns, CHI PLAY 2016, [doi:10.1145/2967934.2968095](https://dl.acm.org/doi/10.1145/2967934.2968095) |
| UNION's synthetic-negative taxonomy (repeated plot, conflicting logic, long-range incoherence) is directly reusable as judge criteria | Guan & Huang, EMNLP 2020, [arXiv:2009.07602](https://arxiv.org/abs/2009.07602) |
| Simulation richness ≠ perceived richness — judge what the transcript *surfaced*, not what the world contained | Ryan, *Curating Simulated Storyworlds*, UCSC 2018, [escholarship.org/uc/item/1340j5h2](https://escholarship.org/uc/item/1340j5h2) |

**Consequence:** the tool does **not** ship a default scoring rubric. The compound
`alive` boolean bundles three claims ("acts on its own", "reacts to you", "stays
coherent") into one bit and should eventually be split — see the open work below.

---

## 6. The gap, stated plainly

**No study found measures agreement between issues found by agent playtesters and
issues found by human playtesters for *experience quality*.** Automated
playtesting is validated against difficulty and competence only (Gudmundsson,
Roohi, Holmgård). TITAN measured bug-detection rates and found agents and humans
to be *complementary rather than concordant* — they find different things.

So the tool's central premise — that a model's confusions resemble a player's —
is untested in the literature in either direction. Dead spots and confusions are
leads to check, not findings. This is stated in the README and should stay stated
until someone measures it.

---

## 7. Terminal observation — why the `pty` driver is not just TUI support

Measured on this rig (Windows 11 26340, Node 22.22.3) rather than taken from a
paper, because the relevant facts are platform facts.

| measurement | result |
|---|---|
| `npm i node-pty @xterm/headless` | **2.3s**, prebuilt win32-x64, no node-gyp |
| stdio under a **pipe** | `isTTY:false`, `cols:null`, `rows:null` |
| stdio under a **PTY** | `isTTY:true`, `cols:100`, `rows:30` |
| same TUI, three redraws — **emulator grid** | **115 chars**, one current screen |
| same TUI, three redraws — **line-append** | **416 chars**, three stacked copies, player's echoed input interleaved, **three contradictory HP values** |
| ConPTY injects `ESC]0;<path>BEL` into every Windows session | **confirmed true** |

**The buffering fact is the load-bearing one.** Under a pipe, a C program's
stdout switches from line-buffered to **fully buffered (4 KB)**
([glibc manual](https://sourceware.org/glibc/manual/latest/html_node/Buffering-Concepts.html)).
So "output has been quiet for N ms" can mean *"has not flushed yet"* rather than
*"is waiting for you"* — the stdio driver's readiness rule is unsound for any
game that does not flush explicitly. A PTY restores line buffering and makes the
same heuristic sound. That is why `pty` improves the *text* path and is not
merely TUI support.

Two more platform facts worth knowing before choosing a driver:

- **ratatui/crossterm apps do not error under a pipe.** crossterm's `tty_fd()`
  falls back to `/dev/tty`, so raw mode succeeds and escape codes go into the
  pipe as literal bytes. The [Ratatui FAQ](https://ratatui.rs/faq/) puts it
  plainly: there is no indication anything went wrong.
- **On Windows a pipe captures nothing at all** from a game drawing through the
  Console API. Only ConPTY turns those calls into bytes.

**Readiness detection has no reliable external signal on Windows.** OSC 133
semantic-prompt marks are emitted by *shells* via `PS1` hooks, never by a game
binary. Cursor position carries no information (DSR is a query the terminal
answers — and you are the terminal). ConPTY does not relay the client's termios
state ([microsoft/terminal#6859](https://github.com/microsoft/terminal/issues/6859)).
The one usable proxy, verified here: `?2004h` (bracketed paste) means readline is
reading a line, observable via `parser.registerCsiHandler({prefix:'?',final:'h'})`.

Hence the tiered readiness in `pty-driver.ts`: game-emitted sentinel → `?2004h`
→ regex against the *rendered cursor line* → quiescence as a backstop, with the
tier that fired recorded on every observation so a reader can tell knowledge
from inference.

**Costs of the dependency, stated:** `@xterm/headless` is CJS-only (needs an
unwrapped import in this ESM repo); node-pty ships **no Linux prebuild** (CI
would compile it), and its `kill()` has live teardown bugs
([#952](https://github.com/microsoft/node-pty/issues/952),
[#967](https://github.com/microsoft/node-pty/issues/967)). Both are therefore
`optionalDependencies`, loaded lazily. A PTY also **merges stderr into stdout** —
one stream — which is why `PtyDriver.diagnostics` is always empty.

**Consequence in this repo:** `src/pty-driver.ts`, and the `Observation.grid`
field on the driver seam.

---

## Open work this evidence implies

Shipped in swarm #2 (do not re-open): **deterministic verifiers**
(`src/verifiers.ts`, six transcript-only checks; a trace still cannot prove
unwinnability) and **multi-run** (`--runs N`, `src/stats.ts` Beta-Binomial;
n=3 is descriptive). See `docs/research-2.md` and `docs/research-3.md`.

Still open:

1. **Split the compound `alive` boolean** into separately-evidenced dimensions
   (autonomy, reactivity, continuity, comprehensibility, progress), mirroring
   PXI's construct separation.
2. **Action chunking.** +7.0–31.3% success at −78.9% model calls — the current
   loop is one input per turn, which is structurally ReAct.
3. **Persona presets** and a **browser/canvas driver** — specified in
   `docs/research-2.md` §B and §C, not built.
