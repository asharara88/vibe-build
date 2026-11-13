/**
 * Package J3, measurement M6 (final design, section 6): the preview front's process. No container.
 *
 *   flock <scratchpad>/live-tests.lock npx tsx scripts/measure-j3-front.ts <out folder>
 *
 * It starts the live preview as the interface does (preview.ts), on 127.0.0.1:4041, and reads, from /proc: the
 * front's user, the names in its environment (never the values) and its open files. Then, as the front's user, a
 * short program (Node's own modules) tries what the front must not be able to: Docker's socket, a data folder like the
 * interface's (mode 700, root's), a project's door socket folder like 0.6c's (user 1000, mode 750; the socket 600),
 * PostgreSQL's socket (a sign-in as root, which peer authentication judges by the user asking), and the builder's own
 * files. Last, every port listening on 127.0.0.1 is tried as that user and listed: the front can reach them (gap 149).
 * Needs root (it gives folders to other users). Everything it makes is removed. Made-up data only.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, chownSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join, resolve } from "node:path";
import { createForwarder, listenOnSocket } from "../src/sandbox/forwarder.js";
import { frontTexts } from "../src/web/pages.js";
import { DEFAULT_PREVIEW_UID, LivePreview } from "../src/web/preview.js";

const builderDir = resolve(import.meta.dirname, "..");
const out: string[] = [];
const say = (s = "") => {
  out.push(s);
  console.log(s);
};

/** A program run as the front's user: tries one thing, prints one JSON line. */
const PROBE = `
const [what, target] = process.argv.slice(1);
const net = require("net"), fs = require("fs");
const done = (o) => { console.log(JSON.stringify(o)); process.exit(0); };
if (what === "connect") {
  const s = net.connect(target);
  s.setTimeout(3000, () => done({ result: "timed out" }));
  s.on("connect", () => {
    if (target.endsWith(".s.PGSQL.5432")) {
      const body = Buffer.concat([Buffer.alloc(8), Buffer.from("user\\0root\\0database\\0postgres\\0\\0")]);
      body.writeInt32BE(body.length, 0); body.writeInt32BE(196608, 4);
      s.write(body);
      s.once("data", (d) => {
        const kind = String.fromCharCode(d[0]);
        const text = d.toString("latin1").replace(/[^\\x20-\\x7e]+/g, " ").match(/M([^\\0]*?) (F|L|R)/);
        done({ result: kind === "E" ? "connected; the server refused the sign-in" : "connected; the server answered " + kind, detail: text ? text[1].slice(0, 120) : "" });
      });
    } else { s.destroy(); done({ result: "connected" }); }
  });
  s.on("error", (e) => done({ result: "refused", code: e.code }));
} else if (what === "pgtcp") {
  const s = net.connect(5432, "127.0.0.1");
  s.setTimeout(3000, () => done({ result: "timed out" }));
  s.on("connect", () => {
    const body = Buffer.concat([Buffer.alloc(8), Buffer.from("user\\0" + target + "\\0database\\0postgres\\0\\0")]);
    body.writeInt32BE(body.length, 0); body.writeInt32BE(196608, 4);
    s.write(body);
    s.once("data", (d) => {
      const kind = String.fromCharCode(d[0]);
      const auth = kind === "R" ? d.readInt32BE(5) : -1;
      const text = d.toString("latin1").replace(/[^\\x20-\\x7e]+/g, " ").match(/M([^\\0]*?) (F|L|R)/);
      done({ result: kind === "E" ? "the server refused the sign-in" : kind === "R" && auth === 0 ? "SIGNED IN with no password (trust)" : kind === "R" ? "the server asks for a password (method " + auth + ")" : "the server answered " + kind, detail: text ? text[1].slice(0, 120) : "" });
    });
  });
  s.on("error", (e) => done({ result: "refused", code: e.code }));
} else if (what === "tcp") {
  const [h, p] = target.split(":");
  const s = net.connect(Number(p), h);
  s.setTimeout(2000, () => done({ result: "timed out" }));
  s.on("connect", () => { s.destroy(); done({ result: "connected" }); });
  s.on("error", (e) => done({ result: "refused", code: e.code }));
} else if (what === "list") {
  try { done({ result: "listed", detail: String(fs.readdirSync(target).length) + " entries" }); } catch (e) { done({ result: "refused", code: e.code }); }
} else if (what === "read") {
  try { fs.readFileSync(target); done({ result: "read" }); } catch (e) { done({ result: "refused", code: e.code }); }
}`;

