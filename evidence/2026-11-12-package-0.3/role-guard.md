# Package 0.3: the role guard stops an unauthorised request itself

| | |
| --- | --- |
| Date | 12 November 2026 |
| Package | 0.3 of `docs/BUILD-PLAN.md`: "The role guard stops an unauthorised request itself. It returns only a permitted user. A wrong role gets a plain 'no access' page in both languages. An unrecognised role is refused, not treated as the lowest role. The same guard covers form actions and data routes, not only pages." It depends on licence code L11, true since 12 November |
| Answers | Register finding P-3 (`docs/reviews/2026-11-11-pull-request-2.md`): the guard returned a "denied" flag for the page to act on, treated an unrecognised role as the lowest role, and covered pages only |
| Run on | The development machine (a cloud session). The template's own tests, type check, build and checks ran on the host in `templates/next/`. The live checks built and ran the template in containers on the development profile, which shares the host's network; as before, creating the tables and sample users ran from the host (known gap 29). Made-up sample users only |
| Done means (plan) | (1) "A restricted example page with a test for each role." (2) "A check that fails the build when a page, action or route has no guard." (3) "The existing home page uses the guard the new way" |
| Result | (1) **Shown**: runs 1 and 2. (2) **Shown**: runs 3 and 4. (3) **Shown**: run 3 lists the home page with its guard, and run 2 shows it behaving for each kind of visitor. **State: built, not tested**, until an independent reviewer has read the commit that is merged |

A *guard* is the piece of code that decides whether the person asking may see or do something. A *form action* is code on the server that a form's button runs. A *data route* is an address that answers with data instead of a page.

## What was built, in `templates/next/`

