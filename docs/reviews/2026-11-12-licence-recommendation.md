# Independent assistant's recommendation on the licence questions, supplied by the owner

| | |
| --- | --- |
| What this is | A recommendation on licence questions L9, L11 and L10, written by an independent assistant (not Claude Code, not the owner) and supplied by the owner, Ahmed Sharara, on 12 November 2026 |
| The owner's approval | **Not recorded.** The text recommends approval; it is addressed to the owner and is not his approval. Hard rule 2 needs the owner's approval in writing, package by package. The question is put to him in `docs/STATUS.md`. Until he answers, L9, L10 and L11 stay false and nothing is unblocked |
| What it would not do, in its own words | Approval "would unblock development; it would not approve the existing code, certify compliance, or authorise real-model spending" |

## The recommendation

| Packages | Recommendation | Conditions |
| --- | --- | --- |
| `lightningcss`, `lightningcss-linux-x64-gnu` | Approve for development use | Preserve licence notices; verify they are excluded from customer deliverables. Distribution creates additional obligations |
| `spdx-exceptions`, `spdx-ranges` | Approve | Preserve their attribution and licence notices; record the exact installed versions and licence expressions |
| `caniuse-lite` | Approve for generated apps | Include attribution, source and licence links, retained notices, and modification information where applicable, in exports |
| `psycopg` | Approve only if the Django comparison is wanted; a separate stack decision | A documented LGPL distribution approach before customer delivery: notices, licence copies, applicable source obligations, and the ability to replace the library |

Further points it makes:

1. Approve **named packages for their specified uses**, not every package that carries those licences.
2. Claude Code must implement the notices and pass the licence checks.
3. Replacing the first group only to avoid these licences would add work without a worthwhile benefit.
4. **A correction to Claude Code's wording.** `docs/STATUS.md` described CC-BY-4.0 as "credit required, nothing else" and LGPL-3.0 as letting an app "use it unchanged as a separate package and stay proprietary". Both were too loose. Creative Commons asks for more than naming the package; and "installed separately" alone does not show LGPL compliance. Accepted; the wording in `docs/STATUS.md` is corrected.

## What Claude Code checked, and what it did not

**Checked on 12 November 2026, from the files installed on the development machine:**

| Package | Version installed | Licence expression in its `package.json` | Where installed |
| --- | --- | --- | --- |
| `lightningcss` | 1.33.0 | MPL-2.0 | `builder/` and `templates/next/` |
| `lightningcss-linux-x64-gnu` | 1.33.0 | MPL-2.0 | `builder/` and `templates/next/` |
| `lightningcss-linux-x64-musl` | 1.33.0 | MPL-2.0 | `builder/` only, on this machine |
| `spdx-exceptions` | 2.5.0 | CC-BY-3.0 | `builder/` and `templates/next/` |
| `spdx-ranges` | 2.1.1 | (MIT AND CC-BY-3.0) | `builder/` and `templates/next/` |
| `caniuse-lite` | 1.0.30001823 | CC-BY-4.0 | `templates/next/` only |

**A further name, found on 12 November by running the builder's licence check again.** `lightningcss` is published as one main package plus one package per kind of computer (`lightningcss-linux-x64-gnu`, `lightningcss-linux-x64-musl`, and others for Mac and Windows), all from the same source, at the same version, under the same licence. Which of them is installed depends on the machine. The owner's question and the recommendation name two; this machine has three, and a Mac would have a different one. So the approval asked for in `docs/STATUS.md` names `lightningcss` and its per-machine build packages `lightningcss-*` at the same version; without that, the check would fail again on the next machine. The committed report `builder/licences.csv` predates this and lacks four rows (this package, one sibling MIT package, and the two Playwright packages, Apache-2.0); it is regenerated in package 0.4, not here, so that this change stays documents-only.

Read from the licence texts shipped inside those packages:

- **CC-BY-4.0, section 3(a)(1)** (`caniuse-lite/LICENSE`). Whoever shares the material must keep, where the licensor supplied them: the identification of the creators; a copyright notice; a notice that refers to the licence; a notice that refers to the disclaimer of warranties; and a link to the material where reasonably practicable. They must also say whether they modified the material and keep any earlier such indication, and say that the material is under this licence with its text or a link to it. Section 3(a)(2) allows this in any reasonable manner, for example a link to a page holding the information.
- **MPL-2.0, sections 3.1 to 3.4** (`lightningcss/LICENSE`). The duties attach to distributing the covered files: source form stays under the licence and recipients are told so; executable form means the source is made available and recipients are told how to get it; a larger work may be under other terms provided the covered files still meet the licence; licence notices in the source are not removed or altered.
- **`spdx-exceptions` and `spdx-ranges`** (their README files). The data comes from the SPDX specification, copyright the Linux Foundation and its contributors, under CC-BY-3.0. The authors of `spdx-ranges` license their own work under MIT, which is why its expression has two parts.

**Not checked:**

- The Mozilla licence FAQ, the Creative Commons website and the Free Software Foundation's LGPL page that the recommendation cites. The session's network list does not include those sites; the requests were refused. The CC-BY-4.0 and MPL-2.0 clauses above were read from the copies inside the packages instead.
- **The LGPL-3.0 text and the CC-BY-3.0 text.** Neither is on the development machine (`psycopg` is not installed; `spdx-exceptions` ships no licence file). Nothing is stated here about what they require.
- Whether any of the development packages ends up inside something a customer receives. No exporter exists, so there is nothing to check yet.
- Nothing here is legal advice, and no claim of compliance is made. Whether the notices are sufficient is for the owner's reviewing engineer or a lawyer to confirm.

## What each condition would mean in the build, if the owner approves

| Condition | Where it would be met | State |
| --- | --- | --- |
| Named packages only, for named uses | Package 0.4: one licence rule, with exceptions listed one by one from `docs/DECISIONS.md` (name, licence expression, permitted use, date). A new package with the same licence still fails | Not done |
| Versions and licence expressions recorded | The table above; then kept current by the licence report of package 0.4 | Recorded once, by hand |
| Notices preserved | Package 0.4 writes a notices file from the installed packages' own licence files | Not done |
| Development packages absent from customer deliverables | Package 3.2 (the exporter): a check on the export that none of them is in it, shown with evidence | Not done |
| `caniuse-lite` attribution in exports | Package 3.2: each exported app carries a third-party notices file with the items of CC-BY-4.0 section 3(a)(1) | Not done |
| LGPL distribution approach for `psycopg` | A written approach before any customer delivery of a Django app; needs the LGPL text read and an engineer's or lawyer's judgement | Not started; only if the owner wants the comparison |
