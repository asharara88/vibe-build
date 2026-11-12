# Package 0.5: app set-up runs in a tools container

| | |
| --- | --- |
| Date | 12 November 2026 |
| Package | 0.5 of `docs/BUILD-PLAN.md`: "App set-up runs in a tools container. Creating tables and sample users never runs on the machine that hosts the builder. A container receives a named list of settings, never the host's whole environment." It depends on licence codes L9 and L11, both true since 12 November |
| Answers | Register finding P-5 (`docs/reviews/2026-11-11-pull-request-2.md`): creating the app's tables and sample users ran on the machine that hosts the builder, with the host's whole environment. Known gap 29 |
| Done means (plan) | "A test whose seed script prints its environment shows none of the builder's own settings. Known gap 29 closed" |
| Run on | The development machine (a cloud session), development profile: the project's containers share the host's network (known gap 1). Made-up sample users only. No model was called |
| Result | **Shown on the development profile** (run 2 below): a stand-in seed step, run in the tools container exactly as the seed is run, printed the names in its environment; none of the builder's settings was among them, and none of 13 made-up values put into the builder's environment reached it. The tables and the three sample users were then created in that container, and the app ran and passed the screenshots and the 26 role-guard checks of package 0.3. **Not shown**: the server profile, which needs a server (package 0.6b). **State: built, not tested**, until an independent reviewer has read the commit that is merged |

A *container* is a sealed box the app runs in, with only the files and settings put into it. The *tools container* is a box made from the same app, with the extra programs needed to create its tables and sample users; it runs one command and is removed.

## What was built

- **The template's image file** (`templates/next/Dockerfile`) has a new stage, `tools`: the build stage, which already has the development programs, run as the unprivileged user `node`. It is never started as the app. It also runs its command directly, without the base image's start-up script (see run 1 for why).
- **The sandbox manager** (`builder/src/sandbox/manager.ts`):
  - builds two images from the template, the app (`run` stage) and the tools image (`tools` stage); both are removed with the project;
  - adds a `tools` service to the project's Compose file, under its own profile so it starts only when run on purpose, with the same hardening as the app (every capability dropped, no new privileges, read-only files, a small writable `/tmp`);
  - gives it a **named list** of settings and nothing else: `DATABASE_URL`, the names the builder passes in `toolsEnv` (here `APP_URL`), and the names in the project's secrets file (`AUTH_SECRET`, `APP_SAMPLE_PASSWORD`). Every entry has its value written in, so Compose has nothing to copy from the host. No proxy setting is given; the container needs only the project's database;
  - runs a one-off command with the `docker compose` program itself given only `PATH` and `HOME`, so that none of the builder's settings is there to be picked up, whatever the Compose file says.
