import { Readability } from "@mozilla/readability";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const CONFIG_FILE = join(homedir(), ".config", "pi-browser-bridge", "config.json");
const DEFAULT_BASE_URL = "http://127.0.0.1:3210";
const DEFAULT_TIMEOUT_MS = 15000;

const TAB_SELECTOR_PROPS = {
	tabId: Type.Optional(Type.Number({ description: "Exact tab ID to target" })),
	titleContains: Type.Optional(Type.String({ description: "Case-insensitive substring to match in the tab title" })),
	urlContains: Type.Optional(Type.String({ description: "Case-insensitive substring to match in the tab URL" })),
};

const LIST_TABS_SCHEMA = Type.Object({
	windowId: Type.Optional(Type.Number({ description: "Optional window ID filter" })),
	onlyActive: Type.Optional(Type.Boolean({ description: "Only include active tabs" })),
});

const ACTIVATE_TAB_SCHEMA = Type.Object({
	...TAB_SELECTOR_PROPS,
});

const NAVIGATE_SCHEMA = Type.Object({
	...TAB_SELECTOR_PROPS,
	url: Type.String({ description: "URL to navigate to" }),
	newTab: Type.Optional(Type.Boolean({ description: "Open in a new tab instead of navigating the current/target tab" })),
	waitForLoad: Type.Optional(Type.Boolean({ description: "Wait for the tab to finish loading (default true)" })),
	timeoutMs: Type.Optional(Type.Number({ description: "Navigation/load timeout in milliseconds (default 15000)" })),
});

const COOKIES_SCHEMA = Type.Object({
	...TAB_SELECTOR_PROPS,
});

const FIND_ELEMENTS_SCHEMA = Type.Object({
	...TAB_SELECTOR_PROPS,
	text: Type.String({ description: "Visible text or label text to search for" }),
	interactiveOnly: Type.Optional(Type.Boolean({ description: "Only search interactive/editable elements (default true)" })),
	exact: Type.Optional(Type.Boolean({ description: "Require an exact text match" })),
	includeHidden: Type.Optional(Type.Boolean({ description: "Include hidden elements in the search" })),
	maxResults: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default 10)" })),
});

const CLICK_TEXT_SCHEMA = Type.Object({
	...TAB_SELECTOR_PROPS,
	text: Type.String({ description: "Visible text of the element to click" }),
	exact: Type.Optional(Type.Boolean({ description: "Require an exact text match" })),
	includeHidden: Type.Optional(Type.Boolean({ description: "Include hidden elements in matching" })),
	maxResults: Type.Optional(Type.Number({ description: "Maximum number of candidate matches to consider" })),
});

const TYPE_BY_LABEL_SCHEMA = Type.Object({
	...TAB_SELECTOR_PROPS,
	labelText: Type.String({ description: "Label, placeholder, aria-label, or field name to match" }),
	text: Type.String({ description: "Text to type into the matched field" }),
	clear: Type.Optional(Type.Boolean({ description: "Clear the current field value first (default true)" })),
	submit: Type.Optional(Type.Boolean({ description: "Submit the form after typing when possible" })),
	exact: Type.Optional(Type.Boolean({ description: "Require an exact label match" })),
	includeHidden: Type.Optional(Type.Boolean({ description: "Include hidden fields in matching" })),
});

const PICK_ELEMENTS_SCHEMA = Type.Object({
	...TAB_SELECTOR_PROPS,
	message: Type.String({ description: "Instruction shown to the user while the page overlay picker is active" }),
});

const RUN_JS_SCHEMA = Type.Object({
	...TAB_SELECTOR_PROPS,
	expression: Type.String({ description: "JavaScript expression to evaluate in the target tab" }),
});

const GET_DOM_SCHEMA = Type.Object({
	...TAB_SELECTOR_PROPS,
	maxChars: Type.Optional(
		Type.Number({ description: "Maximum number of HTML characters to return (default 20000)" }),
	),
});

const SCREENSHOT_SCHEMA = Type.Object({
	...TAB_SELECTOR_PROPS,
});

const CLICK_SCHEMA = Type.Object({
	...TAB_SELECTOR_PROPS,
	selector: Type.String({ description: "CSS selector for the element to click" }),
});

const TYPE_SCHEMA = Type.Object({
	...TAB_SELECTOR_PROPS,
	selector: Type.String({ description: "CSS selector for the input or contenteditable element" }),
	text: Type.String({ description: "Text to type into the matched element" }),
	clear: Type.Optional(Type.Boolean({ description: "Clear existing value first (default true)" })),
	submit: Type.Optional(Type.Boolean({ description: "Submit the parent form after typing when possible" })),
});

