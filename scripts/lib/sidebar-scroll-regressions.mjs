import assert from "node:assert/strict";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function harness(renderSidebar, state, options = {}) {
	const runtimeMessages = [];
	const dom = await renderSidebar(state, runtimeMessages, options);
	const originalSend = dom.window.chrome.runtime.sendMessage;
	dom.window.chrome.runtime.sendMessage = async (message) => {
		if (message?.type === "sidebar:fetch-state") {
			runtimeMessages.push(message);
			return { ok: true, state: structuredClone(state) };
		}
		return originalSend(message);
	};
	const shadow = dom.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot;
	const scroll = shadow.getElementById("scroll");
	const messages = shadow.getElementById("messages");
	const refresh = async () => {
		await dom.window.__onhandSidebarTestHooks.requestState();
		await tick();
	};
	await refresh();
	// JSDOM has no layout. Let rendered text determine transcript height so a
	// streaming update grows it *during* rendering, as it does in the browser.
	let scrollTop = 0;
	Object.defineProperties(scroll, {
		clientHeight: { configurable: true, get: () => 600 },
		scrollHeight: {
			configurable: true,
			get: () => messages.querySelector(".onhand-entry") ? 3200 + messages.textContent.length * 2 : 600,
		},
		scrollTop: {
			configurable: true,
			get: () => Math.min(scrollTop, Math.max(0, scroll.scrollHeight - scroll.clientHeight)),
			set: (value) => { scrollTop = Math.max(0, Math.min(Number(value), scroll.scrollHeight - scroll.clientHeight)); },
		},
	});
	const maxScroll = () => scroll.scrollHeight - scroll.clientHeight;
	const position = (top) => {
		scroll.scrollTop = top;
		scroll.dispatchEvent(new dom.window.Event("scroll"));
	};
	return { dom, shadow, scroll, messages, refresh, runtimeMessages, maxScroll, position,
		jumpButton: () => shadow.getElementById("jumpToLatestButton"),
	};
}

function startStreaming(state) {
	state.activeRequestId = state.currentTurnId = "reading-position-stream";
	state.messages = [
		{ id: "user:reading-position-stream", text: "Continue this explanation", createdAt: "2026-09-07T12:00:00.000Z" },
		{ id: "assistant:reading-position-stream", text: "An answer is arriving.", pending: true },
	];
}

async function assertUpdatesPreserveReaderPosition({ renderSidebar, createState }) {
	const state = createState();
	const h = await harness(renderSidebar, state);
	try {
		h.position(300);
		await h.refresh();
		assert.equal(h.scroll.scrollTop, 300, "an idle refresh must leave an older answer in view");
		state.turns.at(-1).reply += " A completed answer correction.";
		await h.refresh();
		assert.equal(h.scroll.scrollTop, 300, "a completed answer update must preserve the reader's position");
		startStreaming(state);
		await h.refresh();
		assert.equal(h.scroll.scrollTop, 300, "starting a response must not drag a reader away from older answers");
		for (let i = 0; i < 3; i++) {
			state.messages[1].text += ` More streamed explanation ${i}.`;
			await h.refresh();
			assert.equal(h.scroll.scrollTop, 300, `streaming chunk ${i} must preserve the reader's position`);
		}
		const citation = h.messages.querySelector(".onhand-cite");
		assert.ok(citation, "fixture must contain an actionable source link");
		citation.click();
		await tick();
		await h.refresh();
		assert.equal(h.runtimeMessages.filter((message) => message.type === "sidebar:activate-action" && message.key === citation.dataset.actionKey).length, 1);
		assert.equal(h.scroll.scrollTop, 300, "following a source must not move the sidebar away from its answer");
		state.turns.push({
			id: state.currentTurnId, userPrompt: state.messages[0].text, reply: state.messages[1].text,
			activities: [], pageActions: [], pending: false, error: false,
			createdAt: "2026-09-07T12:00:00.000Z",
		});
		state.activeRequestId = state.currentTurnId = null;
		state.messages = [];
		await h.refresh();
		assert.equal(h.scroll.scrollTop, 300, "finishing a response must preserve the reader's position");
		assert.equal(h.jumpButton()?.hidden, false, "a reader above the latest answer needs a way back after completion");
	} finally { h.dom.window.close(); }
}

