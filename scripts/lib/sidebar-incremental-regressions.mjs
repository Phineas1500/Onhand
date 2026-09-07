import assert from "node:assert/strict";

const sourceUrl = "https://example.test/incremental.pdf";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function mark(id, type = "annotation") {
	return {
		key: `${type === "note" ? "note" : "highlight"}:${id}`,
		type, annotationId: id, url: sourceUrl, title: "Incremental transcript fixture",
		label: type === "note" ? "Added note" : "Highlighted text",
		citationText: `Distinct evidence for ${id}.`,
		pdfAnchor: { pageNumber: 1, occurrence: 1, textQuote: { exact: `Distinct evidence for ${id}.` } },
	};
}

function turn(id, pageActions = [mark(id)], reply = `Claim ${id}. [[cite:${id}]]`) {
	return {
		id, userPrompt: `Question ${id}`, reply, pageActions, activities: [],
		pending: false, error: false, createdAt: "2026-09-07T12:00:00.000Z",
	};
}

async function harness(renderSidebar, state) {
	const runtimeMessages = [];
	const dom = await renderSidebar(state, runtimeMessages);
	const originalSend = dom.window.chrome.runtime.sendMessage;
	// Match Chrome's structured-clone boundary, including for session changes.
	dom.window.chrome.runtime.sendMessage = async (message) => {
		if (message?.type === "sidebar:fetch-state") {
			runtimeMessages.push(message);
			return { ok: true, state: structuredClone(state) };
		}
		return originalSend(message);
	};
	const shadow = dom.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot;
	const messages = shadow.getElementById("messages");
	const refresh = async () => {
		await dom.window.__onhandSidebarTestHooks.requestState();
		await tick();
	};
	await refresh();
	await refresh();
	return { dom, shadow, messages, runtimeMessages, refresh,
		entries: () => [...messages.querySelectorAll(".onhand-entry")],
	};
}

function chips(entry) {
	return [...entry.querySelectorAll(".onhand-cite")].map((button) => [button.textContent.trim(), button.dataset.actionKey]);
}

function setDisclosure(dom, details, open) {
	details.open = open;
	details.dispatchEvent(new dom.window.Event("toggle"));
}

