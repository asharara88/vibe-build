/**
 * Rule 5 at build time: every page, form action and data route is written through a guard.
 *
 *   tsx scripts/check-guards.ts            check this app; exit code 1 if anything is unguarded
 *   tsx scripts/check-guards.ts --dir X    check the app in folder X (used by the tests)
 *
 * What it reads (the files are parsed, not searched as text):
 *   - every page file under src/app: its default export must be guardedPage(...) or publicPage(...),
 *     and it may export nothing else but a few fixed settings with plain values (no
 *     generateMetadata, no metadata: code there would run for every visitor);
 *   - every route file under src/app: each HTTP method it exports must be
 *     `export const GET = guardedRoute(...)` or publicRoute(...), and nothing else but those settings;
 *   - every code file of the component, inside src/ or not (hidden folders too; only the top-level
 *     node_modules, .next and .git are skipped): a file whose opening directives include
 *     "use server" may export only `export const name = guardedAction(...)` or publicAction(...);
 *     and no function anywhere may carry "use server" among its own opening directives.
 * The guard names must be imported from "@/lib/roles" and not declared again in the file; an
 * export must be `const`, so that it cannot be swapped for something else afterwards.
 * It also refuses: a top-level app/ or pages/ folder, or src/pages/ (Next.js would serve those);
 * a node_modules folder anywhere but at the top; the special files that answer with data by
 * themselves (manifest, sitemap, robots, and social and icon images written as code, numbered or
 * not); a tsconfig.json that maps "@/" anywhere but src/ or extends another; a jsconfig.json;
 * a Next.js settings file other than the template's own next.config.ts, byte for byte; a build
 * script other than exactly "tsx scripts/check-guards.ts && next build"; and a page or route set
 * to be built ahead of time ("force-static"), which would serve one answer to everyone.
 *
 * What it is for: catching a page, action or route written without its guard by mistake. It is
 * not a defence against code written on purpose to get round the guard (for example code that
 * changes how the sign-in library reads a session); that is for review.
 *
 * What it does not read: layouts and the other special files (they must not show data); what a
 * guard is given (a page for every role is still "guarded"); and src/lib/roles.tsx itself, which
 * the build engine is not to change. It is run by `npm run build`, so an unguarded page, action
 * or route fails the build.
 *
 * Protected: the build engine must not change this file.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync } from "@swc/core";

type Node = { type: string; span?: { start: number; end: number }; [key: string]: unknown };

const here = path.dirname(fileURLToPath(import.meta.url));
const dirArg = process.argv.indexOf("--dir");
const root = path.resolve(dirArg >= 0 ? (process.argv[dirArg + 1] ?? "") : path.join(here, ".."));
const src = path.join(root, "src");

const GUARDS = {
  page: ["guardedPage", "publicPage"],
  route: ["guardedRoute", "publicRoute"],
  action: ["guardedAction", "publicAction"],
} as const;
const ALL_GUARDS: string[] = Object.values(GUARDS).flat();
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
/** Settings a page or route file may also export, each with a plain value: no code of its own. */
const SETTINGS = ["dynamic", "dynamicParams", "revalidate", "fetchCache", "runtime", "preferredRegion", "maxDuration"];
/** Special files that answer a request with data by themselves, with no page around them. */
const SELF_ANSWERING = /^(manifest|sitemap|robots|opengraph-image\d*|twitter-image\d*|icon\d*|apple-icon\d*)$/;
/** Folders not read, and only at the top of the component: anywhere else, they are read like any other. */
const SKIP_AT_TOP = new Set(["node_modules", ".next", ".git"]);
/** The template's own Next.js settings file, by the SHA-256 of its contents. Changing it means changing this. */
const NEXT_CONFIG = { name: "next.config.ts", sha256: "6d6a993c13eda1af5e2f92ae2697c1d5fb1afb0dadb3d232f5017661433a7bbd" };
const BUILD_SCRIPT = "tsx scripts/check-guards.ts && next build";
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

const problems: string[] = [];
const rows: string[] = [];
const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (dir === root && SKIP_AT_TOP.has(name)) continue;
      if (name === "node_modules") {
        problems.push(`${rel(full)}/ is a node_modules folder below the top of the component. Packages are installed only at the top; nothing here is read, so it is not allowed.`);
        continue;
      }
      walk(full, out);
    } else if (CODE.test(name)) out.push(full);
  }
  return out;
}

