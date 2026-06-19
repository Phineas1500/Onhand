import assert from "node:assert/strict";
import { startFixtureServer } from "./serve-browser-runtime-fixture.mjs";

function installChromeStorageStub() {
	globalThis.chrome = {
		runtime: {
			getURL(path = "") {
				return `chrome-extension://onhand-test/${path}`;
			},
			getManifest() {
				return { version: "test" };
			},
		},
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

// Sessions live in per-record storage (IndexedDB in Chrome, the
// onhandBrowserSessions fallback key in Node), while the
// onhandBrowserRuntime key only holds settings + currentSessionId.
function getStoredSessions() {
	const data = globalThis.chrome.storage.local.data;
	if (!data.onhandBrowserSessions || typeof data.onhandBrowserSessions !== "object") data.onhandBrowserSessions = {};
	return data.onhandBrowserSessions;
}

function getStoredStore() {
	const meta = globalThis.chrome.storage.local.data.onhandBrowserRuntime || {};
	return { ...meta, sessions: getStoredSessions() };
}

function storedStoreEntries(store) {
	const { sessions = {}, ...meta } = store || {};
	return { onhandBrowserRuntime: meta, onhandBrowserSessions: sessions };
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
				if (options.rejectNavigate?.(String(args.url || ""), args)) {
					throw new Error(`Navigation failed: ${args.url}`);
				}
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
			if (name === "open_pdf_in_onhand_viewer") {
				const pdfUrl = String(args.pdfUrl || tab.url || "https://example.test/replay-smoke.pdf");
				const viewerUrl = String(options.pdfViewerUrl || `chrome-extension://onhand-test/pdf-viewer.html?url=${encodeURIComponent(pdfUrl)}`);
				const preservedSourceUrl = options.preservePdfSourceUrl !== false && /^https?:\/\//i.test(pdfUrl);
				const viewerTab = {
					id: Number(options.pdfViewerTabId || 120),
					windowId: Number(options.pdfViewerWindowId || tab.windowId || 3),
					active: true,
					title: options.pdfViewerTitle || "Onhand PDF Viewer",
					url: preservedSourceUrl ? pdfUrl : viewerUrl,
				};
				for (const candidate of tabs) {
					if (candidate.windowId === viewerTab.windowId) candidate.active = false;
				}
				const existingIndex = tabs.findIndex((candidate) => candidate.id === viewerTab.id);
				if (existingIndex >= 0) tabs[existingIndex] = viewerTab;
				else tabs.push(viewerTab);
				return {
					tab: viewerTab,
					sourceTab: tab,
					pdfUrl,
					viewerUrl,
					alreadyOpen: false,
					opened: true,
					replacedCurrentTab: args.newTab !== true,
					preservedSourceUrl,
				};
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
				if (options.rejectHighlightText?.(String(args.text || ""), args, calls)) {
					throw new Error(`No visible text matched: ${args.text}`);
				}
				const annotationId =
					typeof options.highlightAnnotationId === "function"
						? options.highlightAnnotationId(String(args.text || ""), args)
						: options.highlightAnnotationId || "replay-highlight";
				return {
					tab,
					annotation: {
						annotationId,
						matchedText: String(args.text || "Alpha smoke content"),
						...(args.pdfAnchor ? { pdfAnchor: args.pdfAnchor } : {}),
					},
				};
			}
			if (name === "show_note") return { tab, note: { annotationId: String(args.annotationId || "replay-highlight"), note: String(args.note || "") } };
			if (name === "run_js") {
				if (options.rejectRunJs) throw new Error(typeof options.rejectRunJs === "string" ? options.rejectRunJs : "run_js failed");
				const runJsResult = typeof options.runJsResult === "function" ? options.runJsResult(args, calls, tab) : options.runJsResult;
				return { tab, result: runJsResult ?? true };
			}
			if (name === "get_selection") return { selection: options.selection || { text: "" } };
			if (name === "get_visible_text") {
				return {
					tab,
					visible: {
						text: options.visibleText || "Replay smoke page with Alpha smoke content available for highlighting.",
					},
				};
			}
			if (name === "extract_content") {
				return {
					tab,
					content: {
						markdown: options.extractedMarkdown || "Replay smoke page with Alpha smoke content available for highlighting.",
						text: options.extractedText || options.extractedMarkdown || "Replay smoke page with Alpha smoke content available for highlighting.",
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
			if (name === "get_visible_region_image") {
				return {
					tab,
					method: "debugger",
					dataUrl: "data:image/png;base64,VklTVUFM",
					mimeType: "image/png",
					label: String(args.label || "visible region"),
					region: { x: 0, y: 0, width: 640, height: 360, coordinateSystem: "viewport-css-pixels" },
					viewport: { width: 1280, height: 720, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
				};
			}
			return { tab, ok: true };
		},
		async snapshotState(args = {}) {
			calls.push({ name: "snapshot_state", args });
			const windowIds = Array.from(new Set(tabs.map((tab) => tab.windowId).filter((windowId) => typeof windowId === "number")));
			const windows = windowIds.map((windowId, index) => ({
				id: windowId,
				focused: index === 0,
				tabs: tabs.filter((tab) => tab.windowId === windowId),
			}));
			return {
				windows: typeof args.windowId === "number" ? windows.filter((windowInfo) => windowInfo.id === args.windowId) : windows,
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


async function assertProviderApiKeyStorageAndRouting() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime, __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const {
		getApiKeyForProvider,
		getMissingApiKeyError,
		getProviderModelOptions,
		normalizeApiKeys,
		normalizeProviderForAuthMode,
		validateProviderApiKey,
	} = __browserRuntimeTest || {};
	assert.equal(typeof normalizeApiKeys, "function", "provider key normalizer export is missing");
	assert.equal(typeof getApiKeyForProvider, "function", "provider key lookup export is missing");
	assert.equal(typeof getMissingApiKeyError, "function", "provider key error export is missing");
	assert.equal(typeof validateProviderApiKey, "function", "provider key validator export is missing");
	assert.equal(typeof getProviderModelOptions, "function", "provider model list export is missing");
	assert.deepEqual(normalizeApiKeys({ openai: " sk-openai ", anthropic: "sk-ant-test", unknown: "secret" }, "legacy"), {
		openai: "sk-openai",
		anthropic: "sk-ant-test",
	});
	assert.deepEqual(normalizeApiKeys({}, "sk-legacy"), { openai: "sk-legacy" });
	assert.equal(normalizeProviderForAuthMode("anthropic", "api-key"), "anthropic");
	assert.equal(normalizeProviderForAuthMode("google", "api-key"), "google");
	assert.equal(normalizeProviderForAuthMode("anthropic", "oauth"), "openai-codex");
	assert.equal(validateProviderApiKey("anthropic", "not-an-anthropic-key").ok, false);
	assert.equal(validateProviderApiKey("anthropic", "sk-ant-test").ok, true);
	assert.equal(validateProviderApiKey("openrouter", "sk-or-test").ok, true);
	assert.equal(validateProviderApiKey("openrouter", "sk-bad").ok, false);
	assert.equal(validateProviderApiKey("onhand-free", "").ok, true, "keyless provider should validate without a key");
	assert.ok(getProviderModelOptions("openrouter").some((model) => model.id === "deepseek/deepseek-v4-flash"), "openrouter should offer deepseek v4 flash");
	assert.ok(getProviderModelOptions("openrouter").length <= 5, "openrouter model options should stay curated");
	assert.equal(getProviderModelOptions("onhand-free")[0].id, "deepseek/deepseek-v4-flash", "free tier should pin its model");
	assert.deepEqual(getProviderModelOptions("onhand-free")[0].input, ["text", "image"], "free tier must preserve image payloads for server-side visual routing");
	{
		// The free-tier worker rejects everything outside its allowlist, so
		// the options page must not offer a custom-model entry for it.
		const { readFile } = await import("node:fs/promises");
		const optionsSource = await readFile(new URL("../packages/browser-extension/options.js", import.meta.url), "utf8");
		assert.match(optionsSource, /lockedModels/, "options page should lock the free-tier model dropdown to curated entries");
	}
	assert.ok(getProviderModelOptions("google").some((model) => model.id === "gemini-2.5-flash"));
	assert.match(getMissingApiKeyError("google"), /Set a Google Gemini API key/i);

	globalThis.chrome.storage.local.data.onhandBrowserRuntime = {
		settings: {
			aiProvider: "openai",
			aiModel: "gpt-4.1-mini",
			aiApiKey: "sk-legacy-openai",
			authMode: "api-key",
		},
		sessions: {},
		currentSessionId: "",
	};
	let runtime = createOnhandBrowserRuntime(createReplayHost());
	let settings = await runtime.getSettings();
	assert.equal(settings.hasAiApiKey, true, "legacy OpenAI API key should migrate into provider key status");
	assert.equal(settings.apiKeyProviders.find((provider) => provider.id === "openai").hasApiKey, true);
	assert.equal(settings.advancedRuntimeInspectionEnabled, true, "advanced runtime inspection should default on for existing users");

	runtime = createOnhandBrowserRuntime(createReplayHost());
	settings = await runtime.updateSettings({
		aiProvider: "anthropic",
		aiModel: "claude-sonnet-4-5-20250929",
		authMode: "api-key",
		advancedRuntimeInspectionEnabled: false,
		aiApiKeys: {
			openai: "sk-openai-runtime",
			anthropic: "sk-ant-runtime",
		},
	});
	assert.equal(settings.aiProvider, "anthropic");
	assert.equal(settings.aiModel, "claude-sonnet-4-5-20250929");
	assert.equal(settings.advancedRuntimeInspectionEnabled, false);
	assert.equal(settings.hasSelectedProviderApiKey, true);
	assert.equal(settings.apiKeyProviders.find((provider) => provider.id === "anthropic").hasApiKey, true);
	const storedSettings = globalThis.chrome.storage.local.data.onhandBrowserRuntime.settings;
	assert.equal(getApiKeyForProvider(storedSettings, "anthropic"), "sk-ant-runtime");
	assert.equal(getApiKeyForProvider(storedSettings, "openai"), "sk-openai-runtime");
	const validation = await runtime.validateApiKey({ providerId: "anthropic", apiKey: "sk-ant-runtime" });
	assert.equal(validation.ok, true);
	settings = await runtime.removeApiKey("anthropic");
	assert.equal(settings.apiKeyProviders.find((provider) => provider.id === "anthropic").hasApiKey, false);
}

function countImageBlocks(messages) {
	return messages.reduce((total, message) => {
		const content = Array.isArray(message?.content) ? message.content : [];
		return total + content.filter((block) => block?.type === "image").length;
	}, 0);
}

function textChars(messages) {
	return messages.reduce((total, message) => {
		const content = message?.content;
		if (typeof content === "string") return total + content.length;
		if (!Array.isArray(content)) return total;
		return total + content.reduce((sum, block) => sum + (block?.type === "text" ? String(block.text || "").length : 0), 0);
	}, 0);
}

async function assertFreeTierVisualContextBudgeting() {
	installChromeStorageStub();
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const { compactFreeTierVisualContextMessagesForTest, messagesContainImageForTest } = __browserRuntimeTest || {};
	assert.equal(typeof compactFreeTierVisualContextMessagesForTest, "function", "free-tier visual compactor export is missing");
	assert.equal(typeof messagesContainImageForTest, "function", "image detector export is missing");
	const longText = "Long extracted context. ".repeat(6000);
	const olderChatter = Array.from({ length: 80 }, (_, index) => ({
		role: "user",
		content: [{ type: "text", text: `Older thread turn ${index}. ${"extra context ".repeat(600)}` }],
		timestamp: index,
	}));
	const messages = [
		...olderChatter,
		{ role: "user", content: [{ type: "text", text: longText }], timestamp: 1 },
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "call_old", name: "browser_get_visible_region_image", arguments: {} }],
			timestamp: 2,
		},
		{
			role: "toolResult",
			toolCallId: "call_old",
			toolName: "browser_get_visible_region_image",
			content: [
				{ type: "text", text: longText },
				{ type: "image", data: "T0xEX1ZJU1VBTA==", mimeType: "image/png" },
			],
			timestamp: 3,
		},
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "call_new", name: "browser_get_visible_region_image", arguments: {} }],
			timestamp: 4,
		},
		{
			role: "toolResult",
			toolCallId: "call_new",
			toolName: "browser_get_visible_region_image",
			content: [
				{ type: "text", text: longText },
				{ type: "image", data: "TkVXX1ZJU1VBTA==", mimeType: "image/png" },
			],
			timestamp: 5,
		},
	];
	assert.equal(messagesContainImageForTest(messages), true);
	const compacted = compactFreeTierVisualContextMessagesForTest(messages);
	assert.equal(messagesContainImageForTest(compacted), true, "visual compaction must keep recent image payloads");
	assert.equal(countImageBlocks(compacted), 2, "visual compaction should keep only the newest bounded image set");
	assert.ok(textChars(compacted) < textChars(messages) / 3, "visual compaction should aggressively trim old text context");
	assert.ok(textChars(compacted) <= 48000, "visual compaction should enforce the free-tier visual text budget");
	assert.match(JSON.stringify(compacted), /Long extracted context/, "compacted context should retain useful text, not only placeholders");
}

async function assertSentryDiagnosticsGateAndScrub() {
	installChromeStorageStub();
	const originalFetch = globalThis.fetch;
	const fetchCalls = [];
	globalThis.fetch = async (url, options = {}) => {
		fetchCalls.push({
			url: String(url),
			body: typeof options.body === "string" ? options.body : "",
		});
		return new Response("", { status: 200 });
	};
	try {
		const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
		const sensitiveMessage =
			'No visible text matched: private prompt text at https://example.test/page?token=secret from file:///Users/sriram/private.pdf using sk-or-secret';
		const extensionFrame = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/onhand-runtime.bundle.js:123:45";
		let runtime = createOnhandBrowserRuntime(createReplayHost());
		const blocked = await runtime.captureRuntimeException({
			messageType: "sentry_smoke",
			message: sensitiveMessage,
			stack: `Error: ${sensitiveMessage}\n    at smoke (${extensionFrame})\n    at test (file:///Users/sriram/private.js:1:2)`,
		});
		assert.equal(blocked.captured, false, "diagnostics-off Sentry capture should be blocked");
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(fetchCalls.length, 0, "diagnostics-off Sentry capture should not call fetch");

		globalThis.chrome.storage.local.data = {
			onhandBrowserRuntime: {
				settings: {
					authMode: "oauth",
					aiProvider: "openai-codex",
					aiModel: "gpt-5.5",
					diagnosticsEnabled: true,
				},
				currentSessionId: "",
			},
			onhandBrowserSessions: {},
		};
		runtime = createOnhandBrowserRuntime(createReplayHost());
		const captured = await runtime.captureRuntimeException({
			messageType: "sentry_smoke",
			message: sensitiveMessage,
			stack: `Error: ${sensitiveMessage}\n    at smoke (${extensionFrame})\n    at test (file:///Users/sriram/private.js:1:2)`,
		});
		assert.equal(captured.captured, true, "diagnostics-on Sentry capture should be accepted");
		for (let attempt = 0; attempt < 20 && fetchCalls.length === 0; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		assert.ok(fetchCalls.some((call) => /sentry\.io/i.test(call.url)), "expected Sentry capture to use the ingest endpoint");
		const sentryPayload = fetchCalls.map((call) => call.body).join("\n");
		assert.doesNotMatch(sentryPayload, /private prompt text/i);
		assert.doesNotMatch(sentryPayload, /example\.test/i);
		assert.doesNotMatch(sentryPayload, /file:\/\/\/Users\/sriram/i);
		assert.doesNotMatch(sentryPayload, /chrome-extension:\/\/abcdefghijklmnop/i);
		assert.match(sentryPayload, /app:\/\/\/onhand-runtime\.bundle\.js/);
		assert.doesNotMatch(sentryPayload, /sk-or-secret/i);
		assert.match(sentryPayload, /"dist":"chrome"/);
		assert.match(sentryPayload, /sentry_smoke/);
		assert.match(sentryPayload, /openai-codex/);
	} finally {
		globalThis.fetch = originalFetch;
	}
}

async function assertSelectionFormatting() {
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const {
		buildHighlightRetryCandidates,
		buildPlannerAnchorCandidates,
		buildReplayAnnotationsFromPageActions,
		formatToolResultForModel,
		formatVisibleTextForModel,
		getSelectionText,
		normalizePlannerMove,
		summarizeRestoredArtifact,
	} = __browserRuntimeTest || {};
	assert.equal(typeof buildHighlightRetryCandidates, "function", "browser runtime highlight retry export is missing");
	assert.equal(typeof buildPlannerAnchorCandidates, "function", "browser runtime planner anchor export is missing");
	assert.equal(typeof buildReplayAnnotationsFromPageActions, "function", "browser runtime replay export is missing");
	assert.equal(typeof formatToolResultForModel, "function", "browser runtime test formatter export is missing");
	assert.equal(typeof formatVisibleTextForModel, "function", "browser runtime visible formatter export is missing");
	assert.equal(typeof getSelectionText, "function", "browser runtime selection formatter export is missing");
	assert.equal(typeof normalizePlannerMove, "function", "browser runtime planner normalizer export is missing");
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

	const selectedPdfText = formatToolResultForModel("browser_get_selection", {
		selection: {
			text: " recurrent neural networks ",
			surface: "pdf",
			viewer: "pdfjs",
			pageNumber: 7,
			pdfAnchor: {
				surface: "pdf",
				viewer: "pdfjs",
				pageNumber: 7,
			},
		},
	});
	assert.equal(selectedPdfText, "Selected text (PDF, p. 7, pdfjs):\nrecurrent neural networks");
	const emptyPdfSelectionWithFallback = formatToolResultForModel("browser_get_selection", {
		selection: {
			hasSelection: false,
			surface: "pdf",
			viewer: "google-scholar",
			readerFrameFallback: {
				attempted: true,
				ok: false,
				error: "No Google Scholar PDF Reader frame context found",
			},
		},
	});
	assert.match(emptyPdfSelectionWithFallback, /No selected text/);
	assert.match(emptyPdfSelectionWithFallback, /Reader-frame fallback: failed/);
	assert.match(emptyPdfSelectionWithFallback, /No Google Scholar PDF Reader frame context found/);

	const visibleText = formatVisibleTextForModel({
		blocks: [
			{ tag: "h2", text: "You will learn" },
			{ tag: "li", text: "How to create and nest components" },
			{ tag: "li", text: "How to add markup and styles" },
		],
	});
	assert.equal(visibleText, "## You will learn\n- How to create and nest components\n- How to add markup and styles");
	const unsupportedPdfVisibleText = formatVisibleTextForModel({
		surface: "pdf",
		unsupported: true,
		text: "This PDF viewer does not expose selectable page text to Onhand yet.",
		readerFrameFallback: {
			attempted: true,
			ok: false,
			error: "No Google Scholar PDF Reader frame context found",
		},
	});
	assert.match(unsupportedPdfVisibleText, /does not expose selectable page text/);
	assert.match(unsupportedPdfVisibleText, /Reader-frame fallback: failed/);
	assert.match(unsupportedPdfVisibleText, /No Google Scholar PDF Reader frame context found/);
	const localFileVisibleText = formatVisibleTextForModel({
		surface: "local-file",
		unsupported: true,
		reason: 'This is a local file tab. Enable "Allow access to file URLs" for Onhand in chrome://extensions, then reload this tab.',
	});
	assert.match(localFileVisibleText, /local file tab/);
	assert.match(localFileVisibleText, /Allow access to file URLs/);
	assert.match(localFileVisibleText, /chrome:\/\/extensions/);
	assert.match(
		formatToolResultForModel("browser_extract_content", {
			tab: replaySmokeTab({ title: "local report", url: "file:///Users/example/report.html" }),
			content: {
				surface: "local-file",
				unsupported: true,
				reason: "This is a local file tab. Enable Allow access to file URLs for Onhand.",
			},
		}),
		/Enable Allow access to file URLs/,
	);
	assert.match(
		formatToolResultForModel("browser_pdf_search", {
			search: {
				query: "perceptron",
				matchCount: 1,
				matches: [
					{
						pageNumber: 8,
						occurrence: 1,
						matchedText: "perceptron",
						snippet: "Simple method: perceptron input neurons...",
					},
				],
			},
		}),
		/PDF search for "perceptron": 1 match/,
	);
	assert.match(
		formatToolResultForModel("browser_pdf_read_pages", {
			pages: {
				pageNumbers: [8],
				blocks: [{ pageNumber: 8, text: "SIMPLE METHOD: PERCEPTRON" }],
			},
		}),
		/\[p\. 8\]\nSIMPLE METHOD: PERCEPTRON/,
	);
	assert.match(
		formatToolResultForModel("browser_extract_content", {
			tab: replaySmokeTab(),
			content: { markdown: "## You will learn\n\n- How to create and nest components" },
		}),
		/## You will learn\n\n- How to create and nest components/,
	);
	assert.match(
		formatToolResultForModel("browser_find_elements", {
			matches: [
				{
					tag: "a",
					selector: "a:nth-of-type(3)",
					text: "Notes",
					href: "https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/07cnn/CNNs.html",
				},
			],
		}),
		/href=https:\/\/www\.cs\.purdue\.edu\/homes\/ribeirob\/courses\/Spring2026\/lectures\/07cnn\/CNNs\.html/,
	);
	assert.deepEqual(buildHighlightRetryCandidates("## You will learn\n- How to create and nest components\n- How to add markup and styles"), [
		"How to create and nest components",
		"How to add markup and styles",
	]);
	const scrolledPagePlannerCandidates = buildPlannerAnchorCandidates({
		userQuestion: "What does this page say about Alpha smoke content?",
		visible: {
			text: "Lower Section\nDelta lower content gives scroll and scroll-to-annotation tests enough page height.",
		},
		extracted: {
			markdown:
				"Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore on this local page.\n\nLower Section\nDelta lower content gives scroll and scroll-to-annotation tests enough page height.",
		},
	});
	assert.match(scrolledPagePlannerCandidates[0]?.text || "", /^Alpha smoke content confirms readable extraction/);
	const repairedPlannerMove = normalizePlannerMove(
		JSON.stringify({
			anchor: {
				text_excerpt: "Delta lower content gives scroll and scroll-to-annotation tests enough page height.",
				kind: "question_anchor",
				note: "Key evidence for this question.",
			},
			voice_script: "What does this lower section tell you?",
		}),
		{
			userQuestion: "What does this page say about Alpha smoke content?",
			browserContext: "Visible text snapshot:\nDelta lower content gives scroll and scroll-to-annotation tests enough page height.",
			anchorCandidates: scrolledPagePlannerCandidates,
		},
	);
	assert.match(repairedPlannerMove.anchor.text_excerpt, /^Alpha smoke content confirms readable extraction/);
	assert.doesNotMatch(repairedPlannerMove.anchor.text_excerpt, /^Delta lower content/);

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

async function assertToolRetryActivitiesFinalizeAsRecovered() {
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const { finalizePublicActivitiesForTest, summarizeToolReliabilityForTest } = __browserRuntimeTest || {};
	assert.equal(typeof finalizePublicActivitiesForTest, "function", "browser runtime activity finalizer export is missing");
	assert.equal(typeof summarizeToolReliabilityForTest, "function", "browser runtime tool reliability export is missing");

	const transientActivities = [
		{
			id: "tool:search-failed",
			kind: "tool",
			label: "Searching the PDF...",
			toolName: "browser_pdf_search",
			state: "retrying",
		},
		{
			id: "tool:search-ok",
			kind: "tool",
			label: "Searching the PDF...",
			toolName: "browser_pdf_search",
			state: "complete",
		},
		{
			id: "tool:learning",
			kind: "tool",
			label: "Updating learning state...",
			toolName: "onhand_record_learning_event",
			state: "retrying",
		},
	];

	const recovered = finalizePublicActivitiesForTest(transientActivities, null);
	assert.deepEqual(recovered.map((activity) => activity.state), ["recovered", "complete"]);
	assert.deepEqual(summarizeToolReliabilityForTest(recovered), {
		tool_step_count: 2,
		tool_failure_count: 1,
		recovered_tool_failure_count: 1,
		final_tool_failure_count: 0,
	});

	const failed = finalizePublicActivitiesForTest(transientActivities, new Error("prompt failed"));
	assert.deepEqual(failed.map((activity) => activity.state), ["error", "complete"]);
	assert.deepEqual(summarizeToolReliabilityForTest(failed), {
		tool_step_count: 2,
		tool_failure_count: 1,
		recovered_tool_failure_count: 0,
		final_tool_failure_count: 1,
	});

	assert.deepEqual(
		summarizeToolReliabilityForTest([], [
			{ key: "capture:page", label: "Read page", detail: "Captured page content" },
			{ key: "highlight:passage", label: "Highlighted text", detail: "Highlighted a passage" },
		]),
		{
			tool_step_count: 2,
			tool_failure_count: 0,
			recovered_tool_failure_count: 0,
			final_tool_failure_count: 0,
		},
	);
}

async function assertPdfViewerFrameWaitsHaveTimeoutFallback() {
	// requestAnimationFrame never fires on hidden tabs or occluded windows;
	// a bare rAF await left viewer annotation commands hanging until the
	// surface became visible, and their stale completions then clobbered
	// newer annotations (see docs/onhand-pdf-qa-2026-06-09.md).
	const { readFile } = await import("node:fs/promises");
	for (const path of ["packages/browser-extension/src/pdf-viewer.ts", "packages/browser-extension/pdf-viewer.bundle.js"]) {
		const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
		assert.match(source, /waitForNextFrame/, `${path} should use the timeout-backed frame wait`);
		assert.doesNotMatch(
			source,
			/await new Promise\(\s*\(?resolve\)?\s*=>\s*requestAnimationFrame\(resolve\)\s*\)/,
			`${path} should not await bare requestAnimationFrame (hangs on hidden/occluded surfaces)`,
		);
		// Hidden/zero-sized surfaces must not trigger fit re-renders: a
		// backgrounded tab fires resize with garbage dimensions and used to
		// re-render the whole document twice per tab switch.
		assert.match(source, /hasUsableViewerViewport/, `${path} should gate fit re-renders on a usable viewport`);
		// Height-only resizes (the chrome.debugger infobar around tool
		// calls) must not refit either, and large documents must render
		// progressively with on-demand pages instead of blocking until
		// every page is rasterized.
		assert.match(source, /lastFitRenderWidth/, `${path} should gate fit re-renders on width changes`);
		assert.match(source, /data-onhand-pdf-pending/, `${path} should support pending page shells`);
		assert.match(source, /renderRemainingPages/, `${path} should background-render remaining pages`);
		assert.match(source, /ensurePageRendered/, `${path} should render pages on demand`);
		// textContent glues text-layer line fragments together; extraction
		// must convert PDF.js's <br> line markers to whitespace.
		assert.match(source, /textLayerVisibleText/, `${path} should separate text-layer lines when extracting text`);
	}
	const background = await readFile(new URL("../packages/browser-extension/background.js", import.meta.url), "utf8");
	assert.match(
		background,
		/probeInlineOnhandPdfViewerStatus/,
		"open_pdf_in_onhand_viewer should reuse an existing viewer instead of reinstalling on every prompt",
	);
	assert.match(background, /reusedExistingViewer/, "viewer reuse should be reported in the handoff result");
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
	assert.match(contract.systemPrompt, /explicitly asks to search online/);
	assert.match(contract.systemPrompt, /Preserve existing session highlights/);
	assert.match(contract.systemPrompt, /Do not add notes that merely paraphrase the highlight/);
	assert.match(contract.systemPrompt, /Only successful highlight\/note tool results count as anchors/);
	assert.match(contract.systemPrompt, /Chat should be a brief guide to what the annotations show/);
	assert.match(contract.systemPrompt, /Roadmap\/list\/navigation questions are not simple/);
	assert.match(contract.systemPrompt, /every named step or item in chat must be anchored/);
	assert.match(contract.systemPrompt, /Do not rely on a heading-only highlight/);
	assert.match(contract.systemPrompt, /do not send a heading-plus-list block as one highlight/);
	assert.match(contract.systemPrompt, /Do not replace missing list items with nearby headings/);
	assert.match(contract.systemPrompt, /use browser_pdf_find_citation to look up the bibliography entry/);
	assert.match(contract.systemPrompt, /explicitly asks to compare or relate the current material to another open tab/);
	assert.match(contract.systemPrompt, /Do not infer cross-tab permission from standalone comparison or agreement wording/);
	assert.match(contract.systemPrompt, /highlight the key passage in each source/);
	assert.match(contract.systemPrompt, /anchor each substantive claim in the source that supports it/);
	assert.match(contract.systemPrompt, /Never attribute a claim to a source it was not anchored in/);
	assert.match(contract.systemPrompt, /links\/notes\/readings\/resources listed on the current page/);
	assert.match(contract.answerPrompt, /Page-material claims need anchors/);
	assert.match(contract.answerPrompt, /Do page work before chat/);
	assert.match(contract.answerPrompt, /External-source requests are navigation tasks/);
	assert.match(contract.answerPrompt, /Linked-note\/resource requests are navigation tasks/);
	assert.match(contract.answerPrompt, /Grounding budget: simple questions get one strong highlight/);
	assert.match(contract.answerPrompt, /Notes are not mini-summaries/);
	assert.match(contract.answerPrompt, /Failed highlight attempts are not anchors/);
	assert.match(contract.answerPrompt, /Source-thorough path: if the question has distinct subclaims/);
	assert.match(contract.answerPrompt, /Roadmap\/list\/navigation answers need the actual supporting list/);
	assert.match(contract.answerPrompt, /Every named step\/item in chat needs a matching anchor/);
	assert.match(contract.answerPrompt, /highlight the exact item words one item at a time/);
	assert.match(contract.answerPrompt, /Do not substitute nearby headings for missing list items/);
	assert.match(contract.answerPrompt, /Do not call browser_extract_content more than once/);
	assert.match(contract.answerPrompt, /browser_get_visible_region_image/);
	assert.match(contract.answerPrompt, /Visual claims must name the captured region/);
	assert.doesNotMatch(contract.answerPrompt, /answer now without calling a browser tool/i);
	assert.doesNotMatch(contract.answerPrompt, /Current Learning Mode state/);
	assert.match(contract.learningModeAppend, /give a concise anchored answer first/);
	assert.match(contract.learningModeAppend, /Do not make the check the whole answer/);
	assert.match(contract.learningModeAppend, /Stay fast: the first move should be a useful page anchor/);
	assert.match(contract.learningModeAppend, /onhand_record_learning_event/);
	assert.match(contract.learningModeAppend, /one reviewable learning unit/);
	assert.match(contract.learningModeAppend, /reuse that conceptId/);
	assert.match(contract.learningModeAppend, /prefer a lightweight refresher/);
	assert.match(contract.learningModeAppend, /add at most one replacement highlight and no note/);
	assert.match(contract.learningModeAppend, /do not open or record a second check/);
	assert.match(contract.learningModeAppend, /Do not add fresh annotations for this meta\/follow-up turn/);
	assert.match(contract.learningModeAppend, /Cross-tab interleaving is offer-first/);
	assert.match(contract.learningModeAppend, /call browser_list_tabs once only if the captured list is missing or ambiguous/);
	assert.match(contract.learningModeAppend, /Do not switch to, read, highlight, or note a related tab unless the user explicitly asks/);
	assert.match(contract.learningModeAppend, /anchor each page separately and say which tab supports which claim/);
	assert.match(contract.learningModeAppend, /Do not record an offered related tab as a learning source/);
	assert.match(contract.learningModeAppend, /Homework\/problem priority/);
	assert.match(contract.learningModeAppend, /final numeric, symbolic, or code answer/);
	assert.match(contract.learningModeAppend, /even if the user asks directly/);
	assert.match(contract.learningModeAppend, /ask for the next step the learner should do/);
	assert.match(contract.learningModeAppend, /Drop the Socratic stance only for non-homework conceptual questions/);
	assert.match(contract.learningModeAppend, /homework\/problem priority still wins/);
	assert.ok(
		contract.learningModeAppend.indexOf("Homework/problem priority") < contract.learningModeAppend.indexOf("Drop the Socratic stance only"),
		"homework guard must appear before and constrain the direct-answer escape hatch",
	);
	assert.match(contract.homeworkLearningPrompt, /Learning mode homework test/);
	assert.match(contract.homeworkLearningPrompt, /Chain Rule - Practice Problems/);
	assert.match(contract.homeworkLearningPrompt, /Please give me the final answer/);
	assert.match(contract.homeworkLearningPrompt, /Homework\/problem priority/);
	assert.match(contract.homeworkLearningPrompt, /do not give the final numeric, symbolic, or code answer/);
	assert.match(contract.homeworkLearningPrompt, /even if the user asks directly/);
	assert.match(contract.homeworkLearningPrompt, /ask for the next step the learner should do/);
	assert.match(contract.homeworkLearningPrompt, /homework\/problem priority still wins/);
	assert.doesNotMatch(contract.homeworkLearningPrompt, /Drop the Socratic stance when the user explicitly asks for the direct answer/);
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
	assert.match(contract.learningPrompt, /reasonable paraphrase/);
	assert.match(contract.learningPrompt, /Concept hygiene/);
	assert.match(contract.learningPrompt, /Cross-tab interleaving is offer-first/);
	assert.match(contract.newConceptLearningPrompt, /Current Learning Mode state for this session/);
	assert.doesNotMatch(contract.newConceptLearningPrompt, /Likely repeated concepts in the user's latest message/);
	const answerToolNames = getToolNamesForTest("How does rejection sampling work?", false);
	const learningToolNames = getToolNamesForTest("How does rejection sampling work?", true);
	const visualToolNames = getToolNamesForTest("What does this chart show about model accuracy?", false);
	const answerAllToolNames = getToolNamesForTest("Port smoke all browser tools.", false);
	const pdfContextToolNames = getToolNamesForTest("How do perceptrons solve binary classification?", false, null, { forcePdfTools: true });
	const externalSourceToolNames = getToolNamesForTest("Could you take me to these sources and highlight the parts that discuss attention?", false);
	const linkedNotesToolNames = getToolNamesForTest(
		"Could you open the notes that are relevant? Like, could you open them up in another tab and find the exact points that might be relevant?",
		false,
	);
	const linkedNotesFollowupToolNames = getToolNamesForTest(
		"Could you check the other notes that might be useful to help solve this problem? You mentioned a couple other topics.",
		false,
	);
	const comparisonToolNames = getToolNamesForTest("Compare how this paper and the other paper I have open handle attention.", false);
	const agreementToolNames = getToolNamesForTest("Do you agree with this?", false);
	const differenceToolNames = getToolNamesForTest("What is the difference?", false);
	const explicitAgreementToolNames = getToolNamesForTest("Do these papers agree?", false);
	const citationToolNames = getToolNamesForTest("What does reference [2] of this paper actually say?", false);
	const debugToolNames = getToolNamesForTest("Debug why this page is logging console errors.", false);
	const explicitRuntimeToolNames = getToolNamesForTest("Run JavaScript to return document.title.", false);
	const dynamicRuntimeToolNames = getToolNamesForTest("Inspect the React app state and selected value on this dynamic page.", false);
	const disabledExplicitRuntimeToolNames = getToolNamesForTest("Run JavaScript to return document.title.", false, null, { advancedRuntimeInspectionEnabled: false });
	assert.equal(answerToolNames.includes("onhand_record_learning_event"), false);
	assert.equal(answerAllToolNames.includes("onhand_record_learning_event"), false);
	assert.equal(visualToolNames.includes("browser_get_visible_region_image"), true);
	assert.equal(answerToolNames.includes("browser_pdf_search"), false);
	assert.equal(debugToolNames.includes("browser_collect_console"), true, "debug prompts should get console inspection");
	assert.equal(debugToolNames.includes("browser_run_js"), false, "generic debug prompts should not expose JavaScript execution");
	assert.equal(explicitRuntimeToolNames.includes("browser_run_js"), true, "explicit JavaScript prompts should expose browser_run_js");
	assert.equal(dynamicRuntimeToolNames.includes("browser_run_js"), true, "dynamic runtime-state prompts should expose browser_run_js");
	assert.equal(disabledExplicitRuntimeToolNames.includes("browser_run_js"), false, "disabled advanced runtime inspection should hide browser_run_js even for explicit JavaScript prompts");
	assert.equal(comparisonToolNames.includes("browser_list_tabs"), true, "explicit cross-tab comparison prompts should get tab tools");
	assert.equal(comparisonToolNames.includes("browser_activate_tab"), true);
	assert.equal(explicitAgreementToolNames.includes("browser_list_tabs"), true, "explicit multi-document agreement prompts should get tab tools");
	assert.equal(agreementToolNames.includes("browser_list_tabs"), false, "standalone agreement prompts must not get tab enumeration");
	assert.equal(agreementToolNames.includes("browser_navigate"), false, "standalone agreement prompts must not get navigation");
	assert.equal(differenceToolNames.includes("browser_list_tabs"), false, "standalone difference prompts must not get tab enumeration");
	assert.equal(differenceToolNames.includes("browser_navigate"), false, "standalone difference prompts must not get navigation");
	assert.equal(citationToolNames.includes("browser_pdf_find_citation"), true, "citation prompts should get the citation lookup tool");
	assert.equal(citationToolNames.includes("browser_open_pdf_in_onhand_viewer"), true);
	assert.equal(pdfContextToolNames.includes("browser_open_pdf_in_onhand_viewer"), true);
	assert.equal(pdfContextToolNames.includes("browser_pdf_search"), true);
	assert.equal(pdfContextToolNames.includes("browser_pdf_read_pages"), true);
	assert.equal(pdfContextToolNames.includes("browser_pdf_jump_to_page"), true);
	assert.equal(externalSourceToolNames.includes("browser_navigate"), true);
	assert.equal(externalSourceToolNames.includes("browser_activate_tab"), true);
	assert.equal(externalSourceToolNames.includes("browser_click_text"), true);
	assert.equal(linkedNotesToolNames.includes("browser_navigate"), true, "linked-note requests should be able to open note URLs");
	assert.equal(linkedNotesToolNames.includes("browser_list_tabs"), true, "linked-note requests should be able to recover an already-open index tab");
	assert.equal(linkedNotesToolNames.includes("browser_activate_tab"), true, "linked-note requests should be able to activate an already-open index tab");
	assert.equal(linkedNotesToolNames.includes("browser_find_elements"), true, "linked-note requests should be able to discover link elements");
	assert.equal(linkedNotesToolNames.includes("browser_click"), true, "linked-note requests should be able to click precise link selectors");
	assert.equal(linkedNotesToolNames.includes("browser_click_text"), true, "linked-note requests should be able to click visible note links");
	assert.equal(linkedNotesFollowupToolNames.includes("browser_list_tabs"), true, "other-note followups should be able to find the original notes index tab");
	assert.equal(linkedNotesFollowupToolNames.includes("browser_activate_tab"), true, "other-note followups should be able to switch back to the original notes index tab");
	assert.equal(linkedNotesFollowupToolNames.includes("browser_find_elements"), true, "other-note followups should be able to discover additional note links");
	assert.equal(learningToolNames.includes("onhand_record_learning_event"), true);
	assert.equal(learningToolNames.includes("browser_list_tabs"), false, "learning mode alone must not expose cross-tab enumeration");
	const repeatedLearningToolNames = getToolNamesForTest("How does rejection sampling work?", true, contract.learnerState);
	assert.equal(repeatedLearningToolNames.includes("onhand_record_learning_event"), true);
	assert.equal(repeatedLearningToolNames.includes("browser_scroll_to_annotation"), true);
	assert.equal(repeatedLearningToolNames.includes("browser_show_note"), false);
	assert.equal(repeatedLearningToolNames.includes("browser_extract_content"), false);
	assert.equal(classifyPromptForReasoning("what is this term?", [], true), "balanced");
	assert.equal(classifyPromptForReasoning("What are React components, and why would I split UI into components?", [], false), "balanced");
	assert.equal(classifyPromptForReasoning("compare the two derivations on this page", [], true), "deep");
}

async function assertPdfCitationFormatting() {
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const { formatPdfCitationForModel } = __browserRuntimeTest;
	const found = formatPdfCitationForModel({
		citation: {
			found: true,
			reference: "2",
			pageNumber: 10,
			entryText: "[2] Dzmitry Bahdanau, Kyunghyun Cho, and Yoshua Bengio. Neural machine translation by jointly learning to align and translate. CoRR, abs/1409.0473, 2014.",
			identifiers: { arxivId: "1409.0473", suggestedUrl: "https://arxiv.org/pdf/1409.0473" },
		},
	});
	assert.match(found, /Citation entry for \[2\] on p\. 10/);
	assert.match(found, /arXiv id: 1409\.0473/);
	assert.match(found, /navigate to https:\/\/arxiv\.org\/pdf\/1409\.0473 in a new tab/);
	assert.match(found, /browser_highlight_text/);

	const missing = formatPdfCitationForModel({
		citation: { found: false, reference: "99", message: "No bibliography entry matched." },
	});
	assert.match(missing, /No citation entry found for "99"/);

	const noLink = formatPdfCitationForModel({
		citation: { found: true, reference: "3", pageNumber: 11, entryText: "[3] Some Author. A book. Publisher, 1999.", identifiers: {} },
	});
	assert.match(noLink, /no direct link/);

	const privateLink = formatPdfCitationForModel({
		citation: {
			found: true,
			reference: "14",
			pageNumber: 12,
			entryText: "[14] Mallory. Internal appliance manual. http://127.0.0.1:8080/secret",
			identifiers: { suggestedUrl: "http://127.0.0.1:8080/secret" },
		},
	});
	assert.doesNotMatch(privateLink, /navigate to http:\/\/127\.0\.0\.1:8080\/secret/);
	assert.match(privateLink, /no direct link safe to open automatically/);
}

async function assertSpacedReviewScheduling() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime, __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const { computeDueReviews } = __browserRuntimeTest;
	const DAY = 24 * 60 * 60 * 1000;
	const now = Date.parse("2026-06-09T12:00:00.000Z");
	const iso = (msAgo) => new Date(now - msAgo).toISOString();
	const makeSession = (id, learnerState) => ({
		id,
		name: id,
		createdAt: iso(30 * DAY),
		updatedAt: iso(DAY),
		messages: [],
		turns: [],
		pageActions: [],
		artifactIds: [],
		learnerState,
	});
	const concept = (conceptId, label, lastSeenMsAgo, sources = []) => ({
		conceptId,
		label,
		firstSeenAt: iso(lastSeenMsAgo + DAY),
		lastSeenAt: iso(lastSeenMsAgo),
		sources,
	});

	const sessions = [
		makeSession("session_a", {
			mode: "learning",
			conceptsIntroduced: [
				concept("concept_due", "Chain rule", 2 * DAY, [{ tabTitle: "Calc notes", url: "https://example.test/calc" }]),
				concept("concept_fresh", "Quotient rule", 2 * 60 * 60 * 1000),
			],
			openChecks: [],
			responses: [],
		}),
		makeSession("session_b", {
			mode: "learning",
			conceptsIntroduced: [concept("concept_boxed", "Bayes theorem", 6 * DAY, [{ url: "https://example.test/bayes" }])],
			openChecks: [],
			responses: [{ checkId: "check_bayes", assessment: "correct", resolvedAt: iso(2 * DAY), conceptId: "concept_boxed", promptText: "State Bayes theorem." }],
		}),
	];

	const due = computeDueReviews(sessions, { now, limit: 5 });
	const labels = due.map((review) => review.label);
	assert.ok(labels.includes("Chain rule"), "an unassessed concept past its first interval should be due");
	assert.ok(!labels.includes("Quotient rule"), "a concept seen hours ago should not be due yet");
	assert.ok(!labels.includes("Bayes theorem"), "a correct assessment should advance the interval past now");
	const chainRule = due.find((review) => review.label === "Chain rule");
	assert.equal(chainRule.box, 0);
	assert.equal(chainRule.overdueDays, 1);
	assert.equal(chainRule.sources[0].url, "https://example.test/calc");

	const resetSessions = [
		makeSession("session_c", {
			mode: "learning",
			conceptsIntroduced: [concept("concept_reset", "Markov chains", 10 * DAY)],
			openChecks: [],
			responses: [
				{ checkId: "c1", assessment: "correct", resolvedAt: iso(9 * DAY), conceptId: "concept_reset" },
				{ checkId: "c2", assessment: "incorrect", resolvedAt: iso(2 * DAY), conceptId: "concept_reset" },
			],
		}),
	];
	const reset = computeDueReviews(resetSessions, { now });
	assert.equal(reset.length, 1, "an incorrect assessment should reset the interval and come due quickly");
	assert.equal(reset[0].box, 0);
	assert.equal(reset[0].lastAssessment, "incorrect");

	const snoozed = computeDueReviews(sessions, { now, snoozes: { "chain rule": new Date(now + DAY).toISOString() } });
	assert.ok(!snoozed.some((review) => review.label === "Chain rule"), "snoozed concepts should be excluded until the snooze expires");

	const boostSessions = [
		makeSession("session_d", {
			mode: "learning",
			conceptsIntroduced: [
				concept("concept_near", "On-page concept", 3 * DAY, [{ url: "https://example.test/calc" }]),
				concept("concept_far", "Off-page concept", 10 * DAY, [{ url: "https://other.test/notes" }]),
			],
			openChecks: [],
			responses: [],
		}),
	];
	const boosted = computeDueReviews(boostSessions, { now, activeUrl: "https://example.test/anything" });
	assert.equal(boosted[0].label, "On-page concept", "concepts sourced from the active tab's domain should sort first");
	assert.equal(boosted[0].matchesActiveTab, true);

	const mergedSessions = [
		makeSession("session_e", {
			mode: "learning",
			conceptsIntroduced: [concept("concept_e", "Chain rule", 12 * DAY)],
			openChecks: [],
			responses: [{ checkId: "ce", assessment: "correct", resolvedAt: iso(11 * DAY), conceptId: "concept_e" }],
		}),
		makeSession("session_f", {
			mode: "learning",
			conceptsIntroduced: [concept("concept_f", "Chain rule", 4 * DAY)],
			openChecks: [],
			responses: [],
		}),
	];
	const merged = computeDueReviews(mergedSessions, { now });
	assert.equal(merged.filter((review) => review.label === "Chain rule").length, 1, "the same concept across sessions should merge into one review");
	assert.equal(merged[0].sessionId, "session_f", "the merged review should point at the most recent session");
	assert.equal(merged[0].box, 1, "the merged review should keep the assessment history from the earlier session");

	// Runtime surface: listDueReviews reads sessions from storage and
	// snoozeReview persists an exclusion.
	const host = createReplayHost();
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({ aiProvider: "onhand-smoke", aiModel: "onhand-smoke-1", aiApiKey: "test", authMode: "api-key" });
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.learnerState = {
		mode: "learning",
		conceptsIntroduced: [concept("concept_live", "Spectral theorem", 4 * DAY, [{ url: "https://example.test/spectral" }])],
		openChecks: [],
		responses: [],
	};
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));
	const listed = await runtime.listDueReviews({ now });
	assert.equal(listed.reviews.length, 1);
	assert.equal(listed.reviews[0].label, "Spectral theorem");
	const afterSnooze = await runtime.snoozeReview({ conceptKey: listed.reviews[0].conceptKey, days: 3, now });
	assert.equal(afterSnooze.reviews.length, 0, "a snoozed review should disappear from the due list");
	const state = await runtime.getState();
	assert.ok(Array.isArray(state.dueReviews), "runtime state should expose dueReviews");
}

async function assertFallbackOpenCheckRecording() {
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const { extractTrailingCheckQuestion, withFallbackOpenCheck, applyLearningEvent, createEmptyLearnerState } = __browserRuntimeTest;

	assert.equal(
		extractTrailingCheckQuestion("Explanation text.\n\nHere's a short question for you: Why does the paper scale the dot products?"),
		"Why does the paper scale the dot products?",
		"trailing check question should be extracted without its lead-in",
	);
	assert.equal(extractTrailingCheckQuestion("All done. Want me to explain more?"), "", "conversational offers should not become checks");
	assert.equal(extractTrailingCheckQuestion("The slope is 3."), "", "non-question replies should not become checks");
	assert.equal(extractTrailingCheckQuestion("Why?"), "", "too-short questions should be ignored");

	const startedAt = "2026-06-09T18:00:00.000Z";
	let state = applyLearningEvent(createEmptyLearnerState("learning"), {
		kind: "concept_introduced",
		conceptLabel: "Scaled dot-product attention",
		at: "2026-06-09T18:00:05.000Z",
	});
	state = withFallbackOpenCheck(state, "Explained.\n\nIn your own words, why are the dot products scaled?", startedAt);
	assert.equal(state.openChecks.length, 1, "fallback should record the trailing question as an open check");
	assert.equal(state.openChecks[0].promptText, "In your own words, why are the dot products scaled?");
	assert.equal(state.openChecks[0].conceptId, state.conceptsIntroduced[0].conceptId, "fallback check should attach to the turn's concept");

	const unchanged = withFallbackOpenCheck(state, "Another question here, what about this?", startedAt);
	assert.equal(unchanged.openChecks.length, 1, "fallback should not add a second check when one was already opened this turn");

	const noQuestion = withFallbackOpenCheck(applyLearningEvent(createEmptyLearnerState("learning"), { kind: "concept_introduced", conceptLabel: "X" }), "Plain answer.", startedAt);
	assert.equal(noQuestion.openChecks.length, 0, "no trailing question should record nothing");
}

async function assertLearnerStateUpdates() {
	const { createOnhandBrowserRuntime, __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const { applyLearningEvent, buildLearningCheckFollowupForTest, createEmptyLearnerState, normalizeLearnerState, setLearnerStateMode } = __browserRuntimeTest || {};
	assert.equal(typeof createEmptyLearnerState, "function", "browser runtime learner-state factory export is missing");
	assert.equal(typeof normalizeLearnerState, "function", "browser runtime learner-state normalizer export is missing");
	assert.equal(typeof applyLearningEvent, "function", "browser runtime learning-event reducer export is missing");
	assert.equal(typeof setLearnerStateMode, "function", "browser runtime learner-state mode export is missing");
	assert.equal(typeof buildLearningCheckFollowupForTest, "function", "browser runtime learning follow-up helper export is missing");

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
	const derivativeFollowup = buildLearningCheckFollowupForTest("I think the derivative measures rate of change.", learnerState);
	assert.equal(derivativeFollowup?.check?.checkId, "check-derivative-1", "related answer-shaped follow-up should resolve the matching open check");

	let staleMdnCheckState = createEmptyLearnerState("learning");
	staleMdnCheckState = applyLearningEvent(staleMdnCheckState, {
		kind: "concept_introduced",
		conceptLabel: "Promise.allSettled result objects",
		conceptId: "concept_promise_allsettled_result_objects",
		tabTitle: "Promise.allSettled() - JavaScript | MDN",
		url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled",
	});
	staleMdnCheckState = applyLearningEvent(staleMdnCheckState, {
		kind: "check_opened",
		checkId: "check-mdn-reason",
		checkKind: "retrieval",
		conceptId: "concept_promise_allsettled_result_objects",
		promptText: "If one input promise rejects with \"Network error\", what would that result object contain: value or reason?",
	});
	const unrelatedCalculusFollowup = buildLearningCheckFollowupForTest(
		"I think the inside derivative is 6x + 7. Is that right? Please help me fix it if needed.",
		staleMdnCheckState,
	);
	assert.equal(unrelatedCalculusFollowup, null, "unrelated answer-shaped prompt must not resolve a stale open check from another concept");
	const relatedMdnFollowup = buildLearningCheckFollowupForTest("I think it would contain reason.", staleMdnCheckState);
	assert.equal(relatedMdnFollowup?.check?.checkId, "check-mdn-reason", "related answer-shaped prompt should still resolve the matching open check");

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
			conceptId: "concept_derivative",
			promptText: "What input change is this derivative measuring?",
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

	let conceptHygieneState = createEmptyLearnerState("learning");
	conceptHygieneState = applyLearningEvent(
		conceptHygieneState,
		{
			kind: "concept_introduced",
			conceptId: "concept_rejection_sampling_impractical",
			conceptLabel: "Why rejection sampling is impractical for posterior sampling",
			annotationId: "posterior-bound",
			tabTitle: "BayesianDL",
			url: "https://example.test/bayesian-dl",
		},
		{ now: "2026-05-18T05:06:00.000Z" },
	);
	conceptHygieneState = applyLearningEvent(
		conceptHygieneState,
		{
			kind: "concept_introduced",
			conceptId: "concept_posterior_rejection_sampling_impracticality",
			conceptLabel: "Rejection sampling impracticality for posterior sampling",
			annotationId: "posterior-bound-note",
			tabTitle: "BayesianDL",
			url: "https://example.test/bayesian-dl#nearby",
		},
		{ now: "2026-05-18T05:07:00.000Z" },
	);
	assert.equal(conceptHygieneState.conceptsIntroduced.length, 1, "near-duplicate learning concepts on the same page should be reused");
	assert.equal(conceptHygieneState.conceptsIntroduced[0].conceptId, "concept_rejection_sampling_impractical");
	assert.equal(conceptHygieneState.conceptsIntroduced[0].lastSeenAt, "2026-05-18T05:07:00.000Z");
	assert.deepEqual(
		conceptHygieneState.conceptsIntroduced[0].sources.map((source) => source.annotationId),
		["posterior-bound", "posterior-bound-note"],
	);

	conceptHygieneState = applyLearningEvent(
		conceptHygieneState,
		{
			kind: "concept_introduced",
			conceptId: "concept_m_prime_acceptance",
			conceptLabel: "M prime in acceptance probability simplification",
			annotationId: "acceptance-simplification",
			tabTitle: "BayesianDL",
			url: "https://example.test/bayesian-dl",
		},
		{ now: "2026-05-18T05:08:00.000Z" },
	);
	assert.equal(conceptHygieneState.conceptsIntroduced.length, 2, "distinct nearby learning concepts should remain separate");

	conceptHygieneState = applyLearningEvent(
		conceptHygieneState,
		{
			kind: "check_opened",
			checkId: "check-rejection-impractical",
			checkKind: "retrieval",
			conceptId: "concept_why_posterior_rejection_sampling_is_impractical",
			conceptLabel: "Why posterior rejection sampling is impractical",
			promptText: "Why does the global M bound make this inefficient?",
			annotationId: "posterior-bound-note",
			tabTitle: "BayesianDL",
			url: "https://example.test/bayesian-dl",
		},
		{ now: "2026-05-18T05:09:00.000Z" },
	);
	assert.equal(conceptHygieneState.conceptsIntroduced.length, 2, "opening a check should not create a duplicate near-matching concept");
	assert.equal(conceptHygieneState.openChecks[0].conceptId, "concept_rejection_sampling_impractical");

	const dedupedLegacyConceptState = normalizeLearnerState({
		mode: "learning",
		conceptsIntroduced: [
			{
				conceptId: "concept_rejection_sampling_impractical",
				label: "Why rejection sampling is impractical for posterior sampling",
				firstSeenAt: "2026-05-18T05:00:00.000Z",
				lastSeenAt: "2026-05-18T05:00:00.000Z",
				sources: [{ annotationId: "posterior-bound", tabTitle: "BayesianDL", url: "https://example.test/bayesian-dl" }],
			},
			{
				conceptId: "concept_posterior_rejection_sampling_impracticality",
				label: "Rejection sampling impracticality for posterior sampling",
				firstSeenAt: "2026-05-18T05:01:00.000Z",
				lastSeenAt: "2026-05-18T05:02:00.000Z",
				sources: [{ annotationId: "posterior-bound-note", tabTitle: "BayesianDL", url: "https://example.test/bayesian-dl" }],
			},
			{
				conceptId: "concept_m_prime_acceptance",
				label: "M prime in acceptance probability simplification",
				firstSeenAt: "2026-05-18T05:03:00.000Z",
				lastSeenAt: "2026-05-18T05:03:00.000Z",
				sources: [{ annotationId: "acceptance-simplification", tabTitle: "BayesianDL", url: "https://example.test/bayesian-dl" }],
			},
		],
	});
	assert.equal(dedupedLegacyConceptState.conceptsIntroduced.length, 2, "normalization should compact legacy near-duplicate concepts");
	assert.equal(dedupedLegacyConceptState.conceptsIntroduced[0].lastSeenAt, "2026-05-18T05:02:00.000Z");

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
	const store = getStoredStore();
	const savedSession = store.sessions[store.currentSessionId];
	assert.equal(savedSession.learnerState.mode, "learning");
	assert.equal(savedSession.learnerState.conceptsIntroduced[0].label, "Monte Carlo");
}

async function assertLearnerSourceSelfHealsByText() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	// The original highlight element is gone (e.g. concept tracked in an
	// earlier session, or a not-yet-rendered page of a large PDF), so
	// scroll_to_annotation fails. The jump must re-find the passage by its
	// stored text instead of giving up with "Source not found".
	const host = createReplayHost({ rejectScrollToAnnotation: () => true });
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({ aiProvider: "onhand-smoke", aiModel: "onhand-smoke-1", aiApiKey: "test", authMode: "api-key" });
	assert.equal(typeof runtime.jumpToLearnerSource, "function", "runtime should expose a self-healing learner-source jump");
	const jumped = await runtime.jumpToLearnerSource({
		annotationId: "ann-gone",
		matchedText: "Alpha smoke content",
		url: replaySmokeTab().url,
		tabTitle: replaySmokeTab().title,
	});
	assert.equal(jumped.ok, true, "self-healing jump should succeed by re-finding the text");
	assert.equal(jumped.mode, "text", "jump should re-find via text when the annotation element is gone");
	assert.ok(
		host.calls.some((call) => call.name === "highlight_text" && String(call.args.text || "").includes("Alpha smoke content")),
		"jump should re-highlight the stored source text",
	);
	// With nothing to re-find by, it still reports a clean miss.
	await assert.rejects(
		runtime.jumpToLearnerSource({ annotationId: "ann-gone", url: replaySmokeTab().url }),
		/Source not found on this page/,
		"a jump with no text or artifact should surface a clean not-found error",
	);
}

async function assertLearnerSourceRecoversTextAcrossSessions() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	// A concept tracked before sources stored their text: its source has only
	// a now-stale annotation id, but the highlight page action that created it
	// still lives in an earlier session with the verbatim text intact.
	globalThis.chrome.storage.local.data.onhandBrowserSessions = {
		old_session: {
			id: "old_session",
			name: "old",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
			messages: [],
			turns: [],
			pageActions: [
				{
					// The annotationId field has drifted (re-materialized on a
					// past restore), but the key still embeds the original id the
					// concept source kept. Recovery must match on the key.
					key: "highlight:ann-rnd",
					type: "annotation",
					label: "Highlighted text",
					annotationId: "ann-rnd-restored-9",
					citationText: "Alpha smoke content",
					url: replaySmokeTab().url,
					title: replaySmokeTab().title,
				},
			],
			artifactIds: [],
			learnerState: null,
		},
	};
	const host = createReplayHost({ rejectScrollToAnnotation: () => true });
	const runtime = createOnhandBrowserRuntime(host);
	const jumped = await runtime.jumpToLearnerSource({ annotationId: "ann-rnd", target: "annotation" });
	assert.equal(jumped.ok, true, "jump should recover the passage text from the originating session");
	assert.equal(jumped.mode, "text", "recovered jump should re-find by text");
	assert.ok(
		host.calls.some((call) => call.name === "highlight_text" && String(call.args.text || "").includes("Alpha smoke content")),
		"recovery should re-highlight the originating session's stored text",
	);
}

