const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_INTERVAL_MS = 500;

function parseArgs(argv) {
	const args = {
		realOpenAI: false,
		timeoutMs: DEFAULT_TIMEOUT_MS,
		json: false,
	};
	for (const value of argv) {
		if (value === "--real-openai") {
			args.realOpenAI = true;
			continue;
		}
		if (value === "--json") {
			args.json = true;
			continue;
		}
		if (value.startsWith("--timeout-ms=")) {
			const parsed = Number.parseInt(value.slice("--timeout-ms=".length), 10);
			if (Number.isFinite(parsed) && parsed > 0) args.timeoutMs = parsed;
			continue;
		}
		if (value === "--help" || value === "-h") {
			printUsage();
			process.exit(0);
		}
		throw new Error(`Unknown option: ${value}`);
	}
	return args;
}

function printUsage() {
	console.log(`Usage: npm run smoke:browser-runtime -- [options]

Runs the browser-only Onhand runtime without the desktop app or localhost bridge.

Options:
  --real-openai       Use OPENAI_API_KEY and openai/gpt-4.1-mini instead of the deterministic faux provider
  --timeout-ms=<n>    Wait timeout for the runtime response
  --json              Print machine-readable output
`);
}

function installChromeStorageStub() {
	globalThis.chrome = {
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

function createHost() {
	return {
		async runCommand(name, args = {}) {
			if (name === "highlight_text") {
				return {
					tab: { id: 101, windowId: 1, title: "Browser runtime smoke page", url: "https://example.com/onhand-smoke" },
					annotation: {
						annotationId: "smoke-highlight",
						matchedText: String(args.text || "browser-only runtime testing is active"),
					},
				};
			}
			if (name === "get_selection") {
				return { selection: { text: "" } };
			}
			if (name === "get_visible_text") {
				return {
					tab: { id: 101, windowId: 1, title: "Browser runtime smoke page", url: "https://example.com/onhand-smoke" },
					visible: {
						text: "Onhand browser-only runtime testing is active. Alpha smoke content is visible on the page.",
					},
				};
			}
			return { ok: true, name, args };
		},
		async snapshotState() {
			return {
				windows: [
					{
						id: 1,
						focused: true,
						tabs: [
							{
								id: 101,
								windowId: 1,
								active: true,
								title: "Browser runtime smoke page",
								url: "https://example.com/onhand-smoke",
							},
						],
					},
				],
			};
		},
		log() {},
		notifyAuthProgress() {},
	};
}

async function waitForCompletion(runtime, timeoutMs) {
	const startedAt = Date.now();
	let state = null;
	while (Date.now() - startedAt <= timeoutMs) {
		state = await runtime.getState();
		if (!state.activeRequestId) return state;
		await new Promise((resolve) => setTimeout(resolve, DEFAULT_INTERVAL_MS));
	}
	return state;
}

function latestAssistantText(state) {
	return [...(state?.messages || [])].reverse().find((message) => message.role === "assistant")?.text || "";
}

function buildResult({ args, state, provider, model }) {
	const latestTurn = state?.turns?.at(-1) || null;
	const reply = latestTurn?.reply || latestAssistantText(state);
	const failures = [];
	if (state?.activeRequestId) failures.push("Runtime did not complete before timeout.");
	if (state?.status !== "Reply ready") failures.push(`Expected status Reply ready, found ${state?.status || "(missing)"}.`);
	if (latestTurn?.error) failures.push(`Latest turn is marked as an error: ${reply || "(no reply)"}`);
	if (!reply) failures.push("No assistant reply was recorded.");
	if (args.realOpenAI) {
		if (!/Onhand smoke ok/i.test(reply)) failures.push("Real OpenAI reply did not include the expected smoke text.");
	} else {
		if (reply !== "Browser runtime smoke ok") failures.push(`Expected deterministic faux reply, found ${reply || "(missing)"}.`);
		if ((latestTurn?.pageActions || []).length < 1) failures.push("Expected at least one page action from the highlight tool.");
	}
	return {
		ok: failures.length === 0,
		mode: args.realOpenAI ? "real-openai" : "faux",
		provider,
		model,
		status: state?.status || null,
		reply,
		pageActions: latestTurn?.pageActions || [],
		turnError: Boolean(latestTurn?.error),
		failures,
	};
}

function printHuman(result) {
	console.log(`Browser runtime smoke: ${result.ok ? "PASS" : "FAIL"}`);
	console.log(`Mode: ${result.mode}`);
	console.log(`Model: ${result.provider}/${result.model}`);
	console.log(`Status: ${result.status || "(missing)"}`);
	console.log(`Reply: ${result.reply || "(none)"}`);
	console.log(`Page actions: ${result.pageActions.length}`);
	for (const action of result.pageActions) {
		console.log(`- ${action.label}: ${action.detail}`);
	}
	if (result.failures.length) {
		console.log("");
		console.log("Failures:");
		for (const failure of result.failures) console.log(`- ${failure}`);
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	installChromeStorageStub();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	let provider = "openai";
	let model = "gpt-4.1-mini";
	let apiKey = process.env.OPENAI_API_KEY || "";

	if (!args.realOpenAI) {
		provider = "onhand-smoke";
		model = "onhand-smoke-1";
		apiKey = "test";
	} else if (!apiKey) {
		throw new Error("OPENAI_API_KEY is required for --real-openai.");
	}

	const runtime = createOnhandBrowserRuntime(createHost());
	await runtime.updateSettings({
		aiProvider: provider,
		aiModel: model,
		aiApiKey: apiKey,
		authMode: "api-key",
	});
	await runtime.submitPrompt({
		prompt: args.realOpenAI
			? "Reply with exactly these words and no punctuation: Onhand smoke ok"
			: "Use the page and then reply with the deterministic smoke result.",
		displayPrompt: "browser runtime smoke",
		attachments: [],
		learningMode: false,
	});
	const state = await waitForCompletion(runtime, args.timeoutMs);
	const result = buildResult({ args, state, provider, model });
	if (args.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		printHuman(result);
	}
	if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error?.message || String(error));
	process.exitCode = 1;
});
