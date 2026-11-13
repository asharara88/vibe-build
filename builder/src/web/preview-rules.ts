/**
 * The live preview's rules (package J3; final design, sections 4.4 to 4.6): pure functions, no state, no I/O.
 *
 * The preview front (preview-front.ts) uses them on every request it takes from the owner's browser and every
 * answer it passes back from the app; the interface (preview.ts) uses the pass's. They are kept apart so that each
 * rule has its own test (test/preview-rules.test.ts) and its own control.
 *
 * This file and preview-front.ts are copied into the interface's own short folder and run there by Node's own
 * type stripping, as an unprivileged user that cannot read the builder's folders (preview.ts). So they import
 * nothing but Node's own modules, and use only syntax Node can strip (no enums, namespaces or parameter properties).
 *
 * Names of headers are compared in lower case, as Node gives them.
 */
import { createHash, timingSafeEqual } from "node:crypto";

/* ------------------------------------------------------------------ the pass */

/**
 * The 32 symbols a pass is written with: Crockford's base 32 (digits and capital letters without I, L, O and U).
 * When it is typed, O is read as 0, I and L as 1, small letters as capitals, and spaces and dashes are dropped,
 * so the symbols that look alike cannot be mistaken (`normalisePass`).
 */
export const PASS_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** A pass has 8 symbols: 40 bits. */
export const PASS_LENGTH = 8;
/** How long a pass may be used, from when it is shown: 2 minutes. */
export const PASS_VALID_MS = 120_000;
/** Wrong passes before the pass is voided and the gate locked (section 4.4). */
export const PASS_TRIES = 5;
/** The first lock-out of the gate; each next one is twice as long. Chosen, not measured. */
export const GATE_LOCK_FIRST_MS = 60_000;
/** The longest a live session lasts (section 4.4). */
export const SESSION_MAX_MS = 8 * 60 * 60 * 1000;

/** A pass from 8 random bytes (`bytes`, at least 8): each symbol from the low 5 bits of one byte. */
export function passFromBytes(bytes: Uint8Array): string {
  if (bytes.length < PASS_LENGTH) throw new Error("A pass needs 8 random bytes.");
  let out = "";
  for (let i = 0; i < PASS_LENGTH; i++) out += PASS_ALPHABET[bytes[i]! & 31];
  return out;
}

/** The pass as it is shown: two groups of four, "ABCD-EFGH". */
export const showPass = (pass: string): string => `${pass.slice(0, 4)}-${pass.slice(4)}`;

/** What was typed, as a pass: spaces and dashes dropped, capitals, O as 0, I and L as 1. Null if it cannot be one. */
export function normalisePass(typed: string): string | null {
  if (typeof typed !== "string" || typed.length > 40) return null;
  const s = typed
    .replace(/[\s-]/g, "")
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (s.length !== PASS_LENGTH) return null;
  for (const ch of s) if (!PASS_ALPHABET.includes(ch)) return null;
  return s;
}

/** The pass's digest: only this reaches the preview front. */
export const passDigest = (pass: string): string => createHash("sha256").update(`builder-preview-pass:${pass}`).digest("hex");

/** True if `typed` is the pass whose digest is `digest`, compared in constant time. */
export function passMatches(typed: string, digest: string): boolean {
  const n = normalisePass(typed);
  if (n === null || !/^[0-9a-f]{64}$/.test(digest)) return false;
  return timingSafeEqual(Buffer.from(passDigest(n), "hex"), Buffer.from(digest, "hex"));
}

/* ------------------------------------------------------------------ paths */

/** The front's own paths: only these two live under /__builder/. */
export const ENTER_PATH = "/__builder/enter";
export const LEAVE_PATH = "/__builder/leave";

export type PathKind = "enter" | "leave" | "builder-other" | "app" | "refused";

/**
 * What a request's path is (section 4.4): the front's "enter" or "leave", another /__builder/ path (never passed to
 * the app), the app's, or refused. Only the path is read (before "?"). Refused: a path that does not start with
 * "/", or holds an encoded "/" (%2F), an encoded "_" (%5F), an encoded "." (%2E), a backslash, a control character,
 * a "." or ".." segment, or a "%" that does not start an escape. The rest is decoded and then compared, so that no
 * spelling of /__builder/ reaches the app.
 */
