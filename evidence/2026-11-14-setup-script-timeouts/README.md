# The setup script: time limits on its last three commands

*Written by Claude Code on 14 Nov 2026, branch `claude/fix-setup-script-timeouts` from `claude/stage-1` at `bdfd911`.*

## In plain words

- **What was wrong.** An independent review the owner relayed found that the setup script (`docs/environment/vibe-build-setup.sh`, the commands the cloud service runs before a session starts) said "every wait has a time limit", but three commands had none: starting Docker, stopping it, and giving a downloaded image its short name (`docker tag`). If one of them hung, the session's start could be held up. The review read this from the script; no hang was seen.
- **What changed.** Each of the three now has a time limit: 60 seconds to start Docker, 30 to stop it, 15 to rename an image, and each is killed 5 seconds later if it still has not stopped. Each writes its result to the script's log. The limits are chosen, not measured. The whole script now takes at most about five minutes.
- **How it was shown.** A copy of the script was run with stand-in commands that hang on purpose (`hang-test.sh`; nothing real was started, stopped or changed). The copy as it was **did not finish within 240 seconds**; the copy as it is now **finished by itself in 105 seconds** and logged each command that ran out of time (`hang-test.txt`).
- **The real script, run once here** (`real-run.txt`, under the shared test lock so no test run was using Docker): it ran to its end in 2 seconds, every step logged success, and the two approved images are present at their exact digests. Its "stop Docker" step returned success but did not stop Docker here, because this session started Docker by hand and Docker's own stop command only stops a Docker it started; on a fresh session the script starts Docker itself, so its stop is expected to work there (not shown).
- **Not shown.** A hang on the real machine (only with stand-ins). That the cloud service runs it by itself when a fresh session starts is still not shown. The copy saved on the "vibe-build" environment is updated separately, with the owner's approval.

## Files

| File | What it holds |
| --- | --- |
| `hang-test.sh` | The test: runs a copy of the script before and after, with `service` and `docker tag` replaced by commands that never return; the copy's log, start-script and process-file paths are rewritten into a temporary folder, and the test refuses to run if a real path is left |
| `hang-test.txt` | Its output: before, stopped by the test's own 240-second limit after logging only "setup start"; after, finished in 105 s with exit code 0, logging `exit=124` (ran out of time) for the start, both renames and the stop |
| `real-run.txt` | The fixed script run for real once, under the shared test lock, with what it showed and did not show |
