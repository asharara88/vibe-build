/**
 * The role guard, tried by each kind of user against a running template (package 0.3).
 * It runs only inside the project's acceptance runner container, on the project's `front` network, never on
 * the machine (package 0.6c): scripts/browser-in-project.ts starts it there with
 * <baseUrl> <outDir> <samplePasswordFile>, the base address being http://app:<port>.
 *
 * Five kinds of visitor: the three sample roles; a person who has just signed up and so has no
 * role this app recognises; and nobody (not signed in). Each tries the example page for HR
 * admins, the example form action for managers and HR admins (through the page's button where
 * they can see it, and by sending the form directly where they cannot), and the example data
 * route. Every line is a check with what was expected and what was seen; the exit code is 1 if
 * any check failed.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

const [baseUrl, outDir, passwordFile] = process.argv.slice(2);
if (!baseUrl || !outDir || !passwordFile) {
  console.error("usage: guard-checks.ts <baseUrl> <outDir> <samplePasswordFile>");
  process.exit(1);
}
const password = readFileSync(passwordFile, "utf8").trim();
mkdirSync(outDir, { recursive: true });

let failed = 0;
const check = (what: string, expected: string, seen: string) => {
  const ok = expected === seen;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}: expected ${expected}; saw ${seen}`);
};

const browser = await chromium.launch();
const shot = (page: Page, name: string) => page.screenshot({ path: join(outDir, name), fullPage: true });

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The sign-in library allows only a few sign-in attempts in any ten seconds, so the sign-ins are
// spaced out, and one that is turned away for that reason is tried again after a wait.
async function signedIn(email: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (let attempt = 1; ; attempt++) {
    await pause(4_000);
    await page.goto(`${baseUrl}/en/sign-in`, { waitUntil: "networkidle" });
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.getByRole("button", { name: "Sign in" }).click();
    try {
      await page.waitForURL(/\/en\/home/, { timeout: 10_000 });
      return { ctx, page };
    } catch (err) {
      if (attempt >= 4) throw err;
      await pause(11_000);
    }
  }
}

/** What a visitor sees at an address: the page's own marker, the "no access" page with its reason, or the sign-in page. */
async function sees(page: Page, path: string): Promise<string> {
  await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
  if (/\/sign-in$/.test(new URL(page.url()).pathname)) return "the sign-in page";
  const refused = page.getByTestId("no-access");
  if ((await refused.count()) > 0) return `the "no access" page (${await refused.getAttribute("data-reason")})`;
  for (const id of ["example-restricted", "example-action", "signed-in-as"]) if ((await page.getByTestId(id).count()) > 0) return `the page (${id})`;
  return `something else at ${page.url()}`;
}

