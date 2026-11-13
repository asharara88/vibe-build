/**
 * Package J3: the live preview's interface side (src/web/preview.ts) and its forked front (src/web/preview-front.ts),
 * with a stand-in upstream on the pump socket: each stream connects to a made-up app on this machine's loopback
 * address instead of a `check` container. No container, no database. The front runs as it does in the interface:
 * forked from its copied files, under its own user when the tests run as root.
 */
import { chownSync, existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AppStream, StreamingEnd } from "../src/sandbox/manager.js";
import { RUNNER_UID } from "../src/acceptance/runner-image.js";
import { SignInLimiter } from "../src/web/auth.js";
import { DEFAULT_PREVIEW_UID, LIVE_EVENTS, LiveOpenCancelled, LivePreview, MAX_FRONT_RESTARTS, previewUidRefusal, removeStaleFolders } from "../src/web/preview.js";
import { FRONT_TEXT_KEYS, IDLE_MS, relayAnswer, type Texts } from "../src/web/preview-rules.ts";

const texts = (): Texts => {
  const t = Object.fromEntries(FRONT_TEXT_KEYS.map((k) => [k, `[${k}] {seconds} {reason}`])) as Texts["en"];
  return { en: t, ar: t };
};

/** The made-up app: echoes what it was asked, sets a cookie, redirects, hangs, or sends a type the front refuses. */
let upstream: http.Server;
let upstreamPort = 0;
const seen: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; bodyBytes: number }> = [];
let upstreamConnections = 0;
const openSockets = new Set<net.Socket>();

