# Onhand

Onhand is a contextual AI assistant for learning and research. The goal is to help users understand what is already open on their computer instead of pulling them away into a separate chatbot interface.

<p align="center">
  <img src="screenshots/promo/attention-screenshot.png" alt="Onhand explaining scaled dot-product attention with page highlights, notes, and a sidebar answer" width="960">
</p>

<p align="center"><em>Onhand grounding an explanation in the page the user already has open.</em></p>

The intended experience is:
- invoke Onhand from the browser extension side panel
- ask a question about the page, PDF, file, or material already in front of you
- have Onhand point to the relevant place, scroll to it, highlight it, and explain it in context
- save the session so it can be replayed later with the relevant artifacts restored

## Current status

Onhand now uses the browser extension as its runtime:

1. the Chromium extension hosts the side panel UI
2. `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` are bundled into the extension
3. sidebar messages route to an in-extension runtime controller
4. browser tools call the existing extension command handlers directly
5. Onhand Free, OpenAI Codex sign-in, and provider API-key auth are configured from the extension options page
6. runtime settings are stored in `chrome.storage.local`; sessions and artifacts are stored as per-record entries in extension IndexedDB

## Browser-only direction

The browser extension is the whole Onhand runtime. The Electron desktop app, localhost bridge, and pi-extension bridge adapter have been removed.

See:

- `docs/BROWSER_ONLY_MIGRATION.md`

The broader product plan lives in:

- `docs/ONHAND_CONSTITUTION.md`
- `docs/ONHAND_PLAN.md`
- `docs/VOICE_ARCHITECTURE.md`

## Built with Codex and GPT-5.6

Codex has been both a supported way to run Onhand and the primary coding-agent harness used to develop it. We use Codex to inspect and change the repository, run regression suites, reload the real unpacked extension, and validate browser behavior in Helium instead of relying only on mocked tests.

GPT-5.6 Sol has been our frontier-model target for the more agentic Onhand experience. For the v0.4.3 work, we used it in repeated live browser-trajectory runs across a 10-case evaluation set covering page grounding, selections, multi-tab research, PDFs, interaction, and failure recovery. Those runs helped us identify orchestration and evaluation-harness problems separately from model-quality problems. Onhand runs a single production execution path; the planned full-agent/guided-agent profile split was archived in favor of the barebones direction (see docs/AGENT_RUNTIME_PROFILES_PLAN.md).

See `docs/AGENT_TRAJECTORY_EVAL.md` for the evaluation contract, and `docs/AGENT_TRAJECTORY_BASELINE_2026-07-21.md` for the dated 0.4.2 baseline. (`docs/AGENT_RUNTIME_PROFILES_PLAN.md` is an archived plan kept for history, not an architecture reference.)

## Current repository layout

- `docs/ONHAND_PLAN.md` - product and implementation plan
- `packages/browser-extension/` - unpacked Chromium extension and browser-hosted Pi runtime
- `scripts/` - browser-runtime build, smoke, fixture, preflight, and Chrome acceptance helpers
- `website/` - static landing site, privacy policy, support page, and Chrome Web Store links

## Security and privacy model

- Browser-only mode stores runtime settings in extension storage, including the selected auth mode, model, optional provider API keys, OpenAI Codex sign-in credentials, and the anonymous Onhand Free token.
- Onhand Free uses a hosted Cloudflare Worker that forwards model requests to OpenRouter with daily usage caps. Anonymous diagnostics are required for Onhand Free so the hosted endpoint can monitor reliability, cost, quota pressure, crashes, and abuse.
- OpenAI Codex sign-in uses the browser OAuth flow with selectable Codex text models. `gpt-5.5` remains the default, and GPT-5.6 Sol (`gpt-5.6-sol`), Terra (`gpt-5.6-terra`), and Luna (`gpt-5.6-luna`) are available when the signed-in Codex plan includes them.
- Provider API-key mode calls the selected provider directly from the extension runtime. Supported providers include OpenAI, Anthropic, Google Gemini, and OpenRouter.
- Anonymous diagnostics and explicit error reports are redacted. They do not include prompts, page content, URLs, screenshots, saved sessions, transcripts, or keys. Sentry receives only redacted crash/exception events when diagnostics are enabled or when the user explicitly sends an anonymized error report.
- `browser_run_js` is an optional, constrained last-resort runtime-state inspection tool for complex client-side pages. Users can disable it from the options page.

Related docs:

- `website/privacy.html`
- `docs/FREE_TIER.md`
- `docs/SENTRY.md`
- `docs/STORE_LISTING.md`

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Build the extension runtime bundle

```bash
npm run build:extension
```

### 3. Load the browser extension

- Open your Chromium-based browser's extensions page
- Enable developer mode
- Load unpacked extension from `packages/browser-extension/`
- Open the extension options page
- Easiest: select `Onhand Free (beta)` for no-key, no-account usage with a daily cap.
- Preferred for regular text chat: use OpenAI Codex sign-in:
  - click `Sign in` in the OpenAI Codex Sign-In section
  - finish the opened OpenAI login tab
  - confirm Authentication is set to `OpenAI Codex sign-in`
  - keep the default/recommended model, `gpt-5.5`, unless you are intentionally testing another selectable Codex model