async function assertLearnerSourceRecoversByConceptLabelWhenIdsDrift() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	// After several restores the concept's annotation id has drifted to a
	// generation that matches neither the page action's id nor its key. The
	// only link left is content: the concept label overlaps the highlight's
	// text on the same page, so recovery should re-find it by that.
	globalThis.chrome.storage.local.data.onhandBrowserSessions = {
		old_session: {
			id: "old_session",
			name: "old",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
			messages: [],
			turns: [],
			pageActions: [
				{
					key: "highlight:onhand-pdf-original-1",
					type: "annotation",
					label: "Highlighted text",
					annotationId: "onhand-pdf-gen2-aaaa",
					citationText: "Alpha smoke content evaluation claim",
					url: replaySmokeTab().url,
					title: replaySmokeTab().title,
					pdfAnchor: { surface: "pdf", pageNumber: 4, occurrence: 1 },
				},
				{
					key: "highlight:onhand-pdf-other-2",
					type: "annotation",
					label: "Highlighted text",
					annotationId: "onhand-pdf-gen2-bbbb",
					citationText: "An unrelated paragraph about something else",
					url: replaySmokeTab().url,
					title: replaySmokeTab().title,
					pdfAnchor: { surface: "pdf", pageNumber: 9, occurrence: 1 },
				},
			],
			artifactIds: [],
			learnerState: null,
		},
	};
	const host = createReplayHost({ rejectScrollToAnnotation: () => true });
	const runtime = createOnhandBrowserRuntime(host);
	// The drifted id matches nothing; only the label can re-link the concept.
	const jumped = await runtime.jumpToLearnerSource({
		annotationId: "onhand-pdf-gen3-zzzz",
		conceptLabel: "Alpha smoke content evaluation claim",
		url: replaySmokeTab().url,
		target: "annotation",
	});
	assert.equal(jumped.ok, true, "drifted-id concept should recover by label-to-text overlap");
	assert.equal(jumped.mode, "text", "label recovery should re-find the matched highlight by text");
	assert.ok(
		host.calls.some((call) => call.name === "highlight_text" && String(call.args.text || "").includes("Alpha smoke content evaluation claim")),
		"label recovery should re-highlight the best-matching highlight, not the unrelated one",
	);
}

