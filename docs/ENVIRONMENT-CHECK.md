# Environment check (Task 0, item 1)

Measured on 11 November 2026 inside a Claude Code cloud session. Everything here was run, not assumed. Re-run before relying on it: the documentation says these resources are approximate and may change.

## Plain-language result

- **Can it run a container?** Yes. The Docker daemon is not running when a session starts; it starts with one command and then works.
- **Can a container reach the package registry?** Yes, with a workaround. On Docker's default network a container has no internet at all, because this machine reaches the internet only through a local proxy that listens on the machine itself. A container that shares the machine's network, is told about the proxy, and is given the proxy's certificate can reach the npm registry, the Python package index and the Anthropic API.
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
| Start the Docker daemon (`service docker start`) | Works. One harmless warning about a ulimit setting |
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
2. In a cloud session, project containers must share the machine's network and use the session proxy with its certificate. This is a development-only arrangement. On a demo server there is no such proxy, and the design note (section 2.5) describes the egress proxy the builder runs for itself.
3. Nothing can be hosted here: the machine pauses when idle and running processes do not survive. The owner sees progress through screenshots and recordings in pull requests until a demo server exists.
4. Whether a web page served inside a session can be opened by the owner is tested at the end of this session: a one-page test server was started and its port was reported to the Claude app. The result is in `docs/STATUS.md`.

## Update, 12 November 2026: Docker start-up and the `vibe-build` environment

Measured in a cloud session on 12 November 2026.

- **`service docker start` failed** (exit code 2, daemon not running). Docker's start script (`/etc/init.d/docker`) stops at the first error, and two of its lines try to raise system limits the session is not allowed to raise ("ulimit: error setting limit (Operation not permitted)"). On 11 November the same message appeared as a warning and the daemon started; why it differs is not known.
- **Fix, run and checked:** adding `|| true` to those lines lets the script carry on. After it, `service docker start` returned 0 and containers ran from `postgres:16-alpine` (16.15), `node:22-alpine` (22.23.5) and `python:3.13-slim` (3.13.18).
- **The `vibe-build` cloud environment** (personal, created with the owner's approval) carries a setup script, a script that runs once when a new session's machine is built. It applies the fix, starts Docker, downloads those three images, and stops Docker again. Every step is allowed to fail so it cannot stop a session starting. Its network settings are the same as the Default environment's: limited, package managers allowed, plus the twenty research sites. It has no variables and no secrets.
- **Run here:** the script ran twice by hand in this session, about 15 seconds the first time and 5 the second.
- **Not checked:** the script has not yet run at the start of a fresh session, so it is unproven there. Whether the downloaded images are still present when the session begins is not known. The first session started on `vibe-build` should check both: `service docker start`, then `docker images`.
