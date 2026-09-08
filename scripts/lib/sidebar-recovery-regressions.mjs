import assert from "node:assert/strict";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const full = (state, historyRevision = "accepted-history") => ({ ok: true, state: structuredClone(state), historyRevision });

async function harness(renderSidebar, state, options = {}) {
	const messages = [];
	const dom = await renderSidebar(state, messages, options);
	const originalSend = dom.window.chrome.runtime.sendMessage;
	let response = () => full(state);
	let otherResponse = null;
	dom.window.chrome.runtime.sendMessage = async (message) => {
		if (message.type === "sidebar:fetch-state") { messages.push(message); return response(message); }
		if (otherResponse) {
			const result = otherResponse(message);
			if (result !== undefined) { messages.push(message); return result; }
		}
		return originalSend(message);
	};
	const shadow = dom.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot;
	const scroll = shadow.getElementById("scroll");
	Object.defineProperties(scroll, {
		clientHeight: { configurable: true, get: () => 500 },
		scrollHeight: { configurable: true, get: () => shadow.querySelector("#messages .onhand-entry") ? 3000 : 500 },
	});
	const h = { dom, shadow, messages, scroll,
		setResponse(fn) { response = fn; }, setOtherResponse(fn) { otherResponse = fn; },
		async refresh() { await dom.window.__onhandSidebarTestHooks.requestState(); await tick(); },
		get entries() { return [...shadow.querySelectorAll("#messages .onhand-entry")]; },
	};
	await h.refresh();
	scroll.scrollTop = 300;
	return h;
}

