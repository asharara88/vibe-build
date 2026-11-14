# Adversarial readings the record did not show: J1's export and cameras, and 3.1b's guard (14 November 2026)

Written by Claude Code from the reports of six fresh reviewers and fifteen fresh challengers. Their own reports, as returned, are kept in `evidence/2026-11-14-adversarial-readings/reviewers-and-challengers-reports.json`.

**Why these readings were made.** On 14 Nov nine fresh readers checked a draft of new "tested" marks (`docs/reviews/2026-11-14-marks-checked.md`). Two of their findings were about reviews:

- **J1.** Its own design asks for "one fresh review; the export's copy of tests and the cameras' mounts reviewed adversarially as acceptance separation and isolation" (`docs/design/journey-j1.md`). The record showed one fresh review, an independent check and the review bot, and nothing that says any reading was adversarial.
- **3.1b.** It had one fresh review, which is what the plan asks for "other code". It also changes when an acceptance run counts as passed, and no record says it is not "acceptance separation", which needs an adversarial review.

So the stricter class was applied to both, on the merged code.

**Who read, and how.** Three areas, two fresh reviewers each, with different angles; then every finding a reviewer called serious was given to another fresh reader, a challenger, who was told to try to refute it. None of the 21 wrote the code or saw an author's conversation. They read commit `839be17` (the integration branch as merged that day) in a working copy of its own. They could write probes and run single tests under the machine's shared lock; they could not edit the code. Development machine (a cloud session), development profile, made-up data, no model called.

**Result: nothing blocking in any of the three areas.** "Blocking" means: it breaks a hard rule, or it leaves a "Done means" unmet. No challenger raised a finding to blocking. The reviewers called 15 findings serious; these were 11 distinct points. The challengers confirmed the facts of all 11, kept 8 as serious and lowered 3 to minor. Every serious point needs something today's builder does not have: an engine that can write files of its own choosing into a project's history or pages, or code running inside a camera's container. **They must be fixed before package 2.2's engine writes anything.** They are recorded as known gaps 187, 188 and 189.

Nobody has fixed anything yet. The fixes, with tests and controls, come in the pull request after #51.

## 1. J1: the export's copy of tests (acceptance separation)

Read: `builder/src/orchestrator/export.ts`, its caller and rule, the download route, the acceptance store. Angles: tampering; leaks and the route.

| # | Finding | Shown by | After challenge |
| --- | --- | --- | --- |
| E1 | **A link named `EXPORT-NOTE.txt` in the project's history makes the export overwrite a file anywhere on the machine.** The export checks the history out on the machine and writes its note with a plain write, as root. A link of that name is followed. Shown: a file outside every export folder was overwritten; the manifest of the stored tests was overwritten, after which that version could no longer be verified. The archive then carries the link, not the "internal only" note | Run, by both reviewers | Serious, confirmed by two challengers with probes of their own |
| E2 | **An ignore file in the history keeps the tests out of the export's commit, and an attributes file changes their bytes at a later checkout, while the record says the tests are in the exported copy.** `git add` obeys the project's own `.gitignore`; nothing reads the commit back against the manifest | Run, by both | Serious, confirmed twice |
| E3 | **Unusual file names pass the two refusals.** The check for an acceptance folder and for secret-looking files reads git's quoted names. A name with a double quote, a backslash or a tab passes: a file of the engine's lands beside the real tests in the exported `acceptance/` folder. Names that differ only by letter case pass too (`Acceptance/`, `.ENV`) | Run, by both | Serious, confirmed twice |
| E4 | **The export does not compare the stored version with what was recorded when the plan was confirmed**, as the runner does, and it copies the files after checking them. A version replaced whole by a self-consistent one is exported as "the tests". Needs write access to the data folder, which no container has | Run | Serious, at the low end; confirmed |
| e5 | The archive holds this machine's sandbox path (git's reference log) and git's 14 sample hook files | Run | Minor |
| e6 | A second export of the same project overwrites the file the first export's record names; the first download then answers "not found" | Run | Minor |
| e7 | After "Close project" the export stays on disk and is still served, while the screen says the project's folder was removed. An export stopped part-way leaves its staging folder | Run | Minor |
| e8 | The secret check is by file name only, with a short, case-sensitive list (`.npmrc`, `.netrc`, `credentials.json` and others pass) | Run | Minor |
| e9 | The export screen and its record name the tests without the label "stand-in test, not independent acceptance"; the label is inside the archive | Read | Minor |
| e10 | The earlier archive is removed before the new one exists; an archive over 200 MB is recorded but never served | Read | Minor |

**Tried and held.** No container is given the data folder, the exports folder or the history folder. No program ran during an export from anything planted in the history or the working copy: attribute filters, a submodule address, hook settings, a planted `.git` folder. The export wrote nothing back into the sandbox. A link in the history to a file of the machine is archived as a link; the file's content is not pulled in. Manifest tricks (`../`, an absolute path, a link in place of a test or of the version folder) are all refused. Without a session, the export page, the export itself and the download all lead to sign-in; a request from another origin is refused; two requests at the same moment give one export. A project not signed off, or a broken copy, is not exported.

## 2. J1: the cameras' mounts (isolation)

Read as merged, with package 0.6c's networks and J3's live camera: the three camera scripts, the adapter that starts them, the sandbox manager, the automated runs. Angles: mounts and files; network and secrets.

