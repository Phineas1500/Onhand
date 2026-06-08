import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const SIDEBAR_PATH = new URL("../packages/browser-extension/sidebar.js", import.meta.url);

function createState() {
	const pageUrl = "https://example.test/bayesian-dl";
	const firstEvidence = "Rejection sampling rejects too many samples from P(W).";
	const secondEvidence = "Monte Carlo uses samples to estimate an expectation.";
	const hiddenEvidence = "Bayesian posterior factors can be represented with separate latent variables.";
	const thirdEvidence = "Steady state proposals can reduce wasted rejection attempts.";
	return {
		status: "Ready",
		currentSession: {
			sessionId: "session-bayesian",
			sessionName: "BayesianDL",
		},
		preferences: {
			learningMode: false,
			realtimeVoiceEnabled: true,
			speedMode: "auto",
			extensionVersion: "test",
			runtimeRevision: "test",
		},
		turns: [
			{
				id: "turn-1",
				userPrompt: "How is rejection sampling limited?",
				reply: firstEvidence,
				activities: [],
				pageActions: [
					{
						key: "highlight:first",
						type: "annotation",
						annotationId: "ann-first",
						label: "Highlighted text",
						title: "BayesianDL",
						url: pageUrl,
						detail: firstEvidence,
						citationText: firstEvidence,
					},
					{
						key: "highlight:hidden",
						type: "annotation",
						annotationId: "ann-hidden",
						label: "Highlighted text",
						title: "BayesianDL",
						url: pageUrl,
						detail: hiddenEvidence,
						citationText: hiddenEvidence,
					},
				],
				pending: false,
				error: false,
				createdAt: "2026-05-12T10:00:00.000Z",
			},
			{
				id: "turn-2",
				userPrompt: "How does Monte Carlo improve this?",
				reply: secondEvidence,
				activities: [],
				pageActions: [
					{
						key: "highlight:second",
						type: "annotation",
						annotationId: "ann-second",
						label: "Highlighted text",
						title: "BayesianDL",
						url: pageUrl,
						detail: secondEvidence,
						citationText: secondEvidence,
					},
				],
				pending: false,
				error: false,
				createdAt: "2026-05-12T10:01:00.000Z",
			},
			{
				id: "turn-3",
				userPrompt: "Reiterate the rejection sampling point.",
				reply: `${thirdEvidence} ${secondEvidence}`,
				activities: [],
				pageActions: [
					{
						key: "highlight:second-repeat",
						type: "annotation",
						annotationId: "ann-second-repeat",
						label: "Highlighted text",
						title: "BayesianDL",
						url: pageUrl,
						detail: secondEvidence,
						citationText: secondEvidence,
					},
					{
						key: "highlight:third",
						type: "annotation",
						annotationId: "ann-third",
						label: "Highlighted text",
						title: "BayesianDL",
						url: pageUrl,
						detail: thirdEvidence,
						citationText: thirdEvidence,
					},
				],
				pending: false,
				error: false,
				createdAt: "2026-05-12T10:02:00.000Z",
			},
		],
		pageActions: [],
		activities: [],
	};
}

function createLearningState() {
	const state = createState();
	state.preferences.learningMode = true;
	state.learnerState = {
		mode: "learning",
		conceptsIntroduced: [
			{
				conceptId: "concept_rejection_sampling",
				label: "Rejection sampling",
				firstSeenAt: "2026-05-12T10:00:00.000Z",
				lastSeenAt: "2026-05-12T10:02:00.000Z",
				sources: [
					{
						tabTitle: "BayesianDL",
						url: "https://example.test/bayesian-dl",
						annotationId: "ann-first",
					},
				],
			},
			{
				conceptId: "concept_monte_carlo",
				label: "Monte Carlo estimates",
				firstSeenAt: "2026-05-12T10:01:00.000Z",
				lastSeenAt: "2026-05-12T10:01:00.000Z",
				sources: [
					{
						tabTitle: "BayesianDL",
						url: "https://example.test/bayesian-dl",
						annotationId: "ann-second",
					},
				],
			},
		],
		openChecks: [
			{
				checkId: "check-rejection-prediction",
				kind: "prediction",
				conceptId: "concept_rejection_sampling",
				promptText: "Before we explain it: what do you think gets rejected here?",
				annotationId: "ann-first",
				askedAt: "2026-05-12T10:03:00.000Z",
			},
		],
		responses: [],
	};
	return state;
}

async function renderSidebar(state, runtimeMessages, options = {}) {
	const runtimeMessageListeners = [];
	const storageValues = { ...(options.storage || {}) };
	const dom = new JSDOM("<!doctype html><html><body></body></html>", {
		pretendToBeVisual: true,
		runScripts: "outside-only",
		url: "chrome-extension://extension-id/sidepanel.html",
	});
	const { window } = dom;
	window.__onhandSidebarExposeTestHooks = true;
	window.confirm = typeof options.confirm === "function" ? options.confirm : () => true;
	let openOptionsCalls = 0;
	const createdTabs = [];
	if (options.mediaDevices) {
		Object.defineProperty(window.navigator, "mediaDevices", {
			configurable: true,
			value: options.mediaDevices,
		});
	}
	window.chrome = {
		runtime: {
			getURL(path) {
				return `chrome-extension://extension-id/${path}`;
			},
			async openOptionsPage() {
				openOptionsCalls += 1;
				if (typeof options.openOptionsPage === "function") return options.openOptionsPage();
			},
			onMessage: {
				addListener(listener) {
					runtimeMessageListeners.push(listener);
				},
			},
			async sendMessage(message) {
				runtimeMessages.push(message);
				if (message?.type === "sidebar:fetch-state") return { ok: true, state };
				if (message?.type === "sidebar:list-sessions") {
					const configuredSessions =
						typeof options.sessions === "function" ? options.sessions(state) : Array.isArray(options.sessions) ? options.sessions : null;
					return {
						ok: true,
						currentSession: { ...state.currentSession, sessionFile: state.currentSession.sessionId },
						sessions: configuredSessions || [
							{
								id: state.currentSession.sessionId,
								name: state.currentSession.sessionName,
								path: state.currentSession.sessionId,
								title: state.currentSession.sessionName,
							},
						],
					};
				}
				if (message?.type === "sidebar:new-session") {
					state.currentSession = {
						sessionId: "session-new",
						sessionName: "New session",
					};
					state.turns = [];
					state.pageActions = [];
					state.activities = [];
					return { ok: true, currentSession: state.currentSession };
				}
				if (message?.type === "sidebar:delete-session") {
					if (typeof options.deleteSessionResponse === "function") {
						return options.deleteSessionResponse(message, state);
					}
					const deletedSessionId = String(message.sessionPath || state.currentSession?.sessionId || "");
					state.currentSession = {
						sessionId: "session-after-delete",
						sessionName: "Remaining session",
					};
					state.turns = [];
					state.pageActions = [];
					state.activities = [];
					return { ok: true, deletedSessionId, currentSession: state.currentSession };
				}
				if (message?.type === "sidebar:set-learning-mode") {
					state.preferences = {
						...(state.preferences || {}),
						learningMode: Boolean(message.learningMode),
					};
					return { ok: true, settings: state.preferences };
				}
				if (message?.type === "sidebar:switch-session" && typeof options.switchSessionResponse === "function") {
					return options.switchSessionResponse(message, state);
				}
				if (message?.type === "sidebar:get-session-replay") {
					const pageActions = [
						...(Array.isArray(state.pageActions) ? state.pageActions : []),
						...(Array.isArray(state.turns) ? state.turns.flatMap((turn) => turn.pageActions || []) : []),
					];
					const replayArtifacts = options.replayArtifacts || [
						{
							artifactId: "artifact-sidebar-replay",
							title: "BayesianDL",
							url: "https://example.test/bayesian-dl",
							annotationCount: 1,
							hasScreenshot: true,
							hasHtml: true,
							annotations: [
								{
									annotationId: "ann-first",
									matchedText: "Rejection sampling rejects too many samples from P(W).",
									noteText: "Saved replay note",
									noteLabel: "Onhand",
								},
							],
						},
					];
					return {
						ok: true,
						session: {
							id: state.currentSession.sessionId,
							path: state.currentSession.sessionId,
							title: state.currentSession.sessionName,
						},
						turns: state.turns,
						pageActions,
						artifacts: replayArtifacts,
						replayableAnnotations: [
							{
								annotationId: "ann-first",
								matchedText: "Rejection sampling rejects too many samples from P(W).",
								actionKeys: ["highlight:first"],
							},
						],
						selectedArtifactId: options.selectedArtifactId || replayArtifacts.at(-1)?.artifactId || "artifact-sidebar-replay",
					};
				}
				if (message?.type === "sidebar:get-replay-artifact") {
					const replayArtifact = (options.replayArtifacts || []).find((artifact) => artifact.artifactId === message.artifactId);
					if (replayArtifact) {
						return {
							ok: true,
							artifact: {
								...replayArtifact,
								screenshotDataUrl: "data:image/png;base64,UkVQTEFZ",
								outerHTML: "<main><h1>BayesianDL</h1><p>Saved replay artifact</p></main>",
							},
						};
					}
					return {
						ok: true,
						artifact: {
							artifactId: "artifact-sidebar-replay",
							title: "BayesianDL",
							url: "https://example.test/bayesian-dl",
							annotationCount: 1,
							hasScreenshot: true,
							hasHtml: true,
							screenshotDataUrl: "data:image/png;base64,UkVQTEFZ",
							outerHTML: "<main><h1>BayesianDL</h1><p>Rejection sampling rejects too many samples from P(W).</p></main>",
							annotations: [
								{
									annotationId: "ann-first",
									matchedText: "Rejection sampling rejects too many samples from P(W).",
									noteText: "Saved replay note",
									noteLabel: "Onhand",
								},
							],
						},
					};
				}
				if (message?.type === "sidebar:restore-session") {
					return {
						ok: true,
						restoredPages: [],
						restoredCount: 0,
					};
				}
				if (message?.type === "sidebar:open-pdf-viewer") {
					if (typeof options.openPdfViewerResponse === "function") {
						return options.openPdfViewerResponse(message);
					}
					return {
						ok: true,
						result: {
							tab: {
								id: 44,
								title: "onhand-viewer.pdf - Onhand PDF Viewer",
								url: "chrome-extension://extension-id/pdf-viewer.html?url=https%3A%2F%2Fexample.test%2Fpaper.pdf",
							},
							pdfUrl: "https://example.test/paper.pdf",
							opened: true,
						},
					};
				}
				if (message?.type === "sidebar:submit-prompt") {
					if (typeof options.submitPromptResponse === "function") {
						return options.submitPromptResponse(message, state);
					}
					return { ok: true, requestId: options.submitPromptRequestId || "request-sidebar-test" };
				}
				if (message?.type === "sidebar:stop") {
					state.activeRequestId = null;
					state.currentTurnId = null;
					return { ok: true, stopped: { cancelled: false }, currentSession: state.currentSession };
				}
				if (message?.type === "sidebar:realtime-plan-pedagogical-move") {
					if (typeof options.realtimePlanResponse === "function") {
						return options.realtimePlanResponse(message, state);
					}
					return {
						ok: true,
						result: {
							move: {
								anchor: {
									text_excerpt: "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
									kind: "question_anchor",
									note: "Key evidence for this question.",
								},
								move_type: "prediction_prompt",
								voice_script: "What does this line say Alpha smoke content is checking?",
								sidebar_markdown: "**Your turn:** What does this line say Alpha smoke content is checking?",
								expected_concepts: ["Alpha smoke content"],
								stuck_fallback: "Focus on the verb after Alpha smoke content.",
								misconceptions: [],
							},
						},
					};
				}
				if (message?.type === "sidebar:realtime-evaluate-response") {
					if (typeof options.realtimeEvaluateResponse === "function") {
						return options.realtimeEvaluateResponse(message, state);
					}
					return {
						ok: true,
						result: {
							evaluation: {
								correct_points: [{ concept: "Alpha smoke content", anchor_text: "confirms readable extraction" }],
								missed_points: [],
								next_move: "move_on",
								feedback_summary: "Yes. It says the fixture confirms extraction and annotations work.",
								voice_script: "Yes. It says the fixture confirms extraction and annotations work.",
								sidebar_markdown: "Yes. It says the fixture confirms extraction and annotations work.",
								assessment: "correct",
								evidence: "The student connected Alpha smoke content to fixture validation.",
							},
						},
					};
				}
				if (message?.type === "sidebar:realtime-browser-tool") {
					if (typeof options.realtimeBrowserToolResponse === "function") {
						return options.realtimeBrowserToolResponse(message, state);
					}
					const tool = message.tool;
					const args = message.args || {};
					const tab = {
						id: state.tab?.id || 42,
						title: state.tab?.title || "Alpha smoke fixture",
						url: state.tab?.url || "http://127.0.0.1:8765/",
						windowId: 1,
					};
					if (tool === "browser_highlight_text") {
						return {
							ok: true,
							result: {
								tab,
								annotation: {
									annotationId: "ann-realtime-alpha",
									text: args.text || "",
									matchedText: args.text || "",
								},
							},
						};
					}
					if (tool === "browser_show_note") {
						return {
							ok: true,
							result: {
								tab,
								note: {
									annotationId: args.annotationId || "ann-realtime-alpha",
									note: args.note || "",
									label: args.label || "",
								},
							},
						};
					}
					if (tool === "browser_get_visible_text") {
						return { ok: true, result: { tab, visible: { text: state.page?.text || "" } } };
					}
					if (tool === "browser_extract_content") {
						return { ok: true, result: { tab, content: { text: state.page?.text || "" } } };
					}
					if (tool === "browser_open_pdf_in_onhand_viewer") {
						state.tab = {
							id: 44,
							title: "paper.pdf - Onhand PDF Viewer",
							url: "chrome-extension://extension-id/pdf-viewer.html?url=https%3A%2F%2Fexample.test%2Fpaper.pdf",
						};
						state.page = {
							surface: "pdf",
							viewer: "onhand-pdf-viewer",
							url: "https://example.test/paper.pdf",
							title: "paper.pdf - Onhand PDF Viewer",
							text: "Recurrent neural networks preserve sequence state across tokens.",
						};
						state.pageCaptureError = "";
						return {
							ok: true,
							result: {
								tab: state.tab,
								pdfUrl: "https://example.test/paper.pdf",
								opened: true,
							},
						};
					}
					if (tool === "browser_pdf_search") {
						return {
							ok: true,
							result: {
								tab,
								search: {
									query: args.query || "",
									matches: [{ pageNumber: 2, context: "Recurrent neural networks preserve sequence state across tokens." }],
								},
							},
						};
					}
					if (tool === "browser_pdf_read_pages") {
						return {
							ok: true,
							result: {
								tab,
								pages: {
									pageNumbers: [Number(args.pageNumber || args.page || 2)],
									pages: [{ pageNumber: Number(args.pageNumber || args.page || 2), text: "Recurrent neural networks preserve sequence state across tokens." }],
								},
							},
						};
					}
					if (tool === "browser_pdf_jump_to_page") {
						return { ok: true, result: { tab, jump: { pageNumber: Number(args.pageNumber || args.page || 2), matchedText: args.text || "" } } };
					}
					return { ok: true, result: { tab } };
				}
				if (message?.type === "sidebar:realtime-annotate") {
					if (typeof options.realtimeAnnotateResponse === "function") {
						return options.realtimeAnnotateResponse(message, state);
					}
					state.learnerState = state.learnerState || { mode: "learning", conceptsIntroduced: [], openChecks: [], responses: [] };
					const anchor = Array.isArray(message.anchors) ? message.anchors[0] : null;
					const check = {
						checkId: "check-realtime-alpha",
						kind: anchor?.checkKind || "prediction",
						conceptId: "concept_alpha_smoke_content",
						promptText: anchor?.checkPrompt || "What does this line say Alpha smoke content is checking?",
						annotationId: "ann-realtime-alpha",
						askedAt: "2026-05-12T10:05:00.000Z",
					};
					state.learnerState.conceptsIntroduced = [
						...(state.learnerState.conceptsIntroduced || []),
						{
							conceptId: "concept_alpha_smoke_content",
							label: anchor?.conceptLabel || "Alpha smoke content",
							firstSeenAt: "2026-05-12T10:05:00.000Z",
							lastSeenAt: "2026-05-12T10:05:00.000Z",
							sources: [{ tabTitle: state.tab?.title || "Alpha smoke fixture", url: state.tab?.url || "", annotationId: "ann-realtime-alpha" }],
						},
					];
					state.learnerState.openChecks = [...(state.learnerState.openChecks || []), check];
					return {
						ok: true,
						result: {
							annotations: [
								{
									annotationId: "ann-realtime-alpha",
									text: anchor?.text || "",
									matchedText: anchor?.text || "",
									note: anchor?.note || "",
									conceptLabel: anchor?.conceptLabel || "",
									tab: {
										id: state.tab?.id || 42,
										title: state.tab?.title || "Alpha smoke fixture",
										url: state.tab?.url || "",
										windowId: 1,
									},
								},
							],
							learnerState: state.learnerState,
						},
					};
				}
				if (message?.type === "sidebar:realtime-record-learning-event") {
					if (typeof options.realtimeRecordLearningEventResponse === "function") {
						return options.realtimeRecordLearningEventResponse(message, state);
					}
					state.learnerState = state.learnerState || { mode: "learning", conceptsIntroduced: [], openChecks: [], responses: [] };
					const event = message.event || {};
					state.learnerState.openChecks = (state.learnerState.openChecks || []).filter((check) => check.checkId !== event.checkId);
					state.learnerState.responses = [
						...(state.learnerState.responses || []).filter((response) => response.checkId !== event.checkId),
						{
							checkId: event.checkId,
							assessment: event.assessment || "partial",
							evidence: event.evidence || "",
							resolvedAt: "2026-05-12T10:06:00.000Z",
						},
					];
					return { ok: true, result: { learnerState: state.learnerState } };
				}
				if (message?.type === "sidebar:realtime-record-turn") {
					if (typeof options.realtimeRecordTurnResponse === "function") {
						return options.realtimeRecordTurnResponse(message, state);
					}
					const turn = {
						id: message.voiceTurnId || `voice-turn-${state.turns.length + 1}`,
						userPrompt: message.userPrompt || "",
						reply: message.reply || "",
						activities: [],
						pageActions: Array.isArray(message.pageActions) ? message.pageActions : [],
						pending: false,
						error: false,
						createdAt: "2026-05-12T10:07:00.000Z",
					};
					const existingIndex = state.turns.findIndex((candidate) => candidate.id === turn.id);
					if (existingIndex >= 0) {
						state.turns.splice(existingIndex, 1, turn);
					} else {
						state.turns.push(turn);
					}
					return { ok: true, result: { turn } };
				}
				if (message?.type === "sidebar:activate-action") {
					if (typeof options.activateActionResponse === "function") {
						return options.activateActionResponse(message);
					}
					return { ok: true };
				}
				if (message?.type === "sidebar:scroll-to-annotation") {
					if (typeof options.scrollToAnnotationResponse === "function") {
						return options.scrollToAnnotationResponse(message);
					}
					return { ok: true, result: { annotation: { annotationId: message.annotationId } } };
				}
				return { ok: true };
			},
		},
		tabs: {
			async create(params) {
				createdTabs.push(params);
				if (typeof options.createTab === "function") return options.createTab(params);
				return { id: createdTabs.length, ...params };
			},
		},
		storage: {
			local: {
				async get(defaults) {
					if (typeof defaults === "string") {
						return { [defaults]: storageValues[defaults] };
					}
					if (Array.isArray(defaults)) {
						return Object.fromEntries(defaults.map((key) => [key, storageValues[key]]));
					}
					return { ...defaults, ...Object.fromEntries(Object.keys(defaults || {}).map((key) => [key, storageValues[key] ?? defaults[key]])) };
				},
				async set(items) {
					Object.assign(storageValues, items || {});
				},
				async remove(keys) {
					for (const key of Array.isArray(keys) ? keys : [keys]) {
						delete storageValues[key];
					}
				},
			},
			onChanged: { addListener() {} },
		},
		windows: {
			async getCurrent() {
				return { id: 1 };
			},
		},
	};
	window.eval(await readFile(SIDEBAR_PATH, "utf8"));
	await new Promise((resolve) => window.setTimeout(resolve, 50));
	dom.dispatchRuntimeMessage = async (message) => {
		for (const listener of runtimeMessageListeners) {
			listener(message, {}, () => {});
		}
		await new Promise((resolve) => window.setTimeout(resolve, 50));
	};
	dom.getStorageValue = (key) => storageValues[key];
	dom.getOpenOptionsCalls = () => openOptionsCalls;
	dom.getCreatedTabs = () => createdTabs.map((tab) => ({ ...tab }));
	return dom;
}