async function assertLearnerSourcePageFallbackWhenTextUnfindable() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	// The page action's text is recovered, but the exact passage can no
	// longer be re-highlighted (complex PDF text). The recovered anchor still
	// names the page, so the jump should land the reader there, not dead-end.
	globalThis.chrome.storage.local.data.onhandBrowserSessions = {
		old_session: {
			id: "old_session",
			name: "old",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
			messages: [],
			turns: [],
			pageActions: [
				{
					key: "highlight:ann-orig",
					type: "annotation",
					label: "Highlighted text",
					annotationId: "ann-drifted",
					citationText: "A passage that no longer re-matches exactly",
					url: replaySmokeTab().url,
					title: replaySmokeTab().title,
					pdfAnchor: { surface: "pdf", pageNumber: 7, occurrence: 1, matchedText: "A passage that no longer re-matches exactly" },
				},
			],
			artifactIds: [],
			learnerState: null,
		},
	};
	const host = createReplayHost({
		rejectScrollToAnnotation: () => true,
		rejectHighlightText: () => true,
	});
	const runtime = createOnhandBrowserRuntime(host);
	const jumped = await runtime.jumpToLearnerSource({ annotationId: "ann-drifted", target: "annotation" });
	assert.equal(jumped.ok, true, "jump should fall back to the anchor page when the exact highlight cannot be rebuilt");
	assert.equal(jumped.mode, "page", "fallback should report a page jump");
	assert.equal(jumped.pageNumber, 7, "fallback should jump to the recovered anchor page");
	assert.ok(
		host.calls.some((call) => call.name === "pdf_jump_to_page" && Number(call.args.pageNumber) === 7),
		"fallback should issue a pdf_jump_to_page to the anchor page",
	);
}

