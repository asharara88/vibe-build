/**
 * Package J3: the live preview's rules (src/web/preview-rules.ts), one by one, without a process or a container.
 * Every rule of sections 4.4 to 4.6 of the final design: the pass, the paths, the requests refused before any stream,
 * the header allowlist and mappings, the cookie prefix and scanner, Location, the dropped and refused answers, the
 * front's own headers, the gate's origin rule, and the fork channel's fixed shapes.
 */
import { describe, expect, it } from "vitest";
import {
  APP_CSP,
  appCookies,
  contentTypeAllowed,
  cookieValues,
  downstreamHeaders,
  droppedResponseHeader,
  forwardedRequestHeader,
  FRONT_TEXT_KEYS,
  frontHeaders,
  fromFrontMessage,
  gateRefusal,
  mapLocation,
  normalisePass,
  passDigest,
  passFromBytes,
  passMatches,
  PASS_ALPHABET,
  pathKind,
  requestRefusal,
  responseRefusal,
  scanSetCookie,
  showPass,
  toFrontMessage,
  upstreamHeaders,
} from "../src/web/preview-rules.ts";

const PREFIX = "bp0a1b2c3d_";
const ORIGIN = "https://made-up-preview.example";

describe("the pass (section 4.4)", () => {
  it("8 symbols from 32 that cannot be confused (40 bits); typed in any case, with spaces or a dash, O read as 0, I and L as 1", () => {
    expect(PASS_ALPHABET).toHaveLength(32);
    expect(new Set(PASS_ALPHABET).size).toBe(32);
    for (const ch of "ILOU") expect(PASS_ALPHABET.includes(ch)).toBe(false);
    const p = passFromBytes(Uint8Array.from([0, 1, 2, 3, 28, 29, 30, 31]));
    expect(p).toBe("0123WXYZ");
    expect(showPass(p)).toBe("0123-WXYZ");
    expect(normalisePass("o123 wxyz")).toBe("0123WXYZ");
    expect(normalisePass("O1Z3-WXYZ")).toBe("01Z3WXYZ");
    expect(normalisePass("il23wxyz")).toBe("1123WXYZ");
    expect(normalisePass("0123WXY")).toBeNull();
    expect(normalisePass("0123WXYZ9")).toBeNull();
    expect(normalisePass("0123WXY!")).toBeNull();
  });
  it("only its digest is compared, in constant time; the wrong pass or a malformed digest never matches", () => {
    const d = passDigest("0123WXYZ");
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(passMatches("0123-wxyz", d)).toBe(true);
    expect(passMatches("0123WXY0", d)).toBe(false);
    expect(passMatches("0123WXYZ", "not-a-digest")).toBe(false);
    expect(passMatches("", d)).toBe(false);
  });
});

describe("paths (section 4.4): only enter and leave live under /__builder/, matched after decoding", () => {
  it("enter, leave, any other /__builder/ path, the app's", () => {
    expect(pathKind("/__builder/enter")).toBe("enter");
    expect(pathKind("/__builder/leave?x=1")).toBe("leave");
    expect(pathKind("/__builder/other")).toBe("builder-other");
    expect(pathKind("/__builder")).toBe("builder-other");
    expect(pathKind("/__BUILDER/enter")).toBe("builder-other");
    expect(pathKind("/__builder%2Fenter")).toBe("refused");
    expect(pathKind("/en/my-requests?sent=1")).toBe("app");
    expect(pathKind("/_next/static/chunks/a.js")).toBe("app");
  });
  it("%2F, %5F, %2E, a backslash, a dot segment, a broken escape or a control character is refused", () => {
    for (const p of ["/%2F__builder/enter", "/%5F_builder/enter", "/_%5Fbuilder/enter", "/a/%2e%2e/__builder/enter", "/a/../__builder/enter", "/./x", "/a\\b", "/a%zz", "/a%0d%0ab", "/a b", "relative"]) {
      expect(pathKind(p), p).toBe("refused");
    }
    // A path that starts "//" is only a path here: it goes to the app as one, with Host app:3161 (never to another host).
    expect(pathKind("//evil.example/x")).toBe("app");
  });
  it("an encoded letter that spells /__builder/ is still the front's, never the app's", () => {
    expect(pathKind("/%5f%5fbuilder/enter")).toBe("refused");
    expect(pathKind("/__b%75ilder/enter")).toBe("enter");
    expect(pathKind("/__b%75ilder/x")).toBe("builder-other");
  });
});