async function assertSessionWideCitationNumbers() {
	const runtimeMessages = [];
	const dom = await renderSidebar(createState(), runtimeMessages);
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	assert.ok(host, "expected sidebar host to render");
	const learningLabel = host.shadowRoot.getElementById("learningModeLabel");
	assert.ok(learningLabel, "expected learning label to render");
	assert.match(learningLabel.title, /tutor from the page/);
	assert.match(learningLabel.title, /anchor prompts/);
	assert.doesNotMatch(learningLabel.title, /slows down/i);
	const entries = [...host.shadowRoot.querySelectorAll(".onhand-entry")];
	assert.equal(entries.length, 3);

	const citationButtonsByEntry = entries.map((entry) => [...entry.querySelectorAll(".onhand-cite")]);
	assert.deepEqual(
		citationButtonsByEntry.map((buttons) => buttons.map((button) => button.textContent.trim())),
		[["[1]"], ["[2]"], ["[3]", "[2]"]],
	);
	const styleText = host.shadowRoot.querySelector("style")?.textContent || "";
	assert.match(styleText, /\.onhand-cite\s*\{[^}]*min-height:\s*18px/s);
	assert.match(styleText, /\.onhand-cite\s*\{[^}]*min-width:\s*18px/s);
	assert.doesNotMatch(styleText, /\.onhand-cite\s*\{[^}]*line-height:\s*0\b/s);
	assert.match(styleText, /\.onhand-action\s*\{[^}]*min-height:\s*22px/s);
	assert.match(styleText, /\.onhand-action\s*\{[^}]*padding:\s*2px 4px/s);
	assert.equal(citationButtonsByEntry[0][0].dataset.actionKey, "highlight:first");
	assert.equal(citationButtonsByEntry[1][0].dataset.actionKey, "highlight:second");
	assert.equal(citationButtonsByEntry[2][0].dataset.actionKey, "highlight:third");
	assert.equal(citationButtonsByEntry[2][1].dataset.actionKey, "highlight:second");

	citationButtonsByEntry[0][0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:activate-action" && message.key === "highlight:first"),
		true,
	);

	dom.window.close();
}

async function assertResponseCopyButtonAndStableMarkup() {
	const runtimeMessages = [];
	const state = createState();
	const copied = [];
	const dom = await renderSidebar(state, runtimeMessages);
	Object.defineProperty(dom.window.navigator, "clipboard", {
		configurable: true,
		value: {
			async writeText(text) {
				copied.push(text);
			},
		},
	});
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const shadow = host.shadowRoot;
	const hooks = dom.window.__onhandSidebarTestHooks;
	const firstResponse = shadow.querySelector(".onhand-response");
	const copyButton = shadow.querySelector('.onhand-copy-button[data-copy-turn-id="turn-1"]');
	assert.ok(firstResponse, "expected an Onhand response to render");
	assert.ok(copyButton, "expected completed responses to expose a copy button");

	copyButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
	await waitForSidebarTick(dom);
	assert.deepEqual(copied, [state.turns[0].reply], "expected copy button to copy the raw reply text");
	assert.equal(copyButton.textContent, "Copied", "expected copy button to acknowledge the copied response");

	await hooks.requestState();
	await waitForSidebarTick(dom);
	assert.equal(shadow.querySelector(".onhand-response"), firstResponse, "expected unchanged state polls to preserve response DOM");
	assert.equal(shadow.querySelector('.onhand-copy-button[data-copy-turn-id="turn-1"]'), copyButton, "expected unchanged state polls to preserve copy button state");
	assert.equal(copyButton.textContent, "Copied", "expected no-change rerenders not to overwrite local copy feedback");

	dom.window.close();
}

async function assertTranscriptActionButtonsActivateDirectly() {
	const runtimeMessages = [];
	const state = createState();
	state.turns[0].pageActions.push({
		key: "note:first",
		type: "note",
		annotationId: "ann-first",
		label: "Added note",
		title: "BayesianDL",
		url: "https://example.test/bayesian-dl",
		detail: "Remember that rejection sampling can waste many proposed samples.",
		citationText: "Remember that rejection sampling can waste many proposed samples.",
	});
	const dom = await renderSidebar(state, runtimeMessages);
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const messages = host.shadowRoot.getElementById("messages");
	const actionButton = host.shadowRoot.querySelector('.onhand-action[data-action-key="note:first"]');
	assert.ok(actionButton, "expected added-note transcript action button");
	assert.equal(actionButton.dataset.onhandActionBound, "true");
	let legacyBubbleClickCount = 0;
	messages.addEventListener("click", () => {
		legacyBubbleClickCount += 1;
	});

	const actionPointerDown = new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true });
	actionButton.dispatchEvent(actionPointerDown);
	assert.equal(actionPointerDown.defaultPrevented, true, "expected action button pointerdown to prevent text selection");
	actionButton.dispatchEvent(new dom.window.MouseEvent("pointerup", { bubbles: true, cancelable: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:activate-action" && message.key === "note:first"),
		true,
	);

	await new Promise((resolve) => dom.window.setTimeout(resolve, 300));
	messages.innerHTML = messages.innerHTML;
	const delayedActionButton = messages.querySelector('.onhand-action[data-action-key="note:first"]');
	assert.ok(delayedActionButton, "expected added-note transcript action button after rerender");
	delayedActionButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
	assert.equal(
		runtimeMessages.filter((message) => message?.type === "sidebar:activate-action" && message.key === "note:first").length,
		1,
		"expected delayed browser click after pointerup to be deduped across transcript rerenders",
	);

	await new Promise((resolve) => dom.window.setTimeout(resolve, 950));
	const standaloneActionButton = messages.querySelector('.onhand-action[data-action-key="note:first"]');
	assert.ok(standaloneActionButton, "expected added-note transcript action button for standalone click");
	standaloneActionButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
	assert.equal(
		runtimeMessages.filter((message) => message?.type === "sidebar:activate-action" && message.key === "note:first").length,
		2,
	);

	await new Promise((resolve) => dom.window.setTimeout(resolve, 950));
	const actionButtonForMousePair = messages.querySelector('.onhand-action[data-action-key="note:first"]');
	assert.ok(actionButtonForMousePair, "expected added-note transcript action button for mouse pair");
	const actionMouseDown = new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
	actionButtonForMousePair.dispatchEvent(actionMouseDown);
	assert.equal(actionMouseDown.defaultPrevented, true, "expected action button mousedown to prevent text selection");
	actionButtonForMousePair.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true, cancelable: true }));
	actionButtonForMousePair.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
	assert.equal(
		runtimeMessages.filter((message) => message?.type === "sidebar:activate-action" && message.key === "note:first").length,
		3,
		"expected one activation from the mouseup/click pair for one physical click",
	);
	assert.equal(legacyBubbleClickCount, 0, "delegated action handling should suppress older bubble click paths");

	await new Promise((resolve) => dom.window.setTimeout(resolve, 950));
	const citationButton = messages.querySelector('.onhand-cite[data-action-key="note:first"]');
	assert.ok(citationButton, "expected citation to target the paired note action");
	const citationPointerDown = new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true });
	citationButton.dispatchEvent(citationPointerDown);
	assert.equal(citationPointerDown.defaultPrevented, true, "expected citation pointerdown to prevent text selection");
	citationButton.dispatchEvent(new dom.window.MouseEvent("pointerup", { bubbles: true, cancelable: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
	assert.equal(
		runtimeMessages.filter((message) => message?.type === "sidebar:activate-action" && message.key === "note:first").length,
		4,
	);
	await new Promise((resolve) => dom.window.setTimeout(resolve, 300));
	messages.innerHTML = messages.innerHTML;
	const delayedCitationButton = messages.querySelector('.onhand-cite[data-action-key="note:first"]');
	assert.ok(delayedCitationButton, "expected citation after rerender");
	delayedCitationButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
	assert.equal(
		runtimeMessages.filter((message) => message?.type === "sidebar:activate-action" && message.key === "note:first").length,
		4,
		"expected delayed browser click after pointerup to be deduped across citation rerenders",
	);

	dom.window.close();
}

async function assertTurnSourceButtonsExposeAllPageActions() {
	const runtimeMessages = [];
	const state = createState();
	state.turns = [
		{
			id: "turn-source-strip",
			userPrompt: "Explain the page evidence.",
			reply: "This is a grounded answer that intentionally does not repeat either saved page source.",
			activities: [],
			pageActions: [
				{
					key: "highlight:source-strip",
					type: "annotation",
					annotationId: "ann-source-strip",
					label: "Highlighted text",
					title: "BayesianDL",
					url: "https://example.test/bayesian-dl",
					detail: "Monte Carlo uses samples to estimate an expectation.",
					citationText: "Monte Carlo uses samples to estimate an expectation.",
				},
				{
					key: "note:source-strip",
					type: "note",
					annotationId: "ann-source-strip",
					label: "Added note",
					title: "BayesianDL",
					url: "https://example.test/bayesian-dl",
					detail: "Connect this note back to the Monte Carlo explanation.",
					citationText: "Connect this note back to the Monte Carlo explanation.",
				},
			],
			pending: false,
			error: false,
			createdAt: "2026-05-12T10:03:00.000Z",
		},
	];
	const dom = await renderSidebar(state, runtimeMessages);
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const shadow = host.shadowRoot;
	const sourceDisclosure = shadow.querySelector(".onhand-realtime-sources");
	assert.ok(sourceDisclosure, "expected saved turn to render a source dropdown");
	assert.equal(sourceDisclosure.tagName, "DETAILS", "expected sources to render as a disclosure dropdown");
	assert.equal(sourceDisclosure.open, false, "expected source dropdown to be collapsed by default");
	assert.match(sourceDisclosure.querySelector("summary")?.textContent || "", /Sources/);
	assert.match(sourceDisclosure.querySelector("summary")?.textContent || "", /2/);
	assert.equal(shadow.querySelectorAll(".onhand-cite").length, 0, "expected no inline citation when reply text does not quote sources");
	assert.ok(
		shadow.querySelector('.onhand-realtime-sources [data-action-key="highlight:source-strip"]'),
		"expected saved turn source strip to expose highlighted source",
	);
	assert.ok(
		shadow.querySelector('.onhand-realtime-sources [data-action-key="note:source-strip"]'),
		"expected saved turn source strip to expose note source",
	);
	sourceDisclosure.open = true;
	sourceDisclosure.dispatchEvent(new dom.window.Event("toggle"));
	await dom.window.__onhandSidebarTestHooks.requestState();
	await waitForSidebarTick(dom);
	const rerenderedSourceDisclosure = shadow.querySelector(".onhand-realtime-sources");
	assert.equal(rerenderedSourceDisclosure.open, true, "expected opened source dropdown to survive sidebar rerender");

	dom.window.close();
}

async function assertOpenPdfViewerMenuActionTargetsPdfTabs() {
	const nonPdfRuntimeMessages = [];
	const nonPdfState = createState();
	nonPdfState.tab = {
		id: 7,
		title: "Ordinary page",
		url: "https://example.test/article",
	};
	const nonPdfDom = await renderSidebar(nonPdfState, nonPdfRuntimeMessages);
	const nonPdfHost = nonPdfDom.window.document.querySelector("#onhand-extension-sidebar-host");
	const nonPdfButton = nonPdfHost.shadowRoot.getElementById("openPdfViewerButton");
	assert.ok(nonPdfButton, "expected Open PDF menu button");
	assert.equal(nonPdfButton.disabled, true, "expected Open PDF to be disabled on non-PDF pages");
	nonPdfDom.window.close();

	const pdfRuntimeMessages = [];
	const pdfState = createState();
	pdfState.tab = {
		id: 8,
		title: "Direct PDF",
		url: "https://example.test/pdf/onhand-viewer",
	};
	const pdfDom = await renderSidebar(pdfState, pdfRuntimeMessages);
	const pdfHost = pdfDom.window.document.querySelector("#onhand-extension-sidebar-host");
	const pdfButton = pdfHost.shadowRoot.getElementById("openPdfViewerButton");
	assert.ok(pdfButton, "expected Open PDF menu button on PDF page");
	assert.equal(pdfButton.disabled, false, "expected Open PDF to be enabled on PDF-like routes");
	assert.match(pdfButton.title, /Onhand's viewer/);
	pdfButton.dispatchEvent(new pdfDom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => pdfDom.window.setTimeout(resolve, 0));
	assert.equal(
		pdfRuntimeMessages.some((message) => message?.type === "sidebar:open-pdf-viewer" && message.windowId === 1),
		true,
		"expected Open PDF button to send sidebar handoff message",
	);
	pdfDom.window.close();

	const failedCaptureRuntimeMessages = [];
	const failedCaptureState = createState();
	failedCaptureState.pageCaptureError = "Onhand page tools only run on http/https tabs, not native PDF";
	failedCaptureState.tab = {
		id: 9,
		title: "Native PDF",
		url: "https://example.test/paper.pdf",
	};
	const failedCaptureDom = await renderSidebar(failedCaptureState, failedCaptureRuntimeMessages);
	const failedCaptureHost = failedCaptureDom.window.document.querySelector("#onhand-extension-sidebar-host");
	const failedCaptureButton = failedCaptureHost.shadowRoot.getElementById("openPdfViewerButton");
	assert.ok(failedCaptureButton, "expected Open PDF button when PDF capture fails");
	assert.equal(failedCaptureButton.disabled, false, "expected Open PDF to stay enabled from tab URL after PDF capture fails");
	failedCaptureDom.window.close();
}

async function assertSessionPickerSwitchesOnInputWithoutLosingSelection() {
	const runtimeMessages = [];
	const state = createState();
	state.currentSession = {
		sessionId: "session-alpha",
		sessionName: "Alpha session",
	};
	const sessions = [
		{
			id: "session-alpha",
			name: "Alpha session",
			path: "session-alpha",
			title: "Alpha session",
		},
		{
			id: "session-beta",
			name: "Beta session",
			path: "session-beta",
			title: "Beta session",
		},
	];
	const dom = await renderSidebar(state, runtimeMessages, {
		sessions: () => sessions,
		async switchSessionResponse(message) {
			assert.equal(message.sessionPath, "session-beta");
			await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
			state.currentSession = {
				sessionId: "session-beta",
				sessionName: "Beta session",
			};
			return { ok: true };
		},
	});
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const sessionSelect = host.shadowRoot.getElementById("sessionSelect");
	assert.equal(sessionSelect.value, "session-alpha");

	sessionSelect.focus();
	sessionSelect.value = "session-beta";
	sessionSelect.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:switch-session" && message.sessionPath === "session-beta"),
		true,
	);
	assert.equal(sessionSelect.value, "session-beta", "expected focused picker to keep the intended selection while switching");

	await new Promise((resolve) => dom.window.setTimeout(resolve, 80));
	assert.equal(sessionSelect.disabled, false);
	assert.equal(sessionSelect.value, "session-beta");

	assert.equal(host.shadowRoot.getElementById("replaySessionButton"), null, "expected review to be inline rather than a menu button");
	const reviewToggle = host.shadowRoot.querySelector("[data-replay-toggle]");
	assert.ok(reviewToggle, "expected inline review disclosure");
	reviewToggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 80));
	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:get-session-replay" && message.sessionPath === "session-beta"),
		true,
	);

	dom.window.close();
}

async function assertReviewViewRendersSavedSnapshot() {
	const runtimeMessages = [];
	const dom = await renderSidebar(createState(), runtimeMessages);
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	assert.ok(host, "expected sidebar host to render");
	assert.equal(host.shadowRoot.getElementById("replaySessionButton"), null, "expected no separate review menu button");
	const replayView = host.shadowRoot.getElementById("replayView");
	assert.equal(replayView.hidden, false, "expected inline review disclosure to be visible");
	assert.equal(replayView.querySelector(".onhand-replay-body").hidden, true, "expected review body to start collapsed");
	const replayToggle = replayView.querySelector("[data-replay-toggle]");
	assert.ok(replayToggle, "expected inline review disclosure toggle");
	replayToggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 80));

	assert.equal(
		runtimeMessages.some(
			(message) => message?.type === "sidebar:get-session-replay" && message.sessionPath === "session-bayesian",
		),
		true,
	);
	assert.equal(runtimeMessages.some((message) => message?.type === "sidebar:get-replay-artifact" && message.artifactId === "artifact-sidebar-replay"), true);
	assert.equal(replayView.hidden, false, "expected replay view to be visible");
	assert.equal(replayView.querySelector(".onhand-replay-body").hidden, false, "expected review body to expand inline");
	assert.match(replayView.textContent, /Review/);
	assert.match(replayView.textContent, /Saved replay note/);
	assert.equal(replayView.querySelector("[data-replay-close]"), null, "expected no live/review mode switch button");
	const snapshotImage = replayView.querySelector(".onhand-replay-image");
	assert.ok(snapshotImage, "expected saved screenshot image to render");
	assert.equal(snapshotImage.getAttribute("src"), "data:image/png;base64,UkVQTEFZ");
	const replayActionButton = replayView.querySelector('.onhand-replay-annotation [data-action-key="highlight:first"]');
	assert.ok(replayActionButton, "expected saved annotation source button");
	replayActionButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
	assert.equal(
		runtimeMessages.some(
			(message) =>
				message?.type === "sidebar:activate-action" &&
				message.key === "highlight:first" &&
				message.sessionPath === "session-bayesian",
		),
		true,
	);
	const restoreButton = replayView.querySelector("[data-replay-restore]");
	assert.ok(restoreButton, "expected review restore button");
	restoreButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
	assert.equal(
		runtimeMessages.some(
			(message) => message?.type === "sidebar:restore-session" && message.sessionPath === "session-bayesian",
		),
		true,
	);
	assert.equal(host.shadowRoot.getElementById("messages").hidden, false, "expected transcript to remain visible while review is open");
	assert.equal(host.shadowRoot.getElementById("composer").hidden, false, "expected composer to remain visible while review is open");

	replayView.querySelector("[data-replay-toggle]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
	assert.equal(replayView.hidden, false, "expected collapsed review disclosure to remain on the page");
	assert.equal(replayView.querySelector(".onhand-replay-body").hidden, true, "expected toggle to collapse review body");
	assert.equal(host.shadowRoot.getElementById("messages").hidden, false);

	dom.window.close();
}

