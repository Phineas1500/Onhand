# Chrome Acceptance Gate

Use this gate before merging browser-runtime, browser-tool, side-panel, OAuth, or artifact changes that need the real Chrome extension path.

The gate is intentionally manual at the side-panel layer because the authoritative OAuth path runs inside live Chrome. The repository owns the pages, prompts, and expected PASS signals so the run is repeatable and auditable.

## Command

Print the current acceptance plan:

```sh
npm run acceptance:chrome -- --suite=all
```

The local fixture suite includes a visual-region case that calls `browser_get_visible_region_image` on the controlled SVG chart before anchoring the nearby caption text.

Realtime voice has a separate suite because it creates a live Realtime session and requires microphone input. You can optionally generate a local WAV prompt and play it through the selected microphone or virtual audio device:

```sh
npm run generate:realtime-voice-fixture
npm run acceptance:chrome -- --suite=voice
```

The shipped extension does not include a test-audio injection path. Click `Voice` normally, then speak or play the generated prompt through Chrome's selected microphone.
The voice suite also includes a direct-PDF handoff case: start from the controlled PDF URL, let Voice open the Onhand PDF viewer, then submit the typed voice-live PDF prompt.
It also includes a visual-region case: scroll the local fixture's Visual Section chart into view, ask the typed voice-live chart question, and verify Onhand captures a visible-region image before making any visual claim.
For Phase 5 hardening, also verify that interrupting or starting a newer voice turn while Onhand is still planning/evaluating does not let the older result overwrite the sidebar, speak stale content, or resolve learner state incorrectly. Voice prompts and final text answers should remain visible in the restored session transcript.

Use a stable run id when recording results:

```sh
npm run acceptance:chrome -- --suite=all --run-id=chrome-acceptance-YYYY-MM-DD
```

For machine-readable output:

```sh
npm run acceptance:chrome -- --suite=all --json
```

## Preconditions

- Build the runtime with `npm run build:extension`.
- Reload the unpacked Chrome extension from `packages/browser-extension/`.
- Use Chrome, not Helium.
- Use the Onhand side panel.
- Confirm the extension options status shows `authMode: "oauth"`, `aiProvider: "openai-codex"`, `aiModel: "gpt-5.5"`, `hasOAuthCredentials: true`, and `expired: false`.
- Start a fresh Onhand session whose title includes the run id.

## Automation Boundaries

Use Computer Use for extension UI:

- `chrome://extensions` reloads
- the Onhand extension options page
- the Onhand side panel
- submitting and reading side-panel prompts

Use the Codex Chrome Extension backend only for normal web page automation after extension UI is closed. It is useful for opening real pages, inspecting normal page state, and checking that a target page is ready before a side-panel run.

If Codex Chrome reports that another extension UI is open, close the Onhand side panel, extension options tab, or `chrome://extensions` tab and retry the page automation. Treat this as a Chrome automation conflict unless the Onhand side-panel prompt itself fails with an OAuth or model error.

## OAuth Probe

Run this before the full matrix when OAuth or prompt submission is in scope:

```sh
npm run acceptance:chrome -- --suite=oauth --run-id=chrome-acceptance-YYYY-MM-DD
```

1. Open `https://en.wikipedia.org/wiki/Personal_computer` in Chrome.
2. Open the Onhand side panel with Computer Use.
3. Submit:

```text
OAUTH VALIDATION <run id>: Use browser_get_visible_text on this page. Answer only: OAUTH_VALIDATION_PASS <page title> contains_personal_computer=<yes/no>.
```

A passing OAuth probe returns `OAUTH_VALIDATION_PASS` with the Wikipedia page title and `contains_personal_computer=yes`. If this passes, OAuth prompt submission is working even if Codex Chrome page automation is blocked by an open extension UI.

## Suites

### OAuth Prompt Probe

Run `npm run acceptance:chrome -- --suite=oauth` and submit the OAuth validation prompt on `https://en.wikipedia.org/wiki/Personal_computer`.

This suite checks:

- OpenAI Codex OAuth credentials are present and not expired
- a side-panel prompt reaches the model through OAuth
- browser tools can read a real page from the OAuth-backed run

### Local Fixture Matrix

Run `npm run serve:fixture`, open `http://127.0.0.1:8765/`, and submit the fixture prompts from `npm run acceptance:chrome -- --suite=fixture`.

This suite checks:

- readable text extraction
- readable content extraction
- selection formatting, including no `[object Object]`
- heading and scroll-state tools
- label-based typing
- text-based clicking
- selector typing and clicking
- console collection
- DOM collection
- screenshots
- persisted artifacts
- menu-based session restore UI
- no-cache network reload

### PDF Annotation Matrix

Run `npm run serve:fixture`, open `http://127.0.0.1:8765/pdf.html`, `http://127.0.0.1:8765/onhand-pdf-viewer.html?url=http%3A%2F%2F127.0.0.1%3A8765%2Ffixtures%2Fonhand-viewer.pdf`, `http://127.0.0.1:8765/pdf/onhand-viewer`, and `http://127.0.0.1:8765/scholar-pdf.html?file=/fixtures/scholar-reader.pdf`, then submit the controlled PDF prompts from:

```sh
npm run acceptance:chrome -- --suite=pdf
```

