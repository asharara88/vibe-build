// Approved container images (owner, 13 Nov 2026, questions 11 (a) and 15 (a)). Not live: it reads files only.
// The made-up references below are put together at run time, so that this file itself holds no
// reference for the scan to find (the scan reads this folder too).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { listProblems, referenceOf, scanFolders, scanText, type ApprovedImageList } from "../src/licence/approved-images.js";
import { DEFAULT_IMAGES } from "../src/sandbox/manager.js";
import { RUNNER_BASE_IMAGES } from "../src/acceptance/runner-image.js";

const builderDir = resolve(import.meta.dirname, "..");
const repo = resolve(builderDir, "..");
const list = JSON.parse(readFileSync(resolve(builderDir, "approved-images.json"), "utf8")) as ApprovedImageList;
const keys = Object.keys(DEFAULT_IMAGES);
/**
 * The folders scanned. builder/scripted (the scripted engine's change sets) is added to the four named in the task;
 * package 3.1 adds its own three: builder/runner (the runner image's Dockerfile and files), builder/scripted-broken
 * (the deliberately broken copy) and stand-in-acceptance (the stand-in tests).
 */
const ROOTS = ["builder/src", "builder/scripts", "builder/test", "builder/scripted", "templates", "builder/runner", "builder/scripted-broken", "stand-in-acceptance"];

const join = (...parts: string[]) => parts.join("");
const NODE = list.images.find((e) => e.image === join("node", ":22-alpine"))!;
const PG = list.images.find((e) => e.image === join("postgres", ":16-alpine"))!;
const UBUNTU = list.images.find((e) => e.image === join("ubuntu", ":24.04"))!;
const NODE_SLIM = list.images.find((e) => e.image === join("node", ":22-bookworm-slim"))!;
const unpinnedNode = join(NODE.image.split(":")[0]!, ":", NODE.image.split(":")[1]!);

describe("the approved list", () => {
  it("holds exactly the two images of question 11 (a) and the runner's two base images of question 15 (a), each well formed, for internal development and testing only", () => {
    expect(listProblems(list)).toEqual([]);
    expect(list.images.map(referenceOf)).toEqual([
      join("node", ":22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202"),
      join("postgres", ":16-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139"),
      join("ubuntu", ":24.04@sha256:2198e4c65076e9cb0b3d695219df667c0e3b0072da64ca3c2648aca17dcecaf5"),
      join("node", ":22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee"),
    ]);
    for (const e of list.images) {
      expect(e.approved).toBe("2026-11-13");
      expect(e.approvedBy).toBe("Owner");
      expect(e.scope).toBe("internal development and testing only");
    }
    expect(list.images.map((e) => e.decision.includes("Question 11, option (a), approved"))).toEqual([true, true, false, false]);
    expect(list.images.map((e) => e.decision.includes("Question 15 approved by the owner"))).toEqual([false, false, true, true]);
  });

  it("refuses a list entry with no tag, a short digest, no date or no decision", () => {
    const bad: ApprovedImageList = { about: "", images: [{ image: NODE.image.split(":")[0]!, digest: "sha256:0e17", approved: "13 Nov", approvedBy: "Owner", scope: "", decision: "" }] };
    expect(listProblems(bad)).toEqual([
      "entry 1 (node): image must be written name:tag",
      "entry 1 (node): digest must be sha256: and 64 lowercase hexadecimal characters",
      "entry 1 (node): approved must be a date, YYYY-MM-DD",
      "entry 1 (node): scope is empty",
      "entry 1 (node): decision is empty",
    ]);
  });

  it("the sandbox manager's image table is exactly the approved references", () => {
    expect(DEFAULT_IMAGES).toEqual({ postgres: referenceOf(PG), node: referenceOf(NODE) });
  });

  it("the acceptance runner's base image table is exactly the approved references of question 15 (a)", () => {
    expect(RUNNER_BASE_IMAGES).toEqual({ ubuntu: referenceOf(UBUNTU), node: referenceOf(NODE_SLIM) });
  });
});

