# Package 0.4: one licence rule for every dependency

| | |
| --- | --- |
| Date | 12 November 2026 |
| Package | 0.4 of `docs/BUILD-PLAN.md`: "One licence rule for every dependency, shipped or development: the permitted list, plus packages named one by one in `docs/DECISIONS.md`". It depends on licence codes L9 and L11, both true since 12 November (L11 since package R1 was merged) |
| Components | `builder/` and `templates/next/`. The `builder/` half was first built earlier the same day, before its dependencies were met (known gap 42); that first version and its review are in `evidence/2026-11-12-package-0.4a/`. This file covers the package as it now stands, for both components |
| Run on | The development machine (a cloud session), directly on the host. The check only reads installed packages' files and the lock files; it runs no generated code and no engine |
| Done means (plan) | "The check passes with no package outside that rule, and fails when a test package outside it is added" |
| Result | **Shown for both components** (runs 1 to 4); an independent reviewer confirmed that much at `892fa52` and found one way a package outside the rule could pass, since closed (the review is at the end of this file). **State: built, not tested**, until an independent reviewer has read the commit that is merged |

A *lock file* is the list, kept beside a component, of the exact packages it installs on any machine. *Shipped* means not development-only: a package that would be part of a running app.

## The rule

One rule for every package, shipped or development: its licence is on the permitted list, or the package is named in the component's `licence-rule.json` as the owner's approved exception for a named use (`docs/DECISIONS.md`, 12 November 2026). There is no weaker rule for development tools any more. Every problem is listed, not only the first.

The rule is one piece of code, kept as the same two files in each component (`builder/src/licence/` and `templates/next/scripts/licence/`), so that a component still carries its check when it is copied out of this repository. A test fails if the copies differ, or if the two components' permitted lists differ.

What the template's earlier check did not do, and this one does:

| | The template's earlier check | The rule now |
| --- | --- | --- |
| Development tools | A weaker rule: a short list of refused licence names, matched exactly | The same rule as shipped packages |
| A licence naming a permitted licence beside another ("MIT AND LGPL-3.0") | Accepted: a permitted name anywhere in the text was enough | Refused: the whole expression is read |
| A package marked private | Not seen | Refused unless it is the component's own, named in the rule |
| A package only another machine would install | Not seen: only what is installed here was read | Judged from the licence the lock file records for it. This is how the LGPL packages of `sharp` went unseen for other machines |
| Where a package comes from | Not looked at | The lock file must be there and must list every installed package folder. An entry that does not come from the npm registry (an archive file, a git address, another server, a local folder not named in the rule) is refused, and so is an installed folder the lock file does not list, or a link to a folder outside. What is checked is the lock file's record of the source, not the source itself |
| The approved packages | `caniuse-lite` entered with its version, matched by leading text; the development packages not entered at all, only listed | Each entered with its name, licence and the version read on 12 November, matched exactly; `caniuse-lite` for shipped use, the others for development use. Another version fails until someone has looked at it and changed the number |
| The stand-in for `sharp` | Not seen (private) | Named in the rule as the template's own: its folder must hold exactly its two files, each by its SHA-256 (a fingerprint of the file's contents), and every package folder found under the component's `node_modules` that calls itself `sharp`, at any version and however deeply nested, must be that folder. (As first built, the name and version alone were enough; the review found it.) |
| The lock-file check that keeps `sharp` out (`check-lock.mjs`) | Run first | Still run first, unchanged except that a lock file listing no packages now fails |
| A notices file for the approved exceptions | None | `templates/next/THIRD-PARTY-NOTICES.md`, written by the check and failing the check if out of date |