export function pathKind(rawUrl: string): PathKind {
  if (typeof rawUrl !== "string" || !rawUrl.startsWith("/")) return "refused";
  const path = rawUrl.split("?")[0]!.split("#")[0]!;
  if (/%(2f|5f|2e|5c)/i.test(path) || /[\\\u0000- \u007f]/.test(path) || /%(?![0-9a-f]{2})/i.test(path)) return "refused";
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return "refused";
  }
  if (/[\\\u0000-\u001f\u007f]/.test(decoded)) return "refused";
  const segments = decoded.split("/");
  if (segments.some((s) => s === "." || s === "..")) return "refused";
  const lower = decoded.toLowerCase();
  if (lower === "/__builder" || lower.startsWith("/__builder/")) {
    if (decoded === ENTER_PATH) return "enter";
    if (decoded === LEAVE_PATH) return "leave";
    return "builder-other";
  }
  return "app";
}

/* ------------------------------------------------------------------ requests */

/** The methods the front passes on. Anything else is refused before any stream opens. */
export const METHODS = ["GET", "HEAD", "POST"];
/** The largest request body the front takes. */
export const MAX_BODY_BYTES = 1024 * 1024;
/** The most header bytes the front takes (Node's own limit on its server, `maxHeaderSize`). */
export const MAX_HEADER_BYTES = 16 * 1024;

/** One header's value as Node gives it, as one string ("" for none; a list joined as Node joins it). */
export function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v.join(", ") : (v ?? "");
}

/**
 * Why a request is refused before any stream to the app is opened, or null (section 4.5):
 * - any method with Sec-Fetch-Site cross-site or same-site;
 * - a method other than GET, HEAD and POST;
 * - a POST with neither Sec-Fetch-Site: same-origin nor an Origin equal to the stored one (so, if neither header
 *   ever comes, every POST is refused);
 * - a body said to be over 1 MB (a longer body that does not say so is cut off as it streams).
 */
export function requestRefusal(method: string, headers: Record<string, string | string[] | undefined>, storedOrigin: string | null): string | null {
  const site = one(headers["sec-fetch-site"]).trim().toLowerCase();
  if (site === "cross-site" || site === "same-site") return `a request from another site (Sec-Fetch-Site: ${site})`;
  if (!METHODS.includes(method)) return `the method ${method.slice(0, 20)} is not passed on`;
  if (method === "POST") {
    const origin = one(headers.origin).trim();
    const sameOrigin = site === "same-origin";
    const originOk = storedOrigin !== null && origin !== "" && origin === storedOrigin;
    if (!sameOrigin && !originOk) return "a POST that does not show it comes from this page (no Sec-Fetch-Site: same-origin, and no Origin equal to the preview's)";
  }
  const length = one(headers["content-length"]).trim();
  if (length !== "" && (!/^\d{1,12}$/.test(length) || Number(length) > MAX_BODY_BYTES)) return "a body over 1 MB";
  return null;
}

/**
 * The request headers passed on to the app, by name (section 4.5). Everything else is dropped: cookies are passed
 * by `appCookies`, Host, Origin and Referer by `upstreamHeaders`.
 */
const FORWARDED_EXACT = new Set([
  "content-type",
  "content-length",
  "user-agent",
  "cache-control",
  "pragma",
  "range",
  "rsc",
  "next-action",
  "next-router-state-tree",
  "next-router-prefetch",
  "next-router-segment-prefetch",
  "next-url",
]);
export function forwardedRequestHeader(name: string): boolean {
  const n = name.toLowerCase();
  return FORWARDED_EXACT.has(n) || n.startsWith("accept") || n.startsWith("if-") || n.startsWith("sec-fetch-");
}

/** What the front can turn off, one at a time, for the measurements of section 6 (M3). The interface never does. */
export interface MappingControls {
  host?: boolean;
  origin?: boolean;
  referer?: boolean;
  secFetch?: boolean;
  cookiePrefix?: boolean;
}

/** The session's cookie prefix: "bp", 8 lower-case hexadecimal characters, "_". */
export const PREFIX_PATTERN = /^bp[0-9a-f]{8}_$/;

/** The serialised origin of a URL ("scheme://host[:port]"), or null if it has none. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.origin === "null" ? null : u.origin;
  } catch {
    return null;
  }
}

/**
 * The Cookie header passed on to the app (section 4.5): only the cookies whose name starts with this session's
 * prefix, the prefix removed. With the prefix control off, every cookie but the front's own passes as it is.
 */
