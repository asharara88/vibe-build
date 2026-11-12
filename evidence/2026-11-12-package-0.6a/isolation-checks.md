# Package 0.6a: isolation checked on the development profile

| | |
| --- | --- |
| Date | 12 November 2026 |
| Package | 0.6a of `docs/BUILD-PLAN.md`: "Isolation checked on the development profile, from inside the workload container: attempts to connect without the proxy, by address, on other ports, and by name lookup." It depends on package 0.5, tested again on 12 November at `e8dccc1`. Branch `claude/pkg-0.6a-isolation-checks`, started from `claude/stage-1` at `47093c5` |
| Done means (plan) | "Each attempt and its result listed. Because this profile shares the host's network, the report says plainly what is not isolated. The server profile is described as 'designed, not shown'" |
| Run on | The development machine (a cloud session), development profile. Every attempt of the run was made from inside a container: nothing the probe tests was run on the machine itself. On the machine, the harness only read its listening sockets and the gateway address of Docker's default network. Three unit tests make attempts, but only against made-up servers they start on the machine's loopback address. Made-up data only. **No model was called** |
| Result | **State: built, not tested.** Reviewed once on 12 November: eleven findings, each confirmed by two more reviewers, three of them blocking. Each is answered in this round (section "Review and answers"); this round has not been reviewed again yet. **Shown on the development profile** (`run-live.txt`, run once at `325ecd2`, the last commit that changes code), for the app, tools and engine containers and a comparison container that is not a project container (the table below): <br>• From the app and tools containers, a connection was opened to every service listening on the machine, at the machine's loopback address. <br>• Three of those services listen on every address of the machine, not only on loopback: the project's egress proxy (3128), the project's database (5562) and port 2024, whose owner is not identified. From the comparison container, on Docker's default network, a connection to the machine's address on that network opened on those three ports, and was refused on the four that listen only on loopback. <br>• The project's egress proxy is not the only way out: answers came back to requests sent with no proxy at all, and the cloud session's proxy opened a tunnel to a host the egress list refuses. The builder does nothing to stop either. <br>• From the engine container, all 40 attempts failed. <br>**Designed, not shown**: the server profile (package 0.6b) |

