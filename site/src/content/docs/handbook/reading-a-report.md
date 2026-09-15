---
title: Reading a report
description: How to read REPORT.md — glyphs, coverage, splits, sample size.
sidebar:
  order: 5
---

The report is the product. It aggregates; it never rules.

## Criteria table

- **`!`** = that seat's jurors split
- **`met`** is seats (yes / no / unanswered)
- **`agreement`** is jurors on a 1-seat run, seats otherwise
- If any cell is `!`, the row does **not** print `unanimous`. Two seats that both met while their juries split print `seats agree (jurors split)`

An unanswered criterion is not a failed one. Met is `yes/no/unanswered` when any seat left a dash.

## Coverage

Under **How much each seat actually saw**:

- **`repeat`** = consecutive same input
- **`loop`** = 2-gram cycle
- **`H(a)`** = action entropy in **bits**
- Bold is thin / moderate / broad

Thin on a **short but varied** session is a **sample-size limit**, not “explored thinly / never reached the content.”

## Alive counts

Verdicts are counted against the seats that were **asked**, including directories whose `meta.json` could not be read, not against the seats that happened to produce a JSON critique. A half-dead run is not unanimous.

A **degraded panel with no juror answers** is not a fail-closed dead seat. The report names it.

A single judged seat is labelled a sample of one. Repeated runs of a fixed configuration have been measured spanning ~19 percentage points.

## `n_eff`

Kish `k / (1+(k−1)·φ̄)`. The report warns when `n_eff / k < 0.5`. Extra jurors at `panelSize: 3` are about 1.7 independent votes, not 3.

## `--runs N`

Beta-Binomial `Beta(s+1, n−s+1)`. Labels `STABLE_PASS` / `STABLE_FAIL` / `UNSTABLE`. n=3 is **DESCRIPTIVE**; `2/2^n` = 0.25. Do not read 3/3 as 100%.

## Machine-readable

`REPORT.json` has `kind: "single-run-report"` (never `multi-run-aggregate`). `schemaVersion` and `reportFormat` are on the generator stamp. Seat `meta.json` pins `schemaVersion` and `toolVersion`.