export function appCookies(cookieHeader: string, prefix: string, controls: MappingControls = {}): string | null {
  const out: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const kv = part.trim();
    if (kv === "") continue;
    const eq = kv.indexOf("=");
    if (eq <= 0) continue;
    const name = kv.slice(0, eq);
    if (controls.cookiePrefix) {
      if (!name.toLowerCase().startsWith("builder_")) out.push(kv);
      continue;
    }
    if (name.startsWith(prefix) && name.length > prefix.length) out.push(`${name.slice(prefix.length)}${kv.slice(eq)}`);
  }
  return out.length ? out.join("; ") : null;
}

/** Every value of a cookie by its name, from a Cookie header (a browser can send the same name more than once). */
export function cookieValues(cookieHeader: string, name: string): string[] {
  const out: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const kv = part.trim();
    const eq = kv.indexOf("=");
    if (eq > 0 && kv.slice(0, eq) === name) out.push(kv.slice(eq + 1));
  }
  return out;
}

/**
 * The headers sent to the app (section 4.5): the allowlist; Host becomes app:<port>; an Origin becomes
 * http://app:<port>; a Referer keeps its path with its origin replaced if that origin is the stored one, and is
 * dropped otherwise; the cookies of `appCookies`. Each mapping can be turned off for the measurements (`controls`).
 * After J3's review: a GET or a HEAD is sent with no Content-Length. The front never sends their body, so a stated
 * length would make the app wait for one, or read the next request on a kept-alive stream as that body (a way to
 * pass headers that are not on the allowlist).
 */
export function upstreamHeaders(
  headers: Record<string, string | string[] | undefined>,
  o: { method: string; appPort: number; storedOrigin: string | null; prefix: string; controls?: MappingControls },
): Record<string, string> {
  const c = o.controls ?? {};
  const app = `http://app:${o.appPort}`;
  const bodiless = o.method === "GET" || o.method === "HEAD";
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || !forwardedRequestHeader(name)) continue;
    if (bodiless && name === "content-length") continue;
    // The control for Sec-Fetch-*: those headers are not passed on.
    if (c.secFetch && name.startsWith("sec-fetch-")) continue;
    out[name] = one(value);
  }
  out.host = c.host ? one(headers.host) : `app:${o.appPort}`;
  const origin = one(headers.origin).trim();
  if (origin !== "") out.origin = c.origin ? origin : app;
  const referer = one(headers.referer).trim();
  if (referer !== "") {
    if (c.referer) out.referer = referer;
    else if (o.storedOrigin !== null && originOf(referer) === o.storedOrigin) {
      const u = new URL(referer);
      out.referer = `${app}${u.pathname}${u.search}`;
    }
  }
  const cookies = appCookies(one(headers.cookie), o.prefix, c);
  if (cookies !== null) out.cookie = cookies;
  return out;
}

/* ------------------------------------------------------------------ answers */

/** The app's headers the front drops (section 4.6), and hop-by-hop headers, and those the front sets itself. */
const DROPPED_EXACT = new Set([
  "refresh",
  "link",
  "report-to",
  "reporting-endpoints",
  "nel",
  "content-security-policy",
  "content-security-policy-report-only",
  "clear-site-data",
  "strict-transport-security",
  "alt-svc",
  "service-worker-allowed",
  "content-location",
  // After J3's review: headers that make the browser fetch, or prepare connections to, other addresses without the
  // page navigating (prefetch and prerender rules, DNS prefetching, source maps), change what it sends (client hints,
  // a retry for them), or turn on browser features for the origin (login status, credentialed prerender, trials).
  "speculation-rules",
  "x-dns-prefetch-control",
  "sourcemap",
  "x-sourcemap",
  "accept-ch",
  "critical-ch",
  "set-login",
  "supports-loading-mode",
  "origin-trial",
  // hop by hop
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  // set by the front
  "cache-control",
  "permissions-policy",
  "cross-origin-opener-policy",
  "referrer-policy",
  "x-content-type-options",
  "x-frame-options",
  // read and rewritten by the front
  "set-cookie",
  "location",
]);
export function droppedResponseHeader(name: string): boolean {
  const n = name.toLowerCase();
  return DROPPED_EXACT.has(n) || n.startsWith("access-control-") || n.startsWith("attribution-reporting-");
}

