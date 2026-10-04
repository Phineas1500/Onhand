#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = fileURLToPath(new URL("./dump-onhand-sessions.mjs", import.meta.url));
const DEFAULT_HOST = process.env.ONHAND_CDP_HOST || "127.0.0.1";
const DEFAULT_PORT = Number(process.env.ONHAND_CDP_PORT || process.env.ONHAND_TEST_CDP_PORT || 9343);
const DEFAULT_TIMEOUT = "180s";
const DEFAULT_OUT_DIR = "tmp/page-prompt-eval";
const DEFAULT_MIN_SCORE = 0.78;
const DEFAULT_JUDGE_MIN_SCORE = 0.72;
const DEFAULT_JUDGE_TIMEOUT_MS = 60_000;
const DEFAULT_JUDGE_BASE_URL = process.env.OPENAI_API_KEY ? "https://api.openai.com/v1" : "https://openrouter.ai/api/v1";
const DEFAULT_JUDGE_MODEL = process.env.OPENAI_API_KEY ? "gpt-4.1-mini" : "openai/gpt-4.1-mini";
const DEFAULT_JUDGE_API_KEY_ENV = process.env.OPENAI_API_KEY ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY";
const EXTENSION_ID = process.env.ONHAND_EXTENSION_ID || "hpjpjeehgbloadhdidmecpijppodibim";
const SCREENSHOT_MAX_MARKS_PER_TAB = 4;

const PROCESS_NARRATION_PATTERNS = [
	{ id: "let-me-read", pattern: "\\blet me (?:start by )?(?:read|reading|look|looking|check|checking|find|finding|capture|capturing)\\b" },
	{ id: "found-it", pattern: "\\bfound it\\b|\\bi found the\\b" },
	{ id: "let-me-start-with", pattern: "\\blet me start with\\b" },
	{ id: "let-me-grab", pattern: "\\blet me grab\\b" },
	{ id: "let-me-highlight", pattern: "\\blet me highlight\\b|\\bnow let me highlight\\b" },
	{ id: "let-me-add-notes", pattern: "\\b(?:now\\s+)?let me add\\b[^.!?\\n]{0,120}\\b(?:notes?|highlights?|markers?)\\b" },
	{ id: "let-me-record", pattern: "\\blet me record\\b" },
	{ id: "grounding-preamble", pattern: "\\blet me (?:ground|anchor|inspect|extract)\\b" },
	{ id: "highlighted-above", pattern: "\\bhighlighted above\\b|\\banchored above\\b" },
	{ id: "horizontal-rule", pattern: "^\\s*---+\\s*$" },
];

const FRAGMENTED_MATH_PATTERN = String.raw`(^|\n)\s*(?:[$]{1,2}\s*)?(?:[pP𝑝]\s*(?:[A-Za-z\s]+)?\s*)?\([^)\n]{1,160}\)\s*=\s*(?:[$]{1,2}\s*)?(?=\n|$)`;
const MALFORMED_DISPLAY_MATH_PATTERN = String.raw`(^|\n)\s*(?:\$\$\\|\\\[\s*\\\]|\$\$\s*\$\$)\s*(?=\n|$)`;

const BUILTIN_CASES = [
	{
		id: "bayesian-teach",
		url: "https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/06BayesianDL/BayesianDL.html",
		prompt: "Teach me what this page says about Bayesian neural networks.",
		learning: true,
		expect: {
			minHighlights: 1,
			maxHighlights: 6,
			maxNotes: 6,
			maxWords: 520,
			requiredReplyPatterns: ["Bayesian", "posterior", "weight|parameter|model"],
			requiredHighlightPatterns: ["posterior|Bayesian models"],
			forbiddenReplyPatterns: PROCESS_NARRATION_PATTERNS.map((entry) => entry.pattern),
			singleHighlightForbiddenReplyPatterns: ["Hamiltonian Monte Carlo", "Stochastic Gradient MCMC", "Metropolis-Hastings"],
			forbidMarkdownTables: true,
			forbidInlineMarkdownHeadings: true,
			forbidFragmentedMath: true,
			maxMethodMentions: 2,
			maxHighlightErrors: 0,
		},
	},
	{
		id: "bayesian-no-page-changes",
		url: "https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/06BayesianDL/BayesianDL.html",
		prompt: "Teach me what this page says about Bayesian neural networks, but do not add highlights or notes.",
		expect: {
			minHighlights: 0,
			maxHighlights: 0,
			maxNotes: 0,
			maxWords: 520,
			requiredReplyPatterns: ["Bayesian", "posterior"],
			forbiddenReplyPatterns: PROCESS_NARRATION_PATTERNS.map((entry) => entry.pattern),
			forbidMarkdownTables: true,
			forbidInlineMarkdownHeadings: true,
			forbidFragmentedMath: true,
		},
	},
	{
		id: "bayesian-compare",
		url: "https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/06BayesianDL/BayesianDL.html",
		prompt: "Compare rejection sampling and Metropolis-Hastings on this page.",
		expect: {
			minHighlights: 2,
			maxHighlights: 4,
			maxNotes: 2,
			maxWords: 560,
			requiredReplyPatterns: ["rejection sampling", "Metropolis-Hastings", "constant\\s+M|global\\s+constant|proposal"],
			requiredHighlightPatterns: ["rejection sampling", "Metropolis-Hastings"],
			forbiddenReplyPatterns: PROCESS_NARRATION_PATTERNS.map((entry) => entry.pattern),
			// Small tables are legal for genuine comparisons (v3.0 narrowed ban).
			forbidMarkdownTables: false,
			forbidInlineMarkdownHeadings: true,
			forbidFragmentedMath: true,
			maxHighlightErrors: 0,
		},
	},
	{
		id: "bayesian-ordinary-answer",
		url: "https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/06BayesianDL/BayesianDL.html",
		prompt: "According to this page, what prior distribution example is used for W? Keep it one sentence.",
		expect: {
			maxHighlights: 0,
			maxNotes: 0,
			maxWords: 80,
			requiredReplyPatterns: ["Normal|standard normal|0,\\s*I"],
			forbiddenReplyPatterns: PROCESS_NARRATION_PATTERNS.map((entry) => entry.pattern),
		},
	},
	{
		// The external-source flow: the prompt asks for a source that derives the
		// result, so source browsing must activate, the answer must ground in the
		// page's derivation, and at least one durable highlight must anchor it
		// (rendered-math pages used to fail here with timeout spirals and zero
		// markers). Highlight failures may occur once but must degrade cleanly.
		id: "bayes-source-derivation",
		url: "https://en.wikipedia.org/wiki/Bayes%27_theorem",
		prompt: "Could you show me a source that does derive Bayes' theorem from scratch?",
		expect: {
			minHighlights: 1,
			maxHighlights: 5,
			maxNotes: 2,
			maxWords: 520,
			requiredReplyPatterns: ["deriv", "conditional|joint", "equat|divid|both equal|set equal"],
			requiredHighlightPatterns: ["derived|conditional|probabilit|P\\s*\\("],
			forbiddenReplyPatterns: PROCESS_NARRATION_PATTERNS.map((entry) => entry.pattern),
			forbidMarkdownTables: true,
			forbidInlineMarkdownHeadings: true,
			forbidFragmentedMath: true,
			maxHighlightErrors: 1,
			maxTotalToolDurationMs: 45000,
		},
	},
	{
		id: "mdn-fetch-teach",
		url: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch",
		prompt: "Teach me what this page says about using Fetch.",
		expect: {
			minHighlights: 1,
			maxHighlights: 6,
			maxNotes: 6,
			maxWords: 520,
			requiredReplyPatterns: ["fetch|request|response"],
			requiredHighlightPatterns: ["fetch|request|response"],
			forbiddenReplyPatterns: PROCESS_NARRATION_PATTERNS.map((entry) => entry.pattern),
			forbidMarkdownTables: true,
			forbidInlineMarkdownHeadings: true,
			forbidFragmentedMath: true,
			maxHighlightErrors: 0,
		},
	},
	{
		id: "wikipedia-photosynthesis-teach",
		url: "https://en.wikipedia.org/wiki/Photosynthesis",
		prompt: "Teach me what this page says about photosynthesis.",
		expect: {
			minHighlights: 1,
			maxHighlights: 6,
			maxNotes: 6,
			maxWords: 520,
			requiredReplyPatterns: ["photosynthesis|light|energy"],
			requiredHighlightPatterns: ["photosynthesis|light|energy"],
			forbiddenReplyPatterns: PROCESS_NARRATION_PATTERNS.map((entry) => entry.pattern),
			forbidMarkdownTables: true,
			forbidInlineMarkdownHeadings: true,
			forbidFragmentedMath: true,
			maxHighlightErrors: 0,
		},
	},
	{
		id: "energy-heat-pump-summary",
		url: "https://www.energystar.gov/products/air_source_heat_pumps",
		prompt: "Give me a practical summary of this page.",
		expect: {
			minHighlights: 1,
			maxHighlights: 6,
			maxNotes: 6,
			maxWords: 520,
			requiredReplyPatterns: ["heat pump|heating|cooling"],
			requiredHighlightPatterns: ["heat pump|heating|cooling"],
			forbiddenReplyPatterns: PROCESS_NARRATION_PATTERNS.map((entry) => entry.pattern),
			forbidMarkdownTables: true,
			forbidInlineMarkdownHeadings: true,
			forbidFragmentedMath: true,
			maxHighlightErrors: 0,
		},
	},
	{
		id: "python-datastructures-roadmap",
		url: "https://docs.python.org/3/tutorial/datastructures.html",
		prompt: "Give me a roadmap of the data structures covered on this page.",
		expect: {
			minHighlights: 4,
			maxHighlights: 9,
			maxNotes: 5,
			maxWords: 560,
			requiredReplyPatterns: ["list|tuple|set|dictionary"],
			requiredHighlightPatterns: ["list|5\\.1", "tuple|sequence", "sets?", "dictionar"],
			conditionalHighlightPatterns: [
				{ reply: "looping|items\\(|enumerate|zip\\(", highlight: "looping|items\\(|enumerate|zip\\(" },
				{ reply: "more on conditions|identity|chained comparisons", highlight: "more on conditions|identity|chained comparisons" },
				{ reply: "comparing sequences|lexicographic", highlight: "comparing sequences|lexicographic" },
			],
			forbiddenReplyPatterns: PROCESS_NARRATION_PATTERNS.map((entry) => entry.pattern),
			forbidMarkdownTables: true,
			forbidInlineMarkdownHeadings: true,
			forbidFragmentedMath: true,
			maxHighlightErrors: 0,
		},
	},
	{
		id: "mdn-grid-flexbox-compare",
		url: "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Relationship_of_grid_layout_with_other_layout_methods",
		prompt: "Compare CSS Grid and Flexbox on this page.",
		expect: {
			minHighlights: 2,
			maxHighlights: 4,
			maxNotes: 2,
			maxWords: 560,
			requiredReplyPatterns: ["grid|flexbox|one-dimensional|two-dimensional"],
			requiredHighlightPatterns: ["grid|flexbox"],
			forbiddenReplyPatterns: PROCESS_NARRATION_PATTERNS.map((entry) => entry.pattern),
			// Small tables are legal for genuine comparisons (v3.0 narrowed ban).
			forbidMarkdownTables: false,
			forbidInlineMarkdownHeadings: true,
			forbidFragmentedMath: true,
			maxHighlightErrors: 0,
		},
	},
];

