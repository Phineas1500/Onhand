# Onhand code review — September 4, 2026

Scope: PDF annotation activation and restoration, sidebar citation identity, asynchronous sidebar updates, and repeated rendering. Reviewed the current working tree, including the earlier citation-ID/zoom fix. This was a focused review, not an exhaustive repository audit. No extension source or generated bundle was changed during this review.

Four correctness defects were reproduced, plus one rendering inefficiency. Runtime probes call the actual built runtime using the repository's mock browser host. Sidebar probes execute the actual sidebar in jsdom. These are controlled local reproductions; the new edge cases have not been reproduced in the running Helium extension.

## 1. Session restoration can persist the wrong annotation target

**Priority: high.** `packages/browser-extension/src/browser-runtime.ts:14509`, `actionMatchesReplayTarget`, accepts equal quote text in the same document even when annotation IDs and PDF pages differ. `updateReplayActionArray` then rebinds every matching action. The function named `replayTargetSamePage` tests document identity, not a PDF page or occurrence.

Reproduction: seed two highlights with identical text on PDF pages 2 and 9, then call `restoreSession()`. The host creates distinct `restored-page-2` and `restored-page-9` annotations. Restoration reports two successful annotations and no failures. Persisted action records nevertheless become:

| Action | Saved page | Persisted annotation ID |
| --- | --- | --- |
| `highlight:page-2` | 2 | `restored-page-9` |
| `highlight:page-9` | 9 | `restored-page-9` |

The next direct activation of the first action can therefore scroll to page 9. Its saved page anchor still says page 2, leaving contradictory targets in storage.

Recommended fix: use explicit action/annotation identity first and scope any text fallback to a compatible document and location. Preserve PDF page, occurrence, and anchor context. Do not apply ambiguous quote fallback to multiple distinct targets. Audit the related artifact-coverage matcher, `replayAnnotationMatchesRestoredTarget`, which also compares document plus text. Add a regression that inspects both persisted IDs after restoring repeated quotes.

## 2. The sidebar merges explicit citations for different PDF pages

**Priority: medium.** `packages/browser-extension/sidebar.js:540`, `getCitationEvidenceKey`, keys evidence by document URL and normalized text. `ensureCitationGroup` at line 569 uses that text key even for separate explicit annotation IDs.

Reproduction: provide separate page-2 and page-9 actions and answer markers `[[cite:page-2]]` and `[[cite:page-9]]`. Both rendered chips show `[1]` and both carry `highlight:page-2`. Clicking the second chip actually sends `sidebar:activate-action` for `highlight:page-2`.

Recommended fix: include location in evidence equivalence and preserve distinct explicit targets. Retain intentional grouping of a highlight and its note, aliases created during recovery, and repeated references to the same physical passage. This is separate from issue 1: fixing only the sidebar leaves incorrect saved targets, and fixing only restoration leaves incorrect rendered links.

## 3. Older sidebar responses can overwrite a newer session

**Priority: medium.** `packages/browser-extension/sidebar.js:6019`, `requestState`, renders each response as it arrives. Polling at line 3708 starts a request every 900 ms without an in-flight or ordering guard.

Reproduction: start two state requests; resolve the second with a new session, then resolve the first with the old session. The visible title changes from `New session` back to `Old session`. A newly seeded active voice turn becomes `null`, because the apparent session change invokes `clearRealtimeSessionLocalState` at line 5971.

The production background path can delay a previously captured runtime snapshot: `background.js:14708` obtains runtime state before awaiting tab resolution and, when uncached, page capture. A newer request can take the cached/active-request path while an older capture remains pending.

Recommended fix: guard response application with a monotonically increasing request/session generation; invalidate older requests when changing sessions. Coalesce background polls and reject stale success/error responses. Test both out-of-order requests and session changes during an outstanding request.

## 4. PDF note activation can succeed without the note

**Priority: medium.** `packages/browser-extension/src/browser-runtime.ts:15764` and the analogous retry at line 15785 return after any successful `scroll_to_annotation`. Unlike the first direct-scroll check, these paths do not verify `targetKind` or `noteRect` for a note action.

Reproduction: leave the highlight present but its note absent. The mock returns the viewer's valid missing-note result, `{ targetKind: "annotation", noteRect: null }`. Activating the note issues:

`snapshot_state → activate_tab → scroll_to_annotation → pdf_jump_to_page → scroll_to_annotation`

It returns the requested note action as success and never calls `show_note`. The actual viewer's `pdfScrollToAnnotation` at line 1525 deliberately falls back to the highlight when no note exists, so a resolved command alone does not establish that the note was shown.

Recommended fix: apply the same target validation after every retry, then fall through to note reconstruction if only the highlight exists. Extend the existing stale-note test in `scripts/run-browser-runtime-regressions.mjs:7380` to require note recreation, not merely a page jump.

