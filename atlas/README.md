# ai-playtest: how it works

Mapped at 2026-10-02 from commit 733e148 by Atlas 1.24.0.

## What this is

6 parts, mostly TypeScript (42 files), JavaScript (4), CSS (2) and Astro (1). Work enters through 3 doors; the busiest is CI, which reaches 3 parts. It deploys a site to GitHub Pages. ai-playtest is a command of a private package (nothing ships it).

## What changed since 2026-10-02 (0cd8e69)

- CI now also runs src/decisions.test.ts and src/scorers.test.ts.
- CI now also builds src/decisions.ts, src/rescore.ts and src/scorers.ts.
- In src/cli.ts, `main` gained a step, `createDecisionsClient`, before `rescoreRun`.
- In src/cli.ts, `main` gained a step, `rescoreRun`, before `writeReport`.
- In src/cli.ts, `main` gained a step, `createDecisionsClient`, before `summarizeRuns`.
- And 12 more changes to the order of work.
- 6 files added and 4 changed content, across 3 parts.

## What comes in

1. **CI.** On a pull request touching 9 paths; on a push to main touching 9 paths; or by hand. Runs src/cli.test.ts, src/coverage.test.ts, src/critic.test.ts and 14 more; builds src/cli.ts, src/config.ts, src/coverage.ts and 19 more; checks CHANGELOG.md, LICENSE and src/.
2. **Deploy site to GitHub Pages.** On a push to main touching 2 paths; or by hand. Runs site/astro.config.mjs and site/src/.
3. **ai-playtest** (a command of a private package, which nothing ships). Runs src/cli.ts.

## What happens through CI

1. The workflow runs 13 files in src and 4 files in test; it builds 22 files in src; it checks CHANGELOG.md and LICENSE in the repository root and src/ in src.
2. It uploads coverage to Codecov.

## Who reads the results

CI writes nothing this map can see.

## The other doors

**Deploy site to GitHub Pages** runs site/astro.config.mjs and site/src/, and deploys the site.

**ai-playtest** (a command of a private package, which nothing ships) runs src/cli.ts.

## What breaks what

- **src** is imported only from tests, by 1 part (test), and sits on the path of 2 doors.

## What tends to change together

- **src/cli.ts** and **src/index.ts** changed together in 5 of 6 commits, inside the src part.
- **src/index.ts** and **src/report.ts** changed together in 5 of 6 commits, inside the src part.
- **src/cli.ts** and **src/config.ts** changed together in 4 of 6 commits, inside the src part.
- **src/cli.ts** and **src/report.ts** changed together in 4 of 6 commits, inside the src part.
- **src/report.ts** and **test/run.test.ts** changed together in 4 of 6 commits, and the test part imports the src part.

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

People write .github/, docs/, the repository root and site/; 2 writes with paths built at run time may land here.

## Where to start

.github/workflows/ci.yml → src/cli.ts → src/config.ts → src/providers.ts → src/openrouter.ts → src/ollama.ts → src/decisions.ts → src/stats.ts

Read those in order to follow one pull request end to end.

## What this map cannot see

- 2 imports could not be resolved: `src/index.ts` imports `./calibration.js`, which is not in this repository, twice.
- 2 writes and 2 reads use paths built at run time and are not named here.
- 12 writes and 15 reads go to a path their caller passes, not to this repository.
- 1 command is built at run time and not followed.
- 1 file belongs to no part: examples/local-smoke.playtest.json.
- Statistics confidence is low: fewer than 30 qualifying commits in the window, and fewer than 25 source files reach 10 revisions.

Regenerate with `npx --yes @dogfood-lab/atlas map`.
