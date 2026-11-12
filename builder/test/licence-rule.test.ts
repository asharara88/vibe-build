// Package 0.4: one licence rule for every dependency. These tests show the rule passing on a
// clean set and failing on each kind of breach, first on the rule alone, then by running the
// real check against folders that hold a deliberately added test package.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyRule, isPermittedExpression, type Installed, type LicenceRule } from "../src/licence/rule.js";

const builderDir = path.resolve(import.meta.dirname, "..");
const rule = JSON.parse(readFileSync(path.join(builderDir, "licence-rule.json"), "utf8")) as LicenceRule;
const permitted = new Set(rule.permitted);

describe("licence expressions", () => {
  it("accepts a permitted licence and combinations made only of permitted licences", () => {
    expect(isPermittedExpression("MIT", permitted)).toBe(true);
    expect(isPermittedExpression("Apache-2.0 AND MIT", permitted)).toBe(true);
    expect(isPermittedExpression("(MIT OR GPL-3.0-only)", permitted)).toBe(true); // the user may choose MIT
  });
  it("refuses anything else", () => {
    expect(isPermittedExpression("MPL-2.0", permitted)).toBe(false);
    expect(isPermittedExpression("LGPL-3.0-or-later", permitted)).toBe(false);
    expect(isPermittedExpression("(MIT AND CC-BY-3.0)", permitted)).toBe(false);
    expect(isPermittedExpression("Apache-2.0 AND LGPL-3.0-or-later AND MIT", permitted)).toBe(false);
    expect(isPermittedExpression("", permitted)).toBe(false);
    expect(isPermittedExpression("UNKNOWN", permitted)).toBe(false);
    expect(isPermittedExpression("MIT*", permitted)).toBe(false); // a licence the tool guessed, not declared
    expect(isPermittedExpression("Custom: https://example.invalid/terms", permitted)).toBe(false);
  });
});

