/**
 * The checks on each export (package 3.2, design section 4, "The checks on each export"), in the export job, before
 * the export is recorded or offered. Items 1 and 2 (the archive's paths; the fixed files and S29's names) run on the
 * machine, reading only, in the exporter (src/orchestrator/export.ts). Items 3 to 7 run here, with Docker, through
 * one method of the journey's injected sandboxes (`Sandboxes.checkExport`, example-1-adapter.ts), so that the fast
 * tests can stand in for them:
 *
 * 3. The archive is unpacked into a fresh folder in the project's exports folder, and its run and tools stages are
 *    built through the sandbox's own build path (its egress door), tagged `builder_<id>-exportcheck-run:latest` and
 *    `builder_<id>-exportcheck-tools:latest` (manager.ts, `exportCheckImageNames`). These builds also fill npm's
 *    cache mount (the template's Dockerfile). Both images are removed by exact name before this returns, and are on
 *    the project's removal list (manager.ts, `projectImageNames`).
 * 4. What Compose reads (safeguard S30): `docker compose config --format json` in the unpacked folder, with only PATH
 *    and HOME set, equals the same command run on the template's compose.yaml alone in a scratch folder of the same
 *    name, once the two folders' paths are set aside.
 * 5. In the run image (S17, under question 26 (a), "checked under this reading", never called met): every named
 *    package in the whole image is listed. Any of the 14 development-only packages under /app refuses the export; each
 *    copy outside /app is listed, and any but the base image's own npm copy of spdx-exceptions 2.5.0 refuses it.
 * 6. Also in the run image (S18): /app/THIRD-PARTY-NOTICES.md is there, byte-equal to the copy's.
 * 7. In the tools image: the same listing, recorded; then the template's own licence check (S19), as its two commands
 *    (`node scripts/check-lock.mjs && node_modules/.bin/tsx scripts/licence/check.ts`; the image has no bash, so
 *    `npm run check:licences` cannot run there: gap N7). It must exit 0, and its output must hold "RESULT: PASSED"
 *    twice and "Notices file THIRD-PARTY-NOTICES.md is up to date."
 *
 * Every container started here has the sandbox's hardening (`HARDENING`: every capability dropped, no new privileges,
 * 256 processes, 1 GB, a read-only root), a /tmp of 64 MB in memory with no programs run from it, no network, and an
 * unprivileged user (`nobody` in the run image, `node` in the tools image); each is named exactly and removed with
 * `--rm`, or by that name if it is left.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { sha256 } from "../acceptance/store.js";
import { dockerEnv, exportCheckImageNames, HARDENING, sandbox, type Sandbox } from "../sandbox/manager.js";

const run = promisify(execFile);

/** The builder's own copy of the house template (its files are what an export's fixed files must equal: S13). */
export const TEMPLATE_DIR = resolve(import.meta.dirname, "..", "..", "..", "templates", "next");

/** One check of an export, as journey.export.written records it and the export screen shows it. */
export interface ExportCheck {
  id: string;
  passed: boolean;
  /** One plain sentence, in English, of what was checked and found. */
  summary: string;
  [detail: string]: unknown;
}

/** The archive as the exporter packed it, before it is moved into place (design section 4, item 3). */
export interface PackedExport {
  /** The packed archive, under its temporary name in the project's exports folder. */
  path: string;
  sha256: string;
  bytes: number;
  /** The archive's one top folder: the project's id. */
  top: string;
  /** A fresh, empty folder in the project's exports folder, for the check to unpack into; removed by the exporter. */
  unpackDir: string;
}

/** Items 1 and 2, on the machine (export.ts). */
export const MACHINE_CHECK_IDS = ["archive_contents", "fixed_files"] as const;
/** Items 3 to 7, with Docker (this module), in the order they are recorded. */
export const DOCKER_CHECK_IDS = ["images_built", "compose_config", "run_image_packages", "run_image_notices", "tools_image_packages", "licence_check"] as const;

/**
 * The development-only names of the licence approval of 12 Nov 2026 (DEC:45), as the template's rule names them: each
 * exception for "development" use, with its build packages. Here: lightningcss and its eleven build packages,
 * spdx-exceptions and spdx-ranges (14 names).
 */
