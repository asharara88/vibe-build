# Package 0.6a: isolation checked on the development profile

| | |
| --- | --- |
| Date | 12 November 2026 |
| Package | 0.6a of `docs/BUILD-PLAN.md`: "Isolation checked on the development profile, from inside the workload container: attempts to connect without the proxy, by address, on other ports, and by name lookup." It depends on package 0.5, tested again on 12 November at `e8dccc1`. Branch `claude/pkg-0.6a-isolation-checks`, started from `claude/stage-1` at `47093c5` |
| Done means (plan) | "Each attempt and its result listed. Because this profile shares the host's network, the report says plainly what is not isolated. The server profile is described as 'designed, not shown'" |
| Run on | The development machine (a cloud session), development profile, at commit `cf5d41f`, the last commit that changes code (the run, the checks, and the controls of the second review; those of the first review were made at `325ecd2`). Every attempt of the run was made from inside a container: nothing the probe tests was run on the machine itself. On the machine, the harness only read its listening sockets and the gateway address of Docker's default network. Five unit tests make attempts, but only against made-up servers they start on the machine's loopback address. Made-up data only. **No model was called** |
| Result | **State: built, not tested.** Reviewed twice on 12 November. First review: eleven findings, each confirmed by two more reviewers, three of them blocking; the second review judged all eleven resolved. Second review: two should-fix findings, each confirmed by two more reviewers, and nine notes. Each is answered in this round (section "Review and answers", second round); this round has not been reviewed again yet. **Shown on the development profile** (`run-live.txt`, run once at `cf5d41f`, the last commit that changes code), for the app, tools and engine containers and a comparison container that is not a project container (the table below): <br>• From the app and tools containers, a connection was opened to every service listening on the machine, at the machine's loopback address. <br>• Three of those services listen on every address of the machine, not only on loopback: the project's egress proxy (3128), the project's database (5562) and port 2024, whose owner is not identified. From the comparison container, on Docker's default network, a connection to the machine's address on that network opened on those three ports, and was refused on the four that listen only on loopback. <br>• The project's egress proxy is not the only way out: answers came back to requests sent with no proxy at all; and the cloud session's proxy answered 200 to a request for a tunnel (CONNECT) to `github.com`, a host the egress list refuses, with no user name or password given by the container. Inside that tunnel the request was refused in the proxy's own words, or the container did not trust the certificate (F4): nothing from `github.com` was shown. The builder does nothing to stop either. <br>• From the engine container, all 40 attempts failed. <br>**Designed, not shown**: the server profile (package 0.6b) |

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
  - It makes each attempt with a time limit of 5 seconds and prints one line per attempt: what, target, how, result, error code. The results it can give: connected; connected, then no answer within the limit; refused; timed out; name not found; no name server answered; lookup refused by the name server; network unreachable; certificate not trusted; secure connection failed; connection reset; proxy closed without an answer; not an HTTP answer; an HTTP status; a proxy's answer; an address found; or error (a code it does not know).
  - "Timed out" is given only where no connection opened (or, for a lookup, no answer came). An attempt whose connection opened, or whose proxy answered 200 to its CONNECT, and which then got nothing before the limit is "connected, then no answer within the limit", with a detail saying what had come (after the second review's first finding).
  - Every attempt is harmless: a TCP connection opened and closed at once, a plain HTTP request (GET, no body), a proxy's CONNECT, or a name lookup.
  - An HTTP attempt settles once the status and headers arrive; the body is read for at most one second, for the detail only (after review finding 10).
  - A tunnel attempt sends its HTTPS request inside the proxy's tunnel (after review finding 8).
  - Group G (after review findings 1, 3 and 9): for each port the harness read as listening on the machine, a TCP connection to the gateway address of Docker's default network, opened and closed, nothing sent.
  - It lists the network interfaces twice: those that are up and running, with their addresses, as Node lists them; and every interface in `/sys/class/net`, up or down, with its state (names and states only). Node's list leaves out an interface that is not up and running (after the second review).
  - It also lists, without connecting to them: UDP sockets with no remote end, abstract Unix sockets (a kind of local socket that belongs to the network a container shares, not to its files), and whether Docker's socket exists inside.
  - It prints no setting's value: only the names of settings that mention a proxy or a certificate. It refuses a session proxy given with anything but host and port, so it cannot print a user name or password.
- **Its HTTPS attempts** trust the container's own certificates, plus a copy of the session's certificate if one is found inside the container. That is what any program in the container could do. The probe never turns certificate checks off.
- **The reading of its output** (`builder/src/sandbox/isolation.ts`):
  - it turns the lines into a report and keeps every line it does not understand as a problem;
  - it counts an attempt as answered when it got "a connection opened, an HTTP status, a proxy's answer, or an address found". Every result the probe gives only after a connection opened counts: connected, then no answer within the limit (after the second review); certificate not trusted, secure connection failed, connection reset, proxy closed without an answer, not an HTTP answer (after review finding 11). The whole result must match one of these words;
  - it draws the table. Where containers gave an attempt different targets or descriptions (B2 and B3 can), the row says "differs by container: see each cell" and each cell gives its own; none differed in this run. It marks every attempt aimed at a loopback address (127.x.x.x, `localhost` or `[::1]`) in a container whose loopback address is its own;
  - it reads on the machine, for group G, the listening TCP sockets and the gateway address of Docker's default network. With more listening sockets than the probe takes (64), it stops with a plain message, before any probe runs, rather than leave some out (7 in this run).
- **The demonstration** (`builder/scripts/demo-isolation.ts`): it creates a project on the development profile, with the house template as its app, so that the app and tools images are the real ones. It starts the project's database and egress proxy. If nothing listens on the model gateway's address (127.0.0.1:4010), it puts a stand-in listener there; the stand-in accepts a connection and closes it. It reads the machine's side for group G, runs the probe in each container, prints every attempt, the table and the egress proxy's own log, writes the probe's raw lines to this folder, and removes everything, each clean-up step on its own, reporting what is left.
- **Twenty-one tests** (`builder/test/isolation.test.ts`, run by `npm test`):
  - twenty unit tests. Fifteen call the probe's functions or read its output, with made-up samples (one of them writes a made-up folder of interface names in the temporary folder, and removes it). Five make attempts, but only against made-up servers the test starts on the machine's loopback address: the tunnel, a held body, a proxy that closes, a server that accepts a connection and never answers, and a proxy that answers 200 to a CONNECT and then says nothing;
  - one live test that runs the probe in the engine container, group G included, and requires that no attempt got an answer and none ended in "error", and that the container lists only its loopback interface.
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
| Network interfaces that are up and running, with their addresses (as Node lists them) | `lo` (127.0.0.1), `eth0` (192.0.2.2): the machine's | the same | `lo` (127.0.0.1) only | `lo` (127.0.0.1), `eth0` (172.17.0.2): Docker's default network |
| Every network interface in `/sys/class/net`, up or down (name and state only) | `docker0` (down), `eth0` (up), `ifb0` (down), `ifb1` (down), `lo` (unknown): the machine's | the same | `lo` (unknown) only | `eth0` (up), `lo` (unknown) |
| An IPv6 address on an interface that is up and running | none | none | none | none |
| Listening TCP sockets seen, with their addresses | 0.0.0.0:2024, 0.0.0.0:3128, 0.0.0.0:5562, 127.0.0.1:33427, 127.0.0.1:4010, 127.0.0.1:45887, 127.0.0.1:5432: the machine's own | the same | none | none |
| Other TCP sockets seen, in any state | 43 | 76 | 0 | 0 |
| UDP sockets with no remote end | none | none | none | none |
| Abstract Unix sockets (listed only, not connected to) | one: `@docker_cli_c4a20c64f4c502a7f626445593e39674` | one: `@docker_cli_9d4daa0cab37be6f1bc15245cc5760e0` | none | none |
| Docker's socket inside (`/var/run/docker.sock`, `/run/docker.sock`) | absent | absent | absent | absent |
| Settings naming a proxy or a certificate | none | none | none | none |
| A copy of the session's certificate, at the two paths the probe checks (`/certs/session-ca.crt`, `/workspace/certs/session-ca.crt`) | none | `/certs/session-ca.crt` | none | none |

Notes on this table:
- "Other TCP sockets, in any state" counts every TCP socket that is not listening, those closing or waiting after closing included. The tools container was probed right after the app container's probe opened and closed its connections, so part of its 76 are probably those (*inferred, not shown*). The counts differ from run to run (36 and 58 in the run before).
- **Interfaces.** Node's list leaves out an interface that is not up and running; the second line lists them all, with their state, but not the addresses of those that are down. Read on the machine after the run (`read-machine-interfaces.txt`, read-only): `docker0`, Docker's bridge, holds 172.17.0.1, the gateway address the G attempts aimed at, and was down, with no carrier, while no container was attached to it. The app and tools containers ran before the comparison container, so it was down when they ran (their own line shows it so). Their G attempts still opened connections to 172.17.0.1: it is one of the machine's own addresses (`/proc/net/fib_trie`, read on the machine), whatever the state of the interface that holds it (*inferred, not shown*: that this is how Linux treats a local address).
- The abstract Unix socket's name, `docker_cli_` and a string of letters and digits, is different in the two containers. *Inferred, not shown*: each belongs to the Docker command-line client on the machine that ran `docker compose run` for that container; a container that shares the host's network sees the machine's abstract sockets. Whether a container could connect to it, or what it would do, was not tried.
- **Certificates, read rather than probed.** The probe looked only at its two paths. Read from the template's Dockerfile and the sandbox manager, not checked in the image: the tools image very likely holds a second copy at `/app/certs/session-ca.crt`. The Dockerfile's `COPY . .` copies the build context, the sandbox manager puts `certs/session-ca.crt` in that context (`builder/src/sandbox/manager.ts`, `createSandbox`), and the template's `.dockerignore` does not leave `certs` out. For the engine, the workspace's `certs` folder is hidden by an empty one: that is read from the Compose settings; the probe showed only that no file was at its two paths.

## Every attempt and its result

One row per attempt, one column per container (`attempts-table.md`, written by the run). "Not tried" means the container saw no such listening port. In the engine and comparison columns, "at its own loopback address" marks an attempt that went to that container's own 127.0.0.1, as its target or as the proxy it goes through: such a result says nothing about the machine. Where containers give an attempt different targets or descriptions, the row reads "differs by container: see each cell" and each cell gives its own; in this run every container gave every attempt the same target and description. The table is the same, word for word, as the one from the run before at `325ecd2` (`run-live-2-second.txt`).

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

In the engine and comparison columns, C5 to C9, E1 to E5 and F1 to F4 went to the container's own loopback address, where nothing listens (the table marks each). So the comparison column's "0 of 5" through the egress proxy and "0 of 4" through the cloud session's proxy say nothing about the machine: from that container, G3128 did open a connection to the egress proxy's port at the gateway address. No attempt in any container ended "timed out", "connected, then no answer within the limit", or "error".

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
- **F1 and F2**: the cloud session's proxy answered 200 to the CONNECT, for the registry and for `github.com`. The containers gave it **no user name or password**: the probe is given the session proxy as host and port only and refuses anything else (`builder/scripts/isolation-probe.mjs:77-83`), and its CONNECT carries only a Host and a User-Agent line (`:479`).
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

1. **The app and tools containers share the host's network.** Inside them the probe saw the machine's network interfaces (those up and running with their addresses, `lo` and `eth0`, as Node lists them; and every one in `/sys/class/net` with its state, `docker0`, `ifb0` and `ifb1` down among them), its seven listening TCP sockets with their addresses, its other TCP sockets in any state (43 and 76), and one of its abstract Unix sockets each (listed only).
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
   - **Through the cloud session's proxy**, whose address the containers share: it answered 200 to a request for a tunnel (CONNECT) to `github.com`, which the egress list refuses (F2, in both containers), and to the registry (F1). The containers gave it **no user name or password**: host and port were enough (the probe's settings take only those, and its CONNECT sends only a Host and a User-Agent line). What came back inside the tunnel (F4): in the tools container, a 403 in the cloud session's proxy's own words; in the app container, a certificate it did not trust. That is what was shown: the proxy accepted the request for a tunnel. Nothing from `github.com` was shown, and whether the tunnel led there is *not shown*.
   - **The project's egress proxy has no record of any of this** (its log, `run-live.txt` section 6).
