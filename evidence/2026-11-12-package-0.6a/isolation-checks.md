# Package 0.6a: isolation checked on the development profile

| | |
| --- | --- |
| Date | 12 November 2026 |
| Package | 0.6a of `docs/BUILD-PLAN.md`: "Isolation checked on the development profile, from inside the workload container: attempts to connect without the proxy, by address, on other ports, and by name lookup." It depends on package 0.5, tested again on 12 November at `e8dccc1`. Branch `claude/pkg-0.6a-isolation-checks`, started from `claude/stage-1` at `47093c5` |
| Done means (plan) | "Each attempt and its result listed. Because this profile shares the host's network, the report says plainly what is not isolated. The server profile is described as 'designed, not shown'" |
| Run on | The development machine (a cloud session), development profile. The project's app, tools, database and egress proxy containers share the host's network (known gap 1); the engine container has no network. Every attempt was made from inside a container: nothing the probe tests was run on the machine itself. Made-up data only. **No model was called** |
| Result | **State: built, not tested.** No independent reviewer has read it yet. **Shown on the development profile** (`run-live.txt`, at commit `fe5ff7e`; after it only the live test's order of checks changed, commit `fb5dc07`): every attempt and its result, for the app container, the tools container, the engine container, and a comparison container that is not a project container (the table below). From the app and tools containers, every service listening on the host's own loopback address could be reached, the builder's own database and the cloud session's own services among them, and the project's egress proxy could be gone round: directly, and through the cloud session's proxy. The only thing that stopped a direct connection out was the cloud session's own network filter, not anything the builder does. From the engine container, all 33 attempts failed. **Designed, not shown**: the server profile (package 0.6b) |

Plain words for the terms used here:
- A **container** is a sealed box a program runs in, with only the files and settings put into it.
- **Sharing the host's network** means the container uses the machine's own network connections, as if it were a program on the machine: it sees the machine's network and the services listening on it.
- The **loopback address** (127.0.0.1) is a machine's address for talking to itself. Services that should be reached only from the machine itself listen there.
- A **port** is a numbered door on an address; each service listens on its own (the builder's database on 5432, for example).
- A **TCP connection** is the line two programs open before they exchange anything; "connected" means only that the line was opened.
- An **HTTP status** is the number a web server answers with: 200 means "here it is", 301 "go to this other address", 403 "refused", 405 "this kind of request is not accepted".
- The **project's egress proxy** is the builder's own gatekeeper for traffic leaving a project. It lets through only the hosts on its list (here: `registry.npmjs.org`, the package registry) and records every decision.
- The **cloud session's proxy** is the gatekeeper of the cloud machine this work runs on. It is not part of the builder. The machine reaches the internet only through it, and it has its own list of allowed hosts.
- A **name lookup** (DNS) turns a name such as `example.com` into an address.
- A **certificate** is what a secure (HTTPS) site shows to prove who it is. The cloud session's proxy opens secure traffic and shows its own certificate, which a program trusts only if it has a copy of that certificate.

## What was built

- **The probe** (`builder/scripts/isolation-probe.mjs`): a plain Node program with no dependency. It refuses to start where Docker's marker file `/.dockerenv` is missing (measured: present inside a container, missing on the machine itself). It makes each attempt with a time limit of 5 seconds and prints one line per attempt: what, target, how, result (connected, refused, timed out, name not found, no name server answered, network unreachable, certificate not trusted, an HTTP status, a proxy's answer, or an address found) and the error code. Every attempt is harmless: a TCP connection opened and closed at once, a plain HTTP request (GET, no body), a proxy's CONNECT, or a name lookup. It prints no setting's value: only the names of settings that mention a proxy or a certificate. It refuses a session proxy given with anything but host and port, so it cannot print a user name or password.
- **Its HTTPS attempts** trust the container's own certificates, plus a copy of the session's certificate if one is found inside the container. That is what any program in the container could do. The probe never turns certificate checks off.
- **The reading of its output** (`builder/src/sandbox/isolation.ts`): turns the lines into a report, keeps every line it does not understand as a problem, says which attempts got an answer of any kind, and draws the table.
- **The demonstration** (`builder/scripts/demo-isolation.ts`): it creates a project on the development profile, with the house template as its app, so that the app and tools images are the real ones. It starts the project's database and egress proxy. If nothing listens on the model gateway's address (127.0.0.1:4010), it puts a stand-in listener there; the stand-in accepts a connection and closes it. It runs the probe in each container, prints every attempt, the table and the egress proxy's own log, writes the probe's raw lines to this folder, and removes everything.
- **Ten tests** (`builder/test/isolation.test.ts`, run by `npm test`):
  - nine unit tests of the probe's settings, its words for each failure, its reading of `/proc/net/tcp` from a made-up sample, its list of attempts, and the reading of its output. They call the probe's functions only; no attempt is made from the machine;
  - one live test that runs the probe in the engine container and requires that no attempt gets an answer of any kind.
- No package was added. No existing code file was changed.

## How each container was started

| Container | How it was started | Network | User inside |
| --- | --- | --- | --- |
| App | `docker compose run` on the project's `app` service, with the template's real app image (its `run` stage). It has the service's network, hardening (every capability dropped, no new privileges, read-only root, process and memory limits) and settings file. The probe, mounted read-only at `/probe`, was its command, in place of the app's server | the host's | `app` (uid 100) |
| Tools | `docker compose run` on the project's `tools` service, with the template's real tools image (its `tools` stage), the same way | the host's | `node` (uid 1000) |
| Engine | `docker compose run` on the project's `engine` service (`node:22-alpine`), the same way, with its usual mounts | none | `node` (uid 1000) |
| Comparison | `docker run` on Docker's default network ("bridge"), `node:22-alpine`, with the same hardening. **Not a project container**: added to see what the host's network adds | Docker's default | `node` (uid 1000) |

The probe was given: the session proxy as `127.0.0.1:45887` (read from the machine's proxy setting, host and port only), the project database's port 5562, the egress proxy's port 3128, the gateway's port 4010 and the builder's own database's port 5432. `example.com`'s address could not be looked up from any container, so the address given in the task, `93.184.215.14`, was used for B2 and B3. Whether that is still `example.com`'s address was not checked.

What each container saw of the network (the probe's own lines in `run-live.txt`):

| | App | Tools | Engine | Comparison |
| --- | --- | --- | --- | --- |
| Network interfaces | `lo` (127.0.0.1), `eth0` (192.0.2.2): the machine's own | the same | `lo` only | `lo`, `eth0` (172.17.0.2): Docker's |
| Listening ports seen | 2024, 3128, 5562, 33427, 4010, 45887, 5432: the machine's own | the same | none | none |
| Other connections seen on the machine | 16 | 48 | 0 | 0 |
| Settings naming a proxy or a certificate | none | none | none | none |
| A copy of the session's certificate | none | `/certs/session-ca.crt` | none (the workspace's `certs` folder is hidden by an empty one) | none |

## Every attempt and its result

One row per attempt, one column per container (`attempts-table.md`, written by the run). "Not tried" means the container saw no such listening port.

| Id | Target | What | app container (host network) | tools container (host network) | engine container (no network) | comparison: default network, not a project container |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | registry.npmjs.org:443 | a host the egress list allows, HTTPS | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN) | HTTP 200 | no name server answered (EAI_AGAIN) | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN) |
| A2 | registry.npmjs.org:80 | a host the egress list allows, plain HTTP | HTTP 301 | HTTP 301 | no name server answered (EAI_AGAIN) | HTTP 301 |
| A3 | example.com:443 | a host the egress list refuses, HTTPS | name not found (ENOTFOUND) | name not found (ENOTFOUND) | no name server answered (EAI_AGAIN) | name not found (ENOTFOUND) |
| A4 | example.com:80 | a host the egress list refuses, plain HTTP | name not found (ENOTFOUND) | name not found (ENOTFOUND) | no name server answered (EAI_AGAIN) | name not found (ENOTFOUND) |
| A5 | github.com:80 | another host the egress list refuses, plain HTTP | HTTP 301 | HTTP 301 | no name server answered (EAI_AGAIN) | HTTP 301 |
| B1 | 1.1.1.1:443 | a public address, HTTPS port | connected | connected | network unreachable (ENETUNREACH) | connected |
| B2 | 93.184.215.14:80 | example.com's address, HTTP port | connected | connected | network unreachable (ENETUNREACH) | connected |
| B3 | 93.184.215.14:80 | example.com's address, plain HTTP | HTTP 403 | HTTP 403 | network unreachable (ENETUNREACH) | HTTP 403 |
| B4 | 169.254.169.254:80 | the cloud's machine-information address (link-local) | HTTP 403 | HTTP 403 | network unreachable (ENETUNREACH) | HTTP 403 |
| C1 | 1.1.1.1:22 | an outside address, port 22 (remote login) | refused (ECONNREFUSED) | refused (ECONNREFUSED) | network unreachable (ENETUNREACH) | refused (ECONNREFUSED) |
| C2 | 1.1.1.1:25 | an outside address, port 25 (mail) | refused (ECONNREFUSED) | refused (ECONNREFUSED) | network unreachable (ENETUNREACH) | refused (ECONNREFUSED) |
| C3 | 1.1.1.1:53 | an outside address, port 53 (name service over TCP) | refused (ECONNREFUSED) | refused (ECONNREFUSED) | network unreachable (ENETUNREACH) | refused (ECONNREFUSED) |
| C4 | 1.1.1.1:8080 | an outside address, port 8080 | refused (ECONNREFUSED) | refused (ECONNREFUSED) | network unreachable (ENETUNREACH) | refused (ECONNREFUSED) |
| C5 | 127.0.0.1:5432 | the builder's own database (PostgreSQL) | connected | connected | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| C6 | 127.0.0.1:4010 | the model gateway's port | connected | connected | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| C7 | 127.0.0.1:5562 | the project's database | connected | connected | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| C8 | 127.0.0.1:3128 | the project's egress proxy | connected | connected | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| C9 | 127.0.0.1:45887 | the cloud session's proxy | connected | connected | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| X2024 | 127.0.0.1:2024 | another listening port, seen inside the container | connected | connected | not tried | not tried |
| X33427 | 127.0.0.1:33427 | another listening port, seen inside the container | connected | connected | not tried | not tried |
| D1 | registry.npmjs.org | an outside name the egress list allows | found 12 addresses | found 12 addresses | no name server answered (EAI_AGAIN) | found 12 addresses |
| D2 | example.com | an outside name the egress list refuses | name not found (ENOTFOUND) | name not found (ENOTFOUND) | no name server answered (EAI_AGAIN) | name not found (ENOTFOUND) |
| D3 | db | an internal-looking name: the database's name on the server profile | name not found (ENOTFOUND) | name not found (ENOTFOUND) | no name server answered (EAI_AGAIN) | name not found (ENOTFOUND) |
| D4 | metadata.google.internal | an internal-looking name: the cloud's machine-information service | name not found (ENOTFOUND) | name not found (ENOTFOUND) | no name server answered (EAI_AGAIN) | name not found (ENOTFOUND) |
| D5 | registry.npmjs.org @1.1.1.1 | an allowed name, asking an outside name server directly | found 12 addresses | found 12 addresses | no name server answered (ECONNREFUSED) | found 12 addresses |
| D6 | example.com @1.1.1.1 | a refused name, asking an outside name server directly | name not found (ENOTFOUND) | name not found (ENOTFOUND) | no name server answered (ECONNREFUSED) | name not found (ENOTFOUND) |
| E1 | registry.npmjs.org:443 | an allowed host, tunnel | proxy answered 200 | proxy answered 200 | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| E2 | registry.npmjs.org:443 | an allowed host, HTTPS inside the tunnel | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN) | HTTP 200 | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| E3 | example.com:443 | a refused host, tunnel | proxy answered 403 | proxy answered 403 | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| E4 | registry.npmjs.org:80 | an allowed host, plain HTTP | HTTP 405 | HTTP 405 | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| E5 | example.com:80 | a refused host, plain HTTP | HTTP 403 | HTTP 403 | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| F1 | registry.npmjs.org:443 | a host the egress list allows | proxy answered 200 | proxy answered 200 | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| F2 | github.com:443 | a host the egress list refuses | proxy answered 200 | proxy answered 200 | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| F3 | example.com:443 | another host the egress list refuses | proxy answered 403 | proxy answered 403 | refused (ECONNREFUSED) | refused (ECONNREFUSED) |
| F4 | github.com:443 | a host the egress list refuses, HTTPS inside the tunnel | certificate not trusted (SELF_SIGNED_CERT_IN_CHAIN) | HTTP 200 | refused (ECONNREFUSED) | refused (ECONNREFUSED) |

