/**
 * Approved container images (owner, 13 Nov 2026, questions 11 (a) and 15 (a)): the list in builder/approved-images.json,
 * and a scan of source text for image references that are not tag@digest of an entry on that list.
 *
 * What counts as an image reference (text matching, not a parser of any one language):
 * - a Dockerfile `FROM` line, in a file named Dockerfile (every FROM line), or at the start of a string
 *   in other files (a Dockerfile written inline); a FROM may also name a stage the same file declares
 *   with `AS`;
 * - an `image:` field whose value is written out (quoted, or bare in a YAML file);
 * - anywhere else, any word shaped like a Docker reference with a tag (`name:tag`, with or without a
 *   digest) whose tag starts with a version number or a common tag word (latest, alpine, slim, the Debian
 *   and Ubuntu release names ...), or is a number alone after a commonly used image name, or whose name
 *   has a `/` (a registry or an organisation); and any `name@<digest>` with no tag. A host name with a
 *   port, a count, a time and Tailwind's `variant:class` are not taken for images.
 * Comments are scanned too: an example in a comment is held to the same rule.
 *
 * What passes: exactly `<image>@<digest>` of an approved entry; inside a string, `${DEFAULT_IMAGES.<key>}`
 * for a key of the sandbox manager's image table (whose own values are scanned as text); and the images
 * the builder builds itself from the template's Dockerfile, named by `appImageName` and `toolsImageName`
 * (`builder_<project>-app:latest`, `builder_<project>-tools:latest`), which are never pulled.
 *
 * What it does not see: a reference put together at run time from parts, or passed in from outside
 * (for example `SandboxSpec.images` given a variable); files outside the folders scanned; binary files.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

export interface ApprovedImage {
  /** Repository and tag, as Docker writes it for an official image (no registry). */
  image: string;
  /** The image's digest, `sha256:` and 64 hexadecimal characters. */
  digest: string;
  /** ISO date of the owner's approval. */
  approved: string;
  approvedBy: string;
  scope: string;
  /** Where the approval is recorded. */
  decision: string;
  inventory?: string;
}

export interface ApprovedImageList {
  about: string;
  images: ApprovedImage[];
}

export type ReferenceKind = "FROM" | "image field" | "name:tag" | "name@digest";

export interface ImageReference {
  file: string;
  line: number;
  kind: ReferenceKind;
  /** The reference as written. */
  text: string;
  /** Why it passes, or why not. */
  verdict: "approved" | "stage" | "image table" | "built by the builder" | "violation";
  reason?: string;
}

export const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

/** The full reference, tag@digest, of an approved entry. */
export function referenceOf(entry: Pick<ApprovedImage, "image" | "digest">): string {
  return `${entry.image}@${entry.digest}`;
}

/** Problems with the list itself: each entry needs a name:tag, a sha256 digest, a date, a scope and a decision. */
export function listProblems(list: ApprovedImageList): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(list.images) || list.images.length === 0) problems.push("the list has no images");
  for (const [i, e] of (list.images ?? []).entries()) {
    const at = `entry ${i + 1} (${e.image ?? "no image"})`;
    const [name, tag, extra] = (e.image ?? "").split(":");
    if (!name || !tag || extra !== undefined || !TAG_RE.test(tag) || e.image.includes("@")) problems.push(`${at}: image must be written name:tag`);
    if (!DIGEST.test(e.digest ?? "")) problems.push(`${at}: digest must be sha256: and 64 lowercase hexadecimal characters`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.approved ?? "")) problems.push(`${at}: approved must be a date, YYYY-MM-DD`);
    for (const field of ["approvedBy", "scope", "decision"] as const) if (!e[field]?.trim()) problems.push(`${at}: ${field} is empty`);
    if (seen.has(e.image)) problems.push(`${at}: the same image is listed twice`);
    seen.add(e.image);
  }
  return problems;
}

