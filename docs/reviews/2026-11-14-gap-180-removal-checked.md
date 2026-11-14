# Review of known gap 180's fix (a removal is checked), 14 November 2026

Written by Claude Code. This file holds what three fresh reviewers found on the fix of known gap 180 (`docs/KNOWN-GAPS.md`), **as they gave it, unedited**: every field of each reviewer's answer is copied word for word from the review's own output, in the reviewer's order. Nothing is summarised, corrected or left out. Paths that start `/tmp/claude-0/…/scratchpad/` are the reviewers' own working folders on the session's machine; they are not in the repository. Where a reviewer wrote `<TAB>` or `<NEWLINE>` for a character inside a name, a Markdown viewer may hide those words; the file's own text holds them.

**Who reviewed, and what they read.** Three fresh reviewers, none of whom wrote the code, each with one lens: isolation (can the sweep or the check reach, or miss, something), the journey (the record, the screens, stuck or slipping projects), and rules and claims (hard rules 6 to 8, and whether each claim is shown). They read the fix as it stood at commit `7433518`, in a working copy of their own. They could not edit files.

**Result as the reviewers gave it:** no blocking finding from any of the three; 21 non-blocking findings (seven each).

**What was done about each finding** is not in this file: it is in `evidence/2026-11-14-gap-180-removal-checked/README.md`, section "Review and answers", and what stays open is in row 180 of `docs/KNOWN-GAPS.md`. The fixes made after this review have not themselves been read by a reviewer.

## Reviewer 1: isolation

Lens, as given: `isolation`

### Verdict

No blocking finding. The sweep removes only what carries this project's exact Compose label, plus its two exactly named image tags, and the id format is enforced on every path. The check fails closed when Docker cannot be asked.

Seven non-blocking findings, two of them confirmed on real Docker:
- **The check can lie in a hand-made case.** A network carrying the project's label with a tab in its name, held in use, is not seen; the removal is reported done and the folder removed. By the letter of the brief's definition this makes the claim false. I rate it non-blocking because neither Compose nor the builder ever makes such a name, and generated code has no Docker access. Re-rate it if you read the definition strictly.
- **A project can get stuck.** If the folder cannot be removed in full, a plain error is thrown and compose.yaml is already gone. Every later attempt is then refused before Docker is asked.

The other five are wording and coverage: the start line, the refusal text, the unreadable-Docker line, the Docker context, and the live test covering only one of the two removal paths.

I did not run the suite, the controls, C14 to C16 or removal-live.test.ts.

Left in my scratch folder: the probe file at /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/rev-180-isolation/probe/rev180-isolation.test.ts and a small made-up folder at /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/rev-180-isolation/rm-probe. The tool's safety check stopped my removal of rm-probe; its cannot-change flag is cleared, so it can be deleted by hand. My probe database is dropped and no Docker object of mine is left.

### Findings

#### Finding 1: A tab in a network's name hides a labelled network from the check: removal reported done while Docker still lists it (hand-made case)

- **severity:** non_blocking
- **file:** builder/scripts/journey-restart-checks.ts
- **line:** 56-64 (parseNameLabel); used by builder/src/orchestrator/example-1-adapter.ts 130-136
- **what_is_wrong:** dockerLeftovers prints each list as name, tab, label and parseNameLabel splits on the tab, keeping the first two parts. Docker accepts tabs and newlines in network names (not in container or volume names). A network named 'A<TAB>B' with the project's label is read as name 'A', label 'B', so it is not matched. If the sweep also cannot remove it, sweepAndCheck finds nothing, removes the folder and reports the removal done. By the letter of the brief this makes the claim 'only if they hold nothing of the project' false. I rate it non-blocking because neither Compose nor the builder makes such a name and generated code has no Docker access. A newline does the opposite: it makes a second line that can look like the project's.
- **scenario:** Ran on real Docker 29.9.2, through the real adapter, under the lock. Made-up project id; network 'rev180-isolation-net-c52b0c5d<TAB>x' with label com.docker.compose.project=builder_<id>, held in use by a container that is not the project's. dockerLeftovers(id) returned []. destroyRecorded returned 'containers removed by the sweep: 0; nothing of the project left in Docker's lists; folder removed' and the folder was gone, while 'docker network ls --filter label=com.docker.compose.project=builder_<id>' still listed the network. Probe objects removed afterwards. Newline case: ran only that Docker accepts 'x<NEWLINE>y' as a network name and prints it as two lines. A network named 'x<NEWLINE>builder_<id>_y' would be reported as 'network builder_<id>_y' and, having no label, never swept, so every Close would be refused until it is removed by hand (read, not run end to end).
- **ran_it:** True
- **suggested_fix:** After the sweep, ask Docker again with the sweep's own label filters (ps -aq, volume ls -q, network ls -q with --filter label=...). Any id that comes back is left; Docker does the matching and nothing is parsed. For the name-prefix match, print with {{json .Name}} or {{json .}} so a tab or newline cannot shift fields. Otherwise add it to gap 180's 'what stays open' list.

#### Finding 2: A sandbox folder that cannot be removed in full gives a plain error; afterwards every attempt is refused before Docker is asked

- **severity:** non_blocking
- **file:** builder/src/orchestrator/example-1-adapter.ts
- **line:** 163-164, 187, 390-391
- **what_is_wrong:** Line 164 means to throw SandboxNotRemoved naming the folder, but rmSync throws when it cannot remove something, so line 164 is not reached. A plain Error leaves sweepAndCheck with the folder half removed. compose.yaml can already be gone, and then recordedSandboxRefusal returns 'the recorded folder holds no compose file' on every later attempt. destroyRecorded throws at line 391 before any Docker command, so no sweep and no check ever run again for that project. At a start the record gets removed: false with no 'left', and the screen says 'Still listed by Docker: not named in the record ... tries again'. At 'Close project' the error is not a JourneyRefused, so the owner gets the generic 500 page (builder/src/web/app.ts 166) and the project can never be closed from the interface. The guard is older than this change; the unreachable line 164 and the 'tries again' promise are new.
- **scenario:** Ran through the real adapter, under the lock. Made-up project id; folder builder-acceptance-probe with compose.yaml naming it and one file that cannot be removed (chattr +i). Attempt 1: threw a plain Error (ENOTDIR from rmSync), not SandboxNotRemoved; folder still there, compose.yaml gone. Attempt 2: threw 'The sandbox of j1-0ec5757691f4 was not removed: the recorded folder holds no compose file.' The same end state follows if the process ends during rmSync (a second stop signal, a crash), or if compose.yaml is lost from a kept folder by hand or by a temp cleaner (assumed, not checked). In that last case containers may still be running and nothing removes them.
- **ran_it:** True
- **suggested_fix:** Catch rmSync's error and throw SandboxNotRemoved naming the folder and the error code. Remove compose.yaml last, or rename the folder before removing it. When the folder exists but fails the content check, still run the label sweep and the Docker check (they need no folder), leave the folder alone, and report it as left.

#### Finding 3: The start line still counts a project whose removal left something as 'removed at start'

