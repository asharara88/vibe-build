/**
 * How a starting gateway tells a gateway that has gone from one still running (build plan package 1.4;
 * proof row B9; design note 5.5 steps 3 and 4).
 *
 * Each gateway process holds a session-level advisory lock (a lock with a meaning the builder gives it,
 * which PostgreSQL releases when the session that took it ends) keyed by its id, on one connection of its
 * own that it keeps open and idle, outside its pool. A starting gateway, looking at the holds other
 * gateways left open (`recoverHolds`), tries that lock for each owner with `pg_try_advisory_xact_lock`
 * (released at the end of its own transaction). If it gets it, nobody holds it: the owner has gone, and
 * its open holds are marked unreconciled. If not, the owner is still running and its holds are left alone.
 * PostgreSQL documentation, sections 13.3.5 and 9.27.10 (docs/SOURCES.md, 13 Nov 2026).
 *
 * What this rests on: the owner's session ends when its process ends. A process that is killed closes its
 * connection at once on this machine; a machine that stops answering leaves the session open until the
 * database notices (known gaps). A gateway that does not hold its lock (one made in a test without it) is
 * judged gone.
 *
 * If the lock's connection drops, `ok()` turns false at once and stays false until the lock is taken
 * again; the gateway forwards nothing meanwhile (gateway/app.ts), because a sibling starting then would
 * judge it gone.
 *
 * Package 1.4b: given its journal folder's id, the gateway takes a second advisory lock, keyed by that id, on
 * the same connection, and `ok()` is true only while it holds both. Its journal folder is then used by one
 * gateway at a time, and by no recovery script while the gateway runs (builder/scripts/journal-recover.ts tries
 * the same lock and refuses without it): a second gateway on the same folder and the same database does not
 * start. Both locks end with the gateway's session: a killed gateway leaves no stale lock. Taken again after a
 * dropped connection only if the folder's lock is free; meanwhile the gateway forwards nothing and its journal
 * moves nothing in its file (main.ts guards it with `ok()`), though it still appends a call's ending (1.4b's review).
 */
import type pg from "pg";
import { createClient } from "./db.js";

/** The lock's key for a gateway id: the first 64 bits of an MD5 digest of the id, worked out by the database itself, so every process gets the same key. */
export const gatewayLockKeySql = (param: string): string => `('x' || substr(md5('builder-gateway-liveness:' || ${param}), 1, 16))::bit(64)::bigint`;

/** Package 1.4b: the lock's key for a journal folder's id, worked out the same way. */
export const journalFolderLockKeySql = (param: string): string => `('x' || substr(md5('builder-gateway-journal-folder:' || ${param}), 1, 16))::bit(64)::bigint`;

/** Package 1.4b: another process (a gateway, or the recovery script) holds the journal folder's lock. */
export class JournalFolderBusy extends Error {
  constructor() {
    super("Another process holds the lock of this gateway's journal folder: a gateway, or the journal recovery script.");
    this.name = "JournalFolderBusy";
  }
}

export interface Liveness {
  /** True while this gateway holds its lock. */
  ok(): boolean;
  /** The database session that holds the lock, while it does. */
  pid(): number | null;
  stop(): Promise<void>;
}

/**
 * Take the gateway's lock on a connection of its own and keep it. Throws if the lock is held already (by
 * another process with the same id). If the connection drops, tries again every `retryMs`.
 */
export async function holdLivenessLock(
  url: string,
  gatewayId: string,
  o: { retryMs?: number; onLost?: (message: string) => void; /** Package 1.4b: also hold the lock of this journal folder. */ journalFolderId?: string } = {},
): Promise<Liveness> {
  const retryMs = o.retryMs ?? 2_000;
  let client: pg.Client | null = null;
  let held = false;
  let sessionPid: number | null = null;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const take = async (): Promise<void> => {
    const c = createClient(url);
    // An error on an idle connection (the server ended the session) must not end the process.
    c.on("error", () => lost(c));
    c.on("end", () => lost(c));
    await c.connect();
    const r = await c.query<{ got: boolean; pid: number }>(`select pg_try_advisory_lock(${gatewayLockKeySql("$1")}) as got, pg_backend_pid() as pid`, [gatewayId]);
    if (!r.rows[0]!.got) {
      await c.end().catch(() => undefined);
      throw new Error(`Another gateway process holds the liveness lock for "${gatewayId}".`);
    }
    if (o.journalFolderId !== undefined) {
      const f = await c.query<{ got: boolean }>(`select pg_try_advisory_lock(${journalFolderLockKeySql("$1")}) as got`, [o.journalFolderId]);
      if (!f.rows[0]!.got) {
        await c.end().catch(() => undefined); // its session ends, and the liveness lock with it
        throw new JournalFolderBusy();
      }
    }
    if (stopped) {
      await c.end().catch(() => undefined);
      return;
    }
    client = c;
    sessionPid = r.rows[0]!.pid;
    held = true;
  };
  const lost = (c: pg.Client) => {
    if (c !== client) return;
    client = null;
    held = false;
    sessionPid = null;
    if (stopped) return;
    o.onLost?.("The gateway's liveness lock was lost with its database connection; it forwards nothing until the lock is taken again.");
    retry();
  };
  const retry = () => {
    if (timer || stopped) return;
    timer = setTimeout(() => {
      timer = null;
      take().catch(() => retry());
    }, retryMs);
    timer.unref();
  };

  await take();
  return {
    ok: () => held && !stopped,
    pid: () => sessionPid,
    stop: async () => {
      stopped = true;
      held = false;
      if (timer) clearTimeout(timer);
      const c = client;
      client = null;
      if (c) await c.end().catch(() => undefined);
    },
  };
}
