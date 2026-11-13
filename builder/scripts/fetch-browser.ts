/**
 * Fetch the approved browser zip into the browser cache (package 3.1b). The runner image is built from
 * it, and the live acceptance tests, part of `npm test`, fail without it.
 *
 * Usage (from builder/): BUILDER_BROWSER_CACHE=<a folder outside the repository> npx tsx scripts/fetch-browser.ts
 *
 * It fetches from the recorded address only (BROWSER_ZIP_URL in src/acceptance/runner-image.ts; docs/SOURCES.md),
 * through the proxy the environment names (HTTPS_PROXY in a cloud session), and puts the zip in place only if
 * its size and SHA-256 are the approved ones; a file already there is never replaced. The rules are in
 * src/acceptance/browser-fetch.ts. It prints the proxy's host and port, never a user name or password.
 * Exit code 0: the approved zip is in place (fetched now, or already there). Exit code 1: refused or failed;
 * the reason is printed, and no partial file is left.
 */
import { fetchBrowserZip, FetchRefused } from "../src/acceptance/browser-fetch.js";
import { BROWSER_ZIP_URL } from "../src/acceptance/runner-image.js";

const cacheDir = process.env.BUILDER_BROWSER_CACHE;
if (!cacheDir) {
  console.error("BUILDER_BROWSER_CACHE is not set. Set it to a folder outside the repository (it is made if it is not there), then run this again.");
  process.exit(1);
}
console.log(`Fetching the approved browser zip from ${BROWSER_ZIP_URL} into ${cacheDir}, ${new Date().toISOString()}.`);
try {
  const r = await fetchBrowserZip({ cacheDir, log: (l) => console.log(l) });
  console.log(r.fetched ? `Done: the approved zip was fetched ${r.via}.` : "Done: the approved zip was already there.");
} catch (err) {
  const e = err as Error & { code?: string; cause?: { code?: string } };
  const what = err instanceof FetchRefused ? e.message : `The fetch failed: ${e.message.split("\n")[0]}${e.code ? ` (${e.code})` : ""}. Nothing was put in place.`;
  console.error(what);
  console.error("If the session's proxy refused storage.googleapis.com, a fresh session cannot fetch the browser until the owner's cloud environment lets that host through (docs/ENVIRONMENT-CHECK.md, 'Session set-up'; known gap 110).");
  process.exit(1);
}
