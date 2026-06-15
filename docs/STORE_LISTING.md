# Chrome Web Store listing copy

Source of truth for the Onhand store listing. Paste the sections below
into the Chrome Web Store dashboard when updating the listing.

## Summary (132-character field)

Ask about any webpage or PDF and get answers anchored to the source —
highlights, notes, citation chasing. Free to try.

## Detailed description

Onhand is a page-grounded AI tutor for learning and research. Open the
side panel on any webpage or PDF, ask a question, and Onhand answers
from the material in front of you — and shows you where, highlighting
the exact passages it used right on the page.

Free to try: no API key, no account. The built-in Onhand Free tier
works the moment you install, with a daily usage cap. For more, sign in
with OpenAI Codex or bring your own API key (OpenAI, Anthropic, Google
Gemini, or any OpenRouter model).

WHAT IT DOES

— Answers anchored to the source. Every explanation points at the
passage that supports it, with highlights and margin notes instead of a
detached chat transcript.

— Reads PDFs properly. A built-in viewer handles research papers and
large documents, with highlights and notes that work the same as on
webpages.

— Chases citations. Ask "what does [14] actually say?" and Onhand finds
the reference, opens the cited paper, and anchors the answer inside it.

— Compares sources. Ask how the paper you're reading relates to another
open tab, and each claim is highlighted in the source it came from.

— Helps you actually learn. Learning mode adds quick comprehension
checks as you read and tracks the concepts you've covered, instead of
just handing over answers.

— Voice mode. Ask aloud while keeping your eyes on the page (uses an
OpenAI API key).

Study sessions are saved locally in your browser, so you can close a
paper and pick the conversation back up later.

Privacy note: Onhand reads the active page only to answer your request,
annotate the page, and save your local session. In API-key and Codex
sign-in modes, request content goes to your selected provider. In Onhand
Free mode, request content goes through Onhand's hosted Cloudflare
Worker to OpenRouter; anonymous diagnostics are required for reliability,
quota, cost, and abuse monitoring. Diagnostics and explicit error
reports do not include prompts, page content, URLs, screenshots,
transcripts, saved sessions, or keys.

Onhand is designed for students, researchers, and deep readers who want
explanations grounded in the source they're reading — not a chatbot in
another tab.

Open source: github.com/Phineas1500/Onhand

## Chrome Web Store privacy fields

Use these as the source text for the Developer Dashboard privacy and
review fields. Keep this consistent with `website/privacy.html`.

### Single purpose

Onhand is a contextual learning and research assistant that reads the
active webpage or PDF at the user's request, answers questions from that
source, and adds highlights, notes, and saved local study sessions.

### Permission justifications

`tabs`

Used to identify the active tab, show tab titles in the side panel, and
switch tabs only when the user asks Onhand to use another open source.

`storage`

Used to store extension settings, authentication mode, provider
configuration, anonymous free-tier token, saved sessions, highlights,
notes, and local replay artifacts.

`unlimitedStorage`

Used because saved study sessions may include local page snapshots,
screenshots, transcripts, highlights, notes, and PDF artifacts.

`debugger`

Used to inspect and annotate pages, collect console/network diagnostics
when the user asks for debugging help, support PDF-reader frames, and
capture visible page regions. Onhand attaches only while performing a
user-requested browser action.

`sidePanel`

Used to provide the Onhand chat, learning, voice, and session UI inside
Chrome's side panel.

`offscreen`

Used for extension-owned background processing needed by the browser
runtime and media/session flows.

`scripting`

Used to inject bundled Onhand page tools into the active tab so Onhand
can read visible text, highlight passages, add notes, capture state, and
restore saved annotations.

`webNavigation`

Used to track page/frame navigation state for page reading, PDF viewer
handoff, and annotation restore.

Host permissions: `http://*/*`, `https://*/*`, `http://localhost/*`,
`http://127.0.0.1/*`, `file:///*`

Used so Onhand can work on the webpage or PDF the user opens, including
local development pages and user-opened local files when Chrome grants
file URL access. Onhand reads page content only for user-facing page
assistance, annotation, debugging, or saved-session restore.

### Remote code declaration

For the next store build, Onhand keeps `browser_run_js` as a constrained,
model-facing runtime-state escape hatch. It is selected only for explicit
JavaScript/runtime-state requests or complex client-side pages where safer
browser tools cannot answer the user-facing question. The model instructions
require it to stay read-only unless the user explicitly asks for page
interaction, and to avoid cookies, storage, secrets, payment fields, or
unrelated page data. Users can disable this capability from the options
page with **Allow advanced runtime inspection for complex websites**.

Reviewer note text:

Onhand includes a constrained advanced runtime-inspection tool for complex
client-side websites. The tool can run read-only JavaScript on the active
page only when the user explicitly asks for JavaScript/runtime-state
inspection or when normal page-reading, DOM, screenshot, console, network,
and selector tools cannot answer the user's question. It is not used for
ordinary page/PDF Q&A, Learning Mode, or generic console/network debugging.
Users can disable it in options. Anonymous diagnostics record only
started/succeeded/failed event names for this tool; diagnostics never
include JavaScript expressions, prompts, page content, URLs, screenshots,
saved sessions, transcripts, or keys.

Onhand bundles its Sentry SDK locally. It does not load the remote Sentry
loader script in the store build. Sentry receives only redacted crash and
exception events when anonymous diagnostics are enabled, plus a redacted
event when the user explicitly clicks "Send anonymized error report".

Onhand should not load or execute remotely hosted JavaScript bundles in
the store build. The extension package includes its runtime, page tools,
PDF viewer, and vendor assets. Remote AI APIs and the Onhand Free Worker
are data/model endpoints, not remotely hosted extension code.

Review note: Chrome's remote-hosted-code guidance treats JavaScript or
WASM executed from outside the extension package as sensitive, including
some `chrome.debugger` execution patterns. Because `browser_run_js` remains
available to remote model output in constrained circumstances, disclose this
clearly in reviewer notes and ask Chrome Web Store support for guidance if
the dashboard remote-code field is ambiguous.

### Data usage disclosure

Disclose collection/handling of:

- Website content: visible page text, selected text, PDF text, headings,
  page screenshots or visible-region captures when needed for visual
  grounding, and page URLs/titles for source context.
- Personal communications: only when the user chooses to run Onhand on
  webmail, chat, messaging, or similar pages.
- Location: request IP address for short-lived Onhand Free, diagnostics,
  and explicit error-report rate limits, plus aggregate country/Cloudflare
  data center metadata for operations.
- User activity: user prompts, learning-mode responses, extension
  actions, tool activity names/states, diagnostics event names, and
  aggregate counts.
- Authentication information: provider API keys and OpenAI Codex sign-in
  state, stored locally in extension storage when the user chooses those
  modes.
- User-generated content: saved highlights, notes, transcripts, local
  study sessions, and replay artifacts.

Data use certifications:

- Onhand does not sell user data.
- Onhand does not use extension data for advertising or creditworthiness.
- Onhand uses page content only to provide user-facing page assistance,
  annotations, PDF support, debugging, voice tutoring, and saved-session
  restore.
- In direct-provider modes, request content is sent to the provider the
  user selected. In Onhand Free mode, request content goes through
  Onhand's hosted Cloudflare Worker to OpenRouter.
- Anonymous diagnostics, Sentry crash events, and explicit error reports
  exclude prompts, page content, URLs, page titles, screenshots, saved
  sessions, transcripts, and keys.
