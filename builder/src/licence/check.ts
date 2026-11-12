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

function readInstalled(production: boolean): Installed {
  const tool = path.join(componentDir, "node_modules", ".bin", "license-checker-rseidelsohn");
  const args = ["--json", "--excludePrivatePackages", "--start", dir];
  if (production) args.push("--production");
  const out = execFileSync(tool, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(out) as Installed;
}

const rule = JSON.parse(readFileSync(rulePath, "utf8")) as LicenceRule;
const all = readInstalled(false);
const shipped = readInstalled(true);
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

let failed = false;
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
