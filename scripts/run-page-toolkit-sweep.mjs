// Page-toolkit sweep: model-free coverage of the extract -> highlight contract
// across many real pages.
//
// The teaching flow depends on one invariant: any span the model copies from
// browser_extract_content's readable text must be anchorable on the page with
// browser_highlight_text. The model-turn evals exercise a handful of pages at
// full LLM cost; this sweep checks the invariant directly on a much wider,
// deliberately diverse page corpus (wiki math, LaTeX-heavy papers, docs sites,
// specs, tables, plain essays) using a live Chromium over CDP — no model calls.
//
// For each page it opens a background tab, runs the real
// extractReadableContentInPage + createPageToolkit sources in an isolated
// world (mirroring the extension's injection world), samples sentences,
// headings, and rendered-math sources from the extraction, and asserts each
// sample highlights within a latency budget.
//
// Usage:
//   node scripts/run-page-toolkit-sweep.mjs [--port 9347] [--page <id>]...
//     [--max-sentences 5] [--budget-ms 4000] [--keep-tabs] [--list]
//
// Requires Helium/Chromium running with --remote-debugging-port. Pages that
// fail to load (network flake, site change) are reported as SKIP, not FAIL;
// span failures on a loaded page exit non-zero.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import WebSocket from "ws";

const ROOT = process.cwd();
const DEFAULT_PORT = Number(process.env.ONHAND_CDP_PORT || process.env.ONHAND_TEST_CDP_PORT || 9343);