Groups: A, without the proxy, by name; B, without the proxy, by address; C, on other ports, and services on the host; D, by name lookup; E, through the project's egress proxy (the intended route); F, through the cloud session's proxy, going round the project's egress proxy. F was added to the plan's list to see whether the project's egress proxy can be gone round.

**Who answered.** An answer is not the same as reaching the target: a filter on the way can answer. Each answer's own words, as the probe recorded them (`run-live.txt`):
- A2 (301 to `https://registry.npmjs.org/-/ping`), A1 and E2 in the tools container (200): the answer named its server as `cloudflare`, the registry's own front. **The registry itself answered.**
- F4 in the tools container (200): the answer named its server as `github.com`. **GitHub itself answered.**
- A5 (301 to `https://github.com/`): no server name, and none of the cloud filter's marks. *Inferred, not shown*: GitHub's own redirect.
- B3 (403): `x-deny-reason: host_not_allowed`, "Host not in allowlist: example.com. Add this host to your network egress settings to allow access." **The cloud session's filter.**
- B4 (403): `x-deny-reason: private_dest_ip`, "Destination IP is in a private/reserved range". **The cloud session's filter.**
- E3 and E5 (403): "egress refused: example.com is not an allowed host". **The project's egress proxy.**
- E4 (405): "agent-proxy relay: this proxy only accepts HTTPS CONNECT tunnels…". The project's egress proxy let the request through and passed it on to the cloud session's proxy, which refused plain HTTP. **On this profile the egress proxy's plain-HTTP route does not work.** It fails closed, so this is not a risk.
- F3 (403): "request blocked: no rule or allowlist entry allows host "example.com"". **The cloud session's proxy.**
- B1 and B2 (connected) while C1 to C4 were refused at once: *inferred, not shown*: the cloud machine's network accepts connections on ports 80 and 443 itself and then applies its own list, as B3 and B4 show. Nothing shows that a packet reached 1.1.1.1 or 93.184.215.14.
- D5 and D6: a question sent straight to 1.1.1.1 was answered for the allowed name and "not found" for `example.com`, a name that exists on the public internet. *Inferred, not shown*: the cloud machine's network answers name questions itself, by its own list.
- The project's egress proxy logged ten decisions: E1 to E5, from the app and tools containers. None of the A, B, C, D or F attempts passed through it, so it has no record of them.

