// The one licence rule (hard rule 2; build plan package 0.4).
//
// Every installed package, shipped or development, must carry a licence on the permitted
// list, or be a named exception. An exception is the owner's written approval of ONE named
// package for ONE named use. It never covers another package with the same licence.
//
// This file is the rule only: it takes what the licence tool read from the installed
// packages, and what the lock file records for packages that other machines would install,
// and returns every problem it finds. It does not stop at the first one.
//
// The same two files (rule.ts and check.ts) are kept, byte for byte, in every component that
// is checked, so that a component still carries its check when it is copied out of this
// repository. A test in builder/ fails if the copies differ.

export type Use = "development" | "shipped";

export interface LicenceException {
  /** Exact package name. */
  name: string;
  /**
   * Optional list of per-machine build packages published with the named package, each by
   * its exact name. One is accepted only at the same version and licence as the named
   * package. A name that merely starts the same way is not covered.
   */
  build_packages?: string[];
  /** The licence string exactly as the installed package declares it. */
  licence: string;
  /**
   * Optional. Where given, the approval covers this version only: another version fails until
   * someone has looked at it and changed the number here.
   */
  version?: string;
  /** "development": must never be among the shipped dependencies. "shipped": may be. */
  use: Use;
  /** Date of the owner's written approval, and where it is recorded. */
  approved: string;
  record: string;
  attribution: string;
  source: string;
  licence_text: string;
  build_packages_note?: string;
}

/**
 * A package that is this component's own: a folder inside the component, linked in under a
 * package name, with no licence of anyone else's to check. It is accepted only at the named
 * version, from the named folder, with exactly the named files (each by its SHA-256).
 */
export interface OwnPackage {
  name: string;
  version: string;
  /** Folder inside the component, with forward slashes, for example "vendor/no-sharp". */
  path: string;
  why: string;
  /** Every file in that folder, by name, with the SHA-256 of its contents in hex. */
  files: Record<string, string>;
}

export interface LicenceRule {
  permitted: string[];
  exceptions: LicenceException[];
  own_packages?: OwnPackage[];
}

/** One package, as the licence tool reports it or as the lock file records it. Key is "name@version". */
export interface InstalledPackage {
  licenses?: string | string[];
  repository?: string;
  path?: string;
  licenseFile?: string;
  /** True when the package is not installed on this machine and its licence was read from the lock file. */
  fromLockFile?: boolean;
}
export type Installed = Record<string, InstalledPackage>;

export interface Problem {
  package: string;
  licence: string;
  reason: string;
}

export interface ExceptionInUse {
  exception: LicenceException;
  package: string;
  version: string;
  viaFamily: boolean;
  shipped: boolean;
}

export interface Result {
  /** Packages installed on this machine. */
  checked: number;
  /** Packages the lock file lists for other machines, judged by the licence the lock file records. */
  fromLockFile: number;
  /** This component's own packages that were found, as "name@version". */
  ownInUse: string[];
  shipped: number;
  problems: Problem[];
  exceptionsInUse: ExceptionInUse[];
  exceptionsNotInstalled: string[];
  /** Packages accepted because one side of an "A OR B" choice is permitted. */
  choices: { package: string; licence: string }[];
}

export function splitNameVersion(key: string): { name: string; version: string } {
  const at = key.lastIndexOf("@");
  if (at <= 0) return { name: key, version: "" };
  return { name: key.slice(0, at), version: key.slice(at + 1) };
}

/** A package may declare one licence expression, or (old style) a list in which every entry applies. */
function licenceParts(p: InstalledPackage): string[] {
  if (Array.isArray(p.licenses)) return p.licenses.map((l) => String(l).trim());
  return [(p.licenses ?? "").trim()];
}

function licenceString(p: InstalledPackage): string {
  const parts = licenceParts(p);
  return parts.length === 1 ? (parts[0] ?? "") : parts.map((l) => `(${l})`).join(" AND ");
}

