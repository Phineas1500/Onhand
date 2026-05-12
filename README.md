# Onhand

Onhand is a contextual AI assistant for learning and research. The goal is to help users understand what is already open on their computer instead of pulling them away into a separate chatbot interface.

<p align="center">
  <img src="screenshots/promo/attention-screenshot.png" alt="Onhand explaining scaled dot-product attention with page highlights, notes, and a sidebar answer" width="960">
</p>

<p align="center"><em>Onhand grounding an explanation in the page the user already has open.</em></p>

The intended experience is:
- invoke Onhand from a global shortcut
- ask a question about the page, PDF, file, or material already in front of you
- have Onhand point to the relevant place, scroll to it, highlight it, and explain it in context
- save the session so it can be replayed later with the relevant artifacts restored

## Current status

This branch makes the browser extension the primary Onhand runtime:

1. the Chromium extension hosts the side panel UI
2. `@mariozechner/pi-agent-core` and `@mariozechner/pi-ai` are bundled into the extension
3. sidebar messages route to an in-extension runtime controller
4. browser tools call the existing extension command handlers directly
5. direct sign-in and API-key auth are configured from the extension options page
6. sessions and runtime settings are stored in `chrome.storage.local`

## Browser-only direction

The intended direction is to make the browser extension the whole Onhand runtime. The Electron desktop app and localhost bridge are now legacy paths; the side panel can submit prompts without starting either one.

See:

- `docs/BROWSER_ONLY_MIGRATION.md`

The broader product plan lives in:

- `docs/ONHAND_PLAN.md`

## Current repository layout

- `apps/desktop/` - legacy Electron desktop shell for Onhand
- `docs/ONHAND_PLAN.md` - product and implementation plan
- `packages/browser-bridge/` - legacy local HTTP + WebSocket bridge server
- `packages/browser-extension/` - unpacked Chromium extension and browser-hosted Pi runtime
- `packages/pi-extension/` - legacy pi extension tools for the browser bridge

## Security model

- browser-only mode stores the selected OpenAI auth mode, model, API key, and Codex sign-in refresh token in extension local storage
- the extension calls the provider API directly from the extension runtime
- direct sign-in currently supports only OpenAI Codex OAuth with `openai-codex` / `gpt-5.5`
- the legacy bridge still uses a bearer token and localhost WebSocket when manually used

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
- Preferred: use OpenAI Codex sign-in:
  - click `Sign in` in the OpenAI Codex Sign-In section
  - finish the opened OpenAI login tab
  - confirm Authentication is set to `OpenAI Codex sign-in`
  - confirm the model is `gpt-5.5`
- Fallback: use an OpenAI API key:
  - set Authentication to `OpenAI API key`
  - enter the OpenAI API key
  - choose an OpenAI API model if needed
  - Save

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

For a manual Chrome smoke, reload the unpacked extension, sign in with OpenAI Codex, confirm the options page shows `openai-codex` / `gpt-5.5` in the status JSON, then run the local fixture with `npm run serve:fixture`. Open `http://127.0.0.1:8765/` in Chrome, start a fresh Onhand side-panel session with a Chrome-specific title, and submit the read, interaction, debug, artifact, and network reload prompts there.

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

## Browser Runtime Tools

- `browser_list_tabs`
- `browser_activate_tab`
- `browser_navigate`
- `browser_extract_content`
- `browser_highlight_text`
- `browser_show_note`
- `browser_scroll_to_annotation`
- `browser_clear_annotations`
- `browser_get_visible_text`
- `browser_get_selection`
- `browser_get_viewport_headings`
- `browser_get_scroll_state`
- `browser_capture_state`
- `browser_list_artifacts`
- `browser_restore_state`
- `browser_find_elements`
- `browser_wait_for_selector`
- `browser_click`
- `browser_type`
- `browser_click_text`
- `browser_type_by_label`
- `browser_pick_elements`
- `browser_collect_console`
- `browser_collect_network`
- `browser_get_dom`
- `browser_capture_screenshot`
- `browser_run_js`

## Notes

- If you previously loaded the unpacked extension from the old top-level `browser-extension/` path, reload it from `packages/browser-extension/`.
- `chrome.debugger` is a powerful permission and may show a browser warning while attached.
- Some pages cannot be debugged, such as privileged browser pages.
- Session restore/replay is now best-effort for browser-only artifacts; full replay fidelity is still in progress.
- The legacy desktop, bridge, and pi-extension files are still present during this migration branch, but they are no longer required for the side-panel prompt path.

## Likely next steps

- remove the legacy desktop app, bridge server, pi extension, and bridge-based tests after the browser-only path is verified in Chrome
- stronger replay/restore fidelity beyond best-effort text matching
- move sessions/artifacts from `chrome.storage.local` to IndexedDB once transcripts and captured artifacts grow
- PDF/document support after the browser-grounded MVP is solid