Also changed since the first version of the `builder/` half: packages for other machines are judged from the lock file (the builder's lists 67 beyond the 191 installed here, among them the other nine build packages of `lightningcss`, each named in the rule; two of the eleven are installed on this machine); a package's source is checked; and the notices file is titled with the component's own package name instead of its folder name, so a copy in another folder is still up to date.

**One reading to know about.** Where a package offers a choice of licences ("A OR B"), it is accepted if one side is on the permitted list, and the check prints each such package. No package in either component uses a choice today.

## Run 1: the check on `builder/`

```text
$ npm run check:licences   (in builder/)
Licence check for builder
Rule: licence-rule.json
Packages checked: 191 installed on this machine, and 67 more that the lock file lists for other machines (judged by the licence the lock file records). Shipped, that is not development-only: 17.
Permitted licences: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, BlueOak-1.0.0, CC0-1.0, Python-2.0, PostgreSQL, Unlicense
Named exceptions in use:
  lightningcss-android-arm64@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-darwin-arm64@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-darwin-x64@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-freebsd-x64@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-linux-arm-gnueabihf@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-linux-arm64-gnu@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-linux-arm64-musl@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-linux-x64-gnu@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-linux-x64-musl@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-win32-arm64-msvc@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-win32-x64-msvc@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss@1.33.0 | MPL-2.0 | approved 2026-11-12 for development use | development only
  spdx-exceptions@2.5.0 | CC-BY-3.0 | approved 2026-11-12 for development use | development only
  spdx-ranges@2.1.1 | (MIT AND CC-BY-3.0) | approved 2026-11-12 for development use | development only
Notices file THIRD-PARTY-NOTICES.md is up to date.
RESULT: PASSED
exit code: 0
```

## Run 2: the check on `templates/next/`

```text
$ npm run check:licences   (in templates/next/)
Lock file:
Lock file check (templates/next/package-lock.json): 405 entries read.
No sharp or @img package from the registry; caniuse-lite is under the approved licence; no unexpected local package.
RESULT: PASSED
Licence check for next
Rule: licence-rule.json
Packages checked: 263 installed on this machine, and 135 more that the lock file lists for other machines (judged by the licence the lock file records). Shipped, that is not development-only: 132.
This component's own packages (a folder of its own, no outside licence):
  sharp@0.0.0-removed | vendor/no-sharp | installed
Permitted licences: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, BlueOak-1.0.0, CC0-1.0, Python-2.0, PostgreSQL, Unlicense
Named exceptions in use:
  caniuse-lite@1.0.30001823 | CC-BY-4.0 | approved 2026-11-12 for shipped use | shipped
  lightningcss-android-arm64@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-darwin-arm64@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-darwin-x64@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-freebsd-x64@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-linux-arm-gnueabihf@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-linux-arm64-gnu@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-linux-arm64-musl@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-linux-x64-gnu@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-linux-x64-musl@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-win32-arm64-msvc@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss-win32-x64-msvc@1.33.0 (build package of lightningcss) | MPL-2.0 | approved 2026-11-12 for development use | development only
  lightningcss@1.33.0 | MPL-2.0 | approved 2026-11-12 for development use | development only
  spdx-exceptions@2.5.0 | CC-BY-3.0 | approved 2026-11-12 for development use | development only
  spdx-ranges@2.1.1 | (MIT AND CC-BY-3.0) | approved 2026-11-12 for development use | development only
Notices file THIRD-PARTY-NOTICES.md is up to date.
RESULT: PASSED
exit code: 0
```

## Run 3: nine cases, through the template's earlier check and through the rule

Each case is a copy of `templates/next/` with one thing changed (`cases.sh` beside this file; nothing in the repository is changed by it). "Old check" is the template's script as it was on the integration branch before this package.

```text
A. The template as it is
   old check: exit code 0 (PASSES)
   new rule:  exit code 0 (PASSES)

B. A shipped test package under GPL-3.0-only is added
   old check: exit code 1 (fails)
      Package "fake-gpl@1.0.0" is licensed under "GPL-3.0-only" which is not permitted by the --onlyAllow flag. Exiting.
   new rule:  exit code 1 (fails)
      PROBLEMS: 1
        fake-gpl@1.0.0 | GPL-3.0-only | its licence is outside the permitted list and the package is not a named exception

C. A development-only test package under LGPL-3.0-or-later is added
   old check: exit code 0 (PASSES)
   new rule:  exit code 1 (fails)
      PROBLEMS: 1
        fake-lgpl-later@1.0.0 | LGPL-3.0-or-later | its licence is outside the permitted list and the package is not a named exception

D. A shipped test package declaring "MIT AND LGPL-3.0" is added
   old check: exit code 0 (PASSES)
   new rule:  exit code 1 (fails)
      PROBLEMS: 1
        fake-both@1.0.0 | MIT AND LGPL-3.0 | its licence is outside the permitted list and the package is not a named exception

E. A shipped test package under GPL-3.0-only, marked private, is added
   old check: exit code 0 (PASSES)
   new rule:  exit code 1 (fails)
      PROBLEMS: 1
        fake-private@1.0.0 | UNLICENSED | its licence is outside the permitted list and the package is not a named exception

F. The lock file lists a package under LGPL-3.0-or-later that only another machine would install
   old check: exit code 0 (PASSES)
   new rule:  exit code 1 (fails)
      PROBLEMS: 1
        @fake/other-machine@1.0.0 | LGPL-3.0-or-later | its licence is outside the permitted list and the package is not a named exception

G. The approved package caniuse-lite at another version (1.0.30001824), same licence
   old check: exit code 1 (fails)
      Package "caniuse-lite@1.0.30001824" is licensed under "CC-BY-4.0" which is not permitted by the --onlyAllow flag. Exiting.
   new rule:  exit code 1 (fails)
      PROBLEMS: 1
        caniuse-lite@1.0.30001824 | CC-BY-4.0 | caniuse-lite is entered at version 1.0.30001823 only; this version has not been looked at
      PROBLEM: THIRD-PARTY-NOTICES.md is missing or out of date. Run the check with --write and commit the result.

I. A folder nested inside the installed package next calls itself by the stand-in's name and version (sharp@0.0.0-removed) and declares LGPL-3.0-or-later. Nothing else is changed; the lock file does not list it.
   old check: exit code 1 (fails)
      Package "sharp@0.0.0-removed" is licensed under "LGPL-3.0-or-later" which is not permitted by the --onlyAllow flag. Exiting.
   new rule:  exit code 1 (fails)
      PROBLEM: node_modules/next/node_modules/sharp calls itself sharp and is not the component's own folder for that name.
      PROBLEM: node_modules/next/node_modules/sharp is installed and is not in the lock file, so where it came from is not recorded.
      PROBLEM: sharp@0.0.0-removed is installed in more than one folder with different licence declarations (node_modules/next/node_modules/sharp, node_modules/sharp); the licence tool reports only one of them.

   the template's check as it was at commit 892fa52, before the review: exit code 0 (PASSES)
      RESULT: PASSED

H. The lock file as it was before the image library sharp was removed (the installed packages unchanged).
   Only the new rule is run here, without the separate lock-file check that keeps sharp out:
   new rule:  exit code 1 
      PROBLEMS: 15
        @img/sharp-libvips-darwin-arm64@1.3.4 | LGPL-3.0-or-later | its licence is outside the permitted list and the package is not a named exception
        @img/sharp-libvips-darwin-x64@1.3.4 | LGPL-3.0-or-later | its licence is outside the permitted list and the package is not a named exception
        @img/sharp-libvips-linux-arm64@1.3.4 | LGPL-3.0-or-later | its licence is outside the permitted list and the package is not a named exception
        @img/sharp-libvips-linux-arm@1.3.4 | LGPL-3.0-or-later | its licence is outside the permitted list and the package is not a named exception
        @img/sharp-libvips-linux-ppc64@1.3.4 | LGPL-3.0-or-later | its licence is outside the permitted list and the package is not a named exception
        @img/sharp-libvips-linux-riscv64@1.3.4 | LGPL-3.0-or-later | its licence is outside the permitted list and the package is not a named exception
        @img/sharp-libvips-linux-s390x@1.3.4 | LGPL-3.0-or-later | its licence is outside the permitted list and the package is not a named exception
        @img/sharp-libvips-linux-x64@1.3.4 | LGPL-3.0-or-later | its licence is outside the permitted list and the package is not a named exception
        @img/sharp-libvips-linuxmusl-arm64@1.3.4 | LGPL-3.0-or-later | its licence is outside the permitted list and the package is not a named exception
        @img/sharp-libvips-linuxmusl-x64@1.3.4 | LGPL-3.0-or-later | its licence is outside the permitted list and the package is not a named exception
        @img/sharp-wasm32@0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | its licence is outside the permitted list and the package is not a named exception
        @img/sharp-win32-arm64@0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | its licence is outside the permitted list and the package is not a named exception
        @img/sharp-win32-ia32@0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | its licence is outside the permitted list and the package is not a named exception
        @img/sharp-win32-x64@0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | its licence is outside the permitted list and the package is not a named exception
        sharp@0.35.5 | Apache-2.0 | the name sharp belongs to this component's own package sharp@0.0.0-removed (vendor/no-sharp); any other package of that name is not to be installed
```

Reading: the rule passes on the template as it is (A), and fails when a test package outside it is added, shipped (B) or development-only (C). It refuses everything the earlier check refused (B, G, I) and four things it accepted (C, D, E, F). Case I is the one the review found, built as the reviewer built it: the earlier check refused it, the template's check as it was at `892fa52` passed it (the last lines of case I run that commit's whole template), and the check now refuses it. Run against the lock file from before `sharp` was removed (H), it names all fourteen LGPL-carrying packages, eleven of which were never installed on this machine (three were: known gap 40), and the real `sharp`.

