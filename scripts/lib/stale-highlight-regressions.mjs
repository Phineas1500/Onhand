import assert from "node:assert/strict";

// A page reload removes every Onhand highlight, but the session still lists
// them, so a follow-up question asked the page to scroll to a highlight that
// was gone ("No annotation found with id", 17 failed steps from 6 installs in
// the week of 2026-11-13). The scroll now puts the highlight and its note back
// from the session's saved text, on the page it was made on.
export async function runStaleHighlightRegressions({ installChromeStorageStub, createReplayHost, waitForRuntimeCompletion, getStoredStore }) {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime, __browserRuntimeTest: test } = await import("../../packages/browser-extension/onhand-runtime.bundle.js");

	// The tool: what the model is told, and when the page's own miss stands.
	{
		const marks = new Set(["on-page"]);
		const commands = [];
		const host = {
			async runCommand(name, args = {}) {
				commands.push({ name, args });
				if (name !== "scroll_to_annotation") return {};
				if (args.annotationId === "no-tab") throw new Error("No tab with id: 9.");
				if (!marks.has(args.annotationId)) throw new Error(`No annotation found with id: ${args.annotationId}`);
				return { tab: { id: 5 }, annotation: { annotationId: args.annotationId } };
			},
			async snapshotState() {
				return { windows: [] };
			},
			log() {},
		};
		const restoreCalls = [];
		let restore = async () => null;
		const tools = test.createToolsForTest(host, {}, (params) => params, undefined, () => {}, () => null, async () => null, () => {}, async (params) => {
			restoreCalls.push(params);
			return restore(params);
		});
		const scroll = tools.find((tool) => tool.name === "browser_scroll_to_annotation");

		const present = await scroll.execute("s1", { annotationId: "on-page" });
		assert.equal(present.content[0].text, "Scrolled to annotationId on-page.");
		assert.equal(restoreCalls.length, 0, "a highlight that is on the page is scrolled to as before");

		restore = async (params) => ({ tab: { id: 5 }, annotation: { annotationId: "new-id" }, restoredAnnotation: { previousAnnotationId: params.annotationId, annotationId: "new-id" } });
		const restored = await scroll.execute("s2", { annotationId: "gone" });
		assert.equal(restoreCalls.at(-1).annotationId, "gone", "the restore is asked for the id the model used");
		assert.equal(restored.details.annotation.annotationId, "new-id");
		assert.equal(
			restored.content[0].text,
			"Scrolled to annotationId new-id. This is the same source highlight as gone, put back after its page reloaded; cite it as new-id.",
			"the model learns the id to cite",
		);

		restore = async () => null;
		await assert.rejects(scroll.execute("s3", { annotationId: "gone" }), /No annotation found with id: gone/, "a highlight the session cannot put back keeps the page's miss");
		restore = async () => {
			throw new Error("restore broke");
		};
		await assert.rejects(scroll.execute("s4", { annotationId: "gone" }), /No annotation found with id: gone/, "a failed restore keeps the page's miss too");

		const restoreCallsBefore = restoreCalls.length;
		await assert.rejects(scroll.execute("s5", { annotationId: "no-tab" }), /No tab with id/);
		assert.equal(restoreCalls.length, restoreCallsBefore, "other failures are not treated as a missing highlight");

		// Telemetry: a highlight that could not be put back has its own name.
		const reasons = (toolName, error) => test.summarizeToolReliabilityForTest([], [], [{ toolName, state: "error", error, duration_ms: 20 }]).tool_failure_reasons;
		assert.equal(reasons("browser_scroll_to_annotation", "No annotation found with id: onhand-1731-abc"), "scroll_to_annotation:stale_mark*1");
		assert.equal(reasons("browser_scroll_to_annotation", "Annotation not found: onhand-1731-abc"), "scroll_to_annotation:stale_mark*1", "the PDF viewer's wording");
		assert.equal(reasons("browser_show_note", "No annotation found with id: onhand-1731-abc"), "show_note:stale_mark*1");
		assert.equal(reasons("browser_highlight_text", "No visible text matched: a private sentence"), "highlight_text:no_match*1", "a missed quote is still a miss");
	}

	// A whole follow-up turn. The first turn highlights a passage and adds a
	// note; the page then reloads (or not), and the follow-up scrolls to the
	// highlight the session remembers.
	const noteText = "Before I explain: what role do you think Alpha smoke content plays here?";
	const runFollowUp = async ({ afterFirstTurn }) => {
		installChromeStorageStub();
		const tab = { id: 7, windowId: 3, active: true, title: "Replay smoke page", url: "https://example.test/replay-smoke" };
		const page = { reloaded: false };
		const host = createReplayHost({ tabs: [tab], highlightAnnotationId: () => (page.reloaded ? "restored-highlight" : "smoke-highlight") });
		const runCommand = host.runCommand.bind(host);
		host.runCommand = async (name, args = {}) => {
			if (page.reloaded && name === "scroll_to_annotation" && args.annotationId === "smoke-highlight") {
				host.calls.push({ name, args });
				throw new Error("No annotation found with id: smoke-highlight");
			}
			return runCommand(name, args);
		};
		const runtime = createOnhandBrowserRuntime(host);
		await runtime.updateSettings({ aiProvider: "onhand-smoke", aiModel: "onhand-smoke-learning-1", aiApiKey: "test", authMode: "api-key", learningMode: true });
		await runtime.submitPrompt({ prompt: "Teach this page concept in Learning Mode.", displayPrompt: "learning smoke", attachments: [], learningMode: true });
		const taught = await waitForRuntimeCompletion(runtime);
		assert.equal(taught?.activeRequestId, null, "the first turn did not finish");
		assert.equal(taught.learnerState.openChecks[0].annotationId, "smoke-highlight");

		afterFirstTurn({ tab, page });
		const callsBefore = host.calls.length;
		await runtime.submitPrompt({
			prompt: "I think the Alpha smoke content plays the role of confirming extraction works.",
			displayPrompt: "I think the Alpha smoke content plays the role of confirming extraction works.",
			sessionId: taught.currentSession.sessionId,
			attachments: [],
			learningMode: true,
		});
		const answered = await waitForRuntimeCompletion(runtime);
		assert.equal(answered?.activeRequestId, null, "the follow-up turn did not finish");
		const store = getStoredStore();
		return { answered, calls: host.calls.slice(callsBefore), session: store.sessions[store.currentSessionId] };
	};
	const scrollIds = (calls) => calls.filter((call) => call.name === "scroll_to_annotation").map((call) => call.args.annotationId);
	const turnActions = (session) => session.turns.flatMap((turn) => turn.pageActions || []);

	// No reload: the highlight is there and nothing is re-created.
	{
		const { calls, answered } = await runFollowUp({ afterFirstTurn() {} });
		assert.deepEqual(scrollIds(calls), ["smoke-highlight"]);
		assert.equal(calls.some((call) => call.name === "highlight_text"), false, "a highlight that is still on the page is not made again");
		assert.equal(answered.learnerState.openChecks[0].annotationId, "smoke-highlight");
	}

	// The page reloaded: the highlight and its note come back, and the scroll lands.
	{
		const { calls, answered, session } = await runFollowUp({
			afterFirstTurn({ page }) {
				page.reloaded = true;
			},
		});
		assert.deepEqual(scrollIds(calls), ["smoke-highlight", "restored-highlight"], "the scroll is retried on the highlight that was put back");
		const highlights = calls.filter((call) => call.name === "highlight_text");
		assert.equal(highlights.length, 1, "the saved passage is highlighted once");
		assert.equal(highlights[0].args.text, "Alpha smoke content");
		assert.equal(highlights[0].args.tabId, 7);
		assert.equal(highlights[0].args.clearExisting, false, "other marks on the page are left alone");
		assert.equal(highlights[0].args.exactOnly, true, "only the saved words are accepted, not a near match");
		const notes = calls.filter((call) => call.name === "show_note");
		assert.equal(notes.length, 1, "its note is put back with it");
		assert.equal(notes[0].args.annotationId, "restored-highlight");
		assert.equal(notes[0].args.note, noteText);
		assert.ok(calls.findIndex((call) => call.name === "show_note") < calls.findLastIndex((call) => call.name === "scroll_to_annotation"), "the scroll comes after the note is back");

		const lastTurn = answered.turns.at(-1);
		assert.equal(Boolean(lastTurn.error), false, "the follow-up answers normally");
		assert.ok(String(lastTurn.reply || "").length > 0);
		assert.equal((lastTurn.activities || []).some((activity) => activity.state === "error"), false, "no step of the follow-up failed");
		assert.equal(answered.learnerState.openChecks[0].annotationId, "restored-highlight", "the open check follows the highlight to its new id");
		const highlightAction = turnActions(session).find((action) => action.key === "highlight:smoke-highlight");
		assert.equal(highlightAction.annotationId, "restored-highlight", "the session now points at the highlight that is on the page");
		assert.deepEqual(highlightAction.citationAnnotationIds, ["smoke-highlight"], "earlier answers' citations still resolve to it");
		const noteAction = turnActions(session).find((action) => action.type === "note");
		assert.equal(noteAction.annotationId, "restored-highlight");
	}

	// The tab moved to another page: the same words there are not the source
	// the earlier answer pointed at, so nothing is re-created.
	{
		const { calls, answered } = await runFollowUp({
			afterFirstTurn({ tab, page }) {
				page.reloaded = true;
				tab.url = "https://example.test/another-article";
				tab.title = "Another article";
			},
		});
		assert.deepEqual(scrollIds(calls), ["smoke-highlight"]);
		assert.equal(calls.some((call) => call.name === "highlight_text" || call.name === "show_note"), false, "no highlight is made on a different page");
		assert.equal(answered.learnerState.openChecks[0].annotationId, "smoke-highlight");
		assert.ok(String(answered.turns.at(-1).reply || "").length > 0, "the turn still answers");
	}

	console.log("A highlight lost to a page reload is put back before scrolling passed");
}