const WAIT_FOR_SELECTOR_SCHEMA = Type.Object({
	...TAB_SELECTOR_PROPS,
	selector: Type.String({ description: "CSS selector to wait for" }),
	visible: Type.Optional(Type.Boolean({ description: "Require the element to be visible, not just present" })),
	timeoutMs: Type.Optional(Type.Number({ description: "How long to wait before timing out (default 10000)" })),
});

const CONSOLE_SCHEMA = Type.Object({
	...TAB_SELECTOR_PROPS,
	durationMs: Type.Optional(Type.Number({ description: "How long to observe console output (default 3000)" })),
	maxEntries: Type.Optional(Type.Number({ description: "Maximum number of console entries to keep (default 50)" })),
	reload: Type.Optional(Type.Boolean({ description: "Reload the page before collecting console output" })),
	ignoreCache: Type.Optional(Type.Boolean({ description: "Ignore cache when reload=true" })),
	expression: Type.Optional(Type.String({ description: "Optional JavaScript expression to evaluate after listeners are attached" })),
});

const NETWORK_SCHEMA = Type.Object({
	...TAB_SELECTOR_PROPS,
	durationMs: Type.Optional(Type.Number({ description: "How long to observe network activity (default 4000)" })),
	maxEntries: Type.Optional(Type.Number({ description: "Maximum number of network entries to keep (default 100)" })),
	reload: Type.Optional(Type.Boolean({ description: "Reload the page before collecting network activity" })),
	ignoreCache: Type.Optional(Type.Boolean({ description: "Ignore cache when reload=true" })),
	onlyFailures: Type.Optional(Type.Boolean({ description: "Only show failed network requests" })),
	matchUrlContains: Type.Optional(Type.String({ description: "Only show requests whose URL contains this substring" })),
	includeRequestHeaders: Type.Optional(Type.Boolean({ description: "Include request headers in the result" })),
	includeResponseHeaders: Type.Optional(Type.Boolean({ description: "Include response headers in the result" })),
	includeBodies: Type.Optional(Type.Boolean({ description: "Try to fetch response bodies for matching text responses" })),
	bodyMaxEntries: Type.Optional(Type.Number({ description: "Maximum number of response bodies to fetch when includeBodies=true (default 3)" })),
	bodyMaxChars: Type.Optional(Type.Number({ description: "Maximum number of characters to keep from each fetched response body (default 4000)" })),
});

const EXTRACT_CONTENT_SCHEMA = Type.Object({
	...TAB_SELECTOR_PROPS,
	maxChars: Type.Optional(Type.Number({ description: "Maximum number of markdown characters to return (default 20000)" })),
});

function normalizeBaseUrl(url: string | undefined) {
	return (url || DEFAULT_BASE_URL).replace(/\/$/, "");
}

async function loadBridgeConnection() {
	const envBaseUrl = normalizeBaseUrl(process.env.PI_BROWSER_BRIDGE_BASE_URL);
	const envToken = process.env.PI_BROWSER_BRIDGE_TOKEN;

	if (envToken) {
		return { baseUrl: envBaseUrl, token: envToken };
	}

	try {
		const raw = await readFile(CONFIG_FILE, "utf8");
		const parsed = JSON.parse(raw);
		return {
			baseUrl: normalizeBaseUrl(`http://${parsed.host || "127.0.0.1"}:${parsed.port || 3210}`),
			token: parsed.token,
		};
	} catch {
		throw new Error(
			`Browser bridge config not found. Start the bridge first or set PI_BROWSER_BRIDGE_BASE_URL and PI_BROWSER_BRIDGE_TOKEN. Expected config at ${CONFIG_FILE}`,
		);
	}
}

async function bridgeRequest(path: string, init: RequestInit = {}) {
	const connection = await loadBridgeConnection();
	const headers = new Headers(init.headers || {});
	headers.set("Authorization", `Bearer ${connection.token}`);
	if (init.body && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}

	let response: Response;
	try {
		response = await fetch(`${connection.baseUrl}${path}`, {
			...init,
			headers,
		});
	} catch (error: any) {
		throw new Error(`Could not reach browser bridge at ${connection.baseUrl}: ${error.message || String(error)}`);
	}

	let data: any;
	try {
		data = await response.json();
	} catch {
		throw new Error(`Browser bridge returned a non-JSON response for ${path}`);
	}

	if (!response.ok || data?.ok === false) {
		throw new Error(data?.error || `Browser bridge request failed: ${response.status}`);
	}

	return data;
}

async function getBridgeState() {
	const data = await bridgeRequest("/state");
	return data.client;
}

async function sendBridgeCommand(name: string, args: Record<string, any> = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
	const data = await bridgeRequest("/command", {
		method: "POST",
		body: JSON.stringify({ name, args, timeoutMs }),
	});
	return data.result;
}