async function assertReviewArtifactStripKeepsScrollPositionAcrossRenders() {
	const runtimeMessages = [];
	const artifacts = Array.from({ length: 8 }, (_, index) => ({
		artifactId: `artifact-sidebar-replay-${index + 1}`,
		title: `BayesianDL snapshot ${index + 1}`,
		url: "https://example.test/bayesian-dl",
		annotationCount: index + 1,
		hasScreenshot: true,
		hasHtml: true,
		annotations: [
			{
				annotationId: `ann-${index + 1}`,
				matchedText: `Saved replay passage ${index + 1}`,
				noteText: "",
			},
		],
	}));
	const dom = await renderSidebar(createState(), runtimeMessages, {
		replayArtifacts: artifacts,
		selectedArtifactId: "artifact-sidebar-replay-8",
	});
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	host.shadowRoot.querySelector("[data-replay-toggle]").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 80));

	const replayView = host.shadowRoot.getElementById("replayView");
	const scroller = replayView.querySelector(".onhand-replay-artifacts");
	assert.ok(scroller, "expected replay artifact scroller");
	scroller.scrollLeft = 180;
	scroller.dispatchEvent(new dom.window.Event("scroll"));
	const button = replayView.querySelector('[data-replay-artifact-id="artifact-sidebar-replay-3"]');
	assert.ok(button, "expected another snapshot button");
	button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 80));

	const rerenderedScroller = replayView.querySelector(".onhand-replay-artifacts");
	assert.equal(rerenderedScroller.scrollLeft, 180, "expected review artifact scroll position to survive rerender");

	dom.window.close();
}

async function assertPageIndexHighlightWithNoteJumpsToAnnotation() {
	const runtimeMessages = [];
	const state = createState();
	state.tab = {
		id: 42,
		title: "BayesianDL",
		url: "https://example.test/bayesian-dl",
	};
	state.page = {
		annotations: [
			{
				annotationId: "ann-stationary",
				kind: "block",
				matchedText: "q=qP",
				note: {
					text: "Stationary means applying the Markov transition once leaves the distribution unchanged.",
					label: "Onhand",
				},
			},
		],
	};
	const dom = await renderSidebar(state, runtimeMessages);
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const pageIndex = host.shadowRoot.getElementById("pageIndex");
	assert.match(pageIndex.textContent, /1 highlight, 1 note/);
	assert.match(pageIndex.textContent, /Stationary means applying the Markov transition once leaves the distribution unchanged/);
	const item = pageIndex.querySelector('.onhand-index-item[data-annotation-id="ann-stationary"]');
	assert.ok(item, "expected page index highlight item for restored highlight");
	assert.equal(item.dataset.target, "annotation");
	const highlightKind = item.querySelector(".onhand-index-kind");
	assert.equal(highlightKind?.textContent?.trim(), "highlight");
	const notePreview = pageIndex.querySelector('.onhand-index-note-preview[data-annotation-id="ann-stationary"]');
	assert.ok(notePreview, "expected page index note preview for restored note");
	assert.equal(notePreview.dataset.target, "note");

	item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

	assert.equal(
		runtimeMessages.some(
			(message) =>
				message?.type === "sidebar:scroll-to-annotation" &&
				message.annotationId === "ann-stationary" &&
				message.target === "annotation",
		),
		true,
	);

	notePreview.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

	assert.equal(
		runtimeMessages.some(
			(message) =>
				message?.type === "sidebar:scroll-to-annotation" &&
				message.annotationId === "ann-stationary" &&
				message.target === "note",
		),
		true,
	);

	dom.window.close();
}

async function assertPageIndexDoesNotShowStalePageActions() {
	const runtimeMessages = [];
	const state = createState();
	state.tab = {
		id: 99,
		title: "onhand-viewer.pdf - Onhand PDF Viewer",
		url: "http://127.0.0.1:8765/onhand-pdf-viewer.html?url=http%3A%2F%2F127.0.0.1%3A8765%2Ffixtures%2Fonhand-viewer.pdf",
	};
	state.page = { annotations: [] };
	state.pageActions = [
		{
			key: "highlight:stale-pdf",
			type: "annotation",
			annotationId: "stale-pdf",
			tabId: 42,
			title: "Onhand PDF Adapter Fixture",
			url: "http://127.0.0.1:8765/pdf.html",
			label: "Highlighted text",
			detail: "Recurrent Neural Networks",
			citationText: "Recurrent Neural Networks",
		},
		{
			key: "note:stale-pdf",
			type: "note",
			annotationId: "stale-pdf",
			tabId: 42,
			title: "Onhand PDF Adapter Fixture",
			url: "http://127.0.0.1:8765/pdf.html",
			label: "Added note",
			detail: "RNNs preserve sequence state.",
			citationText: "RNNs preserve sequence state.",
		},
	];

	const dom = await renderSidebar(state, runtimeMessages);
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const pageIndex = host.shadowRoot.getElementById("pageIndex");
	assert.equal(pageIndex.hidden, true, "expected stale annotations from another tab/page to stay out of the current page index");
	assert.equal(pageIndex.textContent.trim(), "", "expected stale annotation text not to render under ON THIS PAGE");
	dom.window.close();
}

async function assertLearningSessionPanelRendersState() {
	const runtimeMessages = [];
	const dom = await renderSidebar(createLearningState(), runtimeMessages);
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	assert.ok(host, "expected sidebar host to render");
	const learnerPanel = host.shadowRoot.getElementById("learnerPanel");
	assert.ok(learnerPanel, "expected learner panel to render");
	assert.equal(learnerPanel.hidden, false, "expected learner panel to be visible in Learning Mode with state");
	assert.match(learnerPanel.textContent, /This session/);
	assert.match(learnerPanel.textContent, /2 concepts/);
	assert.match(learnerPanel.textContent, /1 open check/);
	assert.match(learnerPanel.textContent, /Covered/);
	assert.match(learnerPanel.textContent, /Rejection sampling/);
	assert.match(learnerPanel.textContent, /Monte Carlo estimates/);
	assert.match(learnerPanel.textContent, /To answer/);
	assert.match(learnerPanel.textContent, /what do you think gets rejected here/);
	assert.match(learnerPanel.textContent, /prediction · Rejection sampling/);

	const sourceButtons = [...learnerPanel.querySelectorAll("[data-learner-annotation-id]")];
	assert.equal(sourceButtons.length, 3);
	const conceptSourceButton = learnerPanel.querySelector('[data-learner-annotation-id="ann-second"]');
	assert.ok(conceptSourceButton, "expected concept source button");
	conceptSourceButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
	assert.equal(
		runtimeMessages.some(
			(message) =>
				message?.type === "sidebar:activate-action" &&
				message.key === "highlight:second",
		),
		true,
	);
	assert.match(learnerPanel.textContent, /Jumped to source/);

	const checkSourceButton = learnerPanel.querySelector('[data-learner-annotation-id="ann-first"][data-target="note"]');
	assert.ok(checkSourceButton, "expected open-check source button");
	checkSourceButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
	assert.equal(
		runtimeMessages.some(
			(message) =>
				message?.type === "sidebar:activate-action" &&
				message.key === "highlight:first",
		),
		true,
	);

	dom.window.close();
}

async function assertLearningSessionPanelUsesPageActionWhenLearnerSourceIdIsStale() {
	const runtimeMessages = [];
	const state = createLearningState();
	state.turns = [
		{
			...state.turns[1],
			pageActions: [state.turns[1].pageActions[0]],
		},
	];
	state.pageActions = [state.turns[0].pageActions[0]];
	state.learnerState.conceptsIntroduced = [
		{
			conceptId: "concept_monte_carlo",
			label: "Monte Carlo estimates",
			firstSeenAt: "2026-05-12T10:01:00.000Z",
			lastSeenAt: "2026-05-12T10:01:00.000Z",
			sources: [
				{
					tabTitle: "BayesianDL",
					url: "https://example.test/bayesian-dl",
					annotationId: "stale-learner-source",
				},
			],
		},
	];
	state.learnerState.openChecks = [];

	const dom = await renderSidebar(state, runtimeMessages);
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const learnerPanel = host.shadowRoot.getElementById("learnerPanel");
	const sourceButton = learnerPanel.querySelector('[data-learner-annotation-id="stale-learner-source"]');
	assert.ok(sourceButton, "expected stale learner source button");
	assert.equal(sourceButton.dataset.actionKey, "highlight:second");
	sourceButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:activate-action" && message.key === "highlight:second"),
		true,
	);
	assert.match(learnerPanel.textContent, /Jumped to source/);

	dom.window.close();
}

async function assertLearningSessionPanelResolvesEachConceptToItsOwnTurnSource() {
	const state = createLearningState();
	const pageUrl = "https://example.test/transformers";
	state.tab = {
		id: 42,
		title: "Transformers",
		url: pageUrl,
	};
	state.pageActions = [
		{
			key: "highlight:latest-visible",
			type: "annotation",
			annotationId: "latest-visible",
			label: "Highlighted text",
			title: "Transformers",
			url: pageUrl,
			detail: "Multi-head self-attention",
			citationText: "Multi-head self-attention",
		},
	];
	state.turns = [
		{
			id: "turn-attention-graph",
			userPrompt: "[Voice] What exactly is an attention graph?",
			reply: "An attention graph treats tokens as nodes and attention weights as directed, weighted edges.",
			activities: [],
			pageActions: [
				{
					key: "highlight:attention-graph",
					type: "annotation",
					annotationId: "attention-graph",
					label: "Highlighted text",
					title: "Transformers",
					url: pageUrl,
					detail: "self-attention graph",
					citationText: "self-attention graph",
				},
				{
					key: "note:attention-graph",
					type: "note",
					annotationId: "attention-graph",
					label: "Added note",
					title: "Transformers",
					url: pageUrl,
					detail: "Tokens are nodes, and attention weights are directed, weighted edges.",
					citationText: "Tokens are nodes, and attention weights are directed, weighted edges.",
				},
			],
			pending: false,
			error: false,
			createdAt: "2026-05-12T10:04:00.000Z",
		},
		{
			id: "turn-multi-head",
			userPrompt: "[Voice] Difference between single-headed and multi-headed attention?",
			reply: "Single-head attention builds one attention graph; multi-head builds several graphs in parallel.",
			activities: [],
			pageActions: [
				{
					key: "highlight:multi-head",
					type: "annotation",
					annotationId: "multi-head",
					label: "Highlighted text",
					title: "Transformers",
					url: pageUrl,
					detail: "The multi-head self-attention mechanism constructs multiple weighted graphs in parallel",
					citationText: "The multi-head self-attention mechanism constructs multiple weighted graphs in parallel",
				},
				{
					key: "note:multi-head",
					type: "note",
					annotationId: "multi-head",
					label: "Added note",
					title: "Transformers",
					url: pageUrl,
					detail: "Read each head as its own attention graph; multi-head means several such graphs are computed side-by-side.",
					citationText: "Read each head as its own attention graph; multi-head means several such graphs are computed side-by-side.",
				},
			],
			pending: false,
			error: false,
			createdAt: "2026-05-12T10:05:00.000Z",
		},
	];
	state.learnerState.conceptsIntroduced = [
		{
			conceptId: "concept_single_multi_head",
			label: "Single-head vs multi-head attention",
			firstSeenAt: "2026-05-12T10:05:00.000Z",
			lastSeenAt: "2026-05-12T10:05:00.000Z",
			sources: [{ tabTitle: "Transformers", url: pageUrl, annotationId: "stale-multi-head" }],
		},
		{
			conceptId: "concept_attention_graph_meaning",
			label: "Attention graph nodes and edges",
			firstSeenAt: "2026-05-12T10:04:00.000Z",
			lastSeenAt: "2026-05-12T10:04:00.000Z",
			sources: [{ tabTitle: "Transformers", url: pageUrl, annotationId: "stale-attention-graph" }],
		},
	];
	state.learnerState.openChecks = [];

	const dom = await renderSidebar(state, []);
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const learnerPanel = host.shadowRoot.getElementById("learnerPanel");
	const multiHeadSource = learnerPanel.querySelector('[data-learner-annotation-id="stale-multi-head"]');
	const graphSource = learnerPanel.querySelector('[data-learner-annotation-id="stale-attention-graph"]');
	assert.ok(multiHeadSource, "expected multi-head concept source button");
	assert.ok(graphSource, "expected attention graph concept source button");
	assert.equal(multiHeadSource.dataset.actionKey, "highlight:multi-head");
	assert.equal(graphSource.dataset.actionKey, "highlight:attention-graph");

	dom.window.close();
}

async function assertLearningSessionPanelCanResolveRestoredConceptThroughPairedNote() {
	const runtimeMessages = [];
	const state = createLearningState();
	const pageUrl = "https://example.test/bayesian-dl";
	state.learnerState.conceptsIntroduced = [
		{
			conceptId: "concept_stationary_distribution",
			label: "Stationary distribution of a Markov chain",
			firstSeenAt: "2026-05-12T10:03:00.000Z",
			lastSeenAt: "2026-05-12T10:03:00.000Z",
			sources: [
					{
						tabTitle: "BayesianDL",
						url: pageUrl,
						annotationId: "restored-unrelated",
					},
				],
			},
	];
	state.learnerState.openChecks = [];
	state.pageActions = [
		{
			key: "highlight:qeqp-restored",
			type: "annotation",
			annotationId: "restored-qeqp",
			label: "Highlighted text",
			title: "BayesianDL",
			url: pageUrl,
			detail: "q=qP",
			citationText: "q=qP",
		},
		{
			key: "note:qeqp-restored",
			type: "note",
			annotationId: "restored-qeqp",
			label: "Added note",
			title: "BayesianDL",
			url: pageUrl,
			detail: "Stationary means applying the Markov transition once leaves the distribution unchanged.",
			citationText: "Stationary means applying the Markov transition once leaves the distribution unchanged.",
		},
		{
			key: "highlight:unrelated-restored",
			type: "annotation",
			annotationId: "restored-unrelated",
			label: "Highlighted text",
			title: "BayesianDL",
			url: pageUrl,
			detail: "Metropolis-Hastings Algorithm",
			citationText: "Metropolis-Hastings Algorithm",
		},
	];
		state.turns = [
			{
				id: "turn-wrong-stale-id",
				userPrompt: "what does this mean?",
				reply: "Saved concept: Stationary distribution of a Markov chain.",
				activities: [],
				pageActions: [
					{
						key: "highlight:wrong-stale-id",
						type: "annotation",
						annotationId: "restored-unrelated",
						label: "Highlighted text",
						title: "BayesianDL",
						url: pageUrl,
						detail: "Metropolis-Hastings Algorithm",
						citationText: "Metropolis-Hastings Algorithm",
					},
				],
				pending: false,
				error: false,
				createdAt: "2026-05-12T10:02:00.000Z",
			},
			{
				id: "turn-stationary",
				userPrompt: "what does this mean?",
			reply: "Saved concept: Stationary distribution of a Markov chain.",
			activities: [],
			pageActions: [
				{
					key: "highlight:qeqp-stale",
					type: "annotation",
					annotationId: "stale-stationary-source",
					label: "Highlighted text",
					title: "BayesianDL",
					url: pageUrl,
					detail: "q=qP",
					citationText: "q=qP",
				},
				{
					key: "note:qeqp-stale",
					type: "note",
					annotationId: "stale-stationary-source",
					label: "Added note",
					title: "BayesianDL",
					url: pageUrl,
					detail: "Stationary means applying the Markov transition once leaves the distribution unchanged.",
					citationText: "Stationary means applying the Markov transition once leaves the distribution unchanged.",
				},
			],
			pending: false,
			error: false,
			createdAt: "2026-05-12T10:03:00.000Z",
		},
	];

	const dom = await renderSidebar(state, runtimeMessages);
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const learnerPanel = host.shadowRoot.getElementById("learnerPanel");
	const sourceButton = learnerPanel.querySelector('[data-learner-annotation-id="restored-unrelated"]');
	assert.ok(sourceButton, "expected semantically corrected stationary source button");
	assert.equal(sourceButton.dataset.actionKey, "highlight:qeqp-restored");
	sourceButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:activate-action" && message.key === "highlight:qeqp-restored"),
		true,
	);
	assert.match(learnerPanel.textContent, /Jumped to source/);

	dom.window.close();
}