describe("the scan of the code, scripts, tests and templates", () => {
  const { files, references } = scanFolders(repo, ROOTS, list.images, keys);

  it("finds no image reference that is not tag@digest of an approved entry", () => {
    const violations = references.filter((r) => r.verdict === "violation").map((r) => `${r.file}:${r.line} ${r.kind} ${r.text} (${r.reason})`);
    expect(violations).toEqual([]);
  });

  it("is not empty: it reads the image tables, the template's two FROM lines, the runner's three and the test's inline FROM", () => {
    expect(files).toBeGreaterThan(100);
    const seen = references.map((r) => `${r.file} ${r.kind} ${r.verdict} ${r.text}`);
    expect(seen).toEqual(
      expect.arrayContaining([
        `builder/src/sandbox/manager.ts name:tag approved ${referenceOf(PG)}`,
        `builder/src/sandbox/manager.ts name:tag approved ${referenceOf(NODE)}`,
        `templates/next/Dockerfile FROM approved ${referenceOf(NODE)}`,
        "templates/next/Dockerfile FROM stage build",
        "builder/test/sandbox.test.ts FROM image table ${DEFAULT_IMAGES.node}",
        `builder/src/acceptance/runner-image.ts name:tag approved ${referenceOf(UBUNTU)}`,
        `builder/src/acceptance/runner-image.ts name:tag approved ${referenceOf(NODE_SLIM)}`,
      ]),
    );
    expect(references.filter((r) => r.file === "templates/next/Dockerfile" && r.kind === "FROM").map((r) => r.verdict)).toEqual(["approved", "stage", "approved"]);
    expect(references.filter((r) => r.file === "builder/runner/Dockerfile" && r.kind === "FROM").map((r) => `${r.verdict} ${r.text}`)).toEqual([
      `approved ${referenceOf(NODE_SLIM)}`,
      `approved ${referenceOf(UBUNTU)}`,
      `approved ${referenceOf(UBUNTU)}`,
    ]);
  });
});

