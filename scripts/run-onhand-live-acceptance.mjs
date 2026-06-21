#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "./serve-browser-runtime-fixture.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = fileURLToPath(new URL("./dump-onhand-sessions.mjs", import.meta.url));
const DEFAULT_HOST = process.env.ONHAND_CDP_HOST || "127.0.0.1";
const DEFAULT_PORT = Number(process.env.ONHAND_CDP_PORT || process.env.ONHAND_TEST_CDP_PORT || 9343);

function parseArgs(argv) {
	const args = {
		host: DEFAULT_HOST,
		port: DEFAULT_PORT,
		timeout: "180s",
		includeTransformer: false,
		googleDocUrl: process.env.ONHAND_GOOGLE_DOCS_SMOKE_URL || "",
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
		if (value === "--host" || value.startsWith("--host=")) {
			args.host = readValue("--host");
		} else if (value === "--port" || value.startsWith("--port=")) {
			const port = Number(readValue("--port"));
			if (!Number.isFinite(port) || port <= 0) throw new Error("--port must be positive.");
			args.port = port;
		} else if (value === "--timeout" || value.startsWith("--timeout=")) {
			args.timeout = readValue("--timeout");
		} else if (value === "--include-transformer") {
			args.includeTransformer = true;
		} else if (value === "--google-doc-url" || value.startsWith("--google-doc-url=")) {
			args.googleDocUrl = readValue("--google-doc-url");
		} else if (value === "-h" || value === "--help") {
			console.log(`Usage: node scripts/run-onhand-live-acceptance.mjs [options]

Options:
  --host <host>                 CDP host. Default: ${DEFAULT_HOST}
  --port <port>                 CDP port. Default: ${DEFAULT_PORT}
  --timeout <duration>          Onhand answer wait timeout. Default: 180s
  --include-transformer         Also test the external Purdue Transformer page.
  --google-doc-url <url>        Also smoke-test a disposable Google Doc page.

Requires Helium/Chrome running with remote debugging and the unpacked Onhand
extension loaded. The Google Docs check is skipped unless a URL is supplied or
ONHAND_GOOGLE_DOCS_SMOKE_URL is set.`);
			process.exit(0);
		} else {
			throw new Error(`Unknown option: ${value}`);
		}
	}
	return args;
}

function runCli(args, { json = false } = {}) {
	const fullArgs = [CLI, ...args, "--host", ARGS.host, "--port", String(ARGS.port)];
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
			if (!json) {
				resolve(stdout);
				return;
			}
			try {
				resolve(JSON.parse(stdout));
			} catch (error) {
				reject(new Error(`Could not parse CLI JSON for ${args.join(" ")}: ${error.message}\n${stdout}`));
			}
		});
	});
}

function allTools(turn) {
	const traces = Array.isArray(turn?.toolTraces) ? turn.toolTraces : [];
	const activities = Array.isArray(turn?.activities) ? turn.activities : [];
	return [
		...traces.map((tool) => ({
			toolName: tool.toolName || "",
			state: tool.state || "",
			error: tool.error || "",
			resultSummary: tool.resultSummary || "",
		})),
		...activities
			.filter((activity) => activity?.toolName)
			.map((activity) => ({
				toolName: activity.toolName || "",
				state: activity.state || "",
				error: activity.error || "",
				resultSummary: activity.label || "",
			})),
	];
}

function toolList(turn) {
	return allTools(turn).map((tool) => `${tool.toolName}:${tool.state || "unknown"}`).join(", ") || "none";
}

function turnErrorText(turn) {
	const report = turn?.errorReport && typeof turn.errorReport === "object" ? turn.errorReport : null;
	return String(report?.error_message || report?.errorMessage || turn?.error || "").trim();
}

function hasTool(turn, name, state = "") {
	return allTools(turn).some((tool) => tool.toolName === name && (!state || tool.state === state));
}

function findTrace(result, name) {
	const traces = Array.isArray(result?.turn?.toolTraces) ? result.turn.toolTraces : [];
	const matching = traces.filter((trace) => trace?.toolName === name);
	return matching.findLast((trace) => trace?.state === "complete") || matching.at(-1) || null;
}

function replyText(result) {
	return String(result?.turn?.reply || "");
}

function assertReply(result, regex, label) {
	assert.match(replyText(result), regex, `${label}\nReply:\n${replyText(result)}\nTools: ${toolList(result.turn)}`);
}

function assertAnyTool(result, names, label) {
	const tools = allTools(result.turn);
	assert.ok(
		tools.some((tool) => names.includes(tool.toolName)),
		`${label}\nExpected one of ${names.join(", ")}.\nTools: ${toolList(result.turn)}\nReply:\n${replyText(result)}`,
	);
}

