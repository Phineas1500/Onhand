# Firefox parity plan

Status: planned
Date: 2026-10-21
Scope: making the Firefox add-on do what the Chrome extension does, from the same source

## Goal

A Firefox user gets the same Onhand as a Chrome user. Where Firefox makes that impossible, they get the closest equivalent, and the difference is written down in `docs/FIREFOX.md`.

## Where things stand (2026-10-21)

- **Releases:**
  - Chrome Web Store serves 0.4.12.
  - Firefox Add-ons (AMO) approved 0.4.9 on 2026-10-21, at https://addons.mozilla.org/firefox/addon/onhand-ai/.
  - 0.4.12 is uploaded to AMO and validated, waiting for someone to click through the submission.
- **Works in Firefox:**
  - The one-off run on 2026-10-17 passed: page reading, highlights with notes, recovery from a missing passage, reading another tab, Learning mode, screenshots, web PDFs and local PDFs chosen in the viewer.
  - The sidebar opens and closes from the toolbar button and the shortcut.
- **Gaps:** listed under "Known gaps" in `docs/FIREFOX.md`, and assigned to phases below.

## Principles

- **One codebase.** Keep detecting what the browser supports (`IS_FIREFOX_RUNTIME`, `debuggerApi`, the missing `chrome.offscreen`) instead of forking files.
- **Prefer fixes that help Chrome too.** A fix in the shared page toolkit, or one that removes a debugger fallback, improves both browsers.
- **Measure parity.** Each gap that's closed gets a Firefox test, so parity is checked on every release instead of assumed.
- **Same-day releases.** Every Chrome release goes to AMO the same day.

## Phase 0: same-day releases (small)

Firefox is three versions behind because each AMO submission is a manual web form.

- Submit with Mozilla's `web-ext sign --channel=listed`, which uploads the package, the source archive and the release notes. Check that `--upload-source-code` handles the 7 MB archive.
- **Credentials:** the user creates AMO API credentials at addons.mozilla.org/developers/addon/api/key/ and stores them in `.env` (for example `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`). Claude doesn't create credentials.
- **Release notes:** build them from the `whats-new.js` entries since the last AMO version.
- **Reviewer notes:** take them from `docs/FIREFOX.md`. Update its build command to `ONHAND_FREE_TIER_BASE_URL=https://api.useonhand.com/v1`.
- **Release process:** add this as the AMO step, after packaging and the source map upload.
- **Done when:** a release reaches AMO the same day as Chrome, without the web form.

## Phase 1: measure parity (small to medium)

- **Firefox lane for live acceptance:** `npm run test:live-acceptance -- --browser firefox`.
  - It drives Firefox over WebDriver BiDi, like the 2026-10-17 run. That harness lived in the session scratchpad, so it needs to be rebuilt in `scripts/`.
  - It seeds `ONHAND_FREE_TIER_TEST_TOKEN` and tags prompts `acceptance`.
- **Expected skips:** each case has a per-browser expectation. Firefox starts with a named list of expected skips (today, the `browser_run_js` case), and the list shrinks as gaps close.
- **CI:** add a packaged-build Firefox smoke run. GitHub's Ubuntu runners ship Firefox; confirm, and confirm the version is new enough.
- **Parity table:** add one to `docs/FIREFOX.md` with feature, Chrome, Firefox and the test that covers it.
- **Done when:** acceptance runs on Firefox, and every remaining difference shows up as a named expected skip.

## Phase 2: test what has never run in Firefox (small)

- **Voice:**
  - Live voice runs in the panel page (`sidebar.js`), so it may mostly work.
  - The microphone prompt is the likely problem: Chrome's side panel routes it through `mic-permission.html`.
  - Test with the synthetic microphone, as `eval:voice-call` does.
- **ChatGPT sign-in:** `src/browser-oauth.ts` catches the `localhost:1455` redirect with `tabs.onUpdated`, which Firefox supports. Test the full sign-in and a refresh.
- **Google Docs:** reading a doc and capturing a selection.
- **Done when:** each one passes in the Firefox lane, or has a fix assigned to a phase below.

## Phase 3: gaps that don't need the debugger (medium)

- **Clipboard probe:**
  - Chrome runs it in the offscreen document (`offscreen.js`).
  - Firefox's background is an event page with a DOM, so the same snapshot, read and write can run there when `chrome.offscreen` is missing.
- **Form text:** text inside `<output>` and similar form elements fails to highlight without the debugger. Fix the page toolkit's text matching, which also removes a debugger fallback in Chrome.
- **Google Scholar's reader:** read the selection through the reader's frame with `scripting.executeScript` and frame ids, instead of a debugger target.
- **Pages whose security policy blocks reads:**
  - Where a read today goes through string evaluation in the page's world, call a function shipped with the add-on through `scripting.executeScript({ func, world: "MAIN" })`.
  - Check the minimum Firefox version that supports the main world.
- **Google Docs selection copy:**
  - Chrome sends a real Cmd+C through the debugger, then reads the clipboard.
  - Try a copy from the editor's text-event frame, or the text Docs exposes for screen readers.
  - This one may stay a gap.
- **Local HTML files:**
  - Firefox can't open `file://` pages for extensions.
  - Offer the local-PDF treatment: choose or drop the file into an Onhand page that shows it sandboxed and annotates it there.
  - This is the largest item in this phase and can come last.

