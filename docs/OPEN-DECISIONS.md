# Open decisions for the owner

Bring these to the owner one at a time, as multiple-choice questions with a recommendation and its reason. When one is decided, move it to `docs/DECISIONS.md`. Decided on 11 November 2026 and moved there: the design note, the Agent SDK licence exception, the network hosts, Arabic from the first version, step approvals in demonstrations, the reviewing engineer's timing, the two planning items, the `main` branch, and the second engine. Decided on 12 November 2026 and moved there: items 9 and 11 (the development packages and `caniuse-lite`, approved by name on conditions).

## Still open

1. **Product name.** Until then, `builder`.
2. **Which demo candidate first:** D1, D2 or D3 in `docs/spec/B6-demo-candidates.md`. The owner is undecided. Recommendation stands: D3, because the owner can judge every number himself and it shows rules 8 and 9. Not needed until the intake milestone; the walking skeleton uses test example 1.
3. **Monthly spending limit for model usage, and the default per-project cap.** The owner is on the Ultra plan ($200 of API credits a month, verified). Proposed: a $100 monthly limit in the Console and a $20 default project cap. The owner confirms the figures when creating the key.
4. **Pass target for the test protocol.** The owner sets it after a trial run of the first two examples, and before the full protocol starts.
5. **Demo environment and its cost.** Prices read on 11 Nov 2026 from the providers' pages (details in the design note, section 4.3). (a) **Hetzner CPX32**, 4 vCPU, 8 GB, 160 GB, €30.49 per month excl. VAT, billed hourly, in Germany, Finland, the USA or Singapore; no UAE. Recommended: the lowest verified price, and the demo server holds made-up data only. (b) **Oracle Cloud, Dubai region**: region verified; price table not readable by this session, so the owner reads it in a browser (a search snippet suggested about $59 a month for 2 OCPU and 8 GB). (c) **AWS, UAE region**: region verified; price to be read in a browser. (d) **DigitalOcean**, 4 vCPU, 8 GiB, $48.00 per month; no UAE. Nothing is created until the owner names an option and its price.
6. **Reviewing engineer: who.** The timing is decided (after the walking skeleton, and before the demo). The person is not.
7. **Legal owner of the code.** Ahmed Sharara personally for now. A company later.
8. **OpenAI account and spend for the Codex SDK** (gate item 9). The owner chose the Codex SDK as the second engine. Using it needs an OpenAI API account and key, and its usage is paid. Hard rule 4: the price and its source are shown before any sign-up, when the second-engine milestone comes. Not needed for the walking skeleton.

9. *Decided 12 November 2026: approved by name, for development use only, on conditions. See `docs/DECISIONS.md`.*

10. **Licence exception needed for the Django candidate (Decision D).** Django's PostgreSQL support requires the `psycopg` driver, which is under the GNU Lesser General Public License 3.0 (verified from PyPI, 11 Nov 2026). LGPL is a weak copyleft licence. An earlier wording here said an app may use the library and stay proprietary as long as it is kept separate; installing it separately does not by itself show the licence is met, and the LGPL text has not been read in this project. But it is not permissive, and the generated apps are installed on customers' infrastructure, so hard rule 2 needs the owner's written exception before the Django template is built. The TypeScript candidate's PostgreSQL driver `pg` is MIT; but that candidate is not free of LGPL either: its template carries LGPL packages through the image library `sharp` (found 12 Nov 2026, known gap 40; the current question is in `docs/STATUS.md`). The options and the current recommendation are in `docs/STATUS.md`, under the question on the second stack; the recommendation first written here (approve) is withdrawn. `psycopg` is not installed. LGPL packages of `sharp` are installed in the TypeScript template (known gap 40).

11. *Decided 12 November 2026: `caniuse-lite` approved by name for generated apps, on conditions. See `docs/DECISIONS.md`. An earlier wording of this item said the licence asks for credit "and nothing else"; that was too loose (`docs/reviews/2026-11-12-licence-recommendation.md`).*

## Requests to the owner, not choices

9. **Model key.** Create an API key in the Anthropic Console, set a monthly spending limit there, and add the key as the environment variable `BUILDER_MODEL_API_KEY` on the personal cloud environment. Steps are in `docs/design/stage-1.md`, section 9, question 7. Never paste the key into the conversation. Claim the Ultra plan's monthly API credits and link the Console organization to the plan first. *Not asked for now: under the build plan the key is created at checkpoint 1. See `docs/STATUS.md`, the question on `VIBEBUILD_KEY`, and Money.*
10. **Preview test.** Say whether the page titled "builder: preview test" was shown in the Claude app during the first session.

## Network hosts allowed on 11 November 2026 (for the record)

`www.hetzner.com`, `www.digitalocean.com`, `aws.amazon.com`, `docs.aws.amazon.com`, `azure.microsoft.com`, `learn.microsoft.com`, `docs.cloud.google.com`, `www.oracle.com`, `www.core42.ai`, `www.khazna.ae`, `www.moro.ae`, `docs.djangoproject.com`, `www.postgresql.org`, `www.npmjs.com`, `e2b.dev`, `openai.com`, `developers.openai.com`, `privacy.anthropic.com`, `www.morganlewis.com`. Proposed as an edit to the owner's personal Default environment; the owner approved the edit, and the hosts were in the environment's allowed list when it was read on 12 November 2026.