## 5. Unchanged sidebar polls rebuild the full conversation markup

**Priority: optimization after correctness fixes.** `packages/browser-extension/sidebar.js:5690`, `renderMessages`, calls `renderTurnListMarkup` before comparing against `lastMessagesMarkup`. Thus the DOM equality guard saves DOM replacement but still rebuilds citation groups and every turn's HTML. `buildTurnCitationGroups` at line 626 copies cumulative citation groups for each turn, adding quadratic growth as unique sources accumulate.

Benchmark: seven consecutive unchanged refreshes per case; six distinct highlights and six explicitly cited paragraphs per turn. The message DOM was reused in every case. These are Node/jsdom timings, not measured Helium frame times or battery use.

| Turns | Highlights | Median unchanged refresh |
| --- | --- | --- |
| 10 | 60 | 5.85 ms |
| 30 | 180 | 12.47 ms |
| 60 | 360 | 24.57 ms |
| 100 | 600 | 47.77 ms |

Recommended fix: check content revisions before regenerating markup, cache completed-turn rendering and citation registries, and explicitly invalidate those caches when citation mappings change. The existing 900 ms polling interval makes idle recomputation recurring work.

## Verification and reproduction

- `node tmp/onhand-review-2026-09-05/probes.mjs` reproduced all four correctness defects and generated the benchmark.
- Raw results: `tmp/onhand-review-2026-09-05/results.json`.
- Probe host/DOM harnesses in that directory were copied from the helper prefixes of the existing runtime and sidebar regression scripts, with relative module paths resolved to this checkout. Production runtime/sidebar code was not patched for the probes.
- Probe assertions intentionally assert the observed defective behavior, so successful probe execution means the defect was reproduced; it is not a passing correctness regression.
- `npm run test:preflight` passed.
- `npm run test:agent-runtime-modules` passed.

The earlier live citation/zoom verification is documented separately in `docs/onhand-pdf-citation-live-qa-2026-09-04.md`; it did not cover these newly isolated cases. Fix source identity first, then stale response handling and note recovery, followed by rendering caches.

## Fixes and validation — follow-up

All five items above are now addressed in the working tree:

- Runtime restoration checks document and anchor compatibility, selects explicit source identities across the whole session before mutating records, and avoids applying ambiguous quote fallback to multiple sources. The artifact-coverage matcher also checks location.
- Sidebar evidence grouping includes page, occurrence, surrounding context, and region when available. Highlight/note identity and citation recovery aliases continue to work.
- State requests use sequence numbers; obsolete successes, failures, and rejected requests cannot overwrite newer state. Polls coalesce while requests are outstanding and pause during session changes. Starting a session change invalidates an older poll immediately.
- PDF retry paths verify the requested note. A surviving highlight is reused to recreate its missing note, without replaying an entire artifact or reopening a working viewer.
- A content signature skips transcript generation on unchanged refreshes. Changes to replies, source mappings, disclosure state, session, or math renderer availability invalidate the cache. Other sidebar regions still render; this does not eliminate every idle update.

`scripts/lib/onhand-review-regressions.mjs` adds regressions to the existing sidebar/runtime suites for replay, full artifact restore, partial artifact restore, identical passages on different pages and different occurrences on one page, persisted action copies, missing notes with/without viewer refresh, stale success/error/rejected responses, session changes during a pending poll, and cache invalidation.

The pre-fix bundle and sidebar were retained under ignored `tmp/onhand-review-fixes/`. Re-running the original probes against those copies reproduced all four original defects. The corrected expectations pass against the new build.

### Checks passed

- `npm run build:extension`
- `npm run test:sidebar-regressions`
- `npm run test:browser-runtime-regressions`
- `npm run test:page-toolkit-regressions`
- `npm run test:agent-runtime-modules`
- `npm run test:preflight`
- `npm run test:real-browser-anchoring`
- `git diff --check`

The real-browser test now additionally saves a fixture answer citing two physical occurrences of the same phrase, restores both through the actual extension, checks that the saved IDs still target different locations in the PDF.js DOM, removes one note card, and verifies activation recreates it. It also loads the real sidebar and verifies distinct numbered citation targets. The existing fresh-browser/IndexedDB artifact restore cycle passed. These tests use temporary Helium profiles and a generated local fixture, without model calls or personal documents.

### Measured idle refresh improvement

The same seven-refresh benchmark was repeated sequentially with pre-fix and fixed sidebar code:

| Turns | Before median | After median |
| --- | --- | --- |
| 10 | 5.41 ms | 3.43 ms |
| 30 | 13.75 ms | 7.47 ms |
| 60 | 26.17 ms | 13.24 ms |
| 100 | 50.74 ms | 22.73 ms |

