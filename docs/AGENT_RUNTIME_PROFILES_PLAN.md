# Agent Runtime Profiles and Simplification Plan

Status: in progress
Date: 2026-07-21
Scope: browser-extension agent orchestration and Onhand Free model strategy

## Migration progress

- The trajectory fixture, scorer, live adapter, and privacy-safe turn counters
  are implemented. A 50-run legacy Codex baseline was recorded on 2026-07-21.
  The matching Onhand Free matrix is quota-blocked after one clean hosted-model
  run; the runner now stops explicitly at the quota boundary instead of
  misclassifying subsequent HTTP 429 responses as model-quality failures. See
  `docs/AGENT_TRAJECTORY_BASELINE_2026-07-21.md`.
- The behavior-preserving extraction has started: execution-profile
  resolution, constitution validation, browser-tool capability groups,
  runtime invariants, and research evidence types now live in dedicated
  modules. `legacy` remains the only active execution profile.
- `full-agent` and `guided-agent` are not active yet. No production semantic
  gate has been removed as part of the extraction milestone.

## Decision

Onhand will optimize first for the best agentic experience available from a
frontier model. The hosted free tier will remain useful and dependable, but it
will not define the ceiling or force cheap-model accommodations into the
frontier execution path.

The browser runtime will support two explicit execution profiles:

- `full-agent`: the Codex/frontier path. It receives the broad browser tool
  surface, a compact constitution, and freedom to plan its own tool sequence.
- `guided-agent`: the hosted/free path. It receives a smaller set of
  higher-level tools that collapse fragile multi-call workflows into reliable
  browser operations.

A temporary `legacy` profile may exist only during migration and rollback. It
must have a deletion milestone; it is not a third permanent product mode.

Model price per token is not the primary optimization target. The free-tier
decision metric is cost per successfully completed, grounded task, including
retries, latency, and abandonment.

## Why this change is needed

`packages/browser-extension/src/browser-runtime.ts` is currently 15,000+ lines
and combines concerns that should be independently testable:

- the product constitution and turn-specific prompt instructions;
- model intent classification and regex fallbacks;
- prompt-shaped tool exposure;
- linked-document research planning, corpus retrieval, semantic reranking, and
  evidence assessment;
- annotation-quality budgets and tool-call interception;
- missing-tool, missing-highlight, missing-PDF-anchor, workspace-evidence, and
  blank-reply retries;
- the Pi agent lifecycle, browser command adapters, session persistence, and
  telemetry.

This coupling lowers the frontier model's ceiling while still failing to make a
cheap model reliable on long tool loops. A one-step model eval can pass while a
real task wanders through many tabs and never answers.

The target is not "remove deterministic code." The target is to keep
determinism for invariants and move semantic decisions back to the agent or to
an explicitly guided orchestration layer.

## Design boundaries

### Deterministic invariants: retain

These protect the user or make tool outcomes trustworthy. They apply to both
profiles unless noted otherwise.

- Authentication, quota enforcement, body limits, cancellation, and command
  timeouts.
- Explicit user prohibitions such as "answer only," "do not highlight," or
  "do not change the page."
- Tool schema and argument validation.
- Exact-text/page/occurrence verification for highlights and PDF anchors.
- Canonical URL and PDF-viewer deduplication.
- Background focus preservation unless the user asks to navigate to a source.
- Idempotent annotation reuse and duplicate-action suppression.
- Honest tool-result reporting: a model cannot claim an action succeeded when
  it did not.
- Session persistence, activity traces, source provenance, error reporting, and
  telemetry privacy.
- Infrastructure recovery such as bounded matching candidates for an exact
  highlight and one transport-level retry for an empty model response.

Relevant existing code includes `createTools`, command timeouts, highlight
matching/replay, `applyLearningBackgroundFocusDefault`,
`buildDuplicateTabNavigationGuardResult`, `buildEmptyHighlightTextGuardResult`,
session persistence, and `packages/browser-extension/src/pdf-corpus-search.ts`.

### Semantic orchestration: remove from the full-agent path

The following mechanisms make judgments about how a capable model should solve
the task. The `full-agent` profile should not depend on them:

- `selectToolsForPrompt` and prompt-regex tool eligibility, except for explicit
  user prohibitions and disabled runtime capabilities.
- `missingToolRetryToolNamesForPrompt` and the finalize-time missing-tool retry.
  The full profile should receive the tools from the start.
- Automatic `planLearningResearch`, corpus reranking, and evidence-assessment
  passes before or after the main frontier agent.