async function assertStreamingPreservesCompletedEntries({ renderSidebar, createState }) {
	const state = createState();
	state.turns = Array.from({ length: 12 }, (_, i) => turn(`saved-${i}`));
	state.activeRequestId = state.currentTurnId = "streaming";
	state.pageActions = [mark("streaming")];
	state.messages = [
		{ id: "user:streaming", text: "Continue", createdAt: "2026-09-07T12:01:00.000Z" },
		{ id: "assistant:streaming", text: "Current answer. [[cite:streaming]]", pending: true },
	];
	const h = await harness(renderSidebar, state);
	try {
		const savedEntries = h.entries().slice(0, -1);
		const firstResponse = savedEntries[0].querySelector(".onhand-response");
		const sources = savedEntries[0].querySelector(".onhand-source-disclosure");
		setDisclosure(h.dom, sources, true);
		await h.refresh();
		assert.equal(h.entries()[0], savedEntries[0], "opening sources must preserve completed response DOM");
		assert.equal(sources.open, true);
		const progress = savedEntries[0].querySelector(".onhand-progress");
		setDisclosure(h.dom, progress, true);
		await h.refresh();
		assert.equal(h.entries()[0], savedEntries[0], "progress toggles must not rebuild Markdown");
		assert.ok(h.entries().every((entry) => entry.querySelector(".onhand-progress").open), "the shared progress preference must reach preserved and active entries");

		const copied = [];
		Object.defineProperty(h.dom.window.navigator, "clipboard", {
			configurable: true, value: { async writeText(text) { copied.push(text); } },
		});
		const copyButton = savedEntries[0].querySelector("[data-copy-turn-id]");
		copyButton.click();
		await tick();
		assert.deepEqual(copied, ["Claim saved-0."]);
		assert.equal(copyButton.textContent, "Copied");
		const firstCitation = savedEntries[0].querySelector(".onhand-cite");
		firstCitation.dispatchEvent(new h.dom.window.MouseEvent("pointerup", { bubbles: true, cancelable: true }));
		firstCitation.click();
		await tick();

		for (let chunk = 0; chunk < 4; chunk++) {
			state.messages[1].text += ` Streaming chunk ${chunk}.`;
			await h.refresh();
			for (let i = 0; i < savedEntries.length; i++) {
				assert.equal(h.entries()[i], savedEntries[i], `stream chunk ${chunk} must retain completed turn ${i}`);
			}
			assert.equal(h.entries()[0].querySelector(".onhand-response"), firstResponse);
			assert.equal(h.entries()[0].querySelector("[data-copy-turn-id]"), copyButton);
			assert.equal(copyButton.textContent, "Copied", "streaming must preserve local copy feedback");
			assert.equal(h.entries()[0].querySelector(".onhand-source-disclosure"), sources);
			assert.equal(sources.open, true);
			assert.match(h.entries().at(-1).textContent, new RegExp(`Streaming chunk ${chunk}`));
			assert.deepEqual(chips(h.entries().at(-1)), [["[13]", "highlight:streaming"]]);
		}
		assert.equal(h.runtimeMessages.filter((message) => message.type === "sidebar:activate-action" && message.key === "highlight:saved-0").length, 1, "preserved delegation must activate a physical click once");

		setDisclosure(h.dom, progress, false);
		await h.refresh();
		assert.ok(h.entries().every((entry) => !entry.querySelector(".onhand-progress").open));
		const finalReply = state.messages[1].text;
		state.turns.push(turn("streaming", state.pageActions, finalReply));
		state.activeRequestId = state.currentTurnId = null;
		state.messages = [];
		state.pageActions = [];
		await h.refresh();
		assert.equal(h.entries().length, 13);
		assert.equal(h.entries()[0], savedEntries[0]);
		assert.equal(h.entries().at(-1).querySelector(".onhand-cursor"), null);
		const completedCopy = h.entries().at(-1).querySelector("[data-copy-turn-id]");
		assert.ok(completedCopy, "finalizing a streaming turn must add its copy control");
		completedCopy.click();
		await tick();
		assert.equal(copied.at(-1), finalReply.replace(/\[\[cite:streaming\]\]/, "").replace(/ {2,}/g, " "));
		h.entries().at(-1).querySelector(".onhand-cite").click();
		await tick();
		assert.equal(h.runtimeMessages.filter((message) => message.type === "sidebar:activate-action" && message.key === "highlight:streaming").length, 1, "newly rendered controls must use the same action delegation");
	} finally { h.dom.window.close(); }
}

async function assertNumberingRewindsWithChangedHistory({ renderSidebar, createState }) {
	const state = createState();
	state.turns = [
		turn("first", [mark("a"), mark("b")], "B claim. [[cite:b]]\n\nA claim. [[cite:a]]"),
		turn("second", [mark("c")], "C claim. [[cite:c]]"),
		turn("third", [mark("d")], "Repeated C. [[cite:c]]\n\nD claim. [[cite:d]]"),
	];
	const h = await harness(renderSidebar, state);
	try {
		const first = h.entries()[0];
		assert.deepEqual(chips(first), [["[1]", "highlight:b"], ["[2]", "highlight:a"]], "number by first displayed use, not source order");
		assert.deepEqual(chips(h.entries()[2]), [["[3]", "highlight:c"], ["[4]", "highlight:d"]]);
		state.turns[1].pageActions.unshift(mark("e"));
		state.turns[1].reply = "E claim. [[cite:e]]\n\nC claim. [[cite:c]]";
		await h.refresh();
		assert.equal(h.entries()[0], first, "changes to a later answer must preserve the unchanged prefix");
		assert.deepEqual(chips(h.entries()[1]), [["[3]", "highlight:e"], ["[4]", "highlight:c"]]);
		assert.deepEqual(chips(h.entries()[2]), [["[4]", "highlight:c"], ["[5]", "highlight:d"]], "a changed citation count must renumber the suffix");
		state.turns[0].reply = "B claim. [[cite:b]]";
		await h.refresh();
		assert.deepEqual(chips(h.entries()[1]), [["[2]", "highlight:e"], ["[3]", "highlight:c"]]);
		assert.deepEqual(chips(h.entries()[2]), [["[3]", "highlight:c"], ["[4]", "highlight:d"]], "removed historical citations must release their numbers");
	} finally { h.dom.window.close(); }
}