async function assertLearningSessionPanelPrefersPairedNoteSourceOverGenericHeading() {
	const runtimeMessages = [];
	const state = createLearningState();
	const pageUrl = "https://example.test/bayesian-dl";
	state.learnerState.conceptsIntroduced = [
		{
			conceptId: "concept_aperiodic_markov_chain",
			label: "Aperiodic Markov chain in convergence",
			firstSeenAt: "2026-05-12T10:04:00.000Z",
			lastSeenAt: "2026-05-12T10:04:00.000Z",
			sources: [
				{
					tabTitle: "BayesianDL",
					url: pageUrl,
					annotationId: "stale-aperiodic-source",
				},
			],
		},
	];
	state.learnerState.openChecks = [];
	state.pageActions = [
		{
			key: "highlight:generic-mcmc-heading",
			type: "annotation",
			annotationId: "restored-generic-mcmc",
			label: "Highlighted text",
			title: "BayesianDL",
			url: pageUrl,
			detail: "Markov Chain Monte Carlo",
			citationText: "Markov Chain Monte Carlo",
		},
		{
			key: "highlight:aperiodic-condition-restored",
			type: "annotation",
			annotationId: "restored-aperiodic-condition",
			label: "Highlighted text",
			title: "BayesianDL",
			url: pageUrl,
			detail: "condition that the Markov chain is aperiodic",
			citationText: "condition that the Markov chain is aperiodic",
		},
		{
			key: "note:aperiodic-condition-restored",
			type: "note",
			annotationId: "restored-aperiodic-condition",
			label: "Added note",
			title: "BayesianDL",
			url: pageUrl,
			detail: "Aperiodic means the chain does not get trapped in a fixed cycle, so convergence can settle instead of oscillating.",
			citationText: "Aperiodic means the chain does not get trapped in a fixed cycle, so convergence can settle instead of oscillating.",
		},
	];
	state.turns = [
		{
			id: "turn-aperiodic",
			userPrompt: "What does aperiodic mean in this convergence argument?",
			reply: "Saved concept: Aperiodic Markov chain in convergence.",
			activities: [],
			pageActions: state.pageActions,
			pending: false,
			error: false,
			createdAt: "2026-05-12T10:04:00.000Z",
		},
	];

	const dom = await renderSidebar(state, runtimeMessages);
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const learnerPanel = host.shadowRoot.getElementById("learnerPanel");
	const sourceButton = learnerPanel.querySelector('[data-learner-annotation-id="stale-aperiodic-source"]');
	assert.ok(sourceButton, "expected aperiodic concept source button");
	assert.equal(sourceButton.dataset.actionKey, "highlight:aperiodic-condition-restored");
	sourceButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:activate-action" && message.key === "highlight:aperiodic-condition-restored"),
		true,
	);

	dom.window.close();
}

async function assertLearningSessionPanelPrefersPairedNoteSourceOverExactBroadSource() {
	const runtimeMessages = [];
	const state = createLearningState();
	const pageUrl = "https://example.test/bayesian-dl";
	state.learnerState.conceptsIntroduced = [
		{
			conceptId: "concept_rejection_sampling_impractical",
			label: "Why rejection sampling is impractical for posterior sampling",
			firstSeenAt: "2026-05-12T10:34:00.000Z",
			lastSeenAt: "2026-05-12T10:34:00.000Z",
			sources: [
				{
					tabTitle: "BayesianDL",
					url: pageUrl,
					annotationId: "broad-rejection-heading",
				},
			],
		},
	];
	state.learnerState.openChecks = [];
	state.pageActions = [
		{
			key: "highlight:broad-rejection-heading",
			type: "annotation",
			annotationId: "broad-rejection-heading",
			label: "Highlighted text",
			title: "BayesianDL",
			url: pageUrl,
			detail: "Bayesian modeling: Posterior sampling via rejection sampling (impractical)",
			citationText: "Bayesian modeling: Posterior sampling via rejection sampling (impractical)",
		},
		{
			key: "highlight:posterior-bound-restored",
			type: "annotation",
			annotationId: "posterior-bound-restored",
			label: "Highlighted text",
			title: "BayesianDL",
			url: pageUrl,
			detail: "Let M>=p(W|D)P(W), for all W be a constant",
			citationText: "Let M>=p(W|D)P(W), for all W be a constant",
		},
		{
			key: "note:posterior-bound-restored",
			type: "note",
			annotationId: "posterior-bound-restored",
			label: "Added note",
			title: "BayesianDL",
			url: pageUrl,
			detail: "This requires a global bound M on posterior/prior for all weights; if M is large or unknown, most proposed prior samples get rejected.",
			citationText: "This requires a global bound M on posterior/prior for all weights; if M is large or unknown, most proposed prior samples get rejected.",
		},
	];
	state.turns = [
		{
			id: "turn-rejection-impractical",
			userPrompt: "Explain why rejection sampling becomes impractical for posterior sampling.",
			reply: "Saved concept: Why rejection sampling is impractical for posterior sampling.",
			activities: [],
			pageActions: state.pageActions,
			pending: false,
			error: false,
			createdAt: "2026-05-12T10:34:00.000Z",
		},
	];

	const dom = await renderSidebar(state, runtimeMessages);
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const learnerPanel = host.shadowRoot.getElementById("learnerPanel");
	const sourceButton = learnerPanel.querySelector('[data-learner-annotation-id="broad-rejection-heading"]');
	assert.ok(sourceButton, "expected rejection concept source button");
	assert.equal(sourceButton.dataset.actionKey, "highlight:posterior-bound-restored");
	sourceButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:activate-action" && message.key === "highlight:posterior-bound-restored"),
		true,
	);

	dom.window.close();
}

async function assertLearningSessionPanelShowsAllConceptsAndCanCollapse() {
	const runtimeMessages = [];
	const state = createLearningState();
	const concepts = Array.from({ length: 7 }, (_, index) => {
		const number = index + 1;
		return {
			conceptId: `concept_${number}`,
			label: `Concept ${number}`,
			firstSeenAt: `2026-05-12T10:0${index}:00.000Z`,
			lastSeenAt: `2026-05-12T10:0${index}:00.000Z`,
			sources: [
				{
					tabTitle: "BayesianDL",
					url: "https://example.test/bayesian-dl",
					annotationId: `ann-${number}`,
				},
			],
		};
	});
	state.learnerState.conceptsIntroduced = concepts;
	state.learnerState.openChecks = [];
	state.turns = concepts.map((concept) => ({
		id: `turn-${concept.conceptId}`,
		userPrompt: concept.label,
		reply: concept.label,
		activities: [],
		pageActions: [
			{
				key: `highlight:${concept.sources[0].annotationId}`,
				type: "annotation",
				annotationId: concept.sources[0].annotationId,
				label: "Highlighted text",
				title: "BayesianDL",
				url: "https://example.test/bayesian-dl",
				detail: concept.label,
				citationText: concept.label,
			},
		],
		pending: false,
		error: false,
		createdAt: concept.firstSeenAt,
	}));

	const dom = await renderSidebar(state, runtimeMessages);
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const learnerPanel = host.shadowRoot.getElementById("learnerPanel");
	assert.match(learnerPanel.textContent, /7 concepts/);
	assert.doesNotMatch(learnerPanel.textContent, /earlier/);
	for (const concept of concepts) {
		assert.match(learnerPanel.textContent, new RegExp(concept.label));
	}
	const grid = learnerPanel.querySelector(".onhand-learner-grid");
	assert.ok(grid, "expected learner concept scroller");
	grid.scrollTop = 140;
	grid.dispatchEvent(new dom.window.Event("scroll"));
	const firstSourceButton = learnerPanel.querySelector('[data-learner-annotation-id="ann-1"]');
	assert.ok(firstSourceButton, "expected source button to trigger learner panel rerender");
	firstSourceButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
	const rerenderedGrid = learnerPanel.querySelector(".onhand-learner-grid");
	assert.equal(rerenderedGrid.scrollTop, 140, "expected learner concept scroll position to survive rerender");
	const body = learnerPanel.querySelector(".onhand-learner-body");
	assert.equal(body.hidden, false, "expected learner body to start expanded");
	const toggle = learnerPanel.querySelector("[data-learner-toggle]");
	assert.equal(toggle.textContent, "Hide");
	toggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
	const collapsedBody = learnerPanel.querySelector(".onhand-learner-body");
	assert.equal(collapsedBody.hidden, true, "expected learner body to collapse");
	assert.equal(learnerPanel.querySelector("[data-learner-toggle]").textContent, "Show");

	dom.window.close();
}

async function assertLearningSessionPanelReportsSourceFailure() {
	const runtimeMessages = [];
	const dom = await renderSidebar(createLearningState(), runtimeMessages, {
		activateActionResponse(message) {
			return {
				ok: false,
				error: `No annotation found with key: ${message.key}`,
			};
		},
	});
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const learnerPanel = host.shadowRoot.getElementById("learnerPanel");
	const sourceButton = learnerPanel.querySelector('[data-learner-annotation-id="ann-second"]');
	assert.ok(sourceButton, "expected concept source button");
	sourceButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:activate-action" && message.key === "highlight:second"),
		true,
	);
	const feedback = learnerPanel.querySelector(".onhand-learner-feedback");
	assert.ok(feedback, "expected learner source feedback");
	assert.match(feedback.textContent, /Source not found on this page/);
	assert.equal(feedback.classList.contains("error"), true);

	dom.window.close();
}

async function assertLearningSessionPanelHidesOutsideLearningState() {
	const answerRuntimeMessages = [];
	const answerState = createLearningState();
	answerState.preferences.learningMode = false;
	const answerDom = await renderSidebar(answerState, answerRuntimeMessages);
	const answerPanel = answerDom.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot.getElementById("learnerPanel");
	assert.equal(answerPanel.hidden, true, "expected learner panel to hide in Answer Mode");
	answerDom.window.close();

	const emptyRuntimeMessages = [];
	const emptyState = createState();
	emptyState.preferences.learningMode = true;
	emptyState.learnerState = {
		mode: "learning",
		conceptsIntroduced: [],
		openChecks: [],
		responses: [],
	};
	const emptyDom = await renderSidebar(emptyState, emptyRuntimeMessages);
	const emptyPanel = emptyDom.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot.getElementById("learnerPanel");
	assert.equal(emptyPanel.hidden, true, "expected learner panel to hide when Learning Mode has no state");
	emptyDom.window.close();
}

function createRealtimeTestDataChannel(events) {
	return {
		readyState: "open",
		send(payload) {
			events.push(JSON.parse(payload));
		},
		close() {
			this.readyState = "closed";
		},
	};
}

function getRealtimeTestHooks(dom) {
	const hooks = dom.window.__onhandSidebarTestHooks;
	assert.ok(hooks, "expected realtime sidebar test hooks");
	return hooks;
}

async function waitForSidebarTick(dom) {
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
}

async function waitForRealtimePreambleDelay(dom) {
	await new Promise((resolve) => dom.window.setTimeout(resolve, 1260));
}

async function flushRealtimeTranscript(hooks, dom) {
	await hooks.flushRealtimePendingTranscript();
	await waitForSidebarTick(dom);
}

function createDeferred() {
	let resolve;
	let reject;
	const promise = new Promise((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}

async function assertRealtimeMicPickerConstrainsSelectedDevice() {
	const runtimeMessages = [];
	const mediaRequests = [];
	const mediaDevices = {
		async enumerateDevices() {
			return [
				{ kind: "audioinput", deviceId: "default", label: "Default - Built-in Mic", groupId: "group-default" },
				{ kind: "audioinput", deviceId: "studio-mic", label: "Studio Mic", groupId: "group-studio" },
				{ kind: "videoinput", deviceId: "camera", label: "Camera", groupId: "group-camera" },
			];
		},
		async getUserMedia(constraints) {
			mediaRequests.push(constraints);
			return {
				getAudioTracks() {
					return [{ label: "Studio Mic" }];
				},
			};
		},
		addEventListener() {},
	};
	const dom = await renderSidebar(createState(), runtimeMessages, { mediaDevices });
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const micSelect = host.shadowRoot.getElementById("realtimeMicSelect");
	const micPicker = host.shadowRoot.getElementById("realtimeMicPicker");
	const micLabel = host.shadowRoot.getElementById("realtimeMicLabel");
	const voiceControl = host.shadowRoot.getElementById("realtimeVoiceControl");
	assert.ok(micSelect, "expected realtime mic picker");
	assert.ok(micPicker, "expected realtime mic picker shell");
	assert.equal(micPicker.parentElement, voiceControl, "expected mic picker to be attached to the voice control");
	assert.equal(micPicker.hidden, false, "expected realtime mic picker to be visible when mic capture is available");
	assert.equal(micSelect.hidden, false, "expected realtime mic select to be available when mic capture is available");
	assert.match(micSelect.textContent, /Studio Mic/);
	assert.equal(micLabel.textContent, "Default");

	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeMicDeviceId("studio-mic");
	await hooks.refreshRealtimeMicDevices();
	assert.equal(micLabel.textContent, "Studio Mic");
	await hooks.createRealtimeInputMediaStream();

	assert.equal(mediaRequests.length, 1);
	assert.equal(mediaRequests[0].audio.deviceId.exact, "studio-mic");
	assert.equal(hooks.getRealtimeDebugState().micDeviceId, "studio-mic");
	dom.window.close();
}

async function assertRealtimeVoiceDisabledState() {
	const runtimeMessages = [];
	const state = createState();
	state.preferences.realtimeVoiceEnabled = false;
	const dom = await renderSidebar(state, runtimeMessages);
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const shadow = host.shadowRoot;
	const voiceButton = shadow.getElementById("realtimeVoiceButton");
	const status = shadow.getElementById("realtimeStatus");

	assert.equal(voiceButton.textContent, "Off", "expected disabled realtime voice button to render as off");
	assert.equal(voiceButton.disabled, true, "expected disabled realtime voice button to be disabled");
	assert.equal(status.textContent, "Voice disabled", "expected realtime status to explain disabled voice");
	assert.match(status.title, /Enable Realtime Voice/);
	dom.window.close();
}

async function assertRealtimeApiKeyErrorOpensOptions() {
	const runtimeMessages = [];
	const dom = await renderSidebar(createState(), runtimeMessages);
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const shadow = host.shadowRoot;
	const voiceButton = shadow.getElementById("realtimeVoiceButton");
	const status = shadow.getElementById("realtimeStatus");
	const errorBubble = shadow.getElementById("realtimeErrorBubble");
	const errorText = shadow.getElementById("realtimeErrorText");
	const errorOptionsButton = shadow.getElementById("realtimeErrorOptionsButton");
	const errorDismissButton = shadow.getElementById("realtimeErrorDismissButton");
	const hooks = getRealtimeTestHooks(dom);

	hooks.setRealtimeStatus(
		"Voice setup needed",
		"Voice needs an OpenAI platform API key. Open Onhand options, paste a platform key with Realtime API access in the OpenAI platform API key field, then Save.",
	);

	assert.equal(voiceButton.textContent, "Setup", "expected Voice button to become a setup button after API-key auth failure");
	assert.match(status.textContent, /OpenAI platform API key/);
	assert.match(status.title, /Onhand options/);
	assert.equal(status.getAttribute("aria-expanded"), "false");
	assert.equal(errorBubble.hidden, true, "expected voice error details to start collapsed");

	status.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	assert.equal(status.getAttribute("aria-expanded"), "true");
	assert.equal(errorBubble.hidden, false, "expected clicking the status error to reveal details");
	assert.match(errorText.textContent, /Realtime API access/);
	assert.equal(errorOptionsButton.hidden, false, "expected API key setup errors to expose an options action");

	errorDismissButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	assert.equal(errorBubble.hidden, true, "expected dismissing error details to collapse the bubble");

	voiceButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await waitForSidebarTick(dom);

	assert.equal(dom.getOpenOptionsCalls(), 1, "expected setup click to open extension options");
	status.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	errorOptionsButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await waitForSidebarTick(dom);
	assert.equal(dom.getOpenOptionsCalls(), 2, "expected error bubble options click to open extension options");
	dom.window.close();
}

async function assertRealtimeApiKeyErrorFallsBackToOptionsTab() {
	const runtimeMessages = [];
	const dom = await renderSidebar(createState(), runtimeMessages, {
		async openOptionsPage() {
			throw new Error("Could not create an options page");
		},
	});
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const shadow = host.shadowRoot;
	const status = shadow.getElementById("realtimeStatus");
	const errorOptionsButton = shadow.getElementById("realtimeErrorOptionsButton");
	const hooks = getRealtimeTestHooks(dom);

	hooks.setRealtimeStatus(
		"Voice setup needed",
		"Voice needs an OpenAI platform API key. Open Onhand options, paste a platform key with Realtime API access in the OpenAI platform API key field, then Save.",
	);

	status.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	errorOptionsButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await waitForSidebarTick(dom);

	assert.equal(dom.getOpenOptionsCalls(), 1, "expected native options API to be attempted first");
	assert.deepEqual(dom.getCreatedTabs(), [
		{
			url: "chrome-extension://extension-id/options.html",
			active: true,
		},
	]);
	dom.window.close();
}

async function assertRealtimeResponseCreateQueuesUntilDone() {
	const runtimeMessages = [];
	const events = [];
	const dom = await renderSidebar(createState(), runtimeMessages);
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	hooks.requestRealtimeResponse("first_response");
	hooks.requestRealtimeResponse("second_response");

	assert.equal(events.filter((event) => event.type === "response.create").length, 1, "expected active response to suppress duplicate response.create");
	assert.equal(hooks.getRealtimeDebugState().responseCreateQueued, true, "expected second response to be queued");
	assert.equal(hooks.getRealtimeDebugState().status, "Finishing current response...");

	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.done", response: { output: [] } }));
	await waitForSidebarTick(dom);

	assert.equal(events.filter((event) => event.type === "response.create").length, 2, "expected queued response after response.done");
	assert.equal(hooks.getRealtimeDebugState().responseInProgress, true, "expected queued response to become active");

	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.done", response: { output: [] } }));
	await waitForSidebarTick(dom);

	assert.equal(hooks.getRealtimeDebugState().responseInProgress, false, "expected final response.done to clear active response");
	assert.equal(hooks.getRealtimeDebugState().responseCreateQueued, false);
	assert.equal(hooks.getRealtimeDebugState().status, "Voice ready · ask, then pause");

	dom.window.close();
}

async function assertRealtimeActiveResponseErrorIsRecoverable() {
	const runtimeMessages = [];
	const events = [];
	const dom = await renderSidebar(createState(), runtimeMessages);
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);
	hooks.setRealtimeResponseInProgress(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "error",
			error: {
				message: "Conversation already has an active response in progress: resp_test. Wait until the response is finished before creating a new one.",
			},
		}),
	);

	const queuedState = hooks.getRealtimeDebugState();
	assert.equal(queuedState.connected, true, "expected active-response error not to disconnect voice");
	assert.equal(queuedState.responseCreateQueued, true, "expected active-response error to queue a retry");
	assert.equal(queuedState.status, "Waiting for response to finish...");

	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.done", response: { output: [] } }));
	await waitForSidebarTick(dom);

	assert.equal(events.filter((event) => event.type === "response.create").length, 1, "expected recoverable error to retry after response.done");
	assert.equal(hooks.getRealtimeDebugState().responseInProgress, true);

	dom.window.close();
}