/** Every node of the tree, depth first. */
function* nodes(value: unknown): Generator<Node> {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) yield* nodes(v);
    return;
  }
  const n = value as Node;
  if (typeof n.type === "string") yield n;
  for (const v of Object.values(n)) yield* nodes(v);
}

/** The opening directives of a file or a function body: the plain strings before its first other statement. */
function directives(stmts: Node[]): string[] {
  const out: string[] = [];
  for (const s of stmts) {
    const e = s.expression as Node | undefined;
    if (s.type !== "ExpressionStatement" || e?.type !== "StringLiteral") break;
    out.push(e.value as string);
  }
  return out;
}
const marksServer = (stmts: Node[]): boolean => directives(stmts).includes("use server");
/** A setting that has a page or route built once, ahead of time, and the same answer served to everyone. */
const builtAhead = (d: Node): boolean => ((d.id as Node).value === "dynamic" && (d.init as Node | undefined)?.value === "force-static");
/** A plain value: text, a number, true or false. */
const plain = (expr: unknown): boolean => ["StringLiteral", "NumericLiteral", "BooleanLiteral"].includes((expr as Node | undefined)?.type ?? "");

/** The name of the guard a value is made with, if it is a direct call to one: guardedPage(...) and so on. */
function guardOf(expr: unknown): string | null {
  const e = expr as Node | undefined;
  if (e?.type !== "CallExpression") return null;
  const callee = e.callee as Node | undefined;
  return callee?.type === "Identifier" && typeof callee.value === "string" ? callee.value : null;
}

function firstArgument(source: string, expr: unknown, offset: number): string {
  const args = ((expr as Node).arguments as Array<{ expression: Node }> | undefined) ?? [];
  const span = args[0]?.expression.span;
  if (!span) return "";
  return source.slice(span.start - offset, span.end - offset).replace(/\s+/g, " ").slice(0, 90);
}