5. **On the direct path, the failures were:** names not found (A3, A4, D2, D6), connections to other ports refused (C1 to C4), and two requests refused with the cloud session's filter's own marks (B3, B4). The builder puts nothing in that path on this profile: the containers share the host's network (read from the Compose settings). Which part of the cloud network caused the name failures and the port refusals is *inferred, not shown* (previous section). Whatever causes them, the builder does not set these rules and cannot rely on them. On another machine they may be different or absent.
6. **The plain-HTTP route through the egress proxy (E4).** In this run, on this profile, it failed: the egress proxy allowed the request (its log) and passed it on, and the cloud session's proxy refused it with 405. On the server profile there is no upstream proxy; that route was not run there.
7. **The tools container holds a copy of the cloud session's certificate** (`/certs/session-ca.crt`, at the two paths the probe checks). On this profile the template's build stage copies it in, and the tools image is that stage (read from the Dockerfile; known gap 2). With it, the tools container's direct HTTPS request to the registry got 200 (A1). The app container holds no copy at those paths and is given no proxy setting: its direct HTTPS request failed the certificate check (A1), as did its request inside the cloud session's proxy's tunnel (F4); inside the egress proxy's tunnel to the registry it got 200 (E2). **A missing copy is not a safeguard**: plain HTTP got answers with no certificate at all (A2, A5), and a program can choose not to check certificates (not tried).
8. **Name lookups.** The containers' name servers answered for the allowed name, including a question sent straight to an outside server (D1, D5). Internal-looking names were not found (D3, D4).

