// The licence check for one component (hard rule 2; build plan package 0.4).
//
//   tsx src/licence/check.ts                  check this component; fail on any problem
//   tsx src/licence/check.ts --write          also rewrite the report and the notices file
//   tsx src/licence/check.ts --dir <folder>   check another folder with this component's rule
//
// It reads every installed package's licence with the licence tool, applies the one rule in
// licence-rule.json, and prints every problem. Exit code 0 means the check passed; 1 means
// it did not.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyRule, renderNotices, type Installed, type LicenceRule } from "./rule.js";

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

// "Shipped" means not development-only. The tool decides it by what it can reach from the
// non-development dependencies among the installed packages. The lock file, where there is
// one, marks development-only packages itself; a package is treated as shipped if either says so.
function shippedByLockFile(all: Installed): Installed {
  const lockPath = path.join(dir, "package-lock.json");
  const extra: Installed = {};
  if (!existsSync(lockPath)) return extra;
  const lock = JSON.parse(readFileSync(lockPath, "utf8")) as { packages?: Record<string, { version?: string; dev?: boolean }> };
  for (const [where, entry] of Object.entries(lock.packages ?? {})) {
    if (where === "" || entry.dev === true) continue;
    const name = where.slice(where.lastIndexOf("node_modules/") + "node_modules/".length);
    const key = `${name}@${entry.version ?? ""}`;
    const pkg = all[key];
    if (pkg) extra[key] = pkg;
  }
  return extra;
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

const rule = JSON.parse(readFileSync(rulePath, "utf8")) as LicenceRule;
const all = readInstalled(false);
const shipped = { ...readInstalled(true), ...shippedByLockFile(all) };
const missing = declaredButMissing();
const result = applyRule(rule, all, shipped);

console.log(`Licence check for ${path.relative(path.resolve(componentDir, ".."), dir) || dir}`);
console.log(`Rule: ${path.relative(dir, rulePath) || rulePath}`);
console.log(`Packages checked: ${result.checked} installed, of which ${result.shipped} shipped (not development-only).`);
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
  const notices = renderNotices(path.basename(dir), result, texts);
  const noticesPath = path.join(dir, "THIRD-PARTY-NOTICES.md");
  if (write) {
    writeFileSync(noticesPath, notices);
    const rows = ['"package","licence","repository","shipped"'];
    for (const key of Object.keys(all).sort()) {
      const p = all[key];
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
