# Voice Architecture

## Status

Planning document for integrating `gpt-realtime-2` into Onhand as a page-anchored tutoring layer. The current branch has a Realtime WebRTC prototype in the browser extension; this document describes the target architecture before the prototype becomes product behavior.

Relevant references:

- OpenAI Realtime WebRTC guide: https://developers.openai.com/api/docs/guides/realtime-webrtc
- OpenAI Realtime conversations guide: https://developers.openai.com/api/docs/guides/realtime-conversations
- OpenAI Realtime server-side controls guide: https://developers.openai.com/api/docs/guides/realtime-server-controls
- `gpt-realtime-2` model page: https://developers.openai.com/api/docs/models/gpt-realtime-2
- OpenAI release post: https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/

## Thesis

Voice should not be a second Onhand interface. It should be the conversational layer over the same page-first tutoring experience.

Typing pulls the user's gaze into the sidebar. Voice lets the user keep looking at the source while Onhand points, highlights, and teaches around the page. This is a deeper fit than "voice input for chat" because Onhand's constitution already models a one-on-one tutor, and tutors talk while pointing at the material.

The target experience:

- User invokes voice on demand.
- User asks aloud while looking at the page.
- Onhand highlights or annotates the source first.
- A short spoken answer or Socratic prompt follows.
- The sidebar mirrors the spoken move in scannable text.
- The persisted artifact remains the annotated page session, not an audio recording.

## Constitutional Constraints

Voice raises two failure risks:

- It makes verbose answers frictionless.
- It can become intrusive if it speaks without being invited.

Hard constraints:

- Voice is explicit and on-demand only: button, hotkey, or push-to-talk.
- No passive listening by default.
- Idle sessions auto-disconnect.
- Spoken answers are shorter than text answers.
- All claims about page material require successful page anchors.
- The page remains primary; sidebar and audio are secondary.
- The user can interrupt, stop, or ask for a direct answer at any time.

## Target Architecture

There should not be two independent minds: "Realtime" and "Onhand." `gpt-realtime-2` is the voice controller. `gpt-5.5` is the Onhand reasoning backend.

Actors:

- Browser sidebar: owns the WebRTC peer connection, microphone, model audio output, visible status, and sidebar transcript mirror.
- Browser extension background/runtime: owns page context, page tools, session state, saved auth, and server-side API calls.
- `gpt-realtime-2`: handles live speech, turn-taking, short preambles, interruptions, and tool narration.
- `gpt-5.5`: plans and evaluates pedagogical moves from page context and learner state.

Target tool families exposed to `gpt-realtime-2`:

- Context tools: `get_current_learning_context`, `get_visible_region_image`.
- Page tools: `highlight_passage`, `add_margin_note`, `clear_voice_turn_highlights`, `navigate_to_passage`.
- Reasoning tools backed by `gpt-5.5`: `answer_directly`, `plan_pedagogical_move`, `evaluate_response`.
- Sidebar/session tools: `publish_sidebar_answer`, `record_voice_turn`, `record_learning_event`.

The current prototype has `delegate_to_onhand(prompt)`. That is useful for dogfood, but it should be removed from the target architecture because it blurs responsibility. The replacement is explicit: call either `answer_directly`, `plan_pedagogical_move`, or `evaluate_response`.

## Mode Policy

Answer Mode:

- Use voice as an input/output layer over direct anchored answers.
- `gpt-realtime-2` may handle tiny conversational moves itself, such as "can you repeat that?" or "scroll back to the highlight?"
- For material claims, call `answer_directly` so the `gpt-5.5` backend chooses anchors and sidebar copy.
- Do not use Socratic withholding unless the user explicitly asks to be quizzed.

Learning Mode:

- Always call `plan_pedagogical_move` for a new conceptual voice question.
- Always call `evaluate_response` when the user answers a Socratic prompt, unless the response is a trivial acknowledgement.
- The planner returns a teaching move, not a complete essay.
- The first move should usually be a highlight plus a short spoken prompt, not a full explanation.

This avoids leaving model selection to vibes. Learning Mode means planner-first. Answer Mode means direct-answer-first.

