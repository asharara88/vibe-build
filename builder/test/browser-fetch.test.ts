/**
 * Package 3.1b: fetching the approved browser zip (src/acceptance/browser-fetch.ts, used by
 * scripts/fetch-browser.ts), against a stand-in HTTP server and a stand-in proxy on this machine's loopback
 * address. The stand-ins serve made-up bytes; the test gives their address and what they should serve
 * (`testSource`), which the script never does. Nothing here reaches beyond the machine.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchBrowserZip, FetchRefused, noProxyCovers, type FetchOptions } from "../src/acceptance/browser-fetch.js";
import { BROWSER_ZIP, BROWSER_ZIP_BYTES, BROWSER_ZIP_SHA256, BROWSER_ZIP_URL } from "../src/acceptance/runner-image.js";
import { REPO_ROOT, sha256 } from "../src/acceptance/store.js";

const scratch = mkdtempSync(join(tmpdir(), "builder-browser-fetch-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Made-up bytes standing in for the zip. */
const BODY = randomBytes(300_000);
const SOURCE = { sha256: sha256(BODY), bytes: BODY.length };

/** What the stand-in server does for each path; every request it gets is recorded. */
const seen: string[] = [];
let server: http.Server;
let base = "";
beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push(req.url ?? "");
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/zip") {
      res.writeHead(200, { "content-length": BODY.length });
      res.end(BODY);
    } else if (path === "/short") {
      const b = BODY.subarray(0, BODY.length - 1);
      res.writeHead(200, { "content-length": b.length });
      res.end(b);
    } else if (path === "/other-bytes") {
      const b = Buffer.from(BODY);
      b[1000] = b[1000]! ^ 0xff;
      res.writeHead(200, { "content-length": b.length });
      res.end(b);
    } else if (path === "/endless") {
      // No length stated, and more than the approved size: it goes on until the client stops reading.
      res.writeHead(200);
      const more = () => {
        while (res.write(randomBytes(64 * 1024)) && !res.destroyed) {
          /* keep writing */
        }
        if (!res.destroyed) res.once("drain", more);
      };
      res.on("close", () => seen.push("closed /endless"));
      more();
    } else if (path === "/cut-short") {
      // Says the right length, then the connection ends early.
      res.writeHead(200, { "content-length": BODY.length });
      res.write(BODY.subarray(0, 1000));
      setTimeout(() => res.destroy(), 50);
    } else if (path === "/stall") {
      res.writeHead(200, { "content-length": BODY.length });
      res.write(BODY.subarray(0, 1000)); // then nothing
    } else if (path === "/trickle") {
      res.writeHead(200, { "content-length": BODY.length });
      let at = 0;
      const t = setInterval(() => {
        if (res.destroyed || at >= BODY.length) return clearInterval(t);
        res.write(BODY.subarray(at, at + 10));
        at += 10;
      }, 50);
      res.on("close", () => clearInterval(t));
    } else if (path === "/moved") {
      res.writeHead(302, { location: "/zip-elsewhere" });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((ok) => server.close(ok));
});

let n = 0;
const freshCache = () => join(scratch, `cache-${++n}`);
/** Fetch from the stand-in, with no proxy setting at all. */
const fetchFrom = (path: string, cacheDir: string, extra: Partial<FetchOptions> = {}) =>
  fetchBrowserZip({ cacheDir, testSource: { url: `${base}${path}`, ...SOURCE }, env: {}, ...extra });
/** The folder holds no temporary file of a fetch (and nothing else but what is listed). */
const left = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort() : []);

