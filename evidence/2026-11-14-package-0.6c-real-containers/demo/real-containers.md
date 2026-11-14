# Where each real column ran (part A)

Written by scripts/demo-isolation.ts from this run. Project builder_p_iso06c_real_demo: a real example-1 project made by makeExample1, the scripted engine's steps 01 and 02, and buildAndStart, with the door started too.

## The images

```
app: builder_p_iso06c_real_demo-app:latest
  id: sha256:bdf5679a7d1e739b32a4cde688361decab89a0a16d5836993162b32ab9af0f1a
  user: "app"; command: ["node","server.js"]; entrypoint: ["docker-entrypoint.sh"]; working folder: "/app"; labels: {}
  how it was made: built in this run by sandbox.build from the project's workspace (the house template after the scripted engine's steps 01 and 02), the Dockerfile's `run` stage
tools: builder_p_iso06c_real_demo-tools:latest
  id: sha256:1556da4e2e4f7c5d8a54f13acf900ce0dbe10569efcb3d24d76c05ba9cfdf388
  user: "node"; command: ["node","-e","console.error('The tools image runs one named command at a time, e.g. drizzle-kit push or the seed.'); pro; entrypoint: []; working folder: "/app"; labels: {}
  how it was made: built in this run by sandbox.build from the same workspace, the Dockerfile's `tools` stage
acceptance runner: builder-acceptance-runner:local
  id: sha256:2e1340795a27782bde30b20f6f815aa87c3eda7634112a8a2e91d48ee44843e1
  user: "runner"; command: ["/bin/bash"]; entrypoint: []; working folder: "/runner"; labels: {"builder.browser-zip-sha256":"a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d","builder.never-pushed":"true","builder.package":"3.1","org.opencontainers.image.version":"24.04"}
  how it was made: built by buildRunnerImage from builder/runner and the approved browser zip; machine-wide, never removed here
approved Node image (check, engine, door): node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
  id: sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
  user: ""; command: ["node"]; entrypoint: ["docker-entrypoint.sh"]; working folder: "/"; labels: {}
  how it was made: the approved Node image, by its digest
The running app container 4c0e0c1e4e80 runs image sha256:bdf5679a7d1e739b32a4cde688361decab89a0a16d5836993162b32ab9af0f1a.
```

Are these the real images (realImageProblemsFrom)? Yes: no problem found.

## The columns

### app, the running container itself (real container, in place)

