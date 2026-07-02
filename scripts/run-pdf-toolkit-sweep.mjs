// PDF toolkit sweep: model-free coverage of the PDF extract -> anchor contract.
//
// The teaching flow's core contract also holds for PDFs: any span the model
// copies from browser_pdf_read_pages / extraction must be anchorable with
// browser_highlight_text on the PDF's text layer. run-page-toolkit-sweep.mjs
// validates this for HTML; PDFs are a completely separate matching surface
// (pdf.js text layer in the Onhand viewer, viewer handoff, PDF anchors), so
// they get their own sweep.
//
// Unlike the HTML sweep (isolated-world injection), PDF surfaces need the
// extension's own viewer, so this harness launches a real Chromium/Helium
// with the unpacked extension (temp profile), drives the extension's actual
// command layer through the realtime tool bridge, and per PDF:
//   1. opens the PDF through browser_open_pdf_in_onhand_viewer
//   2. reads early pages with browser_pdf_read_pages
//   3. samples sentence spans from that text and asserts each anchors via
//      browser_highlight_text within a latency budget
//   4. round-trips a distinctive phrase through browser_pdf_search
//
// No model calls. Pages that fail to load (network flake, site change) are
// SKIP; span/search failures on a loaded PDF exit non-zero.
//
// Usage:
//   node scripts/run-pdf-toolkit-sweep.mjs [--pdf <id>]... [--list]
//     [--max-sentences 5] [--budget-ms 4000] [--keep-browser]
//   Browser: ONHAND_TEST_BROWSER=/path/to/chromium (defaults to Helium).
//   SKIPS (exit 0) when no browser binary is found.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const EXT_DIR = fileURLToPath(new URL("../packages/browser-extension", import.meta.url));
const EXT_ID_FALLBACK = "hpjpjeehgbloadhdidmecpijppodibim";
const CDP_PORT_OVERRIDE = process.env.ONHAND_TEST_CDP_PORT ? Number(process.env.ONHAND_TEST_CDP_PORT) : null;
const VERBOSE = Boolean(process.env.ONHAND_TEST_VERBOSE);

const BROWSER_CANDIDATES = [
	process.env.ONHAND_TEST_BROWSER,
	"/Applications/Helium.app/Contents/MacOS/Helium",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
].filter(Boolean);

// Real-PDF corpus across layout families. PDF-specific URLs are test data by
// design — the production toolkit stays generic; this corpus is how we notice
// when a layout family breaks it.
const SWEEP_PDFS = [
	{ id: "generated-fixture", family: "controlled", url: "__generated__" },
	{ id: "bitcoin-whitepaper", family: "single-column", url: "https://bitcoin.org/bitcoin.pdf" },
	{ id: "attention-paper", family: "latex-ligatures", url: "https://arxiv.org/pdf/1706.03762" },
	{ id: "resnet-two-column", family: "two-column", url: "https://arxiv.org/pdf/1512.03385" },
	{ id: "nist-fips-180-4", family: "gov-spec", url: "https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf" },
	{ id: "irs-f1040", family: "form", url: "https://www.irs.gov/pub/irs-pdf/f1040.pdf" },
	{ id: "berkshire-letter", family: "prose-letter", url: "https://www.berkshirehathaway.com/letters/2023ltr.pdf" },
	{ id: "mackay-itprnn", family: "latex-book", url: "https://www.inference.org.uk/itprnn/book.pdf" },
	{ id: "pdf-spec", family: "large-spec", url: "https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf" },
];

