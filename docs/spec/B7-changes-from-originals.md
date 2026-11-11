> Living specification. Cut unchanged from HANDOVER.md Part B on 11 November 2026. Change only with the owner's agreement, and record the change in docs/DECISIONS.md.

## B7. What changed from the 5 November originals

1. The originals were written to run as prompts in front of someone else's builder, ahead of a review of that builder's code. All references to that builder, to its review and to changes in its repository are removed.
2. The four questions the optimiser asked about that builder are now design requirements for ours (section 8.2).
3. The test protocol is now run by an automated harness with answer sheets, in place of a person pasting prompts. The field "evidence of a planning step" is dropped, because we design the planning step. A field for model usage and cost is added. Repeating the tuned run three times is added as a proposal.
4. The fourth use of the results changed: low-scoring or costly patterns now point to deterministic generators, where they used to point a code reviewer at the other builder.
5. Sign-in: the bank still recommends company email with single sign-on. Stage 1 can only offer email and password. Until single sign-on exists, the analyst shows it as "available later", records the choice in the Later list, and builds with email and password.
6. "Flags sovereign hosting as required" is worded as "flags hosting inside the country as required". In Stage 1 the flag is recorded on the brief and nothing more, because Stage 1 uses made-up data only.
7. The demo candidates in B6 are new.
8. Nothing else in the analyst's procedure, the recommendation logic, the question bank or the ten quality rules was changed.