export function devOnlyNames(templateDir = TEMPLATE_DIR): string[] {
  const rule = JSON.parse(readFileSync(join(templateDir, "licence-rule.json"), "utf8")) as { exceptions?: Array<{ name?: unknown; use?: unknown; build_packages?: unknown }> };
  const names: string[] = [];
  for (const e of rule.exceptions ?? []) {
    if (e.use !== "development" || typeof e.name !== "string") continue;
    names.push(e.name);
    if (Array.isArray(e.build_packages)) for (const b of e.build_packages) if (typeof b === "string") names.push(b);
  }
  return names;
}

/** A package as a listing finds it: the folder of a package.json that names one. */
export interface PackageCopy {
  path: string;
  name: string;
  version: string;
}

/** The one copy of a development-only package allowed outside /app of the run image: inside the base image's own npm (gap N5). */
export const KNOWN_BASE_COPY: PackageCopy = { path: "/usr/local/lib/node_modules/npm/node_modules/spdx-exceptions", name: "spdx-exceptions", version: "2.5.0" };

/** How the run image's listing is reported until the owner answers question 26. */
export const READING_26A =
  "checked under this reading (question 26 (a)): none of the 14 development-only packages under /app of the image the app runs from, and every other copy listed; the licence condition is not called met";

const devCopies = (copies: PackageCopy[], devNames: readonly string[]) => {
  const dev = new Set(devNames);
  return copies.filter((c) => dev.has(c.name)).sort((a, b) => a.path.localeCompare(b.path));
};

/** Item 5 (S17), under question 26 (a): the verdict on the run image's listing. */
export function runImageVerdict(copies: PackageCopy[], devNames: readonly string[]): { passed: boolean; problems: string[]; listed: PackageCopy[]; reading: string; summary: string } {
  const listed = devCopies(copies, devNames);
  const problems: string[] = [];
  for (const c of listed) {
    if (c.path === "/app" || c.path.startsWith("/app/")) problems.push(`${c.name} ${c.version} at ${c.path}, under /app`);
    else if (!(c.path === KNOWN_BASE_COPY.path && c.name === KNOWN_BASE_COPY.name && c.version === KNOWN_BASE_COPY.version))
      problems.push(`${c.name} ${c.version} at ${c.path}, outside /app but not the base image's own npm copy that is allowed`);
  }
  const where = listed.length ? listed.map((c) => `${c.name} ${c.version} at ${c.path}`).join("; ") : "none";
  const summary = problems.length
    ? `The image the app runs from holds development-only packages it may not: ${problems.join("; ")}.`
    : `The image the app runs from: none of the 14 development-only packages under /app; copies elsewhere in it: ${where}. ${READING_26A[0]!.toUpperCase()}${READING_26A.slice(1)}.`;
  return { passed: problems.length === 0, problems, listed, reading: READING_26A, summary };
}

/** Item 7's listing: every development-only package in the tools image, recorded (a development stage holds them). */
export function toolsImageVerdict(copies: PackageCopy[], devNames: readonly string[]): { passed: true; listed: PackageCopy[]; reading: string; summary: string } {
  const listed = devCopies(copies, devNames);
  return {
    passed: true,
    listed,
    reading: READING_26A,
    summary: `The tools image, which an exported copy builds and runs at each start as its setup service, holds ${listed.length} of the 14 development-only packages: ${listed.map((c) => `${c.name} ${c.version} at ${c.path}`).join("; ") || "none"}.`,
  };
}

/** Item 6 (S18): the notices file in the run image, byte-equal to the copy's. */
export function noticesVerdict(inImage: { sha256: string; bytes: number } | null, copySha256: string): { passed: boolean; summary: string } {
  if (!inImage) return { passed: false, summary: "The image the app runs from has no /app/THIRD-PARTY-NOTICES.md." };
  if (inImage.sha256 !== copySha256) return { passed: false, summary: `The image the app runs from holds /app/THIRD-PARTY-NOTICES.md with the SHA-256 ${inImage.sha256}, not the copy's ${copySha256}.` };
  return { passed: true, summary: `The image the app runs from holds /app/THIRD-PARTY-NOTICES.md, ${inImage.bytes} bytes, byte-equal to the copy's (SHA-256 ${copySha256}).` };
}