beforeAll(async () => {
  upstream = http.createServer((q, s) => {
    let n = 0;
    q.on("data", (d: Buffer) => (n += d.length));
    q.on("end", () => {
      seen.push({ method: q.method ?? "", url: q.url ?? "", headers: q.headers, bodyBytes: n });
      if (q.url === "/redirect-out") return s.writeHead(302, { location: "https://evil.example/" }).end();
      if (q.url === "/redirect-in") return s.writeHead(302, { location: "http://app:3161/en/home" }).end();
      if (q.url === "/binary") return s.writeHead(200, { "content-type": "application/octet-stream" }).end("x");
      if (q.url === "/hang") return void s.writeHead(200, { "content-type": "text/plain" }).write("start");
      if (q.url === "/slow-headers") return; // never answers
      // After the review bot on af80dc9: an answer cut short after its headers (it says 100 bytes, sends 5, and the app is gone).
      if (q.url === "/cut-short") {
        s.writeHead(200, { "content-type": "text/plain", "content-length": "100" });
        s.write("hello");
        setTimeout(() => q.socket.destroy(), 100);
        return;
      }
      s.writeHead(200, { "content-type": "text/html", "set-cookie": ["sid=1; Path=/; HttpOnly", "bad=1; Domain=evil.example"], "x-seen-host": String(q.headers.host) });
      s.end(`app page ${q.url}`);
    });
  });
  upstream.on("connection", (c) => {
    upstreamConnections++;
    openSockets.add(c);
    c.on("close", () => openSockets.delete(c));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  upstreamPort = (upstream.address() as AddressInfo).port;
});
afterAll(async () => {
  for (const s of openSockets) s.destroy();
  await new Promise((r) => upstream.close(r));
});

async function freePort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const p = (s.address() as AddressInfo).port;
  await new Promise((r) => s.close(r));
  return p;
}

let made: LivePreview[] = [];
afterEach(async () => {
  for (const p of made) await p.stop().catch(() => undefined);
  made = [];
});

/** A preview whose streams go to the made-up app; `streams` counts them, `appRunning` stands for the project's app. */
async function preview(o: { passValidMs?: number; sessionMaxMs?: number; onFault?: (message: string, detail: unknown) => void } = {}) {
  const port = await freePort();
  const events: Array<{ project: string; kind: string; payload: Record<string, unknown> }> = [];
  const state = { appRunning: true, streams: 0, killed: 0 };
  const p = new LivePreview({
    port,
    texts: texts(),
    base: "/tmp",
    allowControls: true,
    ...o,
    openStream: () => {
      if (!state.appRunning) return null;
      state.streams++;
      const sock = net.connect(upstreamPort, "127.0.0.1");
      sock.on("error", () => undefined);
      const done = new Promise<StreamingEnd>((r) => sock.on("close", () => r({ code: 0, stderrTail: "" })));
      return { container: `stand-in-${state.streams}`, stdin: sock, stdout: sock, done, kill: async () => {
          state.killed++;
          sock.destroy();
          await done;
        }, args: [] } satisfies AppStream;
    },
    onEvent: async (project, kind, payload) => void events.push({ project, kind, payload }),
  });
  made.push(p);
  await p.start();
  const base = `http://127.0.0.1:${port}`;
  const enter = (pass: string, headers: Record<string, string> = { origin: base }) =>
    fetch(`${base}/__builder/enter`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: `pass=${encodeURIComponent(pass)}`, redirect: "manual" });
  const open = (builderSession = "builder-session-1", projectId = "j1-0000000000aa") => p.open({ projectId, builderSession, appStartEventId: "7", appPort: 3161 });
  const cookieOf = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0]!;
  const get = (path: string, cookie: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { headers: { cookie, ...headers }, redirect: "manual" });
  return { p, port, base, events, state, enter, open, cookieOf, get };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("the preview front: the gate", () => {
  it("a visitor without a session gets only the gate, and no stream is opened", async () => {
    const t = await preview();
    for (const path of ["/", "/en/home", "/_next/static/a.js", "/__builder/enter"]) {
      const r = await fetch(`${t.base}${path}`);
      expect(r.status, path).toBe(200);
      expect(await r.text(), path).toContain("[no_live]");
    }
    await t.open();
    const r = await fetch(`${t.base}/en/home`);
    expect(await r.text()).toContain('action="/__builder/enter"');
    expect(t.state.streams).toBe(0);
    // A connection straight to the pump socket, with no session entered, is refused there too.
    expect(t.p.refusedStreams).toBe(0);
  });

  it("a pass works once: the right one sets builder_preview (HttpOnly, SameSite=Strict, Path=/) with Clear-Site-Data, then the app is reached; the same pass again is refused", async () => {
    const t = await preview();
    const o = await t.open();
    const r = await t.enter(o.shown);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/");
    expect(r.headers.get("set-cookie")).toMatch(/^builder_preview=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\/$/);
    expect(r.headers.get("clear-site-data")).toBe('"cache", "storage"');
    const cookie = t.cookieOf(r);
    await pause(50);
    const page = await t.get("/en/home", cookie);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("app page /en/home");
    expect(page.headers.get("x-seen-host")).toBe("app:3161");
    expect(t.events.map((e) => e.kind)).toEqual(["journey.preview.live_entered"]);
    expect(t.events[0]!.payload).toEqual({ session: o.sessionId, sec_fetch_site_sent: false });
    const again = await t.enter(o.shown);
    expect(again.status).toBe(403);
    expect(await again.text()).toContain("[no_pass]");
  });

  it("the pass is refused after its time; the session then ends unused", async () => {
    const t = await preview({ passValidMs: 300 });
    const o = await t.open();
    await pause(500);
    const r = await t.enter(o.shown);
    expect(r.status).toBe(403);
    await pause(1200);
    expect(t.p.session()).toBeNull();
    expect(t.events.map((e) => `${e.kind} ${String(e.payload.reason ?? "")}`)).toContain("journey.preview.live_closed pass_unused");
  });

  it("five wrong passes void the pass and lock the gate; the right pass is refused then; the interface's own sign-in limiter is not touched", async () => {
    const t = await preview();
    const ui = new SignInLimiter();
    const o = await t.open();
    for (let i = 1; i <= 4; i++) expect((await t.enter("ZZZZ-ZZZZ")).status, `try ${i}`).toBe(403);
    const fifth = await t.enter("ZZZZ-ZZZZ");
    expect(fifth.status).toBe(429);
    expect(await fifth.text()).toContain("[locked] 60");
    const right = await t.enter(o.shown);
    expect(right.status).toBe(429);
    await pause(50);
    expect(t.p.session()).toBeNull();
    expect(t.events.at(-1)).toMatchObject({ kind: "journey.preview.live_closed", payload: { reason: "pass_voided", entered: false } });
    expect(ui.lockedFor()).toBe(0);
  });

  it("the pump socket takes a stream only once the pass has been used: before that, a connection to it is closed and no stream is opened", async () => {
    const t = await preview();
    const o = await t.open();
    const knock = () =>
      new Promise<void>((resolve) => {
        const c = net.connect(t.p.pumpSocket()!);
        c.on("error", () => resolve());
        c.on("close", () => resolve());
        setTimeout(() => (c.destroy(), resolve()), 2000);
      });
    await knock();
    expect(t.p.refusedStreams).toBe(1);
    expect(t.state.streams).toBe(0);
    expect((await t.enter(o.shown)).status).toBe(303);
    await pause(50);
    await knock();
    expect(t.state.streams).toBe(1);
    expect(t.p.refusedStreams).toBe(1);
  });

  it("the gate refuses an Origin of null, a POST with neither Origin nor Sec-Fetch-Site: same-origin, and a POST from another site", async () => {
    const t = await preview();
    const o = await t.open();
    expect((await t.enter(o.shown, { origin: "null" })).status).toBe(403);
    expect((await t.enter(o.shown, {})).status).toBe(403);
    expect((await t.enter(o.shown, { origin: "https://evil.example", "sec-fetch-site": "cross-site" })).status).toBe(403);
    // Still unused: the right request then works.
    expect((await t.enter(o.shown, { "sec-fetch-site": "same-origin" })).status).toBe(303);
  });

  it("only enter and leave live under /__builder/; other spellings are not passed to the app", async () => {
    const t = await preview();
    const o = await t.open();
    const cookie = t.cookieOf(await t.enter(o.shown));
    await pause(50);
    seen.length = 0;
    // Sent as written (fetch would tidy "/a/../" away before sending).
    const raw = (path: string) =>
      new Promise<number>((resolve) => http.get({ host: "127.0.0.1", port: t.port, path, headers: { cookie } }, (r) => (r.resume(), resolve(r.statusCode ?? 0))).on("error", () => resolve(-1)));
    for (const path of ["/__builder/other", "/__b%75ilder/x", "/%5F%5Fbuilder/enter", "/__builder%2Fenter", "/a/../__builder/enter", "/a/%2e%2e/__builder/enter"]) {
      expect([400, 404], path).toContain(await raw(path));
    }
    expect(seen).toEqual([]);
  });
});

