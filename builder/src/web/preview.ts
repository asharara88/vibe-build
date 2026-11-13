/**
 * The live preview, the interface's side (package J3; final design, sections 4.1 to 4.4 and 4.8).
 *
 * - The preview front (preview-front.ts) is started with `fork`, under a user of its own: BUILDER_PREVIEW_UID, 1990
 *   by default, refused if it is 0, 1000 (the door's user) or 1001 (the runner's), or named in /etc/passwd. It runs
 *   from a copy of its two files in a short folder the interface makes (root's, mode 711; the files 444), by Node's
 *   own type stripping, with no tsx and no way into the builder's folders. Its environment holds its port and the
 *   pump socket's path only. If the interface is not root, the front runs as the interface's own user
 *   (`frontUser()` says so).
 * - The pump socket: the interface listens on `p.sock` in that folder, given to the front's user with mode 600. Each
 *   connection the front opens there becomes one stream to the app (`openStream`, manager.ts `appStream`): bytes
 *   only, never parsed. A connection is taken only while a live session is open and its pass has been used.
 * - One session at a time. `open` makes a pass (8 symbols, 40 bits; preview-rules.ts), sends only its digest to the
 *   front, and binds it to the builder's sign-in session, the project and the app's start. The session ends on leave,
 *   app stop, project close, the end of the builder sign-in session that opened it (its sign-out, a new sign-in in
 *   the same browser, or its expiry; after J3's review), a pass unused or voided, the checklist, a halt or a lost
 *   lock, or after 8 hours, whichever comes first; its streams are then killed.
 * - Events (`journey.preview.live_entered`, `.live_closed`) go through `onEvent`; `.live_opened` is the live job's.
 * - The live camera's socket (`cameraSocket`): a folder of the runner's user 1001 (mode 750) with one socket (mode
 *   600), whose connections are passed, byte for byte, to the front's port on 127.0.0.1 (forwarder.ts).
 */
