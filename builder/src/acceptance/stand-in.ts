/**
 * Writing the stand-in tests into the acceptance store (package 3.1; the owner's answer to question 12,
 * option (a), 13 Nov 2026; design note 2.7, amendment of 13 Nov).
 *
 * A plain function copies the fixed tests from stand-in-acceptance/<example>/ at the top of the
 * repository (a folder no container mounts) into a new version of the project's tests, and records the
 * version in the event log. No model is called: these tests were written in advance by Claude Code, not
 * by the builder's acceptance writer, and they are labelled "stand-in test" in every file, in the
 * manifest (written_by "stand-in") and in every acceptance event.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import { appendEvent } from "../store/events.js";
import { ITEM_FILE, REPO_ROOT, sha256, STAND_IN_LABEL, writeVersion, type AcceptanceStore, type WrittenVersion } from "./store.js";

export const STAND_IN_DIR = join(REPO_ROOT, "stand-in-acceptance");
export const EXAMPLE_SPECS: Record<string, string> = {
  "example-1": join(REPO_ROOT, "builder", "src", "spec", "examples", "example-1-leave-request.json"),
};

interface SpecChecklist {
  acceptance: Array<{ number: number; as_role: string; does: string; sees: string }>;
}

/** The app spec's checklist, and the spec file's fingerprint. */
export function exampleChecklist(example: string): { sha256: string; items: SpecChecklist["acceptance"] } {
  const path = EXAMPLE_SPECS[example];
  if (!path) throw new Error(`There is no app spec for "${example}".`);
  const raw = readFileSync(path);
  return { sha256: sha256(raw), items: (JSON.parse(raw.toString("utf8")) as SpecChecklist).acceptance };
}

/** The stand-in test files of an example, as committed. */
export function standInSources(example: string): Array<{ number: number; file: string; content: string }> {
  const dir = join(STAND_IN_DIR, example);
  return readdirSync(dir)
    .filter((f) => ITEM_FILE.test(f))
    .sort()
    .map((file) => ({ number: Number(ITEM_FILE.exec(file)![1]), file, content: readFileSync(join(dir, file), "utf8") }));
}

/**
 * Write a new version of a project's tests from the stand-in tests of an example, and record it:
 * event `acceptance.version.written` with the version, the manifest's fingerprint, each item's number,
 * file and fingerprint, and written_by "stand-in". The marker is not put in the event.
 * The project's row must exist first (the event log refers to it).
 */
export async function writeStandInVersion(pool: pg.Pool, store: AcceptanceStore, projectId: string, example: string): Promise<WrittenVersion> {
  const spec = exampleChecklist(example);
  const items = standInSources(example).map((s) => {
    const c = spec.items.find((i) => i.number === s.number);
    if (!c) throw new Error(`${s.file} is for item ${s.number}, which the app spec's checklist does not have.`);
    return { ...s, checklist: `As ${c.as_role}: ${c.does} Sees: ${c.sees}` };
  });
  const written = writeVersion(store, projectId, { writtenBy: "stand-in", appSpecSha256: spec.sha256, items });
  await appendEvent(pool, projectId, "acceptance.version.written", {
    version: written.version,
    manifest_sha256: written.manifestSha256,
    written_by: "stand-in",
    label: STAND_IN_LABEL,
    app_spec_sha256: spec.sha256,
    items: written.manifest.items.map((i) => ({ number: i.number, file: i.file, sha256: i.sha256 })),
    checklist_items: spec.items.length,
  });
  return written;
}
