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
					return {
						ok: true,
						currentSession: { ...state.currentSession, sessionFile: state.currentSession.sessionId },
						sessions: [
							{
								id: state.currentSession.sessionId,
								name: state.currentSession.sessionName,
								path: state.currentSession.sessionId,
								title: state.currentSession.sessionName,
							},
						],
					};
				}
				if (message?.type === "sidebar:get-session-replay") {
					return {
						ok: true,
						session: {
							id: state.currentSession.sessionId,
							path: state.currentSession.sessionId,
							title: state.currentSession.sessionName,
						},
						turns: state.turns,
						pageActions: state.pageActions || [],
						artifacts: [
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
						],
						replayableAnnotations: [],
						selectedArtifactId: "artifact-sidebar-replay",
					};
				}
				if (message?.type === "sidebar:get-replay-artifact") {
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
				if (message?.type === "sidebar:activate-action") return { ok: true };
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

async function assertReplayViewRendersSavedSnapshot() {
	const runtimeMessages = [];
	const dom = await renderSidebar(createState(), runtimeMessages);
	const host = dom.window.document.querySelector("#onhand-extension-sidebar-host");
	assert.ok(host, "expected sidebar host to render");
	const replayButton = host.shadowRoot.getElementById("replaySessionButton");
	assert.ok(replayButton, "expected replay menu button to render");
	replayButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 80));

	assert.equal(runtimeMessages.some((message) => message?.type === "sidebar:get-session-replay"), true);
	assert.equal(runtimeMessages.some((message) => message?.type === "sidebar:get-replay-artifact" && message.artifactId === "artifact-sidebar-replay"), true);
	const replayView = host.shadowRoot.getElementById("replayView");
	assert.equal(replayView.hidden, false, "expected replay view to be visible");
	assert.match(replayView.textContent, /Replay/);
	assert.match(replayView.textContent, /Saved replay note/);
	assert.match(replayView.textContent, /Transcript/);
	const snapshotImage = replayView.querySelector(".onhand-replay-image");
	assert.ok(snapshotImage, "expected saved screenshot image to render");
	assert.equal(snapshotImage.getAttribute("src"), "data:image/png;base64,UkVQTEFZ");
	assert.equal(host.shadowRoot.getElementById("messages").hidden, true);
	assert.equal(host.shadowRoot.getElementById("composer").hidden, true);

	const liveButton = replayView.querySelector("[data-replay-close]");
	liveButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
	assert.equal(replayView.hidden, true, "expected live button to close replay view");
	assert.equal(host.shadowRoot.getElementById("messages").hidden, false);

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
				message?.type === "sidebar:scroll-to-annotation" &&
				message.annotationId === "ann-second" &&
				message.target === "annotation",
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
				message?.type === "sidebar:scroll-to-annotation" &&
				message.annotationId === "ann-first" &&
				message.target === "note",
		),
		true,
	);

	dom.window.close();
}

async function assertLearningSessionPanelReportsSourceFailure() {
	const runtimeMessages = [];
	const dom = await renderSidebar(createLearningState(), runtimeMessages, {
		scrollToAnnotationResponse(message) {
			return {
				ok: false,
				error: `No annotation found with id: ${message.annotationId}`,
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
		runtimeMessages.some((message) => message?.type === "sidebar:scroll-to-annotation" && message.annotationId === "ann-second"),
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
await assertReplayViewRendersSavedSnapshot();
await assertLearningSessionPanelRendersState();
await assertLearningSessionPanelReportsSourceFailure();
await assertLearningSessionPanelHidesOutsideLearningState();
console.log("sidebar regressions passed");