describe("the preview front: requests and answers", () => {
  it("a refused request opens no stream: cross-site, same-site, a POST without proof of its page, another method, a body said to be over 1 MB", async () => {
    const t = await preview();
    const o = await t.open();
    const cookie = t.cookieOf(await t.enter(o.shown));
    await pause(50);
    const before = t.state.streams;
    const tries: Array<[string, RequestInit]> = [
      ["cross-site GET", { headers: { cookie, "sec-fetch-site": "cross-site" } }],
      ["same-site POST", { method: "POST", headers: { cookie, "sec-fetch-site": "same-site", origin: t.base }, body: "x" }],
      ["POST, no Origin, no Sec-Fetch-Site", { method: "POST", headers: { cookie }, body: "x" }],
      ["POST from another Origin", { method: "POST", headers: { cookie, origin: "https://evil.example" }, body: "x" }],
      ["PUT", { method: "PUT", headers: { cookie, "sec-fetch-site": "same-origin" }, body: "x" }],
      ["DELETE", { method: "DELETE", headers: { cookie, "sec-fetch-site": "same-origin" } }],
    ];
    for (const [what, init] of tries) {
      const r = await fetch(`${t.base}/en/action`, init);
      expect(r.status, what).toBe(403);
    }
    const big = await new Promise<number>((resolve) => {
      const q = http.request({ host: "127.0.0.1", port: t.port, path: "/en/action", method: "POST", headers: { cookie, "sec-fetch-site": "same-origin", "content-length": String(1024 * 1024 + 1), "content-type": "text/plain" } }, (r) => resolve(r.statusCode ?? 0));
      q.on("error", () => resolve(-1));
      q.end();
    });
    expect(big).toBe(413);
    expect(t.state.streams).toBe(before);
  });

  it("a body that grows past 1 MB as it streams is cut off", async () => {
    const t = await preview();
    const o = await t.open();
    const cookie = t.cookieOf(await t.enter(o.shown));
    await pause(50);
    const status = await new Promise<number>((resolve) => {
      const q = http.request({ host: "127.0.0.1", port: t.port, path: "/en/upload", method: "POST", headers: { cookie, "sec-fetch-site": "same-origin", "content-type": "text/plain", "transfer-encoding": "chunked" } }, (r) => resolve(r.statusCode ?? 0));
      q.on("error", () => resolve(-1));
      const chunk = Buffer.alloc(64 * 1024, 120);
      for (let i = 0; i < 20; i++) q.write(chunk);
      q.end();
    });
    expect([413, -1]).toContain(status);
  });

  it("headers over 16 KB are refused by the front's own server", async () => {
    const t = await preview();
    const r = await fetch(`${t.base}/`, { headers: { "x-big": "a".repeat(17 * 1024) } }).then(
      (x) => x.status,
      () => -1,
    );
    expect([431, -1]).toContain(r);
  });

  it("passes only the allowlist, maps Host and Origin, sends only this session's cookies without their prefix, and renames the app's cookies", async () => {
    const t = await preview();
    const o = await t.open();
    const cookie = t.cookieOf(await t.enter(o.shown));
    await pause(50);
    seen.length = 0;
    const first = await t.get("/en/home", cookie);
    const setCookies = first.headers.getSetCookie();
    expect(setCookies).toHaveLength(1);
    const prefixed = setCookies[0]!.split(";")[0]!;
    expect(prefixed).toMatch(/^bp[0-9a-f]{8}_sid=1$/);
    expect(first.headers.get("content-security-policy")).toContain("connect-src 'self'");
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    const r = await fetch(`${t.base}/en/action`, {
      method: "POST",
      headers: { cookie: `${cookie}; ${prefixed}; bp00000000_old=1; plain=2`, origin: t.base, referer: `${t.base}/en/home`, "x-forwarded-host": "evil.example", authorization: "Bearer made-up", "content-type": "text/plain" },
      body: "hello",
    });
    expect(r.status).toBe(200);
    const q = seen.at(-1)!;
    expect(q.headers.host).toBe("app:3161");
    expect(q.headers.origin).toBe("http://app:3161");
    expect(q.headers.referer).toBe("http://app:3161/en/home");
    expect(q.headers.cookie).toBe("sid=1");
    expect(q.headers["x-forwarded-host"]).toBeUndefined();
    expect(q.headers.authorization).toBeUndefined();
    expect(q.bodyBytes).toBe(5);
  });

  it("Location: a path or http://app:3161/ is followed as a path; another site gets the front's own page; an answer of another type is refused", async () => {
    const t = await preview();
    const o = await t.open();
    const cookie = t.cookieOf(await t.enter(o.shown));
    await pause(50);
    const inside = await t.get("/redirect-in", cookie);
    expect(inside.status).toBe(302);
    expect(inside.headers.get("location")).toBe("/en/home");
    const out = await t.get("/redirect-out", cookie);
    expect(out.status).toBe(502);
    expect(out.headers.get("location")).toBeNull();
    expect(await out.text()).toContain("[off_site]");
    const bin = await t.get("/binary", cookie);
    expect(bin.status).toBe(502);
    expect(await bin.text()).toContain("[not_passed]");
  });

  it(
    "an answer whose headers do not come within 30 s gets the front's own page",
    async () => {
      const t = await preview();
      const o = await t.open();
      const cookie = t.cookieOf(await t.enter(o.shown));
      await pause(50);
      const t0 = Date.now();
      const r = await t.get("/slow-headers", cookie);
      expect(r.status).toBe(502);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(29_000);
    },
    60_000,
  );

  it("a browser that leaves before the app's answer comes: the request to the app is stopped at once, and its stream ended", async () => {
    const t = await preview();
    const o = await t.open();
    const cookie = t.cookieOf(await t.enter(o.shown));
    await pause(50);
    const before = t.state.killed;
    const q = http.get({ host: "127.0.0.1", port: t.port, path: "/slow-headers", headers: { cookie } }, () => undefined);
    q.on("error", () => undefined);
    await pause(300);
    expect(t.p.activeStreams()).toBe(1);
    q.destroy();
    await pause(500);
    expect(t.p.activeStreams()).toBe(0);
    expect(t.state.killed).toBe(before + 1);
  });

  it("a GET or HEAD that says it has a body reaches the app with no Content-Length, and the next request on the same connection reaches it as a request of its own (J3's review)", async () => {
    const t = await preview();
    const o = await t.open();
    const cookie = t.cookieOf(await t.enter(o.shown));
    await pause(50);
    seen.length = 0;
    const c = net.connect(t.port, "127.0.0.1");
    c.on("error", () => undefined);
    let got = "";
    c.on("data", (d: Buffer) => (got += d.toString("latin1")));
    const waitFor = async (text: string) => {
      for (let i = 0; i < 40 && !got.includes(text); i++) await pause(50);
      return got.includes(text);
    };
    // A raw client: a GET that states a 5-byte body and sends it, then a HEAD that states one, then a plain GET, on one connection.
    c.write(`GET /first HTTP/1.1\r\nHost: x\r\nCookie: ${cookie}\r\nContent-Length: 5\r\n\r\nhello`);
    expect(await waitFor("app page /first")).toBe(true);
    c.write(`HEAD /head HTTP/1.1\r\nHost: x\r\nCookie: ${cookie}\r\nContent-Length: 7\r\n\r\nheadbdy`);
    await pause(300);
    c.write(`GET /second HTTP/1.1\r\nHost: x\r\nCookie: ${cookie}\r\n\r\n`);
    expect(await waitFor("app page /second")).toBe(true);
    c.destroy();
    expect(seen.map((q) => `${q.method} ${q.url}`)).toEqual(["GET /first", "HEAD /head", "GET /second"]);
    for (const q of seen) {
      expect(q.headers["content-length"], q.url).toBeUndefined();
      expect(q.bodyBytes, q.url).toBe(0);
    }
  });

  it("listens on 127.0.0.1 only", async () => {
    const t = await preview();
    const hex = t.port.toString(16).toUpperCase().padStart(4, "0");
    const lines = readFileSync("/proc/net/tcp", "utf8").split("\n").filter((l) => l.includes(`:${hex} 00000000:0000 0A`));
    expect(lines.length).toBe(1);
    expect(lines[0]!.trim().split(/\s+/)[1]).toBe(`0100007F:${hex}`);
    const tcp6 = existsSync("/proc/net/tcp6") ? readFileSync("/proc/net/tcp6", "utf8") : "";
    expect(tcp6.includes(`:${hex} 00000000000000000000000000000000:0000 0A`)).toBe(false);
  });
});