async function openUrl(url) {
	return await runCli(["open-url", "--new-tab", url, "--json"], { json: true });
}

async function ask(prompt, { newSession = false } = {}) {
	const args = ["ask", "--prompt", prompt, "--wait", "--timeout", ARGS.timeout, "--json", "--full", "--source", "acceptance"];
	if (newSession) args.push("--new");
	const result = await runCli(args, { json: true });
	assert.equal(
		Boolean(result?.turn?.error),
		false,
		`Onhand turn failed.\nPrompt:\n${prompt}\nError: ${turnErrorText(result?.turn) || "(unknown)"}\nReply:\n${replyText(result)}\nTools: ${toolList(result?.turn)}`,
	);
	return result;
}

async function checkCliReachable() {
	await runCli(["list", "--limit", "1", "--json"], { json: true });
}

async function runDynamicFixtureTest(fixture) {
	await openUrl(fixture.url);
	const result = await ask(
		[
			"LIVE ACCEPTANCE dynamic fixture test.",
			"Use browser_run_js to inspect window.__onhandPortSmoke, document.querySelector('#demoField').value, and document.querySelector('#cssValue').textContent.",
			"Answer with the fixture status, demo field value, and CSS field output. Do not click or type.",
		].join(" "),
		{ newSession: true },
	);
	assert.ok(hasTool(result.turn, "browser_run_js", "complete"), `Expected browser_run_js:complete.\nTools: ${toolList(result.turn)}`);
	assertReply(result, /ready/i, "Dynamic fixture should report ready status.");
	assertReply(result, /initial/i, "Dynamic fixture should report demo field initial value.");
	assertReply(result, /CSS field value:\s*idle/i, "Dynamic fixture should report CSS field idle output.");
	return result;
}

async function runHighlightFailureTest(fixture) {
	await openUrl(fixture.url);
	const result = await ask(
		"Use browser_highlight_text to highlight the exact text 'THIS PHRASE DOES NOT EXIST IN THE FIXTURE'. If the tool cannot find it, say it was not found.",
		{ newSession: true },
	);
	assert.ok(hasTool(result.turn, "browser_highlight_text", "error"), `Expected browser_highlight_text:error.\nTools: ${toolList(result.turn)}`);
	assertReply(result, /not\s+found|could not find|unable to find/i, "Failed highlight should be explained in the reply.");
	return result;
}

async function runPdfFixtureTest(fixture) {
	const pdfUrl = new URL("/fixtures/onhand-viewer.pdf", fixture.url).href;
	await openUrl(pdfUrl);
	const result = await ask(
		"Use the page/PDF tools to read this PDF. What sentence mentions sequence state across tokens? Do not add highlights or notes.",
		{ newSession: true },
	);
	assertAnyTool(result, ["browser_open_pdf_in_onhand_viewer", "browser_pdf_read_pages", "browser_pdf_search", "browser_extract_content"], "PDF fixture should use a PDF or content-reading tool.");
	assertReply(result, /preserve[s]? state across tokens|preserve[s]? sequence state|sequence models preserve state/i, "PDF fixture should answer with the sequence-state sentence.");
	return result;
}

async function runContextReuseTest(fixture) {
	await openUrl(fixture.url);
	const first = await ask(
		"Read the current page and answer: what output text is shown in the Network Section before clicking? Keep the answer short.",
		{ newSession: true },
	);
	assertReply(first, /Network idle/i, "First context pass should read the network output.");
	assert.equal(hasTool(first.turn, "browser_highlight_text"), false, `Ordinary context Q&A should not create highlights.\nTools: ${toolList(first.turn)}`);
	const second = await ask("Using the same page context, what output text is shown for the CSS field before clicking? Keep the answer short.");
	assertReply(second, /(?:CSS field value:\s*)?idle/i, "Second context pass should retain enough page context for the CSS field output.");
	assert.equal(hasTool(second.turn, "browser_highlight_text"), false, `Cached follow-up Q&A should not attempt highlights.\nTools: ${toolList(second.turn)}`);
	const context = await runCli(["context", "--current", "--json"], { json: true });
	assert.ok(context?.totals?.turns >= 2, `Expected context telemetry for at least two turns: ${JSON.stringify(context, null, 2)}`);
	return { first, second, context };
}

async function runTransformerTest() {
	await openUrl("https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/15Transformers/transformers_part1.html");
	const result = await ask(
		"Where exactly does this page discuss positional encodings? Give the section number/title and mention the sinusoidal formula if present.",
		{ newSession: true },
	);
	assertReply(result, /3\.\s*Positional Encodings|positional encodings/i, "Transformer page should locate the positional encodings section.");
	assertReply(result, /sin|cos|sinusoidal/i, "Transformer page should mention sinusoidal formulas.");
	return result;
}