import { fork, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, chownSync, copyFileSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { RUNNER_UID } from "../acceptance/runner-image.js";
import type { AppStream } from "../sandbox/manager.js";
import { createForwarder, listenOnSocket } from "../sandbox/forwarder.js";
import { fromFrontMessage, passDigest, passFromBytes, PASS_VALID_MS, SESSION_MAX_MS, showPass, type MappingControls, type Texts, type ToFront } from "./preview-rules.ts";

/** The front's port for the owner's interface (section 4.3). The automated run uses 4041. */
export const DEFAULT_PREVIEW_PORT = 4030;
/** The front's user when the interface runs as root, unless BUILDER_PREVIEW_UID names another. */
export const DEFAULT_PREVIEW_UID = 1990;
/** How many times the front is started again after it stops, in one interface's life. */
export const MAX_FRONT_RESTARTS = 5;
/** At most this many streams to the app at once; the front itself keeps at most 6. */
export const MAX_PUMP_STREAMS = 8;

/** Why a uid may not be the front's, or null (section 4.3). */
export function previewUidRefusal(uid: number, passwd = readPasswd()): string | null {
  if (uid === 0) return "it is root";
  if (!Number.isInteger(uid) || uid < 1 || uid > 65_000) return "it is not a user number from 1 to 65000";
  if (uid === 1000) return "it is the door's user (1000)";
  if (uid === RUNNER_UID) return `it is the runner's user (${RUNNER_UID})`;
  if (passwd.split("\n").some((l) => l.split(":")[2] === String(uid))) return "it is named in /etc/passwd, so it may own files or run programs already";
  return null;
}
function readPasswd(): string {
  try {
    return readFileSync("/etc/passwd", "utf8");
  } catch {
    return "";
  }
}

/** True if every folder from / down to `dir` lets other users through (the front's user must reach its folder). */
export function traversableByOthers(dir: string): boolean {
  let d = dir;
  for (;;) {
    try {
      if ((statSync(d).mode & 0o001) === 0) return false;
    } catch {
      return false;
    }
    const up = dirname(d);
    if (up === d) return true;
    d = up;
  }
}

/** Where the interface makes its short folders: the temporary folder if the front's user can reach it and paths stay short, else /tmp. */
export function shortBase(base = tmpdir()): string {
  return traversableByOthers(base) && Buffer.byteLength(join(base, "bpv-XXXXXX", "preview-front.ts")) <= 100 ? base : "/tmp";
}

/**
 * The short folders an interface left when it was killed (SIGKILL; measurement M2): each `bpv-*` folder in `base`
 * whose pump socket nobody listens on, and each `bpc-*` folder whose camera socket nobody listens on, is removed. A
 * folder whose socket answers belongs to a running interface (the owner's, or a test's) and is left alone, and so is
 * one made in the last `minAgeMs` (another interface may be starting in it). Returns the names removed.
 */
export function removeStaleFolders(base: string, minAgeMs = 60_000): string[] {
  const removed: string[] = [];
  let names: string[];
  try {
    names = readdirSync(base);
  } catch {
    return removed;
  }
  for (const name of names) {
    const m = /^(bpv|bpc)-[A-Za-z0-9]{6}$/.exec(name);
    if (!m) continue;
    const dir = join(base, name);
    try {
      const st = lstatSync(dir);
      // Not a folder of this user, or made in the last minute (another interface may be starting in it): left alone.
      // After J3's review: run as root, the interface gives each camera folder to the runner's user (`cameraSocket`),
      // so a bpc- folder of that user is the interface's own too.
      const me = process.getuid?.() ?? st.uid;
      const owned = st.uid === me || (me === 0 && m[1] === "bpc" && st.uid === RUNNER_UID);
      if (!st.isDirectory() || !owned || Date.now() - st.mtimeMs < minAgeMs) continue;
    } catch {
      continue;
    }
    const sock = join(dir, m[1] === "bpv" ? "p.sock" : "c.sock");
    // Connecting to a Unix socket nobody listens on fails at once (ECONNREFUSED); a missing socket fails too.
    const r = spawnSync(process.execPath, ["-e", "const s=require('net').connect(process.argv[1]);s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1))", sock], { timeout: 3000 });
    if (r.status === 1) {
      rmSync(dir, { recursive: true, force: true });
      removed.push(name);
    }
  }
  return removed;
}

export interface LiveSession {
  projectId: string;
  sessionId: string;
  builderSession: string;
  appStartEventId: string;
  appPort: number;
  openedAt: number;
  passExpiresAt: number;
  endsAt: number;
  entered: boolean;
  enteredAt: number | null;
}

export interface LivePreviewOptions {
  port: number;
  /** The front's user, when the interface runs as root. Default 1990. */
  uid?: number;
  /** The texts of the front's own pages, from the interface's message files. */
  texts: Texts;
  /** A stream to the running app of a project, or null if this interface has none running for it. */
  openStream: (projectId: string) => AppStream | null;
  /** Writes one event of a project (journey.preview.live_entered, .live_closed). */
  onEvent: (projectId: string, kind: string, payload: Record<string, unknown>) => Promise<void>;
  onFault?: (message: string, detail: unknown) => void;
  /** The measurements' controls (section 6, M3) may be sent to the front. Never set by main.ts. */
  allowControls?: boolean;
  /** Where the short folder is made (tests). Default `shortBase()`. */
  base?: string;
  /** The tests only: a shorter life for a pass, and for a session (main.ts never sets them). */
  passValidMs?: number;
  sessionMaxMs?: number;
}

/** The events of a live session (the same names as journey.ts's EV.liveOpened, .liveEntered, .liveClosed). */
export const LIVE_EVENTS = {
  opened: "journey.preview.live_opened",
  entered: "journey.preview.live_entered",
  closed: "journey.preview.live_closed",
} as const;

export class LivePreview {
  private dir: string | null = null;
  private front: ChildProcess | null = null;
  private pump: net.Server | null = null;
  private current: LiveSession | null = null;
  /** Why the open session ends at its `endsAt`: its own 8 hours, or the builder sign-in session's expiry. */
  private expiryReason: "expiry" | "builder_session_expired" = "expiry";
  private readonly streams = new Set<{ sock: net.Socket; stream: AppStream }>();
  private timers: NodeJS.Timeout[] = [];
  private stopping = false;
  private listening: Promise<void> | null = null;
  /** How many times the front was started again after it stopped (at most MAX_FRONT_RESTARTS). */
  private restarts = 0;
  /** Connections to the pump socket refused because no session was open and entered (the tests read it). */
  refusedStreams = 0;
  /** Streams opened to the app since start. */
  openedStreams = 0;
  /** The front's process id (the measurements read it). */
  frontPid: number | null = null;

  constructor(private readonly o: LivePreviewOptions) {}

  /** The pump socket's path while the preview runs (the tests connect to it as the front would). */
  pumpSocket(): string | null {
    return this.dir ? join(this.dir, "p.sock") : null;
  }

  /** The front's port on 127.0.0.1. */
  port(): number {
    return this.o.port;
  }

  /** The user the front runs as, in words, for the record. */
  frontUser(): string {
    return process.getuid?.() === 0 ? `uid ${this.uid()} (no name in /etc/passwd)` : `the interface's own user, uid ${process.getuid?.()} (the interface is not root, so it cannot give the front a user of its own)`;
  }

  private uid(): number {
    return this.o.uid ?? DEFAULT_PREVIEW_UID;
  }

  /** Make the folder, listen on the pump socket, start the front; resolves once it listens on 127.0.0.1:<port>. */
  async start(): Promise<void> {
    const root = process.getuid?.() === 0;
    if (root) {
      const why = previewUidRefusal(this.uid());
      if (why) throw new Error(`The preview front's user ${this.uid()} is refused: ${why}. The interface does not start.`);
    }
    const base = this.o.base ?? shortBase();
    // Folders left by an interface that was killed (measurement M2): only those whose socket nobody listens on.
    const stale = removeStaleFolders(base);
    if (stale.length) this.o.onFault?.("Short folders left by an interface that was killed were removed.", { removed: stale });
    const dir = mkdtempSync(join(base, "bpv-"));
    this.dir = dir;
    chmodSync(dir, root ? 0o711 : 0o700);
    // The front's two files, copied: its user cannot reach the builder's folders.
    for (const f of ["preview-front.ts", "preview-rules.ts"]) {
      copyFileSync(join(import.meta.dirname, f), join(dir, f));
      chmodSync(join(dir, f), 0o444);
    }
    writeFileSync(join(dir, "package.json"), '{"type":"module"}\n', { mode: 0o444 });
    const pumpPath = join(dir, "p.sock");
    this.pump = net.createServer((sock) => this.onPump(sock));
    await listenOnSocket(this.pump, pumpPath);
    if (root) chownSync(pumpPath, this.uid(), this.uid());
    chmodSync(pumpPath, 0o600);
    this.forkFront(pumpPath);
    await this.listening;
  }

  private forkFront(pumpPath: string): void {
    const root = process.getuid?.() === 0;
    const child = fork(join(this.dir!, "preview-front.ts"), [], {
      cwd: this.dir!,
      env: { BUILDER_PREVIEW_PORT: String(this.o.port), BUILDER_PREVIEW_PUMP: pumpPath },
      execArgv: [],
      serialization: "json",
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      ...(root ? { uid: this.uid(), gid: this.uid() } : {}),
    });
    this.front = child;
    this.frontPid = child.pid ?? null;
    let errTail = "";
    child.stderr?.on("data", (d: Buffer) => (errTail = (errTail + d.toString("utf8")).slice(-1000)));
    this.listening = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`The preview front did not listen within 20 s: ${errTail.trim().split("\n").pop() ?? ""}`)), 20_000);
      child.on("message", (raw) => {
        const m = fromFrontMessage(raw);
        if (!m) return; // a message of another shape is ignored
        if (m.type === "listening") {
          clearTimeout(t);
          resolve();
        } else void this.onFront(m);
      });
      child.on("exit", (code) => {
        clearTimeout(t);
        reject(new Error(`The preview front stopped (exit code ${code}): ${errTail.trim().split("\n").pop() ?? ""}`));
        if (!this.stopping && this.restarts >= MAX_FRONT_RESTARTS) {
          this.o.onFault?.(`The preview front stopped ${MAX_FRONT_RESTARTS + 1} times; it is not started again until the interface restarts.`, { code });
          void this.closeCurrent("front_stopped");
        } else if (!this.stopping) {
          this.restarts++;
          this.o.onFault?.("The preview front stopped; it is started again.", { code });
          void this.closeCurrent("front_stopped");
          setTimeout(() => {
            if (!this.stopping) {
              this.forkFront(pumpPath);
              this.listening?.catch(() => undefined);
            }
          }, 1000).unref();
        }
      });
    });
    this.listening.catch(() => undefined);
    this.send({ type: "texts", en: this.o.texts.en, ar: this.o.texts.ar });
  }

  private send(m: ToFront): void {
    if (this.front?.connected) this.front.send(m);
  }

  private async onFront(m: NonNullable<ReturnType<typeof fromFrontMessage>>): Promise<void> {
    const c = this.current;
    if (m.type === "entered") {
      if (!c || c.sessionId !== m.sessionId) return;
      c.entered = true;
      c.enteredAt = Date.now();
      await this.event(c.projectId, LIVE_EVENTS.entered, { session: c.sessionId, sec_fetch_site_sent: m.secFetchSite });
    } else if (m.type === "closed") {
      if (!c || c.sessionId !== m.sessionId) return;
      await this.closeCurrent(m.reason === "leave" ? "leave" : this.expiryReason, false);
    } else if (m.type === "refused") {
      if (m.voided && c && !c.entered) await this.closeCurrent("pass_voided");
      else if (m.reason === "expired" && c && !c.entered) await this.closeCurrent("pass_unused");
    }
  }

  private async event(projectId: string, kind: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.o.onEvent(projectId, kind, payload);
    } catch (err) {
      this.o.onFault?.("A live preview event could not be written.", { kind, error: err instanceof Error ? err.name : typeof err });
    }
  }

  /** The open session, if it is this project's. */
  status(projectId: string): LiveSession | null {
    return this.current?.projectId === projectId ? { ...this.current } : null;
  }

  /** The open session, whichever project's. */
  session(): LiveSession | null {
    return this.current ? { ...this.current } : null;
  }

  /**
   * A new session and its pass (section 4.4): any open session ends first ("replaced"). The pass is returned once,
   * to be shown; only its digest is kept, by the front. After J3's review: `builderSessionEndsAt`, when the interface
   * knows it, is when the builder sign-in session that opens this one expires; the live session then ends no later
   * ("builder_session_expired"), as it ends with that session's sign-out.
   */
  async open(o: { projectId: string; builderSession: string; builderSessionEndsAt?: number | null; appStartEventId: string; appPort: number }): Promise<{ pass: string; shown: string; expiresAt: Date; sessionId: string }> {
    if (!this.front?.connected) throw new Error("The preview front is not running.");
    if (this.current) await this.closeCurrent("replaced");
    const now = Date.now();
    const pass = passFromBytes(randomBytes(8));
    const sessionId = `live-${randomBytes(8).toString("hex")}`;
    const prefix = `bp${randomBytes(4).toString("hex")}_`;
    const passMs = this.o.passValidMs ?? PASS_VALID_MS;
    const sessionMs = this.o.sessionMaxMs ?? SESSION_MAX_MS;
    const bound = typeof o.builderSessionEndsAt === "number" && o.builderSessionEndsAt < now + sessionMs;
    const endsAt = bound ? Math.max(now + 1, o.builderSessionEndsAt as number) : now + sessionMs;
    const endReason = bound ? "builder_session_expired" : "expiry";
    this.expiryReason = endReason;
    const s: LiveSession = {
      projectId: o.projectId,
      builderSession: o.builderSession,
      appStartEventId: o.appStartEventId,
      appPort: o.appPort,
      sessionId,
      openedAt: now,
      passExpiresAt: now + passMs,
      endsAt,
      entered: false,
      enteredAt: null,
    };
    this.current = s;
    this.send({ type: "pass", digest: passDigest(pass), expiresAt: s.passExpiresAt, sessionId, prefix, appPort: o.appPort, sessionEndsAt: s.endsAt });
    this.timers.push(
      setTimeout(() => {
        if (this.current?.sessionId === sessionId && !this.current.entered) void this.closeCurrent("pass_unused");
      }, passMs + 1000),
      setTimeout(() => {
        if (this.current?.sessionId === sessionId) void this.closeCurrent(endReason);
      }, endsAt - now),
    );
    for (const t of this.timers) t.unref();
    return { pass, shown: showPass(pass), expiresAt: new Date(s.passExpiresAt), sessionId };
  }

  /** End the session if it is this project's (leave, app stop, project close, the checklist). */
  async closeFor(projectId: string, reason: string): Promise<boolean> {
    if (this.current?.projectId !== projectId) return false;
    await this.closeCurrent(reason);
    return true;
  }

  /**
   * End the session if it belongs to this builder sign-in session: its sign-out ("sign_out"), or, after J3's review,
   * a new sign-in in the same browser that ends it ("signed_in_again").
   */
  async signedOut(builderSession: string | undefined, reason: "sign_out" | "signed_in_again" = "sign_out"): Promise<void> {
    if (builderSession && this.current?.builderSession === builderSession) await this.closeCurrent(reason);
  }

  /** End any session (a halt, a lost lock, the interface stopping). */
  async closeAll(reason: string): Promise<void> {
    if (this.current) await this.closeCurrent(reason);
  }

  private async closeCurrent(reason: string, tellFront = true): Promise<void> {
    const c = this.current;
    if (!c) return;
    this.current = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (tellFront) this.send({ type: "revoke", reason: /^[a-z_]{1,40}$/.test(reason) ? reason : "closed" });
    await this.killStreams();
    await this.event(c.projectId, LIVE_EVENTS.closed, { session: c.sessionId, reason, entered: c.entered });
  }

  private async killStreams(): Promise<void> {
    const all = [...this.streams];
    this.streams.clear();
    for (const s of all) s.sock.destroy();
    await Promise.all(all.map((s) => s.stream.kill().catch(() => undefined)));
  }

  /** Streams open now (the tests and the measurements read it). */
  activeStreams(): number {
    return this.streams.size;
  }

  private onPump(sock: net.Socket): void {
    sock.on("error", () => undefined);
    const c = this.current;
    if (!c || !c.entered || Date.now() >= c.endsAt) {
      this.refusedStreams++;
      sock.destroy();
      return;
    }
    if (this.streams.size >= MAX_PUMP_STREAMS) {
      sock.destroy();
      return;
    }
    let stream: AppStream | null;
    try {
      stream = this.o.openStream(c.projectId);
    } catch (err) {
      this.o.onFault?.("A stream to the app could not be opened.", { error: err instanceof Error ? err.message : String(err) });
      stream = null;
    }
    if (!stream) {
      sock.destroy();
      void this.closeCurrent("app_stopped");
      return;
    }
    this.openedStreams++;
    const entry = { sock, stream };
    this.streams.add(entry);
    sock.pipe(stream.stdin as NodeJS.WritableStream);
    stream.stdout.pipe(sock);
    sock.on("close", () => {
      // The app's bytes are drained from now on, so its stream can end (measurement M2).
      stream.stdout.unpipe(sock);
      stream.stdout.resume();
      if (this.streams.delete(entry)) void stream.kill().catch(() => undefined);
    });
    void stream.done.then(() => {
      this.streams.delete(entry);
      sock.end();
    });
  }

  /** The measurements' controls (M3); refused unless the preview was made with `allowControls`. */
  controls(controls: MappingControls, cspSandbox: boolean): void {
    if (!this.o.allowControls) throw new Error("This preview takes no controls.");
    this.send({ type: "controls", controls, cspSandbox });
  }

  /** Send the front a raw message (the tests: a message of another shape must be ignored). Only with `allowControls`. */
  sendRaw(m: unknown): void {
    if (!this.o.allowControls) throw new Error("This preview takes no raw messages.");
    if (this.front?.connected) this.front.send(m as never);
  }

  /** Stop the front, close the pump socket, kill every stream, remove the folder. */
  async stop(reason = "interface_stopped"): Promise<void> {
    this.stopping = true;
    await this.closeAll(reason);
    const child = this.front;
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((r) => child.once("exit", () => r()));
      this.send({ type: "stop" });
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await new Promise<void>((r) => (this.pump ? this.pump.close(() => r()) : r()));
    if (this.dir) rmSync(this.dir, { recursive: true, force: true });
    this.dir = null;
  }
}