describe("the rule", () => {
  const clean: Installed = { "a@1.0.0": { licenses: "MIT" }, "b@2.0.0": { licenses: "ISC" } };

  it("passes when every package is permitted", () => {
    const r = applyRule(rule, clean, { "a@1.0.0": { licenses: "MIT" } });
    expect(r.problems).toEqual([]);
    expect(r.checked).toBe(2);
  });

  it("fails on a development-only package outside the list: there is no weaker rule for development tools", () => {
    const r = applyRule(rule, { ...clean, "some-tool@1.0.0": { licenses: "GPL-3.0-only" } }, {});
    expect(r.problems.map((p) => p.package)).toEqual(["some-tool@1.0.0"]);
  });

  it("lists every problem, not only the first", () => {
    const all: Installed = { ...clean, "x@1.0.0": { licenses: "LGPL-3.0-or-later" }, "y@1.0.0": { licenses: "CC-BY-4.0" } };
    const r = applyRule(rule, all, all);
    expect(r.problems.map((p) => p.package)).toEqual(["x@1.0.0", "y@1.0.0"]);
  });

  it("accepts the named exceptions for development use", () => {
    const all: Installed = {
      ...clean,
      "lightningcss@1.33.0": { licenses: "MPL-2.0" },
      "lightningcss-linux-x64-gnu@1.33.0": { licenses: "MPL-2.0" },
      "spdx-exceptions@2.5.0": { licenses: "CC-BY-3.0" },
      "spdx-ranges@2.1.1": { licenses: "(MIT AND CC-BY-3.0)" },
    };
    const r = applyRule(rule, all, {});
    expect(r.problems).toEqual([]);
    expect(r.exceptionsInUse.map((u) => u.package).sort()).toEqual([
      "lightningcss",
      "lightningcss-linux-x64-gnu",
      "spdx-exceptions",
      "spdx-ranges",
    ]);
  });

  it("does not extend an approval to another package with the same licence", () => {
    const r = applyRule(rule, { ...clean, "another-mpl-package@1.0.0": { licenses: "MPL-2.0" } }, {});
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]?.reason).toContain("not a named exception");
  });

  it("fails when a package approved for development use is among the shipped dependencies", () => {
    const all: Installed = { ...clean, "lightningcss@1.33.0": { licenses: "MPL-2.0" } };
    const r = applyRule(rule, all, { "lightningcss@1.33.0": { licenses: "MPL-2.0" } });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]?.reason).toContain("development use only");
  });

  it("fails when an approved package later declares a different licence", () => {
    const r = applyRule(rule, { ...clean, "spdx-exceptions@3.0.0": { licenses: "CC-BY-SA-4.0" } }, {});
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]?.reason).toContain("different one");
  });

  it("fails a build package whose version differs from its main package, or whose main package is absent", () => {
    const mismatch = applyRule(
      rule,
      { "lightningcss@1.33.0": { licenses: "MPL-2.0" }, "lightningcss-linux-x64-gnu@1.34.0": { licenses: "MPL-2.0" } },
      {},
    );
    expect(mismatch.problems.map((p) => p.package)).toEqual(["lightningcss-linux-x64-gnu@1.34.0"]);
    const orphan = applyRule(rule, { "lightningcss-linux-x64-gnu@1.33.0": { licenses: "MPL-2.0" } }, {});
    expect(orphan.problems).toHaveLength(1);
    expect(orphan.problems[0]?.reason).toContain("is not installed");
  });

  it("covers only the build packages named one by one, not every name that starts the same way", () => {
    // lightningcss-cli and lightningcss-wasm are real packages under MPL-2.0 that the owner did not approve.
    const r = applyRule(
      rule,
      {
        "lightningcss@1.33.0": { licenses: "MPL-2.0" },
        "lightningcss-cli@1.33.0": { licenses: "MPL-2.0" },
        "lightningcss-wasm@1.33.0": { licenses: "MPL-2.0" },
        "lightningcss-loader@3.0.1": { licenses: "MIT" },
      },
      {},
    );
    expect(r.problems.map((p) => p.package)).toEqual(["lightningcss-cli@1.33.0", "lightningcss-wasm@1.33.0"]);
  });

  it("treats an old-style list of licences as all applying, each read on its own", () => {
    const r = applyRule(rule, { "old-style@1.0.0": { licenses: ["GPL-3.0-only", "MIT OR Apache-2.0"] } }, {});
    expect(r.problems.map((p) => p.package)).toEqual(["old-style@1.0.0"]);
    const ok = applyRule(rule, { "old-style@1.0.0": { licenses: ["MIT", "ISC"] } }, {});
    expect(ok.problems).toEqual([]);
  });

  it("records which packages were accepted on one side of a choice of licences", () => {
    const r = applyRule(rule, { "dual@1.0.0": { licenses: "(MIT OR GPL-3.0-only)" } }, {});
    expect(r.problems).toEqual([]);
    expect(r.choices).toEqual([{ package: "dual@1.0.0", licence: "(MIT OR GPL-3.0-only)" }]);
  });

  it("does not let a build package's name excuse a different licence", () => {
    const r = applyRule(
      rule,
      { "lightningcss@1.33.0": { licenses: "MPL-2.0" }, "lightningcss-linux-x64-gnu@1.33.0": { licenses: "GPL-3.0-only" } },
      {},
    );
    expect(r.problems.map((p) => p.package)).toEqual(["lightningcss-linux-x64-gnu@1.33.0"]);
  });
});