describe("the preview front: its process", () => {
  it("runs as its own user (not root, 1000 or 1001), with only its port and the pump socket's path in its environment (and the two names Node's fork adds for its channel)", async () => {
    const t = await preview();
    const status = readFileSync(`/proc/${t.p.frontPid}/status`, "utf8");
    const uid = Number(/^Uid:\s+(\d+)/m.exec(status)![1]);
    if (process.getuid?.() === 0) expect(uid).toBe(DEFAULT_PREVIEW_UID);
    else expect(uid).toBe(process.getuid?.());
    const env = readFileSync(`/proc/${t.p.frontPid}/environ`, "utf8").split("\0").filter(Boolean).map((l) => l.split("=")[0]);
    expect(env.sort()).toEqual(["BUILDER_PREVIEW_PORT", "BUILDER_PREVIEW_PUMP", "NODE_CHANNEL_FD", "NODE_CHANNEL_SERIALIZATION_MODE"]);
  });

  it("refuses root, 1000, 1001 and a user named in /etc/passwd as the front's user", () => {
    expect(previewUidRefusal(0, "")).toMatch(/root/);
    expect(previewUidRefusal(1000, "")).toMatch(/door/);
    expect(previewUidRefusal(1001, "")).toMatch(/runner/);
    expect(previewUidRefusal(1990, "made-up:x:1990:1990::/home/x:/bin/sh\n")).toMatch(/passwd/);
    expect(previewUidRefusal(1990, "root:x:0:0::/root:/bin/sh\n")).toBeNull();
    expect(previewUidRefusal(-1, "")).not.toBeNull();
  });

  it("a message of another shape is ignored: no pass is opened by it, and the front goes on working", async () => {
    const t = await preview();
    t.p.sendRaw({ type: "pass", digest: "0".repeat(64), expiresAt: Date.now() + 60_000, sessionId: "live-0123456789abcdef", prefix: "bp00000000_", appPort: 3161, sessionEndsAt: Date.now() + 60_000, extra: true });
    t.p.sendRaw({ type: "eval", code: "process.exit(9)" });
    t.p.sendRaw("stop");
    await pause(100);
    const r = await fetch(`${t.base}/`);
    expect(await r.text()).toContain("[no_live]");
    const o = await t.open();
    expect((await t.enter(o.shown)).status).toBe(303);
  });
});