function printUsage() {
	console.log(`Usage: npm run eval:page-prompts -- [options]

Runs real Onhand page prompts through the CLI/CDP driver, then scores replies,
tool traces, highlights, notes, and timing.

Options:
  --case <id>                 Run only a built-in or case-file case. Repeatable.
  --cases-file <path>         JSON file: { "cases": [...], "variants": [...] } or an array of cases.
  --url <url>                 Add one ad-hoc case URL.
  --prompt <text>             Add one ad-hoc case prompt.
  --id <id>                   ID for the ad-hoc case. Default: adhoc.
  --learning                  Enable Learning mode for the ad-hoc case.
  --variant <id|id=file>      Add a variant. "id=file" reads launcher-policy append text from file.
  --variants-file <path>      JSON file containing an array of variant objects.
  --host <host>               CDP host. Default: ${DEFAULT_HOST}
  --port <port>               CDP port. Default: ${DEFAULT_PORT}
  --timeout <duration>        Onhand answer wait timeout. Default: ${DEFAULT_TIMEOUT}
  --out-dir <path>            Output directory. Default: ${DEFAULT_OUT_DIR}/<timestamp>
  --json                      Print JSON summary to stdout.
  --voice live                Ask each case as a spoken turn (no microphone): runs the Live
                              client-mode coordinator and checks the text handed to Live to speak.
  --dry-run                   Validate and print the run plan without opening a browser.
  --list-cases                Print available built-in cases.
  --keep-tabs                 Do not close the tabs a case opened (default: close them to keep the debug browser healthy).
  --model <id>                Run with this Onhand model (must be offered by the current provider), then restore the previous one.
  --screenshots               Save a viewport screenshot around each landed mark (up to ${SCREENSHOT_MAX_MARKS_PER_TAB} per tab).
  --judge                     Ask a rubric judge to decide final quality.
  --judge-export-ok           Required with --judge; sends rubric docs and eval data to the judge API.
  --judge-model <model>       OpenAI-compatible judge model. Default: ${DEFAULT_JUDGE_MODEL}
  --judge-base-url <url>      Judge API base URL. Default: ${DEFAULT_JUDGE_BASE_URL}
  --judge-api-key-env <name>  Env var containing judge API key. Default: ${DEFAULT_JUDGE_API_KEY_ENV}
  --judge-min-score <n>       Judge score needed for pass. Default: ${DEFAULT_JUDGE_MIN_SCORE}
  --judge-timeout-ms <n>      Judge request timeout. Default: ${DEFAULT_JUDGE_TIMEOUT_MS}
  -h, --help                  Show this help.

Variant object fields:
  id, systemAppend, systemAppendFile, launcherAppend, launcherAppendFile

Case object fields:
  id, url, prompt, learning, timeout, expect
  setupUrls                   URLs opened in their own tabs before the prompt (multi-page cases).
  followUps                   [{ prompt, expect }] asked in the same session after the first turn.

Multi-page / research expect fields:
  requiredToolPatterns        Each regex must match a completed tool name.
  forbiddenToolPatterns       No tool that actually ran may match (guardrail-blocked attempts only warn).
  minAnnotatedTabs            Marks must land on at least this many distinct tabs.
  minSourceTabs               Tools must read or mark at least this many distinct tabs.
`);
}

function parseArgs(argv) {
	const args = {
		host: DEFAULT_HOST,
		port: DEFAULT_PORT,
		timeout: DEFAULT_TIMEOUT,
		outDir: "",
		json: false,
		dryRun: false,
		listCases: false,
		keepTabs: false,
		model: "",
		screenshots: false,
		caseIds: [],
		casesFile: "",
		url: "",
		prompt: "",
		id: "adhoc",
		learning: false,
		variants: [],
		variantsFile: "",
		judge: false,
		judgeExportOk: false,
		judgeModel: DEFAULT_JUDGE_MODEL,
		judgeBaseUrl: DEFAULT_JUDGE_BASE_URL,
		judgeApiKeyEnv: DEFAULT_JUDGE_API_KEY_ENV,
		judgeMinScore: DEFAULT_JUDGE_MIN_SCORE,
		judgeTimeoutMs: DEFAULT_JUDGE_TIMEOUT_MS,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		const readValue = (name) => {
			const inline = value.startsWith(`${name}=`) ? value.slice(name.length + 1) : "";
			if (inline) return inline;
			const next = argv[index + 1];
			if (!next || next.startsWith("-")) throw new Error(`${name} requires a value.`);
			index += 1;
			return next;
		};
		if (value === "-h" || value === "--help") {
			printUsage();
			process.exit(0);
		} else if (value === "--json") {
			args.json = true;
		} else if (value === "--voice" || value.startsWith("--voice=")) {
			const engine = value.includes("=") ? value.slice("--voice=".length) : readValue("--voice");
			if (engine !== "live") throw new Error("--voice must be live (the Realtime engine was removed).");
			args.voice = engine;
		} else if (value === "--dry-run") {
			args.dryRun = true;
		} else if (value === "--list-cases") {
			args.listCases = true;
		} else if (value === "--keep-tabs") {
			args.keepTabs = true;
		} else if (value === "--screenshots") {
			args.screenshots = true;
		} else if (value === "--model" || value.startsWith("--model=")) {
			args.model = readValue("--model");
		} else if (value === "--judge") {
			args.judge = true;
		} else if (value === "--judge-export-ok") {
			args.judgeExportOk = true;
		} else if (value === "--learning") {
			args.learning = true;
		} else if (value === "--host" || value.startsWith("--host=")) {
			args.host = readValue("--host");
		} else if (value === "--port" || value.startsWith("--port=")) {
			const port = Number(readValue("--port"));
			if (!Number.isFinite(port) || port <= 0) throw new Error("--port must be positive.");
			args.port = port;
		} else if (value === "--timeout" || value.startsWith("--timeout=")) {
			args.timeout = readValue("--timeout");
		} else if (value === "--out-dir" || value.startsWith("--out-dir=")) {
			args.outDir = readValue("--out-dir");
		} else if (value === "--case" || value.startsWith("--case=")) {
			args.caseIds.push(readValue("--case"));
		} else if (value === "--cases-file" || value.startsWith("--cases-file=")) {
			args.casesFile = readValue("--cases-file");
		} else if (value === "--url" || value.startsWith("--url=")) {
			args.url = readValue("--url");
		} else if (value === "--prompt" || value.startsWith("--prompt=")) {
			args.prompt = readValue("--prompt");
		} else if (value === "--id" || value.startsWith("--id=")) {
			args.id = readValue("--id");
		} else if (value === "--variant" || value.startsWith("--variant=")) {
			args.variants.push(parseVariantArg(readValue("--variant")));
		} else if (value === "--variants-file" || value.startsWith("--variants-file=")) {
			args.variantsFile = readValue("--variants-file");
		} else if (value === "--judge-model" || value.startsWith("--judge-model=")) {
			args.judgeModel = readValue("--judge-model");
		} else if (value === "--judge-base-url" || value.startsWith("--judge-base-url=")) {
			args.judgeBaseUrl = readValue("--judge-base-url").replace(/\/+$/, "");
		} else if (value === "--judge-api-key-env" || value.startsWith("--judge-api-key-env=")) {
			args.judgeApiKeyEnv = readValue("--judge-api-key-env");
		} else if (value === "--judge-min-score" || value.startsWith("--judge-min-score=")) {
			const score = Number(readValue("--judge-min-score"));
			if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error("--judge-min-score must be between 0 and 1.");
			args.judgeMinScore = score;
		} else if (value === "--judge-timeout-ms" || value.startsWith("--judge-timeout-ms=")) {
			const timeout = Number(readValue("--judge-timeout-ms"));
			if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("--judge-timeout-ms must be positive.");
			args.judgeTimeoutMs = timeout;
		} else {
			throw new Error(`Unknown option: ${value}`);
		}
	}
	if ((args.url || args.prompt) && (!args.url || !args.prompt)) throw new Error("--url and --prompt must be supplied together for an ad-hoc case.");
	if (args.judge && !args.judgeExportOk && !args.dryRun) {
		throw new Error("--judge sends Onhand rubric docs and eval artifacts to the judge API. Re-run with --judge-export-ok only after explicit approval.");
	}
	return args;
}

function parseVariantArg(value) {
	const text = String(value || "").trim();
	if (!text) throw new Error("--variant cannot be blank.");
	const equals = text.indexOf("=");
	if (equals > 0) {
		return { id: text.slice(0, equals).trim(), launcherAppendFile: text.slice(equals + 1).trim() };
	}
	return { id: text };
}

