# Stage 1 design note

| | |
| --- | --- |
| Status | **Approved by the owner on 11 November 2026, as written.** The owner's answers to section 9 are recorded in `docs/DECISIONS.md`; the demo candidate (question 5) is still undecided, and the model key (question 7) is still to be created. The walking skeleton (section 7) is the next task |
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
- An acceptance check written from the brief, kept out of the engine's reach, can drive the running app and produce evidence.
- The exported app starts on its own with one command.
- The whole thing runs on the development machine we have, within its limits.

**What I checked, and what I could not.** I verified Anthropic's documentation on the build engine, its hosting, its security guidance, its permissions, the cloud development machine, model prices and the plan's monthly API credits (section 3). I measured the development machine: containers run, and containers can reach the package registries and the model API with a workaround that is acceptable for development only (section 4). After you allowed the research sites, I read Hetzner's and DigitalOcean's prices from their own pages, and confirmed that Oracle, AWS and Azure each have regions in the UAE. Oracle's, AWS's and Azure's price tables are drawn by a script in the browser and could not be read by this session; you can read those in a browser if you want the demo server in the UAE.

**Where I disagree with the handover.** In seven places, set out in section 2.9, most of them small. The three that matter: the first is that the handover's "Powered by Claude" wording is not quite what Anthropic permits: the permitted form is "{our name} Powered by Claude". The second is that the build engine's licence is a commercial licence, not a permissive one, so hard rule 2 needs your written exception. The third concerns processing inside the UAE: today no verified option keeps the model's processing in the country, and that matters for the regulated buyers in the handover.

