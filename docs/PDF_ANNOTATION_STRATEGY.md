# PDF Annotation Strategy

Status: implementation direction with controlled fixtures, an initial Onhand-owned PDF viewer slice, and a handoff path from direct/native PDF tabs.

## Decision

Keep the user-facing Onhand annotation model the same across websites and PDFs:

- highlight source text
- attach a short Onhand note to the source
- jump back to either the highlight or the note
- capture, review, and restore the annotation later

Do not implement PDF support by writing into Google Scholar PDF Reader's own highlights or comments. Treat Google Scholar PDF Reader as a compatible reading surface when possible, but keep Onhand annotations owned by Onhand.

The durable product path should be an **Onhand-owned PDF.js-style viewer**:

- the user-facing Onhand tools and sidebar stay the same as websites
- the active PDF surface exposes page DOM, selectable text layers, and stable page geometry to the existing PDF adapter
- Onhand owns highlights, notes, capture, restore, and source jumps
- Chrome's native PDF viewer is treated as unsupported when it exposes no scriptable text layer
- Google Scholar PDF Reader is best-effort compatibility, not the primary implementation dependency

The controlled PDF fixtures model third-party text-layer surfaces. The initial Onhand-owned viewer now renders a real PDF fixture through PDF.js and exposes the same page/text-layer contract for deterministic validation.

The implementation should introduce a PDF annotation adapter under the existing browser tool surface. The model should remain:

- `browser_get_visible_text`
- `browser_get_selection`
- `browser_highlight_text`
- `browser_show_note`
- `browser_scroll_to_annotation`
- `browser_capture_state`
- `browser_restore_state`

Those tools can dispatch internally to either the current HTML DOM adapter or a PDF adapter after detecting the active surface.

## Why

The current website annotation path works by finding visible DOM text, wrapping a `Range` in an inline span with `data-onhand-annotation-id`, inserting a note card into the page DOM, and restoring from captured `matchedText` plus note metadata.

PDFs need different anchors:

- page number
- text layer span or character offsets when available
- highlight rectangles in page coordinates
- current PDF zoom/viewport mapping
- PDF/document identity beyond the tab URL

Trying to wrap PDF viewer DOM text directly is fragile because PDF viewers often rebuild text-layer nodes during zoom, page virtualization, rotation, and scrolling. The stable thing to store is not the temporary DOM span; it is the PDF page, text quote, context, and normalized rectangles.

## Google Scholar PDF Reader

Google Scholar PDF Reader is useful as an early compatibility target because it already provides a PDF reading UI, selection behavior, and its own highlight/comment UX. Google documents that selecting text in Scholar PDF Reader opens a popup for highlights/comments, and that those highlights/comments are saved to Scholar Library.

That is evidence that the viewer has the semantic data needed for annotation, but it is not a reason to depend on its private storage or UI. Onhand should not click Scholar's highlight/comment controls or scrape Scholar's saved annotation model unless Google publishes a stable API for that purpose.

The same applies when a user has already made native Scholar highlights or comments. Those are useful visual context, but they are a separate annotation layer. Onhand should read around them, avoid extracting their comment popup text as PDF source content, and store only Onhand-created highlights/notes in Onhand state.

Use Scholar Reader for:

- reading visible PDF text
- deriving selection text and page/rect geometry
- aligning Onhand overlays with the visible PDF page
- coexisting with Scholar's native highlights/comments without treating them as Onhand state

Avoid:

- mutating Scholar Reader's own comments
- invoking Scholar Reader's highlight/comment toolbar as an implementation shortcut
- depending on undocumented class names as durable storage
- assuming Scholar's cloud sync is Onhand's source of truth

If a user also uses Scholar Reader's native annotation tools, Onhand should visually coexist with them. Onhand should only capture, restore, count, and jump to annotations that it created itself, identified by Onhand-owned overlay nodes and persisted Onhand anchors.

## Anchor Shape

Add a backward-compatible annotation shape for PDF captures:

```ts
type OnhandAnnotationSurface = "html" | "pdf";

interface PdfAnnotationAnchor {
  surface: "pdf";
  viewer: "google-scholar" | "pdfjs" | "chrome-pdf" | "unknown-pdf";
  document: {
    url: string;
    viewerUrl?: string;
    pdfUrl?: string;
    title?: string;
    fingerprint?: string;
    pageCount?: number;
  };
  pageNumber: number;
  matchedText: string;
  textQuote: {
    exact: string;
    prefix?: string;
    suffix?: string;
  };
  rects: Array<{
    pageNumber: number;
    x: number;
    y: number;
    width: number;
    height: number;
    coordinateSpace: "page-normalized";
  }>;
  occurrence?: number;
}
```

Keep existing fields such as `annotationId`, `kind`, `matchedText`, `rect`, and `note` so sidebar and replay code can stay mostly unchanged. PDF-only metadata should live under a new field such as `anchor` or `pdfAnchor`.

Normalized page coordinates are preferred over viewport coordinates because they survive zoom and window size changes. If the PDF page is rendered at a different scale later, the adapter can reproject the stored rectangles onto the current page element.

## Rendering Model

HTML pages should keep the current DOM wrapping behavior.

PDF pages should render Onhand-owned overlays:

- highlight overlays are absolutely positioned boxes over the PDF page
- note cards are Onhand DOM elements anchored near the first highlight rect
- every overlay carries `data-onhand-annotation-id`
- `scroll_to_annotation` scrolls the PDF page container to the stored page and rect
- `clear_annotations` removes only Onhand overlay nodes

This keeps the visual behavior similar to websites while avoiding mutation of the PDF viewer's transient text-layer spans.

## Adapter Detection

Add a small detection layer before running page annotation methods:

1. If the current page is the Onhand/PDF.js-style viewer, use the PDF adapter with `pdfjs` anchors.
2. If the current page has any compatible PDF viewer text layer and a PDF-like URL/content type, use the PDF adapter.
3. If the current page looks like Google Scholar PDF Reader, use `google-scholar`.
4. If the current page is a PDF-like URL but exposes no readable text layer, return an unsupported-PDF result.
5. Otherwise use the existing HTML adapter.

Initial detection should be conservative. If PDF detection is uncertain, return a clear unsupported-PDF error rather than silently using approximate HTML matching.

## MVP

Build the first PDF MVP against text-based PDFs only.

Required tools:

- read selected PDF text
- read visible PDF text with page numbers
- highlight exact selected text or an exact visible text quote
- show a note anchored to that highlight
- scroll to highlight or note
- capture and restore the PDF annotation on the same viewer/session

Current implementation is at the existing page-toolkit seam:

- `browser_get_visible_text` can detect a PDF text-layer surface and return page-numbered PDF blocks while preserving the same browser tool API.
- `browser_get_selection` can preserve selected PDF text with viewer, page number, and normalized page-rect anchor metadata.
- selected PDF anchors are carried as request-local hints so a later `browser_highlight_text` call for the same text can reuse the original selection geometry instead of re-searching the PDF text layer.
- `browser_highlight_text` can dispatch to the same surface detector and render Onhand-owned PDF overlay highlights from text quote + page rect anchors.
- `browser_show_note` can attach an Onhand note card inside the PDF overlay layer.
- `browser_capture_state` preserves PDF anchor metadata alongside the existing annotation fields.
- `browser_restore_state` can pass saved PDF anchors back into `browser_highlight_text`, allowing restore to reproject page-normalized rects before falling back to text re-search.
- When a PDF is wrapped by a viewer page, PDF anchors preserve both the viewer URL and the embedded/current PDF URL when detectable. This includes common PDF.js-style wrapper parameters such as `file=...pdf`, `url=...pdf`, and similar. The viewer URL remains useful for tab/session restore; the PDF URL is the document identity used by the annotation anchor.
- repeated text search prefers currently visible PDF pages before offscreen repeated matches.
- Google Scholar-like page regions can be treated as PDF pages when there is a PDF signal, even if the viewer does not expose PDF.js's exact `.textLayer` class. Normal website regions labelled "Page" remain HTML unless there is a PDF signal.
- PDF surfaces with no readable text layer are treated as unsupported for annotation instead of silently falling back to HTML highlighting. This avoids claiming source-grounded PDF behavior when Onhand can only see a wrapper page or native viewer shell.
- PDF text extraction excludes Onhand-owned overlay highlights and note cards, so Onhand notes do not become searchable/restorable as if they were source PDF text on viewers that require page-level text fallback.
- When a viewer exposes source-text containers such as selectable-text layers, prefer those over the whole page. Viewer UI such as native comment popups, color palettes, and toolbars should not become Onhand-visible PDF text.
- PDF anchors can contain multiple normalized page rects. Onhand renders those as multiple visual overlay segments while keeping one logical annotation, one note, and one captured/restored sidebar entry. If the original anchor page is virtualized away, Onhand can still rehydrate against another currently rendered page represented by the saved rects while preserving the original source page number in the anchor.
- existing PDF overlays are reprojected from normalized page coordinates when Onhand scrolls/captures annotations, and observed PDF pages are resynced on resize so highlights and notes can survive zoom-like page-size changes.
- PDF anchors and note text are kept in a page-local Onhand registry so overlays can be rehydrated when a viewer virtualizes and recreates a page DOM node. Onhand also observes page DOM mutations after a PDF annotation exists, so recreated pages can be rehydrated without waiting for a later explicit command.
- source jumps first rehydrate from the PDF registry. For multi-page anchors, Onhand can jump to any currently rendered page represented by the saved rects. If none of the anchor pages are currently rendered, Onhand asks the viewer to render the original source page through common page-number controls or `#page=N`; if that still fails, Onhand returns a nearest-rendered-page jump result instead of incorrectly treating the source as missing.
- the Onhand-owned viewer exposes PDF-specific retrieval tools for full-document work: search extracted text across rendered pages, read specific page ranges, jump to a page or matched text, and capture a page image for visual slide/equation grounding. These tools are additive to the normal highlight/note/capture surface, so a PDF answer can first locate offscreen evidence and then anchor it in the viewer.

The extension-owned viewer milestone is now the primary product path:

1. Add `pdfjs-dist` or equivalent vendored PDF.js assets to the extension build.
2. Add `pdf-viewer.html` / `pdf-viewer.js` under `packages/browser-extension/`.
3. Open unsupported native PDF tabs by keeping the tab at the original PDF URL and injecting an Onhand-owned PDF viewer frame over the native PDF surface.
4. Render page canvases plus `.textLayer` DOM with stable `.page[data-page-number]` containers matching the current adapter contract.
5. Keep all annotation behavior in the existing page toolkit, so `browser_get_visible_text`, `browser_highlight_text`, notes, capture, restore, and sidebar source jumps do not need a separate user-facing PDF tool set.
6. Add manual acceptance for "Open in Onhand PDF viewer" from a native PDF tab, then run the same controlled highlight/note/restore matrix against the real viewer.

Items 1-5 are implemented in the current slice. The browser runtime exposes `browser_open_pdf_in_onhand_viewer`, which infers a direct PDF source from the active tab or a `file`/`url` query parameter, keeps or navigates the tab to that original PDF URL, injects `pdf-viewer.html?url=...` as an Onhand-owned frame, and then routes the normal visible-text, highlight, note, capture, restore, and source-jump tools into that frame. This keeps the user-visible tab URL canonical, such as `https://arxiv.org/pdf/2509.03345`, while still giving Onhand a stable PDF.js text layer. The older top-level `chrome-extension://<id>/pdf-viewer.html?url=...` path remains supported for already-saved artifacts and direct developer testing. The sidebar menu also exposes an `Open PDF` button for PDF-like active tabs, so the user has a deterministic handoff path even when the model would otherwise skip the tool. Item 6 remains part of Chrome acceptance because it depends on the currently loaded extension and the active Chrome profile.

Controlled live validation has passed on the local PDF.js-style fixture after an extension reload. The validated flow was: reload the unpacked extension, open `http://127.0.0.1:8765/pdf.html`, ask Onhand to read visible PDF text, highlight `Recurrent Neural Networks`, add a note, save an artifact, reload the page so overlays disappear, then use Restore pages to recreate the saved PDF highlight and note from the anchor.