## Run 4: the type check, and the automated tests for the rule

Only the tests of the rule are listed here, with the totals for the whole suite of `builder/`; every test by name is in `run-tests.txt`.

```text
$ npm run typecheck   (in builder/)
exit code: 0
$ npx vitest run --reporter=verbose   (in builder/; the whole suite)
 ✓ test/licence-rule.test.ts > licence expressions > accepts a permitted licence and combinations made only of permitted licences
 ✓ test/licence-rule.test.ts > licence expressions > refuses anything else
 ✓ test/licence-rule.test.ts > one rule, kept the same in every component > the template carries the same two files as the builder, byte for byte
 ✓ test/licence-rule.test.ts > one rule, kept the same in every component > both components permit the same licences, and every exception names its approval
 ✓ test/licence-rule.test.ts > the rule > judges a package the lock file lists for another machine like any other, and counts it apart
 ✓ test/licence-rule.test.ts > the rule > holds an exception to one version where the rule gives one
 ✓ test/licence-rule.test.ts > the rule > matches a build package against any installed version of its main package, where the rule gives no single version
 ✓ test/licence-rule.test.ts > the rule > holds every approved package in both components to the version that was read
 ✓ test/licence-rule.test.ts > the rule > accepts the component's own package at its named version, and refuses any other package of that name
 ✓ test/licence-rule.test.ts > the rule > passes when every package is permitted
 ✓ test/licence-rule.test.ts > the rule > fails on a development-only package outside the list: there is no weaker rule for development tools
 ✓ test/licence-rule.test.ts > the rule > lists every problem, not only the first
 ✓ test/licence-rule.test.ts > the rule > accepts the named exceptions for development use
 ✓ test/licence-rule.test.ts > the rule > does not extend an approval to another package with the same licence
 ✓ test/licence-rule.test.ts > the rule > fails when a package approved for development use is among the shipped dependencies
 ✓ test/licence-rule.test.ts > the rule > fails when an approved package later declares a different licence
 ✓ test/licence-rule.test.ts > the rule > fails a build package whose version differs from its main package, or whose main package is absent
 ✓ test/licence-rule.test.ts > the rule > covers only the build packages named one by one, not every name that starts the same way
 ✓ test/licence-rule.test.ts > the rule > treats an old-style list of licences as all applying, each read on its own
 ✓ test/licence-rule.test.ts > the rule > records which packages were accepted on one side of a choice of licences
 ✓ test/licence-rule.test.ts > the rule > does not let a build package's name excuse a different licence
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > passes on a folder whose packages are all permitted
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when a shipped test package outside the rule is added, and names it
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when a development-only test package outside the rule is added
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when a test package declares no licence at all
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when a shipped test package outside the rule is marked private
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when it reads nothing: an empty folder, or a folder that does not exist
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when a declared dependency is not installed, since its licence cannot be read
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > passes with a lock file whose entries all come from the registry under permitted licences
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails on a package that only another machine would install, read from the lock file
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails on a lock-file package that records no licence, or one that names a permitted licence beside another
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails on a package that does not come from the registry: an archive file, a git address, another server
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when there is no lock file, or when a shrinkwrap file that npm would prefer is there
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails on an installed folder the lock file does not list, and on a link to a folder outside
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when two folders call themselves the same package and version but declare different licences
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails on a folder holding a package under another name that the lock file does not record
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails on a package folder with no name, an unreadable package.json, or the component's own name
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails on a package put in a hidden folder, and on a scope folder that is a link
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails on an optional or peer dependency that is neither installed nor in the lock file
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails on a lock file that lists no packages, or cannot be read
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails on a local package the rule does not name, whether a folder or a link
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > a component's own package > passes when the folder is exactly what the rule names
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > a component's own package > fails without the rule naming it: an unlicensed private package is refused like any other
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > a component's own package > fails when a file in it has changed, or a file has been added
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > a component's own package > fails when another folder calls itself by the own package's name and version, nested or under another folder name
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > a component's own package > fails when a real package is installed under its name
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > fails when the notices file is out of date
 ✓ test/licence-rule.test.ts > the real check, run against a folder with a test package added > passes on the builder itself, with the notices file up to date
 Test Files  6 passed (6)
      Tests  86 passed (86)
exit code: 0
```

