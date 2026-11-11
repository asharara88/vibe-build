# Sources

Every outside fact this project relies on, with the link and the date it was checked. Re-check before relying on any of them. A fact marked **search result** came from a search engine's result snippet, not from the page itself, and must be re-checked against the page before it is used for a decision.

## Verified 11 November 2026 (this session, against the live page)

| Fact | Source |
| --- | --- |
| The Claude Agent SDK gives "the same tools, agent loop, and context management that power Claude Code", in Python and TypeScript, with built-in tools, hooks, subagents, MCP, permissions, sessions, skills and plugins | [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) |
| Use of the SDK "is governed by Anthropic's Commercial Terms of Service, including when you use it to power products and services that you make available to your own customers and end users" | Agent SDK overview; [SDK repository README](https://github.com/anthropics/claude-agent-sdk-typescript) |
| "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products." API-key authentication is used instead | Agent SDK overview |
| Branding: allowed forms are "Claude Agent", "Claude" inside a menu labelled "Agents", and "{YourAgentName} Powered by Claude". Not permitted: "Claude Code", "Claude Code Agent", or Claude Code visuals. A bare "Powered by Claude" is not among the listed forms | Agent SDK overview |
| Managed Agents is "a hosted agent harness that runs the agent loop, with sessions in an Anthropic-managed cloud sandbox or a self-hosted sandbox on your own infrastructure". Sessions "store conversation history, sandbox state, and outputs server-side". Not eligible for zero data retention | Agent SDK overview; [Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview) |
| "One agent session maps to one subprocess", which "owns the shell, the working directory, and the JSONL session transcripts on local disk" | [Hosting the Agent SDK](https://code.claude.com/docs/en/agent-sdk/hosting) |
| "1 GiB RAM, 5 GiB disk, and 1 CPU per agent is a reasonable starting point"; the 1 GiB "is a floor, not the ceiling" | Hosting the Agent SDK |
| "No top-level session timeout." Set `maxTurns` (TypeScript) or `max_turns` (Python) | Hosting the Agent SDK |
| Set `ANTHROPIC_BASE_URL` "to route model calls through a proxy that injects the key outside the container" | Hosting the Agent SDK; [Secure deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment) |
| "Anthropic token cost typically dominates container infrastructure cost by an order of magnitude or more. A minimally provisioned container runs roughly $0.05 per hour" | Hosting the Agent SDK |
| Serving several customers from one container: `settingSources: []`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, a per-tenant `CLAUDE_CONFIG_DIR`, an explicit `cwd` per tenant, per-tenant egress rules at the proxy | Hosting the Agent SDK |
| Isolation options compared: sandbox runtime, containers, gVisor, virtual machines, with isolation strength, overhead and complexity for each. VMs "aren't automatically 'more secure' than alternatives like gVisor" | Secure deployment |
| Hardened Docker example: `--cap-drop ALL`, `--security-opt no-new-privileges`, seccomp profile, `--read-only`, tmpfs for `/tmp` and home, `--network none`, `--memory 2g`, `--cpus 2`, `--pids-limit 100`, `--user 1000:1000`, read-only code mount, proxy over a mounted Unix socket; also `--userns-remap`, `--ipc private` | Secure deployment |
| `ANTHROPIC_BASE_URL` covers only sampling requests; `HTTP_PROXY`/`HTTPS_PROXY` cover other traffic | Secure deployment |
| Permissions: modes `default`, `dontAsk`, `acceptEdits`, `bypassPermissions`, `plan`, `auto`; `allowedTools`/`disallowedTools` (a bare name in `disallowedTools` removes the tool entirely); `Edit(path)` deny rules; a `PreToolUse` hook can deny a call in every mode including `bypassPermissions`; "for a locked-down agent, pair `allowedTools` with `permissionMode: 'dontAsk'`" | [Configure permissions](https://code.claude.com/docs/en/agent-sdk/permissions) |
| Cloud sessions: "each session gets a fresh virtual machine (VM) running Ubuntu 24.04 on x86_64"; installed: docker, dockerd, docker compose, PostgreSQL 16, Redis 7.0, Node.js 20 to 22, Python 3.x; approximate ceilings 4 vCPU, 16 GB RAM, 30 GB disk, which "may change over time" | [Cloud environments](https://code.claude.com/docs/en/cloud-environments) |
| Default network access is "Limited" with "Allow package managers" on; environment variables: "Anyone who uses the environment can read the values"; the agent proxy never attaches a network secret to requests to api.anthropic.com or public package registries | Cloud environments |
| Command time limits: foreground commands wait 2 minutes by default and can ask for up to 10; a timed-out command moves to the background for up to 30 more minutes; `BASH_DEFAULT_TIMEOUT_MS` raises the default | Cloud environments |
| "After a few minutes without activity, a session's VM pauses with its files saved." Sessions stop after a period of inactivity and the VM is reclaimed. Restored: conversation history. Not restored: background work still running | Cloud environments; [Cloud sessions](https://code.claude.com/docs/en/claude-code-on-the-web) |
| Neither cloud documentation page states whether a web service running inside a session can be opened from outside | Cloud environments; Cloud sessions |
| `CLAUDE.md` is loaded at the start of every conversation; target under 200 lines; "Claude treats CLAUDE.md files as context, not enforced configuration"; use a `PreToolUse` hook to block actions | [Memory](https://code.claude.com/docs/en/memory) |
| Max, Ultra and Team plans include monthly API credits (announced 7 October 2026) covering the Claude API, Managed Agents and the Agent SDK when run with an API key from the linked Console organization | [Support article 15036540](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) |
| Credit amounts: Max $100 per month, Ultra $200 per month, Team $20 per Standard seat and $100 per Premium seat pooled, pool cap $500. No rollover. Claim after seven days on the plan. One Console organization per plan. Not covered: interactive Claude Code, Bedrock, Vertex AI, Foundry | [Support article 17154008](https://support.claude.com/en/articles/17154008) |
| Model prices (USD per million tokens; base input / cache hit / output): Claude Fable 5.2 $8 / $0.20 / $40; Claude Opus 5.5 $4 / $0.20 / $20; Claude Sonnet 5.5 $2 / $0.10 / $10; Claude Haiku 5.5 $0.10 / $0.01 / $0.50 for prompts up to 100,000 tokens. Batch processing is half price | [Pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Anthropic's data-residency controls: inference geography is "global" (default) or "us" only; workspace geography is "us" only. No Middle East option is stated | [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency) |
| Managed Agents self-hosted sandboxes: "tool execution and the sandbox filesystem stay on infrastructure you control"; attached memory-store contents remain stored by Anthropic | Managed Agents overview; Data residency |
| Agent SDK packages: TypeScript `@anthropic-ai/claude-agent-sdk` 0.3.322, licence field "SEE LICENSE IN README.md" (the README points to the Commercial Terms); Python `claude-agent-sdk` 0.2.180, PyPI licence "MIT License", released 9 Nov 2026 | `npm view` from this session; [PyPI](https://pypi.org/project/claude-agent-sdk/); SDK repository README |
| E2B runtime and control plane: Apache-2.0; "E2B Embed is the whole stack on a single Linux host with KVM"; Terraform for GCP, AWS and Azure, and a Kubernetes manifest | [E2B repository](https://github.com/e2b-dev/infra) |
| gVisor: Apache-2.0; an application kernel that isolates containers from the host kernel | [gVisor repository](https://github.com/google/gvisor) |
| Dyad: Apache-2.0 outside `src/pro`; `src/pro` is under the Functional Source License 1.1; a local app that runs "right on your machine" for Mac or Windows | [Dyad repository](https://github.com/dyad-sh/dyad) |
| Candidate components, licence and version (from the project's own repository or package index): Next.js MIT v16.4.6; React Router MIT v8.5.1; Drizzle ORM Apache-2.0 0.45.4; Prisma Apache-2.0 7.10.1; better-auth MIT v1.7.20; Auth.js ISC 4.24.15 (its repository recommends new projects start with Better Auth); next-intl MIT v4.14.10; Tailwind CSS MIT v4.3.5; shadcn/ui MIT; Zod MIT v4.6.7; Hono MIT v4.13.17; Django BSD-3-Clause 6.1.3 and 5.2.19 LTS; django-allauth MIT 65.21.1; Django REST framework BSD-3-Clause 3.18.3; htmx Zero-Clause BSD v4.0.1; Ruby on Rails MIT 8.1.4.1; Playwright Apache-2.0 v1.65.0; Mailpit MIT v1.33.1; pip-licenses MIT 5.5.5; license-checker-rseidelsohn BSD-3-Clause 5.0.1; Fastify MIT v5.12.8; Vitest MIT v5.1.0 | Each project's GitHub repository or PyPI/RubyGems page, 11 Nov 2026; `npm view` for license-checker-rseidelsohn |
| "Anthropic doesn't endorse, maintain, or audit third-party gateway products, and doesn't support routing Claude Code to non-Claude models through any gateway." `ANTHROPIC_BASE_URL` points Claude Code at a gateway; `allowedProviders: ["customEndpoint"]` in managed settings pins it there | [LLM gateways](https://code.claude.com/docs/en/llm-gateway) |
| "OpenRouter offers EU and US in-region routing." Regional base URLs are eu.openrouter.ai and us.openrouter.ai only. No UAE or Middle East region is mentioned | [OpenRouter sovereign AI](https://openrouter.ai/docs/guides/features/sovereign-ai) |
| OpenAI's Codex repository is licensed Apache-2.0 (sidebar and README). The `sdk/` directory's own terms were not read | [Codex repository](https://github.com/openai/codex) |
| PostgreSQL current major is 18 (tag REL_18_7, 9 Nov 2026). The licence name was not confirmed from postgresql.org (host not reachable); the mirror's COPYRIGHT file carries the PostgreSQL permissive notice | [PostgreSQL mirror](https://github.com/postgres/postgres) |

## From the handover, verified by the owner and not re-checkable from this session

| Fact | Source |
| --- | --- |
| Core42 Compass exposes an OpenAI-compatible API. Its release notes show some models running in the UAE and others in the US (owner, 11 Nov 2026). Host not reachable from this session | [Compass API reference](https://www.core42.ai/compass/documentation/compass-api-reference); [Compass release notes](https://www.core42.ai/compass/documentation/2025) |
| The Codex SDK embeds OpenAI's coding agent in an application by driving its command-line tool as a separate process (owner, 11 Nov 2026). Host not reachable from this session | [OpenAI announcement](https://openai.com/index/codex-now-generally-available) |

## From the handover, checked on 10 November 2026 and not re-checked today

| Fact | Source |
| --- | --- |
| Deployable examples for Docker and Kubernetes exist | [Hosting cookbook](https://github.com/anthropics/claude-cookbooks/tree/main/claude_agent_sdk/hosting) |
| Cloud sessions need a GitHub repository. A new project starts from an empty one | [Cloud sessions quickstart](https://code.claude.com/docs/en/web-quickstart) |
| Claude Code's auto memory is local to one machine and not shared across cloud environments (today's check confirmed the "per repository" scope in the page text; the "not shared across cloud environments" sentence was in a summary of the page, not read verbatim) | [Memory](https://code.claude.com/docs/en/memory) |
| bolt.diy: MIT, but depends on the WebContainer API, which needs a separate licence for commercial production use (secondary source only) | [Rapid Developers](https://www.rapidevelopers.com/blog/best-free-lovable-alternatives) |
| Self-hosting E2B is a real infrastructure project. Daytona went closed source in June 2026 | [Helix review](https://helix.ml/blog/self-hosted-agent-sandboxes) |
| Core42 Compass lists Anthropic among its model providers and states that data stays within the UAE. Which Claude models are offered is not stated. Host not reachable today | [Core42 AI Cloud](https://www.core42.ai/ai-cloud) |
| The UAE's data protection law has been in force since 2 January 2022. A law-firm note of June 2026 says its implementing regulations had not been issued. Host not reachable today | [Morgan Lewis](https://www.morganlewis.com/pubs/2026/06/uae-establishes-federal-authority-for-artificial-intelligence-and-data); [BusinessDubai](https://www.businessdubai.ae/blogs/uae-pdpl-data-protection) |

## Search results only, 11 November 2026 (not verified against the page; re-check before use)

| Fact | Source |
| --- | --- |
| Hetzner shared-vCPU plans are billed hourly or monthly with no minimum term. A June 2024 press release listed CX32 (4 vCPU, 8 GB, 80 GB) at €6.80 per month; snippets for current CPX plans were inconsistent | [Hetzner cloud](https://www.hetzner.com/cloud/); [press release](https://www.hetzner.com/press-release/new-cx-plans/) |
| DigitalOcean Basic Droplet 4 vCPU, 8 GiB, 160 GiB SSD: $48.00 per month | [Droplet pricing](https://www.digitalocean.com/pricing/droplets) |
| Oracle Cloud VM.Standard.E4.Flex: $0.032765 per OCPU-hour and $0.0019659 per GB-hour; Oracle has a UAE East (Dubai) region, named in its service-limits documentation | [Oracle UAE price list](https://www.oracle.com/ae/cloud/price-list/); [Oracle service limits](https://docs.oracle.com/en-us/iaas/Content/General/service-limits/default.htm) |
| AWS t3.large on-demand is listed at $0.0835 per hour with no region stated. No UAE-region price found | [EC2 T3 instances](https://aws.amazon.com/ec2/instance-types/t3/) |
| Azure B-family VMs "starting from $3.8 per month"; no UAE North price for B2ms found | [Azure VM series](https://azure.microsoft.com/en-us/pricing/details/virtual-machines/series/) |
| Amazon Bedrock: Claude models in the UAE region (me-central-1) are available only through the global cross-region inference endpoint, not in-region, so request data may be processed outside the UAE | [Bedrock regional availability](https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.html); [AWS blog on Middle East cross-region inference](https://aws.amazon.com/blogs/machine-learning/introducing-amazon-bedrock-global-cross-region-inference-for-anthropics-claude-models-in-the-middle-east-regions/) |

## Not verified. Treat as open questions

- Whether a service running inside a cloud session can be opened from outside it. The documentation does not say. A practical test was made at the end of this session (see `docs/STATUS.md`).
- Whether an environment variable holding an Anthropic key interferes with Claude Code's own connection in a cloud session. Not stated in the documentation. Using our own variable name, `BUILDER_MODEL_API_KEY`, avoids the question.
- Which Claude models can be used with processing inside the UAE, and through which provider. Anthropic's own options are US or global. Bedrock's UAE region appears to be global-routed (search result). Core42 unverified.
- Whether a self-hosted E2B runs on the cloud a buyer will require. E2B documents GCP, AWS and Azure.
- The WebContainer API's commercial terms, from the primary source. Only needed if bolt.diy is considered, and it is not.
- What the UAE's data law requires of this product. Design to its principles now. A UAE lawyer confirms before any real data is handled.
- Django's built-in support for authentication, permissions, form validation, migrations, translation and right-to-left layout. Widely known, but the documentation host was not reachable today, so it is recorded as an assumption until read.
