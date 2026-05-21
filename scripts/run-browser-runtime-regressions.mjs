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
			if (name === "scroll_to_annotation") {
				if (options.rejectScrollToAnnotation?.(String(args.annotationId || ""), args)) {
					throw new Error(`No annotation found: ${args.annotationId}`);
				}
				const extra =
					typeof options.scrollToAnnotationResult === "function"
						? options.scrollToAnnotationResult(args, tab)
						: options.scrollToAnnotationResult || {};
				return { tab, annotation: { annotationId: String(args.annotationId || ""), ...extra } };
			}
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
			if (name === "capture_state") {
				return {
					tab,
					page: {
						title: tab.title,
						url: tab.url,
						scrollX: 0,
						scrollY: 120,
						viewport: { width: 1200, height: 800 },
						annotations: [
							{
								annotationId: "replay-highlight",
								kind: "inline",
								matchedText: "Alpha smoke content",
								note: { text: "Replay smoke note", label: "Onhand" },
							},
						],
						annotationCount: 1,
					},
				};
			}
			if (name === "get_dom") {
				return { tab, outerHTML: "<main><h1>Replay smoke page</h1><p>Alpha smoke content</p></main>" };
			}
			if (name === "capture_screenshot") {
				return { tab, method: "debugger", dataUrl: "data:image/png;base64,UkVQTEFZ" };
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
		{
			id: "tool:learning",
			kind: "tool",
			label: "Updating learning state...",
			toolName: "onhand_record_learning_event",
			state: "complete",
		},
	]);

	assert.equal(activities.length, 1);
	assert.equal(activities[0].toolName, "browser_get_dom");
	assert.doesNotMatch(JSON.stringify(activities), /I need to think|Reasoning/);
	assert.doesNotMatch(JSON.stringify(activities), /onhand_record_learning_event/);
}