describe("requests refused before any stream opens (section 4.5)", () => {
  it("Sec-Fetch-Site cross-site or same-site, for any method", () => {
    for (const m of ["GET", "HEAD", "POST"]) {
      expect(requestRefusal(m, { "sec-fetch-site": "cross-site" }, ORIGIN)).toMatch(/another site/);
      expect(requestRefusal(m, { "sec-fetch-site": "same-site" }, ORIGIN)).toMatch(/another site/);
    }
    expect(requestRefusal("GET", { "sec-fetch-site": "same-origin" }, ORIGIN)).toBeNull();
    expect(requestRefusal("GET", { "sec-fetch-site": "none" }, ORIGIN)).toBeNull();
    expect(requestRefusal("GET", {}, null)).toBeNull();
  });
  it("methods other than GET, HEAD and POST", () => {
    for (const m of ["PUT", "DELETE", "PATCH", "OPTIONS", "CONNECT", "TRACE"]) expect(requestRefusal(m, { "sec-fetch-site": "same-origin" }, ORIGIN), m).toMatch(/method/);
  });
  it("a POST with neither Sec-Fetch-Site: same-origin nor an Origin equal to the stored one; with neither header ever, every POST", () => {
    expect(requestRefusal("POST", { "sec-fetch-site": "same-origin" }, ORIGIN)).toBeNull();
    expect(requestRefusal("POST", { origin: ORIGIN }, ORIGIN)).toBeNull();
    expect(requestRefusal("POST", { origin: "https://other.example" }, ORIGIN)).toMatch(/POST/);
    expect(requestRefusal("POST", {}, ORIGIN)).toMatch(/POST/);
    expect(requestRefusal("POST", { origin: "null" }, ORIGIN)).toMatch(/POST/);
    expect(requestRefusal("POST", {}, null)).toMatch(/POST/);
    expect(requestRefusal("POST", { origin: ORIGIN }, null)).toMatch(/POST/);
  });
  it("a body said to be over 1 MB, or a length that is not a number", () => {
    expect(requestRefusal("POST", { "sec-fetch-site": "same-origin", "content-length": String(1024 * 1024) }, ORIGIN)).toBeNull();
    expect(requestRefusal("POST", { "sec-fetch-site": "same-origin", "content-length": String(1024 * 1024 + 1) }, ORIGIN)).toMatch(/1 MB/);
    expect(requestRefusal("POST", { "sec-fetch-site": "same-origin", "content-length": "12, 13" }, ORIGIN)).toMatch(/1 MB/);
  });
});