// A Docker reference with a tag: an optional registry (host, optional port) and path, the name, `:tag`,
// and an optional digest. The characters around it must not continue a word, a path, a URL or an address,
// so that `postgres://...`, `user:password@host`, `/tmp:rw` and `127.0.0.1:5432/app` are not taken for one.
const NAME_COMPONENT = String.raw`[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*`;
const NAME = String.raw`(?:${NAME_COMPONENT}(?::[0-9]+)?/)?${NAME_COMPONENT}(?:/${NAME_COMPONENT})*`;
// The tag does not end in "." or "-", so that a reference at the end of a sentence is still read whole;
// the digest part is read loosely (any `@algorithm:hex`), so that a mistyped digest is caught, not skipped.
const TAG = String.raw`[A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,126}[A-Za-z0-9_])?`;
const AFTER = String.raw`(?![\w\-:/@$]|\.\w)`;
const TAGGED = new RegExp(String.raw`(?<![\w.\-/:@$])(${NAME}):(${TAG})(@[a-z0-9]+:[0-9a-fA-F]+)?${AFTER}`, "g");
const DIGEST_ONLY = new RegExp(String.raw`(?<![\w.\-/:@$])(${NAME})@[a-z0-9]+:[0-9a-fA-F]{8,}${AFTER}`, "g");
// Words an image tag commonly starts with when it does not start with a version number.
const TAG_WORDS = new Set([
  "latest", "alpine", "slim", "lts", "current", "stable", "edge", "mainline", "nightly", "nonroot", "debug",
  "bookworm", "bullseye", "buster", "trixie", "noble", "jammy", "focal",
]);
// Images commonly tagged with a number alone (a major version). A number-only tag on any other single
// name is taken for a port or a count (a host name and port, or text such as "count" and a number), not an image.
const KNOWN_IMAGE_NAMES = new Set([
  "node", "postgres", "python", "ubuntu", "debian", "alpine", "busybox", "redis", "valkey", "mysql", "mariadb",
  "mongo", "nginx", "httpd", "caddy", "traefik", "haproxy", "golang", "rust", "openjdk", "eclipse-temurin",
  "amazoncorretto", "ruby", "php", "perl", "bash", "gcc", "buildpack-deps", "centos", "fedora", "rockylinux",
  "almalinux", "amazonlinux", "oraclelinux", "registry", "memcached", "rabbitmq", "elasticsearch", "kibana",
  "logstash", "cassandra", "couchdb", "neo4j", "influxdb", "zookeeper", "solr", "tomcat", "jetty", "nats",
  "jenkins", "gradle", "maven", "docker", "composer", "wordpress", "ghost", "nextcloud", "adminer", "swift",
  "julia", "erlang", "elixir", "haskell", "clojure", "groovy", "kong", "sonarqube", "postgis", "hello-world",
]);
/** Images the builder builds itself from the template (manager.ts, appImageName and toolsImageName). */
const BUILT_HERE = /^builder_[a-z0-9_-]+-(?:app|tools):latest$/;

function looksLikeImage(name: string, tag: string): boolean {
  if (name === "sha256" || name === "localhost") return false;
  if (!/[a-z]/.test(name)) return false; // times and addresses: 06:14, 127.0.0.1:5432
  if (name.includes("/")) return true; // a registry or an organisation before the name
  if (/^\d+$/.test(tag)) return KNOWN_IMAGE_NAMES.has(name);
  if (/^v?\d/.test(tag)) return true; // 22-alpine, 3.13-slim, v1.63.0-noble
  return TAG_WORDS.has(tag.split(/[-._0-9]/)[0]!); // latest, alpine3.20, bookworm-slim; not Tailwind's disabled:opacity-60
}

function judge(ref: string, approved: Set<string>): Pick<ImageReference, "verdict" | "reason"> {
  if (approved.has(ref)) return { verdict: "approved" };
  if (BUILT_HERE.test(ref)) return { verdict: "built by the builder" };
  if (ref.includes("@")) {
    const [nameTag] = ref.split("@");
    return { verdict: "violation", reason: nameTag && nameTag.includes(":") ? "pinned, but not to an approved digest of an approved image" : "a digest with no tag: write tag@digest" };
  }
  return { verdict: "violation", reason: "not pinned by digest: write the approved tag@digest" };
}