## What is not isolated on the development profile

The run showed the following.

1. **The app and tools containers share the host's network.** By their Compose settings, so do the database and egress proxy containers; those two were not probed. Inside the app and tools containers the probe saw:
   - the machine's own network interfaces;
   - every port listening on the machine;
   - the machine's own open connections (16 and 48).
2. **From the app and tools containers, every service listening on the machine could be reached** (C5 to C9, X2024, X33427: all "connected"):
   - the builder's own database (5432);
   - the model gateway's port (4010; a stand-in, because the gateway was not running);
   - the project's database (5562);
   - the project's egress proxy (3128);
   - the cloud session's own proxy (45887);
   - two more of the cloud session's own services (2024 and 33427).

   Only a connection was opened and closed. Nothing was signed in to or sent. Read on the machine itself, not from a container (`measure-host-listeners.txt`):
   - the builder's database asks for a password over such a connection, and none of its sign-in roles has one;
   - port 45887 belongs to a process named `claude`;
   - port 33427 belongs to a process whose name `lsof` shortens to `environme`;
   - `lsof` names no owner for port 2024.

   The gateway refuses a call whose project token it does not recognise (gateway test "refuses an unknown token and never forwards it"); no call to it was tried from a container.
3. **The project's egress proxy is not the only way out, and the builder does nothing to stop the others.** The egress proxy does what it was built to do: it allowed the registry (E1) and refused `example.com` (E3, E5). But a program in the app or tools container can go round it:
   - **Directly, without any proxy.** The registry answered plain HTTP (A2, from Cloudflare). A redirect came back from `github.com`, which is not on the egress list (A5). The tools container fetched the registry over HTTPS (A1, 200).
   - **Through the cloud session's proxy.** Its address is on the machine's loopback address, which these containers share. It opened a tunnel to `github.com`, which the egress list refuses, from both containers (F2). The tools container then fetched a page from GitHub through that tunnel (F4, 200, `server: github.com`).
   - **The project's egress proxy saw none of this** (its log above).