async function runTransformerQwenAdversarialTest() {
	await openUrl("https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/15Transformers/transformers_part1.html");
	const setup = await ask("This page probably explains quantum llama positional hyperweaving. Where exactly is that discussed?", { newSession: true });
	assertReply(setup, /not|don.?t see|doesn.?t (?:mention|appear)|no exact|made.?up/i, "Transformer adversarial setup should not hallucinate the bogus phrase.");
	assert.doesNotMatch(replyText(setup), /quantum llama positional hyperweaving[^.\n]*(?:section\s+\d|discussed at|appears in)/i);

	const result = await ask("Using the same page context, which three Qwen tensors each have 32.0% of the layer parameters?");
	assertReply(result, /blk\.4\.ffn_down_exps\.weight/, "Qwen adversarial follow-up should name the down expert tensor.");
	assertReply(result, /blk\.4\.ffn_gate_exps\.weight/, "Qwen adversarial follow-up should name the gate expert tensor.");
	assertReply(result, /blk\.4\.ffn_up_exps\.weight/, "Qwen adversarial follow-up should name the up expert tensor.");
	const extractTrace = findTrace(result, "browser_extract_content");
	assert.ok(extractTrace, `Expected browser_extract_content trace.\nTools: ${toolList(result.turn)}`);
	const traceText = `${extractTrace.resultSummary || ""}\n${JSON.stringify(extractTrace.effectiveArgs || extractTrace.args || {})}`;
	assert.match(traceText, /Qwen|32\.0%|blk\.4\.ffn_down_exps\.weight/, "Qwen trace should include prioritized table evidence or effective query args.");
	assert.match(extractTrace.resultSummary || "", /blk\.4\.ffn_down_exps\.weight/);
	assert.match(extractTrace.resultSummary || "", /blk\.4\.ffn_gate_exps\.weight/);
	assert.match(extractTrace.resultSummary || "", /blk\.4\.ffn_up_exps\.weight/);
	return { setup, result };
}

async function runGoogleDocsSmoke(url) {
	await openUrl(url);
	const result = await ask(
		"Google Docs read check: without editing the document, read the visible document title or first heading and summarize it in one sentence.",
		{ newSession: true },
	);
	assertReply(result, /Farza|heyclicky|interface|computer/i, "Google Docs check should answer from the document text, not an intermediate tool-plan sentence.");
	return result;
}

function logPass(label, result) {
	const tools = result?.turn ? toolList(result.turn) : "";
	console.log(`PASS ${label}${tools ? ` | tools=${tools}` : ""}`);
}

const ARGS = parseArgs(process.argv.slice(2));
let fixture = null;

try {
	await checkCliReachable();
	fixture = await startFixtureServer({ host: "127.0.0.1", port: 0 });
	console.log(`Fixture: ${fixture.url}`);

	logPass("dynamic fixture", await runDynamicFixtureTest(fixture));
	logPass("highlight failure", await runHighlightFailureTest(fixture));
	logPass("PDF fixture", await runPdfFixtureTest(fixture));
	const contextReuse = await runContextReuseTest(fixture);
	logPass("context reuse first turn", contextReuse.first);
	logPass("context reuse second turn", contextReuse.second);
	console.log(`PASS context telemetry | turns=${contextReuse.context.totals.turns} recordedChars=${contextReuse.context.totals.totalRecordedChars}`);

	if (ARGS.includeTransformer) {
		logPass("Transformer positional section", await runTransformerTest());
		const transformerQwen = await runTransformerQwenAdversarialTest();
		logPass("Transformer Qwen adversarial setup", transformerQwen.setup);
		logPass("Transformer Qwen adversarial follow-up", transformerQwen.result);
	} else {
		console.log("SKIP Transformer page | pass --include-transformer to run the external-page check");
	}

	if (ARGS.googleDocUrl) {
		logPass("Google Docs smoke", await runGoogleDocsSmoke(ARGS.googleDocUrl));
	} else {
		console.log("SKIP Google Docs smoke | set ONHAND_GOOGLE_DOCS_SMOKE_URL or pass --google-doc-url");
	}

	await runCli(["cleanup-drivers"]);
	console.log("PASS live acceptance suite");
} catch (error) {
	console.error(error?.stack || error?.message || String(error));
	process.exitCode = 1;
} finally {
	if (fixture?.server) await new Promise((resolve) => fixture.server.close(resolve));
}