async function assertLearnerSourceWiring() {
	const { readFile } = await import("node:fs/promises");
	const runtimeSource = await readFile(new URL("../packages/browser-extension/src/browser-runtime.ts", import.meta.url), "utf8");
	assert.match(runtimeSource, /function enrichLearningEventSource/, "runtime should enrich learner events with the highlight's verbatim text");
	assert.match(runtimeSource, /matchedText = compactLearnerText\(rawSource\?\.matchedText \|\| rawSource\?\.citationText/, "learner source should persist matchedText");
	const sidebarSource = await readFile(new URL("../packages/browser-extension/sidebar.js", import.meta.url), "utf8");
	assert.match(sidebarSource, /sidebar:jump-learner-source/, "sidebar should route source jumps through the self-healing resolver");
	assert.match(sidebarSource, /data-source-text=/, "sidebar source button should carry the passage text for re-finding");
	const backgroundSource = await readFile(new URL("../packages/browser-extension/background.js", import.meta.url), "utf8");
	assert.match(backgroundSource, /sidebar:jump-learner-source/, "background should handle the learner-source jump message");
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
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	assert.equal(session.learnerState.conceptsIntroduced[0].label, "Alpha smoke content");
	assert.equal(session.learnerState.openChecks[0].checkId, "check-alpha-smoke");
}

async function assertLearningOpenCheckVoiceAnswerResolvesWithoutRegrounding() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost();
	const runtime = createOnhandBrowserRuntime(host);
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
	await waitForRuntimeCompletion(runtime);
	const highlightCallsBeforeAnswer = host.calls.filter((call) => call.name === "highlight_text").length;
	await runtime.submitPrompt({
		prompt: "I think it is saying this is the important page concept.",
		displayPrompt: "[Voice] I think it is saying this is the important page concept.",
		source: "realtime-voice-direct-answer",
		attachments: [],
		learningMode: true,
	});
	const completedState = await waitForRuntimeCompletion(runtime);
	assert.equal(completedState?.activeRequestId, null, "runtime did not complete voice check-answer regression");
	assert.equal(completedState.learnerState.openChecks.length, 0, "voice answer should resolve the existing open check");
	assert.equal(completedState.learnerState.responses[0].checkId, "check-alpha-smoke");
	assert.equal(completedState.learnerState.responses[0].assessment, "correct");
	assert.match(completedState.turns.at(-1)?.reply || "", /answers the check|right direction/i);
	assert.equal(
		host.calls.filter((call) => call.name === "highlight_text").length,
		highlightCallsBeforeAnswer,
		"answering an open check should not create a replacement highlight",
	);
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

async function assertDeleteSessionSwitchesToRemainingOrFreshSession() {
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
	const store = getStoredStore();
	const firstSessionId = store.currentSessionId;
	store.sessions[firstSessionId].name = "First session";
	store.sessions[firstSessionId].updatedAt = "2026-05-12T10:00:00.000Z";
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

	await runtime.startNewSession({ targetWindowId: 4 });
	const withSecondSession = getStoredStore();
	const secondSessionId = withSecondSession.currentSessionId;
	assert.notEqual(secondSessionId, firstSessionId, "starting a new session should create a second session before delete regression");

	const callCountBeforeDelete = host.calls.length;
	const deletedSecond = await runtime.deleteSession(secondSessionId, { targetWindowId: 4 });
	const deleteCalls = host.calls.slice(callCountBeforeDelete);
	const afterDeletingSecond = getStoredStore();
	assert.equal(afterDeletingSecond.sessions[secondSessionId], undefined, "expected deleted current session to be removed from storage");
	assert.equal(afterDeletingSecond.currentSessionId, firstSessionId, "expected delete to switch to the remaining session");
	assert.equal(deletedSecond.deletedSessionId, secondSessionId);
	assert.equal(deletedSecond.currentSession.sessionId, firstSessionId);
	assert.equal(deleteCalls.some((call) => call.name === "clear_annotations" && call.args.tabId === 8), true);
	assert.equal(deleteCalls.some((call) => call.name === "clear_annotations" && call.args.tabId === 7), false);
	const stateAfterDelete = await runtime.getState();
	assert.equal(stateAfterDelete.currentSession.sessionId, firstSessionId, "runtime state should follow the selected replacement session");

	const deletedLast = await runtime.deleteSession(firstSessionId, { targetWindowId: 4 });
	const afterDeletingLast = getStoredStore();
	const remainingSessionIds = Object.keys(afterDeletingLast.sessions);
	assert.equal(afterDeletingLast.sessions[firstSessionId], undefined, "expected original last session to be removed");
	assert.equal(remainingSessionIds.length, 1, "deleting the final saved session should create one fresh session");
	assert.notEqual(afterDeletingLast.currentSessionId, firstSessionId);
	assert.equal(deletedLast.deletedSessionId, firstSessionId);
	assert.equal(deletedLast.currentSession.sessionId, afterDeletingLast.currentSessionId);
	const freshState = await runtime.getState();
	assert.equal(freshState.currentSession.sessionId, afterDeletingLast.currentSessionId);
	assert.deepEqual(freshState.turns, [], "fresh replacement session should not inherit deleted turns");
}

async function assertLegacySessionBlobMigratesToSessionRecords() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const legacySession = {
		id: "session_legacy_1",
		name: "Legacy session",
		createdAt: "2026-05-01T10:00:00.000Z",
		updatedAt: "2026-05-02T10:00:00.000Z",
		messages: [],
		turns: [],
		pageActions: [],
		artifactIds: [],
	};
	globalThis.chrome.storage.local.data.onhandBrowserRuntime = {
		settings: {
			aiProvider: "openai",
			aiModel: "gpt-4.1-mini",
			aiApiKey: "sk-legacy-secret",
			authMode: "api-key",
		},
		sessions: { [legacySession.id]: legacySession },
		currentSessionId: legacySession.id,
	};

	const runtime = createOnhandBrowserRuntime(createReplayHost());
	const listed = await runtime.listSessions();
	assert.equal(listed.currentSession.sessionId, legacySession.id, "legacy current session should survive migration");
	assert.ok(listed.sessions.some((session) => session.id === legacySession.id), "legacy session should be listed after migration");

	const migratedSessions = getStoredSessions();
	assert.ok(migratedSessions[legacySession.id], "legacy session should move into per-session storage");
	assert.equal(migratedSessions[legacySession.id].name, "Legacy session");
	const meta = globalThis.chrome.storage.local.data.onhandBrowserRuntime;
	assert.equal(meta.sessions, undefined, "legacy blob should be stripped of sessions after migration");
	assert.equal(meta.currentSessionId, legacySession.id, "currentSessionId should stay in the meta blob");
	assert.equal(meta.settings.aiApiKey, "sk-legacy-secret", "settings should survive migration");

	migratedSessions[legacySession.id].name = "Renamed after migration";
	const rebooted = createOnhandBrowserRuntime(createReplayHost());
	const relisted = await rebooted.listSessions();
	const matches = relisted.sessions.filter((session) => session.id === legacySession.id);
	assert.equal(matches.length, 1, "reboot after migration should not duplicate the migrated session");
	assert.equal(matches[0].name, "Renamed after migration", "per-session record should win over any stale legacy copy");
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
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	assert.equal(session.artifactIds.length, 1, "annotated turns should auto-save a review snapshot");
	assert.equal(session.pageActions.some((action) => action.key === "highlight:replay-highlight"), true);
	session.artifactIds = [];
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

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

async function assertSelectedPdfAnchorIsReusedForPromptHighlight() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const pdfAnchor = {
		surface: "pdf",
		viewer: "pdfjs",
		document: {
			url: "https://example.test/lecture.pdf",
			title: "Lecture PDF",
			pageCount: 12,
		},
		pageNumber: 2,
		matchedText: "Alpha smoke content",
		textQuote: {
			exact: "Alpha smoke content",
		},
		rects: [
			{
				pageNumber: 2,
				x: 0.24,
				y: 0.36,
				width: 0.18,
				height: 0.04,
				coordinateSpace: "page-normalized",
			},
		],
	};
	const host = createReplayHost({
		tabs: [replaySmokeTab({ title: "Lecture PDF", url: "https://example.test/lecture.pdf" })],
		selection: {
			text: "Alpha smoke content",
			surface: "pdf",
			viewer: "pdfjs",
			pageNumber: 2,
			pdfAnchor,
		},
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	await runtime.submitPrompt({
		prompt: "Explain the selected PDF text.",
		displayPrompt: "selected PDF smoke",
		attachments: [],
		learningMode: false,
	});
	const completedState = await waitForRuntimeCompletion(runtime);
	assert.equal(completedState?.activeRequestId, null, "runtime did not complete selected-PDF regression");
	const highlightCalls = host.calls.filter((call) => call.name === "highlight_text");
	assert.equal(highlightCalls.length >= 1, true);
	assert.deepEqual(highlightCalls[0].args.pdfAnchor, pdfAnchor);
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	const highlightAction = session.pageActions.find((action) => action.type === "annotation");
	assert.deepEqual(highlightAction?.pdfAnchor, pdfAnchor);
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
	const store = getStoredStore();
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
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

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

async function assertSessionReplayDoesNotReuseSameTitleWrongUrl() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const targetUrl = "https://arxiv.org/search/?query=AxBench+Steering+LLMs+simple+baselines+outperform&searchtype=all";
	const wrongUrl = "https://arxiv.org/search/?query=causal+interventions+activation+steering+language+models&searchtype=all";
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
				title: "Search | arXiv e-print repository",
				url: wrongUrl,
			}),
		],
		navigateTabId: 21,
		navigateTitle: "Search | arXiv e-print repository",
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = [];
	session.pageActions = [
		{
			key: "highlight:arxiv-title",
			type: "annotation",
			tabId: 1235288553,
			title: "Search | arXiv e-print repository",
			url: targetUrl,
			label: "Highlighted text",
			citationText: "AxBench: Steering LLMs? Even Simple Baselines Outperform Sparse Autoencoders",
			annotationId: "arxiv-title",
		},
	];
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	assert.equal(restored.restoredPages.length, 1);
	assert.equal(restored.restoredPages[0].tabId, 21);
	assert.equal(restoreCalls.some((call) => call.name === "navigate" && call.args.url === targetUrl), true);
	assert.equal(restoreCalls.some((call) => call.name === "clear_annotations" && call.args.tabId === 8), false);
	assert.equal(restoreCalls.some((call) => call.name === "highlight_text" && call.args.tabId === 8), false);
	assert.equal(restoreCalls.some((call) => call.name === "highlight_text" && call.args.tabId === 21), true);
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
	const store = getStoredStore();
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
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

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

	const savedSession = getStoredSessions()[session.id];
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
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = ["artifact_empty_restore"];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
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

async function assertArtifactRestoreDoesNotReuseSameTitleWrongUrl() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const targetUrl = "https://arxiv.org/search/?query=%22Decomposing+The+Dark+Matter+of+Sparse+Autoencoders%22&searchtype=all";
	const wrongUrl = "https://arxiv.org/search/?query=causal+interventions+activation+steering+language+models&searchtype=all";
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
				title: "Search | arXiv e-print repository",
				url: wrongUrl,
			}),
		],
		navigateTabId: 22,
		navigateTitle: "Search | arXiv e-print repository",
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = ["artifact_arxiv_generic_title"];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_arxiv_generic_title: {
				id: "artifact_arxiv_generic_title",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "arxiv generic title",
				tab: {
					id: 1235288554,
					windowId: 3,
					title: "Search | arXiv e-print repository",
					url: targetUrl,
				},
				page: {
					title: "Search | arXiv e-print repository",
					url: targetUrl,
					annotations: [
						{
							annotationId: "dark-matter-title",
							kind: "inline",
							matchedText: "Decomposing The Dark Matter of Sparse Autoencoders",
						},
					],
				},
			},
		},
	});

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	assert.equal(restored.restoredPages.length, 1);
	assert.equal(restored.restoredPages[0].tabId, 22);
	assert.equal(restoreCalls.some((call) => call.name === "navigate" && call.args.url === targetUrl), true);
	assert.equal(restoreCalls.some((call) => call.name === "clear_annotations" && call.args.tabId === 8), false);
	assert.equal(restoreCalls.some((call) => call.name === "highlight_text" && call.args.tabId === 8), false);
	assert.equal(restoreCalls.some((call) => call.name === "highlight_text" && call.args.tabId === 22), true);
}

