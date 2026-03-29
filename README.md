# pi-browser-bridge

A local browser bridge for pi built from three pieces:

1. a Chromium extension that uses `chrome.debugger`
2. a localhost bridge server
3. a pi extension that exposes browser tools inside pi

## Why this exists

This avoids `--remote-debugging-port=9222`.

Instead of relaunching the browser in DevTools mode, the browser extension attaches to tabs with the `chrome.debugger` API and talks to a local bridge over WebSocket. The pi extension talks to that bridge over HTTP.

## Current MVP

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
- pi tools for the above

## Project layout

- `bridge/server.mjs` - local HTTP + WebSocket bridge
- `browser-extension/` - unpacked Chromium extension
- `pi-extension/index.ts` - pi extension tools

## Security model

- bridge binds to `127.0.0.1`
- bridge uses a bearer token stored in `~/.config/pi-browser-bridge/config.json`
- browser extension connects with that token over WebSocket
- pi extension reads the same config file by default

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
- Load unpacked extension from `browser-extension/`
- Open the extension options page
- Set:
  - Bridge URL: `ws://127.0.0.1:3210/ws`
  - Token: paste the token from `npm run bridge:token`
- Save

If Helium supports Chromium extensions and the `chrome.debugger` API, it should work there too.

### 4. Load the pi extension

For local development:

```bash
pi -e ./pi-extension/index.ts
```

Or install this folder as a pi package:

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

Also includes the command:

- `/browser-bridge-status`

## Notes

- `chrome.debugger` is a powerful permission and may show a browser warning while attached.
- Some pages cannot be debugged, such as privileged browser pages.
- Screenshots currently activate the target tab before capture.
- The bridge currently sends commands to the first connected browser client unless a specific client is added later.

## Likely next steps

- browser/client selection when multiple browsers are connected
- richer content extraction and page-structure helpers
- smarter action tools (click nearest matching button, submit forms, wait for navigation)
- richer network features like targeted response-body capture for specific requests
- release hardening and browser-store packaging
