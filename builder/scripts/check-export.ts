/**
 * The check from the exported copy (package 3.2, docs/design/package-3.2.md, section 3), as a command:
 *
 *   npx tsx scripts/check-export.ts <copy folder> --project-id <id> --version <vNNN> --manifest-sha256 <hex> \
 *     --checklist-items <n> --run-folder <folder>
 *
 * Run from builder/, on the machine where the copy was started with its README's command. The four values come from
 * the export's event, journey.export.written, recorded before the builder that made the export stopped. It opens no
 * builder interface, database, gateway or acceptance store; it builds and downloads nothing. Its logic is in
 * src/export/check-from-copy.ts. It prints the reading and writes it, with the runner's results, into the run folder,
 * which must not exist yet and is made outside the copy and outside the repository (the results' trace holds the sample
 * password: known gap 72). Exit code: 0 when the check passed, 1 when it did not, 2 when it could not be run as asked.
 */
import { CHECK_USAGE, checkFromCopy, parseCheckArgs, type CopyCheckArgs } from "../src/export/check-from-copy.js";

let args: CopyCheckArgs;
try {
  args = parseCheckArgs(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n\n${CHECK_USAGE}\n`);
  process.exit(2);
}

try {
  const r = await checkFromCopy({ ...args, onLine: (l) => process.stdout.write(`  runner | ${l}\n`) });
  const lines = [
    `Check from the exported copy: ${r.reading.outcome}. ${r.reading.summary}.`,
    `Label: ${r.label}.`,
    `Run ${r.runId}; project ${r.projectId}, version ${r.version}, manifest SHA-256 ${r.manifestSha256 ?? "not read"}.`,
    r.refused ? `Refused before the start: ${r.refused}.` : `Started: the forwarder ${r.forwarder?.name}, then the runner ${r.runner?.name}; the runner's exit code ${r.exit?.code ?? "none"}${r.exit?.timedOut ? " (stopped at its time limit)" : ""}.`,
    r.app ? `The app: container ${r.app.container} of the Compose project ${r.app.project}, started from ${r.app.workingDir}, image ${r.app.imageName} (${r.app.imageId}), at ${r.app.appUrl}.` : "The app: not found.",
    ...r.reading.items.map((it) => `Item ${it.number} (${it.file}): ${it.status}; ${it.why}.${it.screenshot ? ` Screenshot: ${it.screenshot.path}.` : ""}`),
    `The copy: ${r.copy.files} entries ${r.copy.unchanged ? "unchanged" : `changed (${r.copy.changes.join(", ")})`}; the forwarder ${r.forwarderRemoved === null ? "was not started" : r.forwarderRemoved ? "removed" : "NOT removed"}.`,
    ...r.afterProblems.map((p) => `After the run: ${p}.`),
    `The reading is in ${args.runFolder}/check-reading.json.`,
    r.passed ? "PASSED" : "NOT PASSED",
  ];
  process.stdout.write(lines.join("\n") + "\n");
  process.exit(r.passed ? 0 : 1);
} catch (err) {
  process.stderr.write(`The check could not be run: ${(err as Error).message}\n`);
  process.exit(2);
}