| # | Finding | Shown by | After challenge |
| --- | --- | --- | --- |
| C1 | **The cameras' rule "refuse every address but one" does not see a redirect's target or a WebSocket.** It is a rule inside the browser, and the browser does not ask it about those. They go out uncounted, so the closing check "nothing else was loaded" passes. The builder camera is on the machine's network and types the interface's password; the rule was the only thing the record named between it and every other address. Not reachable through the interface's own pages as written: their content rules stop it (run) | Run, in a container with no network | Serious, confirmed |
| C2 | **A named pipe left in the app camera's output folder stops the whole interface.** A screenshot is opened before it is checked to be a plain file, and opening a pipe never returns. It needs code running inside the camera's container | Run | Serious, confirmed |
| C3 | **J3's automated run removes every sandbox folder in the temporary folder**, not only its own, at its end; the name also matches the tests' folders and another interface's. J2's run removes only what its own record names | Read by the reviewer; run by the challenger | Serious, confirmed |
| c4 | The check before the app camera and the live camera start reads the words of the Compose file, not what Docker really attached (a network of that name made beforehand; the IPv6 setting; the Engine's version) | Run | **Lowered to minor:** the mechanism is real; it needs someone who can already create Docker networks on the machine |
| c5 | The automated runs write into a camera's folder as root, through a link | Run | Minor |
| c6 | A hard stop during a camera run leaves its run folder, with the sample password file, in the data folder | Read | Minor |
| c7 | The builder camera's browser runs with its own sandbox off; gap 138 did not say so | Run | Minor |
| c8 | No fast test pins the live or the builder camera's mounts | Read | Minor |
| c9 | Two of J1's evidence files and one of J3's are written without being searched for the interface's password | Read | Minor |

**Tried and held.** Each camera's mounts are as the code and records say, shown by `docker inspect` of real containers and by write attempts from inside: only the screenshots folder takes a write. A hostile page could not make the app camera read a file or write outside its folder (file addresses in every form were refused; the pictures were looked at). A link at a screenshot's name is refused. Neither the engine nor the app can see a camera's script, output or secrets. The browser opens no debugging port. The interface's password reaches only the interface and the builder camera, as one file readable by its owner; it is typed into a form, never put in an address, and is in no evidence file that was searched. Files served back have a fixed type and must start as a picture.

## 3. Package 3.1b: when an acceptance run counts as passed, and the guard against skipped tests

Read: the results reader, the runner, the prerequisites and image checks, the gate tests and their scan. Angles: a false pass; getting round the gate.

| # | Finding | Shown by | After challenge |
| --- | --- | --- | --- |
| G1 | **The gate's scan of the test settings file is a list of nine setting names.** Other settings leave tests out or turn a failure into a pass and are not on the list: a name filter, "changed files only", a set-up file, a retry count. With the first three the gate test itself is among the tests left out, so nothing is there to fail. The real settings file holds none of them today (read) | Run on made-up folders, by both reviewers | Serious, confirmed twice |
| g2 | The scan of test files misses eight more ways of leaving a test out than gap 112 names (a test with no body; the test's own skip taken by name; a line break before the word; the API under another name; and others). None is in the suite today (searched) | Run on made-up folders | **Lowered to minor:** gap 112 already records that the scan reads words |
| g3 | A version whose tests cover 1 of 6 checklist items reads "passed"; the untested count is only in the summary's text, and it is the caller's number | Run | **Lowered to minor:** it is known gap 111 |
| g4 | A "screenshot" that is an empty file counts; a test that opens no browser can pass | Run | Minor (gaps 71, 111) |
| g5 | Exit code 1 with a report in which every test passed reads "passed" | Run | Minor |
| g6 | A manifest naming one file, or one item, twice lets one test pass two items | Run | Minor |
| g7 | If the runner's container cannot even be asked for, the run leaves no record | Run | Minor |
| g8 | The runner image check reads one label (gap 98); `preview-live.test.ts` has no gate of its own; a browser zip can be placed in a cache folder inside the repository; two evidence scripts start the runner without the image check | Run and read | Minor |

**Tried and held.** No run was recorded as passed that should not be: 21 made-up test versions in the real runner image (no test, every form of skip, a failed test, a killed or timed-out run), and crafted results files (missing, empty, cut short, the wrong shape, from an earlier run, far too large, a pipe). Only the acceptance run can write where results are read from. The live acceptance tests fail, 7 of 7, and never skip, when Docker does not answer or the approved browser zip is absent. The zip is checked against a recorded fingerprint: a wrong file under the right name, a link, a file of the right size and a partial download are each refused. Every later path that produces an acceptance result or a screenshot makes the image check.

## What this means for the marks

J1 and 3.1b now have the adversarial reading they lacked, and it found nothing blocking. They are **not marked tested in pull request #51**: the serious points are fixed first, with tests, and the marks are written with the fixes. The decision is in `docs/DECISIONS.md` (14 Nov); the gaps are 187, 188 and 189.

## Limits

- No reviewer ran the whole suite or the automated journeys; the builder camera was read, not started.
- What the builder camera can actually reach on the machine's network was not probed (gap 138 states it).
- The server profile, IPv6 and two projects at once were not looked at.
- The findings assume an engine that can write what it likes. Whether package 2.2's engine will be allowed links, ignore files or unusual names is a design question for 2.2.
- One reviewer's made-up test folders reached the working copy's module folder through a link, so the test runner wrote a cache file there; nothing tracked was changed.
- Nobody has re-read this file against the reports. It is Claude Code's summary; the reports are the record.
