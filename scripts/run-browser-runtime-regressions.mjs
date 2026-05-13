import assert from "node:assert/strict";
import { startFixtureServer } from "./serve-browser-runtime-fixture.mjs";

function installChromeStorageStub() {
	globalThis.chrome = {
		storage: {
			local: {
				data: {},
				async get(defaults) {
					return { ...defaults, ...this.data };
				},
				async set(values) {
					Object.assign(this.data, values);
				},
			},
		},
	};
}

function replaySmokeTab(overrides = {}) {
	return {
		id: 7,
		windowId: 3,
		active: true,
		title: "Replay smoke page",
		url: "https://example.test/replay-smoke",
		...overrides,
	};
}

function createReplayHost(options = {}) {
	const calls = [];
	const tabs = Array.isArray(options.tabs) && options.tabs.length ? [...options.tabs] : [replaySmokeTab()];
	const tabForArgs = (args = {}) => {
		if (Object.hasOwn(args, "tabId")) {
			const explicitTab = tabs.find((candidate) => candidate.id === Number(args.tabId));
			if (explicitTab) return explicitTab;
			if (options.strictTabIds) throw new Error(`No tab with id: ${args.tabId}.`);
		}
		if (typeof args.windowId === "number") {
			return tabs.find((candidate) => candidate.windowId === args.windowId && candidate.active) || tabs.find((candidate) => candidate.windowId === args.windowId) || tabs[0] || replaySmokeTab();
		}
		return tabs[0] || replaySmokeTab();
	};
	return {
		calls,
		async runCommand(name, args = {}) {
			calls.push({ name, args });
			const tab = tabForArgs(args);
			if (name === "navigate") {
				const navigatedTab = {
					id: Number(options.navigateTabId || 99),
					windowId: Number(options.navigateWindowId || tab.windowId || 3),
					active: true,
					title: options.navigateTitle || "Restored target",
					url: String(args.url || options.navigateUrl || "https://example.test/restored"),
				};
				for (const candidate of tabs) {
					if (candidate.windowId === navigatedTab.windowId) candidate.active = false;
				}
				const existingIndex = tabs.findIndex((candidate) => candidate.id === navigatedTab.id);
				if (existingIndex >= 0) tabs[existingIndex] = navigatedTab;
				else tabs.push(navigatedTab);
				return { tab: navigatedTab };
			}
			if (name === "activate_tab") return { tab };
			if (name === "clear_annotations") return { tab, cleared: true };
			if (name === "highlight_text") {
				if (options.rejectHighlightText?.(String(args.text || ""))) {
					throw new Error(`No visible text matched: ${args.text}`);
				}
				return {
					tab,
					annotation: {
						annotationId: "replay-highlight",
						matchedText: String(args.text || "Alpha smoke content"),
					},
				};
			}
			if (name === "show_note") return { tab, note: { annotationId: String(args.annotationId || "replay-highlight"), note: String(args.note || "") } };
			if (name === "get_selection") return { selection: { text: "" } };
			if (name === "get_visible_text") {
				return {
					tab,
					visible: {
						text: "Replay smoke page with Alpha smoke content available for highlighting.",
					},
				};
			}
			return { tab, ok: true };
		},
		async snapshotState() {
			calls.push({ name: "snapshot_state", args: {} });
			return {
				windows: [
				{
					id: 3,
					focused: true,
					tabs,
				},
			],
		};
		},
		log() {},
		notifyAuthProgress() {},
	};
}

