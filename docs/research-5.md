# The evidence base, wave 5 -- what to build next, Jev's other uses, and 3D

Dispatched 2026-10-02, while the first Harrow Gate calibration run played on a
rented GPU. Five research lanes from one brief, run by hand by the Director on
Grok Build (5× Grok 4.7) the same day. Sources below are as Grok Build reported
them. It marked each one retrieved or recalled, and every claim used here was
marked retrieved. This note is the studio's synthesis, not Grok's text.

Companion to [`research.md`](research.md) through [`research-4.md`](research-4.md).

The five lanes:
1. the market
2. more uses for a decision model
3. 3D
4. growing the calibration game
5. personas

---

## The one-line answer

Teams pay for a failing check they can file. Build a build-versus-build delta
that exits non-zero, carries a repro, and has a human accept step, before any new
judge, persona or pixel agent. **Built the same day as `ai-playtest diff`** (see
the README, "Comparing two builds").

The five lanes agree on the shape. A finding is a named failure with evidence,
and pixels are an exhibit attached to it. Jev screens single claims and abstains;
it neither gates the player nor stops a run. Harrow Gate grows as a generator
whose answer key is computed. A persona counts only if a statistic in the turn
log moves.

## The order, and where each step stands

| # | build | lane | status |
|---|---|---|---|
| 1 | Build-vs-build delta: non-zero exit, repro, accept bit | 1 | **built**: `diff`, exit 5, `--accept` with a required note |
| 2 | Single-claim Jev cascade with an abstain band; leave raw P(met) unfitted | 2 | next for us, after the first calibration grade |
| 3 | Exact answer key for Harrow Gate: AG(EF(goal)) and counterexample paths | 4 | **out to Grok Build** as a parallel slice (new files under `calibration/` only) |
| 4 | Godot 3D scene slice, navmesh readiness, reachability sweep, before any seat | 3 | waits for a 3D title in play |
| 5 | One persona set with an acceptance test | 5 | waits on one decision (below) |

## What each lane changes for us

### 1. The market: sell the failure, not the score

- modl.ai, nunu.ai, GameDriver and Razer QA Companion-AI sell the same thing: a
  named flow run on a new build, with evidence and pass/fail, and a person deciding
  what becomes a ticket. Sources: modl.ai's site, and a GamesIndustry.biz interview
  with Christoffer Holmgård (27 Aug 2026).
  → **Why `diff` keeps accepted findings visible and requires a note.**
- Observation splits into two priced camps:
  - rendered frames, with no SDK (nunu.ai: $200/month for 20,000 credits)
  - an in-engine object query (GameDriver: from $200 per node per month)

  We are in the second camp already. A pty grid or one Godot frame attached to a
  failure is evidence; a pixel agent is a second product.
- King reports level difficulty to its designers, not "the bot cleared it."
  Source: Sahar Asadi, GamesIndustry.biz, 26 Jun 2024, reporting 95% fewer manual
  tweaks on match-3.
  → For a turn-based RPG, the matching output is an **encounter sheet**: fail
  rate, turns and resources per encounter over seeded runs, against the last
  build. It is the strongest feature after the delta.
- Steam Playtest is a gate for human beta players with no API for bots (Steamworks
  docs). Do not integrate it.
- Jira or Linear export only after a finding is accepted. A ticket per run kills
  adoption, and single-judge noise makes it worse.

### 2. Jev: a screen in front of the judge, not a second judge

- **Jev's confidence ranks well but is not P(correct).**
  - On 3,080 Banking77 items, Jev 1.13 scored 81.0% to Claude Opus 5's 84.4%, at
    about 1/22 of the cost. Source: OpenRouter, "Is Jev as Accurate as Frontier
    Models at Classification?", 22 Sep 2026.
  - At confidence ≥ 0.99 it was right 96.3% of the time; below 0.5, 29.6%.
  - The cascade threshold in that article was tuned on the same rows it was scored
    on, so treat it as an upper bound.
- **Cascades work** (FrugalGPT, arXiv:2305.05176), but routers need labels from
  the domain they route (RouteLLM, arXiv:2406.18665). A threshold fit on Harrow
  Gate does not transfer to the harbour or to Saint's Mile.
- **How many labels:**
  - About 20 labels per criterion can fit a monotone map on an ordinal score
    (CORDIAL, arXiv:2609.29807).
  - Platt and isotonic scaling often fail to improve log loss (Manokhin and
    Grønhaug 2026, PMLR 329).
  - Isotonic wants on the order of a thousand points (Niculescu-Mizil and Caruana
    2005).

  → **Our 14 known-answer transcripts support a Brier score, not a refit.** A
  calibrator ships only if held-out Brier on Harrow Gate drops.
- **Uses, ranked:**
  1. The cascade (one `noul` per claim; escalate the middle band, and any
     disagreement with a deterministic check, to the LLM judge).
  2. A `score` rubric for ranking builds.
  3. Read-order triage for a person.
  4. Checking that a bug report reproduces.
- **Dropped:**
  - Gating the seat's action. It changes the coverage measures we rely on.
  - Early stops on "looks buggy." A playtest wants exactly those sessions
    (arXiv:2606.27009, arXiv:2607.06503).