describe("the live session's ends (section 4.4)", () => {
  async function entered(o: { sessionMaxMs?: number } = {}) {
    const t = await preview(o);
    const opened = await t.open();
    const cookie = t.cookieOf(await t.enter(opened.shown));
    await pause(50);
    expect((await t.get("/en/home", cookie)).status).toBe(200);
    const hang = http.get({ host: "127.0.0.1", port: t.port, path: "/hang", headers: { cookie } }, (r) => r.resume()).on("error", () => undefined);
    await pause(200);
    return { ...t, cookie, hang };
  }
  const gateAfter = async (t: Awaited<ReturnType<typeof entered>>) => {
    await pause(100);
    const r = await t.get("/en/home", t.cookie);
    expect(await r.text()).toContain("[no_live]");
    expect(t.p.activeStreams()).toBe(0);
    t.hang.destroy();
  };

  it("the app stops (the jobs call closeFor with app_stopped): streams killed, the session ends", async () => {
    const t = await entered();
    t.state.appRunning = false;
    expect(await t.p.closeFor("j1-0000000000aa", "app_stopped")).toBe(true);
    expect(t.events.at(-1)).toMatchObject({ kind: "journey.preview.live_closed", payload: { reason: "app_stopped" } });
    await gateAfter(t);
  });

  it("the app stopped, found by the pump: a request opens no stream and ends the session (app_stopped)", async () => {
    const t = await preview();
    const o = await t.open();
    const cookie = t.cookieOf(await t.enter(o.shown));
    await pause(50);
    t.state.appRunning = false;
    const r = await t.get("/en/home", cookie);
    expect(r.status).toBe(502);
    await pause(100);
    expect(t.events.at(-1)).toMatchObject({ kind: "journey.preview.live_closed", payload: { reason: "app_stopped" } });
  });

  it("the project is closed (closeFor): streams killed, event recorded", async () => {
    const t = await entered();
    expect(await t.p.closeFor("j1-0000000000ff", "project_closed")).toBe(false);
    expect(await t.p.closeFor("j1-0000000000aa", "project_closed")).toBe(true);
    expect(t.state.killed).toBeGreaterThan(0);
    expect(t.events.at(-1)).toMatchObject({ kind: "journey.preview.live_closed", payload: { reason: "project_closed", entered: true } });
    await gateAfter(t);
  });

  it("the builder's sign-out ends the session it opened, and only that one", async () => {
    const t = await entered();
    await t.p.signedOut("another-builder-session");
    expect(t.p.session()).not.toBeNull();
    await t.p.signedOut("builder-session-1");
    expect(t.events.at(-1)).toMatchObject({ payload: { reason: "sign_out" } });
    await gateAfter(t);
  });

  it("the session ends when the builder sign-in session that opened it expires, if that comes before its 8 hours (J3's review)", async () => {
    const t = await preview();
    const before = Date.now();
    const opened = await t.p.open({ projectId: "j1-0000000000aa", builderSession: "builder-session-1", builderSessionEndsAt: before + 1500, appStartEventId: "7", appPort: 3161 });
    expect(t.p.session()!.endsAt).toBeLessThanOrEqual(before + 1500);
    const cookie = t.cookieOf(await t.enter(opened.shown));
    await pause(50);
    expect((await t.get("/en/home", cookie)).status).toBe(200);
    await pause(1700);
    expect(t.events.at(-1)).toMatchObject({ kind: "journey.preview.live_closed", payload: { reason: "builder_session_expired" } });
    expect(await (await t.get("/en/home", cookie)).text()).toContain("[no_live]");
    expect(t.p.activeStreams()).toBe(0);
    // A sign-in session that outlives the 8 hours does not lengthen them.
    await t.p.open({ projectId: "j1-0000000000aa", builderSession: "builder-session-2", builderSessionEndsAt: Date.now() + 10 * 60 * 60 * 1000, appStartEventId: "7", appPort: 3161 });
    expect(t.p.session()!.endsAt).toBeLessThanOrEqual(Date.now() + 8 * 60 * 60 * 1000);
  });

  it("after its longest life (8 hours in the interface; shortened here), the session ends", async () => {
    const t = await entered({ sessionMaxMs: 1500 });
    await pause(1700);
    expect(t.events.at(-1)).toMatchObject({ payload: { reason: "expiry" } });
    await gateAfter(t);
  });

  it("leave: the owner leaves at the front; the session ends and its cookie is cleared", async () => {
    const t = await entered();
    const r = await fetch(`${t.base}/__builder/leave`, { method: "POST", headers: { cookie: t.cookie, origin: t.base } });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(/^builder_preview=; .*Max-Age=0/);
    await pause(100);
    expect(t.events.at(-1)).toMatchObject({ payload: { reason: "leave" } });
    await gateAfter(t);
  });

  it("a halt or a lost lock (the interface stopping) closes every stream and the front", async () => {
    const t = await entered();
    const pid = t.p.frontPid!;
    await t.p.stop("lock_lost");
    expect(t.events.at(-1)).toMatchObject({ payload: { reason: "lock_lost" } });
    expect(t.p.activeStreams()).toBe(0);
    await pause(200);
    expect(() => process.kill(pid, 0)).toThrow();
    t.hang.destroy();
  });
});