### Sentences elsewhere that this run contradicts

Each is named here so that the record update after merging, with the owner, can correct it. None is changed by this package, except gap 1's opening sentence.

- **Design note `docs/design/stage-1.md`, section 2.5** (line 138): "the machine reaches the internet only through a proxy on its own loopback address" is contradicted: requests sent with no proxy got answers (A1 in the tools container, A2, A5). "A container on Docker's default network has no internet at all" is contradicted: the comparison container got answers from outside (next section). The same paragraph's "the proxy cannot be reached from a bridge network" agrees with the run (G45887 refused from the comparison container, at the gateway address, the only address of the machine it tried). Its "only working arrangement" was not tested: whether the project's containers could work off the host's network was not tried. The design note is **not changed by this package**; the record update after merging can correct it (owner's decision, gap 60).
- **The template's Dockerfile** (`templates/next/Dockerfile`, line 4, a comment): "The development machine reaches the internet only through a proxy with its own certificate." The same contradiction; not changed by this package.
- **`docs/ENVIRONMENT-CHECK.md`, line 8** (the record of the environment check of 11 November): "On Docker's default network a container has no internet at all, because this machine reaches the internet only through a local proxy that listens on the machine itself." Both halves are contradicted. The comparison container, on Docker's default network, with no proxy setting and no certificate, got answers to requests for hosts outside the machine: A2 and A5 (301 on port 80) and the name lookups D1 and D5 (the registry's addresses found); who answered is in "What the answers said". And requests sent with no proxy at all got answers from all three containers with a network (A2, A5; A1 in the tools container). Its line 59 ("In a cloud session, project containers must share the machine's network and use the session proxy with its certificate") rests on the same reason; whether the project's containers could work without these was not tried (gap 60). Not changed by this package.
- **`CLAUDE.md`, line 64** (the project's standing instructions, the owner's file): "Containers in a cloud session need `--network host`, the proxy variables and the proxy certificate at `/root/.ccr/ca-bundle.crt` mounted, or they have no internet." Contradicted as written: the comparison container had none of the three and still got answers on port 80 and to name lookups (A2, A5, D1, D5); the app container had the host's network but no proxy setting and no certificate, and got A2 and A5 (301) with no proxy. What the run does agree with: on port 443, sent directly, only the tools container, which holds a copy of the session's certificate, got an answer it trusted (A1: 200; the app and comparison containers: certificate not trusted). Named here for the owner, who decides whether and how to change it; not changed by this package.
- **`builder/src/sandbox/manager.ts`, lines 11 to 14** (a code comment): "the development machine reaches the internet only through a proxy on its own loopback address, which containers on a bridge network cannot reach". The first half is contradicted as above; the second agrees with the run (G45887 refused from the comparison container, at the gateway address, the only address of the machine it tried). Not changed by this package.
- **Known gap 1's opening sentence**: corrected in this package, by this measurement.