async function assertArtifactRestoreScrollsBeforeHighlightForVirtualizedPage() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const targetUrl = "https://chatgpt.com/c/restore-scroll-smoke";
	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 31,
				title: "Further study suggestions",
				url: targetUrl,
			}),
		],
		rejectHighlightText: (_text, _args, calls) =>
			!calls.some((call) => call.name === "run_js" && /targetY = 2400/.test(String(call.args.expression || "")) && /scrollTop/.test(String(call.args.expression || ""))),
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = ["artifact_virtualized_chat_scroll"];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_virtualized_chat_scroll: {
				id: "artifact_virtualized_chat_scroll",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "virtualized chat scroll",
				tab: replaySmokeTab({ id: 31, title: "Further study suggestions", url: targetUrl }),
				page: {
					title: "Further study suggestions",
					url: targetUrl,
					scrollX: 0,
					scrollY: 2400,
					annotations: [
						{
							annotationId: "chat-scroll-target",
							kind: "inline",
							matchedText: "around the question: when does a representation become a causal handle",
						},
					],
				},
			},
		},
	});

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	const preScrollIndex = restoreCalls.findIndex((call) => call.name === "run_js" && /targetY = 2400/.test(String(call.args.expression || "")) && /scrollTop/.test(String(call.args.expression || "")));
	const highlightIndex = restoreCalls.findIndex((call) => call.name === "highlight_text");
	assert.equal(restored.restoredPages.length, 1);
	assert.equal(restored.restoredPages[0].restoredAnnotations, 1);
	assert.equal(preScrollIndex >= 0, true);
	assert.equal(highlightIndex > preScrollIndex, true);
}

async function assertArtifactRestoreUsesSavedScrollContainerForVirtualizedPage() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const targetUrl = "https://chatgpt.com/c/restore-scroll-container-smoke";
	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 33,
				title: "Further study suggestions",
				url: targetUrl,
			}),
		],
		rejectHighlightText: (_text, _args, calls) =>
			!calls.some((call) => call.name === "run_js" && /targetY = 3600/.test(String(call.args.expression || "")) && /scrollTop/.test(String(call.args.expression || ""))),
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = ["artifact_virtualized_chat_scroll_container"];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_virtualized_chat_scroll_container: {
				id: "artifact_virtualized_chat_scroll_container",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "virtualized chat scroll container",
				tab: replaySmokeTab({ id: 33, title: "Further study suggestions", url: targetUrl }),
				page: {
					title: "Further study suggestions",
					url: targetUrl,
					scrollX: 0,
					scrollY: 0,
					scrollContainer: {
						source: "scrollable-element",
						scrollTop: 3600,
						scrollLeft: 0,
						scrollHeight: 9000,
						clientHeight: 720,
					},
					annotations: [
						{
							annotationId: "chat-scroll-container-target",
							kind: "inline",
							matchedText: "around the question: when does a representation become a causal handle",
						},
					],
				},
			},
		},
	});

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	const preScrollIndex = restoreCalls.findIndex((call) => call.name === "run_js" && /targetY = 3600/.test(String(call.args.expression || "")));
	const highlightIndex = restoreCalls.findIndex((call) => call.name === "highlight_text");
	assert.equal(restored.restoredPages.length, 1);
	assert.equal(restored.restoredPages[0].restoredAnnotations, 1);
	assert.equal(preScrollIndex >= 0, true);
	assert.equal(highlightIndex > preScrollIndex, true);
}

async function assertArtifactRestoreUsesVisibleFallbackForSplitChatText() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const targetUrl = "https://chatgpt.com/c/restore-visible-fallback-smoke";
	const fallbackText = "I’d focus your next study plan around the question:";
	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 34,
				title: "Further study suggestions",
				url: targetUrl,
			}),
		],
		runJsResult: (args) => {
			const expression = String(args.expression || "");
			if (/visible-replay-text-candidates/.test(expression)) return { candidates: [fallbackText] };
			if (/maxY/.test(expression)) return { scrollX: 0, scrollY: 0, innerHeight: 800, scrollHeight: 3000, maxY: 2200 };
			return true;
		},
		rejectHighlightText: (text) => text !== fallbackText,
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = ["artifact_split_chat_text"];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_split_chat_text: {
				id: "artifact_split_chat_text",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "split chat text",
				tab: replaySmokeTab({ id: 34, title: "Further study suggestions", url: targetUrl }),
				page: {
					title: "Further study suggestions",
					url: targetUrl,
					annotations: [
						{
							annotationId: "split-chat-target",
							kind: "inline",
							matchedText: "around the question: when does a representation that predicts reasoning success become a causal handle",
						},
					],
				},
			},
		},
	});

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	assert.equal(restored.restoredPages.length, 1);
	assert.equal(restored.restoredPages[0].restoredAnnotations, 1);
	assert.equal(restoreCalls.some((call) => call.name === "run_js" && /visible-replay-text-candidates/.test(String(call.args.expression || ""))), true);
	assert.equal(restoreCalls.some((call) => call.name === "highlight_text" && call.args.text === fallbackText), true);
}

async function assertArtifactRestoreReportsAbsentLiveSourceText() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const targetUrl = "https://claude.ai/chat/restore-absent-source-smoke";
	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 35,
				title: "InAbHyD ontology reasoning research directions - Claude",
				url: targetUrl,
			}),
		],
		runJsResult: (args) => {
			const expression = String(args.expression || "");
			if (/visible-replay-text-candidates/.test(expression)) return { candidates: [] };
			if (/replay-source-presence/.test(expression)) return { present: false, reason: "token-overlap", overlap: 0, requiredOverlap: 4 };
			if (/maxY/.test(expression)) return { scrollX: 0, scrollY: 0, innerHeight: 800, scrollHeight: 800, maxY: 0 };
			return true;
		},
		rejectHighlightText: () => true,
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = ["artifact_absent_live_source"];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_absent_live_source: {
				id: "artifact_absent_live_source",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "absent live source",
				tab: replaySmokeTab({ id: 35, title: "InAbHyD ontology reasoning research directions - Claude", url: targetUrl }),
				page: {
					title: "InAbHyD ontology reasoning research directions - Claude",
					url: targetUrl,
					annotations: [
						{
							annotationId: "absent-live-source-target",
							kind: "inline",
							matchedText: "The two most feasible high-value follow-ups would use the existing Gemma 3 result.",
						},
					],
				},
			},
		},
	});

	const restored = await runtime.restoreSession();
	assert.equal(restored.restoredPages.length, 1);
	assert.equal(restored.restoredPages[0].restoredAnnotations, 0);
	assert.equal(restored.restoredPages[0].failedCount, 1);
	assert.match(restored.restoredPages[0].failures[0], /Saved source text is not currently loaded/i);
}

async function assertSessionReplayScansScrollPositionsForVirtualizedPage() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const targetUrl = "https://claude.ai/chat/restore-scroll-smoke";
	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 32,
				title: "InAbHyD ontology reasoning research directions - Claude",
				url: targetUrl,
			}),
		],
		runJsResult: (args) => {
			const expression = String(args.expression || "");
			if (/maxY/.test(expression)) {
				return { scrollX: 0, scrollY: 6400, innerHeight: 800, scrollHeight: 9600, maxY: 8800 };
			}
			return true;
		},
		rejectHighlightText: (_text, _args, calls) =>
			!calls.some((call) => call.name === "run_js" && /targetY = \d+/.test(String(call.args.expression || "")) && /scrollTop/.test(String(call.args.expression || ""))),
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = [];
	session.pageActions = [
		{
			key: "highlight:claude-most-feasible",
			type: "annotation",
			tabId: 32,
			title: "InAbHyD ontology reasoning research directions - Claude",
			url: targetUrl,
			label: "Highlighted text",
			citationText: "The two most feasible, high-value follow-ups on your existing Gemma 3 + Gemma Scope work",
			annotationId: "claude-most-feasible",
		},
	];
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	assert.equal(restored.restoredPages.length, 1);
	assert.equal(restored.restoredPages[0].restoredAnnotations, 1);
	assert.equal(restoreCalls.some((call) => call.name === "run_js" && /maxY/.test(String(call.args.expression || ""))), true);
	assert.equal(restoreCalls.some((call) => call.name === "run_js" && /targetY = \d+/.test(String(call.args.expression || "")) && /scrollTop/.test(String(call.args.expression || ""))), true);
}

async function assertSessionRestoreContinuesAfterArtifactOpenFailure() {
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
		rejectNavigate: (url) => /broken\.example/.test(url),
		navigateTabId: 9,
		navigateTitle: "Good restored page",
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = ["artifact_broken_restore", "artifact_good_restore"];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_broken_restore: {
				id: "artifact_broken_restore",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "broken restore",
				tab: {
					id: 101,
					windowId: 3,
					title: "Broken restored page",
					url: "https://broken.example/session",
				},
				page: {
					title: "Broken restored page",
					url: "https://broken.example/session",
					annotations: [{ annotationId: "ann-broken", kind: "inline", matchedText: "Broken content" }],
				},
			},
			artifact_good_restore: {
				id: "artifact_good_restore",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "good restore",
				tab: {
					id: 102,
					windowId: 3,
					title: "Good restored page",
					url: "https://example.test/good",
				},
				page: {
					title: "Good restored page",
					url: "https://example.test/good",
					annotations: [{ annotationId: "ann-good", kind: "inline", matchedText: "Alpha smoke content" }],
				},
			},
		},
	});

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	const brokenPage = restored.restoredPages.find((page) => page.artifactId === "artifact_broken_restore");
	const goodPage = restored.restoredPages.find((page) => page.artifactId === "artifact_good_restore");
	assert.equal(restored.restoredPages.length, 2);
	assert.equal(brokenPage?.restoredAnnotations, 0);
	assert.equal(brokenPage?.failedCount, 1);
	assert.match(brokenPage?.failures?.[0] || "", /Navigation failed/);
	assert.equal(goodPage?.restoredAnnotations, 1);
	assert.equal(goodPage?.failedCount, 0);
	assert.equal(restoreCalls.some((call) => call.name === "highlight_text" && call.args.text === "Alpha smoke content"), true);
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
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = ["artifact_short_math_restore"];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
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

async function assertArtifactRestorePassesPdfAnchorToHighlight() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const pdfAnchor = {
		surface: "pdf",
		viewer: "pdfjs",
		document: {
			url: "https://example.test/lecture.pdf",
			title: "Lecture PDF",
			pageCount: 12,
		},
		pageNumber: 4,
		matchedText: "recurrent neural networks",
		textQuote: {
			exact: "recurrent neural networks",
		},
		rects: [
			{
				pageNumber: 4,
				x: 0.2,
				y: 0.3,
				width: 0.18,
				height: 0.03,
				coordinateSpace: "page-normalized",
			},
		],
	};
	const host = createReplayHost({
		tabs: [replaySmokeTab({ title: "Lecture PDF", url: "https://example.test/lecture.pdf" })],
		highlightAnnotationId: (_text, args) => (args.pdfAnchor ? "pdf-restored-anchor" : "text-restored-anchor"),
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = ["artifact_pdf_restore"];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_pdf_restore: {
				id: "artifact_pdf_restore",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "pdf restore",
				tab: replaySmokeTab({ title: "Lecture PDF", url: "https://example.test/lecture.pdf" }),
				page: {
					title: "Lecture PDF",
					url: "https://example.test/lecture.pdf",
					annotations: [
						{
							annotationId: "ann-pdf",
							kind: "pdf",
							matchedText: "recurrent neural networks",
							pdfAnchor,
							note: { text: "RNNs keep sequence state.", label: "Onhand" },
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
	assert.equal(highlightCalls.length, 1);
	assert.deepEqual(highlightCalls[0].args.pdfAnchor, pdfAnchor);
	assert.equal(highlightCalls[0].args.exactOnly, true);
	assert.equal(highlightCalls[0].args.allowApproximate, false);
	assert.equal(restoreCalls.some((call) => call.name === "show_note" && call.args.annotationId === "pdf-restored-anchor"), true);
}

async function assertPdfActionActivationHandsOffBeforeSourceFallback() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const pdfAnchor = {
		surface: "pdf",
		viewer: "onhand-pdf-viewer",
		document: {
			url: "https://example.test/lecture.pdf",
			pdfUrl: "https://example.test/lecture.pdf",
			viewerUrl: "https://example.test/lecture.pdf",
			title: "Lecture PDF",
		},
		pageNumber: 1,
		matchedText: "recurrent neural networks",
		textQuote: {
			exact: "recurrent neural networks",
		},
		rects: [
			{
				pageNumber: 1,
				x: 0.2,
				y: 0.3,
				width: 0.24,
				height: 0.03,
				coordinateSpace: "page-normalized",
			},
		],
	};
	const host = createReplayHost({
		tabs: [replaySmokeTab({ title: "Lecture PDF", url: "https://example.test/lecture.pdf" })],
		rejectScrollToAnnotation: () => true,
		highlightAnnotationId: (_text, args) => (args.pdfAnchor ? "pdf-source-restored" : "text-source-restored"),
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.pageActions = [
		{
			key: "highlight:pdf-source",
			type: "annotation",
			tabId: 7,
			windowId: 3,
			title: "Lecture PDF",
			url: "https://example.test/lecture.pdf",
			label: "Highlighted text",
			citationText: "recurrent neural networks",
			annotationId: "stale-pdf-source",
			pdfAnchor,
		},
	];
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

	await runtime.activateAction("highlight:pdf-source");
	const openPdfIndex = host.calls.findIndex((call) => call.name === "open_pdf_in_onhand_viewer");
	const scrollIndex = host.calls.findIndex((call) => call.name === "scroll_to_annotation");
	const highlightIndex = host.calls.findIndex((call) => call.name === "highlight_text");
	assert.notEqual(openPdfIndex, -1, "PDF source activation should hand off to Onhand's PDF viewer surface");
	assert.notEqual(scrollIndex, -1, "expected source activation to try the saved annotation before replay fallback");
	assert.notEqual(highlightIndex, -1, "expected source activation to replay the PDF highlight after stale annotation miss");
	assert.ok(openPdfIndex < scrollIndex, "PDF source activation should prepare the PDF surface before scrolling to an annotation");
	assert.ok(openPdfIndex < highlightIndex, "PDF source activation should prepare the PDF surface before replaying a highlight");
	assert.deepEqual(host.calls[highlightIndex].args.pdfAnchor, pdfAnchor);
}

async function assertPdfArtifactRestoreNavigatesViewerUrlNotDocumentUrl() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const viewerUrl = "https://reader.example.test/viewer.html?file=https%3A%2F%2Fexample.test%2Flecture.pdf";
	const pdfUrl = "https://example.test/lecture.pdf";
	const pdfAnchor = {
		surface: "pdf",
		viewer: "google-scholar-pdf-reader",
		document: {
			url: pdfUrl,
			viewerUrl,
			title: "Lecture PDF",
			pageCount: 48,
		},
		pageNumber: 1,
		matchedText: "natural language processing",
		textQuote: {
			exact: "natural language processing",
		},
		rects: [
			{
				pageNumber: 1,
				x: 0.12,
				y: 0.32,
				width: 0.36,
				height: 0.04,
				coordinateSpace: "page-normalized",
			},
		],
	};
	const host = createReplayHost({
		tabs: [],
		navigateTabId: 77,
		navigateTitle: "Lecture PDF",
		highlightAnnotationId: (_text, args) => (args.pdfAnchor ? "pdf-viewer-restored-anchor" : "text-restored-anchor"),
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = ["artifact_pdf_viewer_restore"];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_pdf_viewer_restore: {
				id: "artifact_pdf_viewer_restore",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "pdf viewer restore",
				tab: replaySmokeTab({ title: "Lecture PDF", url: viewerUrl }),
				page: {
					title: "Lecture PDF",
					url: viewerUrl,
					annotations: [
						{
							annotationId: "ann-pdf-viewer",
							kind: "pdf",
							matchedText: "natural language processing",
							pdfAnchor,
							note: { text: "NLP studies models for language data.", label: "Onhand" },
						},
					],
				},
			},
		},
	});

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	const navigateCalls = restoreCalls.filter((call) => call.name === "navigate");
	const waitCalls = restoreCalls.filter((call) => call.name === "wait_for_selector");
	const highlightCalls = restoreCalls.filter((call) => call.name === "highlight_text");
	assert.equal(restored.restoredPages.length, 1);
	assert.equal(restored.restoredPages[0].url, viewerUrl);
	assert.equal(restored.restored[0].tab?.url, viewerUrl);
	assert.equal(navigateCalls.length, 1);
	assert.equal(navigateCalls[0].args.url, viewerUrl);
	assert.notEqual(navigateCalls[0].args.url, pdfUrl);
	assert.equal(waitCalls.length, 1);
	assert.match(waitCalls[0].args.selector, /data-onhand-pdf-rendered/);
	assert.equal(highlightCalls.length, 1);
	assert.ok(
		restoreCalls.findIndex((call) => call.name === "wait_for_selector") < restoreCalls.findIndex((call) => call.name === "highlight_text"),
		"expected PDF restore to wait for the viewer surface before highlighting",
	);
	assert.deepEqual(highlightCalls[0].args.pdfAnchor, pdfAnchor);
	assert.equal(restoreCalls.some((call) => call.name === "show_note" && call.args.annotationId === "pdf-viewer-restored-anchor"), true);
}

async function assertOwnPdfViewerArtifactRestoreIsRestorable() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const pdfUrl = "http://127.0.0.1:8765/pdf/onhand-viewer";
	const viewerUrl = `chrome-extension://onhand-test/pdf-viewer.html?url=${encodeURIComponent(pdfUrl)}`;
	const pdfAnchor = {
		surface: "pdf",
		viewer: "onhand-pdf-viewer",
		document: {
			url: pdfUrl,
			viewerUrl,
			title: "onhand-viewer",
			pageCount: 1,
		},
		pageNumber: 1,
		matchedText: "recurrent neural networks",
		textQuote: {
			exact: "recurrent neural networks",
		},
		rects: [
			{
				pageNumber: 1,
				x: 0.31,
				y: 0.23,
				width: 0.24,
				height: 0.03,
				coordinateSpace: "page-normalized",
			},
		],
	};
	const host = createReplayHost({
		tabs: [],
		navigateTabId: 88,
		navigateTitle: "onhand-viewer - Onhand PDF Viewer",
		highlightAnnotationId: (_text, args) => (args.pdfAnchor ? "own-pdf-viewer-restored-anchor" : "text-restored-anchor"),
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = ["artifact_own_pdf_viewer_restore"];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_own_pdf_viewer_restore: {
				id: "artifact_own_pdf_viewer_restore",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "own pdf viewer restore",
				tab: replaySmokeTab({ title: "onhand-viewer - Onhand PDF Viewer", url: viewerUrl }),
				page: {
					title: "onhand-viewer - Onhand PDF Viewer",
					url: viewerUrl,
					annotations: [
						{
							annotationId: "ann-own-pdf-viewer",
							kind: "pdf",
							matchedText: "recurrent neural networks",
							pdfAnchor,
							note: { text: "Live Onhand PDF viewer note.", label: "Onhand" },
						},
					],
				},
			},
		},
	});

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	const navigateCalls = restoreCalls.filter((call) => call.name === "navigate");
	const waitCalls = restoreCalls.filter((call) => call.name === "wait_for_selector");
	const highlightCalls = restoreCalls.filter((call) => call.name === "highlight_text");
	assert.equal(restored.restoredPages.length, 1);
	assert.equal(restored.restoredPages[0].restoredAnnotations, 1);
	assert.equal(restored.restoredPages[0].restoredNotes, 1);
	assert.equal(navigateCalls.length, 1);
	// A viewer-url artifact should reopen the current Onhand PDF viewer, not
	// navigate directly to the embedded source PDF. Direct navigation can
	// trigger a browser download before the viewer handoff can run.
	assert.equal(navigateCalls[0].args.url, viewerUrl);
	assert.notEqual(navigateCalls[0].args.url, pdfUrl);
	assert.equal(waitCalls.length, 1);
	assert.match(waitCalls[0].args.selector, /data-onhand-pdf-rendered/);
	assert.equal(highlightCalls.length, 1);
	assert.deepEqual(highlightCalls[0].args.pdfAnchor, pdfAnchor);
	assert.equal(restoreCalls.some((call) => call.name === "show_note" && call.args.annotationId === "own-pdf-viewer-restored-anchor"), true);
}

async function assertGoogleDocsPdfViewerRestoreDoesNotNavigateRawExport() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const pdfUrl = "https://docs.google.com/document/d/1sfsGQurJ444vXKXcqcHg32SBRYz3LVrvOt4Hwig-ai8/export?format=pdf";
	const viewerUrl = `chrome-extension://onhand-test/pdf-viewer.html?url=${encodeURIComponent(pdfUrl)}`;
	const pdfAnchor = {
		surface: "pdf",
		viewer: "onhand-pdf-viewer",
		document: {
			url: pdfUrl,
			pdfUrl,
			viewerUrl,
			title: "heyclicky vision",
			pageCount: 2,
		},
		pageNumber: 1,
		matchedText: "My name is Farza.",
		textQuote: {
			exact: "My name is Farza.",
		},
		rects: [
			{
				pageNumber: 1,
				x: 0.19,
				y: 0.09,
				width: 0.18,
				height: 0.02,
				coordinateSpace: "page-normalized",
			},
		],
	};
	const host = createReplayHost({
		tabs: [],
		navigateTabId: 89,
		navigateTitle: "heyclicky vision - Onhand PDF Viewer",
		highlightAnnotationId: "google-docs-pdf-restored-anchor",
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = ["artifact_google_docs_pdf_viewer_restore"];
	session.pageActions = [
		{
			key: "highlight:google-docs-pdf-anchor",
			type: "annotation",
			tabId: 7,
			windowId: 3,
			title: "heyclicky vision - Onhand PDF Viewer",
			url: viewerUrl,
			annotationId: "google-docs-pdf-anchor",
			label: "Highlighted text",
			detail: "My name is Farza.",
			citationText: "My name is Farza.",
			pdfAnchor,
		},
		{
			key: "note:google-docs-pdf-anchor",
			type: "note",
			tabId: 7,
			windowId: 3,
			title: "heyclicky vision - Onhand PDF Viewer",
			url: viewerUrl,
			annotationId: "google-docs-pdf-anchor",
			label: "Added note",
			detail: "Opening the Docs export through Onhand keeps it annotatable.",
			citationText: "Opening the Docs export through Onhand keeps it annotatable.",
			pdfAnchor,
		},
	];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_google_docs_pdf_viewer_restore: {
				id: "artifact_google_docs_pdf_viewer_restore",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "google docs pdf viewer restore",
				tab: replaySmokeTab({ title: "heyclicky vision - Onhand PDF Viewer", url: pdfUrl }),
				page: {
					title: "heyclicky vision - Onhand PDF Viewer",
					url: pdfUrl,
					annotations: [
						{
							annotationId: "google-docs-pdf-anchor",
							kind: "pdf",
							matchedText: "My name is Farza.",
							pdfAnchor,
							note: { text: "Opening the Docs export through Onhand keeps it annotatable.", label: "Onhand" },
						},
					],
				},
			},
		},
	});

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	const navigateCalls = restoreCalls.filter((call) => call.name === "navigate");
	const highlightCalls = restoreCalls.filter((call) => call.name === "highlight_text");
	const replayPages = restored.restoredPages.filter((page) => page.source === "browser-replay");
	assert.equal(restored.restoredPages.length, 1, "a covered Docs PDF artifact should not trigger replay fallback");
	assert.equal(replayPages.length, 0, "Docs PDF artifact restore should cover matching replay page actions");
	assert.equal(navigateCalls.length, 1);
	assert.equal(navigateCalls[0].args.url, viewerUrl);
	assert.notEqual(navigateCalls[0].args.url, pdfUrl);
	assert.equal(highlightCalls.length, 1);
	assert.deepEqual(highlightCalls[0].args.pdfAnchor, pdfAnchor);
	assert.equal(restoreCalls.some((call) => call.name === "show_note" && call.args.annotationId === "google-docs-pdf-restored-anchor"), true);
}

