# Onhand Smoke Tests

This document defines the default smoke-test flows that future Codex runs should reuse.

These are intentionally small and repeatable. They are not exhaustive QA plans.

## Rules

- Prefer `Chrome Test` for authoritative GUI checks.
- Prefer `sidebar submit` for end-to-end UX validation.
- Use `desktop/API submit` only when the goal is a quick runtime check.
- Prefer the managed local runtime:
  - `npm run tmux:start`
  - `npm run tmux:status`
  - `npm run tmux:attach`
  - `npm run tmux:stop`
- Start with `npm run test:preflight`.
- If browser-extension code changed, reload the unpacked extension in Chrome before the run.
- If preflight reports extension runtime as `STALE`, reload the unpacked extension or restart Chrome before browser smokes.
- If desktop or bridge code changed and you are using the managed runtime, prefer:
  - `npm run tmux:stop`
  - `npm run tmux:start`
- If you are not using the managed runtime:
  - desktop code changed: restart `npm run desktop`
  - bridge code changed: restart `npm run bridge`

## Smoke A: Article Grounding

Use this as the default browser UX smoke test.

### Setup

- environment: `Chrome Test`
- submission path: `sidebar submit`
- fixture URL: `https://en.wikipedia.org/wiki/Donald_Trump`
- prompt: `how did he win the 2024 election after losing in 2020?`

### What to verify

- the side panel is open and usable
- reasoning remains visible during the run
- the reply completes and stays attached to the current turn
- at least one relevant highlight appears
- at least one relevant note appears
- inline citations or page actions jump to the intended grounded passage
- a follow-up in the same session stays below the first turn and does not destroy prior turns

### Tier guidance

- minimum: Tier 3
- useful companion: Tier 2 via `npm run inspect:latest-session`

## Smoke B: Learning Mode

Use this to validate pedagogical behavior on technical material.

### Setup

- environment: `Chrome Test`
- submission path: `sidebar submit`
- fixture URL:
  - `https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/12sets/sets.html`
  - or `https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/06BayesianDL/BayesianDL.html`
- prompt:
  - `teach this in learning mode`
  - or `use the notes I have open to help me understand how to solve this problem`

### What to verify

- Learning Mode is on
- the reply actually appears at the end of the run
- the run does not stop at reasoning-only with `Reply ready`
- the response behaves like a tutor rather than a pure lookup answer
- technical formatting is readable
- prior turns remain intact after a follow-up

### Tier guidance

- minimum: Tier 2 plus Tier 3

## Smoke B2: Technical / Math / CS Grounding

Use this to validate whether Onhand can answer from dense technical pages, choose the right evidence, and stop after enough grounding.

### Setup

- environment: `Chrome Test`
- submission path: `desktop/API submit` for quick checks, `sidebar submit` for visual QA
- fixture ids:
  - `pytorch_conv2d`
  - `annotated_transformer`
  - `cp_algorithms_dijkstra_sparse`
  - `distill_attention_rnns`
  - `wikipedia_fft`
  - `arxiv_attention_transformer`

### What to verify

- the run produces a final reply, not only highlights/notes
- the reply addresses the user's technical question rather than summarizing the page generically
- selected highlights point to the equation, code, parameter semantics, or explanatory passage that actually supports the answer
- notes remain readable on docs, notebook, arXiv, Wikipedia, and article layouts
- formula/code highlights do not fail just because the rendered text differs from the literal query
- dense pages do not continue tool use after enough evidence is gathered

### Commands

- `npm run smoke:tier2 -- --fixture=cp_algorithms_dijkstra_sparse --prompt=0 --browser-client="Chrome Test" --expect-actions --expect-fixture-content --expect-provider=openai-codex --expect-model=gpt-5.5 --expect-api=openai-codex-responses`
- `npm run smoke:tier2 -- --fixture=pytorch_conv2d --prompt=0 --browser-client="Chrome Test" --expect-actions --expect-fixture-content --allow-tool-errors`
- `npm run smoke:tier2 -- --fixture=annotated_transformer --prompt=0 --browser-client="Chrome Test" --expect-actions --expect-fixture-content --timeout-ms=240000`

### Tier guidance

- minimum: Tier 2 for content/finalization
- add Tier 3 when checking visual placement of notes/highlights

## Smoke C: PDF Side Panel

Use this whenever PDF behavior is affected.

### Setup

- environment: `Chrome Test`
- submission path: `sidebar submit`
- fixture URL: `https://cdn-uploads.piazza.com/paste/iiw7c9aoSkA/0df25398a27137b9c250be0fd7b5bce3f8bcc6425fde1b25403799364c9cd8ba/practice_midterm_2025.pdf`
- prompt: `use my notes to help me understand how to solve this problem`

### What to verify