async function assertConstitutionPromptContract() {
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const { classifyPromptForReasoning, getPromptContractForTest, getToolNamesForTest } = __browserRuntimeTest || {};
	assert.equal(typeof getPromptContractForTest, "function", "browser runtime prompt contract export is missing");
	assert.equal(typeof classifyPromptForReasoning, "function", "browser runtime reasoning classifier export is missing");
	assert.equal(typeof getToolNamesForTest, "function", "browser runtime tool selector export is missing");

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
	assert.doesNotMatch(contract.answerPrompt, /Current Learning Mode state/);
	assert.match(contract.learningModeAppend, /ask one short page-anchored question/);
	assert.match(contract.learningModeAppend, /Stay fast: the first move should be a useful page anchor/);
	assert.match(contract.learningModeAppend, /onhand_record_learning_event/);
	assert.match(contract.learningModeAppend, /prefer a lightweight refresher/);
	assert.match(contract.learningModeAppend, /add at most one replacement highlight and no note/);
	assert.match(contract.learningModeAppend, /do not open or record a second check/);
	assert.match(contract.learningModeAppend, /Cross-tab interleaving is offer-first/);
	assert.match(contract.learningModeAppend, /call browser_list_tabs once only if the captured list is missing or ambiguous/);
	assert.match(contract.learningModeAppend, /Do not switch to, read, highlight, or note a related tab unless the user explicitly asks/);
	assert.match(contract.learningModeAppend, /anchor each page separately and say which tab supports which claim/);
	assert.match(contract.learningModeAppend, /Do not record an offered related tab as a learning source/);
	assert.match(contract.learningModeAppend, /Do not solve homework-style prompts outright/);
	assert.match(contract.learningModeAppend, /Drop the Socratic stance/);
	assert.match(contract.learningPrompt, /Current Learning Mode state for this session/);
	assert.match(contract.learningPrompt, /Rejection sampling \(concept_rejection_sampling\)/);
	assert.match(contract.learningPrompt, /check-rejection-1/);
	assert.match(contract.learningPrompt, /Likely repeated concepts in the user's latest message/);
	assert.match(contract.learningPrompt, /keep the turn lightweight/);
	assert.match(contract.learningPrompt, /use the existing source anchor when possible/);
	assert.match(contract.learningPrompt, /avoid re-running the full teaching flow/);
	assert.match(contract.learningPrompt, /Page-work budget for repeated concepts/);
	assert.match(contract.learningPrompt, /at most one fallback read and at most one replacement highlight/);
	assert.match(contract.learningPrompt, /do not call onhand_record_learning_event with check_opened/);
	assert.match(contract.learningPrompt, /If there is no open check for the concept/);
	assert.match(contract.learningPrompt, /reuse the existing conceptId/);
	assert.match(contract.learningPrompt, /resolve that check with onhand_record_learning_event/);
	assert.match(contract.learningPrompt, /Cross-tab interleaving is offer-first/);
	assert.match(contract.newConceptLearningPrompt, /Current Learning Mode state for this session/);
	assert.doesNotMatch(contract.newConceptLearningPrompt, /Likely repeated concepts in the user's latest message/);
	const answerToolNames = getToolNamesForTest("How does rejection sampling work?", false);
	const learningToolNames = getToolNamesForTest("How does rejection sampling work?", true);
	const answerAllToolNames = getToolNamesForTest("Port smoke all browser tools.", false);
	assert.equal(answerToolNames.includes("onhand_record_learning_event"), false);
	assert.equal(answerAllToolNames.includes("onhand_record_learning_event"), false);
	assert.equal(learningToolNames.includes("onhand_record_learning_event"), true);
	assert.equal(learningToolNames.includes("browser_list_tabs"), true);
	const repeatedLearningToolNames = getToolNamesForTest("How does rejection sampling work?", true, contract.learnerState);
	assert.equal(repeatedLearningToolNames.includes("onhand_record_learning_event"), true);
	assert.equal(repeatedLearningToolNames.includes("browser_scroll_to_annotation"), true);
	assert.equal(repeatedLearningToolNames.includes("browser_show_note"), false);
	assert.equal(repeatedLearningToolNames.includes("browser_extract_content"), false);
	assert.equal(classifyPromptForReasoning("what is this term?", [], true), "balanced");
	assert.equal(classifyPromptForReasoning("What are React components, and why would I split UI into components?", [], false), "balanced");
	assert.equal(classifyPromptForReasoning("compare the two derivations on this page", [], true), "deep");
}

async function assertLearnerStateUpdates() {
	const { createOnhandBrowserRuntime, __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const { applyLearningEvent, createEmptyLearnerState, normalizeLearnerState, setLearnerStateMode } = __browserRuntimeTest || {};
	assert.equal(typeof createEmptyLearnerState, "function", "browser runtime learner-state factory export is missing");
	assert.equal(typeof normalizeLearnerState, "function", "browser runtime learner-state normalizer export is missing");
	assert.equal(typeof applyLearningEvent, "function", "browser runtime learning-event reducer export is missing");
	assert.equal(typeof setLearnerStateMode, "function", "browser runtime learner-state mode export is missing");

	let learnerState = createEmptyLearnerState("learning");
	assert.deepEqual(learnerState, {
		mode: "learning",
		conceptsIntroduced: [],
		openChecks: [],
		responses: [],
	});

	learnerState = applyLearningEvent(
		learnerState,
		{
			kind: "concept_introduced",
			conceptLabel: "Derivative",
			annotationId: "ann-derivative",
			tabTitle: "Calculus notes",
			url: "https://example.test/calculus",
		},
		{ now: "2026-05-18T05:00:00.000Z" },
	);
	assert.equal(learnerState.conceptsIntroduced.length, 1);
	assert.equal(learnerState.conceptsIntroduced[0].conceptId, "concept_derivative");
	assert.equal(learnerState.conceptsIntroduced[0].label, "Derivative");
	assert.deepEqual(learnerState.conceptsIntroduced[0].sources, [
		{
			tabTitle: "Calculus notes",
			url: "https://example.test/calculus",
			annotationId: "ann-derivative",
		},
	]);

	learnerState = applyLearningEvent(
		learnerState,
		{
			kind: "check_opened",
			checkId: "check-derivative-1",
			checkKind: "retrieval",
			conceptLabel: "Derivative",
			promptText: "In your own words, what is this derivative measuring?",
			annotationId: "ann-derivative",
		},
		{ now: "2026-05-18T05:01:00.000Z" },
	);
	assert.equal(learnerState.conceptsIntroduced.length, 1, "opening a check should reuse the existing concept");
	assert.deepEqual(learnerState.openChecks, [
		{
			checkId: "check-derivative-1",
			kind: "retrieval",
			conceptId: "concept_derivative",
			promptText: "In your own words, what is this derivative measuring?",
			annotationId: "ann-derivative",
			askedAt: "2026-05-18T05:01:00.000Z",
		},
	]);

	learnerState = applyLearningEvent(
		learnerState,
		{
			kind: "check_opened",
			checkId: "check-derivative-2",
			checkKind: "retrieval",
			conceptLabel: "Derivative",
			promptText: "What input change is this derivative measuring?",
			annotationId: "ann-derivative",
		},
		{ now: "2026-05-18T05:01:30.000Z" },
	);
	assert.deepEqual(learnerState.openChecks, [
		{
			checkId: "check-derivative-2",
			kind: "retrieval",
			conceptId: "concept_derivative",
			promptText: "What input change is this derivative measuring?",
			annotationId: "ann-derivative",
			askedAt: "2026-05-18T05:01:30.000Z",
		},
	]);

	learnerState = applyLearningEvent(
		learnerState,
		{
			kind: "check_resolved",
			checkId: "check-derivative-2",
			assessment: "partial",
			evidence: "User connected the derivative to rate of change but missed instantaneous behavior.",
		},
		{ now: "2026-05-18T05:02:00.000Z" },
	);
	assert.equal(learnerState.openChecks.length, 0);
	assert.deepEqual(learnerState.responses, [
		{
			checkId: "check-derivative-2",
			assessment: "partial",
			resolvedAt: "2026-05-18T05:02:00.000Z",
			evidence: "User connected the derivative to rate of change but missed instantaneous behavior.",
		},
	]);

	let generatedCheckState = createEmptyLearnerState("learning");
	generatedCheckState = applyLearningEvent(
		generatedCheckState,
		{ kind: "check_opened", conceptLabel: "Limit", promptText: "What value does this approach?" },
		{ now: "2026-05-18T05:03:00.000Z" },
	);
	const firstGeneratedCheckId = generatedCheckState.openChecks[0].checkId;
	generatedCheckState = applyLearningEvent(
		generatedCheckState,
		{ kind: "check_resolved", checkId: firstGeneratedCheckId, assessment: "correct" },
		{ now: "2026-05-18T05:04:00.000Z" },
	);
	generatedCheckState = applyLearningEvent(
		generatedCheckState,
		{ kind: "check_opened", conceptLabel: "Limit", promptText: "What value does this approach?" },
		{ now: "2026-05-18T05:05:00.000Z" },
	);
	assert.notEqual(generatedCheckState.openChecks[0].checkId, firstGeneratedCheckId);

	const legacyState = normalizeLearnerState({
		mode: "learning",
		conceptsIntroduced: [{ conceptId: "concept_limit", label: "Limit", firstSeenAt: "2026-05-18T04:00:00.000Z" }],
		openPredictions: [{ predictionId: "pred-limit", conceptId: "concept_limit", promptText: "What value does this approach?" }],
		openRetrievalChecks: [{ checkId: "retrieval-limit", conceptId: "concept_limit", promptText: "Say back the epsilon-delta claim." }],
		responded: [{ itemId: "pred-old", assessment: "correct", resolvedAt: "2026-05-18T04:05:00.000Z" }],
	});
	assert.equal(legacyState.openChecks.length, 1);
	assert.equal(legacyState.openChecks[0].kind, "retrieval");
	assert.equal(legacyState.responses[0].checkId, "pred-old");
	assert.equal(setLearnerStateMode(legacyState, "answer").mode, "answer");

	installChromeStorageStub();
	const runtime = createOnhandBrowserRuntime(createReplayHost());
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
		learningMode: true,
	});
	const stateBeforeEvent = await runtime.getState();
	assert.equal(stateBeforeEvent.learnerState.mode, "learning");
	const recorded = await runtime.recordLearningEvent({
		kind: "concept_introduced",
		conceptLabel: "Monte Carlo",
		annotationId: "ann-monte-carlo",
		tabTitle: "BayesianDL",
		url: "https://example.test/bayesian-dl",
	});
	assert.equal(recorded.learnerState.conceptsIntroduced[0].label, "Monte Carlo");
	const store = globalThis.chrome.storage.local.data.onhandBrowserRuntime;
	const savedSession = store.sessions[store.currentSessionId];
	assert.equal(savedSession.learnerState.mode, "learning");
	assert.equal(savedSession.learnerState.conceptsIntroduced[0].label, "Monte Carlo");
}

async function assertLearningModeToolLoopPersistsAgentEvents() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const runtime = createOnhandBrowserRuntime(createReplayHost());
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-learning-1",
		aiApiKey: "test",
		authMode: "api-key",
		learningMode: true,
	});
	await runtime.submitPrompt({
		prompt: "Teach this page concept in Learning Mode.",
		displayPrompt: "learning smoke",
		attachments: [],
		learningMode: true,
	});
	const completedState = await waitForRuntimeCompletion(runtime);
	assert.equal(completedState?.activeRequestId, null, "runtime did not complete learning-mode tool regression");
	assert.equal(completedState.learnerState.mode, "learning");
	assert.equal(completedState.learnerState.conceptsIntroduced[0].label, "Alpha smoke content");
	assert.deepEqual(completedState.learnerState.openChecks, [
		{
			checkId: "check-alpha-smoke",
			kind: "prediction",
			conceptId: "concept_alpha_smoke_content",
			promptText: "Before I explain: what role do you think Alpha smoke content plays here?",
			annotationId: "smoke-highlight",
			askedAt: completedState.learnerState.openChecks[0].askedAt,
		},
	]);
	assert.equal(completedState.activities.some((activity) => activity.toolName === "onhand_record_learning_event"), false);
	const store = globalThis.chrome.storage.local.data.onhandBrowserRuntime;
	const session = store.sessions[store.currentSessionId];
	assert.equal(session.learnerState.conceptsIntroduced[0].label, "Alpha smoke content");
	assert.equal(session.learnerState.openChecks[0].checkId, "check-alpha-smoke");
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
	assert.equal(session.artifactIds.length, 1, "annotated turns should auto-save a review snapshot");
	assert.equal(session.pageActions.some((action) => action.key === "highlight:replay-highlight"), true);
	session.artifactIds = [];
	await globalThis.chrome.storage.local.set({ onhandBrowserRuntime: store });

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