async function assertRealtimeManualVoiceFallbackDisabled() {
	const runtimeMessages = [];
	const events = [];
	const dom = await renderSidebar(createState(), runtimeMessages);
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	assert.equal(hooks.isRealtimeOnlyVoiceMode(), true, "expected voice mode to keep page work inside the live Realtime session");
	assert.equal(hooks.commitRealtimeVoiceFallback(), false, "expected local speech fallback commit to be disabled");
	hooks.scheduleRealtimeVoiceFallbackCommit();
	await new Promise((resolve) => dom.window.setTimeout(resolve, 900));
	await waitForSidebarTick(dom);

	assert.equal(events.some((event) => event.type === "input_audio_buffer.commit"), false, "expected no local input buffer commit");
	assert.equal(events.some((event) => event.type === "response.create"), false, "expected no local fallback response");
	assert.equal(hooks.getRealtimeDebugState().manualVoiceCommitPending, false);

	dom.window.close();
}

async function assertRealtimeServerSpeechDoesNotScheduleLocalFallback() {
	const runtimeMessages = [];
	const events = [];
	const dom = await renderSidebar(createState(), runtimeMessages);
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	hooks.setRealtimeServerSpeechSeenAt(Date.now() - 1100);
	hooks.scheduleRealtimeVoiceFallbackCommit();
	await new Promise((resolve) => dom.window.setTimeout(resolve, 1800));
	await waitForSidebarTick(dom);

	assert.equal(events.some((event) => event.type === "input_audio_buffer.commit"), false, "expected Realtime-only mode not to schedule local fallback commits");
	assert.equal(events.some((event) => event.type === "response.create"), false, "expected Realtime-only mode not to create local fallback responses");

	dom.window.close();
}

async function assertRealtimeCommittedAudioCreatesRealtimeTurn() {
	const runtimeMessages = [];
	const events = [];
	const dom = await renderSidebar(createState(), runtimeMessages);
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "input_audio_buffer.committed",
			item_id: "item-audio-only",
		}),
	);
	await waitForSidebarTick(dom);

	assert.equal(events.some((event) => event.type === "response.create"), false, "expected committed audio to let Realtime server VAD create the response");
	assert.equal(hooks.getRealtimeDebugState().pendingTranscriptionItemId, "");
	assert.equal(hooks.getRealtimeDebugState().status, "Thinking...");
	assert.equal(hooks.getRealtimeDebugState().activeVoiceTurn?.kind, "realtime_response");
	assert.equal(hooks.getRealtimeDebugState().audioFallbackItemIds.join(","), "");

	dom.window.close();
}

async function assertRealtimeSpeechStoppedWaitsForRealtimeResponse() {
	const runtimeMessages = [];
	const events = [];
	const dom = await renderSidebar(createState(), runtimeMessages);
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "input_audio_buffer.speech_stopped" }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 1300));
	await waitForSidebarTick(dom);

	assert.equal(events.some((event) => event.type === "response.create"), false, "expected Realtime-only mode not to create a local fallback response");
	assert.equal(events.some((event) => event.type === "input_audio_buffer.commit"), true, "expected speech stop to commit audio for transcription if Realtime does not");
	assert.equal(hooks.getRealtimeDebugState().status, "Submitting voice...");
	assert.equal(hooks.getRealtimeDebugState().responseInProgress, false);

	dom.window.close();
}

async function assertRealtimeTranscriptRoutesPageQuestionsThroughOnhand() {
	const runtimeMessages = [];
	const events = [];
	const state = createState();
	state.tab = {
		id: 42,
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
	};
	state.page = {
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
		text: "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
	};
	const dom = await renderSidebar(state, runtimeMessages, { submitPromptRequestId: "request-transcribed-voice" });
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "input_audio_buffer.committed",
			item_id: "item-transcribed",
		}),
	);
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "item-transcribed",
			transcript: "What does Alpha smoke content mean here?",
		}),
	);
	await waitForSidebarTick(dom);

	assert.equal(hooks.getRealtimeDebugState().pendingTranscriptionItemId, "");
	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:submit-prompt"),
		false,
		"expected transcript completion to wait for the merge window before submitting",
	);
	await flushRealtimeTranscript(hooks, dom);
	const submitMessage = runtimeMessages.find((message) => message?.type === "sidebar:submit-prompt");
	assert.ok(submitMessage, "expected page-material voice transcript to use Onhand's persisted answer pipeline");
	assert.equal(submitMessage.prompt, "What does Alpha smoke content mean here?");
	assert.equal(submitMessage.displayPrompt, "[Voice] What does Alpha smoke content mean here?");
	assert.equal(submitMessage.source, "realtime-voice-direct-answer");
	assert.equal(hooks.getRealtimeDebugState().pendingDirectAnswerRequestId, "request-transcribed-voice");
	assert.equal(hooks.getRealtimeDebugState().activeVoiceTurn?.kind, "direct_answer");
	assert.equal(hooks.getRealtimeDebugState().activeVoiceTurn?.prompt, "What does Alpha smoke content mean here?");
	assert.equal(
		events.some((event) => event.type === "response.create" && !event.event_id?.includes("backend_preamble")),
		false,
		"expected no self-authored Realtime answer for page-material voice questions",
	);

	dom.window.close();
}

async function assertRealtimeLearningVoiceQuestionUsesRuntimeAgentInsteadOfSocraticPlanner() {
	const runtimeMessages = [];
	const events = [];
	const state = createLearningState();
	state.tab = {
		id: 42,
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
	};
	state.page = {
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
		text: "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
	};
	const dom = await renderSidebar(state, runtimeMessages, { submitPromptRequestId: "request-learning-voice-direct" });
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "What does Alpha smoke content mean here?",
		}),
	);
	await waitForSidebarTick(dom);

	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:realtime-plan-pedagogical-move"),
		false,
		"expected an ordinary Learning voice question not to call the Socratic planner",
	);
	await flushRealtimeTranscript(hooks, dom);
	const submitMessage = runtimeMessages.find((message) => message?.type === "sidebar:submit-prompt");
	assert.ok(submitMessage, "expected an ordinary Learning voice question to use Onhand's persisted answer pipeline");
	assert.equal(submitMessage.prompt, "What does Alpha smoke content mean here?");
	assert.equal(submitMessage.displayPrompt, "[Voice] What does Alpha smoke content mean here?");
	assert.equal(submitMessage.learningMode, true);
	assert.equal(submitMessage.source, "realtime-voice-direct-answer");
	assert.equal(
		events.some((event) => event.type === "response.create" && event.event_id?.includes("response_for_audio_transcript")),
		false,
		"expected an ordinary Learning voice question not to self-author through the live Realtime tool session",
	);
	assert.equal(hooks.getRealtimeDebugState().pendingDirectAnswerRequestId, "request-learning-voice-direct");
	assert.equal(hooks.getRealtimeDebugState().pendingSocraticMove, null);
	assert.equal(hooks.getRealtimeDebugState().activeVoiceTurn?.prompt, "What does Alpha smoke content mean here?");

	dom.window.close();
}

async function assertRealtimeEmptyInputBufferDoesNotDisconnect() {
	const runtimeMessages = [];
	const dom = await renderSidebar(createState(), runtimeMessages);
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel([]));
	hooks.setRealtimeConnected(true);
	hooks.setRealtimeManualVoiceCommitPending(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "error",
			error: { message: "Input audio buffer is empty. Commit requires audio." },
		}),
	);

	const state = hooks.getRealtimeDebugState();
	assert.equal(state.connected, true, "expected empty input-buffer error not to disconnect voice");
	assert.equal(state.manualVoiceCommitPending, false);
	assert.equal(state.status, "OpenAI received no mic audio");
	assert.equal(state.error, "");

	dom.window.close();
}

async function assertRealtimeIdleTimeoutDisconnectsOnlyWhenIdle() {
	const runtimeMessages = [];
	const events = [];
	const dom = await renderSidebar(createState(), runtimeMessages);
	const hooks = getRealtimeTestHooks(dom);
	const dataChannel = createRealtimeTestDataChannel(events);
	hooks.setRealtimeDataChannel(dataChannel);
	hooks.setRealtimeConnected(true);
	hooks.setRealtimeResponseInProgress(true);

	assert.equal(hooks.expireRealtimeIdleTimeout(), false, "expected idle timeout not to disconnect during an active response");
	assert.equal(hooks.getRealtimeDebugState().connected, true);

	hooks.setRealtimeResponseInProgress(false);
	assert.equal(hooks.expireRealtimeIdleTimeout(), true, "expected idle timeout to disconnect once no response is active");
	assert.equal(hooks.getRealtimeDebugState().connected, false);
	assert.equal(hooks.getRealtimeDebugState().status, "Voice ended after idle");
	assert.equal(dataChannel.readyState, "closed");

	dom.window.close();
}

async function assertRealtimeSessionUsesRuntimeAgentMode() {
	const runtimeMessages = [];
	const events = [];
	const dom = await renderSidebar(createState(), runtimeMessages);
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	const audioConfig = hooks.getRealtimeInputAudioConfig();
	assert.equal(audioConfig.turn_detection?.type, "semantic_vad", "expected semantic VAD in Realtime-only mode");
	assert.equal(audioConfig.turn_detection?.eagerness, "medium", "expected Realtime to own turn timing");
	assert.equal(audioConfig.turn_detection?.create_response, false, "expected Onhand to trigger the grounded Realtime response after transcription");

	hooks.sendRealtimeSessionUpdate();
	const sessionUpdate = events.find((event) => event.type === "session.update");
	assert.ok(
		sessionUpdate?.session?.tools?.some((tool) => tool?.name === "browser_get_visible_text"),
		"expected page tools to be exposed to the live Realtime session",
	);
	assert.ok(
		sessionUpdate?.session?.tools?.some((tool) => tool?.name === "publish_sidebar_answer"),
		"expected Realtime session to publish its own sidebar answer",
	);
	assert.deepEqual(
		sessionUpdate?.session?.tool_choice,
		{ type: "function", name: "browser_get_visible_text" },
		"expected any leaked Realtime response to start with the page-read tool",
	);
	assert.match(sessionUpdate?.session?.instructions || "", /page-grounded browser agent/i);

	dom.window.close();
}

async function assertRealtimeVoiceTranscriptUsesRuntimeAgentAndNarratesCompletion() {
	const runtimeMessages = [];
	const events = [];
	const state = createState();
	state.tab = {
		id: 42,
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
	};
	state.page = {
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
		text: "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
	};
	const dom = await renderSidebar(state, runtimeMessages, { submitPromptRequestId: "request-voice-direct" });
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "input_audio_buffer.committed",
			item_id: "item-realtime-direct",
		}),
	);
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "item-realtime-direct",
			transcript: "What does Alpha smoke content mean here?",
		}),
	);
	await waitForSidebarTick(dom);

	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:submit-prompt"),
		false,
		"expected voice page question to wait for the merge window before submitting",
	);
	assert.equal(hooks.getRealtimeDebugState().activeVoiceTurn?.prompt, "What does Alpha smoke content mean here?");
	await flushRealtimeTranscript(hooks, dom);
	const submitMessage = runtimeMessages.find((message) => message?.type === "sidebar:submit-prompt");
	assert.ok(submitMessage, "expected voice page question to submit through Onhand's persisted answer pipeline");
	assert.equal(submitMessage.prompt, "What does Alpha smoke content mean here?");
	assert.equal(submitMessage.displayPrompt, "[Voice] What does Alpha smoke content mean here?");
	assert.equal(submitMessage.source, "realtime-voice-direct-answer");
	assert.equal(hooks.getRealtimeDebugState().pendingDirectAnswerRequestId, "request-voice-direct");
	assert.equal(
		events.some((event) => event.type === "response.create" && event.event_id?.includes("response_for_audio_transcript")),
		false,
		"expected no self-authored Realtime answer for the page-grounded transcript",
	);

	state.turns.push({
		id: "request-voice-direct",
		userPrompt: "[Voice] What does Alpha smoke content mean here?",
		reply: "Alpha smoke content is a fixture sentence that confirms the page tools can read visible text, create highlights, and restore artifacts for the smoke test.",
		activities: [
			{
				kind: "tool",
				toolName: "browser_highlight_text",
				label: "Highlighting the relevant passage...",
				state: "done",
			},
		],
		pageActions: [
			{
				key: "highlight:alpha",
				type: "highlight",
				text: "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
				pageTitle: "Alpha smoke fixture",
			},
		],
		pending: false,
		error: false,
		createdAt: "2026-05-12T10:06:00.000Z",
	});
	await hooks.requestState();
	await waitForSidebarTick(dom);

	const shadowText = dom.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot.textContent;
	assert.match(shadowText, /Alpha smoke content is a fixture sentence/, "expected completed voice answer to render in the sidebar");
	assert.equal(
		dom.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot.querySelector(".onhand-realtime-answer"),
		null,
		"expected completed direct voice answers to render only as saved Onhand turns",
	);
	assert.equal(
		events.some((event) => event.type === "response.create" && event.event_id?.includes("speak_onhand_answer") && event.response?.tool_choice === "none"),
		true,
		"expected the persisted Onhand answer to be narrated after it appears in the sidebar",
	);

	dom.window.close();
}

async function assertRealtimeUngroundedAudioIsCancelledAndRetried() {
	const runtimeMessages = [];
	const events = [];
	const state = createState();
	state.tab = {
		id: 42,
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
	};
	state.page = {
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
		text: "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
	};
	const dom = await renderSidebar(state, runtimeMessages);
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "What does Alpha smoke content mean here?",
		}),
	);
	await flushRealtimeTranscript(hooks, dom);
	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.created" }));
	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.output_audio.delta", delta: "abc" }));
	await waitForSidebarTick(dom);

	assert.equal(events.some((event) => event.type === "response.cancel"), true, "expected ungrounded audio to be cancelled before it speaks a page answer");
	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:realtime-record-turn"),
		false,
		"expected ungrounded audio not to persist as a completed turn",
	);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.done",
			response: {
				output: [{ content: [{ text: "This answer skipped the page tools." }] }],
			},
		}),
	);
	await waitForSidebarTick(dom);

	const retry = events.filter((event) => event.type === "response.create" && event.event_id?.includes("response_retry_ungrounded")).at(-1);
	assert.deepEqual(
		retry?.response?.tool_choice,
		{ type: "function", name: "browser_get_visible_text" },
		"expected cancelled ungrounded audio to retry with the forced page-read tool",
	);

	dom.window.close();
}

async function assertRealtimeTranscriptMergeWindowSubmitsMergedRuntimePrompt() {
	const runtimeMessages = [];
	const events = [];
	const state = createState();
	state.tab = {
		id: 42,
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
	};
	state.page = {
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
		text: "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
	};
	const dom = await renderSidebar(state, runtimeMessages, { submitPromptRequestId: "request-merged-direct" });
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "What does Alpha smoke",
		}),
	);
	await waitForSidebarTick(dom);
	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:submit-prompt"),
		false,
		"expected partial transcript handling to wait for the merge window",
	);

	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "input_audio_buffer.speech_started" }));
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "content mean here?",
		}),
	);
	await waitForSidebarTick(dom);
	assert.equal(
		hooks.getRealtimeDebugState().activeVoiceTurn?.prompt,
		"What does Alpha smoke content mean here?",
		"expected Realtime voice turn to merge transcript segments",
	);

	const submitMessages = runtimeMessages.filter((message) => message?.type === "sidebar:submit-prompt");
	assert.equal(submitMessages.length, 0, "expected no merged runtime submission before the merge window flushes");
	await flushRealtimeTranscript(hooks, dom);
	const flushedSubmitMessages = runtimeMessages.filter((message) => message?.type === "sidebar:submit-prompt");
	assert.equal(flushedSubmitMessages.length, 1, "expected one merged runtime submission after transcript flush");
	assert.equal(flushedSubmitMessages[0].prompt, "What does Alpha smoke content mean here?");
	assert.equal(flushedSubmitMessages[0].displayPrompt, "[Voice] What does Alpha smoke content mean here?");
	assert.equal(flushedSubmitMessages[0].source, "realtime-voice-direct-answer");
	assert.equal(hooks.getRealtimeDebugState().pendingDirectAnswerRequestId, "request-merged-direct");
	assert.equal(
		events.filter((event) => event.type === "response.create" && event.event_id?.includes("response_for_audio_transcript")).length,
		0,
		"expected merged transcript to use Onhand's persisted answer pipeline instead of live Realtime self-authoring",
	);

	dom.window.close();
}

async function assertRealtimePublishSidebarAnswerCanAnnotateAndCite() {
	const runtimeMessages = [];
	const events = [];
	const state = createState();
	state.tab = {
		id: 42,
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
	};
	state.page = {
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
		text: "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
	};
	const dom = await renderSidebar(state, runtimeMessages);
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "What does Alpha smoke content mean here?",
		}),
	);
	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.created" }));
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.function_call_arguments.done",
			call_id: "call-publish-answer",
			name: "publish_sidebar_answer",
			arguments: JSON.stringify({
				markdown:
					"Alpha smoke content is checking the fixture behavior: the source line confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
				status: "Voice answer",
				anchors: [
					{
						text: "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
						note: "This is the source line.",
						label: "Source",
					},
				],
			}),
		}),
	);
	await waitForSidebarTick(dom);

	assert.equal(
		runtimeMessages.some(
			(message) =>
				message?.type === "sidebar:realtime-annotate" &&
				message.anchors?.[0]?.text === "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
		),
		true,
		"expected publish_sidebar_answer anchors to create page annotations",
	);
	const recordTurnMessage = runtimeMessages.find((message) => message?.type === "sidebar:realtime-record-turn");
	assert.ok(recordTurnMessage, "expected published realtime answer to persist");
	assert.equal(recordTurnMessage.pageActions.some((action) => action?.key === "highlight:ann-realtime-alpha"), true);
	assert.equal(recordTurnMessage.pageActions.some((action) => action?.key === "note:ann-realtime-alpha"), true);

	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const shadow = host.shadowRoot;
	assert.ok(
		shadow.querySelector('.onhand-cite[data-action-key="note:ann-realtime-alpha"], .onhand-cite[data-action-key="highlight:ann-realtime-alpha"]'),
		"expected realtime voice answer to show an inline fallback citation even when the answer paraphrases the anchor",
	);
	assert.ok(
		shadow.querySelector('.onhand-realtime-sources [data-action-key="highlight:ann-realtime-alpha"]'),
		"expected realtime voice answer to expose source buttons",
	);

	dom.window.close();
}