The largest fixture used approximately 55% less time per unchanged refresh. These remain Node/jsdom measurements. Raw results are in `tmp/onhand-review-2026-09-05/baseline-results.json` and `results-after.json`.

### User-profile reload and remaining manual check

Computer Use closed the Onhand side panel, opened a fresh Helium `chrome://extensions` tab, clicked the Onhand 0.4.5 card's Reload button, and observed the **Reloaded** toast. The temporary extensions tab was closed. Reopening the sidebar displayed all 13 citations from the original saved answer.

The extension reload closed the existing extension PDF-viewer tab. The subsequent check on that personal local PDF was not completed: native browser input stopped taking effect, a direct viewer reopen displayed Onhand's local-file handoff requirement, and the browser backend explicitly blocked navigation to the underlying `file://` URL. No workaround was attempted after that explicit rejection. Cleanup of the resulting PDF error tab was also blocked while the side panel remained open. The user can close that error tab and reopen the local PDF through Onhand's supported handoff/session flow. This tooling limitation is separate from the passing real-browser fixture tests; no claim is made that the saved personal PDF was revalidated after this build.

No commits or pushes were made; earlier citation fixes and unrelated promotional assets were preserved.

### Recovery workflow verification — September 4, 22:42 EDT

The previously blocked personal PDF was successfully recovered through Onhand's normal saved-session UI:

- Re-ran `npm run test:real-browser-anchoring` in temporary Helium profiles. Repeated citations, missing-note recovery, anchoring, and the fresh-browser restore cycle all passed.
- Recorded the original saved answer's 13 citation numbers and source-help labels. The existing PDF tab still displayed the earlier handoff error before reload.
- Closed the side panel, reloaded the Onhand 0.4.5 card in a fresh extensions tab using Computer Use, and observed **Reloaded**. Closed the temporary extensions tab; the reload closed the old PDF error tab.
- Opened the saved Onhand session on a temporary blank tab and clicked **Restore pages**. The local PDF opened and rendered all 15 pages. Onhand finished with **Restored 1 saved page state** and **1 page / 13 highlights / 13 notes**. The live annotation index also reported 13 highlights and 13 notes.
- All 13 citation numbers and source-help labels matched the pre-reload snapshot after restoration and the subsequent spot checks. Native UI and a screenshot confirmed a restored highlight and its Gate Validity note on page 9.
- The complete navigation pass remains incomplete. Native actions began returning ScreenCaptureKit errors or having no effect; later attempts to click citation 5 did not even change focus from citation 3. Reconnecting native controls did not resolve this. Opening a temporary `sidepanel.html` tab through the browser connector was then explicitly rejected by its URL policy; no workaround followed that rejection.
- Closed both temporary blank tabs through the browser connector, including the one created by the rejected interface open; the connector's task-tab list was empty afterward. Left the successfully restored PDF and saved answer open at page 9, 97% zoom, with the Onhand menu open. Requested a user spot check of citation 2 to page 3.

This verifies that saved-session recovery avoids the original direct-viewer handoff failure. It does not establish a complete post-reload citation-navigation pass or resolve the separate automation input failure. No extension code changed during this follow-up.

### Personal PDF navigation completed — September 4, 22:55 EDT

The remaining live navigation check now passes. After the user brought Helium to the foreground and clicked inside the existing PDF, native Computer Use input worked again. This is an observed recovery of the tool session, not an established fix for every ScreenCaptureKit error.

Clicked citations in order **2, 1, 3–13, 2** (14 activations). All 13 distinct citations reached the expected PDF pages recorded in `docs/onhand-pdf-citation-live-qa-2026-09-04.md`. After every activation, the complete number-to-source-help mapping remained unchanged and the live annotation index retained **13 highlights and 13 notes**. Screenshots confirmed the pilot highlight and its matching note on page 3.

Left the restored PDF and saved answer open at **citation 2, page 3, 97% zoom**, with the Onhand menu closed. No new tabs, model answers, reloads, or extension-code changes were needed in this continuation. No commits or pushes were made. The earlier incomplete personal-document navigation check is now resolved; the isolated browser regression results above remain applicable to the additional review fixes.

### Commit preparation

Final diff review found no additional blocking defect. Added the sidebar and page-toolkit regression suites to `.github/workflows/browser-runtime.yml`, which previously omitted both. Both suites passed again locally, and the workflow YAML parsed with each new step present exactly once. Removed the private PDF filename and answer excerpt from the live QA report. No extension source or bundle changed in this preparation pass, so the completed live verification still applies.

The remote `main` head was checked directly and matched local HEAD at `7a4078e`. Include the new `scripts/lib/onhand-review-regressions.mjs` helper with the tests that import it. The two untracked promotional banner assets are unrelated and should remain outside this commit. Nothing has been staged, committed, or pushed.