Plain words for the terms used here:
- A **container** is a sealed box a program runs in, with only the files and settings put into it.
- **Sharing the host's network** means the container uses the machine's own network connections, as if it were a program on the machine: it sees the machine's network and the services listening on it.
- The **loopback address** (127.0.0.1) is a machine's address for talking to itself. A service that listens only there can be reached only from the machine itself, or from a container that shares its network. A service that listens on **every address** (written 0.0.0.0) can also be reached on the machine's other addresses.
- **Docker's default network** ("bridge") is a private network Docker makes on the machine. A container on it has an address of its own (here 172.17.0.2) and its own loopback address. The machine's own address on that network, the network's **gateway**, was 172.17.0.1 in this run (read with `docker network inspect bridge`).
- A **port** is a numbered door on an address; each service listens on its own (the builder's database on 5432, for example).
- A **TCP connection** is the line two programs open before they exchange anything; "connected" means only that the line was opened.
- An **HTTP status** is the number a web server answers with: 200 means "here it is", 301 "go to this other address", 403 "refused", 405 "this kind of request is not accepted".
- The **project's egress proxy** is the builder's own gatekeeper for traffic leaving a project. It lets through only the hosts on its list (here: `registry.npmjs.org`, the package registry) and records every decision.
- The **cloud session's proxy** is a gatekeeper of the cloud machine this work runs on, at 127.0.0.1:45887, held by a process named `claude` (read on the machine, `measure-host-listeners.txt`). It is not part of the builder, and it has its own list of allowed hosts. It is **not** the machine's only way out: requests sent with no proxy at all also got answers (A1 in the tools container, A2, A5). On that direct path, some refusals carry their own marks (`x-deny-reason`, B3 and B4); this report calls whatever gives them **the cloud session's filter**. Which part of the cloud environment that is was not shown.
- A **name lookup** (DNS) turns a name such as `example.com` into an address.
- A **certificate** is what a secure (HTTPS) site shows to prove who it is. A program trusts it only if it chains to a certificate the program already holds. In this run, some secure answers came with a certificate that a program trusted only once it also held a copy of the cloud session's certificate (A1 and F4, below).

## What was built

- **The probe** (`builder/scripts/isolation-probe.mjs`): a plain Node program with no dependency.
  - It refuses to start where Docker's marker file `/.dockerenv` is missing. That refusal is **designed**: it was not run on the machine (hard rule 9). The file was present in all four containers (the probe ran to its end in each) and is missing on the machine itself (read on 12 November).
  - It makes each attempt with a time limit of 5 seconds and prints one line per attempt: what, target, how, result, error code. The results it can give: connected, refused, timed out, name not found, no name server answered, lookup refused by the name server, network unreachable, certificate not trusted, secure connection failed, connection reset, proxy closed without an answer, not an HTTP answer, an HTTP status, a proxy's answer, an address found, or error (a code it does not know).
  - Every attempt is harmless: a TCP connection opened and closed at once, a plain HTTP request (GET, no body), a proxy's CONNECT, or a name lookup.
  - An HTTP attempt settles once the status and headers arrive; the body is read for at most one second, for the detail only (after review finding 10).
  - A tunnel attempt sends its HTTPS request inside the proxy's tunnel (after review finding 8).
  - Group G (after review findings 1, 3 and 9): for each port the harness read as listening on the machine, a TCP connection to the gateway address of Docker's default network, opened and closed, nothing sent.
  - It also lists, without connecting to them: UDP sockets with no remote end, abstract Unix sockets (a kind of local socket that belongs to the network a container shares, not to its files), and whether Docker's socket exists inside.
  - It prints no setting's value: only the names of settings that mention a proxy or a certificate. It refuses a session proxy given with anything but host and port, so it cannot print a user name or password.
- **Its HTTPS attempts** trust the container's own certificates, plus a copy of the session's certificate if one is found inside the container. That is what any program in the container could do. The probe never turns certificate checks off.
- **The reading of its output** (`builder/src/sandbox/isolation.ts`):
  - it turns the lines into a report and keeps every line it does not understand as a problem;
  - it counts an attempt as answered when it got "a connection opened, an HTTP status, a proxy's answer, or an address found". Every result the probe gives only after a connection opened counts: certificate not trusted, secure connection failed, connection reset, proxy closed without an answer, not an HTTP answer (after review finding 11);
  - it draws the table, and marks every attempt aimed at 127.0.0.1 in a container whose loopback address is its own;
  - it reads on the machine, for group G, the listening TCP sockets and the gateway address of Docker's default network.
- **The demonstration** (`builder/scripts/demo-isolation.ts`): it creates a project on the development profile, with the house template as its app, so that the app and tools images are the real ones. It starts the project's database and egress proxy. If nothing listens on the model gateway's address (127.0.0.1:4010), it puts a stand-in listener there; the stand-in accepts a connection and closes it. It reads the machine's side for group G, runs the probe in each container, prints every attempt, the table and the egress proxy's own log, writes the probe's raw lines to this folder, and removes everything, each clean-up step on its own, reporting what is left.
- **Fifteen tests** (`builder/test/isolation.test.ts`, run by `npm test`):
  - fourteen unit tests. Eleven call the probe's functions or read its output, with made-up samples. Three make attempts, but only against made-up servers the test starts on the machine's loopback address: the tunnel, a held body, a proxy that closes;
  - one live test that runs the probe in the engine container, group G included, and requires that no attempt got an answer and none ended in "error".
- No package was added. No code file outside this package's own was changed.

## How each container was started

| Container | How it was started | Network | User inside |
| --- | --- | --- | --- |
| App | `docker compose run` on the project's `app` service, with the template's real app image (its `run` stage). It has the service's network, hardening (every capability dropped, no new privileges, read-only root, process and memory limits) and settings file. The probe, mounted read-only at `/probe`, was its command, in place of the app's server | the host's | `app` (uid 100) |
| Tools | `docker compose run` on the project's `tools` service, with the template's real tools image (its `tools` stage), the same way | the host's | `node` (uid 1000) |
| Engine | `docker compose run` on the project's `engine` service (`node:22-alpine`), the same way, with its usual mounts | none | `node` (uid 1000) |
| Comparison | `docker run` on Docker's default network ("bridge"), `node:22-alpine`, with the same hardening. **Not a project container**: added to see what the host's network adds | Docker's default | `node` (uid 1000) |

The network, user, read-only root and dropped capabilities of each service are read from the Compose file the sandbox manager writes (`builder/src/sandbox/manager.ts`), and the run prints them (`run-live.txt`, section 1). The user ids are what the probe saw inside.

The probe was given:
- the session proxy as `127.0.0.1:45887` (read from the machine's proxy setting, host and port only);
- the ports of the project's database (5562), the egress proxy (3128), the gateway (4010) and the builder's own database (5432);
- for group G, read on the machine just before the probes ran (`run-live.txt`, section 3): the gateway address of Docker's default network, `172.17.0.1`, and the machine's listening TCP sockets, `0.0.0.0:2024, 0.0.0.0:3128, 0.0.0.0:5562, 127.0.0.1:33427, 127.0.0.1:4010, 127.0.0.1:45887, 127.0.0.1:5432`.

`example.com`'s address could not be looked up from any container, so the address given, `93.184.215.14`, was used for B2 and B3, and the table labels them "the address given for example.com (not checked)".

What each container saw (the probe's own lines in `run-live.txt`):

| | App | Tools | Engine | Comparison |
| --- | --- | --- | --- | --- |
| Network interfaces | `lo` (127.0.0.1), `eth0` (192.0.2.2): the machine's own | the same | `lo` only | `lo`, `eth0` (172.17.0.2): Docker's default network |
| An IPv6 address on any interface | none | none | none | none |
| Listening TCP sockets seen, with their addresses | 0.0.0.0:2024, 0.0.0.0:3128, 0.0.0.0:5562, 127.0.0.1:33427, 127.0.0.1:4010, 127.0.0.1:45887, 127.0.0.1:5432: the machine's own | the same | none | none |
| Other TCP sockets seen, in any state | 36 | 58 | 0 | 0 |
| UDP sockets with no remote end | none | none | none | none |
| Abstract Unix sockets (listed only, not connected to) | one: `@docker_cli_cb94d06b0c25f3282190aa93e60e73fd` | one: `@docker_cli_92a9e9a9ba683bfc07d93393c2a0a61f` | none | none |
| Docker's socket inside (`/var/run/docker.sock`, `/run/docker.sock`) | absent | absent | absent | absent |
| Settings naming a proxy or a certificate | none | none | none | none |
| A copy of the session's certificate, at the two paths the probe checks (`/certs/session-ca.crt`, `/workspace/certs/session-ca.crt`) | none | `/certs/session-ca.crt` | none | none |

Notes on this table:
- "Other TCP sockets, in any state" counts every TCP socket that is not listening, those closing or waiting after closing included. The tools container was probed right after the app container's probe opened and closed its connections, so part of its 58 are probably those (*inferred, not shown*).
- The abstract Unix socket's name, `docker_cli_` and a string of letters and digits, is different in the two containers. *Inferred, not shown*: each belongs to the Docker command-line client on the machine that ran `docker compose run` for that container; a container that shares the host's network sees the machine's abstract sockets. Whether a container could connect to it, or what it would do, was not tried.
- **Certificates, read rather than probed.** The probe looked only at its two paths. Read from the template's Dockerfile and the sandbox manager, not checked in the image: the tools image very likely holds a second copy at `/app/certs/session-ca.crt`. The Dockerfile's `COPY . .` copies the build context, the sandbox manager puts `certs/session-ca.crt` in that context (`builder/src/sandbox/manager.ts`, `createSandbox`), and the template's `.dockerignore` does not leave `certs` out. For the engine, the workspace's `certs` folder is hidden by an empty one: that is read from the Compose settings; the probe showed only that no file was at its two paths.

## Every attempt and its result

One row per attempt, one column per container (`attempts-table.md`, written by the run). "Not tried" means the container saw no such listening port. In the engine and comparison columns, "at its own loopback address" marks an attempt that went to that container's own 127.0.0.1, as its target or as the proxy it goes through: such a result says nothing about the machine.

| Id | Target | What | app container (host network) | tools container (host network) | engine container (no network) | comparison: default network, not a project container |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | registry.npmjs.org:443 | a host the egress list allows, HTTPS | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN) | HTTP 200 | no name server answered (EAI_AGAIN) | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN) |
| A2 | registry.npmjs.org:80 | a host the egress list allows, plain HTTP | HTTP 301 | HTTP 301 | no name server answered (EAI_AGAIN) | HTTP 301 |
| A3 | example.com:443 | a host the egress list refuses, HTTPS | name not found (ENOTFOUND) | name not found (ENOTFOUND) | no name server answered (EAI_AGAIN) | name not found (ENOTFOUND) |
| A4 | example.com:80 | a host the egress list refuses, plain HTTP | name not found (ENOTFOUND) | name not found (ENOTFOUND) | no name server answered (EAI_AGAIN) | name not found (ENOTFOUND) |
| A5 | github.com:80 | another host the egress list refuses, plain HTTP | HTTP 301 | HTTP 301 | no name server answered (EAI_AGAIN) | HTTP 301 |
| B1 | 1.1.1.1:443 | a public address, HTTPS port | connected | connected | network unreachable (ENETUNREACH) | connected |
| B2 | 93.184.215.14:80 | the address given for example.com (not checked), HTTP port | connected | connected | network unreachable (ENETUNREACH) | connected |
| B3 | 93.184.215.14:80 | the address given for example.com (not checked), plain HTTP | HTTP 403 | HTTP 403 | network unreachable (ENETUNREACH) | HTTP 403 |
| B4 | 169.254.169.254:80 | the cloud's machine-information address (link-local) | HTTP 403 | HTTP 403 | network unreachable (ENETUNREACH) | HTTP 403 |
| C1 | 1.1.1.1:22 | an outside address, port 22 (remote login) | refused (ECONNREFUSED) | refused (ECONNREFUSED) | network unreachable (ENETUNREACH) | refused (ECONNREFUSED) |
| C2 | 1.1.1.1:25 | an outside address, port 25 (mail) | refused (ECONNREFUSED) | refused (ECONNREFUSED) | network unreachable (ENETUNREACH) | refused (ECONNREFUSED) |
| C3 | 1.1.1.1:53 | an outside address, port 53 (name service over TCP) | refused (ECONNREFUSED) | refused (ECONNREFUSED) | network unreachable (ENETUNREACH) | refused (ECONNREFUSED) |
| C4 | 1.1.1.1:8080 | an outside address, port 8080 | refused (ECONNREFUSED) | refused (ECONNREFUSED) | network unreachable (ENETUNREACH) | refused (ECONNREFUSED) |
| C5 | 127.0.0.1:5432 | the builder's own database (PostgreSQL) | connected | connected | refused (ECONNREFUSED), at its own loopback address | refused (ECONNREFUSED), at its own loopback address |
| C6 | 127.0.0.1:4010 | the model gateway's port | connected | connected | refused (ECONNREFUSED), at its own loopback address | refused (ECONNREFUSED), at its own loopback address |
| C7 | 127.0.0.1:5562 | the project's database | connected | connected | refused (ECONNREFUSED), at its own loopback address | refused (ECONNREFUSED), at its own loopback address |
| C8 | 127.0.0.1:3128 | the project's egress proxy | connected | connected | refused (ECONNREFUSED), at its own loopback address | refused (ECONNREFUSED), at its own loopback address |
| C9 | 127.0.0.1:45887 | the cloud session's proxy | connected | connected | refused (ECONNREFUSED), at its own loopback address | refused (ECONNREFUSED), at its own loopback address |
| X2024 | 127.0.0.1:2024 | another listening port, seen inside the container | connected | connected | not tried | not tried |
| X33427 | 127.0.0.1:33427 | another listening port, seen inside the container | connected | connected | not tried | not tried |
| G2024 | 172.17.0.1:2024 | port 2024, listening on the machine at 0.0.0.0 (every address), as read on the machine | connected | connected | network unreachable (ENETUNREACH) | connected |
| G3128 | 172.17.0.1:3128 | port 3128, listening on the machine at 0.0.0.0 (every address), as read on the machine | connected | connected | network unreachable (ENETUNREACH) | connected |
| G4010 | 172.17.0.1:4010 | port 4010, listening on the machine at 127.0.0.1 (loopback only), as read on the machine | refused (ECONNREFUSED) | refused (ECONNREFUSED) | network unreachable (ENETUNREACH) | refused (ECONNREFUSED) |
| G5432 | 172.17.0.1:5432 | port 5432, listening on the machine at 127.0.0.1 (loopback only), as read on the machine | refused (ECONNREFUSED) | refused (ECONNREFUSED) | network unreachable (ENETUNREACH) | refused (ECONNREFUSED) |
| G5562 | 172.17.0.1:5562 | port 5562, listening on the machine at 0.0.0.0 (every address), as read on the machine | connected | connected | network unreachable (ENETUNREACH) | connected |
| G33427 | 172.17.0.1:33427 | port 33427, listening on the machine at 127.0.0.1 (loopback only), as read on the machine | refused (ECONNREFUSED) | refused (ECONNREFUSED) | network unreachable (ENETUNREACH) | refused (ECONNREFUSED) |
| G45887 | 172.17.0.1:45887 | port 45887, listening on the machine at 127.0.0.1 (loopback only), as read on the machine | refused (ECONNREFUSED) | refused (ECONNREFUSED) | network unreachable (ENETUNREACH) | refused (ECONNREFUSED) |
| D1 | registry.npmjs.org | an outside name the egress list allows | found 12 addresses | found 12 addresses | no name server answered (EAI_AGAIN) | found 12 addresses |
| D2 | example.com | an outside name the egress list refuses | name not found (ENOTFOUND) | name not found (ENOTFOUND) | no name server answered (EAI_AGAIN) | name not found (ENOTFOUND) |
| D3 | db | an internal-looking name: the database's name on the server profile | name not found (ENOTFOUND) | name not found (ENOTFOUND) | no name server answered (EAI_AGAIN) | name not found (ENOTFOUND) |
| D4 | metadata.google.internal | an internal-looking name: the cloud's machine-information service | name not found (ENOTFOUND) | name not found (ENOTFOUND) | no name server answered (EAI_AGAIN) | name not found (ENOTFOUND) |
| D5 | registry.npmjs.org @1.1.1.1 | an allowed name, asking an outside name server directly | found 12 addresses | found 12 addresses | no name server answered (ECONNREFUSED) | found 12 addresses |
| D6 | example.com @1.1.1.1 | a refused name, asking an outside name server directly | name not found (ENOTFOUND) | name not found (ENOTFOUND) | no name server answered (ECONNREFUSED) | name not found (ENOTFOUND) |
| E1 | registry.npmjs.org:443 | an allowed host, tunnel | proxy answered 200 | proxy answered 200 | refused (ECONNREFUSED), at its own loopback address | refused (ECONNREFUSED), at its own loopback address |
| E2 | registry.npmjs.org:443 | an allowed host, HTTPS inside the tunnel | HTTP 200 | HTTP 200 | refused (ECONNREFUSED), at its own loopback address | refused (ECONNREFUSED), at its own loopback address |
| E3 | example.com:443 | a refused host, tunnel | proxy answered 403 | proxy answered 403 | refused (ECONNREFUSED), at its own loopback address | refused (ECONNREFUSED), at its own loopback address |
| E4 | registry.npmjs.org:80 | an allowed host, plain HTTP | HTTP 405 | HTTP 405 | refused (ECONNREFUSED), at its own loopback address | refused (ECONNREFUSED), at its own loopback address |
| E5 | example.com:80 | a refused host, plain HTTP | HTTP 403 | HTTP 403 | refused (ECONNREFUSED), at its own loopback address | refused (ECONNREFUSED), at its own loopback address |
| F1 | registry.npmjs.org:443 | a host the egress list allows | proxy answered 200 | proxy answered 200 | refused (ECONNREFUSED), at its own loopback address | refused (ECONNREFUSED), at its own loopback address |
| F2 | github.com:443 | a host the egress list refuses | proxy answered 200 | proxy answered 200 | refused (ECONNREFUSED), at its own loopback address | refused (ECONNREFUSED), at its own loopback address |
| F3 | example.com:443 | another host the egress list refuses | proxy answered 403 | proxy answered 403 | refused (ECONNREFUSED), at its own loopback address | refused (ECONNREFUSED), at its own loopback address |
| F4 | github.com:443 | a host the egress list refuses, HTTPS inside the tunnel | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN) | HTTP 403 | refused (ECONNREFUSED), at its own loopback address | refused (ECONNREFUSED), at its own loopback address |