async function waitForRuntimeCompletion(runtime, timeoutMs = 10000) {
	const startedAt = Date.now();
	let state = null;
	while (Date.now() - startedAt <= timeoutMs) {
		state = await runtime.getState();
		if (!state.activeRequestId) return state;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return state;
}

async function assertSelectionFormatting() {
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const { buildHighlightRetryCandidates, buildReplayAnnotationsFromPageActions, formatToolResultForModel, formatVisibleTextForModel, getSelectionText, summarizeRestoredArtifact } = __browserRuntimeTest || {};
	assert.equal(typeof buildHighlightRetryCandidates, "function", "browser runtime highlight retry export is missing");
	assert.equal(typeof buildReplayAnnotationsFromPageActions, "function", "browser runtime replay export is missing");
	assert.equal(typeof formatToolResultForModel, "function", "browser runtime test formatter export is missing");
	assert.equal(typeof formatVisibleTextForModel, "function", "browser runtime visible formatter export is missing");
	assert.equal(typeof getSelectionText, "function", "browser runtime selection formatter export is missing");
	assert.equal(typeof summarizeRestoredArtifact, "function", "browser runtime restore summary export is missing");

	const emptyCases = [
		undefined,
		null,
		"",
		{},
		{ text: "" },
		{ text: "   " },
		{ rangeCount: 0 },
		{ anchorNode: {}, focusNode: {} },
	];
	for (const selection of emptyCases) {
		assert.equal(getSelectionText(selection), "", `expected empty selection for ${JSON.stringify(selection)}`);
		const resultText = formatToolResultForModel("browser_get_selection", { selection });
		assert.equal(resultText, "No selected text.");
		assert.doesNotMatch(resultText, /\[object Object\]/);
	}

	const selectedText = formatToolResultForModel("browser_get_selection", { selection: { text: " Alpha smoke content " } });
	assert.equal(selectedText, "Selected text:\nAlpha smoke content");

	const visibleText = formatVisibleTextForModel({
		blocks: [
			{ tag: "h2", text: "You will learn" },
			{ tag: "li", text: "How to create and nest components" },
			{ tag: "li", text: "How to add markup and styles" },
		],
	});
	assert.equal(visibleText, "## You will learn\n- How to create and nest components\n- How to add markup and styles");
	assert.match(
		formatToolResultForModel("browser_extract_content", {
			tab: replaySmokeTab(),
			content: { markdown: "## You will learn\n\n- How to create and nest components" },
		}),
		/## You will learn\n\n- How to create and nest components/,
	);
	assert.deepEqual(buildHighlightRetryCandidates("## You will learn\n- How to create and nest components\n- How to add markup and styles"), [
		"How to create and nest components",
		"How to add markup and styles",
	]);

	const restored = summarizeRestoredArtifact({
		tab: { id: 42, title: "Restored tab", url: "https://example.test/page" },
		artifactId: "artifact_test",
		artifact: {
			page: { title: "Captured page", url: "https://example.test/captured" },
		},
		restoredAnnotations: 2,
		restoredNotes: 1,
		failures: [],
	});
	assert.deepEqual(restored, {
		source: "browser-artifact",
		artifactId: "artifact_test",
		tabId: 42,
		title: "Captured page",
		url: "https://example.test/captured",
		restoredCount: 2,
		restoredAnnotations: 2,
		restoredNotes: 1,
		failedCount: 0,
		failures: [],
	});

	const replayed = summarizeRestoredArtifact({
		source: "browser-replay",
		tab: { id: 7, title: "Open replay tab", url: "https://example.test/replay" },
		artifact: {
			page: { title: "Replay page", url: "https://example.test/replay" },
		},
		restoredAnnotations: 1,
		restoredNotes: 1,
		failures: [],
	});
	assert.equal(replayed.source, "browser-replay");
	assert.equal(replayed.restoredCount, 1);

	const replayAnnotations = buildReplayAnnotationsFromPageActions([
		{
			key: "highlight:ann-1",
			type: "annotation",
			tabId: 7,
			windowId: 3,
			title: "Replay page",
			url: "https://example.test/replay",
			annotationId: "ann-1",
			label: "Highlighted text",
			detail: "Alpha smoke content",
			citationText: "Alpha smoke content",
		},
		{
			key: "note:ann-1",
			type: "note",
			tabId: 7,
			windowId: 3,
			title: "Replay page",
			url: "https://example.test/replay",
			annotationId: "ann-1",
			label: "Added note",
			detail: "Important replay note",
			citationText: "Important replay note",
		},
		{
			key: "scroll:ann-1",
			type: "annotation",
			tabId: 7,
			annotationId: "ann-1",
			label: "Moved to section",
			detail: "Brought the relevant part of the page into view",
		},
	]);
	assert.deepEqual(replayAnnotations, [
		{
			key: "annotation:ann-1",
			actionKeys: ["highlight:ann-1", "note:ann-1"],
			tabId: 7,
			windowId: 3,
			title: "Replay page",
			url: "https://example.test/replay",
			annotationId: "ann-1",
			matchedText: "Alpha smoke content",
			noteText: "Important replay note",
		},
	]);
}

async function assertPublicActivitiesFilterInternalThinking() {
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const { getPublicActivities } = __browserRuntimeTest || {};
	assert.equal(typeof getPublicActivities, "function", "browser runtime activity filter export is missing");

	const activities = getPublicActivities([
		{
			id: "reasoning:test",
			kind: "reasoning",
			label: "Reasoning",
			text: "I need to think through how to perform the requested page actions.",
		},
		{
			id: "tool:dom",
			kind: "tool",
			label: "Reading page HTML...",
			toolName: "browser_get_dom",
			state: "complete",
		},
	]);

	assert.equal(activities.length, 1);
	assert.equal(activities[0].toolName, "browser_get_dom");
	assert.doesNotMatch(JSON.stringify(activities), /I need to think|Reasoning/);
}

async function assertConstitutionPromptContract() {
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const { classifyPromptForReasoning, getPromptContractForTest } = __browserRuntimeTest || {};
	assert.equal(typeof getPromptContractForTest, "function", "browser runtime prompt contract export is missing");
	assert.equal(typeof classifyPromptForReasoning, "function", "browser runtime reasoning classifier export is missing");

	const contract = getPromptContractForTest();
	assert.match(contract.systemPrompt, /The page is the canvas/);
	assert.match(contract.systemPrompt, /Every material claim is anchored/);
	assert.match(contract.systemPrompt, /Do the page work before the chat answer/);
	assert.match(contract.systemPrompt, /focused pass/);
	assert.match(contract.systemPrompt, /The user's pages come first/);
	assert.match(contract.systemPrompt, /Do not add notes that merely paraphrase the highlight/);
	assert.match(contract.systemPrompt, /Only successful highlight\/note tool results count as anchors/);
	assert.match(contract.systemPrompt, /Chat should be a brief guide to what the annotations show/);
	assert.match(contract.systemPrompt, /Roadmap\/list\/navigation questions are not simple/);
	assert.match(contract.systemPrompt, /every named step or item in chat must be anchored/);
	assert.match(contract.systemPrompt, /Do not rely on a heading-only highlight/);
	assert.match(contract.systemPrompt, /do not send a heading-plus-list block as one highlight/);
	assert.match(contract.systemPrompt, /Do not replace missing list items with nearby headings/);
	assert.match(contract.answerPrompt, /Page-material claims need anchors/);
	assert.match(contract.answerPrompt, /Do page work before chat/);
	assert.match(contract.answerPrompt, /Grounding budget: simple questions get one strong highlight/);
	assert.match(contract.answerPrompt, /Notes are not mini-summaries/);
	assert.match(contract.answerPrompt, /Failed highlight attempts are not anchors/);
	assert.match(contract.answerPrompt, /Source-thorough path: if the question has distinct subclaims/);
	assert.match(contract.answerPrompt, /Roadmap\/list\/navigation answers need the actual supporting list/);
	assert.match(contract.answerPrompt, /Every named step\/item in chat needs a matching anchor/);
	assert.match(contract.answerPrompt, /highlight the exact item words one item at a time/);
	assert.match(contract.answerPrompt, /Do not substitute nearby headings for missing list items/);
	assert.match(contract.answerPrompt, /Do not call browser_extract_content more than once/);
	assert.doesNotMatch(contract.answerPrompt, /answer now without calling a browser tool/i);
	assert.match(contract.learningModeAppend, /ask one short page-anchored question/);
	assert.match(contract.learningModeAppend, /Stay fast: the first move should be a useful page anchor/);
	assert.match(contract.learningModeAppend, /Do not solve homework-style prompts outright/);
	assert.match(contract.learningModeAppend, /Drop the Socratic stance/);
	assert.equal(classifyPromptForReasoning("what is this term?", [], true), "balanced");
	assert.equal(classifyPromptForReasoning("What are React components, and why would I split UI into components?", [], false), "balanced");
	assert.equal(classifyPromptForReasoning("compare the two derivations on this page", [], true), "deep");
}

async function assertReplayHighlightCandidateGeneration() {
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const { getReplayHighlightCandidates } = __browserRuntimeTest || {};
	assert.equal(typeof getReplayHighlightCandidates, "function", "browser runtime replay candidate export is missing");

	const promiseCandidates = getReplayHighlightCandidates(
		"The Promise object represents the eventual completion (or failure) of an asynchronous operation and its resulting value.[1]",
	);
	assert.equal(
		promiseCandidates.includes("The Promise object represents the eventual completion (or failure) of an asynchronous operation and its resulting value."),
		true,
	);
	assert.equal(promiseCandidates.some((candidate) => /\[1\]/.test(candidate)), false);

	const connectorCandidates = getReplayHighlightCandidates("that would give us better steady state proposals than P(W)?");
	assert.equal(connectorCandidates.includes("better steady state proposals than P(W)?"), true);
}

async function assertSessionBoundaryClearsActivePageAnnotations() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 7,
				windowId: 3,
				active: true,
				title: "Wrong active window",
				url: "https://example.test/wrong-window",
			}),
			replaySmokeTab({
				id: 8,
				windowId: 4,
				active: true,
				title: "Target active window",
				url: "https://example.test/target-window",
			}),
		],
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const firstSessionId = globalThis.chrome.storage.local.data.onhandBrowserRuntime.currentSessionId;

	const callCountBeforeNew = host.calls.length;
	await runtime.startNewSession({ targetWindowId: 4 });
	const newSessionCalls = host.calls.slice(callCountBeforeNew);
	assert.equal(newSessionCalls.some((call) => call.name === "clear_annotations" && call.args.tabId === 8), true);
	assert.equal(newSessionCalls.some((call) => call.name === "clear_annotations" && call.args.tabId === 7), false);

	const callCountBeforeSwitch = host.calls.length;
	await runtime.switchSession(firstSessionId, { targetWindowId: 4 });
	const switchCalls = host.calls.slice(callCountBeforeSwitch);
	assert.equal(switchCalls.some((call) => call.name === "clear_annotations" && call.args.tabId === 8), true);
	assert.equal(switchCalls.some((call) => call.name === "clear_annotations" && call.args.tabId === 7), false);
}