describe("fetching the approved browser zip (stand-in server, made-up bytes)", () => {
  it("the script's address and the approved size and fingerprint are the recorded ones", () => {
    expect(BROWSER_ZIP_URL).toBe("https://storage.googleapis.com/chrome-for-testing-public/153.0.8010.12/linux64/chrome-headless-shell-linux64.zip");
    expect(BROWSER_ZIP_BYTES).toBe(119_809_080);
    expect(BROWSER_ZIP_SHA256).toBe("a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d");
    // The script passes no address of its own: only the cache folder and its log.
    const script = readFileSync(join(REPO_ROOT, "builder", "scripts", "fetch-browser.ts"), "utf8");
    expect(script).toContain("fetchBrowserZip({ cacheDir, log: (l) => console.log(l) })");
    expect(script).not.toMatch(/testSource|https?:\/\/(?!storage\.googleapis)/);
  });

  it("fetches into a new cache folder (made 0700): the zip in place is a plain file with the size and SHA-256 given; no temporary file is left", async () => {
    const cache = freshCache();
    const lines: string[] = [];
    const r = await fetchFrom("/zip", cache, { log: (l) => lines.push(l) });
    expect(r).toMatchObject({ path: join(cache, BROWSER_ZIP), sha256: SOURCE.sha256, bytes: SOURCE.bytes, fetched: true, via: "directly" });
    expect(statSync(cache).mode & 0o777).toBe(0o700);
    const st = lstatSync(join(cache, BROWSER_ZIP));
    expect(st.isFile()).toBe(true);
    expect(sha256(readFileSync(join(cache, BROWSER_ZIP)))).toBe(SOURCE.sha256);
    expect(left(cache)).toEqual([BROWSER_ZIP]);
    expect(lines.join("\n")).toMatch(/Put in place: .*\(the approved zip\)\./);
  });

  it("a second fetch finds the approved zip there, asks the server nothing and changes nothing", async () => {
    const cache = freshCache();
    await fetchFrom("/zip", cache);
    const asked = seen.length;
    const before = lstatSync(join(cache, BROWSER_ZIP));
    const r = await fetchFrom("/zip", cache);
    expect(r).toMatchObject({ fetched: false, sha256: SOURCE.sha256, bytes: SOURCE.bytes });
    expect(seen.length).toBe(asked);
    expect(lstatSync(join(cache, BROWSER_ZIP)).mtimeMs).toBe(before.mtimeMs);
  });

  it("size: a stated length other than the approved size is refused before anything is written", async () => {
    const cache = freshCache();
    await expect(fetchFrom("/short", cache)).rejects.toThrow(new RegExp(`says the file is ${SOURCE.bytes - 1} bytes, not the approved ${SOURCE.bytes}`));
    expect(left(cache)).toEqual([]);
  });

  it("size: with no length stated, the download stops as soon as more than the approved size arrives", async () => {
    const cache = freshCache();
    const err = await fetchFrom("/endless", cache, { timeLimitMs: 30_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchRefused);
    expect((err as Error).message).toMatch(new RegExp(`More than the approved ${SOURCE.bytes} bytes arrived; the download was stopped`));
    expect(left(cache)).toEqual([]);
    await new Promise((r) => setTimeout(r, 200));
    expect(seen).toContain("closed /endless");
  });

  it("SHA-256: a download of the approved size with other bytes is refused and deleted; nothing is put in place", async () => {
    const cache = freshCache();
    await expect(fetchFrom("/other-bytes", cache)).rejects.toThrow(new RegExp(`has SHA-256 [0-9a-f]{64}, not the approved ${SOURCE.sha256}\\. Nothing was put in place`));
    expect(left(cache)).toEqual([]);
  });

  it("a connection that ends before the stated length is a failure; nothing is put in place", async () => {
    const cache = freshCache();
    await expect(fetchFrom("/cut-short", cache)).rejects.toThrow();
    expect(left(cache)).toEqual([]);
  });

  it("an answer other than 200 is refused; a move elsewhere (302) is not followed", async () => {
    const cache = freshCache();
    await expect(fetchFrom("/no-such-file", cache)).rejects.toThrow(/answered 404/);
    await expect(fetchFrom("/moved", cache)).rejects.toThrow(/answered 302 .*a move elsewhere; it is not followed/);
    expect(seen).not.toContain("/zip-elsewhere");
    expect(left(cache)).toEqual([]);
  });

  it("time limits: a download that goes silent is stopped; one that goes on too long is stopped; no file is left", async () => {
    const cache = freshCache();
    await expect(fetchFrom("/stall", cache, { silenceLimitMs: 300 })).rejects.toThrow(/Nothing arrived for 0\.3 s; the download was stopped/);
    await expect(fetchFrom("/trickle", cache, { timeLimitMs: 400, silenceLimitMs: 10_000 })).rejects.toThrow(/did not end within its time limit \(0\.4 s\)/);
    expect(left(cache)).toEqual([]);
  });

  it("never replaces what is at the zip's place: another file, a link or a folder is refused, left as it was, and the server is not asked", async () => {
    const asked = seen.length;
    const other = freshCache();
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, BROWSER_ZIP), "made-up, not the zip");
    await expect(fetchFrom("/zip", other)).rejects.toThrow(/is another file .* it is not replaced/);
    expect(readFileSync(join(other, BROWSER_ZIP), "utf8")).toBe("made-up, not the zip");
    const linked = freshCache();
    mkdirSync(linked, { recursive: true });
    symlinkSync(join(other, BROWSER_ZIP), join(linked, BROWSER_ZIP));
    await expect(fetchFrom("/zip", linked)).rejects.toThrow(/is a link; it is not followed or replaced/);
    expect(lstatSync(join(linked, BROWSER_ZIP)).isSymbolicLink()).toBe(true);
    const folder = freshCache();
    mkdirSync(join(folder, BROWSER_ZIP), { recursive: true });
    await expect(fetchFrom("/zip", folder)).rejects.toThrow(/is not a plain file; it is not replaced/);
    expect(seen.length).toBe(asked);
  });

  it("the cache folder: a relative path, a folder inside the repository, and a folder reached through a link are refused", async () => {
    await expect(fetchFrom("/zip", "relative/cache")).rejects.toThrow(/must be an absolute path/);
    await expect(fetchFrom("/zip", join(REPO_ROOT, "builder", "browser-cache-made-up"))).rejects.toThrow(/inside the repository/);
    expect(existsSync(join(REPO_ROOT, "builder", "browser-cache-made-up"))).toBe(false);
    const real = freshCache();
    mkdirSync(real, { recursive: true });
    const viaLink = join(scratch, `link-${++n}`);
    symlinkSync(real, viaLink);
    await expect(fetchFrom("/zip", viaLink)).rejects.toThrow(/reached through a link, which is not followed/);
    await expect(fetchFrom("/zip", join(viaLink, "inner"))).rejects.toThrow(/reached through a link, which is not followed/);
    expect(left(real)).toEqual([]);
  });
});

