# ai-playtest: how it works

Mapped at 2026-10-02 from commit b0f5ede by Atlas 1.24.0.

## What this is

6 parts, mostly TypeScript (34 files), JavaScript (4), CSS (2) and Astro (1). Work enters through 3 doors; the busiest is CI, which reaches 3 parts. It deploys a site to GitHub Pages. ai-playtest is a command of a private package (nothing ships it).

## What changed since 2026-09-30 (94e69fc)

Nothing structural changed since 2026-09-30; 6 files changed content.

## What comes in

1. **CI.** On a pull request touching 9 paths; on a push to main touching 9 paths; or by hand. Runs src/cli.test.ts, src/coverage.test.ts, src/critic.test.ts and 11 more; builds src/cli.ts, src/config.ts, src/coverage.ts and 14 more; checks CHANGELOG.md, LICENSE and src/.
2. **Deploy site to GitHub Pages.** On a push to main touching 2 paths; or by hand. Runs site/astro.config.mjs and site/src/.
3. **ai-playtest** (a command of a private package, which nothing ships). Runs src/cli.ts.

## What happens through CI

1. The workflow runs 10 files in src and 4 files in test; it builds 17 files in src; it checks CHANGELOG.md and LICENSE in the repository root and src/ in src.
2. It uploads coverage to Codecov.

## Who reads the results

CI writes nothing this map can see.

## The other doors

**Deploy site to GitHub Pages** runs site/astro.config.mjs and site/src/, and deploys the site.

**ai-playtest** (a command of a private package, which nothing ships) runs src/cli.ts.

## What breaks what

- **src** is imported only from tests, by 1 part (test), and sits on the path of 2 doors.

## What tends to change together

No two source files changed together often enough to name.

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

.github/workflows/ci.yml → src/cli.ts → src/config.ts → src/openrouter.ts → src/stats.ts → src/run.ts → src/report.ts

Read those in order to follow one pull request end to end.

## What this map cannot see

- 6 imports could not be resolved: `src/cli.ts` imports `./ollama.js`, which is not in this repository; `src/cli.ts` imports `./providers.js`, which is not in this repository; `src/config.ts` imports `./ollama.js`, which is not in this repository; and 3 more.
- 2 writes and 1 read use paths built at run time and are not named here.
- 11 writes and 8 reads go to a path their caller passes, not to this repository.
- 1 command is built at run time and not followed.
- Statistics confidence is low: fewer than 30 qualifying commits in the window, and fewer than 25 source files reach 10 revisions.

Regenerate with `npx --yes @dogfood-lab/atlas map`.