/** Item 7 (S19): the template's licence check passed only on exit code 0, "RESULT: PASSED" twice and the notices line. */
export function licenceCheckVerdict(code: number | null, output: string): { passed: boolean; summary: string } {
  const results = output.split("\n").filter((l) => l.trim() === "RESULT: PASSED").length;
  const notices = output.includes("Notices file THIRD-PARTY-NOTICES.md is up to date.");
  const passed = code === 0 && results === 2 && notices;
  return {
    passed,
    summary: passed
      ? 'The template\'s own licence check passed from the copy, in its tools image, with no network: exit code 0, "RESULT: PASSED" twice, and "Notices file THIRD-PARTY-NOTICES.md is up to date."'
      : `The template's own licence check did not pass from the copy: exit code ${code ?? "none"}, "RESULT: PASSED" ${results} times, the notices line ${notices ? "there" : "missing"}.`,
  };
}

/** Where two JSON values differ, as dotted paths (at most `limit`). */
function differences(a: unknown, b: unknown, at: string, out: string[], limit: number): void {
  if (out.length >= limit) return;
  if (a === b) return;
  const isObj = (v: unknown) => typeof v === "object" && v !== null;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) differences(a[i], b[i], `${at}[${i}]`, out, limit);
    return;
  }
  if (isObj(a) && isObj(b) && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a as object), ...Object.keys(b as object)])].sort();
    for (const k of keys) differences((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], at ? `${at}.${k}` : k, out, limit);
    return;
  }
  out.push(at || "(the whole document)");
}

/**
 * Item 4 (S30): Compose's reading of the copy against its reading of the template's compose.yaml alone, each with its
 * folder's path replaced by one placeholder (the two folders have the same name, so Compose names both projects alike).
 */
export function composeConfigVerdict(copyJson: string, templateJson: string, copyDir: string | string[], templateDir: string | string[]): { passed: boolean; summary: string; differences: string[] } {
  const setAside = (text: string, dirs: string | string[]) => {
    let out = text;
    for (const d of [dirs].flat().sort((x, y) => y.length - x.length)) out = out.split(d).join("<folder>");
    return out;
  };
  let a: unknown;
  let b: unknown;
  try {
    a = JSON.parse(setAside(copyJson, copyDir));
    b = JSON.parse(setAside(templateJson, templateDir));
  } catch (err) {
    return { passed: false, summary: `Compose's reading could not be read as JSON (${(err as Error).message}).`, differences: [] };
  }
  const diffs: string[] = [];
  differences(a, b, "", diffs, 20);
  return diffs.length
    ? { passed: false, summary: `What Docker Compose reads from the copy differs from what it reads from the template's compose file alone, at ${diffs.join(", ")}.`, differences: diffs }
    : { passed: true, summary: "What Docker Compose reads from the unpacked copy, with only PATH and HOME set, equals what it reads from the template's compose.yaml alone.", differences: [] };
}

/** The `docker run` arguments of a check's container: the sandbox's hardening, a small /tmp, no network, an unprivileged user. */
export function checkContainerArgs(c: { name: string; image: string; user: string; entrypoint?: string; workdir?: string; cmd: string[] }): string[] {
  return [
    "run",
    "--rm",
    "--name",
    c.name,
    ...HARDENING.cap_drop.flatMap((x) => ["--cap-drop", x]),
    ...HARDENING.security_opt.flatMap((x) => ["--security-opt", x]),
    "--pids-limit",
    String(HARDENING.pids_limit),
    "--memory",
    HARDENING.mem_limit,
    ...(HARDENING.read_only ? ["--read-only"] : []),
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--network",
    "none",
    "--user",
    c.user,
    ...(c.workdir ? ["--workdir", c.workdir] : []),
    ...(c.entrypoint ? ["--entrypoint", c.entrypoint] : []),
    c.image,
    ...c.cmd,
  ];
}

/**
 * Run in each image as its unprivileged user: every package.json in the whole image (/proc, /sys and /dev left out)
 * that names a package, with its folder and version, as SX-L's A1 listed them; the folders it could not read; and the
 * SHA-256 and size of /app/THIRD-PARTY-NOTICES.md, if it is there. Links are not followed.
 */