Controlled live validation has also passed on the local Scholar-like fixture after reloading the unpacked extension. The validated flow was: open `http://127.0.0.1:8765/scholar-pdf.html?file=/fixtures/scholar-reader.pdf`, ask Onhand to read visible PDF text while excluding the native Scholar-style comment text, highlight `Recurrent Neural Networks`, add an Onhand note, reload the page so Onhand overlays disappear while the native Scholar-style comment remains, then use Restore pages to recreate one Onhand PDF highlight and one Onhand note. Runtime DOM inspection confirmed the restored anchor preserved `viewer: "google-scholar"`, `pageNumber: 4`, one normalized rect, `pdfUrl`/document URL `http://127.0.0.1:8765/fixtures/scholar-reader.pdf`, and viewer URL `http://127.0.0.1:8765/scholar-pdf.html?file=/fixtures/scholar-reader.pdf`.

The public Google Scholar PDF Reader extension package for version 0.5.0 shows that the reader is injected into PDF tabs as an extension iframe (`chrome-extension://dahenjhkoodjbpjheillcadbppiidmhp/reader.html`). Its rendered PDF pages use `.gsr-page[data-pn]`, and selectable text lives under `.gsr-text-ctn` as `.gsr-text[data-idx]` nodes. The Onhand PDF adapter recognizes those classes directly. Because the real reader lives in a cross-extension iframe, normal `chrome.scripting.executeScript` against the top PDF tab can only see the wrapper document. Onhand therefore treats a bare `.pdf` wrapper with no readable text as an unsupported PDF surface instead of falling back to HTML, and it has a debugger-context fallback that can run the page toolkit inside the Google Scholar Reader frame when Chrome exposes that frame context.

Source jumps for virtualized Google Scholar Reader pages should use the Reader's `.gsr-tb-pn-input` page control. The actual Reader input is classed as `.gsr-tb-pn-input.gsr-tb-input` and does not need to expose an accessible page label, so Onhand cannot rely only on generic `aria-label*="page"` selectors when asking the viewer to render a saved annotation's page.

Google Scholar Reader can also run on content-type PDF URLs whose path does not end in `.pdf` (for example `/pdf/...` routes). Onhand should detect the injected `chrome-extension://dahenjhkoodjbpjheillcadbppiidmhp/reader.html` iframe itself, classify the wrapper as a Google Scholar PDF surface, and then use the Reader-frame fallback rather than treating the wrapper's ordinary DOM text as source page text. If top-page scripting fails before returning a surface payload, Onhand should still try the Reader-frame fallback for conservative PDF-like URL patterns such as `.pdf`, `/pdf/...`, viewer `file=...pdf`, and `format=pdf`.

When the page toolkit runs inside the Google Scholar Reader iframe, PDF anchors must still identify the original top tab, not `chrome-extension://.../reader.html`. The background runner passes the top tab URL/title into the toolkit, and the PDF adapter uses those values for `document.url`, `document.pdfUrl`, and `document.viewerUrl` when the Reader frame itself cannot expose the source PDF URL.

Google Scholar PDF Reader still needs manual acceptance in a real Chrome profile where that extension is installed. In the Codex-controlled Chrome profile used for earlier remote-PDF validation, direct `.pdf` navigation returned `ERR_BLOCKED_BY_CLIENT`. That should not block the adapter design, but it means current live evidence is for the controlled PDF.js-style and Scholar-like surfaces plus source-package inspection of the actual Reader DOM, not a fully completed real Reader live flow.

A later live Chrome diagnostic found an already-open arXiv PDF tab at `https://arxiv.org/pdf/2509.03345` rendered by Chrome's native PDF viewer. The page was visually readable, but normal extension scripting saw an empty top document: no body text, no PDF.js `.textLayer`, no `.gsr-page`, and no Google Scholar Reader iframe. Drag-selecting visible PDF text also left `window.getSelection()` empty from the scriptable top document. That confirms an important boundary for the MVP: visible native-PDF rendering is not enough to support Onhand source-grounded annotations. Onhand should report an unsupported PDF surface for this case instead of pretending the PDF is ordinary HTML, then open the same PDF in Onhand's viewer when the user wants annotation.

