// The licence check for one component (hard rule 2; build plan package 0.4).
//
//   tsx src/licence/check.ts                  check this component; fail on any problem
//   tsx src/licence/check.ts --write          also rewrite the report and the notices file
//   tsx src/licence/check.ts --dir <folder>   check another folder with this component's rule
//
// It reads every installed package's licence with the licence tool, and every other package
// the lock file lists (the ones another machine would install) from the lock file's own
// record, applies the one rule in licence-rule.json, and prints every problem. Exit code 0
// means the check passed; 1 means it did not.
//
// This file and rule.ts are kept, byte for byte, in every component that is checked.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyRule, renderNotices, type Installed, type LicenceRule, type OwnPackage } from "./rule.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const componentDir = path.resolve(here, "..", "..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dir = path.resolve(arg("--dir") ?? componentDir);
const rulePath = path.resolve(arg("--rule") ?? path.join(componentDir, "licence-rule.json"));
const write = process.argv.includes("--write");
const isOwnComponent = dir === componentDir;

function fail(message: string): never {
  console.log(`PROBLEM: ${message}`);
  console.log("RESULT: FAILED");
  process.exit(1);
}

if (!existsSync(path.join(dir, "package.json"))) fail(`${dir} has no package.json, so there is nothing to check.`);

// Every installed package is read, including any marked private. Only the folder's own
// package (the root) is left out, by its path.
function readInstalled(production: boolean): Installed {
  const tool = path.join(componentDir, "node_modules", ".bin", "license-checker-rseidelsohn");
  const args = ["--json", "--start", dir];
  if (production) args.push("--production");
  const out = execFileSync(tool, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const found = JSON.parse(out) as Installed;
  const result: Installed = {};
  for (const [key, pkg] of Object.entries(found)) {
    if (pkg.path !== undefined && path.resolve(pkg.path) === dir) continue;
    result[key] = pkg;
  }
  return result;
}

interface LockEntry {
  name?: string;
  version?: string;
  resolved?: string;
  license?: unknown;
  dev?: boolean;
  link?: boolean;
  inBundle?: boolean;
}
const REGISTRY = "https://registry.npmjs.org/";
const lockProblems: string[] = [];

// The lock file lists every package any machine would install, with the licence each one
// declares. Read here:
//   - packages not installed on this machine, so that they are judged too (by the lock
//     file's record of their licence);
//   - which packages are shipped: the lock file marks development-only packages itself, and
//     a package is treated as shipped if either the tool or the lock file says so;
//   - where each package comes from: the npm registry, or a folder named in the rule as this
//     component's own. Anything else (an archive file, a git address, another server, a
//     local folder that is not named) is a problem: its contents are not what a registry
//     package's licence record describes.
function readLockFile(installed: Installed, own: OwnPackage[]): { lockOnly: Installed; shipped: Installed; entries: Map<string, LockEntry> } {
  const lockPath = path.join(dir, "package-lock.json");
  const lockOnly: Installed = {};
  const shipped: Installed = {};
  const byPath = new Map<string, LockEntry>();
  // npm reads npm-shrinkwrap.json in preference to the lock file. This check does not read it, so it must not be there.
  if (existsSync(path.join(dir, "npm-shrinkwrap.json"))) lockProblems.push("npm-shrinkwrap.json is present. npm would install from it, and this check reads only package-lock.json.");
  // No lock file: where the packages come from, and what another machine would install, cannot be checked.
  if (!existsSync(lockPath)) {
    lockProblems.push("package-lock.json is missing, so the source of each package and the packages for other machines could not be checked.");
    return { lockOnly, shipped, entries: byPath };
  }
  let lock: { packages?: Record<string, LockEntry> };
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf8")) as { packages?: Record<string, LockEntry> };
  } catch {
    lockProblems.push("package-lock.json could not be read as JSON.");
    return { lockOnly, shipped, entries: byPath };
  }
  const entries = lock.packages !== null && typeof lock.packages === "object" && !Array.isArray(lock.packages) ? Object.entries(lock.packages) : [];
  if (entries.filter(([where]) => where !== "").length === 0) {
    lockProblems.push("package-lock.json lists no packages, so nothing in it could be checked.");
    return { lockOnly, shipped, entries: byPath };
  }
  for (const [where, entry] of entries) if (where !== "" && entry !== null && typeof entry === "object") byPath.set(where, entry);
  for (const [where, entry] of entries) {
    if (where === "" || entry === null || typeof entry !== "object") continue;
    const cut = where.lastIndexOf("node_modules/");
    if (cut < 0) {
      // A local folder of the component. Only one named in the rule is accepted.
      if (!own.some((o) => o.path === where)) lockProblems.push(`${where} is listed as a local package and is not named in the rule as one of this component's own.`);
      continue;
    }
    const nameFromPath = where.slice(cut + "node_modules/".length);
    if (entry.link === true) {
      const o = own.find((x) => x.name === nameFromPath && x.path === entry.resolved);
      if (!o) lockProblems.push(`${where} is a link to the local folder "${String(entry.resolved)}", which is not named in the rule as one of this component's own.`);
      continue;
    }
    // The package's real name, where the lock file records one that differs from the folder name.
    const name = typeof entry.name === "string" && entry.name !== "" ? entry.name : nameFromPath;
    const key = `${name}@${entry.version ?? ""}`;
    if (typeof entry.resolved === "string" ? !entry.resolved.startsWith(REGISTRY) : entry.inBundle !== true) {
      lockProblems.push(`${where} does not come from the npm registry (${typeof entry.resolved === "string" ? entry.resolved : "no address recorded"}).`);
    }
    const pkg = installed[key];
    if (pkg) {
      if (entry.dev !== true) shipped[key] = pkg;
      continue;
    }
    const licence = typeof entry.license === "string" ? entry.license : "";
    const fromLock = { licenses: licence, fromLockFile: true };
    // Listed more than once with different licences: keep the one that is not permitted, so it is seen.
    const earlier = lockOnly[key];
    if (earlier === undefined || earlier.licenses === licence) lockOnly[key] = fromLock;
    else lockOnly[`${key} (${where})`] = fromLock;
    if (entry.dev !== true) shipped[key] = lockOnly[key] ?? fromLock;
  }
  return { lockOnly, shipped, entries: byPath };
}

