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
- Slice E is implemented as prompt-contract and runtime-enforced behavior: Learning Mode ranks the full open-tab workspace, automatically inspects clearly related sources, and has regression plus manual Chrome acceptance coverage.
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

- Treat metadata from every eligible tab across open browser windows as a workspace index; tab position is not a relevance signal, while the current window is a ranking signal.
- Rank likely sources from the complete census, and call `browser_list_tabs` whenever the compact ranked summary is insufficient.
- Automatically inspect clearly related tabs by `tabId`. When an index page links a PDF collection, extract its linked PDFs without opening every document, use lexical matching only to assemble a broad recall pool, then have a model semantically select evidence for each slot before opening the strongest sources for exact reading and annotation.
- Read and annotate background tabs without switching focus. Do not inspect unrelated tabs merely because they are open.
- Anchor each source separately and say which tab supports which claim.

For homework/problem requests where the active page supplies only the question, cross-tab evidence is an invariant rather than an optional enhancement:

- Capture the prompt, selection, active-page context, attachments, and open-tab workspace before planning. Meaningful selected text is the authoritative referent for deictic sidebar requests such as “could you help me solve this?”
- Use a compact model-led research plan to resolve the target problem, derive concept-specific search queries, split multi-part questions into evidence slots, rank plausible sources, and set a broad cost-safety ceiling. Users do not need to name the homework, mention another tab, or use a magic phrase.
- Complete the research phase before exposing answer prose. Show tool progress such as “Checking relevant notes…” rather than a provisional answer followed by “Revising.”
- Judge completion by model-assessed evidence-slot coverage. For a linked PDF collection, run one corpus pass across the collection instead of walking its DOM, schedule, chapter, or lecture-number order. Candidate ordering, filenames, lecture numbers, and lexical scores are never final relevance decisions. Reading one distinct source is not success by itself.
- A second tab or viewer showing the same canonical PDF is not distinct evidence.
- Reuse source/viewer tabs by canonical URL. When Onhand opened a raw PDF tab only for background research, replace that temporary tab with the Onhand viewer rather than leaving two identically titled tabs.
- If an open course/index page links to the relevant lecture or notes, use its links as a source inventory. Search linked PDFs as a corpus when possible, then follow the strongest result in a background tab and inspect the destination itself; the index alone is not explanatory evidence.
- If no inspected source supports the proposed guidance, withdraw unsupported claims and say that the open materials did not verify them.
- When a supporting source is found, place the explanatory highlight and, when interpretive, one short note on that source page rather than spending the entire annotation budget on the problem statement.

Deterministic runtime checks remain responsible for mechanics and safety: permissions, focus preservation, canonical-source deduplication, tool success, bounded retries/cost, and honest annotation reporting. Semantic decisions—what the selection refers to, which notes are relevant, and whether evidence is sufficient—belong to the model-led plan and assessment.

### Direct-answer escape hatch

Learning Mode must not trap the user in Socratic interaction.

Collapse to a direct answer when:

- The user explicitly asks for the answer to a non-homework conceptual question.
- The user asks for a study artifact such as a summary, formula sheet, or flashcards.
- The user says they are stuck, annoyed, or short on time.
- The agent has already asked one prompt and the user does not engage with it.

For homework-style problems, Learning Mode does not reveal the completed numeric, symbolic, or code answer. Switching to Answer Mode is the explicit escape hatch.

## Teaching moves

Learning Mode should use a small set of repeatable moves.

| Move | Trigger | Behavior |
|---|---|---|
| Prerequisite scaffold | The question depends on an unstated concept | Highlight the prerequisite first, then connect it to the question |
| Prediction prompt | The user asks a conceptual "how/why" question | Ask for a short prediction before revealing the explanation |
| Retrieval check | The agent has just explained a substantive idea | Ask the user to restate the claim or mechanism in their own words |
| Hint-before-correction | The user gives a partial or wrong answer | Point to the passage that resolves the issue before giving the correction |
| Misconception repair | The question implies a common wrong model | Name the misconception briefly and contrast it with the page evidence |
| Automatic interleaving | Another open tab is clearly related | Inspect it in the background and connect the useful evidence; ask first only when relevance is ambiguous |
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
5. If clearly related open tabs exist, inspect them without stealing focus and connect the useful source automatically.

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
9. Expected: Onhand automatically inspects the clearly related tab without switching focus, anchors the useful passage there, and names which source supports the connection.

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