async function assertSessionReplayRestore() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost();
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	await runtime.submitPrompt({
		prompt: "Highlight the visible Alpha smoke content, then reply with the deterministic smoke result.",
		displayPrompt: "replay smoke",
		attachments: [],
		learningMode: false,
	});
	const completedState = await waitForRuntimeCompletion(runtime);
	assert.equal(completedState?.activeRequestId, null, "runtime did not complete before replay regression timeout");
	const store = globalThis.chrome.storage.local.data.onhandBrowserRuntime;
	const session = store.sessions[store.currentSessionId];
	assert.deepEqual(session.artifactIds, []);
	assert.equal(session.pageActions.some((action) => action.key === "highlight:replay-highlight"), true);

	const listed = await runtime.listSessions();
	assert.equal(listed.sessions.length, 1);
	assert.equal(listed.sessions[0].id, session.id);
	assert.equal(listed.sessions[0].turnCount, 1);
	assert.equal(listed.sessions[0].highlightCount, 1);
	assert.equal(listed.sessions[0].replayableCount, 1);
	assert.equal(listed.sessions[0].canRestore, true);

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	assert.equal(restored.restoredPages.length, 1);
	assert.equal(restored.restoredPages[0].source, "browser-replay");
	assert.equal(restored.restoredPages[0].restoredAnnotations, 1);
	assert.equal(restoreCalls.some((call) => call.name === "clear_annotations" && call.args.tabId === 7), true);
	assert.equal(
		restoreCalls.some((call) => call.name === "highlight_text" && call.args.tabId === 7 && call.args.text === "Alpha smoke content" && call.args.clearExisting === false),
		true,
	);
}

