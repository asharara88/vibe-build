// Package 0.4: one licence rule for every dependency. These tests show the rule passing on a
// clean set and failing on each kind of breach, first on the rule alone, then by running the
// real check against folders that hold a deliberately added test package.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

describe("one rule, kept the same in every component", () => {
  const templateDir = path.resolve(builderDir, "..", "templates", "next");
  it("the template carries the same two files as the builder, byte for byte", () => {
    for (const f of ["rule.ts", "check.ts"]) {
      expect(readFileSync(path.join(templateDir, "scripts", "licence", f), "utf8")).toBe(readFileSync(path.join(builderDir, "src", "licence", f), "utf8"));
    }
  });
  it("both components permit the same licences, and every exception names its approval", () => {
    const templateRule = JSON.parse(readFileSync(path.join(templateDir, "licence-rule.json"), "utf8")) as LicenceRule;
    expect(templateRule.permitted).toEqual(rule.permitted);
    for (const ex of [...rule.exceptions, ...templateRule.exceptions]) {
      expect(ex.approved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(ex.record).toContain("docs/DECISIONS.md");
      expect(["development", "shipped"]).toContain(ex.use);
    }
    // The only package approved for shipping is the one the owner approved for generated apps.
    expect(templateRule.exceptions.filter((e) => e.use === "shipped").map((e) => `${e.name}@${e.version}`)).toEqual(["caniuse-lite@1.0.30001823"]);
    expect(rule.exceptions.filter((e) => e.use === "shipped")).toEqual([]);
  });
});

describe("the rule", () => {
  const clean: Installed = { "a@1.0.0": { licenses: "MIT" }, "b@2.0.0": { licenses: "ISC" } };

  it("judges a package the lock file lists for another machine like any other, and counts it apart", () => {
    const r = applyRule(rule, { ...clean, "other-machine@1.0.0": { licenses: "LGPL-3.0-or-later", fromLockFile: true }, "fine-elsewhere@1.0.0": { licenses: "MIT", fromLockFile: true } }, {});
    expect(r.problems.map((p) => p.package)).toEqual(["other-machine@1.0.0"]);
    expect(r.checked).toBe(2);
    expect(r.fromLockFile).toBe(2);
  });

  it("holds an exception to one version where the rule gives one", () => {
    const pinned: LicenceRule = { ...rule, exceptions: [{ ...rule.exceptions[0]!, name: "data-pkg", licence: "CC-BY-4.0", use: "shipped", version: "1.0.5", build_packages: undefined }] };
    expect(applyRule(pinned, { ...clean, "data-pkg@1.0.5": { licenses: "CC-BY-4.0" } }, {}).problems).toEqual([]);
    const later = applyRule(pinned, { ...clean, "data-pkg@1.0.6": { licenses: "CC-BY-4.0" } }, {});
    expect(later.problems.map((p) => p.package)).toEqual(["data-pkg@1.0.6"]);
    expect(later.problems[0]!.reason).toContain("entered at version 1.0.5 only");
    // A longer number that merely begins the same way is a different version.
    expect(applyRule(pinned, { ...clean, "data-pkg@1.0.51": { licenses: "CC-BY-4.0" } }, {}).problems).toHaveLength(1);
  });

  it("accepts the component's own package at its named version, and refuses any other package of that name", () => {
    const withOwn: LicenceRule = { ...rule, own_packages: [{ name: "standin", version: "0.0.0-own", path: "vendor/standin", why: "test", files: {} }] };
    const ok = applyRule(withOwn, { ...clean, "standin@0.0.0-own": { licenses: "UNLICENSED" } }, {});
    expect(ok.problems).toEqual([]);
    expect(ok.ownInUse).toEqual(["standin@0.0.0-own"]);
    const real = applyRule(withOwn, { ...clean, "standin@2.3.4": { licenses: "MIT" } }, {});
    expect(real.problems.map((p) => p.package)).toEqual(["standin@2.3.4"]);
    // Without the rule naming it, an unlicensed package is refused like any other.
    expect(applyRule(rule, { ...clean, "standin@0.0.0-own": { licenses: "UNLICENSED" } }, {}).problems).toHaveLength(1);
  });

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

  function run(dir: string, rulePath?: string): { code: number; out: string } {
    try {
      const out = execFileSync(path.join(builderDir, "node_modules", ".bin", "tsx"), ["src/licence/check.ts", "--dir", dir, ...(rulePath ? ["--rule", rulePath] : [])], {
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

  // A lock file for a fixture: the installed test packages as registry entries, plus whatever is added.
  const registry = (name: string) => `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`;
  function lockFor(dir: string, licences: Record<string, string>, more: Record<string, unknown> = {}) {
    const packages: Record<string, unknown> = { "": { name: path.basename(dir), version: "0.0.1" } };
    for (const [pkg, licence] of Object.entries(licences)) packages[`node_modules/${pkg}`] = { version: "1.0.0", resolved: registry(pkg), license: licence };
    writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify({ name: path.basename(dir), lockfileVersion: 3, packages: { ...packages, ...more } }));
  }

  it("passes with a lock file whose entries all come from the registry under permitted licences", () => {
    const dir = fixture("lock-clean", { "fake-mit": "" }, {}, { "fake-mit": "MIT" });
    lockFor(dir, { "fake-mit": "MIT" }, { "node_modules/fake-elsewhere": { version: "1.0.0", resolved: registry("fake-elsewhere"), license: "ISC", optional: true } });
    const r = run(dir);
    expect(r.out).toContain("1 installed on this machine, and 1 more that the lock file lists for other machines");
    expect(r.code).toBe(0);
  });

  it("fails on a package that only another machine would install, read from the lock file", () => {
    const dir = fixture("lock-other-machine", { "fake-mit": "" }, {}, { "fake-mit": "MIT" });
    lockFor(dir, { "fake-mit": "MIT" }, { "node_modules/@fake/other-machine": { version: "1.0.0", resolved: registry("@fake/other-machine"), license: "LGPL-3.0-or-later", optional: true } });
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("@fake/other-machine@1.0.0 | LGPL-3.0-or-later");
  });

  it("fails on a lock-file package that records no licence, or one that names a permitted licence beside another", () => {
    const dir = fixture("lock-odd-licences", { "fake-mit": "" }, {}, { "fake-mit": "MIT" });
    lockFor(dir, { "fake-mit": "MIT" }, {
      "node_modules/fake-silent": { version: "1.0.0", resolved: registry("fake-silent"), optional: true },
      "node_modules/fake-both": { version: "1.0.0", resolved: registry("fake-both"), license: "MIT AND LGPL-3.0", optional: true },
    });
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("fake-silent@1.0.0 | (none declared)");
    expect(r.out).toContain("fake-both@1.0.0 | MIT AND LGPL-3.0");
  });

  it("fails on a package that does not come from the registry: an archive file, a git address, another server", () => {
    for (const [i, resolved] of ["file:../somewhere/fake-mit-1.0.0.tgz", "git+ssh://git@example.invalid/x/fake-mit.git#abc", "https://example.invalid/fake-mit-1.0.0.tgz", undefined].entries()) {
      const dir = fixture(`lock-source-${i}`, { "fake-mit": "" }, {}, { "fake-mit": "MIT" });
      lockFor(dir, {}, { "node_modules/fake-mit": { version: "1.0.0", license: "MIT", ...(resolved ? { resolved } : {}) } });
      const r = run(dir);
      expect(r.code).toBe(1);
      expect(r.out).toContain("node_modules/fake-mit does not come from the npm registry");
    }
  });

  it("fails on a lock file that lists no packages, or cannot be read", () => {
    for (const [i, text] of ['{"lockfileVersion":3}', '{"lockfileVersion":3,"packages":{"":{}}}', '{"lockfileVersion":3,"packages":[]}', "not json"].entries()) {
      const dir = fixture(`lock-empty-${i}`, { "fake-mit": "" }, {}, { "fake-mit": "MIT" });
      writeFileSync(path.join(dir, "package-lock.json"), text);
      const r = run(dir);
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/lists no packages|could not be read as JSON/);
    }
  });

  it("fails on a local package the rule does not name, whether a folder or a link", () => {
    const dir = fixture("lock-local", { "fake-mit": "" }, {}, { "fake-mit": "MIT" });
    lockFor(dir, { "fake-mit": "MIT" }, { "vendor/hidden": { name: "hidden", version: "1.0.0" }, "node_modules/hidden": { resolved: "vendor/hidden", link: true } });
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("vendor/hidden is listed as a local package and is not named in the rule");
    expect(r.out).toContain('node_modules/hidden is a link to the local folder "vendor/hidden"');
  });

  describe("a component's own package", () => {
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");
    const pj = JSON.stringify({ name: "standin", version: "0.0.0-own", private: true, license: "UNLICENSED" });
    const index = "throw new Error('not installed');\n";
    function own(name: string) {
      const dir = fixture(name, { "fake-mit": "", standin: "" }, {}, { "fake-mit": "MIT" });
      mkdirSync(path.join(dir, "vendor", "standin"), { recursive: true });
      writeFileSync(path.join(dir, "vendor", "standin", "package.json"), pj);
      writeFileSync(path.join(dir, "vendor", "standin", "index.js"), index);
      symlinkSync(path.join("..", "vendor", "standin"), path.join(dir, "node_modules", "standin"));
      lockFor(dir, { "fake-mit": "MIT" }, { "vendor/standin": { name: "standin", version: "0.0.0-own" }, "node_modules/standin": { resolved: "vendor/standin", link: true } });
      const rulePath = path.join(dir, "licence-rule.json");
      const ownRule: LicenceRule = { ...rule, own_packages: [{ name: "standin", version: "0.0.0-own", path: "vendor/standin", why: "test", files: { "package.json": sha(pj), "index.js": sha(index) } }] };
      writeFileSync(rulePath, JSON.stringify(ownRule));
      return { dir, rulePath };
    }
    it("passes when the folder is exactly what the rule names", () => {
      const { dir, rulePath } = own("own-ok");
      const r = run(dir, rulePath);
      expect(r.out).toContain("standin@0.0.0-own | vendor/standin | installed");
      expect(r.code).toBe(0);
    });
    it("fails without the rule naming it: an unlicensed private package is refused like any other", () => {
      const { dir } = own("own-unnamed");
      const r = run(dir);
      expect(r.code).toBe(1);
      expect(r.out).toContain("standin@0.0.0-own | UNLICENSED");
    });
    it("fails when a file in it has changed, or a file has been added", () => {
      const a = own("own-changed");
      writeFileSync(path.join(a.dir, "vendor", "standin", "index.js"), "module.exports = require('something-real');\n");
      const ra = run(a.dir, a.rulePath);
      expect(ra.code).toBe(1);
      expect(ra.out).toContain("vendor/standin/index.js has changed since the rule recorded it");
      const b = own("own-extra");
      mkdirSync(path.join(b.dir, "vendor", "standin", "lib"));
      writeFileSync(path.join(b.dir, "vendor", "standin", "lib", "real.node"), "binary");
      const rb = run(b.dir, b.rulePath);
      expect(rb.code).toBe(1);
      expect(rb.out).toContain("vendor/standin/lib/real.node is a file the rule does not name");
    });
    it("fails when a real package is installed under its name", () => {
      const { dir, rulePath } = own("own-replaced");
      rmSync(path.join(dir, "node_modules", "standin"));
      mkdirSync(path.join(dir, "node_modules", "standin"));
      writeFileSync(path.join(dir, "node_modules", "standin", "package.json"), JSON.stringify({ name: "standin", version: "9.9.9", license: "Apache-2.0" }));
      lockFor(dir, { "fake-mit": "MIT" }, { "node_modules/standin": { version: "9.9.9", resolved: registry("standin"), license: "Apache-2.0" } });
      const r = run(dir, rulePath);
      expect(r.code).toBe(1);
      expect(r.out).toContain("standin@9.9.9 | Apache-2.0 | the name standin belongs to this component's own package");
      expect(r.out).toContain("node_modules/standin is not the component's own folder vendor/standin");
    });
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
