# Evidence: the TypeScript house template running in a project sandbox

Run on 2026-11-11 on the development machine (profile development-cloud-session). Command: npx tsx builder/scripts/demo-template.ts templates/next evidence/2026-11-11-skeleton-3/next-template

The first image build took 28 seconds; later builds reuse Docker's layer cache. Tables were created and the three sample users seeded from this machine against the project's database (known gap 29). Screenshots were taken by a browser, not composed.

```
Template copied from /home/user/vibe-build/templates/next to the project workspace.
Compose project builder_demo_template: db, egress, app. Secrets written to the sandbox's secrets folder only.
Building the app image inside Docker (development profile: build steps use the session proxy)...
Image built in 1 s.
Creating the tables (drizzle-kit push) and the three sample users (seed)...
  created: employee@example.test (employee)
  created: manager@example.test (manager)
  created: hr.admin@example.test (hr_admin)
Starting the app container and waiting for it to answer...
  Container app: running (healthy)
  Container db: running (healthy)

Screenshots, taken by a browser as a person would see the pages:
  sign-in (English): title "Internal app", dir=ltr
  sign-in (Arabic): title "تطبيق داخلي", dir=rtl
  validation messages shown: Enter your work email address. | Enter your password.
  home (English): Signed in as Sample Employee (Employee)
  home (Arabic): مسجّل الدخول باسم Sample Employee (موظف), dir=rtl
  wrong password message: The email or password is not right. Check both and try again.
  phone width 390: page scroll width 390 (no sideways scrolling when 390)

Whole run: 17 s.
Containers, network, volume and image removed.
```

## Screenshots

| File | What it shows | Quality rule |
| --- | --- | --- |
| [01-sign-in-en.png](next-template/01-sign-in-en.png) | Sign-in in English, with the sample-data banner | 7 (nothing secret in the page) |
| [02-sign-in-ar.png](next-template/02-sign-in-ar.png) | Sign-in in Arabic, right-to-left layout | Arabic from the first version |
| [03-sign-in-validation-en.png](next-template/03-sign-in-validation-en.png) | Empty form submitted: two plain-words messages | 1 |
| [04-home-en.png](next-template/04-home-en.png) | Home after signing in as the sample employee, role shown, empty state | 5, 2 |
| [05-home-ar.png](next-template/05-home-ar.png) | The same in Arabic | 5, 2 |
| [06-sign-in-wrong-password-en.png](next-template/06-sign-in-wrong-password-en.png) | Wrong password: a message the user can act on | 3 |
| [07-sign-in-ar-phone.png](next-template/07-sign-in-ar-phone.png) | Phone width (390 px), Arabic; no sideways scrolling | 10 |

## Template licence check (npm run check:licences in templates/next)

```
Production dependencies:
Package "caniuse-lite@1.0.30001823" is licensed under "CC-BY-4.0" which is not permitted by the --onlyAllow flag. Exiting.
```

The template's own licence check **fails on purpose** at this point: Next.js depends on the browser-support data file `caniuse-lite`, which is under Creative Commons Attribution 4.0, a licence outside the permitted list. It is a data file, not code, and the licence asks for credit. The owner's written exception is requested in `docs/OPEN-DECISIONS.md` (item 11). Until then the check stays red rather than being weakened (hard rule 8).

## Correction, 12 November 2026

The statement above that the template's licence check fails on `caniuse-lite` is true but incomplete. The tool behind that check stops at the first package it refuses. A check that lists every problem (package 0.4a) shows three more packages outside the permitted list in the template, all part of the image library `sharp` and carrying LGPL-3.0-or-later; two are among the shipped dependencies. See `evidence/2026-11-12-package-0.4a/licence-rule.md` and known gap 40.