describe("fetching through the environment's proxy (stand-in proxy)", () => {
  let proxy: http.Server;
  let proxyPort = 0;
  const asked: Array<{ method: string; url: string; auth: string | undefined }> = [];
  /** A stand-in TLS server for zip.test, with a certificate made for this run (openssl), and what each tunnel to it carried. */
  let tlsServer: https.Server;
  let tlsPort = 0;
  let testCert = "";
  const carried: Array<{ toServer: number; toClient: number }> = [];
  /** The tunnels' sockets: a server's close does not end them, so they are ended here. */
  const open = new Set<net.Socket>();
  /** Bytes the client sent inside each tunnel the proxy let through. */
  const tunnelled: number[] = [];
  beforeAll(async () => {
    proxy = http.createServer((req, res) => {
      // A plain address through the proxy: the request's path is the whole address. It serves the zip itself.
      asked.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers["proxy-authorization"] });
      res.writeHead(200, { "content-length": BODY.length });
      res.end(BODY);
    });
    proxy.on("connect", (req, socket) => {
      open.add(socket as net.Socket);
      asked.push({ method: "CONNECT", url: req.url ?? "", auth: req.headers["proxy-authorization"] });
      if (req.url === "zip.test:443") {
        // Lets the tunnel through to the stand-in TLS server, counting the bytes each way.
        const upstream = net.connect(tlsPort, "127.0.0.1", () => {
          open.add(upstream);
          socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
          const counted = { toServer: 0, toClient: 0 };
          carried.push(counted);
          socket.on("data", (d: Buffer) => (counted.toServer += d.length));
          upstream.on("data", (d: Buffer) => (counted.toClient += d.length));
          socket.pipe(upstream).pipe(socket);
        });
        upstream.on("error", () => socket.destroy());
        socket.on("error", () => upstream.destroy());
        return;
      }
      if (req.url === "reset.invalid:443") {
        // Lets the tunnel through, then resets it, as the session's proxy closed the real tunnel (13 Nov 2026).
        socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
        socket.once("data", (d: Buffer) => {
          tunnelled.push(d.length);
          (socket as import("node:net").Socket).resetAndDestroy();
        });
        return;
      }
      // Every other tunnel is refused, as a proxy refuses a host it does not let through.
      socket.end("HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n");
    });
    await new Promise<void>((ok) => proxy.listen(0, "127.0.0.1", ok));
    proxyPort = (proxy.address() as AddressInfo).port;
    const certDir = mkdtempSync(join(scratch, "cert-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", join(certDir, "key.pem"), "-out", join(certDir, "cert.pem"), "-subj", "/CN=zip.test", "-addext", "subjectAltName=DNS:zip.test", "-days", "1"], { stdio: "ignore" });
    testCert = readFileSync(join(certDir, "cert.pem"), "utf8");
    tlsServer = https.createServer({ key: readFileSync(join(certDir, "key.pem")), cert: testCert }, (req, res) => {
      res.writeHead(200, { "content-length": BODY.length });
      res.end(BODY);
    });
    await new Promise<void>((ok) => tlsServer.listen(0, "127.0.0.1", ok));
    tlsPort = (tlsServer.address() as AddressInfo).port;
  });
  afterAll(async () => {
    for (const sock of open) sock.destroy();
    proxy.closeAllConnections();
    await new Promise((ok) => proxy.close(ok));
    tlsServer.closeAllConnections();
    await new Promise((ok) => tlsServer.close(ok));
  });

  it("an https address: the download goes through the proxy's tunnel, and TLS is checked: a certificate Node does not trust is refused; once trusted, the zip is fetched through the tunnel", async () => {
    const cache = freshCache();
    const source = { url: "https://zip.test/zip", ...SOURCE };
    // zip.test is not a name this machine can look up: only the tunnel reaches it.
    const untrusted = await fetchBrowserZip({ cacheDir: cache, testSource: source, env: { HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` } }).catch((e: unknown) => e);
    expect(String((untrusted as Error & { code?: string }).code)).toMatch(/SELF_SIGNED|UNABLE_TO_VERIFY|CERT/);
    expect(left(cache)).toEqual([]);
    // Trusted as Node trusts the session's certificate in a cloud session (NODE_EXTRA_CA_CERTS): added to Node's own list.
    const before = tls.getCACertificates("default");
    tls.setDefaultCACertificates([...before, testCert]);
    try {
      const r = await fetchBrowserZip({ cacheDir: cache, testSource: source, env: { HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` } });
      expect(r).toMatchObject({ fetched: true, via: `through the proxy at 127.0.0.1:${proxyPort} (HTTPS_PROXY)`, sha256: SOURCE.sha256, bytes: SOURCE.bytes });
      expect(asked.at(-1)).toMatchObject({ method: "CONNECT", url: "zip.test:443" });
      // The zip's bytes, inside TLS, came back through the tunnel.
      expect(carried.at(-1)!.toClient).toBeGreaterThan(SOURCE.bytes);
      expect(carried.at(-1)!.toServer).toBeGreaterThan(0);
      expect(sha256(readFileSync(join(cache, BROWSER_ZIP)))).toBe(SOURCE.sha256);
    } finally {
      tls.setDefaultCACertificates(before);
    }
  });
  const withCredentials = () => `http://made-up-user:made-up-pass@127.0.0.1:${proxyPort}`;
  const basic = `Basic ${Buffer.from("made-up-user:made-up-pass").toString("base64")}`;

  it("an https address goes through a tunnel; a tunnel the proxy refuses is reported with its answer; the user name and password go to the proxy and are never printed", async () => {
    const cache = freshCache();
    const lines: string[] = [];
    const err = await fetchBrowserZip({ cacheDir: cache, testSource: { url: "https://browser-zip.invalid/zip", ...SOURCE }, env: { HTTPS_PROXY: withCredentials() }, log: (l) => lines.push(l) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchRefused);
    expect((err as Error).message).toBe(`The proxy at 127.0.0.1:${proxyPort} refused the tunnel to browser-zip.invalid:443: it answered 403 Forbidden. Nothing was fetched.`);
    expect(asked.at(-1)).toEqual({ method: "CONNECT", url: "browser-zip.invalid:443", auth: basic });
    for (const text of [(err as Error).message, ...lines]) expect(text).not.toMatch(/made-up-user|made-up-pass/);
    expect(left(cache)).toEqual([]);
  });

  it("a tunnel the proxy lets through carries the TLS connection; reset, it fails the fetch: the program does not stop, and no file is left", async () => {
    const cache = freshCache();
    const before = tunnelled.length;
    const err = await fetchBrowserZip({ cacheDir: cache, testSource: { url: "https://reset.invalid/zip", ...SOURCE }, env: { HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error & { code?: string }).code ?? (err as Error).message)).toMatch(/ECONNRESET|socket hang up|disconnected/);
    // The TLS greeting went into the tunnel: the request did not go round the proxy.
    expect(tunnelled.length).toBe(before + 1);
    expect(tunnelled.at(-1)).toBeGreaterThan(0);
    expect(left(cache)).toEqual([]);
    await new Promise((r) => setTimeout(r, 200)); // a late error on the tunnel's socket would be reported by the runner as unhandled
  });

  it("a plain address goes through HTTP_PROXY as a whole address; what is printed names the proxy's host and port only", async () => {
    const cache = freshCache();
    const lines: string[] = [];
    const r = await fetchBrowserZip({ cacheDir: cache, testSource: { url: "http://browser-zip.invalid/zip", ...SOURCE }, env: { HTTP_PROXY: withCredentials() }, log: (l) => lines.push(l) });
    expect(r).toMatchObject({ fetched: true, via: `through the proxy at 127.0.0.1:${proxyPort} (HTTP_PROXY)` });
    expect(asked.at(-1)).toEqual({ method: "GET", url: "http://browser-zip.invalid/zip", auth: basic });
    for (const text of lines) expect(text).not.toMatch(/made-up-user|made-up-pass/);
  });

  it("NO_PROXY: a host it lists is fetched directly; the list's forms are read as hosts and domains", async () => {
    const cache = freshCache();
    const before = asked.length;
    const r = await fetchFrom("/zip", cache, { env: { HTTP_PROXY: withCredentials(), NO_PROXY: "example.invalid, 127.0.0.1" } });
    expect(r).toMatchObject({ fetched: true, via: "directly" });
    expect(asked.length).toBe(before);
    expect(noProxyCovers("storage.googleapis.com", ".googleapis.com")).toBe(true);
    expect(noProxyCovers("storage.googleapis.com", "*.googleapis.com,localhost")).toBe(true);
    expect(noProxyCovers("storage.googleapis.com", "googleapis.com:443")).toBe(true);
    expect(noProxyCovers("storage.googleapis.com", "*")).toBe(true);
    expect(noProxyCovers("storage.googleapis.com", "notgoogleapis.com, localhost")).toBe(false);
    expect(noProxyCovers("storage.googleapis.com", undefined)).toBe(false);
  });

  it("a proxy setting that is not an http:// address is refused, naming the setting and not its value", async () => {
    const cache = freshCache();
    await expect(fetchBrowserZip({ cacheDir: cache, testSource: { url: "https://browser-zip.invalid/zip", ...SOURCE }, env: { HTTPS_PROXY: "made-up-pass not an address" } })).rejects.toThrow(/^The proxy setting HTTPS_PROXY is not an address; nothing was fetched\.$/);
    await expect(fetchBrowserZip({ cacheDir: cache, testSource: { url: "https://browser-zip.invalid/zip", ...SOURCE }, env: { https_proxy: "socks5://made-up-user:made-up-pass@127.0.0.1:1" } })).rejects.toThrow(/^The proxy setting https_proxy is not an http:\/\/ address; only such a proxy is supported; nothing was fetched\.$/);
    expect(left(cache)).toEqual([]);
  });
});
