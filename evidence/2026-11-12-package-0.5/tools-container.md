# Package 0.5: app set-up runs in a tools container

| | |
| --- | --- |
| Date | 12 November 2026 |
| Package | 0.5 of `docs/BUILD-PLAN.md`: "App set-up runs in a tools container. Creating tables and sample users never runs on the machine that hosts the builder. A container receives a named list of settings, never the host's whole environment." It depends on licence codes L9 and L11, both true since 12 November |
| Answers | Register finding P-5 (`docs/reviews/2026-11-11-pull-request-2.md`): creating the app's tables and sample users ran on the machine that hosts the builder, with the host's whole environment. Known gap 29 |
| Done means (plan) | "A test whose seed script prints its environment shows none of the builder's own settings. Known gap 29 closed" |
| Run on | The development machine (a cloud session), development profile: the project's containers share the host's network (known gap 1). Made-up sample users only. No model was called |
| Result | **Shown on the development profile** (run 3 below). A stand-in seed step, run in the tools container exactly as the seed is run, printed the names in its environment and a fingerprint of each value. Every name was on the named list, declared by the image, or set by Docker in every container. Every named value was the one the builder chose to give. None of the builder's settings was inside. Run again with Compose given the builder's whole environment, plus made-up values for each of its settings, the result was the same, and none of the made-up values reached the container. The tables and the three sample users were then created in that container, and the app ran and passed the screenshots and the 26 role-guard checks of package 0.3. Two automated tests in `npm test` cover the two ways round that review found (below). **Not shown**: the server profile, which needs a server (package 0.6b). **State: built, not tested**, until an independent reviewer has read the commit that is merged |

A *container* is a sealed box the app runs in, with only the files and settings put into it. The *tools container* is a box made from the same app, with the extra programs needed to create its tables and sample users; it runs one command and is removed. A *fingerprint* (SHA-256) is a short code worked out from a value: the same value always gives the same fingerprint, and the value cannot be read back from it, so values can be compared without being printed.

## What was built

- **The template's image file** (`templates/next/Dockerfile`):
  - A new stage, `tools`: the build stage, which already has the development programs, run as the unprivileged user `node`. It is never started as the app. It runs its command directly, without the base image's start-up script (see run 1 for why).
  - The proxy's address is no longer declared as a build argument. Docker predefines `HTTPS_PROXY` and `HTTP_PROXY`, so the build steps still see them, and an undeclared one is not recorded in the image's history.
- **`templates/next/.dockerignore`** (new): a local settings file (`.env`), installed packages and build output are never sent to the image build. `drizzle-kit` reads a `.env` file by itself when one is there; with this file, none can be.
- **The sandbox manager** (`builder/src/sandbox/manager.ts`):
  - It builds two images from the template, the app (`run` stage) and the tools image (`tools` stage); both are removed with the project.
  - It adds a `tools` service to the project's Compose file, under its own profile, so `up` never starts it, with the same hardening as the app: every capability dropped, no new privileges, read-only files, a small writable `/tmp`.
  - It gives that service a **named list** of settings: `DATABASE_URL`, the names the builder passes in `toolsEnv` (here `APP_URL`), and the names in the project's secrets file (`AUTH_SECRET`, `APP_SAMPLE_PASSWORD`). Every entry has its value written in. No proxy setting is given; the container needs only the project's database.
  - **Every Docker command of a sandbox now runs with one narrow environment:** `PATH`, `HOME`, the settings that name the Docker daemon (`DOCKER_HOST` and its two TLS settings, when set), and `DOCKER_CONFIG` pointed at the project's own, empty Docker client folder. The user's command-line plugins are linked into that folder, so `docker compose` is still found.
    - The project's own client folder is needed because Docker's client configuration can itself add settings to every container: its `proxies` entry adds proxy settings.
    - A Docker "context" is refused with a plain message, so that every command reaches the same daemon.
  - **Removing a project now also removes a tools container whose run was cut off**, and with it the project's network. Before, it was left behind.
