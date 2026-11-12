# The licence checks as committed on the integration branch, run on 12 November 2026

| | |
| --- | --- |
| Why | A reviewer found that `docs/STATUS.md` said "the checks do not pass yet" with no run to show it, and that this was untrue for `builder/` |
| What was run | The gating commands of the two committed scripts, `builder/scripts/check-licences.sh` and `templates/next/scripts/check-licences.sh`, with their options exactly as in the scripts, typed out one by one so that nothing is written to the repository (each script's last step rewrites a report file and was left out). For the template, one command was also run a second time without the script's empty `--excludePackages ""` option, to show that the package named changes |
| Code state | `builder/` and `templates/` as at commit `e0e22e6` of the integration branch; they are unchanged on this branch |
| Run on | The development machine (a cloud session), directly on the host, against the packages installed there. The check reads files only |

## `builder/`: both gates pass

```text
$ npx license-checker-rseidelsohn --production --onlyAllow MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD;BlueOak-1.0.0;CC0-1.0;Python-2.0;PostgreSQL;Unlicense --excludePackages @anthropic-ai/claude-agent-sdk --excludePrivatePackages --summary
├─ MIT: 15
└─ ISC: 2

exit code: 0

$ npx license-checker-rseidelsohn --failOn GPL-1.0;GPL-2.0;GPL-3.0;AGPL-1.0;AGPL-3.0;LGPL-2.0;LGPL-2.1;LGPL-3.0;SSPL-1.0;BUSL-1.1;CC-BY-NC-4.0 --excludePackages @anthropic-ai/claude-agent-sdk --excludePrivatePackages --summary
├─ MIT: 96
├─ ISC: 59
├─ Apache-2.0: 15
├─ BlueOak-1.0.0: 11
├─ MPL-2.0: 3
├─ BSD-2-Clause: 2
├─ BSD-3-Clause: 2
├─ CC-BY-3.0: 1
├─ CC0-1.0: 1
└─ (MIT AND CC-BY-3.0): 1

exit code: 0
```

So, by the build plan's definition, **L9 is true** since the owner's approval of 12 November: the packages it names are approved in `docs/DECISIONS.md` and the committed check passes. What this check does **not** do: it applies the permitted list to shipped packages only. Development tools are refused only if their licence is on a short list of strong-copyleft names; anything else outside the permitted list is printed, not refused. The approved names are not entered in it as exceptions; it passes because of that weaker rule. Replacing it with one rule is package 0.4.

## `templates/next/`: the check fails

```text
$ npx license-checker-rseidelsohn --production --onlyAllow MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD;BlueOak-1.0.0;CC0-1.0;Python-2.0;PostgreSQL;Unlicense --excludePackages  --excludePrivatePackages --summary
Package "caniuse-lite@1.0.30001823" is licensed under "CC-BY-4.0" which is not permitted by the --onlyAllow flag. Exiting.
exit code: 1

# The same command without the script's empty --excludePackages option:
$ npx license-checker-rseidelsohn --production --onlyAllow MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD;BlueOak-1.0.0;CC0-1.0;Python-2.0;PostgreSQL;Unlicense --excludePrivatePackages --summary
Package "@img/sharp-libvips-linux-x64@1.3.4" is licensed under "LGPL-3.0-or-later" which is not permitted by the --onlyAllow flag. Exiting.
exit code: 1

$ npx license-checker-rseidelsohn --failOn GPL-1.0;GPL-2.0;GPL-3.0;AGPL-1.0;AGPL-3.0;LGPL-2.0;LGPL-2.1;LGPL-3.0;SSPL-1.0;BUSL-1.1;CC-BY-NC-4.0 --excludePackages  --excludePrivatePackages --summary
├─ MIT: 99
├─ ISC: 43
├─ BlueOak-1.0.0: 11
├─ Apache-2.0: 8
├─ BSD-3-Clause: 4
├─ BSD-2-Clause: 2
├─ MPL-2.0: 2
├─ 0BSD: 2
├─ CC-BY-4.0: 1
├─ CC-BY-3.0: 1
├─ CC0-1.0: 1
└─ (MIT AND CC-BY-3.0): 1

exit code: 0
```

So **L11 is not true.** What this shows about the committed check:

1. **It refuses `caniuse-lite`.** That package was approved by the owner on 12 November, but the approval is not entered in this check, so the check stays red on it whatever else is done.
2. **It stops at the first package it refuses**, so it never shows more than one. Which one it names depends on the options: as the script runs it, `caniuse-lite`; without the empty `--excludePackages` option, an LGPL package of the image library `sharp`. The packages it does not get to are never reported.
3. **Its rule for development tools matches licence names exactly.** "LGPL-3.0" is on its list, "LGPL-3.0-or-later" is not, so the last command passes although LGPL packages are installed.
4. Nothing in it lists every package outside the permitted list. For the template that list is in known gap 40.

So two things stand between the template and a passing check: the approved name has to be entered in the check, and the LGPL packages have to be removed or approved. The owner has since chosen removal for the LGPL packages (package R1); how the approved name gets into the check is put to him in `docs/STATUS.md`.

## What this does not show

Only the packages installed on this machine were read; another machine installs differently named build packages. The licence of each package is what the package declares; nobody has checked those declarations against the packages' sources. Nothing here is a statement that any licence is complied with.