/** Every entry of the package's licence declaration must be permitted. */
function isPermittedPackage(p: InstalledPackage, permitted: ReadonlySet<string>): boolean {
  const parts = licenceParts(p);
  return parts.length > 0 && parts.every((l) => isPermittedExpression(l, permitted));
}

/**
 * True only when the expression is made up entirely of permitted licences:
 * "A OR B" needs one permitted side (the user may choose it), "A AND B" needs both.
 * Anything this small reader does not understand is treated as not permitted.
 */
export function isPermittedExpression(expr: string, permitted: ReadonlySet<string>): boolean {
  let e = expr.trim();
  if (e === "") return false;
  if (e.startsWith("(") && e.endsWith(")") && !e.slice(1, -1).includes("(")) e = e.slice(1, -1).trim();
  if (e.includes("(") || e.includes(")")) return false;
  if (e.includes(" OR ")) return e.split(" OR ").some((part) => isPermittedExpression(part, permitted));
  if (e.includes(" AND ")) return e.split(" AND ").every((part) => isPermittedExpression(part, permitted));
  // A trailing "*" means the tool guessed the licence from a file and the package did not
  // declare it. A guess is not accepted.
  return permitted.has(e);
}

function findException(
  rule: LicenceRule,
  name: string,
  version: string,
  mainVersions: Map<string, Set<string>>,
): { exception: LicenceException; viaFamily: boolean; familyProblem?: string } | undefined {
  for (const ex of rule.exceptions) {
    if (ex.name === name) return { exception: ex, viaFamily: false };
  }
  for (const ex of rule.exceptions) {
    if (ex.build_packages?.includes(name)) {
      const mains = mainVersions.get(ex.name);
      if (mains === undefined) {
        return { exception: ex, viaFamily: true, familyProblem: `its main package ${ex.name} is not installed` };
      }
      // More than one version of the main package can be installed; a build package must match one of them.
      if (!mains.has(version)) {
        return {
          exception: ex,
          viaFamily: true,
          familyProblem: `its version ${version} differs from ${[...mains].map((v) => `${ex.name}@${v}`).join(", ")}`,
        };
      }
      return { exception: ex, viaFamily: true };
    }
  }
  return undefined;
}

/**
 * Apply the rule. `all` is every installed package; `shipped` is the subset reachable from
 * the component's non-development dependencies.
 */