- the PDF viewer stays visible
- the side panel does not destroy or replace the PDF surface
- the run completes
- the reply is readable in the side panel
- cross-tab movement between notes and PDF still works if relevant

### Tier guidance

- minimum: Tier 3

## Smoke D: Quick Runtime Check

Use this when the change is mostly runtime/state/prompt logic and a full GUI run is unnecessary.

### Setup

- environment: usually `Chrome Test`
- submission path: `desktop/API submit`
- fixture: choose from `docs/TEST_FIXTURES.md`

### What to verify

- the run starts and completes
- the latest saved session contains the expected final reply
- the page actions are structurally correct
- any artifacts or restore metadata are present if expected

### Commands

- `npm run smoke:tier2 -- --fixture=onhand_github_repo --prompt=0 --expect-actions`
- `npm run smoke:tier2 -- --fixture=onhand_github_repo --prompt=0 --browser-client="Chrome Test" --expect-actions --expect-provider=openai-codex --expect-model=gpt-5.5 --expect-api=openai-codex-responses`
- exploratory URL smoke:
  `npm run smoke:tier2 -- --url=https://cp-algorithms.com/graph/dijkstra_sparse.html --title="cp-algorithms Dijkstra Sparse" --prompt="Guide me through why sparse-graph Dijkstra needs a priority queue or set and what complexity tradeoff the page is making." --browser-client="Chrome Test" --expect-actions`
- technical fixture with content assertions:
  `npm run smoke:tier2 -- --fixture=cp_algorithms_dijkstra_sparse --prompt=0 --browser-client="Chrome Test" --expect-actions --expect-fixture-content`
- `npm run inspect:latest-session`

### Tier guidance

- minimum: Tier 2
- use the exploratory `--url` path for technical/math/CS pages that are not stable enough to add to `docs/TEST_FIXTURES.md` yet
- for exploratory content QA, inspect whether the selected highlights are the right evidence for the prompt, not only whether the smoke exits successfully

## Smoke E: Multi-Browser Routing

Use this only when browser targeting or client binding changed.

### Setup

- environment: `Chrome Test` and `Helium` both connected
- submission path: `desktop/API submit`

### What to verify

- a prompt targeted to `Chrome Test` affects only Chrome
- a prompt targeted to `Helium` affects only Helium
- session restore and page-action clickthrough stay bound to the browser that created them

### Tier guidance

- minimum: Tier 2
- add Tier 3 only if the GUI behavior itself changed

## Smoke F: Direct Bridge Regression

Use this when browser bridge, browser extension, annotation, stale-extension detection, or client targeting changed.

This smoke does not call the model. It sends local bridge commands directly to the selected browser client, which makes failures faster and easier to attribute than a full agent run.

### Setup

- environment: usually `Chrome Test`
- submission path: direct bridge command
- fixture: `onhand_github_repo`

### What to verify

- the selected browser client matches the intended label/name
- the connected extension runtime revision matches the source tree
- `highlight_text` returns promptly for a README heading
- `get_visible_text` still returns after annotation mutations
- `show_note` can attach to the returned annotation id
- other connected browser clients keep their active tab unchanged

### Commands

- `npm run test:browser-bridge -- --browser-client="Chrome Test" --expect-client-label="Chrome Test"`
- `npm run test:browser-bridge -- --browser-client="Chrome Test" --expect-client-label="Chrome Test" --json`

### Tier guidance

- minimum: Tier 2
- run before a full model smoke when browser-command reliability is the main risk

## Smoke G: Note Layout Regression

Use this when note placement, highlight containers, page scrolling, or annotation CSS changed.

This smoke does not call the model. It navigates fixture pages through the local bridge, highlights representative text, calls `show_note`, and checks that the note card is visible, not horizontally or vertically overflowing the viewport, not clipped by overflow ancestors, and not inserted under invalid parents such as `p`, `pre`, `code`, `ul`, `table`, or GitHub `.markdown-heading`.

### Setup

- environment: usually `Chrome Test`
- submission path: direct bridge command
- default fixtures: `onhand_github_repo`, `personal_computer`, `bayesian_dl`

### Commands

- `npm run test:note-layout -- --browser-client="Chrome Test"`
- `npm run test:note-layout -- --browser-client="Chrome Test" --fixture=anthropic_job_posting --max-cases=5`
- `npm run test:note-layout -- --browser-client="Chrome Test" --fixtures=onhand_github_repo,donald_trump,shah_rukh_khan,bayesian_dl,sets,cnns,graph_representations,anthropic_job_posting --max-cases=5`

### Tier guidance

- minimum: Tier 2 for deterministic placement coverage
- add Tier 3 if the page has sticky overlays, dynamic app chrome, or a visual issue that the DOM checks cannot fully prove