async function assertRealtimeDirectAnswerFallsBackToEarlierSourceCitations() {
	const runtimeMessages = [];
	const events = [];
	const state = createState();
	state.tab = {
		id: 42,
		title: "BayesianDL",
		url: "https://example.test/bayesian-dl",
	};
	state.page = {
		title: "BayesianDL",
		url: "https://example.test/bayesian-dl",
		text: "Monte Carlo uses samples to estimate an expectation.",
	};
	const dom = await renderSidebar(state, runtimeMessages, { submitPromptRequestId: "request-prior-source-direct" });
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "The expectation bit?",
		}),
	);
	await flushRealtimeTranscript(hooks, dom);

	state.turns.push({
		id: "request-prior-source-direct",
		userPrompt: "[Voice] The expectation bit?",
		reply: "Monte Carlo uses samples to estimate an expectation.",
		activities: [
			{
				kind: "tool",
				toolName: "browser_highlight_text",
				label: "Highlighting the relevant passage...",
				state: "error",
			},
		],
		pageActions: [],
		pending: false,
		error: false,
		createdAt: "2026-05-12T10:05:00.000Z",
	});
	await hooks.requestState();
	await waitForSidebarTick(dom);

	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const realtimeAnswer = host.shadowRoot.querySelector(".onhand-realtime-answer");
	assert.equal(realtimeAnswer, null, "expected completed direct answer not to render a duplicate realtime card");
	assert.ok(
		host.shadowRoot.querySelector('.onhand-entry:not(.onhand-realtime-answer) .onhand-cite[data-action-key="highlight:second"]'),
		"expected saved direct answer to cite the earlier source when the current highlight failed",
	);
	assert.ok(
		host.shadowRoot.querySelector('.onhand-entry:not(.onhand-realtime-answer) .onhand-response [data-action-key="highlight:second"]'),
		"expected saved direct answer to expose a clickable earlier source citation",
	);

	dom.window.close();
}

async function assertRealtimeDirectAnswerPreambleQueuesFinalNarration() {
	const runtimeMessages = [];
	const events = [];
	const state = createState();
	state.tab = {
		id: 42,
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
	};
	state.page = {
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
		text: "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
	};
	const submit = createDeferred();
	const dom = await renderSidebar(state, runtimeMessages, {
		submitPromptResponse(message) {
			if (message?.type === "sidebar:submit-prompt") return submit.promise;
			return { ok: true };
		},
	});
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	const turnPromise = hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "What does Alpha smoke content mean here?",
		}),
	);
	await turnPromise;
	const flushPromise = hooks.flushRealtimePendingTranscript();
	await waitForSidebarTick(dom);

	assert.equal(events.some((event) => event.type === "response.create"), false, "expected no preamble before the latency threshold");
	await waitForRealtimePreambleDelay(dom);

	const preamblePrompt = events.find(
		(event) =>
			event.type === "conversation.item.create" &&
			String(event.item?.content?.[0]?.text || "").includes('Say exactly this sentence, with no extra words: "Let me ground that in the page."'),
	);
	assert.ok(preamblePrompt, "expected a delayed fixed preamble prompt while direct answer is pending");
	const preambleResponse = events.find((event) => event.type === "response.create" && event.event_id?.includes("backend_preamble"));
	assert.ok(preambleResponse, "expected delayed preamble to create a realtime response");
	assert.equal(preambleResponse.response?.tool_choice, "none", "expected preamble to disable tool calls");
	assert.equal(hooks.getRealtimeDebugState().suppressTranscriptForResponse, true, "expected preamble transcript to be suppressed");

	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.audio_transcript.delta", delta: "Let me anchor that first." }));
	await waitForSidebarTick(dom);
	assert.doesNotMatch(
		dom.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot.textContent,
		/Let me anchor that first/,
		"expected preamble transcript not to overwrite the pending Onhand answer card",
	);

	submit.resolve({ ok: true, requestId: "request-preamble-direct" });
	await flushPromise;
	state.turns.push({
		id: "request-preamble-direct",
		userPrompt: "[Voice] What does Alpha smoke content mean here?",
		reply: "Alpha smoke content is a fixture sentence that confirms extraction and annotation behavior.",
		activities: [],
		pageActions: [],
		pending: false,
		error: false,
		createdAt: "2026-05-12T10:09:00.000Z",
	});
	await hooks.requestState();
	await waitForSidebarTick(dom);

	assert.equal(hooks.getRealtimeDebugState().responseCreateQueued, true, "expected final narration to queue behind the preamble");
	assert.equal(hooks.getRealtimeDebugState().queuedResponseReason, "speak_onhand_answer");

	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.done", response: { output: [] } }));
	await waitForSidebarTick(dom);

	const finalResponse = events.filter((event) => event.type === "response.create").at(-1);
	assert.equal(finalResponse.event_id.includes("speak_onhand_answer"), true, "expected queued final response to keep its reason");
	assert.equal(finalResponse.response?.tool_choice, "none", "expected queued final response to preserve tool_choice");
	assert.equal(hooks.getRealtimeDebugState().suppressTranscriptForResponse, true, "expected final narration transcript to be suppressed");
	assert.match(
		String(finalResponse.response?.instructions || ""),
		/Speak only the provided Onhand answer text/,
		"expected queued final response to preserve exact narration instructions",
	);

	dom.window.close();
}

async function assertRealtimeExternalSourceRequestsCanNavigateFirst() {
	const runtimeMessages = [];
	const events = [];
	const state = createState();
	state.page = null;
	state.tab = {
		id: 42,
		title: "Blank tab",
		url: "about:blank",
	};
	const dom = await renderSidebar(state, runtimeMessages);
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	const options = hooks.getRealtimeInitialGroundedResponseOptions(
		"Could you take me to these sources and highlight the parts that talk about attention?",
	);
	assert.equal(options.tool_choice, "auto", "expected external-source requests not to force the current-page read first");
	assert.match(String(options.instructions || ""), /browse or navigate to external sources/i);
	assert.match(String(options.instructions || ""), /browser_navigate/);
	assert.doesNotMatch(String(options.instructions || ""), /Start by calling browser_get_visible_text/);

	await hooks.sendRealtimeTextPrompt("Could you take me to these sources and highlight the parts that talk about attention?");
	await waitForSidebarTick(dom);
	const response = events.find((event) => event.type === "response.create" && event.event_id?.includes("response_for_text"));
	assert.equal(response?.response?.tool_choice, "auto", "expected text prompt response to allow navigation as the first tool");
	assert.match(String(response?.response?.instructions || ""), /browse or navigate to external sources/i);

	dom.window.close();
}

async function assertRealtimeBrowserToolsCanAnnotateAndCite() {
	const runtimeMessages = [];
	const events = [];
	const state = createState();
	state.tab = {
		id: 42,
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
	};
	state.page = {
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
		text: "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
	};
	const dom = await renderSidebar(state, runtimeMessages);
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "Mark up where Alpha smoke content is explained.",
		}),
	);
	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.created" }));
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.function_call_arguments.done",
			call_id: "call-browser-visible-text",
			name: "browser_get_visible_text",
			arguments: JSON.stringify({ maxChars: 4000 }),
		}),
	);
	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.done", response: { output: [] } }));
	await waitForSidebarTick(dom);

	const answerResponse = events
		.filter((event) => event.type === "response.create" && event.event_id?.includes("response_after_tool"))
		.at(-1);
	assert.deepEqual(
		answerResponse?.response?.tool_choice,
		{ type: "function", name: "publish_sidebar_answer" },
		"expected a readable Realtime page read to auto-anchor before forcing the complete sidebar answer",
	);
	assert.deepEqual(answerResponse?.response?.output_modalities, ["text"], "expected final Realtime publish step to be text-only");
	assert.match(
		String(answerResponse?.response?.instructions || ""),
		/complete answer/i,
		"expected follow-up instructions to require a complete answer",
	);
	assert.equal(
		runtimeMessages.some(
			(message) =>
				message?.type === "sidebar:realtime-browser-tool" &&
				message.tool === "browser_highlight_text" &&
				message.command === "highlight_text" &&
				message.args?.text === "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
		),
		true,
		"expected the extension to auto-highlight exact visible text after the Realtime page read",
	);
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.function_call_arguments.done",
			call_id: "call-browser-highlight",
			name: "browser_highlight_text",
			arguments: JSON.stringify({
				text: "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
				scrollIntoView: true,
			}),
		}),
	);
	await waitForSidebarTick(dom);
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.function_call_arguments.done",
			call_id: "call-browser-note",
			name: "browser_show_note",
			arguments: JSON.stringify({
				annotationId: "ann-realtime-alpha",
				note: "Fixture source line.",
				label: "Source",
			}),
		}),
	);
	await waitForSidebarTick(dom);
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.function_call_arguments.done",
			call_id: "call-browser-publish",
			name: "publish_sidebar_answer",
			arguments: JSON.stringify({
				markdown:
					"This line is the fixture source for the smoke test because it explicitly mentions readable extraction, visible text, highlighting, notes, and artifact restore.",
				status: "Voice answer",
			}),
		}),
	);
	await waitForSidebarTick(dom);

	assert.equal(
		runtimeMessages.some(
			(message) =>
				message?.type === "sidebar:realtime-browser-tool" &&
				message.tool === "browser_highlight_text" &&
				message.command === "highlight_text" &&
				message.args?.text === "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
		),
		true,
		"expected Realtime browser_highlight_text to call the extension browser runtime",
	);
	assert.equal(
		runtimeMessages.some(
			(message) =>
				message?.type === "sidebar:realtime-browser-tool" &&
				message.tool === "browser_show_note" &&
				message.command === "show_note" &&
				message.args?.annotationId === "ann-realtime-alpha",
		),
		true,
		"expected Realtime browser_show_note to call the extension browser runtime",
	);
	const highlightOutput = events.find((event) => event.type === "conversation.item.create" && event.item?.call_id === "call-browser-highlight");
	assert.match(String(highlightOutput?.item?.output || ""), /annotationId/, "expected browser highlight result to include annotation id for follow-up note tool calls");
	const recordTurnMessage = runtimeMessages.find((message) => message?.type === "sidebar:realtime-record-turn");
	assert.ok(recordTurnMessage, "expected published realtime answer to persist");
	assert.equal(recordTurnMessage.pageActions.some((action) => action?.key === "highlight:ann-realtime-alpha"), true);
	assert.equal(recordTurnMessage.pageActions.some((action) => action?.key === "note:ann-realtime-alpha"), true);

	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	const shadow = host.shadowRoot;
	assert.ok(
		shadow.querySelector('.onhand-realtime-sources [data-action-key="highlight:ann-realtime-alpha"]'),
		"expected browser-tool source strip to expose the highlight",
	);
	assert.ok(
		shadow.querySelector('.onhand-realtime-sources [data-action-key="note:ann-realtime-alpha"]'),
		"expected browser-tool source strip to expose the note",
	);

	dom.window.close();
}

async function assertRealtimeBrowserHighlightRepairsNearQuoteFromVisibleText() {
	const runtimeMessages = [];
	const events = [];
	const exactLine = "The multi-head self-attention mechanism constructs multiple weighted graphs in parallel:";
	const state = createState();
	state.tab = {
		id: 42,
		title: "Transformers notes",
		url: "https://example.test/transformers",
	};
	state.page = {
		title: "Transformers notes",
		url: "https://example.test/transformers",
		text: `${exactLine}\nMulti-head attention uses several attention patterns at the same time.`,
	};
	const dom = await renderSidebar(state, runtimeMessages, {
		realtimeBrowserToolResponse(message, currentState) {
			const tab = { id: 42, title: "Transformers notes", url: "https://example.test/transformers", windowId: 1 };
			if (message.tool === "browser_get_visible_text") {
				return { ok: true, result: { tab, visible: { text: currentState.page.text } } };
			}
			if (message.tool === "browser_highlight_text") {
				if (message.args?.text !== exactLine) {
					return { ok: false, error: `No visible text matched: ${message.args?.text || ""}` };
				}
				return {
					ok: true,
					result: {
						tab,
						annotation: {
							annotationId: "ann-realtime-transformers",
							text: exactLine,
							matchedText: exactLine,
						},
					},
				};
			}
			return { ok: true, result: { tab } };
		},
	});
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.function_call_arguments.done",
			call_id: "call-browser-visible-text-repair",
			name: "browser_get_visible_text",
			arguments: JSON.stringify({ maxChars: 4000 }),
		}),
	);
	await waitForSidebarTick(dom);
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.function_call_arguments.done",
			call_id: "call-browser-highlight-repair",
			name: "browser_highlight_text",
			arguments: JSON.stringify({
				text: "multi-head attention constructs multiple weighted graphs in parallel",
				scrollIntoView: true,
			}),
		}),
	);
	await waitForSidebarTick(dom);

	const highlightMessages = runtimeMessages.filter((message) => message?.type === "sidebar:realtime-browser-tool" && message.tool === "browser_highlight_text");
	assert.equal(highlightMessages.length, 2, "expected Realtime highlight to retry a near-quote with an exact visible line");
	assert.equal(highlightMessages[0].args?.text, "multi-head attention constructs multiple weighted graphs in parallel");
	assert.equal(highlightMessages[1].args?.text, exactLine);
	const output = events.find((event) => event.type === "conversation.item.create" && event.item?.call_id === "call-browser-highlight-repair");
	assert.match(String(output?.item?.output || ""), /ann-realtime-transformers/, "expected repaired highlight result to be returned to Realtime");
	assert.match(String(output?.item?.output || ""), /highlightRetry/, "expected repaired highlight result to disclose the retry");

	dom.window.close();
}

async function assertRealtimeAutoAnchorPrefersQuestionRelevantVisibleLine() {
	const runtimeMessages = [];
	const events = [];
	const exactLine = "The multi-head self-attention mechanism constructs multiple weighted graphs in parallel:";
	const genericLine = "Formally, a transformer block operates on a sequence of token embeddings X = [x1, x2, ..., xn] where n is the sequence length and d is the embedding dimension.";
	const state = createState();
	state.tab = {
		id: 42,
		title: "Transformers notes",
		url: "https://example.test/transformers",
	};
	state.page = {
		title: "Transformers notes",
		url: "https://example.test/transformers",
		text: `${genericLine}\n4.1. Self-Attention as Multiple Graphs (Multiple Attention Heads)\n${exactLine}\nSingle-headed attention uses one attention map instead of multiple parallel heads.`,
	};
	const dom = await renderSidebar(state, runtimeMessages);
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "What's the difference between single-headed attention and multi-headed attention?",
		}),
	);
	await flushRealtimeTranscript(hooks, dom);
	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.created" }));
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.function_call_arguments.done",
			call_id: "call-transformers-visible-text",
			name: "browser_get_visible_text",
			arguments: JSON.stringify({ maxChars: 4000 }),
		}),
	);
	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.done", response: { output: [] } }));
	await waitForSidebarTick(dom);

	const highlightMessages = runtimeMessages.filter((message) => message?.type === "sidebar:realtime-browser-tool" && message.tool === "browser_highlight_text");
	assert.equal(highlightMessages[0]?.args?.text, exactLine, "expected auto-anchor to prefer the multi-head evidence line over the generic transformer-block paragraph");
	const answerResponse = events.filter((event) => event.type === "response.create" && event.event_id?.includes("response_after_tool")).at(-1);
	assert.deepEqual(answerResponse?.response?.tool_choice, { type: "function", name: "publish_sidebar_answer" });
	assert.deepEqual(answerResponse?.response?.output_modalities, ["text"]);

	dom.window.close();
}

async function assertRealtimeRejectsPreambleOnlyPublishedAnswer() {
	const runtimeMessages = [];
	const events = [];
	const exactLine = "The multi-head self-attention mechanism constructs multiple weighted graphs in parallel:";
	const state = createState();
	state.tab = {
		id: 42,
		title: "Transformers notes",
		url: "https://example.test/transformers",
	};
	state.page = {
		title: "Transformers notes",
		url: "https://example.test/transformers",
		text: `${exactLine}\nSingle-headed attention uses one attention map instead of multiple parallel heads.`,
	};
	const dom = await renderSidebar(state, runtimeMessages);
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "What's the difference between single-headed attention and multi-headed attention?",
		}),
	);
	await flushRealtimeTranscript(hooks, dom);
	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.created" }));
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.function_call_arguments.done",
			call_id: "call-visible-before-preamble",
			name: "browser_get_visible_text",
			arguments: JSON.stringify({ maxChars: 4000 }),
		}),
	);
	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.done", response: { output: [] } }));
	await waitForSidebarTick(dom);

	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.created" }));
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.function_call_arguments.done",
			call_id: "call-preamble-publish",
			name: "publish_sidebar_answer",
			arguments: JSON.stringify({
				markdown: "Let me quickly lay out the core difference in how they process information.",
				status: "Voice answer",
			}),
		}),
	);
	await waitForSidebarTick(dom);

	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:realtime-record-turn"),
		false,
		"expected preamble-only publish_sidebar_answer not to persist",
	);
	const toolOutput = events.find((event) => event.type === "conversation.item.create" && event.item?.call_id === "call-preamble-publish");
	assert.match(String(toolOutput?.item?.output || ""), /incomplete_answer/, "expected Realtime to be told the publish call was incomplete");
	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.done", response: { output: [] } }));
	await waitForSidebarTick(dom);
	const retry = events.filter((event) => event.type === "response.create" && event.event_id?.includes("response_retry_complete_answer")).at(-1);
	assert.deepEqual(retry?.response?.tool_choice, { type: "function", name: "publish_sidebar_answer" });
	assert.deepEqual(retry?.response?.output_modalities, ["text"]);
	assert.match(String(retry?.response?.instructions || ""), /complete answer/i);

	dom.window.close();
}

async function assertRealtimeSpokenAnswerWithoutPublishRemainsVisible() {
	const runtimeMessages = [];
	const events = [];
	const exactLine = "The multi-head self-attention mechanism constructs multiple weighted graphs in parallel:";
	const finalAnswer =
		"Single-headed attention uses one attention pattern or map to decide which tokens influence each other. Multi-headed attention runs several attention heads in parallel, so different heads can learn different relation patterns from the same sequence at the same time.";
	const state = createState();
	state.tab = {
		id: 42,
		title: "Transformers notes",
		url: "https://example.test/transformers",
	};
	state.page = {
		title: "Transformers notes",
		url: "https://example.test/transformers",
		text: `${exactLine}\nSingle-headed attention uses one attention map instead of multiple parallel heads.`,
	};
	const dom = await renderSidebar(state, runtimeMessages, {
		realtimeRecordTurnResponse(message) {
			return {
				ok: true,
				result: {
					turn: {
						id: message.voiceTurnId,
						userPrompt: message.userPrompt,
						reply: message.reply,
						pageActions: message.pageActions || [],
					},
				},
			};
		},
	});
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "What's the difference between single-headed attention and multi-headed attention?",
		}),
	);
	await flushRealtimeTranscript(hooks, dom);
	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.created" }));
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.function_call_arguments.done",
			call_id: "call-visible-before-spoken-answer",
			name: "browser_get_visible_text",
			arguments: JSON.stringify({ maxChars: 4000 }),
		}),
	);
	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.done", response: { output: [] } }));
	await waitForSidebarTick(dom);

	const answerResponse = events.filter((event) => event.type === "response.create" && event.event_id?.includes("response_after_tool")).at(-1);
	assert.deepEqual(answerResponse?.response?.tool_choice, { type: "function", name: "publish_sidebar_answer" });
	assert.deepEqual(answerResponse?.response?.output_modalities, ["text"]);

	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.created" }));
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.output_audio_transcript.delta",
			delta: finalAnswer,
		}),
	);
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.output_audio_transcript.done",
			transcript: finalAnswer,
		}),
	);
	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.done", response: { output: [] } }));
	await waitForSidebarTick(dom);

	const recordTurnMessage = runtimeMessages.find((message) => message?.type === "sidebar:realtime-record-turn");
	assert.ok(recordTurnMessage, "expected spoken Realtime answer to persist even without publish_sidebar_answer");
	assert.equal(recordTurnMessage.reply, finalAnswer);
	assert.equal(recordTurnMessage.pageActions.some((action) => action?.key === "highlight:ann-realtime-alpha"), true);
	assert.equal(state.turns.some((turn) => turn.id === recordTurnMessage.voiceTurnId), false, "test fixture intentionally simulates a stale state refresh");
	const shadow = dom.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot;
	const liveAnswer = shadow.querySelector(".onhand-realtime-answer");
	assert.ok(liveAnswer, "expected live Realtime answer to remain visible until the saved turn is visible in state");
	assert.match(liveAnswer.textContent, /Single-headed attention uses one attention pattern/);
	assert.ok(
		liveAnswer.querySelector('.onhand-realtime-sources [data-action-key="highlight:ann-realtime-alpha"]'),
		"expected the visible live answer to keep its highlighted source",
	);

	dom.window.close();
}