4. **What stopped direct connections was the cloud session's own filter, not the builder:**
   - names not on its list were not found (A3, A4, D2, D6);
   - requests by address were refused by its allowlist (B3) or as a private address (B4);
   - ports other than 80 and 443 were refused (C1 to C4).

   These rules belong to the cloud environment this work runs in. The builder does not set them and cannot rely on them. On another machine they would be different or absent.
5. **The tools container holds a copy of the cloud session's certificate** (`/certs/session-ca.crt`). On this profile the template's build stage copies it in, and the tools image is that stage (known gap 2). With it, the tools container's HTTPS attempts were trusted (A1, E2, F4). The app container holds no copy and is given no proxy setting, so its HTTPS attempts failed the certificate check (A1, E2, F4: "certificate not trusted"). **That is not a safeguard.** A program can choose not to check certificates (not tried), and plain HTTP worked without any certificate (A2, A5).
6. **Name lookups.** The containers' name servers answered for allowed names, including a question sent straight to an outside server (D1, D5). Internal-looking names were not found (D3, D4).

Recorded in `docs/KNOWN-GAPS.md`: gap 1 and gap 2 updated with these measurements, and a new gap 60 for the cloud session's own services and the builder's own database being reachable from project containers before model-written code runs there.

## The engine container

All 33 attempts failed (`run-live.txt`, and the live test in `npm test`):
- every outside attempt: "network unreachable" (ENETUNREACH) or "no name server answered" (EAI_AGAIN, ECONNREFUSED);
- every attempt on 127.0.0.1: "refused". That address is the container's own, and nothing listens there.