describe("the front's restarts (J3's review: the cap added in c8c4b23 had no test)", () => {
  it(`a front that stops is started again at most ${MAX_FRONT_RESTARTS} times in one interface's life; each stop ends the open session; then the live app stays off`, { timeout: 60_000 }, async () => {
    const faults: string[] = [];
    const t = await preview({ onFault: (m) => void faults.push(m) });
    const listening = async () => fetch(`${t.base}/`).then((r) => r.status === 200, () => false);
    const pids = [t.p.frontPid!];
    await t.open();
    for (let i = 1; i <= MAX_FRONT_RESTARTS + 1; i++) {
      process.kill(pids.at(-1)!, "SIGKILL");
      if (i === 1) {
        await pause(200);
        expect(t.events.at(-1)).toMatchObject({ kind: "journey.preview.live_closed", payload: { reason: "front_stopped" } });
      }
      if (i <= MAX_FRONT_RESTARTS) {
        let up = false;
        for (let k = 0; k < 100 && !up; k++) {
          await pause(100);
          up = t.p.frontPid !== pids.at(-1) && (await listening());
        }
        expect(up, `started again after stop ${i}`).toBe(true);
        pids.push(t.p.frontPid!);
      }
    }
    await pause(2500);
    expect(new Set(pids).size).toBe(MAX_FRONT_RESTARTS + 1);
    expect(t.p.frontPid).toBe(pids.at(-1));
    expect(await listening()).toBe(false);
    expect(faults.filter((m) => m === "The preview front stopped; it is started again.")).toHaveLength(MAX_FRONT_RESTARTS);
    expect(faults.at(-1)).toBe(`The preview front stopped ${MAX_FRONT_RESTARTS + 1} times; it is not started again until the interface restarts.`);
    await expect(t.open()).rejects.toThrow(/not running/);
  });
});

