/** The measurement (kept here in the evidence; copied into builder/test/ only for its runs): how long the browser's read of an answer cut short stays open, through the real front. */
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { expect, it } from "vitest";
import type { AppStream, StreamingEnd } from "../src/sandbox/manager.js";
import { LivePreview } from "../src/web/preview.js";
import { FRONT_TEXT_KEYS, type Texts } from "../src/web/preview-rules.ts";

it("measure: an answer that says 100 bytes, sends 5 and is cut", { timeout: 120_000 }, async () => {
  const t = Object.fromEntries(FRONT_TEXT_KEYS.map((k) => [k, `[${k}]`])) as Texts["en"];
  const app = http.createServer((q, s) => {
    s.writeHead(200, { "content-type": "text/plain", "content-length": "100" });
    s.write("hello");
    setTimeout(() => q.socket.destroy(), 100);
  });
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
  const appPort = (app.address() as AddressInfo).port;
  const free = net.createServer();
  await new Promise<void>((r) => free.listen(0, "127.0.0.1", r));
  const port = (free.address() as AddressInfo).port;
  await new Promise((r) => free.close(r));
  const p = new LivePreview({
    port, texts: { en: t, ar: t }, base: "/tmp",
    openStream: () => {
      const sock = net.connect(appPort, "127.0.0.1");
      sock.on("error", () => undefined);
      const done = new Promise<StreamingEnd>((r) => sock.on("close", () => r({ code: 0, stderrTail: "" })));
      return { container: "stand-in", stdin: sock, stdout: sock, done, kill: async () => { sock.destroy(); await done; }, args: [] } satisfies AppStream;
    },
    onEvent: async () => undefined,
  });
  await p.start();
  try {
    const o = await p.open({ projectId: "j1-0000000000aa", builderSession: "b", appStartEventId: "7", appPort: 3161 });
    const base = `http://127.0.0.1:${port}`;
    const e = await fetch(`${base}/__builder/enter`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: base }, body: `pass=${o.shown}`, redirect: "manual" });
    const cookie = (e.headers.get("set-cookie") ?? "").split(";")[0]!;
    await new Promise((r) => setTimeout(r, 50));
    const r = await fetch(`${base}/cut`, { headers: { cookie } });
    const t0 = Date.now();
    const how = await r.text().then(() => "complete", () => "cut short");
    const ms = Date.now() - t0;
    console.log(`MEASURED: status ${r.status}, content-length ${r.headers.get("content-length")}, the browser's read ended "${how}" after ${ms} ms`);
    expect(how).toBe("cut short");
  } finally {
    await p.stop();
    app.closeAllConnections();
    await new Promise((r) => app.close(r));
  }
});