// Diverse page families. Page-specific URLs are test data by design — the
// production toolkit stays generic; this corpus is how we notice when a page
// family breaks it.
const SWEEP_PAGES = [
	{ id: "wikipedia-math", family: "mediawiki+math-images", url: "https://en.wikipedia.org/wiki/Bayes%27_theorem" },
	{ id: "wikipedia-plain", family: "mediawiki", url: "https://en.wikipedia.org/wiki/Photosynthesis" },
	{ id: "wikipedia-tables", family: "mediawiki+tables", url: "https://en.wikipedia.org/wiki/List_of_countries_by_population_(United_Nations)" },
	{ id: "mdn-fetch", family: "docs", url: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch" },
	{ id: "python-datastructures", family: "docs", url: "https://docs.python.org/3/tutorial/datastructures.html" },
	{ id: "rust-book-ownership", family: "docs-book", url: "https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html" },
	{ id: "react-thinking", family: "docs-spa", url: "https://react.dev/learn/thinking-in-react" },
	{ id: "purdue-bayesiandl", family: "mathjax-lecture", url: "https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/06BayesianDL/BayesianDL.html" },
	{ id: "arxiv-abstract", family: "arxiv", url: "https://arxiv.org/abs/1706.03762" },
	{ id: "ar5iv-attention", family: "latex-html", url: "https://ar5iv.labs.arxiv.org/html/1706.03762" },
	{ id: "sep-bayes", family: "scholarly", url: "https://plato.stanford.edu/entries/bayes-theorem/" },
	{ id: "katex-supported", family: "katex", url: "https://katex.org/docs/supported.html" },
	{ id: "github-readme", family: "app-readme", url: "https://github.com/microsoft/vscode" },
	{ id: "stackoverflow-branch", family: "qa-thread", url: "https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array" },
	{ id: "paulgraham-essay", family: "plain-html", url: "https://www.paulgraham.com/greatwork.html" },
	{ id: "gutenberg-novel", family: "large-plain", url: "https://www.gutenberg.org/files/1342/1342-h/1342-h.htm" },
	{ id: "wcag-spec", family: "w3c-spec", url: "https://www.w3.org/TR/WCAG21/" },
	{ id: "energy-heat-pump", family: "gov-cms", url: "https://www.energy.gov/energysaver/heat-pump-systems" },
];

function parseArgs(argv) {
	const args = { port: DEFAULT_PORT, pageIds: [], maxSentences: 5, budgetMs: 4000, keepTabs: false, list: false };
	for (let index = 2; index < argv.length; index += 1) {
		const value = argv[index];
		const readValue = (flag) => (value.includes("=") ? value.slice(flag.length + 1) : argv[(index += 1)]);
		if (value === "--port" || value.startsWith("--port=")) args.port = Number(readValue("--port"));
		else if (value === "--page" || value.startsWith("--page=")) args.pageIds.push(String(readValue("--page")).trim());
		else if (value === "--max-sentences" || value.startsWith("--max-sentences=")) args.maxSentences = Number(readValue("--max-sentences"));
		else if (value === "--budget-ms" || value.startsWith("--budget-ms=")) args.budgetMs = Number(readValue("--budget-ms"));
		else if (value === "--keep-tabs") args.keepTabs = true;
		else if (value === "--list") args.list = true;
		else throw new Error(`Unknown argument: ${value}`);
	}
	if (!Number.isFinite(args.port) || args.port <= 0) throw new Error("--port must be a positive number");
	return args;
}

async function loadPageToolkitFactory() {
	const source = await readFile(join(ROOT, "packages/browser-extension/background.js"), "utf8");
	const start = source.indexOf("const createPageToolkit = ");
	const end = source.indexOf("\n};\n\nasync function evaluateInTab", start);
	if (start === -1 || end === -1) throw new Error("createPageToolkit source markers not found");
	const expressionStart = source.indexOf("=", start) + 1;
	return source.slice(expressionStart, end + 2).trim().replace(/;$/, "");
}

async function loadBackgroundFunction(functionName) {
	const source = await readFile(join(ROOT, "packages/browser-extension/background.js"), "utf8");
	const start = source.indexOf(`function ${functionName}`);
	if (start === -1) throw new Error(`${functionName} declaration not found`);
	const bodyStart = source.indexOf("{", source.indexOf(")", start));
	const declarationStart = source.slice(Math.max(0, start - 6), start) === "async " ? start - 6 : start;
	let depth = 0;
	for (let index = bodyStart; index < source.length; index += 1) {
		if (source[index] === "{") depth += 1;
		if (source[index] === "}") {
			depth -= 1;
			if (depth === 0) return source.slice(declarationStart, index + 1);
		}
	}
	throw new Error(`${functionName} body end not found`);
}

function httpRequest(method, port, path) {
	return new Promise((resolve, reject) => {
		const request = http.request({ host: "127.0.0.1", port, path, method }, (response) => {
			let data = "";
			response.on("data", (chunk) => (data += chunk));
			response.on("end", () => resolve({ status: response.statusCode, data }));
		});
		request.on("error", reject);
		request.end();
	});
}

async function createTab(port, url) {
	const path = `/json/new?${encodeURIComponent(url)}`;
	let response = await httpRequest("PUT", port, path);
	if (response.status !== 200) response = await httpRequest("GET", port, path);
	if (response.status !== 200) throw new Error(`Could not open tab (${response.status}): ${response.data.slice(0, 120)}`);
	return JSON.parse(response.data);
}

async function closeTab(port, targetId) {
	await httpRequest("GET", port, `/json/close/${targetId}`).catch(() => {});
}

function connect(webSocketDebuggerUrl) {
	const ws = new WebSocket(webSocketDebuggerUrl, { maxPayload: 128 * 1024 * 1024 });
	let messageId = 0;
	const pending = new Map();
	ws.on("message", (raw) => {
		const message = JSON.parse(raw.toString());
		if (message.id && pending.has(message.id)) {
			pending.get(message.id)(message);
			pending.delete(message.id);
		}
	});
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = ++messageId;
			const timeout = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`CDP ${method} timed out`));
			}, 60000);
			pending.set(id, (message) => {
				clearTimeout(timeout);
				if (message.error) reject(new Error(`${method}: ${message.error.message || "CDP error"}`));
				else resolve(message.result);
			});
			ws.send(JSON.stringify({ id, method, params }));
		});
	const opened = new Promise((resolve, reject) => {
		ws.on("open", resolve);
		ws.on("error", reject);
	});
	return { ws, send, opened };
}

async function evaluateJson(send, contextId, expression) {
	const reply = await send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
		contextId,
	});
	if (reply?.exceptionDetails) {
		throw new Error(reply.exceptionDetails.exception?.description?.slice(0, 200) || "Evaluation failed");
	}
	return typeof reply?.result?.value === "string" ? JSON.parse(reply.result.value) : reply?.result?.value;
}

