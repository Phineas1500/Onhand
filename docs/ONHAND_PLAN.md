# Onhand Product + Implementation Plan

## 1. Vision

Onhand is an AI learning and research assistant that helps users understand what is already in front of them instead of pulling them away into a separate chat window.

The core experience is:

1. the user invokes Onhand from a global keyboard shortcut
2. a small command-palette-style input appears
3. the user asks a question about what they are reading or working on
4. Onhand inspects the relevant material already open on the computer
5. Onhand moves to the relevant tab/page/section, highlights the exact part that matters, scrolls it into view, and explains it with anchored notes/popups
6. the session is saved and can later be replayed with the source material and annotations restored

This is not primarily a chatbot. It is a **contextual tutor / research copilot**.

---

## 2. Product Principles

### 2.1 Stay in context
Onhand should prefer using the material already open on screen before opening new pages or giving a detached answer.

### 2.2 Point, don’t just tell
When possible, Onhand should:
- highlight the exact sentence/paragraph/figure/control it is referring to
- scroll the relevant content into view
- attach short explanations near the relevant content

### 2.3 Teach, not just answer
Responses should help the user understand:
- what part of the source matters
- why it matters
- how it connects to the question
- what other nearby content supports or changes the interpretation

### 2.4 Preserve provenance
Onhand should remember:
- which tabs/files/PDF pages it used
- what it highlighted
- what notes it showed
- what state the material was in during the session

### 2.5 Prefer semantic integrations over generic computer-use
For core workflows, use structured adapters for:
- browsers
- PDFs
- files/editors
- macOS workspace state

Use generic computer-use only as a fallback for unsupported apps or edge cases.

---

## 3. Target Users and Primary Use Cases

### 3.1 Students
- “What does this paragraph mean?”
- “Show me where this definition is used later on the page.”
- “Explain this proof step using the surrounding text.”
- “Compare what this lecture note says to the textbook tab I already have open.”

### 3.2 Researchers
- “Which section of this paper supports this claim?”
- “Summarize the differences between these two sources.”
- “Follow the citation trail and open the most relevant source.”
- “Show me where this concept is introduced in the PDF and where it is applied later.”

### 3.3 General knowledge work
- “Explain this policy/contract/technical doc in plain language.”
- “Point me to the important part of this page.”
- “Compare what I’m reading with the related tab.”

---

## 4. Scope Decisions

## In scope for v1
- current-browser tutoring workflow
- global hotkey + command palette
- browser tab/page awareness
- highlight + scroll + anchored explanation notes
- browser session saving + replay
- project grouping for sessions

## In scope soon after v1
- PDF support
- local document/file support
- richer multi-tab workflows
- session replay viewer inside app

## Not a v1 goal
- full generic desktop automation across every macOS app
- perfect replay of arbitrary third-party web apps without storing snapshots
- replacing a web browser or PDF viewer entirely

---

## 5. Recommended Technical Direction

## 5.1 App shell
**Recommendation: Electron for v1**.

Why:
- easiest way to embed pi’s SDK directly
- global shortcut support
- command palette UI is straightforward
- session replay UI can be built quickly
- browser/PDF rendering can live in the same app later

Longer-term, if native macOS polish becomes a priority, keep the core logic in reusable Node packages so a Swift wrapper or native shell can be added later.

## 5.2 Agent engine
Use **pi’s SDK** as the agent runtime.

Why:
- custom tools are the core of Onhand
- tree-structured session persistence is a strong fit
- programmatic control over sessions, tools, prompts, and events
- easier than trying to bolt a full product UI on top of the terminal app itself

## 5.3 Session persistence
Use **pi SessionManager** for conversation state, branching, and agent messages.

Add **Onhand-specific artifact storage** alongside pi sessions for replay.

This means:
- pi JSONL stores the reasoning/conversation tree
- Onhand artifacts store workspace state, anchors, annotations, and snapshots

## 5.4 Core adapters
Onhand should be built around adapters:
- **Browser adapter**: current Chromium extension + localhost bridge
- **PDF adapter**: controlled PDF viewer (PDF.js recommended for v1/v2)
- **File/editor adapter**: file path + selected text + line/section anchors
- **Workspace adapter**: macOS Accessibility-based app/window/selection awareness
- **Computer-use fallback**: later, for unsupported apps and edge cases