- Kind: real container, in place
- Container: builder_p_iso06c_real_demo-app-1 (4c0e0c1e4e80), the one buildAndStart started; the same before and after the probe
- Image: builder_p_iso06c_real_demo-app:latest, id sha256:bdf5679a7d1e739b32a4cde688361decab89a0a16d5836993162b32ab9af0f1a
- User id the probe reported: 100
- Networks, as Docker reported them: builder_p_iso06c_real_demo_data builder_p_iso06c_real_demo_front ; user setting "app"; read-only root: true
- How the probe got in: `docker compose exec` in the running container: the probe file written to its own /tmp/isolation-probe.mjs from one base64 argument (59316 characters), its SHA-256 read back inside (3afbd7d85547d1a9dd650e11a198eb590a3db83b9fe413009ecd063dd746c084; the repository's file: 3afbd7d85547d1a9dd650e11a198eb590a3db83b9fe413009ecd063dd746c084), run there, removed (seen gone: true)
- Compared with the list `app-running`: PASS (56 PASS, 0 FAIL)
- The docker commands:
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-QDYef1/compose.yaml --profile tools --profile engine --profile acceptance --profile check exec -T app node -e <write the file from one base64 argument> /tmp/isolation-probe.mjs <59316 characters>`
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-QDYef1/compose.yaml --profile tools --profile engine --profile acceptance --profile check exec -T app node -e <print the file's SHA-256> /tmp/isolation-probe.mjs`
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-QDYef1/compose.yaml --profile tools --profile engine --profile acceptance --profile check exec -T app node /tmp/isolation-probe.mjs <settings: 496 characters, in real-probe-settings.json>`
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-QDYef1/compose.yaml --profile tools --profile engine --profile acceptance --profile check exec -T app node -e <remove the file and say whether it is gone> /tmp/isolation-probe.mjs`

### app, a one-off container of the real image (real image, one-off container)

- Kind: real image, one-off container
- Container: builder_p_iso06c_real_demo-isolation-app-real, a one-off container of the app service (`docker compose run --rm --no-deps`), removed when the probe ended
- Image: builder_p_iso06c_real_demo-app:latest, id sha256:bdf5679a7d1e739b32a4cde688361decab89a0a16d5836993162b32ab9af0f1a
- User id the probe reported: 100; Docker's user setting: "app"
- Networks, as Docker reported them: builder_p_iso06c_real_demo_data, builder_p_iso06c_real_demo_front; read-only root: true
- How the probe got in: the probe mounted read-only at /probe as the container's command, in place of the service's own
- Compared with the list `app`: PASS (55 PASS, 0 FAIL)
- The docker command:
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-QDYef1/compose.yaml --profile tools --profile engine --profile acceptance --profile check run --rm --no-deps -T --name builder_p_iso06c_real_demo-isolation-app-real --volume <scratchpad>/run06c/builder/scripts/isolation-probe.mjs:/probe/isolation-probe.mjs:ro app node /probe/isolation-probe.mjs <496 characters>`

### tools, a one-off container of the real image (real image, one-off container)

- Kind: real image, one-off container
- Container: builder_p_iso06c_real_demo-isolation-tools-real, a one-off container of the tools service (`docker compose run --rm --no-deps`), removed when the probe ended
- Image: builder_p_iso06c_real_demo-tools:latest, id sha256:1556da4e2e4f7c5d8a54f13acf900ce0dbe10569efcb3d24d76c05ba9cfdf388
- User id the probe reported: 1000; Docker's user setting: "node"
- Networks, as Docker reported them: builder_p_iso06c_real_demo_data; read-only root: true
- How the probe got in: the probe mounted read-only at /probe as the container's command, in place of the service's own
- Compared with the list `tools`: PASS (55 PASS, 0 FAIL)
- The docker command:
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-QDYef1/compose.yaml --profile tools --profile engine --profile acceptance --profile check run --rm --no-deps -T --name builder_p_iso06c_real_demo-isolation-tools-real --volume <scratchpad>/run06c/builder/scripts/isolation-probe.mjs:/probe/isolation-probe.mjs:ro tools node /probe/isolation-probe.mjs <496 characters>`

### runner (package 3.1), a one-off container of the real image (real image, one-off container)

- Kind: real image, one-off container
- Container: builder_p_iso06c_real_demo-isolation-runner-real, a one-off container of the acceptance service (`docker compose run --rm --no-deps`), removed when the probe ended
- Image: builder-acceptance-runner:local, id sha256:2e1340795a27782bde30b20f6f815aa87c3eda7634112a8a2e91d48ee44843e1
- User id the probe reported: 1001; Docker's user setting: "runner"
- Networks, as Docker reported them: builder_p_iso06c_real_demo_front; read-only root: true
- How the probe got in: the probe mounted read-only at /probe as the container's command, in place of the service's own
- Compared with the list `runner`: PASS (55 PASS, 0 FAIL)
- The docker command:
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-QDYef1/compose.yaml --profile tools --profile engine --profile acceptance --profile check run --rm --no-deps -T --name builder_p_iso06c_real_demo-isolation-runner-real --volume <scratchpad>/run06c/builder/scripts/isolation-probe.mjs:/probe/isolation-probe.mjs:ro acceptance node /probe/isolation-probe.mjs <496 characters>`

### the live camera: the runner's service with the camera socket at /psock, the real runner image (real image, one-off container)

- Kind: real image, one-off container
- Container: builder_p_iso06c_real_demo-isolation-camera-real, a one-off container of the acceptance service (`docker compose run --rm --no-deps`), removed when the probe ended
- Image: builder-acceptance-runner:local, id sha256:2e1340795a27782bde30b20f6f815aa87c3eda7634112a8a2e91d48ee44843e1
- User id the probe reported: 1001; Docker's user setting: "runner"
- Networks, as Docker reported them: builder_p_iso06c_real_demo_front; read-only root: true
- How the probe got in: the probe mounted read-only at /probe as the container's command, in place of the service's own
- Compared with the list `camera`: PASS (56 PASS, 0 FAIL)
- The docker command:
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-QDYef1/compose.yaml --profile tools --profile engine --profile acceptance --profile check run --rm --no-deps -T --name builder_p_iso06c_real_demo-isolation-camera-real --volume <scratchpad>/run06c/builder/scripts/isolation-probe.mjs:/probe/isolation-probe.mjs:ro --volume /tmp/bpc-Ppy6ZW:/psock:ro acceptance node /probe/isolation-probe.mjs <524 characters>`

### a live preview stream, check (real image, one-off container)

- Kind: real image, one-off container
- Container: builder_p_iso06c_real_demo-isolation-check-real, a one-off container of the check service (`docker compose run --rm --no-deps`), removed when the probe ended
- Image: node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202, id sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
- User id the probe reported: 1000; Docker's user setting: "node"
- Networks, as Docker reported them: builder_p_iso06c_real_demo_front; read-only root: true
- How the probe got in: the probe mounted read-only at /probe as the container's command, in place of the service's own
- Compared with the list `check`: PASS (55 PASS, 0 FAIL)
- The docker command:
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-QDYef1/compose.yaml --profile tools --profile engine --profile acceptance --profile check run --rm --no-deps -T --name builder_p_iso06c_real_demo-isolation-check-real --volume <scratchpad>/run06c/builder/scripts/isolation-probe.mjs:/probe/isolation-probe.mjs:ro check node /probe/isolation-probe.mjs <496 characters>`

### the scripted engine's container (package 2.1; no network; NOT package 2.2's engine) (real image, one-off container)

- Kind: real image, one-off container
- Container: builder_p_iso06c_real_demo-isolation-engine-scripted-real, a one-off container of the engine service (`docker compose run --rm --no-deps`), removed when the probe ended
- Image: node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202, id sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
- User id the probe reported: 1000; Docker's user setting: "node"
- Networks, as Docker reported them: network mode none; read-only root: true
- How the probe got in: the probe mounted read-only at /probe as the container's command, in place of the service's own
- Compared with the list `engine-scripted`: PASS (54 PASS, 0 FAIL)
- The docker command:
  - `docker compose -f <scratchpad>/t06c/builder-acceptance-QDYef1/compose.yaml --profile tools --profile engine --profile acceptance --profile check run --rm --no-deps -T --name builder_p_iso06c_real_demo-isolation-engine-scripted-real --volume <scratchpad>/run06c/builder/scripts/isolation-probe.mjs:/probe/isolation-probe.mjs:ro engine node /probe/isolation-probe.mjs <496 characters>`

### db: the probe in the running database container's network (network namespace only)

- Kind: network namespace only
- Container: builder_p_iso06c_real_demo-isolation-db-real, a container of the approved Node image sharing the running database container's network (`docker run --network container:<db>`)
- Image: node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202, id sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
- User id the probe reported: 1000
- Networks, as Docker reported them: not asked
- How the probe got in: only the network is the database's; the image, user and files are the probe container's (the database's image has no Node)
- Compared with the list `db`: PASS (55 PASS, 0 FAIL)
- The docker command:
  - `docker run --rm --name builder_p_iso06c_real_demo-isolation-db-real --network container:<the running db container> --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 256 --memory 1g --read-only --entrypoint "" --volume <the probe>:/probe/isolation-probe.mjs:ro <the approved Node image> node /probe/isolation-probe.mjs <settings>`