Groups:
- A, without the proxy, by name;
- B, without the proxy, by address;
- C, on other ports, and services on the host (X: other ports the container saw listening);
- G, toward the machine through the container network's gateway. For the app and tools containers, which share the machine's network, 172.17.0.1 is one of the machine's own addresses; for the comparison container it is the machine as seen from Docker's default network;
- D, by name lookup;
- E, through the project's egress proxy (the intended route);
- F, through the cloud session's proxy, going round the project's egress proxy.

F, G and B4 were added to the plan's list (`docs/DECISIONS.md`).

How many attempts got an answer ("a connection opened, an HTTP status, a proxy's answer, or an address found"), as the run printed them and as counted again from the probe's files:

| | App | Tools | Engine | Comparison |
| --- | --- | --- | --- | --- |
| Attempts | 42 | 42 | 40 | 40 |
| Got an answer | 28 | 28 | 0 | 12 |
| Toward outside (A, B, C1 to C4) | 7 of 13 | 7 of 13 | 0 of 13 | 7 of 13 |
| Toward the machine (C5 to C9, X, G) | 10 of 14 | 10 of 14 | 0 of 12 | 3 of 12 |
| Name lookups (D) | 2 of 6 | 2 of 6 | 0 of 6 | 2 of 6 |
| Through the egress proxy (E) | 5 of 5 | 5 of 5 | 0 of 5 | 0 of 5 |
| Through the cloud session's proxy (F) | 4 of 4 | 4 of 4 | 0 of 4 | 0 of 4 |