describe("the scan, on made-up text: each kind of reference it must refuse, and what it leaves alone", () => {
  // The made-up texts are written with stand-ins (@FROM@, @IMAGE@, @NODE@ ...) and filled in at run time.
  const values: Record<string, string> = {
    "@FROM@": "FROM",
    "@IMAGE@": "image",
    "@NODE@": unpinnedNode,
    "@NODE_PINNED@": referenceOf(NODE),
    "@PG_PINNED@": referenceOf(PG),
    "@WRONG_DIGEST@": join(NODE.image, "@", PG.digest),
    "@DIGEST_ONLY@": join("node@", NODE.digest),
    "@SHORT_DIGEST@": join(NODE.image, "@sha256:0e1754758c2d"),
    "@OTHER@": join("python", ":3.13-slim"),
    "@MAJOR@": join("postgres", ":16"),
    "@REGISTRY@": join("mcr.microsoft.com/playwright", ":v1.63.0-noble"),
  };
  const fill = (text: string) => text.replace(/@[A-Z_]+@/g, (k) => values[k] ?? k);
  const scan = (file: string, text: string) => scanText(file, fill(text), list.images, keys).map((r) => [r.kind, r.verdict, r.text]);
  const v = (k: string) => values[k]!;

  it("a Dockerfile: an unpinned FROM, a FROM pinned to another digest, a FROM by digest alone, and an image not on the list", () => {
    const dockerfile = [
      "@FROM@ @NODE@ AS one",
      "@FROM@ @WRONG_DIGEST@",
      "@FROM@ @DIGEST_ONLY@",
      "@FROM@ --platform=linux/amd64 @OTHER@",
      "@FROM@ one AS two",
      "@FROM@ @NODE_PINNED@",
    ].join("\n");
    expect(scan("Dockerfile", dockerfile)).toEqual([
      ["FROM", "violation", v("@NODE@")],
      ["FROM", "violation", v("@WRONG_DIGEST@")],
      ["FROM", "violation", v("@DIGEST_ONLY@")],
      ["FROM", "violation", v("@OTHER@")],
      ["FROM", "stage", "one"],
      ["FROM", "approved", v("@NODE_PINNED@")],
    ]);
  });

  it("TypeScript: an image field, a docker run argument, an inline Dockerfile, a computed FROM and a comment", () => {
    const ts = [
      '  db: { @IMAGE@: "@NODE@" },',
      '  run("docker", ["run", "--rm", "@OTHER@", "true"]);',
      '  const df = "@FROM@ @NODE@\\nENTRYPOINT []\\n";',
      "  const df2 = `@FROM@ ${someImage}\\n`;",
      "  const df3 = `@FROM@ ${DEFAULT_IMAGES.node}\\n`;",
      "  const df4 = `@FROM@ ${DEFAULT_IMAGES.ruby}\\n`;",
      "  // Needs Docker and @NODE@.",
      '  @IMAGE@: "@PG_PINNED@",',
    ].join("\n");
    expect(scan("x.ts", ts)).toEqual([
      ["image field", "violation", v("@NODE@")],
      ["name:tag", "violation", v("@OTHER@")],
      ["FROM", "violation", v("@NODE@")],
      ["FROM", "violation", "${someImage}"],
      ["FROM", "image table", "${DEFAULT_IMAGES.node}"],
      ["FROM", "violation", "${DEFAULT_IMAGES.ruby}"],
      ["name:tag", "violation", v("@NODE@")],
      ["image field", "approved", v("@PG_PINNED@")],
    ]);
  });

  it("YAML: a bare image value, and a registry image", () => {
    const yaml = ["    @IMAGE@: @NODE@", "    @IMAGE@: @REGISTRY@", "    @IMAGE@: @NODE_PINNED@"].join("\n");
    expect(scan("compose.yaml", yaml)).toEqual([
      ["image field", "violation", v("@NODE@")],
      ["image field", "violation", v("@REGISTRY@")],
      ["image field", "approved", v("@NODE_PINNED@")],
    ]);
  });

  it("a mistyped digest is refused, not skipped; a major version alone is caught for a known image", () => {
    expect(scan("a.md", "Pinned to @SHORT_DIGEST@.\nOr @MAJOR@ for short.")).toEqual([
      ["name:tag", "violation", v("@SHORT_DIGEST@")],
      ["name:tag", "violation", v("@MAJOR@")],
    ]);
  });

  it("leaves alone what is not an image: URLs, addresses, host and port, counts, times, Node's own modules, Tailwind classes, SQL, mounts", () => {
    const text = [
      'const url = "postgres://app:${DB_PASSWORD}@db:5432/app";',
      'const u2 = "postgres://build:build@localhost/build";',
      'import { execFile } from "node:child_process"; import x from "node:fs";',
      'const hosts = ["registry.npmjs.org:443", "example.com:80", "127.0.0.1:5432", "localhost:3000"];',
      'system: "count:10000", target: "t:1", at: "2026-11-13T06:14:34Z"',
      'className="disabled:opacity-60 hover:bg-blue-700 md:grid-cols-2"',
      "SELECT id @FROM@ holds AS h WHERE h.id = $1",
      "  @FROM@ holds",
      'tmpfs: ["/tmp:rw,noexec,nosuid,size=16m"], volumes: [`${sets}:/engine:ro`]',
      'security_opt: ["no-new-privileges:true"], digest: "sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202"',
      "tools @IMAGE@: builder_p_test-tools:latest",
    ].join("\n");
    expect(scan("x.ts", text)).toEqual([["name:tag", "built by the builder", "builder_p_test-tools:latest"]]);
  });
});
