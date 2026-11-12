// The scripted engine's applier (build plan package 2.1).
//
// This is the build engine. It runs ONLY inside the project's engine container (hard rule 9), where
// the workspace is at /workspace and the change sets are at /engine, read-only. It refuses to start
// anywhere else. It calls no model and uses nothing but Node's own modules.
//
//   node /engine/apply.mjs --example example-1 --step 01-data --protected '["src/auth.ts", ...]'
//                          [--max-writes N] [--delay-ms N]
//
// It applies one fixed change set: the files under /engine/<example>/<step>/files, as its
// manifest.json lists them, each either added (the file must not exist) or replaced (the file must
// have the fingerprint the manifest names). Every entry is checked before anything is written, so a
// change that is refused writes nothing. It refuses a path outside the workspace, a protected path,
// a path through a symbolic link, and a fingerprint that does not match.
//
// It prints one JSON line per operation on stdout:
//   {"kind":"start", ...}  {"kind":"write","op","path","sha256"}  {"kind":"done","written"}
//   {"kind":"refused","path","reason"}  (exit 2)   {"kind":"limit","written","needed","reason"}  (exit 3)
//   {"kind":"error","reason"}  (exit 1)
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE = "/workspace";
const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

class Stop extends Error {
  constructor(line, code) {
    super(line.reason ?? line.kind);
    this.line = line;
    this.code = code;
  }
}

const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const refuse = (path, reason) => {
  throw new Stop({ kind: "refused", path, reason }, 2);
};

/** A plain path inside the workspace: relative, already normal, no "." or ".." part, no backslash. */
function pathProblem(p) {
  if (typeof p !== "string" || p === "" || p.includes("\0") || p.includes("\\")) return "the path is not a plain relative path";
  if (p.startsWith("/")) return "the path is outside the workspace";
  if (posix.normalize(p) !== p || p.split("/").some((s) => s === "" || s === "." || s === "..")) return "the path is outside the workspace";
  return null;
}

/** Nothing on the way to the file may be a symbolic link, and what exists on the way must be a folder. */
function linkProblem(p) {
  const parts = p.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const st = lstatSync(posix.join(WORKSPACE, ...parts.slice(0, i)), { throwIfNoEntry: false });
    if (!st) return null;
    if (st.isSymbolicLink()) return "the path goes through a symbolic link";
    if (i < parts.length && !st.isDirectory()) return "a part of the path is not a folder";
    if (i === parts.length && !st.isFile()) return "the path is not a plain file";
  }
  return null;
}

async function main() {
  // Hard rule 9: only inside a container, with the workspace mounted where the engine service puts it.
  if (!existsSync("/.dockerenv") || !existsSync(WORKSPACE) || HERE !== "/engine") {
    throw new Stop({ kind: "error", reason: "apply.mjs runs only inside the project's engine container" }, 1);
  }
  const example = arg("example");
  const step = arg("step");
  if (!example || !NAME.test(example) || !step || !NAME.test(step)) throw new Stop({ kind: "error", reason: "the example and the step must be given by name" }, 1);
  let protectedPaths;
  try {
    protectedPaths = JSON.parse(arg("protected") ?? "[]");
    if (!Array.isArray(protectedPaths) || !protectedPaths.every((p) => typeof p === "string" && pathProblem(p) === null)) throw new Error();
  } catch {
    throw new Stop({ kind: "error", reason: "the protected paths must be a list of plain relative paths" }, 1);
  }
  const maxWrites = arg("max-writes") === undefined ? Infinity : Number(arg("max-writes"));
  const delayMs = arg("delay-ms") === undefined ? 0 : Number(arg("delay-ms"));
  if (!(maxWrites === Infinity || (Number.isInteger(maxWrites) && maxWrites >= 0)) || !(Number.isInteger(delayMs) && delayMs >= 0 && delayMs <= 600_000)) {
    throw new Stop({ kind: "error", reason: "the turn limit and the pause must be whole numbers" }, 1);
  }
  const isProtected = (p) => protectedPaths.some((q) => p === q || p.startsWith(q + "/") || q.startsWith(p + "/"));

  const dir = posix.join(HERE, example, step);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(posix.join(dir, "manifest.json"), "utf8"));
  } catch {
    throw new Stop({ kind: "error", reason: `there is no fixed change ${example}/${step}` }, 1);
  }
  if (manifest.example !== example || manifest.step !== step || !Array.isArray(manifest.files)) {
    throw new Stop({ kind: "error", reason: `the manifest of ${example}/${step} does not describe that change` }, 1);
  }
  emit({ kind: "start", example, step, files: manifest.files.length, label: manifest.label ?? "" });

  // Check every entry before writing anything.
  const plan = [];
  for (const f of manifest.files) {
    const bad = pathProblem(f.path);
    if (bad) refuse(String(f.path), bad);
    if (isProtected(f.path)) refuse(f.path, "the path is protected: the engine must not change it");
    const link = linkProblem(f.path);
    if (link) refuse(f.path, link);
    let content;
    try {
      content = readFileSync(posix.join(dir, "files", f.path));
    } catch {
      refuse(f.path, "the change set has no copy of this file");
    }
    if (sha256(content) !== f.sha256) refuse(f.path, "the change set's copy of this file is not the one its manifest names");
    const target = posix.join(WORKSPACE, f.path);
    const exists = existsSync(target);
    if (f.op === "add") {
      if (exists) refuse(f.path, "the file already exists, and this change only adds it");
    } else if (f.op === "replace") {
      if (!exists) refuse(f.path, "the file to replace does not exist");
      if (sha256(readFileSync(target)) !== f.expectSha256) refuse(f.path, "the file is not the one this change was written for (its fingerprint differs)");
    } else {
      refuse(f.path, `"${f.op}" is not an operation this engine knows`);
    }
    plan.push({ f, target, content });
  }

  let written = 0;
  for (const { f, target, content } of plan) {
    if (written >= maxWrites) throw new Stop({ kind: "limit", written, needed: plan.length, reason: "turn limit reached" }, 3);
    if (delayMs > 0) await pause(delayMs);
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    } catch (err) {
      refuse(f.path, `the system refused the write (${err && err.code ? err.code : "unknown reason"})`);
    }
    written++;
    emit({ kind: "write", op: f.op, path: f.path, sha256: f.sha256 });
  }
  emit({ kind: "done", written });
}

try {
  await main();
} catch (err) {
  if (err instanceof Stop) {
    emit(err.line);
    process.exitCode = err.code;
  } else {
    emit({ kind: "error", reason: `the applier failed: ${err && err.message ? err.message : String(err)}` });
    process.exitCode = 1;
  }
}