async function readJsonFile(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

async function readOptionalFile(path) {
	return path ? String(await readFile(path, "utf8")).trim() : "";
}

async function loadCases(args) {
	let cases = [...BUILTIN_CASES];
	let fileVariants = [];
	if (args.casesFile) {
		const payload = await readJsonFile(args.casesFile);
		if (Array.isArray(payload)) cases = payload;
		else {
			if (Array.isArray(payload?.cases)) cases = payload.cases;
			if (Array.isArray(payload?.variants)) fileVariants = payload.variants;
		}
	}
	if (args.url && args.prompt) {
		cases.push({
			id: args.id || "adhoc",
			url: args.url,
			prompt: args.prompt,
			learning: args.learning,
			expect: {
				forbiddenReplyPatterns: PROCESS_NARRATION_PATTERNS.map((entry) => entry.pattern),
				forbidFragmentedMath: true,
			},
		});
	}
	if (args.caseIds.length) {
		const selected = new Set(args.caseIds);
		cases = cases.filter((testCase) => selected.has(testCase.id));
		const missing = args.caseIds.filter((id) => !cases.some((testCase) => testCase.id === id));
		if (missing.length) throw new Error(`Unknown case id(s): ${missing.join(", ")}`);
	}
	if (!cases.length) throw new Error("No cases to run.");

	let variants = [...fileVariants, ...args.variants];
	if (args.variantsFile) {
		const payload = await readJsonFile(args.variantsFile);
		variants.push(...(Array.isArray(payload) ? payload : Array.isArray(payload?.variants) ? payload.variants : []));
	}
	if (!variants.length) variants = [{ id: "baseline" }];
	variants = await Promise.all(variants.map(normalizeVariant));
	return { cases: cases.map(normalizeCase), variants };
}

function normalizeCase(testCase) {
	const id = String(testCase?.id || "").trim();
	const url = String(testCase?.url || "").trim();
	const prompt = String(testCase?.prompt || "").trim();
	if (!id || !url || !prompt) throw new Error(`Invalid case: ${JSON.stringify(testCase)}`);
	return {
		...testCase,
		id,
		url,
		prompt,
		learning: Boolean(testCase.learning),
		expect: testCase.expect && typeof testCase.expect === "object" ? testCase.expect : {},
	};
}

async function normalizeVariant(variant) {
	const id = String(variant?.id || "").trim();
	if (!id) throw new Error(`Invalid variant: ${JSON.stringify(variant)}`);
	return {
		id,
		systemAppend: String(variant.systemAppend || "").trim() || await readOptionalFile(variant.systemAppendFile),
		launcherAppend: String(variant.launcherAppend || variant.policyAppend || "").trim() || await readOptionalFile(variant.launcherAppendFile || variant.policyAppendFile),
	};
}

function excerpt(value, max = 1800) {
	const text = String(value || "").replace(/\s+/g, " ").trim();
	return text.length > max ? `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...` : text;
}

function extractBetween(text, start, end) {
	const startIndex = text.indexOf(start);
	if (startIndex < 0) return "";
	const contentStart = startIndex + start.length;
	const endIndex = end ? text.indexOf(end, contentStart) : -1;
	return text.slice(contentStart, endIndex >= 0 ? endIndex : undefined).trim();
}

async function loadJudgeRubric() {
	const [runtimeSource, pedagogyPlan, learningSpec] = await Promise.all([
		readFile(join(ROOT, "packages/browser-extension/src/browser-runtime.ts"), "utf8"),
		readFile(join(ROOT, "docs/PEDAGOGY_PLAN.md"), "utf8").catch(() => ""),
		readFile(join(ROOT, "docs/LEARNING_MODE_SPEC.md"), "utf8").catch(() => ""),
	]);
	const constitution = extractBetween(runtimeSource, "Onhand's constitution:", "Default answer mode:");
	const defaultAnswerMode = extractBetween(runtimeSource, "Default answer mode:", "- For PDFs,");
	const pedagogy = extractBetween(pedagogyPlan, "## 1. Pedagogical concepts, mapped to Onhand", "## 2. The core architectural shift");
	const learningMoves = extractBetween(learningSpec, "## Teaching moves", "## Learner state");
	return [
		"ONHAND CONSTITUTION",
		constitution,
		"",
		"DEFAULT ANSWER MODE",
		defaultAnswerMode,
		"",
		"PEDAGOGY PLAN EXCERPT",
		pedagogy,
		"",
		"LEARNING MODE TEACHING MOVES",
		learningMoves,
	].join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildJudgeMessages({ testCase, variant, evaluation, raw, rubric }) {
	const toolErrors = (evaluation.tools || [])
		.filter((tool) => tool.state === "error" || tool.error)
		.map((tool) => `${tool.toolName}: ${tool.error || tool.state}`)
		.slice(0, 12);
	const toolSummary = (evaluation.tools || [])
		.map((tool) => `${tool.toolName || "tool"}:${tool.state || "unknown"}:${tool.duration_ms ?? "?"}ms${tool.error ? ` error=${tool.error}` : ""}`)
		.slice(0, 24);
	const pageActions = Array.isArray(raw?.turn?.pageActions)
		? raw.turn.pageActions.map((action) => ({
				key: action.key || "",
				type: action.type || "",
				citationText: excerpt(action.citationText || action.detail || action.noteText || "", 400),
				noteText: excerpt(action.noteText || "", 240),
			}))
		: [];
	const payload = {
		case: {
			id: testCase.id,
			url: testCase.url,
			prompt: testCase.prompt,
			learningMode: Boolean(testCase.learning),
			variant: variant.id,
		},
		metrics: evaluation.metrics,
		mechanicalDiagnostics: {
			status: evaluation.status,
			score: evaluation.score,
			failures: evaluation.failures,
			warnings: evaluation.warnings,
		},
		reply: evaluation.reply,
		highlights: evaluation.highlights,
		notes: evaluation.notes,
		pageActions,
		toolSummary,
		toolErrors,
	};
	return [
		{
			role: "system",
			content: [
				"You are an expert QA judge for Onhand, a browser-based contextual tutor.",
				"Judge whether the final user-visible answer, page highlights, notes, and tool behavior fit Onhand's product constitution.",
				"Do not grade by rigid counts. A response can pass with one excellent source marker or fail with many poor ones.",
				"Focus on whether Onhand helped the user understand the page, grounded material claims in durable page evidence, stayed concise for a side panel, avoided internal process narration, and used highlights/notes only when they materially helped.",
				"Treat mechanical checks as diagnostics, not as your final rubric. Tool errors matter when they leave claims unsupported, waste time, or create bad UX.",
				"Hard blockers: visible process narration such as 'Let me start by reading', 'Let me grab', 'now let me highlight', or 'let me record'; claims that depend on source passages that were not successfully highlighted when the prompt called for source markers; or highlights that are only generic titles while the answer makes detailed claims.",
				"Major issues: repeated failed highlight attempts, long runtime caused by bad anchor selection, notes that merely paraphrase the highlight, or broad multi-section summaries backed by only weak/generic source markers.",
				"Return only valid JSON.",
				"",
				rubric,
			].join("\n"),
		},
		{
			role: "user",
			content: [
				"Evaluate this Onhand turn.",
				"",
				"Return JSON with this shape:",
				`{"verdict":"pass|needs_review|fail","score":0.0,"summary":"one sentence","strengths":["..."],"issues":[{"severity":"minor|major|blocking","area":"answer|grounding|highlight|note|learning|math|tooling","message":"...","evidence":"..."}],"recommendations":["..."],"criteria":{"grounding":"pass|mixed|fail","annotationFit":"pass|mixed|fail","answerQuality":"pass|mixed|fail","sidePanelFit":"pass|mixed|fail","learningFit":"pass|mixed|fail"}}`,
				"",
				"Turn JSON:",
				JSON.stringify(payload, null, 2),
			].join("\n"),
		},
	];
}

function parseJudgeJson(text) {
	const raw = String(text || "").trim();
	try {
		return JSON.parse(raw);
	} catch {
		const match = raw.match(/\{[\s\S]*\}/);
		if (!match) throw new Error(`Judge returned non-JSON: ${raw.slice(0, 240)}`);
		return JSON.parse(match[0]);
	}
}

async function fetchWithTimeout(url, options = {}) {
	const { timeoutMs = DEFAULT_JUDGE_TIMEOUT_MS, ...fetchOptions } = options;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
	try {
		return await fetch(url, { ...fetchOptions, signal: controller.signal });
	} finally {
		clearTimeout(timeout);
	}
}

async function runJudge({ args, rubric, testCase, variant, evaluation, raw }) {
	const apiKey = process.env[args.judgeApiKeyEnv];
	if (!apiKey) throw new Error(`Missing ${args.judgeApiKeyEnv}; set it or omit --judge.`);
	const messages = buildJudgeMessages({ testCase, variant, evaluation, raw, rubric });
	const response = await fetchWithTimeout(`${args.judgeBaseUrl}/chat/completions`, {
		method: "POST",
		timeoutMs: args.judgeTimeoutMs,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			...(args.judgeBaseUrl.includes("openrouter.ai") ? {
				"HTTP-Referer": "https://github.com/Phineas1500/Onhand",
				"X-Title": "Onhand Page Prompt Eval",
			} : {}),
		},
		body: JSON.stringify({
			model: args.judgeModel,
			messages,
			temperature: 0,
			max_tokens: 1200,
			response_format: { type: "json_object" },
		}),
	});
	const text = await response.text();
	let payload = null;
	try {
		payload = text ? JSON.parse(text) : null;
	} catch {
		payload = { raw: text };
	}
	if (!response.ok) {
		throw new Error(payload?.error?.message || text || `Judge HTTP ${response.status}`);
	}
	const content = payload?.choices?.[0]?.message?.content || "";
	const parsed = parseJudgeJson(content);
	const score = Number(parsed.score);
	return {
		verdict: ["pass", "needs_review", "fail"].includes(parsed.verdict) ? parsed.verdict : "needs_review",
		score: Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0,
		summary: String(parsed.summary || "").trim(),
		strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String).slice(0, 8) : [],
		issues: Array.isArray(parsed.issues) ? parsed.issues.map((issue) => ({
			severity: String(issue?.severity || "minor"),
			area: String(issue?.area || "answer"),
			message: String(issue?.message || ""),
			evidence: String(issue?.evidence || ""),
		})).slice(0, 12) : [],
		recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map(String).slice(0, 8) : [],
		criteria: parsed.criteria && typeof parsed.criteria === "object" ? parsed.criteria : {},
		model: args.judgeModel,
		baseUrl: args.judgeBaseUrl,
		usage: payload?.usage || null,
	};
}

