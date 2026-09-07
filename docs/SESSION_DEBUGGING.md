# Session Debugging And Live Acceptance

This workflow lets you inspect and drive Onhand browser sessions from the terminal instead of reading the side panel visually.

## Browser Setup

Launch Helium or another Chromium browser with remote debugging enabled, then load the unpacked extension from `packages/browser-extension/`.

```sh
/Applications/Helium.app/Contents/MacOS/Helium --remote-debugging-port=9343
```

After changing `packages/browser-extension/` or rebuilding `packages/browser-extension/onhand-runtime.bundle.js`, reload the unpacked extension from `chrome://extensions` before live validation.

### CDP alongside an existing Helium session

An already-running Helium process without a debug port does not acquire one by
launching the same profile again with a new flag. Leave that session running and
use a disposable profile for generated-fixture QA:

```sh
onhand_test_profile=$(mktemp -d /tmp/onhand-cdp-XXXXXX)
/Applications/Helium.app/Contents/MacOS/Helium \
  --user-data-dir="$onhand_test_profile" \
  --remote-debugging-port=9343 \
  --load-extension="$PWD/packages/browser-extension" \
  --disable-extensions-except="$PWD/packages/browser-extension" \
  --no-first-run --no-default-browser-check about:blank
```

Run from the repository root and choose an unused port. Confirm the endpoint at
`http://127.0.0.1:9343/json/version`. Reload the Onhand card in that profile's
Extensions page and confirm its new service worker. For hosted checks, select
Onhand Free and set `onhandFreeTierBaseUrl` to the deployment's **`/v1`** URL;
plain development builds do not load `.env` into extension storage. Do not copy
the user's browser profile or credentials into the test profile.

Open the sidebar through Onhand's normal action or `chrome.sidePanel.open()`
under an authorized debugging user gesture, then attach CDP to the resulting
target. This permits sidebar interaction while the user's other profile stays
available. Close only the disposable browser and remove its temporary profile
when finished. This workflow does not override an automation tool's explicit
URL-policy rejection.

### Reloading when local PDFs are open

Run automated PDF checks with generated fixtures in an isolated browser profile first. `npm run test:real-browser-anchoring` already uses temporary Helium profiles. Launching the user's normal browser with a debug port is not required for these checks.

For a live check in the user's Helium profile:

1. Record the current Onhand session and PDF page/zoom before reloading. An extension reload can close its PDF-viewer tabs.
2. Close the Onhand side panel, open a fresh `chrome://extensions` tab, and use Computer Use to click Reload on the Onhand card. Confirm the **Reloaded** toast, then close that temporary tab. Refresh the accessibility snapshot after each UI change.
3. Reopen Onhand and recover the saved document using its citation or **Restore pages** control. The internal session-restore path issues a new local-file grant before opening the viewer. Pasting a saved `pdf-viewer.html?url=file...` address into a new tab does not issue that grant and can produce the handoff error.
4. Verify the restored document, annotations, and citation numbers before reporting that the personal-document check passed. Fixture results alone do not establish this.

If native clicks stop taking effect or report `noWindowsAvailable` while the window remains readable, ask the user to bring Helium to the foreground and click inside the existing PDF, then fetch a fresh accessibility snapshot before resuming. This recovered input during the September 4 verification; it is not a guaranteed remedy. Preserve the working viewer instead of reloading it again to address an input-tool failure.

If a browser automation tool explicitly rejects a local-file URL, stop that operation; do not retry it through CDP, AppleScript, or another surface. Report the personal-document check as incomplete and let the user reopen it through Onhand. Keep automated validation on generated fixtures. A debug port helps normal development automation but does not remove the tool's URL policy.

### PDF clipboard regression

PDF selection recovery must read the clipboard through the extension's sidebar/offscreen document, never through a debugger expression in the PDF page. A page-level `navigator.clipboard.readText()` can request site permission even when nothing is selected. Offscreen clipboard reads and writes also need the extension-permitted Paste/Copy fallback because Chromium's async Clipboard API requires document focus.

`npm run test:page-toolkit-regressions` covers empty selections, captured text, clipboard setup/read/copy failures, restoration, and offscreen focus failures. To additionally exercise the real native PDF plugin in an isolated browser profile:

```sh
ONHAND_TEST_CLIPBOARD=1 ONHAND_TEST_BROWSER_FLAGS=--headless=new npm run test:real-browser-anchoring
```

Automatic selection-copy probes run only when the clipboard contains plain text or is empty. Image, HTML, file, custom, or unknown formats skip the probe so an incomplete text-only backup cannot destroy them. The PDF viewer remains available for document questions.

The clipboard group is opt-in because it **replaces the system clipboard with harmless test data**. Preserve anything needed from the clipboard before running it. It seeds known text, HTML, and generated image data before reading, verifies that the rich formats survive unchanged, and leaves fixture text afterward. It also captures text via the actual Copy shortcut and extension clipboard route with the PDF site's clipboard permission ungranted. The normal anchoring/restore groups then run as usual.

### Runtime and PDF review regressions

After building and reloading the extension, run:

```sh
npm run test:pdf-viewer-review
ONHAND_TEST_BROWSER_FLAGS=--headless=new npm run test:real-runtime-review
ONHAND_TEST_BROWSER_FLAGS=--headless=new npm run test:real-pdf-zoom
```

