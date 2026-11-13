/**
 * Fetching the approved browser zip into the cache (package 3.1b; the third outside review supplied by
 * the owner, item 3). scripts/fetch-browser.ts calls this with the recorded address, BROWSER_ZIP_URL; a
 * test gives a stand-in server's address and what it serves instead (`testSource`), never the script.
 *
 * The rules, each checked by builder/test/browser-fetch.test.ts:
 * - The cache folder is an absolute path outside the repository, reached through no link; it is made
 *   (mode 0700) if it is not there.
 * - A file already at the zip's place is never replaced: if it is the approved zip (size and SHA-256) the
 *   fetch says so and downloads nothing; a link, a folder or any other file is refused and left alone.
 * - The download goes through the proxy the environment names for that kind of address (HTTPS_PROXY or
 *   https_proxy for https, HTTP_PROXY or http_proxy for http, unless NO_PROXY or no_proxy lists the host),
 *   by a tunnel (CONNECT), and TLS is checked with the trust Node already has (NODE_EXTRA_CA_CERTS names the
 *   session's certificate in a cloud session). A proxy's user name and password are sent to it, never
 *   printed: only its host and port are named.
 * - Only an answer 200 is read; a move elsewhere (3xx) is refused, not followed.
 * - A time limit for the whole download and one for silence; a size limit: a stated length other than the
 *   approved size is refused before anything is written, and the download stops as soon as more than the
 *   approved size arrives.
 * - An answer refused at its headers is not read on: it is destroyed with its connection (and the tunnel, through
 *   a proxy) before the refusal is given, since the time limits end with the refusal (the review bot on 1ebe1cc).
 * - The bytes go to a new temporary file in the same folder (created exclusively, so not through a link);
 *   its size and SHA-256 are checked on disk before it is moved into place, which is done by a hard link
 *   that fails if anything is at the zip's place by then, so nothing is replaced. On any mismatch or
 *   failure the temporary file is deleted.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, realpathSync, rmSync, writeSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { isAbsolute, join, resolve } from "node:path";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import tls from "node:tls";
import { BROWSER_ZIP, BROWSER_ZIP_BYTES, BROWSER_ZIP_SHA256, BROWSER_ZIP_URL, sha256File } from "./runner-image.js";
import { insideOrEqual, realpathAsFar, REPO_ROOT } from "./store.js";

/** A refusal: the message says what was found and that nothing was replaced. */
export class FetchRefused extends Error {}

/** The whole download must end within this (the zip is about 120 MB). */
export const FETCH_TIME_LIMIT_MS = 20 * 60_000;
/** The download is stopped when nothing arrives for this long. */
export const FETCH_SILENCE_LIMIT_MS = 60_000;

export interface FetchOptions {
  /** The cache folder (BUILDER_BROWSER_CACHE). */
  cacheDir: string;
  /** Tests only: a stand-in server's address and exactly what it should serve. The script never sets it. */
  testSource?: { url: string; sha256: string; bytes: number };
  /** Where the proxy settings are read from; default: this process's environment. */
  env?: NodeJS.ProcessEnv;
  timeLimitMs?: number;
  silenceLimitMs?: number;
  log?: (line: string) => void;
}

export interface FetchResult {
  path: string;
  sha256: string;
  bytes: number;
  /** False when the approved zip was already there and nothing was downloaded. */
  fetched: boolean;
  /** "directly", or "through the proxy at host:port": never a user name or password. */
  via: string;
}

/** True if NO_PROXY (as a list of host names, "*" for all) covers the host. Ports and a leading "*." or "." are ignored. */
export function noProxyCovers(host: string, noProxy: string | undefined): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  for (let entry of (noProxy ?? "").split(/[\s,]+/)) {
    entry = entry.trim().toLowerCase();
    if (!entry) continue;
    if (entry === "*") return true;
    entry = entry.replace(/^\*?\./, "").replace(/:\d+$/, "");
    if (h === entry || h.endsWith(`.${entry}`)) return true;
  }
  return false;
}

/** The proxy the environment names for this address, or null. Throws FetchRefused, naming only the setting, if it is not an http:// address. */
export function proxyFor(url: URL, env: NodeJS.ProcessEnv): { url: URL; setting: string } | null {
  const names = url.protocol === "https:" ? ["HTTPS_PROXY", "https_proxy"] : ["HTTP_PROXY", "http_proxy"];
  const setting = names.find((n) => env[n]);
  if (!setting) return null;
  if (noProxyCovers(url.hostname, env.NO_PROXY ?? env.no_proxy)) return null;
  let proxy: URL;
  try {
    proxy = new URL(env[setting]!);
  } catch {
    throw new FetchRefused(`The proxy setting ${setting} is not an address; nothing was fetched.`);
  }
  if (proxy.protocol !== "http:" || !proxy.hostname) throw new FetchRefused(`The proxy setting ${setting} is not an http:// address; only such a proxy is supported; nothing was fetched.`);
  return { url: proxy, setting };
}

const hostPort = (u: URL) => `${u.hostname}:${u.port || (u.protocol === "https:" ? "443" : "80")}`;