- **The decision, on its own** (`src/lib/access.ts`): who is asking (nobody; someone whose account has no role this app recognises; a user with a role) and whether the roles named allow them. No framework in it, so it is tested directly.
- **Three guards** (`src/lib/roles.tsx`, replacing `roles.ts`): `guardedPage`, `guardedAction` and `guardedRoute`. Each takes the roles it is for and the code to run, and calls that code only with a permitted user. There is no "denied" flag any more for a page to forget. Not signed in: the sign-in page (a route answers 401). Wrong role, or a role not recognised: the "no access" page in the reader's language (a route answers 403 with the message in both languages).
- **For the few things that need no role**, `publicPage`, `publicAction` and `publicRoute`, each with its reason written beside it: the sign-in page, the page that only sends a visitor on, the "no access" message, and the sign-in library's own routes.
- **An unrecognised role is refused.** Before, it was read as "employee". Also changed: a new account used to be given the role "employee" by default; it is now given `none`, which is not a role, so every guard refuses it until someone gives it a role.
- **The "no access" page** (`src/components/NoAccess.tsx`), in English and Arabic: which role you have, who the page is for, and what to do.
- **A check that runs before every build** (`scripts/check-guards.ts`; `npm run build` runs it first): it parses every page, every file of form actions and every data route, and fails unless each is written through a guard that comes from the guards' own file.
- **Examples** that the tests use: a page for HR admins only, a form action for managers and HR admins on a page every role can open, and a data route for managers and HR admins. The build step that adds an app's own screens replaces them.
- **The template's first automated tests** (`tests/`, run by `npm test`, with Node's own test runner, no new package): the decision for each role, and the build check on small made-up apps.
- The home page, the sign-in page and the sign-in routes are rewritten through the guards. `@swc/core`, the parser the check uses, was already installed as part of Next.js; it is now also listed by name at the same version, so no package was added (the lock file's own entry is the only one changed).
- In `builder/`: `scripts/guard-checks.ts`, the live checks below, run by `scripts/demo-template.ts --guard`.

## Run 1: the template's tests (`npm test`)

One test for each role, for an account with no recognised role and for nobody; then the build check on made-up apps with an unguarded page, route or action in each.

```text
$ npm test   (in templates/next/)
# Subtest: who is asking
    ok 1 - nobody, when there is no session
    ok 2 - a user with the role employee
    ok 3 - a user with the role manager
    ok 4 - a user with the role hr_admin
    ok 5 - an account with no role this app recognises is not given the lowest role
ok 1 - who is asking
# Subtest: may they: a page, action or route for HR admins only
    ok 1 - employee: refused, role not allowed
    ok 2 - manager: refused, role not allowed
    ok 3 - HR admin: allowed, and the user is handed on
    ok 4 - no recognised role: refused, even where every role is allowed
    ok 5 - nobody: refused, not signed in
ok 2 - may they: a page, action or route for HR admins only
# Subtest: may they: the list of roles itself
    ok 1 - an empty list allows nobody
    ok 2 - every recognised role is allowed where the list is every role
    ok 3 - a name on the list that is not a role lets nobody in under it
ok 3 - may they: the list of roles itself
# Subtest: the guard check on this template
    ok 1 - passes, and lists every page, action and route with its guard
ok 4 - the guard check on this template
# Subtest: a page without a guard fails the check
    ok 1 - a plain page component
    ok 2 - a page that calls something else, or keeps the guard in a variable first
    ok 3 - a guard of the same name that does not come from the guards' own file
    ok 4 - a page in the older pages folder, which is not checked and so not allowed
ok 5 - a page without a guard fails the check
# Subtest: a data route without a guard fails the check
    ok 1 - a plain handler, as a function or as a constant
    ok 2 - one guarded method beside one that is not
    ok 3 - handlers exported together or passed on from another file
    ok 4 - passes when every method has its guard, with settings beside them
ok 6 - a data route without a guard fails the check
# Subtest: a form action without a guard fails the check
    ok 1 - a plain action in a file marked "use server"
    ok 2 - a function marked "use server" inside a page or a component
    ok 3 - the same, for a function written with an arrow, and for one inside an event handler
    ok 4 - passes when the action is written with its guard
ok 7 - a form action without a guard fails the check
# Subtest: a check that read nothing has not passed
    ok 1 - fails on a folder with no app in it
ok 8 - a check that read nothing has not passed
# tests 27
# suites 8
# pass 27
# fail 0
# cancelled 0
# skipped 0
# todo 0
exit code: 0
```

## Run 2: each kind of visitor against the running template

Five kinds of visitor: the three sample roles; a person who has just signed up, whose account has no role the app recognises; and nobody. The form action is tried twice: through the page's button, by the roles that can see the page; and by sending the form directly, by every visitor, including those who are never shown the form.

```text
The role guard, tried by each kind of visitor (scripts/guard-checks.ts):
(a new account was made through the sign-up route for the "no role" visitor: HTTP 200)

1. The example page for HR admins only (/en/example/restricted)
PASS  page, employee: expected the "no access" page (role_not_allowed); saw the "no access" page (role_not_allowed)
PASS  page, manager: expected the "no access" page (role_not_allowed); saw the "no access" page (role_not_allowed)
PASS  page, HR admin: expected the page (example-restricted); saw the page (example-restricted)
PASS  page, no recognised role: expected the "no access" page (role_not_recognised); saw the "no access" page (role_not_recognised)
PASS  page, not signed in: expected the sign-in page; saw the sign-in page
PASS  page in Arabic, employee: direction of the page: expected rtl; saw rtl

2. The home page, open to every recognised role (/en/home)
PASS  home, employee: expected the page (signed-in-as); saw the page (signed-in-as)
PASS  home, manager: expected the page (signed-in-as); saw the page (signed-in-as)
PASS  home, HR admin: expected the page (signed-in-as); saw the page (signed-in-as)
PASS  home, no recognised role: expected the "no access" page (role_not_recognised); saw the "no access" page (role_not_recognised)
PASS  home, not signed in: expected the sign-in page; saw the sign-in page

3. The example data route for managers and HR admins (/api/example/roles)
PASS  route, employee: expected 403 no_access; saw 403 no_access
PASS  route, manager: expected 200 {"role":"manager"}; saw 200 {"role":"manager"}
PASS  route, HR admin: expected 200 {"role":"hr_admin"}; saw 200 {"role":"hr_admin"}
PASS  route, no recognised role: expected 403 no_access; saw 403 no_access
PASS  route, not signed in: expected 401 not_signed_in; saw 401 not_signed_in

4. The example form action for managers and HR admins, through the page's button (/en/example/action)
PASS  action by button, employee: expected sent to /en/no-access; saw sent to /en/no-access
PASS  action by button, manager: expected done, for the role Manager; saw done, for the role Manager
PASS  action by button, HR admin: expected done, for the role HR admin; saw done, for the role HR admin

5. The same form action, sent directly as the form would send it, by each visitor
(hidden fields of the form: 1)
PASS  action sent directly, employee: expected 303 to /en/no-access; saw 303 to /en/no-access
PASS  action sent directly, manager: expected 303 to /en/example/action?done=manager; saw 303 to /en/example/action?done=manager
PASS  action sent directly, HR admin: expected 303 to /en/example/action?done=hr_admin; saw 303 to /en/example/action?done=hr_admin
PASS  action sent directly, no recognised role: expected 303 to /en/no-access; saw 303 to /en/no-access
PASS  action sent directly, not signed in: expected 303 to /en/sign-in; saw 303 to /en/sign-in
PASS  "no access" page at phone width 390, Arabic: no sideways scrolling: expected true; saw true

RESULT: PASSED
```

Screenshots are in `screens/` beside this file:

| File | What it shows |
| --- | --- |
| `01-no-access-employee-en.png` | The "no access" page an employee gets on the HR admins' page |
| `02-no-access-employee-ar.png` | The same in Arabic, right to left |
| `03-restricted-page-hr-admin-en.png` | The HR admins' page, as an HR admin |
| `04-no-role-home-en.png` | What a newly signed-up person sees on the home page: nothing but the "no access" message |
| `05-action-refused-employee-en.png` | An employee pressing the button of an action that is not for employees |
| `06-action-done-manager-en.png` | A manager pressing the same button |
| `07-no-access-ar-phone.png` | The "no access" page in Arabic at a phone's width |

The same run first repeated the template's earlier demonstration (sign-in, validation, home in both languages, phone width); those screenshots are in `screens-template/` and the whole output is `run-live.txt`.

## Run 3: the guard check on the template (`npm run check:guards`)

```text
$ npm run check:guards   (in templates/next/)
Guard check (rule 5): 25 code files read under src/.
Pages, form actions and data routes, each with its guard and what the guard is given:
  action  src/app/[locale]/example/action/actions.ts  runExampleAction = guardedAction(["manager", "hr_admin"])
  page    src/app/[locale]/example/action/page.tsx  guardedPage(ROLES)
  page    src/app/[locale]/example/restricted/page.tsx  guardedPage(["hr_admin"])
  page    src/app/[locale]/home/page.tsx  guardedPage(ROLES)
  page    src/app/[locale]/no-access/page.tsx  publicPage("the plain \"no access\" message: it shows no data and must be readable by someone who was)
  page    src/app/[locale]/page.tsx  publicPage("shows nothing: it only sends a visitor to the home page or to sign-in")
  page    src/app/[locale]/sign-in/page.tsx  publicPage("the sign-in form: it must be reachable before anyone is signed in")
  route   src/app/api/auth/[...all]/route.ts  GET = publicRoute(reason)
  route   src/app/api/auth/[...all]/route.ts  POST = publicRoute(reason)
  route   src/app/api/example/roles/route.ts  GET = guardedRoute(["manager", "hr_admin"])
RESULT: PASSED
exit code: 0
```

## Run 4: the build failing on a page with no guard

```text
# A copy of the template with one page added that has no guard: src/app/[locale]/open/page.tsx
$ npm run build
...
PROBLEMS: 1
  src/app/[locale]/open/page.tsx is a page whose default export is not guardedPage(...) or publicPage(...) from "@/lib/roles".
RESULT: FAILED
exit code: 1
```

The whole output is `run-build-with-an-unguarded-page.txt`. The build of the template as it is passes, with the check first: `run-build.txt`. The licence check passes: `run-licences.txt`. The template's type check passed (exit code 0), and the suite of `builder/` passed (86 of 86).

## What this does not show

- **That every page of a future app is guarded for the right roles.** The check reads how a file is written, not which roles it names: a page written with `guardedPage` for every role passes. Which roles a screen is for comes from the app's brief, and is checked by the acceptance test, which is a later package.
- **A "forbidden" status for a refused page.** The page a refused person gets is sent with the ordinary status (200). The framework's way of sending 403 for a page is still marked experimental and is not used. Data routes do answer 401 and 403.
- **Layouts and the framework's other special files.** They are not checked. A layout must not show data; the template's layout shows only the app's name and the language switch.
- **Other ways code can run on the server** that are not a page, a form action or a data route: the request file `proxy.ts`, and anything a later framework version adds.
- **That nobody can make an account.** The sign-in library's sign-up route is open: run 2 used it to make the visitor with no role. Such an account sees nothing but the "no access" message, but it exists. Whether sign-up should be closed is a decision for the owner with the reviewing engineer (known gap 47).
- **The Arabic of the new messages.** It was written by Claude Code and has not been read by a native speaker; the wording list for the owner (`docs/arabic-wording-list.md`) is regenerated with them.
- **Records.** Nothing here is about who changed what: the who-and-when stamps are rule 4, not this package.
- **A server.** Everything ran on the development profile, where containers share the machine's network.
