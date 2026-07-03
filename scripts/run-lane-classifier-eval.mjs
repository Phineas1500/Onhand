// Lane-classifier evaluation: compares the regex lane predicates and the
// experimental model intent classifier against a labeled prompt corpus built
// from real failures (2026-07 testing sessions + PR #52 review findings).
//
// Default (dry) mode scores the REGEX baseline only — no network.
// --live also runs the model classifier prompt against an OpenAI-compatible
// endpoint and scores it side by side:
//   OPENAI_API_KEY   required for --live
//   OPENAI_BASE_URL  default https://api.openai.com/v1
//   OPENAI_MODEL     default gpt-5.1-mini
//
// Expected labels use null for genuinely ambiguous fields (not scored).
import assert from "node:assert/strict";

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
	// [prompt, {pageScoped, teaching, enumerableCoverage, comparison, crossTabComparison, documentReviewMarkup}]
	["Give me a roadmap of the twelve factors.", { pageScoped: true, enumerableCoverage: true, teaching: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["give me a career roadmap for becoming a data scientist", { pageScoped: false, enumerableCoverage: false, teaching: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["Summarize the main points of disagreement in these comments.", { pageScoped: true, teaching: true, enumerableCoverage: null, comparison: null, crossTabComparison: false, documentReviewMarkup: false }],
	["Summarize the main claims of this dashboard.", { pageScoped: true, teaching: true, enumerableCoverage: null, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["When should I use a Map instead of a plain object, according to this page?", { pageScoped: true, comparison: true, teaching: false, enumerableCoverage: false, crossTabComparison: false, documentReviewMarkup: false }],
	["Using both this page and the HTTP/2 page I have open in another tab, what did HTTP/3 change about head-of-line blocking?", { pageScoped: true, comparison: true, crossTabComparison: true, teaching: false, enumerableCoverage: false, documentReviewMarkup: false }],
	["How do I change both tabs to dark mode?", { pageScoped: false, comparison: false, crossTabComparison: false, teaching: false, enumerableCoverage: false, documentReviewMarkup: false }],
	["Do these papers agree?", { comparison: true, crossTabComparison: true, pageScoped: true, teaching: false, enumerableCoverage: false, documentReviewMarkup: false }],
	["teach me what this page says", { pageScoped: true, teaching: true, enumerableCoverage: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["Where does it say I can charge money for copies?", { pageScoped: true, teaching: false, enumerableCoverage: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["change both tabs to dark mode", { pageScoped: false, comparison: false, crossTabComparison: false, teaching: false, enumerableCoverage: false, documentReviewMarkup: false }],
	["How has the API changed between these two open docs?", { comparison: true, crossTabComparison: true, pageScoped: true, teaching: false, enumerableCoverage: false, documentReviewMarkup: false }],
	["Go through my manager's feedback on this draft and mark what needs to change.", { documentReviewMarkup: true, pageScoped: true, teaching: null, enumerableCoverage: null, comparison: false, crossTabComparison: false }],
	["outline an essay about climate change for me", { pageScoped: false, enumerableCoverage: false, teaching: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["what is the time complexity here?", { pageScoped: true, teaching: false, enumerableCoverage: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["compare this article with the other tab I have open", { pageScoped: true, comparison: true, crossTabComparison: true, teaching: false, enumerableCoverage: false, documentReviewMarkup: false }],
	["give me a step-by-step of the branching workflow in this chapter", { pageScoped: true, enumerableCoverage: true, teaching: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["Qu'est-ce que cette page dit sur les transformateurs ?", { pageScoped: true, teaching: true, enumerableCoverage: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["walk me through rejection sampling", { pageScoped: null, teaching: null, enumerableCoverage: null, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
	["Summarize this page. Answer only in chat, no page changes please.", { pageScoped: true, teaching: true, enumerableCoverage: false, comparison: false, crossTabComparison: false, documentReviewMarkup: false }],
];

const FIELDS = ["pageScoped", "teaching", "enumerableCoverage", "comparison", "crossTabComparison", "documentReviewMarkup"];

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
			else misses.push(`  ${field}=${verdicts[field]} (want ${expected[field]}): ${prompt.slice(0, 70)}`);
		}
	}
	console.log(`\n${name}: ${correct}/${scored} labeled fields correct`);
	if (misses.length) {
		console.log("misses:");
		for (const miss of misses) console.log(miss);
	}
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
	const text = body?.choices?.[0]?.message?.content || "";
	return test.parseModelIntentClassificationForTest(text);
}

installChromeStub();
const { __browserRuntimeTest: test } = await import("../packages/browser-extension/onhand-runtime.bundle.js");

const regexResults = new Map(CORPUS.map(([prompt]) => [prompt, regexVerdicts(test, prompt)]));
score("Regex baseline", regexResults);

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
} else {
	console.log("\n(dry run — pass --live with OPENAI_API_KEY to score the model classifier)");
}
