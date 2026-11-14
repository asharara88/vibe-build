# Package 3.2: the exporter (design)

*Status:* **Draft design, not yet built. Read by two critics and corrected (section 12).** 14 Nov 2026. Written by Claude Code from four readers' reports of the same day (the export path, the tables, the check from the exported copy, the licences), each of which read the code and measured what it could; then corrected on the findings of two independent critics (feasibility, requirements), each finding checked against the code or by a measurement before it was acted on. Not approved by the owner: five questions are his (section 10), and 3.2 cannot be marked tested before the first three are answered. Package 3.2's "Done means" (R BP:193): "The app starts from the export with the builder stopped, and the check passes from the exported copy." The clean machine is milestone 6, not this package (R DN:593). Only this file was edited.

**For the owner, in five lines.**
1. **What would be built:** the export becomes a folder that starts on its own with one command, `docker compose up --build`, which makes the app's own passwords, its database, its tables (from fixed files now kept in the app's history), the made-up sample users and the app. Before offering an export, the builder checks it and shows what it found: none of the development-only packages in the app's own folder of the image the app runs from, and every place they still are (the tools image the copy builds and runs at each start, and one copy inside the base image's own npm); the notices file in the app and up to date; the licence check passing. Then the builder's own check code and checklist runner run the checklist's test from the exported copy against the app that copy started.
2. **What you would see:** pictures from an automated run: the export screen with its new label and checks; then, after the builder that made the export was stopped, the checklist's picture taken in the app started from the export (the app's "My requests" page with the made-up request "Waiting" and the run's id); and a picture of the run's record, drawn from its own files, with "version passed; checklist incomplete (5 of 6)", the label "stand-in test, not independent acceptance", and the times the builder stopped and the app started. One figure from J1 changes: step 1's reservation rises from $1.5552 to $2.7216, because the data step now writes 7 files instead of 4 (worked out, not yet run; no money is spent either way).
3. **What needs you:** five questions (section 10), one at a time. First: on this machine the copy's own start cannot download its packages (measured), so it would install the copies the builder downloaded here before it stopped (measured to work); may it? Then: may the check use the builder's own code and runner, and the stand-in test; may your builder on 4020 keep running; what "development packages absent" means for an internal export; and whether 3.2 stays internal, with every customer question moved to milestone 6. Nothing here costs money, and no new package or image is added.
4. **Until you answer:** the build goes ahead on the recommendations, but 3.2 stays "built, not tested" until questions 23 to 25 are answered. Another answer means changes and a repeat run (for 25 (b), with your 4020 builder stopped), or, for 23 (b) or 24 (b), waiting for milestone 6. 3.2 also cannot be marked tested before 3.1, on which it depends, is tested.
5. **What it would not show:** a clean machine (milestone 6); anything a customer may receive; an app or tests written by a model (packages 2.3 and 3.2b); whether the notices are enough in law. Nothing here is legal advice.

**Tags.** **R** = read at the file and line cited. Code is cited at `e6bf03d`, the base of this branch. **J2:** before a path means read on branch `claude/j2-broken-and-restart`, where that file differs from `e6bf03d`; those files are the same at `b2649f0` and at `392a6fd`, the branch head (R `git diff --stat b2649f0 392a6fd -- builder` touches only `test/preview-live.test.ts` and `test/sandbox.test.ts`, neither cited). The corrections of section 12 were read at `392a6fd`. **M** = measured on 14 Nov 2026 on the development machine, under the shared lock, by one of the four readers, by the feasibility critic, or for this correction; every Docker object each made was removed by exact name or id afterwards. The outputs are in the session's scratch folders named under Keys, not in the repository; the package's own run repeats what it relies on. **I** = inferred, not checked. Everything else is a proposal of this design.

**Keys.** BP, DEC, KG, DN, QS, ENV, SRC, ST = `docs/BUILD-PLAN.md`, `DECISIONS.md`, `KNOWN-GAPS.md`, `design/stage-1.md`, `QUESTIONS.md`, `ENVIRONMENT-CHECK.md`, `SOURCES.md`, `STATUS.md`. P31 = `docs/design/package-3.1.md`. J2D = `docs/design/journey-j2.md` (J2 branch). EJ1 = `evidence/2026-11-13-journey-j1/`. TPL = `templates/next`. S01 = `builder/scripted/example-1/01-data`. **File names cited alone are under `builder/src/`:** `export.ts`, `journey.ts`, `journey-jobs.ts` and `example-1-adapter.ts` in `orchestrator/`; `manager.ts` in `sandbox/`; `scripted.ts` and `project-repo.ts` in `engine/`; `runner.ts`, `runner-image.ts`, `store.ts` and `results.ts` in `acceptance/`; `app.ts`, `pages.ts` and `messages/en.json` in `web/`; `holds.ts` in `store/`. Other paths with no leading folder (`test/`, `scripts/`, `scripted/`, `camera/`) are under `builder/`. Scratch folders, all under the session's scratchpad: **SX-E** `d32-export` (the export path), **SX-M** `d32-mig` (the tables and the start), **SX-C** `d32-check` (the check from the copy), **SX-L** `d32-lic` (the licences), **SX-K** `d32-crit` (the feasibility critic), **SX-F** `d32-fix` (this correction: `run.sh`, `run2.sh`, `run3.sh`, their `.out` files, `m4/*.log`, `m5/build.log`, `cleanup.out`, `cleanup2.out`).

**Words.** An *export* is the .tar.gz file the builder offers after sign-off: a copy of the project's git history with the checklist's tests added in one last commit, the *export commit*. *Docker Compose* starts a set of containers from one file, `compose.yaml`; each container in it is a *service*; a *volume* is storage Docker keeps between starts; a *one-shot* service runs one command and exits; an *override file* is a second Compose file that Compose reads beside `compose.yaml` without being told. A *migration* is a fixed file of database commands that makes or changes tables; drizzle-kit, the template's database tool, keeps a *journal* that lists them and a *snapshot* of the tables after each. The Dockerfile's *tools stage* is the image with the development tools; its *run stage* is the small image the app runs from. A *development package* is one needed only to build or check the app. The *notices file*, `THIRD-PARTY-NOTICES.md`, gives the licence and attribution of each package the owner approved by name. *Loopback* (127.0.0.1, `localhost`) is an address only the machine itself can reach. A *door* is a small container running fixed forwarding code; here it is the only way in from the machine. A *network namespace* is a container's own set of network addresses; two containers can share one. The *build cache* is Docker's store of build steps already done; a *cache mount* is a folder Docker keeps between builds and lends to one build step, here npm's store of downloaded packages. A *symbolic link* is a file that points to another path; a *submodule* is a pointer to another git history. An *origin* is the scheme, host and port a browser says a request comes from; the app's sign-in accepts only the one in its setting `APP_URL`. A *drift check* asks whether the migrations still match the tables the app's schema files declare. A file *created exclusively* is made only if nothing, not even a link, is already at its path. A *control* removes one safeguard to show that its test then fails; a *regression guard* is a test that passes both before and after the change. Other words are in P31's and J2D's "Words" lines and in ST.

## 1. What the export holds, and its one command

**Today.**
- The export job is `POST /projects/:id/export` (R J2: app.ts:366), then `exportProject` (R J2: journey-jobs.ts:581-600), then `writeExport` (R export.ts:73-137). `writeExport` checks the version against its manifest, refuses any acceptance path and any secret-like path in any commit, clones the history with `--no-local`, removes the remote, copies the version's files from the store into `acceptance/<version>/`, writes `acceptance/README.txt` and `EXPORT-NOTE.txt`, commits, re-checks that the workspace history did not move, and packs a .tar.gz of mode 0600 (R export.ts:75-131).
- J1's live export, 380,818 bytes (R EJ1/export-contents.txt), holds the template, steps 01 and 02, `EXPORT-NOTE.txt`, `acceptance/README.txt` and `acceptance/v001/{item-01.spec.ts, manifest.json}`. Its history has 4 commits, and `acceptance/` appears only in the export commit (R J2: test/journey.test.ts:674-713).
- **It cannot start alone.** The template's README says `docker compose up --build`, then http://localhost:3000 (R TPL/README.md:9-15), but no compose file exists in the template or the export (R `ls` of TPL; M SX-E listing). The tables and sample users are made only by the builder, in its tools container (R scripts/example-1-sandbox.ts:138-139). The app's settings exist only in the builder's sandbox folder (R manager.ts:616-617), and the sample password only in the builder's memory (R scripts/example-1-sandbox.ts:69; KG 139).
- **It does not even build.** `next build` stops at `acceptance/v001/item-01.spec.ts`: "Cannot find module '@playwright/test'" (M SX-C m2-build-export-as-is.txt). The template's TypeScript settings take in every `.ts` file (R TPL/tsconfig.json:32-34), and the image build copies the whole folder before `npm run build` (R TPL/Dockerfile:18, :22).
- **Its label is out of date.** `EXPORT_LABEL` says "it has no notices file" (R J2: journey.ts:244-245; en.json:262), but the archive carries `THIRD-PARTY-NOTICES.md`, 39,276 bytes (R EJ1/export-contents.txt), the size of the template's file (R `ls -l` of TPL); that the two are the same bytes is I.

**After 3.2: what the exported folder holds.**
- **Unchanged:** the project's history (the template copy and the `[scripted]` steps), and an export commit that adds exactly `acceptance/<version>/` (the manifest and its items), `acceptance/README.txt` and `EXPORT-NOTE.txt`, in the exported copy only. J1's test pins those four paths (R J2: test/journey.test.ts:706) and keeps passing.
- **New in the template**, and so in every project's history from its first commit:
  - `compose.yaml`, the file of the one command (below);
  - `drizzle/0000_template.sql`, `drizzle/meta/0000_snapshot.json` and `drizzle/meta/_journal.json`, the template's own migration (section 2);
  - `README.md`, rewritten as the exported app's own (below).
- **Changed in the template's protected files** (R scripted.ts:50-64 lists them):
  - `tsconfig.json` excludes `acceptance`, and `.dockerignore` lists `acceptance`. Both are needed: with the TypeScript change alone the tests reach the tools image; with the `.dockerignore` change alone the image builds (M SX-C m3-build.txt), but a type check outside Docker would still fail (I).
  - `.dockerignore` also lists `.git`. It does not today (R TPL/.dockerignore:1-7), and the sandbox never needed it, because the workspace holds no `.git` (R project-repo.ts:2-6); an exported copy does, and `COPY . .` would put its history into the tools image (I).
  - `Dockerfile`, three changes: the run stage also copies `THIRD-PARTY-NOTICES.md` into `/app` (section 4); the install step keeps npm's downloads in a cache mount and uses them first (below, "The build on this machine"); and the comment that the tools image "is never started as the app and is not shipped to anyone" (R TPL/Dockerfile:24-26) is rewritten, since in an exported copy it runs at each start as the `setup` service.
- **More paths protected from the engine:** `compose.yaml`, `README.md`, the two `0000` migration files, and the licence files, `THIRD-PARTY-NOTICES.md`, `licence-rule.json`, `scripts/licence/check.ts`, `scripts/licence/rule.ts`, `scripts/check-licences.sh` and `scripts/check-lock.mjs`. None of the licence files is protected today (R scripted.ts:50-64). `drizzle/meta/_journal.json` cannot be protected, because the data step replaces it.
- **Names a step may not add.** Compose and the image build read some files without being told (below, "What Compose reads"). They cannot join `TEMPLATE_PROTECTED_PATHS`: a protected path is mounted read-only over itself, and a missing one fails the step (R scripted.ts:245-247). So a separate refusal runs after each step, beside the protected-path check (R scripted.ts:339-349), and the exporter refuses the same names in any commit (S29).
- **Why in the template, not written by the exporter:** the engine cannot change a protected file (the step check refuses it, R scripted.ts:339-349); the README's command is true from a project's first commit; the export commit stays the four paths above; and the exporter writes nothing new at a fixed path, which is how finding F1 (section 5) harmed the machine.
- **Why these are corrections, not new product work** (R BP:150: the template is a comparison prototype; corrections are allowed, new product work is not): the template's README has promised `docker compose up --build` since walking skeleton 3a with no file to run it (R TPL/README.md:9-15); design note step 5 asks for a migration the template never had (R DN:514; KG 53); and design note section 1 asks that the exported app start with one command (R DN:29). Nothing here adds a feature to the app. Nothing built on the template counts toward milestone 1 until "Stack" is true (R BP:150).