async function assertSessionReplayDoesNotTrustStaleTabIds() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 7,
				active: true,
				title: "Onhand Sidebar",
				url: "chrome-extension://extension-id/sidepanel.html",
			}),
			replaySmokeTab({
				id: 8,
				active: false,
				title: "Replay smoke page",
				url: "https://example.test/replay-smoke",
			}),
		],
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = globalThis.chrome.storage.local.data.onhandBrowserRuntime;
	const session = store.sessions[store.currentSessionId];
	session.pageActions = [
		{
			key: "highlight:stale-tab",
			type: "annotation",
			tabId: 7,
			title: "Replay smoke page",
			url: "https://example.test/replay-smoke",
			label: "Highlighted text",
			citationText: "Alpha smoke content",
			annotationId: "stale-tab",
		},
	];
	await globalThis.chrome.storage.local.set({ onhandBrowserRuntime: store });

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	assert.equal(restored.restoredPages.length, 1);
	assert.equal(restored.restoredPages[0].tabId, 8);
	assert.equal(restoreCalls.some((call) => call.name === "clear_annotations" && call.args.tabId === 8), true);
	assert.equal(restoreCalls.some((call) => call.name === "highlight_text" && call.args.tabId === 8), true);
	assert.equal(restoreCalls.some((call) => call.name === "clear_annotations" && call.args.tabId === 7), false);
	assert.equal(restoreCalls.some((call) => call.name === "highlight_text" && call.args.tabId === 7), false);
}

