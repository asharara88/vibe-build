/**
 * Sign-in for the builder's own interface (package J1): one user, one password. A prototype's sign-in, not
 * single sign-on and not hardened (design note, section 9). THIS IS PASSWORD HANDLING WRITTEN BY HAND, with
 * Node's own scrypt: it is on the reviewing engineer's list, as known gap 6 says for generated apps.
 *
 * - The password is kept only as a scrypt digest (salt and settings stored with it) and compared with
 *   `timingSafeEqual`. It comes from BUILDER_UI_PASSWORD (automated runs), which `main.ts` deletes from
 *   `process.env` once read (so no child process inherits it; the process's starting environment, readable in
 *   /proc/<pid>/environ by the same user or root, still holds it), or is chosen by the first visitor when BUILDER_UI_FIRST_RUN=1 and none is set
 *   yet: its digest is then written to a file in BUILDER_DATA_DIR with mode 0600, and no password passes
 *   through the conversation or the repository.
 * - A session id is 32 random bytes, kept in memory with an expiry on the server; the cookie is HttpOnly,
 *   SameSite=Strict, Path=/. Sessions end when the process ends.
 * - Failed sign-ins are limited for the whole server, not per address (through a tunnel every request may
 *   come from 127.0.0.1): 5 failures, then a lock-out that doubles each time. The route reads the lock-out
 *   after the request's body has arrived, immediately before the check (review of 13 Nov 2026).
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";

export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 1024;
export const PASSWORD_FILE = "ui-password.scrypt";
export const SESSION_COOKIE = "builder_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

/** "scrypt$N$r$p$salt$hash", salt and hash in base64url. */
export function digestPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export function verifyPassword(password: string, digest: string): boolean {
  const parts = digest.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  const salt = Buffer.from(parts[4]!, "base64url");
  const expected = Buffer.from(parts[5]!, "base64url");
  if (![N, r, p].every((x) => Number.isInteger(x) && x > 0) || expected.length !== SCRYPT.keylen || password.length > MAX_PASSWORD) return false;
  const got = scryptSync(password, salt, expected.length, { N, r, p, maxmem: SCRYPT.maxmem });
  return timingSafeEqual(got, expected);
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `The password must be ${MIN_PASSWORD} characters or more.`;
  if (password.length > MAX_PASSWORD) return `The password must be at most ${MAX_PASSWORD} characters.`;
  return null;
}

/**
 * Where the password's digest comes from. `env`: BUILDER_UI_PASSWORD was set (it is digested and forgotten).
 * `file`: chosen earlier on the first-run page. `first_run`: none yet, and the first visitor chooses it.
 */
export class PasswordState {
  private digest: string | null;
  constructor(
    readonly source: "env" | "file" | "first_run",
    digest: string | null,
    private readonly file: string | null,
  ) {
    this.digest = digest;
  }

  get isSet(): boolean {
    return this.digest !== null;
  }

  /**
   * Synchronous on purpose (scryptSync): the sign-in route reads the lock-out, checks and records a failure with
   * no await between them, so attempts that arrive at the same moment are judged one after the other.
   */
  check(password: string): boolean {
    // With no password set, a sign-in is refused after the same work, so its timing does not say so.
    if (this.digest === null) {
      verifyPassword(password, digestPassword("not-set-" + randomBytes(8).toString("hex")));
      return false;
    }
    return verifyPassword(password, this.digest);
  }

