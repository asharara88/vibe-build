# Environment check (Task 0, item 1)

Measured on 11 November 2026 inside a Claude Code cloud session. Everything here was run, not assumed. Re-run before relying on it: the documentation says these resources are approximate and may change.

## Plain-language result

- **Can it run a container?** Yes. The Docker daemon is not running when a session starts; it starts with one command and then works. *Not always, as seen on 12 and 13 November 2026: on 12 Nov that command failed until Docker's start script was patched, and on 13 Nov it failed once until a file left from the day before was deleted (last section).*
- **Can a container reach the package registry?** Yes, with a workaround. As first written on 11 November: "On Docker's default network a container has no internet at all, because this machine reaches the internet only through a local proxy that listens on the machine itself." *Corrected by measurement on 12 November 2026 (package 0.6a, `evidence/2026-11-12-package-0.6a/isolation-checks.md`): neither half holds as written.* A container on Docker's default network, with no proxy setting and no certificate, got answers on port 80 (A2, A5) and to name lookups (D1, D5); its HTTPS request to the registry got a certificate it did not trust (A1), as in the 11 November row below. And requests sent with no proxy at all also got answers from containers on the machine's network (A2, A5; A1 in the one holding the proxy's certificate): the local proxy is not the machine's only way out. Which part of the cloud network answered or refused those direct requests is inferred, not shown. Measured on 11 November: a container that shares the machine's network, is told about the proxy, and is given the proxy's certificate can reach the npm registry, the Python package index and the Anthropic API. That was a test container started for this check; the builder's own project containers are not all set up that way (item 2 of "What this means for Stage 1" says which part gets what). The table rows below are the 11 November measurements, unchanged.
- **How much memory and disk?** 4 processor cores, 15 GiB of memory (14 GiB free), 30 GB of writable disk at session start.
- **Anything else?** Docker Hub, the public image library, refused one download with a "too many requests" error and accepted it on retry a minute later. Images should be pinned and, on the demo server, pulled with an account or from a mirror.

## Measured values

| Item | Result |
| --- | --- |
| Operating system | Ubuntu 24.04.5 LTS, x86_64, kernel 6.18 |
| Processors | 4 |
| Memory | 15 GiB total, 14 GiB available, no swap |
| Disk | 30 GB available to this session (the filesystem reports 252 GB, of which this session may use 30 GB) |
| Docker | 29.9.2, Compose v5.6.1, containerd snapshotter, cgroup v1 |
| Node.js / npm | 22.23.4 / 10.9.9 |
| Python | 3.13.18 |
| PostgreSQL client | 16.15 (server installed, not running by default) |

## Container tests

| Test | Result |
| --- | --- |
| Start the Docker daemon (`service docker start`) | Works. One harmless warning about a ulimit setting. *(12 and 13 Nov 2026: not always; last section)* |
| Pull and run `alpine:3.20` | Works |
| Pull `node:22-alpine`, `python:3.13-slim`, `curlimages/curl:8.10.1`, `postgres:16-alpine` | Works. One pull hit Docker Hub's rate limit (HTTP 429) and worked on retry |
| `npm view express version` inside a container, default bridge network | Fails: "self-signed certificate in certificate chain". The traffic is intercepted by the session proxy and the container does not trust its certificate |
| Same, container on the host network, proxy variables passed, proxy CA certificate mounted and set as `NODE_EXTRA_CA_CERTS` and npm `cafile` | Works. Returned the current version |
| Same, bridge network with the proxy address pointed at the host gateway | Fails: the proxy listens only on the machine's loopback address, so a bridge container cannot reach it |
| `pip download requests` inside a container on the host network with proxy and CA | Works |
| `curl https://api.anthropic.com/v1/models` inside a container on the host network with proxy and CA, no key | HTTP 401. The API was reached; 401 is the correct answer to a request with no key |
| Same on the bridge network without proxy | Fails: no route |
| Docker Compose with `postgres:16-alpine` and a health check | Works. `select version()` returned PostgreSQL 16.15 |
| Hardened container flags: `--user 65534:65534 --memory 512m --pids-limit 100 --cap-drop ALL --security-opt no-new-privileges` | Works |
| Same plus `--read-only --tmpfs /tmp:rw,noexec,nosuid,size=50m` | Works. A write to `/tmp` succeeds; a write to `/etc` fails with "Read-only file system" |
| Playwright on the host: `require('playwright')` and the browser directory | Works. Playwright 1.63.0 with Chromium installed at `/opt/pw-browsers` |

## Network from the session itself

| Host | Result |
| --- | --- |
| api.anthropic.com | Reachable (HTTP 401 without a key) |
| registry.npmjs.org, pypi.org, Docker Hub, GitHub | Reachable |
| code.claude.com, platform.claude.com, support.claude.com, github.com, pypi.org | Reachable |
| cloud.google.com | Reachable |
| www.npmjs.com, www.oracle.com | HTTP 403 from the proxy (policy denial) |
| www.hetzner.com, www.digitalocean.com, aws.amazon.com, azure.microsoft.com, docs.aws.amazon.com, learn.microsoft.com, docs.cloud.google.com, docs.djangoproject.com, www.postgresql.org, e2b.dev, www.core42.ai, www.khazna.ae, www.moro.ae, www.morganlewis.com, privacy.anthropic.com | Not reachable (name does not resolve through the session's network policy) |

The session's network policy is "limited: package managers allowed". Provider pricing pages and several documentation sites are outside it. `docs/OPEN-DECISIONS.md` lists the hosts that would need to be allowed.

## What this means for Stage 1

1. Development and the automated test harness can run here. Each session must start the Docker daemon first.
2. In a cloud session, project containers must share the machine's network and use the session proxy with its certificate. *Corrected by measurement on 12 November 2026 (package 0.6a, `evidence/2026-11-12-package-0.6a/isolation-checks.md`): "must" rested on the reason in the first section, which does not hold as written, and the project's containers do not all use the session proxy and its certificate. In use on the development profile (read from the sandbox manager's Compose settings and the template's Dockerfile, and seen in the run for the app and tools containers): every project container except the engine shares the machine's network, and the engine container has none; the app image's build is given the session proxy as build arguments and a copy of its certificate in the build stage; the egress proxy container is given the session proxy and has the certificate mounted; the tools image holds a copy of the certificate from the build stage; the app and tools containers are given no proxy setting, and the app container holds no copy of the certificate (none at the two places the 0.6a probe looked; the Dockerfile's `run` stage copies none). Whether project containers could work off the machine's network was not tried (known gap 60); on it, a connection opened from the app and tools containers to every service listening on the machine.* This is a development-only arrangement. On a demo server there is no such proxy, and the design note (section 2.5) describes the egress proxy the builder runs for itself.
3. Nothing can be hosted here: the machine pauses when idle and running processes do not survive. The owner sees progress through screenshots and recordings in pull requests until a demo server exists.
4. Whether a web page served inside a session can be opened by the owner is tested at the end of this session: a one-page test server was started and its port was reported to the Claude app. The result is in `docs/STATUS.md`.

## Update, 12 and 13 November 2026: Docker start-up and the `vibe-build` environment

Measured in one cloud session on 12 and 13 November 2026, on the same machine, across two restarts that kept its disk.

- **`service docker start` failed on 12 November** (exit code 2, daemon not running). Docker's start script (`/etc/init.d/docker`) stops at the first error, and two of its lines try to raise system limits the session is not allowed to raise ("ulimit: error setting limit (Operation not permitted)"). On 11 November `service docker start` worked with "one harmless warning about a ulimit setting" (first section; the warning's text was not recorded); why it differs is not known.
- **Fix, run and checked:** adding `|| true` to the start script's three `ulimit` lines lets it carry on, so Docker runs without the raised limits (known gap 62). After it, `service docker start` returned 0 and containers ran from `postgres:16-alpine` (16.15), `node:22-alpine` (22.23.5) and `python:3.13-slim` (3.13.18).
- **The `vibe-build` cloud environment** (personal, created on 12 Nov with the owner's approval) carries a *setup script*: commands the cloud service runs as root before a session starts. As written, it applies the fix above, starts Docker, downloads those three images by tag, and stops Docker again. Every step is allowed to fail and the script always ends with success, so, as written, a failing step should not stop a session starting; a step that hangs instead of failing, such as a stalled download, has no time limit (read from the script, not seen). When it runs, per Anthropic's documentation (`docs/SOURCES.md`, 13 Nov): the first time a session starts in the environment; the disk it leaves, images included, is saved as a snapshot that later sessions start from without running the script; it runs again when the script or the allowed hosts change, and when the snapshot expires after roughly seven days; not when a session's machine is restored after being idle; and before the environment's variables are set. Its network settings, read on 12 and 13 Nov, are the same as the Default environment's: limited, package managers allowed, and the same twenty allowed hosts. Nineteen of them are the research sites the owner approved on 11 Nov (`docs/OPEN-DECISIONS.md`); the twentieth, `openrouter.ai`, is not on that list, and how it came to be allowed was not looked into (`docs/STATUS.md`, Money). It had no variables and no secrets when created. By the afternoon of 12 Nov a variable named `VIBEBUILD_KEY` had been added. On 13 Nov the environment tool gave no list of names for it (`null`, where at creation it gave an empty list), but the session running on it that day was still given a variable named `VIBEBUILD_KEY` with a value in it (checked by name only; the value was not read) (`docs/STATUS.md`, question 2).
- **Run by hand:** on 12 Nov, in the session that made the environment, the script ran twice by hand, about 15 seconds the first time and 5 the second.
- **Not shown:** the script running by itself. The session that made the environment was moved onto it after that session had started, so no session start of its own ran the script. Whether other sessions started on "vibe-build" ran it, and when, is not known here. The images a session finds come from whichever run built its snapshot, so the same tag can name different images in different sessions (`docs/STATUS.md`, question 11).
- **Seen on 13 November 2026:** the machine restarted twice with its disk kept, on 12 Nov at 12:39 and on 13 Nov at 02:47. The start script is still dated 12 Nov 07:02 (the setup script's first step rewrites that file each time it runs, which would have given it a new date), and Docker's log (`/var/log/docker.log`) has no entry between 12 Nov 12:41 and that session's own start attempt on 13 Nov at 02:53. So the setup script did not run at either restart, as the documentation leads one to expect for a machine restored after being idle; the patch and the three images present since then come from the hand run of 12 Nov. After the 12:39 restart `service docker start` returned 0 and `postgres:16-alpine` ran.
- **A second way Docker fails to start here, seen on 13 November 2026:** after the 02:47 restart, `service docker start` printed "done" and returned, but the daemon stopped at once. Its log: "failed to start daemon, ensure docker is not running or delete /var/run/docker.pid: process with PID 343 is still running". The file `/var/run/docker.pid` was left from the daemon started on 12 Nov at 12:40, because `/run` is on the kept disk here, not cleared at restart. Docker's own check reports that some process had number 343 at that moment; that it was not Docker is inferred from the file dating from before the restart, and it had exited by the time it was looked for. With no `dockerd` running, deleting that file and running `service docker start` again started the daemon (Docker 29.9.2). The setup script does not handle this case, and `nohup dockerd` (the other start command in `CLAUDE.md`) uses the same file, so it would be expected to fail the same way (not tried). Known gap 62.
- **Images and the open licence question:** the setup script fetches its three images by tag. `node:22-alpine` and `postgres:16-alpine` are among the images the owner's question 11 asks about (`docs/STATUS.md`); `python:3.13-slim` is not named there and nothing in the builder uses it. On this machine, by hand, each of the three was run on 12 Nov at 07:02 to print its version, and `postgres:16-alpine` was run once more after the 12:39 restart; `python:3.13-slim` was not run again. `node:22-alpine` and `postgres:16-alpine` are also run by the builder's sandboxes, so the live tests in `npm test` ran them here on 12 Nov at 12:41 and again on 13 Nov before the merge (Docker's log; `docs/STATUS.md`, question 11).
