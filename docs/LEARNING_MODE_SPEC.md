# Onhand Learning Mode Spec

## Status

Learning Mode exists as a Phase 1 scaffold:

- Sidebar toggle for Learning Mode.
- Persisted setting included on prompt submission.
- Runtime prompt branch via `ONHAND_LEARNING_MODE_APPEND`.
- Learning Mode bias toward tab context via `browser_list_tabs`.

This spec defines the product behavior and implementation shape for the next education work, especially session-scoped learner state and the sidebar learning panel.

Implementation progress:

- Slice A is implemented in the browser runtime: `learnerState` is normalized with each session, exposed in runtime state, updateable through `recordLearningEvent`, and covered by browser-runtime regressions.
- Slice B is partially implemented: Learning Mode prompts now include compact learner-state context, detect likely repeated concepts in the latest prompt, and the agent has an internal `onhand_record_learning_event` tool for concept/check updates.
- Slice C is implemented in the sidebar: Learning Mode sessions with state now show a compact "This session" panel with covered concepts, open checks, and best-effort source jumps with visible success/failure feedback.
- Slice D is implemented in the Chrome acceptance matrix: Answer Mode control, Learning Mode concept prompt, open-check resolution, and repeated-concept refresher cases are available through `npm run acceptance:chrome -- --suite=learning`.
- Slice E is implemented as prompt-contract behavior: Learning Mode scans captured open tabs, offers related-tab connections before switching context, and has a manual Chrome acceptance case.
- Cross-session spaced review (pedagogy phase 4) is implemented: assessments are concept-linked, `computeDueReviews` schedules per-concept reviews across sessions with a Leitner-style ladder, and the sidebar shows a review nudge with Review now / snooze actions. Learning Mode turns that end in an unrecorded check question also get a fallback open check.

## Product thesis

Onhand should not become a course platform. Its advantage is contextual teaching over whatever the user already has open. Learning Mode should make the browser feel like a marked-up textbook with a tutor in the margin: page-anchored, concise, adaptive, and interruptible.

Answer Mode remains the default for fast grounded answers. Learning Mode is opt-in because users sometimes need a direct answer, not a teaching loop.

## Modes

### Answer Mode

Answer Mode is transactional:

- Find relevant evidence on the user's page or open tabs.
- Highlight the key material.
- Explain directly and concisely.
- Use notes only when they improve the reading experience.

### Learning Mode

Learning Mode is instructional:

- Ask before telling when the user is trying to understand a concept.
- Anchor teaching moves to page evidence.
- Track what has already been introduced in the session.
- Resolve open prediction or retrieval prompts before introducing new material.
- Collapse back to a direct answer when the user asks for one or shows frustration.

Learning Mode should still be concise. The difference is sequencing and adaptiveness, not verbosity.

## User-facing feature set

### Learning toggle

The existing toggle remains the entry point. It should communicate a stance change, not a separate product area.

Expected behavior:

- The setting persists across sidebar reloads.
- The current mode is included with every prompt.
- Turning the toggle off returns the agent to direct Answer Mode behavior.

### Page-anchored teaching prompts

When a user asks "how", "why", "what does this mean", or similar concept questions, the first Learning Mode response should usually include one of:

- A prerequisite highlight with a short "read this first" note.
- A prediction prompt on the relevant passage.
- A retrieval check after a short explanation.
- A hint that redirects attention to the evidence before correcting the user.

These prompts should be on-page when they refer to specific material. Chat-only Socratic questions are a fallback, not the signature interaction.

### This Session panel

Add a compact "This session" panel above the composer when Learning Mode is on and there is learner state to show.

The panel should show:

- Covered concepts.
- Open prediction or retrieval checks.
- Source affordances that jump back to the relevant highlight or note when possible.

The panel should avoid progress bars, streaks, scores, or course-like framing. It is a reading aid, not an LMS dashboard.

### Quick refresher behavior

If the user asks about a concept already introduced in the current session, Onhand should not restart the full explanation by default.

Expected behavior:

- Briefly remind the user that the concept came up earlier.
- Point back to the source highlight when possible.
- Offer or provide a concise refresher.
- Only re-explain fully if the user asks or appears confused.

### Cross-tab interleaving

Learning Mode should use Onhand's awareness of already-open tabs without stealing the user's attention.

Expected behavior:

- Treat the current tab as the primary teaching source unless the user explicitly asks for cross-tab comparison.
- Scan the captured open-tab list, and call `browser_list_tabs` only when the captured list is missing or ambiguous.
- If another open tab appears related, name it briefly and offer to connect it.
- Do not switch to, read, highlight, or note the related tab until the user accepts or directly asks for cross-tab work.
- Once the user accepts, anchor each tab separately and say which tab supports which claim.