/** Every image reference in one text, with its verdict. `file` decides the Dockerfile and YAML rules. */
export function scanText(file: string, text: string, approvedList: ApprovedImage[], imageTableKeys: string[]): ImageReference[] {
  const approved = new Set(approvedList.map(referenceOf));
  const name = basename(file);
  const isDockerfile = /^Dockerfile/i.test(name) || /\.dockerfile$/i.test(name);
  const isYaml = /\.ya?ml$/i.test(name);
  const stages = new Set<string>();
  for (const m of text.matchAll(/\bFROM\s+\S+\s+AS\s+([A-Za-z0-9_.-]+)/gi)) stages.add(m[1]!.toLowerCase());
  const fromVerdict = (operand: string): Pick<ImageReference, "verdict" | "reason"> => {
    const interpolated = /^\$\{DEFAULT_IMAGES\.([A-Za-z0-9_]+)\}$/.exec(operand);
    if (interpolated) return imageTableKeys.includes(interpolated[1]!) ? { verdict: "image table" } : { verdict: "violation", reason: "not a key of the image table" };
    if (operand.includes("${")) return { verdict: "violation", reason: "an image computed in the string: use ${DEFAULT_IMAGES.<key>}" };
    if (stages.has(operand.toLowerCase())) return { verdict: "stage" };
    return judge(operand, approved);
  };
  const out: ImageReference[] = [];
  const lines = text.split("\n");
  for (const [i, line] of lines.entries()) {
    const at = { file, line: i + 1 };
    const taken: Array<[number, number]> = [];
    const take = (start: number, end: number) => taken.push([start, end]);
    const isTaken = (start: number) => taken.some(([s, e]) => start >= s && start < e);

    // FROM, in a Dockerfile (every FROM line) or at the start of a string or of an escaped line in a string.
    const fromRe = isDockerfile ? /^(\s*FROM\s+(?:--platform=\S+\s+)?)([^\s"'`\\]+)/gi : /(?:["'`]|\\n)(FROM\s+(?:--platform=\S+\s+)?)([^\s"'`\\]+)/g;
    for (const m of line.matchAll(fromRe)) {
      const operand = m[2]!;
      const start = m.index! + m[0].length - operand.length;
      take(start, start + operand.length);
      out.push({ ...at, kind: "FROM", text: operand, ...fromVerdict(operand) });
    }
    // In other files, a FROM at the start of a line (a Dockerfile in a multi-line string) is taken only
    // when its operand looks like an image, so that SQL's FROM is left alone.
    if (!isDockerfile) {
      for (const m of line.matchAll(/^(\s*FROM\s+)([^\s"'`\\]+)/g)) {
        const operand = m[2]!;
        const start = m.index! + m[1]!.length;
        if (isTaken(start) || !/[:@/]|\$\{/.test(operand)) continue;
        take(start, start + operand.length);
        out.push({ ...at, kind: "FROM", text: operand, ...fromVerdict(operand) });
      }
    }

    // An image field with its value in quotes (any file), or bare (YAML only).
    const fieldRe = isYaml ? /\bimage\s*:\s*(["']?)([^"'\s,}#]+)\1/g : /\bimage\s*:\s*(["'`])([^"'`]+)\1/g;
    for (const m of line.matchAll(fieldRe)) {
      const value = m[2]!;
      const start = m.index! + m[0].lastIndexOf(value);
      if (isTaken(start)) continue;
      take(start, start + value.length);
      out.push({ ...at, kind: "image field", text: value, ...judge(value, approved) });
    }

    // Anything else shaped like name:tag[@digest], or name@digest with no tag.
    for (const m of line.matchAll(TAGGED)) {
      const start = m.index!;
      if (isTaken(start) || !looksLikeImage(m[1]!, m[2]!)) continue;
      take(start, start + m[0].length);
      out.push({ ...at, kind: "name:tag", text: m[0], ...judge(m[0], approved) });
    }
    for (const m of line.matchAll(DIGEST_ONLY)) {
      const start = m.index!;
      if (isTaken(start) || m[1] === "sha256") continue;
      take(start, start + m[0].length);
      out.push({ ...at, kind: "name@digest", text: m[0], verdict: "violation", reason: "a digest with no tag: write tag@digest" });
    }
  }
  return out;
}

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "coverage", "test-results", "playwright-report"]);
const SKIP_FILES = new Set(["package-lock.json"]);

/** Every text file under the given folders, skipping dependency and build folders, lock files and binary files. */
export function filesUnder(roots: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(p);
      } else if (entry.isFile() && !SKIP_FILES.has(entry.name)) out.push(p);
    }
  };
  for (const r of roots) if (statSync(r).isDirectory()) walk(r);
  return out;
}

/** Scan folders; paths in the result are relative to `base`. */
export function scanFolders(base: string, roots: string[], approvedList: ApprovedImage[], imageTableKeys: string[]): { files: number; references: ImageReference[] } {
  const references: ImageReference[] = [];
  let files = 0;
  for (const p of filesUnder(roots.map((r) => join(base, r)))) {
    const buf = readFileSync(p);
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    files++;
    references.push(...scanText(relative(base, p), buf.toString("utf8"), approvedList, imageTableKeys));
  }
  return { files, references };
}
