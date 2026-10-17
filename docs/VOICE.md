# Voice

Onhand's voice mode runs on GPT-Live 1 (`gpt-live-1`) over WebRTC from the side panel. Live holds the spoken conversation: it listens continuously, acknowledges briefly, takes interruptions and corrections, and speaks answers. Real work goes to Onhand's agent.

The GPT-Realtime 2.1 engine and its separate voice tutor were removed on 2026-10-04. `REALTIME_VOICE.md` and `VOICE_ARCHITECTURE.md` describe that design and are kept for history; `GPT_LIVE_MIGRATION_PLAN.md` records the migration and its measurements.

## How a call works

- **Delegation.** Live decides whether to answer a turn itself or hand it to the backend. By default (client delegation) every handed-off question goes through the same submission path as typed chat (`source: "live-voice"`). Voice therefore uses the chosen text model and sign-in, and the same lanes, per-request policies (quiz, hints, page notes, document review, no page changes) and guards. The agent writes the full cited answer to the sidebar and opens it with a short paragraph; Onhand appends that paragraph to Live as commentary, and Live speaks it.
- **Page commands.** A handed-off request can be a simple page command Onhand carries out directly: next or previous PDF page (Onhand viewer only), next or previous highlight from the latest answer, clear Onhand's marks, stop, or Learning Mode on/off. A confident pick (0.6 or more) that is valid at that moment runs at once, Live speaks the result ("Page 4 of 15."), and the exchange is saved as a short `[Voice]` turn; "ask Onhand", an unsure or invalid pick, or a failure goes to the agent. Typed messages during a call are never routed.
  - **Native Decisions delegation (default).** Client sessions are created with `delegation.type: "decisions"` ([guide](https://developers.openai.com/api/docs/guides/decisions-voice)), so Live asks Decisions (gpt-6-luna) which command a request is as it delegates, and the `decision.event` usually arrives while the spoken request is still settling. Onhand no longer makes that call itself before each handed-off request, command or question. The session's question offers every command; Onhand appends a state message (`decision.item.create`) listing the commands valid now whenever that changes, and checks each pick before acting (`runVoiceCommand`). If no decision arrives within 1 s, or it failed, Onhand routes the request itself as before.
  - **Keeping Live from answering early.** Live gets the decision within about 150 ms of delegating and, unprompted, took it as the result: it asked its own quiz questions, gave hints and graded answers while Onhand was still working (quiz A/B, 2026-10-16: more than 12 words before Onhand's answer in 4 of 7 handed-off turns, versus 0 of 8 with client delegation; the student's answer went unhanded in 2 of 3 calls). Native sessions therefore add an instruction that a decision is not Onhand's result, and an "ask Onhand" decision is followed at once by a `session.thinking.append` on that delegation telling Live to acknowledge briefly and wait. Rerun: 0 of 17 handed-off turns spoke ahead, and the quiz answer was handed off in 3 of 3 calls.
  - **Fallback.** A key or account that cannot create a native session (a 4xx other than 401/429) gets plain client delegation, and Onhand asks Decisions itself (`routeVoiceCommand`, about 0.2 s plus the round trip). The hidden `liveNativeDecisions` setting turns native delegation off (`npm run debug:sessions -- live-native-decisions off`); `npm run eval:voice -- --native-ab` compares the two.
  - Code: `routeVoiceCommand`, `runVoiceCommand` and `voiceCommandState` in `browser-runtime.ts`; `host.route`, `host.execute` and `host.commandState` in the coordinator.
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

`npm run eval:voice` runs `evals/voice/cases.json`: one real call per case, each turn labelled with whether Live should hand it to the backend (`"handoff"`) or answer it itself (`"live"`), or carry out directly as a page command (`"command"`: delegated, and Onhand's reply is a command result rather than an agent turn). Cases cover follow-ups on Wikipedia, MDN and an arXiv PDF, follow-ups Live could answer from its own knowledge, small talk, overview questions, page commands between questions on a PDF and on Wikipedia, and a Learning-mode quiz (Learning mode is switched on for that case only, then restored). The run fails on any mis-handled or unheard turn, or a handed-off answer that was never spoken. It also reports native decisions received and the median time from delegation to Onhand's reply for page commands; `--native-ab` alternates calls with native Decisions delegation on and off to compare them.

`--case <id>` runs one case, `--reps <n>` repeats, and `--baseline <git-ref>` alternates calls between the working copy of `live-voice.js` and the one at that ref, then restores the working copy and reloads the extension. Use it to compare an instruction change old against new; each call is a paid Live call.