### Direct-answer escape hatch

Learning Mode must not trap the user in Socratic interaction.

Collapse to a direct answer when:

- The user explicitly asks for the answer.
- The user asks for a study artifact such as a summary, formula sheet, or flashcards.
- The user says they are stuck, annoyed, or short on time.
- The agent has already asked one prompt and the user does not engage with it.

## Teaching moves

Learning Mode should use a small set of repeatable moves.

| Move | Trigger | Behavior |
|---|---|---|
| Prerequisite scaffold | The question depends on an unstated concept | Highlight the prerequisite first, then connect it to the question |
| Prediction prompt | The user asks a conceptual "how/why" question | Ask for a short prediction before revealing the explanation |
| Retrieval check | The agent has just explained a substantive idea | Ask the user to restate the claim or mechanism in their own words |
| Hint-before-correction | The user gives a partial or wrong answer | Point to the passage that resolves the issue before giving the correction |
| Misconception repair | The question implies a common wrong model | Name the misconception briefly and contrast it with the page evidence |
| Interleaving offer | Another open tab has related material | Offer to connect the two sources before pulling in the second tab |
| Direct-answer escape | User asks for speed or shows frustration | Answer directly while staying anchored |

## Learner state

Store learner state with the session, not globally. Session state gives enough adaptiveness for the next release without introducing account-level memory, review scheduling, or privacy questions.

Suggested shape:

```json
{
  "mode": "learning",
  "conceptsIntroduced": [
    {
      "conceptId": "concept_derivative",
      "label": "Derivative",
      "firstSeenAt": "2026-05-18T04:30:00.000Z",
      "lastSeenAt": "2026-05-18T04:35:00.000Z",
      "sources": [
        {
          "tabTitle": "Calculus notes",
          "url": "https://example.test/calculus",
          "annotationId": "ann_123",
          "artifactId": "artifact_456"
        }
      ]
    }
  ],
  "openChecks": [
    {
      "checkId": "check_789",
      "kind": "prediction",
      "conceptId": "concept_derivative",
      "promptText": "Before I explain: what do you think this derivative is measuring?",
      "annotationId": "ann_124",
      "askedAt": "2026-05-18T04:36:00.000Z"
    }
  ],
  "responses": [
    {
      "checkId": "check_789",
      "assessment": "partial",
      "resolvedAt": "2026-05-18T04:37:00.000Z",
      "evidence": "User connected derivative to rate of change but missed instantaneous behavior."
    }
  ]
}
```

Notes:

- `openChecks` intentionally combines predictions and retrieval checks. The UI can render them together, and the agent only needs to know what is waiting on the user.
- Runtime state keeps at most one open check per concept; a newer unresolved check for the same concept replaces the older one.
- A concept should be one reviewable learning unit, not every highlight, citation, note, or algebraic detail. If a follow-up point restates or locally elaborates an existing concept, the agent should reuse that conceptId and append/update the source.
- The runtime may merge near-duplicate concept events when their labels strongly overlap and their sources are on the same page or share an anchor. Distinct nearby concepts should remain separate when they would deserve separate retrieval checks.
- `assessment` is model-visible scaffolding, not a user-facing grade.
- Source links should be best effort. A concept can exist without a durable annotation if the runtime failed to place one.
- `artifactId` is optional until artifacts become the durable replay surface for spaced review.

## Runtime behavior

At the start of each Learning Mode turn, the runtime should surface a compact learner-state summary to the model:

- Concepts already introduced.
- Open checks awaiting a response.
- The most recent source anchors.
- Whether the user's latest message appears to answer an open check.

The agent should then follow this order:

1. If the user is answering an open check, assess that response and close the check before moving on.
2. If the user is asking about an already introduced concept, use lightweight refresher behavior: reuse or jump to the existing source anchor when possible, add at most one replacement highlight if the anchor is missing, avoid adding a new note unless the user asks for a deeper pass, and avoid re-running the full teaching flow. If the concept already has an open check, point to that check instead of opening another one.
3. If the user is asking about a new reviewable concept, anchor it to a passage and add it to `conceptsIntroduced`; otherwise reuse the existing concept and append/update its source.
4. If the answer is substantive, add one prediction or retrieval check unless that would feel forced.
5. If related open tabs exist, offer an interleaving connection rather than automatically changing context.

## State update contract

Phase 2 should not rely only on the model remembering state inside chat history. The runtime needs a structured path for updates.

Recommended implementation:

- Add an internal learning-event mechanism, exposed to the agent as a narrow tool or equivalent structured action.
- Store events in session state and derive `learnerState` from them or update `learnerState` directly.
- Keep the tool unavailable in Answer Mode.

Possible event API:

```ts
type LearningEvent =
  | {
      kind: "concept_introduced";
      conceptLabel: string;
      annotationId?: string;
      url?: string;
      tabTitle?: string;
    }
  | {
      kind: "check_opened";
      checkKind: "prediction" | "retrieval";
      conceptLabel: string;
      promptText: string;
      annotationId?: string;
    }
  | {
      kind: "check_resolved";
      checkId: string;
      assessment: "correct" | "partial" | "incorrect" | "skipped";
      evidence?: string;
    };
```

This keeps the agent responsible for pedagogical judgment while the runtime remains responsible for durable state and sidebar rendering.

If adding a tool is too much for the first slice, an acceptable temporary version is to let the runtime infer learning events from page actions plus prompt metadata. That should be treated as a stepping stone, not the final contract.

## Sidebar UX

The sidebar panel should be compact and functional.

Suggested layout:

- Header: `This session`
- Concepts row/list: short concept labels, newest last or grouped by source.
- To answer row/list: open checks with concise prompt text.
- Source action: click concept or check to scroll to the annotation when an `annotationId` is available.

Rendering rules:

- Hide the panel in Answer Mode.
- Hide the panel when Learning Mode is on but there is no state yet.
- Cap visible concepts to a small number and provide a simple overflow affordance if needed.
- Do not add badges, scores, streaks, or mastery percentages.
- Keep on-page notes as the primary teaching surface; the panel is memory and navigation.

## Acceptance criteria

### Manual acceptance

Use a stable page with an obvious definition or mechanism.

1. Turn Learning Mode on.
2. Ask: "How does this concept work?"
3. Expected: Onhand highlights a relevant prerequisite or evidence passage and asks a prediction or retrieval-style prompt before dumping a full answer.
4. Respond to the prompt with a partial answer.
5. Expected: Onhand assesses the response, gives a hint or correction anchored to the page, and closes the open check.
6. Ask about the same concept again.
7. Expected: Onhand gives a lightweight refresher, points back to the original source instead of re-explaining from scratch, does not create a new batch of highlights or notes, and does not accumulate multiple open checks for the same repeated concept.
8. Open a related tab and ask a follow-up.
9. Expected: Onhand offers to connect the related tab before using it.

### Regression coverage

Add focused tests for:

- Learning Mode preference persistence.
- Prompt construction includes the compact learner-state summary only in Learning Mode.
- Learning event updates add concepts and open checks.
- Resolving a check removes it from open checks and records an assessment.
- Sidebar renders covered concepts and open checks.
- Answer Mode behavior is unchanged when the toggle is off.

## Non-goals

- Courses, syllabi, streaks, progress bars, or full LMS behavior.
- Cross-session spaced repetition in Phase 2.
- Automatic mastery scoring as product truth.
- Analytics instrumentation before the interaction loop is proven.
- Forcing Socratic behavior when the user clearly wants a direct answer.

## Implementation slices

### Slice A: Session learner state

Add the data model and update helpers.

Deliverables:

- `learnerState` on session state.
- Event/update helper.
- Unit coverage for concept/check creation and resolution.

### Slice B: Prompt/state loop

Feed compact state into the Learning Mode prompt and make the agent resolve open checks before new teaching.

Deliverables:

- Learning-state prompt summary.
- Updated Learning Mode append text.
- Manual transcript comparison against Answer Mode.

### Slice C: Sidebar panel

Render the "This session" panel above the composer.

Deliverables:

- Covered concept list.
- Open check list.
- Best-effort jump-to-source action.
- Hidden state in Answer Mode and empty Learning Mode.

### Slice D: Acceptance matrix

Add Learning Mode cases to the browser acceptance flow.

Deliverables:

- One direct Answer Mode control prompt.
- One Learning Mode concept prompt.
- One open-check resolution prompt.
- One repeated-concept refresher prompt.

### Slice E: Cross-tab interleaving

Use open tabs as related teaching material.

Deliverables:

- [x] Prompt guidance to scan tab titles and summaries for related context.
- [x] Offer-first behavior before switching context.
- [x] Manual acceptance with at least three related tabs.

## Open questions

1. Should the sidebar panel show resolved checks, or only open checks and concepts?
2. Should concept labels be model-generated only, or normalized by the runtime?
3. Should Learning Mode state reset when the user starts a new session, or when they turn the toggle off?
4. Should a direct-answer escape temporarily suspend Learning Mode for one turn or turn the mode off?