async function assertReplayRestoreRetriesEllipsisTextAndRefreshesCitationTargets() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const fullText = "But sampling from P(W) still causes too many rejections... can we improve it?";
	const prefixText = "But sampling from P(W) still causes too many rejections";
	const questionText = "that would give us better steady state proposals than P(W)?";
	const questionFallbackText = "better steady state proposals than P(W)?";
	const staleTabId = 1235284726;
	const restoredTabId = 88;
	const host = createReplayHost({
		strictTabIds: true,
		navigateTabId: restoredTabId,
		navigateTitle: "BayesianDL",
		tabs: [
			replaySmokeTab({
				id: 7,
				active: true,
				title: "Onhand Sidebar",
				url: "chrome-extension://extension-id/sidepanel.html",
			}),
		],
		rejectHighlightText: (text) => text === fullText || text === questionText,
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = globalThis.chrome.storage.local.data.onhandBrowserRuntime;
	const session = store.sessions[store.currentSessionId];
	session.name = "BayesianDL";
	const highlightAction = {
		key: "highlight:old-ann",
		type: "annotation",
		tabId: staleTabId,
		windowId: 44,
		title: "BayesianDL",
		url: "https://example.test/bayesian-dl",
		annotationId: "old-ann",
		label: "Highlighted text",
		detail: fullText,
		citationText: fullText,
	};
	const noteAction = {
		key: "note:old-ann",
		type: "note",
		tabId: staleTabId,
		windowId: 44,
		title: "BayesianDL",
		url: "https://example.test/bayesian-dl",
		annotationId: "old-ann",
		label: "Added note",
		detail: "Rejection sampling is limited by low acceptance rates.",
		citationText: "Rejection sampling is limited by low acceptance rates.",
	};
	const secondHighlightAction = {
		key: "highlight:old-ann-2",
		type: "annotation",
		tabId: staleTabId,
		windowId: 44,
		title: "BayesianDL",
		url: "https://example.test/bayesian-dl",
		annotationId: "old-ann-2",
		label: "Highlighted text",
		detail: questionText,
		citationText: questionText,
	};
	session.pageActions = [{ ...highlightAction }, { ...noteAction }, { ...secondHighlightAction }];
	session.turns = [
		{
			id: "turn-restore",
			userPrompt: "how is rejection sampling limited?",
			reply: "Rejection sampling is limited by low acceptance rates.[1]",
			activities: [],
			pageActions: [{ ...highlightAction }, { ...noteAction }, { ...secondHighlightAction }],
			pending: false,
			error: false,
			createdAt: new Date().toISOString(),
		},
	];
	await globalThis.chrome.storage.local.set({ onhandBrowserRuntime: store });

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession(session.id);
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	const highlightCalls = restoreCalls.filter((call) => call.name === "highlight_text");
	assert.equal(restored.restoredPages.length, 1);
	assert.equal(restored.restoredPages[0].tabId, restoredTabId);
	assert.equal(restored.restoredPages[0].restoredAnnotations, 2);
	assert.equal(restored.restoredPages[0].restoredNotes, 1);
	assert.equal(restored.restoredPages[0].failedCount, 0);
	assert.equal(highlightCalls[0]?.args.text, fullText);
	assert.equal(highlightCalls.some((call) => call.args.text === prefixText), true);
	assert.equal(highlightCalls.some((call) => call.args.text === questionFallbackText), true);
	assert.equal(restoreCalls.some((call) => call.name === "activate_tab" && call.args.tabId === staleTabId), false);

	const savedSession = globalThis.chrome.storage.local.data.onhandBrowserRuntime.sessions[session.id];
	const updatedHighlight = savedSession.turns[0].pageActions.find((action) => action.key === "highlight:old-ann");
	const updatedNote = savedSession.turns[0].pageActions.find((action) => action.key === "note:old-ann");
	assert.equal(updatedHighlight.tabId, restoredTabId);
	assert.equal(updatedHighlight.annotationId, "replay-highlight");
	assert.equal(updatedNote.tabId, restoredTabId);
	assert.equal(updatedNote.annotationId, "replay-highlight");

	const callCountBeforeActivate = host.calls.length;
	await runtime.activateAction("highlight:old-ann");
	const activateCalls = host.calls.slice(callCountBeforeActivate);
	assert.equal(activateCalls.some((call) => call.name === "activate_tab" && call.args.tabId === staleTabId), false);
	assert.equal(activateCalls.some((call) => call.name === "activate_tab" && call.args.tabId === restoredTabId), true);
	assert.equal(
		activateCalls.some((call) => call.name === "scroll_to_annotation" && call.args.tabId === restoredTabId && call.args.annotationId === "replay-highlight"),
		true,
	);
}

async function assertEmptyArtifactRestoreDoesNotRunPageTools() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 7,
				title: "Onhand Sidebar",
				url: "chrome-extension://extension-id/sidepanel.html",
			}),
		],
		navigateTabId: 9,
		navigateTitle: "Fixture restored",
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = globalThis.chrome.storage.local.data.onhandBrowserRuntime;
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = ["artifact_empty_restore"];
	await globalThis.chrome.storage.local.set({
		onhandBrowserRuntime: store,
		onhandBrowserArtifacts: {
			artifact_empty_restore: {
				id: "artifact_empty_restore",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "empty restore",
				tab: {
					id: 101,
					windowId: 3,
					title: "Fixture restored",
					url: "http://127.0.0.1:8765/",
				},
				page: {
					title: "Fixture restored",
					url: "http://127.0.0.1:8765/",
					scrollX: 0,
					scrollY: 320,
					annotations: [],
				},
			},
		},
	});

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	assert.equal(restored.restoredPages.length, 1);
	assert.equal(restored.restoredPages[0].restoredAnnotations, 0);
	assert.equal(restoreCalls.some((call) => call.name === "navigate"), true);
	assert.equal(restoreCalls.some((call) => ["clear_annotations", "highlight_text", "show_note", "run_js"].includes(call.name)), false);
}

