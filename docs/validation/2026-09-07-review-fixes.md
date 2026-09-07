# Review fixes and validation — September 7, 2026

## Implemented, in priority order

| Priority | Issue | Result |
| --- | --- | --- |
| P1 | Selection-copy recovery overwrote image/HTML clipboards with an incomplete text backup | Inspect clipboard formats before copying. Only known plain text or empty clipboards permit the probe; other formats are preserved. Applies to native PDF and Google Docs fallback paths. |
| P1 | Cancelled/error streams and JSON responses escaped hosted cost accounting | All response terminal paths finalize accounting once. Pending read/cancel races, late metadata, and lost RPC replies are handled. |
| P1 | Concurrent KV cost updates lost charges | One SQLite-backed Durable Object per UTC request day serializes updates, deduplicates generation IDs, and reconciles delayed costs through alarms. |
| P2 | PDF zoom replayed stale annotation snapshots over current edits | Update existing annotation geometry synchronously before raster sharpening. Preserve live marks, notes, collapse state, and IDs. |
| P2 | Stop failed while preparing page context | Request-level cancellation begins before model startup. Late preparation results cannot continue the cancelled request. |
| P2 | Simultaneous cold submissions replaced one another | Reserve submission synchronously, and exclude new/switch/delete/restore session operations while another operation is active. |
| P2 | PDF extraction errors looked like successful empty reads | Propagate extraction errors and report failed-page/incomplete coverage. Unready text layers use PDF.js extraction. |
| P2 | A damaged page aborted bibliography lookup or pending-page highlight search | Continue searching readable pages, retain failure coverage, and distinguish an incomplete miss from a complete miss. |
| P2 | A first highlight created during transient zoom used the wrong coordinate scale | Initialize its annotation layer with the committed layout scale. |
| P2 | Imperative “highlight” requests were mistaken for references to an existing selection | Keep markup requests on the normal PDF answering path; retain recovery for explicit selected-text references. |
| P2 | “Mark … with margin notes” activated the optional three-note limit | Recognize the explicit note request while retaining the default cap for unsolicited notes. |
| P2 | PDF restoration timed out while restoring scroll through the native outer frame | Restore coordinates through the Onhand viewer port/bridge. Bound the generic page animation-frame wait; continue reporting real viewer failures. |
| P2 | IndexedDB request success was mistaken for a committed save | Wait for transaction completion, reject aborts/errors, allow failed initial loads to retry, and release the busy state after a failed final save. |
| P2 | Deleting sessions leaked saved HTML/screenshots | Delete owned artifacts with the session in one IndexedDB transaction, preserving artifacts referenced by surviving sessions. |
| Improvement | Snapshot listing cloned every artifact before applying its limit | Walk the creation-time index newest first and stop after enough matches. |
| Improvement | Escape committed session renames | Cancel the blur-save path and restore the saved title. Enter still commits. |
| Improvement | Options displayed the wrong hosted model | Derive the help from shared provider metadata. |

Also reproduced and fixed a delayed Learning Mode callback that could switch
tabs after its request had finished. A related Restore pages/submission race is
covered by the session-operation exclusion above.

## Verification

All commands below passed against the final sources/bundles unless stated otherwise:

```sh
npm run build:extension
npm run test:browser-runtime-regressions
npm run test:sidebar-regressions
npm run test:page-toolkit-regressions
npm run test:pdf-viewer-review
npm run test:agent-runtime-modules
npm run test:free-tier-worker-regressions
npm run smoke:browser-runtime -- --ports --json
npm run test:preflight
git diff --check
ONHAND_TEST_BROWSER_FLAGS=--headless=new npm run test:real-runtime-review
ONHAND_TEST_BROWSER_FLAGS=--headless=new npm run test:real-pdf-zoom
ONHAND_TEST_CLIPBOARD=1 ONHAND_TEST_BROWSER_FLAGS=--headless=new npm run test:real-browser-anchoring
```

The rich-clipboard group passed before the later PDF routing and scroll fixes;
those changes do not alter clipboard handling. Runtime, sidebar, PDF review,
preflight, real-browser anchoring/restore, and real-PDF zoom checks were rerun
against the final build. The routing probe passed all 23 cases. Earlier shared
profile reloads used native Computer Use; the final isolated profile used the
CDP workflow explicitly requested by the user. The Extensions reload control
and Reloaded toast were verified.