// Every folder that sits where an installed package sits, read directly from the disk. The
// licence tool reports one entry per name and version, so a second folder calling itself by
// the same name and version would hide behind the first; and it leaves out a folder whose
// package.json has no name. What is found here is checked against the lock file, against the
// component's own packages, and against what the tool reported.
interface OnDisk {
  /** Path inside the component, with forward slashes, for example "node_modules/next/node_modules/sharp". */
  where: string;
  real: string;
  name: string;
  version: string;
  /** The licence fields exactly as the folder's package.json gives them. */
  declared: string;
  isLink: boolean;
}
function readDisk(): { found: OnDisk[]; problems: string[] } {
  const found: OnDisk[] = [];
  const problems: string[] = [];
  const rel = (p: string) => path.relative(dir, p).split(path.sep).join("/");
  const packageFolder = (p: string): void => {
    const st = lstatSync(p);
    const isLink = st.isSymbolicLink();
    if (!isLink && !st.isDirectory()) return;
    let real: string;
    try {
      real = realpathSync(p);
    } catch {
      problems.push(`${rel(p)} is a link that leads nowhere.`);
      return;
    }
    const pjPath = path.join(p, "package.json");
    if (!existsSync(pjPath)) {
      if (readdirSync(p).some((f) => f !== "node_modules")) problems.push(`${rel(p)} holds files but no package.json, so what it is could not be read.`);
      else if (existsSync(path.join(p, "node_modules"))) visit(path.join(p, "node_modules"));
      return;
    }
    let pj: { name?: unknown; version?: unknown; license?: unknown; licenses?: unknown };
    try {
      pj = JSON.parse(readFileSync(pjPath, "utf8")) as typeof pj;
    } catch {
      problems.push(`${rel(p)}/package.json could not be read as JSON.`);
      return;
    }
    if (pj === null || typeof pj !== "object" || typeof pj.name !== "string" || pj.name === "") {
      problems.push(`${rel(p)}/package.json names no package, so the licence tool does not report it.`);
      return;
    }
    found.push({ where: rel(p), real, name: pj.name, version: typeof pj.version === "string" ? pj.version : "", declared: JSON.stringify([pj.license ?? null, pj.licenses ?? null]), isLink });
    // A linked folder is not walked into: it is either the component's own, checked file by file, or a problem.
    if (!isLink && existsSync(path.join(p, "node_modules"))) visit(path.join(p, "node_modules"));
  };
  // npm installs nothing under a name that begins with a dot, but a folder put there by hand can
  // still be loaded by name. Such folders hold tool caches; a package.json in one that names a
  // package is a problem. (.bin holds only links to programs inside packages already read.)
  const hidden = (p: string, depth: number): void => {
    if (depth > 12) return;
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) hidden(full, depth + 1);
      else if (e.name === "package.json") {
        let named = true; // unreadable counts as named: it cannot be shown to be harmless
        try {
          const pj = JSON.parse(readFileSync(full, "utf8")) as { name?: unknown } | null;
          named = pj !== null && typeof pj === "object" && typeof pj.name === "string" && pj.name !== "";
        } catch {
          /* stays true */
        }
        if (named) problems.push(`${rel(full)} is a package inside a hidden folder, where neither this check nor the licence tool reads licences.`);
      }
    }
  };
  const visit = (nm: string): void => {
    for (const e of readdirSync(nm, { withFileTypes: true })) {
      const full = path.join(nm, e.name);
      if (e.name.startsWith(".")) {
        if (e.name !== ".bin" && lstatSync(full).isDirectory()) hidden(full, 0);
        else if (e.name !== ".bin" && lstatSync(full).isSymbolicLink()) problems.push(`${rel(full)} is a hidden link.`);
        continue;
      }
      if (e.name.startsWith("@")) {
        // A scope folder that is itself a link would put every package under it outside the component.
        if (lstatSync(full).isSymbolicLink()) {
          problems.push(`${rel(full)} is a link, so the packages under it are not inside this component.`);
          continue;
        }
        for (const sub of readdirSync(full, { withFileTypes: true })) {
          if (sub.name.startsWith(".")) {
            const subFull = path.join(full, sub.name);
            if (lstatSync(subFull).isDirectory()) hidden(subFull, 0);
            else if (lstatSync(subFull).isSymbolicLink()) problems.push(`${rel(subFull)} is a hidden link.`);
          } else packageFolder(path.join(full, sub.name));
        }
      } else packageFolder(full);
    }
  };
  if (existsSync(path.join(dir, "node_modules"))) visit(path.join(dir, "node_modules"));
  return { found, problems };
}

