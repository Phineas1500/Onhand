// Offline routing/guard probe for the Onhand browser runtime.
//
// Given a prompt (and an optional candidate highlight text), print the routing
// classification and highlight-guard decisions the runtime would make — with no
// live turn and no LLM call. This is the deterministic companion to the live
// debug turn-trace (debug:fetch-turn-trace): the trace shows what happened in a
// real turn; this shows what the routing/guard logic decides for any input, in
// milliseconds. It reads the runtime's `__browserRuntimeTest` export surface, so
// it never re-implements or brittle-extracts runtime internals.
//
// Usage:
//   node scripts/probe-routing.mjs "<prompt>" [--text "<candidate highlight>"] [--classify '<intent-json>']
//   node scripts/probe-routing.mjs --selftest
//
// --classify injects a model-intent classification (e.g. '{"pageScoped":true,
//   "enumerableCoverage":true}') to probe the classifier-on path; without it the
//   deterministic regex-router fallback is shown.
//
// Examples:
//   node scripts/probe-routing.mjs "walk me through the twelve factors as a roadmap" \
//     --text "One codebase tracked in revision control, many deploys"
//   node scripts/probe-routing.mjs "walk me through the proof on this page" --text "Codebase"

function installChromeStub() {
	globalThis.chrome = {
		runtime: {
			getURL: (path = "") => `chrome-extension://onhand-probe/${path}`,
			getManifest: () => ({ version: "probe" }),
		},
		storage: { local: { data: {}, async get(d) { return { ...d, ...this.data }; }, async set(v) { Object.assign(this.data, v); } } },
	};
}
installChromeStub();

const { __browserRuntimeTest: T } = await import("../packages/browser-extension/onhand-runtime.bundle.js");

const INTENT_FIELDS = ["pageScoped", "teaching", "enumerableCoverage", "comparison", "crossTabComparison", "documentReviewMarkup", "problemSolvingHelp"];

// Routing predicates that classify a prompt's intent (marker expectations, deliverable profiles).
function routingFor(prompt) {
	return {
		structured: T.promptAsksForStructuredPageSourceMarkerForTest(prompt),
		derivationOrProof: T.promptAsksForDerivationOrProofSourceMarkerForTest(prompt),
		singlePageComparison: T.promptAsksForSinglePageComparisonForTest(prompt),
		crossTabComparison: T.promptAsksForCrossTabComparisonForTest(prompt),
		documentReviewMarkup: T.promptAsksForDocumentReviewMarkupForTest(prompt),
		teaching: T.promptAsksForTeachingPageSourceMarkerForTest(prompt),
		requiresPageSource: T.promptRequiresPageSourceMarkerForTest(prompt),
		allowsPageSource: T.promptAllowsPageSourceHighlightsForTest(prompt),
	};
}

// Highlight guards that can block a candidate span, given the prompt.
function guardsFor(prompt, text, request = {}) {
	const params = { text };
	const TN = "browser_highlight_text";
	const CN = "highlight_text";
	// The span-quality guards, in the order browser-runtime.ts evaluates them —
	// the guards that judge whether THIS span is acceptable for the prompt (plus,
	// for review markup, the pre-extraction first-pass state the empty request
	// represents). The chain's remaining guards — surplus/budget (surplus*,
	// note/highlight budgets) and turn-flow (repeated-failure, repeated-viewport,
	// textbook-context, duplicate-tab) — decide on accumulated request/turn state
	// that a single-span probe does not model, so they are intentionally omitted
	// rather than reported as a misleading "allowed".
	const guards = [
		["empty", () => T.buildEmptyHighlightTextGuardResultForTest(TN, CN, params)],
		["reviewExtractionFirst", () => T.buildReviewExtractionFirstGuardResultForTest(TN, CN, prompt, request)],
		["weakStructured", () => T.buildWeakStructuredHighlightTextGuardResultForTest(TN, CN, params, prompt)],
		["weakCompactTeaching", () => T.buildWeakCompactTeachingHighlightGuardResultForTest(TN, CN, params, prompt, request)],
		["namedFormula", () => T.buildNamedFormulaHighlightGuardResultForTest(TN, CN, params, prompt, request)],
		["conceptLocation", () => T.buildConceptLocationHighlightGuardResultForTest(TN, CN, params, prompt, request)],
	];
	return {
		looksLikeHeadingOnly: T.looksLikeHeadingOnlyHighlightTextForTest(text),
		sectionNumberOnly: T.isSectionNumberOnlyHighlightTextForTest(text),
		blocks: guards.map(([name, run]) => {
			let result = null;
			try {
				result = run();
			} catch {}
			return { name, blocked: Boolean(result), message: result?.guardrail?.message || "" };
		}),
	};
}

function applyClassification(prompt, classifyJson) {
	T.clearModelIntentClassificationsForTest();
	if (!classifyJson) return null;
	const partial = JSON.parse(classifyJson);
	const full = Object.fromEntries(INTENT_FIELDS.map((f) => [f, partial[f] === true]));
	T.setModelIntentClassificationForPromptForTest(prompt, full);
	return full;
}

function printReport(prompt, text, classification, request) {
	const routing = routingFor(prompt);
	console.log(`\nPROMPT: ${JSON.stringify(prompt)}`);
	console.log(`ROUTING (${classification ? "injected classifier" : "regex fallback, classifier=null"}):`);
	for (const [k, v] of Object.entries(routing)) console.log(`  ${(k + ":").padEnd(22)} ${v}`);
	if (classification) console.log(`  classifier:            ${JSON.stringify(classification)}`);
	if (text != null) {
		const g = guardsFor(prompt, text, request);
		console.log(`GUARDS for highlight text ${JSON.stringify(text)}:`);
		console.log(`  ${"looksLikeHeadingOnly:".padEnd(22)} ${g.looksLikeHeadingOnly}`);
		console.log(`  ${"sectionNumberOnly:".padEnd(22)} ${g.sectionNumberOnly}`);
		for (const b of g.blocks) console.log(`  ${(b.name + ":").padEnd(22)} ${b.blocked ? `BLOCKED — ${b.message}` : "allowed"}`);
	}
}