/** A cookie name as RFC 6265 allows it: a token (no separators, spaces or control characters). */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * One Set-Cookie of the app, through the strict scanner (section 4.6): dropped (null) if it cannot be read, has a
 * Domain attribute, or a name starting "__Host-", "__Secure-" or "builder_" (in any case); otherwise renamed with the
 * session's prefix, every attribute kept as it was. Nothing else is changed.
 */
export function scanSetCookie(value: string, prefix: string, controls: MappingControls = {}): string | null {
  if (typeof value !== "string" || value.length > 4096 || /[\u0000-\u0008\u000a-\u001f\u007f]/.test(value)) return null;
  const parts = value.split(";");
  const first = parts[0]!.trim();
  const eq = first.indexOf("=");
  if (eq <= 0) return null;
  const name = first.slice(0, eq).trim();
  if (!TOKEN.test(name)) return null;
  const lower = name.toLowerCase();
  if (lower.startsWith("__host-") || lower.startsWith("__secure-") || lower.startsWith("builder_")) return null;
  for (const attr of parts.slice(1)) {
    const a = attr.trim();
    const an = (a.includes("=") ? a.slice(0, a.indexOf("=")) : a).trim().toLowerCase();
    if (an === "domain") return null;
  }
  if (controls.cookiePrefix) return value;
  if (!PREFIX_PATTERN.test(prefix)) return null;
  return `${prefix}${first}${value.slice(parts[0]!.length)}`;
}

/**
 * The app's Location, as the browser gets it (section 4.6): kept if it starts with exactly one "/" (a path on the
 * preview); cut to its path if it starts with http://app:<port>/; otherwise null, and the front shows its own page.
 * A Location holding a backslash, a space, a tab or another control character is refused too: a browser drops tabs
 * and line ends from an address and reads a backslash as "/", so "/\evil" or "/<tab>/evil" would lead off the site.
 */
export function mapLocation(value: string, appPort: number): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  let v = value;
  const app = `http://app:${appPort}/`;
  if (v.startsWith(app)) v = v.slice(app.length - 1);
  if (!/^\/(?![/\\])/.test(v)) return null;
  if (/[\\\u0000- \u007f]/.test(v)) return null;
  return v;
}

/** The content types the front passes on (section 4.6); anything else is refused. */
export function contentTypeAllowed(contentType: string): boolean {
  const t = contentType.split(";")[0]!.trim().toLowerCase();
  if (t === "") return false;
  if (["text/html", "text/css", "text/javascript", "application/javascript", "application/json", "text/x-component", "text/plain"].includes(t)) return true;
  if (/^application\/[a-z0-9.+-]+\+json$/.test(t)) return true;
  if (/^image\/[a-z0-9.+-]+$/.test(t) || /^font\/[a-z0-9.+-]+$/.test(t)) return true;
  return false;
}

/** Statuses that carry no body to judge: an answer with one of these may come without a content type. */
const BODYLESS = (status: number) => status === 204 || status === 304 || (status >= 300 && status < 400) || status < 200;

/** Why an answer of the app is refused (section 4.6), or null: an attachment, or a content type not on the list. */
export function responseRefusal(status: number, headers: Record<string, string | string[] | undefined>, method: string): string | null {
  const disposition = one(headers["content-disposition"]).trim().toLowerCase();
  if (disposition.startsWith("attachment")) return "the app sent a file to save (Content-Disposition: attachment)";
  const type = one(headers["content-type"]);
  if (type.trim() === "") {
    if (BODYLESS(status) || method === "HEAD") return null;
    const length = one(headers["content-length"]).trim();
    if (length === "0") return null;
    return "the app's answer has no content type";
  }
  if (!contentTypeAllowed(type)) return `the app's answer is of a type the preview does not pass on (${type.split(";")[0]!.trim().slice(0, 60)})`;
  return null;
}

/** The content-security-policy the front sets on every answer of the app (section 4.6). */
export const APP_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'; worker-src 'none'; object-src 'none'; base-uri 'self'";
/** The sandbox value M3 tried; the app works with it (M3), so the front adds it to every answer of the app. */
export const CSP_SANDBOX = "sandbox allow-scripts allow-forms allow-same-origin";
/** The content-security-policy of the front's own pages: no script at all. */
export const FRONT_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
export const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()";

