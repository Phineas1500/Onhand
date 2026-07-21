# Legacy Agent Trajectory Baseline — 2026-07-21

This record captures the first repeated live-browser baseline for the runtime
profile migration. It is a raw baseline and a harness-validation artifact, not
yet a release gate or a final judgment of either model.

## Runtime under test

- Extension: `0.4.2`
- Runtime revision: `2026-05-13-answer-quality-v1`
- Execution profile: `legacy`
- Suite: 10 browser-learning trajectories, five iterations per case
- Browser: Helium with CDP enabled on the local test port

## Frontier baseline

Provider/model: `openai-codex / gpt-5.6-sol`

- Runs: 50
- Raw scorer passes: 0
- Raw average score: 0.505
- Raw p95 latency: 195,939 ms
- Provider cost: unavailable from the captured runtime receipts

The raw failures include real product signals: multi-minute stalls, missing
annotations on tasks that asked for them, repeated tool errors, duplicate
source openings, and tool/model loops above the case budgets.

The zero-pass result must not be treated as a calibrated product-quality rate.
The first run also exposed evaluator-contract mismatches that need an audit
before `full-agent` is compared with `legacy`:

- Some cases require an explicit page-read tool even though the runtime already
  injects the active page context into the turn.
- A clean hosted-model run completed two highlight tool calls and two page
  mutations, but the normalizer recorded zero annotations.
- Evidence slots are currently credited only from tool/action receipts. A
  correct answer based on the active page context receives no evidence credit
  when it reasonably avoids a redundant explicit read call; this contract
  needs an explicit decision before it becomes a gate.

The form-interaction failures were checked separately and are genuine legacy
behavior: those turns received `browser_find_elements`, but click/type tools
were withheld, so the requested page change could not be completed.

The raw local report is stored at:

`tmp/agent-trajectories/legacy-frontier-2026-07-21-gpt-5-6-sol-v2/`

## Onhand Free baseline status

Provider/model: `onhand-free / deepseek/deepseek-v4-flash`

One clean hosted-model run completed before the daily quota was exhausted:

- Completion: yes
- Latency: 44,033 ms
- Model calls: 3
- Tool calls: 2 successful `browser_highlight_text` calls
- Page mutations: 2
- Reply: grounded and cited the highlighted page passage

The full 50-run free-tier matrix was not completed. No local quota-bypass
secret was configured, so continuing would have measured HTTP 429 handling
rather than model behavior. The runner now detects this response, persists the
partial artifacts, sets `stoppedReason` to `free-tier-quota-exhausted`, and
stops before issuing more requests.

The clean partial run and explicit quota-boundary record are stored at:

- `tmp/agent-trajectories/legacy-free-2026-07-21-deepseek-v4-flash-v2/`
- `tmp/agent-trajectories/legacy-free-quota-boundary-2026-07-21/`

## Harness changes proven during collection

The baseline exercise found and fixed four harness problems without changing
production agent behavior:

1. Runtime provider/model metadata now reads the live `preferences` shape.
2. Traces and reports are persisted after every iteration, including errors.
3. Cancellation waits for the runtime to become idle before the next request.
4. Free-tier quota responses end a run explicitly instead of contaminating the
   remaining matrix.

## Required next step

Audit and freeze the live-payload-to-score contract, add regression fixtures
for the mismatches above, then rerun the same legacy matrix. Complete the
Onhand Free repetitions after the quota resets or through an approved test
bypass. Only after that should PR 3 compare `full-agent` with `legacy`.