async function assertDisconnectKeepsReadingAndReconnects({ renderSidebar, createState }) {
	const state = createState();
	const h = await harness(renderSidebar, state);
	try {
		const entries = h.entries;
		const cite = entries[0].querySelector(".onhand-cite");
		const copy = entries[0].querySelector("[data-copy-turn-id]");
		h.setResponse(() => { throw new Error("The background worker is restarting"); });
		await h.refresh();
		assert.deepEqual(h.entries, entries, "disconnect must retain completed answer DOM nodes");
		assert.equal(h.scroll.scrollTop, 300, "disconnect must retain the reader's offset");
		assert.equal(h.shadow.getElementById("connectionNotice").hidden, false);
		assert.match(h.shadow.getElementById("connectionStatus").textContent, /Disconnected.*last received conversation/i);
		assert.equal(cite.disabled, true, "sources requiring the runtime must pause");
		assert.equal(copy.disabled, false, "copying an already received answer remains available");
		assert.equal(h.shadow.getElementById("sessionSelect").disabled, true);
		const actionsBefore = h.messages.filter((message) => message.type === "sidebar:activate-action").length;
		cite.dispatchEvent(new h.dom.window.MouseEvent("click", { bubbles: true }));
		assert.equal(h.messages.filter((message) => message.type === "sidebar:activate-action").length, actionsBefore, "even delegated events may not act on disconnected state");
		const input = h.shadow.getElementById("input");
		input.value = "Do not send while disconnected";
		input.dispatchEvent(new h.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		await tick();
		assert.equal(h.messages.some((message) => message.type === "sidebar:submit-prompt"), false);
		await h.refresh();
		assert.deepEqual(h.entries, entries, "repeated failed polls retain the same snapshot");
		const reconnect = deferred();
		h.setResponse((message) => { assert.equal(message.knownHistoryRevision, undefined, "reconnect must request a fresh full snapshot"); return reconnect.promise; });
		const button = h.shadow.getElementById("reconnectButton");
		button.focus(); button.click();
		await tick();
		assert.match(h.shadow.getElementById("connectionStatus").textContent, /Reconnecting/);
		assert.equal(button.disabled, true);
		reconnect.resolve(full(state, "restarted-history"));
		await tick(); await tick();
		assert.equal(h.shadow.getElementById("connectionNotice").hidden, true);
		assert.deepEqual(h.entries, entries, "same-session recovery must keep answer DOM/selection anchors");
		assert.equal(h.scroll.scrollTop, 300);
		assert.equal(cite.disabled, false);
		assert.equal(h.shadow.getElementById("sendButton").disabled, false);
		assert.notEqual(h.shadow.activeElement, button, "keyboard focus must not remain in a hidden retry control");
	} finally { h.dom.window.close(); }
}

async function assertSessionChangesCannotRecoverOldHistory({ renderSidebar, createState }) {
	for (const kind of ["observed-mismatch", "explicit-switch"]) {
		const state = createState();
		const h = await harness(renderSidebar, state, { sessions: [
			{ id: state.currentSession.sessionId, path: state.currentSession.sessionId, name: state.currentSession.sessionName },
			{ id: "other-session", path: "other-session", name: "Other session" },
		] });
		try {
			const old = deferred();
			h.setResponse(() => old.promise);
			const oldRequest = h.dom.window.__onhandSidebarTestHooks.requestState();
			await tick();
			if (kind === "observed-mismatch") {
				let attempts = 0;
				h.setResponse(() => ++attempts === 1 ? {
					ok: true, historyUnchanged: true, historyRevision: "accepted-history",
					state: { currentSession: { sessionId: "other-session", sessionName: "Other session" } },
				} : { ok: false, error: "Connection lost during full recovery" });
				await h.refresh();
			} else {
				h.setOtherResponse((message) => message.type === "sidebar:switch-session" ? { ok: true } : undefined);
				h.setResponse(() => ({ ok: false, error: "Connection lost after session switch" }));
				const select = h.shadow.getElementById("sessionSelect");
				select.value = "other-session";
				select.dispatchEvent(new h.dom.window.Event("change", { bubbles: true }));
				await tick(); await tick();
			}
			assert.equal(h.entries.length, 0, `${kind}: previous session cannot be presented as the unknown destination`);
			assert.equal(h.shadow.getElementById("connectionNotice").hidden, false);
			old.resolve(full(state, "old-history")); await oldRequest;
			assert.equal(h.entries.length, 0, `${kind}: an older successful response cannot repopulate stale history`);
			await h.refresh();
			assert.equal(h.entries.length, 0, `${kind}: later failures cannot resurrect the invalidated snapshot`);
		} finally { h.dom.window.close(); }
	}
}

async function assertSourceFailureIsLocalAndRetryable({ renderSidebar, createState }) {
	const state = createState();
	const retry = deferred();
	let activations = 0;
	const h = await harness(renderSidebar, state, { activateActionResponse: () => ++activations === 1
		? { ok: false, error: "The saved passage is temporarily unavailable." } : retry.promise });
	try {
		const entry = h.entries[0];
		const cite = entry.querySelector(".onhand-cite");
		const key = cite.dataset.actionKey;
		cite.click(); await tick();
		const feedback = entry.querySelector(".onhand-source-feedback");
		assert.ok(feedback, "failed older-answer source must have feedback within its own answer");
		assert.equal(cite.nextElementSibling, feedback, "feedback belongs beside the originating control");
		assert.equal(feedback.getAttribute("role"), "status");
		assert.match(feedback.textContent, /saved passage is temporarily unavailable/);
		assert.equal(cite.getAttribute("aria-describedby"), feedback.id);
		assert.equal(h.scroll.scrollTop, 300, "source failure must not scroll to a bottom notice");
		await h.refresh(); await h.refresh();
		assert.equal(entry.querySelector(".onhand-source-feedback"), feedback, "polls must not dismiss an unresolved source failure");
		const button = feedback.querySelector("button");
		button.focus(); button.click(); button.click(); cite.click();
		await tick();
		assert.equal(activations, 2, "retry and duplicate pointer/click events must launch only one request");
		assert.equal(button.disabled, true);
		const calls = h.messages.filter((message) => message.type === "sidebar:activate-action");
		assert.deepEqual(calls.map((message) => [message.key, message.sessionPath]), [[key, state.currentSession.sessionId], [key, state.currentSession.sessionId]],
			"retry must retain the original action and session identity");
		retry.resolve({ ok: true }); await tick();
		assert.equal(entry.querySelector(".onhand-source-feedback"), null, "success clears the local error");
		assert.equal(cite.hasAttribute("aria-describedby"), false);
		assert.equal(h.shadow.activeElement, cite, "retry success returns focus to its source control");
		assert.equal(h.scroll.scrollTop, 300);
	} finally { h.dom.window.close(); }
}

async function assertLateSourceErrorsStayWithTheirSession({ renderSidebar, createState }) {
	const state = createState();
	const delayed = deferred();
	const h = await harness(renderSidebar, state, { activateActionResponse: () => delayed.promise });
	try {
		h.entries[0].querySelector(".onhand-cite").click(); await tick();
		state.currentSession = { sessionId: "next-source-session", sessionName: "Next source session" };
		state.turns = [{ ...state.turns[0], reply: "This is another conversation.", pageActions: [] }];
		await h.refresh();
		delayed.resolve({ ok: false, error: "Old conversation source failure" }); await tick();
		assert.equal(h.shadow.querySelector(".onhand-source-feedback"), null, "a late source error must not attach to another conversation");
		assert.doesNotMatch(h.shadow.getElementById("messages").textContent, /Old conversation source failure/);
	} finally { h.dom.window.close(); }
}

async function assertOfflineStopAndEndVoiceRemainAvailable({ renderSidebar, createState }) {
	const state = createState();
	state.activeRequestId = state.currentTurnId = "ongoing-request";
	state.messages = [{ id: "user:ongoing-request", text: "A running request" }];
	state.preferences = { ...state.preferences, realtimeVoiceEnabled: true };
	const h = await harness(renderSidebar, state);
	try {
		let stoppedTracks = 0;
		h.dom.window.__onhandSidebarTestHooks.setRealtimeConnected(true);
		h.dom.window.__onhandSidebarTestHooks.setRealtimeMediaStream({ getTracks: () => [{ stop() { stoppedTracks += 1; } }] });
		h.setResponse(() => ({ ok: false, error: "State temporarily unavailable" }));
		await h.refresh();
		const stop = h.shadow.getElementById("sendButton");
		assert.equal(stop.disabled, false, "a failed poll must not remove best-effort Stop");
		assert.match(stop.textContent, /Stop/);
		stop.click(); await tick(); await tick();
		assert.equal(h.messages.filter((message) => message.type === "sidebar:stop").length, 1, "Stop may succeed even if state reads fail");
		const endVoice = h.shadow.getElementById("realtimeVoiceButton");
		assert.equal(endVoice.disabled, false, "the independently connected microphone must still have an End control");
		endVoice.click(); await tick();
		assert.equal(stoppedTracks, 1);
		assert.equal(h.dom.window.__onhandSidebarTestHooks.getRealtimeDebugState().connected, false);
		assert.equal(endVoice.disabled, true, "starting another voice session waits for reconnection");
	} finally { h.dom.window.close(); }
}

async function assertLateOfflineFailureCanRetryAfterReconnect({ renderSidebar, createState }) {
	const state = createState();
	const delayed = deferred();
	let activations = 0;
	const h = await harness(renderSidebar, state, { activateActionResponse: () => ++activations === 1 ? delayed.promise : { ok: true } });
	try {
		const entry = h.entries[0];
		entry.querySelector(".onhand-cite").click(); await tick();
		h.setResponse(() => ({ ok: false, error: "Poll failed during source lookup" }));
		await h.refresh();
		delayed.resolve({ ok: false, error: "Source lookup also failed" }); await tick();
		const button = entry.querySelector(".onhand-source-feedback button");
		assert.ok(button);
		assert.equal(button.disabled, true);
		await h.refresh();
		h.setResponse(() => full(state)); await h.refresh();
		assert.equal(h.entries[0], entry, "reconnect should retain the exact affected answer");
		assert.equal(button.disabled, false, "Retry created during disconnection must enable on reconnect without a transcript redraw");
		button.click(); await tick();
		assert.equal(activations, 2);
		assert.equal(entry.querySelector(".onhand-source-feedback"), null);
	} finally { h.dom.window.close(); }
}

async function assertReplaySourceFailureSurvivesRefresh({ renderSidebar, createState }) {
	const state = createState();
	let activations = 0;
	const h = await harness(renderSidebar, state, { activateActionResponse: () => ++activations === 1
		? { ok: false, error: "Saved replay source could not open" } : { ok: true } });
	try {
		h.shadow.querySelector("[data-replay-toggle]").click(); await tick(); await tick();
		const replay = h.shadow.getElementById("replayView");
		const source = replay.querySelector("[data-action-key]");
		assert.ok(source);
		const key = source.dataset.actionKey;
		source.click(); await tick();
		assert.match(replay.querySelector(".onhand-source-feedback").textContent, /Saved replay source could not open/);
		await h.refresh();
		const retry = replay.querySelector(".onhand-source-feedback button");
		assert.ok(retry, "replay DOM reconstruction must keep the unresolved error beside its source");
		retry.click(); await tick();
		assert.equal(activations, 2);
		assert.equal(replay.querySelector(".onhand-source-feedback"), null);
		assert.deepEqual(h.messages.filter((message) => message.type === "sidebar:activate-action").map((message) => [message.key, message.sessionPath]),
			[[key, state.currentSession.sessionId], [key, state.currentSession.sessionId]]);
	} finally { h.dom.window.close(); }
}

export async function runSidebarRecoveryRegressions(helpers) {
	await assertDisconnectKeepsReadingAndReconnects(helpers);
	await assertSessionChangesCannotRecoverOldHistory(helpers);
	await assertSourceFailureIsLocalAndRetryable(helpers);
	await assertLateSourceErrorsStayWithTheirSession(helpers);
	await assertOfflineStopAndEndVoiceRemainAvailable(helpers);
	await assertLateOfflineFailureCanRetryAfterReconnect(helpers);
	await assertReplaySourceFailureSurvivesRefresh(helpers);
}
