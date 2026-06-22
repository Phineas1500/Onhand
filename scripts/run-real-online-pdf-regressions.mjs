// Real online PDF smoke/regression test.
//
// This intentionally uses public remote PDFs rather than local fixtures. It is
// network-dependent, so keep it out of preflight, but run it before releases
// when PDF behavior changed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const EXT_DIR = fileURLToPath(new URL("../packages/browser-extension", import.meta.url));
const EXT_ID_FALLBACK = "hpjpjeehgbloadhdidmecpijppodibim";
const VERBOSE = Boolean(process.env.ONHAND_TEST_VERBOSE);
const OVERALL_TIMEOUT_MS = 360_000;

const BROWSER_CANDIDATES = [
	process.env.ONHAND_TEST_BROWSER,
	"/Applications/Helium.app/Contents/MacOS/Helium",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
].filter(Boolean);

const PDF_CASES = [
	{
		id: "w3c-dummy",
		url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
		readPage: 1,
		readPattern: /Dummy PDF file/i,
		searchText: "Dummy PDF file",
		highlightText: "Dummy PDF file",
		noteText: "W3C dummy PDF online smoke note.",
	},
	{
		id: "irs-w4",
		url: "https://www.irs.gov/pub/irs-pdf/fw4.pdf",
		readPage: 1,
		readPattern: /Form W-4|Employee'?s Withholding Certificate/i,
		searchText: "Employee's Withholding Certificate",
		highlightText: "Employee's Withholding Certificate",
		noteText: "IRS W-4 online PDF smoke note.",
	},
	{
		id: "anthropic-fable-mythos-card",
		url: "https://www-cdn.anthropic.com/2f9323abbcc4abe219577539efe19a623c9ca2bd/Claude%20Fable%205%20&%20Claude%20Mythos%205%20System%20Card.pdf",
		readPage: 3,
		readPattern: /Executive Summary|Claude Mythos 5 and Claude Fable 5/i,
		searchText: "Responsible Scaling Policy",
		highlightText: "Responsible Scaling Policy",
		noteText: "Anthropic system card online PDF smoke note.",
	},
	{
		id: "arxiv-attention",
		url: "https://arxiv.org/pdf/1706.03762",
		readPage: 1,
		readPattern: /Attention Is All You Need|Ashish Vaswani/i,
		searchText: "Scaled Dot-Product Attention",
		highlightText: "Scaled Dot-Product Attention",
		noteText: "Attention paper online PDF smoke note.",
		citationReference: "2",
		citationPattern: /Bahdanau|Neural machine translation|jointly learning to align/i,
	},
];

function findBrowser() {
	for (const candidate of BROWSER_CANDIDATES) if (existsSync(candidate)) return candidate;
	return null;
}

function extraBrowserFlags() {
	return String(process.env.ONHAND_TEST_BROWSER_FLAGS || "")
		.split(/\s+/)
		.map((flag) => flag.trim())
		.filter(Boolean);
}

const log = (...args) => {
	if (VERBOSE) console.log(...args);
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function compact(value) {
	return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function pickAvailablePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() => {
				if (port > 0) resolve(port);
				else reject(new Error("Could not allocate a CDP port"));
			});
		});
	});
}

function launchBrowser(profile, port) {
	const browser = findBrowser();
	if (!browser) throw new Error("No Chromium-based browser found. Set ONHAND_TEST_BROWSER.");
	return spawn(
		browser,
		[
			`--user-data-dir=${profile}`,
			`--load-extension=${EXT_DIR}`,
			`--disable-extensions-except=${EXT_DIR}`,
			`--remote-debugging-port=${port}`,
			"--no-first-run",
			"--no-default-browser-check",
			"--window-size=1280,1100",
			...extraBrowserFlags(),
			"about:blank",
		],
		{ stdio: "ignore", detached: false },
	);
}

function connect(url) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
		ws.on("open", () => resolve(ws));
		ws.on("error", reject);
	});
}

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.nextId = 1;
		this.pending = new Map();
		ws.on("message", (raw) => {
			const message = JSON.parse(raw);
			if (!message.id || !this.pending.has(message.id)) return;
			const entry = this.pending.get(message.id);
			this.pending.delete(message.id);
			if (message.error) entry.reject(new Error(message.error.message + (message.error.data ? `: ${message.error.data}` : "")));
			else entry.resolve(message.result);
		});
	}

	send(method, params = {}, sessionId) {
		return new Promise((resolve, reject) => {
			const id = this.nextId++;
			this.pending.set(id, { resolve, reject });
			this.ws.send(JSON.stringify({ id, method, params, sessionId }));
		});
	}
}