---

## 6. Architecture

```text
Onhand App (Electron)
├── UI Layer
│   ├── global hotkey
│   ├── command palette
│   ├── anchored note overlays
│   ├── session browser
│   └── replay viewer
│
├── Agent Layer
│   ├── pi SDK session
│   ├── Onhand system prompt / behavior rules
│   ├── tool orchestration
│   └── project/session routing
│
├── Adapter Layer
│   ├── browser adapter
│   ├── PDF adapter
│   ├── file/editor adapter
│   ├── workspace adapter
│   └── computer-use fallback
│
└── Storage Layer
    ├── pi session JSONL
    ├── Onhand project index
    ├── browser/document snapshots
    ├── annotation records
    └── screenshots / extracted artifacts
```

---

## 7. Storage Model

## 7.1 Projects
Projects group related sessions.

Suggested shape:

```json
{
  "id": "proj_123",
  "name": "History Seminar",
  "rootPaths": ["/Users/.../Class/History"],
  "createdAt": "...",
  "updatedAt": "..."
}
```

## 7.2 Sessions
Each Onhand session should have:
- a pi JSONL session
- metadata
- artifacts directory

Suggested storage layout:

```text
~/Library/Application Support/Onhand/
  projects/
    <project-id>/
      project.json
      sessions/
        <session-id>/
          pi-session.jsonl
          metadata.json
          artifacts/
            browser/
            documents/
            screenshots/
            notes/
```

## 7.3 Browser artifact snapshot
For replay, save more than the live URL.

Suggested browser snapshot fields:

```json
{
  "type": "browser_snapshot",
  "timestamp": "...",
  "tabId": "browser-local-id",
  "url": "https://...",
  "title": "...",
  "scrollX": 0,
  "scrollY": 1320,
  "viewport": { "width": 1440, "height": 900 },
  "htmlPath": "artifacts/browser/....html",
  "screenshotPath": "artifacts/screenshots/....png"
}
```

## 7.4 Annotation record
Annotations should be stored as explicit records.

Suggested shape:

```json
{
  "id": "ann_123",
  "surface": "browser",
  "surfaceId": "tab-or-document-id",
  "anchor": {
    "kind": "text-quote",
    "exact": "The video marked the end of the 823-episode series",
    "prefix": "titled \"Thanks For Watching\".",
    "suffix": "and it received 1.7 million views",
    "selector": "p:nth-of-type(12)"
  },
  "style": {
    "highlight": "yellow",
    "outline": "red"
  },
  "note": {
    "text": "This sentence answers your question because it explicitly states when and how the series ended."
  }
}
```

## 7.5 Use pi custom entries for replay metadata
Onhand-specific events should be persisted as pi `custom` entries where useful, with larger snapshots stored as sidecar files.

Recommended custom entry types:
- `onhand/project_context`
- `onhand/browser_snapshot`
- `onhand/document_snapshot`
- `onhand/annotation`
- `onhand/ui_note`
- `onhand/replay_marker`

---

## 8. Agent Behavior Contract

Onhand’s default behavior should be guided by these rules:

1. **Start from the user’s current context.**
2. **Prefer visible/open material before opening new sources.**
3. **When answering, point to the exact source region.**
4. **Highlight and scroll before or alongside explanation when helpful.**
5. **Use short anchored notes rather than long detached answers when possible.**
6. **Open new tabs/files only when clearly useful.**
7. **Preserve source traceability.**
8. **If uncertain, ask the user to pick the relevant element/page rather than guessing.**

---

## 9. What to Add to the Browser Tooling

The browser adapter is already strong. To support the full Onhand vision, it needs first-class support for anchoring, notes, and replay.

## 9.1 First-class annotation tools
These should become dedicated tools instead of ad hoc JS snippets.

Add:
- `browser_highlight_text`
- `browser_highlight_selector`
- `browser_clear_annotations`
- `browser_scroll_to_annotation`
- `browser_list_annotations`
- `browser_show_note`
- `browser_update_note`
- `browser_remove_note`

