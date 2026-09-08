import assert from "node:assert/strict";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const full = (state, revision) => ({ ok: true, state: structuredClone(state), ...(revision ? { historyRevision: revision } : {}) });
function unchanged(state, revision) {
	const response = full(state, revision);
	delete response.state.turns;
	delete response.state.messages;
	response.historyUnchanged = true;
	return response;
}

async function harness(renderSidebar, state, options = {}) {
	const runtimeMessages = [];
	const dom = await renderSidebar(state, runtimeMessages, options);
	const originalSend = dom.window.chrome.runtime.sendMessage;
	const requests = [];
	let respond = () => full(state, "history-a");
	let otherResponse = null;
	dom.window.chrome.runtime.sendMessage = async (message) => {
		if (message?.type === "sidebar:fetch-state") {
			requests.push(structuredClone(message));
			return await respond(message);
		}
		if (otherResponse) {
			const response = await otherResponse(message);
			if (response !== undefined) return response;
		}
		return originalSend(message);
	};
	const shadow = dom.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot;
	return {
		dom, shadow, requests,
		setResponse(callback) { respond = callback; },
		setOtherResponse(callback) { otherResponse = callback; },
		async refresh() { await dom.window.__onhandSidebarTestHooks.requestState(); await tick(); },
		text: () => shadow.getElementById("messages").textContent,
		sessionName: () => shadow.getElementById("sessionTitleInput").value,
	};
}

async function assertHistoryReuseKeepsMetadataFresh({ renderSidebar, createState }) {
	const state = createState();
	state.tab = { id: 42, title: "Original page", url: "https://example.test/original" };
	state.activeRequestId = state.currentTurnId = "active-history";
	state.messages = [
		{ id: "user:active-history", text: "Current user question" },
		{ id: "assistant:active-history", text: "Current answer remains available.", pending: true },
	];
	const h = await harness(renderSidebar, state);
	try {
		await h.refresh();
		assert.equal(h.requests.at(-1).knownHistoryRevision, undefined, "the first revision-aware fetch must request full history");
		assert.match(h.text(), /Current answer remains available/);
		const savedText = state.turns[0].reply;
		state.tab = { id: 43, title: "Current page", url: "https://example.test/current" };
		state.pageActions = [{
			key: "highlight:current-page", type: "annotation", annotationId: "current-page", tabId: 43,
			title: "Current page", url: state.tab.url, citationText: "A newly added page highlight.",
		}];
		state.status = "Live metadata refreshed";
		h.setResponse(() => unchanged(state, "history-a"));
		await h.refresh();
		assert.equal(h.requests.at(-1).knownHistoryRevision, "history-a", "the accepted revision must be sent on subsequent fetches");
		assert.ok(h.text().includes(savedText), "unchanged history must retain completed answers");
		assert.match(h.text(), /Current answer remains available/, "unchanged history must also retain the current user and assistant messages");
		assert.match(h.shadow.getElementById("pageIndex").textContent, /A newly added page highlight/, "page actions must come from the current response, not cached history");
		assert.match(h.shadow.querySelector(".onhand-status").textContent, /Live metadata refreshed/);
		// A local action failure renders a new status object between server polls.
		h.setOtherResponse((message) => message.type === "sidebar:scroll-to-annotation" ? { ok: false, error: "Local source unavailable" } : undefined);
		h.shadow.querySelector("#pageIndex [data-annotation-id]").click();
		await tick();
		assert.match(h.shadow.querySelector(".onhand-status").textContent, /Local source unavailable/);
		await h.refresh();
		assert.equal(h.requests.at(-1).knownHistoryRevision, "history-a", "local status rendering must not discard the accepted server history");
		assert.ok(h.text().includes(savedText));
		assert.match(h.shadow.querySelector(".onhand-status").textContent, /Live metadata refreshed/);
		state.pageActions = [];
		await h.refresh();
		assert.equal(h.shadow.getElementById("pageIndex").hidden, true, "removing current page actions must not leave cached highlights visible");
		assert.equal(h.shadow.getElementById("pageIndex").textContent, "");
	} finally { h.dom.window.close(); }
}

