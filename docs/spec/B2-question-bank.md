> Living specification. Cut unchanged from HANDOVER.md Part B on 11 November 2026. Change only with the owner's agreement, and record the change in docs/DECISIONS.md.

## B2. Question bank (version 1)

The content the analyst reads from. For each of the seven brief sections: the questions it may ask, the closed options it may offer, and which option, if any, it may recommend and why.

- Version 1 was written from three worked examples: leave request, supplier onboarding, sales dashboard. It is expected to be thin.
- **R** marks a recommended option. Its reason may only be "builds reliably", "satisfies rule N" or "passed acceptance in N projects".
- **(H)** marks a hypothesis: "builds reliably" has not been measured yet. The test protocol (B5) tests it, and the mark is removed or the option changed on evidence.
- **Their call** means no recommendation is allowed, because the answer is the customer's own policy.
- Every "something else" answer is a candidate new option for version 2.

**Purpose**

| Question | Options | Recommendation |
| --- | --- | --- |
| What does this replace? | Email or chat threads · A spreadsheet · A paper or PDF form · Nothing, it is new · Something else | None; their call |
| Who feels the pain today? | The people who submit · The people who approve · The person who reports on it · All three | None; their call |

**Users and roles**

| Question | Options | Recommendation |
| --- | --- | --- |
| How many kinds of user? | One (everyone does the same thing) · Two (someone submits, someone approves) · Three (plus an admin who sees everything) · More | R: Two or three. Reason: builds reliably (H); more roles rarely needed for version one |
| Who can see other people's records? | Only their own · Their team's · Everyone's, for admins only · Everyone's, for all | R: Own, team for managers, all for admin. Reason: satisfies rule 5 |
| How do users sign in? | Company email (SSO) · Email and password · A shared link, no login | R: Company email. Reason: satisfies rule 5; rule 7. See B7 for Stage 1 |

**Data**

| Question | Options | Recommendation |
| --- | --- | --- |
| Where does the starting data come from? | Typed in by users · Uploaded once from a spreadsheet · Synced from a spreadsheet on a schedule · Connected to another system | R: Uploaded once, or synced if it changes weekly. Reason: builds reliably (H); live connections go to Later |
| For each record, which fields matter? | Shown as a checklist from the example's typical fields; customer ticks and adds | None; their call. The analyst proposes the typical list from the pattern |
| Does any field hold personal or sensitive data? | No · Yes, contact details · Yes, salary, ID or health | If yes: adds rule 5 and 7 checks and flags hosting inside the country as required |

**Screens**

| Question | Options | Recommendation |
| --- | --- | --- |
| What does a submitter need to see? | My items and their status · Plus a form to add one · Plus history | R: My items plus form. Reason: builds reliably (H) |
| What does an approver need to see? | A queue of items waiting for me · Plus my team's history · Plus totals | R: Queue plus history. Reason: builds reliably (H) |
| What does the admin or reporter need? | Everything in a table with filters · Plus charts · Plus export | R: Table with filters and export. Reason: satisfies rule 9; charts to Later unless the purpose is a dashboard |

**Core actions**

| Question | Options | Recommendation |
| --- | --- | --- |
| When someone submits, who is told? | Nobody · The approver by email · The approver in the app only · Both | R: Approver by email and in app. Reason: builds reliably (H) |
| When something is approved or rejected, what changes? | Only the status · Status plus a balance or count · Status plus a notification · All | None; their call. The analyst lists what the example usually changes |
| Can a submitter edit or withdraw after submitting? | No · Yes, until it is approved · Yes, any time | R: Until approved. Reason: satisfies rule 6 |

**Rules**

| Question | Options | Recommendation |
| --- | --- | --- |
| Who approves? | Direct manager · A named person · Manager then a second person · Nobody | None; their call |
| Is there a limit or threshold? | No · Yes, a number per person · Yes, a number per period · Yes, an amount that changes the approver | None; their call |
| What happens if a rule is broken? | Block it and say why · Allow it and flag it · Send it to a second approver | R: Block and say why. Reason: satisfies rule 1 |
| What must never happen? | Open text, one line | None; recorded verbatim |

**Done means**

| Question | Options | Recommendation |
| --- | --- | --- |
| How will you know it works? | I will walk one real case through it end to end · The numbers match my spreadsheet · My team uses it for a week without asking me | R: One real case end to end, written as steps. Reason: it becomes the acceptance test directly |
| Who signs off? | Me · Me and the approver · Me, the approver and one submitter | R: Me, the approver and one submitter. Reason: each role tests their own screen |

**Worked mapping, example one (leave request).** Replaces email · three roles (employee, manager, HR admin) · data typed in, employee list uploaded once · screens: my requests, team queue, HR table · submit notifies manager; approve updates balance and notifies employee; withdraw until approved · approver: direct manager (their call); threshold: annual balance (their call); over-balance blocks and says why · done: one employee submits five days, manager approves, balance drops by five, HR sees it.
