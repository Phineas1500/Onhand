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

### Finding 2 (medium) - frame-executor failures are swallowed, surfacing misleading errors - FIXED

`runPageToolkitMethod` retried through the viewer frame inside bare `catch {}` blocks. When the frame path failed, the user-visible error came from the main-world toolkit ("no readable text layer"), which sent this investigation down the wrong path initially.

Fix: viewer-frame errors are now preferred over the generic unsupported-surface error when the frame produced a real error (transport "no frame found" misses still fall through), unsupported-payload results are annotated with the frame failure, and the frame executor dedupes its joined failure messages. Validated live: a highlight for nonexistent text on a viewer tab now reports `No visible text matched: …` instead of the misleading unsupported-surface error.

### Finding 3 (medium) - viewer note cards render far from their highlight - FIXED

In the Onhand viewer, `show_note` placed the note card near the bottom of the page while the highlight was in the top third. Root cause: candidate scoring compared raw overlap areas (px², tens of thousands) against a distance term weighted at 0.01/px, so any overlap-free spot — usually the page bottom — always won; the candidate rect also assumed the CSS max-width instead of the rendered note width, inflating overlap estimates.

Fix: overlaps are normalized as fractions of the note/anchor area so they stay comparable to distance, candidates are scored with the rendered note width, and same-line side positions were added to the candidate list. Validated live: notes now sit adjacent to their highlight on both the sparse fixture and a dense arXiv page.

### Finding 4 (high for Provider API key mode) - gpt-5.x multi-step tool turns fail over the plain OpenAI API - FIXED

With `authMode: api-key`, `aiProvider: openai`, `aiModel: gpt-5.5`, the first tool round-trip succeeded, then the second model call failed: `404 Item with id 'rs_…' not found. Items are not persisted when 'store' is set to false.` pi-ai sends Responses API requests with `store: false` and only requests `reasoning.encrypted_content` when a reasoning effort/summary option is passed; Onhand's `streamOnhandFast` passed reasoning options on the Codex path but not the plain `openai-responses` path, so reasoning items replayed by server-side id and 404ed. Non-reasoning models (`gpt-4.1-mini`) worked, and Codex OAuth was unaffected.

Fix: reasoning models on `openai-responses` now stream through `streamOpenAIResponses` with `reasoningEffort` from the runtime's reasoning profile ("none" for fast/balanced, "low" for deep — gpt-5.5 accepts none/low/medium/high/xhigh) and `reasoningSummary: "auto"`, which makes pi-ai round-trip encrypted reasoning content. Validated live: gpt-5.5 completed both a 2-tool turn and a 7-tool follow-up turn on the arXiv PDF with no errors. The turn errored cleanly before the fix and sessions recovered on the next prompt (no poisoning).

### Finding 5 (low) - Learning Mode check not recorded as an open check on PDFs - FIXED

B3 asked a retrieval check in the reply and recorded the concept, but `learnerState.openChecks` stayed empty, so the sidebar could not resolve the answer turn against it. Model-dependent: weaker models ask the closing question without calling `onhand_record_learning_event`.

Fix: after a successful Learning Mode turn that recorded no open check, the runtime records the reply's trailing question as a fallback open check, attached to the concept introduced that turn. Conversational offers ("want me to explain more?") and short fragments are filtered out, and turns where the model recorded its own check are left untouched. Covered by `assertFallbackOpenCheckRecording`.

### Finding 6 (low) - restore runs artifact restore and replay fallback together - FIXED

`sidebar:restore-session` restored the saved artifact and then ran the replay fallback over the full session annotation set, redoing the artifact pass's successful work.

Fix: the replay fallback now restores only the annotations the artifact pass did not cover (matched by annotation id, text, and URL). When coverage is complete but restored counts came up short, it still replays everything as before. Covered by `assertReplayFallbackSkipsArtifactCoveredAnnotations`.

### Observations (no action required yet)

- Onhand-viewer `get_visible_text` returns no `[p. N]` page markers (fixture surfaces include them) and concatenates text blocks without separators ("…FixtureThe important phrase…"). Could degrade model anchor quality on multi-page documents.
- `highlight_text` matches case-insensitively on the first occurrence document-wide; a query meant for a body passage can land on a title. Models can disambiguate with `occurrence` or `pdfAnchor`, so log-only.
- `chrome.runtime.reload()` on a command-line-loaded extension does not restart it (the extension stays dead until the browser relaunches) — relevant to dev workflow only.

## Follow-ups, in priority order

All six findings were fixed and validated during/after this pass. Remaining:

1. Consider reporting the pi-ai `store:false` + reasoning-item default upstream so plain `streamSimple` callers are not exposed to the same trap.
2. The observations (viewer visible-text page markers/word spacing, first-occurrence highlight matching) remain log-only.