The live Chrome result is also why the Onhand-owned PDF viewer should be the primary path. It gives Onhand a stable, inspectable text layer rather than depending on Chrome's native viewer internals or another extension's injected frame.

The real Google Scholar PDF Reader acceptance path should begin with a non-mutating visible-text diagnostic. On a manually opened Scholar Reader PDF tab, ask Onhand to call `browser_get_visible_text` and `browser_get_selection` before creating any highlights or notes. Treat the surface as ready only if Onhand can see page-numbered PDF source text and does not include Scholar Reader's native comment/highlight toolbar text as source text. If the real viewer does not expose a readable text layer to Onhand, the unsupported result should say whether the Reader-frame fallback was attempted and include the failure reason. Keep the controlled fixture coverage but mark real Scholar Reader annotation as unsupported for that profile until a more specific adapter can be built from the actual viewer DOM or browser-frame limitation observed.

Two controlled PDF-like fixtures are available after running `npm run serve:fixture`:

- `http://127.0.0.1:8765/pdf.html` intentionally uses PDF.js-style `.pdfViewer`, `.page[data-page-number]`, and `.textLayer` DOM so the PDF adapter can be exercised without depending on network PDFs or another extension's internals.
- `http://127.0.0.1:8765/scholar-pdf.html?file=/fixtures/scholar-reader.pdf` uses a Google Scholar-style title, actual Reader-like `.gsr-page[data-pn]` / `.gsr-text-ctn` / `.gsr-text[data-idx]` DOM, selectable PDF text, and native-looking Scholar highlight/comment UI. This fixture verifies that Onhand ignores foreign/native annotation popups and toolbars as PDF source text while still rendering its own highlights and notes.

Defer:

- OCR/scanned PDFs
- writing annotations into the PDF file
- syncing with Google Scholar Library
- multi-column semantic section extraction
- cross-viewer restore between Google Scholar Reader and PDF.js
- direct annotation inside Chrome's native PDF viewer without opening a text-layer viewer

## Testing Plan

Use three levels of tests:

1. Unit tests for anchor normalization and rectangle reprojection.
2. A local PDF.js fixture test where we control the DOM and can assert overlays precisely.
3. A local Scholar-like fixture test that exercises generic page regions, selectable text layers, and native annotation UI coexistence.
4. Manual Chrome acceptance against native Chrome PDF viewer as an unsupported diagnostic, because a visually readable native PDF may still expose no scriptable text layer.
5. Manual Chrome acceptance against the Onhand-owned PDF viewer once it exists.
6. Manual Chrome acceptance against Google Scholar PDF Reader, because this depends on another extension's runtime surface.

Acceptance prompts:

- Select text in a PDF and ask Onhand to explain it.
- Ask Onhand to highlight a short visible phrase without an active selection.
- Add a note to the highlighted phrase.
- Click the source from the sidebar and verify it jumps to the PDF highlight.
- Capture/restore, reload the page, and verify the highlight/note return.
- Repeat in a mixed session with one HTML page and one PDF.

## Open Implementation Question

The browser automation path has now seen two real-profile outcomes: earlier direct PDF navigation could be blocked before the PDF viewer loaded, and an already-open arXiv PDF could render in Chrome's native PDF viewer while exposing no scriptable text layer or Reader iframe. That should not block product implementation, but it means automated Google Scholar Reader testing may need either:

- a user-driven manual acceptance step, or
- controlled PDF.js and Scholar-like fixtures for CI and deterministic regression tests.

The code should be designed so Google Scholar compatibility is one adapter, not the only PDF path.

## References

- Google Scholar Blog, "Mark it up! Highlight and comment in Scholar PDF Reader" (2025-11-10): https://scholar.googleblog.com/2025/11/mark-it-up-highlight-and-comment-in.html
- Chrome Web Store listing for Google Scholar PDF Reader: https://chromewebstore.google.com/detail/google-scholar-pdf-reader/dahenjhkoodjbpjheillcadbppiidmhp