async function assertFullSnapshotsReplaceCachedHistory({ renderSidebar, createState }) {
	const state = createState();
	const h = await harness(renderSidebar, state);
	try {
		await h.refresh();
		state.turns = [{ ...state.turns[0], id: "restart-answer", reply: "The restarted worker has fresh history.", pageActions: [] }];
		h.setResponse(() => full(state, "worker-restarted-b"));
		await h.refresh();
		assert.equal(h.requests.at(-1).knownHistoryRevision, "history-a");
		assert.match(h.text(), /restarted worker has fresh history/);
		assert.doesNotMatch(h.text(), /Monte Carlo uses samples/);
		h.setResponse(() => unchanged(state, "worker-restarted-b"));
		await h.refresh();
		assert.equal(h.requests.at(-1).knownHistoryRevision, "worker-restarted-b", "a worker restart must replace the old revision token");
		state.turns[0].reply = "A legacy full response remains supported.";
		h.setResponse(() => full(state));
		await h.refresh();
		assert.match(h.text(), /legacy full response remains supported/);
		await h.refresh();
		assert.equal(h.requests.at(-1).knownHistoryRevision, undefined, "a response without a revision must clear an earlier revision token");
	} finally { h.dom.window.close(); }
}

async function assertInvalidDeltaRecoversOnce({ renderSidebar, createState }) {
	for (const mode of ["missing-base", "wrong-revision", "wrong-session"]) {
		const state = createState();
		const h = await harness(renderSidebar, state);
		try {
			if (mode !== "missing-base") await h.refresh();
			const recovered = createState();
			if (mode === "wrong-session") recovered.currentSession = { sessionId: "new-history-session", sessionName: "New history session" };
			recovered.turns = [{ ...recovered.turns[0], reply: "Recovered full history is displayed.", pageActions: [] }];
			const start = h.requests.length;
			let attempts = 0;
			h.setResponse(() => ++attempts === 1
				? unchanged(recovered, mode === "wrong-revision" ? "different-revision" : "history-a")
				: full(recovered, "history-recovered"));
			await h.refresh();
			assert.equal(h.requests.length - start, 2, `${mode}: recover with exactly one full retry`);
			assert.equal(h.requests.at(-1).knownHistoryRevision, undefined, `${mode}: recovery must not send an unusable history token`);
			assert.match(h.text(), /Recovered full history is displayed/);
			assert.doesNotMatch(h.text(), /Monte Carlo uses samples/, `${mode}: never substitute an unrelated previous history`);
			assert.equal(h.sessionName(), recovered.currentSession.sessionName);
			h.setResponse(() => unchanged(recovered, "history-recovered"));
			await h.refresh();
			assert.equal(h.requests.at(-1).knownHistoryRevision, "history-recovered");
		} finally { h.dom.window.close(); }
	}
}

async function assertRepeatedMalformedDeltaAndErrorsClearCache({ renderSidebar, createState }) {
	for (const failure of ["repeated-delta", "error", "rejection"]) {
		const state = createState();
		const h = await harness(renderSidebar, state);
		try {
			await h.refresh();
			const start = h.requests.length;
			h.setResponse(() => {
				if (failure === "repeated-delta") return unchanged(state, "unknown-history");
				if (failure === "rejection") throw new Error("Background connection closed");
				return { ok: false, error: "Background refresh failed" };
			});
			await h.refresh();
			assert.equal(h.requests.length - start, failure === "repeated-delta" ? 2 : 1, `${failure}: retrying must remain bounded`);
			assert.equal(h.sessionName(), "Onhand unavailable", `${failure}: show a recoverable error instead of stale history`);
			assert.doesNotMatch(h.text(), /Monte Carlo uses samples/);
			h.setResponse(() => full(state, "after-error"));
			await h.refresh();
			assert.equal(h.requests.at(-1).knownHistoryRevision, undefined, `${failure}: a later refresh must request a new full base`);
			assert.match(h.text(), /Monte Carlo uses samples/);
		} finally { h.dom.window.close(); }
	}
}

