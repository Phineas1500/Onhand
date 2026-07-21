#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { loadTrajectorySuite } from "./lib/agent-trajectory-eval.mjs";
import { startAgentTrajectoryFixtureServer } from "./lib/agent-trajectory-fixtures.mjs";

const DEFAULT_SUITE = fileURLToPath(new URL("../evals/agent-trajectories/cases.json", import.meta.url));

function parseArgs(argv) {
	const args = { host: "127.0.0.1", port: 8766, suitePath: DEFAULT_SUITE };
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
		if (value === "--host" || value.startsWith("--host=")) args.host = readValue("--host");
		else if (value === "--port" || value.startsWith("--port=")) args.port = Number(readValue("--port"));
		else if (value === "--suite" || value.startsWith("--suite=")) args.suitePath = readValue("--suite");
		else if (value === "-h" || value === "--help") {
			console.log("Usage: npm run serve:agent-trajectories -- [--host=127.0.0.1] [--port=8766] [--suite=<path>]");
			process.exit(0);
		} else throw new Error(`Unknown option: ${value}`);
	}
	if (!Number.isFinite(args.port) || args.port <= 0) throw new Error("--port must be a positive number");
	return args;
}

const args = parseArgs(process.argv.slice(2));
const suite = await loadTrajectorySuite(args.suitePath);
const fixture = await startAgentTrajectoryFixtureServer(suite, { host: args.host, port: args.port });
console.log(`Onhand trajectory fixtures: ${fixture.baseUrl}`);
for (const testCase of suite.cases) {
	const activeTab = testCase.workspace.tabs.find((tab) => tab.id === testCase.workspace.activeTabId);
	console.log(`${testCase.id}\t${fixture.catalog.tabUrl(testCase, activeTab)}`);
}

async function close() {
	await fixture.close();
	process.exit(0);
}

process.once("SIGINT", close);
process.once("SIGTERM", close);