async function assertHistoricalCitationSnapshots({ renderSidebar, createState }) {
	const state = createState();
	state.turns = [
		turn("original", [mark("a")], "Original claim. [[cite:a]]"),
		turn("note-added", [mark("a", "note")], "Note claim. [[cite:a]]"),
		turn("follow-up", [mark("b")], "Past claim. [[cite:a]]\n\nNew claim. [[cite:b]]"),
	];
	const h = await harness(renderSidebar, state);
	try {
		const original = h.entries()[0];
		assert.deepEqual(chips(original), [["[1]", "highlight:a"]], "a later note must not change the earlier turn's click target");
		assert.deepEqual(chips(h.entries()[1]), [["[1]", "note:a"]]);
		assert.deepEqual(chips(h.entries()[2]), [["[1]", "note:a"], ["[2]", "highlight:b"]]);
		Object.assign(state.turns[1].pageActions[0], {
			key: "note:restored-a", annotationId: "restored-a", citationAnnotationIds: ["a"],
		});
		await h.refresh();
		assert.equal(h.entries()[0], original);
		assert.deepEqual(chips(original), [["[1]", "highlight:a"]]);
		assert.deepEqual(chips(h.entries()[1]), [["[1]", "note:restored-a"]]);
		assert.deepEqual(chips(h.entries()[2]), [["[1]", "note:restored-a"], ["[2]", "highlight:b"]], "recovered historical aliases must update dependent later targets");
		state.turns[2].reply = "Recovered claim. [[cite:restored-a]]\n\nNew claim. [[cite:b]]";
		await h.refresh();
		assert.deepEqual(chips(h.entries()[2]), [["[1]", "note:restored-a"], ["[2]", "highlight:b"]]);
	} finally { h.dom.window.close(); }
}

async function assertStructuralAndSessionChanges({ renderSidebar, createState }) {
	const state = createState();
	state.turns = [turn("a"), turn("b"), turn("c")];
	const h = await harness(renderSidebar, state);
	try {
		const first = h.entries()[0];
		state.turns.push(turn("d"));
		await h.refresh();
		assert.equal(h.entries()[0], first);
		assert.deepEqual(chips(h.entries()[3]), [["[4]", "highlight:d"]]);
		state.turns.splice(1, 1);
		await h.refresh();
		assert.equal(h.entries().length, 3, "deleted turns must leave no stale nodes");
		assert.equal(h.entries()[0], first);
		assert.deepEqual(h.entries().map(chips), [[["[1]", "highlight:a"]], [["[2]", "highlight:c"]], [["[3]", "highlight:d"]]]);
		state.turns = [state.turns[2], state.turns[0], state.turns[1]];
		await h.refresh();
		assert.deepEqual(h.entries().map(chips), [[["[1]", "highlight:d"]], [["[2]", "highlight:a"]], [["[3]", "highlight:c"]]], "reordering must recompute cumulative citation order");
		const beforeSessionChange = h.entries()[0];
		const sourceDetails = beforeSessionChange.querySelector(".onhand-source-disclosure");
		setDisclosure(h.dom, sourceDetails, true);
		await h.refresh();
		state.currentSession = { sessionId: "new-incremental-session", sessionName: "New incremental session" };
		await h.refresh();
		assert.notEqual(h.entries()[0], beforeSessionChange, "identical turn IDs in another session must not reuse stale nodes");
		assert.equal(h.entries()[0].querySelector(".onhand-source-disclosure").open, false, "source disclosure state must remain scoped to its session");
		assert.match(h.entries()[0].querySelector(".onhand-source-disclosure").dataset.sourceDisclosureKey, /new-incremental-session/);
		state.turns = [];
		await h.refresh();
		assert.equal(h.entries().length, 0);
		assert.ok(h.messages.querySelector(".onhand-empty"), "clearing a session must restore its empty prompt");
		state.turns = [turn("a")];
		await h.refresh();
		assert.equal(h.messages.querySelector(".onhand-empty"), null);
		assert.deepEqual(chips(h.entries()[0]), [["[1]", "highlight:a"]], "numbering must restart after an empty transcript");
	} finally { h.dom.window.close(); }
}

