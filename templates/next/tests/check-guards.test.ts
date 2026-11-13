// The build-time guard check (scripts/check-guards.ts): it passes on this template, and fails
// when a page, a form action or a data route is written without a guard. Run with `npm test`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const templateDir = path.resolve(import.meta.dirname, "..");
const tsx = path.join(templateDir, "node_modules", ".bin", "tsx");
const tmp = mkdtempSync(path.join(os.tmpdir(), "guard-check-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

function run(dir?: string): { code: number; out: string } {
  try {
    const out = execFileSync(tsx, ["scripts/check-guards.ts", ...(dir ? ["--dir", dir] : [])], { cwd: templateDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? -1, out: err.stdout ?? "" };
  }
}

let n = 0;
/** A small app: one guarded page so that there is something right in it, plus the files given. */
function app(files: Record<string, string>): string {
  const dir = path.join(tmp, `app-${++n}`);
  const all: Record<string, string> = {
    "src/app/[locale]/home/page.tsx": `import { guardedPage } from "@/lib/roles";\nexport default guardedPage(["manager"], async () => null);\n`,
    ...files,
  };
  for (const [name, text] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
}
const fails = (files: Record<string, string>, message: string) => {
  const r = run(app(files));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /RESULT: FAILED/);
  assert.ok(r.out.includes(message), `expected "${message}" in:\n${r.out}`);
};
const passes = (files: Record<string, string>) => {
  const r = run(app(files));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /RESULT: PASSED/);
};

describe("the guard check on this template", () => {
  it("passes, and lists every page, action and route with its guard", () => {
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /page\s+src\/app\/\[locale\]\/example\/restricted\/page\.tsx\s+guardedPage\(\["hr_admin"\]\)/);
    assert.match(r.out, /action\s+src\/app\/\[locale\]\/example\/action\/actions\.ts\s+runExampleAction = guardedAction\(\["manager", "hr_admin"\]\)/);
    assert.match(r.out, /route\s+src\/app\/api\/example\/roles\/route\.ts\s+GET = guardedRoute\(\["manager", "hr_admin"\]\)/);
    assert.match(r.out, /RESULT: PASSED/);
  });
});

describe("a page without a guard fails the check", () => {
  it("a plain page component", () => {
    fails({ "src/app/[locale]/open/page.tsx": `export default async function Open() { return null; }\n` }, "src/app/[locale]/open/page.tsx is a page whose default export is not guardedPage");
  });
  it("a page that calls something else, or keeps the guard in a variable first", () => {
    fails({ "src/app/[locale]/a/page.tsx": `import { somethingElse } from "@/lib/other";\nexport default somethingElse(["manager"], async () => null);\n` }, "src/app/[locale]/a/page.tsx is a page whose default export is not");
    fails({ "src/app/[locale]/b/page.tsx": `import { guardedPage } from "@/lib/roles";\nconst page = guardedPage(["manager"], async () => null);\nexport default page;\n` }, "src/app/[locale]/b/page.tsx is a page whose default export is not");
  });
  it("a guard of the same name that does not come from the guards' own file", () => {
    fails({ "src/app/[locale]/c/page.tsx": `const guardedPage = (_roles: string[], render: () => unknown) => render;\nexport default guardedPage(["manager"], async () => null);\n` }, "src/app/[locale]/c/page.tsx is a page whose default export is not");
    fails({ "src/app/[locale]/d/page.tsx": `import { guardedPage } from "@/lib/my-own-roles";\nexport default guardedPage(["manager"], async () => null);\n` }, "src/app/[locale]/d/page.tsx is a page whose default export is not");
    fails({ "src/app/[locale]/e/page.tsx": `import { publicPage as guardedPage } from "@/lib/roles";\nexport default guardedPage("x", async () => null);\n` }, "src/app/[locale]/e/page.tsx is a page whose default export is not");
  });
  it("a page in the older pages folder, which is not checked and so not allowed", () => {
    fails({ "src/pages/open.tsx": `export default function Open() { return null; }\n` }, "src/pages/ exists");
  });
});

describe("a data route without a guard fails the check", () => {
  it("a plain handler, as a function or as a constant", () => {
    fails({ "src/app/api/open/route.ts": `export async function GET() { return Response.json({}); }\n` }, 'src/app/api/open/route.ts exports "GET" without a guard');
    fails({ "src/app/api/open2/route.ts": `export const POST = async () => Response.json({});\n` }, 'src/app/api/open2/route.ts exports "POST" without a guard');
  });
  it("one guarded method beside one that is not", () => {
    fails(
      { "src/app/api/mixed/route.ts": `import { guardedRoute } from "@/lib/roles";\nexport const GET = guardedRoute(["manager"], () => Response.json({}));\nexport const DELETE = async () => Response.json({});\n` },
      'src/app/api/mixed/route.ts exports "DELETE" without a guard',
    );
  });
  it("handlers exported together or passed on from another file", () => {
    fails({ "src/app/api/both/route.ts": `const h = { GET: async () => Response.json({}), POST: async () => Response.json({}) };\nexport const { GET, POST } = h;\n` }, "src/app/api/both/route.ts exports several names at once");
    fails({ "src/app/api/again/route.ts": `export { GET } from "../open/handlers";\n` }, "src/app/api/again/route.ts re-exports names");
  });
  it("passes when every method has its guard, with settings beside them", () => {
    passes({ "src/app/api/ok/route.ts": `import { guardedRoute, publicRoute } from "@/lib/roles";\nexport const dynamic = "force-dynamic";\nexport const GET = guardedRoute(["manager"], () => Response.json({}));\nexport const POST = publicRoute("a reason", () => Response.json({}));\n` });
  });
});

describe("a form action without a guard fails the check", () => {
  it('a plain action in a file marked "use server"', () => {
    fails({ "src/app/[locale]/x/actions.ts": `"use server";\nexport async function save() {}\n` }, 'src/app/[locale]/x/actions.ts exports "save" without a guard');
    fails({ "src/lib/actions.ts": `"use server";\nexport const save = async () => {};\n` }, 'src/lib/actions.ts exports "save" without a guard');
  });
  it('a function marked "use server" inside a page or a component', () => {
    fails(
      { "src/components/Form.tsx": `export function Form() {\n  async function save() {\n    "use server";\n  }\n  return <form action={save} />;\n}\n` },
      'src/components/Form.tsx has a function marked "use server" inside it',
    );
  });
  it("the same, for a function written with an arrow, and for one inside an event handler", () => {
    fails({ "src/components/Arrow.tsx": `export function Arrow() {\n  const save = async () => {\n    "use server";\n  };\n  return <form action={save} />;\n}\n` }, 'src/components/Arrow.tsx has a function marked "use server" inside it');
    fails({ "src/app/[locale]/z/page.tsx": `import { guardedPage } from "@/lib/roles";\nexport default guardedPage(["manager"], async () => <form action={async function () { "use server"; }} />);\n` }, 'has a function marked "use server" inside it');
  });
  it("passes when the action is written with its guard", () => {
    passes({ "src/app/[locale]/y/actions.ts": `"use server";\nimport { guardedAction } from "@/lib/roles";\nexport const save = guardedAction(["manager"], async () => {});\n` });
  });
});

describe("found by the review of the first version, and kept fixed", () => {
  it('an action file whose opening directives put "use strict" before "use server"', () => {
    fails({ "src/app/[locale]/x/actions.ts": `"use strict";\n"use server";\nexport async function wipe() {}\n` }, 'src/app/[locale]/x/actions.ts exports "wipe" without a guard');
    fails(
      { "src/components/F.tsx": `export function F() {\n  async function wipe() {\n    "use strict";\n    "use server";\n  }\n  return <form action={wipe} />;\n}\n` },
      'src/components/F.tsx has a function marked "use server" inside it',
    );
  });
  it("an action file outside src/", () => {
    fails({ "server-outside/actions.ts": `"use server";\nexport async function wipe() {}\n` }, 'server-outside/actions.ts exports "wipe" without a guard');
  });
  it('an action or a route exported with "let", which could be replaced afterwards', () => {
    fails(
      { "src/app/[locale]/x/actions.ts": `"use server";\nimport { guardedAction } from "@/lib/roles";\nexport let wipe = guardedAction(["hr_admin"], async () => {});\nwipe = async () => {};\n` },
      'src/app/[locale]/x/actions.ts exports "wipe" with "let"',
    );
    fails(
      { "src/app/api/x/route.ts": `import { guardedRoute } from "@/lib/roles";\nexport let GET = guardedRoute(["hr_admin"], () => Response.json({}));\nGET = async () => Response.json({ open: true });\n` },
      'src/app/api/x/route.ts exports "GET" with "let"',
    );
  });
  it("a page file that exports anything beside its page, such as generateMetadata or metadata", () => {
    const page = `import { guardedPage } from "@/lib/roles";\nexport default guardedPage(["hr_admin"], async () => null);\n`;
    fails({ "src/app/[locale]/x/page.tsx": `${page}export async function generateMetadata() { return { title: "secret" }; }\n` }, 'src/app/[locale]/x/page.tsx exports "generateMetadata" beside its page');
    fails({ "src/app/[locale]/y/page.tsx": `${page}export const metadata = { title: "secret" };\n` }, 'src/app/[locale]/y/page.tsx exports "metadata" beside its page');
    fails({ "src/app/[locale]/z/page.tsx": `${page}export const dynamic = load();\n` }, 'src/app/[locale]/z/page.tsx exports "dynamic" beside its page');
    passes({ "src/app/[locale]/ok/page.tsx": `${page}export const dynamic = "force-dynamic";\nexport const revalidate = 0;\n` });
  });
  it("a route file that exports something other than its methods and plain settings", () => {
    fails({ "src/app/api/x/route.ts": `import { guardedRoute } from "@/lib/roles";\nexport const GET = guardedRoute(["manager"], () => Response.json({}));\nexport const generateStaticParams = async () => [];\n` }, 'src/app/api/x/route.ts exports "generateStaticParams"');
  });
  it("a top-level app/ folder, which Next.js would serve in place of src/app", () => {
    fails({ "app/open/page.tsx": `export default function Open() { return null; }\n` }, "app/ exists");
  });
  it("special files that answer with data by themselves", () => {
    fails({ "src/app/manifest.ts": `export default function manifest() { return { name: "x" }; }\n` }, "src/app/manifest.ts is a special file that answers with data by itself");
    fails({ "src/app/sitemap.ts": `export default function sitemap() { return []; }\n` }, "src/app/sitemap.ts is a special file");
  });
  it('a change to where "@/" points, a build script that is not exactly the check then the build, and the Next.js settings', () => {
    const realConfig = readFileSync(path.join(templateDir, "next.config.ts"), "utf8");
    const pkg = (build: string) => JSON.stringify({ scripts: { build } });
    fails({ "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/lib/roles": ["./src/lib/fake"], "@/*": ["./src/*"] } } }) }, 'tsconfig.json does not map "@/" to src/ and only that');
    fails({ "tsconfig.json": JSON.stringify({ extends: "./other.json", compilerOptions: { paths: { "@/*": ["./src/*"] } } }) }, 'tsconfig.json does not map "@/" to src/ and only that');
    fails({ "jsconfig.json": "{}" }, "jsconfig.json exists");
    for (const build of ["next build", "tsx scripts/check-guards.ts && next build || next build", "tsx scripts/check-guards.ts; next build"]) {
      fails({ "package.json": pkg(build), "next.config.ts": realConfig }, "build script is not exactly");
    }
    passes({ "package.json": pkg("tsx scripts/check-guards.ts && next build"), "next.config.ts": realConfig, "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }) });
    // Found by the second review: pageExtensions written as a shorthand property passed. Any change to the settings file is now refused.
    const changed = realConfig.replace("const nextConfig: NextConfig = {", 'const pageExtensions = ["tsx", "ts", "view.tsx"];\nconst nextConfig: NextConfig = {\n  pageExtensions,');
    fails({ "package.json": pkg("tsx scripts/check-guards.ts && next build"), "next.config.ts": changed }, "next.config.ts is missing or has changed");
    fails({ "package.json": pkg("tsx scripts/check-guards.ts && next build"), "next.config.ts": realConfig, "next.config.mts": "export default {};\n" }, "next.config.mts exists");
  });
  it("folders named .git or .next below the top, and node_modules below the top", () => {
    // Found by the second review: these were skipped wherever they were.
    fails({ "src/.git/act.ts": `"use server";\nexport async function wipe() {}\n` }, 'src/.git/act.ts exports "wipe" without a guard');
    fails({ "src/app/[locale]/.next/page.tsx": `export default function Open() { return null; }\n` }, "src/app/[locale]/.next/page.tsx is a page whose default export is not");
    fails({ "src/lib/node_modules/x/index.ts": `export const x = 1;\n` }, "src/lib/node_modules/ is a node_modules folder below the top");
  });
  it("special files with a number after their name", () => {
    fails({ "src/app/[locale]/og/opengraph-image2.tsx": `export default function Image() { return null; }\n` }, "opengraph-image2.tsx is a special file that answers with data by itself");
    fails({ "src/app/icon1.tsx": `export default function Icon() { return null; }\n` }, "src/app/icon1.tsx is a special file");
  });
  it('a page or route set to be built ahead of time ("force-static"), which would give everyone the same answer', () => {
    fails({ "src/app/[locale]/s/page.tsx": `import { guardedPage } from "@/lib/roles";\nexport default guardedPage(["hr_admin"], async () => null);\nexport const dynamic = "force-static";\n` }, 'exports "dynamic" beside its page');
  });
});

describe("a check that read nothing has not passed", () => {
  it("fails on a folder with no app in it", () => {
    const dir = path.join(tmp, "empty");
    mkdirSync(dir, { recursive: true });
    const r = run(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /src\/app was not found/);
  });
});