Then run the native Chrome PDF viewer diagnostic and the Google Scholar PDF Reader cases on real PDF tabs. The native Chrome viewer diagnostic is read-only and may validly return unsupported because Chrome can visibly render a PDF while exposing no scriptable DOM/text layer to Onhand. Run the Scholar Reader cases only if the PDF opens successfully in the current Chrome profile and the Google Scholar PDF Reader extension is installed/enabled. Start with the real-reader visible-text diagnostic before testing selection, highlighting, or restore. If direct `.pdf` navigation reports `ERR_BLOCKED_BY_CLIENT`, open the PDF manually in Chrome and continue from the rendered Scholar Reader tab; if the tab still cannot be rendered or the reader extension is not installed/enabled, record the Scholar Reader cases as environment-blocked instead of failed.

The direct-PDF handoff case should use either the sidebar menu's `Open PDF` button or `browser_open_pdf_in_onhand_viewer` before any annotation work. After the handoff, verify the active tab is the Onhand viewer and that the regular visible-text, highlight, note, capture, restore, and source-jump tools work there.

The real Google Scholar Reader currently renders inside an extension iframe. Onhand's normal page-tool path first detects the top PDF wrapper or injected Reader iframe; when that wrapper has no readable text layer, the runtime attempts the Reader-frame fallback before reporting an unsupported PDF surface.

For the real-reader visible-text diagnostic, an unsupported answer should include whether the Reader-frame fallback was attempted and the failure reason. This keeps an environment/browser limitation distinct from a text-layer parsing bug.

This suite checks:

- page-numbered PDF visible text
- real PDF rendering in the Onhand-owned PDF viewer
- selected PDF text formatting without `[object Object]`
- unsupported native Chrome PDF viewer behavior without silent HTML fallback
- real Google Scholar PDF Reader text-layer availability before mutation
- Reader-frame fallback coverage for direct `.pdf` URLs and content-type PDF routes such as `/pdf/...`
- Onhand-owned PDF overlay highlights and notes
- selected PDF anchor reuse instead of text-layer re-search
- PDF capture/restore from normalized page-rect anchors
- page reload followed by Restore pages recreating the saved PDF highlight and note
- real Reader-frame captures preserve the top PDF tab URL/title instead of `chrome-extension://.../reader.html`
- source jumps to restored Google Scholar Reader annotations, including annotations whose target page has been virtualized and must be rendered through the Reader page-number input
- coexistence with Google Scholar PDF Reader's native highlights/comments without using Scholar's private annotation storage
- exclusion of native Scholar-like comment popups, color controls, and toolbars from PDF source text

### Real Page Matrix

Submit the real-page prompts from `npm run acceptance:chrome -- --suite=real-pages`.

The current real pages are:

- `https://en.wikipedia.org/wiki/Personal_computer` for static article grounding.
- `https://the-internet.herokuapp.com/login` for app-like form interaction without submitting data.
- `https://react.dev/learn` for a client-routed documentation page with network reload.

This suite checks that the tool path still works outside the controlled fixture on article, form, and client-routed layouts.

### Learning Mode Matrix

Submit the Learning Mode prompts from `npm run acceptance:chrome -- --suite=learning`.

The current page is:

- `https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/06BayesianDL/BayesianDL.html` for STEM tutoring and repeated-concept behavior.

This suite checks:

- Answer Mode still gives a direct anchored answer without a tutoring prompt
- Learning Mode asks a page-anchored prediction or retrieval question before a full explanation
- an open check can be resolved by a user response in the next turn
- repeated concepts get a lightweight refresher and source pointer instead of a full restart, a new note, or a batch of fresh highlights
- Learning Mode notices related open tabs and offers to connect them before switching context
- the sidebar learner-state panel does not duplicate the same concept
- the sidebar does not accumulate multiple open checks for the same repeated concept

## Passing The Gate

A passing run has:

- all prompted checklists marked PASS
- the fixture artifact answer containing an `artifact_...` id and `Onhand Port Smoke Fixture`
- the fixture session replay case showing restore metadata from the three-dot menu Restore pages action
- the fixture network answer containing `GET 200 http://127.0.0.1:8765/`
- the fixture JSON click answer containing `Network loaded: fixture-json`
- no answer containing `[object Object]`
- the OAuth probe answer containing `OAUTH_VALIDATION_PASS` and `contains_personal_computer=yes`
- real-page prompts completing without tool errors or a reasoning-only final state

## Handoff Format

Record the result in the PR or handoff:

```text
Chrome acceptance <run id>: PASS
- oauth-wikipedia: PASS
- fixture-read: PASS
- fixture-interact: PASS
- fixture-debug: PASS
- fixture-artifact: PASS (<artifact id>)
- fixture-session-replay: PASS
- fixture-network: PASS (<collected URL/status>)
- pdf-controlled-visible: PASS
- pdf-controlled-highlight-note: PASS
- pdf-controlled-capture-restore: PASS (<artifact id>)
- pdf-controlled-selected-passage: PASS
- pdf-google-scholar-selection: PASS
- pdf-google-scholar-restore: PASS
- real-static-article: PASS
- real-form-page: PASS
- real-client-routed-page: PASS
- learning-answer-control: PASS
- learning-concept-prompt: PASS
- learning-open-check-resolution: PASS
- learning-repeated-concept: PASS
- learning-cross-tab-offer: PASS
```

If a case fails, include the exact prompt, the observed answer, and whether the failure was a tool error, page content drift, OAuth/runtime issue, or visual side-panel issue.