/**
 * Ask for an address, directly or through the environment's proxy, and give back the answer (headers read,
 * body not yet). The request is cut when `signal` fires. Exported so that the evidence can show the tunnel
 * and TLS path through the session's proxy against a host it lets through.
 */
export async function requestThroughEnv(target: URL, env: NodeJS.ProcessEnv, signal: AbortSignal, method = "GET"): Promise<{ res: http.IncomingMessage; via: string }> {
  if (target.protocol !== "https:" && target.protocol !== "http:") throw new FetchRefused(`${target.protocol} addresses are not fetched.`);
  const proxy = proxyFor(target, env);
  const headers = { "accept-encoding": "identity", "user-agent": "builder-fetch-browser" };
  const answer = (req: http.ClientRequest) =>
    new Promise<http.IncomingMessage>((ok, fail) => {
      req.on("response", ok);
      req.on("error", fail);
      req.end();
    });
  if (!proxy) {
    const mod = target.protocol === "https:" ? https : http;
    const req = mod.request(target, { method, headers, agent: false, signal });
    return { res: await answer(req), via: "directly" };
  }
  const via = `through the proxy at ${hostPort(proxy.url)} (${proxy.setting})`;
  const auth = proxy.url.username || proxy.url.password ? { "proxy-authorization": `Basic ${Buffer.from(`${decodeURIComponent(proxy.url.username)}:${decodeURIComponent(proxy.url.password)}`).toString("base64")}` } : {};
  if (target.protocol === "http:") {
    // A plain address through a proxy: the whole address is the request's path.
    const req = http.request({ host: proxy.url.hostname, port: Number(proxy.url.port || 80), method, path: target.href, headers: { ...headers, host: target.host, ...auth }, agent: false, signal });
    return { res: await answer(req), via };
  }
  const tunnel = hostPort(target);
  const socket = await new Promise<import("node:net").Socket>((ok, fail) => {
    const req = http.request({ host: proxy.url.hostname, port: Number(proxy.url.port || 80), method: "CONNECT", path: tunnel, headers: { host: tunnel, ...auth }, agent: false, signal });
    req.on("connect", (res, sock) => {
      res.resume();
      if (res.statusCode === 200) ok(sock);
      else {
        sock.destroy();
        fail(new FetchRefused(`The proxy at ${hostPort(proxy.url)} refused the tunnel to ${tunnel}: it answered ${res.statusCode} ${res.statusMessage ?? ""}`.trimEnd() + ". Nothing was fetched."));
      }
    });
    req.on("response", (res) => {
      // Node gives every answer to CONNECT as "connect", so this is not expected; if it comes, it is not read on.
      res.destroy();
      fail(new FetchRefused(`The proxy at ${hostPort(proxy.url)} answered ${res.statusCode} to the tunnel request for ${tunnel}. Nothing was fetched.`));
    });
    req.on("error", fail);
    req.end();
  });
  // No agent: Node uses createConnection only when the request has none. (With `agent: false`, Node makes a fresh
  // agent, ignores createConnection and connects directly, which is what the first try at the real address did.)
  const req = https.request(target, { method, headers, signal, createConnection: () => tls.connect({ socket, servername: target.hostname }) });
  return { res: await answer(req), via };
}

/**
 * Fetch the approved browser zip into the cache folder, under the rules at the top of this file.
 * Resolves with what is in place; rejects with FetchRefused (or a network error) and leaves no temporary file.
 */