function check(file: string): void {
  const source = readFileSync(file, "utf8");
  let module: Node;
  try {
    module = parseSync(source, { syntax: "typescript", tsx: /x$/.test(file), target: "es2022" }) as unknown as Node;
  } catch {
    problems.push(`${rel(file)} could not be read as code, so it could not be checked.`);
    return;
  }
  const body = (module.body as Node[]) ?? [];
  const offset = (module.span?.start ?? 0) - (source.length - source.trimStart().length);
  const base = path.basename(file).replace(CODE, "");
  const inApp = rel(file).startsWith("src/app/");
  const isPage = inApp && base === "page";
  const isRoute = inApp && base === "route";
  const serverFile = marksServer(body);
  if (inApp && SELF_ANSWERING.test(base)) {
    problems.push(`${rel(file)} is a special file that answers with data by itself, with no guard around it. It is not allowed; a static file in public/ can be used instead.`);
  }

  // Which guard names this file really takes from the guards' own file, and which it declares itself.
  const imported = new Set<string>();
  const declaredHere = new Set<string>();
  for (const stmt of body) {
    if (stmt.type === "ImportDeclaration") {
      const from = ((stmt.source as Node).value as string) ?? "";
      for (const spec of (stmt.specifiers as Node[]) ?? []) {
        const local = ((spec.local as Node).value as string) ?? "";
        const original = spec.imported ? (((spec.imported as Node).value as string) ?? local) : local;
        if (from === "@/lib/roles" && spec.type === "ImportSpecifier" && original === local) imported.add(local);
        else if (ALL_GUARDS.includes(local)) declaredHere.add(local);
      }
    }
  }
  for (const n of nodes(body)) {
    if (n.type === "VariableDeclarator" || n.type === "FunctionDeclaration" || n.type === "ClassDeclaration" || n.type === "Parameter") {
      const id = (n.id ?? n.identifier ?? n.pat) as Node | undefined;
      const name = id?.type === "Identifier" ? (id.value as string) : undefined;
      if (name && ALL_GUARDS.includes(name)) declaredHere.add(name);
    }
  }
  const genuine = (name: string | null, kind: keyof typeof GUARDS): name is string =>
    name !== null && (GUARDS[kind] as readonly string[]).includes(name) && imported.has(name) && !declaredHere.has(name);

  // A function marked "use server" on its own, anywhere: an action that no guard was written around.
  for (const n of nodes(body)) {
    // The body of a function, whatever kind of function it is (the parser names them differently).
    const inner = Array.isArray(n.stmts) ? (n.stmts as Node[]) : [];
    if (n !== (module as Node) && marksServer(inner)) {
      problems.push(`${rel(file)} has a function marked "use server" inside it. A form action goes in a file marked "use server" and is written with guardedAction.`);
    }
  }

  if (isPage) {
    for (const stmt of body) {
      if (stmt.type === "ExportAllDeclaration" || (stmt.type === "ExportNamedDeclaration" && ((stmt.specifiers as Node[]) ?? []).length > 0)) {
        problems.push(`${rel(file)} re-exports names. A page file exports only its page, written with guardedPage.`);
      }
      if (stmt.type !== "ExportDeclaration") continue;
      const decl = stmt.declaration as Node;
      if (decl.type === "TsTypeAliasDeclaration" || decl.type === "TsInterfaceDeclaration") continue;
      const ds = decl.type === "VariableDeclaration" ? ((decl.declarations as Node[]) ?? []) : [];
      const settingsOnly =
        decl.type === "VariableDeclaration" &&
        decl.kind === "const" &&
        ds.every((d) => (d.id as Node).type === "Identifier" && SETTINGS.includes((d.id as Node).value as string) && plain(d.init) && !builtAhead(d));
      if (!settingsOnly) {
        const name = ds.length > 0 && (ds[0]!.id as Node).type === "Identifier" ? ((ds[0]!.id as Node).value as string) : (((decl.identifier as Node | undefined)?.value as string | undefined) ?? "(unnamed)");
        problems.push(`${rel(file)} exports "${name}" beside its page. Code there runs for every visitor, before any guard; a page file exports only its page and, if needed, a setting with a plain value (${SETTINGS.join(", ")}).`);
      }
    }
    const def = body.find((s) => s.type === "ExportDefaultExpression" || s.type === "ExportDefaultDeclaration");
    const guard = def?.type === "ExportDefaultExpression" ? guardOf(def.expression) : null;
    if (!def) problems.push(`${rel(file)} is a page with no default export.`);
    else if (!genuine(guard, "page")) problems.push(`${rel(file)} is a page whose default export is not guardedPage(...) or publicPage(...) from "@/lib/roles".`);
    else rows.push(`  page    ${rel(file)}  ${guard}(${firstArgument(source, def.expression, offset)})`);
  }

  if (isRoute || serverFile) {
    const kind = isRoute ? "route" : "action";
    for (const stmt of body) {
      if (stmt.type === "ExportAllDeclaration" || stmt.type === "ExportNamedDeclaration") {
        // "export { x }" and "export * from": what is exported cannot be seen to be guarded here.
        if (stmt.type === "ExportAllDeclaration" || ((stmt.specifiers as Node[]) ?? []).length > 0) {
          problems.push(`${rel(file)} re-exports names. In a ${kind} file each export is written out as "export const name = ${GUARDS[kind][0]}(...)".`);
        }
        continue;
      }
      if (stmt.type === "ExportDefaultExpression" || stmt.type === "ExportDefaultDeclaration") {
        if (serverFile) problems.push(`${rel(file)} has a default export. In a "use server" file each action is "export const name = guardedAction(...)".`);
        continue;
      }
      if (stmt.type !== "ExportDeclaration") continue;
      const decl = stmt.declaration as Node;
      if (decl.type !== "VariableDeclaration") {
        if (decl.type === "TsTypeAliasDeclaration" || decl.type === "TsInterfaceDeclaration") continue;
        const name = ((decl.identifier as Node | undefined)?.value as string | undefined) ?? "(unnamed)";
        if (isRoute && !METHODS.includes(name) && decl.type === "FunctionDeclaration") {
          problems.push(`${rel(file)} exports a function "${name}". A route file exports only its methods, each written with guardedRoute.`);
        } else {
          problems.push(`${rel(file)} exports "${name}" without a guard. Write it as "export const ${name} = ${GUARDS[kind][0]}(...)".`);
        }
        continue;
      }
      for (const d of (decl.declarations as Node[]) ?? []) {
        const id = d.id as Node;
        if (id.type !== "Identifier") {
          problems.push(`${rel(file)} exports several names at once. Each export is written out on its own with its guard.`);
          continue;
        }
        const name = id.value as string;
        if (decl.kind !== "const") {
          problems.push(`${rel(file)} exports "${name}" with "${String(decl.kind)}". An export is "const", so that it cannot be replaced afterwards by something without a guard.`);
          continue;
        }
        // A route file may also export Next.js settings such as "dynamic", with a plain value; only its methods are handlers.
        if (isRoute && !METHODS.includes(name)) {
          if (!(SETTINGS.includes(name) && plain(d.init) && !builtAhead(d))) {
            problems.push(`${rel(file)} exports "${name}". A route file exports only its methods, each written with guardedRoute, and settings with a plain value (${SETTINGS.join(", ")}).`);
          }
          continue;
        }
        const guard = guardOf(d.init);
        if (!genuine(guard, kind)) {
          problems.push(`${rel(file)} exports "${name}" without a guard. Write it as "export const ${name} = ${GUARDS[kind][0]}(...)" with the guard imported from "@/lib/roles".`);
        } else rows.push(`  ${kind.padEnd(7)} ${rel(file)}  ${name} = ${guard}(${firstArgument(source, d.init, offset)})`);
      }
    }
  }
}