- **severity:** non_blocking
- **file:** builder/src/web/main.ts
- **line:** 414-415 (with builder/src/orchestrator/journey.ts 1298)
- **what_is_wrong:** removeLeft pushes every project it handled into 'touched', whether or not its removal completed. recoverInterrupted returns that list and main.ts prints 'Projects with a job or a sandbox left by an interface that stopped, marked interrupted and removed at start: N'. A project recorded removed: false is counted as removed. This is the statement gap 180 is about, left on the start path; the stop's lines were corrected and this one was not. The line is older than this change, but the change makes removed: false at start far more likely, for example in a cloud session where Docker is not yet started.
- **scenario:** Read, not run. Test C14 itself asserts that recoverInterrupted() returns [id] while the event written is removed: false with NOT_REMOVED_AT_START. main.ts would print '... removed at start: 1.' next to the fault line saying the containers could not be removed.
- **ran_it:** False
- **suggested_fix:** Have recoverInterrupted return the removed and the left projects as the stop does, and print them apart: marked interrupted N, removed M, left for the next start K, with names.

#### Finding 4: The 'Close project' refusal says 'Nothing else was changed' after the removal has removed what it could

- **severity:** non_blocking
- **file:** builder/src/orchestrator/journey.ts
- **line:** 380 (with journey-jobs.ts 606, example-1-adapter.ts 381-385, journey.ts 456)
- **what_is_wrong:** By the time SandboxNotRemoved is thrown, the live session has been ended and recorded with reason 'project_closed', Compose's own removal has run (containers, networks, the database volume and its data), the two images are removed, and the handle's appStarted is false. The removed: false event then sets the app as not running whether or not its container went. The owner is told 'Nothing else was changed'. The project stays open and not interrupted, so its other buttons stay offered on a sandbox that is partly gone. The advice 'restart the interface, which removes what a stopped interface left' leads to the same sweep and the same check.
- **scenario:** Read, not run. Close a project whose app is running while one network cannot be removed: the app, its data and its images are gone, the live session's record says 'project_closed', the project is still at its stage, and the refusal says nothing else was changed.
- **ran_it:** False
- **suggested_fix:** Say what happened: what could be removed was removed, the app is stopped and its data may be gone, and the project stays open only so the removal can be tried again. Consider offering only 'Close project' and 'New project' in that state, as for an interrupted project.

#### Finding 5: When Docker cannot be asked, the recorded line names the command, not the reason; the screen then says 'Still listed by Docker'

- **severity:** non_blocking
- **file:** builder/src/orchestrator/example-1-adapter.ts
- **line:** 138 (with src/web/messages/en.json 334, journey.ts 371)
- **what_is_wrong:** The line keeps only the first line of the error's message, which for a failed command is 'Command failed: docker ps -a --format {{.Names}}<TAB>{{.Label "com.docker.compose.project"}}'. Docker's own reason is on the next line and is dropped. This is the most likely real case: Docker is not running when a cloud session begins. The owner's screen then reads 'Still listed by Docker: Docker's lists could not be read (Command failed: docker ps -a --format {{.Names}} ...)'. The same 'Still listed by Docker' and 'Left, as Docker lists it' wording is used for 'folder ...' and for 'not named in the record', where Docker lists nothing. Separately, none of the Docker commands in dockerLeftovers and sweepAndCheck (130-133, 152-160) has a time limit: one that hangs holds 'Close project' open until the process ends.
- **scenario:** Ran the same call with a Docker socket path that does not exist. First line of the message: 'Command failed: docker ps -a --format {{.Names}}\t{{.Label "com.docker.compose.project"}}'. First line of stderr: 'failed to connect to the docker API at unix:///nonexistent-rev180.sock; check if the path is correct and if the daemon is running ...'.
- **ran_it:** True
- **suggested_fix:** Record the first line of the error's stderr, falling back to the message. Give the screen a second sentence for 'Docker could not be asked' and for the folder. Add a time limit to these commands and treat a timeout as 'could not be read'.

#### Finding 6: The check asks Docker with the user's client settings, not the sandbox's; the sandbox's refusal of another Docker context is swallowed

- **severity:** non_blocking
- **file:** builder/src/orchestrator/example-1-adapter.ts
- **line:** 194-198, 384-385, 400-401 (with src/sandbox/manager.ts 675-693)
- **what_is_wrong:** Everything that makes a project's containers runs with dockerEnv, which refuses any Docker context but the default and points DOCKER_CONFIG at the project's own folder. The sweep and the check run with plainDockerEnv: no DOCKER_CONFIG, HOME passed on, so the docker program follows a context chosen in ~/.docker/config.json. In destroy and destroyRecorded the refusal thrown by dockerEnv is swallowed by .catch(() => undefined). The lists can then be read from a different Docker daemon than the one that holds the project's containers.
- **scenario:** Read, not run (it needs a second daemon). A sandbox is made on the default daemon. The owner then runs 'docker context use other' and restarts the interface. At start, compose down is refused by dockerEnv and the refusal is swallowed; the sweep and the four lists go to the other daemon, which holds nothing of the project. The folder is removed and removed: true is recorded; the containers stay on the first daemon and nothing retries. The same holds if DOCKER_CONFIG is set while ~/.docker names another context.
- **ran_it:** False
- **suggested_fix:** In sweepAndCheck apply dockerEnv's refusal and throw SandboxNotRemoved saying the Docker context is not supported, or run these commands with DOCKER_CONFIG pointing at an empty folder so they reach the same daemon as the sandbox's commands.

#### Finding 7: The real-Docker test shows the failing case for destroyRecorded only, not for the path 'Close project' and the clean stop take

- **severity:** non_blocking
- **file:** builder/test/removal-live.test.ts
- **line:** 64, 76 (the untested path: example-1-adapter.ts 379-387)
- **what_is_wrong:** In a running interface, 'Close project' and the clean stop hold the project's handle and go through destroy(x). That is the path the second review's finding B1 was about. The live test calls destroyRecorded twice; C14 and C15 use stand-ins that throw by themselves. If destroy went back to not calling sweepAndCheck, C14 to C16, the live test and controls J2-C54 to C58 would all still pass. That destroy ends in sweepAndCheck is shown by reading only. The live test does show the real thing for the path it covers: Docker refuses to remove a network with an active endpoint, the removal names it, keeps the folder and leaves the holder running. Minor: the holder container has no --rm, so if the test process is killed, the holder, the network and the folder stay and no record names them.
- **scenario:** Read, not run: replace the body of destroy (lines 384-386) with the earlier destroyExample1(x). No test listed for gap 180 calls the real adapter's destroy with something left.
- **ran_it:** False
- **suggested_fix:** Add a third case to removal-live.test.ts that calls example1Sandboxes().destroy with a hand-made handle for the same made-up project while the network is held, expecting SandboxNotRemoved and the folder kept. Add a control for it.

### Overstated claims

