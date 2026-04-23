import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { ONHAND_EXTENSION_RUNTIME_REVISION } from "../packages/browser-extension/runtime-revision.js";
import { pickFixtureMap } from "./show-test-fixtures.mjs";

const CONFIG_PATH = join(homedir(), ".config", "pi-browser-bridge", "config.json");
const DEFAULT_FIXTURES = ["onhand_github_repo", "personal_computer", "bayesian_dl"];
const FAST_TIMEOUT_MS = 3000;
const NAVIGATION_TIMEOUT_MS = 30000;
const ANNOTATION_TIMEOUT_MS = 6000;

const GITHUB_LAYOUT_CASES = [
	{ id: "github-heading-permalink", kind: "heading", text: "Current repository layout" },
	{ id: "github-inline-code", kind: "inline-code", text: "chrome.debugger" },
	{ id: "github-list-inline-code", kind: "list", text: "packages/browser-extension/" },
	{ id: "github-code-block", kind: "code-block", text: "npm run tmux:start" },
];

function parseArgs(argv) {
	const args = {
		fixtureIds: [],
		browserClient: "",
		browserClientId: "",
		maxCasesPerFixture: 5,
		checkRuntimeRevision: true,
		json: false,
		help: false,
	};

	for (const value of argv) {
		if (value === "--help" || value === "-h") {
			args.help = true;
			continue;
		}
		if (value === "--json") {
			args.json = true;
			continue;
		}
		if (value === "--skip-runtime-check") {
			args.checkRuntimeRevision = false;
			continue;
		}
		if (value.startsWith("--fixtures=")) {
			args.fixtureIds.push(...value.slice("--fixtures=".length).split(",").map((item) => item.trim()).filter(Boolean));
			continue;
		}
		if (value.startsWith("--fixture=")) {
			args.fixtureIds.push(value.slice("--fixture=".length).trim());
			continue;
		}
		if (value.startsWith("--browser-client=")) {
			args.browserClient = value.slice("--browser-client=".length).trim();
			continue;
		}
		if (value.startsWith("--client-id=")) {
			args.browserClientId = value.slice("--client-id=".length).trim();
			continue;
		}
		if (value.startsWith("--max-cases=")) {
			args.maxCasesPerFixture = Math.max(1, Math.min(12, Number(value.slice("--max-cases=".length)) || 1));
			continue;
		}
		if (value.startsWith("--")) {
			throw new Error(`Unknown option: ${value}`);
		}
		args.fixtureIds.push(value.trim());
	}

	if (!args.fixtureIds.length) args.fixtureIds = [...DEFAULT_FIXTURES];
	return args;
}

function printUsage() {
	console.log(`Usage: npm run test:note-layout -- [options]

Runs live note placement checks across fixture pages without calling the model.

Options:
  --fixtures=<ids>              Comma-separated fixture ids
  --fixture=<id>                Fixture id, repeatable
  --browser-client=<text>       Match connected browser by label, browser name, or id
  --client-id=<id>              Exact connected browser client id
  --max-cases=<n>               Max dynamic cases per fixture
  --skip-runtime-check          Do not compare extension runtime revision to source
  --json                        Print machine-readable output

Default fixtures: ${DEFAULT_FIXTURES.join(", ")}
Example:
  npm run test:note-layout -- --browser-client="Chrome Test"
`);
}

async function loadBridgeConfig() {
	const raw = await readFile(CONFIG_PATH, "utf8");
	const parsed = JSON.parse(raw);
	return {
		host: parsed.host || "127.0.0.1",
		port: Number(parsed.port || 3210),
		token: parsed.token || "",
	};
}

function buildAuthHeaders(token, hasBody = false) {
	const headers = new Headers();
	if (token) headers.set("Authorization", `Bearer ${token}`);
	if (hasBody) headers.set("Content-Type", "application/json");
	return headers;
}

async function requestJson(url, { token, method = "GET", body, timeoutMs = FAST_TIMEOUT_MS } = {}) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs).unref();
	try {
		const response = await fetch(url, {
			method,
			headers: buildAuthHeaders(token, body !== undefined),
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: controller.signal,
		});
		const text = await response.text();
		const data = text ? JSON.parse(text) : null;
		if (!response.ok || data?.ok === false) {
			throw new Error(data?.error || `HTTP ${response.status}`);
		}
		return data;
	} catch (error) {
		if (error?.name === "AbortError") throw new Error(`Request timed out: ${url}`);
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
}