## Phase 4: debugging tools without the debugger (medium)

- **`browser_collect_console`:**
  - Register a page-world content script at `document_start` that buffers console messages and errors, only while console capture is wanted.
  - Messages from before that need a reload, which is similar to Chrome, where capture starts when the debugger attaches.
- **`browser_collect_network`:**
  - Use `webRequest`, and Firefox's `filterResponseData` for response bodies.
  - Request it as an optional permission at first use, so installs don't ask for it.
  - Check the permission names under Manifest V3, and give AMO a justification.
- **Done when:** the console and network acceptance prompts pass in Firefox.

## Phase 5: replace `browser_run_js` with built-in inspection tools (large, all browsers)

Mozilla forbids running code the add-on didn't ship, so the AI-written JavaScript tool can't come to Firefox as it is. It's also the "remote code" disclosure on Chrome and Edge.

**How much Chrome uses it (2026-10-21):**
- **Diagnostics, last 90 days:**
  - 70 calls across 1,468 prompts (4.8%).
  - By source: prompt-eval 28 of 554, live voice 11 of 286, CLI 7 of 177, acceptance 14 of 59 (one case asks for it on purpose), agent trajectory 1 of 194.
  - The 8 untagged calls came from our own browser on 2026-08-01, within two minutes.
  - No real user has been seen using it. Real users are close to zero, and diagnostics only cover Onhand Free and opted-in users, so this can't rule real use out.
  - All 70 calls succeeded.
- **Saved page-prompt evals (`tmp/page-prompt-eval`):**
  - 14 of 1,043 answers called it, all on ordinary reading questions: a Paul Graham essay, translating a Wikipedia paragraph, a GitHub code file, a Wikipedia citation chase, a Nature figure.
  - The code it ran only read the page's HTML: `document.body.innerText`; one element's text; GitHub's hidden code textarea; links filtered by text; figure captions.
  - Only the acceptance case reads live JavaScript state (`window.__onhandPortSmoke`, an input's value, an element's text).

**Disclosure fix (done 2026-10-21, ships in the next release):**
- **The problem:** the store reviewer notes (`docs/STORE_LISTING.md`) and the Edge submission say the tool isn't used for ordinary page or PDF questions. The evals showed it sometimes was, because the tool was offered whenever the setting was on.
- **The fix:** `selectToolsForPrompt` now offers `browser_run_js` only when the request asks about JavaScript or runtime state, names the tool, or forces it.
  - The check is `promptNeedsRuntimeJavaScript`, which until then only fed the missing-tool retry.
  - Live voice builds its tool list once per call with no prompt, so it no longer offers the tool.
  - The port smoke prompts now name `browser_run_js`, since the smoke model calls it.

**Replacement:**
1. **`browser_query_dom`:** a CSS selector, what to read (text, value, attribute, link or computed style), an optional text filter and a result limit. Read-only and shipped with the add-on. It covers every use seen in the evals.
2. **`browser_read_page_state`:** read a named global by path, for example `window.__NEXT_DATA__` or `app.state.user.name`.
   - It runs a shipped function in the page's world and returns JSON with a size cap.
   - It refuses cookies, storage and anything that looks like a credential.
   - This covers the acceptance case and most real "what's in this page's state" questions.
3. **The reason the AI reached for raw JavaScript:**
   - GitHub's code is in a textarea that `browser_extract_content` misses.
   - A Wikipedia article's first paragraph needed one specific element.
   - Fix those in the existing reading tools.
4. **Remove `browser_run_js` from every build.**
   - Chrome and Edge can then answer "No remote code", and the reviewer disclosure goes away.
   - Firefox gets the same tools.
   - Rewrite the acceptance case and the regressions for the new tools.

**Risk:** some questions about a page's live JavaScript that can't be predicted will lose an answer. Measure it with the explicit runtime prompts before removing the old tool.

## What can't match (document it, don't chase it)

- **`file://` pages:** extensions can't open them in Firefox. Local PDFs, and later HTML, go through choose or drop.
- **Firefox's own PDF viewer:** it can't be scripted, so Onhand's viewer replaces it, as it does today.
- **Opening the sidebar:** Firefox only opens it from a user action, so anything that opens the panel needs a click.
- **Firefox for Android:** out of scope; it has no sidebar.

## Order

| Phase | Size | Needs | Unblocks |
| --- | --- | --- | --- |
| 0 Same-day releases | Small | AMO API credentials from the user | Firefox stops falling behind |
| 1 Parity tests | Small to medium | — | Every later phase can be checked |
| 5, quick disclosure fix | Small, done 2026-10-21 | — | Accurate store and Edge disclosures |
| 2 Untested features | Small | Phase 1 | Fixes for voice, sign-in, Docs |
| 3 Non-debugger gaps | Medium | Phase 1 | Selection, form text, Scholar, CSP pages |
| 4 Console and network | Medium | Phase 1 | Debugging help in Firefox |
| 5 Built-in inspection | Large | Phases 1 and 3 | Remote-code-free builds everywhere |

Track progress in the parity table in `docs/FIREFOX.md`. Remove a gap from "Known gaps" only when the Firefox lane passes it.