export function applyRule(rule: LicenceRule, all: Installed, shipped: Installed): Result {
  const permitted = new Set(rule.permitted);
  const problems: Problem[] = [];
  const exceptionsInUse: ExceptionInUse[] = [];
  const seen = new Set<string>();
  const choices: { package: string; licence: string }[] = [];
  const ownInUse: string[] = [];

  const mainVersions = new Map<string, Set<string>>();
  for (const key of Object.keys(all)) {
    const { name, version } = splitNameVersion(key);
    if (rule.exceptions.some((ex) => ex.name === name)) mainVersions.set(name, (mainVersions.get(name) ?? new Set<string>()).add(version));
  }

  for (const key of Object.keys(all).sort()) {
    const pkg = all[key];
    if (!pkg) continue;
    const { name, version } = splitNameVersion(key);
    const licence = licenceString(pkg);
    const isShipped = key in shipped;

    // The component's own packages. Whether the folder really is the component's own is
    // checked on disk and in the lock file by the caller; here only the name and version.
    const own = (rule.own_packages ?? []).find((o) => o.name === name);
    if (own) {
      if (own.version === version) {
        ownInUse.push(key);
        continue;
      }
      problems.push({
        package: key,
        licence: licence || "(none declared)",
        reason: `the name ${name} belongs to this component's own package ${own.name}@${own.version} (${own.path}); any other package of that name is not to be installed`,
      });
      continue;
    }

    const found = findException(rule, name, version, mainVersions);
    if (!found) {
      if (isPermittedPackage(pkg, permitted)) {
        if (licence.includes(" OR ")) choices.push({ package: key, licence });
        continue;
      }
      problems.push({
        package: key,
        licence: licence || "(none declared)",
        reason: "its licence is outside the permitted list and the package is not a named exception",
      });
      continue;
    }

    const { exception: ex, viaFamily, familyProblem } = found;
    seen.add(ex.name);
    if (familyProblem) {
      problems.push({ package: key, licence, reason: `it is a named build package of ${ex.name}, but ${familyProblem}` });
      continue;
    }
    if (licence !== ex.licence) {
      problems.push({
        package: key,
        licence: licence || "(none declared)",
        reason: `the approval of ${ex.name} was for the licence "${ex.licence}", and the installed package now declares a different one`,
      });
      continue;
    }
    // A build package is held to the same number: it must match its main package, which must match this.
    if (ex.version !== undefined && ex.version !== version) {
      problems.push({
        package: key,
        licence,
        reason: `${ex.name} is entered at version ${ex.version} only; this version has not been looked at`,
      });
      continue;
    }
    if (ex.use === "development" && isShipped) {
      problems.push({
        package: key,
        licence,
        reason: `${ex.name} is approved for development use only, and it is among the shipped dependencies`,
      });
      continue;
    }
    exceptionsInUse.push({ exception: ex, package: name, version, viaFamily, shipped: isShipped });
  }

  // A shipped package must also be in the full list; if the tool ever disagrees, say so.
  for (const key of Object.keys(shipped)) {
    if (!(key in all)) {
      problems.push({ package: key, licence: "", reason: "it is listed as shipped but missing from the full list of installed packages" });
    }
  }

  const exceptionsNotInstalled = rule.exceptions.map((ex) => ex.name).filter((n) => !seen.has(n));
  const lockOnly = Object.values(all).filter((p) => p.fromLockFile === true).length;
  return {
    checked: Object.keys(all).length - lockOnly,
    fromLockFile: lockOnly,
    ownInUse,
    shipped: Object.keys(shipped).length,
    problems,
    exceptionsInUse,
    exceptionsNotInstalled,
    choices,
  };
}

/** The notices file: what is kept for each named exception that is installed. */
export function renderNotices(component: string, result: Result, licenceTexts: Map<string, string>): string {
  const lines: string[] = [];
  lines.push(`# Third-party notices: named licence exceptions in \`${component}\``);
  lines.push("");
  lines.push(
    "Generated by the licence check from `licence-rule.json` and the installed packages; do not edit by hand. The " +
      "notice, source and licence-text lines are the ones typed into the rule file. It lists only the packages " +
      "whose licence is outside the permitted list and which the owner approved by name (`docs/DECISIONS.md`). " +
      "Every other package's licence is in the report `licences.csv`, which the check writes beside this file when " +
      "run with `--write`; that report describes the machine it was written on. This project uses each package " +
      "below as published and does not change its files.",
  );
  const mains = result.exceptionsInUse.filter((u) => !u.viaFamily);
  if (mains.length === 0) {
    lines.push("");
    lines.push("No named exception is installed.");
  }
  for (const u of mains) {
    const ex = u.exception;
    lines.push("");
    lines.push(`## ${u.package} ${u.version}`);
    lines.push("");
    lines.push(`- Licence: ${ex.licence}`);
    lines.push(`- Licence text: ${ex.licence_text}`);
    lines.push(`- Source: ${ex.source}`);
    lines.push(`- Notice: ${ex.attribution}`);
    lines.push("- Modified by this project: no");
    lines.push(
      `- Approved use: ${ex.use === "development" ? "development only; not part of anything a customer receives" : "may be part of a generated app"}`,
    );
    lines.push(`- Approval: ${ex.approved}; ${ex.record}`);
    if (ex.build_packages_note) lines.push(`- Build packages: ${ex.build_packages_note}`);
    const text = licenceTexts.get(u.package);
    if (text !== undefined) {
      lines.push("");
      lines.push("The licence file shipped inside the package:");
      lines.push("");
      lines.push("```text");
      lines.push(text.replace(/\r\n/g, "\n").trimEnd());
      lines.push("```");
    } else {
      lines.push("- No separate licence file was found inside the package.");
    }
  }
  lines.push("");
  return lines.join("\n");
}