async function assertScrollRestoreAccessErrorDoesNotFailRestore() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const pdfUrl = "https://www-cdn.example.test/doc.pdf";
	const pdfAnchor = { surface: "pdf", pageNumber: 1, occurrence: 1, matchedText: "alpha", textQuote: { exact: "alpha" } };
	const sourceTab = replaySmokeTab({ id: 73, title: "doc.pdf", url: pdfUrl });
	// Restoring the scroll position scripts the tab; on a PDF whose main frame
	// is the browser's native viewer that throws "Cannot access a
	// chrome-extension:// URL of different extension". The annotations still
	// restore, so this must not be surfaced as a restore failure.
	const host = createReplayHost({
		tabs: [sourceTab],
		highlightAnnotationId: () => "scroll-test-anchor",
		rejectRunJs: "Cannot access a chrome-extension:// URL of different extension",
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({ aiProvider: "onhand-smoke", aiModel: "onhand-smoke-1", aiApiKey: "test", authMode: "api-key" });
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = ["artifact_scroll"];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_scroll: {
				id: "artifact_scroll",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "scroll artifact",
				tab: sourceTab,
				page: {
					title: "doc.pdf",
					url: pdfUrl,
					scrollY: 1200,
					annotations: [{ annotationId: "ann-scroll", kind: "pdf", matchedText: "alpha", pdfAnchor, note: { text: "scroll note", label: "Onhand" } }],
				},
			},
		},
	});
	const restored = await runtime.restoreSession();
	assert.equal(restored.restoredPages.length, 1, "the pdf artifact should restore");
	assert.equal(restored.restoredPages[0].restoredAnnotations, 1, "its annotation should restore despite the scroll error");
	assert.equal(restored.restoredPages[0].failedCount || 0, 0, "a benign scroll-position access error must not count as a restore failure");
}

async function assertForeignViewerUrlArtifactRestoresAgainstSourceTab() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const pdfUrl = "https://www-cdn.example.test/report.pdf";
	// An artifact saved while the PDF was open in a viewer from a *different*
	// (or older) extension id — the exact state that produced "Cannot access a
	// chrome-extension:// URL of different extension" on restore.
	const staleViewerUrl = `chrome-extension://staleotherextensionid000000000000/pdf-viewer.html?url=${encodeURIComponent(pdfUrl)}`;
	const pdfAnchor = { surface: "pdf", viewer: "onhand-pdf-viewer", pageNumber: 3, occurrence: 1, matchedText: "frontier safeguards", textQuote: { exact: "frontier safeguards" } };
	const sourceTab = replaySmokeTab({ id: 71, title: "report.pdf", url: pdfUrl });
	const host = createReplayHost({ tabs: [sourceTab], highlightAnnotationId: () => "restored-foreign-anchor" });
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({ aiProvider: "onhand-smoke", aiModel: "onhand-smoke-1", aiApiKey: "test", authMode: "api-key" });
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = ["artifact_stale_viewer"];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_stale_viewer: {
				id: "artifact_stale_viewer",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "stale viewer artifact",
				tab: { ...sourceTab, url: staleViewerUrl },
				page: {
					title: "report.pdf - Onhand PDF Viewer",
					url: staleViewerUrl,
					annotations: [{ annotationId: "ann-stale-viewer", kind: "pdf", matchedText: "frontier safeguards", pdfAnchor }],
				},
			},
		},
	});

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	assert.equal(restored.restoredPages.length, 1, "the stale-viewer artifact should restore");
	assert.equal(restored.restoredPages[0].restoredAnnotations, 1, "its annotation should be re-highlighted");
	assert.equal(restored.restoredPages[0].failedCount || 0, 0, "restore must not fail with a chrome-extension access error");
	assert.equal(restoreCalls.some((call) => call.name === "navigate"), false, "the open source tab should be reused, not navigated to the stale viewer url");
	assert.ok(
		restoreCalls.some((call) => call.name === "highlight_text" && call.args.tabId === 71),
		"the highlight should replay against the live source tab",
	);
}

async function assertDirectPdfArtifactRestoreInstallsInlineViewerBeforeHighlight() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const pdfUrl = "https://arxiv.org/pdf/2509.03345";
	const pdfAnchor = {
		surface: "pdf",
		viewer: "onhand-pdf-viewer",
		document: {
			url: pdfUrl,
			pdfUrl,
			viewerUrl: pdfUrl,
			title: "2509.03345",
			pageCount: 12,
		},
		pageNumber: 1,
		matchedText: "language models",
		textQuote: {
			exact: "language models",
		},
		rects: [
			{
				pageNumber: 1,
				x: 0.18,
				y: 0.2,
				width: 0.16,
				height: 0.025,
				coordinateSpace: "page-normalized",
			},
		],
	};
	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 42,
				windowId: 5,
				active: true,
				title: "2509.03345",
				url: pdfUrl,
			}),
		],
		highlightAnnotationId: (_text, args) => (args.pdfAnchor ? "direct-pdf-inline-restored-anchor" : "text-restored-anchor"),
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = ["artifact_direct_pdf_inline_restore"];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_direct_pdf_inline_restore: {
				id: "artifact_direct_pdf_inline_restore",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "direct pdf inline restore",
				tab: replaySmokeTab({ id: 42, windowId: 5, title: "2509.03345", url: pdfUrl }),
				page: {
					title: "2509.03345",
					url: pdfUrl,
					annotations: [
						{
							annotationId: "ann-direct-pdf",
							kind: "pdf",
							matchedText: "language models",
							pdfAnchor,
							note: { text: "Direct PDF inline note.", label: "Onhand" },
						},
					],
				},
			},
		},
	});

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	const openPdfIndex = restoreCalls.findIndex((call) => call.name === "open_pdf_in_onhand_viewer");
	const waitIndex = restoreCalls.findIndex((call) => call.name === "wait_for_selector");
	const highlightIndex = restoreCalls.findIndex((call) => call.name === "highlight_text");
	assert.equal(restored.restoredPages.length, 1);
	assert.equal(restored.restoredPages[0].url, pdfUrl);
	assert.ok(openPdfIndex >= 0, "expected restore to install the inline PDF viewer before annotation restore");
	assert.equal(restoreCalls[openPdfIndex].args.tabId, 42);
	assert.equal(restoreCalls[openPdfIndex].args.newTab, false);
	assert.equal(waitIndex > openPdfIndex, true);
	assert.equal(highlightIndex > waitIndex, true);
	assert.match(restoreCalls[waitIndex].args.selector, /data-onhand-inline-pdf-viewer/);
	assert.deepEqual(restoreCalls[highlightIndex].args.pdfAnchor, pdfAnchor);
	assert.equal(restoreCalls.some((call) => call.name === "show_note" && call.args.annotationId === "direct-pdf-inline-restored-anchor"), true);
}

async function assertDirectPdfArtifactRestoreWithoutPdfAnchorStillHandsOff() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const pdfUrl = "https://arxiv.org/pdf/2509.03345";
	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 42,
				windowId: 5,
				active: true,
				title: "2509.03345",
				url: pdfUrl,
			}),
		],
		highlightAnnotationId: "direct-pdf-text-restored-anchor",
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = ["artifact_direct_pdf_text_restore"];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_direct_pdf_text_restore: {
				id: "artifact_direct_pdf_text_restore",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "direct pdf text restore",
				tab: replaySmokeTab({ id: 42, windowId: 5, title: "2509.03345", url: pdfUrl }),
				page: {
					title: "2509.03345",
					url: pdfUrl,
					annotations: [
						{
							annotationId: "ann-direct-pdf-text",
							kind: "inline",
							matchedText: "language models",
							note: { text: "Older direct PDF note.", label: "Onhand" },
						},
					],
				},
			},
		},
	});

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	const openPdfIndex = restoreCalls.findIndex((call) => call.name === "open_pdf_in_onhand_viewer");
	const waitIndex = restoreCalls.findIndex((call) => call.name === "wait_for_selector");
	const highlightIndex = restoreCalls.findIndex((call) => call.name === "highlight_text");
	assert.equal(restored.restoredPages.length, 1);
	assert.equal(restored.restoredPages[0].restoredAnnotations, 1);
	assert.ok(openPdfIndex >= 0, "expected direct PDF URL restore to prepare Onhand's PDF viewer even without a pdfAnchor");
	assert.equal(restoreCalls[openPdfIndex].args.tabId, 42);
	assert.equal(waitIndex > openPdfIndex, true);
	assert.equal(highlightIndex > waitIndex, true);
	assert.equal(restoreCalls[highlightIndex].args.text, "language models");
	assert.equal(restoreCalls[highlightIndex].args.pdfAnchor, undefined);
	assert.equal(restoreCalls.some((call) => call.name === "show_note" && call.args.annotationId === "direct-pdf-text-restored-anchor"), true);
}

async function assertFullyRestoredPdfArtifactDoesNotReplayDuplicateFallback() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const pdfUrl = "http://127.0.0.1:8765/pdf/onhand-viewer";
	const viewerUrl = `chrome-extension://onhand-test/pdf-viewer.html?url=${encodeURIComponent(pdfUrl)}`;
	const pdfAnchor = {
		surface: "pdf",
		viewer: "onhand-pdf-viewer",
		document: {
			url: pdfUrl,
			viewerUrl,
			title: "onhand-viewer",
			pageCount: 1,
		},
		pageNumber: 1,
		matchedText: "recurrent neural networks",
		textQuote: {
			exact: "recurrent neural networks",
		},
		rects: [
			{
				pageNumber: 1,
				x: 0.31,
				y: 0.23,
				width: 0.24,
				height: 0.03,
				coordinateSpace: "page-normalized",
			},
		],
	};
	const host = createReplayHost({
		tabs: [replaySmokeTab({ title: "onhand-viewer - Onhand PDF Viewer", url: viewerUrl })],
		highlightAnnotationId: "fresh-pdf-anchor",
		rejectRunJs: `Cannot access contents of url "${viewerUrl}". Extension manifest must request permission to access this host.`,
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.artifactIds = ["artifact_fresh_pdf_restore"];
	session.pageActions = [
		{
			key: "highlight:fresh-pdf-anchor",
			type: "annotation",
			tabId: 7,
			title: "onhand-viewer - Onhand PDF Viewer",
			url: viewerUrl,
			annotationId: "fresh-pdf-anchor",
			label: "Highlighted text",
			detail: "recurrent neural networks",
			citationText: "recurrent neural networks",
			pdfAnchor,
		},
		{
			key: "note:fresh-pdf-anchor",
			type: "note",
			tabId: 7,
			title: "onhand-viewer - Onhand PDF Viewer",
			url: viewerUrl,
			annotationId: "fresh-pdf-anchor",
			label: "Added note",
			detail: "Fresh PDF restore note.",
			citationText: "Fresh PDF restore note.",
			pdfAnchor,
		},
	];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_fresh_pdf_restore: {
				id: "artifact_fresh_pdf_restore",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "fresh pdf restore",
				tab: replaySmokeTab({ title: "onhand-viewer - Onhand PDF Viewer", url: viewerUrl }),
				page: {
					title: "onhand-viewer - Onhand PDF Viewer",
					url: viewerUrl,
					scrollY: 120,
					annotations: [
						{
							annotationId: "fresh-pdf-anchor",
							kind: "pdf",
							matchedText: "recurrent neural networks",
							pdfAnchor,
							note: { text: "Fresh PDF restore note.", label: "Onhand" },
						},
					],
				},
			},
		},
	});

	const callCountBeforeRestore = host.calls.length;
	const restored = await runtime.restoreSession();
	const restoreCalls = host.calls.slice(callCountBeforeRestore);
	assert.equal(restored.restoredPages.length, 1);
	assert.equal(restored.restoredPages[0].source, "browser-artifact");
	assert.equal(restored.restoredPages[0].restoredAnnotations, 1);
	assert.equal(restored.restoredPages[0].restoredNotes, 1);
	assert.equal(restored.restoredPages[0].failedCount, 0);
	assert.equal(restoreCalls.filter((call) => call.name === "highlight_text").length, 1);
	assert.equal(restoreCalls.some((call) => call.name === "run_js"), true);
}

