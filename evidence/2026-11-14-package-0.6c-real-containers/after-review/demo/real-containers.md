# Where each real column ran (part A)

Written by scripts/demo-isolation.ts from this run. Project builder_p_iso06c_real_demo: a real example-1 project made by makeExample1, the scripted engine's steps 01 and 02, and buildAndStart, with the door started too.

## The images

```
This project was made at 2026-11-14T16:06:37.245Z.
app: builder_p_iso06c_real_demo-app:latest
  id: sha256:c1a018cfded777c22471313db3c864173546c067be72b74d034d8bd35815e4e6
  created: 2026-11-14T12:34:42.907831573Z
  user: "app"; command: ["node","server.js"]; entrypoint: ["docker-entrypoint.sh"]; working folder: "/app"; labels: {}
  how it was made: named in this run by docker build (sandbox.build) from the project's workspace (the house template after the scripted engine's steps 01 and 02), the Dockerfile's `run` stage; Docker dates it 2026-11-14T12:34:42.907831573Z, 12714 s BEFORE this project was made (2026-11-14T16:06:37.245Z): so the build's last step did not run in this run. docker build took it from Docker's build cache, where an earlier build of identical files had left it, and gave the result this project's name. That the guard check and next build ran in THIS run is not shown
tools: builder_p_iso06c_real_demo-tools:latest
  id: sha256:2b820e7a19f8e0295fee74ee97732168b29aed8e5bd660013d04a3051af06c88
  created: 2026-11-14T12:34:42.492001923Z
  user: "node"; command: ["node","-e","console.error('The tools image runs one named command at a time, e.g. drizzle-kit push or the seed.'); pro; entrypoint: []; working folder: "/app"; labels: {}
  how it was made: named in this run by docker build (sandbox.build) from the same workspace, the Dockerfile's `tools` stage; Docker dates it 2026-11-14T12:34:42.492001923Z, 12715 s BEFORE this project was made (2026-11-14T16:06:37.245Z): so the build's last step did not run in this run. docker build took it from Docker's build cache, where an earlier build of identical files had left it, and gave the result this project's name. That the guard check and next build ran in THIS run is not shown
acceptance runner: builder-acceptance-runner:local
  id: sha256:fa2ce23e3e5320770790fd3f9a8ddafbf36e9ea88608d8d2289f26f31ee5dd1c
  created: 2026-11-14T12:33:50.648406534Z
  user: "runner"; command: ["/bin/bash"]; entrypoint: []; working folder: "/runner"; labels: {"builder.browser-zip-sha256":"a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d","builder.never-pushed":"true","builder.package":"3.1","org.opencontainers.image.version":"24.04"}
  how it was made: built by buildRunnerImage from builder/runner and the approved browser zip (from Docker's build cache when nothing changed); machine-wide, never removed here; Docker dates it 2026-11-14T12:33:50.648406534Z
approved Node image (check, engine, door): node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
  id: sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
  created: 2026-11-05T19:25:28.200769142Z
  user: ""; command: ["node"]; entrypoint: ["docker-entrypoint.sh"]; working folder: "/"; labels: {}
  how it was made: the approved Node image, by its digest
The running app container 9079bb77faab runs image sha256:c1a018cfded777c22471313db3c864173546c067be72b74d034d8bd35815e4e6.
Does any of them have the settings of a stand-in image of 13 Nov (realImageProblemsFrom; a check of settings, not proof of how an image was made)? No: no problem found.
What the images hold, read in a one-off container of each service (imageContents): app {"server.js":true,".next/server/app/[locale]/my-requests/page.js":true,".next/server/app/[locale]/my-requests/new/page.js":true}; tools {"node_modules/.bin/drizzle-kit":true,"scripts/seed.ts":true}. The app image holds the pages only step 02 adds, and the tools image the product's two tools: yes.
```

## The columns

### app, the running container itself (real container, in place)