function parseArgs(argv) {
	const args = { pdfIds: [], list: false, maxSentences: 5, budgetMs: 4000, keepBrowser: false };
	for (let index = 2; index < argv.length; index += 1) {
		const value = argv[index];
		const readValue = (flag) => (value.includes("=") ? value.slice(flag.length + 1) : argv[(index += 1)]);
		const readNumber = (flag) => {
			const raw = readValue(flag);
			const parsed = Number(raw);
			if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} requires a positive number, got: ${raw}`);
			return parsed;
		};
		if (value === "--pdf" || value.startsWith("--pdf=")) args.pdfIds.push(String(readValue("--pdf")).trim());
		else if (value === "--list") args.list = true;
		else if (value === "--max-sentences" || value.startsWith("--max-sentences=")) args.maxSentences = readNumber("--max-sentences");
		else if (value === "--budget-ms" || value.startsWith("--budget-ms=")) args.budgetMs = readNumber("--budget-ms");
		else if (value === "--keep-browser") args.keepBrowser = true;
		else throw new Error(`Unknown argument: ${value}`);
	}
	return args;
}

const stage = (label) => VERBOSE && console.log(`  [stage] ${label}`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findBrowser() {
	for (const candidate of BROWSER_CANDIDATES) if (existsSync(candidate)) return candidate;
	return null;
}

// --- Minimal single-page text PDF generator (no dependencies) ---------------
function pdfEscape(value) {
	return String(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function generateTextPdf(lines) {
	let content = "BT\n/F1 14 Tf\n72 740 Td\n";
	lines.forEach((line, index) => {
		if (index > 0) content += "0 -26 Td\n";
		content += `(${pdfEscape(line)}) Tj\n`;
	});
	content += "ET";
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`,
	];
	let pdf = "%PDF-1.4\n";
	const offsets = [];
	objects.forEach((body, index) => {
		offsets.push(pdf.length);
		pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xrefStart = pdf.length;
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
	return Buffer.from(pdf, "latin1");
}

// Controlled fixture: plain sentences plus a hyphenated line break, the
// classic PDF text-layer hazard (the extraction shows "hyphen-\nation").
const FIXTURE_LINES = [
	"The controlled fixture document opens with a plain declarative sentence for sampling.",
	"Rejection sampling requires a global constant that bounds the target density everywhere.",
	"This paragraph intentionally demonstrates a mid-word hyphen-",
	"ation break across two rendered lines of the page.",
	"A single UNIQUEPHRASE token appears exactly once inside this fixture document.",
];

// --- CDP plumbing ------------------------------------------------------------
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
			if (message.id && this.pending.has(message.id)) {
				const entry = this.pending.get(message.id);
				this.pending.delete(message.id);
				if (message.error) entry.reject(new Error(message.error.message + (message.error.data ? `: ${message.error.data}` : "")));
				else entry.resolve(message.result);
			}
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

async function waitForCdp(port, timeoutMs = 20000) {
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

function launchBrowser(profile, port) {
	const browserPath = findBrowser();
	if (!browserPath) throw new Error(`No Chromium-based browser found; checked: ${BROWSER_CANDIDATES.join(", ")}`);
	return spawn(
		browserPath,
		[
			`--user-data-dir=${profile}`,
			`--load-extension=${EXT_DIR}`,
			`--disable-extensions-except=${EXT_DIR}`,
			`--remote-debugging-port=${port}`,
			"--no-first-run",
			"--no-default-browser-check",
			"--window-size=1200,1000",
			"about:blank",
		],
		{ stdio: "ignore", detached: false },
	);
}

function pickAvailablePort() {
	if (Number.isFinite(CDP_PORT_OVERRIDE) && CDP_PORT_OVERRIDE > 0) return Promise.resolve(CDP_PORT_OVERRIDE);
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

// Driver page inside the extension origin so chrome.runtime/chrome.tabs work.
async function openContext(port) {
	const version = await waitForCdp(port);
	const cdp = new Cdp(await connect(version.webSocketDebuggerUrl));
	let extId = EXT_ID_FALLBACK;
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const targets = (await cdp.send("Target.getTargets")).targetInfos;
		const target = targets.find((t) => {
			const url = String(t.url || "");
			return url.startsWith("chrome-extension://") && (url.includes(EXT_ID_FALLBACK) || String(t.title || "").includes("Onhand"));
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
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const ready = await driverEval(
			`JSON.stringify({ hasRuntime: typeof chrome?.runtime?.sendMessage === "function", hasTabs: typeof chrome?.tabs?.create === "function" })`,
		);
		const state = JSON.parse(String(ready || "{}"));
		if (state.hasRuntime && state.hasTabs) break;
		if (attempt === 39) throw new Error(`Extension driver page did not expose chrome APIs: ${ready}`);
		await delay(250);
	}
	const tool = async (name, args) => {
		const response = await driverEval(`chrome.runtime.sendMessage(${JSON.stringify({ type: "sidebar:realtime-browser-tool", tool: name, args })})`);
		if (!response?.ok) throw new Error(response?.error || `Could not run ${name}`);
		return response.result;
	};
	const createTab = async (url) => {
		const serialized = await driverEval(`new Promise((resolve, reject) => {
			chrome.tabs.create({ url: ${JSON.stringify(url)}, active: true }, (tab) => {
				const error = chrome.runtime.lastError;
				if (error) { reject(new Error(error.message)); return; }
				resolve(JSON.stringify({ id: tab.id, windowId: tab.windowId }));
			});
		})`);
		return JSON.parse(String(serialized || "{}"));
	};
	const removeTabs = async (tabIds) => {
		const ids = tabIds.filter((id) => Number.isInteger(id) && id > 0);
		if (!ids.length) return;
		await driverEval(`new Promise((resolve) => chrome.tabs.remove(${JSON.stringify(ids)}, () => { void chrome.runtime.lastError; resolve(true); }))`).catch(() => {});
	};
	return { cdp, extId, driverEval, tool, createTab, removeTabs };
}

// --- Span sampling ------------------------------------------------------------
function collectPdfPageTexts(payload) {
	// readPdfPages payloads vary in nesting; collect anything page-shaped.
	const texts = [];
	const seen = new Set();
	const walk = (node) => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const item of node) walk(item);
			return;
		}
		const pageNumber = Number(node.pageNumber ?? node.page);
		const text = typeof node.text === "string" ? node.text : "";
		if (Number.isFinite(pageNumber) && text.trim() && !seen.has(pageNumber)) {
			seen.add(pageNumber);
			texts.push({ pageNumber, text });
		}
		for (const value of Object.values(node)) walk(value);
	};
	walk(payload);
	return texts.sort((left, right) => left.pageNumber - right.pageNumber);
}

function sampleSentences(pageTexts, maxSentences) {
	const sentences = [];
	for (const { text } of pageTexts) {
		const flat = text.replace(/\s+/g, " ").trim();
		for (const raw of flat.split(/(?<=[.!?])\s+(?=[A-Z"“(\[])/)) {
			const sentence = raw.trim();
			if (sentence.length < 45 || sentence.length > 240) continue;
			const letters = (sentence.match(/[a-zA-Z]/g) || []).length;
			if (letters / sentence.length < 0.6) continue;
			sentences.push(sentence);
		}
	}
	if (!sentences.length) return [];
	const picks = new Set();
	for (const position of [0, 0.25, 0.5, 0.75, 1]) {
		if (picks.size >= maxSentences) break;
		picks.add(sentences[Math.min(sentences.length - 1, Math.round(position * (sentences.length - 1)))]);
	}
	return Array.from(picks).slice(0, maxSentences);
}

function sampleSearchPhrase(pageTexts) {
	// A distinctive mid-document phrase: 4 consecutive words, mostly lowercase letters.
	for (const { text } of pageTexts.slice().reverse()) {
		const words = text.replace(/\s+/g, " ").trim().split(" ");
		for (let index = Math.floor(words.length / 2); index + 4 <= words.length; index += 1) {
			const phrase = words.slice(index, index + 4).join(" ");
			if (/^[a-zA-Z][a-zA-Z ,'-]{14,60}$/.test(phrase)) return phrase;
		}
	}
	return null;
}

// --- Sweep --------------------------------------------------------------------
async function sweepPdf(ctx, pdf, options) {
	const result = { pdf, spans: [], search: null, skipped: null };
	const openedTabs = [];
	try {
		stage(`opening ${pdf.id}`);
		const sourceTab = await ctx.createTab("about:blank");
		if (sourceTab.id) openedTabs.push(sourceTab.id);
		await delay(600);
		let opened = await ctx.tool("browser_open_pdf_in_onhand_viewer", { pdfUrl: pdf.url, waitForLoad: true });
		if (!opened?.viewerReady?.ready) {
			await delay(2500);
			opened = await ctx.tool("browser_open_pdf_in_onhand_viewer", { pdfUrl: pdf.url, waitForLoad: true }).catch(() => opened);
		}
		const viewerTabId = opened?.tab?.id;
		if (Number.isInteger(viewerTabId) && !openedTabs.includes(viewerTabId)) openedTabs.push(viewerTabId);

		// Poll until the text layer yields page text (viewer render is async).
		let pageTexts = [];
		let lastReadError = "";
		for (let attempt = 0; attempt < 12 && !pageTexts.length; attempt += 1) {
			try {
				const pages = await ctx.tool("browser_pdf_read_pages", { startPage: 1, maxPages: 4, maxChars: 16000 });
				pageTexts = collectPdfPageTexts(pages);
			} catch (error) {
				lastReadError = error?.message || String(error);
			}
			if (!pageTexts.length) await delay(1500);
		}
		if (!pageTexts.length) throw new Error(`No PDF page text extracted${lastReadError ? ` (${lastReadError.slice(0, 140)})` : ""}`);

		const spans = sampleSentences(pageTexts, options.maxSentences).map((text) => ({ type: "sentence", text }));
		if (!spans.length) throw new Error("No usable spans sampled from PDF text");

		for (const span of spans) {
			const startedAt = Date.now();
			let outcome;
			try {
				const highlighted = await ctx.tool("browser_highlight_text", { text: span.text, scrollIntoView: false });
				const annotation = highlighted?.annotation || {};
				outcome = { ok: true, kind: annotation.kind || null, approximate: Boolean(annotation.approximate), fallback: annotation.fallback || null };
			} catch (error) {
				outcome = { ok: false, error: String(error?.message || error).slice(0, 200) };
			}
			result.spans.push({ ...span, ...outcome, ms: Date.now() - startedAt });
		}

		const phrase = sampleSearchPhrase(pageTexts);
		if (phrase) {
			try {
				const search = await ctx.tool("browser_pdf_search", { query: phrase, maxMatches: 5 });
				const matches = collectPdfPageTexts(search).length || (Array.isArray(search?.search?.matches) ? search.search.matches.length : 0);
				result.search = { phrase, ok: matches > 0, matches };
			} catch (error) {
				result.search = { phrase, ok: false, error: String(error?.message || error).slice(0, 160) };
			}
		}

		await ctx.tool("browser_clear_annotations", {}).catch(() => {});
	} catch (error) {
		result.skipped = error?.message || String(error);
	} finally {
		await ctx.removeTabs(openedTabs);
		await delay(300);
	}
	return result;
}

function formatSpan(span) {
	return `${span.type}:"${span.text.slice(0, 60)}${span.text.length > 60 ? "…" : ""}"`;
}

async function main() {
	const options = parseArgs(process.argv);
	if (options.list) {
		for (const pdf of SWEEP_PDFS) console.log(`${pdf.id}\t${pdf.family}\t${pdf.url}`);
		return;
	}
	if (!findBrowser()) {
		console.log("Page toolkit PDF sweep: SKIP (no Chromium/Helium binary found; set ONHAND_TEST_BROWSER)");
		return;
	}
	let pdfs = SWEEP_PDFS;
	if (options.pdfIds.length) {
		pdfs = SWEEP_PDFS.filter((pdf) => options.pdfIds.includes(pdf.id));
		const missing = options.pdfIds.filter((id) => !pdfs.some((pdf) => pdf.id === id));
		if (missing.length) throw new Error(`Unknown pdf id(s): ${missing.join(", ")}`);
	}

	// Serve the generated fixture when it is part of the run.
	let fixtureServer = null;
	if (pdfs.some((pdf) => pdf.url === "__generated__")) {
		const body = generateTextPdf(FIXTURE_LINES);
		fixtureServer = http.createServer((req, res) => {
			if ((req.url || "").startsWith("/fixture.pdf")) {
				res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": body.length });
				res.end(body);
				return;
			}
			res.writeHead(404);
			res.end();
		});
		await new Promise((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
		const fixtureUrl = `http://127.0.0.1:${fixtureServer.address().port}/fixture.pdf`;
		pdfs = pdfs.map((pdf) => (pdf.url === "__generated__" ? { ...pdf, url: fixtureUrl } : pdf));
	}

	const profile = await mkdtemp(join(tmpdir(), "onhand-pdf-sweep-"));
	const port = await pickAvailablePort();
	const browser = launchBrowser(profile, port);
	let failedSpans = 0;
	let approximateSpans = 0;
	let slowSpans = 0;
	let failedSearches = 0;
	let skippedPdfs = 0;
	try {
		const ctx = await openContext(port);
		for (const pdf of pdfs) {
			const result = await sweepPdf(ctx, pdf, options);
			if (result.skipped) {
				skippedPdfs += 1;
				console.log(`SKIP ${pdf.id} (${pdf.family}) — ${result.skipped}`);
				continue;
			}
			const failures = result.spans.filter((span) => !span.ok);
			const approximates = result.spans.filter((span) => span.ok && span.approximate);
			const slow = result.spans.filter((span) => span.ok && span.ms > options.budgetMs);
			failedSpans += failures.length;
			approximateSpans += approximates.length;
			slowSpans += slow.length;
			const searchOk = result.search ? result.search.ok : true;
			if (!searchOk) failedSearches += 1;
			const p95 = result.spans.map((span) => span.ms).sort((a, b) => a - b)[Math.floor((result.spans.length - 1) * 0.95)] || 0;
			const status = failures.length || slow.length || !searchOk ? "FAIL" : "PASS";
			console.log(
				`${status} ${pdf.id} (${pdf.family}) spans=${result.spans.length} exact=${result.spans.filter((span) => span.ok && !span.approximate).length} approx=${approximates.length} fail=${failures.length} search=${result.search ? (searchOk ? `ok(${result.search.matches})` : "FAIL") : "n/a"} p95=${p95}ms`,
			);
			for (const span of failures) console.log(`  FAIL ${formatSpan(span)} — ${span.error}`);
			for (const span of slow) console.log(`  SLOW ${formatSpan(span)} — ${span.ms}ms > ${options.budgetMs}ms`);
			for (const span of approximates) console.log(`  approx ${formatSpan(span)} — fallback=${span.fallback || "none"}`);
			if (result.search && !result.search.ok) console.log(`  SEARCH-FAIL "${result.search.phrase}" — ${result.search.error || "0 matches"}`);
		}
	} finally {
		if (!options.keepBrowser) {
			browser.kill();
			await delay(500);
			await rm(profile, { recursive: true, force: true }).catch(() => {});
		}
		fixtureServer?.close();
	}
	console.log(
		`\nPDF toolkit sweep: pdfs=${pdfs.length} skipped=${skippedPdfs} spanFailures=${failedSpans} approximate=${approximateSpans} slow=${slowSpans} searchFailures=${failedSearches}`,
	);
	if (failedSpans || slowSpans || failedSearches) {
		console.error("PDF toolkit sweep: FAIL");
		process.exitCode = 1;
		return;
	}
	console.log("PDF toolkit sweep: PASS");
}

main().catch((error) => {
	console.error(`pdf-toolkit-sweep: ${error?.message || error}`);
	process.exitCode = 1;
});