**The one documented command.** From the folder:

```
docker compose up --build
```

then open http://localhost:3000. The services:

| Service | Image | Networks | What it does |
| --- | --- | --- | --- |
| `keys` | `node:22-alpine` at its approved digest | none | One-shot. Makes `db_password`, `auth_secret` and `sample_password` once, into the `keys` volume, mode 0444. On a later start it prints "kept" for each (M SX-M 06-one-command.out, O1 and O4; SX-F run.out, M3) |
| `db` | `postgres:16-alpine` at its approved digest | `data` | Reads its password from `/run/secrets/db_password`, the one file of the `keys` volume it is given. No port. The same five capabilities and TCP health check as the sandbox's database (R manager.ts:379-398) |
| `setup` | built from the copy, `tools` stage | `data` | One-shot, given the three files. `drizzle-kit migrate`, then the seed, which needs the sample password and `AUTH_SECRET` (R TPL/scripts/seed.ts:7, :12; TPL/src/auth.ts:13-14). On a later start it applies nothing and prints "exists:" for each user (M SX-M O4) |
| `app` | built from the copy, `run` stage | `data`, `front` | Given `db_password` and `auth_secret`, read through a `sh` wrapper; `APP_URL` is `http://localhost:${APP_PORT:-3000}`; starts only once `setup` has succeeded; the sandbox's health check (R manager.ts:348-353) |
| `door` | `node:22-alpine` at its approved digest | `front`, `edge` | Fixed forwarding code, user `node`, no key. The only published port: `127.0.0.1:${APP_PORT:-3000}` |

- **Each service is given only its own keys,** each file mounted on its own, read-only, through Docker's volume subpath. Measured on a stand-in: at the first `docker compose up`, a service mounted one file of a volume that a one-shot service had made earlier in the same start, read it, and saw no other file and no `/keys` folder; at a second start the one-shot printed "kept" (M SX-F run.out, M3, Docker 29.9.2, Compose v5.6.1). The prototype gave every service the whole volume (R SX-M exp/compose.yaml), which the feasibility critic found gave each of them all three secrets.
- `data` and `front` are internal, in Docker's isolated gateway mode, with IPv6 off: exactly `PROJECT_NETWORK` (R manager.ts:153-157). `edge` is an ordinary network with IPv6 off, for the door alone. Every service gets the sandbox's hardening (R manager.ts:139-145): all capabilities dropped (the database gets its five back), no new privileges, 256 processes, 1 GB, a read-only root (not the database, as in the sandbox, R manager.ts:391). The app gets the same two writable in-memory folders as in the sandbox, `/tmp` and `/app/.next/cache` (R manager.ts:336; scripts/example-1-sandbox.ts:80).
- **One source for the file.** `compose.yaml` is generated by builder code from one object (`src/export/app-compose.ts`, reusing `HARDENING`, `PROJECT_NETWORK` and `DEFAULT_IMAGES`) and written with the builder's own YAML writer (R manager.ts:617). A test holds `TPL/compose.yaml` to that output byte for byte, so its rules are tested on the object, as the sandbox's are (R test/sandbox.test.ts:133-150), and what Compose actually reads is compared with it (S30).
- **Names.** The file sets no `name:`. Compose then names the project after its folder, which is the project id (R export.ts:89), so its containers, networks, volumes and images start `j1-<hex>`, never `builder_<id>`. Measured: with no `name:`, a folder named `j1-0123456789ab` gave `name: j1-0123456789ab` (M SX-K ovr/ovr-config.out; SX-F run.out, M2). The builder's removal deletes by the label `builder_<id>` and by two exact image names (R J2: example-1-adapter.ts:334-361), so it cannot remove an exported app (I).
- **Measured on a prototype** with prebuilt images instead of `build:` (M SX-M exp/compose.yaml, 06-one-command.out): the start took about 13 s; from the machine, the sign-in page answered 200 through the door; sign-in with the origin `http://localhost:<port>` answered 200 and with `http://127.0.0.1:<port>` answered 403; a second start kept the keys, applied no migration again and added no user; `down -v` left nothing. Docker publishes no port for a container whose only networks are internal (M SX-M 03-ports.out, P1 and P2 refused, P3 and P4 worked): hence the door.