An answer is not the same as reaching the target: something on the way can answer.

### What the answers said: shown

Each answer's own words, as the probe recorded them (`run-live.txt`):
- **A2** (all three containers with a network): 301 to `https://registry.npmjs.org/-/ping`, server named `cloudflare`. **A1** in the tools container and **E2** in the app and tools containers: 200, server named `cloudflare`.
- **A5** (all three): 301 to `https://github.com/`, no server name.
- **A1** in the app and comparison containers: "certificate not trusted". In the tools container, which also trusts the session's certificate: 200.
- **B3**: 403, `x-deny-reason: host_not_allowed`, "Host not in allowlist: example.com. Add this host to your network egress settings to allow access." **B4**: 403, `x-deny-reason: private_dest_ip`, "Destination IP is in a private/reserved range". These two carry the cloud session's filter's marks.
- **E3** and **E5**: 403, "egress refused: example.com is not an allowed host": the project's egress proxy's own words; its log records both refusals.
- **E4**: 405, "agent-proxy relay: this proxy only accepts HTTPS CONNECT tunnels…". The egress proxy's log records the request as allowed; it passes requests on to the cloud session's proxy on this profile (`EGRESS_UPSTREAM_PROXY`, read from the Compose settings).
- **E2** in the app container: 200, inside the tunnel the egress proxy opened. The app container holds no copy of the session's certificate and no setting naming one, so the certificate inside that tunnel chained to one Node trusts by default.
- **F3**: 403, "request blocked: no rule or allowlist entry allows host "example.com"". The CONNECT went only to 127.0.0.1:45887, the cloud session's proxy.
- **F4**, after the cloud session's proxy answered 200 to the CONNECT: in the app container, "certificate not trusted"; in the tools container, which also trusts the session's certificate, 403 with no server name and the words `{"message":"This GitHub API path is not available: sessions are bound to their configured repositories. Use re…` (the probe keeps the first 110 characters).
- The project's egress proxy logged ten decisions: E1 to E5, from the app and tools containers. None of the A, B, D, F or G attempts was sent to it; C8 and G3128 only opened and closed a connection to it, so it has no record of them.