describe("request headers: the allowlist and the mappings (section 4.5)", () => {
  const sent = {
    host: "made-up-preview.example",
    origin: ORIGIN,
    referer: `${ORIGIN}/en/home?x=1`,
    cookie: `builder_preview=abc; ${PREFIX}better-auth.session_token=tok; bpffffffff_other=old; plain=1`,
    accept: "text/html",
    "accept-language": "ar",
    "accept-encoding": "gzip",
    "content-type": "text/plain;charset=UTF-8",
    "content-length": "3",
    "user-agent": "made-up",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "if-none-match": '"e"',
    range: "bytes=0-1",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    rsc: "1",
    "next-action": "abc",
    "next-router-state-tree": "%5B%5D",
    "next-router-prefetch": "1",
    "next-router-segment-prefetch": "/x",
    "next-url": "/en",
    authorization: "Bearer made-up",
    "x-forwarded-host": "evil.example",
    "x-forwarded-for": "203.0.113.9",
    forwarded: "for=203.0.113.9",
    "proxy-authorization": "made-up",
    connection: "keep-alive",
    "x-middleware-subrequest": "made-up",
  };
  it("passes only the allowlist; Host becomes app:3161 and Origin http://app:3161; Referer keeps its path on the app's origin", () => {
    const h = upstreamHeaders(sent, { appPort: 3161, storedOrigin: ORIGIN, prefix: PREFIX });
    expect(Object.keys(h).sort()).toEqual(
      ["accept", "accept-encoding", "accept-language", "cache-control", "content-length", "content-type", "cookie", "host", "if-none-match", "next-action", "next-router-prefetch", "next-router-segment-prefetch", "next-router-state-tree", "next-url", "origin", "pragma", "range", "referer", "rsc", "sec-fetch-mode", "sec-fetch-site", "user-agent"].sort(),
    );
    expect(h.host).toBe("app:3161");
    expect(h.origin).toBe("http://app:3161");
    expect(h.referer).toBe("http://app:3161/en/home?x=1");
    for (const dropped of ["authorization", "x-forwarded-host", "x-forwarded-for", "forwarded", "proxy-authorization", "connection", "x-middleware-subrequest"]) expect(h[dropped], dropped).toBeUndefined();
    for (const name of ["accept", "accept-language", "if-none-match", "if-modified-since", "sec-fetch-dest", "rsc", "next-action"]) expect(forwardedRequestHeader(name), name).toBe(true);
    for (const name of ["authorization", "cookie", "host", "origin", "referer", "x-forwarded-host", "forwarded", "connection", "upgrade", "te"]) expect(forwardedRequestHeader(name), name).toBe(false);
  });
  it("a Referer from another origin is dropped; with no stored origin, every Referer is", () => {
    expect(upstreamHeaders({ ...sent, referer: "https://other.example/x" }, { appPort: 3161, storedOrigin: ORIGIN, prefix: PREFIX }).referer).toBeUndefined();
    expect(upstreamHeaders(sent, { appPort: 3161, storedOrigin: null, prefix: PREFIX }).referer).toBeUndefined();
  });
  it("no Origin is added when none was sent", () => {
    const { origin: _o, ...noOrigin } = sent;
    expect(upstreamHeaders(noOrigin, { appPort: 3161, storedOrigin: ORIGIN, prefix: PREFIX }).origin).toBeUndefined();
  });
  it("cookies: only this session's prefix, removed; the front's own cookie, another session's prefix and any other cookie stay behind", () => {
    expect(appCookies(sent.cookie, PREFIX)).toBe("better-auth.session_token=tok");
    expect(appCookies("builder_preview=x; plain=1", PREFIX)).toBeNull();
    expect(appCookies(`${PREFIX}=empty-name; ${PREFIX}a=1`, PREFIX)).toBe("a=1");
  });
  it("every value of a cookie is read (a page can add one of the same name)", () => {
    expect(cookieValues("builder_preview=a; x=1; builder_preview=b", "builder_preview")).toEqual(["a", "b"]);
    expect(cookieValues("", "builder_preview")).toEqual([]);
  });
  it("the measurements' controls turn each mapping off, one at a time", () => {
    const o = { appPort: 3161, storedOrigin: ORIGIN, prefix: PREFIX };
    expect(upstreamHeaders(sent, { ...o, controls: { host: true } }).host).toBe("made-up-preview.example");
    expect(upstreamHeaders(sent, { ...o, controls: { origin: true } }).origin).toBe(ORIGIN);
    expect(upstreamHeaders(sent, { ...o, controls: { referer: true } }).referer).toBe(sent.referer);
    expect(Object.keys(upstreamHeaders(sent, { ...o, controls: { secFetch: true } })).some((k) => k.startsWith("sec-fetch-"))).toBe(false);
    expect(upstreamHeaders(sent, { ...o, controls: { cookiePrefix: true } }).cookie).toBe(`${PREFIX}better-auth.session_token=tok; bpffffffff_other=old; plain=1`);
  });
});