function checkDisk(found: OnDisk[], installed: Installed, lockEntries: Map<string, LockEntry>, own: OwnPackage[], hasLock: boolean): string[] {
  const problems: string[] = [];
  const rootName = (JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { name?: string }).name;
  const ownFolders = new Map(own.map((o) => [o.name, safeReal(path.resolve(dir, o.path))]));
  const byKey = new Map<string, OnDisk[]>();
  for (const f of found) {
    const key = `${f.name}@${f.version}`;
    byKey.set(key, [...(byKey.get(key) ?? []), f]);
    const ownFolder = ownFolders.get(f.name);
    if (ownFolder !== undefined) {
      // The name belongs to the component's own package: only its own folder may carry it, wherever it is found.
      if (f.real !== ownFolder) problems.push(`${f.where} calls itself ${f.name} and is not the component's own folder for that name.`);
    } else if (f.isLink) {
      problems.push(`${f.where} is a link to ${f.real}, which is not named in the rule as one of this component's own.`);
    }
    if (rootName !== undefined && f.name === rootName) problems.push(`${f.where} carries this component's own name (${rootName}), so the licence tool may leave it out.`);
    const folderName = f.where.slice(f.where.lastIndexOf("node_modules/") + "node_modules/".length);
    const entry = lockEntries.get(f.where);
    if (hasLock && entry === undefined) problems.push(`${f.where} is installed and is not in the lock file, so where it came from is not recorded.`);
    if (folderName !== f.name && !(entry !== undefined && entry.name === f.name)) {
      problems.push(`${f.where} holds a package that calls itself ${f.name}, and the lock file does not record that.`);
    }
    if (ownFolder === undefined && installed[key] === undefined) problems.push(`${f.where} (${key}) was not reported by the licence tool, so its licence was not read.`);
  }
  for (const [key, group] of byKey) {
    if (new Set(group.map((g) => g.declared)).size > 1) {
      problems.push(`${key} is installed in more than one folder with different licence declarations (${group.map((g) => g.where).join(", ")}); the licence tool reports only one of them.`);
    }
  }
  return problems;
}
function safeReal(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

// A package named in the rule as the component's own must be exactly that: the folder named,
// inside the component, holding exactly the files named, and nothing else under that name.
function checkOwnPackages(own: OwnPackage[]): string[] {
  const problems: string[] = [];
  const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  for (const o of own) {
    const folder = path.resolve(dir, o.path);
    if (path.relative(dir, folder).startsWith("..") || !existsSync(path.join(folder, "package.json"))) {
      problems.push(`the component's own package ${o.name} should be in ${o.path}, and no package is there.`);
      continue;
    }
    const linked = path.join(dir, "node_modules", o.name);
    if (existsSync(linked) && realpathSync(linked) !== realpathSync(folder)) {
      problems.push(`node_modules/${o.name} is not the component's own folder ${o.path}.`);
    }
    const found = readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter((f) => !f.isDirectory())
      .map((f) => path.relative(folder, path.join(f.parentPath, f.name)).split(path.sep).join("/"))
      .sort();
    const expected = Object.keys(o.files).sort();
    for (const f of found) if (!expected.includes(f)) problems.push(`${o.path}/${f} is a file the rule does not name.`);
    for (const f of expected) {
      if (!found.includes(f)) problems.push(`${o.path}/${f} is named in the rule and is missing.`);
      else if (sha(path.join(folder, f)) !== o.files[f]) problems.push(`${o.path}/${f} has changed since the rule recorded it.`);
    }
    const pj = JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8")) as { name?: string; version?: string; private?: boolean };
    if (pj.name !== o.name || pj.version !== o.version) problems.push(`${o.path}/package.json says ${String(pj.name)}@${String(pj.version)}, and the rule names ${o.name}@${o.version}.`);
  }
  return problems;
}

// A dependency the folder declares but which is not installed cannot be checked, so it fails.
function declaredButMissing(): string[] {
  const root = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const names = [...Object.keys(root.dependencies ?? {}), ...Object.keys(root.devDependencies ?? {})];
  return names.filter((n) => !existsSync(path.join(dir, "node_modules", n, "package.json")));
}

// An optional or peer dependency need not be installed on this machine, but then the lock file must list it.
function declaredAndUnknown(lockEntries: Map<string, LockEntry>): string[] {
  const root = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const names = [...Object.keys(root.optionalDependencies ?? {}), ...Object.keys(root.peerDependencies ?? {})];
  return names.filter((n) => !existsSync(path.join(dir, "node_modules", n, "package.json")) && !lockEntries.has(`node_modules/${n}`));
}

const rule = JSON.parse(readFileSync(rulePath, "utf8")) as LicenceRule;
const ownPackages = rule.own_packages ?? [];
const installed = readInstalled(false);
const lock = readLockFile(installed, ownPackages);
const all = { ...lock.lockOnly, ...installed };
const shipped = { ...readInstalled(true), ...lock.shipped };
const missing = declaredButMissing();
const ownProblems = checkOwnPackages(ownPackages);
const disk = readDisk();
const diskProblems = [...disk.problems, ...checkDisk(disk.found, installed, lock.entries, ownPackages, existsSync(path.join(dir, "package-lock.json")))];
const unknown = declaredAndUnknown(lock.entries);
const result = applyRule(rule, all, shipped);

console.log(`Licence check for ${path.relative(path.resolve(componentDir, ".."), dir) || dir}`);
console.log(`Rule: ${path.relative(dir, rulePath) || rulePath}`);
console.log(
  `Packages checked: ${result.checked} installed on this machine, and ${result.fromLockFile} more that the lock file lists for other machines (judged by the licence the lock file records). Shipped, that is not development-only: ${result.shipped}.`,
);
if (ownPackages.length > 0) {
  console.log("This component's own packages (a folder of its own, no outside licence):");
  for (const o of ownPackages) console.log(`  ${o.name}@${o.version} | ${o.path} | ${result.ownInUse.includes(`${o.name}@${o.version}`) ? "installed" : "NOT installed"}`);
}
console.log(`Permitted licences: ${rule.permitted.join(", ")}`);
console.log("Named exceptions in use:");
if (result.exceptionsInUse.length === 0) console.log("  none");
for (const u of result.exceptionsInUse) {
  const how = u.viaFamily ? ` (build package of ${u.exception.name})` : "";
  console.log(
    `  ${u.package}@${u.version}${how} | ${u.exception.licence} | approved ${u.exception.approved} for ${u.exception.use} use | ${u.shipped ? "shipped" : "development only"}`,
  );
}
if (result.exceptionsNotInstalled.length > 0) {
  console.log(`Named exceptions not installed here: ${result.exceptionsNotInstalled.join(", ")}`);
}

if (result.choices.length > 0) {
  console.log("Accepted on one side of a choice of licences (the permitted side is the one taken):");
  for (const c of result.choices) console.log(`  ${c.package} | ${c.licence}`);
}

let failed = false;
if (result.checked === 0) {
  failed = true;
  console.log("PROBLEM: no installed package was found. A check that read nothing has not passed.");
}
for (const name of missing) {
  failed = true;
  console.log(`PROBLEM: ${name} is declared as a dependency but is not installed, so its licence could not be read.`);
}
for (const name of unknown) {
  failed = true;
  console.log(`PROBLEM: ${name} is declared as an optional or peer dependency, is not installed, and is not in the lock file, so its licence could not be read.`);
}
for (const p of [...lockProblems, ...ownProblems, ...diskProblems]) {
  failed = true;
  console.log(`PROBLEM: ${p}`);
}
if (result.problems.length > 0) {
  failed = true;
  console.log(`PROBLEMS: ${result.problems.length}`);
  for (const p of result.problems) console.log(`  ${p.package} | ${p.licence} | ${p.reason}`);
}

// The notices file and the report belong to the component itself, not to a folder checked with --dir.
if (isOwnComponent) {
  const texts = new Map<string, string>();
  for (const u of result.exceptionsInUse) {
    if (u.viaFamily) continue;
    for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md"]) {
      const f = path.join(dir, "node_modules", u.package, name);
      if (existsSync(f)) {
        texts.set(u.package, readFileSync(f, "utf8"));
        break;
      }
    }
  }
  // Named after the component's own package name, not its folder, so that a copy of the
  // component in a folder of another name still has an up-to-date notices file.
  const ownName = (JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { name?: string }).name ?? path.basename(dir);
  const notices = renderNotices(ownName, result, texts);
  const noticesPath = path.join(dir, "THIRD-PARTY-NOTICES.md");
  if (write) {
    writeFileSync(noticesPath, notices);
    const rows = ['"package","licence","repository","shipped"'];
    for (const key of Object.keys(installed).sort()) {
      const p = installed[key];
      if (!p) continue;
      const licence = Array.isArray(p.licenses) ? p.licenses.join(" AND ") : (p.licenses ?? "");
      rows.push(`"${key}","${licence}","${p.repository ?? ""}","${key in shipped ? "yes" : "no"}"`);
    }
    writeFileSync(path.join(dir, "licences.csv"), rows.join("\n") + "\n");
    console.log("Wrote THIRD-PARTY-NOTICES.md and licences.csv (the report of every installed package on this machine).");
  } else {
    const current = existsSync(noticesPath) ? readFileSync(noticesPath, "utf8") : "";
    if (current !== notices) {
      failed = true;
      console.log("PROBLEM: THIRD-PARTY-NOTICES.md is missing or out of date. Run the check with --write and commit the result.");
    } else {
      console.log("Notices file THIRD-PARTY-NOTICES.md is up to date.");
    }
  }
}

if (failed) {
  console.log("RESULT: FAILED");
  process.exit(1);
}
console.log("RESULT: PASSED");