### What the answers said: inferred, not shown

- **The registry's own service answered** A1 (tools), A2 and E2: inferred from the server name `cloudflare` (the registry is served through Cloudflare; general knowledge, not checked here).
- **A5 is GitHub's own redirect**: inferred; the answer has no server name.
- **E2 in the app container**: the cloud session's proxy passed this tunnel through without opening the secure traffic, so the registry's own certificate came back.
- **A1 and F4**: the cloud session's filter (A1, direct) and the cloud session's proxy (F4, through its tunnel) opened the secure traffic themselves and showed a certificate of their own; that is why only the container holding the session's certificate trusted it (which is shown).
- **F4 in the tools container**: the 403 came from the cloud session's proxy, by its own rule for GitHub (its words speak of "sessions" and "configured repositories"). Nothing shows that GitHub was reached.
- **B1 and B2 connected while C1 to C4 were refused at once**: the cloud machine's network accepts connections on ports 80 and 443 itself and applies its own list, as B3 and B4 show, and refuses other ports. Nothing shows that a packet reached 1.1.1.1 or 93.184.215.14, or which part of the cloud network refused C1 to C4.
- **A3, A4, D2 and D6** (name not found): the cloud machine's network answers name questions itself, by its own list. D6 is a question sent straight to 1.1.1.1 for `example.com`, a name that exists on the public internet (general knowledge, not checked here), answered "not found", while D5 found the registry the same way.

## What is not isolated on the development profile

### Shown by the run

1. **The app and tools containers share the host's network.** Inside them the probe saw the machine's own network interfaces, its seven listening TCP sockets with their addresses, its other TCP sockets in any state (36 and 58), and one of its abstract Unix sockets each (listed only).
2. **From the app and tools containers, a connection was opened to every service listening on the machine, at the machine's loopback address** (C5 to C9, X2024, X33427: all "connected"):
   - the builder's own database (5432);
   - the model gateway's port (4010; a stand-in, because the gateway was not running);
   - the project's database (5562);
   - the project's egress proxy (3128);
   - the cloud session's proxy (45887);
   - port 2024, whose owner is not identified;
   - port 33427, held by a process `lsof` shows as `environme` (*inferred, not shown*: a service of the cloud environment).

   Only a connection was opened and closed. Nothing was signed in to or sent.
3. **Three of these services listen on every address of the machine, not only on its loopback address:** the project's egress proxy (0.0.0.0:3128), the project's database (0.0.0.0:5562) and port 2024 (0.0.0.0:2024). The other four listen only on 127.0.0.1: the builder's database (5432), the gateway's stand-in (4010), the cloud session's proxy (45887) and port 33427. Read on the machine by the harness in this run, and seen in the same form by the probe inside the app and tools containers. The G attempts showed what that means:
   - **From the comparison container, on Docker's default network, a TCP connection to the machine's address on that network (172.17.0.1) opened on ports 2024, 3128 and 5562** (G2024, G3128, G5562: connected), **and was refused on 4010, 5432, 33427 and 45887.**
   - The app and tools containers got the same results on the same address.
   - So a container that does not share the host's network still reached the project's egress proxy, the project's database and port 2024 on this machine. Only a connection was opened and closed: nothing was sent, and nothing was signed in to.
4. **The project's egress proxy is not the only way out, and the builder does nothing to stop the others.** The egress proxy does what it was built to do: it allowed the registry (E1, and E2 got 200 inside its tunnel in both containers) and refused `example.com` (E3, E5). But from the app and tools containers:
   - **Directly, with no proxy at all**, answers came back: A2 and A5 (301) in both containers, and A1 (200) in the tools container.
   - **Through the cloud session's proxy**, whose address the containers share, a tunnel was opened to `github.com`, which the egress list refuses (F2: the proxy answered 200, in both containers). Inside that tunnel, the HTTPS request for `/robots.txt` did not get a page: the tools container got a 403, and the app container did not trust the certificate (F4). So the tunnel opened; a page from GitHub through it was not shown.
   - **The project's egress proxy has no record of any of this** (its log, `run-live.txt` section 6).