## 9.2 Viewport + visible-context tools
Add:
- `browser_get_selection`
- `browser_get_visible_text`
- `browser_get_viewport_context`
- `browser_get_scroll_state`
- `browser_get_nearby_headings`

These are important for questions like “explain what I’m looking at right now.”

## 9.3 Better anchoring primitives
Add stable browser anchors based on:
- exact text quote
- prefix/suffix context
- selector fallback
- section heading context
- last known DOM rect

## 9.4 Better interaction tools
Some already exist, but we should expand them:
- `browser_click_text`
- `browser_type_by_label`
- `browser_wait_for_navigation`
- `browser_submit_form`
- `browser_focus_window`
- `browser_compare_tabs`

## 9.5 Replay support
Add:
- `browser_capture_state`
- `browser_restore_state`
- `browser_export_dom_snapshot`
- `browser_restore_annotations`

## 9.6 Source-tracing helpers
Add:
- `browser_find_citations`
- `browser_open_reference`
- `browser_open_background_source`
- `browser_compare_visible_source_to_tab`

---

## 10. PDF / Document Strategy

## 10.1 Recommendation
Do **not** rely on generic computer-use for PDFs as the primary approach.

Use a dedicated PDF surface, ideally:
- **PDF.js** inside the app or a controlled web surface for v1/v2
- optional native PDFKit integration later if needed

## 10.2 Why
You need:
- page numbers
- text extraction
- precise anchors
- rects for highlights and notes
- reliable replay

These are much easier in a semantic PDF layer than through generic UI automation.

## 10.3 PDF tools to add later
- `pdf_open`
- `pdf_get_visible_text`
- `pdf_find_text`
- `pdf_highlight_text`
- `pdf_show_note`
- `pdf_scroll_to_anchor`
- `pdf_extract_section`
- `pdf_capture_state`
- `pdf_restore_state`

---

## 11. Should Onhand Have Computer-Use?

**Yes, but not as the main abstraction.**

## Recommendation
Use this stack:

1. browser adapter first
2. PDF/document adapter second
3. macOS Accessibility-based workspace adapter third
4. generic computer-use fallback fourth

## Why
Generic computer-use is useful, but for learning/research it is usually worse than semantic access because it is:
- slower
- more brittle
- harder to anchor precisely
- harder to replay faithfully

## Best use for computer-use
- unsupported native apps
- weird one-off workflows
- fallback clicking/focusing
- opening windows/apps when no semantic adapter exists

---

## 12. MVP Definition

## Browser-first Onhand MVP
The first true product milestone should satisfy all of these:

### User flow
1. User presses the global shortcut.
2. Onhand command palette appears.
3. User asks a question about the current browser page.
4. Onhand identifies the relevant part of the current tab.
5. Onhand highlights it and scrolls it into view.
6. Onhand shows a nearby explanation note.
7. Session is saved.
8. User can later open the session in the app and replay the page + note + chat.

### Acceptance criteria
- works on a normal web page in the connected browser
- uses the user’s current tab/session state
- does not require the user to manually navigate to the relevant text
- restores session artifacts during replay
- supports branching follow-up questions via pi session tree

---

## 13. Implementation Phases

### 13.1 Current implementation checkpoint (2026-03-29)

Completed so far:
- repo refactor to an Onhand-centered layout under `packages/`
- minimal Electron desktop shell under `apps/desktop/`:
  - windowed app shell with a command-palette-style input
  - temporary global shortcut (`CommandOrControl+Shift+Space`)
  - live browser-context preview via the local browser bridge
  - prompt submission stubbed in the shell while pi SDK session wiring is still pending
- first-class browser annotation tools:
  - `browser_highlight_text`
  - `browser_show_note`
  - `browser_scroll_to_annotation`
  - `browser_clear_annotations`
