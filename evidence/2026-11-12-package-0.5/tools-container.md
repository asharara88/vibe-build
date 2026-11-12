# Package 0.5: app set-up runs in a tools container

| | |
| --- | --- |
| Date | 12 November 2026 |
| Package | 0.5 of `docs/BUILD-PLAN.md`: "App set-up runs in a tools container. Creating tables and sample users never runs on the machine that hosts the builder. A container receives a named list of settings, never the host's whole environment." It depends on licence codes L9 and L11, both true since 12 November |
| Answers | Register finding P-5 (`docs/reviews/2026-11-11-pull-request-2.md`): creating the app's tables and sample users ran on the machine that hosts the builder, with the host's whole environment. Known gap 29 |
| Done means (plan) | "A test whose seed script prints its environment shows none of the builder's own settings. Known gap 29 closed" |
| Run on | The development machine (a cloud session), development profile: the project's containers share the host's network (known gap 1). Made-up sample users only. No model was called |
| Result | **Shown on the development profile** (run 4 below). A stand-in seed step, run in the tools container exactly as the seed is run, reported the names in its environment and a fingerprint of each value. The check found that: every name was on the named list, declared by the image, or set by Docker in every container; every listed value was the one the builder chose to give; and no value inside equalled any of the builder's own settings. Run again with Compose given the builder's whole environment, plus made-up values for each of its settings, the result was the same, and none of the made-up values reached the container. The tables and the three sample users were then created in that container, and the app ran and passed the screenshots and the 26 role-guard checks of package 0.3. Two live tests in `npm test` cover the two ways round that review found; each was run with its fix removed and failed (output kept). **Not shown**: the server profile, which needs a server (package 0.6b). **State: built, not tested**, until an independent reviewer has read the commit that is merged |

A *container* is a sealed box the app runs in, with only the files and settings put into it. The *tools container* is a box made from the same app, with the extra programs needed to create its tables and sample users; it runs one command and is removed. A *fingerprint* (SHA-256) is a short code worked out from a value: the same value always gives the same fingerprint, and the value cannot be read back from it, so values can be compared without being printed.

## What was built

- **The template's image file** (`templates/next/Dockerfile`):
  - A new stage, `tools`: the build stage, which already has the development programs, run as the unprivileged user `node`. It is never started as the app. It runs its command directly, without the base image's start-up script (see run 1 for why).
  - The proxy's address is no longer declared as a build argument. Docker predefines `HTTPS_PROXY` and `HTTP_PROXY`, so the build steps still see them, and an undeclared one is not recorded in the image's history (measured: `measure-docker-behaviours.txt`, item 1).
- **`templates/next/.dockerignore`** (new): a local settings file (`.env`), installed packages and build output are never sent to the image build. `drizzle-kit` reads a `.env` file by itself when one is there (item 6); with this file, none can be in the image (`measure-tools-image.txt`).
- **The sandbox manager** (`builder/src/sandbox/manager.ts`):
  - It builds two images from the template, the app (`run` stage) and the tools image (`tools` stage); both are removed with the project.
  - It adds a `tools` service to the project's Compose file, under its own profile, with the same hardening as the app: every capability dropped, no new privileges, read-only files, a small writable `/tmp`. `up` refuses it by name; it runs one command at a time through `runOnce`.
  - It gives that service a **named list** of settings: `DATABASE_URL`, the names the builder passes in `toolsEnv` (here `APP_URL`), and the names in the project's secrets file (`AUTH_SECRET`, `APP_SAMPLE_PASSWORD`). Every entry has its value written in. No proxy setting is given; the container needs only the project's database.
  - **Every Docker command of a sandbox runs with one narrow environment:**
    - `PATH`, `HOME`, and the settings that name the Docker daemon (`DOCKER_HOST`, `DOCKER_TLS`, `DOCKER_TLS_VERIFY`, `DOCKER_CERT_PATH`, when set);
    - `DOCKER_CONFIG`, pointed at the project's own Docker client folder.
  - **What the project's own client folder holds and why:**
    - Why: Docker's client configuration can itself add settings to every container; its `proxies` entry adds proxy settings (item 2).
    - Only two things are carried over from the user's own Docker configuration: the folder of command-line plugins (linked) and any extra plugin folders it names. Both are needed so that `docker compose` is found.
    - Its proxies and its registry sign-ins are not carried over. So the sandbox's image pulls do not use a sign-in (known gap 5).
    - A Docker "context" is refused with a plain message, whether chosen with `DOCKER_CONTEXT` or with `docker context use`, so that every command reaches the same daemon.
  - **Removing a project also removes a tools container whose run was cut off.** This needs both the tools profile and `--remove-orphans` (item 4). Before, the container was left behind.
