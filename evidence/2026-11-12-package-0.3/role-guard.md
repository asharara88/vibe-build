# Package 0.3: the role guard stops an unauthorised request itself

| | |
| --- | --- |
| Date | 12 November 2026 |
| Package | 0.3 of `docs/BUILD-PLAN.md`: "The role guard stops an unauthorised request itself. It returns only a permitted user. A wrong role gets a plain 'no access' page in both languages. An unrecognised role is refused, not treated as the lowest role. The same guard covers form actions and data routes, not only pages." It depends on licence code L11, true since 12 November |
| Answers | Register finding P-3 (`docs/reviews/2026-11-11-pull-request-2.md`): the guard returned a "denied" flag for the page to act on, treated an unrecognised role as the lowest role, and covered pages only |
| Run on | The development machine (a cloud session). The template's own tests, type check, build and checks ran on the host in `templates/next/`. The live checks built and ran the template in containers on the development profile, which shares the host's network; as before, creating the tables and sample users ran from the host (known gap 29). Made-up sample users only |
| Done means (plan) | (1) "A restricted example page with a test for each role." (2) "A check that fails the build when a page, action or route has no guard." (3) "The existing home page uses the guard the new way" |
| Result | (1) **Shown**: runs 1 and 2. The decision is tested for each role in `npm test`; the pages themselves, for each kind of visitor, by the live run. (2) **Shown** for the ways of writing listed under "What the build check reads": runs 3 and 4. (3) **Shown**: run 3 lists the home page with its guard, and run 2 shows it behaving for each kind of visitor. **State: built, not tested**, until an independent reviewer has read the commit that is merged. Two reviews found ways round the check that Next.js really serves, closed since (the reviews are at the end of this file). The check is for catching a guard left out by mistake; it is not a defence against code written on purpose to get round the guard |

A *guard* is the piece of code that decides whether the person asking may see or do something. A *form action* is code on the server that a form's button runs. A *data route* is an address that answers with data instead of a page.

## What was built, in `templates/next/`

