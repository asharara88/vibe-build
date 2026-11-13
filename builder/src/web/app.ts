/**
 * The builder's own web interface (package J1): routes, the sign-in guard, csrf, secure headers and the
 * content-security-policy. Pages call only the orchestrator (`Journey`); only it changes a project's state.
 *
 * - One guard in front of every route: a visitor who is not signed in gets only the sign-in page (and, before
 *   a password is chosen on the first run, only "Choose your password"). The only routes open without a
 *   session are the sign-in and first-run pages, the language switch and the stylesheet.
 * - No GET changes anything. Every change is a POST of a form (any other body, or method, is refused with 415),
 *   checked by hono's `csrf()` (the request's Origin, or Sec-Fetch-Site, must be this site).
 * - `secureHeaders()` on every response, with a content-security-policy that allows no script at all, styles
 *   and images from this site only, and forms posted only to it; every page is `no-store`.
 * - Once the interface has lost its instance lock (`unavailable`, review bot on defb9c4), every request gets a plain 503.
 * - Package J3: every value of the sign-in cookie is read, and any valid one accepted (a page on another port of the
 *   same host, such as the live app's, can add a cookie of the same name). "Open the live app" and "Show" are POSTs,
 *   behind sign-in and csrf(); the pass and the sample password are on the page that answers the POST only, never on
 *   a GET page or in a record. Sign-out ends the live session bound to it, and cancels an open it asked for that is
 *   not made yet; the open is made only if its sign-in session is still valid then (after the review bot on af80dc9).
 */
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { frozenMessage, listFreezes } from "../store/freezes.js";
import { getBudget, listStepHolds } from "../store/holds.js";
import { listUnreconciled } from "../store/reconcile.js";
import { PRICE_TABLE_DATE } from "../gateway/prices.js";
import type { Answer } from "../orchestrator/intake.js";
import { Journey, JourneyRefused } from "../orchestrator/journey.js";
import { PRICED_MODEL, type JourneyJobs } from "../orchestrator/journey-jobs.js";
import { passwordProblem, SESSION_COOKIE, type PasswordState, type Sessions, type SignInLimiter } from "./auth.js";
import { recordedFile } from "./files.js";
import type { LivePreview } from "./preview.js";
import { cookieValues } from "./preview-rules.ts";
import {
  acceptancePage,
  briefPage,
  buildPage,
  costPage,
  errorPage,
  exportPage,
  isJourneyId,
  livePassPage,
  liveSamplePage,
  LANGS,
  newProjectPage,
  notFoundPage,
  planPage,
  previewPage,
  projectsPage,
  proposalPage,
  questionsPage,
  recordPage,
  setupPage,
  signInPage,
  STYLESHEET,
  type Lang,
} from "./pages.js";

export const LANG_COOKIE = "builder_lang";
export { PRICED_MODEL };

export interface WebDeps {
  journey: Journey;
  /** The build, preview, acceptance and export jobs. Without it, those actions are refused (the tests of the pages alone). */
  jobs?: JourneyJobs;
  password: PasswordState;
  sessions: Sessions;
  limiter: SignInLimiter;
  /** The data folder, resolved: files are served only from inside it. */
  dataDir: string;
  onFault?: (message: string, detail: unknown) => void;
  /**
   * Why the interface serves nothing now, or null (review bot on defb9c4: main.ts gives the instance lock's loss).
   * While it gives a reason, every request, open or behind the guard, is answered with that reason, plain, and 503.
   */
  unavailable?: () => string | null;
  /** Package J3: the live preview, whose session bound to a sign-in ends with its sign-out. */
  preview?: LivePreview;
}

type Env = { Variables: { lang: Lang; signedIn: boolean; session: string | null } };

/** The first valid sign-in session among every value of the cookie (package J3), or null. */
function sessionFrom(c: Context<Env>, sessions: Sessions): string | null {
  for (const v of cookieValues(c.req.header("cookie") ?? "", SESSION_COOKIE)) if (sessions.valid(v)) return v;
  return null;
}

/** Paths a visitor with no session may reach. Everything else is behind the guard. */
export const PUBLIC_PATHS = new Set(["/sign-in", "/setup", "/language", "/static/app.css"]);

