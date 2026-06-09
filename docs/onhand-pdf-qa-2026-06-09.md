# Onhand PDF QA - 2026-06-09

## Goal

Validate the PDF annotation path end-to-end in a real Chromium browser, beyond what the deterministic fixtures can cover:

- Visible-text/selection capture, highlight, note, scroll, capture on PDF surfaces.
- Direct/native PDF tab handoff into the Onhand viewer.
- Real-world PDF behavior (arXiv, 15 pages) with a real model driving the tools.
- Answer-mode and Learning-mode behavior on PDF content.
- Session restore onto a PDF after navigating away.

## Environment

- Workspace: `/Users/sriram/Documents/Onhand` at the v0.2.9 release commit plus the fix below.
- Browser: Helium (Chromium) launched with a throwaway profile, `--load-extension` pointing at the repo's unpacked extension, and a CDP port. Branded Chrome 137+ removed `--load-extension` (the `DisableLoadExtensionCommandLineSwitch` feature flag no longer restores it in Chrome 149), so a Chromium-family binary is required for this harness.
- Driver: `tmp/onhand-qa-driver.mjs` + `tmp/onhand-qa-turn.sh` send the same background messages the side panel sends (`sidebar:realtime-browser-tool`, `sidebar:submit-prompt`, `sidebar:fetch-state`, `sidebar:restore-session`) from an extension page over CDP. Mechanical tests need no model; behavioral tests used a real OpenAI API key in Provider API key mode.
- Fixture server on `127.0.0.1:8765` (PDF.js-style fixture, Scholar-like fixture, real generated PDF).
- Side note answered along the way: the unpacked extension loads and runs in Helium, including the `chrome.debugger` fallback paths — the README's open compatibility question.

## Result summary

- Mechanical matrix: 11/11 PASS after fixing Finding 1 mid-pass (it blocked all annotation writes on non-visible viewer surfaces).
- Behavioral matrix: 4/4 PASS with `gpt-4.1-mini`; `gpt-5.5` over the plain OpenAI API fails multi-step tool turns (Finding 4) — Codex OAuth (`gpt-5.5`) is a different API path and is not affected.
- One product fix shipped from this pass: timeout-backed frame waits in the Onhand PDF viewer, with a source/bundle regression guard.

## Mechanical matrix (no model)

| ID | Surface | What ran | Result |
| --- | --- | --- | --- |
| M1 | PDF.js fixture | navigate | PASS |
| M2 | PDF.js fixture | `get_visible_text` | PASS - `sourceKind: pdfjs`, `[p. N]` markers |
| M3 | PDF.js fixture | `highlight_text` | PASS - `kind: pdf` (case-insensitive first match: page-1 title, not the page-2 lowercase phrase) |
| M4 | PDF.js fixture | `show_note` | PASS - note card anchored beneath highlight (screenshot) |
| M5 | PDF.js fixture | `scroll_to_annotation` | PASS |
| M6 | PDF.js fixture | `capture_state` | PASS - annotation has `kind`, `matchedText`, `note`, `pdfAnchor.pageNumber`, document identity |
| M7 | PDF.js fixture | `clear_annotations` | PASS |
| M8 | Scholar-like fixture | visible text + highlight | PASS - `viewer: google-scholar`, native Scholar note text excluded from source text, exact-phrase highlight |
| M9 | Direct PDF tab | `open_pdf_in_onhand_viewer` | PASS - inline viewer iframe installed, `viewerReady: true` |
| M10 | Onhand viewer | visible text, highlight, note, scroll, capture on a backgrounded tab | PASS after Finding 1 fix (failed before it) |
| M11 | arXiv 1706.03762 (15 pages) | handoff, `pdf_search` (6 matches), highlight with page anchor | PASS |

## Behavioral matrix (real model, Provider API key mode)

| ID | Mode | Prompt | Result |
| --- | --- | --- | --- |
| B1 | Answer | main contribution, anchored | PASS (`gpt-4.1-mini`) - concise answer; highlighted exactly "We propose a new simple network architecture, the Transformer…" in the abstract; auto-saved a Review artifact. FAIL with `gpt-5.5` (Finding 4) |
| B2 | Answer | where is Scaled Dot-Product Attention defined + explain formula | PASS - found page 4, highlighted the defining passage, correct formula explanation |
| B3 | Learning | teach why dot products are scaled by 1/sqrt(dk), ask a check | PASS - searched PDF, read pages 4-5, highlighted the explanation passage, added an interpretive note, asked a retrieval check, recorded the concept |
| B4 | n/a | `sidebar:restore-session` after `about:blank` navigation | PASS - reopened the arXiv PDF in the viewer and restored all 4 session highlights + 1 note, no duplicates |