**The build on this machine** (found by the feasibility critic, blocking; question 23).
- **Without a change, the one command cannot build the copy here.** A plain `docker compose build` of a fixed copy, as `up --build` runs it, ran `npm ci` again and failed after 141 s ("Exit handler never called!"); a plain `docker build` on Docker's default build network failed the same way (M SX-K b2.log, b5.log). The builder's own builds work only because they run on the host's network with the project's egress proxy as a build argument (R manager.ts:978, :626-627); its own comment says Compose cannot do that build in development (R manager.ts:338-339). Asking Compose for the host's network is refused unless `--allow=network.host` is passed, which `up --build` cannot do (M SX-K b3.log, b4.log). And none of the builder's built steps is reused: on the host's network every step was taken from the cache, on the default one `npm ci` ran again (M SX-K b1.log against b2.log and b5.log), so the build's network is part of a step's cache key.
- **The change:** the install step becomes `RUN --mount=type=cache,id=house-template-npm,target=/root/.npm npm ci --prefer-offline --ignore-scripts --no-fund --no-audit`. npm's store of downloaded packages is then kept by Docker between builds, and `--prefer-offline` uses what is there before asking the registry.
- **Measured** (M SX-F run.out, run2.out, run3.out; the template's own `package.json`, `package-lock.json` and `vendor/`):
  - a cache mount is shared between a host-network `docker build`, a default-network `docker build` and `docker compose build` (M SX-K cm-run3.out);
  - filled once by a host-network build (here through the session's proxy, 41 s; the builder would fill it through its egress proxy), the new line on Docker's default build network, with only `PATH` and `HOME` set, installed all 263 packages in 10 s (m4/prefer-offline.log); with `--offline`, which forbids the network, the same (m4/offline.log); with an empty cache mount, `--offline` failed at once, "ENOTCACHED" (m4/control2.log);
  - `docker compose build` of the fixed copy with that line, plain environment, built both images in 23 s, `next build` included; the app image holds no `acceptance` folder (m5/build.log; run2.out);
  - in that build the install step was taken from the layer the read above had just made: a cache mount's id and contents are not part of a step's cache key (the first control was served from the "offline" read's layer, and only a changed command made it run, run2.out and run3.out).
- **What it means:** on this machine, the copy's own start installs the packages the builder downloaded here before it stopped. The builder's builds fill the store (the sandbox's builds and the export check's, section 4); a build with `--no-cache` does not see it (M SX-K cm-run.out, cm-run2.out); for the app's images only `scripts/demo-scripted.ts:175` asks for one. A machine whose store is empty downloads as usual (I; milestone 6). Whether this still counts as "the builder stopped" is question 23. The store is shared by every project's build on the machine (gap N12; adversarial review, section 8).

**What Compose and the image build read beside the fixed files** (found by both critics).
- **Override files.** Each of `compose.override.yaml`, `compose.override.yml`, `docker-compose.override.yaml` and `docker-compose.override.yml`, put beside `compose.yaml`, was merged into what `docker compose` runs; with `-f compose.yaml` none was (M SX-F run.out, M2). One such file gave the door `privileged: true`, the machine's `/` mounted and port 0.0.0.0:3000 (M SX-K ovr/ovr-config.out). A `.env` naming `COMPOSE_FILE` added a file too; a second main file (`compose.yml`, `docker-compose.yml`) was ignored beside `compose.yaml`, with a warning (M SX-F M2).
- **The build's ignore file.** A `Dockerfile.dockerignore` was used instead of `.dockerignore`, by `docker build` and by `docker compose build`: a file that `.dockerignore` excludes was sent to the build (M SX-F run.out, M1).
- **So:** the exporter refuses, in any commit, any file named `compose.override.yaml`, `compose.override.yml`, `docker-compose.override.yaml`, `docker-compose.override.yml`, `compose.yml`, `docker-compose.yaml` or `docker-compose.yml`, and any `*.dockerignore` other than the root `.dockerignore` (S29; `.env` is already refused, R export.ts:44-47); a step that adds one fails (above); and what Compose reads is compared with the generated document, at export and in the run, before the start (S30).
- **Not chosen:** `docker compose -f compose.yaml up --build` in the README. It would stop the override files (M SX-F M2), but only in a folder changed after export, by whoever holds it, who can change `compose.yaml` itself; S29 and S30 cover what the builder exports, and the README keeps the command the template has always given.

**The exported app's README** (`TPL/README.md`, rewritten; a test holds its key lines):
- What it is: an internal web app the builder made from its house template; every user and record is made up; internal only, not for customers, because the container images it names are approved for the builder's internal development and testing only (R DEC:97).
- The command above, as the one code block under the heading "Start it"; then open http://localhost:3000, "not 127.0.0.1: sign-in accepts only the address it was given" (M SX-M O2); `APP_PORT` to use another port. Other sections may hold code examples (the role guard's, R TPL/README.md:40-44); the run takes the block under "Start it", and a test holds that this section has exactly one.
- The three made-up users, and how to see their password, which is made on this machine at the first start and written nowhere in the folder: `docker compose run --rm --no-deps keys cat /keys/sample_password`.
- To stop: Ctrl-C or `docker compose down`. To remove everything, data included: `docker compose down --volumes`.
- The checklist's tests: `acceptance/`, with their stand-in label; run by the builder's own runner on the business's machine; that runner and its browser are not included, because the browser is approved "only inside the runner, on machines the business controls, never given to anyone" (R DEC:110).
- The template's own sections (the ten rules, the role guard, `sharp`) stay below, unchanged.

**Also changed in the export:**
- **The event** `journey.export.written` also records the project's id, the version's manifest SHA-256 and its items' fingerprints (today only `acceptance/README.txt` holds the SHA-256: R J2: journey-jobs.ts:588-599), the number of checklist items in the app spec (`checklist_items`, as the builder's own run takes it, R J2: journey-jobs.ts:566), the passing run's id, the results of the checks of section 4, and the README's command.
- **One export per project.** `JOB_RULES.export` refuses a second one. Today the screen hides the button once an export exists (R J2: pages.ts:989), but a direct POST runs again and deletes the earlier archive before packing the new one (R export.ts:128-129), so a failed second export would leave the recorded first one missing (I). The archive is written under a temporary name and moved into place only if no file has the final name.
- **The label** (English and Arabic; the test that ties the English to `EXPORT_LABEL` stays, R J2: test/web.test.ts:737-738): "Internal only, not for customers. The two container images it names are approved for the builder's internal development and testing only; its development-only packages are approved for development use only, never in what a customer receives. Made-up data only." This follows the approvals as recorded (R DEC:97, :110 for the images; DEC:45 for the development packages and for `caniuse-lite`, approved in generated apps; the other packages are under permitted licences and need no approval). Under it, the screen lists the checks the event records as passed (section 4).
- **The note.** `EXPORT-NOTE.txt` says "no AI model was called by the builder" (R export.ts:116), true only for the scripted engine, so the export is refused for a project the scripted engine did not build (`scriptedOnlyProblem`, R J2: journey.ts:558), until package 2.2 gives the note another line.

## 2. The tables: known gap 53 decided

**Today.** Step 01 writes 4 files and no migration (R S01/manifest.json). The builder makes the table with `drizzle-kit push --force` in the tools container (R scripts/example-1-sandbox.ts:138), as do two demonstration scripts (R scripts/demo-scripted.ts:200; scripts/demo-template.ts:93). The run image has no `drizzle-kit` (R TPL/Dockerfile:35-44), so an exported app has no fixed way to make its tables (R KG 53). `--force` accepts statements that lose data without asking (I).

**Measured** (M SX-M 02-migrations.out, 04-dev-packages.out, 07-drift-check.out):
- `drizzle-kit generate`, in the tools image with no network and a read-only root, works. In two parts it gives the template's `0000_template` and then the data step's `0001_leave_request`, which holds only `CREATE TABLE "leave_request"` with its 3 checks and 3 foreign keys.
- A second `generate` gives byte-identical SQL, but the snapshot's id is random and the journal holds a time. So the files are made once and committed, never remade at build time.
- `drizzle-kit migrate` in the tools image, read-only root as in the sandbox, applies both; a second run applies nothing (`drizzle.__drizzle_migrations` holds rows 1 and 2).
- `generate` against the committed files, with nothing changed, prints "No schema changes, nothing to migrate" (B2; K1). With one column added to the schema and the files read-only it still exits 0, its write having failed (K2); on a writable scratch copy it writes a new migration and snapshot, `ALTER TABLE "leave_request" ADD COLUMN "note" text` (K3). Its exit code says nothing; its output and new files do.
- `drizzle-kit push --strict --verbose` against the migrated database prints "No changes detected" (D2). Only that no-change case was measured; with a change, it may ask or apply (I).
- The tables made by `migrate`, by drizzle-orm's own migrator and by `push --force` are identical (`pg_dump --schema-only` of `public`, 230 lines); migrations add a `drizzle` schema for their own bookkeeping.
- The run image holds no `drizzle-orm` (Next bundled it), `drizzle-kit`, `tsx` or `better-auth` (case C0). So the tables and the seed need the tools stage, whichever option is chosen.

**Decision: option (a), fixed migration files, in two parts.** Gap 53 left this choice to package 3.2 between two named options (R KG 53); this one returns step 5 to the design note as approved, "creating the leave-request table and migration" (R DN:514).
1. The template carries `drizzle/0000_template.sql`, `drizzle/meta/0000_snapshot.json` and `drizzle/meta/_journal.json`, generated once in the tools container from the template's own settings, never on the machine.
2. Step 01 adds `drizzle/0001_leave_request.sql` and `drizzle/meta/0001_snapshot.json` and replaces `drizzle/meta/_journal.json`: 4 files become 7, the fingerprints are remade with `scripts/scripted-manifest.ts`, and step 02 is unchanged (I).
3. Every place that makes the tables uses `drizzle-kit migrate` in the tools stage: the builder's sandbox (`scripts/example-1-sandbox.ts:138`), the two demonstration scripts (`scripts/demo-scripted.ts:200`, `scripts/demo-template.ts:93`), all through one helper, and the exported app's `setup` service. What is tested is what is exported, and nothing makes tables another way.
4. **The drift check**, in the sandbox after `migrate`: `generate` into a temporary copy of `drizzle/`, read from its output and the files it adds, never from its exit code. It passes only on "No schema changes, nothing to migrate" with no new file (measured both ways: K1, K3). `push --strict` is not used: its case with a change was not measured, and it could apply that change to the sandbox's database (both critics). What it compares: the schema files with the migrations' snapshots, not the SQL files with the live tables; in 3.2 every migration file is fingerprinted by the scripted step (S15), so the two cannot differ; for package 2.2 see gap N8.
5. The exporter refuses a history whose `drizzle/` folder does not match its journal (every entry with its `.sql` and snapshot, nothing else), or whose two `0000` files differ from the template's.

**Why:**
- It meets the design note.
- A second start is safe (M).
- The table's SQL is a fixed file in the history, which a reviewer can read.
- The SQL of the protected sign-in tables stays in the template's own file, not in a step's.
- It opens a way to run without development tools at milestone 6: drizzle-orm's migrator applied the files from the run image once given drizzle-orm (M SX-M C2 and C3); that needs a Dockerfile change and a seed that needs no tools stage (question 26 (b)).

**Not chosen: option (b), `push --force` from the exported copy's tools stage.** It changes no step, but the tables would be worked out at every start by a development tool told to accept data loss without asking (I: measured only on an empty database), and the 12 Nov amendment (R DN:523) would stay for good.

**What option (a) costs, said plainly.** Step 1's reservation becomes 7 turns at $0.3888 a turn, $2.7216 (I: the turn limit is the step's file count, R J2: journey-jobs.ts:379; $0.3888 a turn, R J2D:65). A step refused for lack of room would read "This step needs up to $2.73 to finish (7 turns)" and "A cap of at least $2.73" (R holds.ts:811-813 rounds up to the cent). The $5.00 cap still holds each step, and the $1.00 project is still refused (I).

The lines that follow from step 01's file count, found by `grep` for `1.5552`, `1.56`, `4 turns` and `"01-data", 4` (R at `392a6fd`), each changing with the count and none loosened:
- step 1's reservation, $1.5552: J2: test/journey.test.ts:346 (a test's name), :358-359, :1972 (a test's name), :1978-1979, :2316; J2: test/web.test.ts:683, :1985, :2546, :2552; J2: camera/builder-shots.mjs:197, :248, :493, :553; J2: scripts/demo-journey-j2.ts:493;
- the refusal of the $1.00 project, "$1.56 to finish (4 turns)" and "A cap of at least $1.56": J2: test/journey.test.ts:382; J2: test/web.test.ts:762; J2: camera/builder-shots.mjs:298;
- the plan's file count, `["01-data", 4]`: J2: test/journey.test.ts:101, :1714; R test/scripted-engine.test.ts:790;
- the step's result read from the real manifest, 4 turns and 4 changed files: R test/scripted-engine.test.ts:333-335 (the 3 new paths join the list).

**Not changed**, because the test sets 4 turns itself and does not follow the file count: J2: test/journey.test.ts:229-230 (its step passes `maxTurns: 4` at :216) and :832, :838 (`openStepHold` with `maxTurns: 4` at :827, :830); J2: test/web.test.ts:2551 (`maxTurns: 4` at :2520). The first draft listed the first three as changing; the feasibility critic found they do not.

**Projects built before 3.2** have no migration files. They cannot reach the new exporter: an export needs the sandbox held by the interface that built it (R J2: journey-jobs.ts:320-323), and that interface ran the older code (I). The refusal in item 5 covers them anyway.

**For package 2.2:** a step a model writes that changes `app-schema.ts` must add its migration. Only the drift check catches one that does not (gap N8).

**The amendment to the Stage 1 design note**, written into DN in the same pull request as the package (R BP:254), as a new table after the one for package 2.1 (R DN:519), with that table's 12 Nov row on step 5 (R DN:523) given "Settled in package 3.2: see the amendment below" in its last column:

*Amendments for package 3.2 (the exporter), <date>.* Rows 1 and 2 decided by Claude Code as how something is built (BP section 4) and recorded in DEC, not approved by the owner. Rows 3 to 6 are the owner's: each is written in only as he answers the question it names, and as he answers it.

| Date | Change | Why | Where it stands |
| --- | --- | --- | --- |
| <date> | Step 5: the data step adds fixed migration files, made once by `drizzle-kit generate` in the tools container; the template carries its own first migration; the builder's sandbox and the exported app make the tables with `drizzle-kit migrate` in the tools stage, followed in the builder by a drift check (`generate` into a temporary copy) read from its output | Known gap 53; the step as approved says "table and migration" | Gap 53 closed when the package's run shows it |
| <date> | Step 7: the one documented command is `docker compose up --build`, from `compose.yaml`, a protected file of the template; the passwords are made at the first start into a Docker volume, each service given only its own; one port on the machine's loopback, through a door container, while the app, the database and the tools keep 0.6c's private networks | Section 1 (DN:29) says the exported app starts on its own with one command | Gap N1; the reading of 0.6c it rests on (decision 3) is the owner's to confirm |
| <date> | Step 7, "on the same machine": on the development machine, the copy's install step uses npm's downloads that the builder's own builds kept in a Docker cache mount before the builder stopped; on another machine it downloads them | On this machine a build on Docker's default network cannot download packages (measured) | **The owner's: question 23.** Gap N2 |
| <date> | Step 7 and 7.2 (DN:538), "the check passing against the exported app from the exported copy": the copy's tests, unchanged, run in the builder's own runner image, started by the builder's own check code, on the same machine; the test is the stand-in, labelled so | The browser is approved only inside the runner, never given to anyone (DEC:110); the stand-in test is allowed in the internal export (DEC:130) | **The owner's: question 24.** Gap N3 |
| <date> | Step 7, "the builder is stopped": the builder that made the export (its process, database, project containers and data folder); another builder on the machine may run, untouched | The owner's builder on 4020 runs on the same machine | **The owner's: question 25.** Gap N4 |
| <date> | 2.7 (DN:200), "so the customer receives and can run the same checks": the copy carries the tests, not the runner or the browser; what a customer receives waits for milestone 6 | DEC:97 and :110 leave customers out of both approvals | **The owner's: question 27.** Gap N3 |

## 3. The check from the exported copy

**Measured** (M SX-C, by a reader's scripts, not by the export job):
- **The fix of section 1 works.** With `acceptance` excluded from both the TypeScript settings and the image build, the copy builds and the tests are in neither image (m3-build.txt).
- **The check passed from an exported copy, with no builder started by the measurement** (m4-run.txt). The owner's own builder on 4020 was running, untouched, as were the phone-test pages on 4032 and 4033 (listening ports 4020, 4032, 4033 and 4034, m4-ports-4020-4040.txt). The export was made by the reader's script calling `writeExport` on a scratch history (m1-export.mts), not by the export job, and the tables were made with `drizzle-kit push --force` (m4-run.sh:48), not `migrate`.
  - The runner image was package 3.1's, `builder-acceptance-runner:local`; its label check (`runnerImageProblem`) found nothing wrong.
  - It was started by plain `docker run`, with 3.1's hardening and mounts, on a private network made like 0.6c's.
  - The tests were mounted read-only from the unpacked, unchanged copy.
  - The store's folder was moved away first. 3.1's `verifyVersion`, pointed at the exported folder, passed, and the manifest's SHA-256 was the same in `acceptance/README.txt` and in the export's record (`327e7780…f08892`).
  - Nothing answered at the app's address before the app started. The app's container ran the image built from the copy, and its sign-in page answered 200.
  - Playwright reported "1 passed (2.5s)", exit code 0. 3.1's `readRun`, unchanged, read "passed", "version passed; checklist incomplete (5 of the app spec's 6 checklist items have no test)", with the checklist count given by hand. `results.json` named the run's id and the exported manifest's fingerprint.
  - Afterwards the copy was unchanged: every file's SHA-256 the same, `git status --porcelain --ignored` empty.
- **The browser's address must be the app's `APP_URL`** (m5-run.txt). With `APP_URL=http://localhost:3000` and the runner at `http://app:3000`, sign-in answered 403; `readRun` read "failed" at "signs in as the sample employee", and the app told the user "The email or password is not right" (R TPL/src/app/[locale]/sign-in/SignInForm.tsx:41 shows that text for a 403).
- **The sample password is in the run's files:** in 3 entries of `trace.zip`, and in `error-context.md` of a failed run; not in `results.json` (m4-trace-password-search.txt). This is KG 72's kind.
- **Control:** one expectation in a copy of the test, loosened from `/waiting/i` to `/./`: `verifyVersion` reported "item-01.spec.ts does not match its fingerprint", every item "did not run", outcome "not passed" (m4-run.txt, end).
- **The forwarder works** (M SX-K f-run.out, f/runner-inspect-while-running.txt). The app from the copy ran with `APP_URL=http://localhost:3000`. A forwarder (the approved `node` image, user `node`, read-only, on the private `front` network only) listened on its own 127.0.0.1:3000 and forwarded to `app:3000`. 3.1's runner image shared its namespace (`container:<id>`, user `runner`, read-only root, every capability dropped). Result: "1 passed", exit code 0, and `readRun` read "passed; version passed; checklist incomplete (5 of the app spec's 6 checklist items have no test)" (the count given by hand).