function objectiveBlockingFailures(evaluation) {
	return (evaluation.failures || []).filter((failure) => /turn error|forbidden reply pattern|fragmented formula/i.test(failure));
}

function applyJudgeResult(evaluation, judge, args) {
	const mechanical = {
		status: evaluation.status,
		score: evaluation.score,
		failures: evaluation.failures,
		warnings: evaluation.warnings,
	};
	const blockers = objectiveBlockingFailures(evaluation);
	const judgeIssues = Array.isArray(judge?.issues) ? judge.issues : [];
	const judgeFailureMessages = judgeIssues
		.filter((issue) => issue.severity === "blocking" || issue.severity === "major")
		.map((issue) => `${issue.severity} ${issue.area}: ${issue.message}`)
		.filter(Boolean);
	const judgePasses = judge?.verdict === "pass" && Number(judge?.score || 0) >= args.judgeMinScore;
	const failures = [
		...blockers,
		...(judgePasses ? [] : [
			`judge ${judge?.verdict || "needs_review"} score=${Number(judge?.score || 0).toFixed(3)} < ${args.judgeMinScore}`,
			...judgeFailureMessages,
		]),
	];
	const warnings = [
		...mechanical.failures.filter((failure) => !blockers.includes(failure)).map((failure) => `mechanical: ${failure}`),
		...mechanical.warnings,
		...judgeIssues.filter((issue) => issue.severity === "minor").map((issue) => `judge ${issue.area}: ${issue.message}`),
	];
	return {
		...evaluation,
		status: failures.length ? "fail" : "pass",
		score: Number(judge?.score || 0),
		minScore: args.judgeMinScore,
		failures,
		warnings,
		judge,
		mechanical,
	};
}

function cdpHttp(host, port, path) {
	return new Promise((resolve, reject) => {
		http
			.get({ host, port, path, timeout: 5000 }, (res) => {
				let data = "";
				res.on("data", (chunk) => (data += chunk));
				res.on("end", () => resolve(data));
			})
			.on("error", reject)
			.on("timeout", function onTimeout() {
				this.destroy(new Error("CDP HTTP timeout"));
			});
	});
}

async function listContentTargetIds(host, port) {
	try {
		const targets = JSON.parse(await cdpHttp(host, port, "/json/list"));
		return new Set(
			(Array.isArray(targets) ? targets : [])
				.filter((target) => target?.type === "page" && /^https?:\/\//.test(String(target?.url || "")))
				.map((target) => target.id),
		);
	} catch {
		return new Set();
	}
}

// Each case opens its own content tabs (ask-new-url, setup URLs, and any tab
// Onhand navigates to) and nothing closes them. Left to accumulate, the debug
// browser degrades: backgrounded tabs report zero-rect layouts, which surface
// as false "No visible text matched" and empty-reply failures — model-
// independent noise that masquerades as quality regressions. Close the http(s)
// tabs the case opened; tabs that existed before it (the user's own, when the
// run targets their everyday profile), the extension's own pages, and
// chrome:// tabs are left alone.
async function closeContentTabs(host, port, preexistingIds = new Set()) {
	let targets;
	try {
		targets = JSON.parse(await cdpHttp(host, port, "/json/list"));
	} catch {
		return 0;
	}
	if (!Array.isArray(targets)) return 0;
	let closed = 0;
	for (const target of targets) {
		if (target?.type !== "page") continue;
		if (!/^https?:\/\//.test(String(target?.url || ""))) continue;
		if (preexistingIds.has(target.id)) continue;
		try {
			await cdpHttp(host, port, `/json/close/${target.id}`);
			closed += 1;
		} catch {
			// best-effort; a tab we cannot close is not fatal to the run
		}
	}
	return closed;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openTarget(host, port, url) {
	// /json/new only accepts PUT in current Chromium.
	const response = await fetch(`http://${host}:${port}/json/new?${url}`, { method: "PUT" });
	if (!response.ok) throw new Error(`CDP /json/new returned HTTP ${response.status}`);
	return await response.json();
}

function connectTarget(webSocketDebuggerUrl) {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
		const pending = new Map();
		let nextId = 0;
		socket.on("message", (raw) => {
			const message = JSON.parse(raw);
			const entry = pending.get(message.id);
			if (!entry) return;
			pending.delete(message.id);
			if (message.error) entry.reject(new Error(message.error.message));
			else entry.resolve(message.result);
		});
		socket.once("error", reject);
		socket.once("open", () =>
			resolve({
				send(method, params = {}) {
					const id = ++nextId;
					return new Promise((resolveSend, rejectSend) => {
						pending.set(id, { resolve: resolveSend, reject: rejectSend });
						socket.send(JSON.stringify({ id, method, params }));
					});
				},
				close: () => socket.close(),
			}),
		);
	});
}

async function evaluateValue(session, expression) {
	const result = await session.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
	if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
	return result?.result?.value;
}

// Switches Onhand's model with the same browser-runtime:update-settings message
// the options page sends, and returns the previous model so main() can restore
// the user's choice after the run.
async function setOnhandModel(args, modelId, { requireOffered = true } = {}) {
	const target = await openTarget(args.host, args.port, `chrome-extension://${EXTENSION_ID}/options.html`);
	const session = await connectTarget(target.webSocketDebuggerUrl);
	try {
		for (let attempt = 0; attempt < 40; attempt += 1) {
			if (await evaluateValue(session, "Boolean(globalThis.chrome?.runtime?.sendMessage)")) break;
			await sleep(250);
		}
		const readSettings = `new Promise((resolve) => chrome.runtime.sendMessage({ type: "get-status" }, (status) => resolve(status?.status?.browserRuntime || {})))`;
		const before = await evaluateValue(session, readSettings);
		const offered = (before.providerModels?.[before.aiProvider] || []).map((model) => model.id);
		if (requireOffered && !offered.includes(modelId)) throw new Error(`Onhand's ${before.aiProvider} provider does not offer ${modelId} (offers: ${offered.join(", ")})`);
		const update = await evaluateValue(session, `chrome.runtime.sendMessage({ type: "browser-runtime:update-settings", aiModel: ${JSON.stringify(modelId)} })`);
		if (!update?.ok) throw new Error(update?.error || `Onhand rejected model ${modelId}`);
		const after = await evaluateValue(session, readSettings);
		if (after.aiModel !== modelId) throw new Error(`Onhand reports model ${after.aiModel} after switching to ${modelId}`);
		return { provider: before.aiProvider, previousModel: before.aiModel };
	} finally {
		session.close();
		await cdpHttp(args.host, args.port, `/json/close/${target.id}`).catch(() => {});
	}
}

function withoutHash(url) {
	return String(url || "").replace(/#.*$/, "");
}

// Scrolls each landed mark into view in its tab and saves a viewport
// screenshot, so a reviewer can see where highlights and margin notes landed.
async function captureAnnotationScreenshots(turn, args, runDir, baseName) {
	const tabs = new Map();
	for (const action of collectActions(turn).filter(isHighlightAction)) {
		if (!action.annotationId || !action.url) continue;
		const entry = tabs.get(action.tabId) || { url: action.url, marks: [] };
		if (!entry.marks.some((mark) => mark.annotationId === action.annotationId)) {
			entry.marks.push({ annotationId: action.annotationId, text: String(action.citationText || action.detail || "") });
		}
		tabs.set(action.tabId, entry);
	}
	if (!tabs.size) return [];
	const targets = JSON.parse(await cdpHttp(args.host, args.port, "/json/list"));
	const screenshots = [];
	let tabIndex = 0;
	for (const entry of tabs.values()) {
		tabIndex += 1;
		const target = targets.find((candidate) => candidate?.type === "page" && withoutHash(candidate.url) === withoutHash(entry.url));
		if (!target?.webSocketDebuggerUrl) continue;
		// Background tabs do not paint, so bring each one forward first.
		await cdpHttp(args.host, args.port, `/json/activate/${target.id}`).catch(() => {});
		const session = await connectTarget(target.webSocketDebuggerUrl);
		try {
			for (const [markIndex, mark] of entry.marks.slice(0, SCREENSHOT_MAX_MARKS_PER_TAB).entries()) {
				const found = await evaluateValue(
					session,
					`(() => { const mark = document.querySelector(${JSON.stringify(`[data-onhand-annotation-id="${mark.annotationId}"]`)}); if (!mark) return false; mark.scrollIntoView({ block: "center" }); return true; })()`,
				);
				if (!found) continue;
				await sleep(700);
				const { data } = await session.send("Page.captureScreenshot", { format: "jpeg", quality: 70 });
				const file = `${baseName}__tab${tabIndex}__mark${markIndex + 1}.jpg`;
				await writeFile(join(runDir, file), Buffer.from(data, "base64"));
				screenshots.push({ file, url: entry.url, annotationId: mark.annotationId, text: mark.text });
			}
		} catch (error) {
			screenshots.push({ file: "", url: entry.url, error: error.message });
		} finally {
			session.close();
		}
	}
	return screenshots;
}

function runCli(args, options = {}) {
	const fullArgs = [CLI, ...args, "--host", options.host, "--port", String(options.port)];
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, fullArgs, {
			cwd: ROOT,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`debug:sessions ${args.join(" ")} failed with exit ${code}\n${stderr || stdout}`));
				return;
			}
			try {
				resolve(JSON.parse(stdout));
			} catch (error) {
				reject(new Error(`Could not parse debug:sessions JSON: ${error.message}\n${stdout}`));
			}
		});
	});
}

function regex(pattern, flags = "i") {
	return new RegExp(String(pattern || ""), flags.includes("m") ? flags : `${flags}m`);
}

function words(value) {
	const match = String(value || "").trim().match(/\S+/g);
	return match ? match.length : 0;
}

// A bare ``` line is normally a code block's closing fence: pair fence lines
// in order and flag only an unpaired one (or a bare ** / __ / ` line).
function hasOrphanMarkdownDelimiterLine(reply) {
	const lines = String(reply || "").split("\n");
	const fenceIndexes = lines.flatMap((line, index) => (/^\s*`{3,}/.test(line) ? [index] : []));
	const paired = new Set();
	for (let index = 0; index + 1 < fenceIndexes.length; index += 2) {
		paired.add(fenceIndexes[index]);
		paired.add(fenceIndexes[index + 1]);
	}
	return lines.some((line, index) => !paired.has(index) && /^\s*(?:\*\*|__|`{1,3})\s*$/.test(line));
}

