# Voice

Onhand's voice mode runs on GPT-Live 1 (`gpt-live-1`) over WebRTC from the side panel. Live holds the spoken conversation: it listens continuously, acknowledges briefly, takes interruptions and corrections, and speaks answers. Real work goes to Onhand's agent.

The GPT-Realtime 2.1 engine and its separate voice tutor were removed on 2026-10-04. `REALTIME_VOICE.md` and `VOICE_ARCHITECTURE.md` describe that design and are kept for history; `GPT_LIVE_MIGRATION_PLAN.md` records the migration and its measurements.

## How a call works

- **Delegation.** Live decides whether to answer a turn itself or hand it to the backend. By default (client delegation) every handed-off question goes through the same submission path as typed chat (`source: "live-voice"`). Voice therefore uses the chosen text model and sign-in, and the same lanes, per-request policies (quiz, hints, page notes, document review, no page changes) and guards. The agent writes the full cited answer to the sidebar and opens it with a short paragraph; Onhand appends that paragraph to Live as commentary, and Live speaks it.
- **What Live answers itself.** Greetings, thanks, acknowledgments, its own clarifying questions, and repeats or shortenings of results the backend already returned. Anything that needs a fact the backend has not returned goes to the backend, including short follow-ups ("where does that happen?") and "what is this page about?" (the page title Live is given is not the page's content).
- **Hosted delegation (opt-in).** Options can switch Live's backend to hosted GPT-5.6 Terra or Luna, which runs the agent loop through Live and bills the OpenAI platform key. It uses Onhand's system prompt, tools and guards; each resolved question gets its per-request policy through `onhand_get_context`.
- **Saved history.** Delegated answers are normal saved turns labelled `[Voice]`. Exchanges Live answered itself are saved from its captions as revisable turns. The raw voice transcript is stored per session.

## Code

| Piece | Where |
| --- | --- |
| Live instructions, client coordinator, spoken-result shaping | `packages/browser-extension/live-voice.js` |
| Hosted (managed) delegation coordinator | `packages/browser-extension/live-responses.js` |
| Mic capture, peer connection, mute, idle timeout, voice UI | `packages/browser-extension/sidebar.js` (`startLiveVoice`) |
| Live session creation and `sidebar:live-*` messages | `packages/browser-extension/background.js` |
| Live-voice submissions, hosted delegation, caption turns | `packages/browser-extension/src/browser-runtime.ts` |

Some shared voice code keeps `realtime*` names (for example `realtimeMediaStream`, `setRealtimeStatus`, the `realtimeVoiceEnabled` setting); they belong to Live now.

## Setup

Enable Voice in the Onhand options page and save an OpenAI platform API key. Text chat can stay on OpenAI Codex sign-in; that is also the model Live hands questions to. Live costs $0.05 per connected minute, including silence, plus backend model usage.

## Testing voice without a microphone

`npm run debug:sessions -- ask "question" --voice live --wait` (or `ask-new-url <url> "question" --voice live`) runs the real Live client-mode coordinator (`live-voice.js`) inside the CLI's driver page against the real runtime. The question arrives as a spoken transcript, Live's client delegation submits it exactly as `sidebar.js` does (`source: "live-voice"`, `voiceContext`, the spoken-opening instruction), and the text Onhand hands Live to speak (`speechResult`) is captured.

Any eval suite runs this way with `--voice live`, e.g. `npm run eval:creative -- --voice live`. Voice checks fail a case when the spoken text falls back to "the answer is ready in the sidebar", warn when it runs past ~45 words, and support per-case `requiredSpokenPatterns` / `forbiddenSpokenPatterns`.

Not covered without a live call: speech recognition and endpointing, Live's own decision to delegate, its spoken paraphrase, and hosted delegation.

### Real calls with a synthetic microphone

`npm run eval:voice-call -- --url <page> --question "..." [--question "follow-up"]` places a real (paid) call with the panel's saved voice settings. It opens the actual side panel next to the page in a new window, swaps the panel's microphone for a synthetic stream before pressing Voice, and plays each question into it, synthesized silently with `say -o`. Nothing is played aloud and no room audio is captured. For each question it reports what Live heard and said, whether Live handed it to the backend or answered it itself, and whether and how soon it spoke a handed-off answer; it also shows the saved turns with their tools and marks. `--mute-after` presses the panel's Mute button after the first question, and `--timeline` prints the Live data-channel events. Live occasionally misses a call's first utterance entirely, so a question with no input caption 8 s after its audio ends is asked once more, and the report says so. Every call ends by closing the panel and its window, within `--max-seconds` (default 120).

The synthetic mic carries a faint noise floor (`--room-tone-db`, default -50). With pure digital silence after the question, Live heard the question and ran the delegation but never spoke the delegated answer. A real microphone always picks up room tone, and Mute tells Live the input is muted, so real calls are unaffected.

### The voice eval suite

`npm run eval:voice` runs `evals/voice/cases.json`: one real call per case, each turn labelled with whether Live should hand it to the backend (`"handoff"`) or answer it itself (`"live"`). Cases cover follow-ups on Wikipedia, MDN and an arXiv PDF, follow-ups Live could answer from its own knowledge, small talk, overview questions, and a Learning-mode quiz (Learning mode is switched on for that case only, then restored). The run fails on any mis-handled or unheard turn, or a handed-off answer that was never spoken.

`--case <id>` runs one case, `--reps <n>` repeats, and `--baseline <git-ref>` alternates calls between the working copy of `live-voice.js` and the one at that ref, then restores the working copy and reloads the extension. Use it to compare an instruction change old against new; each call is a paid Live call.
