// Package 0.6c, first step: turns probe-*.jsonl files into a table (attempt x container) and lists, per
// container, every attempt that got an answer, with who answered. Usage: node m06c-summarise.mjs <dir> [order...]
import { readdirSync, readFileSync } from "node:fs";
const dir = process.argv[2];
const order = process.argv.slice(3);
const files = readdirSync(dir).filter((f) => /^probe-.*\.jsonl$/.test(f));
const data = {};
for (const f of files) {
  const label = f.slice(6, -6);
  data[label] = readFileSync(`${dir}/${f}`, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { kind: "unparsed", line: l }; } });
}
const labels = [...order.filter((l) => data[l]), ...Object.keys(data).filter((l) => !order.includes(l)).sort()];
const short = (r) => {
  const x = r.result ?? "";
  if (x === "connected") return "OPEN";
  if (x.startsWith("connected, then closed")) return "OPEN-CLOSED";
  if (x.startsWith("connected, then no answer")) return "OPEN-SILENT";
  if (x === "network unreachable") return "unreach";
  if (x === "timed out") return "timeout";
  if (x === "name not found") return "no-name";
  if (x === "no name server answered") return "no-dns";
  if (x === "address found") return "FOUND";
  if (x.startsWith("HTTP ")) return x.replace("HTTP ", "HTTP");
  if (x.startsWith("proxy answered: ")) return "proxy" + (x.match(/ (\d{3})/)?.[1] ?? "?");
  if (x.startsWith("tunnel open; inside it: ")) { const i = x.slice(24); return "TUN>" + (i.match(/ (\d{3})/)?.[1] ?? i.replace("certificate not trusted", "cert-untrusted").replace(/ /g, "-")); }
  return x.replace(/ /g, "-");
};
const ids = [];
for (const l of labels) for (const r of data[l]) if (r.kind === "attempt" && !ids.includes(r.id)) ids.push(r.id);
const answered = (r) => /^(OPEN|FOUND|HTTP|proxy|TUN)/.test(short(r));
console.log(`Answered (an UPPER-CASE word): a connection opened, an address was found, an HTTP status came back, a proxy answered, or a tunnel opened.`);
console.log(`Not answered: unreach (no route), refused, timeout, no-name, no-dns, error.\n`);
console.log("| attempt | " + labels.join(" | ") + " |");
console.log("| --- | " + labels.map(() => "---").join(" | ") + " |");
for (const id of ids) console.log(`| ${id} | ` + labels.map((l) => { const r = data[l].find((x) => x.kind === "attempt" && x.id === id); return r ? short(r) : "-"; }).join(" | ") + " |");
for (const l of labels) {
  console.log(`\n## ${l}`);
  for (const r of data[l]) if (r.kind === "info") console.log(`- ${r.name}: ${JSON.stringify(r.value)}`);
  const a = data[l].filter((r) => r.kind === "attempt" && answered(r));
  console.log(`- answered: ${a.length} of ${data[l].filter((r) => r.kind === "attempt").length}`);
  for (const r of a) console.log(`  - ${r.id} (${r.what}): ${r.result}${r.detail ? ` — ${r.detail}` : ""}`);
  for (const r of data[l]) if (r.kind !== "attempt" && r.kind !== "info" && r.kind !== "end") console.log(`- PROBLEM: ${JSON.stringify(r)}`);
}
