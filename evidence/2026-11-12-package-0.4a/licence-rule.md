# Package 0.4a: one licence rule for every dependency of `builder/`

| | |
| --- | --- |
| Date | 12 November 2026 |
| Package | 0.4 of `docs/BUILD-PLAN.md`, the `builder/` half (0.4a). The `templates/next/` half (0.4b) is **not done**: see the last section |
| Run on | The development machine (a cloud session), directly on the host. The check only reads installed packages' files; it runs no generated code and no engine |
| Done means (plan) | "The check passes with no package outside that rule, and fails when a test package outside it is added" |
| Result for `builder/` | **Shown.** The check passes on `builder/`; it fails, naming each package, when test packages outside the rule are added |
| Result for `templates/next/` | **Not done, and red.** Four packages there are outside the rule, three of them not known before today |

## The rule

One rule for every installed package, shipped or development: its licence is on the permitted list, or the package is named in `builder/licence-rule.json` as the owner's approved exception for a named use. The earlier check had a weaker rule for development tools; that is gone. The rule also fails when a package approved for development use is among the shipped dependencies, when an approved package declares a different licence from the one approved, and when a licence is missing or was only guessed by the tool. It lists every problem, not only the first.

The named exceptions are the ones the owner approved on 12 November 2026 (`docs/DECISIONS.md`): `lightningcss` with its per-machine build packages, `spdx-exceptions`, `spdx-ranges`, all for development use only.

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

A temporary folder with three made-up packages: `fake-mit` (MIT, shipped), `fake-gpl` (GPL-3.0-only, shipped) and `fake-mpl-tool` (MPL-2.0, development only). The second shows a shipped package outside the rule; the third shows that a development tool gets no weaker rule and that the approval of `lightningcss` does not cover another package with the same licence.

```text
Licence check for ../../../tmp/fixture/demo
Rule: ../../../home/user/vibe-build/builder/licence-rule.json
Packages checked: 3 installed, of which 2 shipped (not development-only).
Permitted licences: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, BlueOak-1.0.0, CC0-1.0, Python-2.0, PostgreSQL, Unlicense
Named exceptions in use:
  none
Named exceptions not installed here: lightningcss, spdx-exceptions, spdx-ranges
PROBLEMS: 2
  fake-gpl@1.0.0 | GPL-3.0-only | its licence is outside the permitted list and the package is not a named exception
  fake-mpl-tool@1.0.0 | MPL-2.0 | its licence is outside the permitted list and the package is not a named exception
RESULT: FAILED
exit code: 1
```

## Run 3: the automated tests (`npx vitest run test/licence-rule.test.ts`)

```text
 ✓ test/licence-rule.test.ts > licence expressions > accepts a permitted licence and combinations made only of permitted licences 2ms
 ✓ test/licence-rule.test.ts > licence expressions > refuses anything else 1ms
 ✓ test/licence-rule.test.ts > the rule > passes when every package is permitted 1ms
 ✓ test/licence-rule.test.ts > the rule > fails on a development-only package outside the list: there is no weaker rule for development tools 1ms
 ✓ test/licence-rule.test.ts > the rule > lists every problem, not only the first 1ms
 ✓ test/licence-rule.test.ts > the rule > accepts the named exceptions for development use 1ms
 ✓ test/licence-rule.test.ts > the rule > does not extend an approval to another package with the same licence 1ms
 ✓ test/licence-rule.test.ts > the rule > fails when a package approved for development use is among the shipped dependencies 0ms
 ✓ test/licence-rule.test.ts > the rule > fails when an approved package later declares a different licence 1ms
 ✓ test/licence-rule.test.ts > the rule > fails a build package whose version differs from its main package, or whose main package is absent 1ms
 ✓ test/licence-rule.test.ts > the rule > does not let the family name excuse a different licence 0ms
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > passes on a folder whose packages are all permitted 765ms
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when a shipped test package outside the rule is added, and names it 758ms
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when a development-only test package outside the rule is added 876ms
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when a test package declares no licence at all 729ms
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > passes on the builder itself, with the notices file up to date 2102ms
 Test Files  1 passed (1)
      Tests  16 passed (16)
```

The whole suite at the same commit: 54 of 54 tests passed, and the type check passed.

## What this does not show

- **Nothing about `templates/next/`.** Its own check script is unchanged and still stops at the first package it refuses.
- **Nothing about what a customer receives.** No exporter exists. That the development packages are absent from an export is a check for package 3.2.
- The notices file `builder/THIRD-PARTY-NOTICES.md` is generated and checked for being up to date. Whether its contents are sufficient under each licence is not something this check can show; it is for the reviewing engineer or a lawyer.
- The licence of each package is what the package declares in its own files, as read by the tool `license-checker-rseidelsohn`. Nobody has verified those declarations against the packages' source repositories.

## Found while building this: the template carries LGPL packages

The new check, pointed at `templates/next/` with the builder's rule (read-only, nothing in the template was changed):

```text
Licence check for templates/next
Rule: ../../builder/licence-rule.json
Packages checked: 267 installed, of which 112 shipped (not development-only).
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

`caniuse-lite` was known and is approved; it shows as a problem here only because the builder's rule file does not list it (the template gets its own rule file in 0.4b). **The three `@img/sharp-...` packages were not known.** They belong to `sharp`, an image-processing library that Next.js installs as an optional extra; two of them are among the shipped dependencies. They carry LGPL-3.0-or-later, which is outside the permitted list and is not covered by the owner's approval. They have been installed since 11 November. The earlier check did not report them because the tool behind it stops at the first package it refuses, and it met `caniuse-lite` first. So the statement in `evidence/2026-11-11-skeleton-3/next-template.md` that the template's check fails on `caniuse-lite` was true but incomplete.

The owner's decision is needed (hard rule 2). It is question 1 in `docs/STATUS.md`. Until then L11 is not true and nothing that depends on it can start.