describe("stale short folders", () => {
  it("removes a folder left by a killed interface (older than a minute, its socket answers nobody), never a running preview's", async () => {
    const t = await preview();
    const stale = mkdtempSync("/tmp/bpv-");
    writeFileSync(join(stale, "p.sock"), "not a socket");
    const old = new Date(Date.now() - 120_000);
    utimesSync(stale, old, old);
    const young = mkdtempSync("/tmp/bpv-");
    const removed = removeStaleFolders("/tmp");
    expect(removed).toContain(stale.split("/").pop());
    expect(existsSync(stale)).toBe(false);
    // Made in the last minute: left alone (another interface may be starting in it).
    expect(existsSync(young)).toBe(true);
    rmSync(young, { recursive: true, force: true });
    // The running preview's folder is kept, and it still answers.
    expect((await fetch(`${t.base}/`)).status).toBe(200);
  });

  it("also removes a stale camera folder: run as root, one the interface gave to the runner's user; one of another user is left alone (J3's review)", () => {
    const root = process.getuid?.() === 0;
    const old = new Date(Date.now() - 120_000);
    const stale = mkdtempSync("/tmp/bpc-");
    writeFileSync(join(stale, "c.sock"), "not a socket");
    // As cameraSocket makes it: the runner's user's when the interface runs as root.
    if (root) chownSync(stale, RUNNER_UID, RUNNER_UID);
    utimesSync(stale, old, old);
    // A stale folder of another user (neither root nor the runner's): only root can make one.
    const other = root ? mkdtempSync("/tmp/bpc-") : null;
    if (other) {
      chownSync(other, 4242, 4242);
      utimesSync(other, old, old);
    }
    try {
      const removed = removeStaleFolders("/tmp");
      expect(removed).toContain(stale.split("/").pop());
      expect(existsSync(stale)).toBe(false);
      if (other) expect(existsSync(other)).toBe(true);
    } finally {
      rmSync(stale, { recursive: true, force: true });
      if (other) rmSync(other, { recursive: true, force: true });
    }
  });
});

