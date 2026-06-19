# Session Debugging And Live Acceptance

This workflow lets you inspect and drive Onhand browser sessions from the terminal instead of reading the side panel visually.

## Browser Setup

Launch Helium or another Chromium browser with remote debugging enabled, then load the unpacked extension from `packages/browser-extension/`.

```sh
/Applications/Helium.app/Contents/MacOS/Helium --remote-debugging-port=9343
```

After changing `packages/browser-extension/` or rebuilding `packages/browser-extension/onhand-runtime.bundle.js`, reload the unpacked extension from `chrome://extensions` before live validation.

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