- **The demonstration** (`builder/scripts/demo-template.ts`) creates the tables (`drizzle-kit push`) and the sample users (the template's seed) in the tools container. Before, it ran both on the host with the host's whole environment added. It no longer copies a local `.env` file into the project.
- **The check** (`builder/scripts/tools-env-check.ts`), run by the demonstration before the seed:
  - A stand-in seed step (a few lines of Node) prints the **names** in its environment and a fingerprint of each value, never a value.
  - It passes only if the names inside are exactly the named list, the names the tools image declares (read from the image) and `HOSTNAME` and `HOME` (which Docker sets in every container, so their values are not compared), and if every named or image value matches by fingerprint the value given.
  - It is run twice: (1) the way the demonstration runs the real seed; (2) with Compose given this process's whole environment plus made-up values for each of the builder's settings, to show that the Compose file alone copies nothing in. In run 2 it also reports which made-up values appear anywhere inside.
  - The demonstration stops if it fails.
- **Tests** (`builder/test/sandbox.test.ts`, run by `npm test`):
  - two that read the Compose file and the sandbox's settings: the tools service in both profiles, and the narrow environment with its own client folder;
  - two that run Docker:
    - (a) with a made-up Docker client configuration in the home folder that adds proxies to every container, a tools container started through the sandbox gets exactly the named list, while the same command run without the sandbox's narrow environment does get the proxies;
    - (b) a tools run left running is removed with the project.

The stand-in seed step stands in for the seed because the real seed must not print its settings' values: they include the sample password and the sign-in secret. The template is not changed for a test. The stand-in runs in the same service, through the same command, as the seed.

## Run 1: the check failed, and the cause was in the image (`run-live-1-failed-PWD-SHLVL.txt`)

The first run stopped at the check. Both ways, the container's environment held two names that were neither on the list nor declared by the image: `PWD` and `SHLVL`. None of the builder's settings was there.

The cause, measured on the base image `node:22-alpine`:

```
$ docker image inspect node:22-alpine --format 'entrypoint={{json .Config.Entrypoint}} cmd={{json .Config.Cmd}}'
entrypoint=["docker-entrypoint.sh"] cmd=["node"]
$ docker run --rm --entrypoint "" node:22-alpine node -e '...print the names...'
HOME,HOSTNAME,NODE_VERSION,PATH,YARN_VERSION
$ docker run --rm node:22-alpine node -e '...print the names, and PWD and SHLVL...'
HOME,HOSTNAME,NODE_VERSION,PATH,PWD,SHLVL,YARN_VERSION / 1
```

The base image starts every command through a shell script, and the shell adds `PWD` and `SHLVL`. The fix is in the image, not the check: the tools stage now clears that start-up script (`ENTRYPOINT []`). The check was not changed.

## Run 2: before the independent review (`run-live-2-before-review.txt`)

The whole demonstration passed at commit `273f294`, with the check as it then was (names only, and made-up values that, as review showed, could only have been found in its second run). The review below found that this check proved less than the records said.

## The independent review of `273f294`

Five reviewers, each from one angle (isolation, the strength of the check, regressions, the records, and an independent run of the demonstration); each finding then read by two more agents told to refute it. The reviewers confirmed the central result in their own runs: the tools container held the named list and the image's own settings, and none of the builder's settings. They also found:

| Finding | What was done |
| --- | --- |
| Docker's client configuration (`proxies` in `$HOME/.docker/config.json`) adds proxy settings to every container Compose starts, the tools container included. Reproduced with made-up values | Every Docker command now uses the project's own, empty client folder. Test (a) shows it, and fails if the fix is removed |
| With `HTTPS_PROXY` and `HTTP_PROXY` declared as build arguments, the proxy's address was recorded in the tools image's history. The Dockerfile's comment said "Neither is in the image" | The declarations are removed. Measured after the fix, on a tools image built with the proxy passed in: the proxy's address is in 0 lines of its history (5 build steps) and 0 lines of its settings. The comment now says that the tools image holds the session certificate (2 files: `/certs` and `/app/certs`), on the development profile only |
| A tools run that was cut off left its container, and on the server profile its network, after the project was removed | Removing a project now names the tools profile. Test (b) shows it, and fails if the fix is removed |
| The check compared names only, so a builder setting given under a name on the list would have passed. Its made-up values could only ever be found in the second run, yet "0 of 13" was reported for both | The check now compares every value by fingerprint, and reports made-up values for the second run only |
| One-off runs could reach a different Docker daemon from the other commands, because only they had a narrowed environment | All of a sandbox's Docker commands now share one environment |
| The records said the builder reads twelve settings; its code reads eleven (`HTTP_PROXY` is not among them). Other sentences claimed more than was shown | Corrected below and in the pull request |

Two points from review are recorded, not changed:
- **`$` in a value.** Compose fills in `$NAME` in the values of `environment` and of the secrets file. The builder writes `${DB_PASSWORD}` into `DATABASE_URL` on purpose. With Compose now given the narrow environment, that comes from the project's own `.env` file. Its generated secrets use letters, digits, `-` and `_` only, so they hold no `$`.
- **The check's own first step** reads the names the tools image declares from the image under test. It also names them in its output (run 3: `NEXT_TELEMETRY_DISABLED`, `NODE_VERSION`, `PATH`, `YARN_VERSION`).

## Run 3: the whole demonstration after the review (`run-live.txt`)

`npx tsx scripts/demo-template.ts ../templates/next ../evidence/2026-11-12-package-0.5/screens --guard`, from `builder/`. Exit code 0. Whole run 149 seconds. The lines that show this package:

```
  Named list (4): APP_SAMPLE_PASSWORD, APP_URL, AUTH_SECRET, DATABASE_URL
  Declared by the tools image itself (4): NEXT_TELEMETRY_DISABLED, NODE_VERSION, PATH, YARN_VERSION
  Set by Docker in every container, names only: HOSTNAME, HOME
  1. As the seed is run (sandbox.runOnce):
     settings seen inside (10): APP_SAMPLE_PASSWORD, APP_URL, AUTH_SECRET, DATABASE_URL, HOME, HOSTNAME, NEXT_TELEMETRY_DISABLED, NODE_VERSION, PATH, YARN_VERSION
     not on the named list, not the image's own, not set by Docker: none
     named or image settings missing: none
     named or image settings whose value is not the one given: none (8 compared by fingerprint)
     builder settings among the names: none
     PASSED
  2. Compose given this process's whole environment (211 settings, including made-up values for the builder's 11 settings, HTTP_PROXY and BUILDER_TOOLS_CHECK_MARKER):
     ... the same ten names, and the same results ...
     made-up values found in any setting: 0 of 13
     PASSED

Creating the tables (drizzle-kit push) and the three sample users (seed), in the tools container...
  drizzle-kit push: done (6 lines of output, not shown)
  created: employee@example.test (employee)
  created: manager@example.test (manager)
  created: hr.admin@example.test (hr_admin)
```

Then the app started (healthy), the seven screenshots were taken (`screens/`), and the role guard's 26 live checks of package 0.3 all passed (`screens/guard/`, "RESULT: PASSED"). The sample users the app signs in with are the ones the tools container created.

**Nothing of the template ran on the host.** The template folder in the checkout this ran from has no `node_modules` (no programs installed), so neither `drizzle-kit` nor the seed could have run there. The builder's own programs did run on the host, as before: the demonstration, the browser that takes the screenshots and the live guard checks.

The builder's settings given made-up values are the eleven its code reads (`grep` of `process.env` in `builder/src` and `builder/scripts`, 12 Nov): `BUILDER_DATABASE_URL`, `BUILDER_TEST_DATABASE_URL`, `BUILDER_MODEL_API_KEY`, `BUILDER_GATEWAY_HOST`, `BUILDER_GATEWAY_PORT`, `BUILDER_UPSTREAM_URL`, `EGRESS_ALLOW`, `EGRESS_PORT`, `EGRESS_UPSTREAM_PROXY`, `HTTPS_PROXY`, `PGUSER`. `HTTP_PROXY`, and one name no code reads, were given made-up values too. In run 2 the builder's whole environment was handed to Docker Compose, which is the point of that run. The check itself read and printed no setting's value: it printed names and fingerprints only. The run's own values went with its temporary folder, so the output was searched for their shapes instead: a sample password `Sample-…`, a line `AUTH_SECRET=`, and a database address with a password in it. None was found.

After the run, no image named after the project was left (`docker images`), and the run's temporary folder was gone.

## Checks run on this branch (`builder/`)

Type check passed (exit 0); 90 of 90 tests passed, among them the four new ones; the committed licence check passed (exit 0). No package was added or removed. Each of the two new tests that run Docker was also run with its fix removed, and failed.

## What this does not show

- **The server profile.** The Compose file puts the tools container on the project's internal network and on no other (unit test). That this network has no route out is designed (design note 2.5), not run; it needs a server (package 0.6b).
- **Isolation on the development profile.** The tools container shares the host's network there, as the app does (known gap 1). It is given no proxy setting, but code in it could still reach what listens on the host. Package 0.6a checks this.
- **What else is in the tools image.** It is the build stage, so it holds what that stage holds: the template's source, its development programs, and on the development profile the session proxy's certificate (known gap 2). It is not shipped, and it is removed with the project.
- **The real seed's own environment.** The stand-in step shows the environment of a command run in that container, in that way; the real seed is run in the same way.
