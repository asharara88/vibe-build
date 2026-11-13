// Package 0.6c, first step: a stand-in for the model gateway (it calls no model). Not part of the builder.
// Listens on GW_LISTEN (host:port) and answers every request with a JSON line naming itself.
import http from "node:http";
const [host, port] = (process.env.GW_LISTEN ?? "127.0.0.1:14610").split(":");
http
  .createServer((req, res) => {
    process.stdout.write(JSON.stringify({ at: new Date().toISOString(), method: req.method, url: req.url, source: req.socket.remoteAddress }) + "\n");
    res.writeHead(200, { "content-type": "application/json", server: "m06c-gateway-standin" });
    res.end(JSON.stringify({ answeredBy: "m06c gateway stand-in", path: req.url }) + "\n");
  })
  .listen(Number(port), host, () => process.stdout.write(JSON.stringify({ listening: `${host}:${port}` }) + "\n"));
