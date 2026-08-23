# Saved-source memory experiment

This experiment tests whether searchable session evidence and an opt-in
normalized representation of explicitly saved webpages and PDFs improve
cross-session and cross-source work enough to justify their storage, privacy,
and freshness costs.

## Treatment

The hidden runtime setting `sourceMemoryEnabled` is off by default. When it is
on, existing review artifacts become searchable through the exact source text
and anchors they already store. This projection does not capture or duplicate
additional page content, and the artifact's `source` field remains null.

Full-source indexing remains explicit: `browser_capture_state` persists
normalized source blocks only when the capture sets both `persist=true` and
`includeSourceContent=true`.

The treatment exposes two experimental tools:

- `browser_search_saved_sources` searches exact evidence in existing restorable
  session artifacts and normalized blocks from explicitly indexed sources.
  Results identify whether their scope is `session-evidence` or `full-source`
  and retain source URL, capture time, fingerprint, block location, and PDF page
  number when available.
- `browser_delete_artifact` deletes the saved artifact and its normalized
  representation. It does not claim to delete separate chat history or live
  page annotations.

Saved results are snapshots. The runtime prompt requires live open content to
win whenever freshness matters. Session-evidence results cover only passages
Onhand previously marked; they are not represented as a search of the full
page or document. Deleting the last session that references an evidence-only
artifact garbage-collects it, while explicitly indexed full sources remain
independent.

## Deterministic regression

```sh
npm run build:browser-runtime
npm run test:source-memory
```

## Live paired comparison

Run both conditions from the same built revision, fixture revision, Pi version,
provider, and model. The runner requires an isolated browser profile before it
will change this hidden setting or execute multi-phase source-memory cases.

```sh
npm run eval:source-memory -- \
  --launch-isolated \
  --source-memory off \
  --iterations 5 \
  --out tmp/source-memory/baseline

npm run eval:source-memory -- \
  --launch-isolated \
  --source-memory on \
  --iterations 5 \
  --out tmp/source-memory/treatment
```

Each iteration clears saved artifacts, asks setup turns to explicitly save the
fixture sources, closes every setup tab, starts a new Onhand session on an empty
workspace using the case's explicit `finalTabIds`, and scores only the final
retrieval turn. Raw traces and reports are written beneath the requested output
directory. The suite covers one saved webpage, one saved PDF with page-level
evidence, and a multi-website comparison with an unrelated saved distractor.

The existing core suite remains the regression control:

```sh
npm run eval:agent-trajectories:live -- \
  --launch-isolated \
  --source-memory off \
  --case current-page-grounded-answer \
  --iterations 5

npm run eval:agent-trajectories:live -- \
  --launch-isolated \
  --source-memory on \
  --case current-page-grounded-answer \
  --iterations 5
```

Do not compare the treatment against the dated 0.4.2 report. Record a fresh
flag-off baseline from the same pre-release revision and model route.

## Real-source suite

The real-source suite uses public material instead of locally authored fixture
documents:

- [Stanford CS231n convolutional-network course notes](https://cs231n.github.io/convolutional-networks/) (HTML)
- [Lilian Weng's LLM-powered autonomous-agent article](https://lilianweng.github.io/posts/2023-06-23-agent/) (HTML)
- [*Attention Is All You Need*](https://arxiv.org/pdf/1706.03762) (public arXiv PDF)
- [Stanford CS229 decision-tree lecture notes](https://cs229.stanford.edu/summer2023/cs229-notes-decision_trees.pdf) (public PDF)

The source pages and PDFs are opened from their public URLs during each setup
turn. The runner explicitly saves and indexes the source, closes the exact tab
it opened, starts the scored turn on an empty fixture page, and asks a natural
multi-part question whose expected evidence is taken from the public source.

```sh
npm run eval:source-memory:real -- \
  --launch-isolated \
  --openrouter \
  --source-memory off \
  --iterations 3 \
  --out tmp/source-memory/real-world-control

npm run eval:source-memory:real -- \
  --launch-isolated \
  --openrouter \
  --source-memory on \
  --iterations 3 \
  --out tmp/source-memory/real-world-treatment
```

### 2026-08-20 paired result

Both conditions used `openai/gpt-5.6-luna` through OpenRouter, the same source
suite, three iterations per case, an isolated browser profile, and the same
extension revision. The control report is
`tmp/source-memory/real-world-2026-08-20/baseline-v2/report.json`; the final
treatment report is
`tmp/source-memory/real-world-2026-08-20/treatment-final/report.json`.

| Metric | Flag off | Flag on | Change |
| --- | ---: | ---: | ---: |
| Fully passing runs | 0/12 | 12/12 | +12 runs |
| Fully grounded runs | 5/12 | 12/12 | +7 runs |
| Required evidence slots found | 11/24 | 24/24 | +13 slots |
| Average score | 0.758 | 1.000 | +0.242 |
| Mean latency | 23.924 s | 8.336 s | -65.2% |
| Median latency | 19.033 s | 8.396 s | -55.9% |
| p95 latency | 49.021 s | 12.291 s | -74.9% |
| Mean model calls | 7.25 | 3.08 | -57.5% |
| Mean browser tool calls | 6.00 | 1.33 | -77.8% |
| Tool errors | 3 | 0 | -3 |
| Live-page annotations | 9 | 0 | -9 |

A full pass requires the answer, all requested evidence, the saved-source access
path, and the efficiency/error limits. The flag-off control cannot satisfy the
saved-source-access requirement by design, so the evidence-slot and grounding
rows are the more direct answer-quality comparison: the control found 45.8% of
the expected evidence, while the treatment found 100%.

The live run exposed two PDF-specific failures before the final result. Long
PDF pages initially produced one oversized block whose later sentences were not
shown to the model. Splitting pages into sentence-aware passages fixed that.
Multi-part questions could still straddle a passage or page boundary, so search
now includes at most the immediate neighboring PDF passages on the same or
adjacent page. A regression prevents that context window from jumping across a
larger page gap.

This is strong directional evidence, not a production-scale benchmark. There
are only four sources and three stochastic repetitions per source, and the
runner did not receive provider cost data. Fewer model/tool calls strongly
suggest lower cost, but no dollar-cost claim should be made from this run.

The paired result above measured the explicit `full-source` path. Searchable
`session-evidence` reuses the same retrieval path but was added afterward and is
covered by deterministic and browser-runtime integration regressions rather
than that dated live comparison.

## Current boundaries

- The hidden search flag stays off by default. Enabling it makes already-saved
  session evidence queryable but does not automatically capture more content.
- Full-page or full-document source persistence remains explicit opt-in.
- Saved content is a timestamped snapshot. It is not fresh-page verification.
- PDF background extraction supports public HTTP(S) PDFs with an extractable
  text layer, up to 40 MB, 240 pages, and 50,000 stored characters.
- Authenticated PDFs fall back to the existing live tab/viewer workflow. Local
  files, scans without text, and OCR are not covered by this saved-PDF path.
- Retrieval is lexical with bounded adjacent context. Embeddings and semantic
  indexing remain intentionally deferred until broader evals show a need.

## Go/no-go interpretation

Keep the experiment only if it produces a material improvement on the targeted
multi-phase cases without new hard failures on the core suite. A saved snapshot
used over newer live content, full-source persistence without explicit opt-in,
session evidence presented as exhaustive document coverage, or content
remaining searchable after its owning artifact is deleted is a release blocker
regardless of aggregate score.
