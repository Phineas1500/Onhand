# Onhand Test Fixtures

This document defines the preferred fixture set for manual and Computer Use smoke tests.

Use:

- `npm run test:fixtures` for the full bundle
- `npm run test:fixtures -- trump` to filter by a term
- `npm run test:fixtures -- --json` for machine-readable output

These fixtures are chosen from URLs that have already shown up repeatedly in prior Onhand sessions, with an emphasis on:

- stable availability
- coverage of distinct product risks
- realistic user questions
- good visual stress cases for notes, highlights, side panel behavior, and Learning Mode

## Selection Rules

Prefer fixtures that are:

- already used in prior sessions
- likely to remain reachable without expiring auth
- visually rich enough to expose annotation/layout bugs
- semantically rich enough to test deep explanation instead of only lookup

Avoid using:

- signed, expiring URLs when a stable alternative exists
- personal mail/chat/docs unless explicitly needed
- pages that are too thin to test grounding properly

## Primary Fixture Set

### 1. Long Article With Infobox and Dense Body

**URL**
- `https://en.wikipedia.org/wiki/Donald_Trump`

**Why this is in the set**
- very frequently used in prior sessions
- large article with many sections and an infobox
- good for verifying:
  - note placement around the right-side infobox
  - multi-highlight grounding
  - causal / change-over-time questions
  - multi-claim evidence selection
  - inline citations in the reply

**Best test prompts**
- `how did he win the 2024 election after losing in 2020?`
- `what changed between 2020 and 2024?`
- `use the page to support each major claim`

**Main product risks covered**
- note overlap with infobox
- weak grounding vs. unsupported explanation
- multi-highlight + multi-note behavior
- current-turn reply rendering

### 2. Article With Infobox, Narrow Content Column, and Visual Placement Pressure

**URL**
- `https://en.wikipedia.org/wiki/Shah_Rukh_Khan`

**Why this is in the set**
- repeatedly used to expose note width / placement problems
- body text is narrow enough that oversized notes look bad quickly
- good for testing whether notes adapt to available width instead of colliding with the infobox

**Best test prompts**
- `why did he become such a big star?`
- `what on this page best explains his rise?`

**Main product risks covered**
- note width and wrapping
- highlight selection quality
- answer-to-evidence proportionality
- over-grounding vs. selective grounding

### 3. STEM Notes Page With Mathematical Content

**URL**
- `https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/06BayesianDL/BayesianDL.html`

**Why this is in the set**
- repeatedly used in prior sessions
- strong fit for:
  - math rendering
  - Learning Mode
  - longer technical explanations
  - definition-first and derivation-style tutoring

**Best test prompts**
- `explain this section step by step`
- `what is the key intuition here?`
- `teach this in learning mode`

**Main product risks covered**
- markdown/LaTeX rendering in the reply
- Learning Mode behavior
- explanatory depth on a technical page
- STEM readability in the side panel

### 4. Structured Course Notes / Set Theory Page

**URL**
- `https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/12sets/sets.html`

**Why this is in the set**
- used in the learning-mode failure case already observed
- good for explanatory prompts where the user has notes open and wants help connecting ideas
- useful for checking multi-tab synthesis against nearby lecture pages or PDFs

**Best test prompts**
- `use the notes I have open to help me understand how to solve this problem`
- `what prerequisite should I read first?`
- `explain the misconception behind this question`

**Main product risks covered**
- Learning Mode scaffolding
- reasoning-to-final-reply handoff
- current-turn preservation
- multi-source tutoring behavior

### 5. Jupyter-Like Technical Page With Nested Lists / Rich DOM

**URL**
- `https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/07cnn/CNNs.html`

**Why this is in the set**
- has already exposed annotation behavior on nested list items and notebook-like content
- useful for testing highlight anchoring on less conventional DOM structures

**Best test prompts**
- `explain this CNN filter step`
- `why does the next layer have different channels?`

**Main product risks covered**
- annotation anchoring in notebook-style pages
- scrolling to annotations in long technical content
- note placement near list items and equations

### 6. Stable PDF Fixture

**URL**
- `https://cdn-uploads.piazza.com/paste/iiw7c9aoSkA/0df25398a27137b9c250be0fd7b5bce3f8bcc6425fde1b25403799364c9cd8ba/practice_midterm_2025.pdf`

**Why this is in the set**
- it appeared repeatedly in prior sessions
- unlike signed Gradescope URLs, it is less likely to expire
- useful for testing the native Chrome side panel against the PDF viewer

**Best test prompts**
- `use my notes to help me understand how to solve this problem`
- `what page should I read first to solve this?`
- `explain this problem setup`

**Main product risks covered**
- side panel behavior on PDFs
- preserving the PDF viewer while Onhand is active
- PDF-grounded tutoring flows
- switching between HTML notes and PDF tabs

## Secondary Fixtures

These are useful, but not part of the minimum smoke set.

### Personal Computer History
- `https://en.wikipedia.org/wiki/Personal_computer`
- good for multi-highlight factual comparison
- good for note placement in article prose without heavy political content

### Steve Wozniak
- `https://en.wikipedia.org/wiki/Steve_Wozniak`
- useful for “how much did X contribute?” style questions
- good for checking whether the agent uses deeper sections, not only the intro

### Graph Representation Notes
- `https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/13GNNs/Graph_Representations_part1.html`
- useful for cross-tab technical synthesis with other Purdue notes

## Preferred Core Fixture Bundle

If only one compact test bundle is open, use:

1. `Donald_Trump` Wikipedia page
2. `Shah_Rukh_Khan` Wikipedia page
3. `BayesianDL` Purdue notes
4. `sets` Purdue notes
5. `CNNs` Purdue notes
6. `practice_midterm_2025.pdf`

This bundle covers:

- article-style grounding
- infobox-aware note placement
- STEM explanation
- Learning Mode
- PDF side panel behavior
- multi-tab synthesis

## Fixture-to-Scenario Mapping

### Side panel / annotation UI regressions

Use:
- `Donald_Trump`
- `Shah_Rukh_Khan`

### Learning Mode / tutoring regressions

Use:
- `sets`
- `BayesianDL`
- `practice_midterm_2025.pdf`

### DOM anchoring regressions

Use:
- `CNNs`

### PDF behavior regressions

Use:
- `practice_midterm_2025.pdf`

### Multi-tab synthesis regressions

Use:
- `sets`
- `BayesianDL`
- `CNNs`
- `practice_midterm_2025.pdf`

## Fixture Notes

- Prefer the Piazza PDF over the signed Gradescope PDF for repeatable testing.
- Prefer the Purdue lecture pages over arbitrary web pages for STEM tutoring tests because they are already part of your real use case.
- Prefer `Donald_Trump` over thinner biography pages when you need to test deep causal explanation, because it contains more explicit evidence across sections.
- Prefer `Shah_Rukh_Khan` when testing note sizing and infobox collisions, because it has already exposed those issues in practice.

## Suggested Standard Prompts

Use these repeatedly so regressions are easier to spot:

- `why did he become such a big star?`
- `how did he win the 2024 election after losing in 2020?`
- `use the notes I have open to help me understand how to solve this problem`
- `teach this in learning mode`
- `what prerequisite concept should I read first?`
- `compare what these two tabs are saying`

## Fixture Helper

The fixture helper script prints this bundle directly:

- `npm run test:fixtures`
- `npm run test:fixtures -- learning`
- `node ./scripts/show-test-fixtures.mjs --json`