// A fixture table that locks in known routing/guard behavior — including the
// #55 regression: a roadmap must NOT classify as a derivation, or the weak-
// highlight guard blocks every heading-shaped item tagline.
const SELFTEST = [
	{ prompt: "walk me through the twelve factors as a roadmap", expect: { derivationOrProof: false } },
	{ prompt: "give me a roadmap of the twelve factors", expect: { derivationOrProof: false } },
	{ prompt: "walk me through the proof on this page", expect: { derivationOrProof: true } },
	{ prompt: "derive the formula shown on this page step by step", expect: { derivationOrProof: true } },
	{ prompt: "walk me through this proof as a roadmap", expect: { derivationOrProof: true } },
	// An explanation that merely mentions an overview keeps the guard (a bare
	// heading must not satisfy an "explain how X works" answer).
	{ prompt: "explain how the algorithm on this page works as an overview", expect: { derivationOrProof: true } },
	// A roadmap's heading-shaped tagline must be allowed by the weak-highlight
	// guard (because the roadmap is not a derivation).
	{
		prompt: "walk me through the twelve factors as a roadmap",
		text: "One codebase tracked in revision control, many deploys",
		expectGuard: { weakStructured: false },
	},
	// The same heading text under a genuine derivation IS blocked.
	{
		prompt: "walk me through the proof on this page",
		text: "One codebase tracked in revision control, many deploys",
		expectGuard: { weakStructured: true },
	},
	// A title/heading-like span in the compact-teaching profile is blocked by the
	// compact-teaching guard, which runs after the structured guard.
	{
		prompt: "summarize this page",
		text: "API: Reference",
		expectGuard: { weakCompactTeaching: true },
	},
	// A span that is not the requested named formula is blocked by the named-
	// formula guard, which runs after compact-teaching.
	{
		prompt: "highlight the quadratic formula on this page",
		text: "a = b + c",
		expectGuard: { namedFormula: true },
	},
	// Review-markup highlighting before any extraction is blocked first-pass by
	// the review-extraction guard (the empty request models "no extraction yet").
	{
		prompt: "mark up this document",
		text: "Executive summary",
		expectGuard: { reviewExtractionFirst: true },
	},
	// "<verb> here" ("described/covered/shown here") is a reliable document
	// reference, so such a comparison/teaching ask routes to grounding on the
	// regex-router (classifier-off) path.
	{ prompt: "what's the difference between the two approaches described here", expect: { allowsPageSource: true } },
	{ prompt: "summarize what's described here", expect: { teaching: true, allowsPageSource: true } },
	// Bare trailing "here" with no content verb is deliberately NOT a page
	// reference — it is ambiguous with a spatial locative — so these stay
	// unrouted rather than force-grounding a physical/navigation ask on the page.
	{ prompt: "compare bagging and boosting here", expect: { singlePageComparison: false, allowsPageSource: false } },
	{ prompt: "list restaurants near here", expect: { structured: false, allowsPageSource: false } },
	{ prompt: "how do I get to the airport from here", expect: { allowsPageSource: false } },
	// A bare "compare X and Y" with no page reference also stays unrouted so
	// general-knowledge comparisons are not force-grounded.
	{ prompt: "compare bagging and boosting", expect: { singlePageComparison: false, allowsPageSource: false } },
	{ prompt: "explain gradient descent", expect: { teaching: false, allowsPageSource: false } },
];

function runSelftest() {
	let pass = 0;
	let fail = 0;
	for (const c of SELFTEST) {
		T.clearModelIntentClassificationsForTest();
		const routing = routingFor(c.prompt);
		for (const [k, v] of Object.entries(c.expect || {})) {
			const ok = routing[k] === v;
			ok ? pass++ : fail++;
			console.log(`  ${ok ? "PASS" : "FAIL"}  routing.${k}=${routing[k]} (exp ${v})  "${c.prompt}"`);
		}
		if (c.text != null) {
			const g = guardsFor(c.prompt, c.text, c.request);
			for (const [name, exp] of Object.entries(c.expectGuard || {})) {
				const got = g.blocks.find((b) => b.name === name)?.blocked;
				const ok = got === exp;
				ok ? pass++ : fail++;
				console.log(`  ${ok ? "PASS" : "FAIL"}  guard.${name}=${got} (exp ${exp})  text="${c.text.slice(0, 40)}"`);
			}
		}
	}
	console.log(`\n${pass} passed, ${fail} failed`);
	return fail === 0;
}

const args = process.argv.slice(2);
if (args[0] === "--selftest") {
	process.exit(runSelftest() ? 0 : 1);
}
const prompt = args[0];
if (!prompt) {
	console.error('usage: node scripts/probe-routing.mjs "<prompt>" [--text "<highlight>"] [--classify \'<json>\']  |  --selftest');
	process.exit(2);
}
const textIdx = args.indexOf("--text");
const text = textIdx >= 0 ? args[textIdx + 1] : null;
const classifyIdx = args.indexOf("--classify");
const classifyJson = classifyIdx >= 0 ? args[classifyIdx + 1] : null;
const titleIdx = args.indexOf("--title");
const request = titleIdx >= 0 ? { initialActiveTab: { title: args[titleIdx + 1] } } : {};
const classification = applyClassification(prompt, classifyJson);
printReport(prompt, text, classification, request);
