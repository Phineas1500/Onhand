import assert from "node:assert/strict";
import { startFixtureServer } from "./serve-browser-runtime-fixture.mjs";
import { rankPdfCorpusTextPages, searchPdfCorpus } from "../packages/browser-extension/pdf-corpus-search.bundle.js";

const GOOGLE_DOCS_FIXTURE_PDF_EXPORT_URL = "https://docs.google.com/document/d/onhand-fixture-doc-id/export?format=pdf";

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
				// The model intent classifier now defaults ON in production, but the
				// replay-host turn tests are deterministic and don't script a
				// classifier model call — seed it OFF so they exercise the regex
				// router. Tests that specifically want the classifier set it true.
				data: { onhandBrowserRuntime: { settings: { experimentalModelLaneClassifier: false, modelLaneClassifierDefaultMigrated: true } } },
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
			if (name === "reopen_onhand_pdf_viewer") {
				const viewerUrl = String(args.viewerUrl || (args.pdfUrl ? `chrome-extension://onhand-test/pdf-viewer.html?url=${encodeURIComponent(String(args.pdfUrl))}` : ""));
				if (!viewerUrl) throw new Error("reopen_onhand_pdf_viewer requires a viewerUrl or pdfUrl.");
				const viewerTab = {
					id: Number(options.pdfViewerTabId || 120),
					windowId: Number(options.pdfViewerWindowId || 3),
					active: true,
					title: options.pdfViewerTitle || "Onhand PDF Viewer",
					url: viewerUrl,
				};
				for (const candidate of tabs) {
					if (candidate.windowId === viewerTab.windowId) candidate.active = false;
				}
				const existingIndex = tabs.findIndex((candidate) => candidate.id === viewerTab.id);
				if (existingIndex >= 0) tabs[existingIndex] = viewerTab;
				else tabs.push(viewerTab);
				return { tab: viewerTab, viewerUrl, opened: true };
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
					initialPageNumber: options.pdfViewerInitialPageNumber || null,
					initialPageSource: options.pdfViewerInitialPageSource || null,
					...(options.pdfViewerSelectionHandoff ? { selectionHandoff: options.pdfViewerSelectionHandoff } : {}),
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
				if (name === "pdf_jump_to_page") {
					if (options.rejectPdfJumpToPage?.(args, calls, tab)) {
						throw new Error(`PDF jump failed: ${args.pageNumber || args.page || ""}`);
					}
					return { tab, jump: { pageNumber: Number(args.pageNumber || args.page || args.pdfAnchor?.pageNumber || 0), pdfAnchor: args.pdfAnchor || null } };
				}
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
			if (name === "pdf_capture_page_image") {
				return {
					tab,
					pageNumber: Number(args.pageNumber || args.page || 1),
					width: 1024,
					height: 1325,
					format: String(args.format || "image/png"),
					dataUrl: "data:image/png;base64,UERGUEFHRQ==",
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
		buildOpenAICodexFallbackModel,
		normalizeApiKeys,
		normalizeProviderForAuthMode,
		validateProviderApiKey,
	} = __browserRuntimeTest || {};
	assert.equal(typeof normalizeApiKeys, "function", "provider key normalizer export is missing");
	assert.equal(typeof getApiKeyForProvider, "function", "provider key lookup export is missing");
	assert.equal(typeof getMissingApiKeyError, "function", "provider key error export is missing");
	assert.equal(typeof validateProviderApiKey, "function", "provider key validator export is missing");
	assert.equal(typeof getProviderModelOptions, "function", "provider model list export is missing");
	assert.equal(typeof buildOpenAICodexFallbackModel, "function", "Codex fallback model builder export is missing");
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
	assert.equal(getProviderModelOptions("onhand-free")[0].id, "openai/gpt-5.6-luna", "free tier should pin its model");
	assert.deepEqual(getProviderModelOptions("onhand-free")[0].input, ["text", "image"], "free tier must preserve image payloads for server-side visual routing");
	const codexModelIds = getProviderModelOptions("openai-codex").map((model) => model.id);
	assert.deepEqual(codexModelIds.slice(0, 3), ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"], "Codex should offer all GPT-5.6 tiers");
	assert.equal(buildOpenAICodexFallbackModel("gpt-5.6-sol")?.api, "openai-codex-responses");
	assert.equal(buildOpenAICodexFallbackModel("gpt-5.6")?.id, "gpt-5.6", "the GPT-5.6 alias should resolve to the Sol transport shape");
	assert.equal(buildOpenAICodexFallbackModel("gpt-5.5"), null, "catalog-backed Codex models should not use the fallback builder");
	{
		// The free-tier worker rejects everything outside its allowlist, so
		// the options page must not offer a custom-model entry for it.
		const { readFile } = await import("node:fs/promises");
		const optionsSource = await readFile(new URL("../packages/browser-extension/options.js", import.meta.url), "utf8");
		const runtimeSource = await readFile(new URL("../packages/browser-extension/src/browser-runtime.ts", import.meta.url), "utf8");
		const runtimeBundle = await readFile(new URL("../packages/browser-extension/onhand-runtime.bundle.js", import.meta.url), "utf8");
		assert.match(optionsSource, /lockedModels/, "options page should lock the free-tier model dropdown to curated entries");
		assert.match(runtimeSource, /ONHAND_FREE_TIER_DEFAULT_BASE_URL = ""/, "free-tier base URL should be configured outside tracked source");
		assert.doesNotMatch(runtimeSource, /https:\/\/[^"'\s]+\.workers\.dev\/v1/, "source must not hard-code a public free-tier Worker URL");
		assert.doesNotMatch(runtimeBundle, /https:\/\/[^"'\s]+\.workers\.dev\/v1/, "bundle must not hard-code a public free-tier Worker URL");
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

async function assertAssistantStreamingTextBlocksStaySeparated() {
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const {
		appendAssistantDraftTextDeltaForTest,
		joinAssistantTextBlocksForTest,
		resetAssistantDraftTextForTest,
	} = __browserRuntimeTest || {};
	assert.equal(typeof appendAssistantDraftTextDeltaForTest, "function", "assistant draft delta helper export is missing");
	assert.equal(typeof joinAssistantTextBlocksForTest, "function", "assistant text-block join helper export is missing");
	assert.equal(typeof resetAssistantDraftTextForTest, "function", "assistant draft reset helper export is missing");

	const request = { reply: "", replyBlocks: [] };
	appendAssistantDraftTextDeltaForTest(request, { type: "text_delta", contentIndex: 0, delta: "Let me open both pages" });
	appendAssistantDraftTextDeltaForTest(request, { type: "text_delta", contentIndex: 2, delta: "Both pages opened." });
	assert.equal(request.reply, "Let me open both pages\n\nBoth pages opened.");
	assert.doesNotMatch(request.reply, /pagesBoth/, "separate assistant text blocks must not be glued together");

	const reordered = joinAssistantTextBlocksForTest([
		{ contentIndex: 2, text: "Both pages opened." },
		{ contentIndex: 0, text: "Let me open both pages" },
	]);
	assert.equal(reordered, "Let me open both pages\n\nBoth pages opened.", "draft blocks should render in content-index order");
	resetAssistantDraftTextForTest(request);
	assert.deepEqual(request.replyBlocks, [], "reset should clear stale draft blocks before a retry");
	assert.equal(request.reply, "");
}

async function assertDestinationNavigationDefaultsToNewTab() {
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const { applyNavigateNewTabDefaultForTest } = __browserRuntimeTest || {};
	assert.equal(typeof applyNavigateNewTabDefaultForTest, "function", "navigation new-tab default helper export is missing");

	const request = {
		initialActiveUrl: "https://react.dev/learn",
	};
	assert.deepEqual(
		applyNavigateNewTabDefaultForTest({ url: "https://react.dev/learn/your-first-component" }, request),
		{ url: "https://react.dev/learn/your-first-component", newTab: true },
		"linked destination pages should preserve the starting page by opening a new tab",
	);
	assert.deepEqual(
		applyNavigateNewTabDefaultForTest({ url: "https://react.dev/learn", waitForLoad: true }, request),
		{ url: "https://react.dev/learn", waitForLoad: true },
		"same-page reloads should not be forced into a new tab",
	);
	assert.deepEqual(
		applyNavigateNewTabDefaultForTest({ url: "https://react.dev/learn/passing-props-to-a-component", newTab: false }, request),
		{ url: "https://react.dev/learn/passing-props-to-a-component", newTab: false },
		"explicit current-tab navigation should remain possible for special cases",
	);
	assert.deepEqual(
		applyNavigateNewTabDefaultForTest({ url: "https://example.test/source" }, {}),
		{ url: "https://example.test/source", newTab: true },
		"when the starting URL is unavailable, destination navigation should still preserve the current tab",
	);
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
	const { compactFreeTierVisualContextMessagesForTest, compressFreeTierVisualContextMessagesForTest, messagesContainImageForTest } = __browserRuntimeTest || {};
	assert.equal(typeof compactFreeTierVisualContextMessagesForTest, "function", "free-tier visual compactor export is missing");
	assert.equal(typeof compressFreeTierVisualContextMessagesForTest, "function", "free-tier visual image compressor export is missing");
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

	const compressed = await compressFreeTierVisualContextMessagesForTest(
		[
			{
				role: "toolResult",
				content: [
					{ type: "text", text: "Captured PDF page image." },
					{ type: "image", data: "A".repeat(900000), mimeType: "image/png" },
					{ type: "image_url", image_url: { url: `data:image/png;base64,${"B".repeat(900000)}` } },
				],
			},
		],
		async (dataUrl) => (dataUrl.includes("BBBB") ? "data:image/jpeg;base64,SMALL_URL" : "data:image/jpeg;base64,SMALL_DATA"),
	);
	const compressedBlocks = compressed[0].content.filter((block) => block?.type === "image" || block?.type === "image_url");
	assert.equal(compressedBlocks[0].mimeType, "image/jpeg", "free-tier image blocks should be rewritten to compressed JPEG");
	assert.equal(compressedBlocks[0].data, "SMALL_DATA");
	assert.equal(compressedBlocks[1].image_url.url, "data:image/jpeg;base64,SMALL_URL");
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

		fetchCalls.length = 0;
		const suppressedCases = [
			{
				label: "aborted request",
				messageType: "sidebar:submit-prompt",
				message: "Request was aborted",
			},
			{
				label: "busy prompt",
				messageType: "sidebar:submit-prompt",
				message: "Agent is already processing a prompt. Use steer() or followUp() to queue messages.",
			},
			{
				label: "OAuth cancellation",
				messageType: "browser-runtime:oauth-sign-in",
				message: "OAuth sign-in tab was closed before authorization completed.",
			},
			{
				label: "stale replay anchor",
				messageType: "sidebar:activate-action",
				message: "Source not found on this page: private source",
			},
			{
				label: "realtime tool target miss",
				messageType: "sidebar:realtime-browser-tool",
				message: "Onhand page tools only run on web or local-file tabs, not Onhand Sidebar",
			},
		];
		for (const entry of suppressedCases) {
			const suppressed = await runtime.captureRuntimeException({
				messageType: entry.messageType,
				message: entry.message,
				stack: `Error: ${entry.message}\n    at smoke (${extensionFrame})`,
			});
			assert.equal(suppressed.captured, false, `${entry.label} should be suppressed even when diagnostics are on`);
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(fetchCalls.length, 0, "suppressed Sentry capture should not call fetch");

		const unexpected = await runtime.captureRuntimeException({
			messageType: "sidebar:submit-prompt",
			message: "Unexpected runtime explosion",
			stack: `Error: Unexpected runtime explosion\n    at smoke (${extensionFrame})`,
		});
		assert.equal(unexpected.captured, true, "unexpected runtime exceptions should still create Sentry issues");
	} finally {
		globalThis.fetch = originalFetch;
	}
}

async function assertSelectionFormatting() {
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const {
		buildHighlightRetryCandidates,
		shouldTryHighlightRetryCandidatesBeforeOriginalForTest,
		cleanMarkdownHeadingHighlightTextForTest,
		stripTrailingHeadingAnchorMarkerForTest,
		looksLikeExpandedMathExtractionCandidateForTest,
		canRewriteToContainedReadablePhraseForTest,
		sourceCitationProvidesExplanatoryComparisonSupportForTest,
		isCompletedSourceHighlightTraceForTest,
		rewriteHighlightTextToRecentReadableExactPhraseForTest,
		shouldAbortAfterRepeatedHighlightFailuresForTest,
		buildCompactTeachingHighlightBudgetGuardResultForTest,
		buildCompactTeachingNoteFailureGuardResultForTest,
		buildPlannerAnchorCandidates,
		buildTextbookContextReadyGuardResultForTest,
		buildReplayAnnotationsFromPageActions,
		findReadyTextbookContextFromTracesForTest,
		formatToolResultForModel,
		formatVisibleTextForModel,
		getSelectionText,
		normalizeOptionalBrowserTargetNumbersForTest,
		normalizePlannerMove,
		summarizeRestoredArtifact,
		buildRepeatedHighlightFailureGuardResultForTest,
		buildPostHighlightFailureAnswerNowGuardResultForTest,
		ensurePdfAbsenceReviewScopeForTest,
	} = __browserRuntimeTest || {};
	assert.equal(typeof buildHighlightRetryCandidates, "function", "browser runtime highlight retry export is missing");
	assert.equal(
		typeof shouldTryHighlightRetryCandidatesBeforeOriginalForTest,
		"function",
		"browser runtime highlight retry preflight export is missing",
	);
	assert.equal(typeof cleanMarkdownHeadingHighlightTextForTest, "function", "browser runtime heading highlight cleaner export is missing");
	assert.equal(typeof stripTrailingHeadingAnchorMarkerForTest, "function", "browser runtime heading anchor cleaner export is missing");
	assert.equal(typeof looksLikeExpandedMathExtractionCandidateForTest, "function", "browser runtime math extraction noise detector export is missing");
	assert.equal(typeof canRewriteToContainedReadablePhraseForTest, "function", "browser runtime contained readable phrase rewrite guard export is missing");
	assert.equal(typeof sourceCitationProvidesExplanatoryComparisonSupportForTest, "function", "browser runtime comparison support detector export is missing");
	assert.equal(typeof isCompletedSourceHighlightTraceForTest, "function", "browser runtime completed highlight detector export is missing");
	assert.equal(typeof rewriteHighlightTextToRecentReadableExactPhraseForTest, "function", "browser runtime readable phrase rewriter export is missing");
	assert.equal(typeof shouldAbortAfterRepeatedHighlightFailuresForTest, "function", "browser runtime highlight failure budget export is missing");
	assert.equal(typeof buildCompactTeachingHighlightBudgetGuardResultForTest, "function", "browser runtime compact teaching highlight budget export is missing");
	assert.equal(typeof buildCompactTeachingNoteFailureGuardResultForTest, "function", "browser runtime compact teaching note failure export is missing");
	assert.equal(typeof buildPlannerAnchorCandidates, "function", "browser runtime planner anchor export is missing");
	assert.equal(typeof buildReplayAnnotationsFromPageActions, "function", "browser runtime replay export is missing");
	assert.equal(typeof buildTextbookContextReadyGuardResultForTest, "function", "browser runtime textbook guard export is missing");
	assert.equal(typeof findReadyTextbookContextFromTracesForTest, "function", "browser runtime ready-textbook detector export is missing");
	assert.equal(typeof buildRepeatedHighlightFailureGuardResultForTest, "function", "browser runtime repeated highlight guard export is missing");
	assert.equal(typeof buildPostHighlightFailureAnswerNowGuardResultForTest, "function", "browser runtime post-highlight-failure guard export is missing");
	assert.equal(typeof formatToolResultForModel, "function", "browser runtime test formatter export is missing");
	assert.equal(typeof formatVisibleTextForModel, "function", "browser runtime visible formatter export is missing");
	assert.equal(typeof getSelectionText, "function", "browser runtime selection formatter export is missing");
	assert.equal(typeof normalizeOptionalBrowserTargetNumbersForTest, "function", "browser runtime browser-target normalizer export is missing");
	assert.equal(typeof normalizePlannerMove, "function", "browser runtime planner normalizer export is missing");
	assert.equal(typeof summarizeRestoredArtifact, "function", "browser runtime restore summary export is missing");
	assert.equal(typeof ensurePdfAbsenceReviewScopeForTest, "function", "browser runtime PDF review-scope enforcer export is missing");

	assert.deepEqual(
		normalizeOptionalBrowserTargetNumbersForTest({ query: "x", tabId: "undefined", windowId: "null", maxResults: 5 }),
		{ query: "x", maxResults: 5 },
		"stringified missing browser targets should be omitted before command validation",
	);
	assert.deepEqual(
		normalizeOptionalBrowserTargetNumbersForTest({ tabId: "123", windowId: "456" }),
		{ tabId: 123, windowId: 456 },
		"string browser target IDs should be coerced to numbers",
	);
	assert.deepEqual(
		normalizeOptionalBrowserTargetNumbersForTest({ tabId: 789, windowId: Number.NaN }),
		{ tabId: 789 },
		"non-finite browser target IDs should be omitted",
	);
	assert.deepEqual(
		normalizeOptionalBrowserTargetNumbersForTest({ tabId: 0, windowId: -1 }),
		{},
		"model-fabricated placeholder ids (0, negative) should fall back to default targeting",
	);
	assert.deepEqual(
		normalizeOptionalBrowserTargetNumbersForTest({ tabId: 12.5 }),
		{},
		"fractional ids should fall back to default targeting",
	);

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

	const selectedFrameText = formatToolResultForModel("browser_get_selection", {
		selection: {
			text: " Nested textbook content ",
			surface: "web",
			source: "debugger-frame-selection",
			frameId: "frame-1",
		},
	});
	assert.equal(selectedFrameText, "Selected text (frame):\nNested textbook content");

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

	const openedPdfWithSelection = formatToolResultForModel("browser_open_pdf_in_onhand_viewer", {
		tab: {
			id: 88,
			title: "Attention Is All You Need - Onhand PDF Viewer",
			url: "chrome-extension://onhand-test/pdf-viewer.html?url=https%3A%2F%2Fexample.test%2Fattention.pdf&page=2",
		},
		pdfUrl: "https://example.test/attention.pdf",
		opened: true,
		selectionHandoff: {
			ok: true,
			text: "Scaled dot-product attention",
			pageNumber: 2,
		},
	});
	assert.match(openedPdfWithSelection, /Opened PDF in Onhand viewer/);
	assert.match(openedPdfWithSelection, /Transferred selected text \(p\. 2\):\nScaled dot-product attention/);
	const failedPdfViewer = formatToolResultForModel("browser_open_pdf_in_onhand_viewer", {
		tab: { id: 88, title: "Onhand PDF Viewer", url: "chrome-extension://onhand-test/pdf-viewer.html" },
		pdfUrl: "https://example.test/protected.pdf",
		viewerReady: { ok: false, error: "Unexpected server response (403)" },
	});
	assert.match(failedPdfViewer, /viewer failed to load the PDF/i, "a failed viewer readiness check must be visible to the model");
	assert.match(failedPdfViewer, /Do not claim the viewer opened successfully/, "viewer failures should explicitly prevent a false success claim");
	assert.doesNotMatch(failedPdfViewer, /^Opened PDF in Onhand viewer/, "a failed viewer must not be formatted as opened");

	const blockedPdfSelection = formatToolResultForModel("browser_get_selection", {
		selection: {
			surface: "pdf",
			viewer: "google-scholar",
			source: "google-scholar-reader-detected",
			hasSelection: false,
			text: "",
			mainFrameSelectionError: "Cannot access a chrome-extension:// URL of different extension",
			googleScholarReader: {
				detected: true,
				readerName: "Google Scholar PDF Reader",
				selectionTextAvailable: false,
				selectionState: "unknown",
			},
			googleScholarReaderSelectionFallback: {
				attempted: true,
				ok: false,
				error: "Cannot access a chrome-extension:// URL of different extension",
			},
			browserClipboardSelectionFallback: {
				attempted: true,
				ok: false,
				error: "Cannot access a chrome-extension:// URL of different extension",
			},
		},
	});
	assert.match(blockedPdfSelection, /No selected text/);
	assert.match(blockedPdfSelection, /PDF reader: Google Scholar PDF Reader/);
	assert.match(blockedPdfSelection, /Google Scholar selected\/highlighted text status: unknown/);
	assert.match(blockedPdfSelection, /PDF main-frame selection: failed/);
	assert.match(blockedPdfSelection, /Google Scholar PDF selection: failed/);
	assert.match(blockedPdfSelection, /Browser PDF copy selection: failed/);

	const selectedGoogleDocsText = formatToolResultForModel("browser_get_selection", {
		selection: {
			text: " 3500 WAUs ",
			surface: "google-docs",
			source: "google-docs-text-event-iframe-copy",
			googleDocsSelectionFallback: {
				attempted: true,
				ok: true,
			},
		},
	});
	assert.match(selectedGoogleDocsText, /Selected text \(Google Docs\):\n3500 WAUs/);
	assert.match(selectedGoogleDocsText, /Google Docs selection fallback: ok/);
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
				matchCount: 3,
				totalMatchCount: 3,
				returnedMatchCount: 1,
				truncated: true,
				coverage: { searchedPageCount: 35, totalPageCount: 35, searchedAllPages: true },
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
		/PDF search for "perceptron": 3 match/,
	);
	const coveredPdfSearch = formatToolResultForModel("browser_pdf_search", {
		query: "waiting period",
		matchCount: 0,
		matches: [],
		coverage: { searchedPageCount: 35, totalPageCount: 35, searchedAllPages: true },
	});
	assert.match(coveredPdfSearch, /Exact-text coverage: 35\/35 PDF pages \(complete\)/);
	assert.match(coveredPdfSearch, /rules out only this exact wording/i);
	assert.match(coveredPdfSearch, /search multiple conceptually distinct phrasings/i);
	const scopedPdfAbsenceReply = ensurePdfAbsenceReviewScopeForTest(
		"No specific waiting period is stated for loans.",
		{
			toolTraces: [
				...Array.from({ length: 3 }, (_, index) => ({
					state: "complete",
					toolName: "browser_pdf_search",
					resultDetails: {
						search: {
							query: ["waiting period", "months of service", "date of employment"][index],
							coverage: { searchedPageCount: 35, totalPageCount: 35, searchedAllPages: true },
						},
					},
				})),
				{ state: "complete", toolName: "browser_pdf_read_pages", resultDetails: { pages: { pageNumbers: [14, 15, 16] } } },
				{ state: "complete", toolName: "browser_pdf_read_pages", resultDetails: { pages: { pageNumbers: [5] } } },
			],
		},
	);
	assert.match(scopedPdfAbsenceReply, /Review scope: 3 exact-text searches each covered 35\/35 extracted PDF pages/);
	assert.match(scopedPdfAbsenceReply, /pages 5, 14–16/);
	assert.match(scopedPdfAbsenceReply, /not the same as reading all 35 pages/);
	assert.equal(
		ensurePdfAbsenceReviewScopeForTest("The loan section states a $1,000 minimum.", {
			toolTraces: [],
		}),
		"The loan section states a $1,000 minimum.",
		"affirmative PDF answers should not receive an absence-review scope footer",
	);
	const pdfReadPagesText = formatToolResultForModel("browser_pdf_read_pages", {
		pages: {
			pageNumbers: [8],
			blocks: [{ pageNumber: 8, text: "SIMPLE METHOD: PERCEPTRON" }],
		},
	});
	assert.match(pdfReadPagesText, /\[p\. 8\]\nSIMPLE METHOD: PERCEPTRON/);
	assert.match(pdfReadPagesText, /Next step: if you answer from this offscreen\/deeper PDF text/);
	assert.match(pdfReadPagesText, /browser_highlight_text/);
	assert.match(pdfReadPagesText, /browser_show_note/);
	assert.match(pdfReadPagesText, /under 280 characters/);
	assert.match(
		formatToolResultForModel("browser_extract_content", {
			tab: replaySmokeTab(),
			content: { markdown: "## You will learn\n\n- How to create and nest components" },
		}),
		/## You will learn\n\n- How to create and nest components/,
	);
	const longPageExtract = formatToolResultForModel("browser_extract_content", {
		tab: replaySmokeTab(),
		content: {
			markdown: "## 1. Intro\n\nEarly page excerpt only.",
			truncated: true,
			headingOutline: [
				{ text: "## 1. Intro" },
				{
					text: "## 3. Positional Encodings (part 1)",
					markdown: "## 3. Positional Encodings (part 1)\n  To incorporate sequence order information, add positional encodings P to input embeddings: X' = X + P.",
				},
				{ text: "## 4. Transformer Block = Attention Graph Representations + Positional Encodings" },
			],
		},
	});
	assert.match(longPageExtract, /Page heading outline with section snippets/);
	assert.match(longPageExtract, /3\. Positional Encodings \(part 1\)/);
	assert.match(longPageExtract, /X' = X \+ P/);
	assert.match(longPageExtract, /body excerpt was truncated/);
	const framePageExtract = formatToolResultForModel("browser_extract_content", {
		tab: replaySmokeTab({ title: "VitalSource Bookshelf" }),
		content: {
			source: "debugger-frame-readable-content",
			frameTitle: "III. Individual Rights",
			contextOrigin: "https://jigsaw.vitalsource.com",
			markdown: "Loaded textbook section content from the nested reader frame.",
		},
	});
	assert.match(framePageExtract, /Source frame: III\. Individual Rights · https:\/\/jigsaw\.vitalsource\.com\./);
	assert.match(framePageExtract, /Loaded textbook section content from the nested reader frame/);
	const emptyPageExtract = formatToolResultForModel("browser_extract_content", {
		tab: replaySmokeTab({ title: "Blank reader" }),
		content: {
			markdown: "",
			text: "",
			reason: "",
		},
	});
	assert.match(emptyPageExtract, /\(No readable content returned\.\)/);
	assert.doesNotMatch(emptyPageExtract, /\[object Object\]/);
	const readerSearch = formatToolResultForModel("browser_textbook_search", {
		tab: replaySmokeTab({ title: "VitalSource Bookshelf" }),
		search: {
			ok: true,
			query: "Lochner",
			adapter: { name: "vitalsource-bookshelf" },
			searchControl: { label: "Search across book" },
			results: [
				{
					index: 1,
					title: "The Rise of Civil Rights and Civil Liberties",
					pageLabel: "page 497",
					snippet: "A short result snippet from the reader search UI.",
				},
			],
			openedResult: {
				index: 1,
				title: "The Rise of Civil Rights and Civil Liberties",
				navigated: true,
				afterUrl: "https://reader.example.test/book/123/page/497",
			},
		},
	});
	assert.match(readerSearch, /Reader search for "Lochner"/);
	assert.match(readerSearch, /vitalsource-bookshelf/);
	assert.match(readerSearch, /Search control: Search across book/);
	assert.match(readerSearch, /The Rise of Civil Rights/);
	assert.match(readerSearch, /Next step: use browser_extract_content once/);
	assert.match(readerSearch, /Do not switch tabs, close search panels, manually click results, or repeat the reader search/);
	const readyTextbookTraces = [
		{
			toolName: "browser_textbook_search",
			state: "complete",
			startedAt: "2026-06-22T03:13:10.000Z",
			endedAt: "2026-06-22T03:13:15.000Z",
			resultDetails: {
				tab: replaySmokeTab({ title: "VitalSource Bookshelf", url: "https://bookshelf.vitalsource.com/reader/books/123/part-11" }),
				search: {
					query: "Americans United Moral Majority",
					openedResult: {
						index: 1,
						title: "Americans United and Moral Majority page 502",
						navigated: true,
						afterUrl: "https://bookshelf.vitalsource.com/reader/books/123/part-11",
					},
				},
			},
		},
		{
			toolName: "browser_extract_content",
			state: "complete",
			startedAt: "2026-06-22T03:13:17.000Z",
			endedAt: "2026-06-22T03:13:18.000Z",
			resultDetails: {
				tab: replaySmokeTab({ title: "VitalSource Bookshelf", url: "https://bookshelf.vitalsource.com/reader/books/123/part-11" }),
				content: {
					source: "debugger-frame-readable-content",
					frameTitle: "III. Individual Rights",
					contextOrigin: "https://jigsaw.vitalsource.com",
					frameUrl: "https://jigsaw.vitalsource.com/books/123/part-11.xhtml",
					markdown:
						"The constitutional politics of religious freedom took contemporary shape during the Nixon administration. Political debates over religious exercises in the public sphere and state assistance to religious organizations became struggles between more liberal and more conservative religious groups. Public debates over funding for parochial schools that once pitted Protestants against Catholics now pitted more liberal Protestants, Catholics, and Jews against more conservative Protestants, Catholics, and Jews.",
				},
			},
		},
	];
	const readyTextbookContext = findReadyTextbookContextFromTracesForTest(readyTextbookTraces);
	assert.equal(readyTextbookContext?.content?.frameTitle, "III. Individual Rights");
	const redundantSearchGuard = buildTextbookContextReadyGuardResultForTest(
		"browser_textbook_search",
		"textbook_search",
		{ query: "Moral Majority became a leading voice" },
		readyTextbookTraces,
	);
	assert.equal(redundantSearchGuard?.guardrail?.kind, "textbook_context_ready");
	assert.match(formatToolResultForModel("browser_textbook_search", redundantSearchGuard), /Textbook context is already ready/);
	assert.match(formatToolResultForModel("browser_textbook_search", redundantSearchGuard), /Do not call browser_textbook_search again/);
	const redundantNavigateGuard = buildTextbookContextReadyGuardResultForTest(
		"browser_navigate",
		"navigate",
		{ url: "https://bookshelf.vitalsource.com/reader/books/123" },
		readyTextbookTraces,
	);
	assert.equal(redundantNavigateGuard?.guardrail?.kind, "textbook_context_ready");
	const externalNavigateGuard = buildTextbookContextReadyGuardResultForTest(
		"browser_navigate",
		"navigate",
		{ url: "https://example.com/external-source" },
		readyTextbookTraces,
	);
	assert.equal(externalNavigateGuard, null);
	for (const [toolName, commandName, params] of [
		["browser_extract_content", "extract_content", { query: "Americans United" }],
		["browser_find_elements", "find_elements", { text: "Americans United" }],
		["browser_click_text", "click_text", { text: "Protestants United" }],
		["browser_wait_for_selector", "wait_for_selector", { selector: "body" }],
		["browser_pdf_capture_page_image", "pdf_capture_page_image", { pageNumber: 1 }],
		["browser_get_visible_region_image", "get_visible_region_image", { label: "search panel" }],
	]) {
		const guard = buildTextbookContextReadyGuardResultForTest(toolName, commandName, params, readyTextbookTraces);
		assert.equal(guard?.guardrail?.kind, "textbook_context_ready", `${toolName} should be blocked after textbook context is ready`);
		assert.match(formatToolResultForModel(toolName, guard), /Textbook context is already ready/);
	}
	const tinyVisualCapture = formatToolResultForModel("browser_get_visible_region_image", {
		tab: replaySmokeTab(),
		label: "div.jp-Cell.jp-CodeCell:nth-of-type(15)",
		region: {
			x: 0,
			y: 770,
			width: 1060,
			height: 41,
			clipped: true,
			visibleRatio: 0.24,
			smallRegion: true,
		},
		viewport: { width: 1060, height: 820 },
	});
	assert.match(tinyVisualCapture, /visible ratio 24%/);
	assert.match(tinyVisualCapture, /very small and may not contain the requested figure/);
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
	assert.deepEqual(
		buildHighlightRetryCandidates("- First exact source sentence for retry\n- Second exact source sentence for retry\n- Third exact source sentence for retry"),
		["First exact source sentence for retry", "Second exact source sentence for retry", "Third exact source sentence for retry"],
		"automatic highlight retries should stay bounded so a bad span cannot consume the turn",
	);
	assert.ok(
		buildHighlightRetryCandidates(Array.from({ length: 9 }, (_, index) => `- Retry source sentence number ${index + 1}`).join("\n")).length <= 5,
		"automatic highlight retries should still have a small upper bound",
	);
	assert.deepEqual(
		buildHighlightRetryCandidates("- " + "x".repeat(181) + "\n- Short retry source sentence"),
		["Short retry source sentence"],
		"automatic highlight retry candidates should avoid long block-like spans",
	);
	const mediumDerivationHighlightText = "A theorem may be derived from the relation between joint and conditional probabilities";
	assert.deepEqual(
		buildHighlightRetryCandidates(mediumDerivationHighlightText),
		["A theorem may be derived", "joint and conditional probabilities"],
		"medium source sentences should shrink to exact clause spans before expensive full-sentence highlighting",
	);
	assert.equal(
		shouldTryHighlightRetryCandidatesBeforeOriginalForTest(mediumDerivationHighlightText),
		true,
		"medium source sentences with retry clauses should try concise spans before the original text",
	);
	assert.equal(
		shouldTryHighlightRetryCandidatesBeforeOriginalForTest("Short exact source phrase"),
		false,
		"short exact source phrases should not pay the retry preflight cost",
	);
	assert.equal(cleanMarkdownHeadingHighlightTextForTest("## 5.4. Sets¶"), "5.4. Sets", "markdown heading markers should be stripped before highlight attempts");
	assert.equal(cleanMarkdownHeadingHighlightTextForTest("Plain source sentence"), "", "ordinary source text should not be rewritten as a heading");
	assert.equal(stripTrailingHeadingAnchorMarkerForTest("Tuples and Sequences¶"), "Tuples and Sequences", "docs permalink markers should not become literal highlight text");
	assert.equal(
		rewriteHighlightTextToRecentReadableExactPhraseForTest("Tuples and Sequences", {
			toolTraces: [
				{
					state: "complete",
					toolName: "browser_extract_content",
					resultSummary: "Readable content:\nTuples and Sequences¶\nSets¶\nDictionaries¶",
				},
			],
		}),
		"",
		"readable exact-phrase rewrites should not add docs permalink markers",
	);
	assert.equal(
		looksLikeExpandedMathExtractionCandidateForTest(
			"Metropolis-Hastings sampling will merge rejection sampling with the Markov chain sampling of Algorithm 1 and get rid of the problematic constant MMM.",
			"Metropolis-Hastings sampling will merge rejection sampling with the Markov chain sampling of Algorithm 1 and get rid of the problematic constant M.",
		),
		true,
		"readable rewrite candidates with duplicated rendered-math tokens should be treated as extraction noise",
	);
	assert.equal(
		rewriteHighlightTextToRecentReadableExactPhraseForTest("Metropolis-Hastings sampling will merge rejection sampling with the Markov chain sampling of Algorithm 1 and get rid of the problematic constant M.", {
			toolTraces: [
				{
					state: "complete",
					toolName: "browser_extract_content",
					resultSummary:
						"Readable content:\nMetropolis-Hastings sampling will merge rejection sampling with the Markov chain sampling of Algorithm 1 and get rid of the problematic constant MMM.",
				},
			],
		}),
		"",
		"readable exact-phrase rewrites should not replace clean prose with duplicated rendered-math text",
	);
	assert.equal(
		canRewriteToContainedReadablePhraseForTest(
			"Metropolis-Hastings Sampling",
			"Metropolis-Hastings sampling will merge rejection sampling with the Markov chain sampling of Algorithm 1 and get rid of the problematic constant M.",
		),
		false,
		"readable exact-phrase rewrites should not collapse explanatory spans to heading-only substrings",
	);
	assert.equal(
		rewriteHighlightTextToRecentReadableExactPhraseForTest("Metropolis-Hastings sampling will merge rejection sampling with the Markov chain sampling of Algorithm 1 and get rid of the problematic constant M.", {
			toolTraces: [
				{
					state: "complete",
					toolName: "browser_get_viewport_headings",
					resultSummary: "Nearby headings: 1. Metropolis-Hastings Sampling",
				},
			],
		}),
		"",
		"readable exact-phrase rewrites should not replace a substantive MH sentence with a heading",
	);
	assert.equal(
		rewriteHighlightTextToRecentReadableExactPhraseForTest("joint and conditional probabilities", {
			toolTraces: [
				{
					state: "error",
					toolName: "browser_highlight_text",
					resultSummary: "browser_highlight_text failed: No visible text matched: A theorem may be derived from the relation between joint and conditional probabilities.",
				},
			],
		}),
		"",
		"readable exact-phrase rewrites should ignore failed highlight trace summaries",
	);
	assert.equal(
		rewriteHighlightTextToRecentReadableExactPhraseForTest("joint and conditional probabilities", {
			toolTraces: [
				{
					state: "error",
					toolName: "browser_highlight_text",
					resultSummary: "browser_highlight_text failed: No visible text matched: A theorem may be derived from the relation between joint and conditional probabilities.",
				},
				{
					state: "complete",
					toolName: "browser_extract_content",
					resultSummary: "Readable content:\nA theorem may be derived from the relation between joint and conditional probabilities.",
				},
			],
		}),
		"",
		"readable exact-phrase rewrites should not expand a short exact phrase into a larger paragraph",
	);
	assert.equal(
		sourceCitationProvidesExplanatoryComparisonSupportForTest("Metropolis-Hastings Sampling", "Metropolis-Hastings"),
		false,
		"heading-only comparison highlights should not satisfy a comparison side",
	);
	assert.equal(
		sourceCitationProvidesExplanatoryComparisonSupportForTest(
			"Metropolis-Hastings sampling will merge rejection sampling with the Markov chain sampling of Algorithm 1 and get rid of the problematic constant M.",
			"Metropolis-Hastings",
		),
		true,
		"explanatory comparison highlights should satisfy the side they explain",
	);
	const longBayesianHighlightText = [
		"In Bayesian modeling, we want to be able to sample from the posterior of models given the data: W_r.v. ~ p(W | {(x_i,y_i)}_i=1^N).",
		"Each sampled W_r.v. is a model. Then, the label prediction can be described as p_Bayesian model(y | x; {(x_i,y_i)}_i=1^N) = ∫_W p(y | x ; W) p(W | {(x_i,y_i)}_i=1^N ) dW.",
		"In practice, we will sample a few models and average their predictions.",
	].join(" ");
	assert.deepEqual(
		buildHighlightRetryCandidates(longBayesianHighlightText),
		[
			"In Bayesian modeling, we want to be able to sample from the posterior of models given the data:",
			"Each sampled W_r.v. is a model.",
		],
		"long page-teaching highlight text should shrink to short exact source spans before retrying",
	);
	const labeledFormulaHighlightText =
		"Core claim: The method estimates the target quantity from observed data: theta_hat = sum_i x_i / n. Each estimate is one sample from the procedure.";
	assert.deepEqual(
		buildHighlightRetryCandidates(labeledFormulaHighlightText),
		[
			"The method estimates the target quantity from observed data:",
			"Core claim: The method estimates the target quantity from observed data:",
		],
		"highlight retries should prefer clean prose over labeled prose-plus-formula spans without relying on page-specific terms",
	);
	assert.match(
		formatToolResultForModel("browser_highlight_text", {
			guardrail: { message: "Two comparison source highlights already succeeded. Answer now." },
		}),
		/Answer now/,
		"surplus highlight guardrails should be returned to the model as instructions, not fake highlights",
	);
	assert.match(
		formatToolResultForModel("browser_highlight_text", {
			guardrail: { blockedTool: "browser_highlight_text", message: "Two comparison source highlights already succeeded. Answer now." },
		}),
		/Guardrail blocked browser_highlight_text/i,
		"guardrail tool results should be explicit blocked instructions in traces/model output",
	);
	assert.equal(
		isCompletedSourceHighlightTraceForTest({
			toolName: "browser_highlight_text",
			state: "complete",
			resultSummary:
				"Guardrail blocked browser_highlight_text: Highlighting has failed repeatedly on this page. Do not call browser_highlight_text again for this turn.",
		}),
		false,
		"guardrail highlight messages should not count as completed source highlights",
	);
	assert.equal(
		shouldAbortAfterRepeatedHighlightFailuresForTest({
			toolTraces: [
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
			],
		}),
		true,
		"repeated failed highlights should abort instead of leaving the request active indefinitely",
	);
	assert.equal(
		shouldAbortAfterRepeatedHighlightFailuresForTest({
			displayPrompt: "Teach me what this page says about Bayesian neural networks.",
			toolTraces: [
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
			],
		}),
		false,
		"compact page-teaching prompts should allow one concise retry after two failed exact highlight attempts",
	);
	assert.equal(
		shouldAbortAfterRepeatedHighlightFailuresForTest({
			displayPrompt: "Teach me what this page says about Bayesian neural networks.",
			toolTraces: [
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
			],
		}),
		true,
		"compact page-teaching prompts should stop failed highlight loops after the concise retry also fails",
	);
	const compactTeachingRepeatedFailureGuard = buildRepeatedHighlightFailureGuardResultForTest(
		"browser_highlight_text",
		"highlight_text",
		{
			displayPrompt: "Teach me what this page says about caching.",
			toolTraces: [
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
			],
		},
	);
	assert.doesNotMatch(
		compactTeachingRepeatedFailureGuard?.guardrail?.message || "",
		/briefly note|could not add highlights/i,
		"repeated highlight failure guard should not instruct the model to mention source-marker failures in chat",
	);
	assert.match(
		compactTeachingRepeatedFailureGuard?.guardrail?.message || "",
		/Do not mention highlight failures/i,
		"repeated highlight failure guard should keep marker failure status out of visible answers",
	);
	assert.equal(
		shouldAbortAfterRepeatedHighlightFailuresForTest({
			displayPrompt: "Could you show me a source that derives Bayes theorem from scratch?",
			toolTraces: [
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
			],
		}),
		true,
		"source discovery prompts phrased as 'show me a source' should use the external-source failure budget",
	);
	assert.equal(
		shouldAbortAfterRepeatedHighlightFailuresForTest({
			displayPrompt: "Teach me what this page says about photosynthesis.",
			toolTraces: [
				{ toolName: "browser_highlight_text", state: "error", resultDetails: { guardrail: { kind: "weak_compact_teaching_highlight" } } },
				{ toolName: "browser_highlight_text", state: "error", resultDetails: { guardrail: { kind: "weak_compact_teaching_highlight" } } },
				{ toolName: "browser_highlight_text", state: "error", resultDetails: { guardrail: { kind: "weak_compact_teaching_highlight" } } },
			],
		}),
		false,
		"corrective quality-guard blocks (retry with a better span) must not count toward the highlight give-up budget",
	);
	assert.equal(
		shouldAbortAfterRepeatedHighlightFailuresForTest({
			displayPrompt: "Teach me what this page says about photosynthesis.",
			toolTraces: [
				{ toolName: "browser_highlight_text", state: "error", resultDetails: { guardrail: { kind: "weak_compact_teaching_highlight" } } },
				{ toolName: "browser_highlight_text", state: "error", error: "No visible text matched: ..." },
				{ toolName: "browser_highlight_text", state: "error", error: "No visible text matched: ..." },
				{ toolName: "browser_highlight_text", state: "error", error: "No visible text matched: ..." },
			],
		}),
		true,
		"genuine page-match failures should still count toward the give-up budget even when mixed with corrective blocks",
	);
	assert.equal(
		shouldAbortAfterRepeatedHighlightFailuresForTest({
			displayPrompt: "Could you show me a source that derives Bayes theorem from scratch?",
			toolTraces: [
				{
					toolName: "browser_extract_content",
					state: "complete",
					resultSummary: "Readable content:\nBayes theorem follows from the product rule for joint probabilities.",
				},
				{ toolName: "browser_highlight_text", state: "error" },
			],
		}),
		true,
		"external source prompts should stop after one failed highlight when readable source content is already available",
	);
	const externalSourceReadableFailureGuard = buildRepeatedHighlightFailureGuardResultForTest(
		"browser_highlight_text",
		"highlight_text",
		{
			displayPrompt: "Could you show me a source that derives Bayes theorem from scratch?",
			toolTraces: [
				{ toolName: "browser_navigate", state: "complete", resultSummary: "Navigated to https://example.test/bayes" },
				{
					toolName: "browser_extract_content",
					state: "complete",
					resultSummary: "Readable content:\nBayes theorem follows from the product rule for joint probabilities.",
				},
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
			],
		},
	);
	assert.match(
		externalSourceReadableFailureGuard?.guardrail?.message || "",
		/Answer the user's question now from the readable page content/i,
		"external source prompts should answer from readable source content after repeated highlight failures",
	);
	assert.doesNotMatch(
		externalSourceReadableFailureGuard?.guardrail?.message || "",
		/different credible source page/i,
		"readable external source content should not trigger another source-search loop after repeated highlight failures",
	);
	const externalSourceUnreadableFailureGuard = buildRepeatedHighlightFailureGuardResultForTest(
		"browser_highlight_text",
		"highlight_text",
		{
			displayPrompt: "Could you show me a source that derives Bayes theorem from scratch?",
			toolTraces: [
				{ toolName: "browser_navigate", state: "complete", resultSummary: "Navigated to https://example.test/bayes" },
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
			],
		},
	);
	assert.match(
		externalSourceUnreadableFailureGuard?.guardrail?.message || "",
		/different credible source page/i,
		"external source prompts without readable content may try one alternate source after repeated highlight failures",
	);
	assert.equal(
		shouldAbortAfterRepeatedHighlightFailuresForTest({
			displayPrompt: "Could you show me a source that derives Bayes theorem from scratch?",
			toolTraces: [
				{
					toolName: "browser_activate_tab",
					state: "complete",
					resultDetails: { tab: { url: "https://example.test/bayes" } },
				},
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
				{
					toolName: "browser_navigate",
					state: "complete",
					resultDetails: { tab: { url: "https://example.test/bayes#proof" } },
				},
			],
		}),
		true,
		"same-document anchor navigation should not reset repeated highlight failures",
	);
	const postHighlightFailureReadGuard = buildPostHighlightFailureAnswerNowGuardResultForTest(
		"browser_get_visible_text",
		"get_visible_text",
		{
			displayPrompt: "Could you show me a source that derives Bayes theorem from scratch?",
			toolTraces: [
				{
					toolName: "browser_extract_content",
					state: "complete",
					resultSummary: "Readable content:\nBayes theorem follows from the product rule for joint probabilities.",
				},
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
			],
		},
	);
	assert.equal(
		postHighlightFailureReadGuard?.guardrail?.kind,
		"post_highlight_failure_answer_now",
		"read/navigation tools should be blocked after repeated highlight failures when readable source content exists",
	);
	assert.match(
		formatToolResultForModel("browser_get_visible_text", postHighlightFailureReadGuard),
		/Answer the user's question now from the readable page content/i,
		"post-highlight-failure guard should steer the model to final answer instead of more page reads",
	);
	const compactTeachingHighlightBudgetGuard = buildCompactTeachingHighlightBudgetGuardResultForTest(
		"browser_highlight_text",
		"highlight_text",
		"Teach me what this page says about fetch.",
		{
			displayPrompt: "Teach me what this page says about fetch.",
			toolTraces: [
				{ toolName: "browser_highlight_text", state: "complete", resultSummary: "Highlighted text: The Fetch API provides a JavaScript interface for making HTTP requests." },
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
			],
		},
	);
	assert.equal(
		compactTeachingHighlightBudgetGuard?.guardrail?.kind,
		"compact_teaching_highlight_budget",
		"compact teaching prompts should answer from an existing source after repeated later highlight failures",
	);
	assert.match(
		formatToolResultForModel("browser_highlight_text", compactTeachingHighlightBudgetGuard),
		/Do not call browser_highlight_text again/,
		"compact teaching highlight budget should instruct the model to stop retrying markers",
	);
	assert.equal(
		buildCompactTeachingNoteFailureGuardResultForTest(
			"browser_show_note",
			"show_note",
			"Teach me what this page says about fetch.",
			{
				displayPrompt: "Teach me what this page says about fetch.",
				toolTraces: [
					{ toolName: "browser_highlight_text", state: "complete", resultSummary: "Highlighted text: The Fetch API provides a JavaScript interface for making HTTP requests." },
					{ toolName: "browser_show_note", state: "error" },
				],
			},
		),
		null,
		"one transient note failure must not forfeit the per-mark note budget",
	);
	const compactTeachingNoteFailureGuard = buildCompactTeachingNoteFailureGuardResultForTest(
		"browser_show_note",
		"show_note",
		"Teach me what this page says about fetch.",
		{
			displayPrompt: "Teach me what this page says about fetch.",
			toolTraces: [
				{ toolName: "browser_highlight_text", state: "complete", resultSummary: "Highlighted text: The Fetch API provides a JavaScript interface for making HTTP requests." },
				{ toolName: "browser_show_note", state: "error" },
				{ toolName: "browser_show_note", state: "error" },
			],
		},
	);
	assert.equal(
		compactTeachingNoteFailureGuard?.guardrail?.kind,
		"compact_teaching_note_failure",
		"compact teaching prompts should stop retrying notes after repeated failures with none landed",
	);
	assert.match(
		formatToolResultForModel("browser_show_note", compactTeachingNoteFailureGuard),
		/Do not call browser_show_note again/,
		"compact teaching note failure guard should instruct the model to answer without another note attempt",
	);
	assert.equal(
		shouldAbortAfterRepeatedHighlightFailuresForTest({
			toolTraces: [
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "complete", resultSummary: "Highlighted text: Source sentence for the answer." },
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
			],
		}),
		false,
		"a successful highlight should satisfy the source-marker path and prevent failure-budget aborts",
	);
	assert.equal(
		shouldAbortAfterRepeatedHighlightFailuresForTest({
			displayPrompt: "Find an external source that derives this.",
			toolTraces: [
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_navigate", state: "complete" },
			],
		}),
		false,
		"successful navigation to another source page should reset the repeated-highlight failure budget",
	);
	assert.equal(
		shouldAbortAfterRepeatedHighlightFailuresForTest({
			displayPrompt: "Find an external source that derives this.",
			toolTraces: [
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
				{
					toolName: "browser_activate_tab",
					state: "complete",
					resultDetails: { tab: { url: "https://example.test/alternate-source" } },
				},
			],
		}),
		false,
		"activating another source tab should reset the repeated-highlight failure budget",
	);
	assert.equal(
		shouldAbortAfterRepeatedHighlightFailuresForTest({
			displayPrompt: "Find an external source that derives this.",
			toolTraces: [
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_navigate", state: "complete" },
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
			],
		}),
		true,
		"highlight failures after the latest source navigation should still trigger the failure guard",
	);
	assert.equal(
		shouldAbortAfterRepeatedHighlightFailuresForTest({
			displayPrompt: "Find a source that derives this from first principles.",
			toolTraces: [
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
			],
		}),
		true,
		"external source prompts should switch sources after two highlight failures on the same page",
	);
	const externalSourceHighlightFailureGuard = buildRepeatedHighlightFailureGuardResultForTest(
		"browser_highlight_text",
		"highlight_text",
		{
			displayPrompt: "Find a source that derives this from first principles.",
			toolTraces: [
				{ toolName: "browser_highlight_text", state: "error" },
				{ toolName: "browser_highlight_text", state: "error" },
			],
		},
	);
	assert.match(
		externalSourceHighlightFailureGuard?.guardrail?.message || "",
		/different credible source page|simpler printable page/i,
		"external source highlight failures should steer the model to another source before answering without a marker",
	);
	assert.doesNotMatch(
		externalSourceHighlightFailureGuard?.guardrail?.message || "",
		/Answer the user's question now/i,
		"external source highlight failures should not immediately force an unmarked answer",
	);
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
		recoveredAnnotations: 0,
		restoredNotes: 1,
		failedCount: 0,
		failures: [],
		snapshotFallback: null,
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

	const recovered = summarizeRestoredArtifact({
		tab: { id: 42, title: "Restored tab", url: "https://example.test/page" },
		artifactId: "artifact_recovered",
		artifact: { page: { title: "Drifted page", url: "https://example.test/drifted" } },
		restoredAnnotations: 3,
		recoveredAnnotations: 2,
		restoredNotes: 0,
		failures: [],
	});
	assert.equal(recovered.recoveredAnnotations, 2, "context-recovered highlight counts should reach the restore summary");

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
			anchor: { surface: "html", textQuote: { exact: "Alpha smoke content", prefix: "Intro", suffix: "Outro" }, occurrence: 1 },
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
			anchor: { surface: "html", textQuote: { exact: "Alpha smoke content", prefix: "Intro", suffix: "Outro" }, occurrence: 1 },
			noteText: "Important replay note",
		},
	]);
}

async function assertDocumentReviewMarkupLane() {
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const {
		promptAsksForDocumentReviewMarkupForTest: isReview,
		buildReviewExtractionFirstGuardResultForTest: extractionGuard,
		buildSurplusReviewHighlightGuardResultForTest: surplusHighlightGuard,
		buildSurplusReviewNoteGuardResultForTest: surplusNoteGuard,
		buildStructuredNoteBudgetGuardResultForTest: structuredNoteGuard,
		buildSurplusTeachingHighlightGuardResultForTest: surplusTeachingGuard,
		buildReasoningProfileForTest: buildProfile,
	} = __browserRuntimeTest;

	// The real failing phrasing: no markup verb anywhere — embedded feedback
	// plus the document as subject must classify it.
	const realPhrasing = [
		"I recently started working on the knowledge graph validation, and I had written a document that went",
		"through kind of a summary of the validation. I think it was the KG validation plan. That's the document",
		"that we had written. And I got some notes back on this plan, and I'd like you to go through them and give",
		"me your thoughts on the advice that I got.",
		"from my manager: Document looks good but there are several holes as mentioned below. Please plug the",
		"holes and circulate the updated document. You cannot descope numerical magnitude. That's a huge hole.",
		"Negative space is mentioned but not defined operationally. The named causal spines are not fully",
		"specified in the plan. County counts are used as a census check but the approach is fragile.",
	].join(" ");
	assert.equal(isReview(realPhrasing), true, "embedded feedback + document subject should classify as review markup");
	assert.equal(isReview("Mark up this draft with what I should change."), true, "explicit markup verbs qualify alone");
	assert.equal(isReview("Summarize this document for me."), false, "summaries are not review markup");
	assert.equal(isReview("Review this plan."), false, "a bare review ask without feedback stays in its usual lane");
	assert.equal(isReview("Teach me what this page says about Bayesian neural networks."), false, "teaching stays teaching");

	// The review profile must lead with full-document extraction and a
	// per-feedback-point mark budget.
	const settings = { aiProvider: "onhand-smoke", aiModel: "onhand-smoke-1", aiApiKey: "test", authMode: "api-key" };
	const profile = buildProfile(settings, realPhrasing, [], false);
	assert.equal(profile.mode, "document-review");
	assert.match(profile.reason, /document review markup/i);
	assert.match(profile.promptPolicy, /Document review markup/);
	assert.match(profile.promptPolicy, /browser_extract_content before placing any marks/);
	assert.match(profile.promptPolicy, /browser_show_note/);

	// Extraction-first guard: fires once before any full read, then never again.
	const request = { toolTraces: [] };
	const first = extractionGuard("browser_highlight_text", "highlight_text", realPhrasing, request);
	assert.equal(first?.guardrail?.kind, "review_extraction_first");
	assert.match(first.guardrail.message, /browser_extract_content first/);
	assert.equal(extractionGuard("browser_highlight_text", "highlight_text", realPhrasing, request), null, "the nudge is one-shot");
	const readRequest = {
		toolTraces: [{ toolName: "browser_extract_content", state: "complete" }],
	};
	assert.equal(extractionGuard("browser_highlight_text", "highlight_text", realPhrasing, readRequest), null, "no nudge once the document was read");

	// Budgets: the soft target is a one-shot mid-pass checkpoint, never a
	// wall; only the runaway backstop hard-stops.
	const marks = (count) => ({
		toolTraces: Array.from({ length: count }, (_, index) => ({
			toolName: "browser_highlight_text",
			state: "complete",
			resultSummary: `Highlighted text ${index + 1}`,
		})),
	});
	assert.equal(surplusHighlightGuard("browser_highlight_text", "highlight_text", realPhrasing, marks(9)), null);
	const checkpointRequest = marks(10);
	checkpointRequest.toolTraces.push({ toolName: "browser_highlight_text", state: "running", toolCallId: "call_a|fc_batch_one" });
	const checkpoint = surplusHighlightGuard("browser_highlight_text", "highlight_text", realPhrasing, checkpointRequest);
	assert.equal(checkpoint?.guardrail?.kind, "review_mark_checkpoint", "the soft target should nudge, not block");
	assert.match(checkpoint.guardrail.message, /Never mention mark budgets/, "the checkpoint must forbid budget narration in the reply");
	// Sibling calls batched in the same assistant message were drafted before
	// the model could read the checkpoint — they are held with it.
	checkpointRequest.toolTraces.push({ toolName: "browser_highlight_text", state: "running", toolCallId: "call_b|fc_batch_one" });
	assert.equal(
		surplusHighlightGuard("browser_highlight_text", "highlight_text", realPhrasing, checkpointRequest)?.guardrail?.kind,
		"review_mark_checkpoint_batch",
		"same-batch siblings must be held with the checkpoint",
	);
	// A call from the model's next message means it read the checkpoint and
	// chose to continue — that flows freely.
	checkpointRequest.toolTraces.push({ toolName: "browser_highlight_text", state: "running", toolCallId: "call_c|fc_batch_two" });
	assert.equal(
		surplusHighlightGuard("browser_highlight_text", "highlight_text", realPhrasing, checkpointRequest),
		null,
		"post-checkpoint marks continue without blocking",
	);
	const hardStop = surplusHighlightGuard("browser_highlight_text", "highlight_text", realPhrasing, marks(20));
	assert.equal(hardStop?.guardrail?.kind, "surplus_review_highlight", "only the runaway backstop hard-stops");
	assert.match(hardStop.guardrail.message, /Never mention mark budgets/, "the backstop must forbid budget narration in the reply");
	const notes = (count) => ({
		toolTraces: Array.from({ length: count }, () => ({ toolName: "browser_show_note", state: "complete" })),
	});
	assert.equal(surplusNoteGuard("browser_show_note", "show_note", realPhrasing, notes(10)), null, "note budget must not stop below the backstop");
	assert.equal(surplusNoteGuard("browser_show_note", "show_note", realPhrasing, notes(20))?.guardrail?.kind, "surplus_review_note");

	// Guard interceptions are course corrections, not failures: a held batch
	// must not trip the highlight give-up budget and abort the marking pass.
	const { shouldAbortAfterRepeatedHighlightFailuresForTest } = __browserRuntimeTest;
	const heldBatch = {
		displayPrompt: realPhrasing,
		toolTraces: Array.from({ length: 8 }, (_, index) => ({
			toolName: "browser_highlight_text",
			state: "error",
			toolCallId: `call_${index}|fc_batch_one`,
			details: { guardrail: { kind: "review_mark_checkpoint_batch" } },
		})),
	};
	assert.equal(shouldAbortAfterRepeatedHighlightFailuresForTest(heldBatch), false, "checkpoint holds must not count toward the highlight give-up budget");

	// The teaching/structured caps must not strangle the review lane even when
	// the pasted feedback trips their keyword predicates ("summary", "approach").
	assert.equal(structuredNoteGuard("browser_show_note", "show_note", realPhrasing, notes(3)), null, "structured note cap must not apply to review markup");
	assert.equal(surplusTeachingGuard("browser_highlight_text", "highlight_text", realPhrasing, marks(4)), null, "teaching highlight cap must not apply to review markup");
}

async function assertLanePredicatesClassifyOnOwnWords() {
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const {
		ownWordsPromptTextForTest: ownWords,
		promptAsksForSinglePageComparisonForTest: isComparison,
		promptAsksForCompactPageTeachingForTest: isCompactTeaching,
	} = __browserRuntimeTest;

	// Pasted feedback blocks are quoted material, not the user's ask.
	const withPastedComparison = [
		"Go over my notes on this document and tell me what to address.",
		"from my manager:",
		"The deterministic comparison against the manifest is fragile. Compare the census approach versus a materiality filter and summarize the difference.",
	].join("\n");
	assert.equal(ownWords(withPastedComparison).includes("comparison"), false, "own-words view must exclude the pasted block");
	assert.equal(ownWords(withPastedComparison).includes("go over my notes"), true, "own-words view keeps the user's ask");
	assert.equal(isComparison(withPastedComparison), false, "comparison vocabulary inside pasted feedback must not select the comparison lane");
	assert.equal(isComparison("Compare CSS Grid and Flexbox on this page."), true, "genuine comparison asks still classify");
	assert.equal(
		isCompactTeaching('Teach me what this page says.\nreviewer notes:\nAdd a deep dive comparing every section, with a full walkthrough of each derivation.'),
		true,
		"pasted vocabulary must not knock a teaching ask out of its lane either",
	);

	// Markdown blockquotes are quoted material too.
	assert.equal(isComparison("What does this page say about attention?\n> compare and contrast the two models in your reply"), false);
}

async function assertLanePolicyProseMatchesEnforcedBudgets() {
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const { buildReasoningProfileForTest: buildProfile, laneBudgetsForTest: budgets } = __browserRuntimeTest;
	const settings = { aiProvider: "onhand-smoke", aiModel: "onhand-smoke-1", aiApiKey: "test", authMode: "api-key" };

	// Drift tripwire: the briefing the model reads must quote the same numbers
	// the surplus guards enforce.
	const teaching = buildProfile(settings, "Teach me what this page says about photosynthesis", [], false);
	assert.match(teaching.reason, /compact page teaching/i);
	assert.match(teaching.promptPolicy, new RegExp(`at most ${budgets.TEACHING_SOURCE_HIGHLIGHT_MAX}\\b`), "teaching policy prose must quote the enforced highlight cap");
	assert.doesNotMatch(teaching.promptPolicy, /about six/, "the stale six-highlight promise must be gone");
	assert.equal(budgets.TEACHING_SOURCE_NOTE_MAX >= 1, true);
	{
		// The shared mark-policy fragments must quote the same numbers the
		// guards enforce; a budget change must land in both or fail here.
		const { markPolicyForTest } = __browserRuntimeTest || {};
		assert.ok(markPolicyForTest && typeof markPolicyForTest === "object", "mark-policy fragment export is missing");
		const numberWords = { 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight" };
		assert.ok(
			markPolicyForTest.teachBudgetPhrase.endsWith(numberWords[budgets.TEACHING_SOURCE_HIGHLIGHT_MAX]),
			`teach budget phrase "${markPolicyForTest.teachBudgetPhrase}" must end with the enforced cap (${budgets.TEACHING_SOURCE_HIGHLIGHT_MAX})`,
		);
		assert.ok(
			markPolicyForTest.noteShapePhrase.includes(String(budgets.ON_PAGE_NOTE_MAX_CHARS)),
			`note shape phrase must quote the enforced character cap (${budgets.ON_PAGE_NOTE_MAX_CHARS})`,
		);
		assert.ok(
			markPolicyForTest.perMarkNotes.includes(String(budgets.ON_PAGE_NOTE_MAX_CHARS)),
			"the per-mark note rule must quote the enforced character cap",
		);
	}

	const review = buildProfile(
		settings,
		"I got notes back on this plan from my manager — go through them and tell me what to change.\nfrom my manager:\n" + "The rollout section needs a soft launch. ".repeat(12),
		[],
		false,
	);
	assert.match(review.reason, /document review markup/i);
	assert.match(review.promptPolicy, new RegExp(`around ${budgets.REVIEW_SOURCE_HIGHLIGHT_SOFT_TARGET}\\b`), "review policy prose must quote the soft mark target");
	assert.match(review.promptPolicy, /Never mention internal budgets/, "review policy must forbid budget narration");
}

async function assertBlankReplyRetryWaitsForAgentIdle() {
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const { queueBlankReplyRetryForTest, buildBlankReplyRetryPromptForTest } = __browserRuntimeTest || {};
	assert.equal(typeof queueBlankReplyRetryForTest, "function", "blank-reply retry helper export is missing");
	assert.equal(typeof buildBlankReplyRetryPromptForTest, "function", "blank-reply retry prompt helper export is missing");
	const events = [];
	let resolveIdle;
	const idlePromise = new Promise((resolve) => {
		resolveIdle = resolve;
	});
	let capturedError = null;
	const agent = {
		followUp(message) {
			events.push({ type: "followUp", message });
		},
		waitForIdle() {
			events.push({ type: "waitForIdle" });
			return idlePromise;
		},
		async continue() {
			events.push({ type: "continue" });
		},
		async prompt() {
			events.push({ type: "prompt" });
			throw new Error("prompt should not be used for queued blank-reply retries");
		},
	};

	queueBlankReplyRetryForTest(agent, "Answer now from the tool result.", (error) => {
		capturedError = error;
	});
	assert.deepEqual(
		events.map((event) => event.type),
		["followUp", "waitForIdle"],
		"blank reply retry should queue a follow-up and wait for idle before continuing",
	);
	assert.equal(events[0].message.role, "user");
	assert.equal(events[0].message.content[0].text, "Answer now from the tool result.");
	await Promise.resolve();
	assert.equal(events.some((event) => event.type === "continue"), false, "retry should not continue before the active run is idle");
	resolveIdle();
	for (let attempt = 0; attempt < 10 && !events.some((event) => event.type === "continue"); attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.equal(events.some((event) => event.type === "continue"), true, "retry should continue after the active run settles");
	assert.equal(events.some((event) => event.type === "prompt"), false, "retry should not call Agent.prompt while the original run is active");
	assert.equal(capturedError, null);
	const sourceMarkerRetryPrompt = buildBlankReplyRetryPromptForTest({
		displayPrompt: "Give me a roadmap of the data structures covered on this page.",
		toolTraces: [
			{
				toolName: "browser_extract_content",
				state: "complete",
				resultSummary: "Readable content: 5.1. More on Lists 5.3. Tuples and Sequences 5.4. Sets 5.5. Dictionaries",
			},
		],
	});
	assert.match(sourceMarkerRetryPrompt, /needs (?:a durable page source marker|durable page source markers)/i);
	assert.match(sourceMarkerRetryPrompt, /browser_highlight_text/i);
	assert.doesNotMatch(
		sourceMarkerRetryPrompt,
		/Do not call more tools/i,
		"blank retries for source-marker prompts must still allow highlight tools",
	);
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
		// Zoom must not mark and rerender every page. Existing canvases scale
		// immediately, while only visible/nearby pages receive a sharper raster;
		// trackpad pinch is the native ctrl+wheel gesture in Chromium.
		assert.match(source, /pageNeedsSharperRender/, `${path} should track whether a page actually needs a sharper raster`);
		assert.match(source, /renderSharpPagesNearViewport/, `${path} should rerender only pages near the viewport after zoom`);
		assert.match(source, /data-onhand-pdf-raster-scale/, `${path} should retain each page's raster scale`);
		assert.match(source, /committedScale/, `${path} should separate committed layout scale from transient gesture scale`);
		assert.match(source, /applyTransientZoom/, `${path} should preview gesture zoom with one compositor transform`);
		assert.match(source, /commitTransientZoom/, `${path} should commit page layout only after gesture zoom settles`);
		assert.match(source, /transientZoomCentersHorizontally/, `${path} should center transient zoom while the current page fits the viewport`);
		assert.match(source, /`translate3d\([^`]+\) scale\(\$\{ratio\}\)`/, `${path} should keep compositor-preview translation in viewport pixels`);
		assert.match(source, /pendingCountBeforeSharpen/, `${path} should not compete with the initial background render queue when sharpening scans`);
		assert.match(source, /rebuildPdfAnnotationLayers/, `${path} should rebuild annotations at committed geometry even when sharpening is deferred`);
		assert.match(source, /return Math\.min\(requested, dimensionLimit, pixelLimit\)/, `${path} should honor canvas dimension and pixel caps at every zoom level`);
		assert.doesNotMatch(source, /Math\.max\(0\.25, Math\.min\(requested, dimensionLimit, pixelLimit\)\)/, `${path} should not override canvas safety caps with a minimum output scale`);
		assert.match(source, /event\.ctrlKey/, `${path} should support Chromium trackpad pinch zoom`);
		assert.match(source, /gesturechange/, `${path} should support native gesture zoom events`);
		assert.doesNotMatch(source, /Every page needs a crisp pass/, `${path} should not schedule a full-document rerender after zoom`);
		// textContent glues text-layer line fragments together; extraction
		// must convert PDF.js's <br> line markers to whitespace.
		assert.match(source, /textLayerVisibleText/, `${path} should separate text-layer lines when extracting text`);
	}
	const viewerHtml = await readFile(new URL("../packages/browser-extension/pdf-viewer.html", import.meta.url), "utf8");
	assert.match(viewerHtml, /id="onhand-pdf-zoom-value"/, "PDF viewer should expose a visible zoom percentage and fit control");
	assert.match(viewerHtml, /justify-content:\s*safe center/, "oversized PDF pages should remain horizontally scrollable");
	assert.match(viewerHtml, /justify-items:\s*safe center/, "each PDF page should stay centered when page sizes differ");
	assert.match(viewerHtml, /\.onhand-pdf-toolbar\s*\{[^}]*position:\s*fixed[^}]*left:\s*0[^}]*right:\s*0/s, "PDF toolbar should stay pinned to the viewport while a zoomed page scrolls horizontally");
	assert.match(viewerHtml, /body\s*\{[^}]*padding-top:\s*var\(--onhand-pdf-toolbar-height\)/s, "fixed PDF toolbar should reserve its height above the document");
	assert.match(viewerHtml, /\.page\s*\{[^}]*scroll-margin-top:\s*var\(--onhand-pdf-toolbar-height\)/s, "PDF page jumps should land below the fixed toolbar");
	assert.match(viewerHtml, /id="onhand-pdf-title"[\s\S]*id="onhand-pdf-status"[\s\S]*class="onhand-pdf-controls"/, "variable PDF status text should appear before the stable control cluster");
	assert.match(viewerHtml, /\.onhand-pdf-controls\s*\{[^}]*flex:\s*0\s+0\s+auto/s, "PDF controls should not move or shrink when status text changes");
	assert.match(viewerHtml, /\.canvasWrapper\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/s, "PDF canvases should fill resized page shells without per-canvas layout writes");
	const background = await readFile(new URL("../packages/browser-extension/background.js", import.meta.url), "utf8");
	assert.match(
		background,
		/probeInlineOnhandPdfViewerStatus/,
		"open_pdf_in_onhand_viewer should reuse an existing viewer instead of reinstalling on every prompt",
	);
	assert.match(
		background,
		/args\.forceReload !== true && !sourceIsGoogleDocs && !isOnhandPdfViewerLikeUrl\(sourceTab\.url\) && isHttpLikeUrl\(pdfUrl\)[\s\S]*probeInlineOnhandPdfViewerStatus\(sourceTab\.id,\s*pdfUrl\)/,
		"inline PDF viewer reuse should run even when a later tool call asks for a new tab",
	);
	assert.doesNotMatch(
		background,
		/args\.forceReload !== true && !shouldOpenViewerInNewTab[\s\S]{0,200}probeInlineOnhandPdfViewerStatus/,
		"newTab should not bypass the existing inline PDF viewer reuse check",
	);
	assert.match(background, /reusedExistingViewer/, "viewer reuse should be reported in the handoff result");
	assert.doesNotMatch(
		background,
		/Refreshing inline Onhand PDF viewer to match source reader page/,
		"page mismatches should not reload the inline Onhand PDF viewer and wipe existing annotations",
	);
	const browserRuntimeSource = await readFile(new URL("../packages/browser-extension/src/browser-runtime.ts", import.meta.url), "utf8");
	const corpusAuditStart = browserRuntimeSource.indexOf("async function runLearningCorpusPreflightCommand");
	const corpusAuditEnd = browserRuntimeSource.indexOf("async function planLearningResearch", corpusAuditStart);
	const corpusAuditPath = browserRuntimeSource.slice(corpusAuditStart, corpusAuditEnd);
	assert.ok(corpusAuditStart >= 0 && corpusAuditEnd > corpusAuditStart, "Learning corpus preflight should have a dedicated audited command path");
	assert.match(corpusAuditPath, /appendActivity/, "hidden corpus research should be visible in the activity trail");
	assert.match(corpusAuditPath, /recordToolTraceStart/, "hidden corpus research should record trace input");
	assert.match(corpusAuditPath, /recordToolTraceEnd/, "hidden corpus research should record trace output");
	assert.match(corpusAuditPath, /appendUniquePageAction[\s\S]*buildPageAction/, "hidden corpus research should publish a readable page action");
	const learningPlanStart = browserRuntimeSource.indexOf("async function planLearningResearch");
	const learningPlanEnd = browserRuntimeSource.indexOf("async function assessLearningResearchEvidence", learningPlanStart);
	assert.match(
		browserRuntimeSource.slice(learningPlanStart, learningPlanEnd),
		/hydrateLearningResearchPlanWithCorpus\([\s\S]*runLearningCorpusPreflightCommand/,
		"Learning plan hydration should use the audited corpus command runner",
	);
	assert.match(
		background,
		/Reusing inline Onhand PDF viewer without reload; requested page differs/,
		"page mismatches should reuse the existing inline Onhand PDF viewer",
	);
	assert.match(
		background,
		/async function withTabCommand\(tabId, fn, timeoutMs = TAB_COMMAND_TIMEOUT_MS\) \{[\s\S]*?const scheduledTask = withOperationTimeout\(\s*previousTask\s*\.catch\(\(\) => \{\}\)\s*\.then\(\(\) => \{[\s\S]*?return Promise\.resolve\(\)\.then\(fn\);\s*\}\),\s*timeoutMs,/,
		"tab command queues should time out the wait behind a prior page command, not only the command body",
	);
	const corpusCommandCase = background.match(/case "search_linked_pdf_corpus": \{[\s\S]*?(?=\n\t\tcase "activate_tab")/)?.[0] || "";
	const corpusTabCommandEnd = corpusCommandCase.indexOf("// Only DOM access belongs");
	const corpusSearchStart = corpusCommandCase.indexOf("const corpus = await searchPdfCorpus");
	assert.match(corpusCommandCase, /const linkScrape = withTabCommand\(tab\.id,[\s\S]*evaluateInTab/);
	assert.match(corpusCommandCase, /overallTimeoutMs:[\s\S]*remainingOverallMs/);
	assert.match(
		corpusCommandCase,
		/Number\(args\.overallTimeoutMs\) > 0[\s\S]*: 30000;/,
		"direct agent corpus searches should receive a bounded overall deadline even when the caller omits one",
	);
	assert.ok(
		corpusTabCommandEnd >= 0 && corpusSearchStart > corpusTabCommandEnd,
		"linked-PDF fetch, parse, and ranking must run after the tab-command timeout scope ends",
	);
	for (const [toolName, commandName] of [
		["browser_list_tabs", "list_tabs"],
		["browser_activate_tab", "activate_tab"],
		["browser_find_elements", "find_elements"],
		["browser_click", "click"],
	]) {
		assert.match(
			background,
			new RegExp(`${toolName}: ["']${commandName}["']`),
			`the Realtime background dispatcher should register advertised tool ${toolName}`,
		);
	}
	assert.match(background, /const REALTIME_BROWSER_SELECTOR_COMMANDS = new Set\([\s\S]*"activate_tab"[\s\S]*"navigate"[\s\S]*"find_elements"/);
	assert.match(
		background,
		/if \(!REALTIME_BROWSER_SELECTOR_COMMANDS\.has\(command\)\) \{[\s\S]*delete sanitized\.tabId/,
		"Realtime workspace tools should preserve explicit selectors for supported cross-tab commands",
	);
	assert.doesNotMatch(background, /sanitized\.newTab = false;\s*\}/, "Realtime navigation should not overwrite an explicit newTab=true request");
	assert.match(
		background,
		/hasOwnProperty\.call\(sanitized, "newTab"\)\) sanitized\.newTab = false;[\s\S]*sanitized\.newTab === true[\s\S]*sanitized\.active = false/,
		"Realtime navigation should keep current-tab defaults while permitting explicit background tabs without focus stealing",
	);
	assert.match(
		background,
		/if \(existingTab\?\.id\) \{[\s\S]{0,700}createdNewTab: false,[\s\S]{0,120}reusedExistingTab: true/,
		"reused navigation targets should be identified as pre-existing tabs",
	);
	assert.match(
		background,
		/const createdTab = await chrome\.tabs\.create\([\s\S]{0,500}createdNewTab: true,[\s\S]{0,120}reusedExistingTab: false/,
		"new navigation targets should be identified as request-created tabs",
	);
	assert.match(
		background,
		/navigation: \{[\s\S]{0,180}createdNewTab: navigation\.createdNewTab,[\s\S]{0,120}reusedExistingTab: navigation\.reusedExistingTab/,
		"navigation provenance should be returned to the runtime trace",
	);
	assert.match(
		background,
		/const scheduledTask = withOperationTimeout\(\s*previousTask\.catch\(\(\) => \{\}\)\.then\(async \(\) => \{[\s\S]{0,220}attachDebuggerWithRetry/,
		"debugger command queues should time out the wait behind a prior debugger task",
	);
	assert.doesNotMatch(
		background,
		/previousTask\s*\.\s*catch\(\(\) => \{\}\)\s*\.\s*then\(\s*\(\)\s*=>\s*withOperationTimeout\(/,
		"tab command queues must not wait forever before starting their timeout wrapper",
	);
	assert.match(
		background,
		/forceSelectionHandoff === true[\s\S]*getSelectionHandoffResult/,
		"existing PDF viewers should skip automatic selection replay unless explicitly forced",
	);
}

async function assertBrowserContextSnapshotHasTimeoutFallback() {
	const { readFile } = await import("node:fs/promises");
	const runtimeSource = await readFile(new URL("../packages/browser-extension/src/browser-runtime.ts", import.meta.url), "utf8");
	assert.match(runtimeSource, /function runBrowserContextSnapshot/, "browser context snapshot should have its own timeout wrapper");
	assert.match(runtimeSource, /withBrowserContextTimeout\("snapshot_state"/, "snapshot timeout should surface a page-context warning");
	assert.match(
		runtimeSource,
		/const state = await runBrowserContextSnapshot\(host\);\s*const activeTab = pickActiveTab\(state, options\.targetWindowId\)/,
		"initial browser context rendering should use the timeout-backed snapshot",
	);
	assert.match(
		runtimeSource,
		/async function runAutomaticPdfHandoffIfNeeded[\s\S]*const state = await runBrowserContextSnapshot\(host\);/,
		"automatic PDF handoff should not hang indefinitely on snapshotState",
	);
}

async function assertConstitutionPromptContract() {
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
		const {
			buildPdfAnchorRetryPromptForTest,
			buildExistingAnchorContext,
			buildFinalAssistantReplyForTest,
			compactOnPageNoteTextForTest,
			buildPriorExtractedPageContextForTest,
			buildVisiblePdfSelectionFirstPassGuardResultForTest,
			buildRepeatedViewportReadGuardResultForTest,
			buildOptionalFrameFallbackNoteGuardResultForTest,
		buildReasoningProfileForTest,
			formatToolResultForModel,
			getPromptContractForTest,
			getToolNamesForTest,
			promptAsksForTeachingPageSourceMarkerForTest,
			promptAsksForStructuredPageSourceMarkerForTest,
			promptAllowsPageSourceHighlightsForTest,
			promptRequiresPageSourceMarkerForTest,
			shouldDeferPdfViewerForVisibleSelectionPrompt,
			shouldRequirePageSourceMarkerRetryForTest,
			buildPageSourceMarkerRetryPromptForTest,
			shouldRequirePdfAnchorRetryForTest,
			buildEmptyHighlightTextGuardResultForTest,
			buildWeakStructuredHighlightTextGuardResultForTest,
			buildSurplusHighlightGuardResultForTest,
			buildSurplusTeachingHighlightGuardResultForTest,
			buildSurplusTeachingNoteGuardResultForTest,
			buildStructuredHighlightBudgetGuardResultForTest,
			buildStructuredNoteBudgetGuardResultForTest,
			cleanMarkdownHeadingHighlightTextForTest,
			rewriteComparisonHighlightTextForTest,
			sanitizeAssistantVisibleReplyForTest,
			shouldRecordFallbackOpenCheckForTest,
			missingToolRetryToolNamesForTest,
			findMissingKnownBrowserToolTraceForTest,
			rankOpenTabCandidatesForTest,
			summarizeOpenTabsForTest,
			shouldRequireLearningWorkspaceEvidenceForTest,
			buildLearningWorkspaceEvidenceRetryPromptForTest,
			hasCompletedNonActiveWorkspaceReadForTest,
			applyLearningBackgroundFocusDefaultForTest,
			shouldPreserveTrustedWorkspaceTabIdForTest,
			tabIdListedInWorkspaceScanForTest,
			isTransientProviderErrorForTest,
			collectResearchScaffoldingTabIdsForTest,
			collectUncitedTurnMarkRemovalsForTest,
			buildHighlightTimeoutTabGuardResultForTest,
			buildUntrustedTabTargetGuardResultForTest,
			describeToolStatusForTargetTabForTest,
			setModelIntentClassificationForPromptForTest,
			clearModelIntentClassificationsForTest,
		} = __browserRuntimeTest || {};
		assert.equal(typeof buildPdfAnchorRetryPromptForTest, "function", "browser runtime PDF anchor retry prompt export is missing");
		assert.equal(typeof buildPageSourceMarkerRetryPromptForTest, "function", "browser runtime page source retry prompt export is missing");
		assert.equal(typeof buildExistingAnchorContext, "function", "browser runtime existing anchor context export is missing");
		assert.equal(typeof buildPriorExtractedPageContextForTest, "function", "browser runtime prior page context export is missing");
		assert.equal(typeof buildVisiblePdfSelectionFirstPassGuardResultForTest, "function", "browser runtime PDF selection guard export is missing");
		assert.equal(typeof buildRepeatedViewportReadGuardResultForTest, "function", "browser runtime repeated viewport read guard export is missing");
		assert.equal(typeof buildOptionalFrameFallbackNoteGuardResultForTest, "function", "browser runtime optional frame-fallback note guard export is missing");
		assert.equal(typeof getPromptContractForTest, "function", "browser runtime prompt contract export is missing");
		assert.equal(typeof buildReasoningProfileForTest, "function", "browser runtime reasoning profile export is missing");
		assert.equal(typeof formatToolResultForModel, "function", "browser runtime tool formatter export is missing");
		assert.equal(typeof getToolNamesForTest, "function", "browser runtime tool selector export is missing");
		assert.equal(typeof rankOpenTabCandidatesForTest, "function", "browser runtime tab ranking export is missing");
		assert.equal(typeof summarizeOpenTabsForTest, "function", "browser runtime compact tab summary export is missing");
		assert.equal(typeof shouldRequireLearningWorkspaceEvidenceForTest, "function", "Learning workspace evidence guard export is missing");
		assert.equal(typeof buildLearningWorkspaceEvidenceRetryPromptForTest, "function", "Learning workspace retry prompt export is missing");
		assert.equal(typeof hasCompletedNonActiveWorkspaceReadForTest, "function", "Learning workspace read detector export is missing");
		assert.equal(typeof applyLearningBackgroundFocusDefaultForTest, "function", "Learning background-focus default export is missing");
		assert.equal(typeof shouldPreserveTrustedWorkspaceTabIdForTest, "function", "trusted workspace tab target guard export is missing");
			assert.equal(typeof promptAsksForTeachingPageSourceMarkerForTest, "function", "browser runtime teaching source marker classifier export is missing");
			assert.equal(typeof promptAsksForStructuredPageSourceMarkerForTest, "function", "browser runtime structured source marker classifier export is missing");
			assert.equal(typeof promptAllowsPageSourceHighlightsForTest, "function", "browser runtime source marker availability classifier export is missing");
			assert.equal(typeof promptRequiresPageSourceMarkerForTest, "function", "browser runtime source marker requirement classifier export is missing");
			assert.equal(typeof shouldRequirePageSourceMarkerRetryForTest, "function", "browser runtime page source retry export is missing");
			assert.equal(typeof shouldRequirePdfAnchorRetryForTest, "function", "browser runtime PDF anchor retry export is missing");
			assert.equal(typeof buildEmptyHighlightTextGuardResultForTest, "function", "browser runtime empty highlight guard export is missing");
			assert.equal(typeof buildWeakStructuredHighlightTextGuardResultForTest, "function", "browser runtime weak structured highlight guard export is missing");
			assert.equal(typeof buildSurplusHighlightGuardResultForTest, "function", "browser runtime comparison surplus highlight guard export is missing");
		assert.equal(typeof buildSurplusTeachingHighlightGuardResultForTest, "function", "browser runtime surplus teaching highlight guard export is missing");
		assert.equal(typeof buildSurplusTeachingNoteGuardResultForTest, "function", "browser runtime surplus teaching note guard export is missing");
			assert.equal(typeof buildStructuredHighlightBudgetGuardResultForTest, "function", "browser runtime structured highlight budget guard export is missing");
			assert.equal(typeof buildStructuredNoteBudgetGuardResultForTest, "function", "browser runtime structured note budget guard export is missing");
			assert.equal(typeof cleanMarkdownHeadingHighlightTextForTest, "function", "browser runtime heading highlight cleaner export is missing");
			assert.equal(typeof rewriteComparisonHighlightTextForTest, "function", "browser runtime comparison highlight rewrite export is missing");
			assert.equal(typeof sanitizeAssistantVisibleReplyForTest, "function", "browser runtime visible reply sanitizer export is missing");
			assert.equal(typeof shouldRecordFallbackOpenCheckForTest, "function", "browser runtime fallback-check gate export is missing");
			assert.equal(typeof missingToolRetryToolNamesForTest, "function", "browser runtime missing-tool retry export is missing");
			assert.equal(typeof findMissingKnownBrowserToolTraceForTest, "function", "browser runtime missing-tool trace export is missing");
		assert.equal(typeof buildFinalAssistantReplyForTest, "function", "browser runtime final reply helper export is missing");
		assert.equal(typeof compactOnPageNoteTextForTest, "function", "browser runtime note compactor export is missing");

	const contract = getPromptContractForTest();
	assert.match(contract.systemPrompt, /The page is the canvas/);
	assert.match(contract.systemPrompt, /Every material page claim must be grounded/);
	assert.match(contract.systemPrompt, /Read the page before answering/);
	assert.match(contract.systemPrompt, /create one durable source highlight/);
	assert.match(contract.systemPrompt, /The user's pages come first/);
	assert.match(contract.systemPrompt, /explicitly asks to search online/);
	assert.match(contract.systemPrompt, /Preserve existing session highlights/);
	assert.match(contract.systemPrompt, /Do not add notes that merely paraphrase the highlight/);
	assert.match(contract.systemPrompt, /under ~280 characters/);
	assert.match(contract.systemPrompt, /Only successful highlight\/note tool results count as source markers/);
	assert.match(contract.systemPrompt, /Do not use the page title, course title, reading list, or a generic heading as a source marker/);
	assert.match(contract.systemPrompt, /For compare\/contrast prompts, usually create two concise source highlights, one for each side, each with a short note on its side of the difference/);
	assert.match(contract.systemPrompt, /Chat should be brief and tied to the page context/);
	assert.match(contract.systemPrompt, /A visible-text-only read is not enough to rule out offscreen page content/);
	assert.match(contract.systemPrompt, /Roadmap\/list\/navigation questions are not simple/);
	assert.match(contract.systemPrompt, /treat the prompt as an enumerable coverage task/);
	assert.match(contract.systemPrompt, /every required step, item, or top-level peer you name in chat needs its own source highlight/);
	assert.match(contract.systemPrompt, /do not narrate internal page-work plans/);
	assert.match(contract.systemPrompt, /let me ground this/);
	assert.match(contract.systemPrompt, /Do not use horizontal rules as separators/);
	assert.match(contract.systemPrompt, /Math formatting: when writing LaTeX symbols or equations/);
	assert.match(contract.systemPrompt, /Never leave raw LaTeX commands/);
	assert.match(contract.systemPrompt, /If extracted page math is fragmented or missing operators/);
	assert.match(contract.systemPrompt, /do not copy it verbatim into chat or source highlights/);
	assert.match(contract.systemPrompt, /do not add extra highlights just to increase source count/);
	const existingAnchorContext = buildExistingAnchorContext({
		pageActions: [],
		turns: [
			{
				pageActions: [
					{
						key: "highlight:onhand-1-old",
						type: "annotation",
						label: "Highlighted text",
						detail: "Multi-head attention allows the model to jointly attend to information from different representation subspaces.",
						citationText: "Multi-head attention allows the model to jointly attend to information from different representation subspaces at different positions.",
						annotationId: "onhand-1-old",
						title: "1706.03762",
						url: "https://arxiv.org/pdf/1706.03762",
						pdfAnchor: { pageNumber: 5 },
					},
					{
						key: "note:onhand-1-old",
						type: "note",
						label: "Added note",
						detail: "Multiple heads keep relationships separate.",
						citationText: "Multiple heads keep relationships separate.",
						annotationId: "onhand-1-old",
						title: "1706.03762",
						url: "https://arxiv.org/pdf/1706.03762",
						pdfAnchor: { pageNumber: 5 },
					},
				],
			},
		],
	});
	assert.match(existingAnchorContext, /Existing session source highlights already available/);
	assert.match(existingAnchorContext, /annotationId=onhand-1-old/);
	assert.match(existingAnchorContext, /p\. 5/);
	assert.match(existingAnchorContext, /Multiple heads keep relationships separate/);
	assert.match(existingAnchorContext, /Do not recreate, re-highlight, or re-note/);
	assert.match(existingAnchorContext, /browser_scroll_to_annotation/);
	assert.match(
		existingAnchorContext,
		/call browser_scroll_to_annotation with its annotationId once before answering/,
		"anchor reuse must be tool-verified in the first pass so the marker gate is satisfied without a revision pass",
	);
	assert.match(contract.systemPrompt, /call browser_scroll_to_annotation on that anchor once before answering/);
	assert.match(contract.systemPrompt, /Do not rely on a heading-only highlight/);
	assert.match(contract.systemPrompt, /do not send a heading-plus-list block as one highlight/);
	assert.match(contract.systemPrompt, /Do not replace missing list items with nearby headings/);
	assert.match(contract.systemPrompt, /use browser_pdf_find_citation to look up the bibliography entry/);
	assert.match(contract.systemPrompt, /Chrome's native PDF viewer is usually supported through selection, clipboard, or debugger fallbacks/);
	assert.match(contract.systemPrompt, /If tool output says the reader is Google Scholar PDF Reader/);
		assert.match(contract.systemPrompt, /third-party PDF reader blocks selected text/);
		assert.match(contract.systemPrompt, /Recommend Chrome's default PDF viewer or the Onhand viewer/);
		assert.match(contract.systemPrompt, /selected text is already available in a supported reader/);
		assert.match(contract.systemPrompt, /Do not treat a selected named concept/);
		assert.match(contract.systemPrompt, /complete the offered search\/read\/jump\/highlight\/note workflow before answering/);
		assert.match(contract.systemPrompt, /Never say you will highlight or add a note unless the corresponding tool call already succeeded/);
		assert.match(contract.systemPrompt, /When an answer draws on another open tab/);
	assert.match(contract.systemPrompt, /auto-use clearly related open tabs without asking first/);
	assert.match(contract.systemPrompt, /Prefer sources the user can see over your own model knowledge/);
	assert.match(contract.systemPrompt, /must be grounded in a source the user can see/);
	assert.doesNotMatch(contract.systemPrompt, /ask before reading other tabs/);
	assert.doesNotMatch(contract.systemPrompt, /Outside Learning Mode/);
	assert.doesNotMatch(contract.systemPrompt, /Do not infer cross-tab permission/);
	assert.match(contract.systemPrompt, /place a highlight on the key passage in each source tab/);
	assert.match(contract.systemPrompt, /highlight or cite each substantive claim in the source that supports it/);
	assert.match(contract.systemPrompt, /Never attribute a claim to a source it was not grounded in/);
	assert.match(contract.systemPrompt, /links\/notes\/readings\/resources listed on the current page/);
	// Drift tripwire (behavior doc §authority): every SETTLED rule that lives as
	// prompt text keeps a recognizable sentence in the runtime prompt surface.
	// When one fails, the runtime regressed or the doc changed — reconcile both
	// (docs/ONHAND_BEHAVIOR_PREFERENCES.md), never just delete the assertion.
	for (const [rule, surface, pattern] of [
		["G1 default source highlight", contract.systemPrompt, /create one durable source highlight/],
		["G5 marginalia placement", contract.systemPrompt, /short marginal notes/],
		["G6 concise chat", contract.systemPrompt, /Be concise in words, thorough in coverage/],
		["G7 honest anchoring", contract.systemPrompt, /say so rather than forcing a generic highlight/],
		["G7 general-knowledge label", contract.systemPrompt, /general knowledge rather than the user's pages/],
		["G9 per-source citation", contract.systemPrompt, /name that source \(by title\) next to the claim/],
		["G12 auto cross-tab", contract.systemPrompt, /auto-use clearly related open tabs without asking first/],
		["G13 web search never first", contract.systemPrompt, /[Ww]eb search is never the first move while open material can answer/],
		["G14 auto-open on unsupported claims", contract.systemPrompt, /open or search for one that does — in a background tab/],
		["G18 tool-verified anchor reuse", contract.systemPrompt, /call browser_scroll_to_annotation on that anchor once before answering/],
		["P4 pages first", contract.systemPrompt, /The user's pages come first/],
		["§5.1 ask-before-telling", contract.learningModeAppend, /Ask before telling/],
		["§5.3 homework final-answer gate", contract.learningModeAppend, /do not give the final numeric, symbolic, or code answer/],
	]) {
		assert.match(surface, pattern, `settled-rule drift: ${rule} lost its prompt sentence — reconcile the behavior doc and the runtime together`);
	}
	assert.match(contract.answerPrompt, /Page-material claims need page grounding/);
	assert.match(contract.answerPrompt, /Do page work before chat/);
	assert.match(contract.answerPrompt, /External-source requests are navigation tasks/);
	assert.match(contract.answerPrompt, /Linked-note\/resource requests are navigation tasks/);
	assert.match(contract.answerPrompt, /Grounding budget: simple questions get one strong source highlight/);
	assert.match(contract.answerPrompt, /Do not use the page title, course title, reading list, or a generic heading as a source marker/);
	assert.match(contract.answerPrompt, /do not paraphrase the highlight/);
	assert.match(contract.answerPrompt, /Failed highlight attempts are not source markers/);
	assert.match(contract.answerPrompt, /Source-thorough path: if the question has distinct subclaims/);
	assert.match(contract.answerPrompt, /For compare\/contrast prompts, usually create two concise source highlights/);
	assert.match(contract.answerPrompt, /Roadmap\/list\/navigation answers need the actual supporting list/);
	assert.match(contract.answerPrompt, /Each named step\/item in chat needs its own source highlight/);
	assert.match(contract.answerPrompt, /literally contains every named item/);
	assert.match(contract.systemPrompt, /where does this page explain/);
	assert.match(contract.systemPrompt, /not a math-only formula as the first or only source marker/);
	assert.match(contract.answerPrompt, /Do not use the word 'anchor' in user-facing replies/);
	assert.match(contract.answerPrompt, /let me ground this/);
	assert.match(contract.answerPrompt, /Do not use horizontal rules like --- as section separators/);
			assert.match(contract.answerPrompt, /Use a small Markdown table only when the user asks for one or a genuine multi-dimension comparison/);
			assert.match(
				contract.systemPrompt,
				/Once a parent\/top-level item is marked, move to the next sibling item/,
				"roadmap prompts should explicitly avoid marking child subtopics after a parent item",
			);
	assert.match(contract.answerPrompt, /Math must be renderable markdown/);
	assert.match(contract.answerPrompt, /Do not write bare LaTeX commands/);
	assert.match(contract.answerPrompt, /If extracted page math is fragmented or missing operators/);
	assert.match(contract.answerPrompt, /do not copy it verbatim into chat or source highlights/);
	assert.match(contract.answerPrompt, /explicitly asks to highlight a formula\/equation/);
	assert.match(contract.answerPrompt, /explicit named formula\/equation\/theorem requests/);
	assert.match(contract.answerPrompt, /do not substitute a nearby unrelated formula/);
	assert.match(contract.answerPrompt, /block formula highlight/);
	assert.match(contract.answerPrompt, /highlight the exact item words one item at a time/);
	const runtimeSourceForHighlightPolicy = [
		await (await import("node:fs/promises")).readFile(new URL("../packages/browser-extension/src/browser-runtime.ts", import.meta.url), "utf8"),
		// Policy wording shared by multiple prompt surfaces lives in the
		// mark-policy fragment module; source-level policy pins must see both.
		await (await import("node:fs/promises")).readFile(new URL("../packages/browser-extension/src/agent/mark-policy.ts", import.meta.url), "utf8"),
	].join("\n");
	assert.match(
		runtimeSourceForHighlightPolicy,
		/reuseExisting:\s*targetedParams\?\.reuseExisting !== false/,
		"source-marker highlight commands should reuse existing page highlights by default",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/shouldTryHighlightRetryCandidatesBeforeOriginal/,
		"highlight commands should try short exact candidates before brittle long spans",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/HIGHLIGHT_COMMAND_TIMEOUT_MS\s*=\s*6000/,
		"highlight commands should have a bounded timeout",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/HIGHLIGHT_TOOL_CALL_TIMEOUT_MS\s*=\s*12000/,
		"highlight candidate retries should also have an overall per-call timeout",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/if \(\["show_note", "scroll_to_annotation", "clear_annotations"\]\.includes\(commandName\)\) return ANNOTATION_COMMAND_TIMEOUT_MS;/,
		"note and annotation follow-up commands should have bounded timeouts too",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/if \(commandName === "activate_tab"\) return targeted;[\s\S]{0,120}delete targeted\.titleContains;[\s\S]{0,80}delete targeted\.urlContains;/,
		"activate_tab should preserve titleContains/urlContains selectors instead of dropping them like read-only page tools",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/\[tabId \$\{tab\.id\}\]/,
		"the workspace metadata scan should print each candidate's tabId so the model can read background tabs directly",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/inspect clearly related open tabs before answering/,
		"cross-tab retrieval should be standard in every mode",
	);
	const privacyCopySurfaces = [
		["website/privacy.html", await (await import("node:fs/promises")).readFile(new URL("../website/privacy.html", import.meta.url), "utf8")],
		["docs/STORE_LISTING.md", await (await import("node:fs/promises")).readFile(new URL("../docs/STORE_LISTING.md", import.meta.url), "utf8")],
	];
	for (const [label, copy] of privacyCopySurfaces) {
		assert.doesNotMatch(
			copy,
			/In Learning mode,? (?:it|this|Onhand) may (?:rank|include|read)/,
			`${label} must not scope cross-tab reading to Learning mode while the runtime reads clearly related tabs in every mode`,
		);
	}
	assert.match(
		runtimeSourceForHighlightPolicy,
		/tabIdListedInWorkspaceScan\(activeRequest, normalizedParams\?\.tabId\)/,
		"explicit tabIds listed in the captured workspace scan should be honored without a prior tab inventory",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/transientProviderRetry = true;[\s\S]{0,500}queueBlankReplyRetry/,
		"transient provider failures should retry once before the raw error becomes the visible reply",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/collectResearchScaffoldingTabIds\(activeRequest\)[\s\S]{0,400}close_scaffolding_tabs/,
		"successful turns should close unused research scaffolding tabs (behavior doc G19)",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/reuseExisting: targetedParams\?\.reuseExisting !== false,[\s\S]{0,400}scrollIntoView: true,/,
		"model-issued source highlights must always scroll into view — the moving page is the user's live progress signal",
	);
	assert.doesNotMatch(
		runtimeSourceForHighlightPolicy,
		/highlightParams\.scrollIntoView = targetedParams|scrollIntoView: targetedParams\?\.scrollIntoView/,
		"turn highlights and notes must not honor model-provided scrollIntoView:false",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/highlightTextWithReplayCandidates\(tabId, text, \{\s*scrollIntoView: false/,
		"session-restore replays must stay still instead of yanking the page on load",
	);
	assert.doesNotMatch(
		runtimeSourceForHighlightPolicy,
		/STRUCTURED_SOURCE_HIGHLIGHT_MAX/,
		"enumerable structured page answers should not stop after a fixed number of successful markers",
	);
	assert.doesNotMatch(
		runtimeSourceForHighlightPolicy,
		/\b(?:mcmc|monte\s+carlo|metropolis|hamiltonian|stochastic\s+gradient)\b/i,
		"production runtime behavior heuristics should not be hardcoded to the BayesianDL lecture",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/buildStructuredHighlightBudgetGuardResult\(toolName,\s*commandName,\s*prompt,\s*activeRequest\)/,
		"structured page prompts should stop runaway highlight loops after repeated failures",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/buildSurplusHighlightGuardResult\(toolName,\s*commandName,\s*prompt,\s*activeRequest\)/,
		"compare prompts should stop surplus highlight calls once enough source markers exist",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/one for each side, each with a short note on its side of the difference/,
		"comparison prompts get a support highlight and note per side (v3.0 marks-carry-the-depth)",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/isCompletedSourceHighlightTrace/,
		"runtime source counts should ignore surplus-highlight guardrails as source highlights",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/buildConceptLocationHighlightGuardResult\(toolName,\s*commandName,\s*effectiveParams,\s*prompt,\s*activeRequest\)/,
		"concept location prompts should reject math-only first highlights in favor of explanatory page text",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/buildNamedFormulaHighlightGuardResult\(toolName,\s*commandName,\s*effectiveParams,\s*prompt,\s*activeRequest\)/,
		"explicit Bayes formula highlight prompts should reject unrelated nearby formula highlights",
	);
	assert.doesNotMatch(
		runtimeSourceForHighlightPolicy,
		/if \(!\(\/rejection sampling\/\.test\(sourceText\) && \/metropolis\[-\\s\]\?hastings\/\.test\(sourceText\)\)\) return null;/,
		"comparison highlight gating should not be hardcoded to one BayesianDL prompt",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/extractComparisonEntities\(prompt\)/,
		"comparison highlight gating should infer compared entities from the prompt",
	);
	assert.match(
		runtimeSourceForHighlightPolicy,
		/case "browser_highlight_text": \{\s*if \(details\.guardrail\) return null;/,
		"surplus highlight guardrails should not create fake page highlight actions",
	);
	const repeatedViewportGuard = buildRepeatedViewportReadGuardResultForTest("browser_get_scroll_state", "get_scroll_state", {
		toolTraces: [
			{ toolName: "browser_get_visible_text", state: "complete", resultSummary: "Visible text from BayesianDL" },
			{ toolName: "browser_get_visible_text", state: "complete", resultSummary: "Visible text from BayesianDL" },
			{ toolName: "browser_get_scroll_state", state: "complete", resultSummary: "Scroll state: progress=4%" },
			{ toolName: "browser_get_visible_text", state: "complete", resultSummary: "Visible text from BayesianDL" },
			{ toolName: "browser_get_viewport_headings", state: "complete", resultSummary: "Current heading: Bayesian Deep Learning" },
			{ toolName: "browser_get_visible_text", state: "complete", resultSummary: "Visible text from BayesianDL" },
		],
	});
	assert.equal(repeatedViewportGuard?.guardrail?.kind, "repeated_viewport_read_loop", "repeated viewport probes should be guardrailed before a minute-long loop");
	assert.match(repeatedViewportGuard?.guardrail?.message || "", /browser_extract_content once/, "read-loop guard should steer to a focused extract or final answer");
	const shortViewportProbe = buildRepeatedViewportReadGuardResultForTest("browser_get_visible_text", "get_visible_text", {
		toolTraces: [
			{ toolName: "browser_get_visible_text", state: "complete", resultSummary: "Visible text from BayesianDL" },
			{ toolName: "browser_get_scroll_state", state: "complete", resultSummary: "Scroll state: progress=4%" },
		],
	});
	assert.equal(shortViewportProbe, null, "short ordinary read probes should not be blocked");
	const optionalFrameFallbackNoteGuard = buildOptionalFrameFallbackNoteGuardResultForTest(
		"browser_show_note",
		"show_note",
		{ annotationId: "ann-frame" },
		"Teach me what this article says.",
		{
			toolTraces: [
				{
					toolName: "browser_highlight_text",
					state: "complete",
					resultSummary: "Highlighted \"Core claim\" on Example. annotationId: ann-frame.",
					resultDetails: {
						annotation: {
							annotationId: "ann-frame",
							pageToolkitFrameFallback: { attempted: true, ok: true, method: "debugger-frame" },
						},
					},
				},
			],
		},
	);
	assert.equal(optionalFrameFallbackNoteGuard, null, "frame-fallback highlights should still allow notes");
	assert.equal(
		buildOptionalFrameFallbackNoteGuardResultForTest(
			"browser_show_note",
			"show_note",
			{ annotationId: "ann-frame" },
			"Teach me what this article says and add a note.",
			optionalFrameFallbackNoteGuard,
		),
		null,
		"explicit note requests should not be blocked by the frame-fallback note path",
	);
	const comparisonHighlightRewriteRequest = {
		displayPrompt: "Compare rejection sampling and Metropolis-Hastings",
		toolTraces: [
			{
				toolName: "browser_extract_content",
				state: "complete",
				resultDetails: {
					content: {
						blocks: [
							{ text: "Rejection sampling is very difficulty in high-dimensional domains (e.g., images) because of the large value of MMM." },
							{ text: "Metropolis-Hastings sampling will merge rejection sampling with the Markov chain sampling of Algorithm 1 and get rid of the problematic constant MMM." },
						],
					},
				},
			},
			{
				toolName: "browser_get_visible_text",
				state: "complete",
				resultDetails: {
					visible: {
						blocks: [
							{ text: "The trick is finding a proposal Markov chain distribution that keeps the rejection probability low." },
							{ text: "M′ can be very large for large datasets (N≫1), forcing us to reject most samples." },
						],
					},
				},
			},
		],
	};
	assert.equal(
		rewriteComparisonHighlightTextForTest(
			"Rejection sampling is very difficulty in high-dimensional domains (e.g., images) because of the large value of M.",
			"Compare rejection sampling and Metropolis-Hastings",
			comparisonHighlightRewriteRequest,
		),
		"",
		"comparison source highlights should keep clean prose when readable page text only adds duplicated rendered-math noise",
	);
	assert.equal(
		rewriteComparisonHighlightTextForTest(
			"Metropolis-Hastings sampling will merge rejection sampling with the Markov chain sampling of Algorithm 1 and get rid of the problematic constant M.",
			"Compare rejection sampling and Metropolis-Hastings",
			comparisonHighlightRewriteRequest,
		),
		"",
		"comparison source highlights should not rewrite MH constants into duplicated rendered-math text",
	);
	const genericFormulaRewriteRequest = {
		displayPrompt: "Teach me what this article says about the method.",
		toolTraces: [
			{
				toolName: "browser_extract_content",
				state: "complete",
				resultDetails: {
					content: {
						blocks: [
							{
								text:
									"- Core claim: The method estimates the target quantity from observed data: theta_hat = sum_i x_i / n. Each estimate is one sample from the procedure.",
							},
						],
					},
				},
			},
		],
	};
	assert.equal(
		rewriteComparisonHighlightTextForTest(
			"The method estimates the target quantity from observed data",
			"Teach me what this article says about the method.",
			genericFormulaRewriteRequest,
		),
		"The method estimates the target quantity from observed data:",
		"exact highlight rewriting should prefer clean explanatory prose before formula noise on any page",
	);
	assert.equal(
		rewriteComparisonHighlightTextForTest(
			"The method estimates the target quantity from observed data: theta_hat = sum_i x_i / n. Each estimate is one sample from the procedure.",
			"Teach me what this article says about the method.",
			{
				displayPrompt: "Teach me what this article says about the method.",
				toolTraces: [
					{
						toolName: "browser_extract_content",
						state: "complete",
						resultSummary:
							"Readable content from Example:\n- Core claim: The method estimates the target quantity from observed data: theta_hat = sum_i x_i / n. Each estimate is one sample from the procedure.",
					},
				],
			},
		),
		"The method estimates the target quantity from observed data:",
		"exact highlight rewriting should use model-facing extract summaries when detailed blocks omit the useful passage",
	);
	const pagePromptEvalSource = await (await import("node:fs/promises")).readFile(new URL("../scripts/run-page-prompt-eval.mjs", import.meta.url), "utf8");
	assert.match(
		pagePromptEvalSource,
		/isRealCompletedHighlightTrace/,
		"page prompt evals should distinguish real completed highlights from guardrail tool messages",
	);
	assert.match(
		pagePromptEvalSource,
		/action\?\.label === "Highlighted text"/,
		"page prompt evals should count highlighted text actions but not scroll-to-annotation actions as highlights",
	);
	assert.match(
		pagePromptEvalSource,
		/do not call browser_highlight_text again/,
		"page prompt evals should ignore surplus-highlight guardrail summaries when counting highlights",
	);
	assert.match(
		pagePromptEvalSource,
		/forbidMarkdownTables:\s*true/,
		"page prompt evals should fail page-teaching replies that render Markdown tables",
	);
	assert.match(
		pagePromptEvalSource,
		/forbidInlineMarkdownHeadings:\s*true/,
		"page prompt evals should fail glued inline Markdown headings in sidebar replies",
	);
	assert.match(
		pagePromptEvalSource,
		/maxHighlightErrors:\s*0/,
		"page prompt evals should treat failed surplus source-marker attempts as regressions",
	);
	assert.match(
		pagePromptEvalSource,
		/recoveredCount[\s\S]*Math\.max\(0,\s*errorCount - recoveredCount\)/,
		"page prompt evals should not fail turns for highlight attempts that were explicitly recovered",
	);
	assert.match(
		pagePromptEvalSource,
		/shouldRetryBlankPageAnswer[\s\S]*model returned an empty answer after reading page context[\s\S]*attempt < 2/s,
		"page prompt evals should retry the specific empty-after-read provider failure once",
	);
	const sessionDumpSource = await (await import("node:fs/promises")).readFile(new URL("../scripts/dump-onhand-sessions.mjs", import.meta.url), "utf8");
	assert.match(
		sessionDumpSource,
		/url\.includes\("\/sidepanel\.html"\) && \/\[\?&\]driver=1\\b\/\.test\(url\)/,
		"debug:sessions should prefer dedicated driver side-panel targets",
	);
	assert.match(
		sessionDumpSource,
		/turn && !turn\.pending && state\.activeRequestId !== requestId/,
		"debug:sessions wait should not return a completed replay turn while the same request is still active",
	);
	assert.doesNotMatch(
		sessionDumpSource,
		/turn && !turn\.pending && !state\.activeRequestId/,
		"debug:sessions wait should allow another active request once the requested replay turn is complete",
	);
	assert.match(
		sessionDumpSource,
		/latestReplay[\s\S]*findTurnByRequestId\(latestReplay,\s*requestId\)/,
		"debug:sessions wait should refetch replay before returning the completed requested turn",
	);
	assert.match(
		sessionDumpSource,
		/if \(target\.type === "page" && url\.includes\("\/sidepanel\.html"\)\) return Number\.POSITIVE_INFINITY;/,
		"debug:sessions should not attach to a user's visible side panel, which can be stale after rebuilds",
	);
	assert.match(contract.answerPrompt, /Do not substitute nearby headings for missing list items/);
	assert.match(contract.answerPrompt, /A visible-text-only read is not enough to rule out offscreen page content/);
	assert.match(contract.answerPrompt, /Do not call browser_extract_content more than once/);
	assert.doesNotMatch(contract.answerPrompt, /browser_textbook_search/);
	assert.doesNotMatch(contract.answerPrompt, /selected\/highlighted PDF questions/);
	assert.doesNotMatch(contract.answerPrompt, /browser_get_visible_region_image/);
	assert.doesNotMatch(contract.answerPrompt, /\.value for form controls and \.textContent/);
	assert.match(contract.textbookPrompt, /browser_textbook_search/);
	assert.match(contract.textbookPrompt, /reader's own .*search UI/);
	assert.match(contract.textbookPrompt, /Do not manually click\/type through the reader search UI/);
	assert.match(contract.textbookPrompt, /openedResult\.navigated=true/);
	assert.match(contract.textbookPrompt, /immediately use browser_extract_content once/);
	assert.match(contract.textbookPrompt, /Do not switch tabs, close search panels, call generic click\/find\/wait tools, or repeat book search/);
	assert.match(contract.textbookPrompt, /Use browser_navigate only to reload the current reader URL once/);
	assert.match(contract.textbookPrompt, /prefer one contiguous highlight spanning the key supporting sentences and one note/);
	assert.match(contract.pdfPrompt, /selected\/highlighted PDF questions/);
	assert.match(contract.pdfPrompt, /Chrome's native PDF viewer usually exposes selection through browser_get_selection/);
	assert.match(contract.pdfPrompt, /If tool output names Google Scholar PDF Reader/);
	assert.match(contract.pdfPrompt, /third-party PDF reader blocks selected text/);
	assert.match(contract.pdfPrompt, /ask the user to highlight the passage there only if selected text did not transfer/);
	assert.match(contract.pdfPrompt, /Recommend Chrome's default PDF viewer or the Onhand viewer/);
	assert.match(contract.pdfPrompt, /Open the Onhand PDF viewer when analysis/);
	assert.match(contract.pdfPrompt, /Do not treat selected named concepts/);
	assert.match(contract.pdfPrompt, /finish the search\/read\/jump\/highlight\/note workflow before answering/);
	assert.match(contract.pdfPrompt, /Never say you will highlight or add a note unless (?:that|the corresponding) tool call already succeeded/);
	assert.match(contract.visualPrompt, /browser_get_visible_region_image/);
	assert.match(contract.visualPrompt, /Visual claims must name the captured region/);
	assert.match(contract.runtimeJsPrompt, /\.value for form controls and \.textContent/);
	assert.doesNotMatch(contract.answerPrompt, /answer now without calling a browser tool/i);
	assert.doesNotMatch(contract.answerPrompt, /Current Learning Mode state/);
	assert.match(contract.learningModeAppend, /Ask before telling: for conceptual questions, lead with one short guiding question/);
	assert.doesNotMatch(
		contract.learningModeAppend,
		/give a concise page-grounded answer first/,
		"Learning Mode stance is ask-before-telling (behavior doc §5.1); answer-first was a runtime regression",
	);
	assert.match(contract.systemPrompt, /[Ww]eb search is never the first move while open material can answer/);
	assert.match(contract.systemPrompt, /a claim check that the current page plus clearly related open tabs already support needs no fetching at all/);
	assert.match(contract.systemPrompt, /Cite every mark you place this turn/);
	assert.match(contract.systemPrompt, /never click through or try to bypass it/);
	assert.match(
		contract.systemPrompt,
		/open or search for one that does — in a background tab/,
		"G14: when open material cannot support a needed claim, Onhand auto-fetches a better source instead of only offering",
	);
	assert.match(contract.learningModeAppend, /Do not stack multiple questions before teaching anything/);
	assert.match(contract.learningModeAppend, /Stay fast: the first move should be a useful source highlight/);
	assert.match(contract.learningModeAppend, /onhand_record_learning_event/);
	assert.match(contract.learningModeAppend, /one reviewable learning unit/);
	assert.match(contract.learningModeAppend, /reuse that conceptId/);
	assert.match(contract.learningModeAppend, /prefer a lightweight refresher/);
	assert.match(contract.learningModeAppend, /add at most one replacement highlight and no note/);
	assert.match(contract.learningModeAppend, /do not open or record a second check/);
	assert.match(contract.learningModeAppend, /Do not add fresh annotations for this meta\/follow-up turn/);
	assert.match(contract.learningModeAppend, /Cross-tab retrieval works the same here as in every mode/);
	assert.match(contract.learningModeAppend, /relevance-ranked from metadata for every eligible tab/);
	assert.match(contract.learningModeAppend, /no special wording required/);
	assert.match(contract.learningModeAppend, /Start with the strongest one to three candidates/);
	assert.match(contract.learningModeAppend, /browser_navigate with newTab true and active false/);
	assert.match(contract.learningModeAppend, /browser_open_pdf_in_onhand_viewer with that tabId and active false/);
	assert.match(contract.learningModeAppend, /Do not activate or switch tabs merely to read, search, highlight, note, or hand off a source PDF/);
	assert.match(contract.learningModeAppend, /Record a related tab as a learning source only after you actually inspect or highlight it/);
	assert.match(contract.learningModeAppend, /Homework\/problem priority/);
	assert.match(contract.learningModeAppend, /final numeric, symbolic, or code answer/);
	assert.match(contract.learningModeAppend, /even if the user asks directly/);
	assert.match(contract.learningModeAppend, /ask for the next step the learner should do/);
	assert.match(contract.learningModeAppend, /Skip the guiding-question beat only for trivial factual lookups/);
	assert.doesNotMatch(
		contract.learningModeAppend,
		/Drop the Socratic stance only for non-homework conceptual questions/,
		"the answer-first-era escape hatch must not undercut ask-before-telling for conceptual questions",
	);
	assert.match(contract.learningModeAppend, /homework\/problem priority still wins/);
	assert.ok(
		contract.learningModeAppend.indexOf("Homework/problem priority") < contract.learningModeAppend.indexOf("Skip the guiding-question beat only"),
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
	assert.match(contract.learningPrompt, /Proposal sampling \(concept_proposal_sampling\)/);
	assert.match(contract.learningPrompt, /check-proposal-1/);
	assert.match(contract.learningPrompt, /Likely repeated concepts in the user's latest message/);
	assert.match(contract.learningPrompt, /keep the turn lightweight/);
	assert.match(contract.learningPrompt, /use the existing source highlight when possible/);
	assert.match(contract.learningPrompt, /avoid re-running the full teaching flow/);
	assert.match(contract.learningPrompt, /Page-work budget for repeated concepts/);
	assert.match(contract.learningPrompt, /at most one fallback read and at most one replacement highlight/);
	assert.match(contract.learningPrompt, /do not call onhand_record_learning_event with check_opened/);
	assert.match(contract.learningPrompt, /If there is no open check for the concept/);
	assert.match(contract.learningPrompt, /reuse the existing conceptId/);
	assert.match(contract.learningPrompt, /resolve that check with onhand_record_learning_event/);
	assert.match(contract.learningPrompt, /reasonable paraphrase/);
	assert.match(contract.learningPrompt, /Concept hygiene/);
	assert.match(contract.learningPrompt, /Cross-tab retrieval works the same here as in every mode/);
	assert.match(contract.learningPrompt, /do not start with process narration like "let me ground this"/);
	assert.match(contract.newConceptLearningPrompt, /Current Learning Mode state for this session/);
		assert.doesNotMatch(contract.newConceptLearningPrompt, /Likely repeated concepts in the user's latest message/);
		const answerToolNames = getToolNamesForTest("How does rejection sampling work?", false);
		const teachingPageToolNames = getToolNamesForTest("Teach me what this page says about Bayesian neural networks", false);
		const compareOnPageToolNames = getToolNamesForTest("Compare rejection sampling and Metropolis-Hastings on this page.", false);
		const differenceLectureToolNames = getToolNamesForTest("What are the differences between rejection sampling and Metropolis-Hastings in this lecture?", false);
		const roadmapLectureToolNames = getToolNamesForTest("Give me a roadmap of the sampling methods in this lecture.", false);
		const hmcStepsToolNames = getToolNamesForTest("What are the main steps in the HMC algorithm on this page?", false);
		const derivationToolNames = getToolNamesForTest("How does this page derive Bayes theorem?", false);
		const quizPageToolNames = getToolNamesForTest("Quiz me on this page.", false);
		const limitationsPageToolNames = getToolNamesForTest("What are the limitations of rejection sampling according to the page?", false);
		const learningToolNames = getToolNamesForTest("How does rejection sampling work?", true);
		const busyWindowTabs = Array.from({ length: 55 }, (_, index) => ({
			id: index + 1,
			windowId: 7,
			index,
			active: index === 0,
			windowFocused: true,
			discarded: index === 50,
			title:
				index === 0
					? "Assignment 1: Sarcasm Detection"
					: index === 50
						? "CS577: Natural Language Processing - Fall 2025"
						: `Unrelated tab ${index}`,
			url:
				index === 0
					? "https://asaparov.org/assets/cs577_fall2025/hw1.pdf"
					: index === 50
						? "https://asaparov.org/cs577_fall2025/"
						: `https://example${index}.test/page`,
		}));
		const secondWindowCourseTab = {
			id: 99,
			windowId: 8,
			index: 0,
			active: true,
			windowFocused: false,
			discarded: false,
			title: "CS577 supplementary notes",
			url: "https://asaparov.org/assets/cs577_fall2025/supplement.html",
		};
		const busyWindowState = {
			windows: [
				{ id: 7, focused: true, tabs: busyWindowTabs },
				{ id: 8, focused: false, tabs: [secondWindowCourseTab] },
			],
		};
		const rankedBusyTabs = rankOpenTabCandidatesForTest(
			busyWindowState,
			busyWindowTabs[0],
			"Help me solve this using the relevant class material",
		);
		const compactBusyTabs = summarizeOpenTabsForTest(
			busyWindowState,
			busyWindowTabs[0],
			"Help me solve this using the relevant class material",
		);
		assert.equal(rankedBusyTabs.length, 56, "tab ranking should census every eligible tab across open browser windows");
		assert.equal(rankedBusyTabs[0].id, 1, "the active tab should stay first");
		assert.deepEqual(
			new Set(rankedBusyTabs.slice(1, 3).map((tab) => tab.id)),
			new Set([51, 99]),
			"related course tabs across windows should outrank unrelated earlier tabs",
		);
		assert.equal(compactBusyTabs.totalCount, 56, "compact tab context should report the uncapped cross-window census size");
		assert.equal(compactBusyTabs.shownTabs.some((tab) => tab.id === 51), true, "the compact context should include a relevant tab beyond position eight");
		assert.equal(compactBusyTabs.shownTabs.some((tab) => tab.id === 99), true, "the compact context should include a related tab from another window");
		assert.equal(compactBusyTabs.omittedCount, 40, "compact context should disclose how many ranked metadata rows were omitted");
		const completeTabInventoryText = formatToolResultForModel("browser_list_tabs", { tabs: busyWindowTabs });
		assert.match(completeTabInventoryText, /Unrelated tab 54/, "browser_list_tabs should return the complete inventory beyond the old 40-tab cap");
	const scannedPdfSearchText = formatToolResultForModel("browser_pdf_search", {
		query: "resonance",
		matchCount: 0,
		matches: [],
		textLayer: { extractableChars: 0, checkedPages: 8, likelyScanned: true },
	});
	assert.match(scannedPdfSearchText, /scanned image without an extractable text layer/, "zero-match searches on scans must diagnose the missing text layer, not imply the terms are absent");
	assert.match(scannedPdfSearchText, /regionRect/, "the scan diagnosis should teach the region-mark fallback");
	assert.match(scannedPdfSearchText, /browser_pdf_capture_page_image/, "the scan diagnosis should point at visual grounding");
	assert.match(
		formatToolResultForModel("browser_navigate", {
			tab: { id: 9, title: "spiff.cis.rit.edu", url: "http://spiff.cis.rit.edu/paper.pdf" },
			blocked: { kind: "insecure-site-warning", detail: "The browser is showing a not-secure warning because this site uses plain HTTP. Only the user can click Continue to site; do not retry and do not try to bypass it. Name this blocked source in the answer and use an alternative." },
		}),
		/Destination blocked: .*not-secure warning/,
		"blocked navigations must tell the model why the destination is unreachable",
	);
	assert.doesNotMatch(
		formatToolResultForModel("browser_pdf_search", { query: "resonance", matchCount: 0, matches: [] }),
		/scanned image/,
		"ordinary zero-match searches keep the plain miss message",
	);
		const learningProblemRequest = {
			learningMode: true,
			displayPrompt: "Help me reason through Question 3.",
			attachments: [],
			initialActiveTab: busyWindowTabs[0],
			initialActiveUrl: busyWindowTabs[0].url,
			initialBrowserContextText: "Assignment 1: Sarcasm Detection\nDiscussion Questions\nSubmission Instructions\nGradescope",
			openTabSummary: compactBusyTabs,
			toolTraces: [],
		};
		assert.equal(
			shouldRequireLearningWorkspaceEvidenceForTest(learningProblemRequest),
			true,
			"Learning homework answers should not finalize from a problem-only page while plausible course tabs remain unread",
		);
		const deicticProblemPrompt = "could you help me solve this?";
		setModelIntentClassificationForPromptForTest(deicticProblemPrompt, {
			pageScoped: true,
			teaching: false,
			enumerableCoverage: false,
			comparison: false,
			crossTabComparison: false,
			documentReviewMarkup: false,
			problemSolvingHelp: true,
		});
		assert.equal(
			shouldRequireLearningWorkspaceEvidenceForTest({ ...learningProblemRequest, displayPrompt: deicticProblemPrompt }),
			true,
			"model-classified deictic help on a homework page should require workspace evidence without magic wording",
		);
		clearModelIntentClassificationsForTest();
		for (const commandName of [
			"search_linked_pdf_corpus",
			"find_elements",
			"get_visible_text",
			"extract_content",
			"open_pdf_in_onhand_viewer",
			"highlight_text",
			"show_note",
			"scroll_to_annotation",
			"clear_annotations",
		]) {
			assert.equal(
				shouldPreserveTrustedWorkspaceTabIdForTest(
					commandName,
					51,
					{ ...learningProblemRequest, learningResearchPlan: { candidateTabIds: [51] } },
				),
				true,
				`a planner-grounded ${commandName} tab should survive before browser_list_tabs completes`,
			);
		}
		assert.equal(
			shouldPreserveTrustedWorkspaceTabIdForTest(
				"search_linked_pdf_corpus",
				52,
				{ ...learningProblemRequest, learningResearchPlan: { candidateTabIds: [51] } },
			),
			false,
			"an unplanned pre-inventory tab id should retain the normal target safety fallback",
		);
		assert.equal(
			shouldPreserveTrustedWorkspaceTabIdForTest(
				"navigate",
				51,
				{ ...learningProblemRequest, learningResearchPlan: { candidateTabIds: [51] } },
			),
			false,
			"the planner exception should not authorize focus-changing navigation",
		);
		assert.equal(
			shouldPreserveTrustedWorkspaceTabIdForTest(
				"open_pdf_in_onhand_viewer",
				52,
				{
					...learningProblemRequest,
					learningResearchPlan: { candidateTabIds: [51] },
					toolTraces: [{ state: "complete", toolName: "browser_navigate", resultDetails: { tab: { id: 52, url: "https://course.test/new-source.pdf" } } }],
				},
			),
			true,
			"a source PDF tab opened by the current request should survive before browser_list_tabs completes",
		);
		for (const commandName of ["pdf_search", "pdf_read_pages", "highlight_text"]) {
			assert.equal(
				shouldPreserveTrustedWorkspaceTabIdForTest(
					commandName,
					53,
					{
						...learningProblemRequest,
						toolTraces: [{ state: "complete", toolName: "browser_open_pdf_in_onhand_viewer", resultDetails: { tab: { id: 53, url: "chrome-extension://onhand/pdf-viewer.html" } } }],
					},
				),
				true,
				`a background viewer returned by the current request should remain targetable by ${commandName}`,
			);
		}
		assert.equal(
			shouldPreserveTrustedWorkspaceTabIdForTest(
				"navigate",
				53,
				{
					...learningProblemRequest,
					toolTraces: [{ state: "complete", toolName: "browser_open_pdf_in_onhand_viewer", resultDetails: { tab: { id: 53 } } }],
				},
			),
			false,
			"a current-turn viewer should not authorize navigation against that tab",
		);
		for (const commandName of ["click_text", "run_js", "get_visible_text"]) {
			assert.equal(
				shouldPreserveTrustedWorkspaceTabIdForTest(
					commandName,
					54,
					{
						...learningProblemRequest,
						toolTraces: [{ state: "complete", toolName: "browser_navigate", resultDetails: { tab: { id: 54, url: "https://www.google.com/search?q=tacoma" } } }],
					},
				),
				true,
				`a tab opened by this turn's navigate should remain targetable by ${commandName} (search-results click flow)`,
			);
		}
		assert.equal(
			shouldPreserveTrustedWorkspaceTabIdForTest(
				"click_text",
				55,
				{
					...learningProblemRequest,
					toolTraces: [{ state: "complete", toolName: "browser_navigate", resultDetails: { tab: { id: 54 } } }],
				},
			),
			false,
			"a tabId the request never opened stays untrusted for click_text",
		);
		assert.equal(
			shouldPreserveTrustedWorkspaceTabIdForTest(
				"activate_tab",
				54,
				{
					...learningProblemRequest,
					toolTraces: [{ state: "complete", toolName: "browser_navigate", resultDetails: { tab: { id: 54 } } }],
				},
			),
			false,
			"request-opened tabs still do not authorize focus changes without an inventory",
		);
		const scanTrustRequest = {
			openTabSummary: {
				totalCount: 3,
				shownTabs: [{ id: 71, title: "Tacoma Narrows Bridge (1940)", url: "https://en.wikipedia.org/wiki/Tacoma_Narrows_Bridge_(1940)" }],
				omittedCount: 0,
			},
		};
		assert.equal(
			tabIdListedInWorkspaceScanForTest(scanTrustRequest, 71),
			true,
			"a tabId printed in the captured workspace scan is grounded and honored without a prior browser_list_tabs inventory",
		);
		assert.equal(
			tabIdListedInWorkspaceScanForTest(scanTrustRequest, 72),
			false,
			"a tabId missing from the workspace scan stays untrusted before browser_list_tabs",
		);
		assert.equal(tabIdListedInWorkspaceScanForTest({}, 71), false, "a request without a workspace scan trusts no direct tabIds");
		const untrustedParams = { text: "aeroelastic flutter", __onhandUntrustedTabId: 99 };
		const untrustedGuard = buildUntrustedTabTargetGuardResultForTest("browser_get_visible_text", "get_visible_text", untrustedParams);
		assert.match(
			untrustedGuard?.guardrail?.message || "",
			/tabId 99/,
			"an untrusted tabId must fail loud instead of silently reading the active tab as if it were the requested one",
		);
		assert.match(untrustedGuard?.guardrail?.message || "", /browser_list_tabs/, "the untrusted-tab error must name the recovery path");
		assert.equal(untrustedGuard?.guardrail?.kind, "untrusted_tab_target");
		assert.equal("__onhandUntrustedTabId" in untrustedParams, false, "the sentinel must not leak into executed command params");
		assert.equal(
			buildUntrustedTabTargetGuardResultForTest("browser_get_visible_text", "get_visible_text", { text: "aeroelastic flutter" }),
			null,
			"grounded params pass through the untrusted-tab guard",
		);
		assert.equal(
			isTransientProviderErrorForTest(new Error("Codex error: Our servers are currently overloaded. Please try again later.")),
			true,
			"provider overload must earn a quiet retry instead of surfacing as the reply",
		);
		assert.equal(isTransientProviderErrorForTest(new Error("429 Too Many Requests")), true);
		assert.equal(isTransientProviderErrorForTest(new Error("Invalid API key provided")), false, "permanent auth failures must surface immediately");
		assert.equal(isTransientProviderErrorForTest(new Error("Model context length exceeded")), false);
		assert.equal(isTransientProviderErrorForTest(null), false);
		const scaffoldingRequest = {
			initialActiveTab: { id: 10 },
			toolTraces: [
				{ toolName: "browser_navigate", state: "complete", resultDetails: { tab: { id: 31 }, navigation: { createdNewTab: true } } },
				{ toolName: "browser_navigate", state: "complete", resultDetails: { tab: { id: 32 }, navigation: { createdNewTab: true } } },
				{ toolName: "browser_navigate", state: "complete", resultDetails: { tab: { id: 33 }, navigation: { createdNewTab: false } } },
				{ toolName: "browser_highlight_text", state: "complete", resultDetails: { tab: { id: 32 } } },
			],
		};
		assert.deepEqual(
			collectResearchScaffoldingTabIdsForTest(scaffoldingRequest),
			[31],
			"only request-created tabs without marks close; marked sources and reused tabs stay",
		);
		assert.deepEqual(
			collectResearchScaffoldingTabIdsForTest({ initialActiveTab: { id: 31 }, toolTraces: scaffoldingRequest.toolTraces }),
			[],
			"the initially active tab never closes even if a trace claims the request created it",
		);
		assert.deepEqual(collectResearchScaffoldingTabIdsForTest({ toolTraces: [] }), [], "no created tabs, no cleanup");
		assert.deepEqual(
			collectResearchScaffoldingTabIdsForTest({
				initialActiveTab: { id: 10 },
				toolTraces: [
					{ toolName: "browser_open_pdf_in_onhand_viewer", state: "complete", resultDetails: { tab: { id: 34 }, opened: true, alreadyOpen: false, replacedCurrentTab: false } },
					{ toolName: "browser_open_pdf_in_onhand_viewer", state: "complete", resultDetails: { tab: { id: 35 }, opened: false, alreadyOpen: true, replacedCurrentTab: false } },
				],
			}),
			[34],
			"detached viewer opens create tabs without navigate traces; unmarked ones must still close at turn end",
		);
		assert.equal(typeof collectUncitedTurnMarkRemovalsForTest, "function", "uncited mark sweep export is missing");
		const sweepCreatedAtMs = Date.parse("2026-07-30T12:00:00.000Z");
		const sweepId = (stampOffsetMs, suffix) => `onhand-${sweepCreatedAtMs + stampOffsetMs}-${suffix}`;
		const orphanId = sweepId(4000, "aaa111");
		const citedId = sweepId(5000, "bbb222");
		const notedId = sweepId(6000, "ccc333");
		const reusedId = sweepId(7000, "ddd444");
		const priorTurnId = `onhand-${sweepCreatedAtMs - 60000}-eee555`;
		const sweepTrace = (annotationId, tabId, extraDetails = {}) => ({
			state: "complete",
			toolName: "browser_highlight_text",
			resultSummary: `Highlighted "x" annotationId: ${annotationId}`,
			resultDetails: { tab: { id: tabId }, annotationId, ...extraDetails },
		});
		const sweepRequest = {
			createdAt: "2026-07-30T12:00:00.000Z",
			toolTraces: [
				sweepTrace(orphanId, 7),
				sweepTrace(citedId, 7),
				sweepTrace(notedId, 7),
				sweepTrace(reusedId, 7, { annotation: { reusedExisting: true } }),
				sweepTrace(priorTurnId, 7),
				sweepTrace("onhand-pdf-zz1-1", 9),
				{ state: "complete", toolName: "browser_show_note", effectiveArgs: { annotationId: notedId }, resultSummary: "Added note" },
			],
		};
		assert.deepEqual(
			collectUncitedTurnMarkRemovalsForTest(sweepRequest, `Answer. [[cite:${citedId}]]`),
			[
				{ tabId: 7, annotationIds: [orphanId] },
				{ tabId: 9, annotationIds: ["onhand-pdf-zz1-1"] },
			],
			"only this turn's bare uncited marks are swept: cited, noted, reused, and prior-turn anchors all stay",
		);
		assert.deepEqual(
			collectUncitedTurnMarkRemovalsForTest(sweepRequest, `A. [[cite:${citedId}]][[cite:${orphanId}]] [[cite:onhand-pdf-zz1-1]]`),
			[],
			"stacked and pdf citation markers all count as citations",
		);
		assert.deepEqual(
			collectUncitedTurnMarkRemovalsForTest(sweepRequest, "Done — I marked the passage for you."),
			[],
			"a zero-cite reply sweeps nothing: explicit highlight requests deliver marks without prose citations",
		);
		const { readFile: readSweepSource } = await import("node:fs/promises");
		const sweepRuntimeSource = await readSweepSource(new URL("../packages/browser-extension/src/browser-runtime.ts", import.meta.url), "utf8");
		assert.match(
			sweepRuntimeSource,
			/collectUncitedTurnMarkRemovals\(activeRequest, reply\)/,
			"finalize must run the uncited-mark sweep against the final reply",
		);
		assert.match(sweepRuntimeSource, /host\.runCommand\("remove_annotations"/, "the sweep must remove marks through the host command");
		const sweepBackgroundSource = await readSweepSource(new URL("../packages/browser-extension/background.js", import.meta.url), "utf8");
		assert.match(sweepBackgroundSource, /case "remove_annotations": \{/, "background must expose the targeted annotation removal command");
		const sweepViewerSource = await readSweepSource(new URL("../packages/browser-extension/src/pdf-viewer.ts", import.meta.url), "utf8");
		assert.match(sweepViewerSource, /case "removeAnnotations":/, "the Onhand PDF viewer must support targeted annotation removal");
		const timeoutTrace = {
			toolName: "browser_highlight_text",
			state: "error",
			error: "browser_highlight_text failed: browser_highlight_text tool call timed out after 12000ms",
			effectiveArgs: { tabId: 68, text: "one misleading identification" },
		};
		const timeoutGuard = buildHighlightTimeoutTabGuardResultForTest(
			"browser_highlight_text",
			"highlight_text",
			{ tabId: 68, text: "a smaller span" },
			{ toolTraces: [timeoutTrace] },
		);
		assert.match(
			timeoutGuard?.guardrail?.message || "",
			/already timed out/,
			"a second highlight attempt on a tab that timed out must be blocked instead of burning another 12s cap",
		);
		assert.match(timeoutGuard?.guardrail?.message || "", /different source/);
		assert.equal(
			buildHighlightTimeoutTabGuardResultForTest("browser_highlight_text", "highlight_text", { tabId: 69, text: "x" }, { toolTraces: [timeoutTrace] }),
			null,
			"other tabs stay highlightable after one page times out",
		);
		assert.equal(
			buildHighlightTimeoutTabGuardResultForTest(
				"browser_highlight_text",
				"highlight_text",
				{ tabId: 68, text: "x" },
				{ toolTraces: [{ ...timeoutTrace, error: "Original highlight text did not match" }] },
			),
			null,
			"text-mismatch failures keep the normal retry-with-smaller-span path",
		);
		const crossTabStatusRequest = {
			initialActiveTab: { id: 12 },
			openTabSummary: {
				totalCount: 2,
				shownTabs: [{ id: 71, title: "Tacoma Narrows Bridge (1940)", url: "https://en.wikipedia.org/wiki/Tacoma_Narrows_Bridge_(1940)" }],
				omittedCount: 0,
			},
		};
		assert.equal(
			describeToolStatusForTargetTabForTest("browser_highlight_text", crossTabStatusRequest, { tabId: 71, text: "flutter" }),
			"Highlighting the relevant passage — in Tacoma Narrows Bridge (1940)...",
			"background-tab marks must name the tab they land in",
		);
		assert.equal(
			describeToolStatusForTargetTabForTest("browser_highlight_text", crossTabStatusRequest, { tabId: 12, text: "resonant frequency" }),
			"Highlighting the relevant passage...",
			"active-tab marks keep the plain progress label",
		);
		assert.equal(
			describeToolStatusForTargetTabForTest("browser_extract_content", crossTabStatusRequest, { tabId: 99 }),
			"Extracting readable page content — in another tab...",
			"unknown background tabs still get a cross-tab progress hint",
		);
		assert.equal(
			describeToolStatusForTargetTabForTest("browser_extract_content", crossTabStatusRequest, null, { id: 99, title: "Billah & Scanlan (AJP 1991)" }),
			"Extracting readable page content — in Billah & Scanlan (AJP 1991)...",
			"completed labels prefer the authoritative tab title from the command result",
		);
		assert.equal(
			describeToolStatusForTargetTabForTest("browser_activate_tab", crossTabStatusRequest, { tabId: 71 }),
			"Switching tabs...",
			"tab-switching status lines already self-describe",
		);
		const activeOnlyReadRequest = {
			...learningProblemRequest,
			toolTraces: [{ state: "complete", toolName: "browser_pdf_read_pages", resultDetails: { tab: { id: 1, url: busyWindowTabs[0].url } } }],
		};
		assert.equal(hasCompletedNonActiveWorkspaceReadForTest(activeOnlyReadRequest), false, "reading only the active homework must not satisfy workspace evidence");
		assert.equal(shouldRequireLearningWorkspaceEvidenceForTest(activeOnlyReadRequest), true);
		const samePdfViewerReadRequest = {
			...learningProblemRequest,
			toolTraces: [{
				state: "complete",
				toolName: "browser_pdf_read_pages",
				resultDetails: { tab: { id: 120, url: busyWindowTabs[0].url } },
			}],
		};
		assert.equal(
			hasCompletedNonActiveWorkspaceReadForTest(samePdfViewerReadRequest),
			false,
			"opening the same homework PDF in a separate viewer tab must not count as outside workspace evidence",
		);
		assert.equal(shouldRequireLearningWorkspaceEvidenceForTest(samePdfViewerReadRequest), true);
		const crossTabReadRequest = {
			...learningProblemRequest,
			toolTraces: [
				{ state: "complete", toolName: "browser_list_tabs" },
				{ state: "complete", toolName: "browser_extract_content", effectiveArgs: { tabId: 51 }, resultDetails: { tab: { id: 51, url: busyWindowTabs[50].url } } },
			],
		};
		assert.equal(hasCompletedNonActiveWorkspaceReadForTest(crossTabReadRequest), true, "an explicit read from a related background tab should satisfy workspace evidence");
		assert.equal(shouldRequireLearningWorkspaceEvidenceForTest(crossTabReadRequest), false);
		const crossTabSourceHighlightRequest = {
			...crossTabReadRequest,
			toolTraces: [
				...crossTabReadRequest.toolTraces,
				{ state: "complete", toolName: "browser_show_note", resultDetails: { tab: { id: 1, url: busyWindowTabs[0].url } } },
				{
					state: "complete",
					toolName: "browser_highlight_text",
					resultDetails: { annotation: { annotationId: "source-highlight" }, tab: { id: 51, url: busyWindowTabs[50].url } },
				},
			],
		};
		assert.equal(
			buildSurplusTeachingNoteGuardResultForTest(
				"browser_show_note",
				"show_note",
				crossTabSourceHighlightRequest.displayPrompt,
				crossTabSourceHighlightRequest,
			),
			null,
			"a note on the homework prompt must not block one interpretive note on a newly inspected learning source",
		);
		assert.equal(
			shouldRequireLearningWorkspaceEvidenceForTest({ ...learningProblemRequest, learningMode: false }),
			false,
			"Answer Mode should not inherit the Learning Mode workspace invariant",
		);
		assert.equal(
			shouldRequireLearningWorkspaceEvidenceForTest({ ...learningProblemRequest, displayPrompt: "Explain regularization conceptually." }),
			false,
			"ordinary conceptual questions should not be forced into homework workspace retrieval",
		);
		const imageProblemRequest = {
			...learningProblemRequest,
			displayPrompt: "Could you help me solve this?",
			attachments: [{ kind: "image", mimeType: "image/png" }],
			initialActiveTab: { id: 1, title: "New Tab", url: "https://example.test/blank" },
			initialActiveUrl: "https://example.test/blank",
			initialBrowserContextText: "",
		};
		assert.equal(
			shouldRequireLearningWorkspaceEvidenceForTest(imageProblemRequest),
			true,
			"an attached problem image should trigger workspace evidence even when the active page is not an assignment",
		);
		const workspaceRetryPrompt = buildLearningWorkspaceEvidenceRetryPromptForTest(learningProblemRequest, "Use L2 and early stopping.");
		assert.match(workspaceRetryPrompt, /call browser_list_tabs/);
		assert.match(workspaceRetryPrompt, /inspect at least one plausible non-active source/);
		assert.match(workspaceRetryPrompt, /tabId 51/);
		assert.match(workspaceRetryPrompt, /Do not use the problem statement as the only citation/);
		assert.match(workspaceRetryPrompt, /newTab true and active false/, "linked learning-source discovery should preserve the learner's active tab");
		assert.match(workspaceRetryPrompt, /browser_open_pdf_in_onhand_viewer with that tabId and active false/);
		assert.deepEqual(
			applyLearningBackgroundFocusDefaultForTest(
				{ tabId: 51, newTab: true },
				"open_pdf_in_onhand_viewer",
				learningProblemRequest,
			),
			{ tabId: 51, newTab: true, active: false },
			"automatic Learning Mode PDF handoff should stay in the background even when the model omits active=false",
		);
		assert.deepEqual(
			applyLearningBackgroundFocusDefaultForTest(
				{ url: busyWindowTabs[50].url, newTab: true },
				"navigate",
				learningProblemRequest,
			),
			{ url: busyWindowTabs[50].url, newTab: true, active: false },
			"automatic Learning Mode linked navigation should stay in the background",
		);
		assert.deepEqual(
			applyLearningBackgroundFocusDefaultForTest(
				{ url: busyWindowTabs[50].url, newTab: true, active: true },
				"navigate",
				{ ...learningProblemRequest, displayPrompt: "Take me to the lecture notes for this question." },
			),
			{ url: busyWindowTabs[50].url, newTab: true, active: true },
			"an explicit request to be taken to the source should preserve focus-changing intent",
		);
		for (const displayPrompt of ["Open https://example.test/notes.", "Open this link.", "Go to Google."]) {
			assert.deepEqual(
				applyLearningBackgroundFocusDefaultForTest(
					{ url: "https://example.test/destination", newTab: true, active: true },
					"navigate",
					{ ...learningProblemRequest, displayPrompt },
				),
				{ url: "https://example.test/destination", newTab: true, active: true },
				`explicit Learning Mode navigation should preserve focus for: ${displayPrompt}`,
			);
		}
		for (const displayPrompt of [
			"Open this link in a background tab.",
			"Open https://example.test/notes but keep me here.",
			"Visit the notes without switching tabs.",
		]) {
			assert.deepEqual(
				applyLearningBackgroundFocusDefaultForTest(
					{ url: "https://example.test/destination", newTab: true, active: true },
					"navigate",
					{ ...learningProblemRequest, displayPrompt },
				),
				{ url: "https://example.test/destination", newTab: true, active: false },
				`explicit background navigation should preserve the current page for: ${displayPrompt}`,
			);
		}
	const firstPrinciplesSourceToolNames = getToolNamesForTest("could you find a source that derives it from first principles?", false);
	const firstPrinciplesCachedSourceToolNames = getToolNamesForTest(
		"could you find a source that derives it from first principles?",
		false,
		null,
		{ suppressExtractContent: true },
	);
	const singularSourceToolNames = getToolNamesForTest("find a source that derives Bayes theorem from first principles", false);
	const ordinarySourceToolNames = getToolNamesForTest("What does this paragraph mean?", false);
	const visualToolNames = getToolNamesForTest("What does this chart show about model accuracy?", false);
	const answerAllToolNames = getToolNamesForTest("Port smoke all browser tools.", false);
	const genericSmokeToolNames = getToolNamesForTest("Google Docs smoke test: read the document title without editing it.", false);
	const pdfContextToolNames = getToolNamesForTest("How do perceptrons solve binary classification?", false, null, { forcePdfTools: true });
	const pdfSelectionToolNames = getToolNamesForTest("What does this mean?", false, null, { forcePdfTools: true });
	const pdfHighlightedPeopleToolNames = getToolNamesForTest("Who are the people I highlighted?", false, null, { forcePdfTools: true });
	const pdfSelectionDeepToolNames = getToolNamesForTest("What does this mean? Open it in the Onhand PDF viewer if you need deeper context.", false, null, {
		forcePdfTools: true,
	});
	const pdfAffirmativeFollowupToolNames = getToolNamesForTest("yes", false, null, { forcePdfTools: true });
	const externalSourceToolNames = getToolNamesForTest("Could you take me to these sources and highlight the parts that discuss attention?", false);
	const linkedNotesToolNames = getToolNamesForTest(
		"Could you open the notes that are relevant? Like, could you open them up in another tab and find the exact points that might be relevant?",
		false,
	);
	const linkedNotesFollowupToolNames = getToolNamesForTest(
		"Could you check the other notes that might be useful to help solve this problem? You mentioned a couple other topics.",
		false,
	);
	const linkedNotesOtherPageVoiceToolNames = getToolNamesForTest(
		"Could you help me solve this problem by looking at the notes for this class on the other page?",
		false,
	);
	const readCurrentPageToolNames = getToolNamesForTest("Can you read this page?", false);
	const reviewCurrentArticleToolNames = getToolNamesForTest("Please review this article.", false);
	const scanCurrentDocumentToolNames = getToolNamesForTest("Can you scan this document?", false);
	const comparisonToolNames = getToolNamesForTest("Compare how this paper and the other paper I have open handle attention.", false);
	const agreementToolNames = getToolNamesForTest("Do you agree with this?", false);
	const differenceToolNames = getToolNamesForTest("What is the difference?", false);
	const explicitAgreementToolNames = getToolNamesForTest("Do these papers agree?", false);
	const citationToolNames = getToolNamesForTest("What does reference [2] of this paper actually say?", false);
	const textbookSearchToolNames = getToolNamesForTest(
		"Search this VitalSource textbook for Lochner and tell me where it is mentioned elsewhere in the book.",
		false,
	);
	const genericTextbookSearchToolNames = getToolNamesForTest(
		"Where does this online book mention due process in another chapter that is not loaded?",
		false,
	);
	const debugToolNames = getToolNamesForTest("Debug why this page is logging console errors.", false);
	const explicitRuntimeToolNames = getToolNamesForTest("Run JavaScript to return document.title.", false);
	const dynamicRuntimeToolNames = getToolNamesForTest("Inspect the React app state and selected value on this dynamic page.", false);
	const disabledExplicitRuntimeToolNames = getToolNamesForTest("Run JavaScript to return document.title.", false, null, { advancedRuntimeInspectionEnabled: false });
	const noPageChangeToolNames = getToolNamesForTest("Answer from this page. Do not add highlights or notes.", false);
	const highlightWithoutNotesToolNames = getToolNamesForTest("Try to highlight the exact phrase Alpha smoke content. Do not add notes.", false);
	const answerOnlySectionValueToolNames = getToolNamesForTest(
		"Read the current page and answer: what output text is shown in the Network Section before clicking? Keep the answer short.",
		false,
	);
	const cachedFollowupToolNames = getToolNamesForTest("What activation functions are listed for FFNs on this page?", false, null, { suppressExtractContent: true });
	const exactCachedFollowupToolNames = getToolNamesForTest(
		"Using the same page context, what is the exact sinusoidal positional encoding formula?",
		false,
		null,
		{ suppressExtractContent: true },
	);
	const tableCachedFollowupToolNames = getToolNamesForTest(
		"Using the same page context, which three Qwen tensors each have 32.0% of the layer parameters?",
		false,
		null,
		{ suppressExtractContent: true },
	);
	const cachedComparisonFollowupToolNames = getToolNamesForTest(
		"Compare rejection sampling and Metropolis-Hastings",
		true,
		contract.learnerState,
		{ suppressExtractContent: true },
	);
	const priorPageContext = buildPriorExtractedPageContextForTest(
		{
			turns: [
				{
					createdAt: "2026-06-19T20:00:00.000Z",
					toolTraces: [
						{
							toolName: "browser_extract_content",
							state: "complete",
							resultDetails: {
								tab: { title: "transformers_part1", url: "https://example.test/transformers_part1.html" },
								content: { url: "https://example.test/transformers_part1.html" },
							},
							resultSummary:
								"Readable content from transformers_part1:\nPage heading outline with section snippets:\n### 4.1. Attention variants\nMQA and GQA reduce KV cache cost.\n#### Activation Functions\nThe table lists ReLU with Original Transformer (Vaswani et al., 2017), GELU with BERT and GPT-2, and SwiGLU with Llama 2/3, PaLM, Gemma.\n#### Parameter Count Example\nLarge MoE layers have many FFN expert parameters.\n\nReadable body excerpt:\nEarly page excerpt.",
						},
					],
				},
			],
		},
		{ title: "transformers_part1", url: "https://example.test/transformers_part1.html#section" },
		"What activation functions are listed for FFNs and which models or papers are associated with them?",
	);
	const exactPriorPageContext = buildPriorExtractedPageContextForTest(
		{
			turns: [
				{
					createdAt: "2026-06-19T20:00:00.000Z",
					toolTraces: [
						{
							toolName: "browser_extract_content",
							state: "complete",
							resultDetails: {
								tab: { title: "transformers_part1", url: "https://example.test/transformers_part1.html" },
								content: { url: "https://example.test/transformers_part1.html" },
							},
							resultSummary:
								"Readable content from transformers_part1:\nPage heading outline with section snippets:\n### Positional Encodings\nThe section starts with P in R and then truncates before later equations...",
						},
					],
				},
			],
		},
		{ title: "transformers_part1", url: "https://example.test/transformers_part1.html" },
		"Using the same page context, what is the exact sinusoidal positional encoding formula?",
	);
	const priorDocContextWithActiveTabDrift = buildPriorExtractedPageContextForTest(
		{
			turns: [
				{
					createdAt: "2026-06-19T20:05:00.000Z",
					toolTraces: [
						{
							toolName: "browser_extract_content",
							state: "complete",
							resultDetails: {
								tab: { title: "heyclicky vision - Google Docs", url: "https://docs.google.com/document/d/example/edit?tab=t.0" },
								content: { url: "https://docs.google.com/document/d/example/edit?tab=t.0" },
							},
							resultSummary:
								"Readable content from heyclicky vision - Google Docs:\nReadable body excerpt:\nThe iMac took the same chip, memory, and storage everyone else was using and made it 100x more accessible. I wanna take the same frontier models everyone else is using, and make it so that the power of this technology can break out of uninspired chat interfaces.",
						},
					],
				},
			],
		},
		{ title: "Unrelated video", url: "https://www.youtube.com/watch?v=example" },
		"Using the same document context, what analogy does the author make with the iMac?",
	);
	const unrelatedActiveTabShouldNotUsePriorDocContext = buildPriorExtractedPageContextForTest(
		{
			turns: [
				{
					createdAt: "2026-06-19T20:05:00.000Z",
					toolTraces: [
						{
							toolName: "browser_extract_content",
							state: "complete",
							resultDetails: {
								tab: { title: "heyclicky vision - Google Docs", url: "https://docs.google.com/document/d/example/edit?tab=t.0" },
								content: { url: "https://docs.google.com/document/d/example/edit?tab=t.0" },
							},
							resultSummary: "Readable content from heyclicky vision - Google Docs:\nReadable body excerpt:\nThe iMac made computing more accessible.",
						},
					],
				},
			],
		},
		{ title: "Unrelated video", url: "https://www.youtube.com/watch?v=example" },
		"What does the current page say about the iMac?",
	);
		assert.equal(answerToolNames.includes("onhand_record_learning_event"), false);
		assert.equal(answerAllToolNames.includes("onhand_record_learning_event"), false);
		assert.equal(answerToolNames.includes("browser_highlight_text"), true, "the ungated tool registry exposes this tool for every prompt; prompt policy and guards govern its use");
		assert.equal(answerToolNames.includes("browser_show_note"), true, "the ungated tool registry exposes this tool for every prompt; prompt policy and guards govern its use");
		assert.equal(firstPrinciplesSourceToolNames.includes("browser_navigate"), true, "natural singular source-finding prompts should expose navigation");
		assert.equal(firstPrinciplesSourceToolNames.includes("browser_extract_content"), true, "source-finding prompts should expose readable extraction");
		assert.equal(firstPrinciplesCachedSourceToolNames.includes("browser_extract_content"), true, "cached source-navigation followups should still expose extraction for destination pages");
		assert.equal(firstPrinciplesSourceToolNames.includes("browser_find_elements"), true, "source-finding prompts should expose element discovery");
		assert.equal(firstPrinciplesSourceToolNames.includes("browser_click"), true, "the ungated tool registry exposes this tool for every prompt; prompt policy and guards govern its use");
		assert.equal(firstPrinciplesSourceToolNames.includes("browser_type"), true, "the ungated tool registry exposes this tool for every prompt; prompt policy and guards govern its use");
		assert.equal(firstPrinciplesSourceToolNames.includes("browser_run_js"), true, "runtime JS is gated only by the advanced runtime inspection setting");
		assert.equal(singularSourceToolNames.includes("browser_navigate"), true, "find a source that... should route to the source-navigation pack");
		assert.equal(ordinarySourceToolNames.includes("browser_navigate"), true, "the ungated tool registry exposes this tool for every prompt; prompt policy and guards govern its use");
		assert.equal(ordinarySourceToolNames.includes("browser_click"), true, "the ungated tool registry exposes this tool for every prompt; prompt policy and guards govern its use");
		assert.equal(ordinarySourceToolNames.includes("browser_run_js"), true, "runtime JS is gated only by the advanced runtime inspection setting");
		const missingNavigationRetryTools = missingToolRetryToolNamesForTest(
			"browser_navigate",
			"could you find a source that derives it from first principles?",
			{},
		);
		for (const name of [
			"browser_get_visible_text",
			"browser_extract_content",
			"browser_get_selection",
			"browser_get_viewport_headings",
			"browser_get_scroll_state",
			"browser_list_tabs",
			"browser_activate_tab",
			"browser_navigate",
			"browser_open_pdf_in_onhand_viewer",
			"browser_find_elements",
		]) {
			assert.equal(missingNavigationRetryTools.includes(name), true, `missing navigation retry should include ${name}`);
		}
		assert.equal(
			missingToolRetryToolNamesForTest("browser_run_js", "could you find a source that derives it from first principles?", {}).length,
			0,
			"missing-tool retry should not enable runtime JS for ordinary source prompts",
		);
		assert.equal(
			findMissingKnownBrowserToolTraceForTest({
				toolTraces: [
					{
						toolName: "browser_navigate",
						state: "error",
						error: "Tool failed.",
						resultDetails: { error: { content: [{ type: "text", text: "Tool browser_navigate not found" }] } },
					},
				],
			})?.toolName,
			"browser_navigate",
			"missing browser tool traces should be detected for retry",
		);
		assert.equal(teachingPageToolNames.includes("browser_highlight_text"), true, "page-level teaching prompts should expose source highlighting");
		assert.equal(teachingPageToolNames.includes("browser_show_note"), true, "page-level teaching prompts should expose source notes");
		for (const [label, toolNames] of [
			["same-page comparison", compareOnPageToolNames],
			["lecture differences", differenceLectureToolNames],
			["lecture roadmap", roadmapLectureToolNames],
			["page algorithm steps", hmcStepsToolNames],
			["page derivation", derivationToolNames],
			["page quiz", quizPageToolNames],
			["according-to-page limitations", limitationsPageToolNames],
		]) {
			assert.equal(toolNames.includes("browser_highlight_text"), true, `${label} prompts should expose source highlighting`);
			assert.equal(toolNames.includes("browser_show_note"), true, `${label} prompts should expose source notes`);
		}
	assert.equal(visualToolNames.includes("browser_get_visible_region_image"), true);
	assert.equal(pdfSelectionToolNames.includes("browser_get_visible_region_image"), true, "the ungated tool registry exposes this tool for every prompt; prompt policy and guards govern its use");
	assert.equal(
		pdfSelectionToolNames.includes("browser_open_pdf_in_onhand_viewer"),
		true,
		"short PDF selection/deictic prompts should keep viewer handoff available for unknown-selection recovery",
	);
	assert.equal(
		pdfSelectionToolNames.includes("browser_pdf_read_pages"),
		true,
		"short PDF selection/deictic prompts should keep PDF reading available for useful deeper context",
	);
	assert.equal(
		pdfSelectionToolNames.includes("browser_pdf_search"),
		true,
		"short PDF selection/deictic prompts should keep PDF search available for useful deeper context",
	);
	assert.equal(
		pdfSelectionToolNames.includes("browser_pdf_jump_to_page"),
		true,
		"short PDF selection/deictic prompts should keep PDF jump available for useful deeper context",
	);
	assert.equal(
		pdfSelectionToolNames.includes("browser_highlight_text"),
		true,
			"PDF viewer analysis should expose highlighting so important supporting passages can be marked",
	);
	assert.equal(
		pdfSelectionToolNames.includes("browser_show_note"),
		true,
		"PDF viewer analysis should expose notes so important supporting passages can be annotated",
	);
	assert.equal(
		pdfSelectionToolNames.includes("browser_clear_annotations"),
		true,
		"the ungated tool registry exposes this tool for every prompt; prompt policy and guards govern its use",
	);
	assert.equal(pdfHighlightedPeopleToolNames.includes("browser_get_visible_region_image"), true, "the ungated tool registry exposes this tool for every prompt; prompt policy and guards govern its use");
	assert.equal(
		pdfHighlightedPeopleToolNames.includes("browser_open_pdf_in_onhand_viewer"),
		true,
		"non-trivial highlighted PDF referents should keep viewer handoff available for analysis and annotation",
	);
	assert.equal(pdfHighlightedPeopleToolNames.includes("browser_navigate"), true, "the ungated tool registry exposes this tool for every prompt; prompt policy and guards govern its use");
	assert.equal(pdfHighlightedPeopleToolNames.includes("browser_highlight_text"), true, "existing highlighted PDF referents should expose highlights for important supporting passages");
		assert.equal(pdfHighlightedPeopleToolNames.includes("browser_show_note"), true, "existing highlighted PDF referents should expose notes for important supporting passages");
		assert.equal(pdfHighlightedPeopleToolNames.includes("browser_clear_annotations"), true, "the ungated tool registry exposes this tool for every prompt; prompt policy and guards govern its use");
			assert.equal(pdfAffirmativeFollowupToolNames.includes("browser_open_pdf_in_onhand_viewer"), true, "affirmative PDF follow-ups should be able to reopen the viewer before deeper source marking");
		assert.equal(pdfAffirmativeFollowupToolNames.includes("browser_pdf_search"), true, "affirmative PDF follow-ups should keep PDF search available for the accepted deeper pass");
		assert.equal(pdfAffirmativeFollowupToolNames.includes("browser_pdf_read_pages"), true, "affirmative PDF follow-ups should keep PDF page reading available for the accepted deeper pass");
	assert.equal(pdfAffirmativeFollowupToolNames.includes("browser_pdf_jump_to_page"), true, "affirmative PDF follow-ups should keep PDF jumping available for source activation");
	assert.equal(pdfAffirmativeFollowupToolNames.includes("browser_highlight_text"), true, "affirmative PDF follow-ups should expose highlights for the accepted deeper pass");
	assert.equal(pdfAffirmativeFollowupToolNames.includes("browser_show_note"), true, "affirmative PDF follow-ups should expose notes for the accepted deeper pass");
		const pdfReadWithoutAnchorsRequest = {
			displayPrompt: "What does this mean?",
			toolTraces: [
				{ toolName: "browser_pdf_search", state: "complete", resultSummary: "PDF search for \"Multi-Head Attention\": 2 matches" },
			{
				toolName: "browser_pdf_read_pages",
				state: "complete",
				resultSummary:
					"PDF page text:\n[p. 5]\nMulti-head attention allows the model to jointly attend to information from different representation subspaces at different positions.",
				},
			],
		};
		const pageTeachingWithoutSourceRequest = {
			displayPrompt: "Teach me what this page says about Bayesian neural networks",
			toolTraces: [
				{
					toolName: "browser_extract_content",
					state: "complete",
					resultSummary:
						"Readable content from BayesianDL:\nReadable body excerpt:\nBayesian models sample from the posterior of models given the data.",
				},
			],
		};
		assert.equal(promptAsksForTeachingPageSourceMarkerForTest(pageTeachingWithoutSourceRequest.displayPrompt), true);
		assert.equal(promptAsksForTeachingPageSourceMarkerForTest("Give me a practical summary of this page."), true);
		assert.equal(promptRequiresPageSourceMarkerForTest("Give me a practical summary of this page."), true);
		assert.equal(promptAsksForTeachingPageSourceMarkerForTest("How does rejection sampling work?"), false);
		assert.equal(promptAllowsPageSourceHighlightsForTest("What does the current page say about the iMac?"), false);
		assert.equal(promptRequiresPageSourceMarkerForTest("What does the current page say about the iMac?"), false);
		for (const prompt of [
			"Compare rejection sampling and Metropolis-Hastings on this page.",
			"What are the differences between rejection sampling and Metropolis-Hastings in this lecture?",
			"Give me a roadmap of the sampling methods in this lecture.",
			"What are the main steps in the HMC algorithm on this page?",
			"How does this page derive Bayes theorem?",
			"Quiz me on this page.",
			"What are the limitations of rejection sampling according to the page?",
		]) {
			assert.equal(promptAsksForStructuredPageSourceMarkerForTest(prompt), true, `${prompt} should be treated as structured page-grounded work`);
			assert.equal(promptAllowsPageSourceHighlightsForTest(prompt), true, `${prompt} should allow source highlights`);
			assert.equal(promptRequiresPageSourceMarkerForTest(prompt), true, `${prompt} should require a source marker before finalizing`);
			assert.equal(
				shouldRequirePageSourceMarkerRetryForTest({ ...pageTeachingWithoutSourceRequest, displayPrompt: prompt }),
				true,
				`${prompt} should retry if no source highlight succeeded`,
			);
		}
		assert.equal(
			shouldRequirePageSourceMarkerRetryForTest(pageTeachingWithoutSourceRequest),
			true,
			"page-level teaching answers should require a retry when no highlight succeeded",
		);
		assert.match(buildPageSourceMarkerRetryPromptForTest(pageTeachingWithoutSourceRequest, "Draft answer"), /durable page source marker/);
		assert.match(buildPageSourceMarkerRetryPromptForTest(pageTeachingWithoutSourceRequest, "Draft answer"), /browser_highlight_text/);
	assert.match(buildPageSourceMarkerRetryPromptForTest(pageTeachingWithoutSourceRequest, "Draft answer"), /Give each interpretive highlight a short browser_show_note/);
		assert.match(buildPageSourceMarkerRetryPromptForTest(pageTeachingWithoutSourceRequest, "Draft answer"), /Do not use the page title, course title, reading list, or a generic heading/);
		assert.match(buildPageSourceMarkerRetryPromptForTest(pageTeachingWithoutSourceRequest, "Draft answer"), /only one source marker succeeded/);
		assert.equal(
			shouldRequirePageSourceMarkerRetryForTest({
				...pageTeachingWithoutSourceRequest,
				toolTraces: [
					...pageTeachingWithoutSourceRequest.toolTraces,
					{ toolName: "browser_highlight_text", state: "complete", resultSummary: "Highlighted text" },
				],
			}),
			false,
			"completed page highlights should satisfy the teaching source-marker requirement",
		);
		assert.equal(
			shouldRequirePageSourceMarkerRetryForTest({
				...pageTeachingWithoutSourceRequest,
				toolTraces: [
					...pageTeachingWithoutSourceRequest.toolTraces,
					{ toolName: "browser_scroll_to_annotation", state: "complete", effectiveArgs: { annotationId: "onhand-1-old" }, resultSummary: "Scrolled to annotationId onhand-1-old." },
				],
			}),
			false,
			"tool-verified anchor reuse (a completed scroll_to_annotation) satisfies the marker gate on follow-ups per G18",
		);
		assert.equal(
			shouldRequirePageSourceMarkerRetryForTest({
				...pageTeachingWithoutSourceRequest,
				displayPrompt: "Compare rejection sampling and Metropolis-Hastings on this page.",
				toolTraces: [
					...pageTeachingWithoutSourceRequest.toolTraces,
					{ toolName: "browser_highlight_text", state: "complete", resultSummary: "Highlighted text annotationId: onhand-2-new" },
					{ toolName: "browser_scroll_to_annotation", state: "complete", effectiveArgs: { annotationId: "onhand-2-new" }, resultSummary: "Scrolled to annotationId onhand-2-new." },
				],
			}),
			true,
			"scrolling to a mark placed this same turn must not double-count toward the comparison floor",
		);
		assert.equal(
			shouldRequirePageSourceMarkerRetryForTest({
				...pageTeachingWithoutSourceRequest,
				displayPrompt: "Compare rejection sampling and Metropolis-Hastings on this page.",
				toolTraces: [
					...pageTeachingWithoutSourceRequest.toolTraces,
					{ toolName: "browser_highlight_text", state: "complete", resultSummary: "Highlighted text annotationId: onhand-2-new" },
					{ toolName: "browser_scroll_to_annotation", state: "complete", effectiveArgs: { annotationId: "onhand-1-old" }, resultSummary: "Scrolled to annotationId onhand-1-old." },
				],
			}),
			false,
			"one fresh mark plus one reused anchor satisfies the two-mark comparison floor",
		);
		assert.equal(
			shouldRequirePageSourceMarkerRetryForTest({
				...pageTeachingWithoutSourceRequest,
				displayPrompt: "Compare these papers and highlight the evidence in both.",
				toolTraces: [
					...pageTeachingWithoutSourceRequest.toolTraces,
					{ toolName: "browser_highlight_text", state: "complete", resultSummary: "Highlighted text", resultDetails: { tab: { id: 5 } } },
					{ toolName: "browser_scroll_to_annotation", state: "complete", effectiveArgs: { annotationId: "onhand-1-old" }, resultSummary: "Scrolled to annotationId onhand-1-old.", resultDetails: { tab: { id: 7 } } },
				],
			}),
			false,
			"a reused anchor in the second tab satisfies the cross-tab distinct-source floor",
		);
		assert.equal(
			shouldRequirePageSourceMarkerRetryForTest({
				...pageTeachingWithoutSourceRequest,
				displayPrompt: "Compare these papers and highlight the evidence in both.",
				toolTraces: [
					...pageTeachingWithoutSourceRequest.toolTraces,
					{ toolName: "browser_highlight_text", state: "complete", resultSummary: "Highlighted text", resultDetails: { tab: { id: 5 } } },
					{ toolName: "browser_scroll_to_annotation", state: "complete", effectiveArgs: { annotationId: "onhand-1-old" }, resultSummary: "Scrolled to annotationId onhand-1-old.", resultDetails: { tab: { id: 5 } } },
				],
			}),
			true,
			"cross-tab prompts still require anchors on distinct tabs even when one is reused",
		);
		assert.equal(
			shouldRequirePageSourceMarkerRetryForTest({
				...pageTeachingWithoutSourceRequest,
				displayPrompt: "Do these papers agree?",
			}),
			false,
			"bare comparison-shaped prompts no longer force a revision pass; prompt policy owns that middle ground (narrowed G17)",
		);
		assert.equal(
			shouldRequirePageSourceMarkerRetryForTest({
				...pageTeachingWithoutSourceRequest,
				displayPrompt: "Why is my textbook wrong about this?",
			}),
			false,
			"claim-check follow-ups must not trigger the forced-marks pass",
		);
		const structuredOneHighlightRequest = {
			...pageTeachingWithoutSourceRequest,
			displayPrompt: "Give me a roadmap of the data structures covered on this page.",
			toolTraces: [
				...pageTeachingWithoutSourceRequest.toolTraces,
				{ toolName: "browser_highlight_text", state: "complete", resultSummary: "Highlighted text: Using Lists as Stacks" },
			],
		};
		assert.equal(
			shouldRequirePageSourceMarkerRetryForTest(structuredOneHighlightRequest),
			true,
			"structured page prompts should retry when only one source highlight supports a multi-item answer",
		);
		assert.match(
			buildPageSourceMarkerRetryPromptForTest(structuredOneHighlightRequest, "Draft roadmap"),
			/one more durable source marker|2-4 concise source markers/,
			"structured source-marker retry prompts should ask for additional concise source markers",
		);
		assert.match(
			buildPageSourceMarkerRetryPromptForTest(structuredOneHighlightRequest, "Draft roadmap"),
			/distinct top-level sibling items or sections/,
			"structured source-marker retry prompts should prefer distinct top-level roadmap items over clustered subitems",
		);
		assert.equal(
			shouldRequirePageSourceMarkerRetryForTest({
				...structuredOneHighlightRequest,
				toolTraces: [
					...structuredOneHighlightRequest.toolTraces,
					{ toolName: "browser_highlight_text", state: "complete", resultSummary: "Highlighted text: Dictionaries" },
				],
			}),
			false,
			"two completed highlights should satisfy structured source-marker retry gating",
		);
		assert.equal(
			shouldRequirePageSourceMarkerRetryForTest({ ...pageTeachingWithoutSourceRequest, displayPrompt: "Teach me what this page says. Do not add highlights or notes." }),
			false,
			"explicit no-page-change prompts should not trigger the page source-marker retry",
		);
		assert.equal(
			shouldRequirePageSourceMarkerRetryForTest({ ...pageTeachingWithoutSourceRequest, pageSourceMarkerRetry: true }),
			false,
			"the page source-marker retry should be one-shot",
		);
		assert.equal(
			shouldRequirePageSourceMarkerRetryForTest({ ...pageTeachingWithoutSourceRequest, displayPrompt: "How does rejection sampling work?" }),
			false,
			"ordinary answer-only prompts should not trigger the page source-marker retry",
		);
		assert.equal(
			shouldRequirePdfAnchorRetryForTest(pdfReadWithoutAnchorsRequest),
			true,
		"PDF page reads that feed an answer should require a retry when no highlight/note succeeded",
	);
	assert.match(buildPdfAnchorRetryPromptForTest(pdfReadWithoutAnchorsRequest, "Draft answer"), /You read PDF pages for this answer but did not leave a durable PDF source highlight/);
		assert.match(buildPdfAnchorRetryPromptForTest(pdfReadWithoutAnchorsRequest, "Draft answer"), /browser_highlight_text/);
		assert.match(buildPdfAnchorRetryPromptForTest(pdfReadWithoutAnchorsRequest, "Draft answer"), /browser_show_note/);
		assert.match(buildPdfAnchorRetryPromptForTest(pdfReadWithoutAnchorsRequest, "Draft answer"), /under 280 characters/);
		assert.equal(
			buildFinalAssistantReplyForTest(
				'The user selected "Multi-Head Attention". Let me find the detailed explanation.',
				new Error("429 You've reached today's Onhand Free limit."),
				{ pdfAnchorRetry: true, reply: "" },
			),
			"Error: 429 You've reached today's Onhand Free limit.",
			"PDF anchor retry failures should surface the real error instead of a stale preamble",
		);
			assert.equal(
				buildFinalAssistantReplyForTest(
					"Let me add a source marker first.",
					new Error("No visible text matched: Bayesian models"),
					{ pageSourceMarkerRetry: true, reply: "" },
				),
				"Error: No visible text matched: Bayesian models",
				"page source-marker retry failures should surface the real error instead of a stale preamble",
			);
			const oneHighlightTeachingRequest = {
				displayPrompt: "Teach me what this page says about Bayesian neural networks.",
				learningMode: true,
				pageSourceMarkerRetry: true,
				toolTraces: [
					{
						toolName: "browser_highlight_text",
						state: "complete",
						resultSummary: "Highlighted text: In Bayesian modeling, we want to be able to sample from the posterior of models given the data.",
					},
				],
			};
			const surplusTeachingHighlightGuard = buildSurplusTeachingHighlightGuardResultForTest(
				"browser_highlight_text",
				"highlight_text",
				oneHighlightTeachingRequest.displayPrompt,
				oneHighlightTeachingRequest,
			);
			assert.equal(surplusTeachingHighlightGuard, null, "teaching prompts may keep marking after one source marker when more concepts remain");
			const cappedTeachingHighlightGuard = buildSurplusTeachingHighlightGuardResultForTest(
				"browser_highlight_text",
				"highlight_text",
				oneHighlightTeachingRequest.displayPrompt,
				{
					...oneHighlightTeachingRequest,
					toolTraces: Array.from({ length: 6 }, (_, index) => ({
						toolName: "browser_highlight_text",
						state: "complete",
						resultSummary: `Highlighted text: Teaching concept ${index + 1}.`,
					})),
				},
			);
			assert.equal(cappedTeachingHighlightGuard?.guardrail?.kind, "surplus_teaching_highlight", "free-form teaching prompts should stop after the teaching source-marker cap");
			assert.match(cappedTeachingHighlightGuard?.guardrail?.message || "", /Do not call browser_highlight_text again/, "teaching surplus guard should stop extra source-marker loops at the cap");
			const emptyHighlightGuard = buildEmptyHighlightTextGuardResultForTest("browser_highlight_text", "highlight_text", { text: "" });
			assert.equal(emptyHighlightGuard?.guardrail?.kind, "empty_highlight_text", "empty highlight calls should be guardrailed before page-tool failure");
			assert.match(
				formatToolResultForModel("browser_highlight_text", emptyHighlightGuard),
				/requires a non-empty exact visible or readable text span/,
				"empty highlight guard should return actionable model instructions",
			);
			const weakStructuredHighlightGuard = buildWeakStructuredHighlightTextGuardResultForTest(
				"browser_highlight_text",
				"highlight_text",
				{ text: "5.5." },
				"Give me a roadmap of the sections on this page.",
			);
			assert.equal(weakStructuredHighlightGuard?.guardrail?.kind, "weak_structured_highlight_text", "structured source markers should reject section-number-only highlights");
			assert.match(
				formatToolResultForModel("browser_highlight_text", weakStructuredHighlightGuard),
				/only a section number/,
				"weak structured highlight guard should explain how to retry with meaningful source text",
			);
			assert.equal(
				buildWeakStructuredHighlightTextGuardResultForTest(
					"browser_highlight_text",
					"highlight_text",
					{ text: "5.5. Dictionaries" },
					"Give me a roadmap of the sections on this page.",
				),
				null,
				"structured source markers should still allow section headings that include the item name",
			);
			const headingOnlyDerivationGuard = buildWeakStructuredHighlightTextGuardResultForTest(
				"browser_highlight_text",
				"highlight_text",
				{ text: "Bayes Theorem and Model Posterior" },
				"How does this page derive Bayes theorem?",
			);
			assert.equal(
				headingOnlyDerivationGuard?.guardrail?.kind,
				"weak_structured_highlight_text",
				"derivation prompts should reject heading-only source markers",
			);
			assert.match(
				formatToolResultForModel("browser_highlight_text", headingOnlyDerivationGuard),
				/only a heading|derivation\/proof\/explanation/i,
				"heading-only derivation guard should ask for explanatory text under the heading",
			);
			assert.equal(
				buildWeakStructuredHighlightTextGuardResultForTest(
					"browser_highlight_text",
					"highlight_text",
					{ text: "Bayes theorem follows from the product rule for joint probabilities." },
					"How does this page derive Bayes theorem?",
				),
				null,
				"derivation prompts should allow explanatory sentence source markers",
			);
			assert.equal(
				buildWeakStructuredHighlightTextGuardResultForTest(
					"browser_highlight_text",
					"highlight_text",
					{ text: "5.5." },
					"Highlight the formula on this page.",
				),
				null,
				"section-number guard should stay scoped to structured roadmap/list/comparison source markers",
			);
			const headingOnlyComparisonGuard = buildSurplusHighlightGuardResultForTest(
				"browser_highlight_text",
				"highlight_text",
				"Compare rejection sampling and Metropolis-Hastings on this page.",
				{
					displayPrompt: "Compare rejection sampling and Metropolis-Hastings on this page.",
					pageActions: [
						{
							type: "annotation",
							annotationId: "rej-1",
							label: "Highlighted text",
							citationText: "In rejection sampling, we want to sample X from p(x)",
						},
						{
							type: "annotation",
							annotationId: "rej-2",
							label: "Highlighted text",
							citationText: "Rejection sampling is very difficulty in high-dimensional domains because of the large value of M.",
						},
						{
							type: "annotation",
							annotationId: "mh-heading",
							label: "Highlighted text",
							citationText: "Metropolis-Hastings Sampling",
						},
					],
				},
			);
			assert.equal(headingOnlyComparisonGuard, null, "heading-only comparison highlights should not satisfy a comparison side");
			const explanatoryComparisonGuard = buildSurplusHighlightGuardResultForTest(
				"browser_highlight_text",
				"highlight_text",
				"Compare CSS Grid and Flexbox on this page.",
				{
					displayPrompt: "Compare CSS Grid and Flexbox on this page.",
					pageActions: [
						{
							type: "annotation",
							annotationId: "grid-1",
							label: "Highlighted text",
							citationText: "CSS Grid is a two-dimensional layout system for rows and columns.",
						},
						{
							type: "annotation",
							annotationId: "flex-1",
							label: "Highlighted text",
							citationText: "Flexbox is a one-dimensional layout method for arranging items in a row or column.",
						},
					],
				},
			);
			assert.equal(explanatoryComparisonGuard?.guardrail?.kind, "surplus_comparison_highlight", "comparison highlights should stop once both sides have explanatory support");
			const structuredBudgetRequest = {
				displayPrompt: "Give me a roadmap of the sampling methods in this page.",
				toolTraces: Array.from({ length: 5 }, (_, index) => ({
					toolName: "browser_highlight_text",
					state: "complete",
					resultSummary: `Highlighted "Roadmap item ${index + 1}" on Example. annotationId: roadmap-${index + 1}.`,
					resultDetails: { annotation: { annotationId: `roadmap-${index + 1}`, matchedText: `Roadmap item ${index + 1}` } },
				})),
			};
			const structuredBudgetGuard = buildStructuredHighlightBudgetGuardResultForTest(
				"browser_highlight_text",
				"highlight_text",
				structuredBudgetRequest.displayPrompt,
				structuredBudgetRequest,
			);
			assert.equal(structuredBudgetGuard, null, "enumerable structured prompts should not stop after a fixed source highlight budget");
			assert.equal(
				buildStructuredHighlightBudgetGuardResultForTest("browser_highlight_text", "highlight_text", structuredBudgetRequest.displayPrompt, {
					displayPrompt: structuredBudgetRequest.displayPrompt,
					toolTraces: [],
				}),
				null,
				"structured budget guard must not block the first source highlight",
			);
			const structuredFailureBudgetGuard = buildStructuredHighlightBudgetGuardResultForTest(
				"browser_highlight_text",
				"highlight_text",
				"Compare CSS Grid and Flexbox on this page.",
				{
					displayPrompt: "Compare CSS Grid and Flexbox on this page.",
					toolTraces: [
						{
							toolName: "browser_highlight_text",
							state: "complete",
							resultSummary: "Highlighted \"Grid is two-dimensional\" on Example. annotationId: grid-1.",
							resultDetails: { annotation: { annotationId: "grid-1", matchedText: "Grid is two-dimensional" } },
						},
						...Array.from({ length: 4 }, (_, index) => ({
							toolName: "browser_highlight_text",
							state: "error",
							error: `No visible text matched: failed-${index + 1}`,
						})),
					],
				},
			);
			assert.equal(structuredFailureBudgetGuard?.guardrail?.kind, "structured_highlight_budget", "structured prompts should stop after repeated failed highlight attempts once at least one source marker exists");
			assert.match(
				formatToolResultForModel("browser_highlight_text", structuredFailureBudgetGuard),
				/Answer now only from the existing successful source highlights/,
				"structured failure guard should return model instructions instead of pretending another highlight succeeded",
			);
			const roadmapNoteBudgetGuard = buildStructuredNoteBudgetGuardResultForTest(
				"browser_show_note",
				"show_note",
				"Give me a roadmap of the data structures on this page.",
				{
					displayPrompt: "Give me a roadmap of the data structures on this page.",
					toolTraces: [
						{
							toolName: "browser_show_note",
							state: "complete",
							resultSummary: "Added note: Lists are the main mutable sequence type.",
						},
					],
				},
			);
			assert.equal(roadmapNoteBudgetGuard, null, "enumerable structured prompts should allow notes on each interpretive highlight");
			assert.equal(
				buildStructuredNoteBudgetGuardResultForTest(
					"browser_show_note",
					"show_note",
					"Compare arrays and linked lists on this page.",
					{
						displayPrompt: "Compare arrays and linked lists on this page.",
						toolTraces: [
							{
								toolName: "browser_show_note",
								state: "complete",
								resultSummary: "Added note: Arrays optimize indexed lookup for constant-time reads.",
							},
						],
					},
				),
				null,
				"comparison prompts must allow a note on each side of the difference",
			);
			const structuredNoteBudgetGuard = buildStructuredNoteBudgetGuardResultForTest(
				"browser_show_note",
				"show_note",
				"Compare arrays and linked lists on this page.",
				{
					displayPrompt: "Compare arrays and linked lists on this page.",
					toolTraces: [
						{
							toolName: "browser_show_note",
							state: "complete",
							resultSummary: "Added note: Arrays optimize indexed lookup for constant-time reads.",
						},
						{
							toolName: "browser_show_note",
							state: "complete",
							resultSummary: "Added note: Linked lists optimize local insertion without reallocation.",
						},
					],
				},
			);
			assert.equal(structuredNoteBudgetGuard?.guardrail?.kind, "structured_note_budget", "comparison prompts should stop after one note per side");
			assert.equal(
				buildStructuredNoteBudgetGuardResultForTest(
					"browser_show_note",
					"show_note",
					"Give me a roadmap of this page and add notes.",
					{ toolTraces: [{ toolName: "browser_show_note", state: "complete" }] },
				),
				null,
				"explicit note requests should bypass the structured optional-note budget",
			);
			const assertPreservesSubstantiveTerms = (label, input, request, terms, removedPatterns = []) => {
				const output = sanitizeAssistantVisibleReplyForTest(input, request);
				for (const pattern of removedPatterns) {
					assert.doesNotMatch(output, pattern, `${label} should remove only the targeted visible artifact`);
				}
				for (const pattern of terms) {
					assert.match(output, pattern, `${label} should preserve substantive answer content`);
				}
				return output;
			};
			const artifactOnlyTeachingReply = buildFinalAssistantReplyForTest(
				"Let me start by reading the page content to find the best teaching passageI found the key explanatory passages.",
				null,
				{
					...oneHighlightTeachingRequest,
					pageActions: [
						{
							key: "highlight:onhand-source",
							type: "annotation",
							label: "Highlighted text",
							citationText: "Bayesian models sample from the posterior of models given the data.",
						},
					],
				},
			);
			assert.equal(
				artifactOnlyTeachingReply,
				"(No reply generated.)",
				"tiny visible cleanup should not synthesize a replacement answer from hidden/source state after removing process-only text",
			);
			const gluedInterimNarrationReply = [
				"The article derives the theorem by starting with the definition of joint probability, expressed two ways.",
				"The page you're on likely has a derivation. Let me read the page more fully to find itLet me look for the derivation, which is often provided as a proofLet me check what's visible on the page to find the derivationFound it! The page has a dedicated derivation. Let me highlight the key passage.",
			].join("\n\n");
			assertPreservesSubstantiveTerms(
				"glued interim narration reply",
				gluedInterimNarrationReply,
				oneHighlightTeachingRequest,
				[/derives the theorem by starting with the definition of joint probability/],
				[/Let me read/i, /Let me look/i, /Let me check/i, /Let me highlight/i, /Found it/i],
			);
			assertPreservesSubstantiveTerms(
				"em-dash and content-glued narration reply",
				[
					"The page on the theorem is already open — let me find its derivation section.",
					"I found the derivation section. Let me capture the full text to highlight itThe page includes a clean derivation from scratch within the statement section. \"The proof follows directly.\"",
				].join("\n\n"),
				oneHighlightTeachingRequest,
				[/includes a clean derivation from scratch/, /"The proof follows directly\."/],
				[/let me find/i, /let me capture/i, /I found the derivation/i, /highlight it/i],
			);
			const broadTeachingReply = [
				"Let me read more of the page to give you a thorough, grounded overview.",
				"This page is a lecture on Bayesian Deep Learning.",
				"---",
				"## Why go Bayesian?",
				"Standard training finds one weight vector via MLE, but a Bayesian approach treats weights as random variables. [1]",
				"## The Bayesian setup",
				"Posterior (via Bayes' theorem):",
				"p(W | D) =",
				"**Prediction** — integrate over possible weights:",
				"$$p(y|x) = \\int p(y|x,W)p(W|D)dW$$",
				"## How to sample from the posterior?",
				"The lecture covers rejection sampling, Metropolis-Hastings, Hamiltonian Monte Carlo, and Stochastic Gradient MCMC. [2]",
				"Let me record the core concept:Want me to walk through Metropolis-Hastings next?",
			].join("\n\n");
			const sanitizedTeachingReply = assertPreservesSubstantiveTerms(
				"lecture teaching answer",
				broadTeachingReply,
				oneHighlightTeachingRequest,
				[
					/Bayesian Deep Learning/,
					/Standard training finds one weight vector/,
					/p\(W \| D\) =/,
					/\\int p\(y\|x,W\)p\(W\|D\)dW/,
					/Hamiltonian Monte Carlo/,
					/Want me to walk through Metropolis-Hastings next\?/,
				],
				[/Let me read more/i, /Let me record the core concept/i, /^---$/m],
			);
			assert.equal(
				shouldRecordFallbackOpenCheckForTest(oneHighlightTeachingRequest, sanitizedTeachingReply),
				false,
				"source-marker retry turns should not create fallback open checks",
			);
			assertPreservesSubstantiveTerms(
				"API documentation answer",
				[
					"Now I have the page content.",
					"",
					"## Fetch request flow",
					"",
					"| Step | Detail |",
					"| --- | --- |",
					"| Create request | Build a Request object or pass a URL. |",
					"| Await response | Check `response.ok` before parsing JSON. |",
					"",
					"```js",
					"const response = await fetch(url);",
					"```",
				].join("\n"),
				null,
				[/Fetch request flow/, /\| Create request \|/, /response\.ok/, /const response = await fetch\(url\);/],
				[/Now I have the page content/i],
			);
			const mdnLiveStyleReply = assertPreservesSubstantiveTerms(
				"live documentation answer",
				[
					"Let me create the highlights and notes for each stageHere's how the Fetch API request/response flow works, based on the page's structure:",
					"",
					"**1. Make a request** — Call `fetch(url)`.",
					"**2. Promise fulfillment** — The browser receives the response status and headers before the body.",
					"**3. Check the status** — Use `response.ok` or `response.status` before reading the body.",
					"Want me to walk through any",
				].join("\n\n"),
				null,
				[/^Here's how the Fetch API request\/response flow works/m, /Call `fetch\(url\)`/, /response status and headers/, /response\.ok/],
				[/Let me create the highlights/i, /Want me to walk through any/i],
			);
			assert.doesNotMatch(mdnLiveStyleReply, /^(?:Let me|Want me)/im, "live documentation cleanup should not leave the process prefix or incomplete trailing prompt");
			const midSentenceProcessReply = assertPreservesSubstantiveTerms(
				"mid-sentence source planning answer",
				[
					"This page teaches the comparison directly. Let me mark the key passages.Here's how the page compares the methods:",
					"",
					"## Rejection sampling",
					"Rejection sampling draws independent candidates and needs a global bound M.",
					"",
					"## Metropolis-Hastings",
					"Metropolis-Hastings uses a conditional Markov chain proposal and avoids that global M.",
				].join("\n"),
				null,
				[/This page teaches the comparison directly\. Here's how the page compares the methods:/, /Rejection sampling draws independent candidates/, /conditional Markov chain proposal/],
				[/Let me mark the key passages/i],
			);
			assert.doesNotMatch(midSentenceProcessReply, /passages\.Here's/i, "mid-sentence process cleanup should repair glued answer text");
			assertPreservesSubstantiveTerms(
				"news explainer answer",
				[
					"Good, OK, Here's what the article says:",
					"",
					"- The rule phases in during 2026, starting with large platforms.",
					"- The enforcement section says civil penalties can apply after a warning period.",
					"- A later paragraph says small businesses get a delayed deadline.",
				].join("\n"),
				null,
				[/large platforms/, /civil penalties/, /small businesses get a delayed deadline/],
				[/^Good,\s*OK/i],
			);
			assertPreservesSubstantiveTerms(
				"math derivation answer",
				[
					"I'll first read the page content to find the derivation.",
					"## Bayes from conditional probability",
					"",
					"Start with p(A | B) = p(A and B) / p(B).",
					"Because p(A and B) = p(B | A)p(A), substitute and get p(A | B) = p(B | A)p(A) / p(B).",
				].join("\n"),
				null,
				[/^## Bayes from conditional probability/m, /p\(A \| B\) = p\(A and B\) \/ p\(B\)/, /p\(B \| A\)p\(A\) \/ p\(B\)/],
				[/I'll first read/i],
			);
			assertPreservesSubstantiveTerms(
				"comparison answer with a wide table",
				[
					"Here's how the page distinguishes them.",
					"",
					"| Feature | Rejection sampling | Metropolis-Hastings |",
					"| --- | --- | --- |",
					"| Proposal | Independent proposal distribution q(x). | Conditional Markov chain proposal q(x' | x_t). |",
					"| Main issue | Needs a global bound M. | Still has rejection, but avoids the global M. |",
				].join("\n"),
				null,
				[/\| Feature \| Rejection sampling \| Metropolis-Hastings \|/, /Independent proposal distribution/, /Conditional Markov chain proposal/, /global bound M/],
			);
			const failedHighlightProcessReply = buildFinalAssistantReplyForTest(
				"Now let me get the visible text for the section to find exact wording for highlights.Good — the visible text has the key material.",
				new Error("Onhand could not create a source highlight after several attempts."),
				oneHighlightTeachingRequest,
			);
			assert.match(
				failedHighlightProcessReply,
				/^Error: Onhand could not create a source highlight after several attempts\.$/,
				"failed turns with only process text should collapse to the actionable error",
			);
			const abortedNavigationLoopReply = buildFinalAssistantReplyForTest(
				[
					"The page is only 4% scrolled — there's much more below.",
					"Good, the page has dedicated sections.",
					"The page appears to be a slides-based lecture.",
					"The page is scrollable — let me navigate to the relevant sections.",
					"This looks like a slide-based lecture. Let me navigate to the sections on these methods.",
				].join("\n\n"),
				new Error("Request was aborted."),
				oneHighlightTeachingRequest,
			);
			assert.match(abortedNavigationLoopReply, /^Error: Request was aborted\.$/, "aborted navigation-loop replies should collapse to the actual error");
			const cleanShortCheck = sanitizeAssistantVisibleReplyForTest(
				"Scaling keeps the softmax from saturating.\n\nHere's a short check: Why does scaling help attention stay stable?",
				{ learningMode: true, toolTraces: [] },
			);
			assert.match(cleanShortCheck, /Here's a short check: Why does scaling help attention stay stable\?$/, "tiny cleanup should preserve check wording instead of rewriting it");
			assert.equal(
				shouldRecordFallbackOpenCheckForTest({ learningMode: true, toolTraces: [] }, cleanShortCheck),
				true,
				"short clean checks may still be tracked as fallback open checks",
			);
			assert.equal(
				shouldRecordFallbackOpenCheckForTest(
					{ learningMode: true, toolTraces: [] },
					`${"word ".repeat(230)}\n\nCheck: Why does scaling help attention stay stable?`,
				),
				false,
				"long answers should not create fallback open checks",
			);
			const longOnPageNote =
				"Instead of one big attention pass, Multi-Head Attention runs h=8 separate attention heads in parallel on projected Q/K/V so different relationships are not averaged away. The sidebar answer explains the full mechanism and formulas.";
	const compactedOnPageNote = compactOnPageNoteTextForTest(longOnPageNote);
	assert.equal(compactedOnPageNote.length <= 280, true, "on-page notes should be clamped to the marginal note budget");
	assert.equal(compactedOnPageNote.includes("sidebar answer"), false, "on-page notes should leave fuller explanation out of the PDF margin");
	assert.equal(
		compactOnPageNoteTextForTest("Eight heads preserve different relationships. The sidebar has the details."),
		"Eight heads preserve different relationships.",
		"on-page notes should drop sentences that defer to the sidebar",
	);
	assert.equal(
		compactOnPageNoteTextForTest(
			"Valid as a regression check, but overclaims if the manifest is self-derived. Reword “free” to mean free to execute, not free to author.",
		),
		"Valid as a regression check, but overclaims if the manifest is self-derived. Reword “free” to mean free to execute, not free to author.",
		"a second actionable sentence within the budget must survive — it is the what-to-change payload of a review note",
	);
	assert.equal(
		shouldRequirePdfAnchorRetryForTest({
			...pdfReadWithoutAnchorsRequest,
			toolTraces: [
				...pdfReadWithoutAnchorsRequest.toolTraces,
				{ toolName: "browser_highlight_text", state: "complete", resultSummary: "Highlighted text" },
				{ toolName: "browser_show_note", state: "complete", resultSummary: "Added note" },
			],
		}),
		false,
		"completed PDF highlights and notes should satisfy the anchor requirement",
	);
	assert.equal(
		shouldRequirePdfAnchorRetryForTest({ ...pdfReadWithoutAnchorsRequest, displayPrompt: "What does this mean? Do not add highlights or notes." }),
		false,
		"explicit no-page-change prompts should not trigger the PDF anchor retry",
	);
	assert.equal(
		shouldRequirePdfAnchorRetryForTest({ ...pdfReadWithoutAnchorsRequest, pdfAnchorRetry: true }),
		false,
		"the PDF anchor retry should be one-shot",
	);
	assert.equal(shouldDeferPdfViewerForVisibleSelectionPrompt("What does this mean?"), true);
	assert.equal(shouldDeferPdfViewerForVisibleSelectionPrompt("Who are the people I highlighted?"), false);
	assert.equal(
		buildVisiblePdfSelectionFirstPassGuardResultForTest("browser_navigate", "navigate", "Who are the people I highlighted?", true)?.guardrail?.kind,
		"visible_pdf_selection_first_pass",
		"selection-first PDF turns should hard-block navigation if a model requests it anyway",
	);
	assert.equal(
		buildVisiblePdfSelectionFirstPassGuardResultForTest(
			"browser_open_pdf_in_onhand_viewer",
			"open_pdf_in_onhand_viewer",
			"What does this mean?",
			true,
		),
		null,
		"selection-first PDF turns should allow viewer handoff for unknown-selection recovery",
	);
	const transferredPdfSelectionTraces = [
		{
			toolName: "browser_open_pdf_in_onhand_viewer",
			state: "complete",
			resultDetails: {
				selectionHandoff: {
					ok: true,
					text: "Multi-Head Attention",
					pageNumber: 2,
				},
			},
			resultSummary: "Already open PDF in Onhand viewer\nTransferred selected text (p. 2):\nMulti-Head Attention",
		},
	];
	assert.equal(
		buildVisiblePdfSelectionFirstPassGuardResultForTest(
			"browser_pdf_search",
			"pdf_search",
			"What does this mean?",
			true,
			transferredPdfSelectionTraces,
		),
		null,
		"selection-first PDF turns should allow PDF search once selected text is transferred",
	);
	assert.equal(
		buildVisiblePdfSelectionFirstPassGuardResultForTest(
			"browser_pdf_read_pages",
			"pdf_read_pages",
			"What does this mean?",
			true,
			transferredPdfSelectionTraces,
		),
		null,
		"selection-first PDF turns should allow reading PDF pages once selected text is transferred",
	);
	assert.equal(
		buildVisiblePdfSelectionFirstPassGuardResultForTest(
			"browser_pdf_jump_to_page",
			"pdf_jump_to_page",
			"What does this mean?",
			true,
			transferredPdfSelectionTraces,
		),
		null,
		"selection-first PDF turns should allow jumping to relevant PDF pages once selected text is transferred",
	);
	const destructiveClearGuard = buildVisiblePdfSelectionFirstPassGuardResultForTest(
		"browser_clear_annotations",
		"clear_annotations",
		"What does this mean?",
		true,
		transferredPdfSelectionTraces,
	);
	assert.equal(
		destructiveClearGuard?.guardrail?.kind,
		"visible_pdf_selection_first_pass",
		"selection-first PDF turns should still block destructive annotation clearing",
	);
	assert.match(destructiveClearGuard?.guardrail?.message || "", /selected PDF text is already available on page 2/i);
	assert.match(
		formatToolResultForModel("browser_pdf_search", { details: destructiveClearGuard }),
		/selected PDF text is already available on page 2/i,
		"PDF guardrails must render the guard message instead of a fake no-matches result",
	);
	assert.equal(
		buildVisiblePdfSelectionFirstPassGuardResultForTest(
			"browser_open_pdf_in_onhand_viewer",
			"open_pdf_in_onhand_viewer",
			"What does this mean?",
			true,
			transferredPdfSelectionTraces,
		)?.guardrail?.kind,
		"visible_pdf_selection_first_pass",
		"selection-first PDF turns should block redundant viewer opens once selected text is transferred",
	);
	assert.equal(
		pdfSelectionDeepToolNames.includes("browser_open_pdf_in_onhand_viewer"),
		true,
		"PDF selection prompts should keep viewer handoff available when deeper/viewer reading is requested",
	);
	assert.equal(answerAllToolNames.includes("browser_get_visible_region_image"), true, "explicit port smoke should expose all browser tools");
	assert.equal(genericSmokeToolNames.includes("browser_get_visible_region_image"), true, "the ungated tool registry exposes this tool for every prompt; prompt policy and guards govern its use");
	assert.equal(genericSmokeToolNames.includes("browser_run_js"), true, "runtime JS is gated only by the advanced runtime inspection setting");
	assert.equal(noPageChangeToolNames.includes("browser_extract_content"), true, "no-page-change prompts still need read tools");
	assert.equal(noPageChangeToolNames.includes("browser_highlight_text"), true, "no-page-changes is enforced by prompt policy and marker suppression, not tool stripping");
	assert.equal(noPageChangeToolNames.includes("browser_show_note"), true, "no-page-changes is enforced by prompt policy and marker suppression, not tool stripping");
	assert.equal(noPageChangeToolNames.includes("browser_capture_state"), true, "no-page-changes is enforced by prompt policy and marker suppression, not tool stripping");
	assert.equal(noPageChangeToolNames.includes("browser_restore_state"), true, "no-page-changes is enforced by prompt policy and marker suppression, not tool stripping");
	assert.equal(highlightWithoutNotesToolNames.includes("browser_highlight_text"), true, "explicit highlight prompts must keep the highlighter even when notes are forbidden");
	assert.equal(highlightWithoutNotesToolNames.includes("browser_show_note"), true, "no-page-changes is enforced by prompt policy and marker suppression, not tool stripping");
	assert.equal(answerOnlySectionValueToolNames.includes("browser_highlight_text"), true, "the ungated tool registry exposes this tool for every prompt; prompt policy and guards govern its use");
	assert.equal(answerOnlySectionValueToolNames.includes("browser_show_note"), true, "the ungated tool registry exposes this tool for every prompt; prompt policy and guards govern its use");
	assert.equal(answerOnlySectionValueToolNames.includes("browser_navigate"), true, "the ungated tool registry exposes this tool for every prompt; prompt policy and guards govern its use");
	assert.equal(cachedFollowupToolNames.includes("browser_extract_content"), true, "extraction stays available; redundant re-extraction is discouraged by prompt policy and guards");
	assert.equal(cachedFollowupToolNames.includes("browser_get_visible_text"), true, "same-page cached followups should retain lightweight read tools");
	assert.equal(exactCachedFollowupToolNames.includes("browser_extract_content"), true, "exact formula followups should keep extraction available even with cached context");
	assert.equal(exactCachedFollowupToolNames.includes("browser_get_visible_text"), true, "the ungated tool registry exposes this tool for every prompt; prompt policy and guards govern its use");
	assert.equal(tableCachedFollowupToolNames.includes("browser_extract_content"), true, "table/value followups should keep full extraction available even with cached context");
	assert.equal(tableCachedFollowupToolNames.includes("browser_get_visible_text"), true, "the ungated tool registry exposes this tool for every prompt; prompt policy and guards govern its use");
	assert.equal(cachedComparisonFollowupToolNames.includes("browser_extract_content"), true, "cached comparison followups should keep extraction available for offscreen section coverage");
	assert.equal(cachedComparisonFollowupToolNames.includes("browser_highlight_text"), true, "cached comparison followups should still be able to create source highlights");
	assert.equal(cachedComparisonFollowupToolNames.includes("browser_show_note"), true, "cached comparison followups should be able to add one concise comparison note");
	assert.match(priorPageContext, /Session page context already read/);
	assert.match(priorPageContext, /Activation Functions/);
	assert.match(priorPageContext, /ReLU with Original Transformer/);
	assert.doesNotMatch(priorPageContext, /Early page excerpt/);
	assert.equal(exactPriorPageContext, "", "exact formula prompts should not inject truncated cached page context");
	assert.match(priorDocContextWithActiveTabDrift, /prior page in this session/);
	assert.match(priorDocContextWithActiveTabDrift, /docs\.google\.com/);
	assert.match(priorDocContextWithActiveTabDrift, /iMac took the same chip/);
	assert.equal(unrelatedActiveTabShouldNotUsePriorDocContext, "", "prior document context should not override an unrelated current-page question");
	assert.equal(answerToolNames.includes("browser_pdf_search"), true, "PDF tools are part of the ungated registry");
	assert.equal(debugToolNames.includes("browser_collect_console"), true, "debug prompts should get console inspection");
	assert.equal(debugToolNames.includes("browser_run_js"), true, "runtime JS is gated only by the advanced runtime inspection setting");
	assert.equal(explicitRuntimeToolNames.includes("browser_run_js"), true, "explicit JavaScript prompts should expose browser_run_js");
	assert.equal(dynamicRuntimeToolNames.includes("browser_run_js"), true, "dynamic runtime-state prompts should expose browser_run_js");
	assert.equal(disabledExplicitRuntimeToolNames.includes("browser_run_js"), false, "disabled advanced runtime inspection should hide browser_run_js even for explicit JavaScript prompts");
	assert.equal(comparisonToolNames.includes("browser_list_tabs"), true, "explicit cross-tab comparison prompts should get tab tools");
	assert.equal(comparisonToolNames.includes("browser_activate_tab"), true);
	assert.equal(explicitAgreementToolNames.includes("browser_list_tabs"), true, "explicit multi-document agreement prompts should get tab tools");
	assert.equal(agreementToolNames.includes("browser_list_tabs"), true, "cross-tab retrieval is standard: every prompt gets the tab tools");
	assert.equal(agreementToolNames.includes("browser_navigate"), true, "cross-tab retrieval is standard: every prompt gets the tab tools");
	assert.equal(differenceToolNames.includes("browser_list_tabs"), true, "cross-tab retrieval is standard: every prompt gets the tab tools");
	assert.equal(differenceToolNames.includes("browser_navigate"), true, "cross-tab retrieval is standard: every prompt gets the tab tools");
	assert.equal(citationToolNames.includes("browser_pdf_find_citation"), true, "citation prompts should get the citation lookup tool");
	assert.equal(citationToolNames.includes("browser_open_pdf_in_onhand_viewer"), true);
	assert.equal(textbookSearchToolNames.includes("browser_textbook_search"), true, "textbook-wide lookup prompts should get reader search");
	assert.equal(textbookSearchToolNames.includes("browser_navigate"), true, "textbook-wide lookup prompts should be able to reload a broken reader");
	assert.equal(genericTextbookSearchToolNames.includes("browser_textbook_search"), true, "generic online-book lookup prompts should get reader search");
	assert.equal(genericTextbookSearchToolNames.includes("browser_navigate"), true, "generic online-book lookup prompts should be able to reload a broken reader");
	assert.equal(pdfContextToolNames.includes("browser_open_pdf_in_onhand_viewer"), true);
	assert.equal(pdfContextToolNames.includes("browser_pdf_search"), true);
	assert.equal(pdfContextToolNames.includes("browser_pdf_read_pages"), true);
	assert.equal(pdfContextToolNames.includes("browser_pdf_jump_to_page"), true);
	assert.equal(externalSourceToolNames.includes("browser_navigate"), true);
	assert.equal(externalSourceToolNames.includes("browser_activate_tab"), true);
	assert.equal(externalSourceToolNames.includes("browser_click_text"), true, "the ungated tool registry exposes this tool for every prompt; prompt policy and guards govern its use");
	assert.equal(linkedNotesToolNames.includes("browser_navigate"), true, "linked-note requests should be able to open note URLs");
	assert.equal(linkedNotesToolNames.includes("browser_list_tabs"), true, "linked-note requests should be able to recover an already-open index tab");
	assert.equal(linkedNotesToolNames.includes("browser_activate_tab"), true, "linked-note requests should be able to activate an already-open index tab");
	assert.equal(linkedNotesToolNames.includes("browser_find_elements"), true, "linked-note requests should be able to discover link elements");
	assert.equal(linkedNotesToolNames.includes("browser_click"), true, "linked-note requests should be able to click precise link selectors");
	assert.equal(linkedNotesToolNames.includes("browser_click_text"), true, "linked-note requests should be able to click visible note links");
	assert.equal(linkedNotesFollowupToolNames.includes("browser_list_tabs"), true, "other-note followups should be able to find the original notes index tab");
	assert.equal(linkedNotesFollowupToolNames.includes("browser_activate_tab"), true, "other-note followups should be able to switch back to the original notes index tab");
	assert.equal(linkedNotesFollowupToolNames.includes("browser_find_elements"), true, "other-note followups should be able to discover additional note links");
	assert.equal(linkedNotesOtherPageVoiceToolNames.includes("browser_list_tabs"), true, "voice asks about notes on another page should get the full tab inventory");
	assert.equal(linkedNotesOtherPageVoiceToolNames.includes("browser_activate_tab"), true, "voice asks about notes on another page should be able to recover the course tab");
	assert.equal(linkedNotesOtherPageVoiceToolNames.includes("browser_find_elements"), true, "voice asks about notes on another page should be able to inspect note links");
	for (const [prompt, toolNames] of [
		["read current page", readCurrentPageToolNames],
		["review current article", reviewCurrentArticleToolNames],
		["scan current document", scanCurrentDocumentToolNames],
	]) {
		assert.equal(toolNames.includes("browser_list_tabs"), true, `${prompt} prompts get the ungated registry including tab enumeration`);
		assert.equal(toolNames.includes("browser_navigate"), true, `${prompt} prompts get the ungated registry including navigation`);
		assert.equal(toolNames.includes("browser_click"), true, `${prompt} prompts get the ungated registry including interaction tools`);
		assert.equal(toolNames.includes("browser_type"), true, `${prompt} prompts get the ungated registry including interaction tools`);
	}
	assert.equal(learningToolNames.includes("onhand_record_learning_event"), true);
	assert.equal(learningToolNames.includes("browser_list_tabs"), true, "Learning Mode should always expose complete tab inventory");
	assert.equal(learningToolNames.includes("browser_activate_tab"), true, "Learning Mode should be able to show a relevant source tab");
	assert.equal(learningToolNames.includes("browser_navigate"), true, "Learning Mode should be able to follow a relevant course/index link");
	assert.equal(learningToolNames.includes("browser_click_text"), true, "Learning Mode should be able to open a relevant linked note");
	const repeatedLearningToolNames = getToolNamesForTest("How does proposal sampling work?", true, contract.learnerState);
	assert.equal(repeatedLearningToolNames.includes("onhand_record_learning_event"), true);
	assert.equal(repeatedLearningToolNames.includes("browser_scroll_to_annotation"), true);
	assert.equal(repeatedLearningToolNames.includes("browser_show_note"), true, "repeated-concept refreshers keep the full registry; reuse guidance lives in prompt policy");
	assert.equal(repeatedLearningToolNames.includes("browser_extract_content"), true, "repeated-concept refreshers keep the full registry; reuse guidance lives in prompt policy");
	const unifiedProfile = buildReasoningProfileForTest({}, "My textbook says this collapse is a classic example of resonance. Is that actually right?", [], false);
	assert.equal(unifiedProfile.mode, "grounded", "ordinary questions all take the single grounded profile — no fast/balanced/deep depth dial");
	assert.match(unifiedProfile.promptPolicy, /read the clearly related open tab by tabId/);
	assert.doesNotMatch(unifiedProfile.promptPolicy, /keep extra page inspection minimal/, "the old fast-lane inspection-minimizing pressure must be gone");
	assert.equal(unifiedProfile.maxTokens >= 1100, true, "verification turns must not shrink to the old fast-lane budget");
	assert.equal(unifiedProfile.reasoningEffort, "low");
	assert.equal(buildReasoningProfileForTest({}, "what is this term?", [], true).mode, "grounded", "learning-mode conceptual questions also take the unified profile");
	assert.equal(
		buildReasoningProfileForTest({}, "Teach me what this page says about photosynthesis", [], false).mode,
		"compact-teaching",
		"the compact teaching deliverable profile survives the lane collapse",
	);
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
	const { applyLearningEvent, findAnsweredOpenLearningCheckForTest, buildLearnerStatePromptSummary, createEmptyLearnerState, normalizeLearnerState, setLearnerStateMode } = __browserRuntimeTest || {};
	const { readFile: readPhase1Source } = await import("node:fs/promises");
	const browserRuntimeSourceTextForPhase1 = await readPhase1Source(new URL("../packages/browser-extension/src/browser-runtime.ts", import.meta.url), "utf8");
	assert.equal(typeof createEmptyLearnerState, "function", "browser runtime learner-state factory export is missing");
	assert.equal(typeof normalizeLearnerState, "function", "browser runtime learner-state normalizer export is missing");
	assert.equal(typeof applyLearningEvent, "function", "browser runtime learning-event reducer export is missing");
	assert.equal(typeof setLearnerStateMode, "function", "browser runtime learner-state mode export is missing");
	assert.equal(typeof findAnsweredOpenLearningCheckForTest, "function", "browser runtime check-answer detection export is missing");

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
	const derivativeFollowup = findAnsweredOpenLearningCheckForTest(learnerState, "I think the derivative measures rate of change.");
	assert.equal(derivativeFollowup?.checkId, "check-derivative-1", "related answer-shaped follow-up should detect the matching open check");

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
	const unrelatedCalculusFollowup = findAnsweredOpenLearningCheckForTest(
		staleMdnCheckState,
		"I think the inside derivative is 6x + 7. Is that right? Please help me fix it if needed.",
	);
	assert.equal(unrelatedCalculusFollowup, null, "unrelated answer-shaped prompt must not read as answering a stale open check from another concept");
	const relatedMdnFollowup = findAnsweredOpenLearningCheckForTest(staleMdnCheckState, "I think it would contain reason.");
	assert.equal(relatedMdnFollowup?.checkId, "check-mdn-reason", "related answer-shaped prompt should detect the matching open check");
	const stopwordOnlyFollowup = findAnsweredOpenLearningCheckForTest(staleMdnCheckState, "I think that is what it means.");
	assert.equal(stopwordOnlyFollowup, null, "an all-stopword reply carries no signal and must not read as a check answer");
	const gradingSummary = buildLearnerStatePromptSummary(staleMdnCheckState, "I think it would contain reason.");
	assert.match(gradingSummary, /Grade it on the page/, "an answered check must inject the page-grading directive");
	assert.match(gradingSummary, /checkId check-mdn-reason/, "the grading directive names the check being graded");
	assert.match(gradingSummary, /Judge the answer honestly against the passage/, "grading must be honest and page-grounded");
	assert.match(gradingSummary, /without giving the final answer away/, "wrong answers get coaching, not the final answer");
	assert.match(gradingSummary, /check_resolved/, "the model is told to record the resolution");
	const noAnswerSummary = buildLearnerStatePromptSummary(staleMdnCheckState, "What does Promise.allSettled return?");
	assert.doesNotMatch(noAnswerSummary, /Grade it on the page/, "a fresh question must not trigger check grading");
	assert.doesNotMatch(gradingSummary, /multi-head attention runs several/, "the hardcoded demo-answer paragraph must stay deleted");
	assert.doesNotMatch(
		gradingSummary,
		/browser_scroll_to_annotation on that annotationId/,
		"a check with no saved annotation must not point the model at a nonexistent annotationId",
	);
	assert.match(
		gradingSummary,
		/highlight the exact supporting span with browser_highlight_text/,
		"an unanchored check re-grounds with a fresh highlight instead",
	);
	const anchoredGradingSummary = buildLearnerStatePromptSummary(learnerState, "I think the derivative measures rate of change.");
	assert.match(
		anchoredGradingSummary,
		/browser_scroll_to_annotation on that annotationId/,
		"an anchored check re-grounds by scrolling to its saved annotation",
	);
	{
		const { attachTurnAnchorToLearningCheckEventForTest } = __browserRuntimeTest || {};
		assert.equal(typeof attachTurnAnchorToLearningCheckEventForTest, "function", "learning check anchor attachment export is missing");
		const turnActions = [
			{ type: "annotation", annotationId: "ann-early", detail: "First highlight" },
			{ type: "navigation", url: "https://example.test" },
			{ type: "annotation", annotationId: "ann-latest", detail: "Latest highlight" },
		];
		assert.equal(
			attachTurnAnchorToLearningCheckEventForTest({ kind: "check_opened", checkId: "check-1" }, turnActions).annotationId,
			"ann-latest",
			"an unanchored check_opened must attach the turn's most recent mark",
		);
		assert.equal(
			attachTurnAnchorToLearningCheckEventForTest({ kind: "check_opened", checkId: "check-1", annotationId: "ann-explicit" }, turnActions).annotationId,
			"ann-explicit",
			"an explicit annotationId must never be overridden",
		);
		assert.equal(
			attachTurnAnchorToLearningCheckEventForTest({ kind: "concept_introduced", conceptId: "c1" }, turnActions).annotationId,
			undefined,
			"non-check events are left untouched",
		);
		assert.equal(
			attachTurnAnchorToLearningCheckEventForTest({ kind: "check_opened", checkId: "check-1" }, []).annotationId,
			undefined,
			"a markless turn leaves the check unanchored for the fallback grading branch",
		);
	}
	const metaFollowupSummary = buildLearnerStatePromptSummary(staleMdnCheckState, "Didn't I already answer that?");
	assert.doesNotMatch(metaFollowupSummary, /Grade it on the page/, "a repeat complaint must not be graded as a new answer");
	assert.match(metaFollowupSummary, /Do not grade this message as a new answer/, "the meta-followup gets the acknowledgement directive");
	assert.match(
		metaFollowupSummary,
		/resolve the check as partial or correct based on the user's earlier answer/,
		"the meta-followup resolves the check from the earlier answer, not the complaint text",
	);
	assert.match(metaFollowupSummary, /check_resolved/, "the meta-followup still records an honest resolution");

	{
		const { humanizeProviderErrorMessageForTest, setLearnerStateModeForTest } = __browserRuntimeTest || {};
		assert.equal(
			humanizeProviderErrorMessageForTest('429: {"error":{"message":"You\u2019ve reached today\u2019s Onhand Free limit. It resets tomorrow."}}'),
			"You\u2019ve reached today\u2019s Onhand Free limit. It resets tomorrow.",
			"provider error JSON envelopes must unwrap to their inner message",
		);
		assert.equal(humanizeProviderErrorMessageForTest("The model returned an empty answer."), "The model returned an empty answer.");
		assert.equal(humanizeProviderErrorMessageForTest("500: not-json{"), "500: not-json{");
		const toggledOff = setLearnerStateModeForTest(staleMdnCheckState, "answer");
		assert.equal(toggledOff.openChecks.length, 0, "toggling Learning mode off resets open checks (behavior doc \u00a75.4)");
		assert.equal(toggledOff.conceptsIntroduced.length, 0, "toggling Learning mode off resets concepts");
		const runtimeSourceForNets = String(browserRuntimeSourceTextForPhase1 || "");
		assert.match(
			runtimeSourceForNets,
			/!activeRequest\.learningResearchPlan\?\.requiresWorkspaceResearch && shouldRequireLearningWorkspaceEvidence/,
			"the workspace-evidence net must arm whenever the planner did not affirmatively require research (a false flag must not disarm both nets)",
		);
		assert.match(
			runtimeSourceForNets,
			/name what made the request look like graded work/,
			"settled-rule drift: \u00a75.3 misclassification guard lost its prompt sentence",
		);
		assert.match(
			runtimeSourceForNets,
			/clearly identified the material as their own non-graded example/,
			"settled-rule drift: \u00a75.3 own-material carve-out lost its prompt sentence",
		);
	}

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

async function assertModelIntentClassifierDefaultsOn() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	// Fresh install (no stored classifier setting) → classifier ON by default.
	globalThis.chrome.storage.local.data = {};
	let runtime = createOnhandBrowserRuntime(createReplayHost());
	let settings = await runtime.getSettings();
	assert.equal(settings.experimentalModelLaneClassifier, true, "model intent classifier should default ON for a fresh install");
	// Legacy stored false with NO migration marker → adopt the new default (ON),
	// because that false is an artifact of the old default, not a real opt-out.
	globalThis.chrome.storage.local.data = {
		onhandBrowserRuntime: {
			settings: { experimentalModelLaneClassifier: false, aiProvider: "onhand-smoke", aiModel: "onhand-smoke-1", aiApiKey: "test", authMode: "api-key" },
			currentSessionId: "",
		},
	};
	runtime = createOnhandBrowserRuntime(createReplayHost());
	settings = await runtime.getSettings();
	assert.equal(settings.experimentalModelLaneClassifier, true, "legacy false without the migration marker must adopt the new default");
	// The migration must PERSIST to raw storage — options.js reads raw storage, so
	// an in-memory-only flip would leave the options checkbox (and its save) stale.
	const persisted = globalThis.chrome.storage.local.data.onhandBrowserRuntime.settings;
	assert.equal(persisted.experimentalModelLaneClassifier, true, "migration must persist classifier=true to raw storage");
	assert.equal(persisted.modelLaneClassifierDefaultMigrated, true, "migration must persist the marker to raw storage");

	// A stored false WITH the marker is an authoritative opt-out and is respected.
	globalThis.chrome.storage.local.data = {
		onhandBrowserRuntime: {
			settings: { experimentalModelLaneClassifier: false, modelLaneClassifierDefaultMigrated: true, aiProvider: "onhand-smoke", aiModel: "onhand-smoke-1", aiApiKey: "test", authMode: "api-key" },
			currentSessionId: "",
		},
	};
	runtime = createOnhandBrowserRuntime(createReplayHost());
	settings = await runtime.getSettings();
	assert.equal(settings.experimentalModelLaneClassifier, false, "a stored false WITH the migration marker is an authoritative opt-out");
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
		prompt: "I think the Alpha smoke content plays the role of confirming extraction works.",
		displayPrompt: "[Voice] I think the Alpha smoke content plays the role of confirming extraction works.",
		source: "realtime-voice-direct-answer",
		attachments: [],
		learningMode: true,
	});
	const completedState = await waitForRuntimeCompletion(runtime);
	assert.equal(completedState?.activeRequestId, null, "runtime did not complete voice check-answer regression");
	// Grading happens in the real turn now (behavior doc v2.9): a model that
	// does not record an honest check_resolved leaves the check OPEN. The old
	// shortcut auto-resolved it as "correct" without evaluation — the false
	// resolution this asserts against.
	assert.equal(completedState.learnerState.openChecks.length, 1, "an ungraded check answer must leave the check open, never auto-resolve it");
	assert.equal(
		completedState.learnerState.responses.some((response) => response?.checkId === "check-alpha-smoke"),
		false,
		"no verdict may be recorded for a check the model never graded",
	);
	assert.ok(String(completedState.turns.at(-1)?.reply || "").length > 0, "the check-answer turn still produces a reply");
	assert.equal(
		host.calls.filter((call) => call.name === "highlight_text").length,
		highlightCallsBeforeAnswer,
		"answering an open check should not create a replacement highlight",
	);
}

async function assertFetchStateSkipsPageCaptureDuringActiveRequest() {
	const { readFile } = await import("node:fs/promises");
	const source = await readFile(new URL("../packages/browser-extension/background.js", import.meta.url), "utf8");
	const handlerStart = source.indexOf('message?.type === "sidebar:fetch-state"');
	assert.notEqual(handlerStart, -1, "fetch-state handler not found in background.js");
	const handlerBlock = source.slice(handlerStart, handlerStart + 2600);
	const gateIndex = handlerBlock.indexOf("if (state.activeRequestId)");
	const captureIndex = handlerBlock.indexOf('handleCommand("capture_state"');
	assert.notEqual(
		gateIndex,
		-1,
		"fetch-state must gate its page capture on state.activeRequestId: state polling during a turn queues capture_state behind the turn's tool calls on the per-tab command chain, and every later command's budget pays for the pileup",
	);
	assert.notEqual(captureIndex, -1, "fetch-state page capture not found");
	assert.ok(gateIndex < captureIndex, "the active-request gate must come before the capture_state call");
}

async function assertGateAwareDraftBuffering() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime, __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const { shouldBufferAssistantDraftUntilSettledForTest } = __browserRuntimeTest || {};
	assert.equal(typeof shouldBufferAssistantDraftUntilSettledForTest, "function", "draft buffering predicate export is missing");
	assert.equal(
		shouldBufferAssistantDraftUntilSettledForTest({ displayPrompt: "Teach me what this page says about fetch." }),
		true,
		"gate-eligible teaching prompts must buffer the draft until the turn settles",
	);
	assert.equal(
		shouldBufferAssistantDraftUntilSettledForTest({ displayPrompt: "What time zone does this meeting use?" }),
		false,
		"conversational prompts have no finalize gates and keep streaming",
	);
	assert.equal(
		shouldBufferAssistantDraftUntilSettledForTest({ displayPrompt: "Teach me this page but do not add highlights or notes." }),
		false,
		"no-page-changes prompts disarm the marker gates and keep streaming",
	);
	assert.equal(
		shouldBufferAssistantDraftUntilSettledForTest({
			displayPrompt: "What does the introduction say?",
			toolTraces: [{ toolName: "browser_pdf_read_pages", state: "complete" }],
		}),
		true,
		"a completed PDF read arms the PDF-anchor gate mid-turn and starts buffering",
	);

	// End-to-end: a gate-eligible teaching turn must never render provisional
	// draft text before the turn settles (P8 buffer-until-final, scoped). The
	// smoke teaching script streams prose before its batched mark calls, so at
	// tool-execution time the pre-fix draft would already be visibly non-empty
	// — the host wrapper observes the UI state at exactly that moment.
	const host = createReplayHost();
	const runtime = createOnhandBrowserRuntime(host);
	const midTurnPendingDrafts = [];
	const originalRunCommand = host.runCommand.bind(host);
	host.runCommand = async (name, args) => {
		const midState = await runtime.getState();
		for (const message of midState.messages || []) {
			if (String(message?.id || "").startsWith("assistant:") && message?.pending && String(message?.text || "").trim()) {
				midTurnPendingDrafts.push(`${name}: ${message.text}`);
			}
		}
		return originalRunCommand(name, args);
	};
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-learning-1",
		aiApiKey: "test",
		authMode: "api-key",
		learningMode: true,
	});
	await runtime.submitPrompt({
		prompt: "Teach this page concept in Learning Mode.",
		displayPrompt: "Teach this page concept in Learning Mode.",
		attachments: [],
		learningMode: true,
	});
	const state = await waitForRuntimeCompletion(runtime);
	assert.equal(state?.activeRequestId, null, "runtime did not complete the buffered teaching turn");
	assert.ok(host.calls.some((call) => call.name === "highlight_text"), "the buffered teaching turn still places its marks");
	assert.deepEqual(midTurnPendingDrafts, [], "a gate-eligible teaching turn must never render provisional draft text before settle");
	assert.ok(String(state.turns.at(-1)?.reply || "").length > 0, "the buffered turn still renders its settled reply");
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

async function assertListSessionsReturnsAllSessionsByDefault() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const sessions = Object.fromEntries(
		Array.from({ length: 25 }, (_, index) => {
			const suffix = String(index).padStart(2, "0");
			const session = {
				id: `session_${suffix}`,
				name: `Session ${suffix}`,
				createdAt: `2026-05-01T00:${suffix}:00.000Z`,
				updatedAt: `2026-05-02T00:${suffix}:00.000Z`,
				messages: [],
				turns: [],
				pageActions: [],
				artifactIds: [],
			};
			return [session.id, session];
		}),
	);
	globalThis.chrome.storage.local.data.onhandBrowserRuntime = {
		settings: {
			aiProvider: "onhand-smoke",
			aiModel: "onhand-smoke-1",
			aiApiKey: "test",
			authMode: "api-key",
		},
		currentSessionId: "session_00",
	};
	globalThis.chrome.storage.local.data.onhandBrowserSessions = sessions;

	const runtime = createOnhandBrowserRuntime(createReplayHost());
	const allSessions = await runtime.listSessions();
	assert.equal(allSessions.sessions.length, 25, "listSessions() should return every saved session by default");
	assert.equal(allSessions.totalCount, 25);
	assert.equal(allSessions.hasMore, false);
	assert.equal(
		allSessions.sessions.some((session) => session.id === "session_24"),
		true,
		"full session list should include sessions beyond the previous 20-item cap",
	);

	const cappedSessions = await runtime.listSessions(20);
	assert.equal(cappedSessions.sessions.length, 20, "positive listSessions(limit) should remain capped for diagnostic callers");
	assert.equal(cappedSessions.totalCount, 25);
	assert.equal(cappedSessions.hasMore, true);
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
	const toolTrace = session.turns[0].toolTraces?.find((trace) => trace.toolName === "browser_highlight_text");
	assert.ok(toolTrace, "session replay should retain detailed tool traces for debugging");
	assert.equal(toolTrace.state, "complete");
	assert.equal(toolTrace.args.text, "Alpha smoke content");
	assert.equal(typeof toolTrace.duration_ms, "number", "tool traces should expose per-tool duration for slow-turn debugging");
	assert.equal(toolTrace.duration_ms >= 0, true, "tool trace duration should be non-negative");
	assert.match(toolTrace.resultSummary, /Highlighted "Alpha smoke content"/);
	assert.equal(toolTrace.resultDetails.annotation.annotationId, "replay-highlight");
	assert.equal(toolTrace.resultDetails.annotation.matchedText, "Alpha smoke content");
	session.artifactIds = [];
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

	const listed = await runtime.listSessions();
	assert.equal(listed.sessions.length, 1);
	assert.equal(listed.sessions[0].id, session.id);
	assert.equal(listed.sessions[0].turnCount, 1);
	assert.equal(listed.sessions[0].highlightCount, 1);
	assert.equal(listed.sessions[0].replayableCount, 1);
	assert.equal(listed.sessions[0].canRestore, true);
	const replay = await runtime.getSessionReplay(session.id);
	assert.equal(
		replay.turns[0].toolTraces.some((trace) => trace.toolName === "browser_highlight_text" && trace.args.text === "Alpha smoke content"),
		true,
		"getSessionReplay should expose persisted tool traces for CLI debugging",
	);

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

async function assertFailedToolTraceSummarizesError() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({ rejectHighlightText: () => true });
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	await runtime.submitPrompt({
		prompt: "Try to highlight Alpha smoke content.",
		displayPrompt: "failed trace smoke",
		attachments: [],
		learningMode: false,
	});
	const completedState = await waitForRuntimeCompletion(runtime);
	assert.equal(completedState?.activeRequestId, null, "runtime did not complete failed-trace regression");
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	const toolTrace = session.turns[0].toolTraces?.find((trace) => trace.toolName === "browser_highlight_text");
	assert.ok(toolTrace, "failed tool should retain a trace entry for CLI debugging");
	assert.equal(toolTrace.state, "error");
	assert.match(toolTrace.resultSummary || "", /^browser_highlight_text failed: No visible text matched: Alpha smoke content/);
	assert.doesNotMatch(toolTrace.resultSummary || "", /Highlighted "Alpha smoke content"/);
	assert.match(toolTrace.error || "", /No visible text matched: Alpha smoke content/);
	assert.equal(session.pageActions.length, 0, "failed highlight should not create replayable page actions");
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
		prompt: "Highlight and explain the selected PDF text.",
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

async function assertRelaxedUrlMatchingFindsRedirectedTab() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime, __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const { relaxedRestorableUrlMatchKeyForTest, restorablePageUrlsMatchRelaxedForTest } = __browserRuntimeTest;

	// Visit markers, scheme, www., trailing slash, and param order are noise…
	assert.equal(
		relaxedRestorableUrlMatchKeyForTest("http://www.example.test/docs/?utm_source=news&b=2&a=1&fbclid=xyz"),
		relaxedRestorableUrlMatchKeyForTest("https://example.test/docs?a=1&b=2"),
	);
	// …while meaningful query params and paths still distinguish pages.
	assert.notEqual(relaxedRestorableUrlMatchKeyForTest("https://example.test/page?id=1"), relaxedRestorableUrlMatchKeyForTest("https://example.test/page?id=2"));
	assert.notEqual(relaxedRestorableUrlMatchKeyForTest("https://example.test/docs/intro"), relaxedRestorableUrlMatchKeyForTest("https://example.test/docs"));
	assert.equal(restorablePageUrlsMatchRelaxedForTest("", "https://example.test/"), false);

	// A saved artifact URL should restore onto an open tab that only differs
	// by redirect noise instead of opening a duplicate tab.
	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 31,
				title: "Docs page",
				url: "https://example.test/docs?b=2&a=1",
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
	session.artifactIds = ["artifact_redirected"];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_redirected: {
				id: "artifact_redirected",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "redirected page",
				tab: { id: 900, windowId: 3, title: "Docs page", url: "http://www.example.test/docs/?utm_source=news&a=1&b=2" },
				page: {
					title: "Docs page",
					url: "http://www.example.test/docs/?utm_source=news&a=1&b=2",
					annotations: [{ annotationId: "ann-docs", kind: "inline", matchedText: "Alpha smoke content" }],
				},
			},
		},
	});
	const restored = await runtime.restoreSession();
	assert.equal(restored.restoredPages.length, 1);
	assert.equal(restored.restoredPages[0].restoredAnnotations, 1, "the annotation should restore onto the redirect-drifted open tab");
	assert.equal(host.calls.some((call) => call.name === "navigate"), false, "a relaxed URL match should not open a duplicate tab");
	assert.equal(host.calls.some((call) => call.name === "highlight_text" && call.args.tabId === 31), true);
}

async function assertSnapshotFallbackWhenNavigationFails() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		tabs: [replaySmokeTab({ id: 7, title: "Unrelated", url: "https://elsewhere.test/" })],
		rejectNavigate: (url) => url.includes("dead.example.test"),
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
	session.artifactIds = ["artifact_dead_url"];
	// A replayable page action for the same dead page: the snapshot fallback
	// must also suppress the page-action replay pass for that target. The
	// action deliberately records the page under redirect noise (scheme, www.,
	// trailing slash, tracking param) relative to the artifact URL — coverage
	// must match relaxed, or the replay pass reopens the dead URL anyway.
	session.pageActions = [
		{
			key: "highlight:dead-ann",
			type: "annotation",
			tabId: 900,
			windowId: 3,
			title: "Gone article",
			url: "http://www.dead.example.test/article/?utm_source=news",
			annotationId: "dead-ann",
			label: "Highlighted text",
			detail: "Saved passage",
			citationText: "Saved passage",
		},
	];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_dead_url: {
				id: "artifact_dead_url",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "gone article",
				tab: { id: 900, windowId: 3, title: "Gone article", url: "https://dead.example.test/article" },
				page: {
					title: "Gone article",
					url: "https://dead.example.test/article",
					annotations: [{ annotationId: "dead-ann", kind: "inline", matchedText: "Saved passage" }],
				},
				outerHTML: '<html><body><p><span data-onhand-highlight-kind="inline">Saved passage</span></p></body></html>',
			},
		},
	});
	const restored = await runtime.restoreSession();
	assert.equal(restored.restoredPages.length, 1, "the snapshot fallback should cover the dead target without a replay retry");
	const page = restored.restoredPages[0];
	assert.equal(page.snapshotFallback?.reason, "navigation-failed");
	assert.match(String(page.snapshotFallback?.viewerUrl || ""), /snapshot-viewer\.html\?artifact=artifact_dead_url/);
	assert.equal(page.restoredAnnotations, 0);
	assert.equal(page.snapshotFallback?.savedAnnotationCount, 1);
	const deadNavigates = host.calls.filter((call) => call.name === "navigate" && String(call.args.url || "").includes("dead.example.test"));
	assert.equal(deadNavigates.length, 1, "the dead URL should be attempted once, not re-attempted by the replay pass");
	const viewerNavigates = host.calls.filter((call) => call.name === "navigate" && String(call.args.url || "").includes("snapshot-viewer.html"));
	assert.equal(viewerNavigates.length, 1, "the snapshot viewer should open exactly once");
}

async function assertSnapshotFallbackWhenContentGone() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		tabs: [replaySmokeTab({ id: 12, title: "Rewritten article", url: "https://example.test/rewritten" })],
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
	session.artifactIds = ["artifact_rewritten"];
	await globalThis.chrome.storage.local.set({
		...storedStoreEntries(store),
		onhandBrowserArtifacts: {
			artifact_rewritten: {
				id: "artifact_rewritten",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				sessionId: session.id,
				label: "rewritten page",
				tab: { id: 12, windowId: 3, title: "Rewritten article", url: "https://example.test/rewritten" },
				page: {
					title: "Rewritten article",
					url: "https://example.test/rewritten",
					annotations: [{ annotationId: "ann-rw", kind: "inline", matchedText: "Sentence that no longer exists" }],
				},
				outerHTML: "<html><body><p>Saved copy</p></body></html>",
			},
		},
	});
	const restored = await runtime.restoreSession();
	const page = restored.restoredPages[0];
	assert.equal(page.snapshotFallback?.reason, "content-missing", "an open page that lost all saved content should fall back to the snapshot");
	assert.equal(page.restoredAnnotations, 0);
	assert.equal(page.failedCount > 0, true, "the highlight failures should stay visible alongside the snapshot fallback");
	const viewerNavigates = host.calls.filter((call) => call.name === "navigate" && String(call.args.url || "").includes("snapshot-viewer.html"));
	assert.equal(viewerNavigates.length, 1);
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
	const fastHost = createReplayHost({
		tabs: [replaySmokeTab({ title: "Lecture PDF", url: "https://example.test/lecture.pdf" })],
	});
	const runtime = createOnhandBrowserRuntime(fastHost);
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
			citationText: "recurrentneural networks",
			annotationId: "stale-pdf-source",
			pdfAnchor,
		},
		{
			key: "note:pdf-source",
			type: "note",
			tabId: 7,
			windowId: 3,
			title: "Lecture PDF",
			url: "https://example.test/lecture.pdf",
			label: "Note",
			detail: "Saved note",
			annotationId: "stale-pdf-note",
			pdfAnchor,
		},
	];
	await globalThis.chrome.storage.local.set(storedStoreEntries(store));

	await runtime.activateAction("highlight:pdf-source");
	const fastScrollIndex = fastHost.calls.findIndex((call) => call.name === "scroll_to_annotation");
	assert.notEqual(fastScrollIndex, -1, "expected live PDF source activation to scroll directly to the saved annotation");
	assert.equal(fastHost.calls.some((call) => call.name === "open_pdf_in_onhand_viewer"), false);
	assert.equal(fastHost.calls.some((call) => call.name === "highlight_text"), false);
	assert.equal(fastHost.calls[fastScrollIndex].args.annotationId, "stale-pdf-source");

	const fallbackHost = createReplayHost({
		tabs: [replaySmokeTab({ title: "Lecture PDF", url: "https://example.test/lecture.pdf" })],
		rejectScrollToAnnotation: () => true,
		highlightAnnotationId: (_text, args) => (args.pdfAnchor ? "pdf-source-restored" : "text-source-restored"),
	});
	const fallbackRuntime = createOnhandBrowserRuntime(fallbackHost);
	await fallbackRuntime.activateAction("highlight:pdf-source");
	const scrollIndex = fallbackHost.calls.findIndex((call) => call.name === "scroll_to_annotation");
	const jumpIndex = fallbackHost.calls.findIndex((call) => call.name === "pdf_jump_to_page");
	assert.notEqual(scrollIndex, -1, "expected source activation to try the saved annotation before replay fallback");
	assert.notEqual(jumpIndex, -1, "stale PDF source activation should jump to the saved page before expensive replay");
	assert.ok(scrollIndex < jumpIndex, "PDF source activation should try direct annotation scroll before page fallback");
	assert.equal(fallbackHost.calls[jumpIndex].args.pageNumber, 1);
	assert.equal("text" in fallbackHost.calls[jumpIndex].args, false, "stale Onhand PDF source jumps should use page anchors, not slow exact text matching");
	assert.deepEqual(fallbackHost.calls[jumpIndex].args.pdfAnchor, pdfAnchor);
	// The fast path must not open the viewer before trying the cheap jump; the
	// replay stage MAY hand off to the viewer afterwards to re-create the mark.
	const fallbackOpenIndex = fallbackHost.calls.findIndex((call) => call.name === "open_pdf_in_onhand_viewer");
	assert.ok(fallbackOpenIndex === -1 || fallbackOpenIndex > jumpIndex, "viewer handoff may only happen at the replay stage, after the fast jump");
	// New contract: when the annotation is verifiably gone after the fast jump
	// (every scroll attempt rejects), activation must fall through and re-create
	// the mark via the anchored replay — landing on the right page with no
	// highlight is the "citation shows nothing" bug.
	const fallbackHighlightIndex = fallbackHost.calls.findIndex((call) => call.name === "highlight_text");
	assert.notEqual(fallbackHighlightIndex, -1, "a stale PDF source whose annotation is gone after the jump must be re-highlighted");
	assert.ok(fallbackHighlightIndex > jumpIndex, "the highlight replay should run after the fast page jump");
	assert.deepEqual(fallbackHost.calls[fallbackHighlightIndex].args.pdfAnchor, pdfAnchor, "the replay should anchor by the saved pdfAnchor, not slow text scanning");

	const staleNoteHost = createReplayHost({
		tabs: [replaySmokeTab({ title: "Lecture PDF", url: "https://example.test/lecture.pdf" })],
		scrollToAnnotationResult: () => ({ targetKind: "annotation" }),
	});
	const staleNoteRuntime = createOnhandBrowserRuntime(staleNoteHost);
	await staleNoteRuntime.activateAction("note:pdf-source");
	const noteScrollIndex = staleNoteHost.calls.findIndex((call) => call.name === "scroll_to_annotation");
	const noteJumpIndex = staleNoteHost.calls.findIndex((call) => call.name === "pdf_jump_to_page");
	assert.notEqual(noteScrollIndex, -1, "expected stale note activation to try paired highlight scroll first");
	assert.notEqual(noteJumpIndex, -1, "stale PDF note activation should jump to the saved page when the note card is missing");
	assert.ok(noteScrollIndex < noteJumpIndex, "stale PDF note activation should try direct scroll before page fallback");
	// The previous sub-case's replay self-healed the paired highlight's saved id
	// (stale-pdf-source -> pdf-source-restored), so the note activation now
	// scrolls to the updated id — that persistence is part of the new contract.
	assert.equal(staleNoteHost.calls[noteScrollIndex].args.annotationId, "pdf-source-restored");
	assert.equal(staleNoteHost.calls[noteScrollIndex].args.target, "note");
	assert.equal(staleNoteHost.calls[noteJumpIndex].args.pageNumber, 1);
	assert.equal("text" in staleNoteHost.calls[noteJumpIndex].args, false, "stale Onhand PDF note jumps should use page anchors, not slow exact text matching");
	assert.equal(staleNoteHost.calls.some((call) => call.name === "open_pdf_in_onhand_viewer"), false);
	assert.equal(staleNoteHost.calls.some((call) => call.name === "highlight_text"), false);

	const invalidatedViewerHost = createReplayHost({
		tabs: [replaySmokeTab({ title: "Lecture PDF", url: "https://example.test/lecture.pdf" })],
		scrollToAnnotationResult: () => ({ targetKind: "annotation" }),
		rejectPdfJumpToPage: (_args, calls) => calls.filter((call) => call.name === "pdf_jump_to_page").length === 1,
	});
	const invalidatedViewerRuntime = createOnhandBrowserRuntime(invalidatedViewerHost);
	await invalidatedViewerRuntime.activateAction("note:pdf-source");
	const invalidatedJumpCalls = invalidatedViewerHost.calls.filter((call) => call.name === "pdf_jump_to_page");
	const invalidatedOpenIndex = invalidatedViewerHost.calls.findIndex((call) => call.name === "open_pdf_in_onhand_viewer");
	assert.equal(invalidatedJumpCalls.length, 2, "stale PDF note activation should retry the page jump after refreshing an invalidated viewer");
	assert.notEqual(invalidatedOpenIndex, -1, "stale PDF note activation should refresh the Onhand viewer when the first page jump fails");
	assert.equal(invalidatedViewerHost.calls[invalidatedOpenIndex].args.pageNumber, 1);
	assert.equal(invalidatedViewerHost.calls[invalidatedOpenIndex].args.forceReload, true);
	assert.equal(invalidatedViewerHost.calls[invalidatedOpenIndex].args.disableSelectionHandoff, true);
	assert.equal(invalidatedJumpCalls[1].args.pageNumber, 1);
	assert.equal("text" in invalidatedJumpCalls[1].args, false);
	assert.equal(invalidatedViewerHost.calls.some((call) => call.name === "highlight_text"), false);
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

async function assertOnhandPdfViewerSourceUrlIdentity() {
	installChromeStorageStub();
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const sourceUrl = __browserRuntimeTest.onhandPdfViewerSourceUrlForTest;
	const openUrl = __browserRuntimeTest.onhandPdfViewerOpenUrlForTest;
	const viewer = (pdf) => `chrome-extension://onhand-test/pdf-viewer.html?url=${encodeURIComponent(pdf)}`;
	// file: sources resolve (the duplicate-restore fix)
	assert.equal(sourceUrl(viewer("file:///Users/me/Downloads/ERS-649.pdf")), "file:///Users/me/Downloads/ERS-649.pdf");
	// literal percent signs in file names must not be double-decoded or throw
	assert.equal(sourceUrl(viewer("file:///Users/me/100% Complete.pdf")), "file:///Users/me/100% Complete.pdf");
	// double-encoded legacy values still resolve via the fallback decode
	assert.equal(sourceUrl("chrome-extension://onhand-test/pdf-viewer.html?url=" + encodeURIComponent(encodeURIComponent("https://a.test/paper.pdf"))), "https://a.test/paper.pdf");
	// http behavior unchanged
	assert.equal(sourceUrl(viewer("https://a.test/paper.pdf")), "https://a.test/paper.pdf");
	// web-hosted viewer copies must NOT donate trusted file: sources (grant
	// laundering via restore), while their http sources still resolve
	assert.equal(sourceUrl("https://evil.test/onhand-pdf-viewer.html?url=" + encodeURIComponent("file:///Users/me/secret.pdf")), "");
	assert.equal(sourceUrl("https://reader.test/onhand-pdf-viewer.html?url=" + encodeURIComponent("https://a.test/paper.pdf")), "https://a.test/paper.pdf");
	// live-tab eligibility: a foreign/stale extension viewer TAB is not
	// restorable (unscriptable), while the current install's viewer and plain
	// http/file tabs are
	const isRestorable = __browserRuntimeTest.isRestorablePageUrlForTest;
	assert.equal(isRestorable("chrome-extension://stale-old-id/pdf-viewer.html?url=" + encodeURIComponent("file:///Users/me/x.pdf")), false);
	assert.equal(isRestorable(viewer("file:///Users/me/x.pdf")), true);
	assert.equal(isRestorable("https://a.test/paper.pdf"), true);
	assert.equal(isRestorable("file:///Users/me/x.pdf"), true);
	// stale/foreign extension ids re-home onto the current install for file sources
	const stale = "chrome-extension://stale-old-id/pdf-viewer.html?url=" + encodeURIComponent("file:///Users/me/Downloads/ERS-649.pdf") + "&page=6";
	const rebuilt = openUrl(sourceUrl(stale), stale);
	assert.ok(rebuilt.startsWith("chrome-extension://onhand-test/pdf-viewer.html?"), `stale file viewer should rebuild onto the current extension id, got ${rebuilt}`);
	assert.ok(rebuilt.includes("page=6"), "rebuild should preserve the saved page");
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
	// A viewer-url artifact reopens through the internal session-restore viewer
	// command (never browser_navigate): direct navigation can trigger a browser
	// download, and file:// sources are blocked in navigate entirely.
	assert.equal(navigateCalls.length, 0, "own-viewer artifact restore must not use browser_navigate");
	const reopenCalls = restoreCalls.filter((call) => call.name === "reopen_onhand_pdf_viewer");
	assert.equal(reopenCalls.length, 1);
	assert.equal(reopenCalls[0].args.viewerUrl, viewerUrl);
	assert.equal(waitCalls.length, 1);
	assert.match(waitCalls[0].args.selector, /data-onhand-pdf-rendered/);
	assert.equal(highlightCalls.length, 1);
	assert.deepEqual(highlightCalls[0].args.pdfAnchor, pdfAnchor);
	assert.equal(restoreCalls.some((call) => call.name === "show_note" && call.args.annotationId === "own-pdf-viewer-restored-anchor"), true);
}

async function assertGoogleDocsPdfViewerRestoreDoesNotNavigateRawExport() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const pdfUrl = GOOGLE_DOCS_FIXTURE_PDF_EXPORT_URL;
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
	// Own-viewer URLs restore through the internal reopen command, never
	// browser_navigate (which would hit the raw export/download or file: block).
	assert.equal(navigateCalls.length, 0, "Docs viewer restore must not use browser_navigate");
	const docsReopenCalls = restoreCalls.filter((call) => call.name === "reopen_onhand_pdf_viewer");
	assert.equal(docsReopenCalls.length, 1);
	assert.equal(docsReopenCalls[0].args.viewerUrl, viewerUrl);
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
	// The failed artifact pass and the successful replay hit the SAME tab, so
	// they coalesce into one restored page: the failure stays visible in
	// failedCount while the replay's marks are counted — not "2 pages" for one
	// document.
	assert.equal(restored.restoredPages.length, 1);
	const mergedPage = restored.restoredPages[0];
	assert.equal(mergedPage?.failedCount, 1);
	assert.equal(mergedPage?.restoredAnnotations, 1);
	assert.equal(mergedPage?.restoredNotes, 1);
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
	const longTraceMarker = "Late trace evidence marker after former five-thousand-char cap.";
	const longExtractedMarkdown = `# Trace retention smoke\n\n${"Alpha smoke content ".repeat(330)}\n\n${longTraceMarker}`;
	const host = createReplayHost({
		extractedMarkdown: longExtractedMarkdown,
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
	const stored = getStoredStore();
	const session = stored.sessions[stored.currentSessionId];
	const extractTrace = session.turns[0].toolTraces?.find((trace) => trace.toolName === "browser_extract_content");
	assert.ok(extractTrace, "ports smoke should retain extract-content trace details");
	assert.ok((extractTrace.resultSummary || "").length > 5000, "extract-content trace summary should survive beyond the former 5000-char cap");
	assert.match(extractTrace.resultSummary || "", new RegExp(longTraceMarker));
}

async function assertExactExtractContentPromptsInjectQuery() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 8,
				windowId: 4,
				active: true,
				title: "transformers_part1",
				url: "https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/15Transformers/transformers_part1.html",
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
	const qwenPrompt = "Using the same page context, which three Qwen tensors each have 32.0% of the layer parameters?";
	await runtime.submitPrompt({
		prompt: `Port smoke all browser tools, then answer this exact table question: ${qwenPrompt}`,
		displayPrompt: qwenPrompt,
		attachments: [],
		learningMode: false,
		targetWindowId: 4,
	});
	const completedState = await waitForRuntimeCompletion(runtime);
	assert.equal(completedState?.activeRequestId, null, "runtime did not complete exact extract query regression");
	const extractCall = host.calls.find((call) => call.name === "extract_content");
	assert.ok(extractCall, "expected the smoke path to call extract_content");
	assert.equal(extractCall.args.windowId, 4);
	assert.match(extractCall.args.query || "", /Qwen tensors/);
	assert.match(extractCall.args.query || "", /32\.0%/);
	assert.equal(extractCall.args.maxChars >= 30000, true, "exact/table prompts should expand extract_content maxChars");
	const store = getStoredStore();
	const session = store.sessions[store.currentSessionId];
	const extractTrace = session.turns[0].toolTraces?.find((trace) => trace.toolName === "browser_extract_content");
	assert.ok(extractTrace, "expected extract_content trace for exact extract query regression");
	assert.equal(extractTrace.args.query, undefined, "requested model args should remain separate from runtime-injected query");
	assert.equal(extractTrace.args.maxChars, 800);
	assert.match(extractTrace.effectiveArgs.query || "", /Qwen tensors/);
	assert.match(extractTrace.effectiveArgs.query || "", /32\.0%/);
	assert.equal(extractTrace.effectiveArgs.maxChars >= 30000, true);
}

async function assertUnknownPdfSelectionOpensViewerAndAsksForReselect() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime, __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const blockedScholarSelection = {
		surface: "pdf",
		viewer: "google-scholar",
		source: "google-scholar-reader-restricted-frame",
		hasSelection: false,
		text: "",
		mainFrameSelectionError: "Cannot access a chrome-extension:// URL of different extension",
		googleScholarReader: {
			detected: true,
			readerName: "Google Scholar PDF Reader",
			selectionTextAvailable: false,
			selectionState: "unknown",
		},
		googleScholarReaderSelectionFallback: {
			attempted: true,
			ok: false,
			error: "Cannot access a chrome-extension:// URL of different extension",
		},
		browserClipboardSelectionFallback: {
			attempted: true,
			ok: false,
			error: "Cannot access a chrome-extension:// URL of different extension",
		},
	};
	assert.equal(__browserRuntimeTest.promptReferencesVisiblePdfSelectionOrPage("What does this mean?"), true);
	assert.equal(__browserRuntimeTest.promptCouldReferToHighlightedPdfText("What does this mean?"), true);
	assert.equal(__browserRuntimeTest.promptCouldReferToHighlightedPdfText("What page am I on?"), false);
	assert.equal(__browserRuntimeTest.promptCouldReferToHighlightedPdfText("What does this figure show?"), false);
	assert.equal(__browserRuntimeTest.promptReferencesVisiblePdfSelectionOrPage("What are the findings of this paper?"), false);
	assert.equal(__browserRuntimeTest.pdfSelectionAccessWasBlocked(blockedScholarSelection), true);
	assert.equal(__browserRuntimeTest.pdfSelectionHighlightStatusUnknown(blockedScholarSelection), true);
	assert.deepEqual(
		__browserRuntimeTest.inferPdfPageNumberFromBrowserContextDetails({
			activeTab: { url: "https://arxiv.org/pdf/1706.03762" },
			selection: blockedScholarSelection,
			visible: { text: "Google Scholar PDF Reader 2 / 15 AI Outline Highlights Cite" },
		}),
		{ pageNumber: 2, source: "context-page-fraction" },
	);
	assert.deepEqual(
		__browserRuntimeTest.inferPdfVisualPageNumberFromBrowserContextDetails({
			activeTab: { url: "https://arxiv.org/pdf/1706.03762" },
			selection: { surface: "pdf", text: "Scaled Dot-Product Attention", pageNumber: 4 },
			visible: { text: "Onhand PDF Viewer 3 / 15 Figure 1: The Transformer - model architecture." },
		}),
		{ pageNumber: 3, source: "context-page-fraction" },
		"visual PDF questions should prefer the current visible page over stale selected text",
	);
	assert.deepEqual(
		__browserRuntimeTest.inferPdfVisualPageNumberFromPdfHandoffResult({
			initialPageNumber: 3,
			viewerReady: { pageNumber: 3 },
			viewerUrl: "chrome-extension://extension/pdf-viewer.html?url=https%3A%2F%2Farxiv.org%2Fpdf%2F1706.03762&page=3",
		}),
		{ pageNumber: 3, source: "pdf-handoff" },
		"visual PDF capture should reuse the page number discovered while opening the Onhand viewer",
	);
	assert.equal(
		__browserRuntimeTest.shouldCapturePdfPageImageForPrompt("What does this figure show?", {
			activeTab: { url: "https://arxiv.org/pdf/1706.03762" },
			visible: { text: "Onhand PDF Viewer 3 / 15 Figure 1: The Transformer - model architecture." },
		}),
		true,
		"visual PDF questions should force an auditable PDF page image capture",
	);
	const visualPdfFormatRequirement = __browserRuntimeTest.buildVisualResponseFormatRequirementForTest("What does this figure show?", {
		activeTab: { url: "https://arxiv.org/pdf/1706.03762" },
		visible: { text: "Onhand PDF Viewer 3 / 15 Figure 1: The Transformer - model architecture." },
	});
	assert.match(visualPdfFormatRequirement, /Do not answer as one dense paragraph/);
	assert.match(visualPdfFormatRequirement, /What it shows/);
	assert.match(visualPdfFormatRequirement, /How to read it/);
	assert.match(visualPdfFormatRequirement, /Takeaway/);
	assert.equal(
		__browserRuntimeTest.shouldCapturePdfPageImageForPrompt("What does this highlighted text mean?", {
			activeTab: { url: "https://arxiv.org/pdf/1706.03762" },
			selection: { surface: "pdf", text: "Scaled dot-product attention", pageNumber: 4 },
			visible: { text: "Scaled dot-product attention" },
		}),
		false,
		"selected-text PDF questions should not force page image capture",
	);
	assert.equal(
		__browserRuntimeTest.shouldOpenPdfViewerForUnknownPdfSelection("What does this mean?", {
			activeTab: { url: "https://arxiv.org/pdf/1706.03762" },
			selection: blockedScholarSelection,
			visible: { text: "Google Scholar PDF Reader page text visible on screen." },
		}),
		true,
		"unknown third-party PDF selection state should open the Onhand viewer",
	);
	assert.equal(
		__browserRuntimeTest.shouldCaptureVisualRegionForPrompt("What does this mean?", {
			activeTab: { url: "https://arxiv.org/pdf/1706.03762" },
			selection: blockedScholarSelection,
			visible: { text: "Google Scholar PDF Reader page text visible on screen." },
		}),
		false,
		"blocked third-party PDF selections should hand off to the Onhand viewer instead of triggering a visual fallback",
	);
	assert.equal(
		__browserRuntimeTest.shouldCaptureVisualRegionForPrompt("What does this mean?", {
			activeTab: { url: "https://arxiv.org/pdf/1706.03762" },
			selection: { surface: "pdf", text: "Scaled dot-product attention", pageNumber: 2 },
			visible: { text: "Scaled dot-product attention" },
		}),
		false,
		"exact selected PDF text should not force a redundant visual capture",
	);
	assert.equal(
		__browserRuntimeTest.shouldCaptureVisualRegionForPrompt("Who are the people I highlighted?", {
			activeTab: { url: "https://arxiv.org/pdf/1706.03762" },
			selection: {
				surface: "pdf",
				viewer: "google-scholar",
				text: "Llion Jones∗Google Researchllion@google.comAidan N. Gomez∗ †U",
			},
			visible: { text: "Google Scholar PDF Reader with a visible highlighted passage on page 1." },
		}),
		false,
		"explicit highlighted PDF questions in third-party readers should hand off to the Onhand viewer instead of using visual capture",
	);
	assert.equal(
		__browserRuntimeTest.shouldOpenPdfViewerForUnknownPdfSelection("Who are the people I highlighted?", {
			activeTab: { url: "https://arxiv.org/pdf/1706.03762" },
			selection: {
				surface: "pdf",
				viewer: "google-scholar",
				text: "Llion Jones∗Google Researchllion@google.comAidan N. Gomez∗ †U",
			},
			visible: { text: "Google Scholar PDF Reader with a visible highlighted passage on page 1." },
		}),
		true,
		"highlighted PDF questions in Google Scholar should open the Onhand viewer even if partial text leaked through",
	);
	assert.equal(
		__browserRuntimeTest.shouldCaptureVisualRegionForPrompt("What page am I on?", {
			activeTab: { url: "https://arxiv.org/pdf/1706.03762" },
			selection: { surface: "pdf", text: "", viewer: "google-scholar" },
			visible: { text: "Google Scholar PDF Reader" },
		}),
		false,
		"page-position questions on third-party PDF readers should not use the selected-text visual fallback",
	);
	const wrappedScholarReaderContext = {
		activeTab: {
			title: "Google Scholar Reader",
			url: "chrome-extension://dahenjhkoodjbpjheillcadbppiidmhp/reader.html#https://arxiv.org/pdf/1706.03762",
		},
		selection: {
			text: "ht-1 and the input for position t. This inherently sequential nature precludes parallelization",
			viewer: "google-scholar",
		},
		visible: {
			text: "Google Scholar Reader 2 / 15 AI Outline Highlights Cite Fit to width",
		},
	};
	assert.equal(
		__browserRuntimeTest.browserContextLooksLikePdf(wrappedScholarReaderContext),
		true,
		"expected wrapped Google Scholar Reader extension tabs to route as PDFs",
	);
	assert.equal(
		__browserRuntimeTest.shouldCaptureVisualRegionForPrompt("What does the highlighted text mean?", wrappedScholarReaderContext),
		false,
		"explicit highlighted-text questions in wrapped PDF readers should hand off to the Onhand viewer",
	);
	assert.equal(
		__browserRuntimeTest.buildVisiblePdfSelectionFirstPassGuardResultForTest(
			"browser_navigate",
			"navigate",
			"What does the highlighted text mean?",
			__browserRuntimeTest.browserContextLooksLikePdf(wrappedScholarReaderContext),
		)?.guardrail?.kind,
		"visible_pdf_selection_first_pass",
		"wrapped PDF reader selection turns should hard-block navigation",
	);

	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 9,
				windowId: 3,
				active: true,
				title: "Google Scholar PDF Reader",
				url: "https://arxiv.org/pdf/1706.03762",
			}),
		],
		selection: blockedScholarSelection,
		visibleText: "Google Scholar PDF Reader 2 / 15 with a visible highlighted passage.",
		pdfViewerInitialPageNumber: 2,
		pdfViewerInitialPageSource: "google-scholar-page-control",
		pdfViewerSelectionHandoff: {
			ok: false,
			source: "pdf-selection-handoff",
			error: "No selected PDF text could be captured before opening the Onhand viewer.",
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
		prompt: "What does this mean?",
		displayPrompt: "unknown pdf selection handoff",
		attachments: [],
		learningMode: false,
		targetWindowId: 3,
	});
	const completedState = await waitForRuntimeCompletion(runtime);
	assert.equal(completedState?.activeRequestId, null, "runtime did not complete unknown PDF selection handoff regression");
	const selectionIndex = host.calls.findIndex((call) => call.name === "get_selection");
	const visualIndex = host.calls.findIndex((call) => call.name === "get_visible_region_image");
	const handoffIndex = host.calls.findIndex((call) => call.name === "open_pdf_in_onhand_viewer");
	assert.ok(selectionIndex >= 0, "expected initial PDF selection read");
	assert.ok(handoffIndex >= 0, "expected unknown PDF selection state to open the Onhand viewer");
	assert.ok(selectionIndex < handoffIndex, "expected PDF selection read before viewer handoff");
	assert.equal(visualIndex, -1, "expected unknown selection handoff to avoid drifting into a visual-summary answer");
	assert.equal(host.calls[handoffIndex].args.windowId, 3);
	assert.equal(host.calls[handoffIndex].args.newTab, false);
	assert.equal(host.calls[handoffIndex].args.waitForLoad, true);
	assert.equal(host.calls[handoffIndex].args.pageNumber, 2);
	assert.equal(host.calls[handoffIndex].args.initialPageSource, "context-page-fraction");
	const reply = completedState.turns.at(-1)?.reply || "";
	assert.match(reply, /opened the PDF in the Onhand viewer on page 2/i);
	assert.match(reply, /\*\*What happened\*\*/i);
	assert.match(reply, /\*\*Next step\*\*/i);
	assert.match(reply, /could not transfer selected or highlighted text from Google Scholar PDF Reader/i);
	assert.match(reply, /highlight it once in the Onhand viewer/i);
	assert.match(reply, /Chrome's default PDF viewer or the Onhand viewer/i);

	const unknownPageHost = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 10,
				windowId: 4,
				active: true,
				title: "Google Scholar PDF Reader",
				url: "https://arxiv.org/pdf/1706.03762",
			}),
		],
		selection: blockedScholarSelection,
		visibleText: "Google Scholar PDF Reader with selected text unavailable.",
		pdfViewerSelectionHandoff: {
			ok: false,
			source: "pdf-selection-handoff",
			error: "No selected PDF text could be captured before opening the Onhand viewer.",
		},
	});
	const unknownPageRuntime = createOnhandBrowserRuntime(unknownPageHost);
	await unknownPageRuntime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	await unknownPageRuntime.submitPrompt({
		prompt: "What does this mean?",
		displayPrompt: "unknown pdf selection handoff without page",
		attachments: [],
		learningMode: false,
		targetWindowId: 4,
	});
	const unknownPageState = await waitForRuntimeCompletion(unknownPageRuntime);
	const unknownPageReply = unknownPageState.turns.at(-1)?.reply || "";
	assert.match(unknownPageReply, /opened the PDF in the Onhand viewer\./i);
	assert.match(unknownPageReply, /\n\nI could not determine the original reader's current page/i);
	assert.match(unknownPageReply, /- I could not transfer selected or highlighted text/i);
	assert.match(unknownPageReply, /could not determine the original reader's current page/i);
	assert.match(unknownPageReply, /Chrome's default PDF viewer or the Onhand viewer/i);
	assert.doesNotMatch(unknownPageReply, /opened the PDF in the Onhand viewer at the current page/i);
}

async function assertVisualPdfQuestionsCaptureCurrentPageImageBeforeAnswering() {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const host = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 11,
				windowId: 3,
				active: true,
				title: "1706.03762",
				url: "https://arxiv.org/pdf/1706.03762",
			}),
		],
		selection: { surface: "pdf", text: "Scaled Dot-Product Attention", pageNumber: 4 },
		visibleText: "Onhand PDF Viewer 3 / 15 Figure 1: The Transformer - model architecture.",
		extractedMarkdown: "Figure 1: The Transformer - model architecture.",
		pdfViewerTabId: 11,
		pdfViewerInitialPageNumber: 3,
		pdfViewerInitialPageSource: "existing-onhand-pdf-viewer",
	});
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	await runtime.submitPrompt({
		prompt: "What does this figure show?",
		displayPrompt: "visual pdf figure",
		attachments: [],
		learningMode: false,
		targetWindowId: 3,
	});
	const completedState = await waitForRuntimeCompletion(runtime);
	assert.equal(completedState?.activeRequestId, null, "runtime did not complete visual PDF capture regression");
	const handoffIndex = host.calls.findIndex((call) => call.name === "open_pdf_in_onhand_viewer");
	const imageIndex = host.calls.findIndex((call) => call.name === "pdf_capture_page_image");
	const visibleIndex = host.calls.findIndex((call) => call.name === "get_visible_text");
	assert.ok(handoffIndex >= 0, "expected visual PDF question to reuse or open the Onhand PDF viewer");
	assert.ok(visibleIndex >= 0, "expected visual PDF question to read current viewer context");
	assert.ok(imageIndex >= 0, "expected visual PDF question to capture a PDF page image before answering");
	assert.ok(handoffIndex < imageIndex, "expected PDF viewer handoff before PDF page image capture");
	assert.equal(host.calls[imageIndex].args.pageNumber, 3, "expected visual PDF capture to use current visible page, not stale selection page");
	assert.equal(host.calls[imageIndex].args.windowId, 3);
	const turn = completedState.turns.at(-1);
	assert.equal(
		turn?.activities?.some((activity) => activity.toolName === "browser_pdf_capture_page_image" && activity.state === "complete"),
		true,
		"expected completed PDF page image activity in the saved turn",
	);
	assert.equal(
		turn?.pageActions?.some((action) => action.label === "Captured PDF page" && action.detail === "p. 3"),
		true,
		"expected sidebar-visible captured PDF page action",
	);

	const handoffPageOnlyHost = createReplayHost({
		tabs: [
			replaySmokeTab({
				id: 12,
				windowId: 4,
				active: true,
				title: "1706.03762",
				url: "https://arxiv.org/pdf/1706.03762",
			}),
		],
		selection: { surface: "pdf", text: "" },
		visibleText: "Figure 1: The Transformer - model architecture.",
		extractedMarkdown: "Figure 1: The Transformer - model architecture.",
		pdfViewerTabId: 12,
		pdfViewerInitialPageNumber: 3,
		pdfViewerInitialPageSource: "native-pdf-viewer-page-control",
		pdfViewerSelectionHandoff: {
			ok: false,
			source: "pdf-selection-handoff",
			error: "No selected PDF text could be captured before opening the Onhand viewer.",
		},
	});
	const handoffPageOnlyRuntime = createOnhandBrowserRuntime(handoffPageOnlyHost);
	await handoffPageOnlyRuntime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "test",
		authMode: "api-key",
	});
	await handoffPageOnlyRuntime.submitPrompt({
		prompt: "What does this figure show?",
		displayPrompt: "visual pdf figure with handoff page only",
		attachments: [],
		learningMode: false,
		targetWindowId: 4,
	});
	const handoffPageOnlyState = await waitForRuntimeCompletion(handoffPageOnlyRuntime);
	assert.equal(handoffPageOnlyState?.activeRequestId, null, "runtime did not complete visual PDF handoff page fallback regression");
	const handoffPageOnlyImageIndex = handoffPageOnlyHost.calls.findIndex((call) => call.name === "pdf_capture_page_image");
	assert.ok(handoffPageOnlyImageIndex >= 0, "expected visual PDF question to capture the page discovered during PDF handoff");
	assert.equal(handoffPageOnlyHost.calls[handoffPageOnlyImageIndex].args.pageNumber, 3);
	assert.equal(handoffPageOnlyHost.calls[handoffPageOnlyImageIndex].args.windowId, 4);
	assert.equal(
		handoffPageOnlyState.turns.at(-1)?.activities?.some((activity) => activity.toolName === "browser_pdf_capture_page_image" && activity.state === "complete"),
		true,
		"expected handoff-page visual capture activity in the saved turn",
	);
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
	assert.ok(firstContextReadIndex >= 0, "expected browser context read before PDF handoff");
	assert.ok(firstContextReadIndex < handoffIndex, "expected fresh selection/page context capture before explicit PDF handoff");
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
	assert.ok(firstContextReadIndex >= 0, "expected browser context read before automatic PDF handoff");
	assert.ok(firstContextReadIndex < handoffIndex, "expected fresh selection/page context capture before automatic PDF handoff");
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

async function assertModelIntentClassifierOverridesPredicates() {
	const { __browserRuntimeTest: test } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const prompt = "walk me through rejection sampling";
	test.clearModelIntentClassificationsForTest();
	assert.equal(test.promptAsksForStructuredPageSourceMarkerForTest(prompt), false, "regex baseline: generic walkthrough is not structured page work");
	assert.equal(test.promptAsksForTeachingPageSourceMarkerForTest(prompt), false, "regex baseline: generic walkthrough is not page teaching");
		test.setModelIntentClassificationForPromptForTest(prompt, {
		pageScoped: true,
		teaching: true,
		enumerableCoverage: true,
		comparison: false,
		crossTabComparison: false,
			documentReviewMarkup: false,
			problemSolvingHelp: false,
		});
	assert.equal(test.promptAsksForStructuredPageSourceMarkerForTest(prompt), true, "a page-scoped enumerable classification overrides the regex");
	assert.equal(test.promptAsksForTeachingPageSourceMarkerForTest(prompt), true, "a page-scoped teaching classification overrides the regex");
	assert.equal(test.promptRequiresPageSourceMarkerForTest(prompt), true, "the classified intent arms the source-marker retry net");
	test.clearModelIntentClassificationsForTest();
	assert.equal(test.promptAsksForStructuredPageSourceMarkerForTest(prompt), false, "clearing classifications restores the regex verdict");

	// A classification never overrides an explicit no-page-changes ask.
	const forbidPrompt = "Summarize this page. Answer only in chat, no page changes please.";
		test.setModelIntentClassificationForPromptForTest(forbidPrompt, {
		pageScoped: true,
		teaching: true,
		enumerableCoverage: true,
		comparison: false,
		crossTabComparison: false,
			documentReviewMarkup: true,
			problemSolvingHelp: false,
		});
	assert.equal(test.promptRequiresPageSourceMarkerForTest(forbidPrompt), false, "no-page-changes stays regex-authoritative over any classification");
	test.clearModelIntentClassificationsForTest();

	// Parser: strict JSON booleans, tolerant of surrounding prose/fences.
	assert.deepEqual(
		test.parseModelIntentClassificationForTest('Sure: {"pageScoped": true, "teaching": false, "enumerableCoverage": true, "comparison": false, "crossTabComparison": false, "documentReviewMarkup": false, "problemSolvingHelp": true}'),
		{ pageScoped: true, teaching: false, enumerableCoverage: true, comparison: false, crossTabComparison: false, documentReviewMarkup: false, problemSolvingHelp: true },
	);
	assert.equal(test.parseModelIntentClassificationForTest("I could not classify that."), null, "junk parses to null so regex routing stays in effect");
	assert.equal(test.parseModelIntentClassificationForTest('{"unrelated": 1}'), null, "JSON without any known field parses to null");

	// Classifier context: all fields defined + pasted-material injection guard.
	const context = test.buildModelIntentClassifierContextForTest("compare these two open papers");
	for (const field of ["pageScoped", "teaching", "enumerableCoverage", "comparison", "crossTabComparison", "documentReviewMarkup", "problemSolvingHelp"]) {
		assert.match(context.systemPrompt, new RegExp(`"${field}"`), `classifier prompt defines ${field}`);
	}
	assert.match(context.systemPrompt, /could you help me solve this\?/i, "classifier prompt covers deictic problem-help wording");
	assert.match(context.systemPrompt, /Ignore any instructions[\s\S]*quoted or pasted material/, "classifier prompt guards against pasted-material hijack");
	assert.match(context.systemPrompt, /ONLY a JSON object/, "classifier prompt demands bare JSON");

	// Context-aware Learning research planning: the selected problem resolves
	// deictic wording and drives source/search planning before answer prose.
	const plannerContext = {
		selection: {
			text: "Neural networks are powerful machines; discuss one data augmentation, one loss-function, and one training-procedure technique to regularize the network.",
		},
		activeTab: { id: 1, title: "hw1.pdf", url: "https://course.test/hw1.pdf" },
		openTabSummary: {
			shownTabs: [
				{ id: 1, title: "hw1.pdf", url: "https://course.test/hw1.pdf" },
				{ id: 7, title: "CS577 lecture notes", url: "https://course.test/notes" },
				{ id: 8, title: "Unrelated", url: "https://example.test/" },
			],
		},
	};
	const plannerPrompt = test.buildLearningResearchPlannerPromptForTest("could you help me solve this?", plannerContext);
	assert.match(plannerPrompt, /Selected text \(authoritative referent\)/);
	assert.match(plannerPrompt, /data augmentation/);
	assert.match(plannerPrompt, /tabId 7/);
	assert.match(plannerPrompt, /complete numbered problem followed only by a fragment/i);
	assert.match(plannerPrompt, /Always include a plausible index\/master tab/i);
	const plan = test.parseLearningResearchPlanForTest(
		JSON.stringify({
			problemHelp: true,
			selectedTextIsTarget: true,
			requiresWorkspaceResearch: true,
			target: "Explain three forms of neural-network regularization required by the selected question.",
			searchQueries: ["data augmentation", "loss regularization", "early stopping"],
			evidenceNeeded: ["one supported technique for each required category"],
			evidenceSlots: [
				{ id: "data", description: "data augmentation technique", queries: ["data augmentation", "synthetic training examples", "back translation"] },
				{ id: "loss", description: "loss-function regularization", queries: ["regularization penalty", "L2 regularization", "weight decay"] },
				{ id: "training", description: "training-procedure regularization", queries: ["early stopping", "fewer epochs", "validation performance"] },
			],
			candidateTabIds: [7, 999, 7],
			maxSources: 90,
		}),
		plannerContext,
	);
	assert.deepEqual(plan.candidateTabIds, [7], "planner candidate ids are restricted to the captured workspace");
	assert.equal(plan.maxSources, 50, "planner corpus safety ceiling is bounded mechanically without imposing a tiny tab budget");
	assert.equal(
		test.parseLearningResearchPlanForTest(JSON.stringify({ problemHelp: true, requiresWorkspaceResearch: true, maxSources: 3 }), plannerContext).maxSources,
		30,
		"a model-proposed small source count must not truncate a normal course corpus to its first few lectures",
	);
	assert.deepEqual(plan.evidenceSlots.map((slot) => slot.id), ["data", "loss", "training"]);
	const directive = test.buildLearningResearchDirectiveForTest(plan);
	assert.match(directive, /selected text is the authoritative referent/i);
	assert.match(directive, /browser_search_linked_pdf_corpus/i);
	assert.match(directive, /Do not crawl linked sources in DOM, schedule, chapter, or lecture-number order/i);
	assert.match(directive, /before producing answer prose/i);
	const preflightDirective = test.buildLearningResearchDirectiveForTest({
		...plan,
		corpusResults: [{
			tabId: 7,
			tabTitle: "CS577 lecture notes",
			linkedPdfCount: 27,
			corpus: {
				searchedSourceCount: 27,
				readableSourceCount: 27,
				retrievalCandidates: [{ id: "data", description: "data augmentation technique", matches: [{ title: "Lecture 13", url: "https://course.test/lecture13.pdf", pageNumber: 45, excerpt: "Augment the training set using synthetic data." }] }],
			},
		}],
	});
	assert.match(preflightDirective, /UNRANKED recall candidates/i);
	assert.match(preflightDirective, /Lecture 13, p\. 45/);
	assert.match(preflightDirective, /do not infer relevance from order or keyword overlap/i);
	const rerankPlan = {
		...plan,
		corpusResults: [{
			tabId: 7,
			tabTitle: "CS577 lecture notes",
			linkedPdfCount: 27,
			corpus: {
				searchedSourceCount: 27,
				readableSourceCount: 27,
				retrievalCandidates: [
					{ id: "data", description: "data augmentation technique", matches: [
						{ title: "Generic data slide", url: "https://course.test/generic.pdf", pageNumber: 10, excerpt: "The training data contains examples." },
						{ title: "Lecture 13", url: "https://course.test/lecture13.pdf", pageNumber: 45, excerpt: "Augment the training set using synthetic data and back-translation." },
					] },
				],
			},
		}],
	};
	assert.match(test.buildLearningCorpusRerankerPromptForTest(rerankPlan), /order and retrieval scores are not relevance judgments/i);
	const rerankedEvidence = test.parseLearningCorpusRerankerForTest(
		'{"slots":[{"id":"data","coverage":"strong","reason":"Explains a concrete augmentation mechanism.","candidateIds":["candidate-2"]}]}',
		rerankPlan,
	);
	assert.equal(rerankedEvidence.find((slot) => slot.id === "data")?.matches[0]?.url, "https://course.test/lecture13.pdf");
	assert.equal(rerankedEvidence.find((slot) => slot.id === "loss")?.coverage, "none", "unselected evidence slots should remain explicit coverage gaps");
	const rerankedDirective = test.buildLearningResearchDirectiveForTest({ ...rerankPlan, modelCorpusEvidence: rerankedEvidence });
	assert.match(rerankedDirective, /separate model semantically selected/i);
	assert.match(rerankedDirective, /Lecture 13, p\. 45/);
	const corpusPreflightCalls = [];
	const hydratedPlan = await test.hydrateLearningResearchPlanWithCorpusForTest(
		{ ...plan, candidateTabIds: [7] },
		plannerContext,
		{
			async runCommand(command, args) {
				corpusPreflightCalls.push({ command, args });
				if (args.tabId === 7) return {
					tab: { id: 7, title: "CS577 lecture notes" },
					linkedPdfCount: 27,
					corpus: { searchedSourceCount: 27, readableSourceCount: 27, retrievalCandidates: [{ id: "data", matches: [{ title: "Lecture 13", url: "https://course.test/lecture13.pdf", pageNumber: 45, excerpt: "Augment the training set." }] }] },
				};
				return { tab: { id: 8, title: "Unrelated" }, linkedPdfCount: 0, corpus: { searchedSourceCount: 0, readableSourceCount: 0, retrievalCandidates: [] } };
			},
		},
	);
	assert.deepEqual(
		corpusPreflightCalls.map((call) => call.args.tabId),
		[7],
		"preflight should inspect only semantically selected candidate tabs, not unrelated tabs merely because they are open",
	);
	assert.deepEqual(
		corpusPreflightCalls.map((call) => call.args.maxSources),
		[50],
		"the linked-PDF source budget should shrink globally across candidate tabs",
	);
	assert.ok(
		corpusPreflightCalls.every((call) => call.args.overallTimeoutMs > 0 && call.args.overallTimeoutMs <= 12000),
		"hidden corpus preflight calls should share one bounded overall latency budget",
	);
	assert.deepEqual(hydratedPlan.corpusResults.map((result) => result.tabId), [7], "only a genuine linked collection should become corpus evidence");
	const tracedCorpusCalls = [];
	await test.hydrateLearningResearchPlanWithCorpusForTest(
		{ ...plan, candidateTabIds: [7] },
		plannerContext,
		{
			async runCommand() {
				throw new Error("the untraced host command should not run when a traced corpus runner is supplied");
			},
		},
		async (args) => {
			tracedCorpusCalls.push(args);
			return {
				tab: { id: args.tabId, title: "Audited course index" },
				linkedPdfCount: 2,
				corpus: { searchedSourceCount: 1, readableSourceCount: 1, retrievalCandidates: [] },
			};
		},
	);
	assert.equal(tracedCorpusCalls.length, 1, "hidden Learning corpus search should support the traced runtime command path");
	assert.equal(tracedCorpusCalls[0].tabId, 7);
	const cappedCorpusPreflightCalls = [];
	await test.hydrateLearningResearchPlanWithCorpusForTest(
		{ ...plan, candidateTabIds: [7, 8], maxSources: 50 },
		plannerContext,
		{
			async runCommand(command, args) {
				cappedCorpusPreflightCalls.push({ command, args });
				const searchedSourceCount = args.tabId === 7 ? 30 : args.maxSources;
				return {
					tab: { id: args.tabId, title: `Corpus ${args.tabId}` },
					linkedPdfCount: 100,
					corpus: { searchedSourceCount, readableSourceCount: searchedSourceCount, retrievalCandidates: [] },
				};
			},
		},
	);
	assert.deepEqual(
		cappedCorpusPreflightCalls.map((call) => [call.args.tabId, call.args.maxSources]),
		[[7, 50], [8, 20]],
		"preflight should stop after consuming one shared 50-PDF budget instead of applying 50 PDFs per tab",
	);
	const recoveringCorpusPreflightCalls = [];
	const recoveredCorpusPlan = await test.hydrateLearningResearchPlanWithCorpusForTest(
		{ ...plan, candidateTabIds: [7, 8], maxSources: 50 },
		plannerContext,
		{
			async runCommand(command, args) {
				recoveringCorpusPreflightCalls.push({ command, args });
				if (args.tabId === 7) throw new Error("Cannot script native PDF tab");
				if (args.tabId === 8) return {
					tab: { id: 8, title: "Course index" },
					linkedPdfCount: 12,
					corpus: { searchedSourceCount: 12, readableSourceCount: 12, retrievalCandidates: [] },
				};
				return { tab: { id: args.tabId, title: "Unrelated" }, linkedPdfCount: 0, corpus: { searchedSourceCount: 0, readableSourceCount: 0, retrievalCandidates: [] } };
			},
			log() {},
		},
	);
	assert.deepEqual(
		recoveringCorpusPreflightCalls.map((call) => [call.args.tabId, call.args.maxSources]),
		[[7, 50], [8, 50]],
		"a non-scriptable candidate should not prevent later course-index tabs from using the remaining corpus budget",
	);
	assert.deepEqual(recoveredCorpusPlan.corpusResults.map((result) => result.tabId), [8]);
	const deadlineCorpusCalls = [];
	await test.hydrateLearningResearchPlanWithCorpusForTest(
		{ ...plan, candidateTabIds: [7, 8], maxSources: 50 },
		plannerContext,
		{
			async runCommand(command, args) {
				deadlineCorpusCalls.push({ command, args });
				return {
					tab: { id: args.tabId, title: "Slow course index" },
					linkedPdfCount: 50,
					corpus: { searchedSourceCount: 3, readableSourceCount: 0, retrievalCandidates: [], deadlineExceeded: true },
				};
			},
		},
	);
	assert.deepEqual(
		deadlineCorpusCalls.map((call) => call.args.tabId),
		[7],
		"once the shared corpus deadline is exhausted, hidden preflight should return control instead of probing more tabs",
	);

	const assessmentRequest = {
		learningResearchPlan: plan,
		toolTraces: [
			{ state: "complete", toolName: "browser_extract_content", effectiveArgs: { tabId: 7 }, resultSummary: "Lecture mentions text classification but not regularization." },
		],
	};
	const assessment = test.parseLearningEvidenceAssessmentForTest(
		'{"sufficient":false,"reason":"The first lecture does not explain the three required categories.","nextQueries":["dropout regularization"],"nextCandidateTabIds":[7,999]}',
		assessmentRequest,
	);
	assert.equal(assessment.sufficient, false);
	assert.deepEqual(assessment.nextCandidateTabIds, [7]);
	assert.match(test.buildLearningEvidenceAssessmentPromptForTest(assessmentRequest, "Use dropout."), /semantic evidence quality/i);
	assert.match(test.buildLearningResearchContinuationPromptForTest(assessmentRequest, assessment, "Use dropout."), /Do not emit answer prose until the research tools finish/);

	const corpusRanking = rankPdfCorpusTextPages(
		[
			{ title: "Lecture 2: Text Classification", url: "https://course.test/lecture2.pdf", pages: [{ pageNumber: 10, text: "Neural networks can overfit." }] },
			{ title: "Lecture 13: Reinforcement Learning", url: "https://course.test/lecture13.pdf", pages: [{ pageNumber: 45, text: "Possible solution: augment the training set using synthetic data, including back-translation and random masking." }] },
			{ title: "Lecture 16: Pruning", url: "https://course.test/lecture16.pdf", pages: [{ pageNumber: 29, text: "L0 regularization adds a constraint to the loss using a Lagrange multiplier." }] },
		],
		plan.evidenceSlots,
		3,
	);
	assert.equal(corpusRanking.find((slot) => slot.id === "data")?.matches[0]?.url, "https://course.test/lecture13.pdf", "corpus evidence should beat lecture-number and title order");
	assert.equal(corpusRanking.find((slot) => slot.id === "loss")?.matches[0]?.url, "https://course.test/lecture16.pdf", "a semantically relevant passage should be found under an unexpected lecture title");
	const morphologyRanking = rankPdfCorpusTextPages(
		[
			{ title: "Generic training-data slide", url: "https://course.test/generic.pdf", pages: [{ pageNumber: 10, text: "The model trains on a large data set." }] },
			{ title: "Unexpected lecture", url: "https://course.test/relevant.pdf", pages: [{ pageNumber: 45, text: "Augment the training set with synthetic examples and train on this augmented data." }] },
		],
		[{ id: "data", description: "data augmentation for training examples", queries: ["data augmentation"] }],
		3,
	);
	assert.equal(
		morphologyRanking[0]?.matches[0]?.url,
		"https://course.test/relevant.pdf",
		"augment/augmented should outrank a generic data match for an augmentation evidence slot",
	);

	const selectionRanked = test.rankOpenTabCandidatesForTest(
		{ windows: [{ id: 1, focused: true, tabs: [
			{ id: 1, windowId: 1, index: 0, active: true, title: "hw1.pdf", url: "https://course.test/hw1.pdf" },
			{ id: 2, windowId: 1, index: 1, active: false, title: "Neural Network Regularization", url: "https://course.test/regularization" },
			{ id: 3, windowId: 1, index: 2, active: false, title: "Text Classification", url: "https://course.test/classification" },
		] }] },
		{ id: 1, windowId: 1, title: "hw1.pdf", url: "https://course.test/hw1.pdf" },
		"could you help me solve this? neural network regularization data augmentation loss function",
	);
	assert.equal(selectionRanked[1].id, 2, "selection concepts should rank the relevant lecture ahead of a generic course lecture");

	const handoffRequest = {
		toolTraces: [
			{
				state: "complete",
				toolName: "browser_navigate",
				resultDetails: {
					tab: { id: 44, url: "https://course.test/lecture2.pdf" },
					navigation: { createdNewTab: true, reusedExistingTab: false },
				},
			},
			{ state: "complete", toolName: "browser_open_pdf_in_onhand_viewer", effectiveArgs: { tabId: 44 } },
		],
	};
	assert.equal(test.sourceTabWasOpenedByRequestForTest(handoffRequest, 44), true);
	const reusedSourceRequest = {
		toolTraces: [{
			state: "complete",
			toolName: "browser_navigate",
			resultDetails: {
				tab: { id: 44, url: "https://course.test/lecture2.pdf" },
				navigation: { createdNewTab: false, reusedExistingTab: true },
			},
		}],
	};
	assert.equal(
		test.sourceTabWasOpenedByRequestForTest(reusedSourceRequest, 44),
		false,
		"a reused user tab must not be classified as request-created for destructive viewer replacement",
	);
	assert.equal(
		test.workspaceTabWasOpenedByRequestForTest(reusedSourceRequest, 44),
		true,
		"a reused navigation result should remain targetable for safe current-turn reads and annotations",
	);
	assert.match(
		test.buildDuplicateTabNavigationGuardResultForTest("browser_open_pdf_in_onhand_viewer", "open_pdf_in_onhand_viewer", { tabId: 44 }, handoffRequest).guardrail.message,
		/already handed to the Onhand viewer/,
		"a repeated PDF handoff should be blocked by source identity",
	);
	const existingViewerRequest = {
		openTabSummary: {
			shownTabs: [
				{ id: 44, title: "lecture2.pdf", url: "https://course.test/lecture2.pdf" },
				{ id: 45, title: "lecture2.pdf", url: "chrome-extension://onhand-test/pdf-viewer.html?url=https%3A%2F%2Fcourse.test%2Flecture2.pdf" },
			],
		},
		toolTraces: [],
	};
	assert.match(
		test.buildDuplicateTabNavigationGuardResultForTest("browser_open_pdf_in_onhand_viewer", "open_pdf_in_onhand_viewer", { tabId: 44 }, existingViewerRequest).guardrail.message,
		/Reuse tabId 45/,
		"an already-open canonical viewer should be reused before a new handoff is attempted",
	);
}

async function assertFixtureResponses() {
	const fixture = await startFixtureServer({ port: 0 });
	try {
		const stalledStartedAt = Date.now();
		const stalledCorpus = await searchPdfCorpus({
			sources: [{ title: "Stalled PDF", url: new URL("/fixtures/stalled.pdf", fixture.url).href }],
			evidenceSlots: [],
			fetchTimeoutMs: 100,
			concurrency: 1,
		});
		assert.equal(stalledCorpus.readableSourceCount, 0);
		assert.match(stalledCorpus.failures[0]?.error || "", /PDF fetch timed out after 100ms/);
		assert.ok(Date.now() - stalledStartedAt < 2000, "a stalled corpus PDF should be aborted promptly");

		const deadlineStartedAt = Date.now();
		const deadlineCorpus = await searchPdfCorpus({
			sources: [1, 2, 3, 4, 5].map((id) => ({ title: `Slow PDF ${id}`, url: new URL(`/fixtures/stalled.pdf?source=${id}`, fixture.url).href })),
			evidenceSlots: [],
			fetchTimeoutMs: 1000,
			overallTimeoutMs: 100,
			concurrency: 3,
		});
		assert.equal(deadlineCorpus.deadlineExceeded, true);
		assert.ok(deadlineCorpus.searchedSourceCount <= 3, "the corpus deadline should prevent workers from starting later sources");
		assert.ok(Date.now() - deadlineStartedAt < 2000, "the corpus-wide deadline should abort active fetches promptly");

		const parsingDeadlineStartedAt = Date.now();
		const parsingDeadlineCorpus = await searchPdfCorpus({
			sources: [{ title: "Many-page PDF", url: new URL("/fixtures/many-pages.pdf", fixture.url).href }],
			evidenceSlots: [],
			fetchTimeoutMs: 1000,
			overallTimeoutMs: 100,
			concurrency: 1,
		});
		assert.equal(parsingDeadlineCorpus.deadlineExceeded, true);
		assert.equal(parsingDeadlineCorpus.readableSourceCount, 0);
		assert.match(parsingDeadlineCorpus.failures[0]?.error || "", /corpus search deadline exceeded/);
		assert.ok(Date.now() - parsingDeadlineStartedAt < 2000, "the corpus deadline should destroy slow PDF parsing promptly");

		const oversizedCorpus = await searchPdfCorpus({
			sources: [{ title: "Oversized streamed PDF", url: new URL("/fixtures/oversized-stream.pdf", fixture.url).href }],
			evidenceSlots: [],
			fetchTimeoutMs: 1000,
			maxPdfBytes: 1024,
			concurrency: 1,
		});
		assert.equal(oversizedCorpus.readableSourceCount, 0);
		assert.match(oversizedCorpus.failures[0]?.error || "", /corpus-search size limit/);

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
	await assertAssistantStreamingTextBlocksStaySeparated();
	await assertDestinationNavigationDefaultsToNewTab();
	await assertFreeTierVisualContextBudgeting();
	await assertSentryDiagnosticsGateAndScrub();
	await assertSelectionFormatting();
	await assertDocumentReviewMarkupLane();
	await assertLanePredicatesClassifyOnOwnWords();
	await assertLanePolicyProseMatchesEnforcedBudgets();
	await assertBlankReplyRetryWaitsForAgentIdle();
	await assertPublicActivitiesFilterInternalThinking();
	await assertToolRetryActivitiesFinalizeAsRecovered();
	await assertConstitutionPromptContract();
	await assertModelIntentClassifierOverridesPredicates();
	await assertPdfViewerFrameWaitsHaveTimeoutFallback();
	await assertBrowserContextSnapshotHasTimeoutFallback();
	await assertLearnerStateUpdates();
	await assertFallbackOpenCheckRecording();
	await assertPdfCitationFormatting();
	await assertSpacedReviewScheduling();
	await assertLearnerSourceSelfHealsByText();
	await assertLearnerSourceRecoversTextAcrossSessions();
	await assertLearnerSourceRecoversByConceptLabelWhenIdsDrift();
	await assertLearnerSourcePageFallbackWhenTextUnfindable();
	await assertLearnerSourceWiring();
	await assertModelIntentClassifierDefaultsOn();
	await assertLearningModeToolLoopPersistsAgentEvents();
	await assertLearningOpenCheckVoiceAnswerResolvesWithoutRegrounding();
	await assertGateAwareDraftBuffering();
	await assertFetchStateSkipsPageCaptureDuringActiveRequest();
	await assertReplayHighlightCandidateGeneration();
	await assertSessionBoundaryClearsActivePageAnnotations();
	await assertDeleteSessionSwitchesToRemainingOrFreshSession();
	await assertLegacySessionBlobMigratesToSessionRecords();
	await assertListSessionsReturnsAllSessionsByDefault();
	await assertSessionReplayRestore();
	await assertFailedToolTraceSummarizesError();
	await assertSelectedPdfAnchorIsReusedForPromptHighlight();
	await assertSessionReplayDoesNotTrustStaleTabIds();
	await assertSessionReplayDoesNotReuseSameTitleWrongUrl();
	await assertReplayRestoreRetriesEllipsisTextAndRefreshesCitationTargets();
	await assertEmptyArtifactRestoreDoesNotRunPageTools();
	await assertRelaxedUrlMatchingFindsRedirectedTab();
	await assertSnapshotFallbackWhenNavigationFails();
	await assertSnapshotFallbackWhenContentGone();
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
	await assertOnhandPdfViewerSourceUrlIdentity();
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
	await assertExactExtractContentPromptsInjectQuery();
	await assertUnknownPdfSelectionOpensViewerAndAsksForReselect();
	await assertVisualPdfQuestionsCaptureCurrentPageImageBeforeAnswering();
	await assertExplicitPdfHandoffRunsBeforeAgentContext();
	await assertAutomaticPdfHandoffRunsForDirectPdfBeforeAgentContext();
	await assertFixtureResponses();
	console.log("Browser runtime regressions: PASS");
}

main().catch((error) => {
	console.error(error?.stack || error?.message || String(error));
	process.exitCode = 1;
});