async function assertMathRendererInvalidatesCachedReplies({ renderSidebar, createState }) {
	const state = createState();
	state.turns = [turn("math", [], "The result is $x^2$."), turn("later")];
	const h = await harness(renderSidebar, state);
	try {
		assert.ok(h.entries()[0].querySelector(".reply-math-fallback"));
		h.dom.window.__onhandSidebarTestHooks.setKatexModule({
			renderToString(expression) { return `<math><mi>${expression}</mi></math>`; },
		});
		await h.refresh();
		assert.equal(h.entries()[0].querySelector(".reply-math-fallback"), null, "loading KaTeX must invalidate previously cached plain math");
		assert.equal(h.entries()[0].querySelector("math mi").textContent, "x^2");
		assert.deepEqual(chips(h.entries()[1]), [["[1]", "highlight:later"]], "math refresh must preserve citation numbering");
	} finally { h.dom.window.close(); }
}

async function assertLegacyTurnIdsRemainCompatible({ renderSidebar, createState }) {
	for (const duplicateIds of [false, true]) {
		const state = createState();
		state.turns = duplicateIds
			? [turn("duplicate", [mark("a")], "Other claim. [[cite:b]]"), turn("duplicate", [mark("b")], "Other claim. [[cite:b]]")]
			: [turn("named", [mark("a")], "Original claim. [[cite:a]]"), turn("", [mark("b")], "Unresolved. [[cite:a]]\n\nOwn claim. [[cite:b]]")];
		const h = await harness(renderSidebar, state);
		try {
			if (duplicateIds) {
				assert.deepEqual(chips(h.entries()[0]), [["[1]", "highlight:b"]], "legacy duplicate IDs use their final shared citation snapshot");
				state.turns[1].pageActions.push(mark("b", "note"));
				await h.refresh();
				assert.deepEqual(chips(h.entries()[0]), [["[1]", "note:b"]], "duplicate IDs must not retain a stale prefix citation snapshot");
				state.turns[1].id = "repaired-unique-id";
				await h.refresh();
				assert.deepEqual(chips(h.entries()[0]), [], "repairing duplicate IDs must discard the earlier turn's future-source snapshot");
				assert.deepEqual(chips(h.entries()[1]), [["[1]", "note:b"]]);
			} else {
				assert.deepEqual(chips(h.entries()[1]), [["[2]", "highlight:b"]], "a legacy turn without an ID resolves only its own sources");
				state.turns[1].reply += " Another sentence.";
				await h.refresh();
				assert.deepEqual(chips(h.entries()[1]), [["[2]", "highlight:b"]]);
			}
		} finally { h.dom.window.close(); }
	}
}

export async function runSidebarIncrementalRegressions(helpers) {
	await assertStreamingPreservesCompletedEntries(helpers);
	await assertNumberingRewindsWithChangedHistory(helpers);
	await assertHistoricalCitationSnapshots(helpers);
	await assertStructuralAndSessionChanges(helpers);
	await assertMathRendererInvalidatesCachedReplies(helpers);
	await assertLegacyTurnIdsRemainCompatible(helpers);
}
