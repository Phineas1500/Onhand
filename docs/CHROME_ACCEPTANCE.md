# Chrome Acceptance Gate

Use this gate before merging browser-runtime, browser-tool, side-panel, OAuth, or artifact changes that need the real Chrome extension path.

The gate is intentionally manual at the side-panel layer because the authoritative OAuth path runs inside live Chrome. The repository owns the pages, prompts, and expected PASS signals so the run is repeatable and auditable.

## Command

Print the current acceptance plan:

```sh
npm run acceptance:chrome -- --suite=all
```

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