function flattenTabs(state: any) {
	const windows = Array.isArray(state?.windows) ? state.windows : [];
	return windows.flatMap((windowInfo: any) =>
		(Array.isArray(windowInfo.tabs) ? windowInfo.tabs : []).map((tab: any) => ({
			...tab,
			windowFocused: Boolean(windowInfo.focused),
		})),
	);
}

function describeTab(tab: any) {
	const flags = [tab.windowFocused ? "focused-window" : null, tab.active ? "active" : null].filter(Boolean).join(", ");
	const prefix = flags ? `[${flags}] ` : "";
	return `${prefix}tab ${tab.id} (window ${tab.windowId}) ${tab.title || "(untitled)"} — ${tab.url || ""}`;
}

function describeElement(element: any) {
	if (!element) return "element";
	const parts = [element.tag ? `<${element.tag}>` : null, element.selector ? `selector ${element.selector}` : null];
	if (element.text) {
		parts.push(`text "${String(element.text).replace(/\s+/g, " ").trim().slice(0, 120)}"`);
	}
	return parts.filter(Boolean).join(", ");
}

function formatConsoleEntries(entries: any[]) {
	if (!Array.isArray(entries) || entries.length === 0) {
		return "No console entries were captured.";
	}
	const lines = entries.map((entry, index) => {
		const location = entry.url ? `\n   ${entry.url}${entry.lineNumber ? `:${entry.lineNumber}` : ""}` : "";
		const type = entry.type && entry.type !== entry.level ? ` (${entry.type})` : "";
		return `${index + 1}. [${entry.level || "info"}] ${String(entry.text || "").replace(/\s+/g, " ").trim()}${type}${location}`;
	});
	return stringifyValue(lines.join("\n"), 16000);
}

function formatNetworkEntries(entries: any[]) {
	if (!Array.isArray(entries) || entries.length === 0) {
		return "No network entries were captured.";
	}
	const lines = entries.map((entry, index) => {
		const status = entry.failed
			? `FAILED${entry.errorText ? ` (${entry.errorText})` : ""}`
			: typeof entry.status === "number"
				? `${entry.status}${entry.statusText ? ` ${entry.statusText}` : ""}`
				: "pending";
		const extras = [
			entry.resourceType || null,
			entry.mimeType || null,
			typeof entry.durationMs === "number" ? `${entry.durationMs}ms` : null,
			entry.fromDiskCache ? "disk-cache" : null,
			entry.fromServiceWorker ? "service-worker" : null,
		].filter(Boolean);
		const extraText = extras.length > 0 ? ` [${extras.join(", ")}]` : "";
		const blocks = [`${index + 1}. ${entry.method || "GET"} ${status}${extraText}`, `   ${entry.url || ""}`];
		if (entry.requestHeaders) {
			blocks.push(`   Request headers: ${stringifyValue(entry.requestHeaders, 2500)}`);
		}
		if (entry.responseHeaders) {
			blocks.push(`   Response headers: ${stringifyValue(entry.responseHeaders, 2500)}`);
		}
		if (entry.responseBody?.text) {
			const suffix = entry.responseBody.truncated ? "\n   [Response body truncated]" : "";
			blocks.push(`   Response body (${entry.responseBody.encoding || "text"}):\n${stringifyValue(entry.responseBody.text, 5000)}${suffix}`);
		}
		if (entry.responseBodyError) {
			blocks.push(`   Response body error: ${entry.responseBodyError}`);
		}
		return blocks.join("\n");
	});
	return stringifyValue(lines.join("\n\n"), 20000);
}

function formatCookies(cookies: any[]) {
	if (!Array.isArray(cookies) || cookies.length === 0) {
		return "No cookies were returned.";
	}
	const lines = cookies.map((cookie, index) => {
		const attrs = [
			cookie.httpOnly ? "httpOnly" : null,
			cookie.secure ? "secure" : null,
			cookie.session ? "session" : null,
			cookie.sameSite ? `sameSite=${cookie.sameSite}` : null,
		].filter(Boolean);
		return `${index + 1}. ${cookie.name}=${cookie.value}\n   domain=${cookie.domain}; path=${cookie.path}${attrs.length ? `; ${attrs.join('; ')}` : ""}`;
	});
	return stringifyValue(lines.join("\n\n"), 12000);
}

function formatElementMatches(matches: any[]) {
	if (!Array.isArray(matches) || matches.length === 0) {
		return "No matching elements were found.";
	}
	const lines = matches.map((match, index) => {
		const bits = [
			match.score ? `score=${match.score}` : null,
			match.matchedBy ? `matchedBy=${match.matchedBy}` : null,
			match.labelText ? `label=${JSON.stringify(match.labelText)}` : null,
			match.placeholder ? `placeholder=${JSON.stringify(match.placeholder)}` : null,
		].filter(Boolean);
		return `${index + 1}. ${describeElement(match)}${bits.length ? ` [${bits.join(", ")}]` : ""}`;
	});
	return stringifyValue(lines.join("\n"), 12000);
}