- `shouldRequireLearningWorkspaceEvidence` and its retry loop.
- `shouldRequirePageSourceMarkerRetry` and the page-source retry loop.
- `shouldRequirePdfAnchorRetry` and the PDF-anchor retry loop.
- Soft annotation-policy interceptors that block a valid model action based on
  a guessed response shape: structured/compact/review highlight budgets,
  surplus note/highlight guards, named-formula/concept-location sequencing,
  review-extraction-first, and selection-first workflow enforcement.
- Semantic regex predicates used to decide comparison, teaching, enumerable
  coverage, cross-tab research, or PDF research access.

This behavior may remain temporarily in `legacy` while the new profiles are
validated. It must not remain as a silent fallback for `full-agent`.

### Guided orchestration: isolate and simplify

The current model classifier and research-planning work are useful prototypes,
but they should become a guided-profile subsystem instead of surrounding every
agent turn.

Move or replace:

- `classifyPromptIntentWithModel`;
- `buildLearningResearchPlannerPrompt` / `planLearningResearch`;
- `buildLearningCorpusRerankerPrompt`;
- `buildLearningEvidenceAssessmentPrompt`;
- `buildLearningResearchContinuationPrompt`;
- guided-only tool selection and retry policy.

The guided orchestrator should use a short dedicated system prompt. Internal
JSON calls must not include the full Onhand constitution. It should emit one
small typed plan rather than a collection of cached booleans that many runtime
predicates reinterpret.

Suggested plan shape:

```ts
type GuidedTaskKind =
  | "current-page"
  | "workspace-research"
  | "visual-explanation"
  | "page-interaction";

interface GuidedTurnPlan {
  taskKind: GuidedTaskKind;
  target: string;
  evidenceSlots: Array<{
    id: string;
    description: string;
    queries: string[];
  }>;
  mutationIntent: "default-annotations" | "none" | "explicit-interaction";
}
```

The runtime remains authoritative for permissions. The planner describes the
task; it does not grant access to consequential browser actions.

## Target module structure

Break the orchestration out of `browser-runtime.ts` before deleting behavior.
The first extraction must be behavior-preserving.

```text
packages/browser-extension/src/
  browser-runtime.ts                # host lifecycle, sessions, Pi Agent wiring
  agent/
    execution-profile.ts            # full/guided/temporary legacy resolution
    constitution.ts                 # compact stable product contract
    launcher-prompt.ts              # profile-specific turn context
    guided-orchestrator.ts           # typed guided plan and minimal JSON calls
  tools/
    registry.ts                     # tool metadata and capability tags
    runtime-invariants.ts            # validation, permissions, idempotency
    workspace-research.ts            # high-level research tool
    evidence-annotation.ts           # source-id based annotation tool
  research/
    pdf-corpus-search.ts             # move/re-export current recall engine
    evidence-types.ts
```

Keep `browser-runtime.ts` as the public runtime entry point during the
migration. Existing imports and the bundled test export should continue to work
until tests consume the extracted modules directly.

## Tool strategy

### Full-agent tool surface

The full profile should receive all enabled Onhand browser tools at turn start.
Tools may be absent only because:

- a user or browser permission explicitly forbids the capability;
- the feature is disabled in settings;
- the active platform cannot support it;
- Learning Mode adds an internal learning-state tool that Answer Mode does not
  need.

Prompt wording must not be the reason a read, PDF, workspace, or annotation tool
is unavailable. Tool descriptions and the compact constitution explain when to
use them; runtime invariants validate what happens when they are called.

### Guided-agent tool surface

The guided profile should avoid asking a cheap model to coordinate a long chain
of low-level tab and PDF operations. Add two general-purpose tools.

#### `browser_research_workspace`

Inputs:

- resolved question/target;
- optional selected text;
- evidence slots;
- source scope (`open-tabs`, `linked-documents`, or both);
- bounded time/source budgets supplied by runtime configuration.

Behavior:

- inventories eligible tabs without changing focus;
- searches the current page, relevant open pages, and linked document
  collections;
- performs broad deterministic recall;
- performs one semantic evidence-selection pass when needed;
- returns coverage by evidence slot, ranked passages, stable source IDs,
  citation-ready locations, and search statistics;
- does not open one tab per candidate.

The current linked-PDF corpus implementation is the foundation, not something
to discard. Its lexical score remains recall-only and must never be presented
as semantic relevance.

#### `browser_annotate_evidence`

Inputs:

- one or more stable source IDs returned by workspace research;
- optional short notes;
- whether to reveal/focus the source, defaulting to false.