## Core Flows

### 1. Voice Direct Answer

1. User clicks `Voice` or uses the hotkey.
2. Sidebar establishes a Realtime WebRTC session.
3. User asks aloud.
4. `gpt-realtime-2` says a short preamble only if a tool call will take noticeable time.
5. `gpt-realtime-2` calls `get_current_learning_context`.
6. `gpt-realtime-2` calls `answer_directly`.
7. `gpt-5.5` returns anchors, a concise voice script, and sidebar markdown.
8. Browser applies highlights and notes.
9. `gpt-realtime-2` speaks the voice script.
10. Sidebar mirrors the answer.

### 2. Socratic Learning Loop

1. User asks aloud: "What does this paragraph mean?"
2. `gpt-realtime-2` calls `get_current_learning_context`.
3. `gpt-realtime-2` calls `plan_pedagogical_move`.
4. `gpt-realtime-2` uses a preamble while waiting: "Let me look at that line."
5. `gpt-5.5` returns one structured teaching move.
6. Browser highlights the anchor and adds any short note.
7. `gpt-realtime-2` speaks the Socratic prompt.
8. User answers aloud.
9. `gpt-realtime-2` calls `evaluate_response` with the transcript and previous move.
10. `gpt-5.5` returns correct points, missed points, a nudge, and the next move.
11. Browser updates notes and learner state.
12. `gpt-realtime-2` gives brief feedback and either nudges, goes deeper, or moves on.

### 3. Interruption and Cancellation

Realtime handles spoken interruption locally, but backend planner calls do not cancel themselves.

Policy:

- Each planner/evaluator request gets a `voiceTurnId` and `abortToken`.
- If the user interrupts before the tool result returns, mark the request stale.
- Ignore stale tool results even if the network call completes.
- If the backend supports abort signals, cancel the in-flight `gpt-5.5` request.
- `gpt-realtime-2` should acknowledge the new user turn and not resume the stale plan.

### 4. PDF and Visual Content

PDFs and equations are not an optional polish item for students and researchers. They are a launch-gate decision.

Two acceptable v1 choices:

- Support PDFs by sending either Onhand PDF viewer text plus region screenshots to the planner.
- Or explicitly disable voice tutoring on unsupported PDF surfaces with a clear status and one-click "Open in Onhand viewer."

Image input path:

1. Capture selected region, visible PDF page region, or figure bounding box.
2. Send it as an `input_image` content part to Realtime or to the `gpt-5.5` planner.
3. Require the planner to return either `text_excerpt` or page/region coordinates.
4. Render highlights or boxes in the page/PDF viewer.

## Tool Schemas

Schemas should encode constitutional commitments so they do not depend only on prompts.

### Page Tool: `highlight_passage`

```json
{
  "type": "function",
  "name": "highlight_passage",
  "description": "Highlight a passage on the user's current page. Use before making material claims about page content.",
  "parameters": {
    "type": "object",
    "properties": {
      "text_excerpt": {
        "type": "string",
        "description": "Exact visible text from the page."
      },
      "kind": {
        "type": "string",
        "enum": ["key_concept", "evidence", "definition", "watch_out", "answer_location", "question_anchor"]
      },
      "note": {
        "type": "string",
        "maxLength": 80,
        "description": "Optional margin note. Must be useful marginalia, not a paraphrase."
      }
    },
    "required": ["text_excerpt", "kind"]
  }
}
```

### Reasoning Tool: `answer_directly`

Used in Answer Mode for concise anchored answers.

Input includes user question, page context, learner state, and open-tab summary.

Output:

```json
{
  "anchors": [
    {
      "text_excerpt": "...",
      "kind": "answer_location",
      "note": "Load-bearing sentence"
    }
  ],
  "voice_script": "Short spoken answer, usually under 45 words.",
  "sidebar_markdown": "Scannable answer with compact citations/anchors.",
  "confidence": "high"
}
```

### Reasoning Tool: `plan_pedagogical_move`

Used in Learning Mode for new conceptual questions. The output intentionally has no `answer` field.

Output:

```json
{
  "anchor": {
    "text_excerpt": "...",
    "kind": "question_anchor",
    "note": "Look here first"
  },
  "move_type": "prediction_prompt",
  "voice_script": "Looking at this line, what do you think changes when X is removed?",
  "sidebar_markdown": "**Your turn:** What changes when X is removed?",
  "expected_concepts": ["concept_a", "concept_b"],
  "stuck_fallback": "Focus on the verb in the highlighted sentence.",
  "misconceptions": [
    {
      "wrong_idea": "...",
      "nudge": "Check whether the sentence says cause or correlation."
    }
  ]
}
```

Constraints:

- `voice_script` should be one question or one nudge.
- `sidebar_markdown` is the durable written mirror, not a long explanation.
- `anchor.text_excerpt` is required.
- `stuck_fallback` is a hint, not the solution.

### Reasoning Tool: `evaluate_response`

Used after the student answers a Learning Mode prompt.

Output:

```json
{
  "correct_points": [
    {
      "concept": "...",
      "anchor_text": "..."
    }
  ],
  "missed_points": [
    {
      "concept": "...",
      "anchor_text": "...",
      "nudge": "..."
    }
  ],
  "next_move": "nudge",
  "feedback_voice_script": "Good start: you caught X. Now look at the highlighted phrase after the comma.",
  "sidebar_markdown": "Good: X. Next, check the phrase after the comma."
}
```

`next_move` is one of `nudge`, `deeper`, `move_on`, or `direct_answer_escape`.

## Persistence Policy

The session is still the artifact. Voice should not make audio the artifact.

Persist by default:

- Page annotations and notes.
- Sidebar answer/prompt mirror.
- Learner state: introduced concepts, open checks, resolved checks, sources.
- A compact text transcript of voice turns.
- Planner/evaluator structured moves.

Do not persist by default:

- Raw microphone audio.
- Model output audio.
- Full low-level Realtime event logs.

Optional developer/debug persistence:

- Realtime event traces behind a debug flag.
- Redacted planner inputs/outputs for evals.

## Implementation Phases

### Phase 0: Stabilize Realtime Transport

Goal: voice in, voice out, no duplicate-response bugs.

Tasks:

- Keep the WebRTC setup in the sidebar and `/v1/realtime/calls` setup in the background/session endpoint.
- Finish mic input reliability: server VAD, transcription, local mic diagnostics, and fallback commit. The prototype now has local mic diagnostics plus a manual input-buffer commit fallback.
- Gate `response.create` so tool calls cannot create overlapping responses. The sidebar regression suite now covers queued `response.create` behavior and recoverable active-response errors.
- Add an idle timeout and explicit disconnect. The prototype now disconnects idle sessions and keeps active responses alive until completion.
- Add regression coverage for response gating and status transitions. Phase 0 sidebar regressions cover response queuing, active-response errors, manual voice commit, empty input-buffer errors, and idle timeout behavior.

Acceptance:

- User asks aloud, pauses, hears a short answer, sees the sidebar mirror, and can disconnect cleanly.

### Phase 1: Internal Dogfood Voice Over Onhand

Goal: validate the ergonomics without pretending the pedagogy is done.

Scope:

- Internal/dogfood only.
- Voice can ask direct questions and receive spoken direct answers.
- Material claims still go through `answer_directly`. The prototype tool surface now exposes `answer_directly(prompt)` instead of `delegate_to_onhand(prompt)`.
- Server VAD no longer auto-creates a Realtime answer for voice turns. Onhand waits for transcription, routes page-material questions through `answer_directly`, then asks Realtime to narrate a concise version of the completed Onhand answer. If transcription does not arrive shortly after the audio buffer is committed, Onhand manually creates a Realtime response from the committed audio so pause-to-answer still works.
- No `delegate_to_onhand` in the target architecture.

Acceptance:

- On normal HTML pages, voice produces the same anchored quality as typed Answer Mode, with shorter spoken delivery.

### Phase 2: Learning Mode Planner

Goal: make voice pedagogical, not just spoken chat.

Tasks:

- Add `plan_pedagogical_move`.
- Always use it for new conceptual voice questions when Learning Mode is on.
- Encode no-answer, required-anchor, note-length, and voice-length constraints in schemas.
- Render Socratic prompts as both voice and sidebar/page notes.

Implemented in this branch:

- The browser runtime exposes an internal structured `gpt-5.5` planner endpoint.
- The sidebar routes Learning Mode voice/text turns to that planner instead of `answer_directly`.
- Planner results drive `annotate_page`, which records a concept and opens a prediction/retrieval check in learner state.
- Realtime narrates the returned `voice_script` with tool calls disabled for that response.

Acceptance:

- In Learning Mode, a "what does this mean?" voice question highlights the relevant source and asks a grounded prompt before explaining.

### Phase 3: Evaluate Student Responses

Goal: complete the tutor loop.

Tasks:

- Add `evaluate_response`.
- Track the previous pedagogical move by `voiceTurnId`.
- Update learner state from evaluation results.
- Handle `move_on`, `nudge`, `deeper`, and `direct_answer_escape`.

Implemented in this branch:

- The sidebar keeps the pending Socratic move and check id after a planner turn.
- A follow-up student response routes to an internal structured `gpt-5.5` evaluator endpoint.
- Evaluator results resolve the open learner check and produce concise spoken/sidebar feedback.
- Current handling resolves the check after one evaluation; deeper chained prompts are still a follow-up hardening item.

Acceptance:

- User answers aloud; Onhand identifies what they got right, nudges what they missed, and updates the "This session" learner panel.

### Phase 4: PDF and Image Gate

Goal: decide whether voice launch supports PDFs or explicitly defers them.

Tasks:

- For Onhand PDF viewer pages, capture text plus region screenshots.
- For unsupported PDF surfaces, guide the user into the Onhand viewer.
- Add `get_visible_region_image`.
- Require text or region anchors for visual claims.

Implemented in this branch:

- Realtime voice detects direct or unsupported PDF tabs and opens them in Onhand's PDF viewer before page-grounded Answer Mode or Learning Mode routing.
- The Learning Mode planner/evaluator perform the same direct-PDF handoff before gathering page context, so they do not plan from a native PDF shell.
- Realtime context now reports a compact `pdf` status object with support/handoff information for tool-driven PDF behavior.
- The voice tool surface exposes `open_pdf_in_onhand_viewer()` for recoverable PDF handoff.
- The browser runtime exposes `browser_get_visible_region_image`, which returns a viewport/selector image plus region metadata for charts, diagrams, equations, screenshots, and weak text extraction.
- The Learning Mode planner/evaluator automatically attach a visible-region image for visual questions or sparse text context, while still preferring exact text anchors when available.

Acceptance:

- PDF voice tutoring works in the Onhand viewer, and visual questions either use a captured visible-region image with an exact text anchor when available or fail clearly by asking for a selected/captioned region.

### Phase 5: Production Hardening

Tasks:

- Push-to-talk option.
- Cost/usage indicator or session timer.
- Auto-disconnect on idle.
- User-facing privacy note: no raw audio persisted by default.
- Debug-only event trace.
- Chrome acceptance suite covering Answer Mode voice, Learning Mode voice, interruptions, PDF behavior, and stale planner cancellation.

Implemented in this branch:

- Voice turns now carry a local `voiceTurnId`; direct-answer, planner, and evaluator results are applied only when that turn is still current.
- User speech interruption marks the active voice turn stale so late planner/evaluator/direct-answer results do not overwrite newer turns or trigger narration.
- Standalone Realtime voice prompts and answers, plus Learning Mode planner/evaluator voice moves, are recorded as durable session turns. Raw audio remains unpersisted.

## Open Questions

- Should Answer Mode use `gpt-5.5` for every material voice question, or can `gpt-realtime-2` answer with page anchors for very simple cases?
- What exact word/character limits should schemas enforce for `voice_script` and `sidebar_markdown`?
- Should push-to-talk be the default for the first public voice release?
- Does PDF support gate public release, or is "Open in Onhand viewer" enough for v1?
- How much transcript should persist when the user has not explicitly saved a session?
