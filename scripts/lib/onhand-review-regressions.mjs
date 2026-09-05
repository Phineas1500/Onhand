import assert from "node:assert/strict";

const url = "https://example.test/review.pdf";
const quote = "The project will deliver a complete validated knowledge graph.";
function source(id, pageNumber, occurrence = 1, type = "annotation") {
	return {
		key: `${type === "note" ? "note" : "highlight"}:${id}`, type, annotationId: id,
		tabId: 7, windowId: 3, url, title: "Review PDF", label: type === "note" ? "Note" : "Highlighted text",
		citationText: type === "note" ? `Explanation for ${id}.` : quote,
		pdfAnchor: {
			surface: "pdf", viewer: "onhand-pdf-viewer", pageNumber, occurrence,
			document: { url, pdfUrl: url, title: "Review PDF" },
			matchedText: quote, textQuote: { exact: quote },
		},
	};
}
const shadowOf = (dom) => dom.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function runRuntimeReviewRegressions({ createOnhandBrowserRuntime, installChromeStorageStub, createReplayHost, replaySmokeTab, getStoredStore, storedStoreEntries }) {
	for (const mode of ["replay", "artifact", "partial-artifact"]) {
		installChromeStorageStub();
		const host = createReplayHost({
			tabs: [replaySmokeTab({ url, title: "Review PDF" })],
			highlightAnnotationId: (_text, args) => `restored-${args.pdfAnchor.pageNumber}-${args.pdfAnchor.occurrence}`,
		});
		const runtime = createOnhandBrowserRuntime(host);
		await runtime.updateSettings({ aiProvider: "onhand-smoke", aiModel: "onhand-smoke-1", aiApiKey: "test", authMode: "api-key" });
		const store = getStoredStore();
		const session = store.sessions[store.currentSessionId];
		const marks = [source("page-2", 2), source("page-9-first", 9), source("page-9-second", 9, 2)];
		session.pageActions = marks.flatMap((mark) => [mark, source(mark.annotationId, mark.pdfAnchor.pageNumber, mark.pdfAnchor.occurrence, "note")]);
		session.turns = [{ id: "saved-turn", pageActions: structuredClone(session.pageActions), reply: "Saved answer" }];
		session.artifactIds = mode === "replay" ? [] : ["review-artifact"];
		const annotations = (mode === "partial-artifact" ? marks.slice(0, 1) : marks).map((mark) => ({
			annotationId: mark.annotationId, kind: "pdf", matchedText: quote, pdfAnchor: mark.pdfAnchor,
			note: { text: `Explanation for ${mark.annotationId}.` },
		}));
		await globalThis.chrome.storage.local.set({
			...storedStoreEntries(store),
			onhandBrowserArtifacts: { "review-artifact": {
				id: "review-artifact", sessionId: session.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
				tab: replaySmokeTab({ url, title: "Review PDF" }), page: { url, title: "Review PDF", annotations },
			} },
		});
		const result = await runtime.restoreSession();
		assert.equal(result.restoredPages.reduce((sum, p) => sum + p.restoredAnnotations, 0), 3, mode);
		const saved = getStoredStore().sessions[store.currentSessionId];
		for (const actions of [saved.pageActions, saved.turns[0].pageActions]) {
			for (const action of actions) {
				assert.equal(action.annotationId, `restored-${action.pdfAnchor.pageNumber}-${action.pdfAnchor.occurrence}`, `${mode}: ${action.key} must retain its own location`);
			}
		}
		assert.equal(host.calls.filter((c) => c.name === "highlight_text").length, 3, `${mode}: restore each occurrence exactly once`);
	}
	for (const refreshViewer of [false, true]) {
		installChromeStorageStub();
		let scrolls = 0;
		const host = createReplayHost({
			tabs: [replaySmokeTab({ url, title: "Review PDF" })],
			scrollToAnnotationResult: () => ({ targetKind: "annotation", noteRect: null }),
			rejectScrollToAnnotation: () => refreshViewer && ++scrolls === 1,
			rejectPdfJumpToPage: (_args, calls) => refreshViewer && calls.filter((c) => c.name === "pdf_jump_to_page").length === 1,
		});
		const runtime = createOnhandBrowserRuntime(host);
		await runtime.updateSettings({ aiProvider: "onhand-smoke", aiModel: "onhand-smoke-1", aiApiKey: "test", authMode: "api-key" });
		const store = getStoredStore();
		store.sessions[store.currentSessionId].pageActions = [source("existing", 3), source("existing", 3, 1, "note")];
		await globalThis.chrome.storage.local.set(storedStoreEntries(store));
		await runtime.activateAction("note:existing");
		const notes = host.calls.filter((c) => c.name === "show_note");
		assert.equal(notes.length, 1, `missing note must be reconstructed, refreshViewer=${refreshViewer}`);
		assert.equal(notes[0].args.annotationId, "existing");
		assert.equal(notes[0].args.note, "Explanation for existing.");
		assert.equal(host.calls.some((c) => c.name === "highlight_text"), false, "reuse the surviving highlight");
	}
}

