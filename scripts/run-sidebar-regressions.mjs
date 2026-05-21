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
	const dom = new JSDOM("<!doctype html><html><body></body></html>", {
		pretendToBeVisual: true,
		runScripts: "outside-only",
		url: "chrome-extension://extension-id/sidepanel.html",
	});
	const { window } = dom;
	window.chrome = {
		runtime: {
			getURL(path) {
				return `chrome-extension://extension-id/${path}`;
			},
			onMessage: { addListener() {} },
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
		storage: {
			local: {
				async get(defaults) {
					return { ...defaults };
				},
				async set() {},
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
	assert.match(learnerPanel.textContent, /Waiting/);
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

await assertSessionWideCitationNumbers();
await assertTranscriptActionButtonsActivateDirectly();
await assertSessionPickerSwitchesOnInputWithoutLosingSelection();
await assertReviewViewRendersSavedSnapshot();
await assertReviewArtifactStripKeepsScrollPositionAcrossRenders();
await assertPageIndexHighlightWithNoteJumpsToAnnotation();
await assertLearningSessionPanelRendersState();
await assertLearningSessionPanelUsesPageActionWhenLearnerSourceIdIsStale();
await assertLearningSessionPanelCanResolveRestoredConceptThroughPairedNote();
await assertLearningSessionPanelShowsAllConceptsAndCanCollapse();
await assertLearningSessionPanelReportsSourceFailure();
await assertLearningSessionPanelHidesOutsideLearningState();
console.log("sidebar regressions passed");
