# Onhand Pedagogy Plan

## 0. Framing

Onhand today is very good at *information delivery*: finding the right passage, highlighting it, explaining it in context. That is already a real UX improvement over chatbots, but it is still fundamentally "user asks, agent answers."

The suggestion to look into pedagogy is a push to make Onhand structure *the learning process itself*, not just the location of the answer. The moat isn't "AI that can read your browser" — it is "AI that can teach you using your browser as the textbook."

This document translates the main evidence-backed pedagogical concepts into concrete changes grounded in the current codebase (pi SDK session in `apps/desktop/onhand-agent.mjs`, tool primitives in `packages/pi-extension/index.ts`, sidebar UI in `packages/browser-extension/sidebar.js`).

The strategy is: reuse the highlight/note/scroll/artifact primitives that already exist, and change *what the agent chooses to do with them* plus *what state is tracked across turns and sessions*. Most of this is prompt engineering and session-state work, not new infrastructure.

---

## 1. Pedagogical concepts, mapped to Onhand

| Concept | What it means | How it maps to Onhand primitives |
|---|---|---|
| **Scaffolding** (Vygotsky ZPD) | Build up from prerequisites toward the target idea; remove support as competence grows | Highlight a prerequisite passage + orienting note *before* answering the actual question. Progressively drop hand-holding across a session. |
| **Active recall / testing effect** | Retrieval beats re-reading for retention | Embed a check-in question as a `browser_show_note` after an explanation, before continuing |
| **Spaced repetition** | Re-surface concepts at increasing intervals | Use session history + artifact index to resurface past highlights when the user revisits related material |
| **Interleaving** | Mix related concepts rather than blocking one topic | Onhand already sees all open tabs; explicitly draw connections ("you saw this on tab 3 twenty minutes ago") |
| **Elaborative interrogation** | Learners generate "why" explanations before being told | Prompt the user ("why do you think this works?") *before* revealing the explanation |
| **Misconception repair** | Explicitly surface and correct likely wrong models | Detect the implicit assumption in the question and address it, don't just answer the literal query |
| **Metacognition** | Learner reflects on what they know / don't | End-of-session summary: "here is what you explored, here is what you haven't checked" |

---

## 2. The core architectural shift: Learning Mode

Add an explicit mode toggle (default off) that changes the agent's operating strategy.

- **Answer Mode** (current behavior): find the passage, highlight it, explain — fast, transactional.
- **Learning Mode**: guide the user toward understanding — check priors, prompt for predictions, reveal progressively, check comprehension after.

Learning Mode is primarily **a different system prompt + a small amount of session-tracked learner state**. It does not require new tools, a database, or a model change.

**Why a toggle rather than always-on pedagogy:** users don't always want to be taught. Sometimes they just want the answer. Forcing Socratic questioning on a quick lookup will feel patronizing and will churn users. The toggle also gives you a clean A/B surface for measuring whether Learning Mode actually improves retention / session quality.

---

## 3. Implementation phases

### Phase 1 — Learning Mode scaffold (minimum viable pedagogy)

Goal: one toggle, different system prompt, no new data model. Prove the prompt-engineering hypothesis before investing in state.

**3.1 Add the toggle**
- Sidebar: add a "Learning mode" checkbox near the session controls in `packages/browser-extension/sidebar.js` (alongside the existing session toolbar around the "New / Restore Pages / Stop" buttons).
- Persist the flag via `chrome.storage.local` and send it on every `/prompt` call as part of the POST body.
- Desktop launcher: mirror the toggle in `apps/desktop/renderer.js` so both entry points behave the same.

**3.2 Thread the flag through the agent**
- Extend the `submitOnhandPrompt` handler in `apps/desktop/onhand-agent.mjs` (~line 862) to accept `{ learningMode: boolean }`.
- In `buildLauncherPrompt` (line 228), branch on the flag: when on, replace the current "answer-oriented" guidance at the bottom of the prompt with learning-oriented guidance (see 3.3).
- Also branch `ONHAND_APPEND_SYSTEM_PROMPT` (line 17): either swap in a pedagogy-flavored variant, or append an additional block when the flag is on. Prefer appending to keep the answer-mode rules stable.

**3.3 The Learning Mode system prompt additions**

The additional prompt block should instruct the agent to, before answering a question about on-page content, do as many of these as apply:

- Identify the **prerequisite concept** the question rests on. If it is likely unfamiliar, highlight its definition on the page first and add a one-line "read this first" note, *then* address the question.
- When the user asks "why" / "how" / "what does this mean," pause and **ask the user to predict** before revealing. Embed the prediction prompt as a `browser_show_note` on the most relevant passage (e.g. "Before I explain: what do you think this derivative is measuring?"). Keep it to one short sentence.
- After a substantive explanation, place a **retrieval check** as a separate note: "In your own words — what does this passage claim?" This is the single highest-leverage change and maps directly onto existing tool primitives.
- Name any **likely misconception** implicit in the question and address it explicitly rather than only the literal query.
- Prefer **fewer, better-placed** annotations. Learning Mode should feel more deliberate, not more cluttered.
- Do not dump the full answer before the user has had a chance to engage. It is fine to answer after the user responds to a prompt — but the first pass should set up the thinking, not conclude it.

