#!/usr/bin/env node

import process from "node:process";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_PASS_SCORE,
	loadTrajectorySuite,
	loadTrajectoryTraces,
	scoreTrajectory,
	summarizeTrajectoryResults,
} from "./lib/agent-trajectory-eval.mjs";

const DEFAULT_SUITE = fileURLToPath(new URL("../evals/agent-trajectories/cases.json", import.meta.url));

function parseArgs(argv) {
	const args = {
		caseIds: [],
		json: false,
		listCases: false,
		passScore: DEFAULT_PASS_SCORE,
		profiles: [],
		suitePath: DEFAULT_SUITE,
		tracePath: "",
	};
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		const readValue = (name) => {
			const inline = value.startsWith(`${name}=`) ? value.slice(name.length + 1) : "";
			if (inline) return inline;
			const next = argv[index + 1];
			if (!next || next.startsWith("-")) throw new Error(`${name} requires a value`);
			index += 1;
			return next;
		};
		if (value === "--help" || value === "-h") {
			printUsage();
			process.exit(0);
		} else if (value === "--json") {
			args.json = true;
		} else if (value === "--list-cases") {
			args.listCases = true;
		} else if (value === "--case" || value.startsWith("--case=")) {
			args.caseIds.push(readValue("--case"));
		} else if (value === "--profile" || value.startsWith("--profile=")) {
			args.profiles.push(readValue("--profile"));
		} else if (value === "--suite" || value.startsWith("--suite=")) {
			args.suitePath = readValue("--suite");
		} else if (value === "--trace-file" || value.startsWith("--trace-file=")) {
			args.tracePath = readValue("--trace-file");
		} else if (value === "--pass-score" || value.startsWith("--pass-score=")) {
			args.passScore = Number(readValue("--pass-score"));
			if (!Number.isFinite(args.passScore) || args.passScore < 0 || args.passScore > 1) {
				throw new Error("--pass-score must be between 0 and 1");
			}
		} else {
			throw new Error(`Unknown option: ${value}`);
		}
	}
	return args;
}

function printUsage() {
	console.log(`Usage: npm run eval:agent-trajectories -- [options]

Validates production-shaped Onhand trajectory fixtures and deterministically
scores normalized trace records. This command does not call a model or browser.

Options:
  --suite <path>           Fixture suite. Default: evals/agent-trajectories/cases.json
  --trace-file <path>      JSON, {"traces": [...]}, or JSONL normalized traces
  --case <id>              Select a case; repeatable
  --profile <profile>      Select legacy, full-agent, or guided-agent; repeatable
  --pass-score <0..1>      Deterministic pass threshold. Default: ${DEFAULT_PASS_SCORE}
  --list-cases             List validated cases
  --json                   Emit machine-readable output
  -h, --help               Show this help

With no --trace-file, the command validates the suite and prints its run matrix.`);
}

function selectCases(suite, args) {
	let cases = suite.cases;
	if (args.caseIds.length) {
		const selected = new Set(args.caseIds);
		cases = cases.filter((testCase) => selected.has(testCase.id));
		const missing = args.caseIds.filter((id) => !cases.some((testCase) => testCase.id === id));
		if (missing.length) throw new Error(`Unknown case id(s): ${missing.join(", ")}`);
	}
	if (args.profiles.length) {
		const selected = new Set(args.profiles);
		cases = cases.filter((testCase) => testCase.profiles.some((profile) => selected.has(profile)));
	}
	if (!cases.length) throw new Error("No trajectory cases matched the requested filters");
	return cases;
}

function formatMatrix(suite, cases) {
	const lines = [
		`Trajectory suite: ${suite.suiteId} (schema ${suite.schemaVersion})`,
		`Cases: ${cases.length}`,
		"",
	];
	for (const testCase of cases) {
		lines.push(`${testCase.id}\t${testCase.profiles.join(",")}\t${testCase.turn.mode}\t${testCase.description}`);
	}
	return lines.join("\n");
}

function formatResults(results, summary) {
	const lines = [
		"| Case | Profile | Model | Iteration | Status | Score | Latency | Model calls | Tool calls | Failures |",
		"| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | --- |",
	];
	for (const result of results) {
		lines.push(
			`| ${result.caseId} | ${result.profile} | ${result.model} | ${result.iteration} | ${result.status} | ${result.score.toFixed(3)} | ${result.metrics.latencyMs} ms | ${result.metrics.modelCalls} | ${result.metrics.toolCalls} | ${result.hardFailures.join("<br>") || ""} |`,
		);
	}
	lines.push("", "| Profile | Model | Runs | Pass rate | Average score | p95 latency | Cost / successful task |", "| --- | --- | ---: | ---: | ---: | ---: | ---: |");
	for (const group of summary) {
		lines.push(
			`| ${group.profile} | ${group.model} | ${group.runs} | ${(group.passRate * 100).toFixed(0)}% | ${group.averageScore.toFixed(3)} | ${group.p95LatencyMs ?? "n/a"} ms | ${group.costPerSuccessfulTaskUsd == null ? "n/a" : `$${group.costPerSuccessfulTaskUsd.toFixed(6)}`} |`,
		);
	}
	return lines.join("\n");
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const suite = await loadTrajectorySuite(args.suitePath);
	const cases = selectCases(suite, args);
	if (args.listCases || !args.tracePath) {
		const payload = {
			suiteId: suite.suiteId,
			schemaVersion: suite.schemaVersion,
			cases: cases.map(({ id, description, profiles, turn }) => ({ id, description, profiles, mode: turn.mode })),
		};
		console.log(args.json ? JSON.stringify(payload, null, 2) : formatMatrix(suite, cases));
		return;
	}

	const traces = await loadTrajectoryTraces(args.tracePath);
	const caseMap = new Map(cases.map((testCase) => [testCase.id, testCase]));
	const selectedProfiles = new Set(args.profiles);
	const selectedTraces = traces.filter((trace) => caseMap.has(trace.caseId) && (!selectedProfiles.size || selectedProfiles.has(trace.profile)));
	if (!selectedTraces.length) throw new Error("No trace records matched the selected cases and profiles");
	const results = selectedTraces.map((trace) => scoreTrajectory(caseMap.get(trace.caseId), trace, { passScore: args.passScore }));
	const summary = summarizeTrajectoryResults(results);
	if (args.json) console.log(JSON.stringify({ suiteId: suite.suiteId, results, summary }, null, 2));
	else console.log(formatResults(results, summary));
	if (results.some((result) => result.status !== "pass")) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error.stack || error.message || String(error));
	process.exitCode = 1;
});
