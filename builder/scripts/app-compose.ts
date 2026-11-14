/**
 * Write templates/next/compose.yaml from its one source, builder/src/export/app-compose.ts (package 3.2).
 * Usage (from builder/): npx tsx scripts/app-compose.ts
 * It writes that one file and nothing else; test/export.test.ts holds the file to the generated text.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { appComposeYaml } from "../src/export/app-compose.js";

const target = resolve(import.meta.dirname, "..", "..", "templates", "next", "compose.yaml");
writeFileSync(target, appComposeYaml());
console.log(`Written: ${target}`);