The template's own type check passed (exit code 0) and its build passed with the new files in place (the same route table as before).

## What the check reads

Three things, and it fails if they disagree: what the licence tool reports for the installed packages; the lock file; and every folder under the component's `node_modules` that sits where an installed package sits, read directly from the disk, together with any package found inside a hidden folder there (a folder whose name begins with a dot; npm installs nothing in one, but a package put there by hand can be loaded by name). The third was added after the review: the licence tool reports one entry for each name and version, so a second folder calling itself by the same name and version hid behind the first, and it leaves out a folder whose `package.json` has no name.

## The review of the whole package (commit `892fa52`) and what was done

A fresh reviewer, who wrote none of this, ran both checks, the eight cases and about 130 fixtures of its own. **Done means: met.** About 70 licence declarations for each component were refused in every position it tried; the rule files match what is installed and trace to the owner's approval; the fingerprints, the eleven build-package names and the notices are right; no test assertion was removed. **One blocking defect**, and three overstated sentences. The review bot, on the same commit, raised two points of its own (N1 and the last row).

| # | Finding | Blocking | Done |
| --- | --- | --- | --- |
| B1 | Any folder calling itself `sharp@0.0.0-removed` was accepted unread, wherever it sat: nested inside another package, or under another folder name. Nested, with an LGPL licence declared, the earlier check refused it and the rule passed it, so the rule was weaker there. Sentences in this file, in `docs/DECISIONS.md` and in known gap 44 said otherwise | Yes | Every package folder found under `node_modules` that carries the own package's name must be the own folder. Tested, nested and under another folder name; case I above, which also runs the template as it was at `892fa52` to show it passing there |
| B2 | Overstated: "the other ten build packages" (nine); "refuses a package that does not come from the npm registry" (true only where the lock file records the source: a link to an outside folder with no lock entry passed); "reads every installed package" | Yes (records) | Corrected above and in the records. An installed folder the lock file does not list now fails, and so does a link to a folder outside. Tested |
| N1 | With no lock file the builder's check passed silently (also raised by the review bot) | No | A missing lock file fails. Tested |
| N2 | A second folder calling itself by an installed package's name and version, with another licence, hid behind the first | No | Fails when two folders with one name and version declare different licences. Tested |
| N3 | A dependency named like the component itself was left out | No | Fails. Tested |
| N4 | A folder whose `package.json` has no name, or is not JSON, was invisible | No | Fails. Tested |
| N5 | A declared optional or peer dependency that is neither installed nor in the lock file passed | No | Fails. Tested |
| N6 | `npm-shrinkwrap.json`, which npm prefers over the lock file, was ignored | No | Its presence fails the check. Tested |
| N7 | The scripts passed their arguments on, so a laxer rule file could be named on the command line | No | The scripts take no argument but `--write` |
| N8 | The three development packages carried no version in the rule, which builds the looser reading of the approval that the owner has not confirmed | No | Each is entered at the version read on 12 November, in both components; a build package must carry the same number. Tested |
| N9 | The notices said the licence report is "beside this file"; in the template that report is not committed | No | The notices now say the report is written by the check when run with `--write` and describes one machine |
| N10 | Run 4 was labelled "the whole suite" and listed half of it | No | Relabelled |
| N11 | Rows of the status file that describe the earlier checks become untrue when this is merged | No | For the record update that follows the merge |
| N12 | One test rewrites the tracked notices file and restores it; a killed run would leave it changed | No | Left as it is; recorded here |
| Bot | Two installed versions of an approved main package made the build packages of one of them fail | No | A build package is matched against every installed version of its main package. Tested. (With each exception now held to one version, two versions cannot both pass in any case) |

