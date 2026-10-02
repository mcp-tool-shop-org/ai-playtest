# The evidence base, wave 4 -- probability judges, criteria, and a test bed

Dispatched 2026-10-02, after the first big-model runs against four studio games
and a 14-case check of who judges correctly. Three research agents (Sonnet),
instructed not to spawn sub-agents. All three returned.

Companion to [`research.md`](research.md), [`research-2.md`](research-2.md) and
[`research-3.md`](research-3.md).

---

## What prompted it: a judge check with an answer key

Fourteen transcripts from that day's runs had a known right answer, fixed from the
transcripts themselves before any judge saw them:

- **Salt Road, "the world changes without the player causing it" (8 cases).** In a
  shared-sim panel the scenario cue fired only for the first seat (the cue counted
  rounds per process; fixed in ai-rpg-engine#29), so three seats truly saw nothing
  change, and five seats on fresh sims saw the quay re-dress.
- **Ghost on the Menu at the tape's own rung, "there is a reason not to shoot
  everything" (3 cases).** Scripted play showed shooting everything cost nothing, so
  the truth is no.
- **Ghost, "the field is readable" (3 cases),** meant as a yes control.

| judge | Salt Road world-moves | Ghost choices-cost | Ghost field-readable |
|---|---|---|---|
| the run's own single LLM judges | 6/8 (missed the re-dress twice) | 0/3 | 3/3 |
| `deepseek/deepseek-v4-flash` | 8/8 | inconsistent across identical runs | said no |
| `typesafe/jev-1.13` (P(met)) | **8/8**, true >= 0.92, false <= 0.18 | 0/3 at 0.5 (p 0.68-0.80) | said no (p 0.22-0.28) |

Two passes cost $0.0073 in total. Three findings shaped what was built:

1. On an observable, single-claim criterion, a decision model returning a
   probability separated true from false with wide margins and never failed a
   call. The LLM judges we had been using missed two of eight.
2. Every judge failed the Ghost criteria, and the criteria were the cause.
   "Shooting and holding have different consequences, *so* there is a reason not
   to shoot everything" bundles a true claim with a false one; judges answer the
   true half. "What is on the field and what each choice will do" bundles a shown
   fact with an arguable one. The yes control was arguably not a yes.
3. DeepSeek V4 Flash reasons before it answers: empty content at a 400-token
   budget, malformed JSON 2/14 at 3,000, and verdicts that flipped between
   identical runs. A decision model has no such failure mode.

---

## Lane C -- writing criteria a judge can score, and calibrating it

1. **Decomposed yes/no checklists raise judge agreement.** CheckEval replaces Likert
   scoring with decomposed binary questions; across 12 evaluator models inter-model
   agreement rose by about 0.45 and variance fell. Lee et al., *CheckEval*, EMNLP
   2025 ([arXiv:2403.18771](https://arxiv.org/abs/2403.18771)). → criteria are
   yes/no questions about one observable claim.
2. **The gain is real but modest against humans.** TICK raised LLM-vs-human exact
   agreement from 46.4% to 52.2%; human inter-annotator agreement went 0.194 to
   0.256. Cook et al. 2024 ([arXiv:2410.03608](https://arxiv.org/abs/2410.03608)).
   → a human-labelled calibration set is still needed.
3. **One construct per criterion.** Autorubric scores each criterion separately to
   avoid criterion conflation and halo effects; binary criteria had the best
   agreement (κ 0.642). Rao & Callison-Burch 2026
   ([arXiv:2603.00077](https://arxiv.org/abs/2603.00077)). → `lintCriteria` warns on
   criteria that join claims with "so", "because", "therefore", "but", a semicolon,
   or more than one sentence.
4. **LLM judges are overconfident.** Confidence clusters at 90-100% while accuracy is
   far lower; fusing several judges' outputs cut expected calibration error by
   53.7% for the weakest model. Tian et al. 2025
   ([arXiv:2508.06225](https://arxiv.org/abs/2508.06225)). → the probability comes
   from the decision model, the evidence text from an LLM critic.
5. **Calibration claims are model-generation dependent.** On post-2025 proprietary
   models, verbalised confidence beat token log-probabilities (Hsiao 2026,
   [arXiv:2609.10996](https://arxiv.org/abs/2609.10996), single-author preprint).
   → measure Jev's calibration on labelled cases before trusting P(met) as a
   probability; until then report it with an uncertain band (0.35-0.65 by default).
6. **Judge panels are correlated.** Nine judges behave like about two effective
   votes, and Dawid-Skene is not reliably better than majority. Kohli 2026
   ([arXiv:2605.29800](https://arxiv.org/abs/2605.29800)). → no aggregation layer;
   a decision model is the independent second opinion, flagged where it disagrees.
7. **Fine-tuned small judges do not generalise like large ones.** Huang et al. 2024
   ([arXiv:2403.02839](https://arxiv.org/abs/2403.02839)). No study was found of a
   decision model scoring game transcripts. → validate per criterion family.
8. **Player-experience instruments are mostly self-report.** PENS (Ryan, Rigby &
   Przybylski 2006) and PXI (Abeele et al. 2020) measure needs and experience by
   questionnaire; only their functional constructs (clear goals, feedback after an
   action, ease of control, meaningful choice) are visible in a transcript. GEQ's
   seven-factor structure was not supported in a 633-participant validation (Law,
   Brühlmann & Mekler, CHI PLAY 2018). → criteria may be *inspired by* PXI/PENS
   functional constructs; do not claim to measure immersion or enjoyment.

---

## Lanes A and B -- is there a test bed with known answers?

The question: an existing game or benchmark where the playtest variables (does the
world move on its own, is there a dead end, does a refusal come from a character,
does the prompt make the wanted input clear, do choices cost anything) can be set
on purpose, so the playtester itself can be scored.

**Nothing found lets those variables be set.** The closest prior art:

- **GBQA** (2026, [arXiv:2604.02648](https://arxiv.org/abs/2604.02648),
  github.com/camel-ai/GBQA, Apache-2.0). 30 generated games, 124 human-verified
  planted bugs (logic errors, description flaws, state not reflected in text) at
  three difficulty levels; agents act through API calls and see text. Recall is
  scored by a critic that semantically matches reports to the ground truth; the best
  model found 48.4%. It tests bug-finding, not criterion-judging, but it is the
  nearest published "test the tester" design and a candidate second benchmark.
- **playtest-agent** (github.com/kevinnie2003/playtest-agent, MIT). A deterministic
  dungeon crawler with eight toggleable planted bugs (one a soft-lock), scored by
  precision and recall against a clean build. Too easy, but the right shape: a clean
  build plus mutants.
- **TextWorld** (github.com/microsoft/TextWorld, MIT). Procedurally generated text
  games with settable rooms, objects and quest depth, and known solutions. No
  time-driven events and no dead-end control in what the lane could read.
- **TALES / Jericho** (Microsoft, 2025 / GPL-2.0): fixed games with walkthroughs;
  nothing to set. **ScienceWorld**: the only candidate with processes that change
  the world on their own (unconfirmed). **MiniHack**: live monsters and authored
  hazards via a level DSL, but a grid, not a text channel.
- Visual glitch datasets (VideoGameQA-Bench, GlitchBench, VideoGlitchBench, PhysGame)
  are pixels; ai-playtest's players read text.
- One study validated an LLM playtester against humans: LLM agent performance
  correlated strongly with human difficulty on Wordle and Slay the Spire, though
  the agent played worse ([arXiv:2410.02829](https://arxiv.org/abs/2410.02829)).
  It covers difficulty, not engagement or confusion.

**Gaps no dataset covers for text games:** ignored input, labelled dead ends and
soft-locks, prompts that leave the wanted input unclear, refusals from the system
rather than a character, choices without cost, a world that never moves, loops,
and human-vs-model agreement on confusion points.

### Two in-house leads

- **si-rpg-engine's reachability sweep** explores every reachable state of a world
  before it runs and refuses a world with an unreachable zone, producing a witness
  that replays. **Its bench measures itself with planted changes of known effect.**
  Both patterns carry over: a small test game can be swept exhaustively, which makes
  its soft-lock answer key exact, and each variant is a planted mutant with a known
  effect on each criterion.
- **ai-rpg-engine** ships twelve genre starter packs, deterministic seeds and replay,
  and a pack authoring path (`scaffold`, `validate`, `audit-content`), reachable over
  the existing rpc bridge. It is the richer tier once the small test bed exists.

---

## What was built from this

- `decisions.ts`: a general client for OpenRouter's Decisions API (noul, choice and
  score questions, validated typed answers, cost), so further decision-model features
  share one transport.
- `scorers.ts`: probability judges beside the jury. `{ "kind": "jev" }` asks every
  criterion in one request and records P(met); the report shows it per criterion and
  seat with an uncertain band and flags confident disagreement with the jury.
- `ai-playtest score`: re-score a finished run from its saved transcripts, against
  the config's current criteria, without replaying the game.
- `lintCriteria`: a warning on criteria that probably bundle two claims.
- Next: a calibration game with every playtest variable as a switch and an answer key
  computed from the game itself (see the README once it lands).
