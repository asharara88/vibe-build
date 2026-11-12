# House template (TypeScript)

This is the starter every generated app begins from. It is not an app yet: it has sign-in, three sample roles, English and Arabic, and the rules every app must follow built in. The builder adds the app's own tables, screens and actions on top, one step at a time.

**Sample data.** Every user here is made up. The sample password is set by the builder per project and never written down in this folder.

## Start it

With Docker installed, from this folder:

```
docker compose up --build
```

Then open http://localhost:3000. Sign in as `employee@example.test`, `manager@example.test` or `hr.admin@example.test` with the sample password the builder gave you.

## What the template guarantees (the ten quality rules)

| Rule | How it holds here |
| --- | --- |
| 1 Forms validate and explain | Every form uses `zod` with messages in plain words (see the sign-in form) |
| 2 Lists have an empty state | `EmptyState` component; the home page shows one |
| 3 Actions that fail say why | Error messages the user can act on, never codes (sign-in form) |
| 4 Who-and-when stamps | `stamps()` in `src/db/schema.ts`; every app table must spread it |
| 5 Role check before anything | `requireRole()` in `src/lib/roles.ts`, called first on every page |
| 6 Confirmation before anything destructive | Translated confirm texts in `messages/*.json`; a confirm component is added with the first destructive action |
| 7 No secrets in code | Everything from the environment; the browser receives nothing secret |
| 8 Numbers show source and period | `common.source` message; a component is added with the first number |
| 9 Exports show their filters | Added with the first export |
| 10 Works on a phone | Mobile-first styles; no fixed widths |

## Files the builder must not change

`src/auth.ts`, `src/lib/roles.ts`, the four sign-in tables in `src/db/schema.ts`, and anything under `acceptance/`. These are protected by the builder's engine rules and mounted read-only.

## The image library `sharp` is not installed

Next.js lists the image library `sharp` as an optional extra. Parts of `sharp` (the `@img/sharp-libvips-*` packages and a few others) carry the LGPL licence, which is outside this project's permitted list, and the owner decided on 12 November 2026 that it is to be removed rather than approved. So:

- `package.json` points `sharp` at `vendor/no-sharp`, an empty stand-in of this template's own, and an `overrides` entry makes Next.js use the same one. No `sharp` or `@img` package from the registry is installed or listed in `package-lock.json`.
- `next.config.ts` turns Next.js's image optimisation off (`images: { unoptimized: true }`), so nothing tries to load `sharp`. Images are served as they are.
- An app that needs resized or converted images must not add `sharp` back. That would need the owner's written approval of the LGPL packages by name.
