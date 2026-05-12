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

- Build the runtime with `npm run build:browser-runtime`.
- Reload the unpacked Chrome extension from `packages/browser-extension/`.
- Use Chrome, not Helium.
- Use the Onhand side panel, not the legacy desktop submit path.
- Confirm the extension options status shows `authMode: "oauth"`, `aiProvider: "openai-codex"`, and `aiModel: "gpt-5.5"`.
- Start a fresh Onhand session whose title includes the run id.

## Suites

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
- no-cache network reload

### Real Page Matrix

Submit the real-page prompts from `npm run acceptance:chrome -- --suite=real-pages`.

The current real pages are:

- `https://developer.mozilla.org/en-US/docs/Web/HTML` for static docs/article grounding.
- `https://the-internet.herokuapp.com/login` for app-like form interaction without submitting data.
- `https://react.dev/learn` for a client-routed documentation page with network reload.

This suite checks that the tool path still works outside the controlled fixture on article, form, and client-routed layouts.

## Passing The Gate

A passing run has:

- all prompted checklists marked PASS
- the fixture artifact answer containing an `artifact_...` id and `Onhand Port Smoke Fixture`
- the fixture network answer containing `GET 200 http://127.0.0.1:8765/`
- the fixture JSON click answer containing `Network loaded: fixture-json`
- no answer containing `[object Object]`
- real-page prompts completing without tool errors or a reasoning-only final state

## Handoff Format

Record the result in the PR or handoff:

```text
Chrome acceptance <run id>: PASS
- fixture-read: PASS
- fixture-interact: PASS
- fixture-debug: PASS
- fixture-artifact: PASS (<artifact id>)
- fixture-network: PASS (<collected URL/status>)
- real-static-article: PASS
- real-form-page: PASS
- real-client-routed-page: PASS
```

If a case fails, include the exact prompt, the observed answer, and whether the failure was a tool error, page content drift, OAuth/runtime issue, or visual side-panel issue.
