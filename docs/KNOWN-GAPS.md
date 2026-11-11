# Known gaps, shortcuts and risks

Record every shortcut and risk here the moment it is taken or noticed. Security first. A human engineer must review this system before any pitch that technical people attend, before any real data, and before anything serves more than one customer.

## Read this first, reviewing engineer

Nothing is built yet, so there is no code to review. When there is, start with these, in this order:

1. The model gateway: the one module that holds the API key and meters usage. Check that no other code path can reach the model and that the key never enters a project container.
2. The sandbox manager: how project containers are created, what they can reach on the network, and what they can see on disk.
3. The acceptance runner: that the build engine cannot read or change the acceptance checks, and that a check is reported as passed only when it ran.
4. The event log: that it is append-only and that every model call, tool call and approval is in it.

## Open gaps as of 11 November 2026

| # | Gap or risk | Why it matters | Planned handling | Status |
| --- | --- | --- | --- | --- |
| 1 | **In cloud development sessions, project containers must run on the host network.** The session reaches the internet only through a proxy on the machine's loopback address; a container on Docker's default network has no internet at all. | A container on the host network is not isolated from the host's network. This is acceptable only for development with made-up data. | Development only. On any server the builder runs its own egress proxy on a private Docker network (design note, section 6). | Open, security |
| 2 | **The session proxy's certificate must be mounted into project containers** so they trust intercepted traffic. | Any code in the container can see the proxy's certificate. The certificate is not a secret in itself, but a container with host networking and this certificate can reach whatever the session can reach. | Development only. Not used on servers. | Open, security |
| 3 | **The model key in Stage 1 development.** The handover's pattern is a proxy outside the container that adds the key. Until the gateway exists, nothing calls the model. If the walking skeleton takes a shortcut and passes the key into the engine's container, it must be written here first. | A key inside a container that runs untrusted generated code can be read by that code. | Build the gateway in the walking skeleton. No shortcut planned. | Watch |
| 4 | **Environment variables on a cloud environment are readable by anyone who uses that environment** (verified in Anthropic's documentation). | The model key lives in such a variable. | The owner's personal environment is used by the owner alone. Record if that changes. | Accepted for Stage 1 |
| 5 | **Docker Hub rate-limits anonymous image pulls.** One pull returned HTTP 429 during Task 0 and worked on retry. | Builds and tests fail at random. | Pin every image by digest. On the demo server, pull with an account or through a mirror. | Open |
| 6 | **Generated apps start with email-and-password sign-in.** Single sign-on comes later. | Password handling is a security-sensitive part of the template. It must use a maintained library and be reviewed. | Use a maintained library in the chosen stack; never write password handling by hand. Add to the engineer's review list. | Open, security |
| 7 | **No in-country model processing is verified for the UAE.** Anthropic's own data-residency options are "US" or "global" (verified 11 Nov 2026). AWS documentation found through search says Claude models in the UAE region run through global cross-region inference, so request data may be processed outside the UAE (not verified from the page itself). Core42's claims could not be checked. | A buyer that needs data to stay in the country may need the model calls to stay in the country too, and today no verified option exists. | Design to keep the model behind the gateway so the provider can be swapped. Say this plainly in any pitch to regulated buyers. Stage 3 question. | Open, pitch risk |
| 8 | **The Claude Agent SDK is not under a permissive licence.** It is governed by Anthropic's Commercial Terms of Service. | Hard rule 2 requires the owner's written exception. | Asked in `docs/OPEN-DECISIONS.md`, item 12. | Awaiting owner |
| 9 | **The Agent SDK has no overall session timeout.** | A runaway build can spend money until the cap is hit. | Every call sets a turn limit, and the gateway enforces the per-project cap. Both are tested in the walking skeleton. | Planned |
| 10 | **Cloud sessions pause when idle and are reclaimed; running processes do not survive, and commands have time limits** (verified). | Long test-protocol runs can be cut off. | The harness must be resumable: one build per invocation, results written to the repository as it goes. | Planned |
| 11 | **`CLAUDE.md` is advice to the model, not enforcement** (verified). | A rule in `CLAUDE.md` does not stop a bad action. | Enforce what matters with hooks and permissions in the build engine, and with the acceptance runner's separation. | Planned |
| 12 | **Provider pricing pages are not reachable from this session.** | The demo-environment decision cannot be made from verified prices. | `docs/OPEN-DECISIONS.md`, item 11. | Awaiting owner |
| 13 | **Several documentation pages could not be read from this session** (Django documentation, postgresql.org, docs.aws.amazon.com, learn.microsoft.com). Facts that depend on them are marked as assumptions in the design note. | Unverified facts can be wrong. | Re-check when the hosts are allowed or from another machine. | Open |
