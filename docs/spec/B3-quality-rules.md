> Living specification. Cut unchanged from HANDOVER.md Part B on 11 November 2026. Change only with the owner's agreement, and record the change in docs/DECISIONS.md.

## B3. Quality rules (version 1)

These apply to every build. The numbers are referred to by the question bank.

1. Every form validates its inputs and says what is wrong in plain words.
2. Every list has an empty state that tells the user what to do first.
3. Every action that can fail has an error message the user can act on.
4. Every record carries who created it and when, and who last changed it and when.
5. Every screen checks the user's role before showing anything.
6. Nothing destructive happens without a confirmation.
7. No credentials, keys or secrets in the application code or visible to users.
8. Every number shown has a stated source and a stated period.
9. Exports and reports show the filters that produced them.
10. The tool works on a phone screen for anything a user would do away from a desk.

For the design note: say how each rule is made true in the template, and which automated check proves it.
