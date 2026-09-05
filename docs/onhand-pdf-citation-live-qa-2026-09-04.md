# PDF citation live verification — September 4, 2026

Result: PASS for the disappearing/renumbering citation regression in the saved session tested below.

## Live environment and scope

- Helium, operated through native Computer Use. The user reported rebuilding and reloading Onhand before this run.
- Actual unpacked Onhand side panel and PDF viewer, extension ID `hpjpjeehgbloadhdidmecpijppodibim`.
- Existing saved answer with 13 citations and 26 source actions; private conversation excerpts are omitted.
- Source: a 15-page local PDF; its private filename is omitted.
- Completed approximately 21:28 EDT, September 4 (01:28 UTC, September 5).

## Checks and observations

1. Captured all 13 numbered citation buttons and their source-help labels before testing. Clicking the first citation reopened the saved local PDF in Onhand's viewer. Subsequent clicks recovered the remaining saved marks. The annotation index eventually reported 13 highlights and 13 notes.
2. Clicked every citation, 1 through 13. Compared the complete number-to-source-label mapping after each click and after recovery finished. No citation disappeared, changed source label, or changed number.
3. Zoomed the annotated PDF from 94% to 109%, allowing the viewer's annotation rebuild to finish. All 13 citations, highlights, and notes remained.
4. Repeated all 13 citation jumps after zoom, in order 2, 1, 3–13. Every comparison retained the same 13 numbered source labels; the annotation index remained at 13 highlights and 13 notes throughout this pass.
5. Restored zoom to 94%, closed the sidebar, visually confirmed closure, and reopened it. The saved answer retained the same citation mapping and annotation counts. Clicked citation 2 again; it opened the pilot passage and its matching note on page 3.

Total: 27 citation activations, two zoom changes, and one sidebar close/reopen cycle. Accessibility snapshots checked the complete citation mapping; screenshots also confirmed visible source highlights and note cards for sampled destinations, including citations 2, 4, 12, and 13.

The repeated pass reached these viewer pages:

| Citation | Page |
| --- | --- |
| 1 | 3 |
| 2 | 3 |
| 3 | 6 |
| 4 | 9 |
| 5 | 4 |
| 6 | 11 |
| 7 | 5 |
| 8 | 5 |
| 9 | 10 |
| 10 | 10 |
| 11 | 14 |
| 12 | 15 |
| 13 | 15 |

## Cleanup and limits

- Left the verified local PDF and saved answer open at citation 2, at the original 94% zoom.
- Closed only the extra arXiv test tab created during setup and stopped the unused local fixture server. Existing user tabs were preserved.
- No new model answer was generated, no session was deleted, and no extension code changed during live verification.
- This verifies the existing 13-citation session's recovery, navigation, numbering, zoom, and sidebar reopening. It does not claim exhaustive behavior across all PDFs or test a fresh model-generated response.

## Post-review-build recovery and navigation — 22:55 EDT

PASS on the same personal PDF after the subsequent review fixes, extension reload, and **Restore pages** recovery described in `docs/onhand-code-review-2026-09-04.md`.

After the user foregrounded Helium and clicked inside the PDF to recover native automation input, clicked citations **2, 1, 3–13, 2**. All 13 distinct citations reached the same expected pages in the table above. The complete citation number/source-help mapping remained unchanged after every activation, and the live annotation index retained **13 highlights and 13 notes** throughout. Screenshots verified the pilot passage and its matching note on page 3.

This continuation performed 14 citation activations and left the existing PDF open at citation 2, page 3, with its restored **97% zoom unchanged** and the Onhand menu closed. It did not repeat the earlier zoom or sidebar close/reopen tests, generate a new answer, open any tabs, reload the extension, or change extension code. The personal-PDF navigation check previously blocked by automation is now complete.
