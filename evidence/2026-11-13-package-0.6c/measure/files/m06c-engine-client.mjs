// Package 0.6c, first step: a throwaway measurement (not part of the builder). Which of Node 22's own HTTP
// clients use the proxy settings in the environment, from a container on `out` only (the engine's place).
// Each attempt: a GET of the gateway stand-in, by proxy semantics (gateway.internal) and by the fixed port (egress:4010),
// and a POST of a made-up body to /v1/messages on the fixed port (the shape ANTHROPIC_BASE_URL would give).
import http from "node:http";
const env = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "NODE_USE_ENV_PROXY"].map((k) => `${k}=${process.env[k] ?? "(unset)"}`).join(" ");
console.log(`node ${process.version}; ${env}`);
const tryFetch = async (label, url, init = {}) => {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(6000) });
    const b = (await r.text()).replace(/\s+/g, " ").slice(0, 90);
    console.log(`${label}: HTTP ${r.status} server=${r.headers.get("server") ?? "-"} says: ${b}`);
  } catch (e) { console.log(`${label}: failed: ${e.cause?.code ?? e.name}`); }
};
const tryHttp = (label, url) => new Promise((ok) => {
  const req = http.get(url, { timeout: 6000 }, (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => { console.log(`${label}: HTTP ${res.statusCode} says: ${b.replace(/\s+/g, " ").slice(0, 90)}`); ok(); }); });
  req.on("error", (e) => { console.log(`${label}: failed: ${e.code}`); ok(); });
  req.on("timeout", () => { req.destroy(); console.log(`${label}: timed out`); ok(); });
});
await tryFetch("fetch GET http://gateway.internal:4010/v1/ping (proxy semantics)", "http://gateway.internal:4010/v1/ping");
await tryFetch("fetch GET https://registry.npmjs.org/-/ping (through the proxy, if used)", "https://registry.npmjs.org/-/ping");
await tryHttp("http.get http://gateway.internal:4010/v1/ping (proxy semantics)", "http://gateway.internal:4010/v1/ping");
await tryFetch("fetch GET http://egress:4010/v1/ping (fixed gateway port)", "http://egress:4010/v1/ping");
await tryFetch("fetch POST http://egress:4010/v1/messages (fixed gateway port, made-up body)", "http://egress:4010/v1/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "stand-in", messages: [{ role: "user", content: "made-up" }] }) });