/** The headers the front sets on every answer, the app's and its own (section 4.6). */
export function frontHeaders(o: { own: boolean; cspSandbox?: boolean }): Record<string, string> {
  return {
    "cache-control": "private, no-store",
    "content-security-policy": o.own ? FRONT_CSP : o.cspSandbox ? `${APP_CSP}; ${CSP_SANDBOX}` : APP_CSP,
    "permissions-policy": PERMISSIONS_POLICY,
    "cross-origin-opener-policy": "same-origin",
    "referrer-policy": "same-origin",
    "x-content-type-options": "nosniff",
  };
}

/**
 * The app's answer headers as the browser gets them: everything but the dropped ones; each Set-Cookie through the
 * scanner; Location mapped (null: the front shows its own page instead); then the front's own headers.
 */
export function downstreamHeaders(
  headers: Record<string, string | string[] | undefined>,
  o: { appPort: number; prefix: string; controls?: MappingControls; cspSandbox?: boolean },
): { headers: Record<string, string | string[]>; locationRefused: boolean; cookiesDropped: number } {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || droppedResponseHeader(name)) continue;
    out[name] = value;
  }
  let cookiesDropped = 0;
  const raw = headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const kept: string[] = [];
  for (const c of list) {
    const s = scanSetCookie(c, o.prefix, o.controls);
    if (s === null) cookiesDropped++;
    else kept.push(s);
  }
  if (kept.length) out["set-cookie"] = kept;
  let locationRefused = false;
  const loc = one(headers.location);
  if (loc !== "") {
    const mapped = mapLocation(loc, o.appPort);
    if (mapped === null) locationRefused = true;
    else out.location = mapped;
  }
  Object.assign(out, frontHeaders({ own: false, cspSandbox: o.cspSandbox }));
  return { headers: out, locationRefused, cookiesDropped };
}

/** Time limits on an answer (section 4.6): its headers within 30 s, and at most 60 s with nothing sent either way. */
export const HEADERS_WITHIN_MS = 30_000;
export const IDLE_MS = 60_000;

/* ------------------------------------------------------------------ the gate */

/**
 * Why the gate refuses a POST to "enter" or "leave", or null (section 4.4): an Origin of "null"; neither an Origin
 * nor Sec-Fetch-Site: same-origin; Sec-Fetch-Site cross-site or same-site.
 */
export function gateRefusal(headers: Record<string, string | string[] | undefined>): string | null {
  const origin = one(headers.origin).trim();
  const site = one(headers["sec-fetch-site"]).trim().toLowerCase();
  if (site === "cross-site" || site === "same-site") return "from another site";
  if (origin === "null") return "from a page with no origin";
  if (origin === "" && site !== "same-origin") return "with neither an Origin nor Sec-Fetch-Site: same-origin";
  if (origin !== "" && originOf(origin) !== origin) return "with an Origin that is not one";
  return null;
}

/** The front's session cookie. */
export const SESSION_COOKIE = "builder_preview";

/* ------------------------------------------------------------------ the fork channel */

/** The texts of the front's own pages, by key, in each language: sent by the interface from its message files. */
export const FRONT_TEXT_KEYS = ["title", "label_sim", "label_data", "no_live", "pass_label", "pass_help", "enter", "wrong", "locked", "no_pass", "refused", "leave", "left", "off_site", "not_passed", "no_answer", "too_large", "not_found"] as const;
export type FrontTextKey = (typeof FRONT_TEXT_KEYS)[number];
export type Texts = { en: Record<FrontTextKey, string>; ar: Record<FrontTextKey, string> };

/** What the interface sends the front. Each has a fixed shape, checked at both ends (`toFrontMessage`). */
export type ToFront =
  | { type: "texts"; en: Record<FrontTextKey, string>; ar: Record<FrontTextKey, string> }
  | { type: "pass"; digest: string; expiresAt: number; sessionId: string; prefix: string; appPort: number; sessionEndsAt: number }
  | { type: "revoke"; reason: string }
  | { type: "controls"; controls: MappingControls; cspSandbox: boolean }
  | { type: "stop" };