5. **On the direct path, the failures were:** names not found (A3, A4, D2, D6), connections to other ports refused (C1 to C4), and two requests refused with the cloud session's filter's own marks (B3, B4). The builder puts nothing in that path on this profile: the containers share the host's network (read from the Compose settings). Which part of the cloud network caused the name failures and the port refusals is *inferred, not shown* (previous section). Whatever causes them, the builder does not set these rules and cannot rely on them. On another machine they may be different or absent.
6. **The plain-HTTP route through the egress proxy (E4).** In this run, on this profile, it failed: the egress proxy allowed the request (its log) and passed it on, and the cloud session's proxy refused it with 405. On the server profile there is no upstream proxy; that route was not run there.
7. **The tools container holds a copy of the cloud session's certificate** (`/certs/session-ca.crt`, at the two paths the probe checks). On this profile the template's build stage copies it in, and the tools image is that stage (read from the Dockerfile; known gap 2). With it, the tools container's direct HTTPS request to the registry got 200 (A1). The app container holds no copy at those paths and is given no proxy setting: its direct HTTPS request failed the certificate check (A1), as did its request inside the cloud session's proxy's tunnel (F4); inside the egress proxy's tunnel to the registry it got 200 (E2). **A missing copy is not a safeguard**: plain HTTP got answers with no certificate at all (A2, A5), and a program can choose not to check certificates (not tried).
8. **Name lookups.** The containers' name servers answered for the allowed name, including a question sent straight to an outside server (D1, D5). Internal-looking names were not found (D3, D4).

### Sentences elsewhere that this run contradicts

- **Design note `docs/design/stage-1.md`, section 2.5** (line 138): "the machine reaches the internet only through a proxy on its own loopback address" is contradicted: requests sent with no proxy got answers (A1 in the tools container, A2, A5). "A container on Docker's default network has no internet at all" is contradicted: the comparison container got answers from outside (next section). The same paragraph's "the proxy cannot be reached from a bridge network" agrees with the run (G45887 refused from the comparison container). Its "only working arrangement" was not tested: whether the project's containers could work off the host's network was not tried. The design note is **not changed by this package**; the record update after merging can correct it (owner's decision, gap 60).
- **The template's Dockerfile** (`templates/next/Dockerfile`, line 4, a comment): "The development machine reaches the internet only through a proxy with its own certificate." The same contradiction; not changed by this package.
- **Known gap 1's opening sentence**: corrected in this package, by this measurement.

Recorded in `docs/KNOWN-GAPS.md`: gaps 1 and 2 updated with these measurements, and gap 60 for what project containers can reach on the machine, with the G results, before model-written code runs there.

## The engine container

All 40 attempts failed (`run-live.txt`, and the live test in `npm test`):
- every outside attempt: "network unreachable" (ENETUNREACH), or "no name server answered" (EAI_AGAIN, ECONNREFUSED);
- every G attempt, toward the machine's gateway address: "network unreachable";
- every attempt on 127.0.0.1 (C5 to C9, E, F): "refused". That address is the container's own, and nothing listens there.

It has only the loopback interface and sees no listening port, no UDP socket, no abstract Unix socket, no Docker socket, and no copy of the session's certificate at the two paths the probe checks. This is the scripted engine's container, given no network in package 2.1. As known gap 50 says, it shows nothing about the real engine of package 2.2, whose network is decided there.

**The live test can fail.** It was run once with the engine service given the host's network instead of none (`run-test-live-control-engine-on-host-network.txt`, at `325ecd2`; the one line was changed for that run only and restored). It failed and listed the 18 attempts that got an answer, G2024 among them. The live test now includes group G, and also fails on any attempt that ended in "error".

## The comparison container (Docker's default network)

It is not a project container. It was added because known gap 1 and design note 2.5 say a container on Docker's default network "has no internet at all". As measured today, that is not accurate:
- **From outside, on port 80**, the registry's address answered plain HTTP (A2: 301, server named `cloudflare`) and so did `github.com` (A5: 301); that these were the registry and GitHub themselves is *inferred, not shown*. The cloud session's filter refused a request for `example.com` (B3) and one to the machine-information address (B4), with its own marks. A connection opened to 1.1.1.1 on port 443 (B1) and to the address given for `example.com` on port 80 (B2). The allowed name was looked up (D1, D5).
- **On port 443, no allowed host answered**: A1 got a certificate the container did not trust, as on 11 November (`docs/ENVIRONMENT-CHECK.md`, "self-signed certificate in certificate chain").
- **Toward the machine**, through its gateway address 172.17.0.1: a connection opened on 2024, 3128 and 5562, the three ports that listen on every address of the machine, and was refused on 4010, 5432, 33427 and 45887, the four that listen only on its loopback address (G).
- **C5 to C9, E1 to E5 and F1 to F4 went to its own loopback address**, where nothing listens: refused. They show nothing about the machine.

So a container off the host's network was not cut off from the internet here. It could open a connection to the project's egress proxy, the project's database and port 2024 on the machine, and could not to the builder's database, the gateway's port, the cloud session's proxy or port 33427. Whether a development profile without the host's network would work for the project's containers was not tried; it is a question for the owner and an engineer (known gap 60). Design note 2.5 is not changed by this package.

## The server profile: designed, not shown

