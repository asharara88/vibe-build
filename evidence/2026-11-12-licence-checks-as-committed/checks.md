# The licence checks as committed on the integration branch, run on 12 November 2026

| | |
| --- | --- |
| Why | A reviewer found that `docs/STATUS.md` said "the checks do not pass yet" with no run to show it, and that this was untrue for `builder/` |
| What was run | The gating commands of the two committed scripts, `builder/scripts/check-licences.sh` and `templates/next/scripts/check-licences.sh`, with their options as in the scripts, typed out one by one so that nothing is written to the repository. Each script's third step (a listing of development packages that refuses nothing) and last step (which rewrites a report file) were left out. For the template, further runs were added to show what the script's options do |
| Code state | `builder/` and `templates/` as at commit `e0e22e6` of the integration branch; they are unchanged on this branch. The template's packages were as installed on 11 November, before `sharp` was removed on the R1 branch |
| Run on | The development machine (a cloud session), directly on the host, against the packages installed there. The check reads files only |

## `builder/`: both gates pass

```text
# A. The production gate exactly as in scripts/check-licences.sh:
$ npx license-checker-rseidelsohn --production --onlyAllow "MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD;BlueOak-1.0.0;CC0-1.0;Python-2.0;PostgreSQL;Unlicense" --excludePackages "@anthropic-ai/claude-agent-sdk" --excludePrivatePackages --summary
├─ MIT: 15
└─ ISC: 2

exit code: 0

# B. The rule for development tools exactly as in the script:
$ npx license-checker-rseidelsohn --failOn "GPL-1.0;GPL-2.0;GPL-3.0;AGPL-1.0;AGPL-3.0;LGPL-2.0;LGPL-2.1;LGPL-3.0;SSPL-1.0;BUSL-1.1;CC-BY-NC-4.0" --excludePackages "@anthropic-ai/claude-agent-sdk" --excludePrivatePackages --summary
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

# C. How many packages the tool reads with the script's option:
191 packages read; 42 of them have a name starting with @

# D. The script's third step, which lists development packages outside the permitted list and refuses nothing, and its last step, which rewrites a report file, were not run.
```

So, by the build plan's definition, **L9 is true** since the owner's approval of 12 November: the packages it names are approved in `docs/DECISIONS.md` and the committed check passes. What this check does **not** do: it applies the permitted list to shipped packages only. Development tools are refused only if their licence is on a short list of strong-copyleft names; anything else outside the permitted list is listed, not refused. The approved names are not entered in it as exceptions; it passes because of that weaker rule. Replacing it with one rule is package 0.4. All 191 installed packages are read.

## `templates/next/`: the check fails, and it reads only part of what is installed

```text
# A. The production gate exactly as in scripts/check-licences.sh (options quoted as in the script):
$ npx license-checker-rseidelsohn --production --onlyAllow "MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD;BlueOak-1.0.0;CC0-1.0;Python-2.0;PostgreSQL;Unlicense" --excludePackages "" --excludePrivatePackages --summary
Package "caniuse-lite@1.0.30001823" is licensed under "CC-BY-4.0" which is not permitted by the --onlyAllow flag. Exiting.
exit code: 1

# B. How many packages the tool reads with and without the script's empty --excludePackages "" option:
with the empty option:    175 packages read; 0 of them have a name starting with @
without the option:       267 packages read; 92 of them have a name starting with @

# C. The production gate without the empty option:
$ npx license-checker-rseidelsohn --production --onlyAllow "MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD;BlueOak-1.0.0;CC0-1.0;Python-2.0;PostgreSQL;Unlicense" --excludePrivatePackages --summary
Package "@img/sharp-libvips-linux-x64@1.3.4" is licensed under "LGPL-3.0-or-later" which is not permitted by the --onlyAllow flag. Exiting.
exit code: 1

# D. The production gate with the approved package excluded by name:
$ npx license-checker-rseidelsohn --production --onlyAllow "MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD;BlueOak-1.0.0;CC0-1.0;Python-2.0;PostgreSQL;Unlicense" --excludePackages "caniuse-lite" --excludePrivatePackages --summary
Package "@img/sharp-libvips-linux-x64@1.3.4" is licensed under "LGPL-3.0-or-later" which is not permitted by the --onlyAllow flag. Exiting.
exit code: 1

# E. The rule for development tools exactly as in the script:
$ npx license-checker-rseidelsohn --failOn "GPL-1.0;GPL-2.0;GPL-3.0;AGPL-1.0;AGPL-3.0;LGPL-2.0;LGPL-2.1;LGPL-3.0;SSPL-1.0;BUSL-1.1;CC-BY-NC-4.0" --excludePackages "" --excludePrivatePackages --summary
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

# F. The same rule without the empty option:
$ npx license-checker-rseidelsohn --failOn "GPL-1.0;GPL-2.0;GPL-3.0;AGPL-1.0;AGPL-3.0;LGPL-2.0;LGPL-2.1;LGPL-3.0;SSPL-1.0;BUSL-1.1;CC-BY-NC-4.0" --excludePrivatePackages --summary
├─ MIT: 156
├─ ISC: 59
├─ Apache-2.0: 22
├─ BlueOak-1.0.0: 11
├─ BSD-3-Clause: 4
├─ LGPL-3.0-or-later: 2
├─ Apache-2.0 AND MIT: 2
├─ BSD-2-Clause: 2
├─ MPL-2.0: 2
├─ 0BSD: 2
├─ Apache-2.0 AND LGPL-3.0-or-later AND MIT: 1
├─ CC-BY-4.0: 1
├─ CC-BY-3.0: 1
├─ CC0-1.0: 1
└─ (MIT AND CC-BY-3.0): 1

exit code: 0
```

So **L11 is not true.** What these runs show about the committed check:

1. **It refuses `caniuse-lite`** (run A). That package was approved by the owner on 12 November, but the approval is not entered in this check.
2. **It skips every package whose name begins with `@`** (run B). The script passes the tool an empty list of packages to exclude, and the tool then leaves out all such packages: 175 of 267 are read, 92 are not. The LGPL packages of the image library `sharp` are all among the 92. So as committed this check has never examined them, and it always names `caniuse-lite`. An earlier version of this file said the check missed them because it "stops at the first package it refuses"; that was the wrong explanation. Found by an independent reviewer; known gap 43.
3. **With a complete scan, it refuses an LGPL package** (runs C and D). Run D is the script's own command with the approved package named in the exclusion list, which makes the list non-empty and the scan complete.
4. **Its rule for development tools passes either way** (runs E and F). As the script runs it (E), the LGPL packages are skipped. Without the empty option (F) they are read and listed, and the rule still passes, because it matches licence names exactly: "LGPL-3.0" is on its list and "LGPL-3.0-or-later" is not.
5. It stops at the first package it refuses and never lists the rest. For the template the full list is in known gap 40.

So three things stand between the template and a check that means something: the approved name has to be entered in the check, which also makes its scan complete; the LGPL packages have to go, which the owner has decided (package R1); and the weaker rule for development tools has to be replaced (package 0.4).

## What this does not show

Only the packages installed on this machine were read; another machine installs differently named build packages. The licence of each package is what the package declares; nobody has checked those declarations against the packages' sources. Nothing here is a statement that any licence is complied with.