- **where:** docs/KNOWN-GAPS.md, row 180
  - **quote:** every removal of a journey project's sandbox, at "Close project", at a stop and at a start, now ends the same way [...] Shown by tests C14, C15 and C16 on stand-ins and by a test on real Docker
  - **what_is_shown:** On real Docker, only destroyRecorded (the next start's path) with one network. The handle path used by 'Close project' and the clean stop is shown to end the same way by reading the code, not by a test that makes it fail.
- **where:** docs/KNOWN-GAPS.md, row 180, last column and third column
  - **quote:** Closed 14 Nov 2026, except (a) to (d)
  - **what_is_shown:** Four more open points are not in the list: a tab or newline in a network name defeats the check (run); a folder that cannot be removed in full leaves a project that no later attempt can remove or close (run); the start line still says 'removed at start' for a removal that left something (read); the check can ask a different Docker daemon than the sandbox's (read). The row's third column still says 'Planned, not built'.
- **where:** builder/src/orchestrator/example-1-adapter.ts 145-146 and builder/src/orchestrator/journey.ts 363-364
  - **quote:** Otherwise the folder is kept and `SandboxNotRemoved` is thrown, naming what is left
  - **what_is_shown:** True when Docker's lists hold something. For the folder itself (line 164's own case) a plain Error is thrown and the folder is left half removed, without its compose file (run).
- **where:** builder/src/orchestrator/journey.ts 380
  - **quote:** Nothing else was changed.
  - **what_is_shown:** By then the live session is ended and recorded as 'project_closed', Compose's removal has run (containers, networks, the database volume), the images are removed, and the app is recorded as not running.
- **where:** builder/src/web/messages/en.json 334 (and ar.json)
  - **quote:** Still listed by Docker: {left}. The interface tries again at its next start, and "Close project" tries again too.
  - **what_is_shown:** {left} can be 'Docker's lists could not be read (...)', 'folder ...' or 'not named in the record', none of which Docker lists. In the half-removed-folder state both retries are refused before Docker is asked.
- **where:** builder/src/web/main.ts 415
  - **quote:** marked interrupted and removed at start: ${touched.length}
  - **what_is_shown:** The count includes projects whose removal was recorded removed: false.

### Checked and sound

- Docker's label filter is an exact match on the value for containers, volumes and networks: with labels 'ab' and 'abc', filtering on 'ab' returned only the first (ran on Docker 29.9.2 with throwaway objects, since removed).
- The sweep selects only by the exact label com.docker.compose.project=builder_<id> and removes only the two image tags builder_<id>-app:latest and -tools:latest by exact name. Removing a tag with -f only untags when the image has another tag (read).
- checkJourneyId ('j1-' plus 12 lowercase hex) is called in sweepAndCheck, dockerLeftovers, destroy, destroyRecorded and stopApp, so no path reaches a Docker command or rmSync with another id (read). With that format, the prefix matches 'builder_<id>-' and 'builder_<id>_' cannot reach another journey project.
- The builder makes only ':latest' tags (manager.ts 977-978), and every container it starts under a project's name goes through docker compose run or up (runStreaming, appStream, askApp, runOnce), so it carries the label. What the name match reports, the sweep can remove; nothing the builder itself makes blocks a close for good (read).
- No anonymous volumes arise: the database's data path is a named, labelled volume (postgres 16) and no Dockerfile in the repository declares VOLUME. The sweep's 'docker rm -f' without -v therefore leaves none (read, grep).
- If any one of the four list commands fails, Promise.all rejects and the check returns the single 'could not be read' line; it is never read as nothing left (read; C16 covers a missing docker program).
- Folder gone but Docker still lists something: recordedSandboxRefusal returns null, the sweep and the check run, and SandboxNotRemoved names what is left on every attempt until it can be removed (read).
- Folder kept with its compose file: the next attempt passes the folder check, runs Compose's removal, the sweep and the check again (ran as part of probe B; the live test's second case shows the same).
- Live streams are killed and waited for (closeFor, killStreams, appStream.kill) before the removal starts, so they leave no container behind when the lists are read (read).
- journeyState keeps the sandbox recorded on removed: false and clears removalLeft on a removal that completed. closeProject writes no journey.closed on SandboxNotRemoved (read).
- The left names reach the page through hono's html template, which escapes them (read; C14 compares against the escaped text).
- The live test fails rather than skips without Docker. It makes and removes only a random made-up project's network, its own holder container and its own temp folder (read; not run by me).
- The replaced strings of controls J2-C54 to J2-C57 exist exactly once in the source as written (read; controls not run).
- No existing check was weakened or removed in this diff: tests and controls are additions only (read).

### Not looked at

- The whole suite, the controls, C14, C15, C16 and removal-live.test.ts themselves: not run (run separately, as the brief says).
- stopApp after a failed preview: the author's own open point (a).
- The lock-lost stop path and how the stop's 90 s deadline cuts a removal under way.
- The Arabic text of removal.left.
- Docker versions other than 29.9.2 with Compose 5.6.1, and any difference between image stores in what 'docker image rm -f' leaves.
- The Docker-context finding was not run: it needs a second daemon.
- Whether the owner's machine cleans its temp folder by age, which would decide how likely a kept folder is to lose its compose file.
- A container caught mid-removal (its own --rm removal under way) when the lists are read: at worst a refusal that a second 'Close project' cures; not tried.
- The J2 automated run's scripts and its own use of projectLeftovers (the process and folder rules).

## Reviewer 2: the journey

Lens, as given: `journey`

### Verdict

No blocking finding from this lens (the record, the screens, stuck or slipping projects). The claims hold as far as I read them, and tests C14 and C15 ran and passed here (stand-ins, 2 passed). Every place that writes "removed: true", REMOVED_AT_STOP, FOUND_AT_START or "The project was closed." is now reached only after the check found nothing; the retry at the next start is really made; the reservation loop still runs when a removal fails. What is left is non-blocking but real: (1) the refusal of "Close project" tells the owner "Nothing else was changed" when the app and most of the sandbox are already gone; (2) the project then stays open in a state nobody tested, a dead end at the checklist stage, with sign-off still offered; (3) the start's console line still counts a project whose removal failed as "removed at start". I did not run anything on real Docker.

### Findings

#### Finding 1: The refusal of "Close project" says "Nothing else was changed", but the app and most of the sandbox are already gone

