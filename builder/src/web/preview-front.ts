/**
 * The preview front (package J3; final design, sections 4.1 and 4.3 to 4.6): the one process that reads the HTTP
 * between the owner's browser and the running app.
 *
 * It is a child of the interface (preview.ts), started with `fork` under a user of its own (not root, not the
 * door's user 1000, not the runner's 1001), from a copy of this file and preview-rules.ts in the interface's own
 * short folder, run by Node's own type stripping. Its environment holds two settings, its port and the pump socket's
 * path: no database, no password digest, no sign-in sessions of the interface, no Docker.
 *
 * - It listens on 127.0.0.1:<port> for as long as the interface runs. With no pass or session open it answers
 *   "No live app now".
 * - The gate: "enter" takes the pass the interface showed the owner (only its digest is here), once, within its
 *   2 minutes; five wrong passes void it and lock the gate, each lock-out twice as long as the last. On the right
 *   pass it sets `builder_preview` (32 random bytes, HttpOnly, SameSite=Strict, Path=/) with
 *   Clear-Site-Data: "cache", "storage", and keeps the preview's origin as the browser sent it. "leave" ends it.
 * - Every other request with a valid session is checked (preview-rules.ts, `requestRefusal`), its headers reduced to
 *   the allowlist and mapped (`upstreamHeaders`), and sent to the app over the pump socket: each connection there is
 *   one stream the interface opens to http://app:<port> through a short-lived `check` container on the project's
 *   `front` network (manager.ts, `appStream`). Bodies pass unread. The answer's headers are checked and rewritten
 *   (`responseRefusal`, `downstreamHeaders`), and the front's own security headers set. An answer the app cuts short
 *   after its headers ends at the browser at once (`relayAnswer`; after the review bot on af80dc9).
 * - It logs no header value. It tells the interface, over the fork channel, only: listening, entered (and whether
 *   Sec-Fetch-Site came), refused (why), closed (why).
 * Its own pages carry no script. They carry no referrer rule of their own either: the front's header,
 * Referrer-Policy: same-origin, lets the browser send the gate's POST with its Origin (with "no-referrer", Chromium
 * sends Origin: null, which the gate refuses; seen in M3).
 */
import http from "node:http";
import net from "node:net";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  cookieValues,
  downstreamHeaders,
  ENTER_PATH,
  frontHeaders,
  gateRefusal,
  GATE_LOCK_FIRST_MS,
  HEADERS_WITHIN_MS,
  IDLE_MS,
  LEAVE_PATH,
  MAX_BODY_BYTES,
  MAX_HEADER_BYTES,
  one,
  originOf,
  passMatches,
  PASS_TRIES,
  pathKind,
  relayAnswer,
  requestRefusal,
  responseRefusal,
  SESSION_COOKIE,
  toFrontMessage,
  upstreamHeaders,
  type FromFront,
  type MappingControls,
  type Texts,
} from "./preview-rules.ts";

const PORT = Number(process.env.BUILDER_PREVIEW_PORT);
const PUMP = process.env.BUILDER_PREVIEW_PUMP ?? "";
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535 || !PUMP.startsWith("/") || Buffer.byteLength(PUMP) > 107) {
  process.stderr.write("preview front: BUILDER_PREVIEW_PORT and BUILDER_PREVIEW_PUMP are wrong; not started.\n");
  process.exit(2);
}

/** The streams kept alive to the app, at most (section 4.2). */
const MAX_STREAMS = 6;

interface Pass {
  digest: string;
  expiresAt: number;
  sessionId: string;
  prefix: string;
  appPort: number;
  sessionEndsAt: number;
}
interface Session {
  id: string;
  token: string;
  prefix: string;
  appPort: number;
  origin: string | null;
  endsAt: number;
  agent: http.Agent;
}

let pass: Pass | null = null;
let session: Session | null = null;
const lock = { wrong: 0, until: 0, nextMs: GATE_LOCK_FIRST_MS };
let controls: MappingControls = {};
/** The content-security-policy's `sandbox` value is on: M3 showed the app works with it (section 4.6). */
let cspSandbox = true;
let texts: Texts | null = null;

const tell = (m: FromFront) => {
  if (process.connected) process.send?.(m);
};