function asFront(uid: number, what: string, target: string): { result: string; code?: string; detail?: string } {
  const r = spawnSync(process.execPath, ["-e", PROBE, what, target], { uid, gid: uid, env: {}, cwd: "/", timeout: 10_000, encoding: "utf8" });
  try {
    return JSON.parse(r.stdout.trim().split("\n").pop() ?? "") as { result: string; code?: string };
  } catch {
    return { result: `no answer (exit ${r.status}): ${(r.stderr ?? "").trim().split("\n").pop() ?? ""}` };
  }
}

async function main(): Promise<number> {
  const outDir = resolve(process.argv[2] ?? join(builderDir, "..", "evidence", "2026-11-13-journey-j3", "m6"));
  mkdirSync(outDir, { recursive: true });
  if (process.getuid?.() !== 0) {
    say("M6 needs root: it gives folders to other users, as the interface does. Not run.");
    return 2;
  }
  let code = 0;
  const made: string[] = [];
  const preview = new LivePreview({ port: 4041, texts: frontTexts(), openStream: () => null, onEvent: async () => undefined });
  let door: net.Server | null = null;
  try {
    await preview.start();
    const pid = preview.frontPid!;
    say(`M6, ${new Date().toISOString()}: the preview front's process (pid ${pid}), started as the interface starts it, on 127.0.0.1:4041.`);
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const uids = /^Uid:\s+(.*)$/m.exec(status)![1]!.trim().split(/\s+/);
    const gids = /^Gid:\s+(.*)$/m.exec(status)![1]!.trim().split(/\s+/);
    const groups = /^Groups:[ \t]*(.*)$/m.exec(status)![1]!.trim();
    const capEff = /^CapEff:\s+(.*)$/m.exec(status)![1]!.trim();
    say(`  Its user (real, effective, saved, file system): ${uids.join(", ")}; its group: ${gids.join(", ")}; supplementary groups: ${groups || "none"}; effective capabilities: ${capEff}.`);
    if (uids.some((u) => u !== String(DEFAULT_PREVIEW_UID)) || capEff !== "0000000000000000" || groups !== "") code = 1;
    const env = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").filter(Boolean).map((l) => l.split("=")[0]!);
    say(`  The names in its environment (its starting environment, /proc/${pid}/environ; values not read): ${env.sort().join(", ")}. NODE_CHANNEL_FD and NODE_CHANNEL_SERIALIZATION_MODE are Node's own, for the fork channel.`);
    const extra = env.filter((n) => !["BUILDER_PREVIEW_PORT", "BUILDER_PREVIEW_PUMP", "NODE_CHANNEL_FD", "NODE_CHANNEL_SERIALIZATION_MODE"].includes(n));
    if (extra.length) code = 1;
    const fds = readdirSync(`/proc/${pid}/fd`).map((fd) => {
      let target = "?";
      try {
        target = readlinkSync(`/proc/${pid}/fd/${fd}`);
      } catch {}
      return `${fd} -> ${target.replace(/^socket:\[\d+\]$/, "socket").replace(/^pipe:\[\d+\]$/, "pipe").replace(/^anon_inode:.*$/, "anon_inode")}`;
    });
    say(`  Its open files (/proc/${pid}/fd; socket and pipe numbers dropped): ${fds.join("; ")}.`);
    const cwd = readlinkSync(`/proc/${pid}/cwd`);
    say(`  Its working folder: ${cwd.replace(/bpv-[A-Za-z0-9]+/, "bpv-<random>")} (the interface's short folder: root's, mode 711; the front's two files, mode 444).`);

    say("\nAs the front's user, each of these is tried:");
    const dataDir = mkdtempSync("/tmp/j3m6-data-");
    made.push(dataDir);
    chmodSync(dataDir, 0o700);
    writeFileSync(join(dataDir, "made-up-ui-password.digest"), "made-up\n", { mode: 0o600 });
    const doorDir = mkdtempSync("/tmp/j3m6-sock-");
    made.push(doorDir);
    chmodSync(doorDir, 0o750);
    chownSync(doorDir, 1000, 1000);
    door = createForwarder(join(doorDir, "egress.sock"), { host: "127.0.0.1", port: 9 }, () => undefined);
    await listenOnSocket(door, join(doorDir, "egress.sock"));
    chownSync(join(doorDir, "egress.sock"), 1000, 1000);
    const tries: Array<[string, string, string, (r: { result: string }) => boolean]> = [
      ["Docker's socket", "connect", "/var/run/docker.sock", (r) => r.result === "refused"],
      ["a data folder like the interface's (root's, mode 700): list it", "list", dataDir, (r) => r.result === "refused"],
      ["a file in it", "read", join(dataDir, "made-up-ui-password.digest"), (r) => r.result === "refused"],
      ["a door socket folder like 0.6c's (user 1000, mode 750): its socket", "connect", join(doorDir, "egress.sock"), (r) => r.result === "refused"],
      ["PostgreSQL's socket: a sign-in as root (peer authentication)", "connect", "/var/run/postgresql/.s.PGSQL.5432", (r) => r.result !== "connected; the server answered R"],
      ["PostgreSQL over TCP on 127.0.0.1:5432: a sign-in as root", "pgtcp", "root", (r) => !r.result.startsWith("SIGNED IN")],
      ["PostgreSQL over TCP on 127.0.0.1:5432: a sign-in as postgres", "pgtcp", "postgres", (r) => !r.result.startsWith("SIGNED IN")],
      ["the builder's own files (the interface's source)", "read", join(builderDir, "src", "web", "main.ts"), (r) => r.result === "refused"],
      ["the builder's package file", "read", join(builderDir, "package.json"), (r) => r.result === "refused"],
    ];
    for (const [label, what, target, ok] of tries) {
      const r = asFront(DEFAULT_PREVIEW_UID, what, target);
      const pass = ok(r);
      if (!pass) code = 1;
      say(`  ${pass ? "PASS" : "FAIL"}: ${label}: ${r.result}${"code" in r && r.code ? ` (${r.code})` : ""}${"detail" in r && r.detail ? `: "${r.detail}"` : ""}.`);
    }

    say("\nEvery port listening on 127.0.0.1 (and on every address), tried as the front's user (gap 149: these it can reach):");
    const listeners = [...new Set(
      readFileSync("/proc/net/tcp", "utf8")
        .split("\n")
        .slice(1)
        .map((l) => l.trim().split(/\s+/))
        .filter((c) => c[3] === "0A" && (c[1]!.startsWith("0100007F:") || c[1]!.startsWith("00000000:")))
        .map((c) => Number.parseInt(c[1]!.split(":")[1]!, 16)),
    )].sort((a, b) => a - b);
    for (const p of listeners) {
      const r = asFront(DEFAULT_PREVIEW_UID, "tcp", `127.0.0.1:${p}`);
      say(`  127.0.0.1:${p}: ${r.result}${p === 4041 ? " (the front itself)" : p === 4020 ? " (the owner's interface: its sign-in still asks for the password)" : p === 5432 ? " (PostgreSQL over TCP)" : ""}`);
    }
    say(`\nRESULT: ${code === 0 ? "every check passed" : "NOT every check passed"}.`);
  } catch (err) {
    say(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    code = 1;
  } finally {
    await preview.stop();
    await new Promise<void>((r) => (door ? door.close(() => r()) : r()));
    for (const d of made) rmSync(d, { recursive: true, force: true });
    writeFileSync(join(outDir, "m6-front.txt"), out.join("\n").replaceAll(builderDir, "<builder>") + "\n");
  }
  return code;
}

process.exitCode = await main();