function htmlToMarkdown(html: string) {
	const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
	turndown.use(gfm);
	turndown.addRule("removeEmptyLinks", {
		filter: (node: any) => node.nodeName === "A" && !node.textContent?.trim(),
		replacement: () => "",
	});
	return turndown
		.turndown(html)
		.replace(/\[\\?\[\s*\\?\]\]\([^)]*\)/g, "")
		.replace(/ +/g, " ")
		.replace(/\s+,/g, ",")
		.replace(/\s+\./g, ".")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function extractReadableContentFromHtml(html: string, url: string, maxChars = 20000) {
	const doc = new JSDOM(html, { url });
	const reader = new Readability(doc.window.document);
	const article = reader.parse();

	let markdown: string;
	if (article?.content) {
		markdown = htmlToMarkdown(article.content);
	} else {
		const fallbackDoc = new JSDOM(html, { url });
		const fallbackBody = fallbackDoc.window.document;
		fallbackBody.querySelectorAll("script, style, noscript, nav, header, footer, aside").forEach((el) => el.remove());
		const main = fallbackBody.querySelector("main, article, [role='main'], .content, #content") || fallbackBody.body;
		markdown = htmlToMarkdown(main?.innerHTML || "");
	}

	const lines = [`URL: ${url}`];
	if (article?.title) lines.push(`Title: ${article.title}`);
		lines.push("");
	lines.push(markdown || "(Could not extract content)");
	return stringifyValue(lines.join("\n"), maxChars);
}

function filterTabs(state: any, params: any) {
	let tabs = flattenTabs(state);

	if (typeof params.windowId === "number") {
		tabs = tabs.filter((tab: any) => tab.windowId === params.windowId);
	}
	if (params.onlyActive) {
		tabs = tabs.filter((tab: any) => tab.active);
	}
	return tabs;
}

function resolveTabFromState(state: any, params: any) {
	const tabs = flattenTabs(state);

	if (typeof params.tabId === "number") {
		const tab = tabs.find((candidate: any) => candidate.id === params.tabId);
		if (!tab) throw new Error(`No tab with id ${params.tabId} found in bridge state`);
		return tab;
	}

	let matches = tabs;
	if (params.titleContains) {
		const needle = params.titleContains.toLowerCase();
		matches = matches.filter((tab: any) => (tab.title || "").toLowerCase().includes(needle));
	}
	if (params.urlContains) {
		const needle = params.urlContains.toLowerCase();
		matches = matches.filter((tab: any) => (tab.url || "").toLowerCase().includes(needle));
	}

	if (!params.titleContains && !params.urlContains) {
		const focusedActiveTabs = matches.filter((tab: any) => tab.active && tab.windowFocused);
		if (focusedActiveTabs.length > 0) {
			matches = focusedActiveTabs;
		} else {
			const activeTabs = matches.filter((tab: any) => tab.active);
			if (activeTabs.length > 0) {
				matches = activeTabs;
			}
		}
	}

	if (matches.length === 0) {
		throw new Error("No matching tab found in bridge state");
	}
	if (matches.length > 1) {
		const preview = matches.slice(0, 5).map(describeTab).join("\n");
		throw new Error(`Tab selector is ambiguous. Matches:\n${preview}`);
	}
	return matches[0];
}

function formatTabsText(state: any, params: any) {
	const windows = Array.isArray(state?.windows) ? state.windows : [];
	const filteredTabs = new Set(filterTabs(state, params).map((tab: any) => tab.id));
	const lines: string[] = [];

	for (const windowInfo of windows) {
		if (typeof params.windowId === "number" && windowInfo.id !== params.windowId) continue;
		const tabs = (windowInfo.tabs || []).filter((tab: any) => filteredTabs.has(tab.id));
		if (tabs.length === 0) continue;

		lines.push(`Window ${windowInfo.id}${windowInfo.focused ? " (focused)" : ""}`);
		for (const tab of tabs) {
			const markers = [tab.active ? "active" : null, tab.pinned ? "pinned" : null].filter(Boolean).join(", ");
			const markerText = markers ? ` [${markers}]` : "";
			lines.push(`  - tab ${tab.id}${markerText}: ${tab.title || "(untitled)"}`);
			lines.push(`    ${tab.url || ""}`);
		}
	}

	if (lines.length === 0) {
		return "No tabs matched the current filter.";
	}
	return lines.join("\n");
}

