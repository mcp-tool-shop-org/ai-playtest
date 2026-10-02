# ai-playtest: how it works

Mapped at 2026-10-02 from commit de93770 by Atlas 1.24.0.

## What this is

6 parts, mostly TypeScript (49 files), JavaScript (6), CSS (2) and Astro (1). Work enters through 3 doors; the busiest is CI, which reaches 3 parts. It deploys a site to GitHub Pages. ai-playtest is a command of a private package (nothing ships it).

## What changed since 2026-10-02 (5e6bf56)

- CI now also runs src/cli-verbs.test.ts, src/diff.test.ts, src/rescore.test.ts and 1 more.
- CI now also builds src/diff.ts.
- In src/cli.ts, `main` gained a step, `parseAcceptances`, before `diffRuns`.
- In src/cli.ts, `main` gained a step, `diffRuns`, before `renderDiff`.
- In src/cli.ts, `main` gained a step, `renderDiff`, before `openFindings`.
- And 5 more changes to the order of work.
- 6 files added and 9 changed content, across 4 parts.

## What comes in

1. **CI.** On a pull request touching 9 paths; on a push to main touching 9 paths; or by hand. Runs src/cli-verbs.test.ts, src/cli.test.ts, src/coverage.test.ts and 19 more; builds src/calibration.ts, src/cli.ts, src/config.ts and 21 more; checks CHANGELOG.md, LICENSE and src/.
2. **Deploy site to GitHub Pages.** On a push to main touching 2 paths; or by hand. Runs site/astro.config.mjs and site/src/.
3. **ai-playtest** (a command of a private package, which nothing ships). Runs src/cli.ts.

## What happens through CI

1. The workflow runs 16 files in src and 6 files in test; it builds 24 files in src; it checks CHANGELOG.md and LICENSE in the repository root and src/ in src.
2. It uploads coverage to Codecov.

## Who reads the results

CI writes nothing this map can see.

## The other doors

**Deploy site to GitHub Pages** runs site/astro.config.mjs and site/src/, and deploys the site.

**ai-playtest** (a command of a private package, which nothing ships) runs src/cli.ts.

## What breaks what

- **src** is imported only from tests, by 1 part (test), and sits on the path of 2 doors.

## What tends to change together

- **src/index.ts** and **src/report.ts** changed together in 6 of 8 commits, inside the src part.
- **src/report.ts** and **test/run.test.ts** changed together in 5 of 7 commits, and the test part imports the src part.
- **src/cli.ts** and **src/index.ts** changed together in 6 of 9 commits, inside the src part.
- **src/cli.ts** and **src/config.ts** changed together in 5 of 8 commits, inside the src part.
- **src/cli.ts** and **src/report.ts** changed together in 5 of 8 commits, inside the src part.

1 file changed together with its own test, as expected.

Confidence is low: fewer than 30 qualifying commits in the window, and fewer than 25 source files reach 10 revisions.

Window: 180 days; a pair counts from 3 shared commits, since the window holds fewer than 30 qualifying commits.

## What no test touches

Every code part is imported by at least one test.

## Written but never read

No place this map can see is written, so none goes unread.

## Helpers that look duplicated

No two parts export a helper that looks alike.

## Generated, never hand-edited

Nothing in this repository writes to a tracked place this map can see.

## Hand-authored

People write .github/, docs/, the repository root and site/; 4 writes with paths built at run time may land here.

## Where to start

.github/workflows/ci.yml → src/cli.ts → src/config.ts → src/providers.ts → src/openrouter.ts → src/ollama.ts → src/decisions.ts → src/stats.ts

Read those in order to follow one pull request end to end.

## What this map cannot see

- 4 writes and 3 reads use paths built at run time and are not named here.
- 2 writes go to places this repository does not track, so they are not listed as generated.
- 12 writes and 22 reads go to a path their caller passes, not to this repository.
- 1 command is built at run time and not followed.
- 8 files belong to no part: calibration/README.md, calibration/answer-key.json, calibration/calibrate.mjs and 5 more.
- Statistics confidence is low: fewer than 30 qualifying commits in the window, and fewer than 25 source files reach 10 revisions.

Regenerate with `npx --yes @dogfood-lab/atlas map`.