/** An agent whose every connection is a new connection to the pump socket: one stream to the app each. */
function pumpAgent(): http.Agent {
  const agent = new http.Agent({ keepAlive: true, maxSockets: MAX_STREAMS, maxFreeSockets: MAX_STREAMS, scheduling: "lifo" });
  (agent as unknown as { createConnection: () => net.Socket }).createConnection = () => net.connect(PUMP);
  return agent;
}

function endSession(reason: "leave" | "expired" | "revoked" | "replaced"): void {
  const s = session;
  if (!s) return;
  session = null;
  s.agent.destroy();
  if (reason === "leave" || reason === "expired") tell({ type: "closed", sessionId: s.id, reason });
}

/* ------------------------------------------------------------------ the front's own pages */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const tx = (lang: "en" | "ar", key: keyof Texts["en"], vars: Record<string, string | number> = {}) =>
  (texts?.[lang]?.[key] ?? key).replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all));

function page(res: http.ServerResponse, status: number, body: (lang: "en" | "ar") => string, extra: Record<string, string | string[]> = {}): void {
  const block = (lang: "en" | "ar") =>
    `<section lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"><h1>${esc(tx(lang, "title"))}</h1><p class="label">${esc(tx(lang, "label_sim"))}</p><p class="label">${esc(tx(lang, "label_data"))}</p>${body(lang)}</section>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(tx("en", "title"))}</title><style>body{font: 16px/1.5 system-ui,sans-serif;margin: 0;padding: 16px;background: #f6f7f9;color: #1d2330}section{background: #fff;border: 1px solid #d5d9e2;border-radius: 8px;padding: 12px 14px;margin: 0 0 14px;max-width: 640px}.label{display: inline-block;font-weight: 700;color: #7a4b00;background: #fff2d6;border-radius: 6px;padding: 2px 8px;margin: 2px 0}.warn{color: #9b1c1c;font-weight: 600}input{font: inherit;padding: 8px;border: 1px solid #d5d9e2;border-radius: 6px;width: 100%;max-width: 240px;letter-spacing: 2px}button{font: inherit;padding: 8px 14px;border-radius: 6px;border: 1px solid #1f4fbf;background: #1f4fbf;color: #fff}</style></head><body>${block("en")}${block("ar")}</body></html>`;
  const headers: Record<string, string | string[]> = { "content-type": "text/html; charset=utf-8", ...frontHeaders({ own: true }), ...extra };
  res.writeHead(status, headers);
  res.end(html);
}

const gateForm = (lang: "en" | "ar") =>
  `<form method="post" action="${ENTER_PATH}"><label for="pass-${lang}">${esc(tx(lang, "pass_label"))}</label><p>${esc(tx(lang, "pass_help"))}</p><input id="pass-${lang}" name="pass" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" maxlength="12" required> <button type="submit">${esc(tx(lang, "enter"))}</button></form>`;

function gatePage(res: http.ServerResponse, status: number, note?: (lang: "en" | "ar") => string): void {
  if (!pass && !session) return page(res, status === 200 ? 200 : status, (lang) => `${note ? note(lang) : ""}<p data-no-live>${esc(tx(lang, "no_live"))}</p>`);
  page(res, status, (lang) => `${note ? note(lang) : ""}${pass ? gateForm(lang) : `<p>${esc(tx(lang, "no_pass"))}</p>`}`);
}

/* ------------------------------------------------------------------ the gate */

function validSession(req: http.IncomingMessage): Session | null {
  const s = session;
  if (!s) return null;
  if (Date.now() >= s.endsAt) {
    endSession("expired");
    return null;
  }
  const want = Buffer.from(s.token);
  // Every value of the cookie is read, and any valid one accepted (a page can add a cookie of the same name).
  for (const v of cookieValues(one(req.headers.cookie), SESSION_COOKIE)) {
    const got = Buffer.from(v);
    if (got.length === want.length && timingSafeEqual(got, want)) return s;
  }
  return null;
}

