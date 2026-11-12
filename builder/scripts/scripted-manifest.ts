/**
 * Fill in the fingerprints (SHA-256) of the scripted engine's change sets (package 2.1).
 * Usage (from builder/): npx tsx scripts/scripted-manifest.ts <example> [templateDir]
 *
 * For each step of the example, in order, each manifest entry gets:
 *  - `sha256`: the fingerprint of the change set's own copy of the file (files/<path>);
 *  - for a `replace`, `expectSha256`: the fingerprint of the file as the step finds it, which is the
 *    previous step's copy if an earlier step wrote it, or else the template's.
 * It reads files only; it runs nothing of the change sets. `npm test` checks the result
 * (test/scripted-engine.test.ts).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { listSteps, readManifest, sha256Of } from "../src/engine/scripted.js";

const [example, templateArg] = process.argv.slice(2);
if (!example) {
  console.error("usage: scripted-manifest.ts <example> [templateDir]");
  process.exit(1);
}
const changeSets = resolve(import.meta.dirname, "..", "scripted");
const templateDir = resolve(templateArg ?? join(import.meta.dirname, "..", "..", "templates", "next"));
const current = new Map<string, string>(); // path -> fingerprint of the file as the next step finds it, where a step wrote it

for (const step of listSteps(changeSets, example)) {
  const manifest = readManifest(changeSets, example, step);
  for (const f of manifest.files) {
    f.sha256 = sha256Of(readFileSync(join(changeSets, example, step, "files", f.path)));
    if (f.op === "replace") f.expectSha256 = current.get(f.path) ?? sha256Of(readFileSync(join(templateDir, f.path)));
    else delete f.expectSha256;
  }
  for (const f of manifest.files) current.set(f.path, f.sha256);
  writeFileSync(join(changeSets, example, step, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${example}/${step}: ${manifest.files.length} files`);
}