- **The demonstration** (`builder/scripts/demo-template.ts`) creates the tables (`drizzle-kit push`) and the sample users (the template's seed) in the tools container. Before, it ran both on the host with the host's whole environment added. It no longer copies a local `.env` file into the project.
- **The check** (`builder/scripts/tools-env-check.ts`), run by the demonstration before the seed:
  - A stand-in seed step (a few lines of Node) reports the **names** in its environment and a fingerprint of each value. The check prints names and counts only; values are fingerprinted, never printed.
  - It passes only if four things hold:
    - the names inside are exactly the named list, the names the tools image declares (read from the image), and `HOSTNAME` and `HOME`, which Docker sets in every container;
    - every named or image value matches, by fingerprint, the value given (`HOSTNAME` and `HOME` have no expected value);
    - no name is one of the builder's settings;
    - no value inside, `HOSTNAME` and `HOME` included, equals the value of one of the builder's own settings in the process running the check.
  - What it cannot judge is a value the builder gives on purpose: the named list is the builder's own choice.
  - It is run twice:
    - (1) the way the demonstration runs the real seed;
    - (2) with Compose given this process's whole environment plus made-up values for each of the builder's settings, with Docker's client folder still the project's own. This shows that the Compose file alone copies nothing in. In run 2 the check also reports which made-up values appear anywhere inside.
  - The demonstration stops if the check fails.
- **Five tests** (`builder/test/sandbox.test.ts`, run by `npm test`):
  - three read the Compose file and the sandbox's settings:
    - the tools service in both profiles;
    - the narrow environment with its own client folder;
    - only extra plugin folders carried over (from a made-up configuration that also holds proxies and a sign-in), a chosen context refused, and `up` refusing the tools service;
  - two run Docker:
    - (a) with a made-up Docker configuration in the home folder that adds proxies to every container, a tools container started through the sandbox holds only the named list plus the image's and Docker's own names. The control, the same command without the project's own client folder, does get the proxies;
    - (b) on the development profile, a tools run left running is removed with the project.

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

The whole demonstration passed at commit `273f294`, with the check as it then was: names only, and made-up values that, as review showed, could only have been found in its second run.

## The first independent review, of `273f294`

Five reviewers each took one angle: isolation, the strength of the check, regressions, the records, and an independent run of the demonstration. Each finding was then read by two more agents told to refute it. The reviewers confirmed the central result in their own runs: the tools container held the named list and the image's own settings, and none of the builder's settings. They also found:

| Finding | What was done (in `bbe0857`) |
| --- | --- |
| Docker's client configuration (`proxies`) adds proxy settings to every container Compose starts, the tools container included | Every Docker command uses the project's own client folder. Test (a) |
| With `HTTPS_PROXY` and `HTTP_PROXY` declared as build arguments, the proxy's address was recorded in the tools image's history. The Dockerfile's comment said "Neither is in the image" | Declarations removed; the comment says the tools image holds the session certificate. Measured in `measure-tools-image.txt` |
| A tools run that was cut off outlived the project | Removing a project names the tools profile. Test (b) |
| The check compared names only, and reported its made-up values for a run in which they could not be found | Values compared by fingerprint; made-up values reported for the second run only |
| One-off runs could reach a different Docker daemon from the other commands | All of a sandbox's Docker commands share one environment |
| A miscount of the builder's settings, and other sentences that claimed more than was shown | Corrected |

Run 3 (`run-live-3-first-answers.txt`) passed at `bbe0857`.

## The second review, of `bbe0857`

Three reviewers each took one angle: the code fixes, a deliberate breach of the new check, and the records. All three found nothing blocking. Their measurements:
- The proxy address is in none of the tools image's history, settings or files, and the build still reaches the package registry through the proxy.
- The check reports FAILED when a value inside is not the one given, and when a builder setting is given under its own name.
- Each new test fails with its fix removed.

They asked for the following, all done in this commit:
- **Compare values with the builder's own settings.** The check did not compare values inside with the builder's own settings, so a sentence saying "a builder setting cannot be inside under any name" claimed too much. The comparison was added, and the sentence now says what the check cannot judge.
- **Correct the count of settings the builder reads.** Besides its eleven own settings, its code reads `PATH`, `HOME` and Docker's own client settings. That is now said where the count appears.
- **Keep outputs that were only described.** These are now kept: `run-tests-with-fixes-removed.txt`, `measure-tools-image.txt`, and `measure-docker-behaviours.txt` with its script.
- **Record the outside facts in `docs/SOURCES.md`.** Docker's documentation could not be read from this session, so the facts are recorded as measurements, with the script and its output.
- **Smaller points:**
  - a Docker context chosen with `docker context use` is now refused too;
  - `DOCKER_TLS` is passed on;
  - extra plugin folders are carried over;
  - a link to a plugin folder that no longer exists is replaced;
  - `up` refuses the tools service;
  - the loss of registry sign-ins is recorded (known gap 5);
  - the tests' own Docker commands use the narrow environment;
  - a test that fails part-way removes what it left.

## The two Docker tests, each with its fix removed (`run-tests-with-fixes-removed.txt`)

Each fix was removed in a scratch copy of `builder/`, and the two live tests of the tools container were run:
- **(A)** `DOCKER_CONFIG` was not pointed at the project's own folder. Test (a) failed: the container held 13 names, where 9 were expected. The test runner prints these as "…(12)" and "…(8)" after the first name. Four extra names is what a `proxies` entry adds (item 2).
- **(B)** `destroy` was run without the tools profile. Test (b) failed: the cut-off container was still there.

With both fixes in place, both tests passed.

## Run 4: the whole demonstration after the second review (`run-live.txt`)

`npx tsx scripts/demo-template.ts ../templates/next ../evidence/2026-11-12-package-0.5/screens --guard`, from `builder/`. Exit code 0. Whole run 82 seconds. The lines that show this package:

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
     settings whose value equals one of the builder's own settings in this process: none (1 of the builder's settings set here, compared by fingerprint)
     PASSED
  2. Compose given this process's whole environment, with Docker's client folder set to the project's own (211 settings, including made-up values for the builder's 11 settings, HTTP_PROXY and BUILDER_TOOLS_CHECK_MARKER):
     ... the same ten names, and the same results ...
     made-up values found in any setting: 0 of 13
     PASSED