export const LISTING_SCRIPT =
  'const fs=require("fs"),p=require("path"),c=require("crypto");const o={packages:[],unreadable:[],notices:null};' +
  'function w(d){let es;try{es=fs.readdirSync(d,{withFileTypes:true})}catch{o.unreadable.push(d);return}' +
  'for(const e of es){const f=p.join(d,e.name);if(d==="/"&&["proc","sys","dev"].includes(e.name))continue;' +
  'if(e.isDirectory())w(f);else if(e.isFile()&&e.name==="package.json"){try{const j=JSON.parse(fs.readFileSync(f,"utf8"));' +
  'if(typeof j.name==="string"&&j.name)o.packages.push({path:p.dirname(f),name:j.name,version:typeof j.version==="string"?j.version:""})}catch{}}}}' +
  'w("/");try{const b=fs.readFileSync("/app/THIRD-PARTY-NOTICES.md");o.notices={sha256:c.createHash("sha256").update(b).digest("hex"),bytes:b.length}}catch{}' +
  "process.stdout.write(JSON.stringify(o));";

/** The template's licence check as its two commands (gap N7: the tools image has no bash). */
export const LICENCE_CHECK_COMMAND = "node scripts/check-lock.mjs && node_modules/.bin/tsx scripts/licence/check.ts";

interface Listing {
  packages: PackageCopy[];
  unreadable: string[];
  notices: { sha256: string; bytes: number } | null;
}

/**
 * Items 3 to 7 on a packed export, with Docker (the real `Sandboxes.checkExport`). Returns the six checks in
 * `DOCKER_CHECK_IDS` order; a check that cannot run (the build fails, a container fails) is returned as not passed,
 * with the checks after it left out, and the exporter refuses the export on it. Both images and every container are
 * removed by exact name before it returns.
 */
