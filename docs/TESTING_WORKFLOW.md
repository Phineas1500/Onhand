# Testing Workflow

Onhand is now browser-only. The authoritative runtime is the unpacked Chrome extension in `packages/browser-extension/`; Electron, tmux, the localhost bridge, and bridge-client targeting are no longer part of the workflow.

## Default Local Gate

Run this before opening or updating a PR:

```sh
git diff --check origin/main...HEAD
npm run build:extension
npm run test:agent-runtime-modules
npm run test:browser-runtime-regressions
npm run smoke:browser-runtime -- --ports
npm run test:preflight
```

`npm run test:browser-runtime-regressions` starts a temporary local fixture server. In sandboxed environments it may need permission to bind `127.0.0.1`.

## Chrome Acceptance

Use Chrome for real side-panel validation, especially when OAuth, tool routing, annotations, artifacts, network/debugger collection, or UI state changed.

1. Run `npm run build:extension`.
2. Reload the unpacked extension from `packages/browser-extension/` using Computer Use on `chrome://extensions`.
3. Open the extension options page with Computer Use.
4. Confirm `authMode: "oauth"`, `aiProvider: "openai-codex"`, `aiModel: "gpt-6-luna"`, `hasOAuthCredentials: true`, and `expired: false` in the status JSON.
5. Print the acceptance matrix:

```sh
npm run acceptance:chrome -- --suite=all --run-id=chrome-acceptance-YYYY-MM-DD
```

6. Run those prompts manually in the Onhand side panel.
7. Record PASS/FAIL results in the PR.

Use Computer Use for extension UI and side-panel prompts. Use the Codex Chrome Extension backend only for normal web page automation after the Onhand side panel, extension options page, and `chrome://extensions` are closed. A Codex Chrome `another extension UI is open` blocker is an automation conflict, not an OAuth failure by itself.

The fixture matrix uses `npm run serve:fixture` and `http://127.0.0.1:8765/`. The PDF matrix uses the controlled PDF.js-style fixture at `http://127.0.0.1:8765/pdf.html`, the Onhand-owned real-PDF viewer fixture at `http://127.0.0.1:8765/onhand-pdf-viewer.html?url=http%3A%2F%2F127.0.0.1%3A8765%2Ffixtures%2Fonhand-viewer.pdf`, the direct content-type PDF handoff fixture at `http://127.0.0.1:8765/pdf/onhand-viewer`, the controlled Scholar-like fixture at `http://127.0.0.1:8765/scholar-pdf.html?file=/fixtures/scholar-reader.pdf`, the native Chrome PDF viewer as an unsupported diagnostic, and Google Scholar PDF Reader when available. If the Chrome profile blocks direct `.pdf` navigation with `ERR_BLOCKED_BY_CLIENT`, or Google Scholar PDF Reader is not installed in `chrome://extensions`, mark only those Scholar Reader cases as environment-blocked and still run the controlled PDF fixtures. If Chrome's native PDF viewer renders the PDF but exposes no scriptable text layer, record that as the expected unsupported result and use the sidebar `Open PDF` menu action or `browser_open_pdf_in_onhand_viewer` for annotation instead of treating the native viewer as ordinary HTML. The real-page matrix currently covers Wikipedia, the-internet.herokuapp.com, and React docs. The Learning Mode matrix covers the BayesianDL notes page with Answer Mode control, concept prompt, open-check resolution, repeated-concept refresher, and automatic cross-tab retrieval cases.

## What To Check

- A prompt submitted from the side panel streams and reaches a final reply.
- Browser tools return readable results, not `[object Object]`.
- Highlights and notes attach to the intended text and remain clickable from page actions.
- Artifact save/list/restore paths work for browser-only artifacts.
- The three-dot menu session selector still switches saved sessions, and its Restore pages action reports restored pages, annotations, notes, and failures.
- The Review view opens saved snapshots/transcripts, and transcript source buttons target the reviewed saved session rather than only the current live session.
- Successful annotated turns auto-save a Review snapshot with HTML and screenshot data when no explicit artifact capture happened.
- Network collection with reload and `ignoreCache` captures the expected document or API request.
- The session list, new session, switch session, rename, stop, and learning mode controls still work.