- **A local fallback exists if the alpha API goes away.** A sub-1B entailment
  checker reaches GPT-4 accuracy on claim checks (MiniCheck, arXiv:2404.10774).

### 3. 3D: an rpc seat with a scene slice, and the checks come before any model

- SIMA 2 is 720p pixels in and keyboard and mouse out, with no game state, and
  DeepMind lists precise control and 3D understanding as open problems
  (arXiv:2512.04797). Structured text beats adding images on BALROG
  (arXiv:2411.13543) and Orak (arXiv:2506.03610).
  → **Keep JSON-RPC.** The model names a target id, and the harness walks there
  with `NavigationServer3D.map_get_path` and a `NavigationAgent3D`. This is the
  same split as the shooter bridge.
- A path query that only reads the navmesh cannot audit the navmesh
  (arXiv:2605.21397; Lu et al. 2022, arXiv:2209.00570, found climbable walls the
  mesh called unreachable). Walk a real body along each path and cast a ray to the
  floor; that is what catches a bad bake.
- Godot returns empty paths before the navigation map has synced. Readiness means
  `map_get_iteration_id > 0` and one physics frame after load (Godot 4.3 docs).
- **First checks:**
  1. A path exists to every authored interactable.
  2. Walk each path and flag stuck, fall-through, out of bounds and off-mesh.

  Seat a model only after both.
- Unreal later: Gauntlet runs sessions and is not an observation API, and Remote
  Control is an editor-only beta server. Use one small in-process RPC with the same
  JSON contract.

### 4. Harrow Gate: a generator with an exact key

- TextWorld's generator is its answer key (arXiv:1806.11532).
- "Never soft-locked" is the CTL formula AG(EF(goal)). It checks in seconds on a
  few thousand states and comes with a counterexample trace. Source: Mawhorter and
  Smith 2021, FDG, doi:10.1145/3472538.3472542.
- EF(goal), "winnable from the start," is the wrong trophy: their edited room was
  winnable and still soft-locked.
  → **Out to Grok Build** (`kickoff-02-harrow-exact`). Our own suspicion for it to
  confirm or refute: burning the lamp's three oil before reaching the seal makes
  the seal unreachable, and no logged event says so.
- Judge benchmarks that hold up are built from verifiers. JudgeBench's 350
  machine-keyed pairs already separate judges (arXiv:2410.12784). Grow the
  machine-keyed set into the hundreds before paying people.
- **When we do pay people:**
  - two raters, about 20 builds, single-claim questions only
  - report Krippendorff's alpha; experts reached only 0.343 on "why is this bad"
    (CHI EA 2011)
  - Prolific's published rates put that at roughly $230

### 5. Personas: a persona is a policy you can reject

- LLM play ranks difficulty the way people do while playing worse. GPT-4 tracked
  human Wordle difficulty at r ≈ 0.62 and Slay the Spire win rates up to r = 0.87.
  An optimal solver did not track humans at all (arXiv:2410.02829).
  → Rank encounters by agent fail rate. Never publish an agent win rate as a human
  one.
- A persona is real only if a statistic in the log moves. In Holmgård et al. 2018
  (arXiv:1802.06881), an evolved Completionist lost its own metric to the Treasure
  Collector. Naming one trait shifts others (arXiv:2609.35036). Persona variables
  explain under 10% of annotation variance (arXiv:2402.10811).
- Bartle-type buckets overlap and fail validity checks (IJHCS 190, 2024). Quantic
  Foundry's Story, Completion, Challenge, Strategy and Discovery are the right axes
  for a JRPG.
- **Signals a transcript supports:**
  - difficulty rank
  - stalls
  - quit-like stops
  - funnels to chapter flags
  - optional coverage
  - retries
  - progress continuity
  - path distance
  - soft-locks

  **Signals it does not support:** flow, felt frustration, churn, or PENS, PXI and
  GEQ scores. Do not ship those.

**Open decision: ship one persona set, not both.**

| set | personas | aims at | status |
|---|---|---|---|
| testing set | Cartographer, Closer, Boundary Pusher, Continuity Auditor, plus a no-persona control | unique bugs | specified in `research-2.md` §B, never built |
| player set | Runner, Reader, Completionist, Grinder, Quitter, Tinkerer | path diversity and per-encounter difficulty; each persona has a target statistic | Lane 5 |

## Corrections this wave caught

- The README and CHANGELOG said the `bleak` build flips every switch. It flips
  every switch except `reacts`, because a build that ignores input would hide the
  others; `deaf` covers that switch alone. Fixed in `de93770`.

## What Grok Build could not verify

- A public price for modl.ai.
- Whether Regression Games is still shipping (its page shows 2022 posts).
- Razer's price, and whether its gameplay agents are generally available (they
  are on its roadmap).
- A NetEase or Tencent paper on automated playtesting.
- A second decision model on OpenRouter besides Jev.
- Any study that sets human confusion and quit points against an LLM seat on the
  same JRPG build. That last gap is the one the README already states.