Recorded in `docs/KNOWN-GAPS.md`: gaps 1, 2 and 50 updated with these measurements, and gap 60 for what project containers can reach on the machine, with the G results, before model-written code runs there.

## The engine container

All 40 attempts failed (`run-live.txt`, and the live test in `npm test`):
- every outside attempt: "network unreachable" (ENETUNREACH), or "no name server answered" (EAI_AGAIN, ECONNREFUSED);
- every G attempt, toward the machine's gateway address: "network unreachable";
- every attempt on 127.0.0.1 (C5 to C9, E, F): "refused". That address is the container's own, and nothing listens there.

It has only the loopback interface (in Node's list and in `/sys/class/net` alike) and sees no listening port, no UDP socket, no abstract Unix socket, no Docker socket, and no copy of the session's certificate at the two paths the probe checks. This is the scripted engine's container, given no network in package 2.1. As known gap 50 says, it shows nothing about the real engine of package 2.2, whose network is decided there.

**The live test can fail.** It was run with the engine service given the host's network instead of none, at `325ecd2` and again at `cf5d41f` (`run-test-live-control-engine-on-host-network.txt` holds the second; the one line was changed for each run only and restored). Both times it failed and listed the 18 attempts that got an answer, G2024 among them. The live test includes group G, and also fails on any attempt that ended in "error".

## The comparison container (Docker's default network)

It is not a project container. It was added because known gap 1 and design note 2.5 say a container on Docker's default network "has no internet at all" (as do `docs/ENVIRONMENT-CHECK.md`, line 8, and, in other words, `CLAUDE.md`, line 64). As measured today, that is not accurate:
- **From outside, on port 80**, the registry's address answered plain HTTP (A2: 301, server named `cloudflare`) and so did `github.com` (A5: 301); that these were the registry and GitHub themselves is *inferred, not shown*. The cloud session's filter refused a request for `example.com` (B3) and one to the machine-information address (B4), with its own marks. A connection opened to 1.1.1.1 on port 443 (B1) and to the address given for `example.com` on port 80 (B2). The allowed name was looked up (D1, D5).
- **On port 443, no allowed host answered**: A1 got a certificate the container did not trust, as on 11 November (`docs/ENVIRONMENT-CHECK.md`, "self-signed certificate in certificate chain").
- **Toward the machine**, through its gateway address 172.17.0.1: a connection opened on 2024, 3128 and 5562, the three ports that listen on every address of the machine, and was refused on 4010, 5432, 33427 and 45887, the four that listen only on its loopback address (G).
- **C5 to C9, E1 to E5 and F1 to F4 went to its own loopback address**, where nothing listens: refused. They show nothing about the machine.

So a container off the host's network was not cut off from the internet here. Toward the machine it tried one address, the gateway address 172.17.0.1: there it opened a connection to the project's egress proxy, the project's database and port 2024, and was refused on the builder's database, the gateway's port, the cloud session's proxy and port 33427. Whether it could reach those four some other way (for example at the machine's outward address, 192.0.2.2) was not tried. Whether a development profile without the host's network would work for the project's containers was not tried either; it is a question for the owner and an engineer (known gap 60). Design note 2.5 is not changed by this package.

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
  - UDP other than name lookups (UDP sockets were only listed: none), ICMP (ping), and IPv6 (no container had an IPv6 address on an interface that was up and running, as Node lists them; the machine has no `/proc/net/tcp6`, read);
  - listing the addresses of interfaces that are down from inside the containers (only their names and states are listed; `docker0`'s address was read on the machine, `read-machine-interfaces.txt`);
  - turning certificate checks off;
  - a request naming an allowed host but sent to a different address;
  - signing in to any database, and sending anything to ports 2024 and 33427, or to anything at the gateway address, beyond opening and closing a connection;
  - an HTTPS request inside the cloud session's proxy's tunnel to the registry (F1 is a CONNECT only);
  - connecting to the abstract Unix sockets the host-network containers saw;
  - reaching the machine's outward address (192.0.2.2) from the comparison container, or from anywhere outside the machine: only the gateway address was tried.
- **What `connected` means.** On ports 80 and 443, "connected" to an outside address shows only that the cloud machine accepted the connection, not that it reached that address.
- **`example.com`'s address.** It could not be looked up, so `93.184.215.14` (as given) was used. Whatever the address, the cloud filter refused the request by name (B3).
- **The machine's listening sockets** were read once, just before the probes ran. A service that started or stopped during the run would not be in group G.
- **One run.** These results are as of 12 November 2026 on this machine. The cloud session's rules can change; the run should be repeated before it is relied on again. Two earlier runs are kept and are not this evidence. The first, made before the first review's fixes, is `run-live-1-first.txt`: its E2 and F4 rows, its comparison column's C5 to C9, and its answer counts are wrong (its first line says why). The second, at `325ecd2`, is `run-live-2-second.txt`: every attempt's target, result and error code in it is the same as in this run; only its info lines differ (its first line says what changed after it).
- **Built, not tested.** Reviewed twice; the answers of the second round have not been reviewed again.

## Review and answers

### First review

The first review of 12 November read the branch at `f57b0d8`. Eleven findings, each confirmed by two more reviewers; three were blocking. Line numbers in this section are at `325ecd2`. The second review judged all eleven resolved.

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
| A failure before the demonstration's main block left its temporary folder | The folder, the copy and the sandbox are made inside the try (`demo-isolation.ts:147-157`); checked once with a certificate path that does not exist: the sandbox was not made, and the folder was removed. The output of that first check was not kept; it was run again in the second round, and that output is kept (`run-demo-control-missing-certificate.txt`) |
| A failed clean-up step skipped the rest; the live test's clean-up was registered late | Each clean-up step on its own, guarded on what was made, and the leftover report always runs, networks and volumes included (`demo-isolation.ts:240-277`). The live test registers its clean-up straight after making its folder (`isolation.test.ts:388-393`) |
| A proxy that closes without answering was reported "timed out" after the full limit | "Proxy closed without an answer", at once: `isolation-probe.mjs:386-416`; unit test `isolation.test.ts:267`; control 4 fails |
| The comparison container "reached allowed hosts on ports 80 and 443" | Now: on port 80 the registry's address and `github.com` answered; on port 443 no allowed host answered (A1, certificate not trusted) |
| "An answer of any kind" | Replaced everywhere by the one defined wording |
| Read or partly checked facts placed under "shown" | Labelled as read from Compose, the Dockerfile or the code; the app image's "no copy" is "at the two paths the probe checks"; the tools image's likely second copy at `/app/certs/session-ca.crt` is noted, read from the Dockerfile; the `/.dockerenv` refusal is "designed". Gap 2 the same |
| "The machine's own open connections (16 and 48)" | "Other TCP sockets seen, in any state" (`isolation-probe.mjs:530`) |
| E4: "it fails closed, so this is not a risk" | Now says only what the run showed |

### Second review

The second review read the branch at `5168b36` (code as at `325ecd2`) through three lenses: coverage (whose reviewer, by its own report, ran the demonstration once more on a copy and got the same result for every attempt), honesty and code. It judged all eleven first-round findings resolved, confirmed two new should-fix findings (each by two more reviewers) and raised nine notes. Line numbers in this section are at `cf5d41f`.

| # | Finding or note (severity) | What was done |
| --- | --- | --- |
| 1 | An attempt whose connection opened (an HTTP or HTTPS request on an open connection, a CONNECT to a proxy that accepted the connection, or a tunnel after the proxy answered 200) and then got nothing before the limit was "timed out" and counted as no answer; `gotAnswer`'s comment said "timed out" means no connection opened (should-fix, two lenses) | A result of its own, "connected, then no answer within the limit", with a detail saying what had come: `OPENED_THEN_SILENT` and `openedThenSilent`, `builder/scripts/isolation-probe.mjs:351-362`. It is set once the connection opens in `httpAttempt` (`:424-427`, and again once the secure connection opens), `httpViaProxyAttempt` (`:441`) and `tunnel()` (`:478`), once the proxy answers 200 (`:471`), and once the secure connection inside the tunnel opens (`:504-510`). "Timed out" is kept for an attempt where no connection opened (`withLimit`'s comment, `:317-323`). `gotAnswer` counts the new result, matches whole results only, and its comment is corrected (`builder/src/sandbox/isolation.ts:46-62`; `RESULT` `:38-39`). Unit tests on the loopback address: a server that accepts a connection and never answers, for HTTP, HTTPS, HTTP through a proxy and CONNECT (`builder/test/isolation.test.ts:296`); a proxy that answers 200 to a CONNECT and then says nothing (`:322`). Each was run once with its fix removed and fails with "timed out" (`run-tests-with-fixes-removed.txt`, controls 5 and 6). The live engine test still requires no answer and no "error" (`isolation.test.ts:567-569`). In this run no attempt had the new result, "timed out" or "error" |
| 2 | `docs/ENVIRONMENT-CHECK.md:8` and `CLAUDE.md:64` make the claim this run contradicts and were not named (should-fix) | Both quoted, with what the run showed, in "Sentences elsewhere that this run contradicts", together with `docs/ENVIRONMENT-CHECK.md:59` and the code comment at `builder/src/sandbox/manager.ts:11-14`, which the verifying reviewers also pointed to; and in gap 1's planned handling. None is edited: the record update after merging, with the owner, does that (`CLAUDE.md` is the owner's to change) |
| 3 | The table took each row's target from the first container, so B2 and B3 could show another container's address (note) | Where containers differ, the row reads "differs by container: see each cell" and each cell gives that container's own target and description: `isolation.ts:159-195`, used by `renderTable` (`:198`) and `renderMarkdownTable` (`:207`). Unit test `isolation.test.ts:497`, with made-up addresses. None differed in this run |
| 4 | "A tunnel was opened to `github.com`" stated as shown (note) | Now what was shown: the cloud session's proxy answered 200 to the CONNECT (F2); inside the tunnel came the proxy's own 403 or a certificate the container did not trust (F4); nothing from `github.com` was shown. In the Result row, "What is not isolated" item 4, gap 1 and gap 60 |
| 5 | Not said that the session proxy accepted these CONNECTs with no user name or password (note) | Said in "What the answers said: shown" (F1, F2), item 4, the Result row, gap 1 and gap 60, from the probe's settings (host and port only, `isolation-probe.mjs:77-83`) and its CONNECT (a Host and a User-Agent line only, `:479`) |
| 6 | The comparison container's summary said it "could not" reach the loopback-only services; only the gateway address was tried (note) | The summary now says it tried one address of the machine, the gateway address, and that other ways (such as 192.0.2.2) were not tried. A note under the count table says C5 to C9, E and F in the engine and comparison columns went to the container's own loopback address |
| 7 | Gap 1 stated as fact that the direct answers came "through the cloud session's filter" (note) | Gap 1 now marks it *inferred, not shown* |
| 8 | The interface list leaves out interfaces that are down (`docker0`, the G target), yet the records called it the machine's interfaces (note) | The probe's line is now "network interfaces that are up and running, with their addresses (as Node lists them)" (`isolation-probe.mjs:193`, `:599`), and a second line lists every interface in `/sys/class/net`, up or down, with its state (`:194`, `:196-217`, `:600`). Unit test on a made-up folder, `isolation.test.ts:103`; the live test checks that the engine lists only `lo` (`:574-576`). This file, gap 1 and gap 60 say which list they mean, and the IPv6 row says "on an interface that is up and running". `docker0`'s address and state were read on the machine (`read-machine-interfaces.txt`) |
| 9 | A clean-up check was claimed with no kept output (note) | Run again at `cf5d41f`, with the certificate path changed for that run only to one that does not exist: the run failed while making the sandbox, before any image or container; the temporary folder, which by then held made-up secrets, was removed; nothing was left. Output, with the one-line change, in `run-demo-control-missing-certificate.txt`. The first check's output was not kept (said in the first review's table) |
| 10 | The own-loopback mark knew only 127.x.x.x, not `localhost` or `[::1]` (note) | `AT_LOOPBACK` also matches `localhost`, `[::1]` and `::1` (`isolation.ts:153-157`); the probe writes an IPv6 address in brackets before its port (`isolation-probe.mjs:234`, used at `:260`, `:263`, `:295`). Unit test with the three spellings and two that must not be marked, `isolation.test.ts:471` |
| 11 | The probe refuses more than 64 machine listeners while the harness passed however many it read (note) | One limit, `MAX_MACHINE_LISTENERS` (`isolation-probe.mjs:61`, used at `:92`). With more, the harness stops before any probe runs, saying how many there are and how many would be left out (`machineListenersFrom`, `isolation.ts:214-227`, called by `readMachineSide`, `:243`). Unit test with made-up `/proc/net/tcp` text, 64 accepted and 65 refused, `isolation.test.ts:346`. The machine had 7 in this run |

