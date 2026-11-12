// The one licence rule (hard rule 2; build plan package 0.4).
//
// Every installed package, shipped or development, must carry a licence on the permitted
// list, or be a named exception. An exception is the owner's written approval of ONE named
// package for ONE named use. It never covers another package with the same licence.
//
// This file is the rule only: it takes what the licence tool read from the installed
// packages and returns every problem it finds. It does not stop at the first one.

export type Use = "development" | "shipped";

export interface LicenceException {
  /** Exact package name. */
  name: string;
  /**
   * Optional name prefix for per-machine build packages published with the named package
   * (same version, same licence), for example "lightningcss-" for lightningcss-linux-x64-gnu.
   */
  family?: string;
  /** The licence string exactly as the installed package declares it. */
  licence: string;
  /** "development": must never be among the shipped dependencies. "shipped": may be. */
  use: Use;
  /** Date of the owner's written approval, and where it is recorded. */
  approved: string;
  record: string;
  attribution: string;
  source: string;
  licence_text: string;
  family_note?: string;
}

export interface LicenceRule {
  permitted: string[];
  exceptions: LicenceException[];
}

/** One installed package, as the licence tool reports it. Key is "name@version". */
export interface InstalledPackage {
  licenses?: string | string[];
  repository?: string;
  path?: string;
  licenseFile?: string;
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
  checked: number;
  shipped: number;
  problems: Problem[];
  exceptionsInUse: ExceptionInUse[];
  exceptionsNotInstalled: string[];
}

export function splitNameVersion(key: string): { name: string; version: string } {
  const at = key.lastIndexOf("@");
  if (at <= 0) return { name: key, version: "" };
  return { name: key.slice(0, at), version: key.slice(at + 1) };
}

function licenceString(p: InstalledPackage): string {
  if (Array.isArray(p.licenses)) return p.licenses.join(" AND ");
  return (p.licenses ?? "").trim();
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
  mainVersions: Map<string, string>,
): { exception: LicenceException; viaFamily: boolean; familyProblem?: string } | undefined {
  for (const ex of rule.exceptions) {
    if (ex.name === name) return { exception: ex, viaFamily: false };
  }
  for (const ex of rule.exceptions) {
    if (ex.family && name.startsWith(ex.family) && name.length > ex.family.length) {
      const main = mainVersions.get(ex.name);
      if (main === undefined) {
        return { exception: ex, viaFamily: true, familyProblem: `its main package ${ex.name} is not installed` };
      }
      if (main !== version) {
        return {
          exception: ex,
          viaFamily: true,
          familyProblem: `its version ${version} differs from ${ex.name}@${main}`,
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

  const mainVersions = new Map<string, string>();
  for (const key of Object.keys(all)) {
    const { name, version } = splitNameVersion(key);
    if (rule.exceptions.some((ex) => ex.name === name)) mainVersions.set(name, version);
  }

  for (const key of Object.keys(all).sort()) {
    const pkg = all[key];
    if (!pkg) continue;
    const { name, version } = splitNameVersion(key);
    const licence = licenceString(pkg);
    const isShipped = key in shipped;

    const found = findException(rule, name, version, mainVersions);
    if (!found) {
      if (isPermittedExpression(licence, permitted)) continue;
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
      problems.push({ package: key, licence, reason: `it matches the approved family of ${ex.name}, but ${familyProblem}` });
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
  return {
    checked: Object.keys(all).length,
    shipped: Object.keys(shipped).length,
    problems,
    exceptionsInUse,
    exceptionsNotInstalled,
  };
}

/** The notices file: what is kept for each named exception that is installed. */
export function renderNotices(component: string, result: Result, licenceTexts: Map<string, string>): string {
  const lines: string[] = [];
  lines.push(`# Third-party notices: named licence exceptions in \`${component}\``);
  lines.push("");
  lines.push(
    "Generated by the licence check from the installed packages; do not edit by hand. It lists only the packages " +
      "whose licence is outside the permitted list and which the owner approved by name (`docs/DECISIONS.md`). " +
      "Every other package's licence is in the licence report beside this file. Each package below is used " +
      "exactly as published: it has not been modified.",
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
    lines.push("- Modified: no");
    lines.push(
      `- Approved use: ${ex.use === "development" ? "development only; not part of anything a customer receives" : "may be part of a generated app"}`,
    );
    lines.push(`- Approval: ${ex.approved}; ${ex.record}`);
    if (ex.family_note) lines.push(`- Build packages: ${ex.family_note}`);
    const text = licenceTexts.get(u.package);
    if (text !== undefined) {
      lines.push("");
      lines.push("The licence file shipped inside the package:");
      lines.push("");
      lines.push("```text");
      lines.push(text.replace(/\r\n/g, "\n").trimEnd());
      lines.push("```");
    } else {
      lines.push("- The package ships no separate licence file; the notice above is taken from its README.");
    }
  }
  lines.push("");
  return lines.join("\n");
}