async function assertRealtimeTextOnlyAnswerFallbackPersistsAndNarrates() {
	const runtimeMessages = [];
	const events = [];
	const exactLine = "The multi-head self-attention mechanism constructs multiple weighted graphs in parallel:";
	const finalAnswer =
		"Single-headed attention uses one attention pattern or map. Multi-headed attention runs several attention heads in parallel, so different heads can learn different relationship patterns at the same time.";
	const state = createState();
	state.tab = {
		id: 42,
		title: "Transformers notes",
		url: "https://example.test/transformers",
	};
	state.page = {
		title: "Transformers notes",
		url: "https://example.test/transformers",
		text: `${exactLine}\nSingle-headed attention uses one attention map instead of multiple parallel heads.`,
	};
	const dom = await renderSidebar(state, runtimeMessages, {
		realtimeRecordTurnResponse(message) {
			return {
				ok: true,
				result: {
					turn: {
						id: message.voiceTurnId,
						userPrompt: message.userPrompt,
						reply: message.reply,
						pageActions: message.pageActions || [],
					},
				},
			};
		},
	});
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "What's the difference between single-headed attention and multi-headed attention?",
		}),
	);
	await flushRealtimeTranscript(hooks, dom);
	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.created" }));
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.function_call_arguments.done",
			call_id: "call-visible-before-text-answer",
			name: "browser_get_visible_text",
			arguments: JSON.stringify({ maxChars: 4000 }),
		}),
	);
	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.done", response: { output: [] } }));
	await waitForSidebarTick(dom);

	const answerResponse = events.filter((event) => event.type === "response.create" && event.event_id?.includes("response_after_tool")).at(-1);
	assert.deepEqual(answerResponse?.response?.tool_choice, { type: "function", name: "publish_sidebar_answer" });
	assert.deepEqual(answerResponse?.response?.output_modalities, ["text"]);

	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.created" }));
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.output_text.done",
			text: finalAnswer,
		}),
	);
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.done",
			response: {
				output: [{ content: [{ type: "output_text", text: finalAnswer }] }],
			},
		}),
	);
	await waitForSidebarTick(dom);

	const recordTurnMessage = runtimeMessages.find((message) => message?.type === "sidebar:realtime-record-turn");
	assert.ok(recordTurnMessage, "expected text-only Realtime fallback answer to persist");
	assert.equal(recordTurnMessage.reply, finalAnswer);
	assert.equal(recordTurnMessage.pageActions.some((action) => action?.key === "highlight:ann-realtime-alpha"), true);
	assert.ok(
		events.some((event) => event.type === "response.create" && event.event_id?.includes("speak_published_realtime_answer")),
		"expected text-only fallback answer to be narrated after it is written to the sidebar",
	);

	dom.window.close();
}

async function assertRealtimePdfToolsOpenViewerAndReturnResults() {
	const runtimeMessages = [];
	const events = [];
	const state = createState();
	state.tab = {
		id: 9,
		title: "Native PDF",
		url: "https://example.test/paper.pdf",
	};
	state.page = null;
	state.pageCaptureError = "Onhand page tools only run on http/https tabs, not native PDF";
	const dom = await renderSidebar(state, runtimeMessages, {
		openPdfViewerResponse() {
			state.tab = {
				id: 9,
				title: "paper.pdf - Onhand PDF Viewer",
				url: "chrome-extension://extension-id/pdf-viewer.html?url=https%3A%2F%2Fexample.test%2Fpaper.pdf",
			};
			state.page = {
				surface: "pdf",
				viewer: "onhand-pdf-viewer",
				url: "https://example.test/paper.pdf",
				title: "paper.pdf - Onhand PDF Viewer",
				text: "Recurrent neural networks preserve sequence state across tokens.",
			};
			state.pageCaptureError = "";
			return {
				ok: true,
				result: {
					tab: state.tab,
					pdfUrl: "https://example.test/paper.pdf",
					opened: true,
				},
			};
		},
	});
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.created",
		}),
	);
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.function_call_arguments.done",
			call_id: "call-open-pdf",
			name: "browser_open_pdf_in_onhand_viewer",
			arguments: "{}",
		}),
	);
	await waitForSidebarTick(dom);

	const openIndex = runtimeMessages.findIndex((message) => message?.type === "sidebar:realtime-browser-tool" && message.tool === "browser_open_pdf_in_onhand_viewer");
	assert.ok(openIndex >= 0, "expected realtime PDF prompt to open the PDF viewer first");
	assert.equal(
		events.some(
			(event) =>
				event.type === "conversation.item.create" &&
				event.item?.type === "function_call_output" &&
				event.item?.call_id === "call-open-pdf" &&
				String(event.item?.output || "").includes('"opened":true'),
		),
		true,
		"expected PDF viewer handoff result to be returned to Realtime",
	);
	assert.equal(hooks.getRealtimeDebugState().responseCreateQueued, true, "expected PDF tool follow-up response to queue behind active response");
	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.done", response: { output: [] } }));
	await waitForSidebarTick(dom);
	assert.equal(events.some((event) => event.type === "response.create"), true, "expected Realtime to continue after PDF tool result");

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.function_call_arguments.done",
			call_id: "call-search-pdf",
			name: "browser_pdf_search",
			arguments: JSON.stringify({ query: "recurrent neural networks" }),
		}),
	);
	await waitForSidebarTick(dom);

	assert.equal(
		runtimeMessages.some(
			(message) =>
				message?.type === "sidebar:realtime-browser-tool" &&
				message.tool === "browser_pdf_search" &&
				message.command === "pdf_search" &&
				message.args?.query === "recurrent neural networks",
		),
		true,
		"expected Realtime PDF search tool to call the extension PDF adapter",
	);
	assert.equal(
		events.some((event) => event.type === "conversation.item.create" && event.item?.call_id === "call-search-pdf"),
		true,
		"expected PDF search result to be returned to Realtime",
	);

	dom.window.close();
}

async function assertRealtimeExplicitLearningVoiceTranscriptPlansSocraticMove() {
	const runtimeMessages = [];
	const events = [];
	const state = createLearningState();
	state.tab = {
		id: 42,
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
	};
	state.page = {
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
		text: "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
	};
	const dom = await renderSidebar(state, runtimeMessages);
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "Quiz me on Alpha smoke content.",
		}),
	);
	await waitForSidebarTick(dom);

	assert.equal(
		runtimeMessages.some(
			(message) => message?.type === "sidebar:realtime-plan-pedagogical-move" && message.userQuestion === "Quiz me on Alpha smoke content.",
		),
		false,
		"expected explicit Learning Mode quiz request to stay inside the live Realtime session",
	);
	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:submit-prompt"),
		false,
		"expected Learning Mode voice not to use direct answer submit-prompt",
	);
	assert.equal(hooks.getRealtimeDebugState().pendingSocraticMove, null);
	assert.equal(hooks.getRealtimeDebugState().activeVoiceTurn?.prompt, "Quiz me on Alpha smoke content.");

	dom.window.close();
}

async function assertRealtimeLearningVoiceResponseEvaluatesOpenSocraticMove() {
	const runtimeMessages = [];
	const events = [];
	const state = createLearningState();
	state.tab = {
		id: 42,
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
	};
	state.page = {
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
		text: "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
	};
	const dom = await renderSidebar(state, runtimeMessages, {
		realtimeEvaluateResponse() {
			return {
				ok: true,
				result: {
					evaluation: {
						correct_points: [{ concept: "Alpha smoke content", anchor_text: "confirms readable extraction" }],
						missed_points: [],
						next_move: "move_on",
						feedback_summary: "Correct: it says the fixture confirms extraction and annotations work.",
						voice_script: "Short alternate narration that should not be used.",
						sidebar_markdown: "Correct: it says the fixture confirms extraction and annotations work.",
						assessment: "correct",
						evidence: "The student connected Alpha smoke content to fixture validation.",
					},
				},
			};
		},
	});
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "What does Alpha smoke content mean here?",
		}),
	);
	await flushRealtimeTranscript(hooks, dom);
	assert.ok(hooks.getRealtimeDebugState().pendingSocraticMove, "expected a pending Socratic move after planner turn");

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "It checks that extraction and highlighting work.",
		}),
	);
	await flushRealtimeTranscript(hooks, dom);

	assert.equal(
		runtimeMessages.some(
			(message) =>
				message?.type === "sidebar:realtime-evaluate-response" &&
				message.userResponse === "It checks that extraction and highlighting work." &&
				message.previousMove?.voice_script === "What does this line say Alpha smoke content is checking?",
		),
		true,
		"expected answer to an open Socratic prompt to call evaluator",
	);
	assert.equal(
		runtimeMessages.some(
			(message) =>
				message?.type === "sidebar:realtime-record-learning-event" &&
				message.event?.kind === "check_resolved" &&
				message.event?.checkId === "check-realtime-alpha" &&
				message.event?.assessment === "correct",
		),
		true,
		"expected evaluator result to resolve the open learner check",
	);
	assert.equal(hooks.getRealtimeDebugState().pendingSocraticMove, null);
	assert.equal(hooks.getRealtimeDebugState().status, "Speaking tutor feedback...");
	assert.equal(state.learnerState.openChecks.some((check) => check.checkId === "check-realtime-alpha"), false);
	assert.equal(state.learnerState.responses.some((response) => response.checkId === "check-realtime-alpha" && response.assessment === "correct"), true);
	assert.equal(
		events.some(
			(event) =>
				event.type === "conversation.item.create" &&
				String(event.item?.content?.[0]?.text || "").includes("Speak this Learning Mode feedback exactly as written below.") &&
				String(event.item?.content?.[0]?.text || "").includes("Correct: it says the fixture confirms extraction and annotations work."),
		),
		true,
		"expected canonical evaluator feedback to be sent to realtime for narration",
	);
	assert.equal(
		events.some(
			(event) =>
				event.type === "conversation.item.create" &&
				String(event.item?.content?.[0]?.text || "").includes("Short alternate narration that should not be used"),
		),
		false,
		"expected evaluator voice_script not to replace the saved sidebar feedback",
	);
	assert.equal(hooks.getRealtimeDebugState().suppressTranscriptForResponse, true, "expected saved tutor feedback narration transcript to be suppressed");
	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "response.audio_transcript.delta", delta: "DUPLICATE NARRATION TEXT" }));
	await waitForSidebarTick(dom);
	const shadow = dom.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot;
	assert.doesNotMatch(
		shadow.textContent,
		/DUPLICATE NARRATION TEXT/,
		"expected narration transcript not to create a second visible answer",
	);
	assert.equal(shadow.querySelector(".onhand-realtime-answer"), null, "expected saved tutor feedback not to leave a duplicate realtime answer card");

	dom.window.close();
}

async function assertRealtimeStandaloneVoiceAnswerPersistsToSession() {
	const runtimeMessages = [];
	const events = [];
	const state = createState();
	const dom = await renderSidebar(state, runtimeMessages);
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.sendRealtimeTextPrompt("Can you check whether my calendar is available tomorrow at 3?");
	await waitForSidebarTick(dom);
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.done",
			response: {
				output: [{ content: [{ text: "That tutoring slot is available." }] }],
			},
		}),
	);
	await waitForSidebarTick(dom);

	const recordTurnMessage = runtimeMessages.find((message) => message?.type === "sidebar:realtime-record-turn");
	assert.ok(recordTurnMessage, "expected standalone realtime voice answer to be persisted as a session turn");
	assert.equal(recordTurnMessage.userPrompt, "[Voice] Can you check whether my calendar is available tomorrow at 3?");
	assert.equal(recordTurnMessage.reply, "That tutoring slot is available.");
	assert.equal(
		state.turns.some(
			(turn) =>
				turn.userPrompt === "[Voice] Can you check whether my calendar is available tomorrow at 3?" &&
				turn.reply === "That tutoring slot is available.",
		),
		true,
		"expected saved voice prompt and answer to remain in session turns",
	);

	dom.window.close();
}

async function assertRealtimeAnswerClearsWhenSessionChanges() {
	const runtimeMessages = [];
	const events = [];
	const state = createState();
	const dom = await renderSidebar(state, runtimeMessages);
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.sendRealtimeTextPrompt("Can you check whether my calendar is available tomorrow at 4?");
	await waitForSidebarTick(dom);
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "response.done",
			response: {
				output: [{ content: [{ text: "That tutoring slot is available." }] }],
			},
		}),
	);
	await waitForSidebarTick(dom);
	assert.match(dom.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot.textContent, /That tutoring slot is available/);

	state.currentSession = {
		sessionId: "session-fresh",
		sessionName: "Fresh session",
	};
	state.turns = [];
	state.pageActions = [];
	await hooks.requestState();
	await waitForSidebarTick(dom);

	const shadow = dom.window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot;
	assert.equal(shadow.getElementById("replySection").hidden, true, "expected stale realtime answer card to hide after session switch");
	assert.doesNotMatch(shadow.textContent, /That tutoring slot is available/, "expected previous voice answer not to appear in a fresh session");

	dom.window.close();
}

async function assertRealtimeStaleDirectAnswerDoesNotNarrateOldTurn() {
	const runtimeMessages = [];
	const events = [];
	const state = createState();
	state.tab = {
		id: 42,
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
	};
	state.page = {
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
		text: "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
	};
	const dom = await renderSidebar(state, runtimeMessages, { submitPromptRequestId: "request-stale-direct" });
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.sendRealtimeTextPrompt("What does Alpha smoke content mean here?");
	await waitForSidebarTick(dom);
	assert.equal(hooks.getRealtimeDebugState().pendingDirectAnswerRequestId, "request-stale-direct");

	await hooks.sendRealtimeTextPrompt("Can you check whether my calendar is available tomorrow at 3?");
	await waitForSidebarTick(dom);
	state.turns.push({
		id: "request-stale-direct",
		userPrompt: "[Voice] What does Alpha smoke content mean here?",
		reply: "Old page-grounded answer that should not be narrated after interruption.",
		activities: [],
		pageActions: [],
		pending: false,
		error: false,
		createdAt: "2026-05-12T10:08:00.000Z",
	});
	await hooks.requestState();
	await waitForSidebarTick(dom);

	assert.equal(
		events.some(
			(event) =>
				event.type === "conversation.item.create" &&
				String(event.item?.content?.[0]?.text || "").includes("Old page-grounded answer that should not be narrated"),
		),
		false,
		"expected stale direct-answer result not to trigger realtime narration",
	);
	assert.equal(hooks.getRealtimeDebugState().pendingDirectAnswerRequestId, "");

	dom.window.close();
}

async function assertRealtimeStalePlannerResultDoesNotAnnotateOrPersist() {
	const runtimeMessages = [];
	const events = [];
	const state = createLearningState();
	state.tab = {
		id: 42,
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
	};
	state.page = {
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
		text: "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
	};
	const firstPlan = createDeferred();
	const secondMove = {
		anchor: {
			text_excerpt: "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
			kind: "question_anchor",
			note: "Key evidence for this question.",
		},
		move_type: "prediction_prompt",
		voice_script: "What does the second question ask you to notice?",
		sidebar_markdown: "**Your turn:** What does the second question ask you to notice?",
		expected_concepts: ["Second question"],
		stuck_fallback: "Focus on the highlighted wording.",
		misconceptions: [],
	};
	const dom = await renderSidebar(state, runtimeMessages, {
		realtimePlanResponse(message) {
			if (message.userQuestion.includes("first")) return firstPlan.promise;
			return { ok: true, result: { move: secondMove } };
		},
	});
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "What does the first question mean?",
		}),
	);
	const stalePlanPromise = hooks.flushRealtimePendingTranscript();
	await waitForSidebarTick(dom);
	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "What does the second question mean?",
		}),
	);
	const currentPlanPromise = hooks.flushRealtimePendingTranscript();
	await currentPlanPromise;
	firstPlan.resolve({
		ok: true,
		result: {
			move: {
				...secondMove,
				voice_script: "This stale first prompt should not be used.",
				sidebar_markdown: "**Your turn:** This stale first prompt should not be used.",
			},
		},
	});
	await stalePlanPromise;
	await waitForSidebarTick(dom);

	const annotateMessages = runtimeMessages.filter((message) => message?.type === "sidebar:realtime-annotate");
	const recordTurnMessages = runtimeMessages.filter((message) => message?.type === "sidebar:realtime-record-turn");
	assert.equal(annotateMessages.length, 1, "expected only the newer planner result to annotate the page");
	assert.equal(recordTurnMessages.length, 1, "expected only the newer planner result to persist a voice turn");
	assert.equal(recordTurnMessages[0].userPrompt, "[Voice] What does the second question mean?");
	assert.equal(
		events.some(
			(event) =>
				event.type === "conversation.item.create" &&
				String(event.item?.content?.[0]?.text || "").includes("This stale first prompt should not be used"),
		),
		false,
		"expected stale planner result not to be narrated",
	);

	dom.window.close();
}