export async function checkExportImages(sb: Sandbox, projectId: string, p: PackedExport, o: { templateDir?: string } = {}): Promise<ExportCheck[]> {
  if (!sb.appBuild) throw new Error("This sandbox has no app to build; the export cannot be checked.");
  const templateDir = o.templateDir ?? TEMPLATE_DIR;
  const [runImage, toolsImage] = exportCheckImageNames(projectId);
  const env = dockerEnv(sb);
  const tag = randomBytes(3).toString("hex");
  const containers: string[] = [];
  const checks: ExportCheck[] = [];
  try {
    // 3. Unpacked into a fresh folder, then built through the sandbox's own build path.
    const copyRoot = join(p.unpackDir, "copy");
    mkdirSync(copyRoot, { mode: 0o700 });
    await run("tar", ["--extract", "--gzip", "--file", p.path, "--directory", copyRoot, "--no-same-owner"], { env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", LC_ALL: "C" } });
    const copy = join(copyRoot, p.top);
    const st = lstatSync(copy, { throwIfNoEntry: false });
    if (!st?.isDirectory()) return [{ id: "images_built", passed: false, summary: `The archive does not unpack to one folder named ${p.top}.` }];
    let buildOut: string;
    try {
      buildOut = await sandbox.build({ ...sb, appBuild: { ...sb.appBuild, context: copy, image: runImage, toolsImage } });
    } catch (err) {
      return [{ id: "images_built", passed: false, summary: `The archive's images could not be built (${(err as Error).message.split("\n")[0]}).` }];
    }
    const idOf = async (image: string) => (await run("docker", ["image", "inspect", "--format", "{{.Id}}", image], { env })).stdout.trim();
    const images = { run: { name: runImage, id: await idOf(runImage) }, tools: { name: toolsImage, id: await idOf(toolsImage) } };
    checks.push({
      id: "images_built",
      passed: true,
      summary: `The archive's run and tools stages were built through the sandbox's build path, as ${runImage} and ${toolsImage}; both are removed after the check.`,
      images,
      install_step: buildOut
        .split("\n")
        .filter((l) => /npm ci|added \d+ packages/.test(l))
        .slice(0, 6)
        .map((l) => l.trim().slice(0, 300)),
    });

    // 4. What Compose reads (S30), with only PATH and HOME set.
    const tplFolder = join(p.unpackDir, "template", p.top);
    mkdirSync(tplFolder, { recursive: true, mode: 0o700 });
    copyFileSync(join(templateDir, "compose.yaml"), join(tplFolder, "compose.yaml"));
    const plain = { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: process.env.HOME ?? "/root" };
    const read = async (cwd: string) => (await run("docker", ["compose", "config", "--format", "json"], { cwd, env: plain, maxBuffer: 4 * 1024 * 1024, timeout: 120_000 })).stdout;
    let composeCheck: ExportCheck;
    try {
      const v = composeConfigVerdict(await read(copy), await read(tplFolder), [copy, realpathSync(copy)], [tplFolder, realpathSync(tplFolder)]);
      composeCheck = { id: "compose_config", ...v };
    } catch (err) {
      composeCheck = { id: "compose_config", passed: false, summary: `Docker Compose could not read the copy or the template's file (${(err as Error).message.split("\n")[0]}).` };
    }
    checks.push(composeCheck);
    if (!composeCheck.passed) return checks;

    // 5 and 6. The run image, as `nobody`.
    const listIn = async (image: string, user: string, what: string): Promise<Listing | string> => {
      const name = `${sb.projectName}-exportcheck-${what}-${tag}`;
      containers.push(name);
      try {
        const { stdout } = await run("docker", checkContainerArgs({ name, image, user, entrypoint: "node", cmd: ["-e", LISTING_SCRIPT] }), { env, maxBuffer: 20 * 1024 * 1024, timeout: 300_000 });
        return JSON.parse(stdout) as Listing;
      } catch (err) {
        return `the listing did not run (${(err as Error).message.split("\n")[0]})`;
      }
    };
    const devNames = devOnlyNames(templateDir);
    const inRun = await listIn(runImage, "nobody", "list-run");
    if (typeof inRun === "string") return [...checks, { id: "run_image_packages", passed: false, summary: `The image the app runs from could not be listed: ${inRun}.` }];
    checks.push({ id: "run_image_packages", ...runImageVerdict(inRun.packages, devNames), image: runImage, user: "nobody", named_packages: inRun.packages.length, unreadable: inRun.unreadable });
    checks.push({ id: "run_image_notices", ...noticesVerdict(inRun.notices, sha256(readFileSync(join(copy, "THIRD-PARTY-NOTICES.md")))) });

    // 7. The tools image, as `node`: the listing, then the template's own licence check.
    const inTools = await listIn(toolsImage, "node", "list-tools");
    if (typeof inTools === "string") return [...checks, { id: "tools_image_packages", passed: false, summary: `The tools image could not be listed: ${inTools}.` }];
    checks.push({ id: "tools_image_packages", ...toolsImageVerdict(inTools.packages, devNames), image: toolsImage, user: "node", named_packages: inTools.packages.length, unreadable: inTools.unreadable });
    const name = `${sb.projectName}-exportcheck-licences-${tag}`;
    containers.push(name);
    let code: number | null = 0;
    let output = "";
    try {
      const r = await run("docker", checkContainerArgs({ name, image: toolsImage, user: "node", workdir: "/app", entrypoint: "sh", cmd: ["-c", LICENCE_CHECK_COMMAND] }), { env, maxBuffer: 20 * 1024 * 1024, timeout: 600_000 });
      output = r.stdout + r.stderr;
    } catch (err) {
      const e = err as { code?: unknown; stdout?: string; stderr?: string };
      code = typeof e.code === "number" ? e.code : null;
      output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    const licence = licenceCheckVerdict(code, output);
    checks.push({ id: "licence_check", ...licence, command: LICENCE_CHECK_COMMAND, image: toolsImage, user: "node", output_lines: output.split("\n").filter((l) => /^RESULT:|^PROBLEM|Notices file|^Lock file check|^Packages checked/.test(l)).slice(0, 20) });
    return checks;
  } finally {
    for (const c of containers) await run("docker", ["rm", "-f", c], { env }).catch(() => undefined);
    for (const image of [runImage, toolsImage]) await run("docker", ["image", "rm", "-f", image], { env }).catch(() => undefined);
  }
}