- **The demonstration** (`builder/scripts/demo-template.ts`) creates the tables (`drizzle-kit push`) and the sample users (the template's seed) in the tools container. Before, it ran both on the host with the host's whole environment added.
- **The check** (`builder/scripts/tools-env-check.ts`), run by the demonstration before the seed. A stand-in seed step (one line of Node) prints the **names** in its environment, never the values, and says which of a list of made-up marker values appear in any value. It is run twice: (1) the way the demonstration runs the real seed; (2) with Compose given this process's whole environment plus made-up values for every setting the builder reads, to show that the Compose file alone keeps them out. It passes only if, both times, every name is on the named list or declared by the tools image itself (read from the image), and no marker is found. The demonstration stops if it fails.
- **Two unit tests** (`builder/test/sandbox.test.ts`): the tools service in both profiles (its image, its profile, exactly the named settings, each with a value, no proxy or builder setting, read-only, on the project's internal network on the server profile); and the names the sandbox records, and Compose run with `PATH` and `HOME` only.

The stand-in seed step stands in for the seed because the real seed must not print its settings' values (they include the sample password and the sign-in secret), and the template is not changed for a test. It runs in the same service, through the same command, as the seed.

## Run 1: the check failed, and the cause was in the image (`run-live-1-failed-PWD-SHLVL.txt`)

The first run stopped at the check. Both ways, the container's environment held two names that were neither on the list nor declared by the image: `PWD` and `SHLVL`. None of the builder's settings was there; 0 of 13 markers were found.

The cause, measured on the base image `node:22-alpine`:

```
$ docker image inspect node:22-alpine --format 'entrypoint={{json .Config.Entrypoint}} cmd={{json .Config.Cmd}}'
entrypoint=["docker-entrypoint.sh"] cmd=["node"]
$ docker run --rm --entrypoint "" node:22-alpine node -e '...print the names...'
HOME,HOSTNAME,NODE_VERSION,PATH,YARN_VERSION
$ docker run --rm node:22-alpine node -e '...print the names, and PWD and SHLVL...'
HOME,HOSTNAME,NODE_VERSION,PATH,PWD,SHLVL,YARN_VERSION / 1
```

The base image starts every command through a shell script, and the shell adds `PWD` and `SHLVL`. The fix is in the image, not the check: the tools stage now clears that start-up script (`ENTRYPOINT []`), so its command runs directly. The check was not changed.

## Run 2: the whole demonstration (`run-live.txt`)

`npx tsx scripts/demo-template.ts ../templates/next ../evidence/2026-11-12-package-0.5/screens --guard`, from `builder/`. Exit code 0. Whole run 105 seconds. The lines that show this package:

```
  Named list (4): APP_SAMPLE_PASSWORD, APP_URL, AUTH_SECRET, DATABASE_URL
  Set by the tools image itself, or by Docker for every container (6): HOME, HOSTNAME, NEXT_TELEMETRY_DISABLED, NODE_VERSION, PATH, YARN_VERSION
  1. As the seed is run (Compose itself given only PATH and HOME):
     settings seen inside (10): APP_SAMPLE_PASSWORD, APP_URL, AUTH_SECRET, DATABASE_URL, HOME, HOSTNAME, NEXT_TELEMETRY_DISABLED, NODE_VERSION, PATH, YARN_VERSION
     not on the named list and not the image's own: none
     builder settings among them: none
     made-up marker values found in any setting: 0 of 13
     PASSED
  2. Compose given this process's whole environment (210 settings, including made-up values for the builder's 12 settings and one more):
     ... the same ten names ...
     PASSED

Creating the tables (drizzle-kit push) and the three sample users (seed), in the tools container...
  drizzle-kit push: done (6 lines of output, not shown)
  created: employee@example.test (employee)
  created: manager@example.test (manager)
  created: hr.admin@example.test (hr_admin)
```

Then the app started (healthy), the seven screenshots were taken (`screens/`), and the role guard's 26 live checks of package 0.3 all passed (`screens/guard/`, "RESULT: PASSED"). The sample users the app signs in with are the ones the tools container created.

**Nothing of the template ran on the host.** The template folder in the checkout this ran from has no `node_modules` (no programs installed), so neither `drizzle-kit` nor the seed could have run there. The builder's own programs did run on the host, as before: the demonstration, the browser that takes the screenshots and the live guard checks.

The builder's settings checked are the twelve its code reads (`grep` of `process.env` in `builder/src` and `builder/scripts`, 12 Nov): `BUILDER_DATABASE_URL`, `BUILDER_TEST_DATABASE_URL`, `BUILDER_MODEL_API_KEY`, `BUILDER_GATEWAY_HOST`, `BUILDER_GATEWAY_PORT`, `BUILDER_UPSTREAM_URL`, `EGRESS_ALLOW`, `EGRESS_PORT`, `EGRESS_UPSTREAM_PROXY`, `HTTPS_PROXY`, `HTTP_PROXY`, `PGUSER`. The marker values were made up for the run; no real key or setting was read or printed. The run's own values are gone with its temporary folder, so the output was searched for their shapes instead (a sample password `Sample-…`, a line `AUTH_SECRET=`, a database address with a password in it): none was found.

After the run: no image named after the project is left (`docker images`), and the run's temporary folder is gone.

## Checks run on this branch (`builder/`)

Type check passed (exit 0); 88 of 88 tests passed, among them the two new ones; the committed licence check passed (exit 0). No package was added or removed.

## What this does not show

- **The server profile.** The Compose file puts the tools container on the project's internal network, with no route out (unit test); it has not been run on a server (package 0.6b).
- **Isolation on the development profile.** The tools container shares the host's network there, as the app does (known gap 1): it is given no proxy setting, but code in it could still reach what listens on the host. Package 0.6a checks this.
- **What is in the tools image.** It is the build stage, so it holds what that stage holds, read from the Dockerfile and not inspected in a built image: the template's source, its development programs and, on the development profile, the session proxy's certificate (known gap 2). It is not shipped and is removed with the project.
- **The real seed's own environment.** The stand-in step shows the environment of a command run in that container in that way; the real seed is run in the same way.