It has only the loopback interface, sees no listening port, and sees no copy of the session's certificate: the workspace's `certs` folder is hidden by an empty one. This is the scripted engine's container, given no network in package 2.1. As known gap 50 says, it shows nothing about the real engine of package 2.2, whose network is decided there.

**The live test can fail.** It was run once with the engine service given the host's network instead of none (`run-test-live-control-engine-on-host-network.txt`, commit `fb5dc07`; the change was made for that run only and undone). It failed and listed the 15 attempts that got an answer.

## The comparison container (Docker's default network)

It is not a project container. It was added because known gap 1 and design note 2.5 say a container on Docker's default network "has no internet at all". As measured today, that is no longer accurate as written:
- **What it reached:** allowed hosts on ports 80 and 443, through the cloud session's own filter. The registry answered plain HTTP (A2) and GitHub's address redirected (A5). Allowed names were looked up (D1, D5). Its HTTPS failed the certificate check (A1), as on 11 November (`docs/ENVIRONMENT-CHECK.md`, "self-signed certificate in certificate chain").
- **What it could not reach:** any service on the machine's loopback address (C5 to C9: refused), the cloud session's proxy among them.

So a container off the host's network was still not cut off from the internet here, but it was cut off from the builder's own services and the cloud session's. Whether a development profile without the host's network would work for the project's containers was not tried; it is a question for the owner and an engineer (known gap 60). Design note 2.5 is not changed by this package.

## The server profile: designed, not shown

