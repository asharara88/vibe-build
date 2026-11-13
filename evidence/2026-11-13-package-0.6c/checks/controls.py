#!/usr/bin/env python3
"""Package 0.6c controls: each new safeguard removed on a scratch copy of the commit (git archive), its test run
and shown failing, then the file restored. Usage: controls.py <commit> <copy-dir> <out-file> [only-ids...]"""
import os, subprocess, sys, shutil, datetime

commit, copy, out = sys.argv[1], sys.argv[2], sys.argv[3]
only = set(sys.argv[4:])
WT = "/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad/wt-06c"
TMP = "/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad/m06c-build-tmp"

if not os.path.isdir(copy):
    os.makedirs(copy)
    subprocess.run(f"git -C {WT} archive {commit} | tar -x -C {copy}", shell=True, check=True)
    os.symlink(f"{WT}/builder/node_modules", f"{copy}/builder/node_modules")

S = "builder/src/sandbox/"
CONTROLS = [
    # id, what is removed, file, old, new, test file, test name filter
    ("C1", "the isolated gateway mode on every project network", S + "manager.ts",
     '  driver_opts: { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" },\n} as const;', '} as const;',
     "test/sandbox.test.ts", "every project network internal"),
    ("C2", "internal: true on every project network", S + "manager.ts",
     "export const PROJECT_NETWORK = {\n  internal: true,", "export const PROJECT_NETWORK = {\n  internal: false,",
     "test/sandbox.test.ts", "every project network internal"),
    ("C3", "IPv6 off on every project network", S + "manager.ts",
     "  internal: true,\n  enable_ipv6: false,\n", "  internal: true,\n",
     "test/sandbox.test.ts", "every project network internal"),
    ("C4", "the tools container on the database's network only", S + "manager.ts",
     '...(tools ? { tools: { ...tools, networks: ["data"] } } : {}),', '...(tools ? { tools: { ...tools, networks: ["data", "out"] } } : {}),',
     "test/sandbox.test.ts", "each service's networks"),
    ("C5", "the runner on the front network only", S + "manager.ts",
     '    environment: { BASE_URL: spec.acceptance.baseUrl },\n    networks: ["front"],', '    environment: { BASE_URL: spec.acceptance.baseUrl },\n    networks: ["front", "data"],',
     "test/acceptance.test.ts", "the service in the Compose file"),
    ("C6", "no project container on the machine's network (the app given network_mode host)", S + "manager.ts",
     '    // Both: its database on `data`, and the runner and the check on `front`. No way out.\n    networks: ["data", "front"],',
     '    network_mode: "host",',
     "test/sandbox.test.ts", "each service's networks"),
    ("C7", "the database's health check over TCP (gap 69)", S + "manager.ts",
     '"pg_isready -h 127.0.0.1 -p 5432 -U app -d app"', '"pg_isready -U app -d app"',
     "test/sandbox.test.ts", "each service's networks"),
    ("C8", "every capability dropped", S + "manager.ts",
     "  const common = {\n    cap_drop: HARDENING.cap_drop,\n", "  const common = {\n",
     "test/sandbox.test.ts", "each service's networks"),
    ("C9", "an empty upstream refused (the proxy would go out directly)", S + "egress-proxy.ts",
     "  if (!v) throw new Error(\"The egress proxy's way out (EGRESS_UPSTREAM_PROXY) is empty or missing: it refuses to start rather than go out directly.\");",
     "  if (!v) return null;",
     "test/door.test.ts", "fails closed"),
    ("C10", "502 when the upstream closes before it answers", S + "egress-proxy.ts",
     '      if (!established) failBeforeTunnel("502 Bad Gateway", "the upstream proxy closed the connection before it answered");\n      else clientSocket.destroy();',
     "      if (established) clientSocket.destroy();",
     "test/door.test.ts", "a tunnel request gets an answer"),
    ("C11", "504 when the upstream says nothing within the limit", S + "egress-proxy.ts",
     '    const timer = setTimeout(() => failBeforeTunnel("504 Gateway Timeout", `the upstream proxy did not answer within ${upstreamTimeoutMs} ms`), upstreamTimeoutMs);',
     "    const timer = setTimeout(() => undefined, upstreamTimeoutMs);",
     "test/door.test.ts", "a tunnel request gets an answer"),
    ("C12", "the machine side refuses \"direct\"", S + "egress-machine-main.ts",
     "parseUpstream(process.env.EGRESS_UPSTREAM_PROXY, { allowDirect: false })!", "(parseUpstream(process.env.EGRESS_UPSTREAM_PROXY, { allowDirect: true }) ?? new URL(\"http://127.0.0.1:9\"))",
     "test/door.test.ts", "machine side refuses to start"),
    ("C13", "the gateway forwarder only to a loopback address", S + "forwarder.ts",
     r'const m = /^(\[::1\]|127\.0\.0\.1|localhost|::1):(\d{1,5})$/.exec((value ?? "").trim());',
     r'const m = /^([a-z0-9.\[\]:]+):(\d{1,5})$/.exec((value ?? "").trim());',
     "test/door.test.ts", "routes and the gateway's target"),
    ("C14", "each socket mode 600", S + "forwarder.ts",
     "      chmodSync(path, 0o600);\n", "",
     "test/door.test.ts", "mode 600"),
    ("C15", "a socket path too long refused", S + "forwarder.ts",
     '  if (Buffer.byteLength(path) > 107) return Promise.reject(new Error(`A socket\'s path must be at most 107 bytes: ${path}`));\n', "",
     "test/door.test.ts", "mode 600"),
    ("C16", "the door's routes only to sockets under /sock/", S + "forwarder.ts",
     r'const m = /^(\d{1,5})=(\/sock\/[a-z0-9-]{1,40}\.sock)$/.exec(r);', r'const m = /^(\d{1,5})=(\/.+)$/.exec(r);',
     "test/door.test.ts", "routes and the gateway's target"),
    ("C17", "vendor/ among the protected paths", "builder/src/engine/scripted.ts",
     '  ".dockerignore",\n  "vendor",\n', '  ".dockerignore",\n',
     "test/scripted-engine.test.ts", "every protected path"),
    ("C18", "install scripts off in the image build", "templates/next/Dockerfile",
     "RUN npm ci --ignore-scripts --no-fund --no-audit", "RUN npm ci --no-fund --no-audit",
     "test/sandbox.test.ts", "image build"),
    ("C19", "no network for the guard check and next build", "templates/next/Dockerfile",
     "RUN --network=none DATABASE_URL=", "RUN DATABASE_URL=",
     "test/sandbox.test.ts", "image build"),
    ("C20", "no certificate for the machine side", S + "manager.ts",
     '          GATEWAY_TARGET: gateway,\n', '          GATEWAY_TARGET: gateway,\n          NODE_EXTRA_CA_CERTS: "/certs/session-ca.crt",\n',
     "test/sandbox.test.ts", "each service's networks"),
    ("C21", "the session proxy given by host and port only", S + "manager.ts",
     '  return u.protocol === "http:" && u.hostname && u.port ? `http://${u.host}` : url;', "  return url;",
     "test/sandbox.test.ts", "the door on `out`"),
    ("C22", "the build's npm through the machine side's loopback port, no certificate", S + "manager.ts",
     "args: (dev ? { HTTPS_PROXY: buildProxy, HTTP_PROXY: buildProxy } : {})", 'args: (dev ? { HTTPS_PROXY: buildProxy, HTTP_PROXY: buildProxy, NODE_EXTRA_CA_CERTS: "/certs/session-ca.crt" } : {})',
     "test/sandbox.test.ts", "createSandbox makes the socket folder"),
    ("C23", "every attempt not on the list must get no answer", S + "isolation.ts",
     '      rows.push({ id: a.id, target: a.target, expected: NO_ANSWER, actual, pass: !gotAnswer(a.result) && a.result !== "error" });',
     '      rows.push({ id: a.id, target: a.target, expected: NO_ANSWER, actual, pass: true });',
     "test/isolation.test.ts", "comparing a container's attempts"),
    ("C24", "who answered compared, not only that something did", S + "isolation.ts",
     "      const pass = e.result.test(a.result) && (!e.detail || e.detail.test(a.detail)) && (!e.detailNot || !e.detailNot.test(a.detail));",
     "      const pass = e.result.test(a.result);",
     "test/isolation.test.ts", "who answered"),
    ("C25", "the positive control's address matched exactly", S + "isolation.ts",
     "  return [{ ids: new RegExp(`^M${at}:${ctx.canaryPort}$`),", "  return [{ ids: new RegExp(`^M${ctx.bridgeAddress}:${ctx.canaryPort}`),",
     "test/isolation.test.ts", "positive controls must get their answers"),
    ("C26", "askApp takes only http://<service>:<port>/<path>", S + "manager.ts",
     r"if (!/^http:\/\/[a-z][a-z0-9-]{0,62}:\d{1,5}\/[A-Za-z0-9/_.-]*$/.test(url))", r"if (!/^https?:\/\//.test(url))",
     "test/sandbox.test.ts", "askApp"),
    ("C27", "package 2.2's engine option on `out` only", S + "manager.ts",
     '          networks: ["out"],\n          environment: {\n            HTTPS_PROXY:', '          networks: ["out", "data"],\n          environment: {\n            HTTPS_PROXY:',
     "test/sandbox.test.ts", "engine option"),
    ("C28", "the development profile's gateway only on the loopback address", S + "manager.ts",
     '  if (!["127.0.0.1", "localhost", "::1"].includes(host) || !u.port)', "  if (!u.port)",
     "test/sandbox.test.ts", "refused without the session proxy"),
    ("C29", "up refuses the check service", S + "manager.ts",
     '    if (services.includes("check")) throw new Error("The check service asks the app one question at a time, through askApp; it is not started with up.");\n', "",
     "test/sandbox.test.ts", "askApp"),
    ("C30", "the check container on the front network only", S + "manager.ts",
     '    user: "node",\n    entrypoint: [],\n    networks: ["front"],\n  };\n}', '    user: "node",\n    entrypoint: [],\n    networks: ["front", "data"],\n  };\n}',
     "test/sandbox.test.ts", "each service's networks"),
    ("C31", "the door on the out network only", S + "manager.ts",
     '        volumes: [bindMount(spec.builderDir, "/builder", true), bindMount(socketDir(spec.dir), "/sock", true)],\n        networks: ["out"],',
     '        volumes: [bindMount(spec.builderDir, "/builder", true), bindMount(socketDir(spec.dir), "/sock", true)],\n        networks: ["out", "data"],',
     "test/sandbox.test.ts", "each service's networks"),
    ("C32", "no port of the database published on the machine", S + "manager.ts",
     '    volumes: ["dbdata:/var/lib/postgresql/data"],\n    networks: ["data"],', '    volumes: ["dbdata:/var/lib/postgresql/data"],\n    ports: ["127.0.0.1:5562:5432"],\n    networks: ["data"],',
     "test/sandbox.test.ts", "each service's networks"),
    ("C33", "the probe's group M: every machine address crossed with every listening port", "builder/scripts/isolation-probe.mjs",
     "  if (s.machineAddresses.length) {", "  if (false) {",
     "test/isolation.test.ts", "group M"),
]