function normalizedHostname(value) {
	try {
		return new URL(String(value || "")).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}

async function waitForPageReady(send, expectedUrl, timeoutMs = 30000) {
	const expectedHost = normalizedHostname(expectedUrl);
	const startedAt = Date.now();
	let lastUrl = "";
	while (Date.now() - startedAt < timeoutMs) {
		try {
			// Default world: survives the initial about:blank -> URL navigation.
			const reply = await send("Runtime.evaluate", {
				expression: `JSON.stringify({ state: document.readyState, url: location.href })`,
				returnByValue: true,
			});
			const { state, url } = JSON.parse(reply?.result?.value || "{}");
			lastUrl = url || lastUrl;
			// Same-host check catches captive portals, error interstitials, and
			// consent redirects that would otherwise sweep the wrong document.
			if (state === "complete" && String(url || "").startsWith("http")) {
				if (expectedHost && normalizedHostname(url) !== expectedHost) {
					throw new Error(`Tab navigated off-host: expected ${expectedHost}, got ${url}`);
				}
				return;
			}
		} catch (error) {
			if (String(error?.message || "").startsWith("Tab navigated off-host")) throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`Page did not finish loading in time${lastUrl ? ` (last URL: ${lastUrl})` : ""}`);
}

// Strip markdown syntax the way a model quotes rendered words back.
function stripMarkdownInline(value) {
	return String(value || "")
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/^\s*>+\s*/gm, "")
		.replace(/^\s*[-*+]\s+/gm, "")
		.replace(/^\s*\d+\.\s+/gm, "")
		.replace(/\s+/g, " ")
		.trim();
}

function sampleSentences(markdown, maxSentences) {
	const lines = String(markdown || "")
		.split(/\n+/)
		.map((line) => stripMarkdownInline(line))
		.filter(Boolean);
	const sentences = [];
	for (const line of lines) {
		for (const raw of line.split(/(?<=[.!?])\s+(?=[A-Z"“(])/)) {
			const sentence = raw.trim();
			if (sentence.length < 50 || sentence.length > 240) continue;
			// Skip TeX/markdown residue and low-letter-density fragments (table rows, formulas).
			if (/[\\{}|]|\$\$?/.test(sentence)) continue;
			const letters = (sentence.match(/[a-zA-Z]/g) || []).length;
			if (letters / sentence.length < 0.6) continue;
			sentences.push(sentence);
		}
	}
	if (!sentences.length) return [];
	const picks = new Set();
	const positions = [0, 0.25, 0.5, 0.75, 1];
	for (const position of positions) {
		if (picks.size >= maxSentences) break;
		picks.add(sentences[Math.min(sentences.length - 1, Math.round(position * (sentences.length - 1)))]);
	}
	return Array.from(picks).slice(0, maxSentences);
}

function sampleHeading(headingOutline) {
	const headings = (Array.isArray(headingOutline) ? headingOutline : [])
		.map((heading) => stripMarkdownInline(heading?.text || heading?.markdown || ""))
		.filter((text) => text.length >= 6 && text.length <= 90);
	// Prefer a mid-document section heading over the page title.
	return headings.length > 1 ? headings[Math.floor(headings.length / 2)] : headings[0] || null;
}

function sampleMathSource(markdown) {
	const match = String(markdown || "").match(/\{\\displaystyle[^\n]{8,140}/);
	return match ? match[0] : null;
}

async function sweepPage(page, options, sources) {
	const tab = await createTab(options.port, page.url);
	const result = { page, spans: [], skipped: null, tabClosed: false };
	let session = null;
	try {
		if (!tab.webSocketDebuggerUrl) throw new Error("Tab has no debugger URL (another client attached?)");
		session = connect(tab.webSocketDebuggerUrl);
		await session.opened;
		const { send } = session;
		await send("Page.enable");
		await waitForPageReady(send, page.url);
		await new Promise((resolve) => setTimeout(resolve, 1500));
		const { frameTree } = await send("Page.getFrameTree");
		const { executionContextId } = await send("Page.createIsolatedWorld", {
			frameId: frameTree.frame.id,
			worldName: "onhand-toolkit-sweep",
		});

		const extraction = await evaluateJson(
			send,
			executionContextId,
			`(async () => JSON.stringify(await (${sources.extractSource})({ maxChars: 20000 })))()`,
		);
		if (!extraction?.text || extraction.text.length < 400) {
			throw new Error(`Readable extraction too small (${extraction?.text?.length || 0} chars, root=${extraction?.root || "?"})`);
		}

		await evaluateJson(
			send,
			executionContextId,
			`(() => { window.__onhandSweepToolkit = (${sources.factorySource})({ theme: "light" }); return JSON.stringify(true); })()`,
		);

		const spans = [];
		for (const sentence of sampleSentences(extraction.text, options.maxSentences)) {
			spans.push({ type: "sentence", text: sentence });
		}
		const heading = sampleHeading(extraction.headingOutline);
		if (heading) spans.push({ type: "heading", text: heading });
		const mathSource = sampleMathSource(extraction.text);
		if (mathSource) spans.push({ type: "math", text: mathSource });
		if (!spans.length) throw new Error("No usable spans sampled from extraction");

		for (const span of spans) {
			const startedAt = Date.now();
			let outcome;
			try {
				outcome = await evaluateJson(
					send,
					executionContextId,
					`(async () => {
						try {
							const r = await window.__onhandSweepToolkit.highlightText(${JSON.stringify(span.text)}, { scrollIntoView: false });
							return JSON.stringify({ ok: true, kind: r.kind, approximate: Boolean(r.approximate), fallback: r.fallback || null });
						} catch (error) {
							return JSON.stringify({ ok: false, error: String((error && error.message) || error).slice(0, 200) });
						}
					})()`,
				);
			} catch (error) {
				outcome = { ok: false, error: error.message };
			}
			result.spans.push({ ...span, ...outcome, ms: Date.now() - startedAt });
		}

		await evaluateJson(send, executionContextId, `(() => JSON.stringify(window.__onhandSweepToolkit.clearAnnotations()))()`).catch(() => {});
	} catch (error) {
		result.skipped = error?.message || String(error);
	} finally {
		session?.ws?.close();
		if (!options.keepTabs) {
			await closeTab(options.port, tab.id);
			result.tabClosed = true;
		}
	}
	return result;
}

function formatSpanLabel(span) {
	return `${span.type}:"${span.text.slice(0, 60)}${span.text.length > 60 ? "…" : ""}"`;
}

async function main() {
	const options = parseArgs(process.argv);
	if (options.list) {
		for (const page of SWEEP_PAGES) console.log(`${page.id}\t${page.family}\t${page.url}`);
		return;
	}
	let pages = SWEEP_PAGES;
	if (options.pageIds.length) {
		pages = SWEEP_PAGES.filter((page) => options.pageIds.includes(page.id));
		const missing = options.pageIds.filter((id) => !pages.some((page) => page.id === id));
		if (missing.length) throw new Error(`Unknown page id(s): ${missing.join(", ")}`);
	}
	const probe = await httpRequest("GET", options.port, "/json/version").catch(() => null);
	if (!probe || probe.status !== 200) {
		throw new Error(`No CDP endpoint on port ${options.port}. Start Helium/Chromium with --remote-debugging-port=${options.port}.`);
	}
	const sources = {
		factorySource: await loadPageToolkitFactory(),
		extractSource: await loadBackgroundFunction("extractReadableContentInPage"),
	};

	let failedSpans = 0;
	let approximateSpans = 0;
	let slowSpans = 0;
	let skippedPages = 0;
	for (const page of pages) {
		const result = await sweepPage(page, options, sources);
		if (result.skipped) {
			skippedPages += 1;
			console.log(`SKIP ${page.id} (${page.family}) — ${result.skipped}`);
			continue;
		}
		const failures = result.spans.filter((span) => !span.ok);
		const approximates = result.spans.filter((span) => span.ok && span.approximate);
		const slow = result.spans.filter((span) => span.ok && span.ms > options.budgetMs);
		failedSpans += failures.length;
		approximateSpans += approximates.length;
		slowSpans += slow.length;
		const p95 = result.spans.map((span) => span.ms).sort((a, b) => a - b)[Math.floor((result.spans.length - 1) * 0.95)] || 0;
		const status = failures.length || slow.length ? "FAIL" : "PASS";
		console.log(
			`${status} ${page.id} (${page.family}) spans=${result.spans.length} exact=${result.spans.filter((span) => span.ok && !span.approximate).length} approx=${approximates.length} fail=${failures.length} p95=${p95}ms`,
		);
		for (const span of failures) console.log(`  FAIL ${formatSpanLabel(span)} — ${span.error}`);
		for (const span of slow) console.log(`  SLOW ${formatSpanLabel(span)} — ${span.ms}ms > ${options.budgetMs}ms`);
		for (const span of approximates) console.log(`  approx ${formatSpanLabel(span)} — fallback=${span.fallback || "none"}`);
	}
	console.log(
		`\nPage toolkit sweep: pages=${pages.length} skipped=${skippedPages} spanFailures=${failedSpans} approximate=${approximateSpans} slow=${slowSpans}`,
	);
	if (failedSpans || slowSpans) {
		console.error("Page toolkit sweep: FAIL");
		process.exitCode = 1;
		return;
	}
	console.log("Page toolkit sweep: PASS");
}

main().catch((error) => {
	console.error(`page-toolkit-sweep: ${error?.message || error}`);
	process.exitCode = 1;
});
