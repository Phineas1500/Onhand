# Onhand

Onhand is a contextual AI assistant for learning and research. The goal is to help users understand what is already open on their computer instead of pulling them away into a separate chatbot interface.

The intended experience is:
- invoke Onhand from a global shortcut
- ask a question about the page, PDF, file, or material already in front of you
- have Onhand point to the relevant place, scroll to it, highlight it, and explain it in context
- save the session so it can be replayed later with the relevant artifacts restored

## Current status

This repository is now organized around **Onhand**, but the main implemented subsystem today is still the **browser grounding layer**:

1. a Chromium extension that uses `chrome.debugger`
2. a localhost bridge server
3. a pi extension that exposes browser tools inside pi

That stack already lets pi inspect and act on the user's current Chromium/Helium browser session without requiring `--remote-debugging-port`.

The broader product plan lives in:

- `docs/ONHAND_PLAN.md`

## Current repository layout

- `docs/ONHAND_PLAN.md` - product and implementation plan
- `packages/browser-bridge/` - local HTTP + WebSocket bridge server
- `packages/browser-extension/` - unpacked Chromium extension
- `packages/pi-extension/` - pi extension tools for the browser bridge

## Browser bridge MVP

Implemented right now:

- list browser windows and tabs
- activate/focus a tab
- navigate the current tab or open a URL in a new tab
- inspect cookies for a tab
- wait for a selector in a tab
- click or type by CSS selector
- find elements by visible text/label/placeholder
- click by visible text
- type by label/placeholder/aria-label
- interactive element picker overlay in the visible browser
- collect console messages, warnings, and exceptions from a tab
- collect network requests/responses/failures from a tab, with optional headers and response bodies
- run JavaScript in a tab via `Runtime.evaluate`
- fetch outer HTML via `DOM.getDocument` + `DOM.getOuterHTML`
- extract readable page content as markdown
- capture screenshots of a visible tab
- expose pi tools for the above

## Security model

- bridge binds to `127.0.0.1`
- bridge uses a bearer token stored in a local config file
- browser extension connects with that token over WebSocket
- pi extension reads the same config file by default

**Compatibility note:** the browser bridge currently still uses the legacy config path:

```text
~/.config/pi-browser-bridge/config.json
```

That keeps the current setup working while the repo structure and product direction shift toward Onhand.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Start the bridge

```bash
npm run bridge
```

On first start it creates:

```text
~/.config/pi-browser-bridge/config.json
```

To print the token/config later:

```bash
npm run bridge:token
npm run bridge:config
```

### 3. Load the browser extension

- Open your Chromium-based browser's extensions page
- Enable developer mode
- Load unpacked extension from `packages/browser-extension/`
- Open the extension options page
- Set:
  - Bridge URL: `ws://127.0.0.1:3210/ws`
  - Token: paste the token from `npm run bridge:token`
- Save

If Helium supports Chromium extensions and the `chrome.debugger` API, it should work there too.

### 4. Load the pi extension

For local development:

```bash
pi -e ./packages/pi-extension/index.ts
```

Or install this repository as a pi package:

```bash
pi install .
```

## Tools exposed in pi

- `browser_list_tabs`
- `browser_activate_tab`
- `browser_navigate`
- `browser_get_cookies`
- `browser_find_elements`
- `browser_wait_for_selector`
- `browser_click`
- `browser_type`
- `browser_click_text`
- `browser_type_by_label`
- `browser_pick_elements`
- `browser_collect_console`
- `browser_collect_network` (supports optional request/response headers and response bodies)
- `browser_run_js`
- `browser_get_dom`
- `browser_extract_content`
- `browser_capture_screenshot`
- `browser_highlight_text`
- `browser_show_note`
- `browser_scroll_to_annotation`
- `browser_clear_annotations`
- `browser_capture_state` (can persist `state.json`, `page.html`, and `screenshot.png` into `.onhand/artifacts/browser/`)
- `browser_restore_state`
- `browser_get_visible_text`
- `browser_get_selection`
- `browser_get_viewport_headings`
- `browser_get_scroll_state`

Also includes the command:

- `/browser-bridge-status`

## Notes

- If you previously loaded the unpacked extension from the old top-level `browser-extension/` path, reload it from `packages/browser-extension/`.
- `chrome.debugger` is a powerful permission and may show a browser warning while attached.
- Some pages cannot be debugged, such as privileged browser pages.
- Screenshots currently activate the target tab before capture.
- The bridge currently sends commands to the first connected browser client unless a specific client is added later.

## Likely next steps

- stronger replay/restore fidelity beyond best-effort text matching
- a small artifact index/loader on top of `.onhand/artifacts/browser/`
- more visible-context helpers for richer viewport structure
- Electron app shell for Onhand
- PDF/document support after the browser-grounded MVP is solid