## Highlight Sweeps

Two model-free sweeps check that text Onhand reads can be highlighted, across many real pages. Run them after changing the page toolkit's matching (`createPageToolkit` in `background.js`) or the PDF viewer's (`src/pdf-viewer.ts`). They need a live browser and the network, so they are not in CI.

```sh
npm run test:page-toolkit-sweep -- --port <cdp port> --perturb
npm run test:page-toolkit-sweep -- --port <bidi port> --bidi --perturb
ONHAND_TEST_CDP_PORT=<port> npm run test:pdf-toolkit-sweep -- --perturb
```

- **Pages:** the page sweep covers articles, docs, math, tables, pages whose prose sits in bare `<div>`s, and Wikipedia in eleven languages (accents, right-to-left text, scripts without spaces).
- **`--perturb`:** also highlights each page's first sentences the way a model tends to retype them: other punctuation, the end cut off with "…", a word left out. A mark that lands anywhere but its own sentence counts as a failure.
- **`--bidi`:** drives the browser over WebDriver BiDi instead of CDP, which is how the sweep runs in Firefox's engine. Start Firefox (or another Gecko browser) with `--remote-debugging-port=<port>`, a throwaway `-profile` and `-no-remote`.
- **`--background <path>`:** runs the toolkit from another copy of `background.js`, to compare two versions on the same pages.
- **Known misses:** three verbatim spans on the Arabic and Chinese pages come from image-map labels and a collapsed navigation box, which extraction reads and highlighting skips.

`evals/non-english/cases.json` is the model-in-the-loop counterpart: one question per language, asked in that language (`npm run eval:page-prompts -- --cases-file evals/non-english/cases.json`).

## Useful Commands

```sh
npm run acceptance:chrome -- --suite=fixture
npm run acceptance:chrome -- --suite=pdf
npm run acceptance:chrome -- --suite=real-pages
npm run acceptance:chrome -- --suite=learning
npm run smoke:browser-runtime -- --json
npm run smoke:browser-runtime -- --ports --json
npm run smoke:browser-runtime -- --real-openai
npm run eval:free-tier-models -- --dry-run
npm run eval:agent-trajectories
npm run test:agent-trajectory-eval
npm run test:agent-runtime-modules
npm run eval:agent-trajectories:live -- --case current-page-grounded-answer
npm run ops:free-tier -- --dry-run
```

Use `--real-openai` only when `OPENAI_API_KEY` is available and the goal is to verify the API-key fallback. The preferred product path is Chrome side-panel OAuth with OpenAI Codex.

## Sentry Release Check

Run this after packaging a release and before publishing that same extension
version:

```sh
npm run package:chrome
npm run package:firefox
npm run sentry:sourcemaps
npm run sentry:smoke
```

`npm run sentry:sourcemaps` uploads each package's source map for
`onhand-extension@<manifest version>`, with `dist=chrome` or `dist=firefox`. `npm run sentry:smoke`
sends one synthetic privacy-safe event and fails unless Sentry resolves
`app:///onhand-runtime.bundle.js` back to
`packages/browser-extension/src/browser-runtime.ts`. See `docs/SENTRY.md`.

Use `npm run eval:free-tier-models` with `OPENROUTER_API_KEY` when evaluating a free-tier model change. See `docs/FREE_TIER_MODEL_EVAL.md`.
Use `npm run eval:agent-trajectories` to validate or score complete browser-task
traces across the legacy, full-agent, and guided-agent profiles. See
`docs/AGENT_TRAJECTORY_EVAL.md`. Unlike the single-turn free-tier eval, this
suite treats evidence coverage, duplicate tabs, focus changes, provisional
answers, annotations, retries, latency, and cost as one outcome.
Use `npm run ops:free-tier` with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` after deployment to inspect free-tier health. See `docs/FREE_TIER_OPS.md`.
