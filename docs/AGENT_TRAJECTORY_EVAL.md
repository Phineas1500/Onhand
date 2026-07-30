# Agent Trajectory Evaluation

The trajectory suite evaluates whether Onhand completes an entire browser task,
not merely whether a model can produce one plausible answer or tool call. It
scores production-shaped trajectories for the (sole) `legacy` runtime; the
`full-agent`/`guided-agent` profile names survive only as trace labels from the
archived `docs/AGENT_RUNTIME_PROFILES_PLAN.md`.

The fixture and scoring contract is runtime-neutral. The live baseline adapter
serves the same cases from a deterministic local origin, opens the declared tab
workspace in the connected Chromium browser, submits the turn through the
loaded Onhand extension and real Pi loop, then normalizes the persisted session
trace. This does not replace `eval:page-prompts`; it adds a task-level gate.

## Files

- `evals/agent-trajectories/cases.json`: versioned task fixtures.
- `evals/agent-trajectories/schema.json`: fixture JSON Schema.
- `evals/agent-trajectories/trace-schema.json`: normalized trace JSON Schema.
- `scripts/lib/agent-trajectory-eval.mjs`: validation, scoring, and aggregation.
- `scripts/lib/agent-trajectory-fixtures.mjs`: deterministic HTML/PDF workspace
  server and live-session trace normalizer.
- `scripts/run-agent-trajectory-eval.mjs`: command-line entry point.
- `scripts/run-agent-trajectory-baseline.mjs`: live Chromium/Pi baseline runner.
- `scripts/run-agent-trajectory-eval-regressions.mjs`: scorer regressions.

## Commands

Validate the full fixture suite and show its model/profile matrix:

```sh
npm run eval:agent-trajectories
```

List or filter cases:

```sh
npm run eval:agent-trajectories -- --list-cases
npm run eval:agent-trajectories -- --case selected-homework-workspace-research
npm run eval:agent-trajectories -- --profile guided-agent --json
```

Run the deterministic scorer tests:

```sh
npm run test:agent-trajectory-eval
```

Run one trajectory through the currently loaded unpacked extension and its
configured provider/model:

```sh
npm run eval:agent-trajectories:live -- \
  --case current-page-grounded-answer \
  --keep-tabs
```

The live runner expects Helium/Chromium on the normal CDP port (`9343` by
default). It writes `metadata.json`, normalized `traces.jsonl`, and JSON/Markdown
score reports beneath an ignored `tmp/agent-trajectories/<timestamp>/`
directory. `--keep-tabs` is useful for visible QA; omit it in repeated runs so
the fixture workspace is cleaned between cases.

To exclude personal tabs and browsing state, let the runner launch a stable,
ignored fixture-only browser profile:

```sh
npm run eval:agent-trajectories:live -- \
  --launch-isolated \
  --case current-page-grounded-answer
```

The isolated profile defaults to `tmp/agent-trajectory-browser-profile` and
loads only the unpacked extension. Keeping this profile stable is important for
honest free-tier testing because it preserves the same anonymous device
identity across runs. A separate window in the user's normal profile does not
provide equivalent isolation because Onhand intentionally scans workspace
metadata across all open browser windows.

To exercise cancellation deterministically, select exactly one case and pass a
delay. The runner waits until the runtime reports an active request, starts the
delay, sends Onhand's real stop command, and persists whatever terminal session
trace the runtime returns:

```sh
npm run eval:agent-trajectories:live -- \
  --launch-isolated \
  --case selected-homework-workspace-research \
  --cancel-after-ms 1500
```

Score normalized traces:

```sh
npm run eval:agent-trajectories -- --trace-file tmp/agent-trajectories/run.jsonl
```

The scoring command exits nonzero if any selected trajectory fails.

## Fixture contract

Each case defines:

- the user turn, mode, selected text, and relevant learner state;
- the starting browser workspace, including unrelated distractor tabs;
- stable source and passage IDs exposed by the deterministic host;
- evidence slots that a successful answer must cover;
- whether each slot requires a citation or durable annotation;
- acceptable low-level and future macro-tool alternatives;
- mutation, focus, deduplication, error, call-count, and latency limits.

The suite intentionally allows both current low-level tools and the proposed
`browser_research_workspace` / `browser_annotate_evidence` tools (never built; the plan is archived and the fixture alternatives were removed). It evaluates
the outcome, not one mandatory tool sequence.

Page-, course-, prompt-, and topic-specific terms are fixture data only. They
must never be imported into production routing or tool-eligibility logic.

## Normalized trace contract

A model/browser adapter writes one JSON object per run. JSON arrays, an object
with a `traces` array, and JSONL are accepted.

```json
{
  "caseId": "current-page-grounded-answer",
  "profile": "legacy",
  "model": "configured-model-id",
  "iteration": 1,
  "completed": true,
  "honestLimitation": false,
  "reply": "...",
  "toolCalls": [
    {
      "name": "browser_extract_content",
      "state": "complete",
      "sourceId": "calibration-article",
      "passageIds": ["calibration-anchor"],
      "durationMs": 120
    }
  ],
  "evidenceUses": [
    {
      "slotId": "mechanism",
      "sourceId": "calibration-article",
      "passageId": "calibration-anchor",
      "citationPresent": true
    }
  ],
  "annotations": [
    {
      "sourceId": "calibration-article",
      "passageId": "calibration-anchor",
      "annotationId": "annotation-1"
    }
  ],
  "modelCalls": 1,
  "latencyMs": 1500,
  "costUsd": 0.001,
  "duplicateSources": 0,
  "focusChanges": 0,
  "unsupportedActionClaims": 0,
  "pageMutations": 1,
  "provisionalAnswerExposed": false
}
```

Adapters are responsible for mapping real URLs and browser artifacts to fixture
source IDs. The live adapter does that with opaque fixture routes plus exact
passage receipts in completed reads or annotations. The scorer does not infer
semantic support from filenames, lexical overlap, or the order of tool calls.
An evidence use is accepted only when its source/passage pair is explicitly
valid for that fixture slot.

## Scoring

The deterministic score is:

- 25% task completion;
- 40% evidence-slot coverage, including required citations and annotations;
- 20% behavior: mutation policy, deduplication, focus, provisional output, and
  truthful action reporting;
- 15% efficiency: model calls, tool calls, and tool errors.

A run passes only if it reaches the score threshold (0.90 by default) and has
no hard failure. Missing required evidence, prohibited mutations, duplicate
sources, unsolicited focus changes, unsupported action claims, exposed
provisional answers, required-tool omissions, and exceeded case limits are hard
failures.

Latency and provider-reported cost are retained in the result. Aggregation
reports pass rate, average score, p95 latency, total cost, and cost per
successful task for each profile/model combination.

## Baseline protocol

Before enabling either new execution profile:

1. Run every case against the current `legacy` runtime with the configured
   Codex/frontier route at least five times.
2. Repeat with the production Onhand Free route and exact provider allowlist.
3. Save raw normalized JSONL, environment metadata, extension version/runtime
   revision, model/provider IDs, and the generated score report under an
   ignored `tmp/agent-trajectories/<timestamp>/` directory.
4. Record only aggregate, non-sensitive results in the corresponding PR. Never
   commit prompts captured from private pages, URLs, page text, keys, or user
   session data.
5. Run the same fixture revision against each new profile. A change is compared
   to the recorded baseline, not to a remembered one-off browser result.

Do not claim a Codex or free-tier baseline until this live adapter has produced
normalized traces for that exact configured route. Fabricated, oracle-planned,
or manually reconstructed traces are not valid baseline evidence.

## Next implementation step

Record five-run legacy baselines for the configured Codex/frontier and Onhand
Free routes. Use the resulting failures to drive the behavior-preserving module
extraction and profile work; do not add case-specific routing fixes.