/** What the front sends the interface (`fromFrontMessage`). */
export type FromFront =
  | { type: "listening"; port: number }
  | { type: "entered"; sessionId: string; secFetchSite: boolean }
  | { type: "refused"; reason: "wrong_pass" | "locked" | "no_pass" | "expired" | "origin"; voided?: boolean }
  | { type: "closed"; sessionId: string; reason: "leave" | "expired" };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const keysAre = (o: Record<string, unknown>, keys: string[]) => {
  const k = Object.keys(o).sort();
  const want = [...keys].sort();
  return k.length === want.length && k.every((x, i) => x === want[i]);
};
const SESSION_ID = /^live-[0-9a-f]{16}$/;
const isTime = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0;
const isTexts = (v: unknown): v is Record<FrontTextKey, string> =>
  isObj(v) && keysAre(v, [...FRONT_TEXT_KEYS]) && Object.values(v).every((x) => typeof x === "string" && x.length <= 600);
const CONTROL_KEYS = ["host", "origin", "referer", "secFetch", "cookiePrefix"];

/** A message from the interface, if it has one of the fixed shapes exactly; otherwise null (and it is ignored). */
export function toFrontMessage(m: unknown): ToFront | null {
  if (!isObj(m) || typeof m.type !== "string") return null;
  switch (m.type) {
    case "texts":
      return keysAre(m, ["type", "en", "ar"]) && isTexts(m.en) && isTexts(m.ar) ? { type: "texts", en: m.en, ar: m.ar } : null;
    case "pass":
      return keysAre(m, ["type", "digest", "expiresAt", "sessionId", "prefix", "appPort", "sessionEndsAt"]) &&
        typeof m.digest === "string" &&
        /^[0-9a-f]{64}$/.test(m.digest) &&
        isTime(m.expiresAt) &&
        isTime(m.sessionEndsAt) &&
        typeof m.sessionId === "string" &&
        SESSION_ID.test(m.sessionId) &&
        typeof m.prefix === "string" &&
        PREFIX_PATTERN.test(m.prefix) &&
        typeof m.appPort === "number" &&
        Number.isInteger(m.appPort) &&
        m.appPort >= 1 &&
        m.appPort <= 65535
        ? { type: "pass", digest: m.digest, expiresAt: m.expiresAt as number, sessionId: m.sessionId, prefix: m.prefix, appPort: m.appPort, sessionEndsAt: m.sessionEndsAt as number }
        : null;
    case "revoke":
      return keysAre(m, ["type", "reason"]) && typeof m.reason === "string" && /^[a-z_]{1,40}$/.test(m.reason) ? { type: "revoke", reason: m.reason } : null;
    case "controls":
      return keysAre(m, ["type", "controls", "cspSandbox"]) &&
        isObj(m.controls) &&
        Object.entries(m.controls).every(([k, v]) => CONTROL_KEYS.includes(k) && typeof v === "boolean") &&
        typeof m.cspSandbox === "boolean"
        ? { type: "controls", controls: m.controls as MappingControls, cspSandbox: m.cspSandbox }
        : null;
    case "stop":
      return keysAre(m, ["type"]) ? { type: "stop" } : null;
    default:
      return null;
  }
}

/** A message from the front, if it has one of the fixed shapes exactly; otherwise null (and it is ignored). */
export function fromFrontMessage(m: unknown): FromFront | null {
  if (!isObj(m) || typeof m.type !== "string") return null;
  switch (m.type) {
    case "listening":
      return keysAre(m, ["type", "port"]) && typeof m.port === "number" && Number.isInteger(m.port) ? { type: "listening", port: m.port } : null;
    case "entered":
      return keysAre(m, ["type", "sessionId", "secFetchSite"]) && typeof m.sessionId === "string" && SESSION_ID.test(m.sessionId) && typeof m.secFetchSite === "boolean"
        ? { type: "entered", sessionId: m.sessionId, secFetchSite: m.secFetchSite }
        : null;
    case "refused": {
      const reasons = ["wrong_pass", "locked", "no_pass", "expired", "origin"];
      const ok = (keysAre(m, ["type", "reason"]) || (keysAre(m, ["type", "reason", "voided"]) && typeof m.voided === "boolean")) && typeof m.reason === "string" && reasons.includes(m.reason);
      return ok ? { type: "refused", reason: m.reason as "wrong_pass", ...(typeof m.voided === "boolean" ? { voided: m.voided } : {}) } : null;
    }
    case "closed":
      return keysAre(m, ["type", "sessionId", "reason"]) && typeof m.sessionId === "string" && SESSION_ID.test(m.sessionId) && (m.reason === "leave" || m.reason === "expired")
        ? { type: "closed", sessionId: m.sessionId, reason: m.reason }
        : null;
    default:
      return null;
  }
}