async function assertArtifactRestoreUsesStrictReusableMatchingForShortMath() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		tabs: [replaySmokeTab({ title: "BayesianDL", url: "https://example.test/bayesian-dl" })],
		rejectHighlightText: (text) => text !== "q = qP",
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
	session.artifactIds = ["artifact_short_math_restore"];
	await globalThis.chrome.storage.local.set({
		onhandBrowserRuntime: store,
		onhandBrowserArtifacts: {
			artifact_short_math_restore: {
				id: "artifact_short_math_restore",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "short math restore",
				tab: replaySmokeTab({ title: "BayesianDL", url: "https://example.test/bayesian-dl" }),
				page: {
					title: "BayesianDL",
					url: "https://example.test/bayesian-dl",
					annotations: [
						{
							annotationId: "ann-math",
							kind: "inline",
							matchedText: "q=qP",
							note: { text: "q is stationary under one transition.", label: "Onhand" },
						},
					],
				},
			},
		},
	});

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	const highlightCalls = restoreCalls.filter((call) => call.name === "highlight_text");
	assert.equal(restored.restoredPages.length, 1);
	assert.equal(restored.restoredPages[0].restoredAnnotations, 1);
	assert.equal(restored.restoredPages[0].restoredNotes, 1);
	assert.deepEqual(highlightCalls.map((call) => call.args.text), ["q=qP", "q = qP"]);
	assert.equal(highlightCalls.at(-1)?.args.exactOnly, true);
	assert.equal(highlightCalls.at(-1)?.args.allowApproximate, false);
	assert.equal(highlightCalls.at(-1)?.args.reuseExisting, true);
	assert.equal(restoreCalls.some((call) => call.name === "show_note" && call.args.annotationId === "replay-highlight"), true);
}