Design note 2.5 describes the server profile, and the sandbox manager writes it (`builder/src/sandbox/manager.ts`, `composeDocument`, profile `server`):
- **One internal network per project, with no route out.** The app, tools and database containers are attached only to it.
- **The egress proxy is the only way out.** It is attached to that network and to an outside one, and connects out directly, with no session proxy. The design note says it allows exactly the model gateway and the stack's package registry; the sandbox manager allows the hosts the builder gives it. It refuses everything else and logs every decision.
- **The engine container has no network.**
- **Every container has the same hardening as here.**

What exists for it today:
- a unit test reads the Compose document ("server profile: an internal network with no route out, and the egress proxy as the only bridge", `builder/test/sandbox.test.ts`);
- `docker compose config` accepted a written file ("writes YAML that Docker Compose accepts").

It has not been run. **The server profile's isolation is designed, not shown.** Package 0.6b runs the same checks on a real server: every attempt from the app and engine containers to the outside must fail, except through the proxy to an allowed host; each connection inside the project that the design note lists must work; and at least one connection not on the list must fail for each container. Known gap 14 records how the design differs from the stronger "no network at all" pattern. The egress proxy listens on every address of its container (`builder/src/sandbox/egress-proxy.ts`, read); on the server profile that container is not on the host's network, so what that means there is for 0.6b.

## What this does not show

- **The server profile** (package 0.6b).
- **The database and egress proxy containers were not probed.** By their Compose settings (read) they share the host's network. *Inferred, not tested:* they would see what the app container saw.
- **Where the probe ran.** The app container ran the probe in place of the app's server, as its image's user, not as root. Every capability is dropped in every container probed, including the one needed for raw network packets (`NET_RAW`); raw packets were not tried.
- **What was not tried:**
  - UDP other than name lookups (UDP sockets were only listed: none), ICMP (ping), and IPv6 (no container had an IPv6 address on any interface; the machine has no `/proc/net/tcp6`, read);
  - turning certificate checks off;
  - a request naming an allowed host but sent to a different address;
  - signing in to any database, and sending anything to ports 2024 and 33427, or to anything at the gateway address, beyond opening and closing a connection;
  - an HTTPS request inside the cloud session's proxy's tunnel to the registry (F1 is a CONNECT only);
  - connecting to the abstract Unix sockets the host-network containers saw;
  - reaching the machine's outward address (192.0.2.2) from the comparison container, or from anywhere outside the machine: only the gateway address was tried.
- **What `connected` means.** On ports 80 and 443, "connected" to an outside address shows only that the cloud machine accepted the connection, not that it reached that address.
- **`example.com`'s address.** It could not be looked up, so `93.184.215.14` (as given) was used. Whatever the address, the cloud filter refused the request by name (B3).
- **The machine's listening sockets** were read once, just before the probes ran. A service that started or stopped during the run would not be in group G.
- **One run.** These results are as of 12 November 2026 on this machine. The cloud session's rules can change; the run should be repeated before it is relied on again. The first run, made before the review's fixes, is kept as `run-live-1-first.txt` and is not this evidence: its E2 and F4 rows, its comparison column's C5 to C9, and its answer counts are wrong (its first line says why).
- **Built, not tested.** Reviewed once; the answers of this round have not been reviewed again.

## Review and answers

The review of 12 November read the branch at `f57b0d8`. Eleven findings, each confirmed by two more reviewers; three were blocking. Line numbers are at `325ecd2`.