**On staying adaptable (the owner's Decision F).** I agree with the two seams and the profiles, and I propose that the second engine proven before the gate be a small loop of our own against an OpenAI-compatible endpoint, because that is the engine a UAE-only profile would need, and the Codex SDK would add a second provider account without answering that question (section 2.8).

**What I need from you.** The decisions in section 9, in order. The first two unblock everything: approve this note, and approve the licence exception for the build engine. The third unblocks the demo-server decision. The model key is needed before the skeleton can make its first model call.

**What this note does not do.** It gives no dates. It does not say the system is secure, ready or reviewed. Section 6 says what is protected in Stage 1 and what is not, and the register in `docs/KNOWN-GAPS.md` is already fourteen entries long.

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
| Acceptance runner | Runs the checklist against the running app | Separate process. Never sees the engine's conversation |
| Preview proxy | Lets the user open the running app | Read-only path to the app container |
| Project store and event log | Projects, briefs, plans, steps, checks, usage. Append-only events | PostgreSQL. Events are never updated or deleted |
| Exporter | Hands over the app as a repository that runs alone | Produces a git repository with the acceptance checks inside it |

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
- Permission mode `dontAsk`. Allowed tools: read, edit, write, glob, grep, and shell commands limited to the project's package manager, test runner and formatter. Denied: web search, web fetch, and any edit under the protected paths (the acceptance checks, the sign-in and role code, the quality-rule machinery). Protected paths are also mounted read-only, so the operating system enforces what the permission rules state.
- Hooks: a `PreToolUse` hook that writes every tool call to the event log and denies anything touching a protected path; a `Stop` hook that records the session's usage.
- `ANTHROPIC_BASE_URL` points at the gateway. The container holds no key. The gateway adds the key, records the usage from each response, and refuses the call if the project's cap is reached.
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
- The egress proxy allows exactly two destinations: the model gateway and the package registry for the chosen stack. Everything else is refused and logged. This replaces the secure-deployment guide's `--network none` plus Unix socket, which is the stronger pattern; the difference is recorded as gap 14 in `docs/KNOWN-GAPS.md` and the sandbox manager's interface allows the stronger pattern later.
- Engine and app containers run as a non-root user with `--cap-drop ALL`, `--security-opt no-new-privileges`, a memory limit, a process limit, and a read-only root filesystem with a writable workspace mount. **Measured:** all of these flags, including the read-only root, work on the development machine.
- The engine's workspace is the project's git checkout. Protected paths are a separate read-only mount.
- The user's text and uploaded spreadsheet are untrusted input. They enter the engine only as files in the workspace and as quoted text inside the optimiser's instruction template, never as instructions in their own right.

**Development finding that changes the picture (measured).** In a cloud development session, the machine reaches the internet only through a proxy on its own loopback address. A container on Docker's default network has no internet at all, and the proxy cannot be reached from a bridge network. The only working arrangement is: the container shares the host's network, receives the proxy address, and has the proxy's certificate mounted. That means **in development the project containers are not network-isolated from the host.** It is acceptable with made-up data and no key in the container. It is recorded as gaps 1 and 2 in `docs/KNOWN-GAPS.md`. On a demo server there is no such proxy, and the egress-proxy design above applies as written. The sandbox manager must therefore have two profiles, `development-cloud-session` and `server`, and the design note of each milestone says which one its evidence was produced under.

Later stages: the secure-deployment guide compares containers, gVisor and virtual machines, and says virtual machines are not automatically more secure than gVisor. E2B is Apache-2.0 and self-hostable on a single Linux host with KVM, or on GCP, AWS and Azure (verified). The sandbox manager's interface is: create project sandbox, start service, run command, mount path, destroy. Plain Docker, gVisor's runtime, or E2B can sit behind it.

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

All licences above were verified today against each project's own repository or package index (`docs/SOURCES.md`). Every one is permissive. htmx's "Zero-Clause BSD" is a BSD-family licence and permissive; I list it so the owner sees it.

How the criteria fall, before measurement:

| Criterion | Leans to |
| --- | --- |
| Quality rules true by construction | P. Django's documentation states a built-in authentication system with users, groups and permissions, form and field validation, and migrations (verified). Who-and-when stamps are a convention in both. In Next.js each is a library or a convention the template must impose |
| Acceptance score and model cost on example 1 | Unknown until measured. Models write both well; Next.js has the larger body of recent code |
| Standard PostgreSQL, containers, permissive licences | Both |
| Maintained and widely used; engineers hireable | Both. Django is older and changes less; Next.js changes more |
| Translation and right-to-left | P built in; T needs next-intl and care with layout |
| One language across builder and apps | T if the builder is TypeScript. The Agent SDK exists in both languages, so the builder could be Python and match P |
| Phone-screen use (rule 10) | Both, with Tailwind |

My prior is that **P wins "true by construction" and T wins "the model writes it fluently"**, and that the measurement will be closer than either side expects. I do not recommend either before the skeleton. I do recommend that the **builder's own language follow the winner**, so that one reviewer can cover both.

Ruby on Rails (MIT) was considered as the batteries-included candidate and set aside: it would add a third language to the project with no advantage over Django on the criteria. React Router v8 (MIT) was considered against Next.js and set aside for the same reason the handover gives: breadth of use, so the model writes it reliably.

### 2.7 Decision E: independent acceptance

**Position: agree, and make the separation physical.**

- The acceptance checklist is written by the analyst from the confirmed brief, before any code exists, as numbered items in the app spec: what the user does, what they should see.
- Each item becomes a Playwright test. The tests are **generated by a separate model call through the gateway**, from the checklist and the app spec only. That call never sees the engine's conversation, and the engine never sees the tests: they live under `acceptance/`, a path the engine's permission rules deny and that is mounted read-only in the engine's container.
- The acceptance runner is a separate container that sees the running app and the `acceptance/` directory. It records a screenshot per item and Playwright's trace, and writes pass or fail per item to the event log. A check is reported as passed only when it ran and passed; a check that did not run is reported as "did not run", never as passed.
- If a check is wrong, the fix goes back through the analyst as a change to the brief, which regenerates the checklist and the tests. Nobody edits a test by hand.
- `acceptance/` travels with the export, so the customer can run the same checks.
- The user's own sign-off is recorded as an event and is the final approval. Automated checks make it quick; they do not replace it.

### 2.8 Decision F: staying adaptable

**Position: agree with the two seams, the profiles and certification by the protocol. One recommendation on which second engine, and two cautions.**

The handover separates two things that are often confused: the **model source** (who serves a model: Anthropic directly, a router, or a cloud inside the UAE) and the **build engine** (the agent that writes code). A router alone does not make the builder adaptable, because the Claude Agent SDK can only drive Claude models (the handover records Anthropic's statement that routing Claude Code to non-Claude models through a gateway is not supported; today's check of that page is in `docs/SOURCES.md`).

How the design already carries the two seams:

| Seam | Where it is in this note | What Decision F adds |
| --- | --- | --- |
| Model gateway | Section 2.1 and 2.4. The only route to the model; meters usage; the engine's container reaches it via `ANTHROPIC_BASE_URL` | It must also speak the OpenAI-compatible format, because the analyst, optimiser and acceptance writer are plain model calls that could go to any provider, and because a second engine would speak that format. One gateway, two dialects, one meter |
| Build engine interface | Section 2.4: start a step, stream progress, stop, report usage | Named explicitly as the second seam: one step's instruction and a workspace in; changes, events and usage out. Any engine adapter implements exactly that |

**Profiles.** A profile is a named bundle: one engine adapter, one model per role (analyst, optimiser, acceptance writer, engine), and the endpoints each may reach. The gateway enforces the endpoints; the event log records the profile on every project; the test protocol's results are stored per profile. Stage 1 has one profile, `standard`. A `uae-only` profile is defined as a shape with no contents until a model and endpoint that process inside the country are verified, which today they are not (section 2.9, point 3).

**Which second engine for the gate.** The handover names two candidates: OpenAI's Codex SDK, and a loop of our own for open models.

| Option | For | Against |
| --- | --- | --- |
| **A loop of our own against an OpenAI-compatible endpoint. Recommended.** | It is the engine a `uae-only` profile would need, since the in-country provider named in the handover exposes that format. It has no vendor licence question. It can be pointed at any provider that speaks the format, including Anthropic's own models for a like-for-like comparison | More work: file tools, shell handling and a turn loop must be written, kept small, and reviewed. The result will be weaker than a mature agent, and the comparison must say so |
| OpenAI's Codex SDK | Same shape as the Claude Agent SDK: its README says it "wraps the codex CLI" and "spawns the CLI and exchanges JSONL events over stdin/stdout" (verified). Package `@openai/codex-sdk`, Apache-2.0 (verified). A mature agent | A second provider account, key and spend line. It answers "does the seam work" but not "can the builder run on an in-country model" |

Recommendation: the loop of our own, kept deliberately small, used for the two gate examples and labelled with its measured score and nothing more. If the owner prefers the Codex SDK for a quicker proof, the adapter is thin and the recommendation does not block it; the licence check comes first either way.

**Two cautions.**

1. Engine-neutral assets cost discipline, not code. The analyst, question bank, template, generators, quality gate and acceptance checks must never carry an instruction phrased for one model. The optimiser's rule slots (B4) are the one place engine-specific phrasing is allowed, and they are stored per profile. This is checked in review, not by a tool.
2. The handover's point that "the more the template and generators do, the less the result depends on the strength of the model" strengthens the proposal in section 2.3 to move the data step to a deterministic generator early. A weaker in-country model is exactly the case where a generator pays.

Gate item 9 (two test examples built with a second engine, difference reported) becomes milestone 7b in section 8.

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
- **Network policy.** Package registries, GitHub, Anthropic and the Claude documentation sites are reachable, and since the owner's approval on 11 November so are the nineteen research sites listed in `docs/OPEN-DECISIONS.md`. Containers need the host network and the proxy's certificate (section 2.5).

The repository is the only memory between sessions. `docs/STATUS.md` is updated at the end of every session.

### 4.2 Test

The same machine, with the test harness. The harness takes an example number and a run type (raw, brief, tuned), drives the analyst with the example's answer sheet, runs the build, runs the acceptance checks, and writes one row of the protocol's table plus the evidence files to `evidence/` in the repository. It is resumable: a run that is cut off is re-run from its last completed step.

GitHub Actions can run the harness's quick checks on every pull request (lint, unit tests, licence check). Whether it can run full builds depends on minutes and on the model key, which should not be in a shared CI secret in Stage 1. Full protocol runs stay on the development machine until the demo server exists. **Assumption:** the repository's Actions minute allowance was not checked today.

### 4.3 Demo

One small server with Docker, a web address, and a login in front of the builder. The owner opens it in a browser. Requirement: about 4 processors, 8 GB memory, 80 GB disk, Linux. Rationale: the hosting guide's floor is 1 GiB per agent; one project at a time needs the builder, one engine, one app, one database, one acceptance runner, and the egress proxy. 8 GB leaves room for two projects at once.

**Prices, read from the providers' own pages on 11 November 2026** after the owner allowed the sites. Where a provider's price table is drawn by a script in the browser and not present in the page itself, this session could not read it, and the row says so rather than carrying a number from elsewhere.

| Option | Location | Price from the provider's page | Notes |
| --- | --- | --- | --- |
| **Hetzner CPX32**: 4 AMD vCPU, 8 GB, 160 GB NVMe | Germany (Falkenstein, Nuremberg), Finland (Helsinki), USA (Hillsboro, Ashburn), Singapore. **No UAE location** (verified) | **€30.49 per month excl. VAT**, €0.0489 per hour. "Your server's bill will never exceed its monthly price cap" | Verified. The cheaper CX33 (4 vCPU, 8 GB, 80 GB) is €8.99 per month but shown as "currently not available" |
| **DigitalOcean Basic Droplet**: 4 vCPU, 8 GiB, 160 GiB SSD | Regions named on the page include Amsterdam, Atlanta, Bangalore, Frankfurt, London, Singapore, Sydney, Toronto. No UAE | **$48.00 per month**, $0.07143 per hour | Verified |
| **Oracle Cloud VM.Standard.E4.Flex**: 2 OCPU (4 vCPU), 8 GB | **Dubai and Abu Dhabi regions confirmed** on Oracle's own region page (verified) | Not readable: Oracle's compute price table is drawn by a script and the page refuses this session's requests. A search snippet earlier gave $0.032765 per OCPU-hour and $0.0019659 per GB-hour, about $59 per month at those rates; **unverified** | The one option with a UAE region whose rate was seen anywhere. The owner can read the price in a browser at oracle.com/ae/cloud/compute/pricing |
| **AWS EC2 t3.large or t4g.large** | **Middle East (UAE), me-central-1, confirmed** on AWS's region page (verified) | Not readable: the on-demand price table is drawn by a script | The owner can read it in a browser with the UAE region selected |
| **Azure B2ms** | **UAE North and UAE Central confirmed** on Azure's geographies page (verified) | Not readable: the price table is drawn by a script | Same |
| UAE-based providers (Core42, Khazna, Moro Hub) | UAE | Core42 publishes no public price for a small machine (verified). Khazna's and Moro's sites did not answer this session | Enterprise pricing on request |
| Hosted sandbox service (E2B cloud or similar) | Varies | Not checked | Stage 1 alternative only, behind the sandbox manager's interface. Would not give the owner a web address for the builder itself |

**Recommendation.** For the Stage 1 demo environment, which holds the builder and made-up data only: **Hetzner CPX32 at €30.49 per month excl. VAT**, hourly billed, because its price is verified from the provider's page and it is the lowest. Its servers are in Europe, the USA and Singapore, not the UAE. If the owner wants to say during the demo that the demo server itself is in the UAE, Oracle's Dubai region or AWS's UAE region are confirmed to exist, and the owner reads the price in a browser before approving it. Nothing is created until the owner says yes to a named option and its price (hard rule 4). The question is in `docs/OPEN-DECISIONS.md`.

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

| Model | Input | Cache hit | Output |
| --- | --- | --- | --- |
| Claude Opus 5.5 | $4.00 | $0.20 | $20.00 |
| Claude Sonnet 5.5 | $2.00 | $0.10 | $10.00 |
| Claude Haiku 5.5 (prompts up to 100k tokens) | $0.10 | $0.01 | $0.50 |

### 5.3 What is unknown until measured

Everything that matters: tokens per step, steps per app, retry rate, and cache hit rate. Any figure for "cost per app" written today would be invented. To show the shape of the arithmetic, not a prediction: **if** a step read 200,000 tokens with no cache hits and wrote 10,000 tokens on Opus 5.5, it would cost $0.80 plus $0.20, so $1.00, and a twelve-step build with two retries would cost about $14. **If** the template reads hit the cache, the same step's input would cost $0.04 instead of $0.80. The skeleton measures which of these worlds we are in.

### 5.4 How the skeleton measures it

- The gateway records, for every call: project, step, model, input tokens, cache-read tokens, cache-write tokens, output tokens, and the cost computed from a price table checked into the repository with its date.
- The skeleton's report shows the cost of the whole build, per step, and per model, for each candidate stack.
- The test protocol adds a column for cost per run, as B5 requires.

### 5.5 The per-project cap

- Each project has a cap in dollars, set when the project is created, with a default the owner chooses (section 9).
- The gateway sums the project's recorded cost before every call. If the next call would exceed the cap, the gateway refuses it and the orchestrator shows the user: "This project has reached its budget of $X. Nothing more will be built until the budget is raised." The step is marked failed with the reason named. No silent degradation.
- Every engine call also carries a turn limit, because the SDK has no overall timeout (verified).
- The owner sets a monthly spending limit in the Anthropic Console as the outer cap. The plan's monthly API credits ($100 on Max, $200 on Ultra, verified) are spent first.

---

## 6. Security position for Stage 1

Stage 1 is a single-user prototype with made-up data. It is **not secure, not reviewed and not ready**, and no document or screen will say otherwise. This section says what is protected, what is not, and what a reviewing engineer should see first.

### 6.1 Protected

| What | How |
| --- | --- |
| The model key | Held by the gateway process only. Never in a project container, never in the repository, never in logs or screenshots. On the development machine it is an environment variable on the owner's personal cloud environment with our own name, `BUILDER_MODEL_API_KEY` |
| Spend | Per-project cap in the gateway; turn limit per engine call; monthly limit in the Console |
| The acceptance checks | Denied to the engine by permission rule and by a read-only mount; generated by a separate process; reported passed only when run |
| The sign-in and role code, the quality-rule machinery | Same protection as the acceptance checks |
| The host machine | Engine and app run in containers as a non-root user with capabilities dropped, memory and process limits, read-only root filesystem |
| Outbound traffic from project containers, on a server | Internal Docker network plus an egress proxy that allows only the gateway and the package registry |
| The record | Append-only event log; every model call, tool call, approval and check result |
| Dependencies | Pinned versions; automated licence check in the quality gate; licences recorded |

### 6.2 Not protected in Stage 1, and said so

| What | Why not yet |
| --- | --- |
| Isolation between customers | One customer, one installation. Stage 2 |
| Network isolation of project containers on the development machine | Host network is required there (section 2.5). Development only, made-up data only |
| Hardened kernel isolation (gVisor, virtual machines) | Plain Docker in Stage 1. The interface allows a swap |
| The builder's own login | A single password in front of the demo server. Not single sign-on, not hardened |
| Secrets management | Environment variables, not a vault |
| Password handling in generated apps | A maintained library, not reviewed by an engineer yet |
| Real data of any kind | Prohibited in Stage 1 |
| An independent review | Not yet done. Required before any technical pitch, any real data, or any second customer |

### 6.3 First entries for the known-gaps register

Written to `docs/KNOWN-GAPS.md` today, fourteen entries: host networking in development sessions (gaps 1 and 2); the key never entering a container, with a note to record any shortcut before taking it (3); environment variables readable by environment users (4); Docker Hub rate limits (5); password handling in the template (6); no verified in-country model processing for the UAE (7); the SDK's commercial licence (8); no SDK session timeout (9); session pause and command limits (10); `CLAUDE.md` is not enforcement (11); pricing pages unreachable (12); several documentation hosts unreachable (13); the egress proxy is weaker than the guide's no-network pattern (14).

---

## 7. Walking skeleton

### 7.1 The slice

The thinnest path from a fixed brief to a running app with one acceptance check and a measured cost, on each candidate stack.

1. **Fixed brief.** The worked mapping for example 1 in `docs/spec/B2-question-bank.md` is written by hand as an app spec: three roles, the leave-request entity with its fields, two screens, two actions, one rule, and the acceptance items from "Done means". The analyst is not involved; its conversation is a later milestone.
2. **Template.** A minimal house template for the stack: sign-in with email and password, three seeded sample users with roles, one protected page per role, who-and-when stamps on every table, a Mailpit mail catcher, and the licence check. Only as much of the ten rules as the two steps below need.
3. **Sandbox.** The sandbox manager creates the project's containers from the template under the `development-cloud-session` profile.
4. **Gateway.** The gateway runs outside the containers, holds the key, records usage and enforces a cap set deliberately low for the first run so the cap is seen to work.
5. **Two engine steps.** The optimiser is a fixed template for now. Step one: the data step, creating the leave-request table and migration. Step two: the submitter's screen, a list of my requests and a form to add one, with validation. Each step is one SDK call with a turn limit, `dontAsk` mode, the allow list, the deny list, and the logging hook. The user's approval between steps is a prompt in the harness.
6. **One acceptance check.** Generated by a separate call from the app spec's first acceptance item: an employee signs in, submits a five-day request, and sees it in their list with status "waiting". Run by Playwright in its own container against the running app. Screenshot recorded.
7. **Export.** The project's repository is copied out, the builder is stopped, and the app is started from the export with its one documented command on the same machine. The acceptance check runs against it again.
8. **Report.** One page per stack: screenshots, the acceptance result, the event log's row count, and the cost per step and in total for each of the two models tried.

### 7.2 What it proves

| Claim | Evidence in the report |
| --- | --- |
| The engine builds on the template inside a container | The step's commit in the project repository; the tool-call log |
| The key never enters the container | The container's environment and filesystem inspected after the run, with the inspection command and its output |
| Every model call goes through the gateway and is metered | The gateway's usage rows match the SDK's reported usage for each call |
| The cap stops a build | A run with the cap set below the second step's cost, and the named failure shown |
| The acceptance check is independent | The check's generation log shows its inputs: app spec and app address only. The engine's deny list and mount show `acceptance/` is unreachable |
| The export runs alone | The app started from the export with the builder stopped, and the check passing against it |
| The development machine suffices | Wall-clock time of the whole run, memory peak, and disk used |
| Which stack and which model | Acceptance result, rule compliance by inspection, and cost, side by side |

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
| 7b | **Second engine** (gate item 9) | Two test examples built through the second engine adapter, scored against the same acceptance tests as their tuned runs, with the difference in score and cost reported plainly and no claim beyond what was measured |
| 8 | **Demo** | The demo environment running the builder behind a login; the chosen demo candidate built live end to end and changed twice; the rehearsed script; a labelled recording as fallback |
| 9 | **Gate review** | Each Stage 1 gate item in `HANDOVER.md` section 6 marked done with its evidence, and `docs/KNOWN-GAPS.md` current with the reviewing engineer's starting points |

The spreadsheet upload (in scope for Stage 1) joins at milestone 2, because it is an input to the analyst. The run-through mode for demonstrations, if the owner wants it, joins at milestone 8.

---

## 9. Decisions needed from the owner

In order. One at a time. Each has a recommendation and its reason. Answers are recorded in `docs/DECISIONS.md`.

**1. Approve this design note?**
- (a) Approve as written; start the walking skeleton. **Recommended.** Reason: it commits to nothing irreversible, and every open point is measured by the skeleton rather than argued.
- (b) Approve with changes. Say which.
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

**11. Which second engine for gate item 9?**
- (a) A small loop of our own against an OpenAI-compatible endpoint. **Recommended.** Reason: it is the engine a UAE-only profile would need, and it has no vendor licence question. Its weakness is reported as measured.
- (b) OpenAI's Codex SDK. Quicker proof of the seam; its repository is Apache-2.0; needs a second provider account and spend line; does not answer the in-country question.
- (c) Both, if the budget allows after the protocol's trial run.

Not asked now: the product name (no rush; `builder` until then), the pass target for the protocol (set after the trial run, as the handover says), the legal owner (Ahmed Sharara personally for now), and the default model (measured in the skeleton, not decided).
