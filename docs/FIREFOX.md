# Firefox

Onhand runs in Firefox from the same source as Chrome. `npm run package:firefox` builds `dist/onhand-v<version>-firefox.zip` for addons.mozilla.org (AMO), with Onhand Free configured the same way as the Chrome package (see `docs/FREE_TIER.md`).

## What the Firefox package changes

`scripts/package-extension.mjs` stages the extension and rewrites the manifest (`toFirefoxManifest`):

- **Name:** "Onhand: Chat with PDFs, Answers Highlighted". AMO caps names at 45 characters, and the Chrome name is longer.
- **Add-on ID:** `onhand@useonhand.com`. It is permanent once the add-on is published on AMO.
- **Background:** a module background script (`background.scripts`) instead of a service worker.
- **Data collection:** `data_collection_permissions`, which AMO requires. Page content and browsing activity (the addresses and titles of pages Onhand reads) are required, because they go to the chosen AI provider. Technical data is optional, because Mozilla doesn't allow it to be required.
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
- **No model-written scripts:** Mozilla's policy forbids running code an add-on didn't ship, so `browser_run_js` is never offered in Firefox (`RUNTIME_JS_ALLOWED` in `src/browser-runtime.ts`) and the options page hides its switch. The background `run_js` command stays, because the runtime uses it for scripts it builds itself, such as restoring a saved page's scroll position. The remaining `eval` calls only run code Onhand builds itself, such as its page toolkit.
- **Diagnostics:** Firefox asks about technical data at install, and users can change it in about:addons. In Firefox that choice decides whether diagnostics, Sentry events and usage events are sent (`diagnosticsSharingAllowed`), in every mode. Onhand Free works either way. The options page shows Firefox's choice instead of Onhand's own switch. Explicit error reports stay user-initiated, as in Chrome.
- **Debugger fallback:** when the scripting path fails and there's no debugger to fall back to, the page tools report the scripting error instead of "no debugger".

## Known gaps

- **Lost to the debugger:** features that only work through it, such as reading a selection from Chrome's own PDF viewer or Google Scholar's reader, and copying a Google Docs selection.
- **Clipboard probe:** the offscreen-document clipboard probe is skipped.
- **Local HTML pages:** `file://` pages other than PDFs can't be read.
- **Page scripts:** questions about a page's live JavaScript state (what `browser_run_js` answers in Chrome) fall back to the page's text and HTML.
- **Form output text:** highlighting text inside some form elements fails. In the fixture, "Network idle" in an `<output>` element gave "No visible text matched"; Chrome's debugger fallback finds it.
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

## Publishing on addons.mozilla.org

Submit `dist/onhand-v<version>-firefox.zip` at addons.mozilla.org/developers as a listed add-on. The fields below are the listing; keep them in step with `docs/STORE_LISTING.md`.

- **URL slug:** `onhand-ai`. `onhand` belongs to an unrelated bookmarks add-on.
- **Name:** comes from the manifest.
- **Summary (250 characters):** Ask about any webpage, PDF or research paper and Onhand highlights the answer right on the page, with notes. Free, no sign-up, open source.
- **Categories:** Other, Search Tools. Similar add-ons, Sidenote included, use Other.
- **Homepage:** https://useonhand.com
- **Support site:** https://useonhand.com/support.html. Use the useonhand.com alias as the support email.
- **License:** Apache License 2.0.
- **Privacy policy:** https://useonhand.com/privacy.html, which has a Firefox paragraph.

**Description:**

> Onhand is a free, open-source AI reading assistant for Firefox. Ask a question about the webpage, PDF or research paper you're reading, and Onhand highlights the passage that answers it, leaves a note in the margin, and explains it in the sidebar. You check the answer against the source instead of trusting a chat transcript.
>
> Free to try: no API key, no account. Choose Onhand Free in the sidebar and start asking, with a daily limit. For more, sign in with your ChatGPT plan or use your own OpenAI, Anthropic, Google Gemini or OpenRouter key.
>
> - Chat with any webpage or PDF and see the source, highlighted on the page with a note beside it.
> - A built-in PDF viewer for papers, textbooks and long documents. For a PDF on your computer, choose or drop the file into the viewer.
> - Follows citations: ask what a reference like [14] says, and Onhand opens the cited paper and answers from it.
> - Compares sources across clearly related open tabs, highlighting each claim where it came from.
> - Learning mode asks guiding questions and quizzes you as you read, instead of handing over answers.
> - Study sessions stay in your browser, so you can reopen a paper and pick up where you left off.
>
> Onhand starts with the active page and may read clearly related open tabs; relevant page content goes to the AI provider you choose (through Onhand's hosted service for Onhand Free). Anonymous diagnostics are sent only if you allow technical data in Firefox. Source code: github.com/Phineas1500/Onhand

Voice is left out until it's tested in Firefox.

**Notes to reviewer:**

> Onhand is an AI reading assistant. The model's answers are turned into highlights and notes by the add-on's own page toolkit (page-toolkit-content.js), which runs on the page the user asks about.
>
> - Source: onhand-runtime.bundle.js is minified to stay under the 5 MB parse limit. The attached source archive is the repository. To build, use Node 20 or later and run `npm ci`, then `ONHAND_FREE_TIER_BASE_URL=https://onhand-free-tier.sriram-kiron.workers.dev/v1 npm run package:firefox`. The package is written to dist/. The runtime's TypeScript source is packages/browser-extension/src/browser-runtime.ts, and scripts/package-extension.mjs writes the Firefox manifest.
> - No remote code: the add-on never runs code the model writes. The model-written JavaScript tool that Chrome has is disabled in Firefox. The eval calls in background.js evaluate code the add-on builds itself (its page toolkit and fixed expressions with JSON-encoded arguments). The eval calls in the pdf.js files are Mozilla's pdf.js.
> - Data: page content and page addresses or titles go to the AI provider the user picks, or through Onhand's Cloudflare Worker to OpenAI for the free tier. Diagnostics are sent only when the technical-data permission is granted.
> - Testing: no account is needed. Open the sidebar, click "Try Onhand free", and ask a question on any article, for example "What's the main idea here? Highlight it."

**Source archive:** zip the repository at the submitted commit, for example `git archive --format=zip -o onhand-source.zip HEAD`.
