# Open decisions for the owner

Bring these to the owner one at a time, as multiple-choice questions with a recommendation and its reason. When one is decided, move it to `docs/DECISIONS.md`. The design note (`docs/design/stage-1.md`, section 9) carries the questions in full with the recommendations.

## From the handover (section 14)

1. **Product name.** Until then, `builder`.
2. **English and Arabic from the first version?** Proposal: yes. Translation and right-to-left layout are cheap to put in the template now and costly to add later, and the buyers are in the UAE.
3. **Step approvals during a demonstration.** The specification has the user approve every step. Should a rehearsed demonstration be allowed to run to the end without stopping? Proposal: keep step approval as the default, and offer a run-through mode only for demonstrations.
4. **Which demo candidate first:** D1, D2 or D3 in `docs/spec/B6-demo-candidates.md`.
5. **Pass target for the test protocol.** The owner sets it after a trial run of the first two examples, and before the full protocol starts.
6. **Demo environment and its cost,** after the price options have been shown. Blocked: see item 11.
7. **Monthly spending limit for model usage.**
8. **Reviewing engineer:** who, and at which milestone.
9. **Legal owner of the code.** Ahmed Sharara personally for now. A company later.

## Added on 11 November 2026

10. **Approve the Stage 1 design note** (`docs/design/stage-1.md`), or say what to change. Nothing is built until it is approved.
11. **Allow the network hosts needed to read provider pricing pages.** The session's network policy blocks them, so no price could be fetched from a provider's own page. Hosts needed: `www.hetzner.com`, `www.digitalocean.com`, `aws.amazon.com`, `docs.aws.amazon.com`, `azure.microsoft.com`, `learn.microsoft.com`, `docs.cloud.google.com`, `www.oracle.com`, `www.core42.ai`, `www.khazna.ae`, `www.moro.ae`. Also useful for verification: `docs.djangoproject.com`, `www.postgresql.org`, `www.npmjs.com`, `e2b.dev`, `openai.com`, `privacy.anthropic.com`. The owner can allow them in the cloud environment's network settings, or fetch the prices himself and paste them, or accept the indicative figures in the design note (which came from search results, not from the pricing pages, and must be re-checked before any spend).
12. **Licence exception for the Claude Agent SDK.** Hard rule 2 allows permissive licences only unless the owner approves an exception in writing. The Agent SDK's TypeScript package is governed by Anthropic's Commercial Terms of Service, which is a commercial licence, not a permissive open-source one. The Python package is marked MIT on PyPI, with the same Commercial Terms stated in its documentation. Using the SDK as the build engine needs the owner's written approval of this exception. The handover's decision "Build with Claude Code" implies it, but it should be explicit.
13. **Model key.** Create an API key in the owner's own Anthropic Console account, set a monthly spending limit there, and add the key as the environment variable `BUILDER_MODEL_API_KEY` on the owner's personal cloud environment. Never paste it into the conversation. Before paying for usage, claim the monthly API credits that come with the Max, Ultra and Team plans (verified today: Max $100 per month, Ultra $200 per month, Team $20 or $100 per seat pooled, no rollover; the Console organization must be linked to the plan).
14. **Default model for the build engine.** Proposal: measure two in the walking skeleton, Claude Opus 5.5 and Claude Sonnet 5.5, and choose on acceptance score and cost. No decision needed before the skeleton.
15. **Which second engine for gate item 9** (added by the owner's edited handover, Decision F). Proposal: a small loop of our own against an OpenAI-compatible endpoint, because it is what a UAE-only profile would need. Alternative: OpenAI's Codex SDK (repository Apache-2.0, verified today). Design note, section 9, question 11.