Design note 2.5 describes the server profile, and the sandbox manager writes it (`builder/src/sandbox/manager.ts`, `composeDocument`, profile `server`):
- **One internal network per project, with no route out.** The app, tools and database containers are attached only to it.
- **The egress proxy is the only way out.** It is attached to that network and to an outside one. It allows exactly the model gateway and the stack's package registry, refuses everything else, and logs every decision. It connects out directly, with no session proxy.
- **The engine container has no network.**
- **Every container has the same hardening as here.**

What exists for it today:
- a unit test reads the Compose document ("server profile: an internal network with no route out, and the egress proxy as the only bridge", `builder/test/sandbox.test.ts`);
- `docker compose config` accepted a written file ("writes YAML that Docker Compose accepts").

It has not been run. **The server profile's isolation is designed, not shown.** Package 0.6b runs the same checks on a real server: every attempt from the app and engine containers to the outside must fail, except through the proxy to an allowed host; each connection inside the project that the design note lists must work; and at least one connection not on the list must fail for each container. Known gap 14 records how the design differs from the stronger "no network at all" pattern.

## What this does not show

- **The server profile** (package 0.6b).
- **The database and egress proxy containers were not probed.** By their Compose settings they share the host's network. *Inferred, not tested:* they would see what the app container saw.
- **Where the probe ran.** The app container ran the probe in place of the app's server, as its image's user, not as root. Every capability is dropped in all of these containers, including the one needed for raw network packets (`NET_RAW`); raw packets were not tried.
- **What was not tried:**
  - UDP other than name lookups, ICMP (ping), and IPv6;
  - turning certificate checks off;
  - a request naming an allowed host but sent to a different address;
  - signing in to any database;
  - sending anything to the cloud session's own services on ports 2024 and 33427, beyond opening and closing a connection.
- **What `connected` means.** On ports 80 and 443, "connected" to an outside address shows only that the cloud machine accepted the connection, not that it reached that address (see "Who answered").
- **`example.com`'s address.** It could not be looked up, so `93.184.215.14` (as given) was used. Whatever the address, the cloud filter refused the request by name (B3).
- **One run.** The run's results are as of 12 November 2026 on this machine. The cloud session's rules can change; the run should be repeated before it is relied on again.
- **No independent review yet.** The package is built, not tested.

## Checks run

All in `builder/`:

| Check | Result | Commit | File |
| --- | --- | --- | --- |
| `npm run typecheck`, and the new script type-checked with the same settings | exit 0, both | `fb5dc07` | `run-typecheck.txt` |
| `npx vitest run` (the whole suite, live Docker tests included) | 8 files, 150 tests passed (140 before this package, plus 10) | `fb5dc07` | `run-tests-all.txt` |
| `npm run check:licences` | `RESULT: PASSED`; no package added | `fb5dc07` | `run-licences.txt` |
| The new tests, each named | 10 passed | `fb5dc07` | `run-tests-isolation.txt` |
| The live test with the engine on the host's network (a control) | failed, as it must: 15 attempts answered | `fb5dc07`, with one line changed for the run | `run-test-live-control-engine-on-host-network.txt` |
| The demonstration | exit 0; nothing of the project left | `fe5ff7e` | `run-live.txt` |

The checks were run at `fb5dc07`, the last commit that changes code. The demonstration was run at `fe5ff7e`; between the two only the order of the live test's checks changed.

## Files in this folder

- `run-live.txt`: the demonstration's output (`npx tsx scripts/demo-isolation.ts`). The checkout's path is replaced by `<checkout>`; nothing in it is secret. The session proxy appears as host and port only.
- `attempts-table.md`: the table above, as the run wrote it.
- `probe-app.jsonl`, `probe-tools.jsonl`, `probe-engine.jsonl`, `probe-bridge.jsonl`: the probe's own lines, one file per container.
- `measure-host-listeners.txt`: read on the machine itself, as context. It records which process holds each listening port, how the builder's database asks a connection over TCP to sign in, and that none of its roles has a password.
- `run-typecheck.txt`, `run-tests-all.txt`, `run-tests-isolation.txt`, `run-licences.txt`, `run-test-live-control-engine-on-host-network.txt`: the checks above.