async function assertRestoreSessionUsesLatestArtifactPerPageAndRefreshesSourceTargets() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const sourceText = "Aperiodic Markov chain convergence";
	const newerText = "Metropolis-Hastings acceptance probabilities";
	const host = createReplayHost({
		tabs: [replaySmokeTab({ title: "BayesianDL", url: "https://example.test/bayesian-dl" })],
		highlightAnnotationId(text) {
			return text === sourceText ? "restored-source" : "restored-newer";
		},
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	const sourceAction = {
		key: "highlight:old-source",
		type: "annotation",
		tabId: 7,
		windowId: 3,
		title: "BayesianDL",
		url: "https://example.test/bayesian-dl",
		annotationId: "page-old-source",
		label: "Highlighted text",
		detail: sourceText,
		citationText: sourceText,
	};
	const newerAction = {
		key: "highlight:old-newer",
		type: "annotation",
		tabId: 7,
		windowId: 3,
		title: "BayesianDL",
		url: "https://example.test/bayesian-dl",
		annotationId: "page-old-newer",
		label: "Highlighted text",
		detail: newerText,
		citationText: newerText,
	};
	session.artifactIds = ["artifact_old_bayesian", "artifact_new_bayesian"];
	session.pageActions = [{ ...sourceAction }, { ...newerAction }];
	session.turns = [
		{
			id: "turn-source",
			userPrompt: "explain the source",
			reply: "source",
			activities: [],
			pageActions: [{ ...sourceAction }],
			pending: false,
			error: false,
			createdAt: new Date().toISOString(),
		},
		{
			id: "turn-newer",
			userPrompt: "explain the newer source",
			reply: "newer",
			activities: [],
			pageActions: [{ ...newerAction }],
			pending: false,
			error: false,
			createdAt: new Date().toISOString(),
		},
	];
	session.learnerState = {
		mode: "learning",
		conceptsIntroduced: [
			{
				conceptId: "concept_aperiodic",
				label: "Aperiodic Markov chain convergence",
				firstSeenAt: new Date().toISOString(),
				lastSeenAt: new Date().toISOString(),
				sources: [{ tabTitle: "BayesianDL", url: "https://example.test/bayesian-dl", annotationId: "artifact-old-source" }],
			},
			{
				conceptId: "concept_mh",
				label: "Metropolis-Hastings acceptance probabilities",
				firstSeenAt: new Date().toISOString(),
				lastSeenAt: new Date().toISOString(),
				sources: [{ tabTitle: "BayesianDL", url: "https://example.test/bayesian-dl", annotationId: "artifact-old-newer" }],
			},
		],
		openChecks: [],
		responses: [],
	};
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_old_bayesian: {
				id: "artifact_old_bayesian",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "old BayesianDL snapshot",
				tab: replaySmokeTab({ title: "BayesianDL", url: "https://example.test/bayesian-dl" }),
				page: {
					title: "BayesianDL",
					url: "https://example.test/bayesian-dl",
					annotations: [
						{
							annotationId: "ann-old-stale",
							kind: "inline",
							matchedText: "Older snapshot only",
						},
					],
				},
			},
			artifact_new_bayesian: {
				id: "artifact_new_bayesian",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "new BayesianDL snapshot",
				tab: replaySmokeTab({ title: "BayesianDL", url: "https://example.test/bayesian-dl" }),
				page: {
					title: "BayesianDL",
					url: "https://example.test/bayesian-dl",
					annotations: [
						{
							annotationId: "artifact-old-source",
							kind: "inline",
							matchedText: sourceText,
						},
						{
							annotationId: "artifact-old-newer",
							kind: "inline",
							matchedText: newerText,
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
	assert.equal(restored.restoredPages.length, 1, "expected restore to use the latest snapshot for the page");
	assert.equal(restored.restoredPages[0].artifactId, "artifact_new_bayesian");
	assert.deepEqual(highlightCalls.map((call) => call.args.text), [sourceText, newerText]);
	assert.equal(highlightCalls.some((call) => call.args.text === "Older snapshot only"), false);

	const savedSession = getStoredSessions()[session.id];
	assert.equal(savedSession.pageActions.find((action) => action.key === "highlight:old-source").annotationId, "restored-source");
	assert.equal(savedSession.pageActions.find((action) => action.key === "highlight:old-newer").annotationId, "restored-newer");
	assert.equal(savedSession.learnerState.conceptsIntroduced[0].sources[0].annotationId, "restored-source");
	assert.equal(savedSession.learnerState.conceptsIntroduced[1].sources[0].annotationId, "restored-newer");

	const callCountBeforeActivate = host.calls.length;
	await runtime.activateAction("highlight:old-source");
	const activateCalls = host.calls.slice(callCountBeforeActivate);
	assert.equal(
		activateCalls.some((call) => call.name === "scroll_to_annotation" && call.args.annotationId === "restored-source"),
		true,
		"expected source jump after restore to use the rebound annotation id",
	);
}

async function assertReplayFallbackSkipsArtifactCoveredAnnotations() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const coveredText = "Artifact covered passage";
	const uncoveredText = "Replay only passage";
	const host = createReplayHost({ tabs: [replaySmokeTab({ title: "Coverage", url: "https://example.test/coverage" })] });
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	const makeAction = (key, text, annotationId) => ({
		key,
		type: "annotation",
		tabId: 7,
		windowId: 3,
		title: "Coverage",
		url: "https://example.test/coverage",
		annotationId,
		label: "Highlighted text",
		detail: text,
		citationText: text,
	});
	session.artifactIds = ["artifact_coverage"];
	session.pageActions = [makeAction("highlight:covered", coveredText, "page-covered"), makeAction("highlight:uncovered", uncoveredText, "page-uncovered")];
	session.turns = [
		{
			id: "turn-coverage",
			userPrompt: "explain both passages",
			reply: "covered and uncovered",
			activities: [],
			pageActions: [...session.pageActions],
			pending: false,
			error: false,
			createdAt: new Date().toISOString(),
		},
	];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_coverage: {
				id: "artifact_coverage",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "coverage snapshot",
				tab: replaySmokeTab({ title: "Coverage", url: "https://example.test/coverage" }),
				page: {
					title: "Coverage",
					url: "https://example.test/coverage",
					annotations: [
						{
							annotationId: "artifact-covered",
							kind: "inline",
							matchedText: coveredText,
						},
					],
				},
			},
		},
	});

	const callCountBeforeRestore = host.calls.length;
	await runtime.restoreSession();
	const highlightTexts = host.calls
		.slice(callCountBeforeRestore)
		.filter((call) => call.name === "highlight_text")
		.map((call) => call.args.text);
	assert.deepEqual(
		[...highlightTexts].sort(),
		[coveredText, uncoveredText].sort(),
		"each session annotation should be restored exactly once across the artifact and replay passes",
	);
}

async function assertArtifactActionActivationPreservesExistingAnnotations() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		tabs: [replaySmokeTab({ title: "BayesianDL", url: "https://example.test/bayesian-dl" })],
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.pageActions = [
		{
			key: "artifact:concept-source",
			type: "artifact",
			tabId: 7,
			windowId: 3,
			title: "BayesianDL",
			url: "https://example.test/bayesian-dl",
			artifactId: "artifact_concept_source",
			label: "Saved artifact",
			detail: "BayesianDL",
		},
	];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_concept_source: {
				id: "artifact_concept_source",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "concept source",
				tab: replaySmokeTab({ title: "BayesianDL", url: "https://example.test/bayesian-dl" }),
				page: {
					title: "BayesianDL",
					url: "https://example.test/bayesian-dl",
					annotations: [
						{
							annotationId: "ann-concept-source",
							kind: "inline",
							matchedText: "Alpha smoke content",
							note: { text: "Concept note", label: "Onhand" },
						},
					],
				},
			},
		},
	});

	const callCountBeforeActivate = host.calls.length;
	await runtime.activateAction("artifact:concept-source");
	const activateCalls = host.calls.slice(callCountBeforeActivate);
	assert.equal(
		activateCalls.some((call) => call.name === "clear_annotations"),
		false,
		"jumping to a saved concept source should not clear the page's existing session annotations",
	);
	assert.equal(
		activateCalls.some((call) => call.name === "highlight_text" && call.args.text === "Alpha smoke content" && call.args.clearExisting === false),
		true,
	);
	assert.equal(activateCalls.some((call) => call.name === "show_note" && call.args.note === "Concept note"), true);
}

async function assertCrossPageLearningSourceActivationOpensMissingPage() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const bayesianUrl = "https://example.test/bayesian-dl";
	const cnnUrl = "https://example.test/cnns";
	const cnnSourceText = "The filter is really just a single-layer MLP applied over an image patch";
	const host = createReplayHost({
		tabs: [replaySmokeTab({ id: 7, title: "BayesianDL", url: bayesianUrl })],
		navigateTabId: 12,
		navigateTitle: "CNNs",
		rejectScrollToAnnotation: (annotationId) => annotationId === "stale-cnn-anchor",
		highlightAnnotationId: (text) => (text === cnnSourceText ? "repaired-cnn-anchor" : "other-anchor"),
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.pageActions = [
		{
			key: "highlight:bayesian-source",
			type: "annotation",
			tabId: 7,
			windowId: 3,
			title: "BayesianDL",
			url: bayesianUrl,
			annotationId: "bayesian-anchor",
			label: "Highlighted text",
			detail: "q = qP",
			citationText: "q = qP",
		},
		{
			key: "highlight:cnn-source",
			type: "annotation",
			tabId: 41,
			windowId: 9,
			title: "CNNs",
			url: cnnUrl,
			annotationId: "stale-cnn-anchor",
			label: "Highlighted text",
			detail: cnnSourceText,
			citationText: cnnSourceText,
		},
	];
	session.learnerState = {
		mode: "learning",
		conceptsIntroduced: [
			{
				conceptId: "concept_stationary",
				label: "Stationary distribution of a Markov chain",
				firstSeenAt: "2026-05-17T12:00:00.000Z",
				lastSeenAt: "2026-05-17T12:00:00.000Z",
				sources: [{ annotationId: "bayesian-anchor", tabTitle: "BayesianDL", url: bayesianUrl }],
			},
			{
				conceptId: "concept_local_receptive_fields",
				label: "Local receptive fields vs fully connected layers",
				firstSeenAt: "2026-05-21T15:30:00.000Z",
				lastSeenAt: "2026-05-21T15:30:00.000Z",
				sources: [{ annotationId: "stale-cnn-anchor", tabTitle: "CNNs", url: cnnUrl }],
			},
		],
		openChecks: [],
		responses: [],
	};
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

	const callCountBeforeActivate = host.calls.length;
	await runtime.activateAction("highlight:cnn-source");
	const activateCalls = host.calls.slice(callCountBeforeActivate);
	assert.equal(
		activateCalls.some((call) => call.name === "navigate" && call.args.url === cnnUrl && call.args.newTab === true),
		true,
		"cross-page source activation should open the saved page when it is not already open",
	);
	assert.equal(
		activateCalls.some((call) => call.name === "activate_tab" && call.args.tabId === 12),
		true,
		"cross-page source activation should focus the reopened page",
	);
	assert.equal(
		activateCalls.some((call) => call.name === "highlight_text" && call.args.tabId === 12 && call.args.text === cnnSourceText),
		true,
		"cross-page source activation should repair stale anchors on the reopened page",
	);
	assert.equal(
		activateCalls.some((call) => call.name === "highlight_text" && call.args.tabId === 7),
		false,
		"cross-page source activation must not try to repair the CNN source on the current BayesianDL tab",
	);

	const savedSession = getStoredSessions()[session.id];
	assert.equal(savedSession.pageActions.find((action) => action.key === "highlight:cnn-source").annotationId, "repaired-cnn-anchor");
	assert.equal(savedSession.pageActions.find((action) => action.key === "highlight:cnn-source").tabId, 12);
	assert.equal(savedSession.learnerState.conceptsIntroduced[1].sources[0].annotationId, "repaired-cnn-anchor");
}

async function assertTruncatedActionActivationRetriesEllipsislessExactPrefix() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const pageUrl = "https://example.test/bayesian-dl";
	const truncatedSource = "Bayesian modeling: Posterior sampling via rejection sampling (impractic...";
	const ellipsislessSource = "Bayesian modeling: Posterior sampling via rejection sampling (impractic";
	const host = createReplayHost({
		tabs: [replaySmokeTab({ id: 7, title: "BayesianDL", url: pageUrl })],
		rejectScrollToAnnotation: (annotationId) => annotationId === "stale-broad-heading",
		rejectHighlightText: (text) => text !== ellipsislessSource,
		highlightAnnotationId: (text) => (text === ellipsislessSource ? "repaired-broad-heading" : "other-anchor"),
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.pageActions = [
		{
			key: "highlight:rejection-heading",
			type: "annotation",
			tabId: 7,
			windowId: 3,
			title: "BayesianDL",
			url: pageUrl,
			annotationId: "stale-broad-heading",
			label: "Highlighted text",
			detail: truncatedSource,
		},
	];
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

	const callCountBeforeActivate = host.calls.length;
	await runtime.activateAction("highlight:rejection-heading");
	const activateCalls = host.calls.slice(callCountBeforeActivate);
	assert.equal(
		activateCalls.some((call) => call.name === "highlight_text" && call.args.text === truncatedSource),
		true,
		"activation should first try the stored exact source text",
	);
	assert.equal(
		activateCalls.some((call) => call.name === "highlight_text" && call.args.text === ellipsislessSource),
		true,
		"activation should retry truncated action text without the trailing ellipsis",
	);

	const savedSession = getStoredSessions()[session.id];
	assert.equal(savedSession.pageActions.find((action) => action.key === "highlight:rejection-heading").annotationId, "repaired-broad-heading");
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
	const store = getStoredStore();
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
		...storedStoreEntries(store),
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
	const store = getStoredStore();
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
		...storedStoreEntries(store),
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

	const store = getStoredStore();
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
	const store = getStoredStore();
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
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

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

async function assertLocalFileCitationActivationReusesOpenFileTab() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const fileUrl = "file:///Users/sriram/Downloads/causal_status_overview.html";
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
				id: 42,
				windowId: 9,
				active: false,
				title: "Phantom or Real — Where the Causality Hunt Stands",
				url: fileUrl,
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
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.pageActions = [
		{
			key: "highlight:local-file-ann",
			type: "annotation",
			tabId: 999,
			windowId: 99,
			title: "Phantom or Real — Where the Causality Hunt Stands",
			url: `${fileUrl}#part-8`,
			annotationId: "local-file-ann",
			label: "Highlighted text",
			detail: "collapse-only-under-combination = pathways jointly exhaustive",
			citationText: "collapse-only-under-combination = pathways jointly exhaustive",
		},
	];
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

	const callCountBeforeActivate = host.calls.length;
	await runtime.activateAction("highlight:local-file-ann");
	const activateCalls = host.calls.slice(callCountBeforeActivate);
	assert.equal(activateCalls.some((call) => call.name === "navigate"), false, "local file citation should reuse the open file tab");
	assert.equal(activateCalls.some((call) => call.name === "activate_tab" && call.args.tabId === 42), true);
	assert.equal(
		activateCalls.some(
			(call) =>
				call.name === "scroll_to_annotation" &&
				call.args.tabId === 42 &&
				call.args.annotationId === "local-file-ann",
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
	const store = getStoredStore();
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
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

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

	const savedAction = getStoredSessions()[session.id].pageActions[0];
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
	const store = getStoredStore();
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
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

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

	const savedSession = getStoredSessions()[session.id];
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
	const store = getStoredStore();
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
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

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
	const store = getStoredStore();
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
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

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
	const store = getStoredStore();
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
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

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

	const savedAction = getStoredSessions()[session.id].pageActions.find(
		(action) => action.key === "note:old-ann",
	);
	assert.equal(savedAction.annotationId, "current-ann");
}

async function assertPdfReplayActionActivationRepairsWithPdfAnchor() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const pdfAnchor = {
		surface: "pdf",
		viewer: "google-scholar",
		document: {
			url: "https://arxiv.org/pdf/1706.03762",
			viewerUrl: "https://arxiv.org/pdf/1706.03762",
			pdfUrl: "https://arxiv.org/pdf/1706.03762",
			title: "Attention Is All You Need",
		},
		pageNumber: 2,
		matchedText: "Scaled dot-product attention",
		textQuote: { exact: "Scaled dot-product attention" },
		rects: [{ pageNumber: 2, x: 0.12, y: 0.18, width: 0.42, height: 0.04, coordinateSpace: "page-normalized" }],
	};
	const host = createReplayHost({
		tabs: [replaySmokeTab({ title: "Attention Is All You Need", url: "https://arxiv.org/pdf/1706.03762" })],
		rejectScrollToAnnotation: (annotationId) => annotationId === "old-pdf-source",
		highlightAnnotationId: (_text, args) => (args.pdfAnchor ? "repaired-pdf-source" : "repaired-text-source"),
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.pageActions = [
		{
			key: "highlight:old-pdf-source",
			type: "annotation",
			tabId: 7,
			windowId: 3,
			title: "Attention Is All You Need",
			url: "https://arxiv.org/pdf/1706.03762",
			annotationId: "old-pdf-source",
			label: "Highlighted text",
			detail: "Scaled dot-product attention",
			citationText: "Scaled dot-product attention",
			pdfAnchor,
		},
	];
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

	const callCountBeforeActivate = host.calls.length;
	await runtime.activateAction("highlight:old-pdf-source");
	const activateCalls = host.calls.slice(callCountBeforeActivate);
	const highlightCalls = activateCalls.filter((call) => call.name === "highlight_text");
	assert.equal(highlightCalls.length, 1);
	assert.equal(highlightCalls[0]?.args.text, "Scaled dot-product attention");
	assert.deepEqual(highlightCalls[0]?.args.pdfAnchor, pdfAnchor);
	assert.equal(highlightCalls[0]?.args.exactOnly, true);
	assert.equal(highlightCalls[0]?.args.allowApproximate, false);
	assert.equal(highlightCalls[0]?.args.reuseExisting, true);

	const savedAction = getStoredSessions()[session.id].pageActions[0];
	assert.equal(savedAction.annotationId, "repaired-pdf-source");
	assert.deepEqual(savedAction.pdfAnchor, pdfAnchor);
}

async function assertPdfNoteReplayActionActivationRepairsWithPdfAnchor() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const pdfAnchor = {
		surface: "pdf",
		viewer: "google-scholar",
		document: {
			url: "https://asaparov.org/assets/cs577_fall2025/lecture4.pdf",
			viewerUrl: "https://asaparov.org/assets/cs577_fall2025/lecture4.pdf",
			pdfUrl: "https://asaparov.org/assets/cs577_fall2025/lecture4.pdf",
			title: "CS 577 Lecture 4",
		},
		pageNumber: 1,
		matchedText: "NATURAL LANGUAGE",
		textQuote: { exact: "NATURAL LANGUAGE" },
		rects: [{ pageNumber: 1, x: 0.12, y: 0.2, width: 0.28, height: 0.06, coordinateSpace: "page-normalized" }],
	};
	const host = createReplayHost({
		tabs: [replaySmokeTab({ title: "CS 577 Lecture 4", url: "https://asaparov.org/assets/cs577_fall2025/lecture4.pdf" })],
		rejectScrollToAnnotation: (annotationId) => annotationId === "old-pdf-note",
		highlightAnnotationId: (_text, args) => (args.pdfAnchor ? "repaired-pdf-note" : "repaired-text-note"),
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	session.pageActions = [
		{
			key: "note:old-pdf-note",
			type: "note",
			tabId: 7,
			windowId: 3,
			title: "CS 577 Lecture 4",
			url: "https://asaparov.org/assets/cs577_fall2025/lecture4.pdf",
			annotationId: "old-pdf-note",
			label: "Added note",
			detail: "This note is anchored to the PDF selection.",
			citationText: "This note is anchored to the PDF selection.",
			pdfAnchor,
		},
	];
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

	const callCountBeforeActivate = host.calls.length;
	await runtime.activateAction("note:old-pdf-note");
	const activateCalls = host.calls.slice(callCountBeforeActivate);
	const highlightCalls = activateCalls.filter((call) => call.name === "highlight_text");
	const noteCalls = activateCalls.filter((call) => call.name === "show_note");
	assert.equal(highlightCalls.length, 1);
	assert.equal(highlightCalls[0]?.args.text, "NATURAL LANGUAGE");
	assert.deepEqual(highlightCalls[0]?.args.pdfAnchor, pdfAnchor);
	assert.equal(noteCalls.length, 1);
	assert.equal(noteCalls[0]?.args.annotationId, "repaired-pdf-note");
	assert.equal(noteCalls[0]?.args.note, "This note is anchored to the PDF selection.");

	const savedAction = getStoredSessions()[session.id].pageActions[0];
	assert.equal(savedAction.annotationId, "repaired-pdf-note");
	assert.deepEqual(savedAction.pdfAnchor, pdfAnchor);
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
	const store = getStoredStore();
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
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

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

	const savedAction = getStoredSessions()[session.id].pageActions[0];
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
	assert.equal(host.calls.some((call) => call.name === "snapshot_state" && call.args.windowId === 4), true);
	assert.equal(host.calls.some((call) => call.name === "snapshot_state" && call.args.windowId === 3), false);
	assert.equal(host.calls.some((call) => call.name === "get_visible_text" && call.args.windowId === 4), true);
	assert.equal(host.calls.some((call) => call.name === "get_visible_region_image" && call.args.windowId === 4), true);
	assert.equal(host.calls.some((call) => call.name === "capture_state" && call.args.windowId === 4), true);
	assert.equal(host.calls.some((call) => call.name === "highlight_text" && call.args.windowId === 4), true);
	assert.equal(host.calls.some((call) => call.name === "open_pdf_in_onhand_viewer" && call.args.windowId === 4), true);
	assert.equal(host.calls.some((call) => call.name === "get_visible_text" && call.args.windowId === 3), false);
	assert.equal(host.calls.some((call) => call.name === "get_visible_region_image" && call.args.windowId === 3), false);
	assert.equal(host.calls.some((call) => call.name === "capture_state" && call.args.windowId === 3), false);
	assert.equal(host.calls.some((call) => call.name === "open_pdf_in_onhand_viewer" && call.args.windowId === 3), false);
}

async function assertRealtimePlannerUsesPageMatchedAnchorsWhenScrolled() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		visibleText: "Lower Section\nDelta lower content gives scroll and scroll-to-annotation tests enough page height.",
		extractedMarkdown:
			"Alpha smoke content confirms readable extraction, visible text, highlighting, notes, and artifact restore on this local page.\n\nLower Section\nDelta lower content gives scroll and scroll-to-annotation tests enough page height.",
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const result = await runtime.planRealtimePedagogicalMove({
		userQuestion: "What does this page say about Alpha smoke content?",
		targetWindowId: 3,
	});
	assert.match(result.move.anchor.text_excerpt, /^Alpha smoke content confirms readable extraction/);
	assert.doesNotMatch(result.move.anchor.text_excerpt, /^Delta lower content/);
	assert.equal(host.calls.some((call) => call.name === "extract_content" && call.args.tabId === 7), true);
}

async function assertRealtimePlannerOpensDirectPdfBeforePlanning() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 17,
				windowId: 3,
				active: true,
				title: "paper.pdf",
				url: "https://example.test/paper.pdf",
			}),
		],
		visibleText: "[p. 2] Recurrent neural networks preserve sequence state across tokens.",
		extractedMarkdown: "Recurrent neural networks preserve sequence state across tokens.",
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	const result = await runtime.planRealtimePedagogicalMove({
		userQuestion: "What does this PDF say about recurrent neural networks?",
		targetWindowId: 3,
	});
	const openIndex = host.calls.findIndex((call) => call.name === "open_pdf_in_onhand_viewer");
	const visibleIndex = host.calls.findIndex((call) => call.name === "get_visible_text");
	assert.ok(openIndex >= 0, "expected realtime planner to open direct PDFs in the Onhand viewer first");
	assert.ok(visibleIndex >= 0, "expected realtime planner to read visible PDF text after handoff");
	assert.ok(openIndex < visibleIndex, "expected PDF handoff before context reads");
	assert.match(result.move.anchor.text_excerpt, /Recurrent neural networks preserve sequence state/);
}

async function assertRealtimePlannerCapturesVisualRegionForVisualQuestions() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		visibleText: "Validation chart",
		extractedMarkdown: "Validation chart",
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	await runtime.planRealtimePedagogicalMove({
		userQuestion: "What does this chart show about accuracy?",
		targetWindowId: 3,
	});
	const visualIndex = host.calls.findIndex((call) => call.name === "get_visible_region_image");
	const visibleIndex = host.calls.findIndex((call) => call.name === "get_visible_text");
	assert.ok(visualIndex >= 0, "expected realtime planner to capture a visible-region image for visual questions");
	assert.ok(visibleIndex >= 0, "expected realtime planner to still read text context");
	assert.equal(host.calls[visualIndex].args.tabId, 7);
	assert.equal(host.calls[visualIndex].args.label, "current visible region");
}

