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

- `npm run inspect:latest-session`

### Tier guidance

- minimum: Tier 2

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