async function assertSidePanelPromptTargetsOriginWindow() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 7,
				windowId: 3,
				active: true,
				title: "Stale fixture tab",
				url: "http://127.0.0.1:8765/",
			}),
			replaySmokeTab({
				id: 8,
				windowId: 4,
				active: true,
				title: "Personal computer - Wikipedia",
				url: "https://en.wikipedia.org/wiki/Personal_computer",
			}),
		],
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-ports-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	await runtime.submitPrompt({
		prompt: "Port smoke all browser tools: exercise every browser_* port once and then reply exactly Browser runtime ports ok.",
		displayPrompt: "side panel target window smoke",
		attachments: [],
		learningMode: false,
		targetWindowId: 4,
	});
	const completedState = await waitForRuntimeCompletion(runtime);
	assert.equal(completedState?.activeRequestId, null, "runtime did not complete target-window regression");
	assert.equal(host.calls.some((call) => call.name === "get_visible_text" && call.args.windowId === 4), true);
	assert.equal(host.calls.some((call) => call.name === "capture_state" && call.args.windowId === 4), true);
	assert.equal(host.calls.some((call) => call.name === "highlight_text" && call.args.windowId === 4), true);
	assert.equal(host.calls.some((call) => call.name === "get_visible_text" && call.args.windowId === 3), false);
	assert.equal(host.calls.some((call) => call.name === "capture_state" && call.args.windowId === 3), false);
}

async function assertFixtureResponses() {
	const fixture = await startFixtureServer({ port: 0 });
	try {
		const pageResponse = await fetch(fixture.url, { headers: { "Cache-Control": "no-store" } });
		assert.equal(pageResponse.status, 200);
		assert.match(await pageResponse.text(), /Alpha smoke content/);

		const jsonResponse = await fetch(new URL("/fixture.json?source=regression", fixture.url), { headers: { "Cache-Control": "no-store" } });
		assert.equal(jsonResponse.status, 200);
		assert.equal(jsonResponse.headers.get("cache-control"), "no-store");
		const json = await jsonResponse.json();
		assert.equal(json.ok, true);
		assert.equal(json.label, "fixture-json");
	} finally {
		await new Promise((resolve, reject) => fixture.server.close((error) => (error ? reject(error) : resolve())));
	}
}

async function main() {
	await assertSelectionFormatting();
	await assertPublicActivitiesFilterInternalThinking();
	await assertConstitutionPromptContract();
	await assertReplayHighlightCandidateGeneration();
	await assertSessionBoundaryClearsActivePageAnnotations();
	await assertSessionReplayRestore();
	await assertSessionReplayDoesNotTrustStaleTabIds();
	await assertReplayRestoreRetriesEllipsisTextAndRefreshesCitationTargets();
	await assertEmptyArtifactRestoreDoesNotRunPageTools();
	await assertSidePanelPromptTargetsOriginWindow();
	await assertFixtureResponses();
	console.log("Browser runtime regressions: PASS");
}

main().catch((error) => {
	console.error(error?.stack || error?.message || String(error));
	process.exitCode = 1;
});
