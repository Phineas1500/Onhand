# Agent Notes

- After changing `packages/browser-extension/` or rebuilding `packages/browser-extension/onhand-runtime.bundle.js`, use Computer Use to reload the unpacked Onhand extension in Chrome from `chrome://extensions` before live validation. If the page renders blank or the old service worker stays alive, close the Onhand side panel first and open `chrome://extensions` in a fresh Chrome tab/window before clicking reload.
- Without Computer Use (e.g. Claude Code, or while Codex delegation is off), reload over the browser's remote-debugging port instead: `npm run debug:reload-extension -- --port=<port>`. It runs the same `chrome://extensions` reload, so the old service worker is replaced.