describe("answers: Set-Cookie, Location, dropped and refused (section 4.6)", () => {
  it("Set-Cookie: renamed with the prefix, attributes kept; dropped with a Domain, a __Host-, __Secure- or builder_ name, or when it cannot be read", () => {
    expect(scanSetCookie("better-auth.session_token=abc; Path=/; HttpOnly; SameSite=Lax", PREFIX)).toBe(`${PREFIX}better-auth.session_token=abc; Path=/; HttpOnly; SameSite=Lax`);
    for (const bad of [
      "a=1; Domain=example.com",
      "a=1; path=/; domain=.app",
      "__Host-a=1; Path=/; Secure",
      "__secure-a=1; Secure",
      "builder_session=1; Path=/",
      "BUILDER_preview=1",
      "=1",
      "noequals",
      "a b=1",
      "a=1\r\nSet-Cookie: x=2",
      "a=1\u0000",
    ])
      expect(scanSetCookie(bad, PREFIX), bad).toBeNull();
    expect(scanSetCookie("a=1", "not-a-prefix")).toBeNull();
  });
  it("Location: kept if it starts with exactly one /; http://app:3161/ cut to its path; anything else refused", () => {
    expect(mapLocation("/en/home", 3161)).toBe("/en/home");
    expect(mapLocation("/en/my-requests?sent=1", 3161)).toBe("/en/my-requests?sent=1");
    expect(mapLocation("http://app:3161/en/sign-in", 3161)).toBe("/en/sign-in");
    for (const bad of ["//evil.example/", "/\\evil.example", "/\t/evil.example", "/a b", "https://evil.example/", "http://app:3161//evil.example", "http://app:31610/x", "en/home", "", "javascript:alert(1)", "/x\r\nSet-Cookie: a=1"])
      expect(mapLocation(bad, 3161), bad).toBeNull();
  });
  it("the dropped headers, hop-by-hop headers, Access-Control-*, and those the front sets itself", () => {
    for (const n of ["Refresh", "Link", "Report-To", "Reporting-Endpoints", "NEL", "Content-Security-Policy", "Content-Security-Policy-Report-Only", "Clear-Site-Data", "Strict-Transport-Security", "Access-Control-Allow-Origin", "Access-Control-Allow-Credentials", "Alt-Svc", "Service-Worker-Allowed", "Content-Location", "Connection", "Keep-Alive", "Transfer-Encoding", "Cache-Control", "X-Frame-Options"])
      expect(droppedResponseHeader(n), n).toBe(true);
    for (const n of ["Content-Type", "Content-Length", "Content-Encoding", "Vary", "ETag", "Last-Modified", "Date"]) expect(droppedResponseHeader(n), n).toBe(false);
  });
  it("content types: html, css, javascript, json, text/x-component, image/*, font/*, text/plain; nothing else", () => {
    for (const ok of ["text/html; charset=utf-8", "text/css", "application/javascript; charset=UTF-8", "text/javascript", "application/json", "application/manifest+json", "text/x-component", "image/png", "image/svg+xml", "image/x-icon", "font/woff2", "text/plain"]) expect(contentTypeAllowed(ok), ok).toBe(true);
    for (const no of ["application/octet-stream", "application/pdf", "application/zip", "text/xml", "application/xml", "multipart/x-mixed-replace", "video/mp4", "application/wasm", "", "text/event-stream"]) expect(contentTypeAllowed(no), no).toBe(false);
  });
  it("an attachment is refused; an answer with a body and no content type is refused; 204, 304, redirects and HEAD need none", () => {
    expect(responseRefusal(200, { "content-type": "text/html", "content-disposition": "attachment; filename=x.html" }, "GET")).toMatch(/file to save/);
    expect(responseRefusal(200, { "content-type": "text/html", "content-disposition": "inline" }, "GET")).toBeNull();
    expect(responseRefusal(200, {}, "GET")).toMatch(/no content type/);
    expect(responseRefusal(200, { "content-type": "application/octet-stream" }, "GET")).toMatch(/type the preview does not pass on/);
    for (const st of [204, 304, 302, 303, 307]) expect(responseRefusal(st, {}, "GET"), String(st)).toBeNull();
    expect(responseRefusal(200, {}, "HEAD")).toBeNull();
    expect(responseRefusal(200, { "content-length": "0" }, "POST")).toBeNull();
  });
  it("the answer's headers: the drops, each cookie scanned, Location mapped, then the front's own headers", () => {
    const d = downstreamHeaders(
      {
        "content-type": "text/html",
        "set-cookie": ["s=1; Path=/; HttpOnly", "x=2; Domain=evil.example"],
        location: "http://app:3161/en/home",
        "content-security-policy": "script-src *",
        "access-control-allow-origin": "*",
        refresh: "0; url=https://evil.example",
        "cache-control": "public, max-age=600",
        vary: "RSC",
      },
      { appPort: 3161, prefix: PREFIX },
    );
    expect(d.headers["set-cookie"]).toEqual([`${PREFIX}s=1; Path=/; HttpOnly`]);
    expect(d.cookiesDropped).toBe(1);
    expect(d.headers.location).toBe("/en/home");
    expect(d.headers.refresh).toBeUndefined();
    expect(d.headers["access-control-allow-origin"]).toBeUndefined();
    expect(d.headers["content-security-policy"]).toBe(APP_CSP);
    expect(d.headers["cache-control"]).toBe("private, no-store");
    expect(d.headers.vary).toBe("RSC");
    expect(downstreamHeaders({ location: "https://evil.example/" }, { appPort: 3161, prefix: PREFIX }).locationRefused).toBe(true);
  });
  it("the front's own headers: no-store, the policy (no script on its own pages), the permissions, COOP, Referrer-Policy, nosniff", () => {
    const own = frontHeaders({ own: true });
    expect(own["content-security-policy"]).toContain("default-src 'none'");
    expect(own["content-security-policy"]).not.toContain("script-src");
    const app = frontHeaders({ own: false });
    expect(app["content-security-policy"]).toBe(APP_CSP);
    for (const d of ["connect-src 'self'", "form-action 'self'", "frame-src 'none'", "frame-ancestors 'none'", "worker-src 'none'", "object-src 'none'", "base-uri 'self'"]) expect(APP_CSP).toContain(d);
    expect(frontHeaders({ own: false, cspSandbox: true })["content-security-policy"]).toContain("sandbox allow-scripts allow-forms allow-same-origin");
    for (const h of [own, app]) {
      expect(h["cache-control"]).toBe("private, no-store");
      expect(h["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()");
      expect(h["cross-origin-opener-policy"]).toBe("same-origin");
      expect(h["referrer-policy"]).toBe("same-origin");
      expect(h["x-content-type-options"]).toBe("nosniff");
    }
  });
});

describe("the gate's POSTs (section 4.4)", () => {
  it("refuses an Origin of null, neither Origin nor Sec-Fetch-Site: same-origin, another site, or an Origin that is not one", () => {
    expect(gateRefusal({ origin: "null" })).toMatch(/no origin/);
    expect(gateRefusal({})).toMatch(/neither/);
    expect(gateRefusal({ "sec-fetch-site": "none" })).toMatch(/neither/);
    expect(gateRefusal({ origin: ORIGIN, "sec-fetch-site": "cross-site" })).toMatch(/another site/);
    expect(gateRefusal({ origin: ORIGIN, "sec-fetch-site": "same-site" })).toMatch(/another site/);
    expect(gateRefusal({ origin: `${ORIGIN}/path` })).toMatch(/not one/);
    expect(gateRefusal({ origin: ORIGIN })).toBeNull();
    expect(gateRefusal({ "sec-fetch-site": "same-origin" })).toBeNull();
  });
});

describe("the fork channel: fixed shapes, checked at both ends", () => {
  const texts = Object.fromEntries(FRONT_TEXT_KEYS.map((k) => [k, k]));
  it("accepts exactly the shapes, and nothing with a field more, less or of another type", () => {
    const pass = { type: "pass", digest: "a".repeat(64), expiresAt: 1, sessionId: "live-0123456789abcdef", prefix: PREFIX, appPort: 3161, sessionEndsAt: 2 };
    expect(toFrontMessage(pass)).toEqual(pass);
    expect(toFrontMessage({ ...pass, extra: 1 })).toBeNull();
    expect(toFrontMessage({ ...pass, digest: "A".repeat(64) })).toBeNull();
    expect(toFrontMessage({ ...pass, prefix: "builder_" })).toBeNull();
    expect(toFrontMessage({ ...pass, sessionId: "x" })).toBeNull();
    expect(toFrontMessage({ type: "texts", en: texts, ar: texts })).not.toBeNull();
    expect(toFrontMessage({ type: "texts", en: { ...texts, more: "x" }, ar: texts })).toBeNull();
    expect(toFrontMessage({ type: "revoke", reason: "checklist" })).toEqual({ type: "revoke", reason: "checklist" });
    expect(toFrontMessage({ type: "revoke", reason: "Checklist!" })).toBeNull();
    expect(toFrontMessage({ type: "controls", controls: { host: true }, cspSandbox: false })).not.toBeNull();
    expect(toFrontMessage({ type: "controls", controls: { other: true }, cspSandbox: false })).toBeNull();
    expect(toFrontMessage({ type: "stop" })).toEqual({ type: "stop" });
    for (const junk of [null, 1, "stop", [], { type: "stop", x: 1 }, { type: "eval", code: "1" }]) expect(toFrontMessage(junk)).toBeNull();
    expect(fromFrontMessage({ type: "entered", sessionId: "live-0123456789abcdef", secFetchSite: true })).not.toBeNull();
    expect(fromFrontMessage({ type: "entered", sessionId: "live-0123456789abcdef", secFetchSite: "yes" })).toBeNull();
    expect(fromFrontMessage({ type: "refused", reason: "locked", voided: true })).toEqual({ type: "refused", reason: "locked", voided: true });
    expect(fromFrontMessage({ type: "refused", reason: "anything" })).toBeNull();
    expect(fromFrontMessage({ type: "closed", sessionId: "live-0123456789abcdef", reason: "leave" })).not.toBeNull();
    expect(fromFrontMessage({ type: "closed", sessionId: "live-0123456789abcdef", reason: "other" })).toBeNull();
  });
});