**The design: a check script, not the builder's interface.** `scripts/check-export.ts <copy folder> --project-id <id> --version <v> --manifest-sha256 <hex> --checklist-items <n> --run-folder <folder>`, its logic in `src/export/check-from-copy.ts`. It is the builder's own code, run on the machine. It uses package 3.1's code as a library and opens no builder interface, database, gateway or acceptance store. Its four values come from the export's event, recorded before the builder stopped. In order:
1. **The version.** `verifyVersion`'s checks, unchanged, on `<copy>/acceptance/<version>`: the manifest and exactly the files it names, their fingerprints, the marker, the stand-in label, and that the manifest names this project and version. The store's `verifyVersion` (R store.ts:279) becomes a wrapper around `verifyVersionAt(folder, projectId, version)`, keeping its check that the manifest names the project (R store.ts:300); the measurement had to point a linked folder at the export to call it (M SX-C m4-check.mts).
2. **The fingerprint.** The manifest's SHA-256 must equal the one the caller gives and the one in `acceptance/README.txt`. This stands in for `versionMatchesEvent` (R runner.ts:98), which needs the builder's database.
3. **The runner image:** `runnerImageProblem("builder-acceptance-runner:local")` (R runner-image.ts:171). A missing or wrong image means "did not run"; the script never builds an image and never downloads anything.
4. **The right app**, rebuilt from `appAnswers` (R runner.ts:76-96) without the sandbox:
   - the container of service `app` in the Compose project whose working folder is the copy is running and healthy (I: Compose labels each container with its project's working folder, `com.docker.compose.project.working_dir`; read from `docker inspect` first in the build, and recorded in SRC);
   - its image is the one Compose built from the copy (`<project>-app`, compared by id);
   - its sign-in page answers 200, asked from a short-lived approved `node` container on `<project>_front` alone;
   - no container other than the project's `app` and `door` and the check's own is on `<project>_front`.
5. **How the browser reaches the app: the forwarder** (measured above). The port is taken from the app container's own `APP_URL`, since `APP_PORT` can change it. The runner shares the forwarder's namespace (`--network container:<forwarder>`), with `BASE_URL` equal to that `APP_URL`. So:
   - the browser's origin is the app's `APP_URL`, which sign-in requires (m5-run.txt);
   - the runner is on an internal network only (0.6c; KG 70), never on `data`, where the database is, and never on the door's ordinary network;
   - one start serves both the person and the check.

   There is no fallback. If the forwarder does not work in the build, 3.2 stays "built, not tested" and the owner is asked: a start with a different `APP_URL` would not be the app started by the one documented command (R DN:516, :538).
6. **The runner**, as 3.1 runs it, nothing changed:
   - 3.1's command and its configuration baked into the image (R runner.ts:31; runner/playwright.config.mjs);
   - the hardening, a read-only root, `/tmp` of 512 MB, user `runner`. 3.1 starts it through Compose from `acceptanceService` (R manager.ts:316-330); the check script's `docker run` arguments are built from that same object and `HARDENING`, not written again, and a test compares them field by field (T8);
   - exactly 3.1's three mounts: `/acceptance`, the copy's `acceptance/<version>`, read-only; `/results`, a fresh folder outside the copy, refused if it exists, handed to the runner's user as 3.1 does (R runner.ts:145-148); `/run/secrets/sample-password`, the one file from the `keys` volume, read-only, through Docker's volume subpath (M SX-M O3 with a stand-in; SX-F M3; I with the runner);
   - `RUN_ID` and `BASE_URL` only;
   - 3.1's limit of 600 s (R runner.ts:32), killed after it.
7. **The reading:** `readRun`, unchanged (R results.ts:260), given the checklist count from the event (`checklistItems`, R results.ts:78, :385-386; the builder's own run takes it from the app spec, R J2: journey-jobs.ts:566).
   - "Passed" only if every item ran once, on retry 0, and passed, with its own screenshot, the run's id and fingerprint matching, and exit code 0 or 1.
   - "Failed" for a recorded failure, with the step named.
   - Anything else is "not passed". Any refusal before the start makes every item "did not run" and the outcome "not passed".
   - It is reported as "version passed; checklist incomplete (5 of 6)", labelled "stand-in test, not independent acceptance" (R DEC:130).
8. **Afterwards:** the forwarder is removed by its exact name. The copy's file fingerprints and `git status --porcelain --ignored` must be what they were. The run folder stays outside the copy and out of `evidence/`, except the item's screenshot and the reading (KG 72: the trace holds the password).

**Kept as they are:** `verifyVersion`'s checks; `readRun`; the baked configuration (retries 0, one worker, `forbidOnly`, a trace without screen frames, the screenshot on, video off: R DEC:110, "no video"); the runner image's label check; the runner never on the machine's network; the exporter's refusals; the stand-in label.

**What "from the exported copy" means here** (question 24): the tests' files come from the copy, unchanged; the code that checks and starts them, the runner and its browser are the builder's, on this machine, and the fingerprint they are checked against was recorded by the builder before it stopped. Whoever receives the copy cannot run the check with what it holds; DN:200's "can run the same checks" waits for milestone 6 (question 27; gap N3).

## 4. The licence conditions: known gap 39

**The conditions, word for word** (R DEC:45): "it covers these names and uses, not other packages with the same licences; their licence and attribution notices are kept; a check on each export shows the development packages are absent; each exported app carries a notices file for `caniuse-lite` with the items of CC-BY-4.0 section 3(a)(1); the licence checks pass with the names as dated exceptions." The development packages are `lightningcss` with its eleven build packages, `spdx-exceptions` 2.5.0 and `spdx-ranges` 2.1.1: 14 names (R DEC:45; TPL/licence-rule.json). They are approved "for development use only, never in what a customer receives"; `caniuse-lite` is approved "in generated apps" (R DEC:45).

**Measured** (M SX-L 01-measure.out, 02-measure.out, 04-measure.out; example 1's app built with the template's own Dockerfile):
- **The run image** (274 MB) holds 275 `package.json` files that name a package, 77 of them under `/app`. None of the 14 names is under `/app`.
- **One of the 14 is elsewhere in it:** `/usr/local/lib/node_modules/npm/node_modules/spdx-exceptions`, 2.5.0, CC-BY-3.0, part of the base image's own npm.
- **`caniuse-lite` is not in the run image:** only `next/package.json` names it. That it is used only while building is I.
- **The tools image** holds `lightningcss` and both of its `linux-x64` build packages, `spdx-exceptions`, `spdx-ranges`, `caniuse-lite` and `license-checker-rseidelsohn`, as a development stage should. The exported app builds and runs that image at each start, as its `setup` service (section 1).
- **The run image holds no notices file anywhere**, and none of the 75 package folders under `/app/node_modules` keeps a licence, copying or notice file of its own: Next's standalone output copies only what its tracer finds (04-measure.out).
- **The template's own licence check, run from the copy in its tools image with no network:**
  - `bash scripts/check-licences.sh`, which `npm run check:licences` runs, exits 127: the image has no bash (C1);
  - through `sh`, or as its two commands directly, it passes (Ca, Cb);
  - with one line added to the notices file, or the file removed, it fails (Cc, Cd);
  - with the copy's own rule changed to allow the development packages in shipped use, it also failed, but only because the notices file then no longer matched: the copy's own rule is trusted (Ce).
- **The archive** holds the development packages only as names in `package.json` and `package-lock.json`, not as files (M SX-E listing); the lock marks the 14 as development packages and `caniuse-lite` as not (M SX-L 03-lockfile-dev-names.txt).
- **The builder's own licence check never runs the template's:** `scripts/check-licences.sh` checks `builder/` and `builder/runner/` only (R scripts/check-licences.sh:1-23), and no test runs the template's check (R grep of test/).

**Each condition, and what 3.2 does.** The third condition, a check that the development packages are absent, is the owner's to read (question 26). Until he answers, the export check does what (a) of that question describes and reports it as "checked under this reading", never as met.

| Condition (R DEC:45) | Today | After 3.2 |
| --- | --- | --- |
| These names and uses only | The template's rule names them (R TPL/licence-rule.json); a test pins its shipped exception to `caniuse-lite` (R test/licence-rule.test.ts:41-50) | The copy's rule and licence scripts must be byte-equal to the builder's own TPL copies, since the copy's own rule is otherwise trusted (M SX-L Ce) |
| Notices kept | The notices file travels in the archive (R EJ1), unchecked; it is not in the run image (M) | The run stage copies it to `/app/THIRD-PARTY-NOTICES.md`; each export is refused unless it is there, byte-equal to the copy's |
| A check on each export: development packages absent | None | **Question 26.** Under (a): the export job builds the archive's images and lists every named package in each. Any of the 14 under `/app` of the run image refuses the export. Every other copy is listed by image, path and version, on the screen and in the record: in the tools image, each of the 14 that is installed (here five: `lightningcss`, its two `linux-x64` build packages and the two `spdx` packages, M SX-L); in the run image, only the one known copy inside the base image's npm, and any other refuses the export |
| A notices file for `caniuse-lite` with the items of 3(a)(1) | The file has a line for each item: the creator, "no separate copyright notice", the licence and its text, the warranty disclaimer by reference, the source address, "Modified by this project: no" (R TPL/THIRD-PARTY-NOTICES.md:5-15) | Unchanged. Whether it is sufficient is not judged |
| The licence checks pass | Never run by the builder on the template, a project or an export (R) | Run on each export, from the copy, in its tools image, with no network (M SX-L Cb) |

**The checks on each export, in the export job, before the export is recorded or offered.** They run through one method of the injected `Sandboxes` object (`sandboxes.checkExport`, beside `engineRunner`, R J2: journey-jobs.ts:143, :370), so J1's fast export tests, which run on stand-in sandboxes with no Docker (R J2: test/journey.test.ts:674-761), get a stand-in that records the call; the live test L1 carries the real proof. Every container they start has the sandbox's hardening (R manager.ts:139-145): every capability dropped, no new privileges, a read-only root, 256 processes, 1 GB, a `/tmp` of 64 MB in memory with no programs run from it, no network, and an unprivileged user (`nobody` in the run image; `node` in the tools image).
1. **On the machine, reading only:** the archive holds no `node_modules` folder and no path named like any of the 14.
2. **The fixed files** are byte-equal to the builder's own TPL copies (section 5, S13), and none of S29's names is in any commit.
3. **The images.** After the disk check every build already makes (R J2: journey-jobs.ts:314-317; its 4 GB floor is assumed, KG 137), the archive is unpacked into a fresh folder in the project's exports folder. Its run and tools stages are built through the sandbox's own build path, its egress door (R manager.ts:966-988), tagged `builder_<id>-exportcheck-run:latest` and `builder_<id>-exportcheck-tools:latest`. These builds also fill npm's cache mount (section 1). Both images are removed by exact name afterwards and added to the project's removal list.
4. **What Compose reads** (S30): in the unpacked folder, with only `PATH` and `HOME` set, `docker compose config --format json` equals the same command run on the template's `compose.yaml` alone in a scratch folder of the same name, once the two folders' paths are set aside.
5. **In the run image:** the listing of every named package in the whole image, as SX-L's A1 made it. Any of the 14 under `/app` refuses the export; each copy outside `/app` is listed, and any other than the known one refuses it.
6. **Also in the run image:** `/app/THIRD-PARTY-NOTICES.md` is there and byte-equal to the copy's.
7. **In the tools image:** the same listing, recorded; then `node scripts/check-lock.mjs && node_modules/.bin/tsx scripts/licence/check.ts`. It must exit 0, and its output must hold "RESULT: PASSED" twice and "Notices file THIRD-PARTY-NOTICES.md is up to date." That it runs under the hardening above (a read-only root, user `node`) is I: the readers ran it without a read-only root (M SX-L 02-measure.sh); measured first in the build.
8. **Recorded:** the results go into the event and onto the export screen.

The automated run repeats items 4 to 7 on the images the copy's own command built, with the builder stopped (section 7).

**Not judged here**, for an engineer or a lawyer; nothing here is legal advice. None of it blocks 3.2's export, which stays internal:
- whether the notices file is sufficient for CC-BY-4.0 section 3(a)(1);
- whether anything passed on must carry the notices of the permissive packages, which are in neither the run image (M) nor the notices file, which lists only the packages approved by name (R its first lines) (gap N6);
- whether the base image's own copy of `spdx-exceptions`, and the tools image the copy builds and runs at each start, count as part of "what a customer receives" (gaps N5, N9; question 26);
- what "absent" means for the development packages a customer's own build would download (KG 39's open point; QS, "Yours to confirm").

**Customers.** "Not approved: anything a customer receives (package 3.2)" (R DEC:97), and customer use of the browser is "asked again at 3.2" (R DEC:110). Both were left by the owner for 3.2. This design recommends that 3.2's export stay internal and that both move to milestone 6, but that is his to decide: question 27.

## 5. The safeguards

**Finding F1** (M SX-E probe-symlink.out.txt, with the J2 branch's own `writeExport`).
- The probe gave `writeExport` a history whose `EXPORT-NOTE.txt` is a link to a file outside the copy.
- The export was written. The file outside the copy was overwritten with the note's text, on the machine, as the builder's user. The archive holds the link, and the export commit holds only the three acceptance files, without the note.
- Why: `writeFileSync` follows links (R export.ts:111-120); the history check refuses only acceptance paths and secret-like names (R :81-84); and links are allowed in a project's history (R project-repo.ts:123).
- The scripted engine writes only plain files and refuses a path that goes through a link (R scripted/apply.mjs:56-62), so it cannot cause this (I). An engine with file or shell tools, package 2.2, could (I).
- The same probe exported a made-up private key held in an ordinary source file: the secret check reads names, not contents (M SX-E, case key-content; gap N10).

| # | Safeguard | Test | Control: removed, this test must fail |
| --- | --- | --- | --- |
| S1 | A history in which any commit of any branch or tag holds a symbolic link or a submodule (modes 120000, 160000, read with `git log --all --raw`) is refused | E1: F1's probe as a test (the outside file unchanged, no archive written); E2: a submodule | E1, E2 |
| S2 | The exporter's own files are created exclusively and without following a link (`O_CREAT`, `O_EXCL`, `O_NOFOLLOW`), in folders it has just made | E1b: a test hook plants a link at `EXPORT-NOTE.txt` after the clone: refused, the outside file unchanged | E1b |
| S3 | `EXPORT-NOTE.txt` in any commit is refused | E3 | E3 |
| S4 | The export commit adds exactly the intended paths, as plain files (100644), with the intended content (`git diff-tree --raw`) | E4: a hook adds `acceptance/<version>/extra.txt` before the commit: refused | E4 |
| S5 | Every file of the checkout is byte-equal to its stored version (`git hash-object --no-filters` against `git ls-files -s`) and nothing else is in it; the clone takes an empty template folder, so git's 14 sample hooks are not shipped (M SX-E) | E5: a history with a `.gitattributes` that turns line ends into CRLF: refused (I: exported with changed bytes today) | E5 |
| S6 | An acceptance folder in the history is refused (R export.ts:82) | E6, a regression guard | E6 |
| S7 | Secret-like paths, `.env` among them, are refused (R export.ts:44-47, :83-84) | R J2: test/journey.test.ts:715, :737 | J1's controls C38 and C53 |
| S8 | The version must match its manifest (R export.ts:75-76) | E7, a regression guard | E7 |
| S9 | The manifest's SHA-256 equals the one in `acceptance.run.finished` (R runner.ts:221-223) of the run that `journey.signed_off` names (R J2: journey.ts:1032-1039) | E9 | E9 |
| S10 | The workspace history did not move during the export (R export.ts:127) | E8, a regression guard, through a hook that moves HEAD | E8 |
| S11 | Only reachable objects, and no remote (R export.ts:90-94) | R J2: test/journey.test.ts:761, :704 | J1's control C54 |
| S12 | One export per project; the archive moved into place only if none exists; a failed export leaves no file | E10 | E10 |
| S13 | These files at HEAD are byte-equal to the builder's TPL copies: `compose.yaml`, `README.md`, `Dockerfile`, `.dockerignore`, `tsconfig.json`, `package.json`, `package-lock.json`, the six licence files, the two `0000` migration files | E13: each changed in turn is refused, the file named | E13 |
| S14 | The `drizzle/` folder matches its journal | E12: a missing file, an extra file, no folder | E12 |
| S15 | Only a project the scripted engine built is exported | E16 | E16 |
| S16 | Sign-off before export, and the broken-copy refusals (R J2: journey.ts:535) | R J2: test/journey.test.ts:107, :622; J2's A3, A6, A6b | J1's and J2's controls |
| S17 | None of the 14 names under `/app` of the run image built from the archive; outside it, only the known copy; every copy in both images listed | L1: made-up images built on the checked run image, one adding `/app/node_modules/lightningcss/package.json`, one adding a second copy of `spdx-ranges` outside `/app` | L1 |
| S18 | The notices file in the run image, byte-equal | L1: a made-up image without it | L1 |
| S19 | The template's licence check passes from the copy, by exit code and output | L1: the check function given a copy whose notices file has one line more | L1 |
| S20 | The archive holds no `node_modules` and no path named like the 14 | E20, a regression guard, with made-up archives | E20 |
| S21 | `tsconfig.json` excludes `acceptance`; `.dockerignore` lists `acceptance` and `.git` | T1; L2 (the copy builds, and `/app/acceptance` is absent from the tools image) | T1 for each; both removed, L2 fails to build (M SX-C m2) |
| S22 | The compose rules: `app`, `db` and `setup` on internal, isolated networks only; `keys` with no network; `door` the only service with a port, on 127.0.0.1 only, on `front` and `edge`; no service on the machine's network; every service hardened; only approved images by digest; each service given only its own key files; the file equal to the generated one | T2; R test/approved-images.test.ts, which scans `templates/` | Each rule removed in turn: T2 |
| S23 | The protected paths extended; a step that adds one of S29's names fails | T3; scripted-engine tests in which a step writes `compose.yaml`, and one in which it adds `compose.override.yaml`, and each fails | T3 |
| S24 | Tables by `migrate`; the drift check by `generate` into a temporary copy, read from its output and new files | T7; L4 (a schema change with no migration: the preview is refused, the drift named) | T7, L4 |
| S25 | The check script runs `verifyVersionAt` before the start | L3: a tampered copy gives every item "did not run" and "not passed" | L3 |
| S26 | The check script's right-app checks | L3b: an app container not built from this copy: refused | L3b |
| S27 | The runner in the forwarder's namespace, on `front` alone | L3c: inspected while it runs, the forwarder's networks are only `<project>_front` and the runner's mode is `container:<forwarder>` | L3c |
| S28 | The label | E15: English equal to `EXPORT_LABEL`, Arabic present, the words "no notices file" gone | E15 |
| S29 | In any commit, a file named `compose.override.yaml`, `compose.override.yml`, `docker-compose.override.yaml`, `docker-compose.override.yml`, `compose.yml`, `docker-compose.yaml` or `docker-compose.yml`, at any depth, or any `*.dockerignore` other than the root `.dockerignore`, is refused | E21: each name in turn, in an earlier commit: refused, the file named | E21 |
| S30 | What Compose reads in the unpacked copy (`docker compose config --format json`, plain environment) equals what it reads from the template's `compose.yaml` alone; at export and again in the run before the start | L2b: an unpacked copy given a `compose.override.yaml` after export: the comparison fails and names the door's `privileged` | L2b |
| S31 | The check script's reading uses the checklist count recorded in the event | E17: a made-up results folder, count 6: "5 of the app spec's 6"; without the flag the script refuses to run | E17 |

Controls are run as J2's were (R J2D section 6): each safeguard removed by exact text replacement, its test run alone and shown failing, the file put back, and the checkout compared with HEAD at the end.

## 6. The tests to write first

**How.** Each new test is committed first, then run with `builder/src`, `builder/scripts`, `builder/scripted`, `builder/camera` and `templates/` as they are on the integration branch with J2 merged, where it must fail; then on the change, where it must pass. The output goes to `evidence/<date>-package-3.2/new-tests-before-and-after.txt`, as J2's did. No test may skip (the gate scan, KG 112). Since 3.1b, live tests are never skipped: without Docker or the runner image they fail, saying what is missing (KG 73).

**Fast tests**, in a new `test/export.test.ts` unless named, and why each fails on today's code:

| Test | Fails today because |
| --- | --- |
| E1, E1b | Links are followed and not refused (M SX-E) |
| E2 | Submodules are not refused (I) |
| E3 | `EXPORT-NOTE.txt` in the history is overwritten, not refused (R export.ts:111) |
| E4 | Nothing reads the export commit's contents (R export.ts:121-125) |
| E5 | Nothing compares the checkout with its stored bytes (R) |
| E9 | The run's fingerprint is not compared (R export.ts:75-76) |
| E10 | A second export runs (R J2: journey.ts:535) |
| E12 | The history has no `drizzle/` folder at all |
| E13 | Nothing compares fixed files with the template (R) |
| E14 | The event lacks the new fields, `checklist_items` among them (R J2: journey-jobs.ts:588-599) |
| E15 | The label still says "no notices file" (R J2: journey.ts:244-245) |
| E16 | Nothing checks the engine at export (R J2: journey-jobs.ts:581-600) |
| E17 | There is no check script |
| E21 | None of S29's names is refused (R export.ts:44-47 refuses secret-like names only) |
| T1 | `acceptance` is in neither file (R TPL/tsconfig.json:39-41, TPL/.dockerignore) |
| T2 | There is no `compose.yaml` |
| T3 | The new paths are not in `TEMPLATE_PROTECTED_PATHS` (R scripted.ts:50-64), and no check refuses S29's names after a step |
| T4, in test/scripted-engine.test.ts | Step 01 has 4 files and the template no `drizzle/` folder (R :790) |
| T5 | The README says "the sample password the builder gave you" (R TPL/README.md:15), has no way to see it, and its "Start it" section is not checked to hold one code block |
| T6 | The run stage copies no notices file (R TPL/Dockerfile:39-41), and the install step has no cache mount and no `--prefer-offline` (R TPL/Dockerfile:17) |
| T7 | The sandbox and two demonstration scripts run `push --force` (R scripts/example-1-sandbox.ts:138; scripts/demo-scripted.ts:200; scripts/demo-template.ts:93) |
| T8 | There is no check script, so no runner arguments to compare with `acceptanceService` (R manager.ts:316-330) |

**Cannot fail first**, marked so in the evidence; their controls show they can fail:
- E6, E7 and E8, the three existing refusals that had no test (M SX-E grep);
- E20, which today's archives already pass;
- J1's export tests (R J2: test/journey.test.ts:674-761), which must pass with the export check's stand-in;
- the store's tests of `verifyVersion` (R test/acceptance.test.ts:132-217), which must pass unchanged after the refactor;
- `test/approved-images.test.ts`, which will scan the new `compose.yaml`.

**Expectations that change, none loosened:** the lines listed in section 2 ("What option (a) costs"), each following step 01's file count; and the label test against the new text.

**Live tests**, in a new `test/export-live.test.ts`, under the shared lock:
- L1: the export job's image checks, on a real export of example 1, and their refusals;
- L2: the copy's own start (build, keys, migrations, seed, health, a second start, `down --volumes` leaving nothing); L2b: S30's comparison and its refusal;
- L3, L3b, L3c: the check from the copy;
- L4: the drift check.

They fail today only because nothing they call exists. That red proves little, so their proof is in their controls.

**The whole suite**, `npm run typecheck` and `npm run check:licences`, run before every push, as CLAUDE.md asks.

**Tested work this package reopens** (R BP:253, section 8, rule 8: a tested package is reopened when a later package requires a change to it; its evidence is run again, and the packages that depend on it are checked). Tested today: 0.1 to 0.5, 0.6a, 1.1, 1.2, 1.2b, 1.3, 1.4, 1.5, 2.1 and W4 (R ST:15).
- **2.1, the scripted engine:** step 01's manifest goes from 4 files to 7 with new fingerprints (R test/scripted-engine.test.ts:790), and `scripted.ts` gains protected paths and a refusal after each step. Its evidence is run again (`scripts/demo-scripted.ts`, which itself changes to `migrate`); 2.2 and 3.1, which depend on it, are checked.
- **0.5, set-up in a tools container:** the tables are made by `migrate`, not `push --force` (`scripts/example-1-sandbox.ts`, `scripts/demo-template.ts`), and its `.dockerignore` (R `git log` of TPL/.dockerignore: package 0.5) and its tools-stage comment change. Its "Done means" test (the seed's environment) is run again; 0.6a, which depends on it, is checked (its probes do not use the table set-up: I).
- **Not reopened, but touched and not tested anyway:** 0.6c (the Dockerfile's install step, built by 0.6c's build path) and 3.1 (`verifyVersion`'s refactor; `scripts/example-1-sandbox.ts`). Their own tests run in the suite.

**Before 3.2 can be marked tested.** Its "Depends on" column is "3.1, L11" (R BP:193), and a package starts only when the packages it lists are **tested** (R BP:131). 3.1 is built, not tested (R ST:16). 3.2 is designed now because the owner's message of 13 Nov organised the work around the journey to the export (R DEC:128), and J2's design named 3.2 as next (R J2D:464); this is a departure from the plan's order, recorded in DEC as such, as DEC:74 recorded the last one (decision 19). 3.2 is not marked tested before 3.1 is.

## 7. The automated run

`flock <scratchpad>/live-tests.lock npx tsx scripts/demo-export.ts <evidence folder>`, built on J1's and J2's runs (R scripts/demo-journey.ts; J2: scripts/demo-journey-j2.ts).

**Before**, refusing rather than stopping anything:
- the runner image checked with `runnerImageProblem`;
- free disk and Docker's lists (containers, images, volumes, networks, and the build cache's records) recorded;
- **no refusal on others' names.** The owner's own builder on 4020 makes `j1-` projects, `builder_j1-<hex>` in Docker (R J2: journey.ts:50; manager.ts:201-202), so a refusal on any such name would block the run on any open project of his. The run's project id is new and random; the run checks that nothing of its own exact names exists when they are made, and at the end compares Docker's lists with the start, counting only what is new;
- a wait of up to 30 min for ports 4025, 3000 and 13161 to be free (4025 appears nowhere in `builder/` or `docs/` except inside a hash in a raw licence file: R grep);
- a fresh database `builder_x32_<run>`, data folder and camera folder;
- a random interface password, given to the camera as a 0400 file and never printed.

**A. With the builder running.**
- The interface runs on 127.0.0.1:4025 (`node --import tsx src/web/main.ts`), with the live preview off.
- The builder camera walks J1's path: sign in; "Leave requests (made-up)" with a $5.00 cap; the brief, the questions, both confirmations; steps 1 and 2, reserved and released at $2.7216 and $3.1104; the preview; the checklist passing; sign-off; the export; the download; "Close project".
- Checks:
  - the export screen shows the new label and the checks passed, in English, in Arabic and at 390 px;
  - the event holds the project's id, the manifest's SHA-256, its items, the checklist count, the run's id and the image checks;
  - the downloaded archive's SHA-256 equals the event's.

**B. The builder stopped.** The run saves the events (`events.json`), then sends SIGTERM to the interface and expects exit code 0 within 120 s, with "removed at the stop: 0", since the project is closed (J2's clean stop). Then it records:
1. The interface's process, whose id was recorded at its start, has exited, and nothing listens on 4025.
2. No process on the machine has the run's data folder, database name or interface process id in its command line or as its parent (`ps`).
3. Docker holds nothing of the project by J2's rule N (R J2D section 2): no container, volume, network or image of `builder_<id>`, and no `builder_<id>-exportcheck-*` image.
4. The run never started a gateway (a scripted run calls no model); what listens on 4010 is recorded, not touched.
5. The run's database is dropped. The archive and the events are copied out; then the run's data folder (the acceptance store, the exports folder, the sandbox folders) is deleted, and `docker ps -a` with `docker inspect` shows no container mounting any path under it. (The first draft moved it into a folder of mode 000; the critics found that no barrier to the run, which works as root.)
6. Whether 4020, 4032 and 4033 are listening is recorded; they are not touched (question 25).
7. **What the builder leaves that the start will use**, recorded: npm's cache mount, its size and when it was last used (`docker buildx du --verbose`), and the two base images by digest. The builder's own built steps are not reused by the copy's build, which runs on another network (section 1, "The build on this machine").

**C. The export, alone.**
- The archive is copied into a fresh `<run>/delivered/`, checked against the event's SHA-256 and unpacked.
- Its history: `acceptance/` first appears in the last commit, whose parent is the event's workspace head; `git status --porcelain --ignored` is empty.
- **Before the start:** the folder holds exactly the files the event lists; `compose.yaml`, `README.md`, `Dockerfile` and `.dockerignore` are byte-equal to TPL; none of S29's names is present; S30's comparison passes.
- The code block under the README's "Start it" heading is read and run exactly, in the unpacked folder, with a plain environment: `PATH` and `HOME`, no proxy setting, nothing of the builder's. Its output is kept, with the build's lines for the install step, which say whether npm ran (and how many packages it added, in what time) or the step was taken from an earlier layer built on the same network. The evidence says plainly that the packages came from npm's store, filled by the builder's builds before it stopped (question 23).
- The run waits up to 10 min for `app` to be healthy (`docker compose ps`). It records the images and their ids, the containers, the networks of each, and the one published port, 127.0.0.1:3000.
- **The person's way in**, from the machine as a browser would come:
  - the sign-in page at http://localhost:3000 answers 200;
  - sign-in with the origin `http://localhost:3000` answers 200, and with `http://127.0.0.1:3000` answers 403;
  - the password is read with the README's own command into memory, never printed or written.
- **No way back to the machine.** The run starts a listener of its own on the machine, on 127.0.0.1 and on every address, at a free port. From the app's network namespace and from the door's (a short-lived approved `node` container joined to each), a connection to that port at 127.0.0.1, at each gateway address of their networks and at Docker's default bridge address must fail; the results are recorded. That the exported app cannot reach the owner's 4020 either is inferred from this probe; 4020 itself is not probed.
- **The tables:** `drizzle.__drizzle_migrations` holds 2 rows, and the three made-up users exist (`docker compose exec db psql`).

**D. The licence checks on what the copy's command built** (the person's images, not the builder's): section 4's items 4 to 7 on `<project>-app` and `<project>-setup`.

**E. The check from the copy.**
- `scripts/check-export.ts` runs with the event's project id, manifest SHA-256 and checklist count, and expects "passed", "version passed; checklist incomplete (5 of the app spec's 6 checklist items have no test)".
- Its item screenshot is copied into the evidence.
- The runner's container is inspected while it runs (networks, mounts, user, read-only root, capabilities), as SX-C's m4 and SX-K's f-run did.

**F. A second start.** `docker compose down`, then the README's command again: the keys are "kept", no migration is applied, the users "exist", and the app is healthy (M SX-M O4 on the prototype).

**G. The copy unchanged.** Every file's SHA-256 and `git status`, after C to F.

**H. Clean-up**, in `finally`, by exact names only:
- the forwarder's container first, since a container left on `<project>_front` would stop Compose removing that network (I); the runner's is removed by `--rm`;
- `docker compose down --volumes` in the folder;
- the images `<project>-app` and `<project>-setup`;
- the run folder.

Docker's lists are compared with the start: anything new of the run left sets exit code 1. npm's cache mount is the builder's and stays.

**Pictures**, in `evidence/<date>-package-3.2/screens/NN-<screen>-<en|ar|phone>.png`:
- the export screen, with its label and checks, in English, Arabic and at 390 px;
- the checklist's item-1 picture, taken by the runner in the app started from the export, with the builder that made it stopped. It shows the app's "My requests" page: "Your request was saved. Its status is Waiting.", a five-day request marked "Waiting" whose reason names the run's id, under the app's banner "Sample data… Built by the scripted engine: fixed changes, no AI model." (as SX-C's m4-item-01-from-export.png shows). It does not show the reading, the label or that the builder was stopped;
- so, a picture of the run's record: a page the run script writes from its own files (`check-reading.json` and the stop record), photographed by the run's camera, with the outcome and summary, the stand-in label, the run's id (the same as in the item picture), and the times the builder stopped, the app was started from the export and the check ran. It is labelled as drawn from the run's files, not as a screen of the builder or the app.

**Files:**
- `run-demo.txt`, `events.json`, `interface-log.txt` (the run folder and the session's proxy replaced by placeholders, as J1's), `compose-output.txt`, `npm-build-lines.txt`, `check-reading.json`, `export-contents.txt`, `docker-after.txt`;
- **the secret search:** before anything is committed, every evidence file, pictures' names included, is searched for the four secrets the run handles: the interface password, the sample password, and the exported app's `db_password` and `auth_secret` (read from the `keys` volume with the README's kind of command into memory, never written). `run-secret-search.txt` records, for each secret by name, the number of files searched and the number that hold it; any hit refuses the commit, as 3.1's `run-password-search.txt` did (R KG 72);
- the evidence file `evidence/<date>-package-3.2/export.md`, in J1's and J2's shape: what the owner can now do; real or simulated, part by part (the steps simulated by the scripted engine; the containers, history, export, start, tables and check real; the test a stand-in; the packages installed from the builder's earlier downloads); the checks with their files; the pictures; checked and assumed; not done.

**Result:** the run prints "Checks in all: N passed, M failed" and exits 0 only if every check passed, every picture was copied, the secret search found nothing and nothing new was left.

## 8. Review by risk

Under BP section 3, step 6 (R BP:47):
- **Adversarial review** (fresh reviewers, each serious finding challenged by others), for three areas.
  - **Acceptance separation.** The tests' path into the copy: the export commit only, the workspace history untouched (S4, S6, S10). The fingerprint tied to the passing run (S9). The tests kept out of both images (S21). The check from the copy: `verifyVersionAt`, `readRun` unchanged, the baked configuration, the right-app checks without the sandbox (S25, S26, S31).
  - **Isolation.** The export's networks and the door's published port (S22; gap N1). What Compose and the image build read beside the fixed files (S29, S30). The forwarder and the runner's place on `front` alone (S27). The exporter's handling, on the machine, of files the engine wrote (S1 to S5). The images and containers the export job adds, and their names and removal, which must never collide with `builder_<id>` (section 1). npm's cache mount, shared by every project's build on the machine (gap N12).
  - **Key handling.** BP lists it among the areas for adversarial review (R BP:47). Here: the exported app's own three secrets, made at its first start into the `keys` volume, mode 0444, each service given only its own; the README's command that shows the sample password; the four secrets the run handles and its search of the evidence. The builder's model key is not touched by anything in this package.
- **One fresh review** for the rest: the tables (section 2), the licence checks (section 4), the labels, the one-export rule, the check script's command line and the run script.
- **Rounds:** at most two. After the second, findings that are not blocking go to KG (R BP:53).

## 9. Known gaps

**To add** (numbered at build time):
- **N1. The exported app has one port on the machine's loopback.** The door runs fixed code from an approved image, on an ordinary network that has a route out. The app, the database and the tools stay on internal networks. Claude Code reads 0.6c's choice, "a proxy the builder runs is their only way out" (R DEC:119), as covering the builder's own sandboxes, not an app started from its export with the builder stopped (decision 3, in QS "Yours to confirm"). An engineer to read it.
- **N2. On this machine, the exported app's own start installs its packages from npm's store, filled by the builder's builds before it stopped** (section 1; question 23). With that store empty, a build on Docker's default network cannot install them here (M SX-K b2.log, b5.log; SX-F control 2), because the machine's outbound traffic from that network meets a certificate it does not trust (R ENV:8, :32). A machine with an empty store, as a clean one has, downloads them (I); milestone 6 shows it.
- **N3. The check from the copy needs the builder's runner image and the builder's own check code,** on this machine only, the runner never given to anyone (R DEC:110). Whoever receives the copy gets the tests but cannot run them with what it holds; DN:200's "can run the same checks" is not met until milestone 6 (questions 24 and 27).
- **N4. "The builder stopped"**, as the owner answers question 25. Under (a), his own builder on 4020 kept running during the run.
- **N5. The run image holds `spdx-exceptions` 2.5.0 in the base image's own npm** (M SX-L). Under question 26 (a), the check allows exactly that copy, at that path and version, and lists it on every export. For anything a customer receives: not judged.
- **N6. The permissive packages' own licence files are not in the run image** (75 of 75 folders, M SX-L 04), and the notices file lists only the packages approved by name. Whether anything passed on must carry them: not judged.
- **N7. `npm run check:licences` cannot run in the app's own tools image,** which has no bash (M SX-L C1, exit 127). The export job runs the check's two commands directly.
- **N8. Migrations from a model-written step (2.2).** (1) A step that changes the app's tables must add a migration; only the drift check catches one that does not, and `generate`'s exit code says nothing (M SX-M K1 to K3). (2) The drift check compares the schema files with the migrations' snapshots, not the SQL files with the live tables: a migration whose SQL does not match its snapshot passes it. In 3.2 the scripted step's fingerprints rule that out (S15). (3) Migrations run as the database's user `app` (R manager.ts:375, `POSTGRES_USER: "app"`; SX-M exp/compose.yaml), which the official PostgreSQL image makes a superuser (I: its documentation, to be recorded in SRC), so a migration can do more than make tables.
- **N9. The tools stage, with every development package, is built and run at each start of the exported app** (the `setup` service). Whether that is acceptable is question 26; for customers it is KG 39's open point.
- **N10. The secret check reads file names, not contents:** a made-up private key in an ordinary source file was exported (M SX-E, case key-content).
- **N11. Compose names the exported project after its folder,** so two copies unpacked into folders of the same name on one machine would share containers and volumes (I).
- **N12. npm's cache mount is shared by every project's build on the machine** (one id). Only npm writes to it, in the install step, with scripts off; `package.json` and `package-lock.json` are protected, so every project installs the same packages; and npm checks each package against the fingerprint in the lock file (I). A cache mount's contents are not part of a step's cache key (M SX-F), so a step built from one state of the store is reused while the store changes. For the adversarial review.

**To close or update:**
- **53:** closed when the run shows the tables made by `migrate` from the copy (section 2); the amendment is in DN.
- **39:** rewritten. Done: on each export, a check that lists where the development packages are, with none of them under `/app` of the run image; a notices file in the copy and in the run image; the template's licence check run on each export. Still open, never called met: what "absent" means (question 26 for an internal export; an engineer or a lawyer for customers); whether the notices are sufficient; N5; N6; N9. Its sentence "since there is no exporter" goes.
- **40:** its sentence "No exporter exists, so whether a generated app would carry them is not shown" is replaced by what each export's listing shows (no `sharp` or `@img` package is in the lock file since R1).
- **61:** the export's `compose.yaml` names `node:22-alpine` and `postgres:16-alpine` by their approved digests; still internal only. The customer questions it lists for 3.2 are question 27.
- **34:** "join the app at export" is now shown from the copy.
- **72:** the check from the copy writes the password into its own trace too (M SX-C); its run folder stays outside the copy and out of `evidence/`, and the evidence is searched for four secrets, not one.
- **75:** for the check from the copy, the right app is found by Compose's labels and the image's id, not by a port.
- **118:** the check from the copy gives the browser `http://localhost:<port>`, a secure context (I), while the builder's own checklist run uses `http://app:3161`, which is not. A page that needs a secure context could pass the export's check and fail the builder's.
- **137:** the export check builds two more images per export, after the same disk check.
- **179** (J2 branch): the export job now builds two images and runs several containers; the clean stop cannot stop it part-way, and its 30 s wait covers it as it covers the archive today.
- **51:** git still runs on the machine over files the engine wrote; at export, links and submodules are now refused and the checkout's bytes are checked (S1, S5).
- **139:** unchanged. An export still needs the sandbox held by the interface that made it, so the run exports before it stops the builder.

**Outside facts to record in SRC, with their address and the date read** (CR24): Compose's project name taken from the folder when the file names none (M SX-K, SX-F M2); the override files Compose merges, and that `-f` stops them (M SX-F M2); `COMPOSE_FILE` read from `.env` (M SX-F M2); `Dockerfile.dockerignore` used before `.dockerignore` (M SX-F M1); volume subpath, and the Docker Engine and Compose versions that support it (measured on Engine 29.9.2 and Compose v5.6.1; the minimum versions to be read); Compose's `com.docker.compose.project.working_dir` label; BuildKit's cache mounts, and that `--no-cache` builds do not see them (M SX-K); npm's `--prefer-offline` and `--offline`; the PostgreSQL image making `POSTGRES_USER` a superuser. The isolated gateway mode is already recorded (R SRC:298-300).

## 10. Questions for the owner

Five, asked one at a time, in this order. *Renumbered 14 Nov 2026 when put in `docs/QUESTIONS.md`:* the draft's 19 to 23 are now **23 to 27**, because 19 to 22 had been taken by the questions of J2's second session (R QS on `839be17`); section 12 keeps the numbers it was written with. **Until questions 23 to 25 are answered, 3.2 stays "built, not tested"**; the build goes ahead on the recommendations, and another answer means changes and a repeat run, or waiting for milestone 6 (BP section 3, step 8; BP section 4: the scope of a package whose "Done means" cannot be met is always the owner's). Questions 26 and 27 do not block 3.2.

**Question 23** (blocks marking 3.2 tested). *On this machine, may the exported app's own start install its packages from the copies the builder downloaded here before it stopped?* On this development machine, a build that is not on the machine's own network cannot download packages (measured: it fails after 141 s). The builder's builds get through only with settings the copy does not have. With one change to the template's build file, the copy's own command installed everything from the builder's earlier downloads, with no network for packages (measured, 10 s).
- **(a) Recommended.** Yes; the evidence says plainly "the packages came from the builder's earlier downloads on this machine". On another machine the same command downloads them (inferred; shown at milestone 6). *Why:* it is the only way the documented command works here, and the downloads are checked against the fingerprints in the app's own lock file (inferred; for the adversarial review).
- (b) No: 3.2's start waits for a clean machine (milestone 6), and 3.2 stays "built, not tested" until then.
- (c) No, but run it another way: the run builds the images the builder's way, then starts the copy without `--build`. That is not the app's one documented command, and the evidence would say so.

**Question 24** (blocks marking 3.2 tested). *May "the check passes from the exported copy" be shown with the builder's own check code and checklist runner, and the stand-in test?* The test files come from the copy, unchanged. The code that checks and starts them is the builder's own, run on this machine; it uses the builder's runner image and a fingerprint the builder recorded before it stopped. The only test is Claude Code's stand-in, which your answer to question B allows "in the internal export" (13 Nov) but your answer to question 12 allows only "to develop and test the acceptance runner".
- **(a) Recommended.** Yes, labelled "stand-in test, not independent acceptance"; 3.2 is recorded as shown with a stand-in test only, and the check from the copy is run again when package 3.2b's test exists. *Why:* the design note asks that the check run "from the exported copy" (step 7); the copy's own tests are what run. The runner and its browser cannot travel with the copy, because you approved the browser only inside the runner, "never given to anyone" (13 Nov).
- (b) No: 3.2 stays "built, not tested" until a copy can carry its own way to run its checks (milestone 6, and question 27).

**Question 25** (blocks marking 3.2 tested). *May your own builder keep running during the run?* (Your builder is the interface you use at http://127.0.0.1:4020 on this machine; the run starts a separate one, on 4025, which makes the export and is then stopped.)
- **(a) Recommended.** Yes: "the builder stopped" means the builder that made the export (its process ended, its database dropped, its project's containers and data folder gone). Yours keeps running, untouched and unused, and the evidence names it. *Why:* stopping yours would interrupt your own open projects (its stop removes their containers, as J2 showed); the run shows, with a test listener of its own, that the exported app cannot reach the machine's addresses (so not 4020 either: inferred from that probe).
- (b) No: you stop it for the run and tell Claude Code when; if the run has already been made, it is made again.

**Question 26** (not blocking). *For an internal export, what does "a check on each export shows the development packages are absent" mean?* (A condition of your licence approval of 12 Nov.) Measured: none is in the app's own folder of the image the app runs from; one (`spdx-exceptions`) is inside that image's base npm; those installed on this machine (five) are in the tools image that the copy builds and runs at each start, to make its tables and sample users.
- **(a) Recommended for internal exports.** Absent from the app's own folder; every other copy listed on each export; reported as "checked under this reading", never as the condition met. The reading for customers waits for an engineer or a lawyer (milestone 6). *Why:* nothing here goes to a customer, and it shows exactly where each package is.
- (b) Absent from everything the copy builds and runs: the tables and users made from the run image, with no tools stage, and npm removed from it. More work in 3.2, not measured.

**Question 27** (not blocking). *Does package 3.2 settle anything for customers?* Two of your decisions left customers for 3.2: "Not approved: anything a customer receives (package 3.2)" and customer use of the browser, "asked again at 3.2" (13 Nov). The design note also says the customer "receives and can run the same checks".
- **(a) Recommended.** No: 3.2's export stays internal, and all three move to milestone 6, when a clean machine is shown, with an engineer's or a lawyer's reading. *Why:* nothing in 3.2 goes to a customer, and the copy cannot carry the runner under your approval. These are one decision: with the export internal, none of the three arises.
- (b) Ask them now, as part of 3.2.

## 11. Decisions Claude Code takes, each the owner's to overrule

To be recorded in DEC with the date. Those marked "yours to confirm" also go to QS's list (R BP:256, rule 11).
1. **Gap 53: option (a)**, fixed migration files in two parts. `migrate` in the sandbox, the export and the two demonstration scripts, then a drift check by `generate` into a temporary copy, read from its output. Step 01 goes from 4 to 7 files, and step 1's reservation to $2.7216 (section 2).
2. **The start files go in the template**, protected from the engine, as corrections to the comparison prototype (R BP:150). `compose.yaml` is generated by builder code and held to it by a test, and the README is rewritten as the exported app's own (section 1).
3. **The door is on by default:** one port on loopback only, 3000 unless `APP_PORT` says otherwise, fixed code. 0.6c is read as covering the builder's own sandboxes (gap N1). *Yours to confirm.* The other choice, the door as a Compose profile a person turns on, with no port by default, would need a second command in the README.
4. **The app's passwords are made at its first start**, into a volume, by a one-shot service, and each service is given only its own files. Nothing is written in the folder. The README tells a person how to see the sample password.
5. **The check from the copy** is a standalone script of the builder's, using 3.1's code. The runner reaches the app through a forwarder's namespace (measured); its arguments are built from 3.1's own service definition. If the forwarder fails in the build, 3.2 stays "built, not tested" and the owner is asked; there is no fallback.
6. **Each export is checked with Docker** by the export job, through an injected method, before it is recorded or offered. A failed check refuses the export, with the reason shown.
7. **The export check implements question 26 (a)** until the owner answers: none of the 14 under `/app` of the run image, every other copy listed, the condition never called met.
8. **The notices file is copied into the run image** (a change to the protected `Dockerfile`).
9. **The protected paths are extended:** `compose.yaml`, `README.md`, the two `0000` migration files and the six licence files; and a step that adds one of S29's names fails.
10. **The exporter's new refusals and checks:** links, submodules, `EXPORT-NOTE.txt` and S29's names anywhere in the history; exclusive writes; the export commit's contents; the checkout's bytes; a clone with no sample hooks; what Compose reads (S30).
11. **One export per project.**
12. **The new labels in English and Arabic;** an export only for a project the scripted engine built.
13. **The new fields of `journey.export.written`**, the checklist count among them.
14. **The README keeps `docker compose up --build`,** not `-f compose.yaml` (section 1).
15. **The run deletes its own database and data folder** after copying out the archive and the events, before it starts the export, and records, never refuses on, Docker names it did not make.
16. **Not changed in 3.2:** `tsconfig.tsbuildinfo`, a 495,814-byte build file the template tracks (M SX-E), stays; `scripts/check-licences.sh` stays a bash script (gap N7).
17. **`verifyVersion` becomes a wrapper around `verifyVersionAt(folder, projectId, version)`**, with the same checks.
18. **The install step keeps npm's downloads in a cache mount** (a change to the protected `Dockerfile`), built on question 27 (a) and taken out if the owner answers otherwise.
19. **3.2 is designed and built while 3.1 is built, not tested**, a departure from BP 7.1 under the owner's journey message (R DEC:128) and J2's design (R J2D:464), recorded as DEC:74 recorded the last; 3.2 is not marked tested before 3.1 is. *Yours to confirm.*
20. **Tested packages 2.1 and 0.5 are reopened** by this package (section 6), and their evidence run again.

The first draft listed two more, now the owner's questions: the reading of "absent" (question 26) and moving the customer questions to milestone 6 (question 27).

## 12. Review of this design

Two independent critics read the first draft against the code at `392a6fd`: one for feasibility (CF, 15 findings, measurements in SX-K) and one for requirements (CR, 24 findings). Each finding was checked before it was acted on, by reading the code at `392a6fd` or by a measurement for this correction (SX-F). Every finding held. "Done" says where the note now answers it.

| # | Finding | Severity | Checked | Done |
| --- | --- | --- | --- | --- |
| CF1 | `docker compose up --build` cannot build the copy here; the builder's build cache does not serve it | Blocking | Holds: M SX-K b2.log, b5.log, b3.log, b4.log; R manager.ts:338-339, :626-627, :978 | Fixed: a cache mount on the install step, measured to work (SX-F M4, M5, control 2); section 1 "The build on this machine"; question 19; DN row 3; gaps N2, N12; section 7 B.7 and C; section 8 |
| CF2 | Compose merges `compose.override.yaml`; byte-equal `compose.yaml` does not hold what runs | Should-fix, high | Holds: M SX-K ovr-config.out; SX-F M2 (all four override names; `COMPOSE_FILE` in `.env`) | Fixed: S29, S30, E21, L2b; section 1 "What Compose reads"; section 7 C, before the start. `-f compose.yaml` considered and not chosen (decision 14, with why) |
| CF3 | `readRun` needs `checklistItems`; the check script has no source for it | Should-fix | Holds: R results.ts:78, :385-386; J2: journey-jobs.ts:566 | Fixed: `checklist_items` in the event, `--checklist-items`, S31, E14, E17; section 3 item 7 |
| CF4 | The list of lines that change with the file count is wrong both ways | Should-fix | Holds: R J2: test/journey.test.ts:216, :827, :830 set 4 turns; :101, :382, :1714; web.test.ts:762; builder-shots.mjs:298, :553; scripted-engine.test.ts:333-335 | Fixed: section 2, rebuilt by grep, with the lines that do not change and why (web.test.ts:2551 also does not) |
| CF5 | "The README's only code block" conflicts with the role guard's code block | Should-fix | Holds: R TPL/README.md:40-44 | Fixed: the run takes the one block under "Start it"; T5 holds it (section 1, section 7 C) |
| CF6 | The export job now builds images, but J1's fast export tests run with no Docker | Should-fix | Holds: R J2: journey-jobs.ts:143 (`sandboxes` injected), :582-600; J2: test/journey.test.ts:674-761 | Fixed: `sandboxes.checkExport`, a stand-in in fast tests, L1 live (section 4; section 6) |
| CF7 | Decisions 14 and 7 are the owner's | Should-fix | Holds: R DEC:97, :110, :45 | Fixed: questions 22 and 23; decision 7 now only implements 22 (a) until he answers; the five lines say so |
| CF8 | Mode 000 is no barrier to root; question 19 understated what the check uses | Should-fix | Holds: SX-K's files are root-owned; R manager.ts:166-170 (the builder as root) | Fixed: section 7 B.5 deletes the folder and inspects mounts; questions 19 and 20 name the cache and the builder's code |
| CF9 | The forwarder works (measured) | Note | Holds: M SX-K f-run.out | Fixed: section 3 "Measured" and item 5; port from `APP_URL`; forwarder removed first (section 7 H) |
| CF10 | `generate` is measured both ways; `push --strict` with a change is not | Note | Holds: M SX-M 07-drift-check.out, 02-migrations.out | Fixed: section 2 item 4, `generate` into a temporary copy; `push --strict` dropped |
| CF11 | Two demonstration scripts still run `push --force` | Note | Holds: R scripts/demo-scripted.ts:200; scripts/demo-template.ts:93 | Fixed: section 2 item 3; T7; decision 1 |
| CF12 | Plain `docker run` makes a second definition of the runner's hardening | Note | Holds: R manager.ts:316-330 | Fixed: section 3 item 6; T8 |
| CF13 | `verifyVersionAt(folder, version)` drops the project check | Note | Holds: R store.ts:300 | Fixed: `verifyVersionAt(folder, projectId, version)`, the id from the event (section 3 item 1; decision 17) |
| CF14 | Compose's project name from the folder is measured | Note | Holds: M SX-K ovr-config.out; SX-F M2 | Fixed: section 1 "Names" |
| CF15 | Every service mounting `keys` sees all three secrets | Note | Holds: R SX-M exp/compose.yaml | Fixed: each file mounted alone to the services that need it, measured at a first start (SX-F M3); S22 |
| CR1 | The licence condition "absent" reported as met under a narrowed reading | Should-fix, high | Holds: the tools image runs at each start (section 1); R KG 39; QS "Yours to confirm" | Fixed: five lines line 1; section 4 table and text; gap 39 keeps "absent" open; question 22; never "met" |
| CR2 | Override files and `Dockerfile.dockerignore` can change what the command runs | Should-fix, high | Holds: M SX-F M1 (`Dockerfile.dockerignore` used, by `docker build` and Compose) and M2 | Fixed: as CF2, with `*.dockerignore` in S29. "Add them to the protected paths" cannot be done as written: a missing protected path fails every step (R scripted.ts:245-247); a separate refusal after each step instead (S23) |
| CR3 | "Only the wording waits on your answer" is untrue | Should-fix | Holds: R BP section 3 step 8; BP section 4 | Fixed: five lines line 4; section 10's opening |
| CR4 | Question 19 held two decisions; the check is builder code; the route claim was not measured; 4020 not explained | Should-fix | Holds: the draft's question 19 | Fixed: questions 20 and 21; both name the builder's code; the route claim inferred and probed with the run's own listener (section 7 C); 4020 glossed |
| CR5 | "No builder running" is contradicted by its own evidence | Should-fix | Holds: M SX-C m4-ports-4020-4040.txt (4020, 4032, 4033, 4034); m1-export.mts; m4-run.sh:48 | Fixed: section 3 "Measured", reworded, naming how the export and the tables were made |
| CR6 | Mode 000 and the build cache: "nothing of the builder's state can be reached" is untrue | Should-fix | Holds (as CF8); the copy's build reuses npm's store, not the builder's steps (M SX-K b1 against b2) | Fixed: section 7 B.5 and B.7; question 19 |
| CR7 | The fallback would check an app not started by the documented command | Should-fix | Holds: R DN:516, :538 | Fixed: no fallback; the forwarder is measured; if it fails in the build, 3.2 is not tested and the owner is asked |
| CR8 | 3.1, on which 3.2 depends, is not tested | Should-fix | Holds: R ST:16; BP:131 | Fixed: section 6 "Before 3.2 can be marked tested"; decision 19; five lines line 4 |
| CR9 | Tested packages this changes are not reopened | Should-fix | Holds: R BP:253; ST:15 | Fixed: section 6 "Tested work this package reopens" (2.1, 0.5; 0.6c and 3.1 touched); decision 20 |
| CR10 | Owner's decisions changed or read without asking | Should-fix | Holds: R DN:200; DEC:97, :110, :119 | Fixed: DN rows 3 to 6 marked the owner's; question 23 (one question for the three, with why); decision 3 and 19 to "Yours to confirm"; "one question" corrected |
| CR11 | No authority for finishing 3.2 with the stand-in test | Should-fix | Holds: R DEC:101, :130 | Fixed: question 20 asks it |
| CR12 | The main picture cannot show the reading | Should-fix | Holds: M SX-C m4-item-01-from-export.png | Fixed: the picture described exactly; a picture of the run's record added (section 7) |
| CR13 | The label misstates the approvals | Should-fix | Holds: R DEC:45, :97, :110 | Fixed: section 1, the label |
| CR14 | The evidence search covers one secret of four | Should-fix | Holds | Fixed: section 7 "Files", `run-secret-search.txt` |
| CR15 | `push --strict` could apply a change | Note | Holds (as CF10) | Fixed: as CF10 |
| CR16 | F3, F4, F5 undefined; the Keys line misplaced files | Note | Holds | Fixed: plain references in section 3; Keys lists each file's folder |
| CR17 | Cost figures list incomplete | Note | Holds | Fixed: as CF4 |
| CR18 | The Dockerfile's comment and gap 40 go out of date | Note | Holds: R TPL/Dockerfile:24-26; KG 40 | Fixed: section 1 (the Dockerfile's third change); section 9, gap 40 |
| CR19 | The check containers' hardening given only as "no network" | Note | Holds | Fixed: section 4, the full hardening; running the licence check under it labelled I |
| CR20 | Migrations run as the database's superuser | Note | Holds: R manager.ts:375 (`POSTGRES_USER: "app"`) | Fixed: gap N8 (3); the image's behaviour I, to record in SRC |
| CR21 | Key handling not in the adversarial review | Note | Holds: R BP:47 | Fixed: section 8 |
| CR22 | The run would refuse on the owner's own `builder_j1-` projects | Note | Holds: R J2: journey.ts:50; manager.ts:201-202 | Fixed: section 7 "Before" |
| CR23 | The template is a comparison prototype | Note | Holds: R BP:150 | Fixed: section 1, "Why these are corrections" |
| CR24 | More outside facts for SRC | Note | Holds | Fixed: section 9, "Outside facts to record" |

**Still labelled inferred (I) after this correction**, each to be measured in the build or left as stated: that the archive's notices file is the template's bytes; that a type check outside Docker fails without the TypeScript change; that `.git` would reach the tools image without its `.dockerignore` line; that the builder's removal cannot remove an exported app; that step 02 is unchanged by the migration files; that `--force` accepts data-losing statements and that `push --strict` with a change may ask or apply; the turn limit and the money figures for 7 turns, and that the $5.00 cap still holds each step; that older projects cannot reach the new exporter; that a failed second export would leave the first missing; that the scripted engine cannot cause F1 and package 2.2 could; that submodules are not refused today and that CRLF settings change the exported bytes; Compose's `working_dir` label; the runner reading its password through a volume subpath; that `caniuse-lite` is used only while building; that the licence check runs under the full hardening; that a machine with an empty npm store downloads as usual; that npm checks each stored package against the lock file; that 0.6a's probes do not use the table set-up; that the forwarder left on `front` would stop Compose removing it; that the exported app cannot reach 4020 (from the run's own probe); that `http://localhost` is a secure context; that two copies in same-named folders would share containers; and the PostgreSQL image making `POSTGRES_USER` a superuser.

## 13. Changes during the build

Dated notes, one per departure from sections 1 to 11 that the code forced, each the smallest that would do, with its reason. Line numbers are at the build's base, `839be17`, unless another commit is named.

**Part A, the template and the tables (sections 1 and 2), 14 Nov 2026.**
- **A1. One more expectation follows the Dockerfile's install step.** `test/sandbox.test.ts:240` (0.6c's test of the template's image build) held the install step to its exact old text, `RUN npm ci --ignore-scripts --no-fund --no-audit`. Section 1 changes that step to the cache-mount line, and section 6 did not list this test among the expectations that change. Its expectation is now the new line, exactly as section 1 gives it; the test's other checks (install scripts off, every other step with no network, no certificate, no `# syntax=` line) are unchanged. Not loosened: still an exact match.
- **A2. Two more lines follow step 01's file count.** Section 2's grep (for `1.5552`, `1.56`, `4 turns`, `"01-data", 4`) missed two lines of the test it names at J2's `:346` (here `test/journey.test.ts:353` and `:356`): the number of engine events of step 1, `Array(7)`, now `Array(10)` (two text events, 7 writes, the end), and the list of their types, now with seven `tool_call` entries in place of four. Both changed exactly; nothing else in that test changed but the figures section 2 lists.
- **A3. Section 2's lines, found at `839be17`** (they were cited on the J2 branch at `392a6fd`): `test/journey.test.ts:101`, `:346`, `:358-359`, `:382`, `:1718`, `:2035`, `:2041-2042`, `:2383`; `test/web.test.ts:683`, `:762`, `:1989`, `:2614`, `:2620`; `camera/builder-shots.mjs:197`, `:248`, `:298`, `:493`, `:560`; `scripts/demo-journey-j2.ts:502`; `test/scripted-engine.test.ts:333-335`, `:790`. Not changed, as section 2 says: `test/journey.test.ts:229-230`, `:832`, `:838`, and `test/web.test.ts:2619` (its step opened with `maxTurns: 4` at `:2588`). Step 1's reservation measured by the tests on the stand-in sandboxes: $2.7216 for 7 turns, and the $1.00 project refused with "This step needs up to $2.73 to finish (7 turns)" and "A cap of at least $2.73" (`test/journey.test.ts`, `test/web.test.ts`, run 14 Nov 2026).
- **A4. No image written `name:tag` in the README or the keys script.** `test/approved-images.test.ts` scans `templates/` and refused two things the first draft of the code wrote: the README's `node:22-alpine` and `postgres:16-alpine` (no digest), and the keys script's file mode written with no space after its colon, which the scan reads as an image's name and tag. The README now names the two images in words and says where they are pinned (`Dockerfile`, `compose.yaml`); the script writes `{mode: 0o444}`. The scan itself is unchanged.
- **A5. The drift check runs wherever the tables are made.** Section 2 item 4 places the drift check "in the sandbox after `migrate`"; item 3 asks for one helper. `makeTables` (`builder/src/sandbox/tables.ts`) runs both, so the two demonstration scripts run the drift check too. Its temporary copy of `drizzle/` is made in the sandbox's own folder and removed after. A drift refuses the start, naming the files generate wrote (for L4).
- **A6. Step 01's migration made with the template's tools image.** The template's `0000_template` was generated in the tools image built from the template through `sandbox.build`; step 01's `0001_leave_request` in the same image, with step 01's two schema files (`src/db/app-schema.ts`, `drizzle.config.ts`) mounted read-only over the template's and a copy of the `0000` files mounted at `/app/drizzle`, as SX-M's K2 mounted a schema file, rather than in an image built from the template and step 01. Both runs had no network and a read-only root. `generate` against the committed files then said "No schema changes, nothing to migrate" for the template alone and for the template with step 01 (evidence/2026-11-14-package-3.2/part-a-migrations-generated.txt). Step 01's label is unchanged; its manifest lists 7 files; step 02's and the broken step's manifests are unchanged.
- **A7. Read, not changed:** the README's section "Files the builder must not change" is not kept: section 1 lists the three template sections that stay (the ten rules, the role guard, `sharp`), and that section described the template before the engine existed ("nothing enforces it today"), which the scripted engine's protected paths now do.