Behavior:

- reuses or opens the canonical source/viewer in the background;
- verifies the page and exact passage;
- places idempotent highlights/notes;
- returns annotation IDs and honest per-source failures.

This collapses `navigate -> open viewer -> search -> read -> highlight -> note`
into one trustworthy operation while still leaving the low-level tools
available to the full agent.

## Model and profile resolution

Add an explicit capability record instead of spreading provider-name checks
through the runtime:

```ts
interface ModelExecutionCapabilities {
  defaultProfile: "full-agent" | "guided-agent";
  reliableNativeTools: boolean;
  reliableParallelTools: boolean;
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
  recommendedMaxToolSteps: number;
}
```

Initial defaults:

- OpenAI Codex sign-in: `full-agent`.
- Onhand Free: `guided-agent`.
- BYOK providers: capability-manifest default with an advanced user override.

Do not infer the execution profile from the wording of an individual prompt.
The profile is a model/runtime capability choice. Within the guided profile, a
model planner may classify the task and select a high-level workflow.

## Prompt simplification

Split prompt content into three layers:

1. **Stable constitution:** page as canvas, grounded claims, teach-don't-tell,
   user pages first, honesty, and user control.
2. **Mode policy:** concise Learning Mode or Answer Mode behavior.
3. **Turn context:** page/selection/session state and relevant tool reminders.

Remove repeated operational recipes from the global prompt once the relevant
tool description or runtime invariant owns them. In particular, navigation
deduplication, exact highlighting mechanics, retry budgets, focus restoration,
and PDF-viewer reuse should not be explained to the model in multiple places.

The full profile's prompt should describe outcomes and constraints, not a
mandatory algorithm. The guided profile may contain a short workflow contract
for its small set of macro tools.

## Evaluation redesign

The existing free-tier eval remains useful as a fast unit check, but it cannot
be the release gate for an agentic workflow. Add a production-shaped trajectory
runner, tentatively `scripts/run-agent-trajectory-eval.mjs`.

The fixture, normalized-trace, and deterministic-scoring contracts are
specified in `docs/AGENT_TRAJECTORY_EVAL.md`.

### Evaluation levels

1. **Tool contract tests:** schemas, invariant enforcement, deduplication,
   source IDs, focus preservation, cancellation, and honest failures.
2. **Model trajectory replay:** real model calls against a deterministic mock
   browser host that returns recorded page/tool results.
3. **Live Chrome acceptance:** the unpacked extension on real sites and PDFs,
   after a real reload from `chrome://extensions`.

### Required trajectory cases

- Simple current-page question requiring one source highlight.
- Selected-text deictic question where selection is the authoritative target.
- Homework problem plus an open course/index tab and linked lecture PDFs.
- Two-open-paper comparison with one source mark per paper.
- Citation chase from one paper into the cited work.
- Visual PDF figure or equation question.
- Explicit "answer only / no page changes" request.
- Unsupported or insufficient source requiring an honest limitation.
- Relevant background tab among unrelated tabs.
- Repeated concept and open-check Learning Mode follow-up.

Page-, course-, and prompt-specific strings belong in fixtures only. Production
behavior must remain structural and domain-independent.

### Metrics and release thresholds

Collect per trajectory and per model:

- successful grounded task completion;
- evidence-slot coverage and citation correctness;
- wall-clock and time-to-first-useful-progress latency;
- model calls, tool calls, retries, and total tokens;
- actual provider-reported cost;
- duplicate tabs/viewers;
- unsolicited focus changes;
- provisional-answer exposure;
- unsupported-action claims;
- user cancellation and error rate.

Initial guided-profile targets:

- at least 90% task completion across the trajectory suite;
- at least 95% supported-claim grounding;
- zero duplicate source tabs/viewers;
- zero unsolicited focus changes;
- no provisional answer before required research completes;
- no more than five model calls for a normal workspace-research task;
- p95 completion below 45 seconds on the production provider route.

Run every model/trajectory pair at least five times. A model cannot be promoted
from a single clean run.

## Free-tier model bakeoff

The initial challenger set should include:

- DeepSeek V4 Flash as the current control;
- DeepSeek V4 Pro;
- Gemini 3 Flash;
- GPT-5 Mini and/or GPT-5.4 Mini;
- Qwen3.7 Plus if its provider location and data policy are acceptable.

Refresh pricing and provider metadata at evaluation time. Test broad routing
first, then repeat finalists through the exact production provider allowlist
and privacy policy. Vision remains a separate lane until a multimodal candidate
passes the visual trajectory suite.

