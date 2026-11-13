/**
 * The acceptance runner's image (package 3.1): built on the builder's machine from builder/runner/,
 * kept there, never pushed to a registry or given to anyone (the owner's approval of 13 Nov 2026 is
 * for the builder's internal development and testing only; docs/DECISIONS.md, question 15 (a)).
 *
 * The browser is not downloaded by the build. It is read from a folder named by the setting
 * BUILDER_BROWSER_CACHE, which must hold chrome-headless-shell-linux64.zip with exactly the approved
 * SHA-256; the build stops before anything else if it does not. The zip is checked again inside the
 * build. Its original address is in docs/SOURCES.md (13 Nov 2026).
 *
 * After every build, cached or not, the image's whole package list is read from a container of it
 * (no network) and compared with the base image's list plus the approved packages; the list is
 * returned so that the evidence shows it, and any difference is a failure.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const RUNNER_DIR = resolve(import.meta.dirname, "..", "..", "runner");
/** The image's local name. It names no registry: it is never pushed. */
export const RUNNER_IMAGE = "builder-acceptance-runner:local";
export const BROWSER_ZIP = "chrome-headless-shell-linux64.zip";
/** Chrome for Testing 153.0.8010.12, chrome-headless-shell-linux64.zip (docs/licences/runtime-inventory.md, section 3). */
export const BROWSER_ZIP_SHA256 = "a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d";
export const BROWSER_VERSION = "153.0.8010.12";
/** The two base images, each at the digest the owner approved (question 15 (a)). */
export const RUNNER_BASE_IMAGES = {
  ubuntu: "ubuntu:24.04@sha256:2198e4c65076e9cb0b3d695219df667c0e3b0072da64ca3c2648aca17dcecaf5",
  node: "node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee",
} as const;
/** The runner's user inside its image (useradd -u 1001 in the Dockerfile). */
export const RUNNER_UID = 1001;

export function sha256File(path: string): Promise<string> {
  return new Promise((ok, fail) => {
    const h = createHash("sha256");
    createReadStream(path)
      .on("data", (d) => h.update(d))
      .on("error", fail)
      .on("end", () => ok(h.digest("hex")));
  });
}

/** The approved package lists, one "name=version" per line. */
export function approvedPackages(which: "runner" | "unpack"): string[] {
  return readFileSync(join(RUNNER_DIR, `approved-${which}-packages.txt`), "utf8").split("\n").filter(Boolean).sort();
}

/**
 * The browser zip in the cache, checked: a plain file (not a link), with the approved SHA-256.
 * Throws, naming the setting or the fingerprint found, otherwise.
 */
export async function checkedBrowserZip(cacheDir = process.env.BUILDER_BROWSER_CACHE): Promise<{ path: string; sha256: string; bytes: number }> {
  if (!cacheDir) throw new Error("BUILDER_BROWSER_CACHE is not set: it must name the folder that holds the approved browser zip (docs/SOURCES.md, 13 Nov 2026).");
  const path = join(resolve(cacheDir), BROWSER_ZIP);
  const st = lstatSync(path, { throwIfNoEntry: false });
  if (!st) throw new Error(`The browser cache has no ${BROWSER_ZIP} (${path}).`);
  if (!st.isFile()) throw new Error(`${path} is not a plain file (a link or a folder is not accepted).`);
  const sha256 = await sha256File(path);
  if (sha256 !== BROWSER_ZIP_SHA256) throw new Error(`${path} has SHA-256 ${sha256}, not the approved ${BROWSER_ZIP_SHA256}: the image is not built.`);
  return { path, sha256, bytes: st.size };
}

export interface RunnerImageBuild {
  image: string;
  imageId: string;
  zip: { path: string; sha256: string; bytes: number };
  /** The build's own output (BuildKit's plain progress). */
  buildLog: string;
  /** Every package in the finished image, "name=version", sorted. */
  packages: string[];
  /** The base image's own packages, read from a container of it, sorted. */
  basePackages: string[];
  /** Packages in the image that are not in the base image: must equal the approved runner list. */
  added: string[];
  /** Differences from base + approved; empty when the image is as approved. */
  problems: string[];
  /** Read from a container of the image: Node's and npm's versions, Node's licence notice, the browser's files. */
  facts: Record<string, string>;
}

/**
 * Build the runner image. `hostProxy` is given in the cloud session: the build then runs on the host's
 * network with the session's proxy as build arguments, and the certificate is put in the build folder's
 * certs/ (bind-mounted by the steps that download, never copied into a layer).
 */