| # | Finding (severity) | What was done |
| --- | --- | --- |
| 1 | The comparison container's "host" attempts went to its own loopback, yet the records said it could not reach the machine's services; port 2024 was reachable (should-fix) | New group G toward the machine's gateway address, run in all four containers: the probe `builder/scripts/isolation-probe.mjs:82-92` (settings) and `:230-242` (attempts); the harness reads the machine's side, `builder/src/sandbox/isolation.ts:183-202`, called at `builder/scripts/demo-isolation.ts:183` and in the live test, `builder/test/isolation.test.ts:411`. The table marks every attempt aimed at a container's own loopback address (`isolation.ts:139-156`; the demonstration sets it for the engine and comparison columns, `demo-isolation.ts:196-208`). Unit test `isolation.test.ts:126`. This file, gap 1 and gap 60 now report the G results |
| 2 | The report dropped the listen addresses; the egress proxy and the project's database listen on every address (should-fix) | Addresses kept in "What each container saw", in the G rows' descriptions and in "What is not isolated", item 3; gap 60 |
| 3 | The comparison container's 127.0.0.1 attempts presented as proof it was cut off from the machine's services (blocking) | "Cut off from the builder's own services and the cloud session's" removed. In its place, exactly what G showed: connected on 2024, 3128, 5562; refused on 4010, 5432, 33427, 45887. Gaps 1 and 60 corrected the same way |
| 4 | Port 2024 (and 33427) called the cloud session's own services with no owner found (should-fix) | "Port 2024, whose owner is not identified"; "port 33427, held by a process `lsof` shows as `environme` (*inferred, not shown*: a service of the cloud environment)", here and in gaps 1 and 60 |
| 5 | Inferences restated as shown (should-fix) | "What the answers said" is split into "shown" and "inferred, not shown"; "What is not isolated" has a section for what was shown only. Marked as inferred: the filter's part in A3, A4, D2, D6 and C1 to C4; the registry and GitHub answering; and the new E2 and F4 readings. Gap 1 the same |
| 6 | The glossary and gap 1 said the machine reaches the internet only through the session's proxy (should-fix) | Glossary corrected; gap 1's opening sentence corrected by this measurement; the design note's line 138 and the Dockerfile's comment named as contradicted, for the record update after merging |
| 7 | Not said that the egress proxy, the project's database and port 2024 listen on every address of the machine (should-fix) | "What is not isolated", item 3, with what the G attempts showed; gap 60 |
| 8 | The "HTTPS inside the tunnel" attempts (E2, F4) sent the request straight to the target (blocking) | `agent: false` removed: `isolation-probe.mjs:422-448`. Unit test on the loopback address with a made-up proxy and two servers, `isolation.test.ts:205`; with the old line put back it fails (`run-tests-with-fixes-removed.txt`, control 1: server A answered, one direct connection). The run was repeated; E2 and F4 now describe what the fixed probe shows |
| 9 | The comparison container's "host" attempts only tested its own loopback (blocking) | As 1 and 3 |
| 10 | An HTTP answer whose body did not finish was reported "timed out" (should-fix) | The answer settles on the status and headers; the body is read for one second at most: `isolation-probe.mjs:282-312` (the limit can give the HTTP status) and `:328-349`. Unit test `isolation.test.ts:245`; control 2 fails ("timed out") |
| 11 | "Certificate not trusted" and "connection reset" counted as no answer, against the definition (should-fix) | `gotAnswer`, `isolation.ts:43-58`, counts every result given only after a connection opened; one wording, `ANSWER_WORDING`, used by the demonstration (`demo-isolation.ts:139`). New words for codes that were "error": `isolation-probe.mjs:123` ("not an HTTP answer"), `:138` ("secure connection failed"), `:406` (a proxy's answer that is not HTTP). Unit test `isolation.test.ts:302`; control 3 fails. The live test also fails on "error" (`isolation.test.ts:431`) |

The reviewers' notes:

| Note | What was done |
| --- | --- |
| B2 and B3 called "example.com's address" when the given address was used | "The address given for example.com (not checked)" unless the probe looked it up itself: `isolation-probe.mjs:210-213`, `:544`; unit test `isolation.test.ts:103` |
| No UDP listeners, abstract Unix sockets or Docker socket listed; IPv6 | Three info lines, `isolation-probe.mjs:531-536`, parsers `:167-184`; unit test `isolation.test.ts:80`. Abstract sockets are listed only, not connected to. The IPv6 line in "What was not tried" says no container had an IPv6 address |
| A failure before the demonstration's main block left its temporary folder | The folder, the copy and the sandbox are made inside the try (`demo-isolation.ts:147-157`); checked once with a certificate path that does not exist: the sandbox was not made, and the folder was removed |
| A failed clean-up step skipped the rest; the live test's clean-up was registered late | Each clean-up step on its own, guarded on what was made, and the leftover report always runs, networks and volumes included (`demo-isolation.ts:240-277`). The live test registers its clean-up straight after making its folder (`isolation.test.ts:388-393`) |
| A proxy that closes without answering was reported "timed out" after the full limit | "Proxy closed without an answer", at once: `isolation-probe.mjs:386-416`; unit test `isolation.test.ts:267`; control 4 fails |
| The comparison container "reached allowed hosts on ports 80 and 443" | Now: on port 80 the registry's address and `github.com` answered; on port 443 no allowed host answered (A1, certificate not trusted) |
| "An answer of any kind" | Replaced everywhere by the one defined wording |
| Read or partly checked facts placed under "shown" | Labelled as read from Compose, the Dockerfile or the code; the app image's "no copy" is "at the two paths the probe checks"; the tools image's likely second copy at `/app/certs/session-ca.crt` is noted, read from the Dockerfile; the `/.dockerenv` refusal is "designed". Gap 2 the same |
| "The machine's own open connections (16 and 48)" | "Other TCP sockets seen, in any state" (`isolation-probe.mjs:530`) |
| E4: "it fails closed, so this is not a risk" | Now says only what the run showed |

## Checks run

All in `builder/`, at `325ecd2`, the last commit that changes code:

| Check | Result | File |
| --- | --- | --- |
| `npm run typecheck`, and the demonstration's script type-checked with the same settings | exit 0, both | `run-typecheck.txt` |
| `npx vitest run` (the whole suite, live Docker tests included) | 8 files, 155 tests passed (140 before this package, plus 15) | `run-tests-all.txt` |
| `npm run check:licences` | `RESULT: PASSED`; no package added | `run-licences.txt` |
| The isolation tests, each named | 15 passed | `run-tests-isolation.txt` |
| Each new unit test run once with its fix removed | all four failed, as they must; each file restored and checked unchanged | `run-tests-with-fixes-removed.txt` |
| The live test with the engine on the host's network (a control) | failed, as it must: 18 attempts answered | `run-test-live-control-engine-on-host-network.txt` |
| The demonstration, run once | exit 0; nothing of the project left (containers, networks, volumes, images, the comparison container, the temporary folder) | `run-live.txt` |

## Files in this folder

- `run-live.txt`: the demonstration's output (`npx tsx scripts/demo-isolation.ts`), at `325ecd2`. Nothing in it is secret; the session proxy appears as host and port only.
- `run-live-1-first.txt`: the first run, at `fe5ff7e`, made with the probe before the review's fixes. Kept for the record; not this evidence. Its first line says which rows it gets wrong.
- `attempts-table.md`: the table above, as the run wrote it.
- `probe-app.jsonl`, `probe-tools.jsonl`, `probe-engine.jsonl`, `probe-bridge.jsonl`: the probe's own lines, one file per container.
- `measure-host-listeners.txt`: read on the machine itself on 12 November at 19:34 UTC, with no project running, as context: which process holds each listening port (`lsof`), how the builder's database asks a connection over TCP to sign in, and that none of its roles has a password.
- `run-typecheck.txt`, `run-tests-all.txt`, `run-tests-isolation.txt`, `run-licences.txt`, `run-tests-with-fixes-removed.txt`, `run-test-live-control-engine-on-host-network.txt`: the checks above. The checkout's path is replaced by `<checkout>`.