- **The decision, on its own** (`src/lib/access.ts`): who is asking (nobody; someone whose account has no role this app recognises; a user with a role) and whether the roles named allow them. No framework in it, so it is tested directly.
- **Three guards** (`src/lib/roles.tsx`, replacing `roles.ts`): `guardedPage`, `guardedAction` and `guardedRoute`. Each takes the roles it is for and the code to run, and calls that code only with a permitted user. There is no "denied" flag any more for a page to forget. (Code that a page file exports beside its page, such as `generateMetadata`, would run before the guard; the build check refuses it.) Not signed in: the sign-in page (a route answers 401). Wrong role, or a role not recognised: the "no access" page in the reader's language (a route answers 403 with the message in both languages).
- **For the few things that need no role**, `publicPage`, `publicAction` and `publicRoute`, each with its reason written beside it: the sign-in page, the page that only sends a visitor on, the "no access" message, and the sign-in library's own routes.
- **An unrecognised role is refused.** Before, it was read as "employee". Also changed: a new account used to be given the role "employee" by default; it is now given `none`, which is not a role, so every guard refuses it until someone gives it a role.
- **The "no access" page** (`src/components/NoAccess.tsx`), in English and Arabic: which role you have, who the page is for, and what to do.
- **A check that runs before every build** (`scripts/check-guards.ts`; `npm run build` runs it first). What it reads and refuses is listed in the next section.
- **Examples** that the tests use: a page for HR admins only, a form action for managers and HR admins on a page every role can open, and a data route for managers and HR admins. The build step that adds an app's own screens replaces them.
- **The template's first automated tests** (`tests/`, run by `npm test`, with Node's own test runner, no new package): the decision for each role, and the build check on small made-up apps.
- The home page, the sign-in page and the sign-in routes are rewritten through the guards. `@swc/core`, the parser the check uses, was already installed (it comes with `next-intl`); it is now also listed by name at the same version, so no package was added (the lock file's own entry is the only one changed).
- **The request file `proxy.ts` is moved into `src/`.** At the template's root, where it had been since the template was first built, Next.js never ran it, because the app is under `src/`; the framework's own documentation says it sits beside the app folder. So the address's language was never set for a form action: a refused action on an Arabic page landed on the English "no access" page, and `/` answered "not found". The build output now lists it (`run-build.txt`, "Proxy").
- In `builder/`: `scripts/guard-checks.ts`, the live checks below, run by `scripts/demo-template.ts --guard`.

## What the build check reads

The files are parsed, not searched as text.

- **Every page file under `src/app`:** its default export must be `guardedPage(...)` or `publicPage(...)`, with the guard imported by name from `@/lib/roles` and not declared again in the file. It may export nothing else except a fixed list of settings with plain values (`dynamic`, `revalidate` and five others): no `generateMetadata`, no `metadata`, because code there runs for every visitor before any guard.
- **Every route file under `src/app`:** each HTTP method it exports must be `export const GET = guardedRoute(...)` (or `publicRoute`), with `const`, so it cannot be replaced afterwards; nothing else but the same plain settings.
- **Every code file of the component, inside `src/` or not, hidden folders included**, except the top-level `node_modules`, `.next` and `.git`: a file whose opening directives include `"use server"` (wherever among them) may export only `export const name = guardedAction(...)` or `publicAction`; and no function anywhere may carry `"use server"` among its own opening directives.
- **A page or route set to be built once, ahead of time** (`dynamic = "force-static"`), is refused: it would give everyone the same answer.
- **It refuses:** a top-level `app/` or `pages/` folder, or `src/pages/` (Next.js would serve pages from them); a `node_modules` folder anywhere but the top; the special files that answer with data by themselves (`manifest`, `sitemap`, `robots`, and social and icon images written as code, with or without a number after the name); a `tsconfig.json` that maps `@/` anywhere but `src/` or extends another file; a `jsconfig.json`; any Next.js settings file other than the template's own `next.config.ts`, which is held to its exact contents by its SHA-256 (the settings can be written in too many ways to read reliably, so a change to them is a change to the check, made by a person); and a build script other than exactly `tsx scripts/check-guards.ts && next build`.
- **It does not read:** layouts and the other special files that wrap pages (`layout`, `template`, `default`, `error`, `not-found`, `loading`), which must not show data; what roles a guard names; the guards' own file; the top-level `node_modules`, `.next` and `.git`.
- **What it is for:** catching a page, action or route written without its guard by mistake. It is not a defence against code written on purpose to get round the guard: for example, the second review showed that a file imported by the layout can change how the sign-in library reads a session, so that a visitor who is not signed in is shown a guarded page. That kind of change is for review, and for the rules of the build engine (a later package).

## Run 1: the template's tests (`npm test`)

One test for each role, for an account with no recognised role and for nobody; then the build check on made-up apps with an unguarded page, route or action in each.

```text
$ npm test   (in templates/next/)
# Subtest: who is asking
    ok 1 - nobody, when there is no session
    ok 2 - a user with the role employee
    ok 3 - a user with the role manager
    ok 4 - a user with the role hr_admin
    ok 5 - "none", the role a new account is given, is refused even if the list of roles were ever to name it
    ok 6 - an account with no role this app recognises is not given the lowest role
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
# Subtest: found by the review of the first version, and kept fixed
    ok 1 - an action file whose opening directives put "use strict" before "use server"
    ok 2 - an action file outside src/
    ok 3 - an action or a route exported with "let", which could be replaced afterwards
    ok 4 - a page file that exports anything beside its page, such as generateMetadata or metadata
    ok 5 - a route file that exports something other than its methods and plain settings
    ok 6 - a top-level app/ folder, which Next.js would serve in place of src/app
    ok 7 - special files that answer with data by themselves
    ok 8 - a change to where "@/" points, a build script that is not exactly the check then the build, and the Next.js settings
    ok 9 - folders named .git or .next below the top, and node_modules below the top
    ok 10 - special files with a number after their name
    ok 11 - a page or route set to be built ahead of time ("force-static"), which would give everyone the same answer
ok 8 - found by the review of the first version, and kept fixed
# Subtest: a check that read nothing has not passed
    ok 1 - fails on a folder with no app in it
ok 9 - a check that read nothing has not passed
# tests 39
# suites 9
# pass 39
# fail 0
# cancelled 0
# skipped 0
# todo 0
exit code: 0
```

## Run 2: each kind of visitor against the running template

Five kinds of visitor: the three sample roles; a person who has just signed up, whose account has no role the app recognises; and nobody. The form action is tried twice: through the page's button, by the roles that can see the page (from the English page, and once from the Arabic page); 26 checks in all; and by sending the form directly, by every visitor, including those who are never shown the form. Check 4 shows the button doing what it should for each role; the "done" message it reads can be shown by anyone who types its address, so check 5, where the action itself is refused, is the stronger of the two.

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

4b. The same, from the Arabic page: a refused employee lands on the Arabic "no access" page
PASS  action by button from the Arabic page, employee: expected /ar/no-access; saw /ar/no-access

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
| `08-action-refused-employee-ar.png` | An employee pressing the action's button on the Arabic page, landing on the Arabic "no access" page |

The same run first repeated the template's earlier demonstration (sign-in, validation, home in both languages, phone width); those screenshots are in `screens-template/` and the whole output is `run-live.txt`.

## Run 3: the guard check on the template (`npm run check:guards`)

```text
$ npm run check:guards   (in templates/next/)
Guard check (rule 5): 38 code files read in the component.
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
- **Layouts and the framework's other special files that wrap pages.** They are not checked. A layout must not show data; the template's layout shows only the app's name and the language switch.
- **Other ways code can run on the server** that are not a page, a form action or a data route: the request file `src/proxy.ts`, which only sets the language, and anything a later framework version adds.
- **Changes to the build itself.** The check refuses a build script that skips it, a changed `@/` and `pageExtensions`; it cannot stop someone changing the check itself or the Next.js settings in other ways. That the build engine may not change these files is a rule of the engine, which is a later package; nothing enforces it yet.
- **Every message is sent to every visitor.** The template's whole message catalogue, in the visitor's language, goes to the browser, signed in or not. It holds no data, only wording.
- **Two small things on the "no access" page.** For an account with no role, "Go to the home page" leads back to the same message; on `/no-access` a visitor who is not signed in also sees "Sign out".
- **That nobody can make an account.** The sign-in library's sign-up route is open: run 2 used it to make the visitor with no role. Such an account sees nothing but the "no access" message, but it exists. Whether sign-up should be closed is a decision for the owner with the reviewing engineer (known gap 47).
- **The Arabic of the new messages.** It was written by Claude Code. The reviewer below reads Arabic and found nothing wrong; three of its suggestions are taken. It has not been read by the owner; the wording list for the owner (`docs/arabic-wording-list.md`) is regenerated with them. Two Arabic sentences, the data route's refusal messages, are in `src/lib/roles.tsx`, not in the message files, so they are not in that list.
- **Records.** Nothing here is about who changed what: the who-and-when stamps are rule 4, not this package.
- **A server.** Everything ran on the development profile, where containers share the machine's network.

## The review of the first version (commit `e7f4d39`) and what was done

A fresh reviewer, who wrote none of this, ran every check and the live run (all matching), about 80 made-up apps against the build check, six builds of copies with files added, and two instances of the template in containers with probe files. **The guard itself held against everything tried at run time:** roles set in the database to near misses (wrong case, spaces, lists, empty, `admin`) were all refused; a sign-up asking for the role `hr_admin` got `none`; the example action was refused for every visitor whether sent by its form or called directly as the browser's code does, from six addresses; guarded pages were not stored for reuse. **But the build check could be got round in ways Next.js really serves**, and two record statements were false. The review bot, on the same commit, found two of the same ways.

| # | Finding | Blocking | Done |
| --- | --- | --- | --- |
| B1 | Form actions the check passed and that ran for a visitor who was not signed in: a file whose directives put `"use strict"` before `"use server"` (also found by the review bot); the same inside a function; a `"use server"` file outside `src/`; an action exported with `let` and then replaced | Yes | The whole run of opening directives is read, in files and in functions; every code file of the component is read, not only `src/`; an export must be `const`. Tested, each case |
| B2 | A data route exported with `let` and then replaced by an unguarded one, served to a visitor not signed in | Yes | An export must be `const`. Tested |
| B3 | A page file exporting `generateMetadata` beside its guarded page: the title and description reached a visitor not signed in, an employee and an account with no role | Yes | A page file exports only its page and plain settings. Tested, with `metadata` and a setting that is not plain |
| B4 | A top-level `app/` folder: the check passed on `src/app`, and Next.js served only the top-level one (also found by the review bot) | Yes | Refused, like `pages/`. Tested |
| B5 | False: a refused form action did not land on the "no access" page in the reader's language: from an Arabic page it went to the English one. The request file `proxy.ts` sat at the template's root, where Next.js never ran it (true since the template was first built) | Yes | Moved into `src/`. A check from the Arabic page is added to the live run and passes; the 25 earlier checks still pass (this cell first said 26: the count had included the run's final line) |
| B6 | False: `@swc/core` was said to come with Next.js; it comes with `next-intl` | Yes (records) | Corrected here and in `docs/DECISIONS.md` |
| | Sentences overstated because of B1 to B4 (in this file, the README, the check's own header and `docs/STATUS.md`) | Yes (records) | Reworded; what the check reads and does not read is now listed in its own section above |
| | A change to where `@/` points in `tsconfig.json` let a fake guard be bundled; a build script could drop the check | No | Both refused by the check. Tested |
| | `src/app/manifest.ts` answered a visitor not signed in | No | The special files that answer with data by themselves are refused. Tested |
| | The demonstration run left a temporary folder holding each run's generated secrets | No | The run now removes its folder at the end. Folders left by earlier runs are still in `/tmp` (removing them was refused in this session; the owner can clear them) |
| | Three Arabic sentences awkward; two refusal sentences in the code not in the wording list | No | Three suggestions taken; the two sentences named above |
| | The "done" message of the example can be shown by anyone who types its address; the "no access" page's links for a no-role account and a visitor not signed in; every message sent to every visitor | No | Recorded above under "What this does not show" |
| | Stale or imprecise: the guards' file named `roles.ts` in a comment; known gap 48's count of messages and its mention of `proxy.ts`; the README's claim that protected files are "mounted read-only"; the status file saying the template has no automated tests | No | Each corrected |

## The second review (commit `7ebf949`) and what was done

The same reviewer re-ran its earlier cases (all now refused; the request file runs; `/` redirects; nothing that passed before fails; the live run 26 of 26) and tried to get round the new rules. **Three more ways round the check passed it and Next.js served them**, and some counts and claims in the records were false. The review bot, on the same commit, had no findings.

| # | Finding | Blocking | Done |
| --- | --- | --- | --- |
| N1 | `pageExtensions` written as a shorthand property in `next.config.ts` passed the check; a page with another extension was served to a visitor not signed in. (Also: a second `tsconfig` named through `typescript.tsconfigPath` bundled a look-alike guard) | Yes | The Next.js settings file is now held to its exact contents, and any other `next.config.*` is refused. Tested, both. A change to the settings is a change to the check, made by a person |
| N2 | Folders named `.git` or `.next` were skipped wherever they were: a page under `src/app/[locale]/.git/` was served, and an action under `src/.git/` ran, for a visitor not signed in | Yes | Only the top-level `node_modules`, `.next` and `.git` are skipped; a `node_modules` folder anywhere else is refused. Tested |
| N3 | Special files with a number after the name (`opengraph-image2`, `icon1`) passed; one was served | Yes | Matched with or without a number. Tested |
| N4 | Counts: the live run has 26 checks, not 27 (and the first version had 25, not 26: the count had included the run's last line); and sentences made false by N1 to N3 | Yes (records) | Corrected here, in the check's own header, in the README, in `docs/STATUS.md` and in `docs/DECISIONS.md` |
| | A build script such as `... && next build \|\| next build` passed the "starts with" rule and built an unguarded page | No | The build script must be exactly `tsx scripts/check-guards.ts && next build`. Tested |
| | A `jsconfig.json`, or a `tsconfig.json` that extends another | No | Both refused. Tested |
| | `dynamic = "force-static"` beside a guarded page locked everyone out | No | Refused. Tested |
| | The decision depends on the list of roles in `src/app-config.ts`, which the build engine writes; nothing stopped a role named `none` | No | `none` is refused in the decision itself, whatever the list says. Tested |
| | Code written on purpose can get round the guard (a file imported by the layout changed how the sign-in library reads a session) | No | Said under "What the build check reads": the check catches a guard left out by mistake, not code written to defeat it |
