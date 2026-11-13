/**
 * The only files the interface serves (package J1, final design section 5, "Files served"): a screenshot or an
 * export whose path and SHA-256 an event of the project records, re-checked inside that event's own folder
 * when it is served. There is no folder listing, and no trace or failure text is served: a test can write
 * anything into its results folder (results.ts), so only the files named here are ever read.
 *
 * Which events may name a file, the field that names it, the folder it must be inside, and how it is served:
 * - `acceptance.item` (package 3.1's runner): `screenshot`, inside that run's `results` folder; image/png.
 * - `journey.screenshot` (J1 part 2, the app camera): `file`, inside `<data>/journey/<project>/shots`; image/png.
 * - `journey.export.written` (J1 part 2, the export): `file`, inside `<data>/journey/<project>/exports`; a
 *   .tar.gz, served as an attachment.
 *
 * Every refusal is the same "not found", so a refusal says nothing about what exists.
 */
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import type pg from "pg";
import { insideOrEqual, sha256 } from "../acceptance/store.js";

export type MediaType = "image/png" | "application/gzip";

interface Rule {
  field: "screenshot" | "file";
  media: MediaType;
  maxBytes: number;
  /** The folder the file must be inside, from the data folder, the project and the event. Null if the event cannot name one. */
  folder: (dataDir: string, projectId: string, payload: Record<string, unknown>) => string | null;
}

const RUN_ID = /^run-[0-9a-z-]{8,80}$/;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** The folder of a journey project's own files (screenshots, exports). Part 2 writes there. */
export const journeyFolder = (dataDir: string, projectId: string, what: "shots" | "exports"): string => join(dataDir, "journey", projectId, what);

export const FILE_RULES: Record<string, Rule> = {
  "acceptance.item": {
    field: "screenshot",
    media: "image/png",
    maxBytes: 20 * 1024 * 1024,
    folder: (dataDir, projectId, p) => (typeof p.run_id === "string" && RUN_ID.test(p.run_id) ? join(dataDir, "acceptance-runs", projectId, p.run_id, "results") : null),
  },
  "journey.screenshot": { field: "file", media: "image/png", maxBytes: 20 * 1024 * 1024, folder: (dataDir, projectId) => journeyFolder(dataDir, projectId, "shots") },
  "journey.export.written": { field: "file", media: "application/gzip", maxBytes: 200 * 1024 * 1024, folder: (dataDir, projectId) => journeyFolder(dataDir, projectId, "exports") },
};

export type Served = { ok: true; body: Buffer; media: MediaType; name: string } | { ok: false };

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GZIP = Buffer.from([0x1f, 0x8b]);

/**
 * The file an event of the project names, if every check passes: the event is the project's and of a kind
 * above; it names a path and a 64-hex SHA-256; the folder and the file exist; the file, with links resolved,
 * is inside the folder, is a plain file (opened without following a final link), is not too large, starts as
 * its type does, and its bytes have the recorded SHA-256.
 */
export async function recordedFile(pool: pg.Pool, dataDir: string, projectId: string, eventId: string): Promise<Served> {
  const no: Served = { ok: false };
  if (!PROJECT_ID.test(projectId) || !/^\d{1,18}$/.test(eventId)) return no;
  const r = await pool.query<{ kind: string; payload: Record<string, unknown> }>("select kind, payload from events where id = $1 and project_id = $2", [eventId, projectId]);
  const ev = r.rows[0];
  if (!ev) return no;
  const rule = FILE_RULES[ev.kind];
  if (!rule) return no;
  const named = ev.payload[rule.field] as { path?: unknown; sha256?: unknown } | null | undefined;
  if (!named || typeof named.path !== "string" || typeof named.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(named.sha256)) return no;
  const folderPath = rule.folder(dataDir, projectId, ev.payload);
  if (!folderPath) return no;
  let folder: string;
  let real: string;
  try {
    folder = realpathSync(folderPath);
    real = realpathSync(named.path);
  } catch {
    return no;
  }
  if (real === folder || !insideOrEqual(real, folder)) return no;
  let fd: number;
  try {
    fd = openSync(real, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return no;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > rule.maxBytes || st.size < 8) return no;
    const body = Buffer.alloc(st.size);
    let read = 0;
    while (read < st.size) {
      const n = readSync(fd, body, read, st.size - read, read);
      if (n === 0) return no;
      read += n;
    }
    const magic = rule.media === "image/png" ? PNG : GZIP;
    if (!body.subarray(0, magic.length).equals(magic)) return no;
    if (sha256(body) !== named.sha256) return no;
    return { ok: true, body, media: rule.media, name: basename(real) };
  } finally {
    closeSync(fd);
  }
}