function stringifyValue(value: any, maxChars = 12000) {
	let text: string;
	if (typeof value === "string") {
		text = value;
	} else {
		const json = JSON.stringify(value, null, 2);
		text = json === undefined ? String(value) : json;
	}
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n\n[Truncated at ${maxChars} characters]`;
}

async function saveDataUrlToFile(dataUrl: string, tabId: number | undefined) {
	const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
	if (!match) throw new Error("Bridge returned an invalid screenshot payload");
	const mediaType = match[1];
	const base64 = match[2];
	const extension = mediaType.includes("jpeg") ? "jpg" : "png";
	const dir = join(tmpdir(), "pi-browser-bridge");
	await mkdir(dir, { recursive: true });
	const path = join(dir, `browser-shot-${Date.now()}-${tabId || "tab"}.${extension}`);
	await writeFile(path, Buffer.from(base64, "base64"));
	return path;
}

export default function browserBridgeExtension(pi: ExtensionAPI) {
	pi.registerCommand("browser-bridge-status", {
		description: "Show browser bridge connection status",
		handler: async (_args, ctx) => {
			try {
				const client = await getBridgeState();
				const tabs = flattenTabs(client.state);
				ctx.ui.notify(
					`Connected browser bridge client ${client.clientId} with ${tabs.length} tabs.`,
					"info",
				);
			} catch (error: any) {
				ctx.ui.notify(error.message || String(error), "error");
			}
		},
	});

	pi.registerTool({
		name: "browser_list_tabs",
		label: "Browser List Tabs",
		description: "List windows and tabs from the connected Chromium browser bridge",
		promptSnippet: "Inspect open browser windows and tabs from the connected browser bridge",
		promptGuidelines: [
			"Use this tool before targeting a browser tab when the correct tab is unclear.",
		],
		parameters: LIST_TABS_SCHEMA,
		async execute(_toolCallId, params) {
			const client = await getBridgeState();
			const text = formatTabsText(client.state, params);
			const tabs = filterTabs(client.state, params);
			return {
				content: [{ type: "text", text }],
				details: {
					clientId: client.clientId,
					tabCount: tabs.length,
					capturedAt: client.state?.capturedAt,
				},
			};
		},
	});

	pi.registerTool({
		name: "browser_activate_tab",
		label: "Browser Activate Tab",
		description: "Focus and activate a browser tab via the connected bridge",
		promptSnippet: "Activate a specific browser tab by id or fuzzy title/url match",
		promptGuidelines: [
			"Prefer listing tabs first when multiple tabs may match the user's request.",
		],
		parameters: ACTIVATE_TAB_SCHEMA,
		async execute(_toolCallId, params) {
			const client = await getBridgeState();
			const tab = resolveTabFromState(client.state, params);
			const result = await sendBridgeCommand("activate_tab", { tabId: tab.id });
			return {
				content: [{ type: "text", text: `Activated ${describeTab(result.tab)}` }],
				details: {
					tab: result.tab,
				},
			};
		},
	});

	pi.registerTool({
		name: "browser_navigate",
		label: "Browser Navigate",
		description: "Navigate a browser tab to a URL, optionally in a new tab",
		promptSnippet: "Navigate the current or selected browser tab to a URL",
		promptGuidelines: [
			"Use this tool instead of browser_run_js for normal URL navigation.",
		],
		parameters: NAVIGATE_SCHEMA,
		async execute(_toolCallId, params) {
			const client = await getBridgeState();
			const args: Record<string, any> = {
				url: params.url,
				newTab: params.newTab,
				waitForLoad: params.waitForLoad,
				timeoutMs: params.timeoutMs,
			};
			if (!params.newTab) {
				const tab = resolveTabFromState(client.state, params);
				args.tabId = tab.id;
			}
			const result = await sendBridgeCommand("navigate", args, (typeof params.timeoutMs === "number" ? params.timeoutMs : 15000) + 5000);
			return {
				content: [{ type: "text", text: `Navigated ${describeTab(result.tab)}` }],
				details: { tab: result.tab },
			};
		},
	});

	pi.registerTool({
		name: "browser_get_cookies",
		label: "Browser Get Cookies",
		description: "Read cookies for a browser tab",
		promptSnippet: "Inspect cookies for the current or selected browser tab",
		parameters: COOKIES_SCHEMA,
		async execute(_toolCallId, params) {
			const client = await getBridgeState();
			const tab = resolveTabFromState(client.state, params);
			const result = await sendBridgeCommand("get_cookies", { tabId: tab.id }, 20000);
			return {
				content: [{ type: "text", text: `Cookies for ${describeTab(result.tab)}\n\n${formatCookies(result.cookies || [])}` }],
				details: { tab: result.tab, cookieCount: Array.isArray(result.cookies) ? result.cookies.length : 0 },
			};
		},
	});

	pi.registerTool({
		name: "browser_find_elements",
		label: "Browser Find Elements",
		description: "Find page elements by visible text, labels, placeholders, or aria labels",
		promptSnippet: "Search a live browser page for elements by visible text and return selector candidates",
		promptGuidelines: [
			"Use this tool before browser_click_text or browser_type_by_label when the page structure is unclear.",
		],
		parameters: FIND_ELEMENTS_SCHEMA,
		async execute(_toolCallId, params) {
			const client = await getBridgeState();
			const tab = resolveTabFromState(client.state, params);
			const result = await sendBridgeCommand(
				"find_elements",
				{
					tabId: tab.id,
					text: params.text,
					interactiveOnly: params.interactiveOnly,
					exact: params.exact,
					includeHidden: params.includeHidden,
					maxResults: params.maxResults,
				},
				20000,
			);
			return {
				content: [{ type: "text", text: `Found ${(result.matches || []).length} element matches in ${describeTab(result.tab)}\n\n${formatElementMatches(result.matches || [])}` }],
				details: { tab: result.tab, matchCount: Array.isArray(result.matches) ? result.matches.length : 0 },
			};
		},
	});

	pi.registerTool({
		name: "browser_wait_for_selector",
		label: "Browser Wait For Selector",
		description: "Wait for a CSS selector to appear in a browser tab",
		promptSnippet: "Wait for a CSS selector to exist (and optionally become visible) in a browser tab",
		promptGuidelines: [
			"Use this tool before clicking or typing on dynamic pages where the target element may not exist yet.",
		],
		parameters: WAIT_FOR_SELECTOR_SCHEMA,
		async execute(_toolCallId, params) {
			const client = await getBridgeState();
			const tab = resolveTabFromState(client.state, params);
			const result = await sendBridgeCommand(
				"wait_for_selector",
				{
					tabId: tab.id,
					selector: params.selector,
					visible: params.visible,
					timeoutMs: params.timeoutMs,
				},
				(typeof params.timeoutMs === "number" ? params.timeoutMs : 10000) + 5000,
			);
			return {
				content: [
					{
						type: "text",
						text: `Found ${describeElement(result.element)} in ${describeTab(result.tab)}`,
					},
				],
				details: {
					tab: result.tab,
					element: result.element,
				},
			};
		},
	});

	pi.registerTool({
		name: "browser_click",
		label: "Browser Click",
		description: "Click an element in a browser tab using a CSS selector",
		promptSnippet: "Click an element in a browser tab by CSS selector",
		promptGuidelines: [
			"Use browser_wait_for_selector first if the page is still loading or updating.",
		],
		parameters: CLICK_SCHEMA,
		async execute(_toolCallId, params) {
			const client = await getBridgeState();
			const tab = resolveTabFromState(client.state, params);
			const result = await sendBridgeCommand("click", { tabId: tab.id, selector: params.selector }, 20000);
			return {
				content: [
					{
						type: "text",
						text: `Clicked ${describeElement(result.element)} in ${describeTab(result.tab)}`,
					},
				],
				details: {
					tab: result.tab,
					element: result.element,
				},
			};
		},
	});

	pi.registerTool({
		name: "browser_type",
		label: "Browser Type",
		description: "Type text into an input or contenteditable element in a browser tab",
		promptSnippet: "Type text into a browser input field by CSS selector",
		promptGuidelines: [
			"Use clear=true when replacing an existing value and submit=true when the form should be submitted immediately after typing.",
		],
		parameters: TYPE_SCHEMA,
		async execute(_toolCallId, params) {
			const client = await getBridgeState();
			const tab = resolveTabFromState(client.state, params);
			const result = await sendBridgeCommand(
				"type_text",
				{
					tabId: tab.id,
					selector: params.selector,
					text: params.text,
					clear: params.clear,
					submit: params.submit,
				},
				20000,
			);
			return {
				content: [
					{
						type: "text",
						text: `Typed into ${describeElement(result.element)} in ${describeTab(result.tab)}`,
					},
				],
				details: {
					tab: result.tab,
					element: result.element,
				},
			};
		},
	});

	pi.registerTool({
		name: "browser_click_text",
		label: "Browser Click Text",
		description: "Click the best matching interactive element by visible text",
		promptSnippet: "Click a browser element by visible text rather than a CSS selector",
		promptGuidelines: [
			"Prefer this tool when the user refers to a button, link, or control by visible text.",
		],
		parameters: CLICK_TEXT_SCHEMA,
		async execute(_toolCallId, params) {
			const client = await getBridgeState();
			const tab = resolveTabFromState(client.state, params);
			const result = await sendBridgeCommand(
				"click_text",
				{
					tabId: tab.id,
					text: params.text,
					exact: params.exact,
					includeHidden: params.includeHidden,
					maxResults: params.maxResults,
				},
				20000,
			);
			return {
				content: [{ type: "text", text: `Clicked ${describeElement(result.element)} in ${describeTab(result.tab)}\n\nCandidates:\n${formatElementMatches(result.matches || [])}` }],
				details: { tab: result.tab, element: result.element },
			};
		},
	});

	pi.registerTool({
		name: "browser_type_by_label",
		label: "Browser Type By Label",
		description: "Type into the best matching field by label, placeholder, or aria-label",
		promptSnippet: "Type into a browser field using human-facing label text instead of a CSS selector",
		promptGuidelines: [
			"Prefer this tool when the user refers to a form field by its label or placeholder.",
		],
		parameters: TYPE_BY_LABEL_SCHEMA,
		async execute(_toolCallId, params) {
			const client = await getBridgeState();
			const tab = resolveTabFromState(client.state, params);
			const result = await sendBridgeCommand(
				"type_by_label",
				{
					tabId: tab.id,
					labelText: params.labelText,
					text: params.text,
					clear: params.clear,
					submit: params.submit,
					exact: params.exact,
					includeHidden: params.includeHidden,
				},
				20000,
			);
			return {
				content: [{ type: "text", text: `Typed into ${describeElement(result.element)} in ${describeTab(result.tab)} (matched by ${result.matchedBy || "unknown"})\n\nCandidates:\n${formatElementMatches(result.matches || [])}` }],
				details: { tab: result.tab, element: result.element, matchedBy: result.matchedBy },
			};
		},
	});

	pi.registerTool({
		name: "browser_pick_elements",
		label: "Browser Pick Elements",
		description: "Open an interactive picker overlay in the browser so the user can click elements",
		promptSnippet: "Let the user pick page elements interactively in the visible browser and return selector information",
		promptGuidelines: [
			"Use this tool when the correct element is ambiguous and the user should click it directly in the browser.",
		],
		parameters: PICK_ELEMENTS_SCHEMA,
		async execute(_toolCallId, params) {
			const client = await getBridgeState();
			const tab = resolveTabFromState(client.state, params);
			const result = await sendBridgeCommand("pick_elements", { tabId: tab.id, message: params.message }, 5 * 60 * 1000);
			const selectionText = Array.isArray(result.selection)
				? formatElementMatches(result.selection)
				: formatElementMatches(result.selection ? [result.selection] : []);
			return {
				content: [{ type: "text", text: `Element picker finished for ${describeTab(result.tab)}\n\n${selectionText}` }],
				details: { tab: result.tab, selection: result.selection },
			};
		},
	});

	pi.registerTool({
		name: "browser_collect_console",
		label: "Browser Collect Console",
		description: "Collect console messages, warnings, and exceptions from a browser tab",
		promptSnippet: "Observe console output from a browser tab, optionally after reload or after running a JavaScript expression",
		promptGuidelines: [
			"Use this tool for debugging page errors, warnings, and console output on live pages.",
			"Set reload=true when you need console output produced during page load.",
		],
		parameters: CONSOLE_SCHEMA,
		async execute(_toolCallId, params) {
			const client = await getBridgeState();
			const tab = resolveTabFromState(client.state, params);
			const timeoutMs = (typeof params.durationMs === "number" ? params.durationMs : 3000) + 10000;
			const result = await sendBridgeCommand(
				"collect_console",
				{
					tabId: tab.id,
					durationMs: params.durationMs,
					maxEntries: params.maxEntries,
					reload: params.reload,
					ignoreCache: params.ignoreCache,
					expression: params.expression,
				},
				timeoutMs,
			);
			return {
				content: [
					{
						type: "text",
						text: `Collected ${(result.entries || []).length} console entries from ${describeTab(result.tab)}\n\n${formatConsoleEntries(result.entries || [])}`,
					},
				],
				details: {
					tab: result.tab,
					entryCount: Array.isArray(result.entries) ? result.entries.length : 0,
				},
			};
		},
	});

	pi.registerTool({
		name: "browser_collect_network",
		label: "Browser Collect Network",
		description: "Collect network requests and responses from a browser tab",
		promptSnippet: "Observe network activity from a browser tab, typically during reload or a specific user action",
		promptGuidelines: [
			"Use this tool to inspect requests, response status codes, and failed resource loads.",
			"Set reload=true when you need the full network activity for a page load.",
			"Set includeResponseHeaders or includeBodies when debugging API responses or HTML payloads.",
		],
		parameters: NETWORK_SCHEMA,
		async execute(_toolCallId, params) {
			const client = await getBridgeState();
			const tab = resolveTabFromState(client.state, params);
			const timeoutMs =
				(typeof params.durationMs === "number" ? params.durationMs : 4000) +
				(params.includeBodies ? 15000 : 10000);
			const result = await sendBridgeCommand(
				"collect_network",
				{
					tabId: tab.id,
					durationMs: params.durationMs,
					maxEntries: params.maxEntries,
					reload: params.reload,
					ignoreCache: params.ignoreCache,
					onlyFailures: params.onlyFailures,
					matchUrlContains: params.matchUrlContains,
					includeRequestHeaders: params.includeRequestHeaders,
					includeResponseHeaders: params.includeResponseHeaders,
					includeBodies: params.includeBodies,
					bodyMaxEntries: params.bodyMaxEntries,
					bodyMaxChars: params.bodyMaxChars,
				},
				timeoutMs,
			);
			let entries = Array.isArray(result.entries) ? result.entries : [];
			if (params.onlyFailures) {
				entries = entries.filter((entry: any) => entry.failed);
			}
			if (params.matchUrlContains) {
				const needle = params.matchUrlContains.toLowerCase();
				entries = entries.filter((entry: any) => (entry.url || "").toLowerCase().includes(needle));
			}
			return {
				content: [
					{
						type: "text",
						text: `Collected ${entries.length} network entries from ${describeTab(result.tab)}\n\n${formatNetworkEntries(entries)}`,
					},
				],
				details: {
					tab: result.tab,
					entryCount: entries.length,
				},
			};
		},
	});

	pi.registerTool({
		name: "browser_run_js",
		label: "Browser Run JS",
		description: "Evaluate JavaScript in a browser tab via chrome.debugger",
		promptSnippet: "Run JavaScript in a browser tab and return the result",
		promptGuidelines: [
			"Use this tool for targeted DOM inspection or extraction from a live page.",
		],
		parameters: RUN_JS_SCHEMA,
		async execute(_toolCallId, params) {
			const client = await getBridgeState();
			const tab = resolveTabFromState(client.state, params);
			const result = await sendBridgeCommand("run_js", {
				tabId: tab.id,
				expression: params.expression,
			});
			return {
				content: [
					{
						type: "text",
						text: `Ran JavaScript in ${describeTab(result.tab)}\n\nResult:\n${stringifyValue(result.result)}`,
					},
				],
				details: {
					tab: result.tab,
					resultType: typeof result.result,
				},
			};
		},
	});

	pi.registerTool({
		name: "browser_get_dom",
		label: "Browser Get DOM",
		description: "Fetch outer HTML from a browser tab via chrome.debugger",
		promptSnippet: "Get the DOM/HTML for a browser tab",
		promptGuidelines: [
			"Use this tool when raw page HTML is more useful than a screenshot.",
		],
		parameters: GET_DOM_SCHEMA,
		async execute(_toolCallId, params) {
			const client = await getBridgeState();
			const tab = resolveTabFromState(client.state, params);
			const result = await sendBridgeCommand("get_dom", { tabId: tab.id }, 25000);
			const maxChars = typeof params.maxChars === "number" ? params.maxChars : 20000;
			const html = stringifyValue(result.outerHTML, maxChars);
			return {
				content: [
					{
						type: "text",
						text: `DOM for ${describeTab(result.tab)}\n\n${html}`,
					},
				],
				details: {
					tab: result.tab,
					htmlLength: typeof result.outerHTML === "string" ? result.outerHTML.length : undefined,
				},
			};
		},
	});

	pi.registerTool({
		name: "browser_extract_content",
		label: "Browser Extract Content",
		description: "Extract readable article/page content as markdown from a browser tab",
		promptSnippet: "Extract readable content from a live browser tab as markdown",
		promptGuidelines: [
			"Use this tool when the user wants a readable summary of a page instead of raw HTML.",
		],
		parameters: EXTRACT_CONTENT_SCHEMA,
		async execute(_toolCallId, params) {
			const client = await getBridgeState();
			const tab = resolveTabFromState(client.state, params);
			const result = await sendBridgeCommand("get_dom", { tabId: tab.id }, 25000);
			const maxChars = typeof params.maxChars === "number" ? params.maxChars : 20000;
			const content = extractReadableContentFromHtml(result.outerHTML || "", result.tab?.url || tab.url || "", maxChars);
			return {
				content: [{ type: "text", text: content }],
				details: { tab: result.tab, extracted: true },
			};
		},
	});

	pi.registerTool({
		name: "browser_capture_screenshot",
		label: "Browser Capture Screenshot",
		description: "Capture a screenshot of a browser tab via the connected bridge",
		promptSnippet: "Capture a screenshot of a browser tab and save it to a temp file",
		parameters: SCREENSHOT_SCHEMA,
		async execute(_toolCallId, params) {
			const client = await getBridgeState();
			const tab = resolveTabFromState(client.state, params);
			const result = await sendBridgeCommand("capture_screenshot", { tabId: tab.id }, 25000);
			const path = await saveDataUrlToFile(result.dataUrl, result.tab?.id);
			return {
				content: [
					{
						type: "text",
						text: `Saved screenshot for ${describeTab(result.tab)} to ${path}`,
					},
				],
				details: {
					tab: result.tab,
					path,
				},
			};
		},
	});
}
