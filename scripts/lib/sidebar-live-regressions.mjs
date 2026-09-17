import assert from "node:assert/strict";

export async function runLiveSidebarRegressions({ renderSidebar, createState }) {
	const tick = () => new Promise(resolve => setTimeout(resolve, 20));
	const state = createState(); state.preferences.voiceEngine = "live"; state.preferences.liveDelegation = "client";
	const messages = [], sent = [], tracks = [];
	let pc, dc;
	const options = {
		mediaDevices: {
			async enumerateDevices() { return []; }, addEventListener() {},
			async getUserMedia() {
				const track = { enabled: true, label: "Test mic", stopped: false, stop() { this.stopped = true; } };
				tracks.push(track);
				return { getAudioTracks: () => [track], getTracks: () => [track] };
			},
		},
		liveSessionResponse(message) {
			assert.match(message.sdp, /^v=0/);
			return { ok: true, result: { sessionId: "live-test", sdp: "v=0\r\nanswer" } };
		},
		submitPromptResponse(message) {
			state.activeRequestId = message.clientRequestId;
			return { ok: true, requestId: message.clientRequestId };
		},
		setupWindow(window) {
			window.Audio = class { play() { return Promise.resolve(); } pause() {} };
			window.RTCPeerConnection = class {
				constructor() { pc = this; this.iceGatheringState = "complete"; }
				createDataChannel(name) {
					assert.equal(name, "oai-events");
					dc = { readyState: "open", send: value => sent.push(JSON.parse(value)), close() { this.readyState = "closed"; this.onclose?.(); } };
					return dc;
				}
				addTrack() {} close() { this.closed = true; }
				async createOffer() { return { type: "offer", sdp: "v=0\r\nm=audio 9\r\nm=application 9" }; }
				async setLocalDescription(value) { this.localDescription = value; }
				async setRemoteDescription(value) { this.remoteDescription = value; }
			};
		},
	};
	const dom = await renderSidebar(state, messages, options);
	const hooks = dom.window.__onhandSidebarTestHooks;
	const shadow = dom.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot;
	let sequence = 0;
	const emit = event => dc.onmessage({ data: JSON.stringify({ event_id: `event-${++sequence}`, ...event }) });
	try {
		await hooks.startLiveVoice();
		assert.equal(pc.remoteDescription.type, "answer");
		assert.equal(hooks.getLiveState().started, false, "SDP negotiation alone does not mean Live is ready");
		emit({ type: "session.started", session: { id: "live-test" } });
		await tick();
		assert.equal(hooks.getLiveState().started, true);
		assert.equal(sent.some(event => /response.create|session.update|input_audio_buffer/.test(event.type)), false);
		emit({ type: "session.input_transcript.delta", delta: "Explain this figure.", start_ms: 0, end_ms: 500 });
		emit({ type: "session.delegation.created", offset_ms: 600, delegation: { id: "opaque-delegation", target: "client" } });
		await new Promise(resolve => setTimeout(resolve, 500));
		const first = messages.find(message => message.type === "sidebar:submit-prompt");
		assert.equal(first.source, "live-voice"); assert.equal(first.sessionId, state.currentSession.sessionId);
		assert.ok(first.clientRequestId); assert.ok(first.voiceContext.length);
		await hooks.requestState();
		const input = shadow.getElementById("input");
		assert.equal(input.disabled, false, "typing must remain available during Live backend work");
		input.value = "Actually, use the second figure.";
		input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		await tick();
		assert.equal(input.value, "", "Enter sends a typed correction instead of acting as the Stop button");
		assert.equal(messages.filter(message => message.type === "sidebar:stop").every(message => message.requestId === first.clientRequestId), true);
		state.turns.push({ id: first.clientRequestId, pending: false, reply: "Stale first figure result.", activities: [], pageActions: [] });
		state.activeRequestId = null;
		await hooks.requestState(); await tick();
		assert.equal(messages.filter(message => message.type === "sidebar:submit-prompt").length, 2);
		assert.equal(sent.some(event => event.content?.includes("Stale first figure result")), false);
		hooks.setRealtimeMicMuted(true);
		const mute = sent.find(event => event.type === "session.input_audio.mute"); assert.ok(mute);
		assert.equal(tracks[0].enabled, false);
		emit({ type: "session.input_audio.muted", client_event_id: mute.event_id });
		assert.match(shadow.getElementById("realtimeStatus").textContent, /Mic muted/);
		emit({ type: "session.output_transcript.delta", delta: "Checking the second figure.", start_ms: 700, end_ms: 900 });
		const ownedRequest = state.activeRequestId;
		emit({ type: "session.input_transcript.delta", delta: "Can you hear me?", start_ms: 1000, end_ms: 1100 });
		emit({ type: "session.output_transcript.delta", delta: "Yes, I can.", start_ms: 1200, end_ms: 1300 });
		const close = hooks.stopLiveVoice();
		assert.equal(pc.closed, undefined, "keep the peer and mic alive until final usage arrives");
		emit({ type: "session.closed", reason: "close_requested", usage: { seconds: 7 } });
		await close; await tick();
		assert.equal(pc.closed, true); assert.equal(tracks[0].stopped, true);
		assert.equal(state.turns.filter(turn => turn.voiceOrigin === "live").length, 1);
		assert.equal(state.turns.at(-1).reply, "Yes, I can.");
		assert.equal(state.activeRequestId, ownedRequest);
		assert.equal(messages.filter(message => message.type === "sidebar:submit-prompt").length, 2, "direct speech saves without invoking the backend");
		assert.equal(hooks.getLiveState().final, true);
		const history = dom.getStorageValue(`onhandLiveTranscript:${state.currentSession.sessionId}`);
		assert.equal(history.usage.seconds, 7); assert.ok(history.segments.some(entry => entry.role === "assistant"));
		assert.equal(messages.some(message => message.type === "sidebar:record-realtime-turn"), false);
		console.log("Live sidebar transport, corrections, mute, captions, and graceful close passed");
	} finally { dom.window.close(); }

	const managedState = createState(); managedState.preferences.voiceEngine = "live"; managedState.preferences.liveDelegation = "responses";
	const initialTurns = managedState.turns.length;
	const managedMessages = [];
	const managedDom = await renderSidebar(managedState, managedMessages, {
		...options,
		liveImage(message) {
			assert.equal(message.sessionId, managedState.currentSession.sessionId);
			assert.match(message.dataUrl, /^data:image\/png;base64,/);
			return { ok: true, result: { type: "input_image", file_id: "file-managed", detail: "auto" } };
		},
		liveTextFile(message) {
			assert.equal(message.sessionId, managedState.currentSession.sessionId);
			assert.ok(message.text.includes("Evidence at the end."));
			return { ok: true, result: { type: "input_file", file_id: "file-source-managed" } };
		},
		liveResponses(message) {
			assert.equal(message.sessionId, managedState.currentSession.sessionId);
			if (message.operation === "config") return { ok: true, result: { tools: [{ name: "onhand_review_answer" }] } };
			if (message.operation === "begin") managedState.activeRequestId = message.requestId;
			if (message.operation === "finish") {
				managedState.activeRequestId = null;
				const turn = { id: message.requestId, userPrompt: message.prompt, reply: message.reply, pending: false, pageActions: [], activities: [], managedLiveRevision: message.revision };
				const index = managedState.turns.findIndex(turn => turn.id === message.requestId);
				if (index < 0) managedState.turns.push(turn); else managedState.turns[index] = turn;
			}
			return { ok: true, result: message.operation === "review" ? { ready: true } : message.operation === "tool" ? { output: "Verified source result. ".repeat(1000) + "Evidence at the end.", images: ["data:image/png;base64,cGl4ZWw="] } : { requestId: message.requestId } };
		},
	});
	const managedHooks = managedDom.window.__onhandSidebarTestHooks;
	try {
		await managedHooks.startLiveVoice(); emit({ type: "session.started", session: { id: "managed-test" } });
		await tick();
		const nested = (event, delegation_id = "managed-delegation") => emit({ type: "response.event", delegation_id, event });
		emit({ type: "session.input_transcript.delta", delta: "Read the source.", start_ms: 0, end_ms: 20 });
		emit({ type: "session.delegation.created", delegation: { target: "responses", id: "managed-delegation" }, offset_ms: 30 });
		nested({ type: "response.created", response: { id: "managed-r1", output: [] } });
		nested({ type: "response.output_item.done", item: { id: "fn", type: "function_call", name: "browser_extract_content", call_id: "call", arguments: "{}" } });
		nested({ type: "response.completed", response: { id: "managed-r1", output: [], usage: { input_tokens: 10, output_tokens: 5 } } });
		await tick(); await tick();
		assert.ok(managedMessages.some(message => message.type === "sidebar:live-responses" && message.operation === "tool"));
		assert.equal(managedMessages.some(message => message.type === "sidebar:submit-prompt"), false);
		assert.ok(managedMessages.some(message => message.type === "sidebar:live-image"));
		assert.ok(managedMessages.some(message => message.type === "sidebar:live-text-file"));
		assert.ok(sent.some(event => event.item?.content?.some(part => part.file_id === "file-source-managed")));
		assert.ok(sent.some(event => event.item?.content?.some(part => part.file_id === "file-managed")));
		nested({ type: "response.created", response: { id: "managed-r2", output: [] } });
		nested({ type: "response.output_text.delta", item_id: "answer", delta: "The source says hello." });
		await tick();
		assert.ok(managedMessages.some(message => message.operation === "update" && message.reply === "The source says hello."));
		nested({ type: "response.output_item.done", item: { id: "answer", type: "message", content: [{ type: "output_text", text: "The source says hello." }] } });
		nested({ type: "response.completed", response: { id: "managed-r2", output: [] } });
		await tick(); await managedHooks.requestState();
		assert.equal(managedState.turns.at(-1).reply, "The source says hello.");
		assert.ok(managedMessages.some(message => message.operation === "review" && message.reply === "The source says hello."));
		emit({ type: "session.output_transcript.delta", delta: "The source says hello.", start_ms: 40, end_ms: 50 });
		const revisedId = managedState.turns.at(-1).id;
		emit({ type: "session.input_transcript.delta", delta: "Especially its conclusion.", start_ms: 60, end_ms: 70 });
		emit({ type: "session.delegation.created", delegation: { target: "responses", id: "continuation" }, offset_ms: 80 });
		nested({ type: "response.created", response: { id: "managed-r3", output: [] } }, "continuation");
		nested({ type: "response.output_item.done", item: { id: "context", type: "function_call", name: "onhand_get_context", call_id: "context", arguments: JSON.stringify({ request_relation: "continue", full_request: "Read the source, especially its conclusion." }) } }, "continuation");
		nested({ type: "response.completed", response: { id: "managed-r3", output: [] } }, "continuation");
		await tick(); await tick();
		nested({ type: "response.created", response: { id: "managed-r4", output: [] } }, "continuation");
		nested({ type: "response.output_item.done", item: { id: "revised", type: "message", content: [{ type: "output_text", text: "The complete answer includes the conclusion." }] } }, "continuation");
		nested({ type: "response.completed", response: { id: "managed-r4", output: [] } }, "continuation");
		await tick(); await managedHooks.requestState();
		assert.equal(managedState.turns.length, initialTurns + 1);
		assert.equal(managedState.turns.at(-1).id, revisedId);
		assert.equal(managedState.turns.at(-1).managedLiveRevision, 2);
		assert.equal(managedState.turns.at(-1).userPrompt, "Read the source, especially its conclusion.");
		assert.ok(managedMessages.filter(message => message.operation === "begin").every(message => message.voiceCallId && message.revision));
		emit({ type: "session.output_transcript.delta", delta: "The conclusion says hello.", start_ms: 90, end_ms: 100 });
		emit({ type: "session.input_transcript.delta", delta: "Just repeat it.", start_ms: 110, end_ms: 120 });
		emit({ type: "session.output_transcript.delta", delta: "It says ", start_ms: 130, end_ms: 140 });
		await new Promise(resolve => setTimeout(resolve, 550));
		await managedHooks.requestState();
		assert.equal(managedState.turns.length, initialTurns + 2, "direct Live answer is a normal conversation turn");
		const directId = managedState.turns.at(-1).id;
		const managedShadow = managedDom.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot;
		const directCard = managedShadow.querySelector(`[data-onhand-turn-id="${directId}"]`);
		assert.match(directCard.textContent, /Voice answer/);
		assert.match(directCard.textContent, /Just repeat it/);
		assert.doesNotMatch(directCard.textContent, /Page-grounded/);
		emit({ type: "session.output_transcript.delta", delta: "hello.", start_ms: 140, end_ms: 150 });
		const closing = managedHooks.stopLiveVoice();
		emit({ type: "session.output_transcript.delta", delta: " That's all.", start_ms: 150, end_ms: 160 });
		emit({ type: "session.closed", usage: { seconds: 5 }, reason: "close_requested" }); await closing; await tick();
		assert.equal(managedState.turns.length, initialTurns + 2, "backend narration does not create another turn");
		assert.equal(managedState.turns.at(-1).id, directId);
		assert.equal(managedState.turns.at(-1).reply, "It says hello. That's all.", "End flushes late captions into the same saved turn");
		assert.equal(managedMessages.filter(message => message.type === "sidebar:live-responses" && message.operation === "begin").length, 2);
		assert.equal(managedMessages.some(message => message.type === "sidebar:submit-prompt"), false);
		const stored = managedDom.getStorageValue(`onhandLiveTranscript:${managedState.currentSession.sessionId}`);
		assert.equal(stored.usage.backendInputTokens, 10); assert.equal(stored.usage.backendOutputTokens, 5);
		console.log("Managed Live sidebar: direct tool routing, streamed answers, persistence, and backend usage passed");
		const reopened = await renderSidebar(managedState, [], options);
		try {
			assert.match(reopened.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot.textContent, /It says hello\. That's all\./);
		} finally { reopened.window.close(); }
	} finally { managedDom.window.close(); }

	const supervisedState = createState();
	Object.assign(supervisedState.preferences, { voiceEngine: "live", liveDelegation: "responses", liveInterruptionEnabled: true });
	const supervisedMessages = [];
	let copiedTiming = "";
	let interruptionAction = "pause", correctionSpeech = "Actually, only English to German.";
	const supervisedDom = await renderSidebar(supervisedState, supervisedMessages, {
		...options,
		setupWindow(window) {
			options.setupWindow(window);
			Object.defineProperty(window.navigator, "clipboard", { value: { async writeText(text) { copiedTiming = text; } } });
		},
		liveInterruption(message) {
			assert.equal(message.sessionId, supervisedState.currentSession.sessionId);
			assert.equal(message.context.request, "Compare models including training cost.");
			assert.equal(message.context.speech, correctionSpeech);
			return { ok: true, result: { action: interruptionAction, usage: { input_tokens: 42, output_tokens: 6 } } };
		},
		liveResponses(message) {
			if (message.operation === "config") return { ok: true, result: { tool_choice: "auto", tools: [{ name: "onhand_review_answer" }] } };
			if (message.operation === "begin") supervisedState.activeRequestId = message.requestId;
			if (message.operation === "finish") supervisedState.activeRequestId = null;
			return { ok: true, result: message.operation === "tool" ? { output: "Verified evidence." } : { ready: true } };
		},
	});
	try {
		const hooks = supervisedDom.window.__onhandSidebarTestHooks;
		const shadow = supervisedDom.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot;
		await hooks.startLiveVoice(); emit({ type: "session.started", session: { id: "supervised" } }); await tick();
		const nested = (event, delegation_id = "supervised-task") => emit({ type: "response.event", delegation_id, event });
		emit({ type: "session.input_transcript.delta", delta: "Compare the models.", start_ms: 0, end_ms: 20 });
		emit({ type: "session.delegation.created", delegation: { target: "responses", id: "supervised-task" }, offset_ms: 30 });
		nested({ type: "response.created", response: { id: "sr1", output: [] } });
		nested({ type: "response.output_item.done", item: { type: "function_call", name: "onhand_get_context", call_id: "context", arguments: JSON.stringify({ request_relation: "new", full_request: "Compare models including training cost." }) } });
		nested({ type: "response.completed", response: { id: "sr1", output: [] } }); await tick();
		nested({ type: "response.created", response: { id: "sr2", output: [] } });
		emit({ type: "session.input_transcript.delta", delta: "Actually, only English to German.", start_ms: 40, end_ms: 60 });
		await new Promise(resolve => setTimeout(resolve, 300));
		assert.equal(shadow.getElementById("liveResumePageWork").hidden, false);
		assert.equal(shadow.getElementById("liveTimingPanel").hidden, false);
		assert.match(shadow.textContent, /correction checks 42 in \/ 6 out tokens/);
		nested({ type: "response.output_item.done", item: { type: "function_call", name: "browser_highlight_text", call_id: "mark", arguments: "{}" } });
		nested({ type: "response.completed", response: { id: "sr2", output: [] } }); await tick();
		assert.equal(supervisedMessages.filter(m => m.operation === "tool").length, 1);
		shadow.getElementById("liveResumePageWork").click(); await tick();
		assert.equal(shadow.getElementById("liveResumePageWork").hidden, true);
		assert.equal(supervisedMessages.filter(m => m.operation === "tool").length, 2);
		// The real failure had no second delegation event. A complete correction
		// must clear the paused UI and continue this exact managed task itself.
		interruptionAction = "revise"; correctionSpeech = "Actually, report BLEU points and keep training cost.";
		nested({ type: "response.created", response: { id: "sr3", output: [] } });
		emit({ type: "session.input_transcript.delta", delta: correctionSpeech, start_ms: 80, end_ms: 100 });
		await new Promise(resolve => setTimeout(resolve, 800));
		assert.equal(shadow.getElementById("liveResumePageWork").hidden, false);
		nested({ type: "response.output_item.done", item: { type: "function_call", name: "browser_highlight_text", call_id: "stale-mark", arguments: "{}" } });
		nested({ type: "response.completed", response: { id: "sr3", output: [] } }); await tick();
		assert.equal(shadow.getElementById("liveResumePageWork").hidden, true, "complete correction automatically resumes the updated task");
		assert.equal(supervisedMessages.filter(m => m.operation === "tool").length, 2, "stale mark was not executed");
		nested({ type: "response.created", response: { id: "sr4", output: [] } });
		nested({ type: "response.output_item.done", item: { type: "function_call", name: "onhand_get_context", call_id: "updated-context", arguments: JSON.stringify({ request_relation: "continue", full_request: "Compare models in BLEU points including training cost." }) } });
		nested({ type: "response.completed", response: { id: "sr4", output: [] } }); await tick();
		assert.equal(supervisedMessages.filter(m => m.operation === "begin").length, 1);
		assert.match(supervisedMessages.filter(m => m.operation === "update").at(-1).prompt, /BLEU points including training cost/);
		nested({ type: "response.created", response: { id: "sr5", output: [] } });
		nested({ type: "response.output_item.done", item: { id: "answer", type: "message", content: [{ type: "output_text", text: "The corrected answer including training cost." }] } });
		nested({ type: "response.completed", response: { id: "sr5", output: [] } }); await tick();
		const updatesBeforeDuplicate = supervisedMessages.filter(m => m.operation === "update").length;
		// Live's delegation offset may follow the final correction caption.
		emit({ type: "session.delegation.created", delegation: { target: "responses", id: "delayed-correction" }, offset_ms: 140 });
		nested({ type: "response.created", response: { id: "sr6", output: [] } }, "delayed-correction");
		nested({ type: "response.output_item.done", item: { type: "function_call", name: "onhand_get_context", call_id: "duplicate-context", arguments: JSON.stringify({ request_relation: "continue", full_request: "Compare models in BLEU points." }) } }, "delayed-correction");
		nested({ type: "response.completed", response: { id: "sr6", output: [] } }, "delayed-correction"); await tick();
		assert.equal(supervisedMessages.filter(m => m.operation === "begin").length, 1);
		assert.equal(supervisedMessages.filter(m => m.operation === "update").length, updatesBeforeDuplicate);
		assert.equal(supervisedMessages.filter(m => m.operation === "finish").length, 1);
		assert.match(supervisedMessages.find(m => m.operation === "finish").reply, /including training cost/);
		shadow.getElementById("liveCopyTiming").click(); await tick();
		const timing = JSON.parse(copiedTiming);
		assert.ok(timing.events.some(e => e.type === "page_work_paused"));
		assert.ok(timing.events.some(e => e.type === "page_work_resumed"));
		assert.ok(timing.events.some(e => e.type === "correction_context_resolved"));
		assert.ok(timing.events.some(e => e.type === "duplicate_correction_delegation"));
		assert.doesNotMatch(copiedTiming, /German|Compare|Verified evidence/);
		const closing = hooks.stopLiveVoice(); emit({ type: "session.closed", usage: { seconds: 2 }, reason: "close_requested" }); await closing; await tick();
		const saved = supervisedDom.getStorageValue(`onhandLiveTranscript:${supervisedState.currentSession.sessionId}`);
		assert.equal(supervisedMessages.filter(m => m.operation === "finish").length, 1, "End preserves the completed answer");
		assert.ok(saved.diagnostics.some(e => e.type === "page_work_paused"));
		assert.equal(saved.usage.checkInputTokens, 84);
		console.log("Managed Live interruption UI, worker routing, recovery, token accounting, and local timing export passed");
	} finally { supervisedDom.window.close(); }

	// A fresh sidebar paired with an older worker must fail before mic/HTTP
	// startup, rather than recording a successful answer as a failed turn.
	const staleMessages = [];
	let staleMicRequests = 0, staleLiveRequests = 0;
	const staleDom = await renderSidebar(managedState, staleMessages, {
		...options,
		mediaDevices: { ...options.mediaDevices, async getUserMedia() { staleMicRequests++; return options.mediaDevices.getUserMedia(); } },
		liveSessionResponse() { staleLiveRequests++; throw new Error("Must not start a paid session"); },
		liveResponses() { return { ok: true, result: { tools: [{ name: "onhand_get_context" }] } }; },
	});
	try {
		await staleDom.window.__onhandSidebarTestHooks.startLiveVoice();
		assert.equal(staleMicRequests, 0); assert.equal(staleLiveRequests, 0);
		assert.match(staleDom.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot.textContent, /running different versions/);
		assert.equal(staleMessages.some(message => message.operation === "begin" || message.operation === "finish"), false);
		console.log("Managed Live startup: stale background detected before microphone, paid session, or saved turn");
	} finally { staleDom.window.close(); }

	let releaseMic;
	const delayedMic = new Promise(resolve => { releaseMic = resolve; });
	let requests = 0;
	const oldTrack = { stopped: false, stop() { this.stopped = true; } };
	const oldStream = { getTracks: () => [oldTrack], getAudioTracks: () => [oldTrack] };
	const lateDom = await renderSidebar(createState(), [], {
		...options,
		liveResponses() { return { ok: true, result: { tools: [{ name: "onhand_review_answer" }] } }; },
		mediaDevices: { ...options.mediaDevices, getUserMedia() { return ++requests === 1 ? delayedMic : options.mediaDevices.getUserMedia(); } },
	});
	const lateHooks = lateDom.window.__onhandSidebarTestHooks;
	try {
		const firstStartup = lateHooks.startLiveVoice(); await tick();
		await lateHooks.stopLiveVoice();
		await lateHooks.startLiveVoice();
		const newest = tracks.at(-1);
		releaseMic(oldStream); await firstStartup;
		assert.equal(oldTrack.stopped, true, "cancelled startup must release its own microphone");
		assert.equal(newest.stopped, false, "late permission completion must not stop a newer call");
		await lateHooks.stopLiveVoice(); assert.equal(newest.stopped, true);
		console.log("Live microphone startup cancellation passed");
	} finally { lateDom.window.close(); }
}