async function assertRealtimeStaleEvaluatorResultDoesNotResolveLearnerState() {
	const runtimeMessages = [];
	const events = [];
	const state = createLearningState();
	state.tab = {
		id: 42,
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
	};
	state.page = {
		title: "Alpha smoke fixture",
		url: "http://127.0.0.1:8765/",
		text: "Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore.",
	};
	const evaluation = createDeferred();
	const dom = await renderSidebar(state, runtimeMessages, {
		realtimeEvaluateResponse() {
			return evaluation.promise;
		},
	});
	const hooks = getRealtimeTestHooks(dom);
	hooks.setRealtimeDataChannel(createRealtimeTestDataChannel(events));
	hooks.setRealtimeConnected(true);

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "What does Alpha smoke content mean here?",
		}),
	);
	await flushRealtimeTranscript(hooks, dom);
	assert.ok(hooks.getRealtimeDebugState().pendingSocraticMove, "expected an open Socratic move before evaluator test");
	const recordsBefore = runtimeMessages.filter((message) => message?.type === "sidebar:realtime-record-learning-event").length;

	await hooks.handleRealtimeServerEvent(
		JSON.stringify({
			type: "conversation.item.input_audio_transcription.completed",
			transcript: "It checks extraction.",
		}),
	);
	const staleEvaluationPromise = hooks.flushRealtimePendingTranscript();
	await waitForSidebarTick(dom);
	await hooks.handleRealtimeServerEvent(JSON.stringify({ type: "input_audio_buffer.speech_started" }));
	evaluation.resolve({
		ok: true,
		result: {
			evaluation: {
				correct_points: [],
				missed_points: [],
				next_move: "move_on",
				feedback_summary: "This stale evaluator feedback should not be applied.",
				voice_script: "This stale evaluator feedback should not be applied.",
				sidebar_markdown: "This stale evaluator feedback should not be applied.",
				assessment: "correct",
				evidence: "stale",
			},
		},
	});
	await staleEvaluationPromise;
	await waitForSidebarTick(dom);

	const recordsAfter = runtimeMessages.filter((message) => message?.type === "sidebar:realtime-record-learning-event").length;
	assert.equal(recordsAfter, recordsBefore, "expected stale evaluator result not to resolve learner state");
	assert.equal(
		events.some(
			(event) =>
				event.type === "conversation.item.create" &&
				String(event.item?.content?.[0]?.text || "").includes("This stale evaluator feedback should not be applied"),
		),
		false,
		"expected stale evaluator feedback not to be narrated",
	);

	dom.window.close();
}

async function assertQuickOpenFocusesComposer() {
	const runtimeMessages = [];
	const dom = await renderSidebar(createState(), runtimeMessages);
	const host = dom.window.document.getElementById("onhand-extension-sidebar-host");
	const shadow = host.shadowRoot;
	const menuButton = shadow.getElementById("menuButton");
	const menuPanel = shadow.getElementById("menuPanel");
	const input = shadow.getElementById("input");
	const request = {
		id: "quick-open-test",
		windowId: 1,
		target: "composer",
		createdAt: Date.now(),
	};

	menuButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	assert.equal(menuPanel.hidden, false, "expected menu to be open before quick-open message");
	await dom.dispatchRuntimeMessage({ type: "sidebar:quick-open", request });

	assert.equal(menuPanel.hidden, true, "expected quick open to close the menu");
	assert.equal(shadow.activeElement, input, "expected quick open to focus the composer input");
	assert.equal(dom.getStorageValue("onhandSidebarQuickOpenRequest"), undefined, "expected handled quick-open request to be cleared");

	dom.window.close();

	const startupRequest = {
		id: "quick-open-startup-test",
		windowId: 1,
		target: "composer",
		createdAt: Date.now(),
	};
	const startupDom = await renderSidebar(createState(), [], {
		storage: { onhandSidebarQuickOpenRequest: startupRequest },
	});
	const startupHost = startupDom.window.document.getElementById("onhand-extension-sidebar-host");
	const startupShadow = startupHost.shadowRoot;
	const startupInput = startupShadow.getElementById("input");
	await new Promise((resolve) => startupDom.window.setTimeout(resolve, 150));
	assert.equal(startupShadow.activeElement, startupInput, "expected startup quick open to survive initial state render");
	assert.equal(startupDom.getStorageValue("onhandSidebarQuickOpenRequest"), undefined, "expected startup quick-open request to be cleared");
	startupInput.blur();
	startupDom.window.dispatchEvent(new startupDom.window.KeyboardEvent("keydown", { key: "x", bubbles: true }));
	assert.equal(startupInput.value, "x", "expected quick-open key capture to route document typing into the composer");
	startupDom.window.close();
}

async function assertMenuClosesOnOutsidePointer() {
	const runtimeMessages = [];
	const dom = await renderSidebar(createState(), runtimeMessages);
	const host = dom.window.document.getElementById("onhand-extension-sidebar-host");
	const shadow = host.shadowRoot;
	const menuButton = shadow.getElementById("menuButton");
	const menuPanel = shadow.getElementById("menuPanel");
	const input = shadow.getElementById("input");

	menuButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	assert.equal(menuPanel.hidden, false, "expected menu to open from menu button");

	input.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, composed: true }));
	assert.equal(menuPanel.hidden, true, "expected menu to close when clicking outside it");

	menuButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	assert.equal(menuPanel.hidden, false, "expected menu to reopen from menu button");
	menuPanel.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, composed: true }));
	assert.equal(menuPanel.hidden, false, "expected menu to stay open when clicking inside it");

	dom.window.close();
}

async function assertInitialMenuClickSurvivesStartupComposerFocus() {
	const runtimeMessages = [];
	const dom = await renderSidebar(createState(), runtimeMessages);
	const host = dom.window.document.getElementById("onhand-extension-sidebar-host");
	const shadow = host.shadowRoot;
	const menuButton = shadow.getElementById("menuButton");
	const menuPanel = shadow.getElementById("menuPanel");

	menuButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	assert.equal(menuPanel.hidden, false, "expected first menu click to open the menu");

	await new Promise((resolve) => dom.window.setTimeout(resolve, 1350));
	assert.equal(menuPanel.hidden, false, "pending startup composer focus should not close the menu after the first click");

	dom.window.close();
}

async function assertComposerEnterSubmitsAndShiftEnterDoesNot() {
	const runtimeMessages = [];
	const submissions = [];
	const dom = await renderSidebar(createState(), runtimeMessages, {
		submitPromptResponse(message) {
			submissions.push(message);
			return { ok: true, requestId: "request-enter-submit" };
		},
	});
	const host = dom.window.document.getElementById("onhand-extension-sidebar-host");
	const shadow = host.shadowRoot;
	const input = shadow.getElementById("input");

	input.value = "Explain this line";
	input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
	await waitForSidebarTick(dom);
	assert.equal(submissions.length, 1, "expected Enter to submit the composer");
	assert.equal(submissions[0].prompt, "Explain this line");

	input.value = "Keep editing";
	input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
	await waitForSidebarTick(dom);
	assert.equal(submissions.length, 1, "expected Shift+Enter not to submit the composer");

	dom.window.close();
}

async function assertActiveComposerButtonStopsCurrentRequest() {
	const runtimeMessages = [];
	const state = createState();
	state.activeRequestId = "request-active";
	state.currentTurnId = "request-active";
	state.status = "Thinking...";
	const dom = await renderSidebar(state, runtimeMessages);
	const host = dom.window.document.getElementById("onhand-extension-sidebar-host");
	const shadow = host.shadowRoot;
	const composer = shadow.getElementById("composer");
	const input = shadow.getElementById("input");
	const sendButton = shadow.getElementById("sendButton");
	const helper = shadow.getElementById("helper");

	assert.equal(input.disabled, true, "expected text input to stay disabled during an active request");
	assert.equal(sendButton.disabled, false, "expected composer button to remain clickable while it acts as Stop");
	assert.equal(sendButton.textContent.trim(), "Stop", "expected Ask button to become Stop during an active request");
	assert.equal(sendButton.classList.contains("stop-button"), true, "expected active composer button to use the Stop style");
	assert.match(sendButton.title, /Stop current Onhand response/);
	assert.match(helper.textContent, /press Stop to cancel/);

	composer.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
	await waitForSidebarTick(dom);

	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:stop"),
		true,
		"expected active composer submit to stop the current response",
	);
	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:submit-prompt"),
		false,
		"active composer submit should not enqueue a new prompt",
	);
	dom.window.close();
}

async function assertSubmitUsesVisibleLearningToggleState() {
	const state = createState();
	state.preferences.learningMode = true;
	const runtimeMessages = [];
	const submissions = [];
	const dom = await renderSidebar(state, runtimeMessages, {
		submitPromptResponse(message) {
			submissions.push(message);
			return { ok: true, requestId: "request-toggle-submit" };
		},
	});
	const host = dom.window.document.getElementById("onhand-extension-sidebar-host");
	const shadow = host.shadowRoot;
	const input = shadow.getElementById("input");
	const learningModeToggle = shadow.getElementById("learningModeToggle");

	assert.equal(learningModeToggle.checked, true, "expected Learning Mode to start on");
	learningModeToggle.checked = false;
	input.value = "Answer mode should answer directly";
	input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
	await waitForSidebarTick(dom);

	assert.equal(submissions.length, 1, "expected visible-toggle submit to send one prompt");
	assert.equal(submissions[0].learningMode, false, "submit should use the checkbox's visible state instead of stale currentState preferences");
	dom.window.close();
}

async function assertLearningSwitchClickUpdatesVisibleToggleState() {
	const state = createState();
	state.preferences.learningMode = true;
	const runtimeMessages = [];
	const submissions = [];
	const dom = await renderSidebar(state, runtimeMessages, {
		submitPromptResponse(message) {
			submissions.push(message);
			return { ok: true, requestId: "request-clicked-toggle-submit" };
		},
	});
	const host = dom.window.document.getElementById("onhand-extension-sidebar-host");
	const shadow = host.shadowRoot;
	const input = shadow.getElementById("input");
	const learningModeLabel = shadow.getElementById("learningModeLabel");
	const learningModeToggle = shadow.getElementById("learningModeToggle");

	assert.equal(learningModeToggle.checked, true, "expected Learning Mode to start on");
	learningModeLabel.click();
	await waitForSidebarTick(dom);

	assert.equal(learningModeToggle.checked, false, "clicking the visible Learning switch should toggle the checkbox off");
	const modeMessage = runtimeMessages.findLast((message) => message?.type === "sidebar:set-learning-mode");
	assert.equal(modeMessage?.type, "sidebar:set-learning-mode", "visible Learning switch should persist the new mode");
	assert.equal(modeMessage?.learningMode, false, "visible Learning switch should persist answer mode");

	input.value = "Answer mode should answer directly after clicking the switch";
	input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
	await waitForSidebarTick(dom);

	assert.equal(submissions.length, 1, "expected answer-mode submit after visible switch click");
	assert.equal(submissions[0].learningMode, false, "submit should use the visible switch state after a click");
	dom.window.close();
}

async function assertHeaderNewEntryButtonStartsNewOnhandSession() {
	const runtimeMessages = [];
	const dom = await renderSidebar(createState(), runtimeMessages);
	const host = dom.window.document.getElementById("onhand-extension-sidebar-host");
	const shadow = host.shadowRoot;
	const newEntryButton = shadow.getElementById("headerNewSessionButton");

	assert.equal(shadow.textContent.includes("cmd+n"), false, "sidebar should not advertise Chrome's reserved Cmd+N shortcut");
	assert.equal(newEntryButton.disabled, false, "expected populated sessions to allow creating a new entry");
	newEntryButton.click();
	await waitForSidebarTick(dom);

	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:new-session"),
		true,
		"expected the header new-entry button to create a new Onhand session",
	);
	dom.window.close();
}

async function assertFreshSessionCannotCreateAnotherNewSession() {
	const runtimeMessages = [];
	const state = createState();
	state.currentSession = {
		sessionId: "session-empty",
		sessionName: "New session",
	};
	state.turns = [];
	state.pageActions = [];
	state.activities = [];
	const dom = await renderSidebar(state, runtimeMessages);
	const host = dom.window.document.getElementById("onhand-extension-sidebar-host");
	const shadow = host.shadowRoot;
	const newEntryButton = shadow.getElementById("headerNewSessionButton");
	const menuNewButton = shadow.getElementById("newSessionButton");

	assert.equal(newEntryButton.disabled, true, "expected header new-entry button to be disabled for a fresh current session");
	assert.equal(menuNewButton.disabled, true, "expected menu New button to be disabled for a fresh current session");
	assert.match(newEntryButton.title, /already new/i);
	assert.match(menuNewButton.title, /already new/i);

	newEntryButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	menuNewButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await waitForSidebarTick(dom);

	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:new-session"),
		false,
		"fresh current sessions should not create another blank session",
	);
	dom.window.close();
}

async function assertMenuOptionsButtonOpensOptionsPage() {
	const runtimeMessages = [];
	const dom = await renderSidebar(createState(), runtimeMessages);
	const host = dom.window.document.getElementById("onhand-extension-sidebar-host");
	const shadow = host.shadowRoot;
	const optionsButton = shadow.getElementById("optionsButton");

	assert.ok(optionsButton, "expected side-panel menu to include an Options button");
	optionsButton.click();
	await waitForSidebarTick(dom);

	assert.equal(dom.getOpenOptionsCalls(), 1, "expected Options button to open the extension options page");
	dom.window.close();
}

async function assertMenuDeleteButtonConfirmsBeforeDeletingSession() {
	const runtimeMessages = [];
	const confirmMessages = [];
	let confirmResult = false;
	const state = createState();
	state.currentSession = {
		sessionId: "session-alpha",
		sessionName: "Alpha session",
	};
	const sessions = [
		{
			id: "session-alpha",
			name: "Alpha session",
			path: "session-alpha",
			title: "Alpha session",
		},
		{
			id: "session-beta",
			name: "Beta session",
			path: "session-beta",
			title: "Beta session",
		},
	];
	const dom = await renderSidebar(state, runtimeMessages, {
		sessions: () => sessions,
		confirm(message) {
			confirmMessages.push(message);
			return confirmResult;
		},
	});
	const host = dom.window.document.getElementById("onhand-extension-sidebar-host");
	const shadow = host.shadowRoot;
	const deleteButton = shadow.getElementById("deleteSessionButton");

	assert.ok(deleteButton, "expected side-panel menu to include a Delete button");
	assert.equal(shadow.getElementById("stopButton"), null, "expected menu Stop button to be removed");
	assert.equal(deleteButton.disabled, false, "expected populated current session to be deletable");
	assert.equal(deleteButton.textContent.trim(), "Delete");

	deleteButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await waitForSidebarTick(dom);

	assert.equal(confirmMessages.length, 1, "expected Delete to confirm before removing a session");
	assert.match(confirmMessages[0], /Delete "Alpha session"/);
	assert.equal(
		runtimeMessages.some((message) => message?.type === "sidebar:delete-session"),
		false,
		"canceling Delete confirmation should not remove a session",
	);

	confirmResult = true;
	deleteButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await waitForSidebarTick(dom);

	const deleteMessage = runtimeMessages.find((message) => message?.type === "sidebar:delete-session");
	assert.ok(deleteMessage, "expected confirmed Delete to send a delete-session message");
	assert.equal(deleteMessage.sessionPath, "session-alpha");
	assert.equal(deleteMessage.windowId, 1);
	dom.window.close();
}

await assertSessionWideCitationNumbers();
await assertResponseCopyButtonAndStableMarkup();
await assertQuickOpenFocusesComposer();
await assertMenuClosesOnOutsidePointer();
await assertInitialMenuClickSurvivesStartupComposerFocus();
await assertComposerEnterSubmitsAndShiftEnterDoesNot();
await assertActiveComposerButtonStopsCurrentRequest();
await assertSubmitUsesVisibleLearningToggleState();
await assertLearningSwitchClickUpdatesVisibleToggleState();
await assertHeaderNewEntryButtonStartsNewOnhandSession();
await assertFreshSessionCannotCreateAnotherNewSession();
await assertMenuOptionsButtonOpensOptionsPage();
await assertMenuDeleteButtonConfirmsBeforeDeletingSession();
await assertTranscriptActionButtonsActivateDirectly();
await assertTurnSourceButtonsExposeAllPageActions();
await assertOpenPdfViewerMenuActionTargetsPdfTabs();
await assertSessionPickerSwitchesOnInputWithoutLosingSelection();
await assertReviewViewRendersSavedSnapshot();
await assertReviewArtifactStripKeepsScrollPositionAcrossRenders();
await assertPageIndexHighlightWithNoteJumpsToAnnotation();
await assertPageIndexDoesNotShowStalePageActions();
await assertLearningSessionPanelRendersState();
await assertLearningSessionPanelUsesPageActionWhenLearnerSourceIdIsStale();
await assertLearningSessionPanelResolvesEachConceptToItsOwnTurnSource();
await assertLearningSessionPanelCanResolveRestoredConceptThroughPairedNote();
await assertLearningSessionPanelPrefersPairedNoteSourceOverGenericHeading();
await assertLearningSessionPanelPrefersPairedNoteSourceOverExactBroadSource();
await assertLearningSessionPanelShowsAllConceptsAndCanCollapse();
await assertLearningSessionPanelReportsSourceFailure();
await assertLearningSessionPanelHidesOutsideLearningState();
await assertRealtimeMicPickerConstrainsSelectedDevice();
await assertRealtimeVoiceDisabledState();
await assertRealtimeApiKeyErrorOpensOptions();
await assertRealtimeApiKeyErrorFallsBackToOptionsTab();
await assertRealtimeResponseCreateQueuesUntilDone();
await assertRealtimeActiveResponseErrorIsRecoverable();
await assertRealtimeManualVoiceFallbackDisabled();
await assertRealtimeServerSpeechDoesNotScheduleLocalFallback();
await assertRealtimeCommittedAudioCreatesRealtimeTurn();
await assertRealtimeSpeechStoppedWaitsForRealtimeResponse();
await assertRealtimeTranscriptRoutesPageQuestionsThroughOnhand();
await assertRealtimeLearningVoiceQuestionUsesRuntimeAgentInsteadOfSocraticPlanner();
await assertRealtimeExplicitLearningVoiceTranscriptPlansSocraticMove();
await assertRealtimeEmptyInputBufferDoesNotDisconnect();
await assertRealtimeIdleTimeoutDisconnectsOnlyWhenIdle();
await assertRealtimeSessionUsesRuntimeAgentMode();
await assertRealtimeVoiceTranscriptUsesRuntimeAgentAndNarratesCompletion();
await assertRealtimeExternalSourceRequestsCanNavigateFirst();
await assertRealtimeBrowserHighlightRepairsNearQuoteFromVisibleText();
await assertRealtimeTranscriptMergeWindowSubmitsMergedRuntimePrompt();
await assertRealtimeDirectAnswerFallsBackToEarlierSourceCitations();
await assertRealtimeDirectAnswerPreambleQueuesFinalNarration();
await assertRealtimeStaleDirectAnswerDoesNotNarrateOldTurn();
await assertRealtimeStandaloneVoiceAnswerPersistsToSession();
await assertRealtimeAnswerClearsWhenSessionChanges();
console.log("sidebar regressions passed");