## Checks run

All in `builder/`, at `cf5d41f`, the last commit that changes code, except controls 1 to 4 (at `325ecd2`, first review):

| Check | Result | File |
| --- | --- | --- |
| `npm run typecheck`, and the demonstration's script type-checked with the same settings | exit 0, both | `run-typecheck.txt` |
| `npx vitest run` (the whole suite, live Docker tests included) | 8 files, 161 tests passed (140 before this package, plus 21) | `run-tests-all.txt` |
| `npm run check:licences` | `RESULT: PASSED`; no package added | `run-licences.txt` |
| The isolation tests, each named | 21 passed | `run-tests-isolation.txt` |
| Each new unit test of the two review rounds run once with its fix removed | all six failed, as they must (controls 1 to 4 at `325ecd2`, 5 and 6 at `cf5d41f`); each file restored and checked unchanged | `run-tests-with-fixes-removed.txt` |
| The live test with the engine on the host's network (a control), run again at `cf5d41f` | failed, as it must: 18 attempts answered | `run-test-live-control-engine-on-host-network.txt` |
| The demonstration's clean-up, with a certificate path that does not exist (a control) | the run failed while making the sandbox, before any image or container; the temporary folder was removed; nothing left. The line "Clean-up: containers, network, volume, images, … removed" is the demonstration's fixed wording; in this run only the folder had been made | `run-demo-control-missing-certificate.txt` |
| The demonstration, run once | exit 0; nothing of the project left (containers, networks, volumes, images, the comparison container, the temporary folder) | `run-live.txt` |

