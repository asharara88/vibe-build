# Package 0.4a: one licence rule for every dependency of `builder/`

| | |
| --- | --- |
| Date | 12 November 2026 |
| Package | 0.4 of `docs/BUILD-PLAN.md`, the `builder/` half. **Built before the plan allowed it** (0.4 needs licence codes L9 and L11; L11 is not true). It is on a branch, not merged, and waits on the owner's answer (known gap 42; `docs/STATUS.md`, question 2) |
| Run on | The development machine (a cloud session), directly on the host, against the packages installed there. The check only reads installed packages' files; it runs no generated code and no engine |
| Done means (plan) | "The check passes with no package outside that rule, and fails when a test package outside it is added" |
| Result for `builder/` | The check passes on `builder/`, and fails, naming each package, on a folder with test packages added. **State: built, not tested.** A first review found test packages that passed when they should not have; the corrections below have not yet been read by an independent reviewer |
| Result for `templates/next/` | **Not done, and red** |

## The rule

One rule for every installed package, shipped or development: its licence is on the permitted list, or the package is named in `builder/licence-rule.json` as the owner's approved exception for a named use (`docs/DECISIONS.md`, 12 November 2026). The rule lists every problem, not only the first. It also fails when:

- a package approved for development use is among the shipped packages ("shipped" is taken from the licence tool and from the lock file; either is enough);
- an approved package declares a different licence from the one approved;
- a licence is missing, or was only guessed by the tool from a file;
- a build package of `lightningcss` is not one of the eleven named one by one, or differs in version from `lightningcss` itself;
- a package is marked private (the tool reports such a package as unlicensed, so it is refused, not skipped);
- a declared dependency is not installed, or nothing at all was read;
- the notices file is out of date.

**One reading to know about.** Where a package offers a choice of licences ("A OR B"), it is accepted if one side is on the permitted list, and the check prints each such package. The earlier check did the same. No package in `builder/` uses a choice today.

## Run 1: the check on `builder/` (`npm run check:licences`)

```text
Licence check for builder
Rule: licence-rule.json
Packages checked: 191 installed, of which 17 shipped (not development-only).
Permitted licences: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, BlueOak-1.0.0, CC0-1.0, Python-2.0, PostgreSQL, Unlicense
Named exceptions in use:
  lightningcss-linux-x64-gnu@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-linux-x64-musl@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss@1.33.0 | MPL-2.0 | approved 2026-11-12 for development use | development only
  spdx-exceptions@2.5.0 | CC-BY-3.0 | approved 2026-11-12 for development use | development only
  spdx-ranges@2.1.1 | (MIT AND CC-BY-3.0) | approved 2026-11-12 for development use | development only
Notices file THIRD-PARTY-NOTICES.md is up to date.
RESULT: PASSED
exit code: 0
```

## Run 2: the same check on a folder with test packages added

A temporary folder of made-up packages: `fake-mit` (MIT, shipped); `fake-gpl` (GPL-3.0-only, shipped); `fake-mpl-tool` (MPL-2.0, development only); `lightningcss` with `lightningcss-cli` beside it (a name that starts the same way but is not one of the eleven approved build packages); `fake-private` (marked private); and `fake-absent`, declared but not installed.

```text
Licence check for ../../../tmp/fixture/demo
Rule: ../../../home/user/vibe-build/builder/licence-rule.json
Packages checked: 6 installed, of which 3 shipped (not development-only).
Permitted licences: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, BlueOak-1.0.0, CC0-1.0, Python-2.0, PostgreSQL, Unlicense
Named exceptions in use:
  lightningcss@1.33.0 | MPL-2.0 | approved 2026-11-12 for development use | development only
Named exceptions not installed here: spdx-exceptions, spdx-ranges
PROBLEM: fake-absent is declared as a dependency but is not installed, so its licence could not be read.
PROBLEMS: 4
  fake-gpl@1.0.0 | GPL-3.0-only | its licence is outside the permitted list and the package is not a named exception
  fake-mpl-tool@1.0.0 | MPL-2.0 | its licence is outside the permitted list and the package is not a named exception
  fake-private@1.0.0 | UNLICENSED | its licence is outside the permitted list and the package is not a named exception
  lightningcss-cli@1.33.0 | MPL-2.0 | its licence is outside the permitted list and the package is not a named exception
RESULT: FAILED
exit code: 1
```

## Run 3: the automated tests for the rule (`npx vitest run test/licence-rule.test.ts`)

```text
 ✓ test/licence-rule.test.ts > licence expressions > accepts a permitted licence and combinations made only of permitted licences 2ms
 ✓ test/licence-rule.test.ts > licence expressions > refuses anything else 1ms
 ✓ test/licence-rule.test.ts > the rule > passes when every package is permitted 1ms
 ✓ test/licence-rule.test.ts > the rule > fails on a development-only package outside the list: there is no weaker rule for development tools 1ms
 ✓ test/licence-rule.test.ts > the rule > lists every problem, not only the first 0ms
 ✓ test/licence-rule.test.ts > the rule > accepts the named exceptions for development use 0ms
 ✓ test/licence-rule.test.ts > the rule > does not extend an approval to another package with the same licence 1ms
 ✓ test/licence-rule.test.ts > the rule > fails when a package approved for development use is among the shipped dependencies 0ms
 ✓ test/licence-rule.test.ts > the rule > fails when an approved package later declares a different licence 1ms
 ✓ test/licence-rule.test.ts > the rule > fails a build package whose version differs from its main package, or whose main package is absent 0ms
 ✓ test/licence-rule.test.ts > the rule > covers only the build packages named one by one, not every name that starts the same way 0ms
 ✓ test/licence-rule.test.ts > the rule > treats an old-style list of licences as all applying, each read on its own 0ms
 ✓ test/licence-rule.test.ts > the rule > records which packages were accepted on one side of a choice of licences 0ms
 ✓ test/licence-rule.test.ts > the rule > does not let a build package's name excuse a different licence 0ms
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > passes on a folder whose packages are all permitted 817ms
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when a shipped test package outside the rule is added, and names it 798ms
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when a development-only test package outside the rule is added 730ms
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when a test package declares no licence at all 765ms
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when a shipped test package outside the rule is marked private 691ms
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when it reads nothing: an empty folder, or a folder that does not exist 913ms
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when a declared dependency is not installed, since its licence cannot be read 847ms
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when the notices file is out of date 2294ms
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > passes on the builder itself, with the notices file up to date 2277ms
 Test Files  1 passed (1)
      Tests  23 passed (23)
```