  /**
   * First run only: write the chosen password's digest to the file, created exclusively with mode 0600, so
   * that of two visitors at once only one can set it. Returns false if it is already set.
   */
  choose(password: string): boolean {
    if (this.digest !== null || this.source !== "first_run" || !this.file) return false;
    const digest = digestPassword(password);
    let fd: number;
    try {
      fd = openSync(this.file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    } catch {
      return false;
    }
    try {
      writeSync(fd, digest + "\n");
    } finally {
      closeSync(fd);
    }
    this.digest = digest;
    return true;
  }
}

/**
 * The password's source at start. BUILDER_UI_PASSWORD wins when set. Otherwise the digest file in the data
 * folder, if it exists (it must be a plain file, ours, readable by its owner only). Otherwise, only with
 * BUILDER_UI_FIRST_RUN=1, the first-run page. Otherwise the start is refused (thrown, in plain words).
 */
export function passwordFromSettings(env: NodeJS.ProcessEnv, dataDir: string): PasswordState {
  const file = join(dataDir, PASSWORD_FILE);
  const fromEnv = env.BUILDER_UI_PASSWORD;
  if (fromEnv !== undefined && fromEnv !== "") {
    const p = passwordProblem(fromEnv);
    if (p) throw new Error(`BUILDER_UI_PASSWORD is not accepted: ${p} The interface does not start.`);
    return new PasswordState("env", digestPassword(fromEnv), null);
  }
  const st = statSync(file, { throwIfNoEntry: false });
  if (st) {
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const f = fstatSync(fd);
      if (!f.isFile()) throw new Error(`${file} is not a plain file. The interface does not start.`);
      if ((f.mode & 0o077) !== 0) throw new Error(`${file} can be read by others (mode ${(f.mode & 0o777).toString(8)}); it must be 600. The interface does not start.`);
      if (typeof process.getuid === "function" && f.uid !== process.getuid()) throw new Error(`${file} belongs to another user. The interface does not start.`);
    } finally {
      closeSync(fd);
    }
    const digest = readFileSync(file, "utf8").trim();
    if (!/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(digest)) throw new Error(`${file} does not hold a password digest. The interface does not start.`);
    return new PasswordState("file", digest, file);
  }
  if (env.BUILDER_UI_FIRST_RUN === "1") return new PasswordState("first_run", null, file);
  throw new Error(
    "No password for the interface: set BUILDER_UI_PASSWORD (12 characters or more), or set BUILDER_UI_FIRST_RUN=1 to choose it on the first visit. The interface does not start.",
  );
}

/** Sessions in memory, each with its expiry on the server. */
export class Sessions {
  private readonly byId = new Map<string, number>();
  constructor(private readonly ttlMs: number = SESSION_TTL_MS) {}

  create(now = Date.now()): string {
    for (const [id, exp] of this.byId) if (exp <= now) this.byId.delete(id);
    const id = randomBytes(32).toString("base64url");
    this.byId.set(id, now + this.ttlMs);
    return id;
  }

  valid(id: string | undefined, now = Date.now()): boolean {
    if (!id) return false;
    const exp = this.byId.get(id);
    if (exp === undefined) return false;
    if (exp <= now) {
      this.byId.delete(id);
      return false;
    }
    return true;
  }

  end(id: string | undefined): void {
    if (id) this.byId.delete(id);
  }

  /** When a valid session expires (milliseconds since 1970), or null if it is not one (package J3, after its review). */
  expiresAt(id: string | undefined, now = Date.now()): number | null {
    return id && this.valid(id, now) ? this.byId.get(id)! : null;
  }

  get count(): number {
    return this.byId.size;
  }
}

/** Failed sign-ins for the whole server: after `limit` failures a lock-out of `baseMs`, doubling each time, up to `maxMs`. */
export class SignInLimiter {
  private failures = 0;
  private lockouts = 0;
  private lockedUntil = 0;
  constructor(
    readonly limit = 5,
    readonly baseMs = 30_000,
    readonly maxMs = 60 * 60 * 1000,
  ) {}

  /** Milliseconds left of a lock-out, or 0. While locked, even the right password is refused. */
  lockedFor(now = Date.now()): number {
    return Math.max(0, this.lockedUntil - now);
  }

  fail(now = Date.now()): void {
    this.failures++;
    if (this.failures >= this.limit) {
      this.lockedUntil = now + Math.min(this.baseMs * 2 ** this.lockouts, this.maxMs);
      this.lockouts++;
      this.failures = 0;
    }
  }

  succeed(): void {
    this.failures = 0;
    this.lockouts = 0;
  }
}