function clientSearchText(client) {
	return [
		client?.clientId,
		client?.hello?.clientLabel,
		client?.hello?.browserName,
		client?.hello?.userAgent,
		client?.stateSummary?.activeTabTitle,
		client?.stateSummary?.activeTabUrl,
	]
		.filter(Boolean)
		.join("\n")
		.toLowerCase();
}

function clientLabel(client) {
	return client?.hello?.clientLabel || client?.hello?.browserName || "Browser";
}

function describeClient(client) {
	const tabs = Number(client?.stateSummary?.tabCount || 0);
	return `${clientLabel(client)} (${client?.clientId || "unknown id"}, ${tabs} tab${tabs === 1 ? "" : "s"})`;
}

function chooseClient(clients, args) {
	if (!Array.isArray(clients) || clients.length === 0) {
		throw new Error("No browser extension clients are connected to the bridge.");
	}
	if (args.browserClientId) {
		const exact = clients.find((client) => client?.clientId === args.browserClientId);
		if (!exact) throw new Error(`No connected browser client has id ${args.browserClientId}.`);
		return exact;
	}
	if (args.browserClient) {
		const needle = args.browserClient.toLowerCase();
		const matches = clients.filter((client) => clientSearchText(client).includes(needle));
		if (!matches.length) throw new Error(`No connected browser client matched "${args.browserClient}".`);
		if (matches.length > 1) {
			throw new Error(`Browser client selector "${args.browserClient}" matched multiple clients. Use --client-id.`);
		}
		return matches[0];
	}
	if (clients.length > 1) {
		const descriptions = clients.map((client) => `- ${describeClient(client)}`).join("\n");
		throw new Error(`Multiple browser clients are connected. Use --browser-client or --client-id.\n${descriptions}`);
	}
	return clients[0];
}

