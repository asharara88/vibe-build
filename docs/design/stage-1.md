# Stage 1 design note

| | |
| --- | --- |
| Status | **Approved by the owner on 11 November 2026, subject to three corrections, which are made in this version:** (1) the acceptance tests are never present in the engine's container and live outside the project's working copy and git history (2.4, 2.5, 2.7, 6.1, 7.2); (2) the budget cap works by worst-case holds settled to actual cost, with a pre-step check (2.4, 5.5, 7.2); (3) the second engine is OpenAI's Codex SDK, the owner's decision (1, 2.8, 8, 9). The owner's answers to section 9 are in `docs/DECISIONS.md`; the demo candidate (question 5) is still undecided, and the model key (question 7) is still to be created |
| Not covered by that approval | Changes made since. The five amendments to 5.5 were approved by the owner through the build plan. The other changes are listed at the end of 2.5, at the end of 5.5, at the end of 7.1 and in 7.2. **None of them has the owner's recorded approval**, except proof rows B15 to B19 in 7.2 (his answer to question 1 on 13 November 2026, "apply budget cap as long aswe can change it later", as Claude Code reads it; `docs/DECISIONS.md`); some are marked there as awaiting his decision, and the points under "Known limits of the hold" are open. *Note of 13 Nov 2026, after that day's review:* by the same reading, his answer also accepts proof rows B1 to B6 as rewritten on 12 November (B4 split in two; B1, B2, B5 and B6 say more) and package 1.2's narrowing to them, as question 1 said choosing (a) would; the wording added to B7 and B8, and the assignment of B7 to B14 to packages 1.3 to 1.5, are not covered by it. *Note of 13 Nov 2026, package 1.2b:* proof rows B20 and B21 in 7.2 restate the way to change a cap that the owner chose in his answer to question 13 ("a, add the cap change after 1.2"), as Claude Code reads it; row B22, and the refusal of a lowering below spent plus open holds (5.5, the note after the budget equation), are Claude Code's additions and are not covered by that answer (whether such a lowering should be accepted instead is his question 14) |
| Written | 11 November 2026, by Claude Code, from `HANDOVER.md` (the owner's edited version of the same day, which adds Decision F and gate item 9) and the checks recorded in `docs/SOURCES.md` and `docs/ENVIRONMENT-CHECK.md` |
| Reader | The owner: section 1, then section 9 (the questions). An incoming engineer: everything |

Marks used, as in the handover: **Verified** means checked against the source in `docs/SOURCES.md` on 11 November 2026. **Measured** means run in this session and recorded in `docs/ENVIRONMENT-CHECK.md`. **Assumption** means not yet checked. **Proposal** means recommended here and not yet decided.

---

## 1. Summary for the owner

**Terms used below, each in one line.** A *codebase* is the set of files that make up an app. A *container* is a sealed box on a machine in which a program runs with only what it is given. The *template* is the starter app every generated app begins from, with the quality rules already built in. A *stack* is the set of tools an app is written with; two candidate stacks are compared. The *gateway* is the one door through which every request to the AI model passes, so it can be counted and capped. The *model key* is the password-like code that lets the builder use the AI model; you create it in your Anthropic account. A *pull request* is a proposed set of changes on GitHub that you can read and approve. A *network policy* is the list of websites the development machine is allowed to reach.

**What this is.** A plan for the first stage of the builder: a single-user prototype that takes a plain-language need, interviews the user with closed-choice questions, writes a brief and a plan the user confirms, builds the app one step at a time inside a container, checks every step against the ten quality rules, runs an acceptance test that was fixed before building started, and exports an ordinary codebase. It is the journey in section 7 of the handover, built so that it can be measured and demonstrated.

**What I will build first: the walking skeleton.** The thinnest slice that goes all the way through. A fixed brief for test example 1, the leave-request app, goes through the pipeline with the analyst's conversation skipped. The build engine runs inside a container, on a house template, and builds the first two steps. The app runs. One acceptance check drives it as a user would and records a screenshot. The cost of every model call is recorded. This is done on two candidate stacks, so the choice of stack rests on a measurement and not on a preference. Nothing about this slice is clever. Its job is to prove that every part connects and to produce the first real numbers.

**What you will see.** A pull request with screenshots from an automated run: the app running, the acceptance check passing with its evidence, and the cost of the build in dollars. One set per candidate stack. Nothing in it is a mock-up. If a part does not work, the pull request says so.

**What the skeleton proves, in plain terms.**

- The engine can build on the template inside a container, without the model key ever entering that container.
- Every model call goes through one gateway that counts the cost and stops at a cap.
- An acceptance check written from the brief, stored where the engine's container cannot see it at all, can drive the running app and produce evidence.
- The exported app starts on its own with one command.
- The whole thing runs on the development machine we have, within its limits.

**What I checked, and what I could not.** I verified Anthropic's documentation on the build engine, its hosting, its security guidance, its permissions, the cloud development machine, model prices and the plan's monthly API credits (section 3). I measured the development machine: containers run, and containers can reach the package registries and the model API with a workaround that is acceptable for development only (section 4). After you allowed the research sites, I read Hetzner's and DigitalOcean's prices from their own pages, and confirmed that Oracle, AWS and Azure each have regions in the UAE. Oracle's, AWS's and Azure's price tables are drawn by a script in the browser and could not be read by this session; you can read those in a browser if you want the demo server in the UAE.

**Where I disagree with the handover.** In seven places, set out in section 2.9, most of them small. The three that matter: the first is that the handover's "Powered by Claude" wording is not quite what Anthropic permits: the permitted form is "{our name} Powered by Claude". The second is that the build engine's licence is a commercial licence, not a permissive one, so hard rule 2 needs your written exception. The third concerns processing inside the UAE: today no verified option keeps the model's processing in the country, and that matters for the regulated buyers in the handover.

**On staying adaptable (the owner's Decision F).** I agree with the two seams and the profiles. **The second engine proven before the gate is OpenAI's Codex SDK, by the owner's decision on 11 November 2026.** My original recommendation, kept as history in section 2.8, was a small loop of our own against an OpenAI-compatible endpoint, because that is what a UAE-only profile would need. The Codex SDK proves the engine seam with a mature agent; it does not answer whether the builder can run on an in-country model, and that question stays open (`docs/KNOWN-GAPS.md`, gap 33).

**What I need from you.** The decisions in section 9, in order. The first two unblock everything: approve this note, and approve the licence exception for the build engine. The third unblocks the demo-server decision. The model key is needed before the skeleton can make its first model call.

**What this note does not do.** It gives no dates. It does not say the system is secure, ready or reviewed. Section 6 says what is protected in Stage 1 and what is not, and the register in `docs/KNOWN-GAPS.md` is already more than thirty entries long.

---

## 2. Architecture

### 2.1 Parts

The parts are as in the handover, section 8.1, with their boundaries made firmer. Each is a module behind a narrow interface. The builder itself is one process in Stage 1; the parts are separate modules so that one reviewer can read each in turn, not separate services.

| Part | Job | Interface it must keep |
| --- | --- | --- |
| Builder web app | Everything the user sees | Talks only to the orchestrator |
| Orchestrator | Moves a project through the journey; holds the approval points | Owns the project state machine. Nothing else changes a project's state |
| Analyst | B1 and B2. Produces brief, plan, acceptance checklist, Later list, assumed choices | Reads the question bank; writes the app spec (2.3) |
| Optimiser | B4. One step in, one engine instruction out; checks the result | Rule slots empty until the test protocol fills them |
| Model gateway | The only route to the model. Holds the key. Meters usage. Enforces the cap | Every model call, from every part and from the engine's container, passes through it |
| Build engine | Writes the app's code for one step, inside the project's container | Replaceable; see 2.4 |
| Sandbox manager | Creates, starts, stops one isolated set of containers per project | Replaceable; see 2.5 |
| Quality gate | Automated checks for the ten rules and the house standard, after every step | Runs inside the project's containers, outside the engine's process |
| Acceptance runner | Runs the checklist against the running app | Separate container. Sees the acceptance store and the running app only. Never sees the engine's conversation or workspace |
| Acceptance store | Holds each project's acceptance tests outside the project's working copy and git history | Owned by the builder. Written by the acceptance writer, read by the runner and the exporter. Never mounted in the engine's container |
| Preview proxy | Lets the user open the running app | Read-only path to the app container |
| Project store and event log | Projects, briefs, plans, steps, checks, usage. Append-only events | PostgreSQL. Events are never updated or deleted |
| Exporter | Hands over the app as a repository that runs alone | Produces a git repository and, at that moment, copies the acceptance tests in from the acceptance store |

### 2.2 The four requirements of the control layer

From handover section 8.2. They are design constraints, checked in the walking skeleton:

1. Instructions reach the engine only through the optimiser, from an approved plan step. There is no other entry point.
2. A build pauses after every step for the user's approval. The engine is invoked once per step, with that step's instruction, and never with "build the whole app".
3. The quality rules that apply to a step type are attached to the step's instruction, and the quality gate checks them after the step.
4. Every model call passes through the gateway. The engine's container can reach the model only through the gateway's address.

### 2.3 Decision A: how an app gets built

**Position: agree with (b), template plus guided generation, with one change of order.**

The handover proposes: build the template first, then define the structured app description, then let the agent build on the template, then move patterns to deterministic generators when the test protocol shows the agent is unreliable or costly on them.

I would define the **app spec** first, before the template. The app spec is the machine-readable form of the brief's seven sections: roles, data entities and fields, screens, actions (trigger, steps, result), rules, and acceptance items. Every other part reads or writes it: the analyst writes it, the optimiser derives instructions from it, the acceptance runner derives checks from it, the quality gate knows which checks apply from it, and the event log links everything to it. If the template is built first, its shape dictates the spec. If the spec is built first, the template is built to satisfy it, which is the right way round. The spec also gives the test protocol a precise record of what each example asked for. This is a change of order, not of substance.

The alternatives, as weighed:

- **(a) Free generation.** This is the open-ended builder with a better prompt. It would get a demo running fastest and it is exactly the thing the product exists to replace. The test protocol's "raw" run is this approach, kept as the control group. Rejected as the product.
- **(c) Fixed runtime.** Most control, but the customer no longer gets an ordinary codebase (principle 5), and every pattern outside the runtime is impossible rather than merely harder. Rejected. One idea from it is kept: the deterministic generators in (b) are a small fixed runtime for the patterns that recur, with the output written out as code the customer owns.

Where I would start the deterministic generators earlier than the handover says: the **data step**. Creating tables, migrations, the who-and-when stamps (rule 4) and the role checks on each table (rule 5) is mechanical, and a generator makes rules 4 and 5 true by construction. The handover says to wait for the protocol's evidence. I propose a compromise: the walking skeleton lets the agent do the data step, so the protocol measures it, and the generator for the data step is the first thing built if the skeleton shows the agent fumbling migrations or stamps. Record the result either way.

### 2.4 Decision B: the build engine

**Position: agree. Start with the Claude Agent SDK behind an interface of our own.**

Verified today (sources in `docs/SOURCES.md`):

- The SDK provides Claude Code's tools, agent loop and context management, in TypeScript and Python, with hooks, subagents, permissions and sessions.
- Its use in products for our own customers is governed by Anthropic's Commercial Terms of Service. The TypeScript package's licence field points at those terms. This is a commercial licence, not a permissive open-source one. **Hard rule 2 therefore needs the owner's written exception** (section 9, question 2).
- Authentication is by API key. Offering claude.ai sign-in is not allowed without prior approval. We will not offer it.
- Branding: the permitted forms are "Claude Agent", "Claude" inside a menu labelled "Agents", and "{our name} Powered by Claude". "Claude Code" is not permitted. The handover's "Powered by Claude" should be read as the full form with our name in front.
- Permissions: modes include `default` and `dontAsk`; tools can be allow-listed and deny-listed; a bare tool name in the deny list removes the tool entirely; `Edit(path)` deny rules protect paths; a `PreToolUse` hook can deny a call in every mode. The documentation's own recommendation for a locked-down agent is an allow list with `dontAsk`. That is what we will use.
- Each session is one subprocess owning a shell, a working directory and its transcript on local disk. No overall timeout; a turn limit must be set. Starting resources are 1 GiB memory, 5 GiB disk and 1 CPU per agent, and the memory figure is "a floor, not the ceiling".
- The key can stay outside the container by pointing `ANTHROPIC_BASE_URL` at a proxy that injects it. Our gateway is that proxy.

How it is used here:

- One SDK call per approved plan step, in the project's engine container, with the optimiser's instruction as the prompt and a turn limit.
- Permission mode `dontAsk`. Allowed tools: read, edit, write, glob, grep, and shell commands limited to the project's package manager, test runner and formatter. Denied: web search, web fetch, and any edit under the protected paths (the sign-in and role code, the quality-rule machinery). Code the engine must read but never change is mounted read-only, so the operating system enforces what the permission rules state.
- **The acceptance tests are not in the engine's container at all.** A read-only mount would still let the engine read them, and an engine that has read the tests can build to the tests rather than to the brief. So they are not mounted, not in the workspace, and not in the project's git history (2.7). The engine container also has no network path to the acceptance store: its only route out is the egress proxy, whose allow-list names the gateway and the package registry.
- Hooks: a `PreToolUse` hook that writes every tool call to the event log and denies anything touching a protected path; a `Stop` hook that records the session's usage.
- `ANTHROPIC_BASE_URL` points at the gateway. The container holds no key. Before each call the gateway places a worst-case hold against the project's budget and refuses the call if there is no room; after the call it settles the hold to the actual cost (5.5). Before a step starts, the orchestrator asks the gateway whether the step's budget fits; a step does not start without room to finish.
- Settings loading is switched off and the configuration directory is per project, as the hosting guide says for isolation between tenants. Stage 1 has one tenant, but the habit is free now and costly later.

Alternatives weighed:

| Alternative | For | Against | Verdict |
| --- | --- | --- | --- |
| Our own loop on the Claude API with tool use (the SDK's tool runner) | Full control of every tool; easier to point at another model provider later; no commercial-licence question | We rebuild file tools, shell handling, context management and permission logic that the Agent SDK already has and that Anthropic maintains. More code for one reviewer to read | Keep as the fallback behind the interface. Not first |
| Anthropic Managed Agents | Anthropic runs the loop; tools can run in a self-hosted sandbox on our infrastructure | Sessions store conversation history, sandbox state and outputs on Anthropic's side (verified). A product that must later run entirely inside a customer's cloud cannot have its agent loop and session state outside it. Not eligible for zero data retention | Not for this product's Stage 3 direction. Could serve a hosted Stage 2 variant; revisit then |
| Start from an open-source builder | Code exists | Dyad is Apache-2.0 outside `src/pro` but is a local app for one person's machine, not a server. bolt.diy depends on a component with a separate commercial licence (secondary source). Either would also mean building our control layer on someone else's architecture | Rejected |

The engine is specific to Claude. The interface around it has four operations: start a step, stream progress, stop, report usage. Anything behind that can be replaced without touching the orchestrator, optimiser or acceptance runner.

**Default model.** Measure two in the walking skeleton: Claude Opus 5.5 and Claude Sonnet 5.5, prices in section 5. Choose on acceptance score and cost. Before that measurement, no default is set.

### 2.5 Decision C: isolation

**Position: agree. Both the engine and the generated app run only in containers, never on the host.**

Stage 1 design, Docker on one machine:

- One Docker Compose project per builder project, on its own **internal** Docker network (no route out). Up to five containers: the app, its PostgreSQL database, the engine (present only while a step is being built), the acceptance runner (present only while checks run), and the **egress proxy**, which is attached to the project network and to the outside and is the only way out. The builder itself is one more container per server, not per project.
- **What each container can see on disk.** The engine: the project's workspace (read-write) and the protected code it must read (read-only). The app: its own image. The acceptance runner: the project's acceptance tests from the builder's acceptance store (read-only) and nothing of the workspace. The engine and the runner never share a mount, so there is no path by which the engine can read a test.
- The egress proxy allows exactly two destinations: the model gateway and the package registry for the chosen stack. Everything else is refused and logged. This replaces the secure-deployment guide's `--network none` plus Unix socket, which is the stronger pattern; the difference is recorded as gap 14 in `docs/KNOWN-GAPS.md` and the sandbox manager's interface allows the stronger pattern later.
- Engine and app containers run as a non-root user with `--cap-drop ALL`, `--security-opt no-new-privileges`, a memory limit, a process limit, and a read-only root filesystem with a writable workspace mount. **Measured:** all of these flags, including the read-only root, work on the development machine.
- The engine's workspace is the project's git checkout. Protected code is a separate read-only mount. The acceptance store lives outside every workspace, in the builder's own data directory, one folder per project, owned by the builder's user and never committed to the project's repository.
- The user's text and uploaded spreadsheet are untrusted input. They enter the engine only as files in the workspace and as quoted text inside the optimiser's instruction template, never as instructions in their own right.

**Development finding that changes the picture (measured on 11 November 2026; corrected by measurement on 12 November 2026, package 0.6a, `evidence/2026-11-12-package-0.6a/isolation-checks.md`; the sentences as first written, and each change, are in the dated list at the end of this section).** In a cloud development session the machine has a proxy on its own loopback address, the cloud session's proxy, and a container on Docker's default network ("bridge") cannot reach it: on 12 November a connection to it at the machine's address on that network was refused (attempt G45887; the only address of the machine tried). That proxy is not the machine's only way out: requests sent with no proxy at all got answers (A1 in the tools container, A2, A5). A container on Docker's default network was not cut off from the internet either: with no proxy setting and no certificate it got answers on port 80 (A2, A5) and to name lookups (D1, D5), and its HTTPS request to the registry got a certificate it did not trust (A1). Which part of the cloud network answers or refuses such requests directly is inferred, not shown. The arrangement used in development, read from the sandbox manager's Compose settings and the template's Dockerfile, and seen in the 0.6a run for the app and tools containers: every project container except the engine shares the host's network, and the engine container has none. The app image's build runs on the host's network, is given the cloud session's proxy as build arguments, and has the proxy's certificate copied into its build stage; the tools image is that stage, so it holds a copy of the certificate. The egress proxy container is given the cloud session's proxy as its way out and has the certificate mounted. The app and tools containers are given no proxy setting, and the app container holds no copy of the certificate (none at the two places the probe looks, `run-live.txt`, the two containers' lines on settings and on the certificate; the Dockerfile's `run` stage copies none, read from the file). On 11 November a test container on the host's network, given the proxy address and the certificate mounted, was the one arrangement of those tried that reached the registry over HTTPS with a certificate it trusted (`docs/ENVIRONMENT-CHECK.md`); on 12 November the tools container, on the host's network with a copy of the certificate and no proxy setting, also got HTTP 200 from the registry over HTTPS sent directly (A1), while the app container, with neither, got a certificate it did not trust (A1). Whether the project's containers could work off the host's network was not tried (known gap 60). That means **in development the project containers other than the engine are not network-isolated from the host.** Measured on 12 November: from the app and tools containers a connection opened to every service listening on the machine, the builder's own database and the cloud session's proxy among them; three of those services listen on every address of the machine and were also reached from Docker's default network; and the project's egress proxy can be gone round on this profile. It was judged acceptable with made-up data and no key in the container; known gap 60 asks an engineer to judge, before package 2.3's first live run, whether it stays acceptable once a model writes the app's code. It is recorded as gaps 1, 2 and 60 in `docs/KNOWN-GAPS.md`. On a demo server there is no such proxy, and the egress-proxy design above applies as written (designed, not shown: package 0.6b). The sandbox manager must therefore have two profiles, `development-cloud-session` and `server`, and the design note of each milestone says which one its evidence was produced under.

Later stages: the secure-deployment guide compares containers, gVisor and virtual machines, and says virtual machines are not automatically more secure than gVisor. E2B is Apache-2.0 and self-hostable on a single Linux host with KVM, or on GCP, AWS and Azure (verified). The sandbox manager's interface is: create project sandbox, start service, run command, mount path, destroy. Plain Docker, gVisor's runtime, or E2B can sit behind it.

*Corrections to this section by measurement, 12 November 2026* (package 0.6a, tested as of `6295445`; `evidence/2026-11-12-package-0.6a/isolation-checks.md`, section "Sentences elsewhere that this run contradicts"). Made by Claude Code in the record update after pull request #22, as corrections of measured facts; the design itself (the two profiles) is not changed, and a change to the development profile would be the owner's (known gap 60).

| Date | Change | Why | Standing |
| --- | --- | --- | --- |
| 12 Nov 2026 | "In a cloud development session, the machine reaches the internet only through a proxy on its own loopback address" (as written on 11 Nov) replaced: the cloud session's proxy is not the machine's only way out | Requests sent from containers with no proxy at all got answers (A1 in the tools container, A2, A5) | Correction of a measured fact |
| 12 Nov 2026 | "A container on Docker's default network has no internet at all" (as written on 11 Nov) replaced | The comparison container of package 0.6a, on that network with no proxy setting and no certificate, got answers on port 80 (A2, A5) and to name lookups (D1, D5); a connection to 1.1.1.1 on port 443 opened (B1); its HTTPS request to the registry got a certificate it did not trust (A1) | Correction of a measured fact |
| 12 Nov 2026 | "the proxy cannot be reached from a bridge network" kept, with the measurement of 12 Nov | A connection to the session's proxy at the machine's address on Docker's default network was refused (G45887), the only address of the machine tried | Agrees with the run |
| 12 Nov 2026 | "The only working arrangement is: the container shares the host's network, receives the proxy address, and has the proxy's certificate mounted" (as written on 11 Nov) replaced by what each part of the development profile is given (every project container except the engine on the host's network; the session proxy for the image build and the egress proxy container; the certificate copied into the build stage, so into the tools image, and mounted in the egress proxy container; no proxy setting in the app and tools containers, and no certificate in the app container (none at the two places the 0.6a probe looked; the Dockerfile's `run` stage copies none)), what was measured on 11 and 12 Nov, and that working off the host's network was not tried | The sandbox manager's Compose settings and the Dockerfile (read); the app and tools containers' lines in `run-live.txt` (seen); package 0.6a did not try a project profile off the host's network | Correction of a measured fact (what each part is given); off the host's network not tested, the question is in known gap 60 |
| 12 Nov 2026 | What "not network-isolated" means, as measured; gap 60 added to the gaps named; "It is acceptable" (as written on 11 Nov) now reads "It was judged acceptable", with gap 60's question for an engineer before package 2.3; the server profile marked designed, not shown | Package 0.6a's results (`evidence/2026-11-12-package-0.6a/isolation-checks.md`, "What is not isolated on the development profile") | Record of measurement; the judgement is unchanged and gap 60's question is open |
| 12 Nov 2026 | Section 4.1, "Network policy", quotes its sentence of 11 Nov and says which project containers use the host's network and which parts get the session proxy and the certificate; section 6.2's row on network isolation says the host's network is used by every project container except the engine ("required" now reads "used"); both point here for what was measured, and say that working without the host's network was not tried | They rested on the 11 Nov reason | Pointers and corrected wording |

### 2.6 Decision D: the house stack for generated apps

**Position: agree not to assume. Shortlist two, build the skeleton on each, choose on measurement.**

| | Candidate T: TypeScript full-stack | Candidate P: batteries-included server framework |
| --- | --- | --- |
| Framework | Next.js 16 (MIT) | Django 5.2 LTS (BSD-3-Clause) |
| Database access | Drizzle ORM (Apache-2.0) | Django ORM and migrations, built in |
| Sign-in and roles | better-auth (MIT). Auth.js's own repository now recommends new projects start with Better Auth (verified) | Django auth and permissions, built in; django-allauth (MIT) for the email flow |
| Forms and validation | Zod (MIT) | Django forms, built in |
| Translation and right-to-left | next-intl (MIT); CSS logical properties | Django i18n, built in, with `LANGUAGES_BIDI` for right-to-left languages (verified) |
| Interface | Tailwind CSS (MIT), shadcn/ui (MIT) | Django templates with htmx (Zero-Clause BSD) and Tailwind |
| Tests and acceptance | Playwright (Apache-2.0), Vitest (MIT) | Playwright, pytest (MIT) |
| Mail catcher | Mailpit (MIT) | Mailpit |
| Licence check | license-checker-rseidelsohn (BSD-3-Clause) | pip-licenses (MIT) |
| Database | PostgreSQL 16 in both (the current major is 18; 16 is what the development machine has, and the version is pinned either way) | |

All licences above were verified today against each project's own repository or package index (`docs/SOURCES.md`). Every one listed here is permissive; the packages they bring with them were not checked at the time, and some are not (see the licence row in the table below, and known gaps 32 and 40). htmx's "Zero-Clause BSD" is a BSD-family licence and permissive; I list it so the owner sees it.

How the criteria fall, before measurement:

| Criterion | Leans to |
| --- | --- |
| Quality rules true by construction | P. Django's documentation states a built-in authentication system with users, groups and permissions, form and field validation, and migrations (verified). Who-and-when stamps are a convention in both. In Next.js each is a library or a convention the template must impose |
| Acceptance score and model cost on example 1 | Unknown until measured. Models write both well; Next.js has the larger body of recent code |
| Standard PostgreSQL, containers | Both |
| Permissive licences only | Neither, as found so far: the Django candidate needs `psycopg` (LGPL-3.0); the TypeScript template ships `caniuse-lite` (CC-BY-4.0, approved by the owner on 12 Nov 2026, on the reading of his "a0 approved" as option (a), which he has not yet confirmed; `docs/STATUS.md`) and carried LGPL packages through `sharp` (found 12 Nov 2026, known gap 40), which package R1 removes |
| Maintained and widely used; engineers hireable | Both. Django is older and changes less; Next.js changes more |
| Translation and right-to-left | P built in; T needs next-intl and care with layout |
| One language across builder and apps | T if the builder is TypeScript. The Agent SDK exists in both languages, so the builder could be Python and match P |
| Phone-screen use (rule 10) | Both, with Tailwind |

My prior is that **P wins "true by construction" and T wins "the model writes it fluently"**, and that the measurement will be closer than either side expects. I do not recommend either before the skeleton. I do recommend that the **builder's own language follow the winner**, so that one reviewer can cover both.

Ruby on Rails (MIT) was considered as the batteries-included candidate and set aside: it would add a third language to the project with no advantage over Django on the criteria. React Router v8 (MIT) was considered against Next.js and set aside for the same reason the handover gives: breadth of use, so the model writes it reliably.

### 2.7 Decision E: independent acceptance

**Position: agree, and make the separation physical.**

- The acceptance checklist is written by the analyst from the confirmed brief, before any code exists, as numbered items in the app spec: what the user does, what they should see.
- Each item becomes a Playwright test. The tests are **generated by a separate model call through the gateway**, from the checklist and the app spec only, by the acceptance writer, a builder process. That call never sees the engine's conversation.
- **Where the tests live.** The acceptance writer writes them straight into the builder's **acceptance store**: a directory outside every project workspace, one folder per project, owned by the builder. They are never placed in the project's working copy and never committed to the project's git history while the project is being built. The engine's container has no mount of the store and no network route to it. Read-only mounts are kept for code the engine must read; they are not used for the tests, because read-only does not prevent reading, and an engine that has read the tests can build to the tests instead of to the brief.
- The acceptance runner is a separate container with two things in view: the running app, over the project network, and the project's folder in the acceptance store, mounted read-only. It has no mount of the workspace. It records a screenshot per item and Playwright's trace, and writes pass or fail per item to the event log. A check is reported as passed only when it ran and passed; a check that did not run is reported as "did not run", never as passed.
- If a check is wrong, the fix goes back through the analyst as a change to the brief, which regenerates the checklist and the tests in the store. Nobody edits a test by hand. The store keeps every version, so the record shows which tests each acceptance run used.
- **The tests join the app at export.** The exporter copies the project's folder from the store into `acceptance/` in the exported repository and commits it there, so the customer receives and can run the same checks. The export commit is the first time the tests appear in any git history.
- The user's own sign-off is recorded as an event and is the final approval. Automated checks make it quick; they do not replace it.

*Amendment, 13 November 2026, by the owner's answer to question 12, option (a) (`docs/DECISIONS.md`):* until the acceptance writer exists, tests written in advance by Claude Code may be used **only to develop and test the acceptance runner** (package 3.1). Each is labelled "stand-in test" wherever it appears. They show that the tests are kept apart from the engine. They are not independent acceptance. The acceptance check at the skeleton report (package 3.3, checkpoint 2) is written by the acceptance writer through a real model call (package 3.2b), not by the engine or by Claude Code, and nobody edits it by hand.

### 2.8 Decision F: staying adaptable

**Position: agree with the two seams, the profiles and certification by the protocol. The second engine is decided: OpenAI's Codex SDK (owner, 11 November 2026). Two cautions follow.**

The handover separates two things that are often confused: the **model source** (who serves a model: Anthropic directly, a router, or a cloud inside the UAE) and the **build engine** (the agent that writes code). A router alone does not make the builder adaptable, because the Claude Agent SDK can only drive Claude models (the handover records Anthropic's statement that routing Claude Code to non-Claude models through a gateway is not supported; today's check of that page is in `docs/SOURCES.md`).

How the design already carries the two seams:

| Seam | Where it is in this note | What Decision F adds |
| --- | --- | --- |
| Model gateway | Section 2.1 and 2.4. The only route to the model; meters usage; the engine's container reaches it via `ANTHROPIC_BASE_URL` | It must also speak the OpenAI-compatible format, because the analyst, optimiser and acceptance writer are plain model calls that could go to any provider, and because a second engine would speak that format. One gateway, two dialects, one meter |
| Build engine interface | Section 2.4: start a step, stream progress, stop, report usage | Named explicitly as the second seam: one step's instruction and a workspace in; changes, events and usage out. Any engine adapter implements exactly that |

**Profiles.** A profile is a named bundle: one engine adapter, one model per role (analyst, optimiser, acceptance writer, engine), and the endpoints each may reach. The gateway enforces the endpoints; the event log records the profile on every project; the test protocol's results are stored per profile. Stage 1 has one profile, `standard`. A `uae-only` profile is defined as a shape with no contents until a model and endpoint that process inside the country are verified, which today they are not (section 2.9, point 3).

**Which second engine for the gate: decided.** The handover named two candidates: OpenAI's Codex SDK, and a loop of our own for open models. **The owner chose the Codex SDK on 11 November 2026** (`docs/DECISIONS.md`). What that means in the design:

- The second engine adapter wraps `@openai/codex-sdk` (Apache-2.0, verified), which "wraps the codex CLI" and "spawns the CLI and exchanges JSONL events over stdin/stdout" (verified). The adapter implements the same four operations as the Claude adapter: start a step, stream progress, stop, report usage.
- It needs an OpenAI account, key and spend line. Under hard rule 4 the price and its source are shown to the owner before any sign-up, when milestone 7b comes. OpenAI's API terms are read then and recorded.
- The gateway's second dialect (the OpenAI-compatible format) is what the Codex engine speaks, so the gateway meters and caps it exactly as it does the Claude engine. The Codex container holds a project token, never a key.
- **What it does not answer:** whether the builder can run on a model that processes inside the UAE. The Codex SDK drives OpenAI's models. That question stays open as gap 33 in `docs/KNOWN-GAPS.md`, and the `uae-only` profile stays an empty shape until a model, endpoint and engine that process in the country are verified.

**History: the original recommendation.** Before the owner decided, this note recommended a small loop of our own against an OpenAI-compatible endpoint, kept deliberately small and labelled with its measured score, because that is the engine a `uae-only` profile would need, it has no vendor licence question, and it can be pointed at any provider that speaks the format. Against it: more code to write and review, and a weaker result than a mature agent. The owner weighed a quicker, stronger proof of the seam above the in-country question for this gate, which is his call to make. The loop of our own remains the candidate for the `uae-only` profile when that work starts.

| Option | For | Against | Outcome |
| --- | --- | --- | --- |
| A loop of our own against an OpenAI-compatible endpoint | What a `uae-only` profile needs; no vendor licence question; any provider that speaks the format | More code; weaker than a mature agent | Recommended originally; not chosen for the gate; kept for the `uae-only` profile |
| **OpenAI's Codex SDK** | Same shape as the Claude Agent SDK; mature agent; thin adapter; Apache-2.0 | Second provider account and spend; does not answer the in-country question | **Chosen by the owner** |

**Two cautions.**

1. Engine-neutral assets cost discipline, not code. The analyst, question bank, template, generators, quality gate and acceptance checks must never carry an instruction phrased for one model. The optimiser's rule slots (B4) are the one place engine-specific phrasing is allowed, and they are stored per profile. This is checked in review, not by a tool.
2. The handover's point that "the more the template and generators do, the less the result depends on the strength of the model" strengthens the proposal in section 2.3 to move the data step to a deterministic generator early. A weaker in-country model is exactly the case where a generator pays.

Gate item 9 (two test examples built with the Codex SDK, difference reported) becomes milestone 7b in section 8.

### 2.9 Where I disagree with the handover

1. **Branding wording** (section 8.4 and 16). "Powered by Claude" alone is not among the permitted forms; "{our name} Powered by Claude" is. Minor, but the handover's statement should not be repeated as written.
2. **Licence of the build engine.** The handover records the Commercial Terms as a verified fact but does not connect it to hard rule 2. The SDK is not permissively licensed, and the rule needs a written exception. I have put it in `docs/OPEN-DECISIONS.md` and in this note's section 9.
3. **Processing inside the UAE** (sections 3, 8.4, 15). The handover treats this as a Stage 3 question. The evidence today is worse than "open": Anthropic's own data-residency options are US or global (verified), and AWS's Bedrock region table lists the UAE region for Claude Sonnet 5.5 and Claude Opus 5.5 only under "Global" cross-region inference, which AWS describes as for use "when you have no data residency constraints" (verified from the page). Core42's release notes name Claude Sonnet 4 as a preview for select customers without saying where it runs (verified). If regulated buyers are in the pitch, the pitch must say that the app and its data can stay in the country and that the model calls, today, cannot be shown to. This affects what the demo claims, which is a Stage 1 matter.
4. **Order of app spec and template** (2.3). Spec first.
5. **"Not verified" items in section 16.** One is now answered by measurement: containers started inside a cloud session can reach the model API and the package registry, with the host-network workaround and the proxy's certificate. One is being tested at the end of this session: whether a page served inside the session can be opened by the owner.
6. **Decision F's sources.** The four facts added for Decision F are dated 11 November 2026 in the handover. I could re-check only those on reachable hosts (see `docs/SOURCES.md`); the Core42 and OpenRouter hosts are blocked from this session. Where a fact could not be re-read it is carried as the owner's verification, not mine.
7. **Where the walking skeleton starts.** The handover's milestone table puts "record, cost and export" seventh. Principle 6 says capture data from the first day, and principle 7 says cost is visible and capped. I pull the event log and the gateway's meter into the skeleton, and leave only the export's polish for later.

---

## 3. Verification

Every tool this note plans to rely on, with what its documentation confirms, the date checked, and its licence. Details and quotations are in `docs/SOURCES.md`.

| Tool | Documentation | What it confirms | Checked | Licence |
| --- | --- | --- | --- | --- |
| Claude Agent SDK (TypeScript 0.3.322, Python 0.2.180) | Overview, Hosting, Secure deployment, Permissions pages on code.claude.com | Agent loop and tools of Claude Code; API-key auth; branding forms; one subprocess per session; no session timeout; `ANTHROPIC_BASE_URL` proxy for the key; `dontAsk` mode with allow and deny lists; `PreToolUse` hooks deny in every mode; hardened Docker flags | 11 Nov 2026 | Anthropic Commercial Terms of Service (TypeScript package); PyPI metadata says MIT for the Python package, with the same terms stated in the documentation. **Not permissive; exception needed** |
| Claude models and prices | platform.claude.com pricing page | Opus 5.5 $4 in, $20 out, $0.20 cache hit per million tokens; Sonnet 5.5 $2, $10, $0.10; Haiku 5.5 $0.10, $0.50, $0.01 up to 100k-token prompts; batch half price | 11 Nov 2026 | Commercial service |
| Plan API credits | support.claude.com articles 15036540 and 17154008 | Max $100 and Ultra $200 per month; Team $20 or $100 per seat pooled; covers the API and the Agent SDK with a key from the linked Console organization; no rollover | 11 Nov 2026 | n/a |
| Cloud development sessions | Cloud environments, Cloud sessions pages | Ubuntu 24.04; Docker, Compose, PostgreSQL 16, Node 20 to 22, Python; approximate 4 vCPU, 16 GB, 30 GB; limited network with package managers allowed; env vars readable by environment users; pauses when idle; command time limits | 11 Nov 2026; resources also measured | n/a |
| Docker 29.9.2, Compose v5.6.1 | Measured on the machine | Containers run; Compose runs PostgreSQL 16; hardened flags work | 11 Nov 2026 | Apache-2.0 (assumption; not re-checked today) |
| PostgreSQL 16 | postgresql.org licence and versioning pages | 16.15 is the current 16 release, supported until 9 November 2028; 18.6 is the current 18 release; 19 is at release candidate | 11 Nov 2026 | PostgreSQL Licence, "a liberal Open Source license, similar to the BSD or MIT licenses" (verified) |
| Playwright 1.65.0 (1.63.0 installed on the development machine, with Chromium; measured) | Repository | Browser automation for acceptance checks | 11 Nov 2026 | Apache-2.0 |
| pytest 9.2.0 | PyPI | Test runner for candidate P | 11 Nov 2026 | MIT |
| Next.js 16.4.6, Drizzle 0.45.4, better-auth 1.7.20, next-intl 4.14.10, Tailwind 4.3.5, shadcn/ui, Zod 4.6.7, Vitest 5.1.0 | Each repository | Current versions and licences | 11 Nov 2026 | MIT, Apache-2.0 (Drizzle), MIT, MIT, MIT, MIT, MIT, MIT |
| Django 5.2.19 LTS, django-allauth 65.21.1, htmx 4.0.1 | PyPI, repositories, and docs.djangoproject.com | Current versions and licences. Django's documentation confirms built-in authentication with groups and permissions, form validation, migrations, and right-to-left language support | 11 Nov 2026 | BSD-3-Clause, MIT, Zero-Clause BSD |
| Mailpit 1.33.1 | Repository | Local mail catcher for notification evidence | 11 Nov 2026 | MIT |
| license-checker-rseidelsohn 5.0.1, pip-licenses 5.5.5 | Package registries | Automated licence reports for both stacks | 11 Nov 2026 | BSD-3-Clause, MIT |
| E2B, gVisor | Repositories | Later-stage isolation options; self-hostable; Apache-2.0 | 11 Nov 2026 | Apache-2.0 |
| Decision F sources: LLM gateway page, OpenRouter, Core42 Compass documentation, OpenAI Codex SDK | code.claude.com, openrouter.ai, core42.ai, github.com/openai/codex | All four re-read today: no non-Claude routing through gateways; OpenRouter EU and US only; Compass is OpenAI-compatible with some models in the UAE and some in the US, and names Claude Sonnet 4 as a preview for select customers; the Codex SDK "wraps the codex CLI" and "spawns the CLI and exchanges JSONL events over stdin/stdout" | 11 Nov 2026 | Codex SDK package `@openai/codex-sdk`: Apache-2.0 (package metadata and repository). OpenAI's API terms not yet read |
| Managed Agents | platform.claude.com overview and data-residency pages | Hosted loop; self-hosted sandbox option; session state stored by Anthropic; inference geography US or global only | 11 Nov 2026 | Commercial service |

Not verified today and needed before the relevant step: Docker's licence (not re-checked), OpenAI's API terms (before the second-engine milestone), the WebContainer terms (not needed, bolt.diy rejected).

---

## 4. Environments

### 4.1 Development

The Claude Code cloud session. Measured on 11 November 2026 (`docs/ENVIRONMENT-CHECK.md`): 4 processors, 15 GiB memory, 30 GB writable disk, Docker and Compose working after starting the daemon, Node 22, Python 3.13, PostgreSQL 16 client and server.

Three limits shape the work:

- **Idle pause and reclaim.** Running processes do not survive. Nothing is hosted here. Every milestone produces screenshots and recordings from an automated run, committed in the pull request.
- **Command time limits.** Foreground commands wait two minutes by default and up to ten on request; background work up to thirty more. The test harness runs one build per invocation and writes results to the repository as it goes, so a cut-off loses one build, not a run.
- **Network policy.** Package registries, GitHub, Anthropic and the Claude documentation sites are reachable, and since the owner's approval on 11 November so are the nineteen research sites listed in `docs/OPEN-DECISIONS.md`. As written on 11 November: "Containers need the host network and the proxy's certificate" (section 2.5). Corrected there by measurement on 12 November: on the development profile every project container except the engine uses the host's network; of those, only the egress proxy container is given the session proxy and has its certificate mounted, the tools image holds a copy of the certificate from the build stage, and the app container holds none (none at the two places the 0.6a probe looked; the Dockerfile's `run` stage copies none); whether the project's containers could work without the host's network was not tried (known gap 60).

The repository is the only memory between sessions. `docs/STATUS.md` is updated at the end of every session.

### 4.2 Test

The same machine, with the test harness. The harness takes an example number and a run type (raw, brief, tuned), drives the analyst with the example's answer sheet, runs the build, runs the acceptance checks, and writes one row of the protocol's table plus the evidence files to `evidence/` in the repository. It is resumable: a run that is cut off is re-run from its last completed step.

GitHub Actions can run the harness's quick checks on every pull request (lint, unit tests, licence check). Whether it can run full builds depends on minutes and on the model key, which should not be in a shared CI secret in Stage 1. Full protocol runs stay on the development machine until the demo server exists. **Assumption:** the repository's Actions minute allowance was not checked today.

### 4.3 Demo

One small server with Docker, a web address, and a login in front of the builder. The owner opens it in a browser. Requirement: about 4 processors, 8 GB memory, 80 GB disk, Linux. Rationale: the hosting guide's floor is 1 GiB per agent; one project at a time needs the builder, one engine, one app, one database, one acceptance runner, and the egress proxy. 8 GB leaves room for two projects at once.

**Prices, read from the providers' own pages on 11 November 2026**, once the owner had allowed those sites on the development machine's network. Where a provider's price table is drawn by a script in the browser and not present in the page itself, this session could not read it, and the row says so rather than carrying a number from elsewhere. **The owner has not yet chosen a demo server**; the choice is open as item 5 in `docs/OPEN-DECISIONS.md`, and nothing is created until he names an option and its price.

| Option | Location | Price from the provider's page | Notes |
| --- | --- | --- | --- |
| **Hetzner CPX32**: 4 AMD vCPU, 8 GB, 160 GB NVMe | Germany (Falkenstein, Nuremberg), Finland (Helsinki), USA (Hillsboro, Ashburn), Singapore. **No UAE location** (verified) | **€30.49 per month excl. VAT**, €0.0489 per hour. "Your server's bill will never exceed its monthly price cap" | Verified. The cheaper CX33 (4 vCPU, 8 GB, 80 GB) is €8.99 per month but shown as "currently not available" |
| **DigitalOcean Basic Droplet**: 4 vCPU, 8 GiB, 160 GiB SSD | Regions named on the page include Amsterdam, Atlanta, Bangalore, Frankfurt, London, Singapore, Sydney, Toronto. No UAE | **$48.00 per month**, $0.07143 per hour | Verified |
| **Oracle Cloud VM.Standard.E4.Flex**: 2 OCPU (4 vCPU), 8 GB | **Dubai and Abu Dhabi regions confirmed** on Oracle's own region page (verified) | Not readable: Oracle's compute price table is drawn by a script and the page refuses this session's requests. A search snippet earlier gave $0.032765 per OCPU-hour and $0.0019659 per GB-hour, about $59 per month at those rates; **unverified** | The one option with a UAE region whose rate was seen anywhere. The owner can read the price in a browser at oracle.com/ae/cloud/compute/pricing |
| **AWS EC2 t3.large or t4g.large** | **Middle East (UAE), me-central-1, confirmed** on AWS's region page (verified) | Not readable: the on-demand price table is drawn by a script | The owner can read it in a browser with the UAE region selected |
| **Azure B2ms** | **UAE North and UAE Central confirmed** on Azure's geographies page (verified) | Not readable: the price table is drawn by a script | Same |
| UAE-based providers (Core42, Khazna, Moro Hub) | UAE | Core42 publishes no public price for a small machine (verified). Khazna's and Moro's sites did not answer this session | Enterprise pricing on request |
| Hosted sandbox service (E2B cloud or similar) | Varies | Not checked | Stage 1 alternative only, behind the sandbox manager's interface. Would not give the owner a web address for the builder itself |

**Recommendation.** For the Stage 1 demo environment, which holds the builder and made-up data only: **Hetzner CPX32 at €30.49 per month excl. VAT**, hourly billed, because its price is verified from the provider's page and it is the lowest. Its servers are in Europe, the USA and Singapore, not the UAE. If the owner wants to say during the demo that the demo server itself is in the UAE, Oracle's Dubai region or AWS's UAE region are confirmed to exist, and the owner reads the price in a browser before approving it. Prices change; whichever option is chosen, its price is read again from the provider's page on the day of approval and recorded in `docs/SOURCES.md` with that date. Nothing is created until the owner says yes to a named option and its price (hard rule 4).

The model key lives on the demo server as an environment variable read only by the gateway process, which runs outside every project container.

---

## 5. Cost

### 5.1 What drives the cost of a build

The handover's hosting source says model usage typically costs ten times the containers or more (verified). So the cost of a build is the cost of its model calls, and that is driven by:

| Driver | What it depends on | Who controls it |
| --- | --- | --- |
| Tokens read per engine step | The size of the template the engine reads, the instruction, and the tool results it pulls in. The template is the same every time, so its reading should hit the prompt cache after the first step | Template design; the optimiser's instruction template; cache use |
| Tokens written per engine step | The code the engine writes and its own working text | Step size; the model |
| Number of steps | The plan. Data, then screens, then actions, then rules; a leave-request app is perhaps eight to fifteen steps | The analyst's plan |
| Retries | One retry is allowed per step. A retry doubles that step's cost | The optimiser's rules, once the protocol fills them |
| Analyst turns | Intake is short text with closed choices; cheap compared with code generation | Question bank design |
| Acceptance generation | One call per project to turn the checklist into tests; one more after each change request | Checklist length |
| Model choice | Opus 5.5 is twice the price of Sonnet 5.5 per token | Measured in the skeleton |

### 5.2 Prices, verified today

USD per million tokens, from Anthropic's pricing page on 11 November 2026:

| Model | Input | Cache write, 5 minutes | Cache write, 1 hour | Cache hit | Output |
| --- | --- | --- | --- | --- | --- |
| Claude Opus 5.5 | $4.00 | $5.00 | $8.00 | $0.20 | $20.00 |
| Claude Sonnet 5.5 | $2.00 | $2.50 | $4.00 | $0.10 | $10.00 |
| Claude Haiku 5.5, prompts up to 100,000 tokens | $0.10 | $0.125 | $0.20 | $0.01 | $0.50 |
| Claude Haiku 5.5, prompts over 100,000 tokens (the long-prompt rate) | $0.50 | $0.625 | $1.00 | $0.05 | $2.50 |
| Claude Fable 5.2 (priced in the gateway's table; not planned for use) | $8.00 | $10.00 | $16.00 | $0.20 | $40.00 |

Every figure in this table was read from the pricing page on 11 November 2026 and is recorded in `docs/SOURCES.md`; the gateway's own table (`builder/src/gateway/prices.ts`) carries the same figures.

**The long-prompt rate (verified).** The page says Claude Haiku 5.5 "is priced by prompt length: a request whose prompt is over 100,000 tokens pays higher prices", that the prompt length "counts all of its input tokens, including cache reads and cache writes", and that the other current models have no such rate. The higher prices apply to the output as well as the input.

**Fast mode (verified for two models).** The page's fast-mode table lists Claude Opus 5.5 at $8 input and $40 output and Claude Fable 5.2 at $16 and $80, which is twice the standard rate in each case, and says "prompt caching multipliers apply on top of fast mode pricing", so the cache rates double too. The page lists no fast mode for Claude Sonnet 5.5 or Claude Haiku 5.5. The gateway doubles every rate whenever an answer reports fast mode, for any model; for a model the page does not list, that doubling is an assumption (gap 23).

**The rates the worst-case hold uses** (section 5.5): for the input, the one-hour cache-write rate, the dearest input rate; for both input and output, the long-prompt rate for a model that has one, unless the counted prompt is under the threshold by the margin package 1.2 sets; and the fast-mode factor on both parts wherever the profile allows fast mode.

### 5.3 What is unknown until measured

Everything that matters: tokens per step, steps per app, retry rate, and cache hit rate. Any figure for "cost per app" written today would be invented. To show the shape of the arithmetic, not a prediction: **if** a step read 200,000 tokens with no cache hits and wrote 10,000 tokens on Opus 5.5, it would cost $0.80 plus $0.20, so $1.00, and a twelve-step build with two retries would cost about $14. **If** the template reads hit the cache, the same step's input would cost $0.04 instead of $0.80. The skeleton measures which of these worlds we are in.

### 5.4 How the skeleton measures it

- The gateway records, for every call: project, step, model, input tokens, cache-read tokens, cache-write tokens, output tokens, and the cost computed from a price table checked into the repository with its date.
- The skeleton's report shows the cost of the whole build, per step, and per model, for each candidate stack.
- The test protocol adds a column for cost per run, as B5 requires.

### 5.5 The per-project cap

Each project has a cap in dollars, set when the project is created, with a default the owner chooses (section 9). Summing what has already been spent does not show that the next call fits, so the cap works by **holds**: money set aside before a call and settled afterwards. The budget equation, checked before every call, is:

> spent (settled cost of finished calls) + open holds (calls in flight, and holds kept for calls not yet reconciled) + this call's hold ≤ cap.

*Note of 13 Nov 2026, package 1.2b (built; not yet marked tested):* a project's cap can now also be changed after the project is created, as the owner chose in his answer to question 13 ("a, add the cap change after 1.2"). The change is made by one function in the builder's store, `changeCap` (`builder/src/store/holds.ts`), run by Claude Code or an engineer when the owner asks (`builder/scripts/change-cap.ts`); there is no screen for it. The new cap and a `cap.changed` event are written together, under the same lock on the project's row that every admission takes: the event gives the old and new figures, who asked, who ran it, the reason, the time (the database's clock, read under the lock), and what the project had spent and held at that moment. Who asked and who ran it are written as the caller states them; nothing checks them. The next call is judged against the new cap; holds already open are not touched. **A lowering below what the project has already spent plus its open holds is refused**, with nothing changed or written, and the refusal names the lowest figure allowed at that moment (spent plus open holds, rounded up to the cap's 4 decimals). So the first of the two invariants below still holds as worded. This refusal is Claude Code's default; whether such a lowering should be accepted instead is the owner's question 14. A cap can also still be changed by a hand edit of the database, which leaves no record (known gaps 22 and 64). Proof rows B20 to B22 (7.2); `evidence/2026-11-13-package-1.2b/cap-change.md`. Package 1.3, the step hold, is not built: its design has to say what a cap change does to an open step hold.

In this section, as built in package 1.2, *worst-case*, said of a hold, means the dearest case the hold's inputs allow: the provider's token estimate plus an assumed margin, and `max_tokens` (the most output the request allows), each at the dearest listed rate that applies to that count and that request (the Input, Output and Fast mode rows below). A hold is therefore a reservation, not a proven ceiling on the bill (known gap 41). The owner approved the cap as "worst-case holds" (the Status row at the top of this note); he has not been asked whether that approval means this.

**The hold is meant to be the most this call can cost, worked out from the request and not from history.** The gateway computes it from the request itself before forwarding anything. Review on 12 November found ways a call could still cost more than the hold as written here; they are under "Known limits of the hold" below, with what package 1.2 is to do about each:

| Part of the hold | How it is bounded |
| --- | --- |
| Input | The request's prompt tokens, counted by the provider's token-counting call (assumed to be free: no source in `docs/SOURCES.md` says so; counting calls carry no hold, so if they are billed, that money is outside the cap). **If the prompt cannot be counted, the call is refused**; no estimate from the request's size is used (amendment b). Priced at the dearest input rate that could apply to this model and this prompt: the one-hour cache-write rate, taken at the long-prompt price for a model that has one (for Claude Haiku 5.5 that is $1.00 per million tokens, not $0.20), unless the counted prompt is under the threshold by the margin package 1.2 sets (amendment c) |
| Output | The request's `max_tokens`, which the model is assumed not to exceed (no source in `docs/SOURCES.md` says so; the same assumption is what bounds extended thinking, the reasoning the model does before it answers), priced at the dearest output rate that could apply: the long-prompt output rate for a model that has one, on the same test as the input (amendment c). The gateway refuses a request whose `max_tokens` is above the profile's ceiling, so a hold cannot be made absurd |
| Fast mode | Doubles both parts whenever the request asks for it **or the profile allows the provider to serve it** (amendment c), so the hold covers fast mode at twice the standard rate. Twice is what the pricing page lists for Claude Opus 5.5 and Claude Fable 5.2; for any other model it is an assumption (known gap 23) |

**The life of a hold.**

1. **Open.** Check-and-hold runs inside one database transaction that locks the project's row, so two calls arriving together are judged one after the other, whatever gateway process they came through. If the equation fails, the call is refused with the message below and a `gateway.refused` event. If it passes, a `hold.opened` event is written with the amount and a deadline, and the call is forwarded.
2. **Settle.** When the provider's answer ends and its usage figures can be read, the gateway prices them, writes the `model.call` event with the actual cost, and closes the hold (`hold.settled`). The difference between the hold and the actual cost returns to the budget at that moment. **If the answer succeeded but its usage cannot be read** (an unexpected shape, a missing usage block), the hold keeps its full worst-case amount and the call is marked `unreconciled` (amendment d). *Unreconciled* means: the gateway does not know what the provider will bill for this call, so it charges the full hold against the budget until the owner establishes the true figure; a bill above the hold is not charged until then. **A kept hold stays open:** it counts as an open hold in the budget equation and in the invariants below until the owner closes it (step 3).
3. **Interrupted calls.** If the client disconnects or the provider's stream fails part-way, **the hold keeps its full worst-case amount and the call is marked `unreconciled`** (amendment a). The output count arrives late in a stream, so what was seen before the cut is not a measure of what the provider will bill; the usage seen so far is recorded for information only and releases nothing. The same holds when nothing at all was seen. Money is never released on a guess. Unreconciled calls are listed for the owner (package 1.5 of the build plan) and are closed only by a recorded owner action stating the actual cost and its evidence, such as the provider's usage record. *As built in package 1.2 (13 Nov 2026):* a caller that leaves after its hold is opened but before the call is forwarded to the provider (only the counting call, assumed to cost nothing, has been sent) has its hold settled at nothing, with that reason and no `model.call` event; once the call has been forwarded, any interruption keeps the hold at its full amount as this step says (in package 1.2 it is not yet marked unreconciled; known gap 62). Shown against a stand-in by the test "a caller that leaves before the call is forwarded: the hold is settled at nothing, with the reason, and the call itself is not forwarded" (`builder/test/gateway.test.ts`; `evidence/2026-11-12-package-1.2/holds.md`). This rests on Claude Code's reading that amendment (a), and the note of 12 Nov in `docs/DECISIONS.md` on interrupted calls, cover a call that was or may have been forwarded, not one whose caller left before it was; that reading is the owner's to confirm (the change-log row of 13 Nov below).
4. **Expired holds.** Every hold carries a deadline: the call's own time limit plus a margin (ten minutes for a plain call, thirty for a streamed one). A hold still open at its deadline is kept at its full worst-case amount, marked `expired` and listed as unreconciled, stays open, and the call is cut off. On start-up the gateway finds holds left open by a crash and treats them the same way, so a restart can never leak budget. *Awaiting the owner's confirmation:* the first holds design, recorded in `docs/DECISIONS.md` on 11 November, had an expired hold **settled** at its full amount, which closes it and charges the worst case for good with no action by the owner. The text here keeps it **open** until the owner reconciles it, to match package 1.5 of the build plan ("a hold is closed only by a recorded owner action"). Neither reading releases any money. The question is in `docs/STATUS.md`; proof rows B5, B6, B9 and B14 are written for the kept-open reading, and each would change if the owner chooses the other. *As built in package 1.2 (13 Nov 2026, after the review bot read `7ce5a33`):* the gateway marks holds past their deadline every 30 seconds, and also, under the project's lock, whenever it admits a call, settles a hold, or releases the hold of a call never sent, in that project, before it decides anything; deadlines are judged by the gateway's clock. So an answer that arrives after a hold's deadline is written down and the hold kept at its full amount, as this step says, even when the 30-second pass has not yet come; before the fix, such an answer settled the hold and released its unused part. Shown against the store, not through the gateway, by the two tests of row B5 added that day (`builder/test/gateway.test.ts`; `evidence/2026-11-12-package-1.2/holds.md`, "Review bot, 7ce5a33").
5. **A finished call that cannot be saved.** If the provider has answered but the event log refuses the write (the database is down or full), the hold stays open at its full amount, the project is marked `frozen`, and **the project makes no further calls until the call is reconciled** by the owner's recorded action (amendment e). The gateway raises a fault: a message saying that money was spent that could not be recorded. Nothing the provider billed, up to the hold, can go unrecorded and uncharged against the budget; for a bill above the hold, see known gap 41. **Where this is recorded while the database is refusing writes is not yet designed, and needs an engineer's judgement** (known gap 35). It is built in package 1.4, with the failure test that shows it (proof row B10), not in package 1.2. The proposal, to be reviewed: the gateway fails closed, meaning that while the event log cannot be written it forwards no metered call for any project; it keeps the unsaved call's record and the frozen mark in a small journal file of its own beside the gateway, outside every project container; and when the database accepts writes again it writes the journal into the log before anything else, so the hold, the freeze and the fault appear in the record and on the unreconciled list.
6. **Record.** Holds are rows in the database and events in the log, not memory, so they survive a restart and hold across more than one gateway process.

**Known limits of the hold, found in review on 12 November 2026.** As written above, the hold could be less than a call costs in four cases, and one case is not defined at all. None of this is on the integration branch. In each case package 1.2 builds the stricter choice (refuse the request, keep the hold, or add a margin to the count), which can only make the cap tighter; the reviewing engineer reads these with the gateway at checkpoint 2.

| Limit | Source, read 12 Nov 2026 | What package 1.2 does about it |
| --- | --- | --- |
| A request that sets `inference_geo` to "us" is billed at 1.1 times every rate, on top of fast mode and the long-prompt rate | Pricing page | The gateway refuses any request that sets `inference_geo` to anything but the default, until the hold includes the factor (proof row B15) |
| The token count is "an estimate" and the billed input "might differ by a small amount" | Token-counting page | A margin is added to the counted prompt; its size is set in package 1.2 as an assumption (5% plus 200 tokens), and compared with real usage in package 2.3, which can check only the calls it runs (proof row B16, which shows only that the margin is applied) |
| Server-side tools are billed on top of tokens (web search: $10 per 1,000 searches) | Pricing page | The gateway refuses any request that includes a server-side tool. The engine in Stage 1 is not expected to need one; that is an assumption until package 2.2. Tool servers (`mcp_servers`) are refused too (proof row B17) |
| Fast mode for a model the pricing page does not list is assumed to cost twice the standard rate | Pricing page lists it for some models only | The gateway refuses fast mode for a model whose fast-mode price is not in its table (proof row B18) |
| **An error answer from the provider is not defined:** the steps above do not say whether its hold is kept or released, and no proof row covers it | Found in review | The hold is released only when the provider's answer shows the request was rejected before any work was done; in every other case, such as a server error, it is kept, unreconciled (proof row B19, package 1.2). A call that never answers or is cut part-way is amendment (a) and belongs to package 1.4. *As built in package 1.2* (correction, 13 Nov 2026): the kept hold stays open at its full amount with its reason recorded, but it is not marked unreconciled; in 1.2 only expiry sets that mark (known gap 62) |

**Proof rows B15 to B19 (section 7.2) cover these five**, one each, in the order of the table above. They were added on 13 November 2026 by the owner's answer to his question 1 ("apply budget cap as long aswe can change it later"), as Claude Code reads it, which also made them part of what finishes package 1.2, with B1 to B6 (`docs/BUILD-PLAN.md`, package 1.2; `docs/DECISIONS.md`, 13 Nov). Until then no proof row covered them. The row for the margin, B16, shows only that a margin is applied; whether it is large enough needs a real provider (package 2.3). None of the five makes the hold a proven ceiling on the bill (known gap 41).

**The pre-step check.** A step must not start without room to finish, so each step carries a **step budget**: the worst case for the whole step, which is the step's turn limit multiplied by the worst-case hold of one call at the profile's `max_tokens` ceiling and the largest prompt the step may send. Before the orchestrator starts a step, it asks the gateway to open a step hold for that amount under the same equation. If it does not fit, the step does not start, and the user sees why and what raising the cap would allow. While the step runs, each call's hold is taken from the step hold rather than from the project's free budget; when the step ends, the unused part of the step hold is released. Step budgets are set from measurement once the skeleton has numbers; until then the turn limit and `max_tokens` ceiling are deliberately small, so the first step budgets are small and visible.

**What the user sees** when a call or a step is refused: "This project has reached its budget of $X (spent $Y, with $Z held for work in progress or awaiting reconciliation; this call needed up to $W). The gateway will forward nothing more until the budget is raised." The orchestrator marks the step failed with that reason. No silent degradation.

**Other limits.** Every engine call also carries a turn limit, because the SDK has no overall timeout (verified). The owner sets a monthly spending limit in the Anthropic Console as the outer cap. The plan's monthly API credits ($100 on Max, $200 on Ultra, verified) are spent first.

**The two invariants** that every failure test must show at every moment (build plan, package 1.4): recorded spend plus open holds is never above the approved cap; and recorded spend plus open holds is never below what the provider was owed. No settled call costs more than its hold.

**State of the code.** The gateway built on 11 November 2026 (`evidence/2026-11-11-skeleton-1/`) implements an earlier version of this: serialised check, in-flight calls counted, but with the next call estimated from recent history instead of bounded from the request, holds kept in memory, and no step hold. It is brought in line with this section before the engine adapter uses it (gaps 20 and 21; build plan packages 1.2 to 1.5).

**Amendments to this section, 11 November 2026** (approved by the owner through `docs/BUILD-PLAN.md`, package 1.1; recorded in `docs/DECISIONS.md`):

| | Amendment | Where it now stands |
| --- | --- | --- |
| (a) | A call cut off part-way keeps its full hold and is marked unreconciled, because the output count arrives late in the stream. The earlier text settled such a call with the usage seen so far | Step 3 of the life of a hold |
| (b) | If the prompt cannot be counted, the call is refused. The earlier text estimated from the request's size | The hold table, "Input" |
| (c) | The hold allows for fast mode and the long-prompt rate when either could apply, not only when the request asks for them | The hold table, "Input", "Output" and "Fast mode" |
| (d) | A successful answer whose usage cannot be read keeps its full hold and is marked unreconciled | Step 2 of the life of a hold |
| (e) | If a finished call cannot be saved, its hold stays open, the project is frozen, and no further call is made until the owner reconciles it | Step 5 of the life of a hold |

**Other changes to this note made with or after those five (to this section, to 5.2, 6.1 and 7.2, and two to the comparison table under decision D), each for the owner to see.** They are not among the five amendments the owner approved through the build plan; the first three follow from them, the fourth awaits his confirmation, and the rest were found in review: some are corrections, some are new, and some are the owner's to approve, as each row says.

| Date | Change | Why | Standing |
| --- | --- | --- | --- |
| 11 Nov 2026 | A hold that is kept (amendments a, d, e, and an expired hold) **stays open**: it counts as an open hold in the budget equation and in the two invariants until the owner closes it | Without this, a kept hold would be neither spend nor an open hold and would drop out of the invariants | Follows from the amendments and from package 1.5 |
| 11 Nov 2026 | Section 5.2's table gained the cache-write rates, the long-prompt row and the fast-mode paragraph | The hold in 5.5 relies on rates the note did not show | Correction; figures verified from the pricing page |
| 11 Nov 2026 | Proof row (e) divided between packages 1.4 and 1.5 | The reconciliation half needs package 1.5 | Correction |
| 11 Nov 2026 | **An expired hold is kept open and unreconciled, where the first holds design settled it at its full amount** | To match package 1.5 | **Awaits the owner's confirmation** (step 4; `docs/STATUS.md`) |
| 12 Nov 2026 | The output part of the hold uses the long-prompt output rate where one could apply; the Input row and 5.2 now state the same test | A fresh reviewer found the Output row said only "the output rate", which would hold too little for Claude Haiku 5.5 over the threshold | Correction within amendment (c) |
| 12 Nov 2026 | Step 5 says that where the fault and the freeze are recorded during a database failure is not yet designed, with a proposal | A fresh reviewer found the note had the gateway writing to the database at the moment the database refuses writes | Open design point; needs an engineer's judgement (gap 35) |
| 12 Nov 2026 | 5.2 states what the pricing page says about the long-prompt rate and fast mode, and marks the one remaining assumption | The earlier sentence said the fast-mode factor "can only over-count", which was an assumption stated as fact | Correction |
| 12 Nov 2026 | The budget rows of the proof table in 7.2 split into B1 to B14, each with one package | Finding 2 of the independent assistant's review supplied by the owner on 12 November | In answer to that review; the assignment is the owner's to approve or change. B14 asks one thing more than the plan's wording for package 1.5: that the frozen project of B10 runs again after reconciliation. *Note of 13 Nov 2026:* the package 1.2 part of it, B1 to B6, is accepted by his answer to question 1, as Claude Code reads it (`docs/DECISIONS.md`, 13 Nov); the assignment of B7 to B14 to packages 1.3 to 1.5 remains the owner's to approve or change |
| 12 Nov 2026 | 5.2's table gained a row for Claude Fable 5.2 | The gateway's price table prices that model, so the note has to show its rates | Correction; figures verified from the pricing page |
| 11 and 12 Nov 2026 | The refusal message under "What the user sees" now mentions money held "for work in progress or awaiting reconciliation" | Kept holds count against the budget, so the message has to say so | Follows from the amendments |
| 12 Nov 2026 | The Input and Output rows use the long-prompt rate "unless the counted prompt is under the threshold by the margin package 1.2 sets" | The count is taken before the call and the threshold decides the rate; a margin is needed and its size is not yet set | New; the margin is set in package 1.2 as an assumption, not from measurement |
| 12 Nov 2026 | Proof rows B1, B2, B5, B6, B7 and B8 say more than the eight rows they replaced: B1 names the settle event; B2 the refusal before forwarding; B5 that the hold stays an open hold; B6 start-up recovery; B8 the count of calls. **B7 asks more than the plan's wording for package 1.3**: besides the refusal with its message, that each call's hold is drawn from the step hold and the unused part released | The rows have to be checkable one by one | The owner's to approve or change, with the row assignment. *Note of 13 Nov 2026:* for B1, B2, B5 and B6, accepted by his answer to question 1, as Claude Code reads it (`docs/DECISIONS.md`, 13 Nov); B7 and B8 are not covered by that answer |
| 12 Nov 2026 | Row B5 says "marked unreconciled", not "listed" | The owner's list is package 1.5, which comes after 1.2 | Correction |
| 12 Nov 2026 | **Which package builds what.** Package 1.2 builds opening, settling, expiry and start-up recovery (B1 to B6). Package 1.4 builds what happens when a call is cut off, is unreadable or cannot be saved (amendments a, d, e) together with the tests that show it (B8 to B13). B14 (package 1.5) needs those cases, so **1.5 can be finished only after 1.4**, although the plan lists 1.5 as depending on 1.2 alone | The earlier text did not say, and had the engineer's question attached to 1.2 | Decided by Claude Code as a matter of how it is built; whether to add the 1.4 dependency to the plan is the owner's to say |
| 12 Nov 2026 | "Known limits of the hold" added above | A fresh reviewer checked the hold against the provider's pricing and token-counting pages and found four ways it could fall short, and one case not defined | **Open design points, not approved** |
| 12 Nov 2026 | **As built in package 1.2**, where this section left a figure or a choice open: the count margin (5% plus 200 tokens, an assumption); the time limits behind a hold's deadline (10 minutes plain, 60 streamed, then the margins in step 4; *corrected 13 Nov 2026:* as built, a plain call is cut at about 300 seconds if its answer's headers have not arrived, by Node's own fetch at its default settings, and a streamed call at 300 seconds without a next piece, within its 60 minutes; a reviewer measured 300,805 ms; known gap 63); the standard profile's ceiling of 16,000 output tokens and no fast mode; a request asking for fast mode on a profile that does not allow it is refused, not doubled; which tools are let through; only the provider's own error of a known type settles a hold at nothing (first built as "any answer in the 400s", narrowed after review); the gateway forwards a fixed list of request fields and its own list of beta features and refuses the rest; usage that cannot be trusted keeps the hold, and a streamed answer is trusted only with the provider's end-of-message marker and no error event; a fixed list of request headers is forwarded and a query string is refused; every budget transaction states its isolation level; an answer arriving after a hold expired does not settle it. What this enforces is a limit when a call is admitted (spend plus open holds plus this hold within the cap); it does not enforce that a bill stays within its hold, and the margin is assumed, not measured (known gaps 41 and 62; wording added 13 Nov 2026) | The note said "the margin package 1.2 sets" and left the others unstated | Recorded in `docs/DECISIONS.md` as how it is built. Each is stricter than the note or marked as an assumption; the reviewing engineer reads them at checkpoint 2 |
| 11 and 12 Nov 2026 | The paragraph "The two invariants" was added to 5.5, and step 3 gained the rule that a kept hold is closed only by the owner's recorded action stating the actual cost and its evidence | The invariants come from the plan's package 1.4 and the closing rule from its package 1.5; the note has to state both | Taken from the plan's own wording; listed here for completeness |
| 12 Nov 2026 | Proof row B4 split into two cases | No model has both a long-prompt rate and a listed fast-mode price, so the row could not be shown as first written | It changes what finishes package 1.2, so it is the owner's to approve or change, with the row assignment. *Note of 13 Nov 2026:* accepted by his answer to question 1, as Claude Code reads it (`docs/DECISIONS.md`, 13 Nov): question 1 said that choosing (a) accepts B4 as split |
| 12 Nov 2026 | In the comparison table under decision D, "permissive licences: Both" replaced by a row saying neither candidate is free of non-permissive licences as found so far | `caniuse-lite` and the LGPL packages of `sharp` were found in the TypeScript template after the table was written; the sentence above the table that said every component is permissive was corrected with it | Correction of a fact. The stack decision is unchanged and is the owner's |
| 13 Nov 2026 | **Proof rows B15 to B19 added to 7.2**, one for each known limit of the hold above, each named as known gap 41 names it; package 1.2 is finished by B1 to B6 and B15 to B19; the paragraph after the table of known limits says so, and each row of that table names its proof row. The error-answer row of that table now says what is built: the hold kept open with its reason, not marked unreconciled | The owner's answer to his question 1 ("What finishes package 1.2?"): "apply budget cap as long aswe can change it later". Claude Code reads it as his choice of option (a), on the condition that the cap and these finish criteria stay changeable later by a recorded decision; he has been told this reading and can correct it | **Approved by the owner, as Claude Code reads his answer** (the rows, through that answer; `docs/DECISIONS.md`, 13 Nov). The reading of his answer is Claude Code's. The note on the error-answer row is a correction |
| 12 Nov 2026 | Wording of the hold made to match what package 1.2 builds: *worst-case* defined in 5.5; token counting "free" and `max_tokens` "cannot exceed" marked as assumptions; steps 2 and 5 limited to the amount of the hold; the margin recorded as an assumption, not a measurement (the token-count row of the table of known limits of the hold, and the change-log row above); the 6.1 Spend row says a hold is a reservation, not a proven ceiling; the `caniuse-lite` row under decision D says its approval rests on an unconfirmed reading | The outside review the owner supplied on 12 Nov (`docs/reviews/2026-11-12-outside-review-supplied-by-the-owner.md`) found that these sentences claimed more than is built or sourced | Corrections, for the owner to see; whether the cap's approval in the Status row at the top of this note means a reservation of this kind is his to say |
| 13 Nov 2026 | **As built in package 1.2, after the review of 13 Nov:** when the gateway cannot pass a call on to the provider, the record says "the provider could not be reached" only when the connection to the provider was never made, and otherwise that the request was or may have been sent, the hold kept either way; a hold that allowed for fast mode is kept when the answer's figures do not say which speed served the call; cache writes (parts of a prompt the provider stores for reuse, billed at a five-minute rate or a dearer one-hour rate) that an answer does not split between the two rates are priced at the one-hour rate, unless nothing in the request asks for a lifetime other than five minutes; a hold whose caller left before the call was forwarded is settled at nothing with that reason, only the counting call having been sent (a third way out of the equation, beside settling to the actual cost in step 2 and at nothing after the provider's own rejection; step 3 has an as-built note); the message under "What the user sees" keeps its wording, with what is needed, spent and held rounded up to the cent and the cap down, so its figures never appear to fit; the plain call's time limit is about 300 seconds as built (the "As built" row above, corrected) | A review of package 1.2 on 13 November found that the record of a failed forward could say nothing was sent when it may have been, that two readings of the usage released money on an assumption, that a hold could be kept for a call never sent, and that the message's figures could appear to fit the cap | Recorded in `docs/DECISIONS.md` as how it is built. Each makes the cap stricter or the record truer, except the settling at nothing of a call never forwarded, which releases a hold only when the call itself was not sent. That one rests on Claude Code's reading of amendment (a) and of the note of 12 Nov in `docs/DECISIONS.md` on interrupted calls ("the hold is kept in full"): that "kept in full" covers a call that was, or may have been, forwarded. The reading is the owner's to confirm |
| 13 Nov 2026 | Step 4 gained an as-built note: a hold past its deadline is not settled or released before the gateway's 30-second pass has marked it; a settlement or release marks it first, under the project's lock, by the gateway's clock | The review bot read `7ce5a33` and found that an answer arriving in that gap settled the hold and released its unused part, which step 4 and proof row B5 do not allow | A defect fix, to match step 4 and row B5 as written; the rule is unchanged, so it is not a new decision |
| 13 Nov 2026 | **A recorded way to change a project's cap (package 1.2b):** the note after the budget equation above, and proof rows B20 to B22 in 7.2. A lowering below spent plus open holds is refused. A cap must be a real number: the database refuses "not a number" (migration 007), and so does the function that creates a project | The owner's answer to question 13: "a, add the cap change after 1.2". The refusal of "not a number" fixes a finding made while designing 1.2b: the database's check `cap_usd >= 0` let that special value in, and such a cap would have refused no call | B20 and B21 restate the option he chose, as Claude Code reads it. B22, the refusal of a lowering below spent plus open holds (Claude Code's default, pending his question 14; it changes no approved wording) and the check that a cap is a real number are Claude Code's, recorded in `docs/DECISIONS.md`, 13 Nov |

---

## 6. Security position for Stage 1

Stage 1 is a single-user prototype with made-up data. It is **not secure, not reviewed and not ready**, and no document or screen will say otherwise. This section says what is protected, what is not, and what a reviewing engineer should see first.

### 6.1 Protected

| What | How |
| --- | --- |
| The model key | Held by the gateway process only. Never in a project container, never in the repository, never in logs or screenshots. On the development machine it is an environment variable on the owner's personal cloud environment with our own name, `BUILDER_MODEL_API_KEY` |
| Spend | Per-project cap in the gateway enforced by worst-case holds settled to actual cost, with a pre-step check (5.5); a hold is a reservation computed from the request, not a proven ceiling on the bill (known gap 41); turn limit per engine call; monthly limit in the Console |
| The acceptance checks | Stored in the builder's acceptance store, outside the project's working copy and git history; never mounted in the engine's container, which also has no network route to the store; mounted read-only in the acceptance runner only; generated by a separate process; reported passed only when run; copied into the app at export |
| The sign-in and role code, the quality-rule machinery | Code the engine must read but never change: denied to the engine's edit tools by permission rule and mounted read-only |
| The host machine | Engine and app run in containers as a non-root user with capabilities dropped, memory and process limits, read-only root filesystem |
| Outbound traffic from project containers, on a server | Internal Docker network plus an egress proxy that allows only the gateway and the package registry |
| The record | Append-only event log; every model call, tool call, approval and check result |
| Dependencies | Pinned versions; automated licence check in the quality gate; licences recorded |

### 6.2 Not protected in Stage 1, and said so

| What | Why not yet |
| --- | --- |
| Isolation between customers | One customer, one installation. Stage 2 |
| Network isolation of project containers on the development machine | Host network is used there by every project container except the engine, as section 2.5 describes (first written "required"; whether the project's containers could work without it was not tried); what they can reach there was measured on 12 November 2026 (known gap 60). Development only, made-up data only |
| Hardened kernel isolation (gVisor, virtual machines) | Plain Docker in Stage 1. The interface allows a swap |
| The builder's own login | A single password in front of the demo server. Not single sign-on, not hardened |
| Secrets management | Environment variables, not a vault |
| Password handling in generated apps | A maintained library, not reviewed by an engineer yet |
| Real data of any kind | Prohibited in Stage 1 |
| An independent review | Not yet done. Required before any technical pitch, any real data, or any second customer |

### 6.3 First entries for the known-gaps register

Written to `docs/KNOWN-GAPS.md` on 11 November 2026, the first fourteen entries: host networking in development sessions (gaps 1 and 2); the key never entering a container, with a note to record any shortcut before taking it (3); environment variables readable by environment users (4); Docker Hub rate limits (5); password handling in the template (6); no verified in-country model processing for the UAE (7); the SDK's commercial licence (8, since decided); no SDK session timeout (9); session pause and command limits (10); `CLAUDE.md` is not enforcement (11); provider price tables drawn by scripts (12, since narrowed); several documentation hosts unreachable (13, since narrowed); the egress proxy is weaker than the guide's no-network pattern (14). Entries 15 onwards were added as the skeleton was built; the register is the living list.

---

## 7. Walking skeleton

### 7.1 The slice

The thinnest path from a fixed brief to a running app with one acceptance check and a measured cost, on each candidate stack.

1. **Fixed brief.** The worked mapping for example 1 in `docs/spec/B2-question-bank.md` is written by hand as an app spec: three roles, the leave-request entity with its fields, two screens, two actions, one rule, and the acceptance items from "Done means". The analyst is not involved; its conversation is a later milestone.
2. **Template.** A minimal house template for the stack: sign-in with email and password, three seeded sample users with roles, one protected page per role, who-and-when stamps on every table, a Mailpit mail catcher, and the licence check. Only as much of the ten rules as the two steps below need.
3. **Sandbox.** The sandbox manager creates the project's containers from the template under the `development-cloud-session` profile.
4. **Gateway.** The gateway runs outside the containers, holds the key, records usage and enforces the cap by holds (5.5), set deliberately low for one run so the cap is seen to work, both at a call and at the pre-step check.
5. **Two engine steps.** The optimiser is a fixed template for now. Step one: the data step, creating the leave-request table and migration. Step two: the submitter's screen, a list of my requests and a form to add one, with validation. Each step is one SDK call with a turn limit, `dontAsk` mode, the allow list, the deny list, and the logging hook. The user's approval between steps is a prompt in the harness.
6. **One acceptance check.** Generated by a separate call from the app spec's first acceptance item: an employee signs in, submits a five-day request, and sees it in their list with status "waiting". Written into the acceptance store, never into the workspace. Run by Playwright in its own container, which mounts the store folder read-only and sees the running app. Screenshot recorded.
7. **Export.** The exporter copies the project's repository out and, at that moment, copies the acceptance check in from the store as `acceptance/` and commits it. The builder is stopped, and the app is started from the export with its one documented command on the same machine. The acceptance check runs against it again, from the exported copy.
8. **Report.** One page per stack: screenshots, the acceptance result, the event log's row count, and the cost per step and in total for each of the two models tried.

*Amendments for package 2.1 (the scripted engine), 12 November 2026.* Decided by Claude Code as how something is built (build plan section 4) and recorded in `docs/DECISIONS.md`; not approved by the owner.

| Date | Change | Why | Where it stands |
| --- | --- | --- | --- |
| 12 Nov 2026 | Step 5 as built by the scripted engine: the data step creates the leave-request table with `drizzle-kit push` in the tools container, and writes no migration files | The same as package 0.5; the template has no migration folder | Known gap 53: settled in package 3.2, where the export must make its tables with the builder stopped |
| 12 Nov 2026 | The scripted engine's container has **no network** (2.5 gives the engine a route out through the egress proxy). The real engine of package 2.2 keeps 2.5's design | The scripted engine calls no model and fetches nothing | Known gap 50: what 3.1 shows from this container about the network does not carry over to 2.2, which repeats those probes |
| 12 Nov 2026 | The project's history is kept beside the workspace, not inside it: the workspace is the checkout (2.5), and its git folder is a separate folder that no container mounts. git runs in the builder | The engine can then neither read nor change the history, its settings or its hooks, and no history is visible to the engine as a file | Known gap 51: an engineer to judge git running in the builder over files the engine wrote |
| 12 Nov 2026 | The scripted slice of example 1 links a leave request to the template's user table, and has no employee record, balance or notification. The template has no mail catcher yet (step 2 lists one) | Enough for acceptance item 1, which is what 3.1 runs | Known gap 54 |
| 12 Nov 2026, after the review of package 2.1 | 2.4 says protected code "is mounted read-only, so the operating system enforces what the permission rules state". With a file mounted on its own, that holds for a write to the file in place only: a file at a protected path can be replaced by renaming a folder above it, which Linux allows. The check after each step (git's view of the workspace and a walk of it for what git cannot see) is the control that decides, in 2.1 and in 2.2 | Shown live in the engine container: `builder/test/scripted-engine.test.ts`, "a protected file replaced through a renamed folder" (the step fails, nothing is committed, the reset puts the file back) | Known gap 56: package 2.2 keeps the check after each step, decides a rule for new files beside protected ones, and decides whether protected folders are also mounted read-only |

### 7.2 What it proves

| Claim | Evidence in the report |
| --- | --- |
| The engine builds on the template inside a container | The step's commit in the project repository; the tool-call log |
| The key never enters the container | The container's environment and filesystem inspected after the run, with the inspection command and its output |
| Every model call goes through the gateway and is metered | The gateway's usage rows match the SDK's reported usage for each call |
| The budget cap works as section 5.5 says | The twenty-two rows B1 to B22 in the table below, each from the event log against a stand-in provider, each assigned to exactly one package of the build plan |
| The acceptance check is independent | The check's generation log shows its inputs: app spec and app address only. The engine container's mounts, listed by the container runtime, show no acceptance mount. The project's git history, listed, shows no acceptance file before the export commit. The runner container's mounts show the store folder read-only and no workspace |
| The export runs alone, with its tests | The app started from the export with the builder stopped; the exported repository's history shows `acceptance/` arriving in the export commit; the check passing against the exported app from the exported copy |
| The development machine suffices | Wall-clock time of the whole run, memory peak, and disk used |
| Which stack and which model | Acceptance result, rule compliance by inspection, and cost, side by side |

**The budget cap's proof rows.** Each row belongs to one package of `docs/BUILD-PLAN.md` and to no other, so a package is finished by its own rows and never waits on a later one. "Shown" for these rows means run against a stand-in provider, which shows how the gateway behaves; it does not show how the real provider behaves (build plan, section 8, rule 3).

| Row | Package | Claim | Evidence, from the event log |
| --- | --- | --- | --- |
| B1 | 1.2 | A hold is opened before every forwarded call and settled to the actual cost | For each call in a run: `hold.opened` with its worst-case amount shown beside the arithmetic (prompt count, `max_tokens`, the rates used), then `hold.settled` with the actual cost; the actual cost is never above the hold; the difference returns to the budget |
| B2 | 1.2 | A call whose hold does not fit is refused at the call | Cap set so that spend plus open holds plus this hold exceeds it: the call is refused with the message shown, a `gateway.refused` event is written, no hold is opened, nothing is forwarded |
| B3 | 1.2 | A prompt that cannot be counted is refused (amendment b) | The token-counting path made to fail: refused with the reason named, no hold opened, nothing forwarded |
| B4 | 1.2 | The hold covers fast mode and the long-prompt rate when either could apply (amendment c) | Two cases, each with the `hold.opened` amount shown beside the arithmetic from the table in 5.2. (1) A model with a long-prompt rate (Claude Haiku 5.5) and a prompt at or near the threshold: the hold is at the long-prompt rates. (2) A model with a listed fast-mode price (Claude Opus 5.5) and a profile that allows fast mode: the hold is at twice the standard rates. No model today has both, so the two are shown separately |
| B5 | 1.2 | A hold past its deadline is kept, not released | One hold driven past its deadline: kept at its full amount, marked `expired`, still counted as an open hold, marked unreconciled |
| B6 | 1.2 | Holds are database rows that survive the gateway stopping | The gateway stopped cleanly with a hold open and started again: the hold is found at start-up, kept at its full amount, still counted as an open hold; spend plus open holds reads the same before and after |
| B7 | 1.3 | A step does not start without room to finish | Cap set below a step's budget: the step is refused before it starts, with the message shown. In a step that does start: each call's hold is drawn from the step hold, and the unused part is released when the step ends |
| B8 | 1.4 | Calls in flight at the same time cannot pass the cap together | Several calls sent at once against room for one: exactly one forwarded, the rest refused; check-and-hold seen to run one after another under the project-row lock |
| B9 | 1.4 | The gateway killed in the middle of a call leaks no budget | The gateway process killed while a call is in flight, then started: the hold is found, kept at its full amount, marked unreconciled |
| B10 | 1.4 | A finished call that cannot be saved freezes the project (amendment e, first half) | The event log made to refuse the write after the provider answered: the hold stays open, the project is marked frozen, the next call is refused with the reason named, a fault is raised |
| B11 | 1.4 | A stream cut after output began keeps its full hold (amendment a) | One call cut off mid-stream after output began, and one with no answer at all: each hold kept in full, still open, marked unreconciled; the usage seen recorded for information only |
| B12 | 1.4 | A successful answer that cannot be read keeps its hold (amendment d) | The stand-in provider answers 200 with no usage block: the hold is kept in full, still open, the call marked unreconciled |
| B13 | 1.4 | The two invariants hold throughout | For each of B8 to B12, a trace of recorded spend plus open holds at every step: never above the approved cap, never below what the provider was owed; no settled call costs more than its hold |
| B14 | 1.5 | Unreconciled holds are closed only by the owner's recorded action | The unreconciled list shown with one example of each kind (interrupted, unreadable, expired, unsaveable); one reconciliation recorded with the actual cost and its evidence, after which the actual cost is what is charged and the frozen project of B10 runs again (amendment e, second half) |
| B15 | 1.2 | Known gap 41, "`inference_geo` "us" (1.1 times every rate)": a request that sets `inference_geo` to anything but the default is refused | A request with `inference_geo` "us": refused before anything is forwarded, with the reason named and the message shown; a `gateway.refused` event is written; no hold is opened; nothing reaches the provider. The same request without it is forwarded |
| B16 | 1.2 | Known gap 41, "the token count being an estimate": a margin is added to the counted prompt | For each call, `hold.opened` shows the counted prompt, the margin and the prompt tokens held, and the amount worked out from the figure held; a stand-in bill a little above the count, at the dearest input rate, is settled within the hold. **Shown only in part:** this shows that a margin is applied. Whether it is large enough needs a real provider (package 2.3); its size is an assumption |
| B17 | 1.2 | Known gap 41, "server-side tools billed on top of tokens": a request that includes one is refused | A request with a tool the provider runs itself, and one that asks the provider to connect to tool servers: each refused before anything is forwarded, with the reason named and the message shown, a `gateway.refused` event, no hold opened, nothing forwarded. A request with only the caller's own tools is forwarded |
| B18 | 1.2 | Known gap 41, "fast mode on a model whose price is assumed": a request for fast mode on a model whose fast-mode price is not in the gateway's table is refused | On a profile that allows fast mode: such a request refused before anything is forwarded, with the reason named and the message shown, a `gateway.refused` event, no hold opened, nothing forwarded; the same request on a model with a listed fast-mode price is forwarded and held at twice the standard rates |
| B19 | 1.2 | Known gap 41, "What happens to a hold after an error answer was not defined": the hold is released only when the provider's own answer shows the request was rejected before any work was done, and is kept in every other case | The provider's own rejection before work: `hold.settled` at nothing. A server error, an overloaded answer, an error type not on the list, and an error not in the provider's own shape: each hold kept open at its full amount, with a `hold.kept` event naming the reason, still counted as an open hold (a further call that would not fit beside it is refused). In package 1.2 the kept hold is not marked unreconciled (5.5, the table of known limits) |
| B20 | 1.2b | A change to a project's cap is recorded, and the next call is judged against the new cap | A raise: a call refused at the old cap (402, and a `gateway.refused` event carrying the old `cap_usd`); then one `cap.changed` event with the old and new figures, who asked, who ran it, the reason and the time, with spent and open holds the same before and after it; then the same call let through, its `hold.opened` showing the new cap (`budget_before.cap_usd`). A lowering to exactly spent plus open holds: accepted and recorded, and the next call refused against the new cap |
| B21 | 1.2b | A cap change and the calls of the same project are judged one at a time | A third database session holds the project's row lock while two changes, and in a second case a change and a call's admission, are seen waiting for it; once it is released, the second change's old figure is the first change's new figure, and the change and the admission agree in the order of their events: whichever was judged second saw the result of the first |
| B22 | 1.2b | A cap change that cannot be made changes nothing and writes nothing | Each refusal named by its own reason: a figure that is not a number, is below 0, is $100,000,000 or more, or has more than 4 decimals; a figure equal to the current cap; an unknown project; who asked, who ran it or the reason missing, empty, longer than 500 characters, or holding a character the event log cannot store; and a lowering below spent plus open holds, whose refusal names the lowest figure allowed at that moment. After each, the cap and the project's number of events are unchanged |

*Amendment to this table, 12 November 2026, in answer to an independent assistant's review supplied by the owner:* the eight budget rows of the earlier table were split into B1 to B14 and each given one package, because package 1.2's "Done means" pointed at rows that belonged to packages depending on 1.2. Nothing was removed: every claim in the earlier rows is in a B row.

*Amendment to this table, 13 November 2026, approved by the owner as Claude Code reads his answer:* rows B15 to B19 were added, one for each case of known gap 41 that package 1.2 handles (by refusing the request, by keeping the hold, or by a margin on the token count), each case named as gap 41 names it. Asked his question 1 ("What finishes package 1.2?"; option (a), recommended: B1 to B6 plus a proof row for each of those five), the owner wrote: "apply budget cap as long aswe can change it later". Claude Code reads this as option (a), on the condition that the cap and these finish criteria stay changeable later by a recorded decision; the owner has been told this reading and can correct it (`docs/DECISIONS.md`, 13 Nov). Package 1.2 is now finished by B1 to B6 and B15 to B19. The new rows are numbered after B14 so that no existing row is renumbered. No row was removed or weakened. Like every row here, they are shown against a stand-in provider; none of them makes the hold a proven ceiling on the bill (5.5; known gap 41).

*Amendment to this table, 13 November 2026 (package 1.2b), as Claude Code reads the owner's answer:* rows B20 to B22 were added. Asked his question 13 ("Should the builder get a way to change a project's cap, and when?"; option (a), recommended: a small addition right after 1.2 and before 1.3, "a recorded way to change a project's cap, shown by a test", one function in the builder's store that changes the cap while holding the project's lock and writes a `cap.changed` event to the event log with the old and new figures, who changed it and when), the owner wrote: "a, add the cap change after 1.2". Rows B20 and B21 are Claude Code's reading of that option as proof rows: the change recorded and the next call judged against it; and the change judged one at a time with the calls of the same project. Claude Code's additions, not covered by his answer: row B22 (a change that cannot be made changes nothing and writes nothing); the refusal of a lowering below spent plus open holds, which keeps the first invariant in 5.5 true as worded (whether such a lowering should be accepted instead is his question 14; if he chooses that, B20 and B22 change with it); and "who changed it" recorded as two names, who asked and who ran it. The rows are numbered after B19 so that no existing row is renumbered. No row was removed or weakened. They are shown against the store and a stand-in provider. They say nothing about who really asked, which is written as the caller states it, and nothing about a hand edit of the database, which still leaves no record (known gaps 22 and 64).

### 7.3 What it does not prove

That the analyst works, that the ten rules hold, that a change request can be applied, or that anything is secure. Those are the milestones that follow.

---

## 8. Milestones after the skeleton

In order. Each names what the owner is shown. No dates. Each ends with a pull request carrying the evidence, a fresh reviewer agent's check of the claims against that evidence, and an updated `docs/STATUS.md` and `docs/KNOWN-GAPS.md`.

| # | Milestone | What the owner is shown |
| --- | --- | --- |
| 0 | **Walking skeleton** (section 7) | Example 1 built from a fixed brief on each candidate stack, running, one acceptance check passing with a screenshot, the key shown absent from the container, the cap shown stopping a build, the export running alone, and the measured cost. The stack decision, with the numbers |
| 1 | **House template** | A blank app on the chosen stack in which all ten quality rules hold, each with the automated check that proves it, shown passing. The quality gate running those checks after a step |
| 2 | **Intake** | A conversation with the analyst, from a raw ask to a brief the owner can confirm, with closed-choice questions, recommendations carrying their reasons, and the Later list. The app spec produced from it. Every question and answer visible in the project's record |
| 3 | **Plan and step-by-step build** | The plan from the brief, confirmed by the owner, built one step at a time in the builder's web interface, with the preview after each step, one deliberate failure shown with its name, and the approval before the next step |
| 4 | **Independent acceptance** | The full checklist generated and run against the app, with a screenshot per item, the assumed choices listed for confirmation, and the sign-off recorded |
| 5 | **Changes** | A change request going back through the analyst, the brief and plan updated, the change built, and the full acceptance test passing again |
| 6 | **Record, cost and export in full** | A project's complete record browsed in the interface; its cost per step; the exported repository started on a clean machine with one command and its README |
| 7 | **Test protocol** | The ten answer sheets for the owner's review first. Then a trial run of two examples for the owner to set the pass target. Then the full protocol: the report with raw, brief and tuned scores, the drift and phrasing findings, the first optimiser rules, and the (H) marks removed or kept. Repeated tuned runs for consistency |
| 7b | **Second engine: OpenAI's Codex SDK** (gate item 9; the owner's choice, 11 Nov 2026) | First, the OpenAI account's price and terms shown to the owner for his yes (hard rule 4). Then two test examples built through the Codex adapter, behind the same gateway and cap, scored against the same acceptance tests as their tuned runs, with the difference in score and cost reported plainly and no claim beyond what was measured. The report says in one line that this proves the engine seam and not in-country processing (gap 33) |
| 8 | **Demo** | The demo environment running the builder behind a login; the chosen demo candidate built live end to end and changed twice; the rehearsed script; a labelled recording as fallback |
| 9 | **Gate review** | Each Stage 1 gate item in `HANDOVER.md` section 6 marked done with its evidence, and `docs/KNOWN-GAPS.md` current with the reviewing engineer's starting points |

The spreadsheet upload (in scope for Stage 1) joins at milestone 2, because it is an input to the analyst. The run-through mode for demonstrations, if the owner wants it, joins at milestone 8.

---

## 9. Decisions needed from the owner

In order. One at a time. Each has a recommendation and its reason. Answers are recorded in `docs/DECISIONS.md`.

**1. Approve this design note?** **Answered: approved on 11 November 2026, subject to three corrections** (acceptance tests out of the engine's container and git history; the cap by worst-case holds with a pre-step check; the Codex SDK as the second engine), which this version makes.
- (a) Approve as written; start the walking skeleton. Was recommended.
- (b) Approve with changes. Say which. **This is what the owner did.**
- (c) Do not approve. Say what is missing.

**2. Licence exception for the build engine?** The Claude Agent SDK is governed by Anthropic's Commercial Terms of Service, not a permissive open-source licence. Hard rule 2 needs your written exception.
- (a) Approve the exception for the Claude Agent SDK, behind an interface of our own (a fixed boundary in the code, so the engine can be swapped without touching the rest). **Recommended.** Reason: it is the engine the handover chose, it is what Claude Code itself runs on, and the interface limits the dependence.
- (b) Do not approve; build our own engine on the Claude API instead (our own code that asks the model what to do and runs it, step by step). More work, same model provider, no licence question.
- (c) Decide later; the skeleton may use it provisionally. Not recommended: the exception should be written before the first line of code depends on it.

**3. Network hosts for pricing and documentation research?** The session cannot reach provider pricing pages or several documentation sites, so hard rule 4 cannot be met for the demo server.
- (a) Allow the hosts listed in `docs/OPEN-DECISIONS.md` item 11 in the cloud environment's network settings (in Claude Code on the web: the environment's settings page has a list of allowed websites; add these to it). **Recommended.** Reason: it lets every price and fact be read from the primary page and dated, which is what the rules require.
- (b) You check the prices yourself on the providers' pages and paste them.
- (c) Decide the demo server on the indicative figures in section 4.3. Not recommended: they come from search snippets.

**4. English and Arabic from the first version?**
- (a) Yes: the template is built with translation and right-to-left layout from the start, and both candidate stacks are judged on it. **Recommended.** Reason: cheap now, costly later, and the buyers are in the UAE.
- (b) English only for Stage 1; Arabic later.
- (c) Arabic in the generated apps only, not in the builder's own interface.

**5. Which demo candidate first?**
- (a) D3, the finance commission leak report for a car dealership. **Recommended.** Reason: you supplied the domain and can judge every number yourself, and it shows rules 8 and 9 (every number with its source and period; every export with its filters), which is the product's answer to dashboards that impress and do not function.
- (b) D1, the inspection and compliance tracker. Shows phone use and dated alerts.
- (c) D2, the delivery and cylinder tracking. Shows three roles and a daily log.

**6. Step approvals during a demonstration?**
- (a) Keep approval of every step as the default, and add a run-through mode that is only offered in a rehearsed demonstration and is labelled as such on screen. **Recommended.** Reason: the control points are the product; a demonstration should still show them, and the mode exists for the clock, not to hide anything.
- (b) Always approve every step, including in demonstrations.
- (c) Allow run-through mode for any user. Not recommended: it removes a control point.

**7. Model key and monthly limit.** Not a choice, a request, in four steps. (1) Sign in to the Anthropic Console (console.anthropic.com, the account for paid use of the model, separate from the Claude app) and create an API key. (2) In the Console's billing settings, set a monthly spending limit. (3) In Claude Code on the web, open your personal cloud environment's settings and add an environment variable named `BUILDER_MODEL_API_KEY` with the key as its value. An environment variable is a named setting the machine reads at start; anyone who uses that environment can read it, which today is you alone. (4) Tell me it is done. Never paste the key into the conversation. Before paying for usage, check that your plan's monthly API credits are claimed and the Console organization is linked to the plan ($100 on Max, $200 on Ultra, verified today). Tell me the monthly limit you set, so the per-project default cap can be chosen below it.
- (a) Monthly limit $50, default project cap $10.
- (b) Monthly limit $100, default project cap $20. **Recommended** if the plan credits cover it. Reason: the skeleton and the protocol trial need room to measure, and the cap still stops any single project early.
- (c) Another figure.

**8. Reviewing engineer: at which milestone?**
- (a) After the walking skeleton, for a short read of the gateway (the one door to the model) and the sandbox manager (the part that creates the containers); then again before the demo. **Recommended.** Reason: the two security-critical parts exist after the skeleton and are small; a second look before anyone technical sees a demo is the handover's own rule.
- (b) Only before the demo.
- (c) Not in Stage 1. Not recommended.

**9. Confirm two items proposed in planning:** portable from the start with UAE hosting built when a buyer requires it; and first use is a live demonstration to a group-level decision-maker.
- (a) Confirm both. **Recommended.**
- (b) Confirm one; say which.
- (c) Change them; say how.

**10. The `main` branch.** Not a choice unless you object. A branch is a named line of history in the repository, and `main` is the one everything is compared against. The repository was empty, so a `main` branch was created holding only `HANDOVER.md` and `CLAUDE.md`, the starting point the handover describes, so that a pull request could be opened. Say if you would rather it were done differently.

**11. Which second engine for gate item 9?** **Decided by the owner on 11 November 2026: (b), OpenAI's Codex SDK.** The options as they were put, kept as history:
- (a) A small loop of our own against an OpenAI-compatible endpoint. Was recommended. Reason given: it is the engine a UAE-only profile would need, and it has no vendor licence question; its weakness would be reported as measured. Not chosen; kept as the candidate for the UAE-only profile.
- (b) OpenAI's Codex SDK. **Chosen.** Quicker proof of the seam with a mature agent; its package is Apache-2.0; needs a second provider account and spend line, to be priced and approved before milestone 7b; does not answer the in-country question (gap 33).
- (c) Both, if the budget allows after the protocol's trial run. Not chosen.

Not asked now: the product name (no rush; `builder` until then), the pass target for the protocol (set after the trial run, as the handover says), the legal owner (Ahmed Sharara personally for now), and the default model (measured in the skeleton, not decided).