async function assertRestoreSessionFallsBackToReplayWhenArtifactRestoreFails() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	let spacedMathAttempts = 0;
	const host = createReplayHost({
		tabs: [replaySmokeTab({ title: "BayesianDL", url: "https://example.test/bayesian-dl" })],
		rejectHighlightText: (text) => text === "q=qP" || (text === "q = qP" && ++spacedMathAttempts === 1),
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
	session.artifactIds = ["artifact_failed_math_restore"];
	session.pageActions = [
		{
			key: "highlight:ann-math",
			type: "annotation",
			tabId: 7,
			title: "BayesianDL",
			url: "https://example.test/bayesian-dl",
			annotationId: "ann-math",
			label: "Highlighted text",
			detail: "q = qP",
			citationText: "q = qP",
		},
		{
			key: "note:ann-math",
			type: "note",
			tabId: 7,
			title: "BayesianDL",
			url: "https://example.test/bayesian-dl",
			annotationId: "ann-math",
			label: "Added note",
			detail: "q is stationary under one transition.",
			citationText: "q is stationary under one transition.",
		},
	];
	await globalThis.chrome.storage.local.set({
		onhandBrowserRuntime: store,
		onhandBrowserArtifacts: {
			artifact_failed_math_restore: {
				id: "artifact_failed_math_restore",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "failed math restore",
				tab: replaySmokeTab({ title: "BayesianDL", url: "https://example.test/bayesian-dl" }),
				page: {
					title: "BayesianDL",
					url: "https://example.test/bayesian-dl",
					annotations: [
						{
							annotationId: "ann-math",
							kind: "inline",
							matchedText: "q=qP",
							note: { text: "q is stationary under one transition.", label: "Onhand" },
						},
					],
				},
			},
		},
	});

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	const highlightTexts = restoreCalls.filter((call) => call.name === "highlight_text").map((call) => call.args.text);
	const replayPage = restored.restoredPages.find((page) => page.source === "browser-replay");
	const artifactPage = restored.restoredPages.find((page) => page.source === "browser-artifact");
	assert.equal(restored.restoredPages.length, 2);
	assert.equal(artifactPage?.failedCount, 1);
	assert.equal(replayPage?.restoredAnnotations, 1);
	assert.equal(replayPage?.restoredNotes, 1);
	assert.deepEqual(highlightTexts, ["q=qP", "q = qP", "q = qP"]);
	assert.equal(restoreCalls.some((call) => call.name === "clear_annotations" && call.args.tabId === 7), true);
	assert.equal(restoreCalls.filter((call) => call.name === "clear_annotations" && call.args.tabId === 7).length, 1);
	assert.equal(restoreCalls.some((call) => call.name === "show_note" && call.args.note === "q is stationary under one transition."), true);
}

async function assertSessionReplaySnapshotPayload() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const runtime = createOnhandBrowserRuntime(createReplayHost());
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = globalThis.chrome.storage.local.data.onhandBrowserRuntime;
	const session = store.sessions[store.currentSessionId];
	session.name = "Snapshot replay";
	session.artifactIds = ["artifact_snapshot_replay"];
	session.turns = [
		{
			id: "turn-snapshot",
			userPrompt: "Explain the saved highlight.",
			reply: "The saved highlight is replayable.",
			activities: [],
			pageActions: [
				{
					key: "highlight:snapshot",
					type: "annotation",
					tabId: 7,
					title: "Snapshot replay page",
					url: "https://example.test/snapshot",
					annotationId: "ann-snapshot",
					label: "Highlighted text",
					detail: "Alpha smoke content",
					citationText: "Alpha smoke content",
				},
			],
			pending: false,
			error: false,
			createdAt: "2026-05-17T12:00:00.000Z",
		},
	];
	await globalThis.chrome.storage.local.set({
		onhandBrowserRuntime: store,
		onhandBrowserArtifacts: {
			artifact_snapshot_replay: {
				id: "artifact_snapshot_replay",
				createdAt: "2026-05-17T12:00:01.000Z",
				updatedAt: "2026-05-17T12:00:01.000Z",
				sessionId: session.id,
				label: "snapshot replay artifact",
				tab: replaySmokeTab({ title: "Snapshot replay page", url: "https://example.test/snapshot" }),
				page: {
					title: "Snapshot replay page",
					url: "https://example.test/snapshot",
					capturedAt: 1779048001000,
					scrollX: 0,
					scrollY: 144,
					viewport: { width: 1200, height: 800 },
					annotations: [
						{
							annotationId: "ann-snapshot",
							kind: "inline",
							matchedText: "Alpha smoke content",
							note: { text: "This is the saved note.", label: "Onhand" },
						},
					],
					annotationCount: 1,
				},
				outerHTML: "<main><h1>Snapshot replay page</h1><p>Alpha smoke content</p></main>",
				screenshotDataUrl: "data:image/png;base64,U05BUFNIT1Q=",
			},
		},
	});

	const replay = await runtime.getSessionReplay(session.id);
	assert.equal(replay.session.id, session.id);
	assert.equal(replay.selectedArtifactId, "artifact_snapshot_replay");
	assert.equal(replay.artifacts.length, 1);
	assert.equal(replay.artifacts[0].hasScreenshot, true);
	assert.equal(replay.artifacts[0].hasHtml, true);
	assert.equal(replay.artifacts[0].annotations[0].matchedText, "Alpha smoke content");
	assert.equal(replay.artifacts[0].annotations[0].noteText, "This is the saved note.");
	assert.equal("screenshotDataUrl" in replay.artifacts[0], false, "session replay summary should not include the large screenshot payload");

	const detail = await runtime.getReplayArtifact("artifact_snapshot_replay");
	assert.equal(detail.artifact.screenshotDataUrl, "data:image/png;base64,U05BUFNIT1Q=");
	assert.match(detail.artifact.outerHTML, /Snapshot replay page/);
	assert.equal(detail.artifact.annotations[0].noteLabel, "Onhand");
}

