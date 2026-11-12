/**
 * Rule 5 at build time: every page, form action and data route is written through a guard.
 *
 *   tsx scripts/check-guards.ts            check this app; exit code 1 if anything is unguarded
 *   tsx scripts/check-guards.ts --dir X    check the app in folder X (used by the tests)
 *
 * What it reads (the files are parsed, not searched as text):
 *   - every page file under src/app: its default export must be guardedPage(...) or publicPage(...);
 *   - every route file under src/app: each HTTP method it exports must be
 *     `export const GET = guardedRoute(...)` or publicRoute(...);
 *   - every file marked "use server": each thing it exports must be guardedAction(...) or
 *     publicAction(...); and no function anywhere may be marked "use server" on its own.
 * The guard names must be imported from "@/lib/roles" and not declared again in the file.
 *
 * What it does not read: layouts and the other special files (they must not show data); what a
 * guard is given (a page for every role is still "guarded"); and src/lib/roles.tsx itself, which
 * is protected from the build engine. It is run by `npm run build`, so an unguarded page, action
 * or route fails the build.
 *
 * Protected: the build engine must not change this file.
 */
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
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

const problems: string[] = [];
const rows: string[] = [];
const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules") walk(full, out);
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

const isUseServer = (stmt: unknown): boolean => {
  const s = stmt as Node | undefined;
  const e = s?.expression as Node | undefined;
  return s?.type === "ExpressionStatement" && e?.type === "StringLiteral" && e.value === "use server";
};

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
  const serverFile = body.length > 0 && isUseServer(body[0]);

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
    if (inner.length > 0 && isUseServer(inner[0])) {
      problems.push(`${rel(file)} has a function marked "use server" inside it. A form action goes in a file marked "use server" and is written with guardedAction.`);
    }
  }

  if (isPage) {
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
        // A route file may also export Next.js settings such as "dynamic"; only its methods are handlers.
        if (isRoute && !METHODS.includes(name)) continue;
        const guard = guardOf(d.init);
        if (!genuine(guard, kind)) {
          problems.push(`${rel(file)} exports "${name}" without a guard. Write it as "export const ${name} = ${GUARDS[kind][0]}(...)" with the guard imported from "@/lib/roles".`);
        } else rows.push(`  ${kind.padEnd(7)} ${rel(file)}  ${name} = ${guard}(${firstArgument(source, d.init, offset)})`);
      }
    }
  }
}

if (!existsSync(path.join(src, "app"))) problems.push("src/app was not found, so there was nothing to check. A check that read nothing has not passed.");
for (const legacy of ["pages", "src/pages"]) {
  if (existsSync(path.join(root, legacy))) problems.push(`${legacy}/ exists. This template uses the app router only; pages and routes there are not checked, so they are not allowed.`);
}
const files = walk(src).filter((f) => rel(f) !== "src/lib/roles.tsx");
for (const f of files) check(f);

console.log(`Guard check (rule 5): ${files.length} code files read under src/.`);
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
