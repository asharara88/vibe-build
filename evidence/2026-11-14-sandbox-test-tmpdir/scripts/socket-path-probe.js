// How long a Unix socket path Node keeps (added after the review, 14 Nov 2026). In a new, empty folder given as the
// first argument, it listens on a socket whose full path is 107, 108, 109 and 115 bytes long, and reports what was
// made: whether listening worked, and the length of the path of the entry that appeared in the folder.
// Usage: node socket-path-probe.js <empty folder>
const net = require("net"), path = require("path"), fs = require("fs");
const base = path.resolve(process.argv[2]);
const tryLen = (n) => new Promise((done) => {
  const p = path.join(base, "x".repeat(n - base.length - 1));
  const s = net.createServer();
  s.on("error", (e) => done(`asked for a ${n}-byte path: ${e.code}`));
  s.listen(p, () => {
    const made = fs.readdirSync(base).map((f) => path.join(base, f));
    s.close();
    for (const f of made) try { fs.unlinkSync(f); } catch {}
    done(`asked for a ${n}-byte path: listening; the entry made has a ${made.map((f) => Buffer.byteLength(f)).join(", ")}-byte path`);
  });
});
(async () => { for (const n of [107, 108, 109, 115]) console.log(await tryLen(n)); })();