- lightweight browser state capture with `browser_capture_state`
- first-pass browser artifact persistence:
  - writes captured browser state to `.onhand/artifacts/browser/<artifact-id>/state.json`
  - writes HTML snapshots to `.onhand/artifacts/browser/<artifact-id>/page.html`
  - writes screenshots to `.onhand/artifacts/browser/<artifact-id>/screenshot.png`
  - appends a session-linked pi custom entry of type `onhand/browser-capture`
  - maintains a lightweight artifact index at `.onhand/artifacts/browser/index.json`
- first-pass browser restore support:
  - restores persisted annotations from a saved browser artifact via `browser_restore_state`
  - re-applies highlights/notes to a live page using best-effort text-based matching
  - scrolls the restored annotation back into view
  - can resolve artifacts by saved path or artifact id through the artifact index/loader
- visible-context helpers:
  - `browser_get_visible_text` captures the text currently visible in the viewport so Onhand can answer questions about what the user is looking at right now
  - `browser_get_selection` captures the user's current text selection so Onhand can explain exactly what the user highlighted
  - `browser_get_viewport_headings` captures the current and nearby headings so Onhand can understand the user's section context on the page
  - `browser_get_scroll_state` captures the current scroll position and page progress so Onhand can reason about where the user is within a long page
- repeated end-to-end testing in the connected live browser, including:
  - highlight target text on the page
  - show an anchored note near the highlighted content
  - scroll back to the annotation so the user can see it
  - capture current page state including scroll position, highlight metadata, and note metadata
  - persist captured state + HTML snapshot + screenshot to disk
  - verify session-link metadata is produced for persistence
  - clear injected annotations and verify they are gone
  - restore a saved artifact back onto the live page and verify the highlight + note reappear
  - verify visible viewport text capture against the live page around the highlighted section
  - verify selection capture against a live selection on the page
  - verify viewport heading capture against the live section surrounding the highlighted content
  - verify scroll-state capture against the live page's current scroll position/progress
  - verify indexed artifact listing and restore-by-artifact-id using the local artifact index/loader

Current status:
- Phase 0 is in progress but the core browser-grounding primitives now exist and are working reliably enough to build on.
- Phase 14.3 has started with a minimal desktop shell, but prompt routing still needs to be wired into a real pi SDK session.
- There is still no session browser or replay UI.

Most important next step:
- connect the desktop-shell prompt flow to a real pi SDK session while reusing the existing browser tools.

## Phase 0 — Stabilize current browser bridge
Goal: make the current prototype a reliable subsystem.

Tasks:
- formalize browser tool contracts
- add first-class annotation/highlight/note tools
- add visible-context helpers
- add browser state snapshot + restore hooks
- add explicit artifact persistence

Exit criteria:
- browser highlights/notes are not ad hoc
- enough metadata is persisted for replay

## Phase 1 — Browser grounded tutoring MVP
Goal: answer questions on current web pages with visible grounding.

Tasks:
- global command palette prototype
- embedded pi SDK session runtime
- Onhand system prompt + tool policies
- highlight + scroll + note workflow
- save browser snapshot + annotation records
- replay simple browser sessions in-app

Exit criteria:
- complete end-to-end browser tutoring demo works reliably

## Phase 2 — Session browser + replay UI
Goal: make sessions a core feature, not just saved logs.

Tasks:
- project list UI
- session list UI
- replay viewer with chat + browser snapshot + annotations
- restore branch history and follow-ups
- show source tabs used during the session

Exit criteria:
- a user can reopen a past session and understand what happened visually

## Phase 3 — PDF support
Goal: support real studying/research beyond ordinary webpages.

Tasks:
- controlled PDF viewer integration
- PDF anchoring/highlighting/notes
- PDF session capture and replay
- browser/PDF mixed-source sessions

Exit criteria:
- a user can ask about a PDF passage and see the explanation anchored to the PDF

## Phase 4 — Multi-source research workflows
Goal: support comparison, citation chasing, and open-source reasoning.

Tasks:
- compare current tab to another tab
- open supporting sources in background tabs
- annotate which source supports which claim
- add side-by-side note/reasoning UI

Exit criteria:
- useful for paper/article/source comparison workflows

## Phase 5 — Workspace-wide context + computer-use fallback
Goal: extend beyond browser/PDF when necessary.