describe("the real check, run against a folder with a test package added", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "licence-check-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  function fixture(name: string, deps: Record<string, string>, devDeps: Record<string, string>, licences: Record<string, string>) {
    const dir = path.join(tmp, name);
    mkdirSync(dir, { recursive: true });
    const versions = (d: Record<string, string>) => Object.fromEntries(Object.keys(d).map((k) => [k, "1.0.0"]));
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name, version: "0.0.1", private: true, dependencies: versions(deps), devDependencies: versions(devDeps) }),
    );
    for (const [pkg, licence] of Object.entries(licences)) {
      const p = path.join(dir, "node_modules", pkg);
      mkdirSync(p, { recursive: true });
      writeFileSync(path.join(p, "package.json"), JSON.stringify({ name: pkg, version: "1.0.0", license: licence }));
    }
    return dir;
  }

  function run(dir: string): { code: number; out: string } {
    try {
      const out = execFileSync(path.join(builderDir, "node_modules", ".bin", "tsx"), ["src/licence/check.ts", "--dir", dir], {
        cwd: builderDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status?: number; stdout?: string };
      return { code: err.status ?? -1, out: err.stdout ?? "" };
    }
  }

  it("passes on a folder whose packages are all permitted", () => {
    const dir = fixture("clean", { "fake-mit": "" }, { "fake-isc": "" }, { "fake-mit": "MIT", "fake-isc": "ISC" });
    const r = run(dir);
    expect(r.out).toContain("RESULT: PASSED");
    expect(r.code).toBe(0);
  });

  it("fails when a shipped test package outside the rule is added, and names it", () => {
    const dir = fixture("shipped-breach", { "fake-mit": "", "fake-gpl": "" }, {}, { "fake-mit": "MIT", "fake-gpl": "GPL-3.0-only" });
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("fake-gpl@1.0.0 | GPL-3.0-only");
    expect(r.out).toContain("RESULT: FAILED");
  });

  it("fails when a development-only test package outside the rule is added", () => {
    const dir = fixture("dev-breach", { "fake-mit": "" }, { "fake-mpl": "" }, { "fake-mit": "MIT", "fake-mpl": "MPL-2.0" });
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("fake-mpl@1.0.0 | MPL-2.0");
  });

  it("fails when a test package declares no licence at all", () => {
    const dir = path.join(tmp, "no-licence");
    mkdirSync(path.join(dir, "node_modules", "fake-none"), { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "no-licence", version: "0.0.1", private: true, dependencies: { "fake-none": "1.0.0" } }));
    writeFileSync(path.join(dir, "node_modules", "fake-none", "package.json"), JSON.stringify({ name: "fake-none", version: "1.0.0" }));
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("fake-none@1.0.0");
  });

  it("fails when a shipped test package outside the rule is marked private", () => {
    const dir = fixture("private-breach", { "fake-private": "" }, {}, {});
    const p = path.join(dir, "node_modules", "fake-private");
    mkdirSync(p, { recursive: true });
    writeFileSync(path.join(p, "package.json"), JSON.stringify({ name: "fake-private", version: "1.0.0", private: true, license: "GPL-3.0-only" }));
    const r = run(dir);
    expect(r.code).toBe(1);
    // The licence tool reports any package marked private as "UNLICENSED", whatever it declares,
    // so a private dependency is always refused rather than skipped.
    expect(r.out).toContain("fake-private@1.0.0 | UNLICENSED");
  });

  it("fails when it reads nothing: an empty folder, or a folder that does not exist", () => {
    const empty = path.join(tmp, "empty");
    mkdirSync(empty, { recursive: true });
    writeFileSync(path.join(empty, "package.json"), JSON.stringify({ name: "empty", version: "0.0.1", private: true }));
    const r1 = run(empty);
    expect(r1.code).toBe(1);
    expect(r1.out).toContain("no installed package was found");
    const r2 = run(path.join(tmp, "does-not-exist"));
    expect(r2.code).toBe(1);
    expect(r2.out).toContain("RESULT: FAILED");
  });

  it("fails when a declared dependency is not installed, since its licence cannot be read", () => {
    const dir = fixture("uninstalled", { "fake-mit": "", "fake-absent": "" }, {}, { "fake-mit": "MIT" });
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("fake-absent is declared as a dependency but is not installed");
  });

  it("fails when the notices file is out of date", () => {
    const noticesPath = path.join(builderDir, "THIRD-PARTY-NOTICES.md");
    const original = readFileSync(noticesPath, "utf8");
    try {
      writeFileSync(noticesPath, original + "\nedited by hand\n");
      const r = run(builderDir);
      expect(r.code).toBe(1);
      expect(r.out).toContain("THIRD-PARTY-NOTICES.md is missing or out of date");
    } finally {
      writeFileSync(noticesPath, original);
    }
  });

  it("passes on the builder itself, with the notices file up to date", () => {
    const out = execFileSync(path.join(builderDir, "node_modules", ".bin", "tsx"), ["src/licence/check.ts"], {
      cwd: builderDir,
      encoding: "utf8",
    });
    expect(out).toContain("RESULT: PASSED");
    expect(out).toContain("Notices file THIRD-PARTY-NOTICES.md is up to date.");
  });
});