env = dict(os.environ, TMPDIR=TMP, NO_COLOR="1", BUILDER_TEST_DATABASE_URL="postgres:///builder_test_m06c?host=/var/run/postgresql")
with open(out, "a") as f:
    f.write(f"# Package 0.6c controls, {datetime.datetime.utcnow().isoformat()}Z, on a copy of commit {commit} made with git archive.\n")
    f.write("# Each control removes one safeguard, runs the test that covers it (expected: FAIL), then restores the file and runs it again (expected: pass).\n\n")
    for cid, what, path, old, new, test, name in CONTROLS:
        if only and cid not in only:
            continue
        full = os.path.join(copy, path)
        orig = open(full).read()
        if orig.count(old) != 1:
            f.write(f"## {cid} NOT RUN: the text to change was found {orig.count(old)} times in {path}\n\n")
            continue
        open(full, "w").write(orig.replace(old, new))
        r = subprocess.run(["npx", "vitest", "run", test, "-t", name], cwd=os.path.join(copy, "builder"), env=env, capture_output=True, text=True, timeout=600)
        open(full, "w").write(orig)
        r2 = subprocess.run(["npx", "vitest", "run", test, "-t", name], cwd=os.path.join(copy, "builder"), env=env, capture_output=True, text=True, timeout=600)
        txt = r.stdout + r.stderr
        tail = [l for l in txt.splitlines() if l.strip().startswith(("Test Files", "Tests ", "FAIL", "×", "AssertionError", "Error:", "- Expected", "+ Received"))][:14]
        t2 = [l for l in (r2.stdout + r2.stderr).splitlines() if l.strip().startswith(("Test Files", "Tests "))]
        verdict = "FAILED with the safeguard removed, as it should" if r.returncode != 0 else "PASSED WITH THE SAFEGUARD REMOVED (control did not catch it)"
        f.write(f"## {cid}: {what}\nRemoved in {path}; test {test} -t \"{name}\"\nWith the safeguard removed: exit {r.returncode}: {verdict}\n")
        f.write("\n".join("    " + l.strip() for l in tail) + "\n")
        f.write(f"Restored: exit {r2.returncode}: " + " / ".join(l.strip() for l in t2) + "\n")
        # A control that removes a refusal can let its test start a container (C26, C29): whatever the run left of the
        # test's own Compose project (builder_p_test) is listed and removed here.
        lbl = "label=com.docker.compose.project=builder_p_test"
        cs = subprocess.run(["docker", "ps", "-aq", "--filter", lbl], capture_output=True, text=True).stdout.split()
        ns = subprocess.run(["docker", "network", "ls", "-q", "--filter", lbl], capture_output=True, text=True).stdout.split()
        names = subprocess.run(["docker", "ps", "-a", "--filter", lbl, "--format", "{{.Names}}"], capture_output=True, text=True).stdout.split() + \
                subprocess.run(["docker", "network", "ls", "--filter", lbl, "--format", "{{.Name}}"], capture_output=True, text=True).stdout.split()
        for c in cs: subprocess.run(["docker", "rm", "-f", c], capture_output=True)
        for n in ns: subprocess.run(["docker", "network", "rm", n], capture_output=True)
        f.write(f"Left by the test run and removed: {', '.join(names) or 'nothing'}\n\n")
        f.flush()
print("done")
