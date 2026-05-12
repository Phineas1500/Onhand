# Testing Workflow

Onhand is now browser-only. The authoritative runtime is the unpacked Chrome extension in `packages/browser-extension/`; Electron, tmux, the localhost bridge, and bridge-client targeting are no longer part of the workflow.

## Default Local Gate

Run this before opening or updating a PR:

```sh
git diff --check origin/main...HEAD
npm run build:extension
npm run test:browser-runtime-regressions
npm run smoke:browser-runtime -- --ports
npm run test:preflight
```

`npm run test:browser-runtime-regressions` starts a temporary local fixture server. In sandboxed environments it may need permission to bind `127.0.0.1`.

## Chrome Acceptance

Use Chrome for real side-panel validation, especially when OAuth, tool routing, annotations, artifacts, network/debugger collection, or UI state changed.

1. Run `npm run build:extension`.
2. Reload the unpacked extension from `packages/browser-extension/`.
3. Open the extension options page.
4. Confirm `authMode: "oauth"`, `aiProvider: "openai-codex"`, and `aiModel: "gpt-5.5"` in the status JSON.
5. Print the acceptance matrix:

```sh
npm run acceptance:chrome -- --suite=all --run-id=chrome-acceptance-YYYY-MM-DD
```

6. Run those prompts manually in the Onhand side panel.
7. Record PASS/FAIL results in the PR.

The fixture matrix uses `npm run serve:fixture` and `http://127.0.0.1:8765/`. The real-page matrix currently covers Wikipedia, the-internet.herokuapp.com, and React docs.

## What To Check

- A prompt submitted from the side panel streams and reaches a final reply.
- Browser tools return readable results, not `[object Object]`.
- Highlights and notes attach to the intended text and remain clickable from page actions.
- Artifact save/list/restore paths work for browser-only artifacts.
- Network collection with reload and `ignoreCache` captures the expected document or API request.
- The session list, new session, switch session, rename, stop, learning mode, and speed mode controls still work.

## Useful Commands

```sh
npm run acceptance:chrome -- --suite=fixture
npm run acceptance:chrome -- --suite=real-pages
npm run smoke:browser-runtime -- --json
npm run smoke:browser-runtime -- --ports --json
npm run smoke:browser-runtime -- --real-openai
```

Use `--real-openai` only when `OPENAI_API_KEY` is available and the goal is to verify the API-key fallback. The preferred product path is Chrome side-panel OAuth with OpenAI Codex.