/**
 * The live camera's socket (section 4.8): a folder of the runner's user 1001, mode 750, holding `c.sock` (the
 * runner's, mode 600). Its connections are passed, byte for byte, to the front on 127.0.0.1:`frontPort`. The folder
 * is mounted read-only at /psock in the camera's container.
 */
export async function cameraSocket(frontPort: number, o: { base?: string; log?: (line: string) => void } = {}): Promise<{ dir: string; socket: string; close: () => Promise<void> }> {
  const dir = mkdtempSync(join(o.base ?? shortBase(), "bpc-"));
  const root = process.getuid?.() === 0;
  chmodSync(dir, root ? 0o750 : 0o755);
  if (root) chownSync(dir, RUNNER_UID, RUNNER_UID);
  const socket = join(dir, "c.sock");
  const server = createForwarder(socket, { host: "127.0.0.1", port: frontPort }, (r) => o.log?.(JSON.stringify(r)));
  await listenOnSocket(server, socket);
  if (root) chownSync(socket, RUNNER_UID, RUNNER_UID);
  else chmodSync(socket, 0o666);
  return {
    dir,
    socket,
    close: () =>
      new Promise<void>((r) =>
        server.close(() => {
          rmSync(dir, { recursive: true, force: true });
          r();
        }),
      ),
  };
}