async function assertSuccessfulAnnotatedTurnAutoPersistsReviewSnapshot() {
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
		prompt: "Highlight Alpha smoke content and answer briefly.",
		displayPrompt: "auto snapshot regression",
		attachments: [],
		learningMode: false,
		targetWindowId: 3,
	});
	const completedState = await waitForRuntimeCompletion(runtime);
	assert.equal(completedState?.activeRequestId, null, "runtime did not complete auto snapshot regression");

	const store = globalThis.chrome.storage.local.data.onhandBrowserRuntime;
	const session = store.sessions[store.currentSessionId];
	assert.equal(session.artifactIds.length, 1, "expected successful annotated turn to save one review snapshot");
	assert.equal(
		host.calls.some((call) => call.name === "capture_state" && call.args.persist === true && call.args.includeHtml === true && call.args.includeScreenshot === true && call.args.windowId === 3),
		true,
	);
	assert.equal(host.calls.some((call) => call.name === "get_dom" && call.args.windowId === 3), true);
	assert.equal(host.calls.some((call) => call.name === "capture_screenshot" && call.args.windowId === 3), true);

	const artifacts = globalThis.chrome.storage.local.data.onhandBrowserArtifacts;
	const artifact = artifacts[session.artifactIds[0]];
	assert.equal(artifact.sessionId, session.id);
	assert.match(artifact.label, /^Review snapshot:/);
	assert.equal(artifact.outerHTML.includes("Replay smoke page"), true);
	assert.equal(artifact.screenshotDataUrl, "data:image/png;base64,UkVQTEFZ");

	const replay = await runtime.getSessionReplay(session.id);
	assert.equal(replay.selectedArtifactId, session.artifactIds[0]);
	assert.equal(replay.artifacts.length, 1);
	assert.equal(replay.artifacts[0].hasHtml, true);
	assert.equal(replay.artifacts[0].hasScreenshot, true);
	assert.equal(replay.session.artifactCount, 1);
}

