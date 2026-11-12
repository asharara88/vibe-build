// Two checks on the dependency lock file, run by scripts/check-licences.sh.
//
// 1. The image library sharp must stay out. Its packages carry LGPL; the owner decided on
//    12 Nov 2026 that it is removed, not approved (docs/DECISIONS.md). The lock file may name
//    "sharp" only as the link to this template's own empty stand-in, and no "@img/" package.
// 2. The one package approved by name for generated apps, caniuse-lite, was approved under
//    CC-BY-4.0. If the lock file ever records another licence for it, the approval no longer
//    covers it.
//
// Usage: node scripts/check-lock.mjs [path to package-lock.json]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lockPath = process.argv[2] ?? fileURLToPath(new URL("../package-lock.json", import.meta.url));
const packages = JSON.parse(readFileSync(lockPath, "utf8")).packages ?? {};
const problems = [];
// A lock file that lists nothing has not been checked: that is a failure, not a pass.
if (typeof packages !== "object" || Array.isArray(packages) || Object.keys(packages).filter((k) => k !== "").length === 0) {
  problems.push("The lock file lists no packages, so nothing in it could be checked.");
}

for (const [where, entry] of Object.entries(packages)) {
  const name = where.slice(where.lastIndexOf("node_modules/") + "node_modules/".length);
  if (!where.includes("node_modules/")) continue;
  if (name.startsWith("@img/")) problems.push(`${name} is listed. It is part of the image library sharp, which is not to be installed.`);
  if (name === "sharp" && !(entry.link === true && entry.resolved === "vendor/no-sharp")) {
    problems.push(`sharp is listed as a real package (${entry.version ?? "no version"}). Only the link to vendor/no-sharp is allowed.`);
  }
  if (name === "caniuse-lite" && entry.license !== "CC-BY-4.0") {
    problems.push(`caniuse-lite is recorded with the licence "${entry.license}". The owner approved it under CC-BY-4.0 only.`);
  }
}
for (const [where, entry] of Object.entries(packages)) {
  // Any other local package would be invisible to the licence tool if marked private.
  if (where !== "" && !where.includes("node_modules/") && where !== "vendor/no-sharp") {
    problems.push(`A local package at "${where}" is listed (${entry.name ?? "unnamed"}). Only vendor/no-sharp is expected.`);
  }
}

console.log(`Lock file check (${lockPath.split("/").slice(-3).join("/")}): ${Object.keys(packages).length - 1} entries read.`);
if (problems.length > 0) {
  console.log(`PROBLEMS: ${problems.length}`);
  for (const p of problems.slice(0, 40)) console.log(`  ${p}`);
  if (problems.length > 40) console.log(`  ... and ${problems.length - 40} more`);
  console.log("RESULT: FAILED");
  process.exit(1);
}
console.log("No sharp or @img package from the registry; caniuse-lite is under the approved licence; no unexpected local package.");
console.log("RESULT: PASSED");
