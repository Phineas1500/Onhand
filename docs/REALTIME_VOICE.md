# Realtime Voice Tutor

Onhand has an experimental Realtime voice tutor branch that layers `gpt-realtime-2` speech-to-speech interaction over the existing browser-extension tutor.

The integration follows the OpenAI Realtime WebRTC unified-interface setup:

- the sidebar owns the browser `RTCPeerConnection`
- the sidebar posts its browser SDP to a local `/session` endpoint
- the local endpoint forwards multipart `FormData` fields named `sdp` and `session` to `/v1/realtime/calls`
- the browser opens an `oai-events` data channel for session updates, text prompts, and function tool outputs

## Setup

Install dependencies as usual:

```sh
npm install
```

Build the extension:

```sh
npm run build:extension
```

Voice requires an OpenAI platform API key in the Onhand options page. Open the extension options page, paste a platform key with Realtime API access in the OpenAI platform API key field, save, reload the extension, and click `Voice`. You can keep Authentication set to OpenAI Codex sign-in for text chat; `gpt-realtime-2` uses the platform API key.

The local session server is still available as a fallback/dev path:

```sh
OPENAI_API_KEY=... npm run serve:realtime
```

Optional environment variables:

```sh
REALTIME_SESSION_PORT=8787
REALTIME_MODEL=gpt-realtime-2
REALTIME_VOICE=marin
OPENAI_SAFETY_IDENTIFIER=onhand-local-dev
```

Reload the unpacked extension from `packages/browser-extension/`, open the side panel, and click `Voice`.

For deterministic live-microphone acceptance, you can generate a local WAV prompt and play it through your normal or virtual microphone device:

```sh
npm run generate:realtime-voice-fixture
```

The generator prefers `espeak`/`espeak-ng` when installed and falls back to macOS `say`/`afconvert`; it verifies that the output has audio samples before writing the fixture to the system temp directory, or to `REALTIME_VOICE_FIXTURE_OUTPUT` if set.

The shipped extension does not include or inject test audio. Click `Voice` normally, then speak or play the generated file through the microphone path selected in Chrome.

## Usage

Click `Voice` and wait until the status reads `Voice ready · ask, then pause`.

- Ask your question aloud, then stop talking for a short pause. Server VAD commits the turn and the model should answer aloud.
- While voice is live, typing in the composer sends that text into the same realtime session and asks for an audio response.
- Click `End` only when you want to disconnect the live voice session. It does not submit the current turn.
- Voice disconnects automatically after a few idle minutes to avoid leaving an expensive realtime session open.

Useful status messages while testing:

- `Mic hears you...` means Chrome is receiving microphone audio locally.
- `Listening...` means OpenAI server VAD detected the start of speech.
- `Transcribing...` means OpenAI server VAD detected the pause/end of speech and Onhand is waiting briefly for the commit/transcript before routing the turn. If neither arrives, Onhand manually asks Realtime to answer from the audio turn so pause-to-answer does not hang.
- `Mic heard a pause · waiting for API` means local mic input was detected, but no server VAD event has arrived yet. Onhand will then try a manual realtime input-buffer commit.
- `OpenAI received no mic audio` means Chrome detected local speech, but the realtime input buffer was empty when Onhand tried to commit it.
- `Voice ended after idle` means the session auto-disconnected because no active response or user turn was in flight.

## Current Behavior

When Voice is connected:

- microphone input streams to `gpt-realtime-2`
- model audio output plays in the side panel
- substantive page questions from voice or typed sidebar prompts are routed through Onhand's normal gpt-5.5-backed answer flow, then Realtime narrates a concise version of the completed answer
- when Learning Mode is enabled, new conceptual page questions route through `plan_pedagogical_move` first: Onhand highlights an anchor, records an open learning check, asks a Socratic prompt aloud, and mirrors it in the sidebar
- when the student answers that prompt, the next voice/text turn routes through `evaluate_response`, resolves the open learning check, and Realtime narrates concise feedback
- on direct or unsupported PDF tabs, Voice opens the document in Onhand's PDF viewer before routing page-grounded Answer Mode or Learning Mode work
- for chart, diagram, equation, screenshot, or weak-text questions, Onhand can capture the visible viewport/selector region as an image for the gpt-5.5 planner/answer flow; visual claims still need a captured region and exact text anchors when available
- voice turns are guarded by a local turn id; if the student interrupts or starts a newer turn, late planner/evaluator/direct-answer results are ignored instead of overwriting the sidebar or speaking stale content
- standalone Realtime voice answers and Learning Mode voice prompts/feedback are saved as text turns in the current Onhand session; raw mic/model audio is not saved
- the realtime model registers these function tools through `session.update`:
  - `check_calendar(date, time)` as the minimal sample tool
  - `get_current_learning_context()` for current tab, visible text, selection, and learner state
  - `annotate_page(anchors)` for exact highlights and short notes
  - `open_pdf_in_onhand_viewer()` for direct or unsupported PDF surfaces
  - `publish_sidebar_answer(markdown)` for sidebar-visible answers
  - `answer_directly(prompt)` for an explicit gpt-5.5-backed Onhand direct-answer pass
  - `plan_pedagogical_move(user_question)` for a gpt-5.5-backed Socratic Learning Mode move
  - `evaluate_response(user_response, previous_move)` for gpt-5.5-backed feedback on the student's answer

The voice model is intentionally narrow. It can ask for compact context, place highlights/notes, open unsupported PDFs in Onhand's viewer, publish a sidebar answer, request an explicit direct-answer pass, or run the Learning Mode planner/evaluator loop. Answer Mode routes page-material questions through `answer_directly`; Learning Mode routes new conceptual questions through `plan_pedagogical_move` and follow-up student answers through `evaluate_response`. Visual region images are captured by the browser runtime and passed to the Onhand planner/answer flow, not treated as free-floating realtime context.

## Notes

- The options-page API key stays in extension local storage and is used only by the extension background to call `/v1/realtime/calls`.
- If using the local session server fallback, `OPENAI_API_KEY` stays in the local session server.
- The server endpoint is fixed to `http://127.0.0.1:8787/session` for this prototype.
- Chrome may ask for microphone permission after the first `Voice` click.
- If Chrome reports `Permission dismissed` from the side panel, Onhand opens `mic-permission.html` in a normal extension tab. Click `Allow microphone` there; the side panel will retry the voice connection after permission is granted.
- Chrome extensions cannot use the packaged-app-only `audioCapture` permission. Onhand uses `navigator.mediaDevices.getUserMedia()` from the side panel and helper permission page instead.