async function assertReplayActionActivationCanTargetSavedSession() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 7,
				windowId: 3,
				active: true,
				title: "Current live page",
				url: "https://example.test/current",
			}),
			replaySmokeTab({
				id: 8,
				windowId: 4,
				active: false,
				title: "Saved replay page",
				url: "https://example.test/saved",
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
	const savedSessionId = "session_saved_replay_action";
	store.sessions[savedSessionId] = {
		id: savedSessionId,
		name: "Saved replay action",
		createdAt: "2026-05-17T12:00:00.000Z",
		updatedAt: "2026-05-17T12:00:00.000Z",
		messages: [],
		pageActions: [],
		artifactIds: [],
		learnerState: { mode: "answer", conceptsIntroduced: [], openChecks: [], responses: [] },
		turns: [
			{
				id: "turn-saved-action",
				userPrompt: "Where was this saved?",
				reply: "The saved citation points back to a non-current session.",
				activities: [],
				pageActions: [
					{
						key: "highlight:saved-session",
						type: "annotation",
						tabId: 8,
						windowId: 4,
						title: "Saved replay page",
						url: "https://example.test/saved",
						annotationId: "ann-saved-session",
						label: "Highlighted text",
						detail: "Saved replay source",
						citationText: "Saved replay source",
					},
				],
				pending: false,
				error: false,
				createdAt: "2026-05-17T12:00:00.000Z",
			},
		],
	};
	await globalThis.chrome.storage.local.set({ onhandBrowserRuntime: store });

	const callCountBeforeActivate = host.calls.length;
	await runtime.activateAction("highlight:saved-session", { sessionId: savedSessionId });
	const activateCalls = host.calls.slice(callCountBeforeActivate);
	assert.equal(activateCalls.some((call) => call.name === "activate_tab" && call.args.tabId === 8), true);
	assert.equal(
		activateCalls.some(
			(call) => call.name === "scroll_to_annotation" && call.args.tabId === 8 && call.args.annotationId === "ann-saved-session",
		),
		true,
	);
}

async function assertReplayActionActivationRepairsStaleAnnotationWithExactSource() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		rejectScrollToAnnotation: (annotationId) => annotationId === "old-ann",
		rejectHighlightText: (text) => text === "Q=QP",
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
			key: "highlight:old-ann",
			type: "annotation",
			tabId: 7,
			windowId: 3,
			title: "Replay smoke page",
			url: "https://example.test/replay-smoke",
			annotationId: "old-ann",
			label: "Highlighted text",
			detail: "Q=QP [1]",
			citationText: "Q=QP [1]",
		},
	];
	await globalThis.chrome.storage.local.set({ onhandBrowserRuntime: store });

	const callCountBeforeActivate = host.calls.length;
	const activated = await runtime.activateAction("highlight:old-ann");
	const activateCalls = host.calls.slice(callCountBeforeActivate);
	const highlightCalls = activateCalls.filter((call) => call.name === "highlight_text");
	assert.equal(highlightCalls.length, 2);
	assert.deepEqual(highlightCalls.map((call) => call.args.text), ["Q=QP", "Q = QP"]);
	assert.equal(highlightCalls[1]?.args.exactOnly, true);
	assert.equal(highlightCalls[1]?.args.allowApproximate, false);
	assert.equal(highlightCalls[1]?.args.reuseExisting, true);
	assert.equal(activated.annotationId, "replay-highlight");

	const savedAction = globalThis.chrome.storage.local.data.onhandBrowserRuntime.sessions[session.id].pageActions[0];
	assert.equal(savedAction.annotationId, "replay-highlight");
}

async function assertReplayNoteActivationUsesPairedHighlightSource() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		rejectScrollToAnnotation: (annotationId) => annotationId === "old-ann",
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
			key: "highlight:old-ann",
			type: "annotation",
			tabId: 7,
			windowId: 3,
			title: "Bayesian Deep Learning",
			url: "https://example.test/bayesian-dl",
			annotationId: "old-ann",
			label: "Highlighted text",
			detail: "Q = QP",
			citationText: "Q = QP",
		},
		{
			key: "note:old-ann",
			type: "note",
			tabId: 7,
			windowId: 3,
			title: "Bayesian Deep Learning",
			url: "https://example.test/bayesian-dl",
			annotationId: "old-ann",
			label: "Added note",
			detail: "Stationary means applying the transition keeps the distribution fixed.",
			citationText: "Stationary means applying the transition keeps the distribution fixed.",
		},
	];
	session.learnerState = {
		mode: "learning",
		conceptsIntroduced: [
			{
				conceptId: "concept_stationary",
				label: "Stationary distribution",
				firstSeenAt: "2026-05-17T12:00:00.000Z",
				lastSeenAt: "2026-05-17T12:00:00.000Z",
				sources: [
					{
						annotationId: "old-ann",
						tabTitle: "Bayesian Deep Learning",
						url: "https://example.test/bayesian-dl",
					},
				],
			},
		],
		openChecks: [
			{
				checkId: "check-stationary",
				kind: "prediction",
				conceptId: "concept_stationary",
				promptText: "What stays fixed here?",
				annotationId: "old-ann",
				askedAt: "2026-05-17T12:00:01.000Z",
			},
		],
		responses: [],
	};
	await globalThis.chrome.storage.local.set({ onhandBrowserRuntime: store });

	const callCountBeforeActivate = host.calls.length;
	await runtime.activateAction("note:old-ann");
	const activateCalls = host.calls.slice(callCountBeforeActivate);
	const highlightCalls = activateCalls.filter((call) => call.name === "highlight_text");
	const noteCalls = activateCalls.filter((call) => call.name === "show_note");
	assert.equal(highlightCalls.length, 1);
	assert.equal(highlightCalls[0]?.args.text, "Q = QP");
	assert.equal(highlightCalls[0]?.args.exactOnly, true);
	assert.equal(highlightCalls[0]?.args.reuseExisting, true);
	assert.equal(noteCalls.length, 1);
	assert.equal(noteCalls[0]?.args.annotationId, "replay-highlight");
	assert.equal(noteCalls[0]?.args.note, "Stationary means applying the transition keeps the distribution fixed.");
	assert.equal(noteCalls[0]?.args.scrollIntoView, true);

	const savedSession = globalThis.chrome.storage.local.data.onhandBrowserRuntime.sessions[session.id];
	const savedActions = savedSession.pageActions;
	assert.equal(savedActions.find((action) => action.key === "highlight:old-ann").annotationId, "replay-highlight");
	assert.equal(savedActions.find((action) => action.key === "note:old-ann").annotationId, "replay-highlight");
	assert.equal(savedSession.learnerState.conceptsIntroduced[0].sources[0].annotationId, "replay-highlight");
	assert.equal(savedSession.learnerState.openChecks[0].annotationId, "replay-highlight");
}