export const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'none'"],
  scriptSrc: ["'none'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'"],
  formAction: ["'self'"],
  baseUri: ["'none'"],
  frameAncestors: ["'self'"],
};

const cookieOpts = { httpOnly: true, sameSite: "Strict" as const, path: "/" };

/** The content types of a form a browser posts: the only bodies the interface accepts. */
export const FORM_CONTENT_TYPE = /^(application\/x-www-form-urlencoded|multipart\/form-data)\s*(;|$)/i;

export function createWebApp(d: WebDeps): Hono<Env> {
  const app = new Hono<Env>();
  const j = d.journey;

  app.use("*", secureHeaders({ contentSecurityPolicy: CONTENT_SECURITY_POLICY }));
  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
  // After the review bot on defb9c4: an interface that has lost its instance lock accepts nothing more.
  app.use("*", async (c, next) => {
    const why = d.unavailable?.() ?? null;
    if (why !== null) return c.text(why, 503);
    await next();
  });
  app.use("*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.text("Too large.", 413) }));
  // Every request but a GET or HEAD must be a form, so that csrf() below judges it: csrf() looks only at form
  // content types, and a JSON body with no Origin would pass it (review of 13 Nov 2026, note 1).
  app.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && !FORM_CONTENT_TYPE.test(c.req.header("content-type") ?? "")) return c.text("Only a form from this site is accepted.", 415);
    await next();
  });
  app.use("*", csrf());

  // The page's language: ?lang= when given, else the cookie, else English.
  app.use("*", async (c, next) => {
    const q = c.req.query("lang");
    const ck = getCookie(c, LANG_COOKIE);
    c.set("lang", (LANGS as string[]).includes(q ?? "") ? (q as Lang) : (LANGS as string[]).includes(ck ?? "") ? (ck as Lang) : "en");
    const session = sessionFrom(c, d.sessions);
    c.set("session", session);
    c.set("signedIn", session !== null);
    await next();
  });

  // The guard, in front of every route.
  app.use("*", async (c, next) => {
    const path = c.req.path;
    if (!d.password.isSet) {
      if (path === "/setup" || path === "/language" || path === "/static/app.css") return next();
      return c.redirect("/setup", 303);
    }
    if (PUBLIC_PATHS.has(path)) return next();
    if (c.get("signedIn")) return next();
    return c.redirect("/sign-in", 303);
  });

  app.onError((err, c) => {
    const lang = c.get("lang") ?? "en";
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof JourneyRefused) return c.html(errorPage(lang, { message: err.message, back: backFrom(c), signedIn: true }), 409);
    d.onFault?.("A request to the interface failed.", { path: c.req.path, error: err instanceof Error ? err.message : String(err) });
    return c.html(errorPage(lang, { message: "Something went wrong. The project's record shows what was written.", back: "/projects", signedIn: c.get("signedIn") ?? false }), 500);
  });
  app.notFound((c) => c.html(notFoundPage(c.get("lang") ?? "en", c.get("signedIn") ?? false), 404));

  /* ---------------------------------------------------------------- open without a session */

  app.get("/static/app.css", (c) => c.body(STYLESHEET, 200, { "Content-Type": "text/css; charset=utf-8" }));

  app.post("/language", async (c) => {
    const body = await c.req.parseBody();
    const lang = typeof body.lang === "string" && (LANGS as string[]).includes(body.lang) ? body.lang : "en";
    setCookie(c, LANG_COOKIE, lang, { ...cookieOpts, maxAge: 60 * 60 * 24 * 365 });
    return c.redirect(localPath(body.back), 303);
  });

  app.get("/sign-in", (c) => {
    if (c.get("signedIn")) return c.redirect("/projects", 303);
    const m = c.req.query("m");
    return c.html(signInPage(c.get("lang"), { message: m === "signed_out" || m === "setup_done" ? m : undefined }));
  });

  app.post("/sign-in", async (c) => {
    const lang = c.get("lang");
    const body = await c.req.parseBody();
    const password = typeof body.password === "string" ? body.password : "";
    // The lock-out is read only now, once the body has arrived, with no await between it, the check and
    // `fail()` (the check is synchronous: scryptSync). Read before the body, every attempt sent at the same
    // moment would pass it before the first was judged (review of 13 Nov 2026, blocking item 1).
    const locked = d.limiter.lockedFor();
    if (locked > 0) return c.html(signInPage(lang, { message: "locked", lockedSeconds: Math.ceil(locked / 1000) }), 429);
    if (!d.password.check(password)) {
      d.limiter.fail();
      const now = d.limiter.lockedFor();
      return c.html(now > 0 ? signInPage(lang, { message: "locked", lockedSeconds: Math.ceil(now / 1000) }) : signInPage(lang, { message: "wrong" }), now > 0 ? 429 : 401);
    }
    d.limiter.succeed();
    // After J3's review: a live session opened from a sign-in session this one replaces ends with it.
    for (const v of cookieValues(c.req.header("cookie") ?? "", SESSION_COOKIE)) {
      await d.preview?.signedOut(v, "signed_in_again");
      d.sessions.end(v);
    }
    setCookie(c, SESSION_COOKIE, d.sessions.create(), cookieOpts);
    return c.redirect("/projects", 303);
  });

  app.get("/setup", (c) => {
    if (d.password.isSet) return c.redirect("/sign-in", 303);
    return c.html(setupPage(c.get("lang")));
  });

  app.post("/setup", async (c) => {
    const lang = c.get("lang");
    if (d.password.isSet) return c.html(setupPage(lang, { message: "already" }), 409);
    const body = await c.req.parseBody();
    const password = typeof body.password === "string" ? body.password : "";
    const again = typeof body.again === "string" ? body.again : "";
    if (password !== again) return c.html(setupPage(lang, { message: "mismatch" }), 400);
    if (passwordProblem(password)) return c.html(setupPage(lang, { message: "too_short" }), 400);
    if (!d.password.choose(password)) return c.html(setupPage(lang, { message: "already" }), 409);
    return c.redirect("/sign-in?m=setup_done", 303);
  });

  /* ---------------------------------------------------------------- behind the guard */

  app.post("/sign-out", async (c) => {
    // Package J3: the live session opened from this sign-in ends with it.
    await d.preview?.signedOut(c.get("session") ?? undefined);
    for (const v of cookieValues(c.req.header("cookie") ?? "", SESSION_COOKIE)) d.sessions.end(v);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.redirect("/sign-in?m=signed_out", 303);
  });

  app.get("/", (c) => c.redirect("/projects", 303));

  app.get("/projects", async (c) => c.html(projectsPage(c.get("lang"), await j.list(), await j.otherProjectCount())));

  app.get("/projects/new", (c) => c.html(newProjectPage(c.get("lang"))));

  app.post("/projects", async (c) => {
    const body = await c.req.parseBody();
    const input = { name: str(body.name), cap: str(body.cap), brief: str(body.brief) };
    try {
      const id = await j.createProject(input);
      return c.redirect(`/projects/${id}/brief`, 303);
    } catch (err) {
      if (err instanceof JourneyRefused) return c.html(newProjectPage(c.get("lang"), { error: err.message, ...input }), 400);
      throw err;
    }
  });

  // One project. Its id must be one the journey made; anything else is "not found".
  app.use("/projects/:id/*", async (c, next) => {
    if (!isJourneyId(c.req.param("id") ?? "")) return c.html(notFoundPage(c.get("lang"), true), 404);
    return next();
  });
  app.use("/projects/:id", async (c, next) => {
    const id = c.req.param("id") ?? "";
    if (id !== "new" && !isJourneyId(id)) return c.html(notFoundPage(c.get("lang"), true), 404);
    return next();
  });

  app.get("/projects/:id", async (c) => {
    const s = await j.state(c.req.param("id"));
    const screen = { brief: "brief", questions: "questions", brief_review: "proposal", plan_review: "plan", build: "build", preview: "preview", acceptance: "acceptance", signed_off: "export", stopped: "brief", closed: "record" }[s.stage];
    return c.redirect(`/projects/${s.project.id}/${screen}`, 303);
  });
  app.get("/projects/:id/brief", async (c) => c.html(briefPage(c.get("lang"), await j.state(c.req.param("id")), j)));
  app.get("/projects/:id/questions", async (c) => c.html(questionsPage(c.get("lang"), await j.state(c.req.param("id")), j)));
  app.get("/projects/:id/proposal", async (c) => c.html(proposalPage(c.get("lang"), await j.state(c.req.param("id")), j)));
  app.get("/projects/:id/plan", async (c) => c.html(planPage(c.get("lang"), await j.state(c.req.param("id")), j)));
  app.get("/projects/:id/build", async (c) => c.html(buildPage(c.get("lang"), await j.state(c.req.param("id")), j)));
  app.get("/projects/:id/preview", async (c) => {
    const s = await j.state(c.req.param("id"));
    const port = d.jobs?.livePort() ?? null;
    return c.html(previewPage(c.get("lang"), s, port === null ? null : { port, session: d.jobs?.liveStatus(s.project.id) ?? null }));
  });
  app.get("/projects/:id/acceptance", async (c) => c.html(acceptancePage(c.get("lang"), await j.state(c.req.param("id")), j)));
  app.get("/projects/:id/export", async (c) => c.html(exportPage(c.get("lang"), await j.state(c.req.param("id")))));
  app.get("/projects/:id/record", async (c) => c.html(recordPage(c.get("lang"), await j.state(c.req.param("id")))));
  app.get("/projects/:id/cost", async (c) => {
    const s = await j.state(c.req.param("id"));
    const id = s.project.id;
    // Every freeze not cleared (a project can carry more than one, of different kinds: packages 1.4, 1.4b, 1.4c).
    const freezes = (await listFreezes(j.pool, id)).filter((f) => f.cleared_at === null);
    return c.html(
      costPage(c.get("lang"), s, {
        budget: await getBudget(j.pool, id),
        stepHolds: await listStepHolds(j.pool, id),
        freezes: freezes.map((f) => ({ freeze: f, message: frozenMessage(f, "step") })),
        unreconciled: await listUnreconciled(j.pool, { projectId: id }),
        modelCalls: s.events.filter((e) => e.kind === "model.call").length,
        pricedModel: PRICED_MODEL,
        priceTableDate: PRICE_TABLE_DATE,
      }),
    );
  });
  app.get("/projects/:id/files/:eventId", async (c) => {
    const f = await recordedFile(j.pool, d.dataDir, c.req.param("id"), c.req.param("eventId"));
    if (!f.ok) return c.html(notFoundPage(c.get("lang"), true), 404);
    const headers: Record<string, string> = { "Content-Type": f.media, "X-Content-Type-Options": "nosniff" };
    if (f.media !== "image/png") headers["Content-Disposition"] = `attachment; filename="${f.name.replace(/[^A-Za-z0-9._-]/g, "_")}"`;
    return c.body(new Uint8Array(f.body), 200, headers);
  });

  const act = (path: string, fn: (id: string, body: Record<string, string | File | (string | File)[]>) => Promise<string>) =>
    app.post(`/projects/:id/${path}`, async (c) => {
      const id = c.req.param("id");
      const body = await c.req.parseBody({ all: true });
      return c.redirect(await fn(id, body), 303);
    });

  act("continue", async (id) => (await j.continueWithExample(id), `/projects/${id}/questions`));
  act("stop", async (id) => (await j.stop(id), `/projects/${id}/brief`));
  act("answers", async (id, body) => {
    const turn = Number(str(body.turn));
    if (!Number.isInteger(turn) || turn < 0 || turn >= j.intake.turns.length) throw new JourneyRefused("That turn is not one of the questions'.");
    const answers: Record<string, Answer> = {};
    for (const qid of j.intake.turns[turn]!) {
      const a = answerFromForm(j, qid, body);
      if (a) answers[qid] = a;
    }
    await j.answerTurn(id, turn, answers);
    return `/projects/${id}/questions`;
  });
  act("answer-rest", async (id) => (await j.answerRestFromSheet(id), `/projects/${id}/questions`));
  act("confirm-brief", async (id) => (await j.confirmBrief(id), `/projects/${id}/plan`));
  act("confirm-plan", async (id) => (await j.confirmPlan(id), `/projects/${id}/plan`));
  act("close", async (id) => (await j.closeProject(id), `/projects/${id}/record`));

  // The jobs (part 2). Each POST starts a job and goes to its screen, which refreshes itself while the job runs.
  const jobs = (): JourneyJobs => {
    if (!d.jobs) throw new JourneyRefused("This interface was started without builds.");
    return d.jobs;
  };
  const stepOf = (body: Record<string, string | File | (string | File)[]>): string => {
    const step = str(body.step);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(step)) throw new JourneyRefused("That step is not one of the plan's.");
    return step;
  };
  act("build", async (id, body) => (await jobs().buildStep(id, stepOf(body)), `/projects/${id}/build`));
  act("approve", async (id, body) => {
    const r = await jobs().approve(id, stepOf(body));
    return `/projects/${id}/${r.next === "preview" ? "preview" : "build"}`;
  });
  act("preview", async (id) => (await jobs().preview(id), `/projects/${id}/preview`));
  act("acceptance", async (id) => (await jobs().acceptance(id), `/projects/${id}/acceptance`));
  act("sign-off", async (id) => (await j.signOff(id), `/projects/${id}/acceptance`));
  act("export", async (id) => (await jobs().exportProject(id), `/projects/${id}/export`));

  // Package J3: the live app. Each answers the POST with its page (the pass, the sample sign-in); nothing of either is
  // on a GET page or in a record.
  app.post("/projects/:id/live", async (c) => {
    const id = c.req.param("id");
    await c.req.parseBody();
    const session = c.get("session");
    if (!session) return c.redirect("/sign-in", 303);
    // After J3's review: the live session ends no later than this sign-in session expires. After the review bot on
    // af80dc9: it is opened only if this sign-in session is still valid then (its sign-out also cancels the open).
    const r = await jobs().openLive(id, session, d.sessions.expiresAt(session), () => d.sessions.valid(session));
    const s = await j.state(id);
    return c.html(livePassPage(c.get("lang"), s, { shown: r.shown, expiresAt: r.expiresAt, port: jobs().livePort() ?? 0 }));
  });
  app.post("/projects/:id/live/show", async (c) => {
    const id = c.req.param("id");
    await c.req.parseBody();
    const sample = jobs().sampleSignIn(id);
    return c.html(liveSamplePage(c.get("lang"), await j.state(id), sample));
  });
  act("live/end", async (id) => (await jobs().endLive(id), `/projects/${id}/preview`));

  return app;
}