if (!existsSync(path.join(src, "app"))) problems.push("src/app was not found, so there was nothing to check. A check that read nothing has not passed.");
for (const other of ["app", "pages", "src/pages"]) {
  if (existsSync(path.join(root, other))) problems.push(`${other}/ exists. Next.js would serve pages and routes from it, and only src/app is checked, so it is not allowed.`);
}

// The settings that decide which files Next.js serves, and what "@/lib/roles" is.
function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}
const tsconfigPath = path.join(root, "tsconfig.json");
if (existsSync(tsconfigPath)) {
  const opts = ((readJson(tsconfigPath) as { compilerOptions?: Record<string, unknown> } | undefined)?.compilerOptions ?? null) as Record<string, unknown> | null;
  const paths = opts?.paths;
  const extendsOther = (readJson(tsconfigPath) as { extends?: unknown } | undefined)?.extends !== undefined;
  if (opts === null || extendsOther || JSON.stringify(paths) !== JSON.stringify({ "@/*": ["./src/*"] }) || (opts.baseUrl !== undefined && opts.baseUrl !== ".")) {
    problems.push('tsconfig.json does not map "@/" to src/ and only that, so "@/lib/roles" might not be the guards\' own file.');
  }
}
if (existsSync(path.join(root, "jsconfig.json"))) problems.push('jsconfig.json exists. Only tsconfig.json may say where "@/" points.');
const pkg = readJson(path.join(root, "package.json")) as { scripts?: Record<string, string> } | undefined;
if (pkg !== undefined && pkg.scripts?.build !== BUILD_SCRIPT) {
  problems.push(`package.json's build script is not exactly "${BUILD_SCRIPT}", so a build might not run this check, or might go on when it fails.`);
}
// The Next.js settings decide which files are pages and where "@/" is looked up; they could be
// written in too many ways to read reliably, so the template's own file is held to its exact contents.
if (pkg !== undefined) {
  for (const name of readdirSync(root).filter((n) => /^next\.config\./.test(n))) {
    if (name !== NEXT_CONFIG.name) problems.push(`${name} exists. The only Next.js settings file allowed is the template's own ${NEXT_CONFIG.name}.`);
  }
  const f = path.join(root, NEXT_CONFIG.name);
  const sha = existsSync(f) ? createHash("sha256").update(readFileSync(f)).digest("hex") : "";
  if (sha !== NEXT_CONFIG.sha256) problems.push(`${NEXT_CONFIG.name} is missing or has changed. It is held to the template's own version; a change to it is a change to this check, made by a person.`);
}

// Every code file of the component: pages and routes count only under src/app, but a "use server"
// file or function counts wherever it is.
const files = walk(root).filter((f) => rel(f) !== "src/lib/roles.tsx");
for (const f of files) check(f);

console.log(`Guard check (rule 5): ${files.length} code files read in the component.`);
console.log("Pages, form actions and data routes, each with its guard and what the guard is given:");
for (const r of rows) console.log(r);
if (rows.length === 0) problems.push("No page, action or route was found. A check that read nothing has not passed.");
if (problems.length > 0) {
  console.log(`PROBLEMS: ${problems.length}`);
  for (const p of problems) console.log(`  ${p}`);
  console.log("RESULT: FAILED");
  process.exit(1);
}
console.log("RESULT: PASSED");
