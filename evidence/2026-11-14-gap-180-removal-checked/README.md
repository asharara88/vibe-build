# Known gap 180's fix: a removal is recorded as done only when Docker lists nothing of the project

| | |
| --- | --- |
| What | The fix of known gap 180 (`docs/KNOWN-GAPS.md`), found by J2's second review (finding B1): the record could say a project's containers were removed, and the interface could exit 0 saying so, with containers or images left, and nothing then tried again |
| Written | 14 November 2026, by Claude Code |
| Code | Commit `7433518` (`builder/` tree `783af9f`), on `claude/stage-1` after pull request #49 |
| Machine | The development machine (a cloud session). Real Docker for the live tests. The scripted engine only: no model was called. Made-up data only |
| How it was run | `full-checks.sh` in this folder, from a side working copy; then the whole suite a second time (see "The red run") |

## What changed, in plain words

- **One checked ending for every removal.** At "Close project", at a stop on purpose and at the next start, removing a project's sandbox now ends in the same function. It removes what is left of the project by its Compose label, then reads Docker's own lists of containers, volumes, networks and images. Only if they hold nothing of the project is the project's folder removed and the removal reported as done.
- **If something is left,** the folder is kept, and the record says `removed: false` and names what is left. The sandbox stays in the record, so the next start, or a second "Close project", tries again.
- **"Close project" does not close a project whose removal left something.** It tells the owner what is left, and the project stays open.
- **The screens say so.** Every page of such a project names what Docker still lists, in English and Arabic.
- **Docker's lists that cannot be read are not read as "nothing left".**

## Results

| Check | Result | File |
| --- | --- | --- |
| The new tests with the fixed files as on `claude/stage-1`: C14, C15 (`test/web.test.ts`), C16 (`test/journey.test.ts`), and the real-Docker file `test/removal-live.test.ts` | **All failed**, as they should without the fix | `new-tests-before-and-after.txt` |
| The same, as committed | **All passed**: C14, C15, C16, and 3 of 3 on real Docker. Nothing of the live test left on the machine | the same file |
| Every control of the journey's list: each safeguard removed in turn | **58 of 58** failed their tests with the safeguard removed (the 53 of pull request #49 and five for this fix); the tree unchanged after every control | `controls-output.txt` |
| The whole suite, first run | **785 of 796. 11 failed.** A red run, kept as it is. The cause is below | `run-tests-full-linked-packages-11-failed.txt` |
| The whole suite, second run | **796 of 796 passed** in 32 files, in one run (1,052 s). No container on the machine before or after | `run-tests-full.txt` |
| Type check | Passed | `run-typecheck.txt` |
| Licence check | Passed. No dependency file is changed | `run-licences.txt` |

796 is the 790 of pull request #49 plus six new tests.

## What each part is shown by

| Part | Test | Control |
| --- | --- | --- |
| A removal that leaves something throws, names what is left and keeps the folder; once nothing holds it, the same removal removes everything and the folder | `test/removal-live.test.ts`, on real Docker: a network carrying the project's label, held in use by a container that is not the project's. The container that is not the project's is not touched | J2-C54 |
| Docker's lists that cannot be read are not read as nothing left | C16 | J2-C55 |
| At a stop: `removed: false` with what is left, a reason that does not say "removed", the project left for the next start, exit 1; the next start tries again, and records it removed once nothing is left; the screen names what is left | C14 | J2-C57, J2-C58 |
| "Close project" refused with what is left, recorded, the project not closed; pressed again with nothing left, it closes; the page and the POST say so | C15 | J2-C56, J2-C58 |

## The red run, and its cause

The first whole-suite run failed 11 live tests in four files (`acceptance-live`, `isolation`, `preview-live`, `sandbox`), every one at the same place: the container `egress-host`, the machine side of a project's door, exited with code 1.

**Cause: the side working copy, not the code.** That container runs `node --import tsx` with the builder's folder mounted into it, so it needs `builder/node_modules` inside that mount. This run was made from a side working copy in which `node_modules` was a symbolic link to another folder on the machine. Inside the container that folder does not exist.

**Shown** (`eleven-failures-cause.txt`): one of the four files, `test/sandbox.test.ts`, run alone on the same commit: it failed with the link, with a long and with a short temporary-folder path (the first guess, known gap 175's long path, was wrong); it passed 23 of 23 once the link was replaced by a real copy of the same installed packages. The whole suite then passed.

**What it does not say:** anything about this fix. The tests that failed do not use the changed code.

## Checked and assumed

- **Checked by running:** everything in the tables above, on the commit named.
- **Assumed:** that Docker lists a container, volume or network under its Compose label, or under the project's name, whenever it holds one of the project's (the matching is that of J2's run, `projectLeftovers`).
- **Not re-run after the review:** see "Review and answers", below, once it is written.

## What this does not show

- `stopApp`, after a preview that failed, still removes the app's containers and images without this check, and the screen sentence `preview.failed` still says they "were removed".
- The check reads Docker's lists once, right after the removal. Something a still-running Docker program creates afterwards (gap 179, point 2) is not seen until the next removal.
- Processes on the machine are not looked at by the product, only by J2's run.
- Images with no name are not matched.
- A removal made to fail in a full project built by the interface: the real-Docker test uses a made-up project with one network.
