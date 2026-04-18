# Onhand Testing Workflow

## Purpose

Onhand has two different kinds of correctness:

1. **runtime correctness**
   - prompt routing
   - session persistence
   - state transitions
   - browser action payloads
   - artifact creation / restore metadata

2. **product correctness**
   - the popup appears and dismisses at the right time
   - the Chrome side panel opens when expected
   - notes/highlights are visible and placed well
   - markdown/LaTeX are readable
   - PDFs stay intact
   - the experience feels like the intended user flow

The first class should be tested with deterministic code/runtime checks whenever possible.
The second class often requires **Computer Use** because the real behavior only exists in the live GUI.

This document defines the default testing procedure for code changes and when to use Computer Use.

## Canonical Test Environments

Use the environments deliberately instead of treating every connected browser the same.

- `Chrome Test` is the canonical **Tier 3** browser.
  - Use it for authoritative GUI validation with Computer Use.
  - Use it for side panel behavior, annotation placement, rendered markdown/LaTeX, PDF behavior, and real user-flow checks.

- `Helium` is a secondary / personal browser surface.
  - It is useful for quick sanity checks and multi-browser routing checks.
  - It is **not** the default authoritative GUI test surface.

- `Desktop popup/API submit` and `browser side panel submit` are two intentional paths, not interchangeable ones.
  - `desktop/API submit` is the fast path for Tier 2 runtime checks.
  - `side panel submit` in `Chrome Test` is the authoritative path for end-to-end UX checks.

- Do not treat desktop-triggered native side-panel auto-open as the authoritative expectation.
  - Chrome does not reliably allow an external desktop app to open the native extension side panel.
  - If the behavior under test is the real side-panel UX, open and submit from the extension UI itself.

## Testing Principles

- Test the cheapest reliable thing first.
- Do not use Computer Use when logs, state inspection, or local API checks already answer the question.
- Use Computer Use for GUI-sensitive behavior, not as a replacement for code-level validation.
- Narrow the test to the smallest realistic user flow that proves the change works.
- Report what was actually verified and what remains unverified.

## Default Change Procedure

For any non-trivial change:

1. Define the expected outcome before editing.
   - Example: `follow-up reply should stay attached to the current turn`
   - Example: `Learning Mode should add a retrieval-check prompt for explanatory questions`

2. Make the code change.

3. Run fast validation on touched code.
   - `node --check` on changed JS files
   - any targeted command that validates the changed path

4. Restart or reload only what changed.
   - `apps/desktop/*` changed: restart `npm run desktop`
   - `packages/browser-extension/*` changed: reload the unpacked extension
   - `packages/browser-bridge/*` changed: restart `npm run bridge`
   - before Tier 2 or Tier 3 runs, use `npm run test:preflight` to confirm the local test surfaces are up

5. Run structured non-GUI checks if they can prove behavior.
   - inspect saved session JSONL
   - inspect local UI state / API responses
   - verify page-action payloads, artifact records, and session transitions

6. Use Computer Use if the success criteria are visual, timing-sensitive, or require real browser/Electron interaction.

7. Summarize the result.
   - what was tested
   - what passed
   - what still needs manual confirmation, if anything

## Validation Tiers

### Tier 1: Static / Local Validation

Use first for almost every change.

Examples:
- `node --check` on touched files
- inspect diffs to confirm the intended code path changed
- check session files under `.onhand/sessions/desktop`
- check persisted browser artifacts under `.onhand/artifacts/browser`

This tier is sufficient for:
- syntax and import errors
- obvious state-shape bugs
- prompt text changes where only saved output matters
- artifact metadata correctness

### Tier 2: Structured Runtime Validation

Use when the runtime behavior matters, but GUI fidelity does not.

Examples:
- submit a prompt via the local runtime and inspect the resulting session
- verify `uiState` and page-action payloads
- inspect whether a final reply was written to session JSONL
- confirm a restore operation produced the expected saved records
- run `npm run inspect:latest-session` to summarize the newest desktop session turn
- run `npm run test:fixtures` to pull the standard fixture URLs and prompts for the scenario you are checking

This tier is sufficient for:
- prompt/policy regressions
- session naming / switching / stopping bugs
- missing reply vs. saved-session mismatches
- page-action generation bugs

### Tier 3: Computer Use Validation

Use when the product behavior depends on the actual GUI.

Examples:
- verifying the Electron popup appears and dismisses correctly
- verifying Chrome side panel open/close behavior
- checking notes/highlights/scroll behavior on real pages
- verifying rendered markdown/LaTeX readability
- confirming PDFs remain visible and usable
- checking upload flows and attachment behavior

This tier is required when:
- the bug is only reproducible through the real UI
- layout, focus, timing, or scrolling are part of the acceptance criteria
- visual grounding on the live page is part of the feature

## When to Use Computer Use

Use Computer Use for:

- popup / side panel open-close timing
- extension UI interaction
- page annotation placement and visibility
- PDF viewer behavior
- rendered markdown / LaTeX / citation QA
- end-to-end follow-up flows inside the real product
- session restore flows that need real tabs to reopen and re-render

## When Not to Use Computer Use

Do not use Computer Use for:

- pure prompt text edits where session output is enough to validate the change
- backend-only state fixes that can be proven from runtime state or saved sessions
- syntax or module validation
- cases where logs or saved artifacts already settle the issue
- broad exploratory clicking through personal apps or unrelated windows

## Onhand-Specific Change Matrix

### Prompt or Mode Changes

Default:
- Tier 1
- Tier 2

Add Tier 3 only if:
- the change affects how the response appears in the side panel
- the change is tied to visual grounding, annotations, or visible turn behavior