- Kind: real container, in place
- Container: builder_p_iso06c_real_demo-app-1 (9079bb77faab), the one buildAndStart started; the same before and after the probe
- Image: builder_p_iso06c_real_demo-app:latest, id sha256:c1a018cfded777c22471313db3c864173546c067be72b74d034d8bd35815e4e6
- User id the probe reported: 100
- Networks, as Docker reported them: builder_p_iso06c_real_demo_data builder_p_iso06c_real_demo_front ; user setting "app"; read-only root: true
- How the probe got in: `docker compose exec` in the running container: the probe file written to its own /tmp/isolation-probe.mjs from one base64 argument (59316 characters), its SHA-256 read back inside (3afbd7d85547d1a9dd650e11a198eb590a3db83b9fe413009ecd063dd746c084; the repository's file: 3afbd7d85547d1a9dd650e11a198eb590a3db83b9fe413009ecd063dd746c084), run there, removed (seen gone: true)
- Compared with the list `app-running`: PASS (56 PASS, 0 FAIL)
- The docker commands (written out by the demonstration script from the manager's and the harness's code; NOT captured from the command that ran):
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-iJgnZx/compose.yaml --profile tools --profile engine --profile acceptance --profile check exec -T app node -e <write the file from one base64 argument> /tmp/isolation-probe.mjs <59316 characters>`
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-iJgnZx/compose.yaml --profile tools --profile engine --profile acceptance --profile check exec -T app node -e <print the file's SHA-256> /tmp/isolation-probe.mjs`
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-iJgnZx/compose.yaml --profile tools --profile engine --profile acceptance --profile check exec -T app node /tmp/isolation-probe.mjs <settings: 496 characters, in real-probe-settings.json>`
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-iJgnZx/compose.yaml --profile tools --profile engine --profile acceptance --profile check exec -T app node -e <remove the file and say whether it is gone> /tmp/isolation-probe.mjs`

### app, a one-off container of the real image (real image, one-off container)

- Kind: real image, one-off container
- Container: builder_p_iso06c_real_demo-isolation-app-real, a one-off container of the app service (`docker compose run --rm --no-deps`), removed when the probe ended
- Image: builder_p_iso06c_real_demo-app:latest, id sha256:c1a018cfded777c22471313db3c864173546c067be72b74d034d8bd35815e4e6
- User id the probe reported: 100; Docker's user setting: "app"
- Networks, as Docker reported them: builder_p_iso06c_real_demo_data, builder_p_iso06c_real_demo_front; read-only root: true
- How the probe got in: the probe mounted read-only at /probe as the container's command, in place of the service's own
- Compared with the list `app`: PASS (55 PASS, 0 FAIL)
- The docker command (captured: the arguments the sandbox manager gave to docker):
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-iJgnZx/compose.yaml --profile tools --profile engine --profile acceptance --profile check run --rm --no-deps -T --name builder_p_iso06c_real_demo-isolation-app-real --volume <scratchpad>/run06c/builder/scripts/isolation-probe.mjs:/probe/isolation-probe.mjs:ro app node /probe/isolation-probe.mjs <496 characters>`

### tools, a one-off container of the real image (real image, one-off container)

- Kind: real image, one-off container
- Container: builder_p_iso06c_real_demo-isolation-tools-real, a one-off container of the tools service (`docker compose run --rm --no-deps`), removed when the probe ended
- Image: builder_p_iso06c_real_demo-tools:latest, id sha256:2b820e7a19f8e0295fee74ee97732168b29aed8e5bd660013d04a3051af06c88
- User id the probe reported: 1000; Docker's user setting: "node"
- Networks, as Docker reported them: builder_p_iso06c_real_demo_data; read-only root: true
- How the probe got in: the probe mounted read-only at /probe as the container's command, in place of the service's own
- Compared with the list `tools`: PASS (55 PASS, 0 FAIL)
- The docker command (captured: the arguments the sandbox manager gave to docker):
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-iJgnZx/compose.yaml --profile tools --profile engine --profile acceptance --profile check run --rm --no-deps -T --name builder_p_iso06c_real_demo-isolation-tools-real --volume <scratchpad>/run06c/builder/scripts/isolation-probe.mjs:/probe/isolation-probe.mjs:ro tools node /probe/isolation-probe.mjs <496 characters>`

### runner (package 3.1), a one-off container of the real image (real image, one-off container)

- Kind: real image, one-off container
- Container: builder_p_iso06c_real_demo-isolation-runner-real, a one-off container of the acceptance service (`docker compose run --rm --no-deps`), removed when the probe ended
- Image: builder-acceptance-runner:local, id sha256:fa2ce23e3e5320770790fd3f9a8ddafbf36e9ea88608d8d2289f26f31ee5dd1c
- User id the probe reported: 1001; Docker's user setting: "runner"
- Networks, as Docker reported them: builder_p_iso06c_real_demo_front; read-only root: true
- How the probe got in: the probe mounted read-only at /probe as the container's command, in place of the service's own
- Compared with the list `runner`: PASS (55 PASS, 0 FAIL)
- The docker command (captured: the arguments the sandbox manager gave to docker):
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-iJgnZx/compose.yaml --profile tools --profile engine --profile acceptance --profile check run --rm --no-deps -T --name builder_p_iso06c_real_demo-isolation-runner-real --volume <scratchpad>/run06c/builder/scripts/isolation-probe.mjs:/probe/isolation-probe.mjs:ro acceptance node /probe/isolation-probe.mjs <496 characters>`

### the live camera: the runner's service with the camera socket at /psock, the real runner image (real image, one-off container)

- Kind: real image, one-off container
- Container: builder_p_iso06c_real_demo-isolation-camera-real, a one-off container of the acceptance service (`docker compose run --rm --no-deps`), removed when the probe ended
- Image: builder-acceptance-runner:local, id sha256:fa2ce23e3e5320770790fd3f9a8ddafbf36e9ea88608d8d2289f26f31ee5dd1c
- User id the probe reported: 1001; Docker's user setting: "runner"
- Networks, as Docker reported them: builder_p_iso06c_real_demo_front; read-only root: true
- How the probe got in: the probe mounted read-only at /probe as the container's command, in place of the service's own
- Compared with the list `camera`: PASS (56 PASS, 0 FAIL)
- The docker command (captured: the arguments the sandbox manager gave to docker):
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-iJgnZx/compose.yaml --profile tools --profile engine --profile acceptance --profile check run --rm --no-deps -T --name builder_p_iso06c_real_demo-isolation-camera-real --volume <scratchpad>/run06c/builder/scripts/isolation-probe.mjs:/probe/isolation-probe.mjs:ro --volume /tmp/bpc-V3dwpD:/psock:ro acceptance node /probe/isolation-probe.mjs <524 characters>`

### a live preview stream, check (real image, one-off container)

- Kind: real image, one-off container
- Container: builder_p_iso06c_real_demo-isolation-check-real, a one-off container of the check service (`docker compose run --rm --no-deps`), removed when the probe ended
- Image: node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202, id sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
- User id the probe reported: 1000; Docker's user setting: "node"
- Networks, as Docker reported them: builder_p_iso06c_real_demo_front; read-only root: true
- How the probe got in: the probe mounted read-only at /probe as the container's command, in place of the service's own
- Compared with the list `check`: PASS (55 PASS, 0 FAIL)
- The docker command (captured: the arguments the sandbox manager gave to docker):
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-iJgnZx/compose.yaml --profile tools --profile engine --profile acceptance --profile check run --rm --no-deps -T --name builder_p_iso06c_real_demo-isolation-check-real --volume <scratchpad>/run06c/builder/scripts/isolation-probe.mjs:/probe/isolation-probe.mjs:ro check node /probe/isolation-probe.mjs <496 characters>`

### the scripted engine's container (package 2.1; no network; NOT package 2.2's engine) (real image, one-off container)

- Kind: real image, one-off container
- Container: builder_p_iso06c_real_demo-isolation-engine-scripted-real, a one-off container of the engine service (`docker compose run --rm --no-deps`), removed when the probe ended
- Image: node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202, id sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
- User id the probe reported: 1000; Docker's user setting: "node"
- Networks, as Docker reported them: network mode none; read-only root: true
- How the probe got in: the probe mounted read-only at /probe as the container's command, in place of the service's own
- Compared with the list `engine-scripted`: PASS (54 PASS, 0 FAIL)
- The docker command (captured: the arguments the sandbox manager gave to docker):
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-iJgnZx/compose.yaml --profile tools --profile engine --profile acceptance --profile check run --rm --no-deps -T --name builder_p_iso06c_real_demo-isolation-engine-scripted-real --volume <scratchpad>/run06c/builder/scripts/isolation-probe.mjs:/probe/isolation-probe.mjs:ro engine node /probe/isolation-probe.mjs <496 characters>`

### db: the probe in the running database container's network (network namespace only)

- Kind: network namespace only
- Container: builder_p_iso06c_real_demo-isolation-db-real, a container of the approved Node image sharing the running database container's network (`docker run --network container:<db>`)
- Image: node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202, id sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
- User id the probe reported: 1000
- Networks, as Docker reported them: not asked
- How the probe got in: only the network is the database's; the image, user and files are the probe container's (the database's image has no Node)
- Compared with the list `db`: PASS (55 PASS, 0 FAIL)
- The docker command (written out by the demonstration script from the manager's and the harness's code; NOT captured from the command that ran):
  - `docker run --rm --name builder_p_iso06c_real_demo-isolation-db-real --network container:<the running db container> --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 256 --memory 1g --read-only --entrypoint "" --volume <the probe>:/probe/isolation-probe.mjs:ro <the approved Node image> node /probe/isolation-probe.mjs <settings>`