The prompt should also say: *if the user indicates they already know the prerequisite, or asks for a quick answer, collapse back to direct explanation.* Pedagogy must not be rigid.

**Acceptance for Phase 1:** toggle Learning Mode on, ask a "how does X work" question about an open page, observe that Onhand's first action is a prerequisite highlight + prediction prompt, not a full answer.

---

### Phase 2 — Session-scoped learner state

Goal: let the agent adapt *within a session* based on what the user has already seen and how they've responded.

**4.1 Extend session UI state**

Add a `learnerState` object to the in-memory `uiState` in `onhand-agent.mjs` (around the `createEmptyUiState` helper near line 47):

```js
learnerState: {
  mode: "answer" | "learning",
  conceptsIntroduced: [           // things the agent has explicitly highlighted+named
    { conceptId, label, firstSeenAt, sources: [{ tabTitle, url, annotationId }] }
  ],
  openPredictions: [               // prediction prompts awaiting user response
    { predictionId, conceptId, promptText, annotationId, askedAt }
  ],
  openRetrievalChecks: [           // same shape, but retrieval-style
    { checkId, conceptId, promptText, annotationId, askedAt }
  ],
  responded: [                     // resolved items with the agent's assessment
    { itemId, kind, assessment: "correct" | "partial" | "incorrect" | "skipped", resolvedAt }
  ],
}
```

This lives in the same pi JSONL session file via `SessionManager`, so it persists for free across launcher restarts.

**4.2 Teach the agent to maintain it**

Add two small things to the Learning Mode system prompt:
- "When you introduce a concept for the first time in this session, record it under `conceptsIntroduced`. When you place a prediction prompt or retrieval check, record it. When the user's next turn responds to an open prediction/check, close it and record the assessment."
- "At the start of each new turn, consult `learnerState`: do not re-explain concepts already in `conceptsIntroduced` from scratch; instead reference them briefly. If open predictions exist, resolve them before moving on."

This does not require tool changes — the agent maintains this inside its own message history. You can nudge it by surfacing a compact `learnerState` summary at the top of each `buildLauncherPrompt` output when Learning Mode is on.

**4.3 Surface it in the sidebar**

In `sidebar.js`, add a small "This session" panel above the composer that shows:
- Concepts covered so far (tappable to scroll back to their highlight)
- Any open prediction/retrieval prompts waiting on the user

This makes the learning structure legible and gives the user a sense of progression. It also makes the mode feel less chatbotty and more like a tutor.

**Acceptance for Phase 2:** after 4–5 turns in Learning Mode on a single page, the sidebar shows a list of covered concepts; asking about one of them elicits a "we already covered this — quick refresher?" response rather than a full re-explanation.

---

### Phase 3 — Cross-tab interleaving

Goal: exploit Onhand's structural advantage — it can see *all* open tabs, unlike a chatbot.

**5.1 Cross-tab concept linking**

Update the Learning Mode prompt (and optionally `buildLauncherPrompt`) to instruct: "Before answering, scan open tabs via `browser_list_tabs` for conceptually adjacent material. If a related passage exists on another tab, offer to connect the two — *this other tab you have open discusses the same mechanism from a different angle, want me to pull that in?*"

The key word is *offer*, not auto-pull — respect attention. Auto-pulling is the kind of thing that turns helpful context into noise.

**5.2 Tab-aware retrieval checks**

When Learning Mode is on and the user returns to a tab they were on earlier in the session, Onhand should treat that as a natural spaced-practice moment: "You were reading this earlier — before we continue, what was the main claim here?" Implementation: compare the active tab URL in `getBrowserContext` against `learnerState.conceptsIntroduced[].sources[].url`.

This does not require new tools. It is purely a prompt-pattern change.

**Acceptance for Phase 3:** with three related tabs open, asking a question on tab 1 produces a response that proactively references relevant passages from tabs 2 or 3.

---

### Phase 4 — Cross-session spaced repetition

Goal: the thing no chatbot can do — come back the next day and have Onhand intelligently resurface things you saw last week.

This is the most ambitious phase and should come only after the first three are proven.

**6.1 Extend artifact metadata**

Artifacts are already persisted via `browser_capture_state` in `packages/pi-extension/index.ts` (the `persistBrowserCaptureArtifact` path). Extend the saved `state.json` schema to include:

```json
{
  "pedagogy": {
    "concepts": [{ "conceptId", "label", "confidence" }],
    "learnerAssessments": [
      { "conceptId", "outcome": "correct|partial|incorrect", "at": "<iso>" }
    ]
  }
}
```

These fields are populated from `learnerState` when the artifact is saved at the end of a learning session. A single new tool — something like `browser_save_learning_artifact` — can wrap the existing capture with the pedagogy block, so the pi extension surface area stays small.

**6.2 Review tool**

Add `browser_list_due_reviews({ now, limit })` to the pi extension. Implementation: scan `~/.onhand/artifacts/browser/index.json`, compute a due date per concept using a simple SM-2 / Leitner-style schedule keyed off last-assessment outcome, and return the top N. Do not build a full SRS engine — a 100-line scheduler is enough to test whether resurfacing actually helps users.

**6.3 Surface reviews**

When the launcher opens on a page whose domain or topic matches a due concept, show a non-intrusive banner in the sidebar: "You studied *partial derivatives* 4 days ago — 30-second check?" One tap restores the original highlight via `browser_restore_state` and the agent asks the retrieval question.

**Acceptance for Phase 4:** open a new browser session a week after a Learning Mode session, land on a related page, and see a contextual review nudge.

---

### Phase 5 — Elaborative interrogation & metacognition (optional polish)

Small additions that round out the pedagogical experience.

- **"Why do you think…?" prompts before explanations.** Already covered by the Learning Mode prompt in Phase 1 but can be strengthened here by making the follow-up explanation explicitly compare the user's prediction to the correct model.
- **End-of-session summary.** When the user closes or switches sessions, emit a one-paragraph reflection: what was covered, what was predicted correctly, what to revisit. Hook into the `handleSessionEvent` `agent_end` path and into the session-switch handler in `sidebar.js`.
- **Confidence tagging on notes.** Let the agent label its own explanations as "definition", "example", "claim", "caveat" in the `browser_show_note` call and render them with distinct styling in the content script. This helps the learner parse what kind of thing they are looking at.

---

## 4. Cross-cutting changes

**System prompt structure.** Keep `ONHAND_APPEND_SYSTEM_PROMPT` as the always-on base. Introduce `ONHAND_LEARNING_MODE_APPEND` as an additional block that is conditionally appended in the runtime setup (near where `appendSystemPrompt` is passed to `DefaultResourceLoader` in `onhand-agent.mjs`). This keeps the two modes readable side-by-side in source.

**Evaluation.** Before shipping any phase beyond Phase 1, pick 3–5 questions on known content (a Wikipedia article, a textbook chapter, an arXiv abstract) and compare Answer Mode vs Learning Mode transcripts by hand. Look for: did the agent actually ask before telling? Did it avoid re-explaining repeated concepts? Did the prediction/retrieval prompts feel natural or forced? No automated eval, just read the outputs. This is the fastest way to catch cases where the prompt drifts.

**Non-goal: don't build an LMS.** Resist turning Onhand into a full learning management system with courses, progress bars, and streaks. The value is *contextual* pedagogy layered on whatever the user already reads. Every feature here should survive the test of "does this make sense when the user is reading something Onhand has never seen before?"

**Non-goal: don't over-instrument.** Do not add analytics plumbing in Phase 1. Real usage patterns will reveal what is worth measuring. Premature metrics drive premature optimization.

---

## 5. Suggested order & rough sizing

| Phase | Scope | Rough effort |
|---|---|---|
| 1 — Learning Mode toggle + prompt | Real | 1–2 days |
| 2 — Session learner state + sidebar panel | Real | 2–4 days |
| 3 — Cross-tab interleaving | Prompt-only | 0.5–1 day |
| 4 — Cross-session spaced review | Real + scheduler | 3–5 days |
| 5 — Elaborative / metacognition polish | Incremental | Ongoing |

Ship Phase 1 first and live with it for a week before committing to Phase 2. The biggest risk is not that pedagogy is the wrong direction — it's that it feels patronizing in practice. Phase 1 is cheap enough to prove that out before building more state.

---

## 6. Open questions

1. **Should Learning Mode be per-session or global?** Per-session is more flexible but adds UI complexity. Start global, revisit if users ask.
2. **Who decides when a concept is "mastered"?** Agent self-assessment is cheap but unreliable. Option: expose a lightweight thumbs up/down on the retrieval-check notes and use that as ground truth for the scheduler.
3. **How do we avoid annotation clutter in Learning Mode?** Predictions + retrieval checks + explanations means more notes per answer. Consider a "tutor pane" in the sidebar for dialogue-style content, reserving on-page annotations for the evidentiary anchors. This is worth prototyping before committing.
4. **What's the story for PDFs / non-HTML content?** The current highlight/note tools assume HTML DOM. If a large share of learning content is PDFs, that's a bigger gap than any of the above features.