The runtime browser suite uses a disposable extension profile and the bundled smoke model. It checks real IndexedDB commit/abort behavior, deletion of session-owned snapshots while preserving shared ones, limited snapshot listing, Stop during preparation, and simultaneous submissions. The PDF browser suite pauses an actual rendering frame while annotations and notes change, then checks their identities and geometry after zoom. These suites do not make hosted model calls or use personal sessions.

## Inspect Sessions

Use the CLI through the npm wrapper:

```sh
npm run debug:sessions -- list --limit 10
npm run debug:sessions -- show --current
npm run debug:sessions -- timeline --latest
npm run debug:sessions -- tools --current
npm run debug:sessions -- turn --current --turn 2
npm run debug:sessions -- grep "positional encodings" --latest
```

Useful diagnostics:

```sh
npm run debug:sessions -- context --current
npm run debug:sessions -- latest-errors --limit 20
npm run debug:sessions -- diff-tools --session-a session_a --session-b session_b
```

- `context` reports recorded prompt/reply/tool-result sizes by turn, which helps spot sessions that are filling context too quickly.
- `latest-errors` scans recent session replays for failed turns and failed tool calls.
- `diff-tools` compares tool choices between two sessions, useful when a prompt improves or regresses.

Use JSON output for scripts:

```sh
npm run debug:sessions -- show --current --json
npm run debug:sessions -- context --current --json
```

## Routing And Guard Diagnostics

Onhand classifies each prompt's intent (teaching, comparison, enumerable coverage, review markup, …) to set marker expectations and pick deliverable profiles, and runs a chain of span-quality guards before it highlights. Two tools inspect that logic — one offline, one live.

### Offline routing/guard probe

`scripts/probe-routing.mjs` prints the intent predicates and highlight-guard decisions for any prompt with no live turn and no model call, by reading the runtime's `__browserRuntimeTest` export surface:

```sh
node scripts/probe-routing.mjs "walk me through the twelve factors as a roadmap" \
  --text "One codebase tracked in revision control, many deploys"
```

- `--text "<span>"` also reports the span-quality guard chain (empty → review-extraction → weak-structured → compact-teaching → named-formula → concept-location) for that candidate highlight.
- `--classify '<intent-json>'` injects a model-intent classification (e.g. `'{"pageScoped":true,"enumerableCoverage":true}'`) to probe the classifier-on path; without it the deterministic regex-router fallback is shown.
- `--title "<tab title>"` supplies a tab title for cross-tab/review routing.

Its fixture table locks in known routing/guard behavior; run it as a test:

```sh
npm run test:routing-probe
```

### Live turn trace

`debug:fetch-turn-trace` is a background message that returns the last ~12 real turns' decision trace — the routing classification plus every `browser_highlight_text`/tool call's args, resulting state, and any guardrail that fired. It is backed by `chrome.storage.session`, so traces survive a service-worker restart, and it records whenever `advancedRuntimeInspectionEnabled` is on (the default). Use it to answer "why did this turn route/highlight that way" without live instrumentation.

Send it from a page attached to the extension (e.g. the offscreen or side-panel context):

```js
chrome.runtime.sendMessage({ type: "debug:fetch-turn-trace", limit: 12 }).then(console.log);
```

The offline probe is the deterministic companion to this live trace: the trace shows what happened in a real turn; the probe shows what the routing/guard logic decides for any input, in milliseconds.

## Drive Sessions From The CLI

Open a page in the remote-debuggable browser:

```sh
npm run debug:sessions -- open-url https://example.com
```

Submit a question to the current Onhand side-panel runtime and wait for the answer:

```sh
npm run debug:sessions -- ask "What does this page say about positional encodings?" --new --wait
```

Open a URL, start a new session, ask, and wait:

```sh
npm run debug:sessions -- ask-new-url https://example.com "Summarize the first heading." --wait
```

Clean up temporary CLI driver targets:

```sh
npm run debug:sessions -- cleanup-drivers
```

## Live Acceptance

The automated live acceptance suite uses the session CLI, a local fixture page, and the loaded Onhand extension.

```sh
npm run test:live-acceptance
```

Optional checks:

```sh
npm run test:live-acceptance -- --include-transformer
npm run test:live-acceptance -- --google-doc-url https://docs.google.com/document/d/<doc-id>
ONHAND_GOOGLE_DOCS_SMOKE_URL=https://docs.google.com/document/d/<doc-id> npm run test:live-acceptance
```

The suite covers:

- read-only dynamic DOM inspection via `browser_run_js`
- failed highlight recovery and traceability
- PDF reading through Onhand's viewer/PDF tools
- context reuse across follow-up turns
- context-budget telemetry
- optional external Transformer-page lookup
- optional Google Docs read smoke

## Release Confidence Pass

Before treating a browser-runtime change as ready, run:

```sh
npm run test:preflight
npm run test:browser-runtime-regressions
env ONHAND_TEST_CDP_PORT=9443 npm run test:real-browser-anchoring
npm run test:live-acceptance -- --include-transformer --google-doc-url https://docs.google.com/document/d/<doc-id>
```
