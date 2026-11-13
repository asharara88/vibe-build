# Third outside review, supplied by the owner, 13 Nov 2026 (verbatim)

The owner pasted this review into the session on 13 Nov 2026, after pull request #31 (package 1.4) was merged at `4e8354a`. It is kept here word for word; it is the reviewer's view, not a decision. The owner has not yet answered question 17.

---

Real progress, Ahmed—but I would still keep real-model spending blocked. I reviewed integration commit 4e8354a⁠￼, including code, tests and recorded evidence. I did not independently rerun the tests.

What has moved forward:

* Cap changes now check existing spending and reservations.
* Approved base images are pinned.
* Step budgets and failure-handling work have merged.
* Browser licensing is resolved. The acceptance runner has been built and exercised against a scripted app, including rejection of a deliberately broken app. It remains recorded as built, not tested. Current status⁠￼

My main challenge is the gateway’s recovery behaviour.

1. An unreadable fault record can let the gateway restart and accept calls.
    The journal replay logs unreadable lines but does not keep the gate closed because of them. Startup continues. Claude has disclosed this gap, but I disagree with treating it as nonblocking before live spending: keeping the money reserved does not satisfy the separate requirement to freeze the affected project until reconciliation.
    Required fix: unreadable records must block forwarding until recovered; test a truncated journal followed by restart. Journal implementation⁠￼
2. A bill exceeding its reservation still produces only a fault message.
    Question 17 defaults to allowing this without freezing the project. My recommendation: choose 17(a)—freeze automatically until reconciled. This cannot prevent the first overrun, but it prevents continued spending afterward. Recorded options⁠￼
3. Browser acceptance is not yet dependable across fresh sessions.
    When the approved browser archive is missing, the live acceptance tests skip. That is honestly reported, but the required acceptance gate should fail when its prerequisites are missing. Otherwise a passing general test run can coexist with no browser exercise. Recorded limitation⁠￼

My advice: let Claude continue with reconciliation and isolation, fix the recovery issue, and make browser acceptance mandatory at its gate. The project is advancing; the remaining concern is whether the safeguards survive failures—not whether more features can be built.
