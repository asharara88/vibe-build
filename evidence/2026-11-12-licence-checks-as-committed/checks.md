# The licence checks as committed on the integration branch, run on 12 November 2026

| | |
| --- | --- |
| Why | A reviewer found that `docs/STATUS.md` said "the checks do not pass yet" with no run to show it, and that this was untrue for `builder/` |
| What was run | The gating commands of the two committed scripts, `builder/scripts/check-licences.sh` and `templates/next/scripts/check-licences.sh`, typed out one by one so that nothing is written to the repository (the scripts' last step rewrites a report file). The permitted list and the strong-copyleft list are the ones in the scripts |
| Run on | The development machine (a cloud session), directly on the host, against the packages installed there. The check reads files only |

## `builder/`: both gates pass

```text
$ license-checker-rseidelsohn --production --onlyAllow "<permitted list>" --excludePackages "@anthropic-ai/claude-agent-sdk" --excludePrivatePackages --summary
├─ MIT: 15
└─ ISC: 2

exit code: 0

$ license-checker-rseidelsohn --failOn "<strong copyleft list>" --excludePackages "@anthropic-ai/claude-agent-sdk" --excludePrivatePackages --summary
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

So, by the build plan's definition, **L9 is true** since the owner's approval of 12 November: the packages it names are approved in `docs/DECISIONS.md` and the committed check passes. What this check does **not** do: it applies the permitted list to shipped packages only. Development tools are refused only if their licence is on a short list of strong-copyleft names; anything else outside the permitted list is printed, not refused. Replacing that with one rule is package 0.4.

## `templates/next/`: the check fails

```text
$ license-checker-rseidelsohn --production --onlyAllow "<permitted list>" --excludePrivatePackages --summary
Package "@img/sharp-libvips-linux-x64@1.3.4" is licensed under "LGPL-3.0-or-later" which is not permitted by the --onlyAllow flag. Exiting.
exit code: 1

$ the same, with caniuse-lite excluded, to see what it refuses next
Package "@img/sharp-libvips-linux-x64@1.3.4" is licensed under "LGPL-3.0-or-later" which is not permitted by the --onlyAllow flag. Exiting.
exit code: 1

$ license-checker-rseidelsohn --failOn "<strong copyleft list>" --excludePrivatePackages --summary   (the rule the committed check applies to development tools)
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

So **L11 is not true.** Three things this shows about the committed check, all for package 0.4 to put right:

1. It stops at the first package it refuses, so it never shows more than one. Run through the script on 11 and 12 November it named `caniuse-lite`; run as above it names an LGPL package of the image library `sharp`. The packages it does not get to are never reported.
2. Its rule for development tools matches licence names exactly. "LGPL-3.0" is on its list, "LGPL-3.0-or-later" is not, so the third command passes although LGPL packages are installed.
3. Nothing in it lists every package outside the permitted list. The full list for the template, found by a different check on 12 November, is in known gap 40.

## What this does not show

Only the packages installed on this machine were read; another machine installs differently named build packages. The licence of each package is what the package declares; nobody has checked those declarations against the packages' sources. Nothing here is a statement that any licence is complied with.