## Findings

### Finding 1 (high) - viewer annotation commands hang on hidden/occluded surfaces - FIXED

`pdfHighlightText`, `pdfShowNote`, `pdfScrollToAnnotation`, and friends awaited bare `requestAnimationFrame` promises to let layout settle. rAF never fires while a tab is backgrounded or its window is occluded, so:

1. The viewer-frame command hung until its bridge timeout; the background then fell through to the main-world toolkit, which surfaced the misleading error "Unsupported PDF annotation surface: PDF surface has no readable text layer" even though the viewer's text layer was fine.
2. Worse, the hung executions were zombies, not failures: when the tab became visible again they completed late, and a `clearExisting: true` zombie deleted newer highlights and left callers holding stale annotation ids (observed live: a fresh highlight's id became unresolvable seconds later).

Fix: `waitForNextFrame()` in `packages/browser-extension/src/pdf-viewer.ts` races rAF against a 150 ms timeout; all 8 bare awaits replaced. Validated live by running the full highlight/note/scroll/capture cycle on a deliberately backgrounded viewer tab. Guarded by `assertPdfViewerFrameWaitsHaveTimeoutFallback` in the regression suite (checks source and bundle).

### Finding 2 (medium, open) - frame-executor failures are swallowed, surfacing misleading errors

`runPageToolkitMethod` retries through the viewer frame inside bare `catch {}` blocks. When the frame path fails, the user-visible error comes from the main-world toolkit ("no readable text layer"), which sent this investigation down the wrong path initially. Recommendation: when the tab hosts an Onhand viewer (inline or own-tab), prefer reporting the frame executor's error over the generic unsupported-surface error.

### Finding 3 (medium, open) - viewer note cards render far from their highlight

In the Onhand viewer, `show_note` placed the note card near the bottom of the page while the highlight was in the top third (screenshot in pass logs; HTML fixture placement is correct). Likely a page-relative vs viewport-relative rect issue in viewer note placement.

### Finding 4 (high for Provider API key mode, open) - gpt-5.x multi-step tool turns fail over the plain OpenAI API

With `authMode: api-key`, `aiProvider: openai`, `aiModel: gpt-5.5`, the first tool round-trip succeeds, then the second model call fails: `404 Item with id 'rs_…' not found. Items are not persisted when 'store' is set to false.` The Responses API conversation replay references the previous response's reasoning item while `store: false`. Non-reasoning models (`gpt-4.1-mini`) work. Codex OAuth uses the codex-responses path and is unaffected. Likely needs a pi-ai driver behavior (store the response, or pass reasoning items back with encrypted content) — worth reporting upstream and/or filtering reasoning-model ids from the API-key model picker until then. The turn errored cleanly and the session recovered on the next prompt (no poisoning).

### Finding 5 (low, open) - Learning Mode check not recorded as an open check on PDFs

B3 asked a retrieval check in the reply and recorded the concept, but `learnerState.openChecks` stayed empty, so the sidebar can't resolve the answer turn against it. Model-dependent (gpt-4.1-mini may simply not have called `onhand_record_learning_event` for the check); re-test with the production Codex model before treating as a bug.

### Finding 6 (low, open) - restore runs artifact restore and replay fallback together

`sidebar:restore-session` restored the saved artifact (1 annotation + 1 note, with one logged failure: "Debugger evaluation timed out") and then also ran the replay fallback (5 annotations + 1 note). Net page state was correct with no visible duplicates, but the artifact pass's timeout failure plus overlapping replay deserves tightening: the timeout failure is what triggered the fallback, doing double work on a slow surface.

### Observations (no action required yet)

- Onhand-viewer `get_visible_text` returns no `[p. N]` page markers (fixture surfaces include them) and concatenates text blocks without separators ("…FixtureThe important phrase…"). Could degrade model anchor quality on multi-page documents.
- `highlight_text` matches case-insensitively on the first occurrence document-wide; a query meant for a body passage can land on a title. Models can disambiguate with `occurrence` or `pdfAnchor`, so log-only.
- `chrome.runtime.reload()` on a command-line-loaded extension does not restart it (the extension stays dead until the browser relaunches) — relevant to dev workflow only.

## Follow-ups, in priority order

1. Finding 4: reproduce with a minimal pi-ai script and report upstream (or gate reasoning models out of API-key mode).
2. Finding 2: surface frame-executor errors for viewer tabs.
3. Finding 3: fix note placement in the Onhand viewer.
4. Re-run B3-style Learning Mode prompts with Codex `gpt-5.5` via manual side-panel acceptance to settle Finding 5.
5. Finding 6: skip the replay fallback when artifact restore succeeded for the same target, or retry the timed-out evaluation before falling back.