async function assertExplicitPdfHandoffRunsBeforeAgentContext() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime, __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	assert.deepEqual(
		__browserRuntimeTest.parseExplicitPdfHandoffParams(
			'Use browser_open_pdf_in_onhand_viewer with pdfUrl "https://example.test/download?id=paper-123", then read it.',
		),
		{ pdfUrl: "https://example.test/download?id=paper-123" },
	);
	assert.equal(__browserRuntimeTest.parseExplicitPdfHandoffParams("Open this PDF in the viewer."), null);

	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 8,
				windowId: 3,
				active: true,
				title: "Direct PDF wrapper",
				url: "https://example.test/article",
			}),
		],
		pdfViewerTabId: 44,
		pdfViewerTitle: "paper.pdf - Onhand PDF Viewer",
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	await runtime.submitPrompt({
		prompt:
			'Use browser_open_pdf_in_onhand_viewer with pdfUrl "https://example.test/paper.pdf", then answer only: PDF handoff done.',
		displayPrompt: "explicit pdf handoff",
		attachments: [],
		learningMode: false,
		targetWindowId: 3,
	});
	const completedState = await waitForRuntimeCompletion(runtime);
	assert.equal(completedState?.activeRequestId, null, "runtime did not complete explicit PDF handoff regression");
	const handoffIndex = host.calls.findIndex((call) => call.name === "open_pdf_in_onhand_viewer");
	const firstContextReadIndex = host.calls.findIndex((call) => call.name === "get_visible_text");
	assert.ok(handoffIndex >= 0, "expected explicit PDF handoff command to run");
	assert.ok(firstContextReadIndex >= 0, "expected browser context read after PDF handoff");
	assert.ok(handoffIndex < firstContextReadIndex, "expected PDF handoff before browser context read");
	assert.equal(host.calls[handoffIndex].args.pdfUrl, "https://example.test/paper.pdf");
	assert.equal(host.calls[handoffIndex].args.windowId, 3);
	const state = await runtime.getState();
	const pdfAction = state.pageActions.find((action) => action?.label === "Opened PDF viewer" && /paper\.pdf/.test(action.detail || action.url || ""));
	assert.ok(pdfAction, "expected the pre-agent PDF handoff to appear as a page action");
	assert.equal(pdfAction.url, "https://example.test/paper.pdf");
	assert.equal(
		state.pageActions.some((action) => action?.label === "Opened PDF viewer" && action.url === "https://example.test/paper.pdf"),
		true,
		"expected the PDF handoff action to keep the original PDF URL",
	);
	assert.equal(
		state.activities.some((activity) => activity?.toolName === "browser_open_pdf_in_onhand_viewer" && activity.state === "complete"),
		true,
		"expected the pre-agent PDF handoff to appear in the activity log",
	);
}

async function assertAutomaticPdfHandoffRunsForDirectPdfBeforeAgentContext() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime, __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	assert.equal(__browserRuntimeTest.isLikelyPdfUrlForAutoHandoff("https://arxiv.org/pdf/2509.03345"), true);
	assert.equal(__browserRuntimeTest.isLikelyPdfUrlForAutoHandoff("https://example.test/article"), false);
	assert.equal(__browserRuntimeTest.isLikelyPdfUrlForAutoHandoff("chrome-extension://onhand-test/pdf-viewer.html?url=https%3A%2F%2Fexample.test%2Fpaper.pdf"), false);
	assert.equal(
		__browserRuntimeTest.browserContextLooksLikePdf({
			activeTab: { url: "https://example.test/paper.pdf" },
			visible: { text: "Title slide" },
		}),
		true,
		"expected direct PDF tabs to force PDF tool availability",
	);
	assert.equal(
		__browserRuntimeTest.browserContextLooksLikePdf({
			activeTab: { url: "https://example.test/article" },
			visible: {
				surface: "pdf",
				blocks: [{ tag: "pdf-page", text: "Title slide" }],
			},
		}),
		true,
		"expected PDF visible-text surfaces to force PDF tool availability",
	);
	assert.equal(
		__browserRuntimeTest.browserContextLooksLikePdf({
			activeTab: { url: "https://example.test/article" },
			visible: { text: "ordinary article text" },
		}),
		false,
		"expected non-PDF pages to keep ordinary tool routing",
	);
	assert.equal(
		__browserRuntimeTest.isOnhandPdfViewerUrl(
			"http://127.0.0.1:8765/onhand-pdf-viewer.html?url=http%3A%2F%2F127.0.0.1%3A8765%2Ffixtures%2Fonhand-viewer.pdf",
		),
		true,
	);
	assert.equal(
		__browserRuntimeTest.shouldAutoOpenPdfViewerForTab({
			id: 8,
			url: "http://127.0.0.1:8765/onhand-pdf-viewer.html?url=http%3A%2F%2F127.0.0.1%3A8765%2Ffixtures%2Fonhand-viewer.pdf",
		}),
		false,
	);

	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 8,
				windowId: 3,
				active: true,
				title: "Do Language Models Follow Occam's Razor?",
				url: "https://arxiv.org/pdf/2509.03345",
			}),
		],
		pdfViewerTabId: 8,
		pdfViewerTitle: "2509.03345 - Onhand PDF Viewer",
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	await runtime.submitPrompt({
		prompt: "What are the findings of this paper?",
		displayPrompt: "automatic pdf handoff",
		attachments: [],
		learningMode: false,
		targetWindowId: 3,
	});
	const completedState = await waitForRuntimeCompletion(runtime);
	assert.equal(completedState?.activeRequestId, null, "runtime did not complete automatic PDF handoff regression");
	const handoffIndex = host.calls.findIndex((call) => call.name === "open_pdf_in_onhand_viewer");
	const firstContextReadIndex = host.calls.findIndex((call) => call.name === "get_visible_text");
	assert.ok(handoffIndex >= 0, "expected automatic PDF handoff command to run for direct PDF route");
	assert.ok(firstContextReadIndex >= 0, "expected browser context read after automatic PDF handoff");
	assert.ok(handoffIndex < firstContextReadIndex, "expected automatic PDF handoff before browser context read");
	assert.equal(host.calls[handoffIndex].args.windowId, 3);
	assert.equal(host.calls[handoffIndex].args.newTab, false);
	assert.equal(host.calls[handoffIndex].args.waitForLoad, true);
	const state = await runtime.getState();
	assert.equal(
		state.activities.some((activity) => activity?.toolName === "browser_open_pdf_in_onhand_viewer" && activity.state === "complete"),
		true,
		"expected automatic PDF handoff to appear in the activity log",
	);
	assert.equal(
		state.pageActions.some((action) => action?.label === "Opened PDF viewer" && action.url === "https://arxiv.org/pdf/2509.03345"),
		true,
		"expected automatic PDF handoff action to keep the original PDF URL",
	);
}

async function assertFixtureResponses() {
	const fixture = await startFixtureServer({ port: 0 });
	try {
		const pageResponse = await fetch(fixture.url, { headers: { "Cache-Control": "no-store" } });
		assert.equal(pageResponse.status, 200);
		const pageHtml = await pageResponse.text();
		assert.match(pageHtml, /Alpha smoke content/);
		assert.match(pageHtml, /validationChart/);

		const pdfResponse = await fetch(new URL("/pdf.html", fixture.url), { headers: { "Cache-Control": "no-store" } });
		assert.equal(pdfResponse.status, 200);
		const pdfHtml = await pdfResponse.text();
		assert.match(pdfHtml, /Onhand PDF Adapter Fixture/);
		assert.match(pdfHtml, /class="pdfViewer"/);
		assert.match(pdfHtml, /class="textLayer"/);
		assert.match(pdfHtml, /data-page-number="2"/);
		assert.match(pdfHtml, /recurrent neural networks/);

		const scholarPdfResponse = await fetch(new URL("/scholar-pdf.html?file=/fixtures/scholar-reader.pdf", fixture.url), {
			headers: { "Cache-Control": "no-store" },
		});
		assert.equal(scholarPdfResponse.status, 200);
		const scholarPdfHtml = await scholarPdfResponse.text();
		assert.match(scholarPdfHtml, /Google Scholar PDF Reader/);
		assert.match(scholarPdfHtml, /class="scholar-selectable-text gsr-text-ctn"/);
		assert.match(scholarPdfHtml, /class="scholar-page gsr-page"/);
		assert.match(scholarPdfHtml, /class="gsr-text" data-idx="2"/);
		assert.match(scholarPdfHtml, /class="scholar-native-comment-popup"/);
		assert.match(scholarPdfHtml, /data-page-index="3"/);
		assert.match(scholarPdfHtml, /data-pn="4"/);
		assert.match(scholarPdfHtml, /Recurrent neural networks preserve sequence state across tokens/);
		assert.match(scholarPdfHtml, /Native Scholar note should not become source PDF text/);

		const samplePdfResponse = await fetch(new URL("/fixtures/onhand-viewer.pdf", fixture.url), {
			headers: { "Cache-Control": "no-store" },
		});
		assert.equal(samplePdfResponse.status, 200);
		assert.equal(samplePdfResponse.headers.get("content-type"), "application/pdf");
		const samplePdfBytes = new Uint8Array(await samplePdfResponse.arrayBuffer());
		assert.equal(new TextDecoder().decode(samplePdfBytes.slice(0, 8)), "%PDF-1.4");
		assert.ok(samplePdfBytes.length > 500, "expected a non-empty generated PDF fixture");

		const routePdfResponse = await fetch(new URL("/pdf/onhand-viewer", fixture.url), {
			headers: { "Cache-Control": "no-store" },
		});
		assert.equal(routePdfResponse.status, 200);
		assert.equal(routePdfResponse.headers.get("content-type"), "application/pdf");
		const routePdfBytes = new Uint8Array(await routePdfResponse.arrayBuffer());
		assert.equal(new TextDecoder().decode(routePdfBytes.slice(0, 8)), "%PDF-1.4");

		const onhandViewerResponse = await fetch(
			new URL("/onhand-pdf-viewer.html?url=http%3A%2F%2F127.0.0.1%3A8765%2Ffixtures%2Fonhand-viewer.pdf", fixture.url),
			{ headers: { "Cache-Control": "no-store" } },
		);
		assert.equal(onhandViewerResponse.status, 200);
		const onhandViewerHtml = await onhandViewerResponse.text();
		assert.match(onhandViewerHtml, /Onhand PDF Viewer/);
		assert.match(onhandViewerHtml, /data-onhand-pdf-viewer-root/);

		const onhandViewerBundleResponse = await fetch(new URL("/pdf-viewer.bundle.js", fixture.url), {
			headers: { "Cache-Control": "no-store" },
		});
		assert.equal(onhandViewerBundleResponse.status, 200);
		assert.match(onhandViewerBundleResponse.headers.get("content-type") || "", /text\/javascript/);
		assert.ok((await onhandViewerBundleResponse.text()).includes("data-onhand-pdf-rendered"));

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
	await assertProviderApiKeyStorageAndRouting();
	await assertFreeTierVisualContextBudgeting();
	await assertSentryDiagnosticsGateAndScrub();
	await assertSelectionFormatting();
	await assertPublicActivitiesFilterInternalThinking();
	await assertToolRetryActivitiesFinalizeAsRecovered();
	await assertConstitutionPromptContract();
	await assertPdfViewerFrameWaitsHaveTimeoutFallback();
	await assertLearnerStateUpdates();
	await assertFallbackOpenCheckRecording();
	await assertPdfCitationFormatting();
	await assertSpacedReviewScheduling();
	await assertLearnerSourceSelfHealsByText();
	await assertLearnerSourceRecoversTextAcrossSessions();
	await assertLearnerSourceRecoversByConceptLabelWhenIdsDrift();
	await assertLearnerSourcePageFallbackWhenTextUnfindable();
	await assertLearnerSourceWiring();
	await assertLearningModeToolLoopPersistsAgentEvents();
	await assertLearningOpenCheckVoiceAnswerResolvesWithoutRegrounding();
	await assertReplayHighlightCandidateGeneration();
	await assertSessionBoundaryClearsActivePageAnnotations();
	await assertDeleteSessionSwitchesToRemainingOrFreshSession();
	await assertLegacySessionBlobMigratesToSessionRecords();
	await assertSessionReplayRestore();
	await assertSelectedPdfAnchorIsReusedForPromptHighlight();
	await assertSessionReplayDoesNotTrustStaleTabIds();
	await assertSessionReplayDoesNotReuseSameTitleWrongUrl();
	await assertReplayRestoreRetriesEllipsisTextAndRefreshesCitationTargets();
	await assertEmptyArtifactRestoreDoesNotRunPageTools();
	await assertArtifactRestoreDoesNotReuseSameTitleWrongUrl();
	await assertArtifactRestoreScrollsBeforeHighlightForVirtualizedPage();
	await assertArtifactRestoreUsesSavedScrollContainerForVirtualizedPage();
	await assertArtifactRestoreUsesVisibleFallbackForSplitChatText();
	await assertArtifactRestoreReportsAbsentLiveSourceText();
	await assertSessionReplayScansScrollPositionsForVirtualizedPage();
	await assertSessionRestoreContinuesAfterArtifactOpenFailure();
	await assertArtifactRestoreUsesStrictReusableMatchingForShortMath();
	await assertArtifactRestorePassesPdfAnchorToHighlight();
	await assertPdfActionActivationHandsOffBeforeSourceFallback();
	await assertPdfArtifactRestoreNavigatesViewerUrlNotDocumentUrl();
	await assertOwnPdfViewerArtifactRestoreIsRestorable();
	await assertGoogleDocsPdfViewerRestoreDoesNotNavigateRawExport();
	await assertForeignViewerUrlArtifactRestoresAgainstSourceTab();
	await assertScrollRestoreAccessErrorDoesNotFailRestore();
	await assertDirectPdfArtifactRestoreInstallsInlineViewerBeforeHighlight();
	await assertDirectPdfArtifactRestoreWithoutPdfAnchorStillHandsOff();
	await assertFullyRestoredPdfArtifactDoesNotReplayDuplicateFallback();
	await assertRestoreSessionUsesLatestArtifactPerPageAndRefreshesSourceTargets();
	await assertReplayFallbackSkipsArtifactCoveredAnnotations();
	await assertArtifactActionActivationPreservesExistingAnnotations();
	await assertCrossPageLearningSourceActivationOpensMissingPage();
	await assertTruncatedActionActivationRetriesEllipsislessExactPrefix();
	await assertRestoreSessionFallsBackToReplayWhenArtifactRestoreFails();
	await assertSessionReplaySnapshotPayload();
	await assertSuccessfulAnnotatedTurnAutoPersistsReviewSnapshot();
	await assertReplayActionActivationCanTargetSavedSession();
	await assertLocalFileCitationActivationReusesOpenFileTab();
	await assertReplayActionActivationRepairsStaleAnnotationWithExactSource();
	await assertReplayNoteActivationUsesPairedHighlightSource();
	await assertReplayNoteActivationDoesNotRegenerateExistingNote();
	await assertReplayNoteActivationRegeneratesMissingNote();
	await assertReplayNoteActivationUsesRepairedPairedHighlightAnchor();
	await assertPdfReplayActionActivationRepairsWithPdfAnchor();
	await assertReplayActionActivationDoesNotUseLooseSourceCandidates();
	await assertSidePanelPromptTargetsOriginWindow();
	await assertRealtimePlannerUsesPageMatchedAnchorsWhenScrolled();
	await assertRealtimePlannerOpensDirectPdfBeforePlanning();
	await assertRealtimePlannerCapturesVisualRegionForVisualQuestions();
	await assertExplicitPdfHandoffRunsBeforeAgentContext();
	await assertAutomaticPdfHandoffRunsForDirectPdfBeforeAgentContext();
	await assertFixtureResponses();
	console.log("Browser runtime regressions: PASS");
}

main().catch((error) => {
	console.error(error?.stack || error?.message || String(error));
	process.exitCode = 1;
});