async function assertStaleResponsesCannotPoisonHistory({ renderSidebar, createState }) {
	for (const staleKind of ["full", "invalid-delta", "error", "rejection"]) {
		const state = createState();
		const h = await harness(renderSidebar, state);
		try {
			await h.refresh();
			const queue = [];
			h.setResponse(() => new Promise((resolve, reject) => queue.push({ resolve, reject })));
			const olderRequest = h.dom.window.__onhandSidebarTestHooks.requestState();
			const newerRequest = h.dom.window.__onhandSidebarTestHooks.requestState();
			await tick();
			assert.equal(queue.length, 2);
			assert.deepEqual(h.requests.slice(-2).map((request) => request.knownHistoryRevision), ["history-a", "history-a"]);
			const newer = createState();
			newer.currentSession = { sessionId: "latest-session", sessionName: "Latest session" };
			newer.turns = [{ ...newer.turns[0], reply: "Only the latest history belongs here.", pageActions: [] }];
			queue[1].resolve(full(newer, "latest-revision"));
			await newerRequest;
			if (staleKind === "rejection") queue[0].reject(new Error("Old worker disconnected"));
			else queue[0].resolve(staleKind === "full" ? full(state, "stale-revision")
				: staleKind === "invalid-delta" ? unchanged(state, "stale-revision")
				: { ok: false, error: "Old fetch failed" });
			await olderRequest;
			assert.equal(queue.length, 2, `${staleKind}: discarded responses must not initiate recovery requests`);
			assert.equal(h.sessionName(), "Latest session");
			h.setResponse(() => unchanged(newer, "latest-revision"));
			await h.refresh();
			assert.equal(h.requests.at(-1).knownHistoryRevision, "latest-revision", `${staleKind}: only an accepted response may update or clear the cache`);
			assert.match(h.text(), /Only the latest history belongs here/);
		} finally { h.dom.window.close(); }
	}
}

async function assertExplicitSessionTransitionRequestsFullHistory({ renderSidebar, createState }) {
	const state = createState();
	const h = await harness(renderSidebar, state, { sessions: [
		{ id: state.currentSession.sessionId, path: state.currentSession.sessionId, name: state.currentSession.sessionName },
		{ id: "saved-other", path: "saved-other", name: "Saved other session" },
	] });
	try {
		await h.refresh();
		let start = h.requests.length;
		h.setOtherResponse((message) => {
			if (message.type !== "sidebar:switch-session") return undefined;
			state.currentSession = { sessionId: "saved-other", sessionName: "Saved other session" };
			state.turns = [{ ...state.turns[0], reply: "The selected saved session's answer.", pageActions: [] }];
			return { ok: true, currentSession: state.currentSession };
		});
		h.setResponse(() => full(state, "saved-other-history"));
		const select = h.shadow.getElementById("sessionSelect");
		select.value = "saved-other";
		select.dispatchEvent(new h.dom.window.Event("change", { bubbles: true }));
		await tick();
		await tick();
		assert.equal(h.requests.length - start, 1);
		assert.equal(h.requests.at(-1).knownHistoryRevision, undefined, "selecting another saved session must request full history");
		assert.equal(h.sessionName(), "Saved other session");
		assert.match(h.text(), /selected saved session's answer/);
		h.setResponse(() => unchanged(state, "saved-other-history"));
		await h.refresh();
		assert.equal(h.requests.at(-1).knownHistoryRevision, "saved-other-history");
		start = h.requests.length;
		h.setResponse(() => full(state, "new-session-history"));
		h.shadow.getElementById("newSessionButton").click();
		await tick();
		await tick();
		assert.equal(h.requests.length - start, 1);
		assert.equal(h.requests.at(-1).knownHistoryRevision, undefined, "an explicit session transition must request full history");
		assert.equal(h.sessionName(), "New session");
		assert.equal(h.shadow.querySelectorAll("#messages .onhand-entry").length, 0);
		h.setResponse(() => unchanged(state, "new-session-history"));
		await h.refresh();
		assert.equal(h.requests.at(-1).knownHistoryRevision, "new-session-history");
	} finally { h.dom.window.close(); }
}

export async function runSidebarHistoryRegressions(helpers) {
	await assertHistoryReuseKeepsMetadataFresh(helpers);
	await assertFullSnapshotsReplaceCachedHistory(helpers);
	await assertInvalidDeltaRecoversOnce(helpers);
	await assertRepeatedMalformedDeltaAndErrorsClearCache(helpers);
	await assertStaleResponsesCannotPoisonHistory(helpers);
	await assertExplicitSessionTransitionRequestsFullHistory(helpers);
}