// Substantive answer points (a bullet, or a sentence of prose) that state
// something but carry no [[cite:]] chip — G1/G9 coverage. Lead-ins ending in
// a colon, questions, synthesis lines, and code are not counted.
function uncitedAnswerPoints(reply) {
	const text = String(reply || "").replace(/```[\s\S]*?```/g, " ").replace(/\$\$[\s\S]*?\$\$/g, " ");
	const units = [];
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (!line || /^#{1,6}\s/.test(line)) continue;
		const body = line.replace(/^(?:[-*•]|\d+[.)])\s+/, "");
		const parts = body !== line ? [body] : body.split(/(?<=[.!?])\s+(?=[A-Z*"“])/);
		for (const part of parts) units.push(part.trim());
	}
	return units.filter((unit) => {
		if (!unit || /\[\[cite:/.test(unit) || /[?:]\s*$/.test(unit)) return false;
		if (/^(?:\*\*)?(?:in short|overall|takeaway|in one sentence|main takeaway|bottom line|summary|so|thus|therefore|in other words|marked|answer|switch learning)\b/i.test(unit)) return false;
		if (/instructions aimed at AI assistants/i.test(unit)) return false;
		return (unit.match(/[A-Za-z]{2,}/g) || []).length >= 6;
	});
}

function allTools(turn) {
	return [
		...(Array.isArray(turn?.toolTraces) ? turn.toolTraces : []),
		...(Array.isArray(turn?.activities) ? turn.activities.filter((activity) => activity?.toolName) : []),
	];
}

function actionText(action) {
	return [action?.citationText, action?.detail, action?.text, action?.noteText, action?.label].filter(Boolean).join("\n");
}

function collectActions(turn) {
	return Array.isArray(turn?.pageActions) ? turn.pageActions : [];
}

function isHighlightControlSummary(value) {
	const text = String(value || "").toLowerCase();
	return (
		text.includes("do not call browser_highlight_text again") ||
		text.includes("source highlights already succeeded") ||
		text.includes("answer now from the existing")
	);
}

function isRealCompletedHighlightTrace(trace) {
	if (trace?.toolName !== "browser_highlight_text" || trace?.state !== "complete") return false;
	const summary = String(trace?.resultSummary || "");
	if (!summary.trim() || isHighlightControlSummary(summary)) return false;
	if (/\bannotationId:\s*[a-z0-9_-]+/i.test(summary)) return true;
	if (/\bHighlighted(?:\s+text)?\b/i.test(summary)) return true;
	const details = trace?.details || trace?.resultDetails;
	if (details && /\bannotationId\b/i.test(JSON.stringify(details))) return true;
	return false;
}

function collectHighlightTexts(turn) {
	const actions = collectActions(turn);
	const highlightActions = actions.filter((action) => String(action?.key || "").startsWith("highlight:") || action?.type === "highlight" || action?.label === "Highlighted text");
	const actionAnnotationIds = new Set(highlightActions.map((action) => String(action?.annotationId || "").trim()).filter(Boolean));
	const actionTexts = highlightActions.map(actionText).filter(Boolean);
	const toolTexts = (Array.isArray(turn?.toolTraces) ? turn.toolTraces : [])
		.filter(isRealCompletedHighlightTrace)
		.filter((trace) => {
			const summary = String(trace?.resultSummary || "");
			const annotationId = summary.match(/\bannotationId:\s*([a-z0-9_-]+)/i)?.[1];
			return !annotationId || !actionAnnotationIds.has(annotationId);
		})
		.map((trace) => [trace?.effectiveArgs?.text, trace?.args?.text, trace?.resultSummary].filter(Boolean).join("\n"))
		.filter(Boolean);
	return [...actionTexts, ...toolTexts];
}

function collectNoteTexts(turn) {
	return collectActions(turn)
		.filter((action) => action?.noteText || String(action?.key || "").startsWith("note:") || action?.type === "note")
		// `detail` is a truncated display summary; citationText carries the full note.
		.map((action) => String(action?.noteText || action?.citationText || action?.detail || action?.label || "").trim())
		.filter(Boolean);
}

function isHighlightAction(action) {
	return String(action?.key || "").startsWith("highlight:") && action?.tabId != null;
}

function collectAnnotatedTabs(turn) {
	const tabs = new Map();
	for (const action of collectActions(turn).filter(isHighlightAction)) {
		const entry = tabs.get(action.tabId) || { tabId: action.tabId, url: String(action.url || ""), marks: 0 };
		entry.marks += 1;
		tabs.set(action.tabId, entry);
	}
	return [...tabs.values()];
}

// Tabs the turn actually used: every tab it marked plus every tab a completed
// tool reported reading from.
function collectSourceTabIds(turn) {
	const ids = new Set(collectAnnotatedTabs(turn).map((tab) => tab.tabId));
	for (const trace of Array.isArray(turn?.toolTraces) ? turn.toolTraces : []) {
		const tabId = trace?.state === "complete" ? trace?.resultDetails?.tab?.id : null;
		if (tabId != null) ids.add(tabId);
	}
	return ids;
}

function collectNavigatedUrls(turn) {
	return (Array.isArray(turn?.toolTraces) ? turn.toolTraces : [])
		.filter((trace) => trace?.toolName === "browser_navigate" && trace?.state === "complete")
		.map((trace) => String(trace?.effectiveArgs?.url || trace?.args?.url || "").trim())
		.filter(Boolean);
}

function completedToolCount(turn, name) {
	const traces = Array.isArray(turn?.toolTraces) ? turn.toolTraces : [];
	const source = traces.length ? traces : Array.isArray(turn?.activities) ? turn.activities : [];
	return source.filter((tool) => tool?.toolName === name && tool?.state === "complete").length;
}

function completedRealHighlightToolCount(turn) {
	const traces = Array.isArray(turn?.toolTraces) ? turn.toolTraces : [];
	return traces.filter(isRealCompletedHighlightTrace).length;
}

function toolErrorCount(turn, name) {
	const traces = allTools(turn);
	const recoveredCount = traces.filter((tool) => tool?.toolName === name && tool?.state === "recovered").length;
	const errorCount = traces.filter((tool) => tool?.toolName === name && tool?.state === "error").length;
	return Math.max(0, errorCount - recoveredCount);
}

function totalDurationMs(turn) {
	return allTools(turn).reduce((sum, tool) => sum + (Number.isFinite(Number(tool?.duration_ms)) ? Math.max(0, Number(tool.duration_ms)) : 0), 0);
}

function methodMentionCount(reply) {
	const terms = ["Metropolis-Hastings", "Hamiltonian Monte Carlo", "HMC", "MALA", "SG-MCMC", "rejection sampling"];
	return terms.filter((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(reply)).length;
}

function evaluateTurn(result, testCase, variant, elapsedMs) {
	const turn = result?.turn || {};
	const reply = String(turn.reply || "");
	const highlightTexts = collectHighlightTexts(turn);
	const noteTexts = collectNoteTexts(turn);
	const annotatedTabs = collectAnnotatedTabs(turn);
	const navigatedUrls = collectNavigatedUrls(turn);
	const expect = testCase.expect || {};
	const metrics = {
		annotatedTabCount: annotatedTabs.length,
		sourceTabCount: collectSourceTabIds(turn).size,
		navigationCount: navigatedUrls.length,
		replyWordCount: words(reply),
		highlightCount: Math.max(highlightTexts.length, completedRealHighlightToolCount(turn)),
		noteCount: noteTexts.length,
		maxNoteChars: noteTexts.reduce((max, text) => Math.max(max, text.length), 0),
		toolCount: allTools(turn).length,
		toolDurationMs: totalDurationMs(turn),
		highlightErrorCount: toolErrorCount(turn, "browser_highlight_text"),
		elapsedMs,
		methodMentionCount: methodMentionCount(reply),
		hasInlineMarkdownHeading: /[^\n][ \t]+#{2,4}[ \t]+\S/.test(reply),
		hasMarkdownTable: /^\s*\|.+\|\s*$/m.test(reply) || /\|[ \t]+\|(?:-{3,}|:?-{3,}:?)/.test(reply) || reply.split("\n").some((line) => !/[$\\`]/.test(line) && /^\s*\S[^\n|]{1,80}\s+\|\s+\S/.test(line)),
		hasOrphanMarkdownDelimiter: hasOrphanMarkdownDelimiterLine(reply),
		uncitedPointCount: uncitedAnswerPoints(reply).length,
		hasDuplicatedOpening: /\b(?:Here(?:'|’)s\s+(?:a|the)|Here\s+are\s+(?:the\s+)?(?:main\s+)?)\s+(?:roadmap|summary|rundown|overview|data structures)[^.!?\n]{0,180}(?:[.!?]|[—–-])\s*Here(?:'|’)s\s+(?:a|the)\s+(?:roadmap|summary|rundown|overview)/i.test(reply),
		hasRedundantHighlightRecap:
			/\n{2,}(?:(?:The\s+(?:page|article|chapter|document)(?:'s|’s)?\s+roadmap(?:\s+at\s+a\s+glance|\s*\([^)]{0,80}\))?\.?\s*)?(?:Highlighted sections?|Source markers?|Marked sections?)(?:\s+on\s+the\s+page)?|The\s+(?:page|article|chapter|document)(?:'s|’s)?\s+roadmap\b)\b[^:\n]{0,180}:\s*\n/i.test(reply) ||
			/\n{2,}(?:The highlights?(?:\s+on\s+the\s+page)?\s+(?:mark|show|cover|identify)|The highlighted (?:passages?|sections?)\s+(?:mark|show|cover|identify))\b/i.test(reply),
		hasDanglingCompactFooterLeadIn: /\n\s*(?:\*\*[^*\n]{1,80}|(?:what|how|why|where|when)\b[^.!?\n]{0,60})\s*\n{2,}This keeps the first pass focused\./i.test(reply),
		hasDanglingEmptyLabel: /(?:^|\n)\s*(?:#{1,4}\s+\S.{0,120}|\*\*[^*\n]{2,120}\*\*\s*:?[.!?]?|[^.!?\n]{2,90}:[.!?]?)\s*$/.test(reply),
		hasProcessNarration: /^(?:The\s+)?visible snapshot shows\b[^.!?\n]*(?:but|however)|^Now I have the page content\b|\b(?:Let me|I(?:'|’)ll|I will)\s+(?:add|put)\s+(?:(?:a|an|one|two|three|four|couple\s+of|few|some|durable|quick|additional|key|top-level|main)\s+){0,8}source\s+markers?\b|\bI(?:'|’)ve\s+highlighted\b/im.test(reply),
		hasInlineHighlightLabel: /[—–-]\s*\*?Highlighted\s+on\s+(?:the\s+)?page\*?|\(\s*\*?highlighted\s+on\s+(?:the\s+)?page\*?\s*\)/i.test(reply),
		hasHighlightStatusNarration: /\bI(?:(?:'|’)ve| have)\s+(?:marked|highlighted)\b|\bEach\s+(?:section|item|source|passage|point)[^.]{0,160}\bhighlighted\b|\b(?:the\s+)?highlights?(?:\s+and\s+notes?)?\s+on\s+(?:the\s+)?page\s+(?:cover|show|mark|identify)\b|\b(?:a|an|another|separate|additional|the)?\s*(?:source\s+)?(?:highlight|marker)[^.!?\n]{0,120}\b(?:could(?:\s+not|n't)|cannot|can't|failed\s+to|was\s+not|wasn't)\b|\b(?:the\s+)?(?:one|two|three|four|five|six|\d+)\s+central\s+concepts?\s+are\s+highlighted\s+on\s+(?:the\s+)?page\b|\((?:the\s+)?(?:first|second|third|fourth|fifth|sixth|\d+(?:st|nd|rd|th))\s+(?:source\s+)?highlight|\(\s*\*?(?:not\s+)?highlight(?:ed)?[^)]{0,100}\*?\s*\)/i.test(reply),
		hasMalformedTableArtifact: /^\s*[-*]\s+[^:\n]{1,80}:\s+Aspect:\s+/im.test(reply),
		hasFragmentedMath: regex(FRAGMENTED_MATH_PATTERN, "im").test(reply) || regex(MALFORMED_DISPLAY_MATH_PATTERN, "im").test(reply),
	};
	const failures = [];
	const warnings = [];
	let score = 1;
	const penalty = (amount, message, hard = true) => {
		score -= amount;
		(hard ? failures : warnings).push(message);
	};
	if (turn?.error) penalty(1, `turn error: ${String(turn.error?.message || turn.error)}`);
	if (expect.minHighlights != null && metrics.highlightCount < Number(expect.minHighlights)) penalty(0.22, `expected at least ${expect.minHighlights} highlight(s), got ${metrics.highlightCount}`);
	if (expect.maxHighlights != null && metrics.highlightCount > Number(expect.maxHighlights)) penalty(0.18, `expected at most ${expect.maxHighlights} highlight(s), got ${metrics.highlightCount}`);
	if (expect.minNotes != null && metrics.noteCount < Number(expect.minNotes)) penalty(0.14, `expected at least ${expect.minNotes} note(s), got ${metrics.noteCount}`);
	if (expect.maxNotes != null && metrics.noteCount > Number(expect.maxNotes)) penalty(0.12, `expected at most ${expect.maxNotes} note(s), got ${metrics.noteCount}`);
	if (expect.maxWords != null && metrics.replyWordCount > Number(expect.maxWords)) penalty(0.14, `reply too long: ${metrics.replyWordCount} words > ${expect.maxWords}`);
	if (expect.minWords != null && metrics.replyWordCount < Number(expect.minWords)) penalty(0.08, `reply too short: ${metrics.replyWordCount} words < ${expect.minWords}`, false);
	if (expect.forbidFragmentedMath && metrics.hasFragmentedMath) penalty(0.16, "reply contains fragmented formula-like math");
	if (expect.forbidInlineMarkdownHeadings && metrics.hasInlineMarkdownHeading) penalty(0.12, "reply contains inline Markdown headings");
	if (expect.forbidMarkdownTables && metrics.hasMarkdownTable) penalty(0.14, "reply contains a Markdown table");
	if (metrics.hasOrphanMarkdownDelimiter) penalty(0.12, "reply contains an orphan Markdown delimiter line");
	// Advisory: page-grounded answers should chip every page point (G1/G9).
	if (metrics.highlightCount > 0 && metrics.uncitedPointCount > 0) penalty(0, `${metrics.uncitedPointCount} answer point(s) carry no citation chip`, false);
	if (metrics.hasDuplicatedOpening) penalty(0.12, "reply contains a duplicated opening sentence");
	if (metrics.hasRedundantHighlightRecap) penalty(0.12, "reply contains a redundant highlighted-section recap");
	if (metrics.hasDanglingCompactFooterLeadIn) penalty(0.12, "reply contains a dangling lead-in before the compact teaching footer");
	if (metrics.hasDanglingEmptyLabel) penalty(0.12, "reply ends with an empty heading or label");
	if (metrics.hasProcessNarration) penalty(0.12, "reply contains process narration");
	if (metrics.hasInlineHighlightLabel) penalty(0.1, "reply contains inline highlighted-on-page labels");
	if (metrics.hasHighlightStatusNarration) penalty(0.12, "reply narrates highlight/source-marker status");
	if (metrics.hasMalformedTableArtifact) penalty(0.14, "reply contains malformed table-conversion artifacts");
	if (expect.maxHighlightErrors != null && metrics.highlightErrorCount > Number(expect.maxHighlightErrors)) {
		penalty(0.12, `too many failed highlight attempts: ${metrics.highlightErrorCount} > ${expect.maxHighlightErrors}`);
	}
	if (metrics.maxNoteChars > 280) penalty(0.08, `note exceeds 280 chars (${metrics.maxNoteChars})`, false);
	for (const pattern of expect.forbiddenReplyPatterns || []) {
		if (regex(pattern, "im").test(reply)) penalty(0.13, `forbidden reply pattern matched: ${pattern}`);
	}
	for (const pattern of expect.requiredReplyPatterns || []) {
		if (!regex(pattern, "im").test(reply)) penalty(0.12, `required reply pattern missing: ${pattern}`);
	}
	for (const pattern of expect.requiredHighlightPatterns || []) {
		if (!highlightTexts.some((text) => regex(pattern, "im").test(text))) penalty(0.16, `required highlight pattern missing: ${pattern}`);
	}
	for (const entry of expect.conditionalHighlightPatterns || []) {
		if (!entry?.reply || !entry?.highlight) continue;
		if (regex(entry.reply, "im").test(reply) && !highlightTexts.some((text) => regex(entry.highlight, "im").test(text))) {
			penalty(0.12, `reply names unsupported item without matching highlight: ${entry.reply}`);
		}
	}
	if (metrics.highlightCount <= 1) {
		for (const pattern of expect.singleHighlightForbiddenReplyPatterns || []) {
			if (regex(pattern, "im").test(reply)) penalty(0.15, `one-highlight answer made unsupported broad claim: ${pattern}`);
		}
	}
	if (expect.maxMethodMentions != null && metrics.methodMentionCount > Number(expect.maxMethodMentions)) {
		penalty(0.1, `too many method mentions: ${metrics.methodMentionCount} > ${expect.maxMethodMentions}`);
	}
	if (expect.maxTotalToolDurationMs != null && metrics.toolDurationMs > Number(expect.maxTotalToolDurationMs)) {
		penalty(0.08, `tool time too high: ${metrics.toolDurationMs}ms > ${expect.maxTotalToolDurationMs}`, false);
	}
	const completedToolNames = allTools(turn)
		.filter((tool) => tool?.state === "complete")
		.map((tool) => String(tool?.toolName || ""));
	for (const pattern of expect.requiredToolPatterns || []) {
		if (!completedToolNames.some((name) => regex(pattern).test(name))) penalty(0.16, `required tool missing: ${pattern}`);
	}
	// A call a runtime guardrail blocked never touched the page: that is the
	// runtime enforcing the request, so it is a warning, not a violation.
	const guardBlockedTrace = (tool) => tool?.state === "error" && /guardrail blocked/i.test(String(tool?.resultSummary || tool?.error || ""));
	// Activities mirror traces under the same call id ("tool:<id>" vs the
	// trace's toolCallId) but carry no result text, so match blocks by id.
	const blockedCallIds = new Set((Array.isArray(turn?.toolTraces) ? turn.toolTraces : []).filter(guardBlockedTrace).map((tool) => String(tool?.toolCallId || "")));
	const guardBlocked = (tool) => guardBlockedTrace(tool) || blockedCallIds.has(String(tool?.toolCallId || String(tool?.id || "").replace(/^(?:tool|trace):/, "")));
	const ranToolNames = allTools(turn)
		.filter((tool) => !guardBlocked(tool))
		.map((tool) => String(tool?.toolName || ""));
	const blockedToolNames = allTools(turn)
		.filter(guardBlocked)
		.map((tool) => String(tool?.toolName || ""));
	for (const pattern of expect.forbiddenToolPatterns || []) {
		if (ranToolNames.some((name) => regex(pattern).test(name))) penalty(0.14, `forbidden tool used: ${pattern}`);
		else if (blockedToolNames.some((name) => regex(pattern).test(name))) penalty(0, `forbidden tool attempted but blocked by a guardrail: ${pattern}`, false);
	}
	if (expect.minAnnotatedTabs != null && metrics.annotatedTabCount < Number(expect.minAnnotatedTabs)) {
		penalty(0.16, `expected marks on at least ${expect.minAnnotatedTabs} tab(s), got ${metrics.annotatedTabCount}`);
	}
	if (expect.minSourceTabs != null && metrics.sourceTabCount < Number(expect.minSourceTabs)) {
		penalty(0.16, `expected at least ${expect.minSourceTabs} source tab(s), got ${metrics.sourceTabCount}`);
	}
	const minScore = Number(expect.minScore || DEFAULT_MIN_SCORE);
	score = Math.max(0, Math.min(1, Number(score.toFixed(3))));
	return {
		caseId: testCase.id,
		variantId: variant.id,
		status: !failures.length && score >= minScore ? "pass" : "fail",
		score,
		minScore,
		failures,
		warnings,
		metrics,
		reply,
		highlights: highlightTexts,
		notes: noteTexts,
		annotatedTabs,
		navigatedUrls,
		tools: allTools(turn).map((tool) => ({
			toolName: tool.toolName || "",
			state: tool.state || "",
			duration_ms: tool.duration_ms ?? null,
			error: tool.error || "",
		})),
	};
}

function shouldRetryBlankPageAnswer(evaluation) {
	const reply = String(evaluation?.reply || "");
	const failures = (evaluation?.failures || []).join("\n");
	return /model returned an empty answer after reading page context/i.test(`${reply}\n${failures}`);
}

function shouldRetryWeakNoSourceAnswer(evaluation) {
	const reply = String(evaluation?.reply || "").trim();
	const failures = (evaluation?.failures || []).join("\n");
	const highlightCount = Number(evaluation?.metrics?.highlightCount || 0);
	return (
		highlightCount === 0 &&
		(/^\(?No reply generated\.?\)?$/i.test(reply) || words(reply) <= 4) &&
		/(expected at least \d+ highlight|required reply pattern missing|required highlight pattern missing)/i.test(failures)
	);
}

// Voice checks on top of the normal turn evaluation. The spoken text is what
// Onhand hands Live (speechResult): the reply when it fits in 480 bytes, else
// its first paragraph, else a "see the sidebar" fallback — the fallback means
// the backend ignored the voice instruction to open with a self-contained
// spoken paragraph of at most 45 words.
const SPOKEN_FALLBACK_PATTERN = /^The answer is ready in the sidebar\./;
function applyVoiceChecks(evaluation, raw, testCase) {
	const voice = raw?.voice || {};
	const expect = testCase.expect || {};
	const failures = [...(evaluation.failures || [])];
	const warnings = [...(evaluation.warnings || [])];
	let score = Number(evaluation.score || 0);
	const fail = (amount, message) => { score -= amount; failures.push(message); };
	const spoken = String(voice.spoken || "");
	if (voice.engine === "live") {
		if (!spoken) fail(0.3, "voice: nothing was handed to Live to speak");
		else if (SPOKEN_FALLBACK_PATTERN.test(spoken)) fail(0.2, "voice: spoken text fell back to \"the answer is ready in the sidebar\" (no self-contained spoken opening under 480 bytes)");
		else if (words(spoken) > 60) warnings.push(`voice: spoken text is ${words(spoken)} words (target: an opening of at most 45)`);
		for (const pattern of expect.requiredSpokenPatterns || []) if (!regex(pattern).test(spoken)) fail(0.12, `voice: required spoken pattern missing: ${pattern}`);
		for (const pattern of expect.forbiddenSpokenPatterns || []) if (regex(pattern).test(spoken)) fail(0.16, `voice: forbidden spoken pattern present: ${pattern}`);
		if (voice.errors?.length) warnings.push(`voice: coordinator errors: ${voice.errors.join("; ")}`);
	}
	score = Math.max(0, score);
	const minScore = Number(evaluation.minScore || 0);
	return { ...evaluation, score, failures, warnings, status: failures.length || score < minScore ? "fail" : evaluation.status, voice: { engine: voice.engine, spoken } };
}

async function runOne(testCase, variant, args, runDir, rubric = "") {
	const cliArgs = [
		"ask-new-url",
		testCase.url,
		testCase.prompt,
		"--wait",
		"--timeout",
		testCase.timeout || args.timeout,
		"--json",
		"--full",
		...(args.voice ? ["--voice", args.voice] : ["--source", `prompt-eval:${variant.id}`]),
		"--eval-variant",
		variant.id,
	];
	if (testCase.learning) cliArgs.push("--learning");
	if (variant.systemAppend) cliArgs.push("--eval-system-append", variant.systemAppend);
	if (variant.launcherAppend) cliArgs.push("--eval-launcher-append", variant.launcherAppend);
	const startedAt = Date.now();
	const preexistingTabIds = await listContentTargetIds(args.host, args.port);
	let raw = null;
	let evaluation = null;
	try {
		for (const setupUrl of testCase.setupUrls || []) await runCli(["open-url", setupUrl, "--json"], args);
		// Let setup tabs finish loading before the primary tab opens and takes focus.
		if (testCase.setupUrls?.length) await sleep(3000);
		let retriedBlankAnswer = false;
		let retriedWeakNoSourceAnswer = false;
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const startedAt = Date.now();
			raw = await runCli(cliArgs, args);
			evaluation = evaluateTurn(raw, testCase, variant, Date.now() - startedAt);
			if (args.voice) evaluation = applyVoiceChecks(evaluation, raw, testCase);
			if (attempt === 0 && shouldRetryBlankPageAnswer(evaluation)) {
				retriedBlankAnswer = true;
				continue;
			}
			if (attempt === 0 && shouldRetryWeakNoSourceAnswer(evaluation)) {
				retriedWeakNoSourceAnswer = true;
				continue;
			}
			break;
		}
		if (retriedBlankAnswer && evaluation) {
			evaluation = {
				...evaluation,
				warnings: [...(evaluation.warnings || []), "retried once after empty answer following page read"],
			};
		}
		if (retriedWeakNoSourceAnswer && evaluation) {
			evaluation = {
				...evaluation,
				warnings: [...(evaluation.warnings || []), "retried once after no-source empty answer"],
			};
		}
		if (args.judge) {
			try {
				const judge = await runJudge({ args, rubric, testCase, variant, evaluation, raw });
				evaluation = applyJudgeResult(evaluation, judge, args);
			} catch (judgeError) {
				evaluation = {
					...evaluation,
					status: "fail",
					failures: [...evaluation.failures, `judge failed: ${judgeError.message}`],
					warnings: evaluation.warnings,
					judge: {
						verdict: "fail",
						score: 0,
						summary: `Judge failed: ${judgeError.message}`,
						issues: [{ severity: "blocking", area: "tooling", message: judgeError.message, evidence: "judge API" }],
						strengths: [],
						recommendations: ["Fix the judge configuration or rerun without --judge."],
						criteria: {},
						model: args.judgeModel,
						baseUrl: args.judgeBaseUrl,
					},
					mechanical: {
						status: evaluation.status,
						score: evaluation.score,
						failures: evaluation.failures,
						warnings: evaluation.warnings,
					},
				};
			}
		}
	} catch (error) {
		// A timed-out turn keeps running in the extension and would reject every
		// later case with "Wait for the current Onhand operation to finish".
		if (/Timed out waiting for request/i.test(error.message)) await runCli(["stop", "--json"], args).catch(() => {});
		evaluation = {
			caseId: testCase.id,
			variantId: variant.id,
			status: "fail",
			score: 0,
			minScore: Number(testCase.expect?.minScore || DEFAULT_MIN_SCORE),
			failures: [error.message],
			warnings: [],
			metrics: { elapsedMs: Date.now() - startedAt },
			reply: "",
			highlights: [],
			notes: [],
			tools: [],
		};
	}
	const safeName = `${safeId(testCase.id)}__${safeId(variant.id)}`;
	if (args.screenshots && raw?.turn) {
		try {
			evaluation = { ...evaluation, screenshots: await captureAnnotationScreenshots(raw.turn, args, runDir, safeName) };
		} catch (error) {
			evaluation = { ...evaluation, warnings: [...(evaluation.warnings || []), `screenshots failed: ${error.message}`] };
		}
	}
	// Follow-ups continue the same session (G18 anchor reuse, clarifications);
	// each turn is scored on its own expectations and any failure fails the case.
	const followUpRaws = [];
	for (const [index, followUp] of (raw?.turn && !evaluation.failures.length ? testCase.followUps || [] : []).entries()) {
		const label = `follow-up ${index + 1}`;
		let followUpEvaluation;
		try {
			const startedAt = Date.now();
			const followUpRaw = await runCli(["ask", followUp.prompt, "--wait", "--timeout", testCase.timeout || args.timeout, "--json", "--full", ...(args.voice ? ["--voice", args.voice] : [])], args);
			followUpRaws.push(followUpRaw);
			followUpEvaluation = evaluateTurn(followUpRaw, { ...testCase, prompt: followUp.prompt, expect: followUp.expect || {} }, variant, Date.now() - startedAt);
			if (args.voice) followUpEvaluation = applyVoiceChecks(followUpEvaluation, followUpRaw, { ...testCase, expect: followUp.expect || {} });
			if (args.screenshots && followUpRaw?.turn) {
				followUpEvaluation.screenshots = await captureAnnotationScreenshots(followUpRaw.turn, args, runDir, `${safeName}__followup${index + 1}`).catch(() => []);
			}
		} catch (error) {
			if (/Timed out waiting for request/i.test(error.message)) await runCli(["stop", "--json"], args).catch(() => {});
			followUpEvaluation = { status: "fail", score: 0, failures: [error.message], warnings: [], metrics: {}, reply: "", highlights: [], notes: [], tools: [] };
		}
		evaluation = {
			...evaluation,
			followUps: [...(evaluation.followUps || []), { prompt: followUp.prompt, ...followUpEvaluation }],
			failures: [...evaluation.failures, ...followUpEvaluation.failures.map((failure) => `${label}: ${failure}`)],
			status: evaluation.status === "pass" && followUpEvaluation.status === "pass" ? "pass" : "fail",
			score: Math.min(evaluation.score, followUpEvaluation.score),
		};
	}
	await writeFile(join(runDir, `${safeName}.json`), JSON.stringify({ case: testCase, variant, evaluation, raw, followUpRaws }, null, 2));
	if (!args.keepTabs) {
		await closeContentTabs(args.host, args.port, preexistingTabIds);
	}
	return evaluation;
}

function safeId(value) {
	return String(value || "item").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "item";
}

function summarizeVariants(results) {
	const byVariant = new Map();
	for (const result of results) {
		const entry = byVariant.get(result.variantId) || { variantId: result.variantId, runs: 0, passes: 0, score: 0, elapsedMs: 0, judgeRuns: 0, judgeScore: 0 };
		entry.runs += 1;
		entry.passes += result.status === "pass" ? 1 : 0;
		entry.score += result.score;
		entry.elapsedMs += Number(result.metrics?.elapsedMs || 0);
		if (result.judge) {
			entry.judgeRuns += 1;
			entry.judgeScore += Number(result.judge.score || 0);
		}
		byVariant.set(result.variantId, entry);
	}
	return [...byVariant.values()]
		.map((entry) => ({
			...entry,
			averageScore: Number((entry.score / Math.max(1, entry.runs)).toFixed(3)),
			averageJudgeScore: entry.judgeRuns ? Number((entry.judgeScore / entry.judgeRuns).toFixed(3)) : null,
			passRate: Number((entry.passes / Math.max(1, entry.runs)).toFixed(3)),
			averageElapsedMs: Math.round(entry.elapsedMs / Math.max(1, entry.runs)),
		}))
		.sort((left, right) => right.averageScore - left.averageScore || right.passRate - left.passRate || left.averageElapsedMs - right.averageElapsedMs);
}

function markdownReport(plan, results, variantSummary) {
	const lines = [
		"# Page Prompt Eval",
		"",
		`Run: ${plan.runId}`,
		...(plan.model ? [`Model: ${plan.model}`] : []),
		`Cases: ${plan.cases.length}`,
		`Variants: ${plan.variants.length}`,
		"",
		"## Variants",
		"",
		"| Variant | Runs | Pass | Avg Score | Avg Time |",
		"| --- | ---: | ---: | ---: | ---: |",
	];
	for (const entry of variantSummary) {
		lines.push(`| ${entry.variantId} | ${entry.runs} | ${entry.passes}/${entry.runs} | ${entry.averageScore.toFixed(3)} | ${entry.averageElapsedMs}ms |`);
	}
	lines.push("", "## Cases", "", "| Case | Variant | Status | Score | Judge | Highlights | Notes | Marked Tabs | Navigations | Words | Failures |", "| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |");
	for (const result of results) {
		const judgeCell = result.judge ? `${result.judge.verdict} ${Number(result.judge.score || 0).toFixed(2)}${result.judge.summary ? `<br>${result.judge.summary.replace(/\|/g, "\\|")}` : ""}` : "";
		lines.push(
			`| ${result.caseId} | ${result.variantId} | ${result.status} | ${result.score.toFixed(3)} | ${judgeCell} | ${result.metrics?.highlightCount ?? 0} | ${result.metrics?.noteCount ?? 0} | ${result.metrics?.annotatedTabCount ?? 0} | ${result.metrics?.navigationCount ?? 0} | ${result.metrics?.replyWordCount ?? 0} | ${result.failures.map((item) => item.replace(/\|/g, "\\|")).join("<br>") || ""} |`,
		);
	}
	lines.push("", "## Details", "");
	for (const result of results) {
		const testCase = plan.cases.find((entry) => entry.id === result.caseId);
		lines.push(`### ${result.caseId} / ${result.variantId}`, "");
		if (testCase) lines.push(`Prompt: ${testCase.prompt}`, `URL: ${testCase.url}${testCase.setupUrls?.length ? ` (also open: ${testCase.setupUrls.join(", ")})` : ""}`, "");
		lines.push("Reply:", "", ...String(result.reply || "(none)").split("\n").map((line) => `> ${line}`), "");
		if (result.voice) lines.push(`Spoken (${result.voice.engine}):`, "", `> ${result.voice.spoken || "(nothing)"}`, "");
		if (result.highlights?.length) lines.push("Highlights:", ...result.highlights.map((text) => `- ${String(text).split("\n")[0]}`), "");
		if (result.notes?.length) lines.push("Notes:", ...result.notes.map((text) => `- ${text}`), "");
		if (result.annotatedTabs?.length) lines.push(`Marked tabs: ${result.annotatedTabs.map((tab) => `${tab.url} (${tab.marks})`).join(", ")}`, "");
		if (result.navigatedUrls?.length) lines.push(`Navigated to: ${result.navigatedUrls.join(", ")}`, "");
		for (const [index, followUp] of (result.followUps || []).entries()) {
			lines.push(`Follow-up ${index + 1}: ${followUp.prompt}`, "", ...String(followUp.reply || "(none)").split("\n").map((line) => `> ${line}`), "");
			if (followUp.highlights?.length) lines.push("Follow-up highlights:", ...followUp.highlights.map((text) => `- ${String(text).split("\n")[0]}`), "");
		}
		const shots = (result.screenshots || []).filter((shot) => shot.file);
		if (shots.length) lines.push("Screenshots:", ...shots.map((shot) => `- ${shot.file}`), "");
	}
	const judged = results.filter((result) => result.judge);
	if (judged.length) {
		lines.push("", "## Judge Notes", "");
		for (const result of judged) {
			lines.push(`### ${result.caseId} / ${result.variantId}`);
			lines.push("");
			lines.push(`Verdict: ${result.judge.verdict} (${Number(result.judge.score || 0).toFixed(3)})`);
			if (result.judge.summary) lines.push(`Summary: ${result.judge.summary}`);
			if (result.judge.issues?.length) {
				lines.push("Issues:");
				for (const issue of result.judge.issues) {
					lines.push(`- ${issue.severity || "minor"} ${issue.area || "answer"}: ${issue.message || ""}${issue.evidence ? ` Evidence: ${issue.evidence}` : ""}`);
				}
			}
			if (result.judge.recommendations?.length) {
				lines.push("Recommendations:");
				for (const item of result.judge.recommendations) lines.push(`- ${item}`);
			}
			lines.push("");
		}
	}
	lines.push("", "## Best Variant", "");
	const best = variantSummary[0];
	lines.push(best ? `Best current variant: \`${best.variantId}\` (avg score ${best.averageScore.toFixed(3)}, pass rate ${(best.passRate * 100).toFixed(0)}%).` : "No variants ran.");
	return `${lines.join("\n")}\n`;
}

// Cases may point at local fixture pages (http://127.0.0.1:8765/...). Start
// the fixture server for the run unless one is already listening.
async function ensureFixtureServerForCases(cases) {
	const fixtureUrls = cases
		.flatMap((testCase) => [testCase.url, ...(Array.isArray(testCase.setupUrls) ? testCase.setupUrls : [])])
		.filter((value) => /^http:\/\/127\.0\.0\.1:8765\//.test(String(value || "")));
	if (!fixtureUrls.length) return null;
	const alreadyRunning = await fetch("http://127.0.0.1:8765/health").then((response) => response.ok).catch(() => false);
	if (alreadyRunning) return null;
	const { startFixtureServer } = await import("./serve-browser-runtime-fixture.mjs");
	const started = await startFixtureServer({ host: "127.0.0.1", port: 8765 });
	console.log("page-prompt-eval: started the local fixture server on 127.0.0.1:8765");
	return started;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.listCases) {
		for (const testCase of BUILTIN_CASES) console.log(`${testCase.id}\t${testCase.url}\t${testCase.prompt}`);
		return;
	}
	const { cases, variants } = await loadCases(args);
	const runId = new Date().toISOString().replace(/[:.]/g, "-");
	const runDir = args.outDir || join(DEFAULT_OUT_DIR, runId);
	const plan = {
		runId,
		host: args.host,
		port: args.port,
		timeout: args.timeout,
		cases,
		variants,
		judge: args.judge
			? {
					model: args.judgeModel,
					baseUrl: args.judgeBaseUrl,
					apiKeyEnv: args.judgeApiKeyEnv,
					minScore: args.judgeMinScore,
					exportOk: args.judgeExportOk,
			  }
			: null,
	};
	if (args.dryRun) {
		const summary = { dryRun: true, plan };
		if (args.json) console.log(JSON.stringify(summary, null, 2));
		else {
			console.log(`Dry run: ${cases.length} case(s), ${variants.length} variant(s)`);
			for (const testCase of cases) console.log(`- case ${testCase.id}: ${testCase.url}`);
			for (const variant of variants) console.log(`- variant ${variant.id}${variant.systemAppend ? " +system" : ""}${variant.launcherAppend ? " +launcher" : ""}`);
		}
		return;
	}
	await mkdir(runDir, { recursive: true });
	const fixtureServer = await ensureFixtureServerForCases(cases);
	const switched = args.model ? await setOnhandModel(args, args.model) : null;
	if (switched) plan.model = `${switched.provider}/${args.model}`;
	await writeFile(join(runDir, "plan.json"), JSON.stringify(plan, null, 2));
	const rubric = args.judge ? await loadJudgeRubric() : "";
	const results = [];
	try {
		for (const variant of variants) {
			for (const testCase of cases) {
				const result = await runOne(testCase, variant, args, runDir, rubric);
				results.push(result);
				const status = result.status === "pass" ? "PASS" : "FAIL";
				const judgeText = result.judge ? ` judge=${result.judge.verdict}:${Number(result.judge.score || 0).toFixed(2)}` : "";
				console.log(`${status} ${testCase.id} / ${variant.id} score=${result.score.toFixed(3)}${judgeText} highlights=${result.metrics?.highlightCount ?? 0} notes=${result.metrics?.noteCount ?? 0} tabs=${result.metrics?.annotatedTabCount ?? 0} nav=${result.metrics?.navigationCount ?? 0} words=${result.metrics?.replyWordCount ?? 0}`);
			}
		}
	} finally {
		// The user's previous model may be a custom id the provider list omits.
		if (switched && switched.previousModel !== args.model) await setOnhandModel(args, switched.previousModel, { requireOffered: false });
		await new Promise((resolve) => (fixtureServer ? fixtureServer.server.close(resolve) : resolve()));
	}
	const variantSummary = summarizeVariants(results);
	const summary = { plan: { ...plan, cases: cases.map((testCase) => testCase.id), variants: variants.map((variant) => variant.id) }, results, variantSummary };
	await writeFile(join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
	await writeFile(join(runDir, "report.md"), markdownReport(plan, results, variantSummary));
	if (args.json) console.log(JSON.stringify(summary, null, 2));
	else {
		console.log(`\nReport: ${join(runDir, "report.md")}`);
		if (variantSummary[0]) console.log(`Best variant: ${variantSummary[0].variantId} score=${variantSummary[0].averageScore.toFixed(3)}`);
	}
	assert.ok(results.every((result) => result.status === "pass"), `Page prompt eval failed. See ${join(runDir, "report.md")}`);
}

main().catch((error) => {
	console.error(`page-prompt-eval: ${error.message}`);
	process.exitCode = 1;
});