Creating the tables (drizzle-kit push) and the three sample users (seed), in the tools container...
  drizzle-kit push: done (6 lines of output, not shown)
  created: employee@example.test (employee)
  created: manager@example.test (manager)
  created: hr.admin@example.test (hr_admin)
```

"1 of the builder's settings set here" means that, of the builder's own settings, only one had a value in the process that ran the demonstration. Its value was compared by fingerprint and not printed.

Then the app started (healthy), the seven screenshots were taken (`screens/`), and the role guard's 26 live checks of package 0.3 all passed (`screens/guard/`, "RESULT: PASSED"). The sample users the app signs in with are the ones the tools container created.

**Nothing of the template ran on the host.** The template folder in the checkout this ran from has no `node_modules` (no programs installed), so neither `drizzle-kit` nor the seed could have run there. The builder's own programs did run on the host, as before: the demonstration, the browser that takes the screenshots and the live guard checks.

The eleven settings specific to the builder that its code reads were given made-up values in run 2 (`grep` of `process.env` in `builder/src` and `builder/scripts`, 12 Nov): `BUILDER_DATABASE_URL`, `BUILDER_TEST_DATABASE_URL`, `BUILDER_MODEL_API_KEY`, `BUILDER_GATEWAY_HOST`, `BUILDER_GATEWAY_PORT`, `BUILDER_UPSTREAM_URL`, `EGRESS_ALLOW`, `EGRESS_PORT`, `EGRESS_UPSTREAM_PROXY`, `HTTPS_PROXY`, `PGUSER`. So were `HTTP_PROXY` and one name no code reads. The code also reads `PATH`, `HOME` and Docker's own client settings, which steer the Docker command itself; any of them inside the container would fail the check as a name not on the list.

In run 2 the builder's whole environment was handed to Docker Compose, which is the point of that run. The run's own values went with its temporary folder, so the output was searched for their shapes instead: a sample password `Sample-…`, a line `AUTH_SECRET=`, and a database address with a password in it. None was found.

After the run, no container and no image of the project was left: `docker ps -a` and `docker images -a` list only the base images.

## Checks run on this branch (`builder/`)

Type check passed (exit 0). 91 of 91 tests passed, among them the five new ones. The committed licence check passed (exit 0). No package was added or removed.

## What this does not show

- **The server profile.** The Compose file puts the tools container on the project's internal network and on no other (unit test). That this network has no route out is designed (design note 2.5), not run; it needs a server (package 0.6b). Test (b) shows the removal of a cut-off run on the development profile only; on the server profile, the removal of the project's network with it is not covered by a test.
- **Isolation on the development profile.** The tools container shares the host's network there, as the app does (known gap 1). It is given no proxy setting, but code in it could still reach what listens on the host. Package 0.6a checks this.
- **What else is in the tools image.** It is the build stage, so it holds what that stage holds: the template's source and its development programs. On the development profile it also holds the session proxy's certificate, 2 files (`measure-tools-image.txt`; known gap 2). It is not shipped, and it is removed with the project.
- **The real seed's own environment.** The stand-in step shows the environment of a command run in that container, in that way; the real seed is run in the same way.
- **Docker's documentation.** The Docker behaviours relied on were measured on this machine (Docker 29.9.2, Compose v5.6.1), not read in Docker's documentation, which this session could not reach.