- **severity:** non_blocking
- **file:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/src/orchestrator/journey.ts
- **line:** 379-380 (the sentence), 1047-1057 (where it is thrown); also builder/src/orchestrator/journey-jobs.ts 605-611 and builder/src/orchestrator/example-1-adapter.ts 379-387
- **what_is_wrong:** The check comes after the removal. Before SandboxNotRemoved is thrown, JourneyJobs.cleanup has ended the live session (recorded with the reason "project_closed", journey-jobs.ts:606), and the real adapter's destroy has set appStarted = false, run Compose's removal (containers, networks, volumes, so the app's data) and removed both images. closeProject then writes journey.sandbox.removed with removed: false, which sets appRunning to false in the state (journey.ts:456-457). So the sentence the owner reads, on a page titled "Not done", is false: "The project was not closed: ... Nothing else was changed." The same sentence advises "restart the interface" without saying that a restart removes the sandbox of every other open project and marks each one interrupted, not resumed (removeLeft at the stop and at the start).
- **scenario:** A project at the checklist stage, its app running; one thing of it cannot be removed (as in test/removal-live.test.ts: a network held by a container that is not the project's). The owner presses "Close project". Answer, HTTP 409: "The project was not closed: not everything of it could be removed (left: network builder_<id>_front). Nothing else was changed. Press Close project again; if this repeats, restart the interface...". In fact the app's containers, its database volume and its images are removed, the live session is closed with reason "project_closed" on a project that is not closed, and the record now says the app is not running.
- **ran_it:** False
- **suggested_fix:** Say what was done: for example "The project was not closed. Its app was stopped and what could be removed was removed. Still left: ...". Either drop the restart advice or say that a restart interrupts every open project. Give the live session's end a reason that does not say the project closed.

#### Finding 2: After a refused close the project stays open and usable as if nothing had happened; at the checklist stage it is a dead end, and sign-off is still offered

- **severity:** non_blocking
- **file:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/src/orchestrator/journey.ts
- **line:** 453-458, 563-578, 678-688; builder/src/orchestrator/journey-jobs.ts 336-338 and 607-611; builder/src/web/pages.ts 896-900, 935, 982-983
- **what_is_wrong:** The refusal's event carries interrupted: false, the in-memory handle is kept (handles.delete at journey-jobs.ts:610 is not reached when destroy throws) and the folder is kept. So the handle describes a sandbox whose containers, volumes and images are gone but whose folder is whole. What the owner can then do: (a) build: allowed, runs on the kept handle and makes containers of the project again; (b) preview, if not yet finished: allowed, rebuilds everything; (c) preview already finished: refused "The preview is already made.", and the checklist is refused "The app is not running: make the preview first." - two refusals that point at each other, and the screens show no button; (d) live app: refused, correctly; (e) sign-off: still offered and accepted when the last checklist run passed, because signOffRefusal looks at neither appRunning nor removalLeft; before this change a sign-off could only be recorded while the app ran; (f) export after sign-off: works from the kept folder, which is right. None of this breaks a hard rule, but it is a new state that no test reaches and docs/KNOWN-GAPS.md does not mention.
- **scenario:** (1) Checklist not yet passed, "Close project" refused: the Preview and Checklist screens offer nothing more; the only ways on are "Close project" again or a new project. (2) Checklist passed, "Close project" refused: the Checklist screen still shows "Sign off"; pressing it records the sign-off, and the export then works, for a project whose app the builder removed a moment earlier in answer to "Close project".
- **ran_it:** False
- **suggested_fix:** One decision for the owner: after a refused close, is the project (A) "closing, not finished" - no job and no sign-off, only "Close project" again - or (B) open on purpose. A is simpler to explain. Either way, add a test of the state after the refusal and a line in gap 180's row.

#### Finding 3: The start's console line still counts a project whose removal failed as "removed at start"

- **severity:** non_blocking
- **file:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/src/web/main.ts
- **line:** 414-415; builder/src/orchestrator/journey.ts 1298 (out.touched.push is unconditional); builder/scripts/demo-journey-j2.ts 71, 552, 589 read this line
- **what_is_wrong:** recoverInterrupted returns every project touched, removed or not, and main.ts prints "Projects with a job or a sandbox left by an interface that stopped, marked interrupted and removed at start: N." with that count. The stop's lines were made right (only removed projects are counted, and each project left is named); the start's were not. It is the same kind of statement gap 180 was about: the interface saying "removed" without the check having passed. The record itself is right (removed: false, NOT_REMOVED_AT_START), and a fault line is printed before it.
- **scenario:** A stop leaves a network of project P (removed: false). Next start: the retry fails again; the record gets NOT_REMOVED_AT_START, removed: false. The console prints "[interface fault] A project's containers could not be removed after an interruption." and then "...marked interrupted and removed at start: 1." No line names P as left, unlike at the stop.
- **ran_it:** True
- **suggested_fix:** Return removed and left from the start as from the stop. Count only the removed in the line, and print one line per project left, with what is left. (What I ran: test C14, which passed and asserts that recoverInterrupted() returns [id] when the removal failed again; the printed line I read, I did not start an interface.)

#### Finding 4: The note "Still listed by Docker" can stay on screen after the project is running again, and can name things that are not Docker's list

- **severity:** non_blocking
- **file:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/src/orchestrator/journey.ts
- **line:** 455; builder/src/web/pages.ts 376-379; builder/src/web/messages/en.json 334
- **what_is_wrong:** removalLeft is set by a removal event with removed: false and cleared only by the next removal event. It is never cleared while something is left (good). But it can be stale the other way: after a refused close the owner can build, or start a preview that was not finished; the app then runs, its network is in proper use, and every screen still says "Not everything of this project could be removed. Still listed by Docker: network ...". The sentence is in the present tense about a past reading and gives no time. It also prints, after "Still listed by Docker:", entries that are not from Docker's lists: "Docker's lists could not be read (Command failed: docker ps ...)" (example-1-adapter.ts:138), "not named in the record" (journey.ts:455) and "folder <path>" (example-1-adapter.ts:164).
- **scenario:** Project with every step approved and a preview that failed. "Close project" is refused (a network left). The owner presses "Start the preview": the app is built and runs. All of the project's screens still carry the red note that it could not be removed.
- **ran_it:** False
- **suggested_fix:** Word it as a past try with its time ("At the last try to remove this project, at <time>, this was left: ..."), and reword or hide it once a journey.app.started follows the removal event.

#### Finding 5: A removal that fails with any other error is not recorded by name, and one case is never retried although the record says it will be

- **severity:** non_blocking
- **file:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/src/orchestrator/example-1-adapter.ts
- **line:** 163 (rmSync), 180-191 and 390-391 (recordedSandboxRefusal); builder/src/orchestrator/journey.ts 1053, 1274-1277
- **what_is_wrong:** Only SandboxNotRemoved gets the new treatment. A plain Error from the removal - the recorded folder refused by recordedSandboxRefusal, or rmSync failing part-way once Docker's side is clean - gives, at "Close project", the general page "Something went wrong" (HTTP 500) and no record at all (journey.ts:1053 throws it on "as before"); on the handle path appStarted is by then false and the containers are gone, while the state still says the app runs. At a stop or a start it gives removed: false with no names ("not named in the record"). And if the folder is left without its compose file (rmSync failed after deleting it), every later start throws at recordedSandboxRefusal before any Docker removal is tried, while the record says "the next start tries again". Mostly as before this change, and unlikely; but gap 180's new text reads as if every failed removal is recorded with what is left.
- **scenario:** rmSync fails on a file it may not delete, after it has deleted compose.yaml. "Close project": 500, nothing recorded. Next start: "The sandbox of <id> was not removed: the recorded folder holds no compose file"; removed: false; the same at every start after it.
- **ran_it:** False
- **suggested_fix:** Turn an rmSync failure into SandboxNotRemoved(["folder ..."]); in closeProject treat any error of the removal as "not removed" (record it, refuse plainly); when the recorded folder is refused, say in the reason that it will not be retried, in place of "the next start tries again".

#### Finding 6: The tests do not reach two cases the claims cover: a stop with mixed outcomes, and the real state after a refused close

- **severity:** non_blocking
- **file:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/test/journey-stand-ins.ts
- **line:** 50-51, 314-323; builder/test/web.test.ts 2478-2567 (C14, C15)
- **what_is_wrong:** (1) notRemoved is one switch for every project, so no test stops an interface with one project that leaves something and one that does not. By reading, that case is right (a "was removed at the stop" line for the first, a "left for the next start" line naming what is left for the second, the count line counting one, exit code 1), but it is read, not shown. (2) The stand-in's destroy throws before it changes anything; the real one throws after it has set appStarted = false and removed nearly everything. (3) C15 closes an idle project (step 1 built, no app). So no test sees a project after a refused close with an app that ran: no live session, appRunning false, the handle kept.
- **scenario:** A change that made removeLeft stop at the first failed project, or that deleted the handle on a refused close, would pass C14 and C15 as they are.
- **ran_it:** False
- **suggested_fix:** Make notRemoved a map by project id and add a two-project stop test; make the stand-in set appStarted = false before it throws; add a refused close on a project whose preview finished, asserting what is then offered and refused.

#### Finding 7: Small things on the screen: the Arabic note names a button label the page does not show, and Docker's names are not kept left to right

- **severity:** non_blocking
- **file:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/src/web/messages/ar.json
- **line:** 334 (and 271, 158); builder/src/web/pages.ts 378
- **what_is_wrong:** The Arabic note says «إغلاق المشروع» tries again; that is the interrupted panel's button (interrupted.close). On a project that is not interrupted, which is the case after a refused close, the button on the Record and Export tabs reads "أغلق المشروع" (close.button). The list of names ("network builder_j1-..._front; container ...") is put inside the Arabic sentence with no lang="en" dir="ltr" around it, as other English fragments on these pages have (pages.ts 898, 945); its punctuation may show in the wrong order. The Projects list gives no sign that a project has something left. Not looked at in a browser.
- **scenario:** Arabic, a project whose close was refused: the note names a button whose wording is not the one on the Record tab, and the names of what is left run inside right-to-left text.
- **ran_it:** False
- **suggested_fix:** Use one Arabic label for "Close project" in both places, and put the list in a span with lang="en" dir="ltr", as failedAt does for a step's name (pages.ts 990-993).

### Overstated claims

- **where:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/src/orchestrator/journey.ts:380 (closeNotRemovedRefusal, shown to the owner)
  - **quote:** Nothing else was changed.
  - **what_is_shown:** By the time this is thrown, the live session is ended, the app's containers, volumes and images are removed where Docker allowed it, and an event is written that marks the app as not running. Test C15 passes only because the stand-in throws before it changes anything.
- **where:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/src/web/main.ts:415
  - **quote:** Projects with a job or a sandbox left by an interface that stopped, marked interrupted and removed at start: ${touched.length}.
  - **what_is_shown:** touched holds every project looked at, including one whose removal just failed and was recorded removed: false (journey.ts:1298; test C14 asserts that return value and passed here).
- **where:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/docs/KNOWN-GAPS.md, row 180
  - **quote:** Otherwise the folder is kept and the record says `removed: false` with what is left, by name ... "Close project" then does not close the project, and says why
  - **what_is_shown:** True when the removal ends in SandboxNotRemoved. With any other error, a stop or a start records removed: false with no names, and "Close project" answers the general 500 page and records nothing.
- **where:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/docs/KNOWN-GAPS.md, row 180, status and "What stays open"
  - **quote:** Closed 14 Nov 2026, except (a) to (d)
  - **what_is_shown:** Not in the list: the start's line that counts a failed removal as removed; the state of a project after a refused close (sign-off still offered, dead end at the checklist stage); errors other than SandboxNotRemoved. Point (a) names only the screen sentence preview.failed; the record says the same without a check (journey-jobs.ts:475, journey.app.stopped: "its containers and images were removed"). The row's third column still reads "Planned, not built".
- **where:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/src/web/messages/en.json:334 and ar.json:334
  - **quote:** Still listed by Docker: {left}.
  - **what_is_shown:** What the last removal attempt read, at an unstated time; it stays until the next attempt, even if the project is running again, and can hold "Docker's lists could not be read (...)" or "not named in the record".
- **where:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/src/web/messages/en.json:333, shown by pages.ts:389-390 directly above the new note
  - **quote:** Its containers are removed at the stop or at the next start
  - **what_is_shown:** On an interrupted project whose removal left something, this sentence and the note that contradicts it are shown one under the other; the gap's own text had already called the sentence unconditional.

### Checked and sound

- Ran: test/web.test.ts -t 'known gap 180' (C14 and C15, stand-ins): 2 passed, 73 skipped, exit 0. My test database was dropped afterwards.
- Every appendEvent of EV.sandboxRemoved (journey.ts 1054, 1058, 1282) and every product caller of destroy, destroyRecorded and stopApp (journey-jobs.ts 474, 609, 613; main.ts 410), by reading: "The project was closed.", REMOVED_AT_STOP, FOUND_AT_START and removed: true are written only after cleanupProject returned, which in main.ts's wiring means sweepAndCheck found nothing, or there was no handle and no recorded sandbox (then no removal event is written at all). The ternary at 1282 picks the NOT_REMOVED reasons whenever removed is false.
- The retry at the next start is really made in both cases. A refused close (interrupted: false) and a stop that left something (interrupted: true) both leave s.sandbox set (journey.ts 453); removeLeft takes any project with a sandbox that is not closed (1259); with no handle it goes through destroyRecorded, which finds the kept folder and its compose file. C14 shows the second and third start on stand-ins.
- The retry cannot mark as interrupted a project the owner is using: removeLeft runs only at start, before the interface serves (main.ts 414), and at the stop, after the halt. A second "Close project" in the same process retries through the kept handle and writes interrupted: false.
- A stop with one project removed and one not, by reading (no test): a "was removed at the stop" line for the first, a "left for the next start: ... (left: ...)" line for the second, the count line counts only the removed, exit code 1 with "a project is left for the next start" (main.ts 349-357; journey.ts 1283-1284).
- Money: the loop that closes an interrupted step's reservation (journey.ts 1289-1297) runs whether or not the removal failed; the try/catch at 1272-1278 takes every error of the removal.
- The screen: every project screen goes through projectPage, so the note is on all of them (18 uses); inside the interrupted panel when the project is interrupted, once at the top otherwise, never when the stage is closed (pages.ts 366-367, 390). It is escaped (hono's html tag; C14 and C15 compare with the escaped text). Both languages have the message, and the Arabic says what the English says.
- removalLeft is never cleared while something is left: only a removal event whose removed is not false clears it, and that is written only after the check. No journey.sandbox.made can follow a removed: false without a completed removal between them (buildStep refuses when there is no handle and a sandbox is recorded, journey-jobs.ts 338).
- The export of a signed-off project still works after a refused close: it reads the kept folder and needs no Docker (export.ts has no Docker call).
- Controls J2-C54 to J2-C58, by reading only: each removes a line whose absence the named test would catch. Not run.
- No existing check was weakened or removed in the test files of this change: only additions (C14, C15, C16, removal-live.test.ts, notRemoved in the stand-ins).

### Not looked at

- Nothing was run on real Docker: not test/removal-live.test.ts, not a real refused close. Everything about the state after a real refusal (containers, volumes and images gone, folder whole, handle kept) is from reading example-1-adapter.ts, manager.ts and journey-jobs.ts.
- Whether the sweep and the check can touch or name something that is not the project's (matching by label and by name prefix): another reviewer's lens; I only read that one-off containers are started with docker compose run, so they carry the label.
- The controls script was not run; the whole suite was not run; test C16 was not run.
- The pages were not opened in a browser, so the Arabic layout of the note is from reading the markup. The Arabic was read by me, not by a native reader.
- builder/scripts/demo-journey-j2.ts and the cameras beyond the two lines that read the start and stop lines.
- What the kept sandbox folder holds (the sandbox's own generated passwords and keys) and who can read it while a removal keeps failing.
- The lock-lost path (stopAfterLockLost): it removes nothing, so I did not go further into it.
- Old records written before this change (removed: true written without a check): they are read as removed, and nothing looks at Docker for them again.

## Reviewer 3: rules and claims

Lens, as given: `rules-and-claims`

### Verdict

No blocking finding in my lens. Rule 8: no existing assertion, test name, time limit or expected value was removed or changed (only three import lines), and no earlier test passes for a new reason. The five controls J2-C54 to J2-C58 are well formed (each text occurs once, each names one test, each removes what its label says). The record's side of the fix is as claimed. What is not yet right is mostly words and evidence: (1) at START the interface still prints "removed at start: N" for a project whose removal left something; (2) the "Close project" refusal says "Nothing else was changed" although the real adapter has by then removed everything it could (I ran this on real Docker); (3) the screen sentence "Still listed by Docker: ..." is not true in three of the cases in which it is written; (4) the real adapter's handle path (the one "Close project" and a clean stop use in a running interface, and the one finding B1 named) has no test or control that would fail if it stopped being checked; (5) the gap's row says "Closed, except (a) to (d)" while its own third column still says "Planned, not built" and several open points are not listed. I did not run the new tests or the controls' mutations (they are run separately; I may not edit files); I ran a count script, one check without Docker, and one probe on real Docker under the shared lock, which left nothing behind.

### Findings

#### Finding 1: At start the interface still prints "removed at start: N" for a project whose removal left something

- **severity:** non_blocking
- **file:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/src/web/main.ts
- **line:** 414-415 (with src/orchestrator/journey.ts 1216-1218 and 1298)
- **what_is_wrong:** recoverInterrupted returns only `touched`, and removeLeft adds a project to `touched` whether its removal completed or not (journey.ts:1298: `out.touched.push(r.id)`); the `left` list removeLeft builds is dropped at start (journey.ts:1217). main.ts prints that count as "Projects with a job or a sandbox left by an interface that stopped, marked interrupted and removed at start: N." The stop's lines were made truthful by this change; the start's line was not, and nothing on standard output names what is left at start (only the fault line on standard error). It is the same kind of sentence gap 180 is about, and the row does not list it.
- **scenario:** CLAUDE.md records that the Docker daemon is not running when a session begins. Start the interface before `service docker start`, with one open project whose record names a sandbox: destroyRecorded ends in dockerLeftovers, which returns the "could not be read" line; the record correctly gets removed: false; standard output says "...marked interrupted and removed at start: 1." Test C14 itself pins the count: test/web.test.ts:2500 expects recoverInterrupted() to equal [id] while the removal still fails.
- **ran_it:** False
- **suggested_fix:** Let recoverInterrupted return removed and left as removeAtStop does; print the count of removed projects only, and one line per project left with what is left; add those lines to C14. Note that J2's automated run reads this line (scripts/demo-journey-j2.ts:589, check K3). Or list it in the row as still open.

#### Finding 2: The "Close project" refusal says "Nothing else was changed", but the real removal has already removed everything it could; the project stays open half-removed

- **severity:** non_blocking
- **file:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/src/orchestrator/journey.ts
- **line:** 379-380 (with src/orchestrator/example-1-adapter.ts 154-162 and 381; src/orchestrator/journey-jobs.ts 605-609)
- **what_is_wrong:** closeNotRemovedRefusal ends: "Nothing else was changed. Press \"Close project\" again; if this repeats, restart the interface, which removes what a stopped interface left." Three things in it are not true with the real adapter. (a) Before the check, cleanup closes the live session with reason "project_closed" (journey-jobs.ts:606), sets appStarted false (adapter:381), runs Compose's removal and the image removal, and the sweep removes containers, volumes and networks by label (adapter:154-160); only then are Docker's lists read (161). So the app, its database volume and its images are gone while the project stays open at its old stage, with its usual buttons. The stand-in hides this: it throws before changing anything (test/journey-stand-ins.ts:315, 323), so C15 cannot see it. (b) "restart the interface, which removes" is unconditional: a restart runs the same sweep and the same check, so what Docker refused once it refuses again (the live test's own case). (c) The advice has a cost it does not state: a clean stop removes the sandbox of EVERY open project and marks each interrupted, not resumed (journey.ts removeLeft).
- **scenario:** Ran on real Docker (probe at /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/rev-180-rules-and-claims/probe.mts, output in probe-output-2.txt in the same folder): a made-up project with one labelled volume and one labelled network held in use by a container that is not the project's. destroyRecorded threw SandboxNotRemoved with left = [the network]; afterwards the volume was GONE, the folder kept, the holder untouched. The refusal built from that result reads "...(left: network ...). Nothing else was changed. ...".
- **ran_it:** True
- **suggested_fix:** Reword: say that what could be removed was removed and the project stays open only so the rest can be tried again; drop "which removes" or make it "tries the same removal again", and say that a restart also stops and removes every other open project's sandbox. Give the live session's close a reason of its own when the close is refused. Decide whether a project with removalLeft may still start jobs, and say so on the screen. Make the stand-in remove something before it throws, or add this case to the live test.

#### Finding 3: The screen sentence "Still listed by Docker: {left}" is not true in every case in which it is written

- **severity:** non_blocking
- **file:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/src/web/messages/en.json
- **line:** 334 (ar.json 334; src/orchestrator/journey.ts 455; src/orchestrator/example-1-adapter.ts 138 and 164)
- **what_is_wrong:** `left` is not always something Docker lists. (1) Docker cannot be asked: the screen reads "Still listed by Docker: Docker's lists could not be read (Command failed: docker ps -a --format {{.Names}}<tab>{{.Label "com.docker.compose.project"}})" - it contradicts itself, and the real reason is cut off, because only the first line of Node's error is kept and Docker's own words are on the second line. (2) The folder could not be removed: "Still listed by Docker: folder <path>" (adapter:164). (3) A removal that failed for another reason (for example recordedSandboxRefusal, where Docker is never read) writes removed: false with no `left`, and the screen reads "Still listed by Docker: not named in the record". (4) The list is the one read at the last attempt, shown in the present tense on every later page view. Also: `interrupted.no_job` (en.json:333) still says "Its containers are removed at the stop or at the next start" without condition, now directly above the note that says otherwise. Arabic: same placeholder and same meaning as far as I can read it, but the first sentence can be read as "removing everything failed" rather than "not everything was removed", and it quotes the button as «إغلاق المشروع», which is the interrupted panel's label; the ordinary button is «أغلق المشروع» (close.button). No sentence claims safety or readiness.
- **scenario:** Ran: the probe's part A called dockerLeftovers with DOCKER_HOST set to a socket that does not exist and printed the screen sentence quoted in (1); /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/rev-180-rules-and-claims/daemon-down.cjs shows the whole message, whose second line is "failed to connect to the docker API ... check if the path is correct and if the daemon is running". Cases (2) to (4) are from reading.
- **ran_it:** True
- **suggested_fix:** Word it as a past reading: "When the removal was last tried, this was left: {left}". Give "Docker could not be asked" and "the reason is not in the record" sentences of their own, and keep Docker's own line (the last non-empty line of the error), not the command. Make `interrupted.no_job` conditional or drop its removal clause. Use one Arabic name for the button; have a reader of Arabic check the new sentence (known gap 134).

#### Finding 4: The real adapter's handle path ("Close project" and a clean stop in a running interface) has no test or control that makes its removal fail

- **severity:** non_blocking
- **file:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/src/orchestrator/example-1-adapter.ts
- **line:** 379-387
- **what_is_wrong:** An interface that made a sandbox holds its handle, so "Close project" and the clean stop go through `destroy(x)`; `destroyRecorded` is used only after a restart. Finding B1 named exactly the handle path (it went through destroyExample1). The new live test and control J2-C54 call `destroyRecorded` only (test/removal-live.test.ts:64, 76); C14 and C15 use stand-ins. If lines 384-386 were put back to `return destroyExample1(x)`, every new test and all five controls would still pass; test/preview-live.test.ts closes a real project through this path, but only where the removal succeeds. So "every removal ... now ends in one function" is true by reading for this path, and not shown by any run.
- **scenario:** By reading and grep: `.destroy(` of the Sandboxes interface is called only at src/orchestrator/journey-jobs.ts:609; the only tests that reach the real adapter's `destroy` are test/preview-live.test.ts:156 and 290, both with nothing left.
- **ran_it:** False
- **suggested_fix:** Add a case to test/removal-live.test.ts that calls example1Sandboxes().destroy with a made-up handle (projectId, dir, and an `sb` built as destroyRecorded builds it) while the network is held, expecting SandboxNotRemoved and the folder kept; add a control that replaces `return sweepAndCheck(x.projectId, x.dir);` in `destroy`.

#### Finding 5: Gap 180's row: "Closed, except (a) to (d)" beside "Planned, not built", and open points it does not list

- **severity:** non_blocking
- **file:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/docs/KNOWN-GAPS.md
- **line:** 187
- **what_is_wrong:** (1) The third column ("Why it matters") is unchanged: "The record can say a project's containers were removed while something is left. Planned, not built: ..." It now contradicts the fourth column ("Fixed as described") and the status. (2) Still open and not listed: the start line (first finding); a project whose removal cannot complete can never be closed, every clean stop then exits 1 and every start adds one more removed: false event, with no way out in the interface (Docker not answering; a thing held by something that is not the project's); after a refused close the project stays open half-removed (second finding); the handle path is not tested for failure (fourth finding); weakness (1), no test case of a network matched by its label only, left the row together with the old "Planned handling" text although the product's own check now uses that matcher; point (a) names the screen sentence `preview.failed` only, while the record's own reason says the same and is written without a check (src/orchestrator/journey-jobs.ts:475: "The preview failed; its containers and images were removed."); `interrupted.no_job` is still unconditional. (3) "C14, C15 and C16 on stand-ins": C16 uses no stand-in; it calls the real function with no docker program on its PATH. The sentences of the "Fixed" paragraph themselves match the code, and (a) to (d) are each accurate.
- **scenario:** Read the row against the code at 7433518, sentence by sentence.
- **ran_it:** False
- **suggested_fix:** Rewrite the third column to what can still happen; add the points above as (e) onward, or fix them; keep the status as "Fixed in part" until the start line and the refusal's wording are right.

#### Finding 6: controls.py still says "No container is started by these tests"; J2-C54 now makes a Docker network and starts a container, and the script takes no lock itself

- **severity:** non_blocking
- **file:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/evidence/2026-11-13-journey-j2/controls-scripts/controls.py
- **line:** 7 and 194-196
- **what_is_wrong:** The header says "No container is started by these tests (stand-in sandboxes)". J2-C54 names test/removal-live.test.ts, whose beforeAll creates a network and runs a holder container on real Docker, in the baseline run and again in the control. The usage line in the header gives a command without the shared lock; only the wrapper evidence/2026-11-14-gap-180-removal-checked/full-checks.sh takes it.
- **scenario:** Someone runs controls.py as its header says while another live run holds Docker: the baseline and J2-C54 start a container outside the lock.
- **ran_it:** False
- **suggested_fix:** Correct the header (one control needs Docker and the approved Node image) and put the flock in the usage line, or take the lock inside the script for that control.

#### Finding 7: The product's check and the automated run's independent check N are now the same commands and the same function

- **severity:** non_blocking
- **file:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/src/orchestrator/example-1-adapter.ts
- **line:** 48 and 125-140 (compare scripts/demo-journey-j2.ts 96-109)
- **what_is_wrong:** dockerLeftovers repeats the run's four `docker ... --format` commands and calls the run's own matcher, projectLeftovers (scripts/journey-restart-checks.ts). Before, the run's N was a second opinion on the product's removal. Now, for Docker's lists, the two cannot disagee: a blind spot in the matcher (images with no name today; any kind added later) is shared by both. N still adds the processes, the folder and a later moment. The header of journey-restart-checks.ts still presents the file as the run's checks only, so a later change "to the run's checks" would change the product's removal rule without saying so.
- **scenario:** By reading: the row's own sentence "matched as J2's run matches them" is exact, which is the point.
- **ran_it:** False
- **suggested_fix:** Say in the row and in journey-restart-checks.ts's header that the product depends on this matcher; where the run reports N after a stop or a close, say that Docker's lists are matched by the product's own rule.

### Overstated claims

- **where:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/src/orchestrator/journey.ts:239 (and the change's own summary)
  - **quote:** the reason does not say "removed"
  - **what_is_shown:** All three new reasons contain the word ("could be removed"). NOT_REMOVED_AT_STOP contains "removed at the stop", the very phrase scripts/journey-restart-checks.ts:117 tests with a regular expression; that check stays sound only because it also requires removed === true. What is true: none of them says the project WAS removed.
- **where:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/docs/KNOWN-GAPS.md:187, status column
  - **quote:** Closed 14 Nov 2026, except (a) to (d)
  - **what_is_shown:** The record's side is fixed. The start line, the refusal's wording, the screen sentence, the untested handle path and a project that can never be closed are open and not among (a) to (d); the row's third column still says "Planned, not built".
- **where:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/docs/KNOWN-GAPS.md:187
  - **quote:** Shown by tests C14, C15 and C16 on stand-ins and by a test on real Docker
  - **what_is_shown:** On stand-ins that throw before changing anything; on real Docker for destroyRecorded only, with one network. Nothing on real Docker for the handle path. At this commit the evidence folder evidence/2026-11-14-gap-180-removal-checked holds only full-checks.sh, no output of a run.
- **where:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/src/orchestrator/journey.ts:380
  - **quote:** Nothing else was changed.
  - **what_is_shown:** On real Docker the refused removal had removed the project's labelled volume (my probe); by reading it also removes containers and images and ends the live session with reason "project_closed".
- **where:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/src/web/messages/en.json:334
  - **quote:** Still listed by Docker: {left}.
  - **what_is_shown:** True when `left` holds names from Docker's lists read at the last attempt. Not true when it holds "Docker's lists could not be read (...)", "folder <path>" or "not named in the record", and not re-read when the page is shown.
- **where:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/evidence/2026-11-13-journey-j2/controls-scripts/controls.py:7
  - **quote:** No container is started by these tests (stand-in sandboxes)
  - **what_is_shown:** J2-C54's test starts a container and makes a network on real Docker.
- **where:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/builder/test/journey.test.ts:2310 (C16's name)
  - **quote:** a project that is not a journey project is refused before anything is asked
  - **what_is_shown:** That the call rejects instead of returning the one line. "Before anything is asked" cannot be seen by the test: with no docker program on the PATH nothing could be asked either way. Small.
- **where:** /tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/wt180r/evidence/2026-11-14-gap-180-removal-checked/full-checks.sh (outside the named scope; its "BEFORE" half)
  - **quote:** Its tests before and after: with the fixed files as on claude/stage-1, then as here.
  - **what_is_shown:** The "before" half runs the new test files against source files that lack the names the tests import (dockerLeftovers, SandboxNotRemoved, the new reasons), so its failures do not by themselves show the old behaviour. The controls are what tie each test to its safeguard.

### Checked and sound

- Lens 1, the test diff: git diff --numstat gives journey-stand-ins.ts +5/-1, journey.test.ts +9/-1, web.test.ts +92/-1, removal-live.test.ts +81/-0; the three removed lines are import lines replaced by longer ones. No assertion, test name, time limit or expected value was removed or changed.
- Lens 1, the stand-in: `notRemoved` defaults to null and only C14 and C15 set it (and reset it in `finally`). No earlier test made a removal fail (grep for removed: false and for a throwing cleanup), so no existing test passes for a different reason.
- Lens 2: destroyExample1 is now used only by scripts/demo-acceptance.ts (328, 367) and test/acceptance-live.test.ts (62, 189), directly and unchanged. The Sandboxes `destroy` is called only at src/orchestrator/journey-jobs.ts:609, which discards what it returns; nothing reads the old sentence. test/preview-live.test.ts:290-296 closes a real project through the handle path and then reads Docker itself: stricter now, not weaker. The run's record checks (scripts/journey-restart-checks.ts 117, 133) also require removed === true, so the new reasons cannot pass them.
- Lens 4, by script (/tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/rev-180-rules-and-claims/count_controls.py): 58 controls with distinct ids; for J2-C54 to J2-C58 each text to replace occurs exactly once in its file, and each name given to -t matches exactly one test title.
- Lens 4, by reading: each replacement removes what its label names, and the first assertion to fail is the one about that safeguard: C54 at test/removal-live.test.ts:65 (not a SandboxNotRemoved), C55 at test/journey.test.ts:2313 (length 1), C56 at test/web.test.ts:2538 (not a JourneyRefused), C57 at test/web.test.ts:2490 (the event lacks `left`), C58 at test/web.test.ts:2511 and 2551 (the note is not on the page).
- Lens 3, by reading: C14, C15, C16 and the three tests of removal-live.test.ts each assert what their names say; the live test fails rather than skips without Docker or the Node image, makes only things named after its own made-up id or its own holder, and removes them in afterAll.
- Lens 5: en.json and ar.json hold 335 keys each, the same keys, and the same placeholders for every key including `removal.left` ({left}); the new sentence claims no safety or readiness.
- Lens 5: the stop's line "was removed at the stop: its containers, images and folder" (src/web/main.ts:349) is written only for a project whose cleanup returned, which with the real adapter means sweepAndCheck found nothing of it in Docker's four lists and the folder gone; `jobs` is set (main.ts:411) before recoverInterrupted runs, so the cleanup is never silently skipped; exit code 0 only when no project is left.
- Lens 5: NOT_REMOVED_AT_STOP, NOT_REMOVED_AT_START and CLOSE_NOT_REMOVED are true where written; "the next start tries again" holds because removeLeft takes every project that is not closed and whose record still names a sandbox (journey.ts 1257-1260, 453).
- Lens 6: the row's points (a) to (d) each match the code (stopApp at example-1-adapter.ts 373-378; one reading at 161; no process list in the product; parseImages keeps <none> and the matcher does not match it).
- On real Docker (my probe, one run): a volume and a network matched by the Compose label ONLY (names not starting builder_) were both listed by dockerLeftovers; the held network was named and the folder kept; the holder, not the project's, was untouched; with the holder gone the same removal completed and Docker listed nothing. The probe left 0 containers, 0 networks, 0 volumes; the snapshot's `git status` is empty; I created no database.

### Not looked at

- I did not run C14, C15, C16 or removal-live.test.ts, nor the whole suite, nor controls.py: they are run separately and the shared lock was held for long runs. I did not run any control's mutation (no file may be edited); "fails for that reason" is from reading.
- Outside my lens and only skimmed: whether the sweep could ever reach something that is not the project's, concurrency and the instance lock, the missing time limit on the docker commands in the sweep and the check, the stop's 90 s bound.
- docs/arabic-wording-list.md and evidence/2026-11-14-gap-180-removal-checked/full-checks.sh are outside the named scope; read once. full-checks.sh holds this session's scratch path and, by default, runs `git checkout` of five files in /home/user/vibe-build with no restore if it is interrupted part-way.
- The Arabic sentence: read by me, not by a reader of Arabic (known gap 134).
- docs/STATUS.md, docs/design/journey-j2.md and the evidence text of earlier runs: not checked for sentences that the change makes stale.
- My first probe attempt (/tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad/rev-180-rules-and-claims/probe-output.txt) failed before running anything (a file-type error of mine); the results I report are from probe.mts and probe-output-2.txt in the same folder.