try {
  const employee = await signedIn("employee@example.test");
  const manager = await signedIn("manager@example.test");
  const hrAdmin = await signedIn("hr.admin@example.test");

  // A person who signs up gets an account with no role this app recognises.
  const noRoleCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const signUp = await noRoleCtx.request.post(`${baseUrl}/api/auth/sign-up/email`, {
    headers: { origin: baseUrl, "content-type": "application/json" },
    data: { name: "Sample Newcomer", email: `newcomer.${Date.now()}@example.test`, password },
  });
  console.log(`(a new account was made through the sign-up route for the "no role" visitor: HTTP ${signUp.status()})`);
  const noRole = { ctx: noRoleCtx, page: await noRoleCtx.newPage() };
  const nobodyCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const nobody = { ctx: nobodyCtx, page: await nobodyCtx.newPage() };

  const visitors = [
    ["employee", employee],
    ["manager", manager],
    ["HR admin", hrAdmin],
    ["no recognised role", noRole],
    ["not signed in", nobody],
  ] as const;

  console.log("\n1. The example page for HR admins only (/en/example/restricted)");
  const pageExpected: Record<string, string> = {
    employee: 'the "no access" page (role_not_allowed)',
    manager: 'the "no access" page (role_not_allowed)',
    "HR admin": "the page (example-restricted)",
    "no recognised role": 'the "no access" page (role_not_recognised)',
    "not signed in": "the sign-in page",
  };
  for (const [name, v] of visitors) check(`page, ${name}`, pageExpected[name]!, await sees(v.page, "/en/example/restricted"));
  await sees(employee.page, "/en/example/restricted");
  await shot(employee.page, "01-no-access-employee-en.png");
  await sees(employee.page, "/ar/example/restricted");
  check("page in Arabic, employee: direction of the page", "rtl", (await employee.page.getAttribute("html", "dir")) ?? "");
  await shot(employee.page, "02-no-access-employee-ar.png");
  await sees(hrAdmin.page, "/en/example/restricted");
  await shot(hrAdmin.page, "03-restricted-page-hr-admin-en.png");

  console.log("\n2. The home page, open to every recognised role (/en/home)");
  const homeExpected: Record<string, string> = {
    employee: "the page (signed-in-as)",
    manager: "the page (signed-in-as)",
    "HR admin": "the page (signed-in-as)",
    "no recognised role": 'the "no access" page (role_not_recognised)',
    "not signed in": "the sign-in page",
  };
  for (const [name, v] of visitors) check(`home, ${name}`, homeExpected[name]!, await sees(v.page, "/en/home"));
  await sees(noRole.page, "/en/home");
  await shot(noRole.page, "04-no-role-home-en.png");

  console.log("\n3. The example data route for managers and HR admins (/api/example/roles)");
  const routeExpected: Record<string, string> = {
    employee: "403 no_access",
    manager: '200 {"role":"manager"}',
    "HR admin": '200 {"role":"hr_admin"}',
    "no recognised role": "403 no_access",
    "not signed in": "401 not_signed_in",
  };
  for (const [name, v] of visitors) {
    const res = await v.ctx.request.get(`${baseUrl}/api/example/roles`);
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    check(`route, ${name}`, routeExpected[name]!, `${res.status()} ${res.ok() ? JSON.stringify(body) : (body.error ?? "?")}`);
  }

  console.log("\n4. The example form action for managers and HR admins, through the page's button (/en/example/action)");
  for (const [name, v, expected] of [
    ["employee", employee, "sent to /en/no-access"],
    ["manager", manager, "done, for the role Manager"],
    ["HR admin", hrAdmin, "done, for the role HR admin"],
  ] as const) {
    await v.page.goto(`${baseUrl}/en/example/action`, { waitUntil: "networkidle" });
    const problems: string[] = [];
    v.page.on("console", (m) => m.type() === "error" && problems.push(m.text().slice(0, 200)));
    v.page.on("pageerror", (e) => problems.push(e.message.slice(0, 200)));
    await v.page.getByRole("button", { name: "Run the example action" }).click();
    // The page moves on by itself: to the "done" message, or to the "no access" page.
    await Promise.race([v.page.getByTestId("example-action-done").waitFor({ timeout: 15_000 }), v.page.getByTestId("no-access").waitFor({ timeout: 15_000 })]).catch(() => undefined);
    if (problems.length) console.log(`      (browser messages: ${problems.join(" | ")})`);
    const done = v.page.getByTestId("example-action-done");
    const where = new URL(v.page.url()).pathname;
    const seen = (await done.count()) > 0 ? `done, for the role ${((await done.textContent()) ?? "").match(/role (.+?)\./)?.[1] ?? "?"}` : `sent to ${where}`;
    check(`action by button, ${name}`, expected, seen);
    if (name === "employee") await shot(v.page, "05-action-refused-employee-en.png");
    if (name === "manager") await shot(v.page, "06-action-done-manager-en.png");
  }

  console.log("\n4b. The same, from the Arabic page: a refused employee lands on the Arabic \"no access\" page");
  {
    await employee.page.goto(`${baseUrl}/ar/example/action`, { waitUntil: "networkidle" });
    await employee.page.locator("form button[type=submit]").click();
    await employee.page.getByTestId("no-access").waitFor({ timeout: 15_000 }).catch(() => undefined);
    check("action by button from the Arabic page, employee", "/ar/no-access", new URL(employee.page.url()).pathname);
    await shot(employee.page, "08-action-refused-employee-ar.png");
  }

  console.log("\n5. The same form action, sent directly as the form would send it, by each visitor");
  // The form's hidden fields are read from the page as the manager sees it; the others then send them as their own.
  await manager.page.goto(`${baseUrl}/en/example/action`, { waitUntil: "networkidle" });
  const fields = await manager.page.locator("form input[type=hidden]").evaluateAll((els) => els.map((e) => [(e as HTMLInputElement).name, (e as HTMLInputElement).value] as [string, string]));
  console.log(`(hidden fields of the form: ${fields.length})`);
  const directExpected: Record<string, string> = {
    employee: "303 to /en/no-access",
    manager: "303 to /en/example/action?done=manager",
    "HR admin": "303 to /en/example/action?done=hr_admin",
    "no recognised role": "303 to /en/no-access",
    "not signed in": "303 to /en/sign-in",
  };
  for (const [name, v] of visitors) {
    const res = await v.ctx.request.post(`${baseUrl}/en/example/action`, {
      multipart: Object.fromEntries(fields),
      maxRedirects: 0,
      headers: { origin: baseUrl },
    });
    const to = res.headers()["location"] ?? res.headers()["x-action-redirect"] ?? "(no redirect)";
    check(`action sent directly, ${name}`, directExpected[name]!, `${res.status()} to ${to.replace(baseUrl, "").replace(/;.*$/, "")}`);
  }

  // The "no access" page at a phone's width, in Arabic.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, storageState: await employee.ctx.storageState() });
  const p = await phone.newPage();
  await p.goto(`${baseUrl}/ar/example/restricted`, { waitUntil: "networkidle" });
  const scrollWidth = await p.evaluate(() => document.documentElement.scrollWidth);
  check('"no access" page at phone width 390, Arabic: no sideways scrolling', "true", String(scrollWidth <= 390));
  await p.screenshot({ path: join(outDir, "07-no-access-ar-phone.png"), fullPage: true });
} catch (err) {
  failed++;
  console.log(`FAIL  the run stopped: ${(err as Error).message}`);
} finally {
  await browser.close();
}
console.log(`\n${failed === 0 ? "RESULT: PASSED" : `RESULT: FAILED (${failed})`}`);
process.exit(failed === 0 ? 0 : 1);