export async function runSidebarReviewRegressions({ renderSidebar, createState }) {
	const state = createState();
	const marks = [source("page-2", 2), source("page-9-first", 9), source("page-9-second", 9, 2)];
	state.turns = [{ ...state.turns[0], id: "repeated-passages", pageActions: marks.flatMap((mark) => [mark, source(mark.annotationId, mark.pdfAnchor.pageNumber, mark.pdfAnchor.occurrence, "note")]),
		reply: marks.map((mark) => `A separate source. [[cite:${mark.annotationId}]]`).join("\n\n") }];
	state.pageActions = state.turns[0].pageActions;
	const messages = [];
	const dom = await renderSidebar(state, messages);
	try {
		const shadow = shadowOf(dom);
		const chips = () => [...shadow.querySelectorAll(".onhand-cite")].map((el) => [el.textContent.trim(), el.dataset.actionKey]);
		assert.deepEqual(chips(), marks.map((mark, i) => [`[${i + 1}]`, `note:${mark.annotationId}`]));
		shadow.querySelectorAll(".onhand-cite")[1].click();
		await tick();
		assert.equal(messages.find((m) => m.type === "sidebar:activate-action")?.key, "note:page-9-first");
		const hooks = dom.window.__onhandSidebarTestHooks;
		// Let native <details> toggle events settle before measuring idle renders.
		await hooks.requestState();
		await tick();
		await hooks.requestState();
		const renders = hooks.getMessageRenderCount();
		for (let i = 0; i < 5; i++) await hooks.requestState();
		assert.equal(hooks.getMessageRenderCount(), renders, "unchanged refreshes must skip transcript generation");
		state.turns[0].reply += "\n\nA new paragraph.";
		await hooks.requestState();
		assert.match(shadow.querySelector("#messages").textContent, /A new paragraph/);
		assert.ok(hooks.getMessageRenderCount() > renders, "new text must invalidate cached markup");
		// Chrome messages are cloned. A fresh object with identical content must
		// still hit the cache, while a rebound citation must remain clickable.
		dom.window.chrome.runtime.sendMessage = async () => ({ ok: true, state: structuredClone(state) });
		const stableRenders = hooks.getMessageRenderCount();
		await hooks.requestState();
		assert.equal(hooks.getMessageRenderCount(), stableRenders);
		state.turns[0].pageActions[0].citationAnnotationIds = ["page-2"];
		state.turns[0].pageActions[0].annotationId = "repaired-page-2";
		await hooks.requestState();
		assert.ok(hooks.getMessageRenderCount() > stableRenders);
		assert.equal(chips()[0][0], "[1]");
	} finally { dom.window.close(); }

	for (const staleResult of ["success", "error", "rejection"]) {
		const oldState = createState();
		oldState.currentSession = { sessionId: "old-session", sessionName: "Old session" };
		const newState = structuredClone(oldState);
		newState.currentSession = { sessionId: "new-session", sessionName: "New session" };
		const dom = await renderSidebar(oldState, []);
		try {
			const queue = [];
			dom.window.chrome.runtime.sendMessage = () => new Promise((resolve, reject) => queue.push({ resolve, reject }));
			const hooks = dom.window.__onhandSidebarTestHooks;
			const oldRequest = hooks.requestState();
			const newRequest = hooks.requestState();
			await tick();
			assert.equal(queue.length, 2);
			await hooks.requestState({ poll: true });
			assert.equal(queue.length, 2, "idle polls must not stack behind outstanding requests");
			queue[1].resolve({ ok: true, state: newState });
			await newRequest;
			hooks.setRealtimeActiveVoiceTurn({ id: "new-voice-turn" });
			if (staleResult === "rejection") queue[0].reject(new Error("Old background connection closed"));
			else queue[0].resolve(staleResult === "success" ? { ok: true, state: oldState } : { ok: false, error: "Old failure" });
			await oldRequest;
			assert.equal(shadowOf(dom).querySelector("#sessionTitleInput").value, "New session", staleResult);
			assert.equal(hooks.getRealtimeDebugState().activeVoiceTurn?.id, "new-voice-turn", staleResult);
		} finally { dom.window.close(); }
	}
	// Starting a session change must invalidate a poll immediately, even before
	// the session mutation or the subsequent refresh has returned.
	const sessionState = createState();
	const sessionDom = await renderSidebar(sessionState, []);
	try {
		const hooks = sessionDom.window.__onhandSidebarTestHooks;
		const originalSend = sessionDom.window.chrome.runtime.sendMessage;
		let resolveOld, resolveNew;
		let fetches = 0;
		sessionDom.window.chrome.runtime.sendMessage = (message) => {
			if (message.type === "sidebar:fetch-state" && ++fetches === 1) return new Promise((resolve) => { resolveOld = resolve; });
			if (message.type === "sidebar:new-session") return new Promise((resolve) => { resolveNew = async () => resolve(await originalSend(message)); });
			return originalSend(message);
		};
		const oldRequest = hooks.requestState();
		await tick();
		shadowOf(sessionDom).querySelector("#newSessionButton").click();
		await tick();
		assert.equal(typeof resolveNew, "function");
		resolveOld({ ok: true, state: { ...sessionState, currentSession: { sessionId: "stale-other", sessionName: "Stale other" } } });
		await oldRequest;
		assert.notEqual(shadowOf(sessionDom).querySelector("#sessionTitleInput").value, "Stale other");
		await hooks.requestState({ poll: true });
		assert.equal(fetches, 1, "pause polls while changing sessions");
		await resolveNew();
		await tick();
		assert.equal(shadowOf(sessionDom).querySelector("#sessionTitleInput").value, "New session");
	} finally { sessionDom.window.close(); }
}