async function assertFollowingAndJumpControl({ renderSidebar, createState }) {
	const state = createState();
	startStreaming(state);
	const h = await harness(renderSidebar, state);
	try {
		h.position(h.maxScroll() - 80);
		const oldBottom = h.maxScroll();
		state.messages[1].text += " A substantial streaming chunk with newly rendered content.".repeat(8);
		await h.refresh();
		assert.ok(h.maxScroll() > oldBottom + 96, "fixture must grow beyond the follow threshold in one update");
		assert.equal(h.scroll.scrollTop, h.maxScroll(), "a reader near the old bottom must follow the newly rendered bottom");
		const button = h.jumpButton();
		assert.ok(button instanceof h.dom.window.HTMLButtonElement, "Jump to latest must be a keyboard-operable button");
		assert.equal(button.type, "button", "jumping must not submit the composer");
		assert.match(`${button.getAttribute("aria-label") || ""} ${button.textContent}`, /jump to latest/i);
		assert.equal(button.hidden, true, "the jump control is unnecessary at the bottom");
		h.position(400);
		assert.equal(button.hidden, false, "scrolling up must reveal the jump control without waiting for a poll");
		h.position(h.maxScroll());
		assert.equal(button.hidden, true, "scrolling to the bottom must immediately hide the jump control");
		state.messages[1].text += " Another streaming chunk.";
		await h.refresh();
		assert.equal(h.scroll.scrollTop, h.maxScroll(), "scrolling back down must resume following");
		h.position(400);
		button.focus();
		button.click();
		assert.equal(h.scroll.scrollTop, h.maxScroll(), "Jump to latest must reveal the latest answer");
		assert.equal(button.hidden, true);
		assert.equal(h.scroll.tabIndex, -1, "the reading area must accept programmatic focus without adding a tab stop");
		assert.equal(h.shadow.activeElement, h.scroll, "jumping must leave keyboard focus in the reading area rather than a hidden button");
		assert.equal(h.runtimeMessages.some((message) => message.type === "sidebar:submit-prompt"), false, "jumping must not send a prompt");
	} finally { h.dom.window.close(); }
}

async function assertExplicitPromptAndSessionReset({ renderSidebar, createState }) {
	const state = createState();
	const h = await harness(renderSidebar, state, {
		submitPromptResponse(_message, activeState) {
			startStreaming(activeState);
			return { ok: true, requestId: activeState.activeRequestId };
		},
	});
	try {
		h.position(300);
		const input = h.shadow.getElementById("input");
		input.value = "Explain the next part";
		input.dispatchEvent(new h.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		await tick();
		await tick();
		assert.equal(h.runtimeMessages.filter((message) => message.type === "sidebar:submit-prompt").length, 1);
		assert.equal(h.scroll.scrollTop, h.maxScroll(), "explicitly submitting a new question must reveal its answer");
		h.position(300);
		state.messages[1].text += " More of the newly requested answer.";
		await h.refresh();
		assert.equal(h.scroll.scrollTop, 300, "an explicit prompt must not permanently override subsequent reader scrolling");
		state.currentSession = { sessionId: "another-reading-session", sessionName: "Another reading session" };
		state.activeRequestId = state.currentTurnId = null;
		state.messages = [];
		await h.refresh();
		assert.equal(h.scroll.scrollTop, h.maxScroll(), "switching to another saved session must open its latest answer");
		h.position(300);
		h.shadow.getElementById("newSessionButton").click();
		await tick();
		await tick();
		assert.equal(h.messages.querySelector(".onhand-entry"), null, "the new session must be empty");
		assert.equal(h.scroll.scrollTop, 0, "a new empty session must not inherit a previous scroll offset");
		assert.equal(h.jumpButton()?.hidden, true, "an empty transcript must not show Jump to latest");
	} finally { h.dom.window.close(); }
}

export async function runSidebarScrollRegressions(helpers) {
	await assertUpdatesPreserveReaderPosition(helpers);
	await assertFollowingAndJumpControl(helpers);
	await assertExplicitPromptAndSessionReset(helpers);
}
