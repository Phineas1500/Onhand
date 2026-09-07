# Long-session sidebar rendering

Validated September 7, 2026, using Helium 151.0.7922.169 on macOS.

Previously, a streaming update rebuilt cumulative citation snapshots and Markdown
for every turn, then replaced the entire transcript DOM. The sidebar now retains
unchanged completed articles and their citation-number assignments. It renders
from the first changed turn onward, so edits to earlier sources still update
dependent citation targets and numbers. Session changes and KaTeX availability
invalidate the cache; disclosure toggles update existing elements directly.

The cache holds only the current transcript. Source registry reconstruction and
state serialization remain linear in history size. This change does not reduce
provider latency or virtualize the initial rendering of a large history.

## Browser measurements

The reproducible fixture uses production `sidebar.js` with synthetic, cloned
runtime responses: 100 completed turns, six explicit citations per turn, and one
streaming answer. Three paired runs alternated before/after order, with ten
streaming updates and ten idle polls per run. Initialization and three warmup
polls were excluded. Both versions ran in the same disposable Helium profile.

| Measurement | Before | After |
| --- | ---: | ---: |
| Median streaming update, 30 samples | 51.3 ms | 9.4 ms |
| 95th percentile streaming update | 70.3 ms | 10.3 ms |
| Median idle poll, 30 samples | 0.8 ms | 0.8 ms |
| Completed articles replaced per streaming update | 100 | 0 |
| Completed citation numbers remaining stable | 600 / 600 | 600 / 600 |

Streaming update time fell approximately **82%**. Timings include the synthetic
state clone, fetch, and full sidebar update. The optional `throughNextPaint`
metric additionally waits for two animation frames; it is not a direct paint-cost
measurement. Early raw reports contain a `startupMs` field that included the delay
before invoking the fixture; that field was removed and is not used here.

Baseline source: commit `54f3fbd`, SHA-256
`6f256f823fa2847012951965f60b0655abacf999a94a49bb62963999d6219445`.
Updated source SHA-256:
`3fb135db928a2003a370b6d12d413e77931a07801655fa3bf4425d8995e0be45`.
Raw local evidence: `tmp/sidebar-performance-2026-09-07/helium-results.json`.

The JSDOM comparison independently measured a median streaming update reduction
from 275.6 to 52.8 ms. JSDOM has no real layout or paint, so these are separate
measurements rather than browser performance claims.

## Actual extension verification

Reloaded the unpacked Onhand extension through its Extensions-page Reload control
and confirmed the “Reloaded” toast. Only the disposable test profile was changed;
the user's normal Helium profile and tabs were preserved.

Opened the native side panel through `chrome.sidePanel.open()` and used the real
extension runtime, IndexedDB, and PDF viewer. A generated three-page garden PDF
provided three actual highlights and notes; a synthetic saved conversation
provided 100 preceding answers. No hosted model calls were made.

- Five updates to the final answer retained all 100 preceding article nodes and
  kept the Sources disclosure open.
- Six citation clicks, two passes through the three sources, reached the correct
  visible PDF note each time. Labels and action keys remained unchanged.
- The New Session control cleared the transcript. Switching back through the
  session selector recovered all 101 turns and the same citation identities.
- The captured side-panel screenshot was visually inspected.

Local evidence: `tmp/sidebar-performance-2026-09-07/live-panel-results.json` and
`live-panel.png`. These checks establish generated-fixture behavior; they do not
claim testing of a personal PDF or reloading the user's normal extension profile.

## Regression coverage and reproduction

`npm run test:sidebar-regressions` passes, including new cases for streaming node
identity, copy feedback, delegated clicks, progress/source toggles, completion,
historical citation renumbering and restored aliases, append/delete/reorder,
session resets, late KaTeX loading, and legacy missing/duplicate IDs. Repairing
duplicate IDs also invalidates previously shared citation snapshots. The new DOM
preservation assertion fails against the baseline implementation.

`npm run test:preflight`, syntax checks, and `git diff --check` pass. Independent
review found no remaining actionable defects.

Run the synthetic benchmark locally:

```sh
node scripts/run-sidebar-performance.mjs --output /tmp/onhand-sidebar-after.json
node scripts/run-sidebar-performance.mjs --serve 8878
```

In a browser, open the printed loopback URL and invoke:

```js
await window.__onhandPerformanceFixture.run({ paint: true })
```

Use `--source /path/to/sidebar.before.js` for the baseline. Optional `--turns`,
`--citations`, and `--updates` parameters control fixture size. Follow
`docs/SESSION_DEBUGGING.md` for disposable Helium setup and normal side-panel
opening; do not copy a personal profile into a test profile.