export async function fetchBrowserZip(opts: FetchOptions): Promise<FetchResult> {
  const log = opts.log ?? (() => undefined);
  const want = opts.testSource ?? { url: BROWSER_ZIP_URL, sha256: BROWSER_ZIP_SHA256, bytes: BROWSER_ZIP_BYTES };
  const env = opts.env ?? process.env;

  // The cache folder.
  const dir = opts.cacheDir;
  if (!dir || !isAbsolute(dir)) throw new FetchRefused(`The cache folder must be an absolute path; "${dir}" is not. Nothing was fetched.`);
  const abs = resolve(dir);
  const forbidden = realpathAsFar(REPO_ROOT);
  if (insideOrEqual(realpathAsFar(abs), forbidden) || insideOrEqual(abs, forbidden)) throw new FetchRefused(`The cache folder ${abs} is inside the repository; the zip is kept outside it. Nothing was fetched.`);
  if (realpathAsFar(abs) !== abs) throw new FetchRefused(`The cache folder ${abs} is reached through a link, which is not followed. Nothing was fetched.`);
  mkdirSync(abs, { recursive: true, mode: 0o700 });
  if (realpathSync(abs) !== abs || !lstatSync(abs).isDirectory()) throw new FetchRefused(`The cache folder ${abs} is not a plain folder (a link is not followed). Nothing was fetched.`);

  // What is at the zip's place already.
  const finalPath = join(abs, BROWSER_ZIP);
  const there = lstatSync(finalPath, { throwIfNoEntry: false });
  if (there) {
    if (there.isSymbolicLink()) throw new FetchRefused(`${finalPath} is a link; it is not followed or replaced. Remove it yourself if it should go. Nothing was fetched.`);
    if (!there.isFile()) throw new FetchRefused(`${finalPath} is not a plain file; it is not replaced. Nothing was fetched.`);
    const sha = await sha256File(finalPath);
    if (there.size === want.bytes && sha === want.sha256) {
      log(`The approved zip is already at ${finalPath} (${there.size} bytes, SHA-256 ${sha}); nothing was downloaded.`);
      return { path: finalPath, sha256: sha, bytes: there.size, fetched: false, via: "not asked" };
    }
    throw new FetchRefused(`${finalPath} is another file (${there.size} bytes, SHA-256 ${sha}), not the approved zip (${want.bytes} bytes, SHA-256 ${want.sha256}); it is not replaced. Remove it yourself if it should go. Nothing was fetched.`);
  }

  // The download, into a new temporary file in the same folder.
  const target = new URL(want.url);
  const tmp = join(abs, `.${BROWSER_ZIP}.${randomBytes(6).toString("hex")}.part`);
  const fd = openSync(tmp, "wx", 0o600); // exclusive: fails if anything, a link included, is at that name
  const limit = opts.timeLimitMs ?? FETCH_TIME_LIMIT_MS;
  const silence = opts.silenceLimitMs ?? FETCH_SILENCE_LIMIT_MS;
  const ctl = new AbortController();
  let stopped: string | null = null;
  const stop = (why: string) => {
    if (stopped === null) stopped = why;
    ctl.abort(new FetchRefused(why));
  };
  const whole = setTimeout(() => stop(`The download did not end within its time limit (${limit / 1000} s); it was stopped.`), limit);
  let quiet: NodeJS.Timeout | undefined;
  const heard = () => {
    clearTimeout(quiet);
    quiet = setTimeout(() => stop(`Nothing arrived for ${silence / 1000} s; the download was stopped.`), silence);
  };
  let fdOpen = true;
  try {
    heard();
    log(`Asking ${target.href} for the zip.`);
    let res: http.IncomingMessage;
    let via: string;
    try {
      ({ res, via } = await requestThroughEnv(target, env, ctl.signal));
    } catch (err) {
      if (stopped) throw new FetchRefused(stopped);
      throw err;
    }
    log(`It answered ${res.statusCode}, ${via}.`);
    if (res.statusCode !== 200) {
      res.destroy(); // not read on: the answer and its connection are closed before the refusal (the time limits end with it)
      const moved = res.statusCode !== undefined && res.statusCode >= 300 && res.statusCode < 400;
      throw new FetchRefused(`${target.host} answered ${res.statusCode} ${res.statusMessage ?? ""}`.trimEnd() + `${moved ? " (a move elsewhere; it is not followed)" : ""}. Nothing was put in place.`);
    }
    const stated = res.headers["content-length"];
    if (stated !== undefined && Number(stated) !== want.bytes) {
      res.destroy(); // as above
      throw new FetchRefused(`${target.host} says the file is ${stated} bytes, not the approved ${want.bytes}. Nothing was put in place.`);
    }
    let received = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        heard();
        received += chunk.length;
        if (received > want.bytes) return done(new FetchRefused(`More than the approved ${want.bytes} bytes arrived; the download was stopped. Nothing was put in place.`));
        done(null, chunk);
      },
    });
    // Written to the temporary file's own descriptor, which this function alone closes.
    const out = new Writable({
      write(chunk: Buffer, _enc, done) {
        try {
          for (let at = 0; at < chunk.length; ) at += writeSync(fd, chunk, at, chunk.length - at);
          done();
        } catch (err) {
          done(err as Error);
        }
      },
    });
    try {
      await pipeline(res, counter, out, { signal: ctl.signal });
    } catch (err) {
      if (err instanceof FetchRefused) throw err;
      if (stopped) throw new FetchRefused(stopped);
      throw err;
    }
    fsyncSync(fd);
    closeSync(fd);
    fdOpen = false;

    // Checked on disk, not only as it arrived.
    const size = lstatSync(tmp).size;
    if (size !== want.bytes) throw new FetchRefused(`The download is ${size} bytes, not the approved ${want.bytes}. Nothing was put in place.`);
    const sha = await sha256File(tmp);
    if (sha !== want.sha256) throw new FetchRefused(`The download has SHA-256 ${sha}, not the approved ${want.sha256}. Nothing was put in place.`);

    chmodSync(tmp, 0o644);
    try {
      linkSync(tmp, finalPath); // fails if anything is at the zip's place by now: nothing is replaced
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new FetchRefused(`Something appeared at ${finalPath} during the download; it is not replaced. Nothing was put in place.`);
      throw err;
    }
    log(`Put in place: ${finalPath}, ${size} bytes, SHA-256 ${sha} (the approved zip).`);
    return { path: finalPath, sha256: sha, bytes: size, fetched: true, via };
  } finally {
    clearTimeout(whole);
    clearTimeout(quiet);
    if (fdOpen) closeSync(fd);
    rmSync(tmp, { force: true });
  }
}
