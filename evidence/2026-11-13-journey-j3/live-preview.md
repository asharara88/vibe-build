# J3: your live preview of the scripted app

*Written by Claude Code on 13 Nov 2026, branch `claude/j3-live-preview` from `claude/stage-1` at `ee36b3c`. Built, not tested, not reviewed. **Not yet approved for use: your two-page phone test comes first** (below).*

## What you can now do

On the builder's preview screen, while a project's app runs, press **"Open the live app"**. The builder shows a pass once (8 characters, works once, for 2 minutes). Open **"app"** in your Claude app's preview list (this machine's port 4030), type the pass, and use example 1's app as it runs: its own sign-in as the made-up employee (press **"Show the sample sign-in"** on the builder for the email and password), My requests, a new request, the list, Arabic, sign-out. "Leave the live app" (at `/__builder/leave`) or "End the live app" on the builder ends it; so do signing out of the builder, running the checklist, closing the project, the app stopping, and 8 hours.

| Part | Real or Simulated |
| --- | --- |
| The app you use | **Simulated build**: written by the scripted engine, Claude Code's fixed changes, no AI model. Labelled "Simulated build: scripted engine, sample data" on the button, the pass and the gate. The app's own banner says it is sample data |
| Its data | Made-up only ("Made-up data only. No customer or personal details. Removed when the project closes.") |
| The app running, the streams, the front, the pass, the sign-in | **Real** |
| Only scripted builds | Enforced in code: the live app is refused unless the project's record shows only the scripted engine's fixed changes (test; control J3-C15) |

## How it works, in one paragraph

Your phone's browser talks to the builder's **preview front** (a small program on this machine, run as a user of its own with no access to Docker, the database, the builder's files or its passwords: M6). The front checks every request (another site's request, an unknown method, a body over 1 MB: refused before anything reaches the app), keeps only a short list of headers, and passes the request on through the builder to a **short-lived container on the project's own private network** (`check`, as package 0.6c made it), which holds one connection to the app. Nothing on this machine opens a connection to the app itself; the app still has no port on the machine. Answers come back the same way; the front checks them (cookies renamed, redirects kept on the preview, anything but web pages, scripts, styles, images and fonts refused) and adds its own rules (no fetch, form, frame or worker to anywhere else).

**What changes in your 0.6c rule (your answer (a), 13 Nov):** while you use the live app, its page code runs in your phone's browser, which has the internet: a way out besides the builder's door, for scripted builds only (known gap 148).

## Your phone test

Two test pages with no data, which this session starts when you say "phone test" and adds to your preview list as "probe-a" and "probe-b":

1. Open **probe-a**. Press its steps in order: 1 (send a form to this page), 2 (open this page again), 3 (go to probe B by a link), 4 (send a form to probe B), 5 (try a port that was not shared), 6 (the cached page, twice). If step 3 or 4 says the address could not be built, open probe-b from the list instead.
2. Open **probe-b** and press its steps.
3. Say "done". If you can, also say whether probe-a opens in a private window when you are signed out of Claude.

The pages record each request's address, what kind of page sent it, and the names (not values) of its headers and cookies (`builder/scripts/probe-phone.ts`). Claude Code then reads them and applies the design's table: same origin for both pages, or a pane that frames them from another site, **stops** the live preview (option (b), guided clicks, instead); the same host on another port, same-site, or cross-site **goes on**, with what it shows added to known gap 157. Tried on this machine with `curl` only; not yet on your phone.
