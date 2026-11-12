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
| 5 Role check before anything | The guards in `src/lib/roles.tsx`: every page is written with `guardedPage`, every form action with `guardedAction`, every data route with `guardedRoute`. The code inside is only called with a permitted user. `npm run build` fails if a page, action or route has no guard (`scripts/check-guards.ts`) |
| 6 Confirmation before anything destructive | Translated confirm texts in `messages/*.json`; a confirm component is added with the first destructive action |
| 7 No secrets in code | Everything from the environment; the browser receives nothing secret |
| 8 Numbers show source and period | `common.source` message; a component is added with the first number |
| 9 Exports show their filters | Added with the first export |
| 10 Works on a phone | Mobile-first styles; no fixed widths |

## Files the builder must not change

`src/auth.ts`, `src/lib/roles.tsx`, `src/lib/access.ts`, `scripts/check-guards.ts`, the four sign-in tables in `src/db/schema.ts`, and anything under `acceptance/`. These are protected by the builder's engine rules and mounted read-only.

## The role guard (rule 5)

Three things in an app can show or change data: a page, a form action and a data route. Each is written through a guard that names the roles it is for:

```ts
export default guardedPage(["manager"], async ({ user, locale }) => ...);          // src/app/[locale]/.../page.tsx
export const approve = guardedAction(["manager"], async (user, formData) => ...);   // a file marked "use server"
export const GET = guardedRoute(["manager"], async (request, user) => ...);         // src/app/api/.../route.ts
```

- The code inside is called only with a permitted user. There is no "denied" flag to forget.
- Not signed in: the sign-in page (a route answers 401). Signed in with the wrong role: a plain "no access" page in the reader's language (a route answers 403).
- A role the app does not recognise is refused, never treated as the lowest role. A new account has the role `none`, which is not a role, until someone gives it one.
- The few things that need no role (the sign-in page, the sign-in library's routes) are written with `publicPage`, `publicAction` or `publicRoute`, each with its reason.
- `npm run build` runs `scripts/check-guards.ts` first and fails if any page, action or route is written any other way. `npm run check:guards` prints the list of what is guarded and for whom.
- `npm test` runs the tests of the decision (one for each role) and of that check.
- The pages under `src/app/[locale]/example/` and the route `src/app/api/example/roles` are examples; the build step that adds an app's own screens replaces them.

What the guard does not do: a refused page is sent with the ordinary "found" status, not a "forbidden" one (the framework's way of sending that is still marked experimental); layouts are not checked, so a layout must not show data; and the check reads how a file is written, not what roles it names.

## The image library `sharp` is not installed

Next.js lists the image library `sharp` as an optional extra. Parts of `sharp` (the `@img/sharp-libvips-*` packages and a few others) carry the LGPL licence, which is outside this project's permitted list, and the owner decided on 12 November 2026 that it is to be removed rather than approved. So:

- `package.json` points `sharp` at `vendor/no-sharp`, an empty stand-in of this template's own, and an `overrides` entry makes Next.js use the same one. No `sharp` or `@img` package from the registry is installed or listed in `package-lock.json`.
- `next.config.ts` turns Next.js's image optimiser off (`images: { unoptimized: true }`): its route `/_next/image` answers "not found" and images are served as they are, with no resizing or conversion.
- Two other parts of Next.js still look for `sharp`. Open Graph image generation tries it, does not find it, and falls back to its built-in renderer. A statically imported image file works with the default bundler (Turbopack, which this template's `build` script uses) but fails the build under the older webpack bundler (`next build --webpack`), so do not switch bundler.
- An app that needs resized or converted images must not add `sharp` back. That would need the owner's written approval of the LGPL packages by name.
