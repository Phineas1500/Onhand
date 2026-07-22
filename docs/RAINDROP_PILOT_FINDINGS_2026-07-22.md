# Raindrop local pilot findings — 2026-07-22

This report contains only deterministic fixture data and aggregate behavior.
The raw Workshop database and trajectory outputs remain ignored under `tmp/`.

## What the pilot now proves

- The default extension build contains no Raindrop SDK or Workshop endpoint.
- The explicit pilot build ships to loopback Workshop only and fails open when
  Workshop is unavailable.
- A stable, separate browser profile can run the same trajectory fixtures with
  Onhand Free without exposing the user's normal tabs or browser storage.
- Workshop provides useful raw model/tool nesting and payload errors, while
  Onhand's trajectory evaluator provides the task contract and pass/fail score.
- Timed cancellation can be measured from the runtime's active-request signal
  through Onhand's real stop command.

## Live matrix

All rows used extension `0.4.3`, the `legacy` profile, a fixture-only Helium
profile, and Onhand Free (`deepseek/deepseek-v4-flash`).

| Case | Result | Latency | Model calls | Tool calls/errors | Important observation |
| --- | --- | ---: | ---: | ---: | --- |
| Current HTML grounding | fail, 0.550 | 7.5 s | 2 | 1 / 1 | The prose answer was correct, but `browser_highlight_text` returned `Tool browser_highlight_text not found`, so required evidence and annotation coverage were absent. |
| Selected homework + open course notes | fail, 0.417 | 76.0 s | 17 | 18 / 2 | It discovered the workspace and found dropout evidence, but did not cover all three requested techniques. Early `browser_pdf_read_pages` and `browser_pdf_search` calls returned `Tool ... not found`; it later recovered through other tools, duplicated one source, and exceeded latency/call budgets. |
| Two open PDFs | fail, 0.350 | 144.9 s | 17 | 28 / 4 | The final comparison and both citations were substantively correct, but the run reopened sources, changed focus, exposed provisional output, and exceeded every efficiency budget. Highlight calls completed, yet the normalized trace reported zero annotations. |
| Cross-tab cancellation | expected incomplete | 16.7 s from submission | 1 | 0 / 0 | The runner observed an active request, waited 1 s, and Onhand acknowledged `stopped=true`. The persisted turn ended with `Request was aborted.` rather than waiting for the outer CLI timeout. |

The earlier GPT-5.6 calibration runs remain useful controls: a simple grounded
answer completed in 3.9 seconds, and an explicit two-highlight request
completed in 8.6 seconds with exact tool arguments/results visible in
Workshop. Those were manual calibration runs, not the full isolated matrix.

## Actionable findings

### P0 — Tool-surface mismatch on the free route

The model is being prompted to perform page/PDF work that is not consistently
present in the active Pi tool registry. Raw Workshop results distinguish this
from a page failure: several calls returned `Tool <name> not found` before any
browser command ran. Fix the runtime's capability/tool-profile contract so the
prompt, model-visible tools, and executable registry are derived from the same
source. Do not add phrase-specific gates.

### P0 — Annotation receipt/evaluator mismatch

In the two-PDF run, both `browser_highlight_text` calls completed, but the
normalized trace contained zero annotations. Determine whether successful PDF
highlights are missing durable page-action receipts or whether the live
normalizer fails to map the current receipt shape. Until fixed, a correct
browser mutation can be scored as absent.

### P1 — Cheap-model recovery needs bounded agent mechanics

The free model eventually found useful evidence, but used 17 model calls in
both complex cases, reopened sources, repeated PDF reads, and spent up to 145
seconds. Prefer a few generic harness-level controls—tool-result capability
errors, dedupe/idempotency receipts, per-source attempt budgets, and compact
macro tools—over more prompt regexes or topic-specific routing.

### P1 — Provisional answer and learner-flow quality

The PDF comparison exposed provisional output, and the homework reply included
multiple narrated planning fragments before a partial answer. Frontier models
need fewer constraints; the free route needs a bounded execution profile that
buffers intermediate prose and exposes only the settled teaching turn.

### P2 — Raindrop integration issues

Workshop double-counts root plus nested model token usage, and the Pi adapter
lacks a browser-safe entry point. Sanitized upstream drafts are in
`docs/RAINDROP_UPSTREAM_ISSUE_DRAFTS.md`.

## What remains

- Run the same three isolated fixtures on GPT-5.6 after a dedicated fixture
  profile is signed in to Codex; do not copy OAuth storage from a personal
  profile.
- Add deterministic provider/transport retry injection. The current matrix
  covers tool-level recovery loops but not a controlled 429/5xx retry.
- Decide whether to trace the internal structured tutor/planner agent and
  realtime voice separately. The current adapter observes only the main Pi
  agent.
- After fixing P0 issues, repeat the matrix before considering any production
  Raindrop integration or privacy-policy change.