- For your own provider key:
  - set Authentication to `Provider API key`
  - choose OpenAI, Anthropic, Google Gemini, or OpenRouter
  - enter the provider API key
  - choose a model if needed
  - Save
- Voice mode requires an OpenAI platform API key with Realtime API access. You can paste this key in the options page while keeping Authentication set to OpenAI Codex sign-in for text chat.

If Helium supports Chromium extensions and the `chrome.debugger` API, the same unpacked extension should work there too.

## Testing The Browser Runtime

```bash
npm run build:extension
npm run smoke:browser-runtime
```

For a real provider call:

```bash
OPENAI_API_KEY=... npm run smoke:browser-runtime -- --real-openai
```

For a manual Chrome smoke, reload the unpacked extension, sign in with OpenAI Codex, confirm the options page shows `authMode: "oauth"`, `aiProvider: "openai-codex"`, the recommended `aiModel: "gpt-5.5"`, `hasOAuthCredentials: true`, and `expired: false` in the status JSON, then run the local fixture with `npm run serve:fixture`. Open `http://127.0.0.1:8765/` in Chrome, start a fresh Onhand side-panel session with a Chrome-specific title, and submit the read, interaction, debug, artifact, and network reload prompts there.

For browser-runtime regression coverage, run:

```sh
npm run build:browser-runtime
npm run test:browser-runtime-regressions
npm run smoke:browser-runtime -- --ports
```

For the repeatable Chrome/OAuth acceptance gate, see `docs/CHROME_ACCEPTANCE.md` or print the current prompt matrix with:

```sh
npm run acceptance:chrome -- --suite=all
```

For terminal-first session inspection, CLI-driven browser questions, and automated live acceptance, see `docs/SESSION_DEBUGGING.md`.

## Experimental Realtime Voice Tutor

This branch includes an experimental `gpt-realtime-2.1` WebRTC voice tutor for the side panel. Start the local session endpoint with:

```sh
OPENAI_API_KEY=... npm run serve:realtime
```

Voice requires an OpenAI platform API key saved in the Onhand options page. Open the options page, paste a platform key with Realtime API access in the OpenAI platform API key field, save, reload the extension, and click `Voice` in the side panel. You can keep Authentication set to OpenAI Codex sign-in for text chat. The local endpoint is only a fallback/dev path. Details are in `docs/REALTIME_VOICE.md`.

## Browser Runtime Tools

The canonical tool manifest is `shared/browser-tools.json` (kept in sync with the runtime and the website by `npm run website:check-tools`). Current tools:

- `browser_extract_content`
- `browser_get_visible_text`
- `browser_get_selection`
- `browser_get_viewport_headings`
- `browser_get_scroll_state`
- `browser_get_visible_region_image`
- `browser_get_dom`
- `browser_textbook_search`
- `browser_search_linked_pdf_corpus`
- `browser_pdf_search`
- `browser_pdf_read_pages`
- `browser_pdf_jump_to_page`
- `browser_pdf_capture_page_image`
- `browser_pdf_find_citation`
- `browser_open_pdf_in_onhand_viewer`
- `browser_highlight_text`
- `browser_show_note`
- `browser_scroll_to_annotation`
- `browser_clear_annotations`
- `browser_list_tabs`
- `browser_activate_tab`
- `browser_navigate`
- `browser_click`
- `browser_type`
- `browser_click_text`
- `browser_type_by_label`
- `browser_find_elements`
- `browser_wait_for_selector`
- `browser_pick_elements`
- `browser_capture_screenshot`
- `browser_capture_state`
- `browser_list_artifacts`
- `browser_restore_state`
- `browser_collect_console`
- `browser_collect_network`
- `browser_run_js`

## Notes

- If you previously loaded the unpacked extension from the old top-level `browser-extension/` path, reload it from `packages/browser-extension/`.
- `chrome.debugger` is a powerful permission and may show a browser warning while attached.
- Some pages cannot be debugged, such as privileged browser pages.
- Session restore/review is now artifact-backed for annotated turns. The side panel's Review action can preview saved snapshots/transcripts, and annotated replies automatically save an HTML/screenshot snapshot when the model did not explicitly capture one. Restore fidelity for changed pages and missing tabs is still in progress.

## Support

If Onhand is useful to you, you can support ongoing development through [GitHub Sponsors](https://github.com/sponsors/Phineas1500).

## License

Onhand is licensed under the Apache License, Version 2.0. See `LICENSE` for details.

## Likely next steps

- stronger replay/restore fidelity for changed pages and missing tabs beyond best-effort text matching
- session/artifact export-import and a storage-usage readout now that sessions/artifacts live in IndexedDB
- tighter release/ops automation for Chrome Web Store submissions, website version sync, free-tier monitoring, and Sentry checks
