#!/usr/bin/env node
// Runs the voice eval suite (evals/voice/cases.json): one real Live call per
// case through scripts/run-live-voice-call.mjs, scoring whether Live handed
// each turn to the backend or answered it itself, as the case expects.
//
// --baseline <git-ref> also runs the cases with Live's instructions from that
// ref (packages/browser-extension/live-voice.js only), alternating with the
// working copy, so an instruction change can be compared old against new.
// The working copy is always restored, and the extension reloaded.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIVE_VOICE = "packages/browser-extension/live-voice.js";

function usage() {
	return `Usage: npm run eval:voice -- [options]

Options:
  --cases-file <path>   Default: evals/voice/cases.json
  --case <id>           Run only this case (repeatable)
  --reps <n>            Calls per case and variant. Default: 1
  --baseline <git-ref>  Also run Live's instructions from this ref, alternating
  --max-seconds <n>     Hard cap per call. Default: 360
  --out <file.jsonl>    Append raw per-call results here
  --json                Print the summary as JSON
  --port <port>         Browser remote-debugging port (passed to the call script)
  --host <host>

Each case is one paid Live call. Learning mode is switched on only for cases
that set learningMode, then restored.`;
}

function parseArgs(argv) {
	const args = { casesFile: "evals/voice/cases.json", cases: [], reps: 1, baseline: "", maxSeconds: 360, out: "", json: false, port: "", host: "" };
	for (let index = 0; index < argv.length; index++) {
		const raw = argv[index];
		const [flag, inline] = raw.startsWith("--") && raw.includes("=") ? [raw.slice(0, raw.indexOf("=")), raw.slice(raw.indexOf("=") + 1)] : [raw, undefined];
		const value = () => {
			if (inline !== undefined) return inline;
			if (index + 1 >= argv.length) throw new Error(`${flag} needs a value.`);
			return argv[++index];
		};
		if (flag === "-h" || flag === "--help") { console.log(usage()); process.exit(0); }
		else if (flag === "--cases-file") args.casesFile = value();
		else if (flag === "--case") args.cases.push(value());
		else if (flag === "--reps") args.reps = Number(value());
		else if (flag === "--baseline") args.baseline = value();
		else if (flag === "--max-seconds") args.maxSeconds = Number(value());
		else if (flag === "--out") args.out = value();
		else if (flag === "--json") args.json = true;
		else if (flag === "--port") args.port = value();
		else if (flag === "--host") args.host = value();
		else throw new Error(`Unknown option: ${raw}`);
	}
	if (!(Number.isInteger(args.reps) && args.reps > 0)) throw new Error("--reps must be a positive integer.");
	if (!(args.maxSeconds > 0)) throw new Error("--max-seconds must be positive.");
	return args;
}

const run = (args, timeoutMs = 120000) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });

function main() {
	const args = parseArgs(process.argv.slice(2));
	const browserArgs = [...(args.port ? ["--port", args.port] : []), ...(args.host ? ["--host", args.host] : [])];
	const log = args.json ? () => {} : (...parts) => console.log(...parts);
	const suite = JSON.parse(readFileSync(path.resolve(ROOT, args.casesFile), "utf8"));
	const cases = args.cases.length ? suite.cases.filter((c) => args.cases.includes(c.id)) : suite.cases;
	const unknown = args.cases.filter((id) => !suite.cases.some((c) => c.id === id));
	if (unknown.length) throw new Error(`Unknown case: ${unknown.join(", ")}`);

	const reload = () => {
		const result = run(["scripts/reload-onhand-extension.mjs", ...(args.port ? [`--port=${args.port}`] : []), ...(args.host ? [`--host=${args.host}`] : [])]);
		if (result.status !== 0) throw new Error(`Extension reload failed: ${(result.stderr || result.stdout).trim()}`);
		spawnSync("sleep", ["4"]);
	};
	const learningMode = (mode) => {
		const result = run(["scripts/dump-onhand-sessions.mjs", "learning-mode", mode, ...browserArgs]);
		if (result.status !== 0) throw new Error(`learning-mode ${mode} failed: ${(result.stderr || result.stdout).trim()}`);
		return /Learning Mode:\s*ON/i.test(result.stdout);
	};

	const workingCopy = readFileSync(path.join(ROOT, LIVE_VOICE), "utf8");
	let baselineCopy = "";
	if (args.baseline) {
		const shown = spawnSync("git", ["show", `${args.baseline}:${LIVE_VOICE}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
		if (shown.status !== 0) throw new Error(`Could not read ${LIVE_VOICE} at ${args.baseline}: ${shown.stderr.trim()}`);
		baselineCopy = shown.stdout;
		if (baselineCopy === workingCopy) throw new Error(`${LIVE_VOICE} is identical at ${args.baseline}; nothing to compare.`);
	}
	let swapped = false;
	const restore = () => {
		if (!swapped) return;
		writeFileSync(path.join(ROOT, LIVE_VOICE), workingCopy);
		swapped = false;
		try { reload(); } catch (error) { console.error(`Restored ${LIVE_VOICE}, but the reload failed: ${error.message}`); }
	};
	const learningWasOn = learningMode("status");
	process.once("SIGINT", () => { restore(); try { learningMode(learningWasOn ? "on" : "off"); } catch {} process.exit(130); });

	const calls = [];
	try {
		for (let rep = 1; rep <= args.reps; rep++) {
			const variants = args.baseline ? (rep % 2 ? ["baseline", "current"] : ["current", "baseline"]) : ["current"];
			for (const variant of variants) {
				if (args.baseline) {
					writeFileSync(path.join(ROOT, LIVE_VOICE), variant === "baseline" ? baselineCopy : workingCopy);
					swapped = variant === "baseline";
					reload();
				}
				for (const testCase of cases) {
					const callArgs = ["scripts/run-live-voice-call.mjs", "--json", "--url", testCase.url, "--max-seconds", String(args.maxSeconds), ...browserArgs];
					for (const turn of testCase.turns) callArgs.push("--question", turn.say);
					const wantLearning = Boolean(testCase.learningMode);
					if (wantLearning !== learningWasOn) learningMode(wantLearning ? "on" : "off");
					let report = null;
					let error = "";
					try {
						const result = run(callArgs, (args.maxSeconds + 120) * 1000);
						try { report = JSON.parse(result.stdout); } catch { error = (result.stderr || result.stdout || "no output").trim().slice(-400); }
					} finally {
						if (wantLearning !== learningWasOn) learningMode(learningWasOn ? "on" : "off");
					}
					const turns = (report?.questions || []).map((q, i) => ({
						say: testCase.turns[i].say,
						expect: testCase.turns[i].expect,
						got: q.delegated ? "handoff" : "live",
						heard: q.heard,
						retried: q.retried,
						spoken: q.spoken,
						answerSpoken: q.answerSpoken,
						speechProblems: q.speechProblems,
					}));
					const call = { variant, rep, case: testCase.id, error, hitCap: Boolean(report?.hitCap), elapsedSeconds: report?.elapsedSeconds ?? null, turns };
					calls.push(call);
					if (args.out) appendFileSync(path.resolve(ROOT, args.out), `${JSON.stringify(call)}\n`);
					const matched = turns.filter((t) => t.heard && t.got === t.expect).length;
					log(`${variant.padEnd(8)} rep ${rep} ${testCase.id.padEnd(26)} ${error ? `ERROR ${error.replace(/\s+/g, " ").slice(0, 140)}` : `${matched}/${testCase.turns.length} as expected${call.hitCap ? " (hit cap)" : ""} · ${call.elapsedSeconds}s`}`);
				}
			}
		}
	} finally {
		restore();
	}

	const summary = {};
	for (const variant of args.baseline ? ["baseline", "current"] : ["current"]) {
		const variantCalls = calls.filter((c) => c.variant === variant);
		const turns = variantCalls.flatMap((c) => c.turns.map((t) => ({ ...t, case: c.case, rep: c.rep })));
		const heard = turns.filter((t) => t.heard);
		const handoffs = heard.filter((t) => t.expect === "handoff");
		const keeps = heard.filter((t) => t.expect === "live");
		const delegated = heard.filter((t) => t.got === "handoff");
		const missingTurns = variantCalls.reduce((n, c) => n + (cases.find((x) => x.id === c.case).turns.length - c.turns.length), 0);
		summary[variant] = {
			calls: variantCalls.length,
			errors: variantCalls.filter((c) => c.error).map((c) => ({ case: c.case, rep: c.rep, error: c.error })),
			unheard: turns.filter((t) => !t.heard).length + missingTurns,
			retried: turns.filter((t) => t.retried).length,
			handoffsAsExpected: [handoffs.filter((t) => t.got === "handoff").length, handoffs.length],
			keptByLiveAsExpected: [keeps.filter((t) => t.got === "live").length, keeps.length],
			handoffAnswersSpoken: [delegated.filter((t) => t.answerSpoken).length, delegated.length],
			speechProblems: heard.filter((t) => t.speechProblems?.length).map((t) => ({ case: t.case, say: t.say, problems: t.speechProblems })),
			misses: heard.filter((t) => t.got !== t.expect).map((t) => ({ case: t.case, rep: t.rep, say: t.say, expect: t.expect, got: t.got, spoken: t.spoken })),
		};
	}
	const current = summary.current;
	const ok = !current.errors.length && !current.unheard && !current.misses.length && current.handoffAnswersSpoken[0] === current.handoffAnswersSpoken[1];
	if (args.json) {
		console.log(JSON.stringify({ ok, summary, calls }, null, 2));
	} else {
		const ratio = ([a, b]) => `${a}/${b}`;
		for (const [variant, s] of Object.entries(summary)) {
			console.log(`\n${variant}${variant === "baseline" ? ` (${args.baseline})` : ""}: ${s.calls} calls`);
			console.log(`  handed to the backend when expected: ${ratio(s.handoffsAsExpected)}`);
			console.log(`  answered by Live when expected:      ${ratio(s.keptByLiveAsExpected)}`);
			console.log(`  handoff answers spoken:              ${ratio(s.handoffAnswersSpoken)}`);
			if (s.unheard || s.retried) console.log(`  unheard turns: ${s.unheard}; asked twice: ${s.retried}`);
			for (const m of s.misses) console.log(`  MISS ${m.case} (rep ${m.rep}) "${m.say}": expected ${m.expect}, got ${m.got}. Live said: ${String(m.spoken || "").slice(0, 160)}`);
			for (const p of s.speechProblems) console.log(`  SPEECH ${p.case} "${p.say}": ${p.problems.join(", ")}`);
			for (const e of s.errors) console.log(`  ERROR ${e.case} (rep ${e.rep}): ${e.error.replace(/\s+/g, " ").slice(0, 200)}`);
		}
		console.log(`\n${ok ? "PASS" : "FAIL"}`);
	}
	process.exitCode = ok ? 0 : 1;
}

try {
	main();
} catch (error) {
	console.error(error.message || error);
	process.exitCode = 1;
}