Tasks:
- macOS Accessibility adapter
- frontmost app/window awareness
- selected text from supported apps
- file/document open/switch helpers
- generic computer-use fallback for unsupported apps

Exit criteria:
- Onhand can help across a broader set of apps without sacrificing stability for core workflows

---

## 14. Immediate Next Implementation Tasks

These are the next tasks to implement, in order.

### 14.1 Convert browser highlights into first-class tools — completed
Completed:
- [x] `browser_highlight_text`
- [x] `browser_clear_annotations`
- [x] `browser_show_note`
- [x] `browser_scroll_to_annotation`

Also added:
- [x] `browser_capture_state` as the first lightweight persistence/replay primitive

### 14.2 Persist browser annotations and snapshots — in progress
Started:
- [x] capture current page state, scroll position, viewport, highlight metadata, and note metadata via `browser_capture_state`
- [x] define a first-pass artifact schema in `state.json`
- [x] save HTML snapshots alongside captured state
- [x] save session-linked metadata via custom entry type `onhand/browser-capture`
- [x] add a first-pass restore hook with `browser_restore_state`
- [x] add screenshot capture alongside the saved state/HTML snapshot
- [x] add a lightweight artifact index/loader and `browser_list_artifacts`

Remaining:
- [ ] decide on final artifact storage/index format beyond the first-pass `.onhand/artifacts/browser/` layout
- [ ] improve restore fidelity beyond best-effort text-based matching
- [ ] decide whether persisted annotation records should also be emitted as richer custom messages/renderable session artifacts

### 14.3 Build minimal Onhand app shell — in progress
Started:
- [x] create Electron app under `apps/desktop/`
- [x] add temporary global shortcut (`CommandOrControl+Shift+Space`)
- [x] add command-palette-style input + session area
- [x] show live browser-context preview from the bridge inside the shell

Remaining:
- [ ] route shell prompt submission to a real pi SDK session
- [ ] decide how the shell should manage session/project selection before the full replay UI exists

### 14.4 Add replay MVP
- session list
- open session
- replay saved browser state from artifacts
- render chat + annotations together

### 14.5 Add visible-context tools — in progress
Started:
- [x] visible text via `browser_get_visible_text`
- [x] current selection via `browser_get_selection`
- [x] viewport headings via `browser_get_viewport_headings`
- [x] scroll state via `browser_get_scroll_state`

Remaining:
- [ ] richer viewport structure if needed after app-shell work starts

These tasks are enough to start the actual product, not just the tooling prototype.

---

## 15. Suggested Repository Evolution

The repo now uses a minimal Onhand-centered layout without over-scaffolding too early.

Current relevant pieces:
- `apps/desktop/`
- `packages/browser-bridge/`
- `packages/browser-extension/`
- `packages/pi-extension/`
- `docs/`

Next structural additions should be added only when implementation requires them. The most likely next step is:

```text
apps/
  desktop/
packages/
  browser-bridge/
  browser-extension/
  browser-protocol/
  browser-tools/
  pi-extension/
docs/
```

That keeps the existing browser prototype usable while giving us a clean path toward the full Onhand app.

---

## 16. Risks and Open Questions

## Major risks
- replay fidelity for live websites that change over time
- note placement UX becoming visually cluttered
- extension/debugger limitations on some browser pages
- cross-app support becoming brittle if we rely too early on generic computer-use

## Open questions
- should the first app shell be Electron only, or Electron + separate helper process?
- do we want to save full HTML snapshots, MHTML, or both?
- how aggressive should automatic note placement be before falling back to a side panel?
- should replay use saved snapshots by default instead of trying to restore live pages?

## Current recommendation
- Electron app shell for v1
- save HTML snapshot + screenshot + structured annotations
- use live pages for active work, saved snapshots for replay
- use semantic adapters before generic computer-use

---

## 17. Bottom-Line Recommendation

Build Onhand in this order:

1. **Browser-first grounded tutoring MVP**
2. **Project/session replay UI**
3. **PDF support**
4. **Multi-source reasoning**
5. **Workspace-wide context + computer-use fallback**

The most important next implementation step is:

> make annotations/highlights/anchored notes first-class, persistent, and replayable.

That is the core of the product.
