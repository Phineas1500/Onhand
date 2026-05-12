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
	const tabs = Array.isArray(options.tabs) && options.tabs.length ? options.tabs : [replaySmokeTab()];
	const tabForArgs = (args = {}) => tabs.find((candidate) => candidate.id === Number(args.tabId)) || tabs[0] || replaySmokeTab();
	return {
		calls,
		async runCommand(name, args = {}) {
			calls.push({ name, args });
			const tab = tabForArgs(args);
			if (name === "navigate") {
				return {
					tab: {
						id: Number(options.navigateTabId || 99),
						windowId: Number(options.navigateWindowId || tab.windowId || 3),
						active: true,
						title: options.navigateTitle || "Restored target",
						url: String(args.url || options.navigateUrl || "https://example.test/restored"),
					},
				};
			}
			if (name === "activate_tab") return { tab };
			if (name === "clear_annotations") return { tab, cleared: true };
			if (name === "highlight_text") {
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
	const { buildReplayAnnotationsFromPageActions, formatToolResultForModel, getSelectionText, summarizeRestoredArtifact } = __browserRuntimeTest || {};
	assert.equal(typeof buildReplayAnnotationsFromPageActions, "function", "browser runtime replay export is missing");
	assert.equal(typeof formatToolResultForModel, "function", "browser runtime test formatter export is missing");
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
	await assertSessionReplayRestore();
	await assertSessionReplayDoesNotTrustStaleTabIds();
	await assertEmptyArtifactRestoreDoesNotRunPageTools();
	await assertFixtureResponses();
	console.log("Browser runtime regressions: PASS");
}

main().catch((error) => {
	console.error(error?.stack || error?.message || String(error));
	process.exitCode = 1;
});
