// Intent-classifier evaluation: compares the regex intent predicates and the
// experimental model intent classifier against a labeled prompt corpus built
// from real failures (2026-07 testing sessions + PR #52 review findings).
//
// Modes:
//   (default)  score the REGEX baseline only — no network.
//   --browser  also drive the REAL classifier through a running browser's
//              Onhand extension (its configured auth/model) via CDP:
//              ONHAND_CDP_PORT or --port <n> (default 9346).
//   --free     with --browser: classify with the Onhand free-tier model
//              instead of the configured one (needs a registered free-tier
//              device in that browser).
//   --live     also score an OpenAI-compatible endpoint directly:
//              OPENAI_API_KEY (required), OPENAI_BASE_URL, OPENAI_MODEL.
//
// Expected labels use null for genuinely ambiguous fields (not scored).
import assert from "node:assert/strict";

const EXT_ID = "hpjpjeehgbloadhdidmecpijppodibim";

function installChromeStub() {
	globalThis.chrome = {
		runtime: {
			getURL: (path = "") => `chrome-extension://onhand-eval/${path}`,
			getManifest: () => ({ version: "eval" }),
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

const CORPUS = [
	// --- verified live wins and failures from the 2026-07 sessions ---
	["Give me a roadmap of the twelve factors.", { pageScoped: true, enumerableCoverage: true, teaching: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	// comparison must stay false here: summarizing others' disagreement is
	// teaching — comparison=true would disqualify the compact-teaching lane
	// (observed live: 3 highlights + 1 note dropped to a single anchor).
	["Summarize the main points of disagreement in these comments.", { pageScoped: true, teaching: true, enumerableCoverage: null, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["Summarize the main claims of this dashboard.", { pageScoped: true, teaching: true, enumerableCoverage: null, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["When should I use a Map instead of a plain object, according to this page?", { pageScoped: true, comparison: true, teaching: false, enumerableCoverage: false, crossTabComparison: false, documentReviewMarkup: false }],
	["Using both this page and the HTTP/2 page I have open in another tab, what did HTTP/3 change about head-of-line blocking?", { pageScoped: true, comparison: true, crossTabComparison: true, teaching: false, enumerableCoverage: false, documentReviewMarkup: false }],
	["Do these papers agree?", { comparison: true, crossTabComparison: true, pageScoped: true, teaching: false, enumerableCoverage: false, documentReviewMarkup: false }],
	["teach me what this page says", { pageScoped: true, teaching: true, enumerableCoverage: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["Where does it say I can charge money for copies?", { pageScoped: true, teaching: false, enumerableCoverage: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["How has the API changed between these two open docs?", { comparison: true, crossTabComparison: true, pageScoped: true, teaching: false, enumerableCoverage: false, documentReviewMarkup: false }],
	["Go through my manager's feedback on this draft and mark what needs to change.", { documentReviewMarkup: true, pageScoped: true, teaching: null, enumerableCoverage: null, comparison: false, crossTabComparison: false }],
	["what is the time complexity here?", { pageScoped: true, teaching: false, enumerableCoverage: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["could you help me solve this?", { pageScoped: true, problemSolvingHelp: true }],
	["Help me troubleshoot why this page will not load.", { pageScoped: true, problemSolvingHelp: false }],
	["compare this article with the other tab I have open", { pageScoped: true, comparison: true, crossTabComparison: true, teaching: false, enumerableCoverage: false, documentReviewMarkup: false }],
	["give me a step-by-step of the branching workflow in this chapter", { pageScoped: true, enumerableCoverage: true, teaching: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["Summarize this page. Answer only in chat, no page changes please.", { pageScoped: true, teaching: true, enumerableCoverage: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	// --- Codex review counterexamples: must stay negative ---
	["give me a career roadmap for becoming a data scientist", { pageScoped: false, enumerableCoverage: false, teaching: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["How do I change both tabs to dark mode?", { pageScoped: false, comparison: false, crossTabComparison: false, teaching: false, enumerableCoverage: false, documentReviewMarkup: false }],
	["change both tabs to dark mode", { pageScoped: false, comparison: false, crossTabComparison: false, teaching: false, enumerableCoverage: false, documentReviewMarkup: false }],
	["outline an essay about climate change for me", { pageScoped: false, enumerableCoverage: false, teaching: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["walk me through rejection sampling", { pageScoped: null, teaching: null, enumerableCoverage: null, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	// --- recall probes the regexes are known or likely to miss ---
	["Qu'est-ce que cette page dit sur les transformateurs ?", { pageScoped: true, teaching: true, enumerableCoverage: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["このページの要点をまとめて", { pageScoped: true, teaching: true, enumerableCoverage: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["summarize teh main pionts of this artcle", { pageScoped: true, teaching: true, enumerableCoverage: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["can you give me the TL;DR of this doc", { pageScoped: true, teaching: true, enumerableCoverage: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["what are the steps described here?", { pageScoped: true, enumerableCoverage: true, teaching: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["give me an outline of this essay", { pageScoped: true, enumerableCoverage: true, teaching: null, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["walk me through the proof in section 3", { pageScoped: true, enumerableCoverage: true, teaching: null, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["how do the two approaches in this article differ?", { pageScoped: true, comparison: true, crossTabComparison: false, teaching: false, enumerableCoverage: false, documentReviewMarkup: false }],
	["what's the difference between the versions listed on this page?", { pageScoped: true, comparison: true, crossTabComparison: false, teaching: false, enumerableCoverage: false, documentReviewMarkup: false }],
	["is this page's claim about caching supported by the paper in my other tab?", { pageScoped: true, crossTabComparison: true, comparison: null, teaching: false, enumerableCoverage: false, documentReviewMarkup: false }],
	["review my draft below and mark anything that reads as overclaiming.\n\nDraft:\nOur system achieves perfect accuracy in all settings...", { documentReviewMarkup: true, pageScoped: true, teaching: null, enumerableCoverage: null, comparison: false, crossTabComparison: false }],
	// --- negatives that look positive on keywords ---
	["compare React and Vue", { pageScoped: false, comparison: true, crossTabComparison: false, teaching: false, enumerableCoverage: false, documentReviewMarkup: false }],
	["what does 'roadmap' mean in product management?", { pageScoped: false, enumerableCoverage: false, teaching: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["my manager wants a comparison table by friday, can you explain what this page says about pivot tables?", { pageScoped: true, teaching: true, comparison: false, crossTabComparison: false, enumerableCoverage: false, documentReviewMarkup: false }],
	["make this page dark mode", { pageScoped: false, teaching: false, enumerableCoverage: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
];

const FIELDS = ["pageScoped", "teaching", "enumerableCoverage", "comparison", "crossTabComparison", "documentReviewMarkup", "problemSolvingHelp"];

function regexVerdicts(test, prompt) {
	// The predicates consult the model-intent cache first; keep it empty here
	// so these are pure regex verdicts.
	test.clearModelIntentClassificationsForTest();
	return {
		pageScoped: null, // no single regex equivalent; folded into the others
		teaching: test.promptAsksForTeachingPageSourceMarkerForTest(prompt),
		enumerableCoverage: test.promptAsksForStructuredPageSourceMarkerForTest(prompt),
		comparison: null,
		crossTabComparison: test.promptAsksForCrossTabComparisonForTest(prompt),
		documentReviewMarkup: test.promptAsksForDocumentReviewMarkupForTest(prompt),
		problemSolvingHelp: null,
	};
}

function score(name, verdictsByPrompt) {
	let scored = 0;
	let correct = 0;
	const misses = [];
	for (const [prompt, expected] of CORPUS) {
		const verdicts = verdictsByPrompt.get(prompt);
		if (!verdicts) continue;
		for (const field of FIELDS) {
			if (expected[field] === null || expected[field] === undefined) continue;
			if (verdicts[field] === null || verdicts[field] === undefined) continue;
			scored += 1;
			if (Boolean(verdicts[field]) === expected[field]) correct += 1;
			else misses.push(`  ${field}=${verdicts[field]} (want ${expected[field]}): ${prompt.slice(0, 70).replace(/\n/g, " ")}`);
		}
	}
	console.log(`\n${name}: ${correct}/${scored} labeled fields correct (${((correct / Math.max(scored, 1)) * 100).toFixed(1)}%)`);
	if (misses.length) {
		console.log("misses:");
		for (const miss of misses) console.log(miss);
	}
	return { scored, correct };
}

async function classifyLive(test, prompt) {
	const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
	const model = process.env.OPENAI_MODEL || "gpt-5.1-mini";
	const context = test.buildModelIntentClassifierContextForTest(prompt);
	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
		body: JSON.stringify({
			model,
			messages: [
				{ role: "system", content: context.systemPrompt },
				{ role: "user", content: context.messages[0].content },
			],
		}),
	});
	if (!response.ok) throw new Error(`classifier request failed: ${response.status} ${await response.text()}`);
	const body = await response.json();
	return test.parseModelIntentClassificationForTest(body?.choices?.[0]?.message?.content || "");
}

async function classifyThroughBrowser(port, providerOverride = "") {
	const { default: WebSocket } = await import("ws");
	const http = await import("node:http");
	const getJson = (path) =>
		new Promise((resolve, reject) =>
			http
				.get({ host: "127.0.0.1", port, path }, (res) => {
					let data = "";
					res.on("data", (chunk) => (data += chunk));
					res.on("end", () => resolve(JSON.parse(data)));
				})
				.on("error", reject),
		);
	const version = await getJson("/json/version");
	const ws = new WebSocket(version.webSocketDebuggerUrl);
	await new Promise((resolve) => ws.on("open", resolve));
	let messageId = 0;
	const pending = new Map();
	ws.on("message", (raw) => {
		const parsed = JSON.parse(raw);
		if (parsed.id && pending.has(parsed.id)) {
			pending.get(parsed.id)(parsed);
			pending.delete(parsed.id);
		}
	});
	const send = (method, params, sessionId) =>
		new Promise((resolve, reject) => {
			const id = ++messageId;
			pending.set(id, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
			ws.send(JSON.stringify({ id, method, params, sessionId }));
		});
	const { targetId } = await send("Target.createTarget", { url: `chrome-extension://${EXT_ID}/pdf-viewer.html?driver=1`, background: true });
	const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
	const evalDriver = async (expression) => {
		const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
		if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
		return result.result?.value;
	};
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (await evalDriver('typeof chrome?.runtime?.sendMessage === "function"').catch(() => false)) break;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	const results = new Map();
	const latencies = [];
	let modelLabel = "";
	for (const [prompt] of CORPUS) {
		const response = await evalDriver(
			`chrome.runtime.sendMessage({ type: 'browser-runtime:classify-intent-eval', prompt: ${JSON.stringify(prompt)}, provider: ${JSON.stringify(providerOverride || undefined)} }).catch(e => ({ ok: false, error: String(e && e.message || e) }))`,
		);
		const payload = response?.result || {};
		modelLabel = payload.model || modelLabel;
		if (payload.classification) {
			results.set(prompt, payload.classification);
			latencies.push(Number(payload.elapsedMs) || 0);
		} else {
			console.log(`  browser classification failed: ${payload.error || response?.error || "no classification"} — ${prompt.slice(0, 50).replace(/\n/g, " ")}`);
		}
	}
	await send("Target.closeTarget", { targetId });
	ws.close();
	latencies.sort((a, b) => a - b);
	const median = latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0;
	const p90 = latencies.length ? latencies[Math.floor(latencies.length * 0.9)] : 0;
	console.log(`\nbrowser classifier model: ${modelLabel} | classified ${results.size}/${CORPUS.length} | latency median ${median}ms, p90 ${p90}ms`);
	return results;
}

installChromeStub();
const { __browserRuntimeTest: test } = await import("../packages/browser-extension/onhand-runtime.bundle.js");

const regexResults = new Map(CORPUS.map(([prompt]) => [prompt, regexVerdicts(test, prompt)]));
score("Regex baseline", regexResults);

if (process.argv.includes("--browser")) {
	const portFlagIndex = process.argv.indexOf("--port");
	const port = Number(portFlagIndex > -1 ? process.argv[portFlagIndex + 1] : process.env.ONHAND_CDP_PORT || 9346);
	const providerOverride = process.argv.includes("--free") ? "onhand-free" : "";
	const browserResults = await classifyThroughBrowser(port, providerOverride);
	score(providerOverride ? "Model classifier (free tier)" : "Model classifier (via browser auth)", browserResults);
}

if (process.argv.includes("--live")) {
	assert.ok(process.env.OPENAI_API_KEY, "--live requires OPENAI_API_KEY");
	const liveResults = new Map();
	for (const [prompt] of CORPUS) {
		try {
			liveResults.set(prompt, await classifyLive(test, prompt));
		} catch (error) {
			console.log(`live classification failed for "${prompt.slice(0, 50)}": ${error.message}`);
		}
	}
	score(`Model classifier (${process.env.OPENAI_MODEL || "gpt-5.1-mini"})`, liveResults);
}

if (!process.argv.includes("--browser") && !process.argv.includes("--live")) {
	console.log("\n(dry run — --browser drives the real extension classifier; --live needs OPENAI_API_KEY)");
}
