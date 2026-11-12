# Environment check (Task 0, item 1)

Measured on 11 November 2026 inside a Claude Code cloud session. Everything here was run, not assumed. Re-run before relying on it: the documentation says these resources are approximate and may change.

## Plain-language result

- **Can it run a container?** Yes. The Docker daemon is not running when a session starts; it starts with one command and then works.
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
2. In a cloud session, project containers must share the machine's network and use the session proxy with its certificate. *Corrected by measurement on 12 November 2026 (package 0.6a, `evidence/2026-11-12-package-0.6a/isolation-checks.md`): "must" rested on the reason in the first section, which does not hold as written, and the project's containers do not all use the session proxy and its certificate. In use on the development profile (read from the sandbox manager's Compose settings and the template's Dockerfile, and seen in the run for the app and tools containers): every project container except the engine shares the machine's network, and the engine container has none; the app image's build is given the session proxy as build arguments and a copy of its certificate in the build stage; the egress proxy container is given the session proxy and has the certificate mounted; the tools image holds a copy of the certificate from the build stage; the app and tools containers are given no proxy setting, and the app container holds no copy of the certificate (none at the two places the 0.6a probe looked; the Dockerfile's `run` stage copies none). Whether project containers could work off the machine's network was not tried (known gap 60); on it, a connection opened from the app and tools containers to every service listening on the machine.* This is a development-only arrangement. On a demo server there is no such proxy, and the design note (section 2.5) describes the egress proxy the builder runs for itself.
3. Nothing can be hosted here: the machine pauses when idle and running processes do not survive. The owner sees progress through screenshots and recordings in pull requests until a demo server exists.
4. Whether a web page served inside a session can be opened by the owner is tested at the end of this session: a one-page test server was started and its port was reported to the Claude app. The result is in `docs/STATUS.md`.