async function assertReplayNoteActivationDoesNotRegenerateExistingNote() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		scrollToAnnotationResult(args) {
			return args.target === "note" ? { targetKind: "note", noteRect: { top: 12, left: 20, width: 120, height: 48 } } : {};
		},
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
			key: "highlight:ann-stationary",
			type: "annotation",
			tabId: 7,
			windowId: 3,
			title: "Bayesian Deep Learning",
			url: "https://example.test/bayesian-dl",
			annotationId: "ann-stationary",
			label: "Highlighted text",
			detail: "q = qP",
			citationText: "q = qP",
		},
		{
			key: "note:ann-stationary",
			type: "note",
			tabId: 7,
			windowId: 3,
			title: "Bayesian Deep Learning",
			url: "https://example.test/bayesian-dl",
			annotationId: "ann-stationary",
			label: "Added note",
			detail: "Stationary means applying the Markov transition once leaves the distribution unchanged.",
			citationText: "Stationary means applying the Markov transition once leaves the distribution unchanged.",
		},
	];
	await globalThis.chrome.storage.local.set({ onhandBrowserRuntime: store });

	const callCountBeforeActivate = host.calls.length;
	await runtime.activateAction("note:ann-stationary");
	const activateCalls = host.calls.slice(callCountBeforeActivate);
	const highlightCalls = activateCalls.filter((call) => call.name === "highlight_text");
	const noteCalls = activateCalls.filter((call) => call.name === "show_note");
	assert.equal(highlightCalls.length, 0, "existing annotations should not be re-highlighted just to replay a note");
	assert.equal(
		activateCalls.some(
			(call) =>
				call.name === "scroll_to_annotation" &&
				call.args.annotationId === "ann-stationary" &&
				call.args.target === "note",
		),
		true,
	);
	assert.equal(noteCalls.length, 0, "existing notes should not be regenerated after the note was already focused");
}

async function assertReplayNoteActivationRegeneratesMissingNote() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		scrollToAnnotationResult(args) {
			return args.target === "note" ? { targetKind: "annotation", noteRect: null } : {};
		},
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
			key: "highlight:ann-stationary",
			type: "annotation",
			tabId: 7,
			windowId: 3,
			title: "Bayesian Deep Learning",
			url: "https://example.test/bayesian-dl",
			annotationId: "ann-stationary",
			label: "Highlighted text",
			detail: "q = qP",
			citationText: "q = qP",
		},
		{
			key: "note:ann-stationary",
			type: "note",
			tabId: 7,
			windowId: 3,
			title: "Bayesian Deep Learning",
			url: "https://example.test/bayesian-dl",
			annotationId: "ann-stationary",
			label: "Added note",
			detail: "Stationary means applying the Markov transition once leaves the distribution unchanged.",
			citationText: "Stationary means applying the Markov transition once leaves the distribution unchanged.",
		},
	];
	await globalThis.chrome.storage.local.set({ onhandBrowserRuntime: store });

	const callCountBeforeActivate = host.calls.length;
	await runtime.activateAction("note:ann-stationary");
	const activateCalls = host.calls.slice(callCountBeforeActivate);
	const highlightCalls = activateCalls.filter((call) => call.name === "highlight_text");
	const noteCalls = activateCalls.filter((call) => call.name === "show_note");
	assert.equal(highlightCalls.length, 0);
	assert.equal(noteCalls.length, 1, "missing note should be regenerated from the saved note action");
	assert.equal(noteCalls[0]?.args.annotationId, "ann-stationary");
	assert.equal(noteCalls[0]?.args.note, "Stationary means applying the Markov transition once leaves the distribution unchanged.");
	assert.equal(noteCalls[0]?.args.scrollIntoView, true);
}