Examples:
- system prompt grounding refinement: Tier 2 first
- Learning Mode response structure + sidebar rendering: Tier 2 plus Tier 3

### Desktop Popup Changes

Default:
- Tier 1
- Tier 3

Reason:
- popup timing, focus, dismiss, and interaction are GUI-only behaviors

### Browser Extension / Side Panel Changes

Default:
- Tier 1
- Tier 3

Reason:
- side panel open/close timing, rendering, and real browser behavior matter

### Page Annotation / Restore Changes

Default:
- Tier 1
- Tier 2
- Tier 3

Reason:
- payloads can be checked structurally, but note placement and scroll-to-annotation must be seen

### PDF Support Changes

Default:
- Tier 1
- Tier 3

Reason:
- PDF viewer behavior is inherently visual and browser-specific

### Session / Artifact Management Changes

Default:
- Tier 1
- Tier 2

Add Tier 3 if:
- the user flow includes visible restore, session switching in the side panel, or reopen behavior

## Required Service Reload Procedure

After edits, apply the smallest necessary restart/reload:

- Desktop app changes:
  - restart `npm run desktop`

- Browser extension changes:
  - reload the unpacked extension in Chrome

- Browser bridge changes:
  - restart `npm run bridge`

If the test depends on all three surfaces, restart/reload all three before the GUI test.

## Computer Use Operating Rules

When using Computer Use:

- prefer a dedicated Chrome window for testing
- keep the flow narrow and intentional
- avoid touching unrelated personal tabs or apps
- reproduce the smallest real user journey that proves the fix
- stop if the next step would send sensitive data or perform a risky action

## Default Submission Paths

### Desktop / API Submit

Use this path for:

- prompt and mode regressions
- session switching / stop / restore payload checks
- browser action generation checks
- quick routing validation against a chosen browser client

This path is the programmatic equivalent of sending from the desktop popup. It is faster and better for Tier 2 checks, but it is not the authoritative way to validate native side-panel UX.

### Sidebar Submit

Use this path for:

- reply rendering and readability
- live reasoning visibility
- page-action placement and clickthrough
- follow-up turn behavior
- PDF behavior
- attachment flows

This path is the authoritative Tier 3 check because it matches how the browser-first product is supposed to work.

## Standard Smoke Sequences

Use the same named flows repeatedly instead of improvising.

See `docs/SMOKE_TESTS.md` for the exact fixtures, prompts, and expected checks.

### Smoke A: Article Grounding

Default authoritative GUI smoke:

- environment: `Chrome Test`
- submission path: `sidebar submit`
- fixture: `Donald_Trump`
- purpose:
  - side panel reply behavior
  - reasoning visibility during a longer run
  - highlights / notes / citations / page actions
  - follow-up behavior in the same session

### Smoke B: Learning Mode

Default pedagogy smoke:

- environment: `Chrome Test`
- submission path: `sidebar submit`
- fixture: `sets` or `BayesianDL`
- purpose:
  - Learning Mode behavior
  - reply preservation
  - tutoring-style grounding on technical material

### Smoke C: Quick Runtime Check

Default fast regression check:

- environment: targeted browser client, usually `Chrome Test`
- submission path: `desktop/API submit`
- fixture: depends on the change
- purpose:
  - verify the run completes
  - inspect the saved session quickly
  - confirm page actions / artifacts / session state

After this run, inspect with:

- `npm run inspect:latest-session`

## Preflight

Before Tier 2 or Tier 3 validation, run:

- `npm run test:preflight`

This checks:

- browser bridge health
- desktop UI API health
- connected browser client count
- whether desktop session files are present

It does not verify extension reload state. That still requires a manual reload when browser-extension files changed.

The expected healthy setup for authoritative GUI testing is:

- bridge is up
- desktop UI API is up
- `Chrome Test` is connected
- the unpacked extension in Chrome has been reloaded if extension code changed

## Recommended Fixture Set

Maintain a small set of repeatable test scenarios:

- one normal HTML lecture-notes page
- one article / Wikipedia-style page
- one PDF
- one multi-tab comparison case
- one attachment/image upload case
- one Learning Mode explanatory question
- one follow-up-in-same-session case
- one restore-session-pages case

The goal is not exhaustive automation. The goal is reproducible smoke tests for the product’s core flows.

Preferred fixture URLs and prompt suggestions are documented in `docs/TEST_FIXTURES.md`.

## Reporting Expectations

When reporting a test result, include:

- which tier(s) were used
- which environment was used (`Chrome Test`, `Helium`, desktop/API only)
- which submission path was used (`desktop/API` or `sidebar`)
- which fixture and prompt were used
- what passed
- what remains unverified

## Suggested End-to-End Smoke Test Template

For a UI-sensitive change:

1. Start / restart required local services.
2. Reload the extension if needed.
3. Open the dedicated browser test window.
4. Reproduce the intended user flow.
5. Observe:
   - popup behavior
   - side panel behavior
   - rendered reply
   - notes / highlights / citations
   - session controls or restore behavior, if relevant
6. Inspect saved session/artifact state if the result is ambiguous.
7. Report pass/fail with the exact checked scenario.

## Reporting Template

When closing out a change, report:

- `Code checks:` which files passed `node --check`
- `Structured checks:` what runtime/session/artifact behavior was validated without GUI
- `Computer Use checks:` what real UI flow was executed
- `Not verified:` anything still untested or only inferred

## Current Default

Until stronger automation exists:

- backend/state/prompt fixes should default to Tier 1 + Tier 2
- popup/side-panel/annotation/PDF/rendering changes should default to Tier 1 + Tier 3
- ambiguous user-reported bugs should be reproduced with Computer Use when the live UI is part of the bug