Browser-native tests verified committed and aborted IndexedDB writes, artifact
cleanup and shared references, limited listing without getAll, Stop during
preparation followed by another question, and simultaneous cold submissions.
These lifecycle tests use the real bundle and IndexedDB with a controlled host
and smoke model; they do not exercise a hosted provider.

Actual PDF browser tests verified native clipboard selection with site clipboard
permission still ungranted, byte/format preservation for generated HTML and PNG
clipboard items, repeated citation identity, missing-note recovery, and session
restore. The zoom test held a real PDF.js render frame while creating/deleting
marks and editing/collapsing a note. All changes survived. Final measured zoom
alignment error was 0–0.249 pixels, with 22.6–28.1 ms preview latency in the final run.

The optional workerd/Miniflare suite passed using real SQLite Durable Objects:
50 concurrent duplicate writes, distinct charges, legacy KV import, persistence
across restart, Worker-to-object RPC, cap admission, SSE/JSON accounting, and
scheduled reconciliation alarms. Provider responses were synthetic. Wrangler's
deployment dry-run and the ops report SQL dry-run passed. See FREE_TIER_OPS.md
for the reproducible optional integration command.

## Hosted PDF walkthrough in Helium over CDP

Used a disposable profile, the production Onhand Free `/v1` endpoint, and a
generated three-page gardening handbook. No personal document or credentials
were copied. The exact request was:

> Using only this PDF, highlight two specific recommendations on each of its three pages and add a short explanatory note to every highlight. Then summarize the six recommendations with clickable citations.

The first attempt exposed the imperative-highlight routing bug above. After
the fix and reload, the actual hosted model completed 16 tool steps, producing
six highlights, six explanatory notes, six inline citations, and a saved
artifact. An alternate wording exposed the explicit-margin-note detection bug;
its classifier-seeded regression now permits six requested notes while an
ordinary summary retains the optional three-note cap.

Verified in the actual sidebar/viewer:

- Twelve forward/backward citation clicks before reload and twelve after
  restoring the final six-note session preserved citation numbers and keys.
  An earlier six-citation session passed another twelve clicks.
- Zoom controls and note collapse preserved live marks, note text, and IDs.
- Stop was clicked while the sidebar displayed “Preparing page context.” The
  runtime settled to `Stopped` with zero model calls; the subsequent hosted
  question completed successfully.
- After closing the PDF and reloading the final bundle, restoring the saved
  session returned six highlights and six notes, zero failures, and no snapshot
  fallback in 13.9 seconds. Note text matched the saved artifact exactly, and
  the viewer's restored `scrollY` matched the saved value of 1180 pixels.
- The PDF site's clipboard-read permission remained `prompt`; the harmless
  clipboard sentinel was unchanged through answering, citation clicks, zoom,
  and restore. No clipboard permission was granted. Rich-format preservation
  remains covered by the earlier opt-in native clipboard suite.
- Final PDF and sidebar screenshots were inspected for highlight alignment,
  note rendering, and the restored cited answer.

The disposable browser was closed, its profile removed, and both local fixture
servers stopped. The user's original Helium process remained running.

## Remaining boundaries

- The hosted Worker was subsequently deployed with a drained migration and
  verified against the real provider and production ledger. Live verification
  found and fixed an additional request-disconnect accounting issue and an
  operations SQL type mismatch. See
  [the deployment record](2026-09-07-hosted-worker-deployment.md).
- Recorded-cost admission is not a strict spending reservation. In-flight calls
  and delayed charges can exceed the cap. A response exposing neither usage nor
  a generation ID is reported as unresolved, and historical lost KV charges
  cannot be reconstructed automatically.
- The native-input walkthrough was subsequently completed using a separate
  Helium profile with CDP and a generated three-page PDF. The user's existing
  browser process was left running. Onhand's normal side-panel API opened its
  panel; no rejected local-PDF or extension-page navigation was retried.
- Already dispatched browser commands may finish after Stop; cancelled results
  cannot advance preparation or mutate a later request. Filtered artifact
  searches may scan many records when matches are sparse; this was not a large
  storage performance benchmark.