function normalizeComparableUrl(value) {
	try {
		const url = new URL(String(value || ""));
		url.hash = "";
		return url.toString().replace(/\/$/, "");
	} catch {
		return String(value || "").replace(/[#?].*$/, "").replace(/\/$/, "");
	}
}

function urlsMatch(actual, expected) {
	return normalizeComparableUrl(actual) === normalizeComparableUrl(expected);
}

function flattenTabs(state) {
	return (state?.windows || []).flatMap((windowInfo) =>
		(windowInfo.tabs || []).map((tab) => ({
			...tab,
			windowFocused: Boolean(windowInfo.focused),
		})),
	);
}

async function getClientState({ bridgeBaseUrl, token, clientId }) {
	const state = await requestJson(`${bridgeBaseUrl}/state?clientId=${encodeURIComponent(clientId)}`, {
		token,
		timeoutMs: FAST_TIMEOUT_MS,
	});
	return state.client?.state || null;
}

function discoverCasesExpression(fixtureId, maxCases) {
	const preferred = fixtureId === "onhand_github_repo" ? GITHUB_LAYOUT_CASES : [];
	return `(() => {
		const maxCases = ${Number(maxCases)};
		const preferred = ${JSON.stringify(preferred)};
		const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
		const root = document.querySelector("main article, article, main, #content, .mw-parser-output, body") || document.body;
		const isVisibleElement = (element) => {
			const style = getComputedStyle(element);
			if (style.display === "none" || style.visibility === "hidden") return false;
			const rect = element.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0;
		};
		const isBadRoot = (element) => Boolean(element.closest('[data-onhand-note-kind="card"], nav, header, footer, script, style, noscript, .navbox, .vertical-navbox'));
		const candidateText = (element, maxLength = 110) => {
			const text = normalize(element.innerText || element.textContent || "");
			if (!text) return "";
			if (text.length <= maxLength) return text;
			const sliced = text.slice(0, maxLength);
			return sliced.replace(/\\s+\\S*$/, "").trim() || sliced.trim();
		};
		const candidateCodeText = (element, maxLength = 90) => {
			const lines = String(element.innerText || element.textContent || "")
				.split(/\\n+/)
				.map((line) => normalize(line))
				.filter((line) => line.length >= 6 && line.length <= maxLength);
			return lines.find((line) => !/[{}$]/.test(line) && !/https?:\\/\\//i.test(line)) || "";
		};
		const existsOnPage = (text) => normalize(document.body?.innerText || document.body?.textContent || "").toLowerCase().includes(normalize(text).toLowerCase());
		const cases = preferred.filter((item) => existsOnPage(item.text)).map((item) => ({ ...item, optional: false }));
		const seen = new Set(cases.map((item) => normalize(item.text).toLowerCase()));
		const addFirst = (id, kind, selector, predicate = () => true, maxLength = 110, textFor = candidateText) => {
			for (const element of Array.from(root.querySelectorAll(selector))) {
				if (!(element instanceof Element)) continue;
				if (isBadRoot(element)) continue;
				if (!isVisibleElement(element)) continue;
				if (!predicate(element)) continue;
				const text = textFor(element, maxLength);
				if (text.length < 4) continue;
				const key = text.toLowerCase();
				if (seen.has(key)) continue;
				seen.add(key);
				cases.push({ id, kind, text, optional: true });
				return;
			}
		};
		addFirst("dynamic-heading", "heading", "h1, h2, h3", (element) => candidateText(element).length <= 120, 90);
		addFirst("dynamic-paragraph", "paragraph", "p", (element) => candidateText(element).length >= 25, 110);
		addFirst("dynamic-list-item", "list", "li", (element) => candidateText(element).length >= 8, 90);
		addFirst("dynamic-inline-code", "inline-code", "code", (element) => !element.closest("pre") && candidateText(element).length <= 80, 80);
		addFirst("dynamic-code-block", "code-block", "pre code, pre", (element) => candidateCodeText(element).length >= 6, 90, candidateCodeText);
		addFirst("dynamic-table-cell", "table-cell", "td, th", (element) => candidateText(element).length >= 4 && candidateText(element).length <= 100, 80);
		return cases.slice(0, Math.max(1, maxCases));
	})()`;
}

function analyzeNoteExpression(annotationId) {
	return `(() => {
		const annotationId = ${JSON.stringify(annotationId)};
		const note = [...document.querySelectorAll('[data-onhand-note-kind="card"]')]
			.find((candidate) => candidate.getAttribute("data-onhand-note-for") === annotationId);
		if (!note) return { found: false };
		const rectToObject = (rect) => ({
			x: rect.x,
			y: rect.y,
			width: rect.width,
			height: rect.height,
			top: rect.top,
			bottom: rect.bottom,
			left: rect.left,
			right: rect.right,
		});
		const rect = note.getBoundingClientRect();
		const parent = note.parentElement;
		const previous = note.previousElementSibling;
		const viewport = { width: innerWidth, height: innerHeight };
		const noteStyle = getComputedStyle(note);
		const contentRoot = note.closest(".markdown-body, article, main");
		const contentRootRect = contentRoot?.getBoundingClientRect?.() || null;
		const overflowClippingValues = new Set(["auto", "hidden", "scroll", "clip"]);
		const clippingAncestors = [];
		for (let ancestor = note.parentElement; ancestor && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
			const style = getComputedStyle(ancestor);
			const clipsX = overflowClippingValues.has(style.overflowX);
			const clipsY = overflowClippingValues.has(style.overflowY);
			if (!clipsX && !clipsY) continue;
			const ancestorRect = ancestor.getBoundingClientRect();
			const clippedX = clipsX && (rect.left < ancestorRect.left - 2 || rect.right > ancestorRect.right + 2);
			const clippedY = clipsY && (rect.top < ancestorRect.top - 2 || rect.bottom > ancestorRect.bottom + 2);
			if (!clippedX && !clippedY) continue;
			clippingAncestors.push({
				tag: ancestor.tagName,
				id: ancestor.id || "",
				className: String(ancestor.className || ""),
				overflowX: style.overflowX,
				overflowY: style.overflowY,
				rect: rectToObject(ancestorRect),
				clippedX,
				clippedY,
			});
		}
		const parentTag = parent?.tagName || "";
		return {
			found: true,
			text: note.textContent.trim().replace(/\\s+/g, " ").slice(0, 200),
			rect: rectToObject(rect),
			viewport,
			style: {
				position: noteStyle.position,
				zIndex: noteStyle.zIndex,
			},
			contentRoot: contentRoot ? {
				tag: contentRoot.tagName,
				id: contentRoot.id || "",
				className: String(contentRoot.className || ""),
				rect: rectToObject(contentRootRect),
			} : null,
			contentRootOverflow: contentRootRect ? {
				left: rect.left < contentRootRect.left - 2,
				right: rect.right > contentRootRect.right + 2,
			} : null,
			visibleInViewport: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth,
			viewportOverflow: {
				left: rect.left < -2,
				right: rect.right > innerWidth + 2,
				top: rect.top < -2,
				bottom: rect.bottom > innerHeight + 2,
			},
			parent: {
				tag: parentTag,
				id: parent?.id || "",
				className: String(parent?.className || ""),
			},
			previous: {
				tag: previous?.tagName || "",
				id: previous?.id || "",
				className: String(previous?.className || ""),
				text: previous?.textContent?.trim().replace(/\\s+/g, " ").slice(0, 120) || "",
			},
			insidePreOrCode: Boolean(parent?.closest("pre, code")),
			insideGithubHeading: parent?.classList?.contains("markdown-heading") === true,
			badParentTag: ["P", "CODE", "PRE", "UL", "OL", "TABLE", "THEAD", "TBODY", "TFOOT", "TR"].includes(parentTag),
			clippingAncestors,
		};
	})()`;
}

function validateNoteAnalysis(analysis) {
	const failures = [];
	if (!analysis?.found) failures.push("note card was not found");
	if (analysis?.found && !analysis.visibleInViewport) failures.push("note card is not visible in the viewport after show_note");
	if (analysis?.viewportOverflow?.left || analysis?.viewportOverflow?.right) failures.push("note card overflows the viewport horizontally");
	if (analysis?.viewportOverflow?.top || analysis?.viewportOverflow?.bottom) failures.push("note card overflows the viewport vertically");
	if (analysis?.contentRootOverflow?.left || analysis?.contentRootOverflow?.right) failures.push("note card overflows its content root horizontally");
	if (Number(analysis?.style?.zIndex) > 10) failures.push(`note card uses overlay-level z-index ${analysis.style.zIndex}`);
	if (analysis?.badParentTag) failures.push(`note card was inserted under invalid parent <${analysis.parent?.tag?.toLowerCase()}>`);
	if (analysis?.insidePreOrCode) failures.push("note card was inserted inside a pre/code container");
	if (analysis?.insideGithubHeading) failures.push("note card was inserted inside GitHub .markdown-heading");
	if (analysis?.clippingAncestors?.length) {
		failures.push(`note card is clipped by ${analysis.clippingAncestors.length} overflow ancestor(s)`);
	}
	return failures;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printUsage();
		return;
	}

	const fixtureMap = pickFixtureMap();
	const fixtures = args.fixtureIds.map((fixtureId) => {
		const fixture = fixtureMap.get(fixtureId);
		if (!fixture) throw new Error(`Unknown fixture id "${fixtureId}". Run npm run test:fixtures to list fixtures.`);
		return fixture;
	});

	const bridgeConfig = await loadBridgeConfig();
	const bridgeBaseUrl = `http://${bridgeConfig.host}:${bridgeConfig.port}`;
	const clientsResponse = await requestJson(`${bridgeBaseUrl}/clients`, { token: bridgeConfig.token });
	const client = chooseClient(clientsResponse.clients || [], args);
	const failures = [];
	const fixtureResults = [];

	async function command(name, commandArgs = {}, timeoutMs = FAST_TIMEOUT_MS) {
		return await requestJson(`${bridgeBaseUrl}/command`, {
			token: bridgeConfig.token,
			method: "POST",
			timeoutMs: timeoutMs + 1000,
			body: {
				name,
				args: commandArgs,
				timeoutMs,
				clientId: client.clientId,
			},
		});
	}

	const ping = await command("ping", {}, FAST_TIMEOUT_MS);
	const actualRevision = String(ping?.result?.runtimeRevision || client?.hello?.runtimeRevision || "").trim();
	if (args.checkRuntimeRevision && actualRevision !== ONHAND_EXTENSION_RUNTIME_REVISION) {
		failures.push(`Extension runtime revision mismatch. Expected ${ONHAND_EXTENSION_RUNTIME_REVISION}, found ${actualRevision || "(missing)"}; reload the unpacked extension.`);
	}

	for (const fixture of fixtures) {
		const fixtureFailures = [];
		const caseResults = [];
		const initialState = await getClientState({
			bridgeBaseUrl,
			token: bridgeConfig.token,
			clientId: client.clientId,
		});
		const exactTab = flattenTabs(initialState).find((tab) => tab?.url && urlsMatch(tab.url, fixture.url));
		const targetTab = exactTab
			? await command("activate_tab", { tabId: exactTab.id }, FAST_TIMEOUT_MS)
			: await command(
					"navigate",
					{
						url: fixture.url,
						newTab: false,
						active: true,
						waitForLoad: true,
						timeoutMs: NAVIGATION_TIMEOUT_MS,
					},
					NAVIGATION_TIMEOUT_MS,
				);
		const tab = targetTab?.result?.tab || exactTab;
		if (!tab?.id) {
			fixtureFailures.push("Could not determine target tab after navigation/activation.");
			fixtureResults.push({ fixture, ok: false, cases: caseResults, failures: fixtureFailures });
			failures.push(`${fixture.id}: ${fixtureFailures[0]}`);
			continue;
		}

		await command("clear_annotations", { tabId: tab.id }, FAST_TIMEOUT_MS);
		const discovered = await command(
			"run_js",
			{
				tabId: tab.id,
				expression: discoverCasesExpression(fixture.id, args.maxCasesPerFixture),
			},
			FAST_TIMEOUT_MS,
		);
		const cases = Array.isArray(discovered?.result?.result) ? discovered.result.result : [];
		if (!cases.length) {
			fixtureFailures.push("No note layout cases could be discovered.");
		}

		for (const noteCase of cases) {
			const result = {
				id: noteCase.id,
				kind: noteCase.kind,
				text: noteCase.text,
				optional: Boolean(noteCase.optional),
				ok: true,
				skipped: false,
				skipReason: "",
				failures: [],
				analysis: null,
			};
			try {
				await command("clear_annotations", { tabId: tab.id }, FAST_TIMEOUT_MS);
				const highlighted = await command(
					"highlight_text",
					{
						tabId: tab.id,
						text: noteCase.text,
						occurrence: 1,
						clearExisting: false,
						scrollIntoView: true,
					},
					ANNOTATION_TIMEOUT_MS,
				);
				const annotationId = highlighted?.result?.annotation?.annotationId;
				if (!annotationId) throw new Error("highlight_text did not return an annotation id");
				await command(
					"show_note",
					{
						tabId: tab.id,
						annotationId,
						note: `Note layout regression for ${noteCase.kind}.`,
						label: `Layout ${noteCase.kind}`,
					},
					ANNOTATION_TIMEOUT_MS,
				);
				const analyzed = await command(
					"run_js",
					{
						tabId: tab.id,
						expression: analyzeNoteExpression(annotationId),
					},
					FAST_TIMEOUT_MS,
				);
				result.analysis = analyzed?.result?.result || null;
				result.failures.push(...validateNoteAnalysis(result.analysis));
			} catch (error) {
				const message = error?.message || String(error);
				if (result.optional && message.includes("No visible text matched:")) {
					result.skipped = true;
					result.skipReason = message;
				} else {
					result.failures.push(message);
				}
			}
			result.ok = result.skipped || result.failures.length === 0;
			if (!result.ok) {
				fixtureFailures.push(`${noteCase.id}: ${result.failures.join("; ")}`);
				failures.push(`${fixture.id}/${noteCase.id}: ${result.failures.join("; ")}`);
			}
			caseResults.push(result);
		}

		await command("clear_annotations", { tabId: tab.id }, FAST_TIMEOUT_MS);
		fixtureResults.push({
			fixture: {
				id: fixture.id,
				title: fixture.title,
				url: fixture.url,
			},
			ok: fixtureFailures.length === 0,
			cases: caseResults,
			failures: fixtureFailures,
		});
	}

	const result = {
		ok: failures.length === 0,
		browserClient: {
			id: client.clientId,
			label: clientLabel(client),
			runtimeRevision: actualRevision,
			expectedRuntimeRevision: ONHAND_EXTENSION_RUNTIME_REVISION,
		},
		fixtures: fixtureResults,
		failures,
	};

	if (args.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(`Note layout regression: ${result.ok ? "PASS" : "FAIL"}`);
		console.log(`Browser client: ${result.browserClient.label} (${result.browserClient.id})`);
		console.log(`Runtime revision: ${result.browserClient.runtimeRevision || "(missing)"}`);
		for (const fixtureResult of result.fixtures) {
			console.log("");
			console.log(`${fixtureResult.ok ? "PASS" : "FAIL"} ${fixtureResult.fixture.id} - ${fixtureResult.fixture.title}`);
			for (const noteCase of fixtureResult.cases) {
				const parent = noteCase.analysis?.parent?.tag ? ` parent=<${noteCase.analysis.parent.tag.toLowerCase()}>` : "";
				const status = noteCase.skipped ? "SKIP" : noteCase.ok ? "OK" : "FAIL";
				const skipReason = noteCase.skipped ? ` - ${noteCase.skipReason}` : "";
				console.log(`- ${status} ${noteCase.id} (${noteCase.kind})${parent}${skipReason}`);
				for (const failure of noteCase.failures) console.log(`  ${failure}`);
			}
			for (const failure of fixtureResult.failures.filter((item) => !fixtureResult.cases.some((noteCase) => item.startsWith(`${noteCase.id}:`)))) {
				console.log(`- ${failure}`);
			}
		}
		if (result.failures.length) {
			console.log("");
			console.log("Failures:");
			for (const failure of result.failures) console.log(`- ${failure}`);
		}
	}

	if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error?.message || String(error));
	process.exitCode = 1;
});
