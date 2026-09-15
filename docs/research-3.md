# The evidence base, wave 3 -- the jury default, and what proof-01 showed

Dispatched 2026-09-14 at the start of dogfood swarm #2, after the first live
run against claude-rpg and before the verifier / multi-run code landed. Four
research agents, instructed not to spawn sub-agents. All four returned.

Companion to [`research.md`](research.md) (what shipped in swarm #1) and
[`research-2.md`](research-2.md) (the build lists this swarm executed).

---

## The decision: panelSize defaults to 1

The README used to carry Verga 2024 (PoLL) and Kohli 2026 side by side,
deliberately unresolved. That is now resolved, on purpose.

**Default: one strongest author-off judge as the score. Optional cheap second
seat only to flag disagreement. Do not keep 3-judge panels as the scoring
default. Do not treat 1×N same-model samples as independent votes.**
Author-off-jury is unchanged.

1. **A 3-model cross-family PoLL beat GPT-4 on human agreement (κ 0.763 vs 0.627) at ~7–8× lower cost, mainly by cutting intra-model self-preference -- not by beating the best individual judge.** Verga et al. 2024, *Replacing Judges with Juries* ([arXiv:2404.18796](https://arxiv.org/abs/2404.18796)). Implication: PoLL is a cheaper alternative to one *large* judge; it does not justify 3-family majority as the accuracy-optimal default.

2. **Nine frontier judges from seven families yield Kish n_eff = 2.18 [2.07–2.31], mean φ̄ = 0.391; majority 72.0% vs best single 71.8%.** Kohli 2026, *Nine Judges, Two Effective Votes* ([arXiv:2605.29800](https://arxiv.org/abs/2605.29800)). Implication: at panelSize=3 and φ≈0.39, n_eff ≈ 1.69 -- paying for three votes buys ~1.7 independent ones.

3. **Family diversity buys only a small φ drop: same-family 0.437 vs cross-family 0.389; one-per-family (7 judges) *lowers* n_eff to 1.93.** Kohli 2026 (same). Implication: brand-name diversity is not independence.

4. **Dawid–Skene and accuracy-weighted voting close ≤11% of the Condorcet gap; Dawid–Skene *underperforms* majority on MNLI (70.7% vs 72.0%).** Kohli 2026 (same). Implication: smarter aggregation cannot extract a third vote from ~2.2 effective votes.

5. **On HELM, pairs agree ~60% of the time when both are wrong (chance ≈ 1/3); larger, more accurate models are *more* correlated even across architecture and provider.** Kim, Garg, Peng & Garg 2025, *Correlated Errors in Large Language Models* ([arXiv:2506.07962](https://arxiv.org/abs/2506.07962)).

6. **A second ballot can change unweighted majority *only* on 1-vote-margin items; n_eff is unchanged; the best single judge still beats the panel.** Shu 2026, *Blind to the Pivotal Vote* ([arXiv:2608.06940](https://arxiv.org/abs/2608.06940)). Parallel: Laddha et al. 2026, *SLMJury* ([arXiv:2606.07810](https://arxiv.org/abs/2606.07810)) -- best 3-judge majority +0.06pp over the best individual.

What this does **not** change: a seat never scores its own play. That rests on
Panickssery 2024, Stechly 2024, Huang 2024, Roytburg 2026 -- subjective domains
are exactly where residual self-preference concentrates, and "did the world
feel alive" is as subjective as it gets.

---

## Absorbing-SCC: how to print it

Mawhorter & Smith FDG 2021: softlock-freedom is `AG(EF(goal))` over an
enumerable Kripke structure. A path cannot prove unwinnability. Failed checks
should be visualized traces, not "the game is broken."

Sadowski et al. 2015 (Tricorder): an *effective* false positive is any report
the reader will not act on. ~75% of bugs filed against one analyzer were
**misread wording**.

OASIS SARIF 2.1: `kind=review` = human must decide; incomplete evidence must
not be `fail`.

**Recipe used in the report:** `kind=review`. Title: possible sink in the
observed screen graph. Must not say trap / unwinnable / deadlock / fail.
Print hub-camp FP and budget FP beside every hit. Link Mawhorter.

---

## REPORT.md as a human artifact (proof-01)

proof-01 (mistral × 8 turns against claude-rpg, 2026-09-14, 198s, no crash,
no key leak, `turnsPlayed` 8, quit excluded, jury of qwen/llama/deepseek from
the config roster even though only mistral played) is the first time any
report surface was read as a human would. What was wrong:

1. **Coverage said "thin" and "weigh claims about content they may never have reached"** while the transcript showed 8/8 novel screens. The n<10 rule is a sample-size limit, not an exploration failure. (Inozemtseva & Holmes 2014: coverage without the trace is a false proxy. Lloyd 2022: n is a qualifier.)
2. **The criteria table hid juror splits.** One playing seat → agreement column `—`, cells `no!`. The 1/3 on `ambush-on-entry` was only in the verdict list.
3. **Jury dead spots never reached the report.** Qwen's "combat loop, unfulfilled favor" lived in `meta.json`. The "Every dead spot" section listed only the author's testimony.
4. **`unknown-command-answered` was credited to `/director`**, a known debug command that cost a turn. Llama voted no; majority 2/3 said yes. The criterion wants an *unknown* slash command. Also: many "world moved" criteria were evidenced from the save recap, which the last player action did not produce.
5. **The last player input's resulting screen was labelled `quit`.** `/director` opened director mode; that screen was consumed by the quit loop and stripped from critic evidence. The recap the jury cited was the `save`/`exit` screen. Fixed in `run.ts`.

`game.env` named `ANTHROPIC_API_KEY=$OPENROUTER_API_KEY` and the narrator ran;
`inheritEnv` was off; `OPENROUTER_API_KEY` did not appear in the transcript or
the report. That is the correct behaviour.

A five-seat × 40-turn comparison against the historical claude-rpg runs was
**not** started. The small run's report was not clean, and a 5×40 with
`panelSize: 3` would have spent the budget the decision above just moved.

---

## Small-n copy (what `--runs 3` prints)

Hariri et al. arXiv:2510.04265: binary posterior `Beta(s+1, n−s+1)`, mean
`(s+1)/(n+2)`. Walker 2020: BCa 95% coverage at n=5 is 81–83%. Hoekstra et al.
2014: researchers endorse multiple false CI statements. Exact sign-flip floor
is `2/2^n`.

The CLI prints that n=3 is DESCRIPTIVE, names `2/2^n = 0.25`, refuses a
p-value, shrinks 3/3 to 0.80, and labels STABLE_PASS / STABLE_FAIL / UNSTABLE.
n=6 is the first inferential n (floor 0.031) and still reports the posterior
mean, not 100%.