function readSmallBody(req: http.IncomingMessage, max: number): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (d: Buffer) => {
      size += d.length;
      if (size > max) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(d);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

async function enter(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method === "GET" || req.method === "HEAD") return gatePage(res, 200);
  if (req.method !== "POST") return gatePage(res, 405);
  const refused = gateRefusal(req.headers);
  if (refused) {
    tell({ type: "refused", reason: "origin" });
    return gatePage(res, 403, (lang) => `<p class="warn">${esc(tx(lang, "refused", { reason: refused }))}</p>`);
  }
  const now = Date.now();
  if (now < lock.until) {
    tell({ type: "refused", reason: "locked" });
    return gatePage(res, 429, (lang) => `<p class="warn">${esc(tx(lang, "locked", { seconds: Math.ceil((lock.until - now) / 1000) }))}</p>`);
  }
  const body = await readSmallBody(req, 1024);
  const typed = body === null ? "" : (new URLSearchParams(body).get("pass") ?? "");
  const p = pass;
  if (!p || Date.now() >= p.expiresAt) {
    if (p) pass = null;
    tell({ type: "refused", reason: p ? "expired" : "no_pass" });
    return gatePage(res, 403, (lang) => `<p class="warn">${esc(tx(lang, "no_pass"))}</p>`);
  }
  if (!passMatches(typed, p.digest)) {
    lock.wrong++;
    if (lock.wrong >= PASS_TRIES) {
      // Five wrong passes: the pass is void and the gate locked, each lock-out twice as long as the last.
      pass = null;
      lock.wrong = 0;
      lock.until = Date.now() + lock.nextMs;
      const seconds = Math.ceil(lock.nextMs / 1000);
      lock.nextMs *= 2;
      tell({ type: "refused", reason: "locked", voided: true });
      return gatePage(res, 429, (lang) => `<p class="warn">${esc(tx(lang, "locked", { seconds }))}</p>`);
    }
    tell({ type: "refused", reason: "wrong_pass" });
    return gatePage(res, 403, (lang) => `<p class="warn">${esc(tx(lang, "wrong"))}</p>`);
  }
  // The right pass: used once.
  pass = null;
  lock.wrong = 0;
  endSession("replaced");
  const origin = one(req.headers.origin).trim();
  const token = randomBytes(32).toString("hex");
  session = { id: p.sessionId, token, prefix: p.prefix, appPort: p.appPort, origin: origin !== "" ? originOf(origin) : null, endsAt: p.sessionEndsAt, agent: pumpAgent() };
  tell({ type: "entered", sessionId: p.sessionId, secFetchSite: one(req.headers["sec-fetch-site"]).trim() !== "" });
  res.writeHead(303, {
    location: "/",
    "set-cookie": `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
    "clear-site-data": '"cache", "storage"',
    ...frontHeaders({ own: true }),
  });
  res.end();
}

async function leave(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method === "GET" || req.method === "HEAD")
    return page(res, 200, (lang) => `<form method="post" action="${LEAVE_PATH}"><button type="submit">${esc(tx(lang, "leave"))}</button></form>`);
  if (req.method !== "POST") return page(res, 405, () => "");
  const refused = gateRefusal(req.headers);
  if (refused) return page(res, 403, (lang) => `<p class="warn">${esc(tx(lang, "refused", { reason: refused }))}</p>`);
  const s = validSession(req);
  if (s) endSession("leave");
  page(res, 200, (lang) => `<p data-left>${esc(tx(lang, "left"))}</p>`, { "set-cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
}

/* ------------------------------------------------------------------ passing a request to the app */

function forward(req: http.IncomingMessage, res: http.ServerResponse, s: Session, retried = false): void {
  const method = req.method ?? "GET";
  const headers = upstreamHeaders(req.headers, { method, appPort: s.appPort, storedOrigin: s.origin, prefix: s.prefix, controls });
  let answered = false;
  const fail = (key: "no_answer" | "too_large") => {
    if (answered || res.headersSent) {
      res.destroy();
      return;
    }
    answered = true;
    page(res, key === "too_large" ? 413 : 502, (lang) => `<p class="warn">${esc(tx(lang, key))}</p>`);
  };
  const up = http.request({ agent: s.agent, method, path: req.url, headers, setHost: false });
  // The browser left before the app's answer came: the request to the app is stopped at once (its stream is then ended).
  res.on("close", () => {
    if (!answered) up.destroy();
  });
  const headersTimer = setTimeout(() => {
    up.destroy();
    fail("no_answer");
  }, HEADERS_WITHIN_MS);
  let idle: NodeJS.Timeout | undefined;
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      up.destroy();
      res.destroy();
    }, IDLE_MS);
  };
  touch();
  up.on("error", (e: NodeJS.ErrnoException) => {
    clearTimeout(headersTimer);
    clearTimeout(idle);
    // A kept-alive stream the app had just closed: a GET or HEAD is sent once more, on a new stream.
    if (!retried && !answered && (method === "GET" || method === "HEAD") && (up as http.ClientRequest & { reusedSocket?: boolean }).reusedSocket && e.code === "ECONNRESET") {
      forward(req, res, s, true);
      return;
    }
    fail("no_answer");
  });
  up.on("response", (r) => {
    clearTimeout(headersTimer);
    touch();
    if (answered) {
      r.resume();
      return;
    }
    const status = r.statusCode ?? 502;
    const refusal = responseRefusal(status, r.headers, method);
    if (refusal) {
      answered = true;
      r.resume();
      return page(res, 502, (lang) => `<p class="warn">${esc(tx(lang, "not_passed", { reason: refusal }))}</p>`);
    }
    const d = downstreamHeaders(r.headers, { appPort: s.appPort, prefix: s.prefix, controls, cspSandbox });
    if (d.locationRefused) {
      answered = true;
      r.resume();
      return page(res, 502, (lang) => `<p class="warn" data-off-site>${esc(tx(lang, "off_site"))}</p>`);
    }
    answered = true;
    res.writeHead(status, d.headers);
    // After the review bot on af80dc9: an answer the app cuts short ends at the browser at once (preview-rules.ts).
    relayAnswer(r, res, { touch, clear: () => clearTimeout(idle) });
  });
  // The body, unread, counted: past 1 MB the request is stopped.
  if (method === "GET" || method === "HEAD") {
    up.end();
    return;
  }
  let size = 0;
  req.on("data", (d: Buffer) => {
    touch();
    size += d.length;
    if (size > MAX_BODY_BYTES) {
      up.destroy();
      fail("too_large");
      req.destroy();
      return;
    }
    up.write(d);
  });
  req.on("end", () => up.end());
  req.on("error", () => up.destroy());
}

/* ------------------------------------------------------------------ the server */

const server = http.createServer({ maxHeaderSize: MAX_HEADER_BYTES, requestTimeout: 120_000, headersTimeout: 30_000 }, (req, res) => {
  res.on("error", () => undefined);
  req.on("error", () => undefined);
  const kind = pathKind(req.url ?? "");
  if (kind === "refused") return page(res, 400, (lang) => `<p class="warn">${esc(tx(lang, "not_found"))}</p>`);
  if (kind === "enter") return void enter(req, res).catch(() => res.destroy());
  if (kind === "leave") return void leave(req, res).catch(() => res.destroy());
  if (kind === "builder-other") return page(res, 404, (lang) => `<p>${esc(tx(lang, "not_found"))}</p>`);
  const s = validSession(req);
  if (!s) return gatePage(res, 200);
  const refused = requestRefusal(req.method ?? "", req.headers, s.origin);
  if (refused) {
    req.resume();
    return page(res, refused === "a body over 1 MB" ? 413 : 403, (lang) => `<p class="warn">${esc(tx(lang, "refused", { reason: refused }))}</p>`);
  }
  forward(req, res, s);
});
server.on("clientError", (_err, socket) => socket.destroy());
server.listen(PORT, "127.0.0.1", () => tell({ type: "listening", port: PORT }));
server.on("error", () => process.exit(3));

/* ------------------------------------------------------------------ the fork channel */

process.on("message", (raw: unknown) => {
  const m = toFrontMessage(raw);
  if (!m) return; // a message of another shape is ignored
  if (m.type === "texts") texts = { en: m.en, ar: m.ar };
  else if (m.type === "pass") {
    pass = { digest: m.digest, expiresAt: m.expiresAt, sessionId: m.sessionId, prefix: m.prefix, appPort: m.appPort, sessionEndsAt: m.sessionEndsAt };
  } else if (m.type === "revoke") {
    pass = null;
    endSession("revoked");
  } else if (m.type === "controls") {
    controls = m.controls;
    cspSandbox = m.cspSandbox;
  } else if (m.type === "stop") {
    pass = null;
    endSession("revoked");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  }
});
// The interface has gone: so does the front.
process.on("disconnect", () => process.exit(0));
