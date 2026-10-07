// Intent-classifier evaluation: compares the regex intent predicates, the
// model intent classifier, and the Decisions API classifier against the
// labeled corpus in evals/intent-classifier/cases.json (real failures from
// 2026-07 sessions and PR #52 review, eval-suite prompts with their pages, and
// edge cases).
//
// Modes:
//   (default)  score the REGEX baseline only — no network.
//   --browser  also drive the REAL classifier through a running browser's
//              Onhand extension (its configured auth/model) via CDP:
//              ONHAND_CDP_PORT or --port <n> (default 9346).
//   --free     with --browser: classify with the Onhand free-tier model
//              instead of the configured one (needs a registered free-tier
//              device in that browser).
//   --decisions  also classify with the Decisions API through the browser's
//              saved OpenAI platform key (the key stays in the extension), and
//              report per-field calibration against the runtime's cutoffs.
//              With --browser too, it scores the production policy: Decisions
//              when every field is confident, otherwise the model classifier.
//   --live     also score an OpenAI-compatible endpoint directly:
//              OPENAI_API_KEY (required), OPENAI_BASE_URL, OPENAI_MODEL.
//
// Expected labels use null for genuinely ambiguous fields (not scored).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

const CORPUS_FILE = new URL("../evals/intent-classifier/cases.json", import.meta.url);
const CORPUS = JSON.parse(readFileSync(CORPUS_FILE, "utf8")).cases.map((entry) => [entry.prompt, entry.expect, entry.page || null]);

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

function score(name, verdictsByCase) {
	let scored = 0;
	let correct = 0;
	const misses = [];
	for (const [index, [prompt, expected]] of CORPUS.entries()) {
		const verdicts = verdictsByCase.get(index);
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

async function classifyThroughBrowser(port, { provider = "", engine = "" } = {}) {
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
	const payloads = new Map();
	const latencies = [];
	let modelLabel = "";
	for (const [index, [prompt, , page]] of CORPUS.entries()) {
		const message = { type: "browser-runtime:classify-intent-eval", prompt, provider: provider || undefined, engine: engine || undefined, page: page || undefined };
		const response = await evalDriver(
			`chrome.runtime.sendMessage(${JSON.stringify(message)}).catch(e => ({ ok: false, error: String(e && e.message || e) }))`,
		);
		const payload = response?.result || {};
		modelLabel = payload.model || modelLabel;
		payloads.set(index, payload);
		if (payload.classification || payload.probabilities) latencies.push(Number(payload.elapsedMs) || 0);
		if (payload.classification) {
			results.set(index, payload.classification);
		} else if (!payload.probabilities) {
			console.log(`  browser classification failed: ${payload.error || response?.error || "no classification"} — ${prompt.slice(0, 50).replace(/\n/g, " ")}`);
		}
	}
	await send("Target.closeTarget", { targetId });
	ws.close();
	latencies.sort((a, b) => a - b);
	const median = latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0;
	const p90 = latencies.length ? latencies[Math.floor(latencies.length * 0.9)] : 0;
	console.log(`\nbrowser classifier model: ${modelLabel} | classified ${results.size}/${CORPUS.length} | latency median ${median}ms, p90 ${p90}ms`);
	return { results, payloads };
}

installChromeStub();
const { __browserRuntimeTest: test } = await import("../packages/browser-extension/onhand-runtime.bundle.js");

const regexResults = new Map(CORPUS.map(([prompt], index) => [index, regexVerdicts(test, prompt)]));
score("Regex baseline", regexResults);

const portFlagIndex = process.argv.indexOf("--port");
const port = Number(portFlagIndex > -1 ? process.argv[portFlagIndex + 1] : process.env.ONHAND_CDP_PORT || 9346);
let modelResults = null;
if (process.argv.includes("--browser")) {
	const providerOverride = process.argv.includes("--free") ? "onhand-free" : "";
	({ results: modelResults } = await classifyThroughBrowser(port, { provider: providerOverride }));
	score(providerOverride ? "Model classifier (free tier)" : "Model classifier (via browser auth)", modelResults);
}

if (process.argv.includes("--decisions")) {
	const { payloads } = await classifyThroughBrowser(port, { engine: "decisions" });
	const cutoffs = test.decisionsIntentCutoffsForTest;
	// Raw accuracy at a single 0.5 threshold, to show the model's own calibration.
	const atHalf = new Map([...payloads].filter(([, p]) => p.probabilities).map(([index, p]) =>
		[index, Object.fromEntries(FIELDS.map((field) => [field, p.probabilities[field] === undefined ? null : p.probabilities[field] >= 0.5]))]));
	score("Decisions at a 0.5 threshold", atHalf);
	console.log("\nDecisions per-field calibration (labeled fields only):");
	for (const field of FIELDS) {
		const rows = [];
		for (const [index, [, expected]] of CORPUS.entries()) {
			const probability = payloads.get(index)?.probabilities?.[field];
			if (expected[field] === null || expected[field] === undefined || probability === undefined) continue;
			rows.push({ probability, want: expected[field], index });
		}
		const { trueAt, falseBelow } = cutoffs[field];
		const sure = rows.filter((row) => row.probability >= trueAt || row.probability < falseBelow);
		const wrong = sure.filter((row) => (row.probability >= trueAt) !== row.want);
		const best = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((t) => [t, rows.filter((row) => (row.probability >= t) === row.want).length]).sort((a, b) => b[1] - a[1])[0];
		console.log(`  ${field.padEnd(21)} cutoffs >=${trueAt}/<${falseBelow}: confident ${sure.length}/${rows.length}, wrong when confident ${wrong.length}; best single threshold ${best[0]} -> ${best[1]}/${rows.length}`);
		for (const row of wrong) console.log(`    WRONG p=${row.probability.toFixed(2)} want ${row.want}: ${CORPUS[row.index][0].slice(0, 80).replace(/\n/g, " ")}`);
	}
	const decided = new Map([...payloads].filter(([, p]) => p.classification).map(([index, p]) => [index, p.classification]));
	console.log(`\nDecisions confident on every field: ${decided.size}/${CORPUS.length} requests (the rest go to the model classifier)`);
	score("Decisions, confident requests only", decided);
	if (modelResults) {
		const policy = new Map(CORPUS.map((_, index) => [index, decided.get(index) || modelResults.get(index)]).filter(([, value]) => value));
		score("Production policy (Decisions when confident, else model)", policy);
	}
}

if (process.argv.includes("--live")) {
	assert.ok(process.env.OPENAI_API_KEY, "--live requires OPENAI_API_KEY");
	const liveResults = new Map();
	for (const [index, [prompt]] of CORPUS.entries()) {
		try {
			liveResults.set(index, await classifyLive(test, prompt));
		} catch (error) {
			console.log(`live classification failed for "${prompt.slice(0, 50)}": ${error.message}`);
		}
	}
	score(`Model classifier (${process.env.OPENAI_MODEL || "gpt-5.1-mini"})`, liveResults);
}

if (!process.argv.includes("--browser") && !process.argv.includes("--live") && !process.argv.includes("--decisions")) {
	console.log("\n(dry run — --browser drives the real extension classifier; --live needs OPENAI_API_KEY)");
}