## The re-read of those answers (commit `63701c5`) and what was done

The same reviewer read only the changes since `892fa52` and ran about 150 more fixtures. **B1 closed in the code; nothing now passes that `892fa52` refused; every pre-existing failing test still fails for its own reason; N1 to N8 and the bot's point done as stated.** The review bot finished on `63701c5` with no findings. **Two record statements were false**, which blocks until corrected:

| # | Finding | Blocking | Done |
| --- | --- | --- | --- |
| R1 | Case I did not show the fix: it was built with a lock-file entry, so the separate lock-file check stopped it first, in the earlier check and the new one alike, and the rule never ran. The sentence about it was false | Yes (records) | Case I is rebuilt as the reviewer's own reproduction (no lock-file entry, under the package `next`), and its last lines run the whole template as it was at `892fa52`, which passes it |
| R2 | "Wherever it sits" was overstated: folders whose names begin with a dot were skipped, by this check and by the licence tool, and a package put in one by hand can still be loaded by name | Yes (records) | Hidden folders under `node_modules` are now read, and a `package.json` there that names a package fails the check (a tool's cache file that names nothing is left alone). Tested. The sentences are reworded, and what is still not looked at is listed below |
| | A scope folder (`@name`) that is itself a link to a folder outside passed | No | Fails. Tested |
| | The template's check failed in a path containing a space | No | Corrected in the lock-file check |
| | "Eight cases" in two places | No | Nine |
| | The stand-in's folder replaced by a link to an outside folder with the same two files passes; a second folder with the same name, version and licence field as an installed package passes | No | Left as they are: in both, what is declared is identical to what is expected, which is the limit recorded below |

## What this does not show

- **That any licence is complied with.** The check compares declared licence names with a list. Nothing here is legal advice.
- **That a package's declared licence is true,** or that the lock file's record of a licence matches the package: for packages not installed on this machine the lock file's record is all that is read.
- **That the notices are sufficient** for the conditions of the owner's approval (known gap 39). The notice for `caniuse-lite` states what the package's own files state: its name, its author as named in the package, its source address, its licence and the licence's full text. The package supplies no separate copyright notice. The licence's standard web address could not be opened from this session; the text reproduced is the copy inside the package. Whether that meets the licence is for the reviewing engineer or a lawyer.
- **That an exported app carries the notices file,** or that the development packages are absent from an export: package 3.2.
- **Anything about another machine's installed packages** beyond what the lock file records.
- **Packages outside the component's own `node_modules` folder.** Another `node_modules` folder somewhere else in the component (for example `lib/node_modules`), or in a folder above it, is not looked at; nor is a build's output folder.
- **Where a package really came from.** The check reads the lock file's record of each source and compares the installed folders with the lock file; it does not download anything or compare a folder's contents with the registry's copy. A folder that the lock file lists as a registry package, and whose `package.json` gives the same name, version and licence, is taken at its word.
- **The second template.** There is none yet.
- The licence tool asks for Node 24 or later and ran here on Node 22 (known gap 43). The rule reads the tool's output; whether the tool reads anything differently on Node 24 was not checked.
- An "A OR B" licence is accepted on its permitted side without anyone having chosen that side in writing.