## Files in this folder

- `run-live.txt`: the demonstration's output (`npx tsx scripts/demo-isolation.ts`), at `cf5d41f`. Nothing in it is secret; the session proxy appears as host and port only.
- `run-live-2-second.txt`: the second run, at `325ecd2`, after the first review's fixes. Kept for the record; not this evidence. Its first line says what changed after it.
- `run-live-1-first.txt`: the first run, at `fe5ff7e`, made with the probe before the first review's fixes. Kept for the record; not this evidence. Its first line says which rows it gets wrong.
- `attempts-table.md`: the table above, as the run wrote it.
- `probe-app.jsonl`, `probe-tools.jsonl`, `probe-engine.jsonl`, `probe-bridge.jsonl`: the probe's own lines, one file per container.
- `measure-host-listeners.txt`: read on the machine itself on 12 November at 19:34 UTC, with no project running, as context: which process holds each listening port (`lsof`), how the builder's database asks a connection over TCP to sign in, and that none of its roles has a password.
- `read-machine-interfaces.txt`: read on the machine itself on 12 November at 21:31 UTC, after the run, read-only: each interface's state and IPv4 address (`docker0`: 172.17.0.1, down), the machine's own addresses, and Node's own list.
- `run-typecheck.txt`, `run-tests-all.txt`, `run-tests-isolation.txt`, `run-licences.txt`, `run-tests-with-fixes-removed.txt`, `run-test-live-control-engine-on-host-network.txt`, `run-demo-control-missing-certificate.txt`: the checks and controls above. The checkout's path is replaced by `<checkout>`, the temporary folder's by `<tmp>`.