/** The answer a turn's form gives for one question, or undefined when it gives none. */
export function answerFromForm(j: Journey, qid: string, body: Record<string, string | File | (string | File)[]>): Answer | undefined {
  const q = j.question(qid);
  const one = (k: string): string | undefined => {
    const v = body[k];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" ? s : undefined;
  };
  if (q.kind === "choice") {
    const v = one(`a_${qid}`);
    if (v === undefined) return undefined;
    if (v === "else") return { something_else: one(`else_${qid}`) ?? "" };
    return /^\d{1,2}$/.test(v) ? { option: Number(v) } : { option: -1 };
  }
  if (q.kind === "checklist") {
    const raw = body[`f_${qid}`];
    const fields = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter((x): x is string => typeof x === "string");
    const other = one(`else_${qid}`)?.trim();
    if (fields.length === 0 && !other) return undefined;
    return other ? { fields, something_else: other } : { fields };
  }
  const v = one(`t_${qid}`);
  return v === undefined ? undefined : { open_text: v };
}

const str = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : "");

/** A path on this site to go back to: a plain absolute path, never another site. */
export function localPath(v: unknown): string {
  const s = typeof v === "string" ? v : "";
  return /^\/(?!\/)[A-Za-z0-9/_-]{0,200}$/.test(s) ? s : "/projects";
}

function backFrom(c: Context<Env>): string {
  const m = /^\/projects\/(j1-[0-9a-f]{12})\//.exec(c.req.path);
  return m ? `/projects/${m[1]}` : "/projects";
}