async function assertReplayNoteActivationUsesRepairedPairedHighlightAnchor() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		rejectScrollToAnnotation: (annotationId) => annotationId === "old-ann",
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
			key: "highlight:old-ann",
			type: "annotation",
			tabId: 7,
			windowId: 3,
			title: "Bayesian Deep Learning",
			url: "https://example.test/bayesian-dl",
			annotationId: "current-ann",
			label: "Highlighted text",
			detail: "q = qP",
			citationText: "q = qP",
		},
		{
			key: "note:old-ann",
			type: "note",
			tabId: 7,
			windowId: 3,
			title: "Bayesian Deep Learning",
			url: "https://example.test/bayesian-dl",
			annotationId: "old-ann",
			label: "Added note",
			detail: "Stationary means applying the Markov transition once leaves the distribution unchanged.",
			citationText: "Stationary means applying the Markov transition once leaves the distribution unchanged.",
		},
	];
	await globalThis.chrome.storage.local.set({ onhandBrowserRuntime: store });

	const callCountBeforeActivate = host.calls.length;
	await runtime.activateAction("note:old-ann");
	const activateCalls = host.calls.slice(callCountBeforeActivate);
	const highlightCalls = activateCalls.filter((call) => call.name === "highlight_text");
	const scrollCalls = activateCalls.filter((call) => call.name === "scroll_to_annotation");
	const noteCalls = activateCalls.filter((call) => call.name === "show_note");
	assert.equal(highlightCalls.length, 0, "paired live highlight anchor should avoid re-highlighting note text");
	assert.equal(scrollCalls[0]?.args.annotationId, "current-ann");
	assert.equal(scrollCalls[0]?.args.target, "note");
	assert.equal(noteCalls.length, 1);
	assert.equal(noteCalls[0]?.args.annotationId, "current-ann");
	assert.equal(noteCalls[0]?.args.note, "Stationary means applying the Markov transition once leaves the distribution unchanged.");

	const savedAction = globalThis.chrome.storage.local.data.onhandBrowserRuntime.sessions[session.id].pageActions.find(
		(action) => action.key === "note:old-ann",
	);
	assert.equal(savedAction.annotationId, "current-ann");
}

async function assertReplayActionActivationDoesNotUseLooseSourceCandidates() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const unrelatedSentence = "Markov chain with transition matrix P, whose unique stationary distribution is pi.";
	const exactCitation = `Q = QP. ${unrelatedSentence}`;
	const host = createReplayHost({
		rejectScrollToAnnotation: (annotationId) => annotationId === "old-source",
		rejectHighlightText: (text) => text !== unrelatedSentence,
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
			key: "highlight:old-source",
			type: "annotation",
			tabId: 7,
			windowId: 3,
			title: "Bayesian Deep Learning",
			url: "https://example.test/bayesian-dl",
			annotationId: "old-source",
			label: "Highlighted text",
			detail: exactCitation,
			citationText: exactCitation,
		},
	];
	await globalThis.chrome.storage.local.set({ onhandBrowserRuntime: store });

	const callCountBeforeActivate = host.calls.length;
	await assert.rejects(() => runtime.activateAction("highlight:old-source"), /Source not found on this page/);
	const activateCalls = host.calls.slice(callCountBeforeActivate);
	const highlightCalls = activateCalls.filter((call) => call.name === "highlight_text");
	assert.equal(highlightCalls.length, 1);
	assert.equal(highlightCalls[0]?.args.text, exactCitation);
	assert.equal(highlightCalls[0]?.args.exactOnly, true);
	assert.equal(highlightCalls[0]?.args.allowApproximate, false);
	assert.equal(highlightCalls[0]?.args.reuseExisting, true);
	assert.equal(highlightCalls.some((call) => call.args.text === unrelatedSentence), false);

	const savedAction = globalThis.chrome.storage.local.data.onhandBrowserRuntime.sessions[session.id].pageActions[0];
	assert.equal(savedAction.annotationId, "old-source");
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
	await assertLearnerStateUpdates();
	await assertLearningModeToolLoopPersistsAgentEvents();
	await assertReplayHighlightCandidateGeneration();
	await assertSessionBoundaryClearsActivePageAnnotations();
	await assertSessionReplayRestore();
	await assertSessionReplayDoesNotTrustStaleTabIds();
	await assertReplayRestoreRetriesEllipsisTextAndRefreshesCitationTargets();
	await assertEmptyArtifactRestoreDoesNotRunPageTools();
	await assertArtifactRestoreUsesStrictReusableMatchingForShortMath();
	await assertRestoreSessionFallsBackToReplayWhenArtifactRestoreFails();
	await assertSessionReplaySnapshotPayload();
	await assertSuccessfulAnnotatedTurnAutoPersistsReviewSnapshot();
	await assertReplayActionActivationCanTargetSavedSession();
	await assertReplayActionActivationRepairsStaleAnnotationWithExactSource();
	await assertReplayNoteActivationUsesPairedHighlightSource();
	await assertReplayNoteActivationDoesNotRegenerateExistingNote();
	await assertReplayNoteActivationRegeneratesMissingNote();
	await assertReplayNoteActivationUsesRepairedPairedHighlightAnchor();
	await assertReplayActionActivationDoesNotUseLooseSourceCandidates();
	await assertSidePanelPromptTargetsOriginWindow();
	await assertFixtureResponses();
	console.log("Browser runtime regressions: PASS");
}

main().catch((error) => {
	console.error(error?.stack || error?.message || String(error));
	process.exitCode = 1;
});