export async function buildRunnerImage(opts: { hostProxy?: { url: string; caBundlePath: string }; env?: NodeJS.ProcessEnv; noCache?: boolean } = {}): Promise<RunnerImageBuild> {
  const zip = await checkedBrowserZip();
  const env = opts.env ?? { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/root", ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}) };
  const ctx = mkdtempSync(join(tmpdir(), "builder-runner-build-"));
  try {
    for (const f of ["Dockerfile", "package.json", "package-lock.json", "playwright.config.mjs", "apt-session.sh", "install-exactly.sh", "approved-runner-packages.txt", "approved-unpack-packages.txt"]) {
      copyFileSync(join(RUNNER_DIR, f), join(ctx, f));
    }
    mkdirSync(join(ctx, "browser"));
    copyFileSync(zip.path, join(ctx, "browser", BROWSER_ZIP));
    // Checked again after the copy: what the build reads is what was checked.
    if ((await sha256File(join(ctx, "browser", BROWSER_ZIP))) !== BROWSER_ZIP_SHA256) throw new Error("The browser zip changed while it was copied into the build folder.");
    mkdirSync(join(ctx, "certs"));
    if (opts.hostProxy) copyFileSync(opts.hostProxy.caBundlePath, join(ctx, "certs", "session-ca.crt"));
    const args = ["build", "--progress", "plain", "--tag", RUNNER_IMAGE, "--label", "builder.package=3.1", "--label", "builder.never-pushed=true"];
    if (opts.noCache) args.push("--no-cache");
    if (opts.hostProxy) {
      args.push("--network", "host");
      for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"]) args.push("--build-arg", `${k}=${opts.hostProxy.url}`);
    }
    args.push(ctx);
    let buildLog: string;
    try {
      const out = await run("docker", args, { env, timeout: 1_800_000, maxBuffer: 64 * 1024 * 1024 });
      buildLog = out.stdout + out.stderr;
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      throw new Error(`The runner image did not build: ${(e.stderr ?? "").slice(-4000) || e.message}`);
    }
    const imageId = (await run("docker", ["image", "inspect", RUNNER_IMAGE, "--format", "{{.Id}}"], { env })).stdout.trim();
    const list = async (image: string) =>
      (await run("docker", ["run", "--rm", "--network", "none", "--entrypoint", "dpkg-query", image, "-W", "-f=${Package}=${Version}\\n"], { env, maxBuffer: 8 * 1024 * 1024 })).stdout
        .split("\n")
        .filter(Boolean)
        .sort();
    const packages = await list(RUNNER_IMAGE);
    const basePackages = await list(RUNNER_BASE_IMAGES.ubuntu);
    const base = new Set(basePackages);
    const added = packages.filter((p) => !base.has(p));
    const approved = approvedPackages("runner");
    const problems: string[] = [];
    const inImage = new Set(packages);
    for (const p of added) if (!approved.includes(p)) problems.push(`in the image and not approved at this version: ${p}`);
    for (const p of approved) if (!inImage.has(p)) problems.push(`approved and not in the image at this version: ${p}`);
    for (const p of basePackages) if (!inImage.has(p)) problems.push(`in the base image and changed or gone: ${p}`);
    const sh = (cmd: string) => run("docker", ["run", "--rm", "--network", "none", "--entrypoint", "sh", RUNNER_IMAGE, "-c", cmd], { env }).then((o) => o.stdout.trim());
    const hs = "/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64";
    const facts: Record<string, string> = {
      "node --version": await sh("node --version"),
      "npm --version": await sh("npm --version"),
      "Node's licence notice (/usr/local/LICENSE), SHA-256": await sh("sha256sum /usr/local/LICENSE | cut -d' ' -f1"),
      "Playwright Test": await sh("node -e \"console.log(require('/runner/node_modules/@playwright/test/package.json').version)\""),
      "browser files, SHA-256": (await sh(`cd ${hs} && sha256sum chrome-headless-shell ABOUT LICENSE.headless_shell`)).replace(/\n/g, "; "),
      "browser folder, number of files": await sh(`find ${hs} -type f | wc -l`),
      "user": await sh("id -u; id -un").then((s) => s.replace(/\n/g, " ")),
      "proxy or certificate settings left in the image": await sh("env | grep -ci proxy; ls /etc/apt/apt.conf.d | grep -c session || true").then((s) => s.replace(/\n/g, " ")),
      "video tool (ffmpeg) installed": await sh("ls /ms-playwright | grep -c ffmpeg || true"),
    };
    return { image: RUNNER_IMAGE, imageId, zip, buildLog, packages, basePackages, added, problems, facts };
  } finally {
    rmSync(ctx, { recursive: true, force: true });
  }
}

/** True if the runner image exists on this machine. */
export async function runnerImageExists(env?: NodeJS.ProcessEnv): Promise<boolean> {
  return run("docker", ["image", "inspect", RUNNER_IMAGE], { env: env ?? process.env }).then(
    () => true,
    () => false,
  );
}
