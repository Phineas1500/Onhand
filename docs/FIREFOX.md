# Firefox

Onhand runs in Firefox from the same source as Chrome. `npm run package:firefox` builds `dist/onhand-v<version>-firefox.zip` for addons.mozilla.org (AMO), with Onhand Free configured the same way as the Chrome package (see `docs/FREE_TIER.md`).

## What the Firefox package changes

`scripts/package-extension.mjs` stages the extension and rewrites the manifest (`toFirefoxManifest`):

- **Name:** "Onhand: Chat with PDFs, Answers Highlighted". AMO caps names at 45 characters, and the Chrome name is longer.
- **Add-on ID:** `onhand@useonhand.com`. It is permanent once the add-on is published on AMO.
- **Background:** a module background script (`background.scripts`) instead of a service worker.
- **Data collection:** `data_collection_permissions`, which AMO requires. Page content is required, because it goes to the chosen AI provider; technical data is optional, because Onhand Free's diagnostics are anonymous.
- **Permissions dropped:** `debugger`, `sidePanel` and `offscreen`, which Firefox doesn't implement.
- **Host access:** `host_permissions` is `<all_urls>`. Firefox's `tabs.captureVisibleTab` needs it.
- **Keyboard shortcut:** `_execute_sidebar_action`, so the shortcut opens Firefox's sidebar.

The runtime bundle is minified (`ONHAND_RUNTIME_MINIFY=1`) because AMO won't parse JavaScript files over 5 MB. AMO needs the source code and build steps for minified code. The repository plus `npm ci && npm run package:firefox` covers that.

## How the shared code handles Firefox

- **Side panel:** Firefox shows `sidepanel.html` through the manifest's `sidebar_action`, and `sidebar.js` treats `moz-extension:` pages as the native panel. Firefox only opens or closes its sidebar during a user action:
  - The toolbar button toggles it with `browser.sidebarAction` before awaiting anything.
  - The panel's close button calls `sidebarAction.close()` itself.
  - The panel tells the background it closed on `pagehide`, since Firefox has no `onClosed` event.
- **Debugger:** `chrome.debugger` doesn't exist in Firefox. `background.js` routes debugger calls through `debuggerApi`, which rejects cleanly there, so the existing scripting fallbacks run. Without a debugger, page evaluations that a page's content security policy blocks in the main world are retried in the extension's isolated world. That world can read the DOM but not the page's own JavaScript globals.
- **Page toolkit:** in Firefox it is loaded from `page-toolkit-content.js` before each call instead of being evaluated from source, which was slow enough on long pages to time out. The generated file ends with `void 0;` because Firefox rejects an injected file whose result can't be cloned.
- **PDFs:** Firefox's built-in PDF viewer can't be scripted, so Onhand's viewer can't be laid over it. The tab switches to Onhand's own viewer instead (`pdf-viewer.html`).
- **Local PDFs:** Firefox extensions can't read `file://` URLs at all. Opening a local PDF switches the tab to Onhand's viewer, which asks the reader to choose the file or drop it there. The tool reports that as its error, so Onhand tells the reader to choose the file and stops trying PDF tools. Annotations stay keyed to the original `file://` address, as in Chrome, so a restored session asks for the file again.
- **Own pages:** checks that recognize Onhand's own pages, and diagnostic redaction, accept `moz-extension:` addresses as well as `chrome-extension:`.

## Known gaps

- **Lost to the debugger:** features that only work through it, such as reading a selection from Chrome's own PDF viewer or Google Scholar's reader, and copying a Google Docs selection.
- **Clipboard probe:** the offscreen-document clipboard probe is skipped.
- **Local HTML pages:** `file://` pages other than PDFs can't be read.
- **Not tested yet:** voice, ChatGPT sign-in and Google Docs.

## Testing

Load the build in Firefox from `about:debugging` → This Firefox → Load Temporary Add-on, and pick `manifest.json` from the unzipped package. Then open the sidebar with the toolbar button.

The 2026-10-17 automated run used Firefox 158, the packaged build and Onhand Free. These all passed:

- page reading and `browser_run_js`;
- a highlight with a margin note;
- recovery from a missing passage;
- reading and highlighting another open tab;
- Learning mode;
- a screenshot;
- a web PDF, through Onhand's viewer;
- a local PDF, chosen in the viewer.

Tests over WebDriver BiDi with system access also confirmed the real sidebar:
- the toolbar action toggles it open and closed;
- it shows `sidepanel.html`;
- ⌘⇧Space (Ctrl+Shift+Space elsewhere) is registered for `_execute_sidebar_action`.

Automated runs should seed the Onhand Free test-device token (`ONHAND_FREE_TIER_TEST_TOKEN`) and tag prompts with a test source, as the Chrome launch scripts do. Otherwise every fresh profile registers a new Free device.

Chrome's CI suites and the live acceptance suite also passed on the same branch.