describe("after the review bot on af80dc9", () => {
  /** How a body read ends: cut short (an error), complete, or still open when the deadline comes. */
  const howItEnds = (r: Response, deadlineMs: number) =>
    Promise.race([
      r.text().then(
        () => "complete",
        () => "cut short",
      ),
      pause(deadlineMs).then(() => `still open after ${deadlineMs / 1000} s`),
    ]);

  it("an answer the app cuts short after its headers (Content-Length: 100, five bytes, then the app gone) ends at the browser at once, not when the front's 60-second idle timer fires; its stream is ended", async () => {
    const t = await preview();
    const o = await t.open();
    const cookie = t.cookieOf(await t.enter(o.shown));
    await pause(50);
    const r = await t.get("/cut-short", cookie);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-length")).toBe("100");
    const t0 = Date.now();
    expect(await howItEnds(r, 5000)).toBe("cut short");
    expect(Date.now() - t0).toBeLessThan(2000);
    await pause(200);
    expect(t.p.activeStreams()).toBe(0);
    // The front goes on: the next request is answered.
    expect(await (await t.get("/en/home", cookie)).text()).toBe("app page /en/home");
  });

  it("relayAnswer, the front's own: an answer cut short destroys the browser's response and clears the idle timer at once; a whole answer passes whole and clears it too", async () => {
    // A front of this test's own around relayAnswer, with an idle timer whose handle the test can read.
    const timers: Array<{ handle: NodeJS.Timeout | undefined; clears: number }> = [];
    const front = http.createServer((q, res) => {
      const timer = { handle: undefined as NodeJS.Timeout | undefined, clears: 0 };
      timers.push(timer);
      const idle = {
        touch: () => {
          clearTimeout(timer.handle);
          timer.handle = setTimeout(() => res.destroy(), IDLE_MS);
          timer.handle.unref();
        },
        clear: () => {
          timer.clears++;
          clearTimeout(timer.handle);
          timer.handle = undefined;
        },
      };
      http
        .get({ host: "127.0.0.1", port: upstreamPort, path: q.url }, (r) => {
          const length = r.headers["content-length"];
          res.writeHead(r.statusCode ?? 502, { "content-type": String(r.headers["content-type"]), ...(length ? { "content-length": length } : {}) });
          idle.touch();
          relayAnswer(r, res, idle);
        })
        .on("error", () => res.destroy());
    });
    await new Promise<void>((r) => front.listen(0, "127.0.0.1", r));
    const at = `http://127.0.0.1:${(front.address() as AddressInfo).port}`;
    try {
      const cut = await fetch(`${at}/cut-short`);
      const t0 = Date.now();
      expect(await howItEnds(cut, 5000)).toBe("cut short");
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(timers[0]!.clears).toBeGreaterThan(0);
      expect(timers[0]!.handle).toBeUndefined();
      // Control: a whole answer passes whole, and its timer is cleared too.
      const whole = await fetch(`${at}/whole`);
      expect(await whole.text()).toBe("app page /whole");
      await pause(50);
      expect(timers[1]!.handle).toBeUndefined();
    } finally {
      front.closeAllConnections();
      await new Promise((r) => front.close(r));
    }
  });

  it("a sign-out of the builder sign-in session that asked for an open cancels it: open refuses it even while that session still reads as valid; another session's sign-out does not", async () => {
    const t = await preview();
    const asked = t.p.beginOpen("builder-session-1");
    const other = t.p.beginOpen("builder-session-2");
    await t.p.signedOut("builder-session-1");
    const still = () => true;
    await expect(t.p.open({ projectId: "j1-0000000000aa", builderSession: "builder-session-1", appStartEventId: "7", appPort: 3161, pending: asked, builderSessionValid: still })).rejects.toBeInstanceOf(LiveOpenCancelled);
    expect(t.p.session()).toBeNull();
    // Control: the other sign-in session's open is made.
    const o = await t.p.open({ projectId: "j1-0000000000aa", builderSession: "builder-session-2", appStartEventId: "7", appPort: 3161, pending: other, builderSessionValid: still });
    expect(t.p.session()?.sessionId).toBe(o.sessionId);
    t.p.endOpen(asked);
    t.p.endOpen(other);
    // A session that no longer reads as valid is refused too.
    await expect(t.p.open({ projectId: "j1-0000000000aa", builderSession: "builder-session-3", appStartEventId: "7", appPort: 3161, builderSessionValid: () => false })).rejects.toBeInstanceOf(LiveOpenCancelled);
  });

  it("open looks again after its last await: a sign-out while it waits for the session it replaces to close cancels it, and no session is left open", async () => {
    const port = await freePort();
    let gate: Promise<void> | null = null;
    const closed: string[] = [];
    const p = new LivePreview({
      port,
      texts: texts(),
      base: "/tmp",
      openStream: () => null,
      onEvent: async (_project, kind, payload) => {
        if (kind === LIVE_EVENTS.closed) {
          closed.push(String(payload.reason));
          if (gate) await gate;
        }
      },
    });
    made.push(p);
    await p.start();
    await p.open({ projectId: "j1-0000000000aa", builderSession: "builder-session-0", appStartEventId: "7", appPort: 3161 });
    let release: () => void = () => undefined;
    gate = new Promise<void>((r) => (release = r));
    try {
      const asked = p.beginOpen("builder-session-1");
      const opening = p.open({ projectId: "j1-0000000000aa", builderSession: "builder-session-1", appStartEventId: "7", appPort: 3161, pending: asked, builderSessionValid: () => true });
      opening.catch(() => undefined);
      await pause(100);
      // The session it replaces is closing (its event held); the sign-out comes now.
      expect(closed).toEqual(["replaced"]);
      await p.signedOut("builder-session-1");
      release();
      await expect(opening).rejects.toBeInstanceOf(LiveOpenCancelled);
      expect(p.session()).toBeNull();
      p.endOpen(asked);
    } finally {
      release();
      gate = null;
    }
  });
});