Prefer the model with the best successful-task cost, not the lowest nominal
token price. A more expensive model that completes a task in two or three calls
may cost less than a cheap model that consumes a long retry loop.

If one inexpensive model is not good enough for every free task, use an honest
two-level free experience:

- ordinary page questions use the fast economical model;
- workspace research uses a stronger model and a visible limited daily
  "deep task" allowance.

This product distinction is preferable to silently degrading the answer or
constraining the frontier profile.

## Observability changes

Extend privacy-safe turn telemetry with:

- `execution_profile`;
- `guided_task_kind`;
- `planner_model_category`;
- workspace source count and evidence-slot count;
- model-call and tool-call counts;
- research macro duration;
- duplicate-prevention count;
- focus-restoration count;
- completion versus stop/error;
- provider-reported aggregate token/cost fields already allowed by the privacy
  policy.

Never transmit prompts, page content, URLs, source excerpts, screenshots,
transcripts, or keys.

## Migration sequence

### PR 1: trajectory baseline and decision record

- Land this document.
- Add the trajectory fixture format and deterministic scoring schema.
- Record current Codex and Onhand Free baselines before changing behavior.
- Keep the existing runtime untouched.

### PR 2: behavior-preserving module extraction

- Extract tool registry, constitution, execution-profile types, runtime
  invariants, and research types.
- Keep `legacy` as the only active profile.
- Replace source-text assertions in
  `scripts/run-browser-runtime-regressions.mjs` with direct exported behavior
  tests where possible; source-shape tests would otherwise block safe module
  extraction.
- Require the existing regression, smoke, preflight, build, and live Chrome
  acceptance gates.

### PR 3: full-agent profile

- Resolve Codex/frontier models to `full-agent` behind a temporary setting.
- Give the profile all enabled tools up front.
- Use the compact prompt layers.
- Bypass semantic tool filtering, preflight planners, soft annotation guards,
  and semantic retry passes.
- Retain all runtime invariants.
- Compare full-agent versus legacy on the trajectory suite and live Chrome.

### PR 4: guided workspace tools

- Add `browser_research_workspace` and `browser_annotate_evidence`.
- Refactor linked-PDF corpus search behind the research tool.
- Add stable source IDs and citation/annotation handoff.
- Add deterministic tool-contract and browser replay tests.

### PR 5: guided-agent profile and model bakeoff

- Move the minimal typed planner into `guided-orchestrator.ts`.
- Give guided models the smaller macro-tool surface.
- Run the full challenger matrix with repeated trajectories.
- Select the model and provider route only after quality, latency, privacy, and
  successful-task cost all pass.

### PR 6: remove legacy semantic gates

- Make `full-agent` and `guided-agent` the only profiles.
- Delete retired prompt predicates, prompt-shaped tool filtering, soft guard
  chain, and finalize-time semantic retries.
- Remove the temporary profile flag and legacy-only test exports.
- Update the Constitution, behavior preferences, free-tier docs, testing
  workflow, and Chrome acceptance matrix to describe the final architecture.

### PR 7: free-tier rollout

- Deploy the selected free-tier route behind a server-side rollout percentage.
- Compare success, latency, cost, stops, and errors against the baseline.
- Roll back by model/profile configuration, not by restoring deleted semantic
  gates.

## Verification required for every runtime PR

```sh
git diff --check origin/main...HEAD
npm run build:extension
npm run test:browser-runtime-regressions
npm run smoke:browser-runtime -- --ports
npm run test:preflight
```

After any browser-extension source or bundle change:

1. Reload the real unpacked Onhand extension from `chrome://extensions` using
   Computer Use.
2. Verify the installed extension version and provider/profile status.
3. Run the relevant live Chrome acceptance trajectories.
4. Record exact model, profile, elapsed time, calls, mutations, and result.

Green unit scripts alone are not sufficient for runtime behavior changes.

## Completion criteria

This migration is complete only when:

- GPT/Codex runs through `full-agent` without prompt-shaped tool withholding or
  semantic retry gates;
- Onhand Free runs through `guided-agent` with production-quality success on
  the trajectory suite;
- both profiles share the same runtime invariants and provenance model;
- the legacy profile and its semantic guard/retry code are deleted;
- the system prompt no longer repeats mechanics owned by tools or runtime code;
- model selection is based on repeated successful-task economics;
- live Chrome validation confirms that the page remains the canvas: relevant
  sources are used, annotations land correctly, tabs are deduplicated, and
  background research does not steal focus.
