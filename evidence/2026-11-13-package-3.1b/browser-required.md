# Package 3.1b: browser acceptance is required

| | |
| --- | --- |
| Date | 13 November 2026 |
| Package | 3.1b, from the third outside review supplied by the owner on 13 Nov 2026, item 3: "When the approved browser archive is missing, the live acceptance tests skip. [...] the required acceptance gate should fail when its prerequisites are missing. Otherwise a passing general test run can coexist with no browser exercise." (The review's own file is added under `docs/reviews/` by package 1.4b.) Branch `claude/pkg-3.1b-browser-required`, from `claude/stage-1` at `4e8354a` |
| Done means | (1) `npm test` cannot pass while the browser is not exercised: the live acceptance tests fail, never skip, when Docker or the approved browser zip is missing, each naming what is missing and how to put it right, and no test in the suite can be skipped or marked to do. (2) The acceptance store never records "passed" for a run whose runner could not start, or in which no browser test ran (no test, or every test skipped). (3) A fetch script puts the approved zip, and nothing else, into the cache. (4) The session set-up says how to fetch it and what to do if the session's network refuses |
| Run on | The development machine (a cloud session): Docker 29.9.2, Node v22.23.4, PostgreSQL with the test database `builder_test_p31b`. Code at commit `a0b0ff1`. The browser zip from the folder `BUILDER_BROWSER_CACHE` names (SHA-256 `a9da0288…f9d1d`, checked before the run). The fetch tests use stand-in servers, a stand-in proxy and made-up bytes; the real address was asked twice to fetch (10:04 and 10:09 UTC) and once with a `HEAD` request (10:45 UTC). No model was called; nothing was spent |
| Result | The whole suite: **419 tests, 419 passed, none skipped**, live acceptance tests included, with the zip present (`run-tests-full.txt`). The live test file with a prerequisite missing: **7 of 7 failed** each time, with the zip absent, with `BUILDER_BROWSER_CACHE` unset, and with Docker not answering (`run-live-test-prerequisites-missing.txt`). **14 controls:** 13 made their test fail; one (C2c) made none fail, as expected (below). *(First written as 13 and 12: a miscount, corrected after the review.)* Type check and licence check passed. The zip's address answered **200** through the session's proxy at 10:09 and at 10:45 UTC |
| State | **Built, not tested.** Every check above ran and passed. Reviewed once, at `4128163`: "may be merged as it stands", nothing blocking; each of its notes is answered in "After the review", below. The review bot on the pull request is the second and last round (build plan section 3, step 7) |

**For the owner, in one line:** before this package, `npm test` could pass in a session that never started the browser, because the browser tests stepped aside when the browser was missing. Now they fail and say how to fix it, and a script fetches the browser.

## What was built (all in `builder/`)

- **The live tests fail, never skip.** `src/acceptance/prerequisites.ts`: `dockerProblem` (`:20-29`) asks `docker info`; `browserZipProblem` (`:32-43`) checks the zip with the build's own check (`checkedBrowserZip`, `src/acceptance/runner-image.ts:66-76`: a plain file, not a link, with the approved SHA-256); each answer names what is missing and how to put it right (`:15-17`: start Docker as `CLAUDE.md` says; run `scripts/fetch-browser.ts`; set `BUILDER_BROWSER_CACHE`). `test/acceptance-live.test.ts`: the prerequisites are read once (`:31`), the `describe` block has no skip (`:37`), and every one of its 7 tests starts with `needsPrerequisites()` (`:33-35`), which throws "This live acceptance test cannot exercise the browser, so it fails (it is never skipped). Missing: …". Its first test (`:73-76`) requires that nothing is missing.
- **The gate test.** `test/acceptance-gate.test.ts:56-72` runs the live file in a child test run with the zip absent and Docker not answering, and requires exit code 1, "7 failed (7)", no "skipped" or "todo", and both messages with their fixes. `:74-96` fails if any file in `test/` writes a skip, run-if, to-do or only, or calls `.skip(`, and if `vitest.config.ts` names a setting that passes an empty run or leaves files out, and requires `npm test` to be `vitest run`.
- **One outcome word for every run.** `src/acceptance/results.ts`: `RunOutcome` is "passed", "failed" or "not passed" (`:52-57`), never "skipped"; a version that names no test is "not passed" whatever its results file holds (`:281`; before this, every one of no items "passed"); the word is set with the summary (`:379-390`). `src/acceptance/runner.ts:220` writes it into the `acceptance.run.finished` event and the run's report. A version with no test is also refused before the start by the store's own check (`src/acceptance/store.ts:316`, from package 3.1).
- **The runner image is checked before a run.** `src/acceptance/runner.ts:121-130`: Docker must answer and the image the sandbox names must be on the machine with the label `builder.browser-zip-sha256` set to the approved zip's SHA-256; otherwise the run is refused before its start, "not passed", no container started. The check: `src/acceptance/runner-image.ts:171-197`; the label is given at every build (`:115`); `src/sandbox/manager.ts:394`, `:494` pass the image's name. At run time the browser is inside that image, and the image is built only from the approved zip, so "the zip is missing" means, for a run, "no image built from it".
- **The fetch.** `scripts/fetch-browser.ts` (32 lines) calls `fetchBrowserZip` (`src/acceptance/browser-fetch.ts:152-274`) with the recorded address only, `BROWSER_ZIP_URL`, kept beside the size and the fingerprint (`runner-image.ts:31-35`). The rules, each with its line: the cache folder is an absolute path outside the repository, reached through no link (`:159-165`); a file already at the zip's place is never replaced, and the approved zip already there is left as it is with nothing downloaded (`:168-179`); the bytes go to a new temporary file in the same folder, created exclusively (`:183-184`); a time limit for the whole download, 20 minutes, and one for silence, 60 seconds (`:39-42`, `:193-198`); only an answer 200 is read, a move elsewhere is not followed (`:212-216`); a stated length other than the approved size is refused before anything is written (`:217-221`), and the download stops as soon as more than that arrives (`:227`); size and SHA-256 are checked on disk (`:254-257`), then the file is put in place by a hard link that fails if anything is there by then (`:261-265`); on any refusal or failure the temporary file is deleted (`:268-273`). The request goes through the proxy the environment names, by a tunnel, with TLS checked by Node's own trust; only the proxy's host and port are ever printed (`:79-146`). No package was added.
- **The set-up step.** `docs/ENVIRONMENT-CHECK.md`, "Session set-up", step 3: the command, and what to do if refused.

## Tests (all ran and passed in `run-tests-full.txt`, at `a0b0ff1`)

| File | Test | What it shows |
| --- | --- | --- |
| `test/acceptance-gate.test.ts` | "Docker: not answering, or not installed" | The Docker message, with `nohup dockerd`, for a socket where nothing listens and for no `docker` program |
| | "the browser zip: the setting unset, a folder without the zip, another file, a link" | Each message, with the fetch command; "remove what is at that place" only when something is there |
| | "both missing: both are named" | Both messages together |
| | "the live acceptance test file, run with the zip absent and Docker not answering, fails: all 7 of its tests, none skipped, …" | The gate itself |
| | "no test file can skip a test, mark one to do, run one alone or run one only if something holds; npm test runs the whole suite" | The scan of `test/` and the runner's settings |
| `test/acceptance-live.test.ts` | "its prerequisites are here: …", then the 6 tests of package 3.1 | With the zip present, all 7 passed: the image built with its label, run A "passed", B and C "not passed", D "failed", each with its outcome word in the reading and in the event |
| `test/acceptance.test.ts` | "no browser test ran: a version that names no test is never read as passed, whatever the results file holds" | A results file with no test, or with a passing test the version does not name: "not passed" |
| | "no browser test ran: results with no test at all, or with every test skipped, are 'not passed', every item 'did not run'" | The two cases the review names |
| | "Docker does not answer: refused before its start, naming Docker; 'not passed' in the run's events and report" | Recorded in the store: 4 events, the last with `outcome: "not passed"`; the report file says the same |
| | "the runner image is not on this machine (it is built from the approved zip): refused before its start, naming the image; 'not passed'" | The same, for a missing image |
| | "an image without the approved zip's label, or with another zip's, is refused; with the approved one it is accepted" | The label check |
| | "a version that names no test is refused before its start (the store's check); 'not passed', never passed" | The store's own check, with a sandbox that throws if touched |
| | Every earlier "did not run" case | Now also requires `outcome: "not passed"` |
| `test/browser-fetch.test.ts` | 17 tests: the recorded address, size and fingerprint; a fetch into a new folder (made `0700`); a second fetch asks nothing; a stated length refused; more bytes than approved stopped; other bytes of the right size refused and deleted; a connection that ends early; an answer other than 200, and a 302 not followed; both time limits; nothing replaced (another file, a link, a folder); the cache folder refused when relative, inside the repository or reached through a link; through a stand-in proxy: the tunnel, TLS checked (a certificate Node does not trust is refused), a refused tunnel reported with its answer, a user name and password sent and never printed, a reset tunnel, a plain address through `HTTP_PROXY`, `NO_PROXY`, a proxy setting that is not an address | No temporary file is left in any of them |

## Controls (`run-controls.txt`, at `a0b0ff1`)

Each control: a fresh copy of the commit (`git archive` into the scratch folder), one safeguard removed as the file shows, the named tests run in the copy, the copy removed. No container was started.

| # | Safeguard removed | Result |
| --- | --- | --- |
| C1 | **The skip put back** on the live tests (`describe.skipIf(missing.length > 0)`) | **Failed:** the gate test found "7 skipped" and the scan found the skip. The live file alone then **passed with 7 skipped, exit code 0**: what `npm test` would have done without the gate |
| C2a | **Size:** the check of a stated length | **Failed:** the size test |
| C2b | **Size:** the limit while bytes arrive | **Failed:** the size test (the stand-in stops at four times the size) |
| C2c | Size: the check on disk | **No test failed, as expected:** a file of another size cannot have the approved SHA-256, so the next check refuses the same files. Kept as a second check |
| C3 | **The store lets a run with no test pass** (the no-test line in `readRun`) | **Failed:** "no browser test ran: a version that names no test …", the reading was `outcome: 'passed', items: []` |
| C3b | The store's check before a run lets a version with no test through | **Failed** |
| C4 | The runner image check before a run | **Failed:** both "runner cannot start" tests; the run went on to the app check |
| C5 | The label check accepts any image | **Failed** |
| C6 | **SHA-256:** the check | **Failed:** "promise resolved instead of rejecting": other bytes would have been put in place |
| C7 | The refusal to replace a file already there | **Failed** |
| C8 | The refusals of a cache folder reached through a link | **Failed** |
| C9 | The refusal of an answer other than 200 | **Failed** |
| C10 | Both time limits | **Failed:** the test hit its own 20-second limit |
| C11 | The tunnel bypassed (`agent: false`, as first written) | **Failed:** both tunnel tests; the request went directly |

## The live test, with and without its prerequisites (at `a0b0ff1`)

- **Zip present** (`run-tests-full.txt`): all 7 live tests passed, within the 419.
- **Zip absent** (an empty folder), **`BUILDER_BROWSER_CACHE` unset**, **Docker not answering** (`run-live-test-prerequisites-missing.txt`, sections A to C): 7 of 7 failed each time, exit code 1, none skipped, each naming what is missing and how to put it right. No container was started.

## Every way a test could be left out (`run-skip-scan.txt`, read line by line)

| Found | Where | What was done |
| --- | --- | --- |
| `describe.skipIf(…)` on the live tests | `test/acceptance-live.test.ts:44` at `4e8354a` | **Removed**: it hid a missing prerequisite of a required check. The gate test now fails if any skip, run-if, to-do or only is written |
| Any other skip, run-if, to-do, only or `.skip(` | none at `4e8354a` or `a0b0ff1` | — |
| Test files outside `builder/test/`; runner settings that pass an empty run or leave files out | none (16 files, all in `builder/test/`; `vitest.config.ts` sets only parallelism and time limits; `npm test` is `vitest run`) | The gate test checks the settings and the command |
| An early `return` inside a test body | `test/failures.test.ts:881`, `:884`; `test/gateway.test.ts:1150` | Kept: each follows `expect(…ok).toBe(true)`, which has already failed the test if the value is not ok; the return only lets the type checker know the value is ok |
| A check made only on a condition | `test/failures.test.ts:892` (after a check that the answer is a refusal); `test/gateway.test.ts:1257`, `:1589`, `:1612` and `test/sandbox.test.ts:87` (one case of a loop, the other cases checked by an `else` or another check) | Kept: none skips a case |
| Early returns in stand-in servers, helpers and waiting loops | `test/failures.test.ts:194-242`, `:1174`; `test/gateway.test.ts:84-231`, `:292`, `:1788`, `:1885`; `test/step-hold.test.ts:74-76`, `:414`; `test/browser-fetch.test.ts:57`, `:74`, `:247`, `:256`; `test/sandbox.test.ts:26`; `test/key-reader.test.ts:76-77`; `test/acceptance.test.ts:44` (clean-up), `:835` | Not test bodies. The waiting loops throw, or their caller checks the answer, when the wait ends |
| A setting read from the environment | `test/egress.test.ts:8` (the session's proxy: used if set, a direct check otherwise); `test/failures.test.ts:377` (writes extra evidence when asked); the others name the test database, the proxy for image builds, or are set and restored by the test itself | Kept: none leaves a check out |
| Retries, generated tests, test contexts | none (the matches are made-up result files in `test/acceptance.test.ts`) | — |
| **In the product:** a version with no item read as "passed" | `src/acceptance/results.ts`, before `:281` | **Changed:** "not passed" (control C3) |
| **In the product:** a version whose tests cover some of the checklist reads "passed; checklist incomplete" | `results.ts:384-386` | Kept, recorded: known gap 111 |

## The real address (`run-real-address.txt`, `run-real-address-after-restart.txt`; `docs/SOURCES.md`, package 3.1b)

- **10:04 UTC, first try:** 200 and the approved zip, but **not through the proxy**: the code then gave `agent: false`, with which Node ignores the tunnel's connection and connects directly. The unused tunnel's reset then ended the program with an error. Found, fixed, and controlled (C11).
- **10:09 UTC, second try, as fixed:** through the session's proxy's tunnel, **200**; 119,809,080 bytes, the approved SHA-256; put in place in a new folder (since removed).
- **10:45 UTC, after the machine's container was restarted:** one `HEAD` request, same route, **200 OK**.
- So, on 13 Nov, from about 10:00, this session could fetch the browser. Earlier that day the host had been recorded as not let through; whether a new session can is known gap 110.

## Checks (at `a0b0ff1`)

| Check | Result | Output |
| --- | --- | --- |
| `npm run typecheck`, and the same with the three scripts added | Passed, exit code 0 | `run-typecheck.txt` |
| The whole suite, under the shared lock, live tests included | 16 files, 419 tests, 419 passed, exit code 0 | `run-tests-full.txt` |
| `npm run check:licences` | Passed; no package added | `run-licences.txt` |

`run-tests-full.txt` lists 12 containers on the machine before the run, all package 0.6c's (names starting `m06c-`; that package runs its own measurement), and counts 15 just after, without names. At 10:54 every container on the machine was either 0.6c's or one started at 10:53:04 by package 1.4c's suite, after this run had released the lock; none was this run's. Other branches' suites, from `4e8354a`, rebuild the shared runner image without the new label; this package's live test rebuilds it, with the label, before it uses it.

## Not done, and not shown

- **Reviewed once** ("After the review", below); the review bot on the pull request has not read it yet.
- **A new session's network** (known gap 110): whether it lets `storage.googleapis.com` through depends on the owner's cloud environment, and nothing fetches the zip when a session starts.
- **That a passing test opened the browser** (known gap 111): "passed" means every test the version names ran and passed.
- **The scan is of words** (known gap 112), and a test with no check still passes.
- **The fetch's limits** (known gap 113): a fetch killed mid-way leaves its `.part` file; proxies only as `http://` addresses.
- **The label** shows which zip the builder's own build used; any build can set it (known gap 98). The image is checked by its name, and Compose then starts whatever image has that name (known gap 130).
- **`CLAUDE.md`** still calls `npm test` a fast check and does not name the fetch; only the owner edits it (known gap 131).

## Files here

| File | What |
| --- | --- |
| `run-tests-full.txt` | The whole suite at `a0b0ff1`, under the shared lock |
| `run-live-test-prerequisites-missing.txt` | The live file with the zip absent, the setting unset, and Docker not answering |
| `run-controls.txt` | The 14 controls (C1, C2a to C2c, C3, C3b, C4 to C11). Two paths in C7 and C8 were shortened to `<scratch>…` after the review, as everywhere else |
| `run-skip-scan.txt` | The search for every way a test could be left out, at `4e8354a` and `a0b0ff1` |
| `run-real-address.txt` | The two tries at the recorded address, 10:04 and 10:09 UTC, with the direct check of the package registry |
| `run-real-address-after-restart.txt` | The `HEAD` request at 10:45 UTC |
| `run-typecheck.txt`, `run-licences.txt` | The other two checks |
| `run-review-before.txt` | After the review: the new tests run against the code as it was at `4128163`: 6 of them fail |
| `run-review-controls.txt` | After the review: the 8 controls, R1 to R7 and R5b |
| `run-review-r5b-at-9c525a3.txt` | After the review: control R5b on the commit before `c3a7570`: no test failed |
| `run-review-tests-full.txt`, `run-review-typecheck.txt`, `run-review-licences.txt` | After the review: the three checks again |
| `run-tunnel-issuer.txt` | After the review: who issued the certificate, through the fetch's own code and directly; the script, as text |

## After the review (13 Nov 2026)

One fresh review, of `4128163`, in an exact copy: **"may be merged as it stands"**, nothing blocking. It ran the type check, the unit tests, the licence check, and the whole suite with the zip present (419 of 419 passed) and with an empty cache folder (exit code 1: the 7 live tests failed, 412 passed, none skipped), and one control of its own (the 7 live tests marked as expected to fail: the live file alone then passed, and the gate test failed it). Its notes, and what was done:

| # | The review's note | What was done | Shown by |
| --- | --- | --- | --- |
| 1 | The controls were miscounted: 14 controls, 13 of which made a test fail, not 13 and 12 | Corrected in this file (the Result row, "Files here") and in the plan's row | — |
| 2 | `docs/STATUS.md`, "Next", item 1 was out of date, and did not name this review or the merge with `b52e041` | Corrected (399 words) | — |
| 3 | The gate's scan (a) left out `fails`, with which a failing test passes; (b) read `builder/test/*.ts` only, not subfolders, which the test runner would still run; (c) did not look at `projects`, `dir`, `root` or a workspace file | **Fixed in code.** The scan moved into `builder/test/gate-scan.ts`. It finds `fails`; reads every source file in `builder/test/` and its subfolders, and every file the test runner lists itself (`vitest list --filesOnly`), wherever it is; names any test file in `builder/test/` that the runner would not run, whatever setting leaves it out, so a setting is seen by what it does, not only by its name; names `projects`, `dir`, `root` and `workspace` in `vitest.config.ts`, and any other settings or workspace file beside it. Five new tests on made-up folders. (Vitest 5.1's own files, searched on 13 Nov, never name a `vitest.workspace` file, so it is probably not read: an assumption, not run; it is named anyway.) Known gap 112 changed | Before the fix, each of the 5 new tests failed (`run-review-before.txt`); after, all passed; controls R1 to R6, with R5b |
| 4 | The real-address record: the line "through the proxy at …" names the route before the request is sent, and at 10:04 it was printed while the request went directly; two wordings in `docs/SOURCES.md`; keep the certificate's issuer as evidence | `docs/SOURCES.md`: both wordings corrected, and a row for a new check. At 11:27 UTC, one `HEAD` request through the fetch's own code answered 200 with the host's own certificate, **issued by Google Trust Services (WE2)**; the same request without the session's proxy got one **issued by Anthropic's egress gateway**. So the fetch's code uses the tunnel. The line itself is unchanged: since the fix it names the route the code takes (control C11) | `run-tunnel-issuer.txt` |
| 5 | Two absolute scratch paths in `run-controls.txt` (C7, C8) | Shortened to `<scratch>…`; nothing else in that file changed | — |
| 6 | Docker's message was cut at 200 characters inside a word ("…no such file o") | **Fixed in code:** cut at a word and marked " …" (`shortened`, `builder/src/acceptance/prerequisites.ts`). A new test with a stand-in `docker` program | Before the fix, the new test failed: "…abcdefghij abc" (`run-review-before.txt`); after, passed; control R7 |
| 7 | The image is checked by its name, and could be swapped between the check and the run | Known gap 130 (with gap 98) | — |
| 8 | `docs/design/package-3.1.md:100` still said "Live tests, skipped without Docker" | A dated note there points to 3.1b | — |
| 9 | `CLAUDE.md`, Commands, still calls `npm test` a fast check and does not name the fetch | Known gap 131, for the owner, who alone edits `CLAUDE.md`; named in `docs/STATUS.md` | — |
| 10 | The reviewer's own files | Not copied; the certificate check was run again here | `run-tunnel-issuer.txt` |

### Before the fix (`run-review-before.txt`)

A copy of `4128163` with the new test file added, and the scan as it was at `4128163` moved, unchanged, into the functions the new tests call. **6 of the 11 tests in the gate file failed:** the 5 new scan tests (each scan found nothing where it should have found something) and the new Docker message test. The 5 earlier tests passed.

### Controls after the review (`run-review-controls.txt`, at `c3a7570`)

Each: a fresh copy of the commit (`git archive` into the scratch folder), one new safeguard removed, the gate test file run, the copy removed. No container was started.

| # | Safeguard removed | Result |
| --- | --- | --- |
| R1 | `fails` taken out of the word list | **Failed:** "a failure turned into a pass" |
| R2 | The subfolders of `builder/test/` not read | **Failed:** "a file in a subfolder", and "a test file … the test runner would not run" (its hidden file is in a subfolder) |
| R3 | The files the test runner lists not read | **Failed:** "a file the test runner runs outside test/ is read" |
| R4 | A test file the runner would not run no longer named | **Failed:** "… whatever setting leaves it out" |
| R5 | `projects`, `dir`, `root` and `workspace` taken out of the settings list | **Failed:** the settings test, at `projects` |
| R5b | `workspace` alone taken out | **Failed:** the settings test, at `workspace`. The same control on `9c525a3`, before the settings test had a made-up `workspace` setting, failed no test, 11 of 11 passed (`run-review-r5b-at-9c525a3.txt`); that is why `c3a7570` adds it |
| R6 | Another settings or workspace file no longer named | **Failed:** the settings test |
| R7 | Docker's message cut at 200 characters again | **Failed:** the Docker message test |

### Checks after the review (at `c3a7570`)

| Check | Result | Output |
| --- | --- | --- |
| `npm run typecheck` | Passed, exit code 0 | `run-review-typecheck.txt` |
| The whole suite, under the shared lock, live tests included, the zip present | 16 files, **425 tests, 425 passed**, none skipped, the 7 live tests among them, exit code 0 (12:11 to 12:15 UTC; no container on the machine before or just after) | `run-review-tests-full.txt` |
| `npm run check:licences` | Passed; no package added | `run-review-licences.txt` |

The three checks ran at `c3a7570` itself (`builder/` unchanged from the commit). The code after the review is in three commits: `a8338b5` (the scan), `9c525a3` (Docker's message) and `c3a7570` (a made-up `workspace` setting in the settings test, and the scan's comment).

**Still not shown:** that a new session's network lets the zip's host through (gap 110); that a passing test opened the browser (gap 111); a skip given as a test's options, `{ skip: true }`, or a test that checks nothing (gap 112); that the image run is the image checked (gap 130).