async function waitForCdp(port, timeoutMs = 20_000) {
	const startedAt = Date.now();
	for (;;) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (res.ok) return await res.json();
		} catch {}
		if (Date.now() - startedAt > timeoutMs) throw new Error("Browser CDP endpoint did not come up");
		await delay(300);
	}
}

async function openContext(port) {
	const version = await waitForCdp(port);
	const cdp = new Cdp(await connect(version.webSocketDebuggerUrl));
	let extId = EXT_ID_FALLBACK;
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const targets = (await cdp.send("Target.getTargets")).targetInfos;
		const target = targets.find((entry) => {
			const url = String(entry.url || "");
			const title = String(entry.title || "");
			return url.startsWith(`chrome-extension://${EXT_ID_FALLBACK}/`) || title.includes("Onhand");
		});
		if (target?.url) {
			extId = new URL(target.url).host;
			break;
		}
		await delay(250);
	}
	const driverUrl = `chrome-extension://${extId}/pdf-viewer.html?driver=1`;
	const { targetId } = await cdp.send("Target.createTarget", { url: driverUrl, background: true });
	const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
	const evalIn = async (sid, expression) => {
		const res = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sid);
		if (res.exceptionDetails) throw new Error(`page exception: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
		return res.result?.value;
	};
	const driverEval = (expression) => evalIn(sessionId, expression);
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const ready = await driverEval(
			`JSON.stringify({ href: location.href, ready: document.readyState, hasRuntime: typeof chrome?.runtime?.sendMessage === "function" })`,
		);
		const state = JSON.parse(String(ready || "{}"));
		if (state.hasRuntime) break;
		if (attempt === 59) throw new Error(`Extension driver did not expose chrome.runtime.sendMessage: ${ready}`);
		await delay(250);
	}
	const sendMessage = (payload) => driverEval(`chrome.runtime.sendMessage(${JSON.stringify(payload)})`);
	const tool = async (name, args = {}) => {
		const response = await sendMessage({ type: "sidebar:realtime-browser-tool", tool: name, args });
		if (!response?.ok) throw new Error(`${name} failed: ${response?.error || JSON.stringify(response)}`);
		return response.result;
	};
	return { cdp, extId, evalIn, driverEval, sendMessage, tool };
}

async function createSourceTab(ctx, url) {
	const serialized = await ctx.driverEval(`new Promise((resolve, reject) => {
		chrome.tabs.create({ url: ${JSON.stringify(url)}, active: true }, (tab) => {
			const error = chrome.runtime.lastError;
			if (error) reject(new Error(error.message));
			else resolve(JSON.stringify({ id: tab.id, windowId: tab.windowId, url: tab.url || "", title: tab.title || "" }));
		});
	})`);
	const tab = JSON.parse(String(serialized || "{}"));
	assert.ok(tab.id, `source tab should be created for ${url}: ${serialized}`);
	await delay(1500);
	return tab;
}

async function waitForViewerSession(ctx, pdfUrl) {
	for (let attempt = 0; attempt < 90; attempt += 1) {
		const targets = (await ctx.cdp.send("Target.getTargets")).targetInfos;
		const frame = targets.find((target) => {
			if (target.type !== "iframe" && target.type !== "page") return false;
			const url = String(target.url || "");
			if (!url.includes("pdf-viewer.html?url=")) return false;
			try {
				return decodeURIComponent(url).includes(pdfUrl);
			} catch {
				return url.includes(encodeURIComponent(pdfUrl));
			}
		});
		if (frame) {
			try {
				const attached = await ctx.cdp.send("Target.attachToTarget", { targetId: frame.targetId, flatten: true });
				const status = await ctx.evalIn(
					attached.sessionId,
					`JSON.stringify({
						rendered: document.body?.getAttribute("data-onhand-pdf-rendered"),
						textSpans: document.querySelectorAll(".textLayer span").length,
						error: document.querySelector(".onhand-pdf-error")?.textContent || ""
					})`,
				);
				const parsed = JSON.parse(String(status || "{}"));
				if (parsed.error) throw new Error(`viewer error for ${pdfUrl}: ${parsed.error}`);
				if (parsed.rendered === "true" && Number(parsed.textSpans || 0) > 0) return attached.sessionId;
			} catch (error) {
				if (String(error?.message || error).includes("viewer error")) throw error;
			}
		}
		await delay(500);
	}
	throw new Error(`Timed out waiting for Onhand viewer text layer: ${pdfUrl}`);
}

async function openPdfInViewer(ctx, testCase) {
	const sourceTab = await createSourceTab(ctx, testCase.url);
	let opened = await ctx.tool("browser_open_pdf_in_onhand_viewer", {
		pdfUrl: testCase.url,
		tabId: sourceTab.id,
		windowId: sourceTab.windowId,
		waitForLoad: true,
	});
	if (!opened?.viewerReady?.ready) {
		await delay(1500);
		opened = await ctx.tool("browser_open_pdf_in_onhand_viewer", {
			pdfUrl: testCase.url,
			tabId: sourceTab.id,
			windowId: sourceTab.windowId,
			waitForLoad: true,
			forceReload: true,
		});
	}
	assert.ok(opened?.tab?.id, `${testCase.id}: PDF viewer should return a tab`);
	const viewerSessionId = await waitForViewerSession(ctx, testCase.url);
	return { tabId: opened.tab.id, viewerSessionId };
}

function summarizeSearch(search) {
	const matches = Array.isArray(search?.matches) ? search.matches : [];
	return {
		matchCount: Number(search?.matchCount || matches.length || 0),
		firstPage: Number(matches[0]?.pageNumber || 0),
		firstText: String(matches[0]?.matchedText || matches[0]?.snippet || ""),
	};
}

async function assertPassiveHighlightDom(ctx, sessionId, annotationId, label) {
	const raw = await ctx.evalIn(
		sessionId,
		`(() => {
			const highlights = [...document.querySelectorAll('[data-onhand-highlight-kind="pdf"]')];
			const notes = [...document.querySelectorAll('[data-onhand-note-for]')];
			const target = highlights.find((el) => el.getAttribute("data-onhand-annotation-id") === ${JSON.stringify(annotationId)}) || highlights[0] || null;
			if (!target) return JSON.stringify({ highlightCount: 0, noteCount: notes.length });
			const rect = target.getBoundingClientRect();
			const hit = document.elementFromPoint(rect.left + Math.min(Math.max(rect.width / 2, 2), Math.max(rect.width - 2, 2)), rect.top + Math.min(Math.max(rect.height / 2, 2), Math.max(rect.height - 2, 2)));
			return JSON.stringify({
				highlightCount: highlights.length,
				noteCount: notes.length,
				pointerEvents: getComputedStyle(target).pointerEvents,
				cursor: getComputedStyle(target).cursor,
				role: target.getAttribute("role") || "",
				tabIndex: target.getAttribute("tabindex") || "",
				ariaHidden: target.getAttribute("aria-hidden") || "",
				hitHighlightKind: hit?.getAttribute?.("data-onhand-highlight-kind") || "",
				hitTag: hit?.tagName || "",
				hitClass: String(hit?.className || ""),
			});
		})()`,
	);
	const state = JSON.parse(String(raw || "{}"));
	assert.ok(state.highlightCount >= 1, `${label}: expected at least one PDF highlight in viewer DOM`);
	assert.ok(state.noteCount >= 1, `${label}: expected at least one Onhand note in viewer DOM`);
	assert.equal(state.pointerEvents, "none", `${label}: PDF highlight should not intercept pointer events`);
	assert.notEqual(state.cursor, "pointer", `${label}: PDF highlight should not look clickable`);
	assert.equal(state.role, "", `${label}: PDF highlight should not expose button role`);
	assert.equal(state.tabIndex, "", `${label}: PDF highlight should not be tab-focusable`);
	assert.equal(state.ariaHidden, "true", `${label}: passive PDF highlight should be hidden from accessibility tree`);
	assert.notEqual(state.hitHighlightKind, "pdf", `${label}: elementFromPoint should pass through the highlight overlay`);
}

async function runPdfCase(ctx, testCase) {
	console.log(`- ${testCase.id}: opening ${testCase.url}`);
	const { tabId, viewerSessionId } = await openPdfInViewer(ctx, testCase);

	const read = await ctx.tool("browser_pdf_read_pages", {
		tabId,
		pageNumber: testCase.readPage,
		maxChars: 2400,
	});
	const readText = JSON.stringify(read?.pages || read || {});
	assert.match(readText, testCase.readPattern, `${testCase.id}: read_pages should include expected text`);

	const searchResult = await ctx.tool("browser_pdf_search", {
		tabId,
		query: testCase.searchText,
		maxMatches: 5,
		maxContextChars: 160,
	});
	const search = summarizeSearch(searchResult?.search);
	assert.ok(search.matchCount >= 1, `${testCase.id}: search should find ${testCase.searchText}`);
	assert.ok(search.firstPage >= 1, `${testCase.id}: search match should include a page number`);

	const jump = await ctx.tool("browser_pdf_jump_to_page", {
		tabId,
		pageNumber: search.firstPage,
		text: testCase.searchText,
	});
	assert.equal(Number(jump?.jump?.pageNumber || search.firstPage), search.firstPage, `${testCase.id}: jump should land on search page`);

	const image = await ctx.tool("browser_pdf_capture_page_image", {
		tabId,
		pageNumber: search.firstPage,
		format: "png",
	});
	const dataUrl = String(image?.image?.dataUrl || image?.dataUrl || "");
	assert.match(dataUrl, /^data:image\/png;base64,/, `${testCase.id}: PDF page capture should return a PNG data URL`);
	assert.ok(dataUrl.length > 100, `${testCase.id}: PDF page capture should not be empty`);

	const highlight = await ctx.tool("browser_highlight_text", {
		tabId,
		text: testCase.highlightText,
		clearExisting: true,
		scrollIntoView: true,
	});
	const annotation = highlight?.annotation || {};
	assert.ok(annotation.annotationId, `${testCase.id}: highlight should return annotationId`);
	assert.match(compact(annotation.matchedText), new RegExp(compact(testCase.highlightText).slice(0, 12)), `${testCase.id}: highlight should match requested text`);
	assert.equal(annotation.pdfAnchor?.surface, "pdf", `${testCase.id}: highlight should include PDF anchor`);

	const note = await ctx.tool("browser_show_note", {
		tabId,
		annotationId: annotation.annotationId,
		note: testCase.noteText,
		label: "Onhand",
	});
	assert.equal(String(note?.note?.annotationId || ""), annotation.annotationId, `${testCase.id}: note should attach to highlight`);

	const scrolled = await ctx.tool("browser_scroll_to_annotation", {
		tabId,
		annotationId: annotation.annotationId,
		target: "annotation",
	});
	assert.ok(scrolled?.annotation || scrolled?.ok !== false, `${testCase.id}: scroll_to_annotation should succeed`);

	await delay(500);
	await assertPassiveHighlightDom(ctx, viewerSessionId, annotation.annotationId, testCase.id);

	if (testCase.citationReference) {
		const citationResult = await ctx.tool("browser_pdf_find_citation", {
			tabId,
			reference: testCase.citationReference,
		});
		const citation = citationResult?.citation || {};
		assert.equal(citation.found, true, `${testCase.id}: citation ${testCase.citationReference} should be found`);
		assert.match(String(citation.entryText || ""), testCase.citationPattern, `${testCase.id}: citation entry should match expected reference`);
		assert.ok(Number(citation.pageNumber || 0) >= 1, `${testCase.id}: citation should include a page number`);
		const citationJump = await ctx.tool("browser_pdf_jump_to_page", {
			tabId,
			pageNumber: citation.pageNumber,
			text: citation.entryText,
		});
		assert.equal(Number(citationJump?.jump?.pageNumber || citation.pageNumber), Number(citation.pageNumber), `${testCase.id}: citation jump should land on bibliography page`);
	}

	console.log(`  PASS ${testCase.id}: read/search/jump/capture/highlight/note/scroll${testCase.citationReference ? "/citation" : ""}`);
}

async function run() {
	if (!findBrowser()) {
		console.log("SKIPPED: no Chromium-based browser found (set ONHAND_TEST_BROWSER).");
		return "skipped";
	}

	const profile = await mkdtemp(join(tmpdir(), "onhand-online-pdf-test-"));
	const port = await pickAvailablePort();
	const child = launchBrowser(profile, port);
	try {
		const ctx = await openContext(port);
		for (const testCase of PDF_CASES) await runPdfCase(ctx, testCase);
		return "passed";
	} finally {
		try {
			child.kill("SIGKILL");
		} catch {}
		await rm(profile, { recursive: true, force: true }).catch(() => {});
	}
}

const timeout = setTimeout(() => {
	console.error("Real online PDF regressions: FAIL (overall timeout)");
	process.exit(1);
}, OVERALL_TIMEOUT_MS);
timeout.unref();

run()
	.then((outcome) => {
		if (outcome !== "skipped") console.log("Real online PDF regressions: PASS");
		process.exit(0);
	})
	.catch((error) => {
		console.error(`Real online PDF regressions: FAIL\n${error?.stack || error}`);
		process.exit(1);
	});