## Run 4: the type check and the whole test suite

```text
type check exit code: 0
 Test Files  6 passed (6)
      Tests  61 passed (61)
```

## The review of the first version (commit `153a0fc`) and what was done

A fresh reviewer agent, which did not write the code, read `153a0fc`, re-ran the runs above and built eighteen folders of its own. It confirmed that every installed package is read (191 of 191), that nothing the old check refused is now allowed, and that the outputs matched this file. It answered "is the Done means met for `builder/`": **no, narrowly**, because of findings 1 and 2.

| # | Finding | Blocking | Done |
| --- | --- | --- | --- |
| 1 | Any package named `lightningcss-<anything>` at the same version and licence passed, including the real packages `lightningcss-cli` and `lightningcss-wasm`, which the owner did not approve | Yes | The eleven build packages are now named one by one; nothing else is covered. Tested (run 2 and run 3) |
| 2 | A dependency marked private was invisible to the check | Yes | Private packages are read; only the folder's own package is left out. Tested |
| 3 | Pointed at a folder with no packages, or one that does not exist, the check passed | No | It fails. A declared but uninstalled dependency fails too. Tested |
| 4 | An old-style list of licences with a choice inside was misread | No | Each entry is read on its own and all must pass. Tested |
| 5 | The "A OR B" reading was not stated openly | No | Stated above and in the rule file; the check prints each such package |
| 6 | "Shipped" could miss a package that is not development-only | No | The lock file's own marking is used as well |
| 7 | The old template check has two more defects (exact-name matching of copyleft names; loose matching of the permitted list) | No | Recorded in `evidence/2026-11-12-licence-checks-as-committed/checks.md` for the template's half |
| 8 | The licence report `licences.csv` can go stale and is specific to one machine | No | **Not fixed.** It is a record, not a check; the check does not depend on it |
| 12 | The notices file stated things it had not checked ("Modified: no"; "taken from its README"; one link not from the package's own files) | No | Reworded to what is known; the link is described as coming from the related package |
| 14 | Two installed copies of the same package and version can hide one another | No | **Not fixed.** It is how the tool reads folders |

Findings 9, 10, 11, 13 and 15 were about documents and are answered in the documents.

## What this does not show

- **Nothing about `templates/next/`.** Its own check script is unchanged.
- **Only this machine's installed packages were read.** Another machine installs differently named build packages.
- **Nothing about what a customer receives.** No exporter exists.
- Whether the notices file is sufficient under each licence. That is for the reviewing engineer or a lawyer. Nothing here says any licence is complied with.
- The licence of each package is what the package declares, as read by the tool `license-checker-rseidelsohn`. Nobody has checked those declarations against the packages' sources.

## Found while building this: the template carries LGPL packages

The new check, pointed at `templates/next/` with the builder's rule (read-only; nothing in the template was changed):

```text
Licence check for templates/next
Rule: ../../builder/licence-rule.json
Packages checked: 267 installed, of which 114 shipped (not development-only).
Permitted licences: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, BlueOak-1.0.0, CC0-1.0, Python-2.0, PostgreSQL, Unlicense
Named exceptions in use:
  lightningcss-linux-x64-gnu@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss@1.33.0 | MPL-2.0 | approved 2026-11-12 for development use | development only
  spdx-exceptions@2.5.0 | CC-BY-3.0 | approved 2026-11-12 for development use | development only
  spdx-ranges@2.1.1 | (MIT AND CC-BY-3.0) | approved 2026-11-12 for development use | development only
PROBLEMS: 4
  @img/sharp-libvips-linux-x64@1.3.4 | LGPL-3.0-or-later | its licence is outside the permitted list and the package is not a named exception
  @img/sharp-libvips-linuxmusl-x64@1.3.4 | LGPL-3.0-or-later | its licence is outside the permitted list and the package is not a named exception
  @img/sharp-wasm32@0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | its licence is outside the permitted list and the package is not a named exception
  caniuse-lite@1.0.30001823 | CC-BY-4.0 | its licence is outside the permitted list and the package is not a named exception
RESULT: FAILED
exit code: 1
```

`caniuse-lite` is approved; it shows here only because the builder's rule file does not list it. **The three `@img/sharp-...` packages had not been recorded anywhere.** They belong to `sharp`, an image library that Next.js installs as an optional extra, and carry LGPL-3.0-or-later. None is marked development-only in the lock file. The owner's approval does not cover them. Known gap 40; question 1 in `docs/STATUS.md`.
