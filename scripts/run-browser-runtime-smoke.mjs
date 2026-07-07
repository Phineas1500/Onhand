const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_INTERVAL_MS = 500;

function parseArgs(argv) {
	const args = {
		realOpenAI: false,
		ports: false,
		timeoutMs: DEFAULT_TIMEOUT_MS,
		json: false,
	};
	for (const value of argv) {
		if (value === "--real-openai") {
			args.realOpenAI = true;
			continue;
		}
		if (value === "--ports") {
			args.ports = true;
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
  --ports             Exercise every browser tool port with the deterministic faux provider
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

function smokeTab(overrides = {}) {
	return {
		id: 101,
		windowId: 1,
		active: true,
		title: "Browser runtime smoke page",
		url: "https://example.com/onhand-smoke",
		...overrides,
	};
}

function seedArtifacts() {
	globalThis.chrome.storage.local.data.onhandBrowserArtifacts = {
		artifact_smoke_seed: {
			id: "artifact_smoke_seed",
			createdAt: "2026-05-04T00:00:00.000Z",
			updatedAt: "2026-05-04T00:00:00.000Z",
			sessionId: null,
			label: "seed ports artifact",
			tab: smokeTab(),
			page: {
				title: "Browser runtime smoke page",
				url: "https://example.com/onhand-smoke",
				scrollX: 0,
				scrollY: 0,
				annotations: [
					{
						matchedText: "Alpha smoke content",
						note: { text: "Ports smoke note", label: "Onhand" },
					},
				],
				annotationCount: 1,
			},
			outerHTML: "<main><h1>Browser runtime smoke page</h1><p>Alpha smoke content</p></main>",
			screenshotDataUrl: "data:image/png;base64,UE9SVFM=",
		},
	};
}

function createHost() {
	const calls = [];
	return {
		calls,
		async runCommand(name, args = {}) {
			calls.push({ name, args });
			const tab = smokeTab();
			const elementBySelector = (selector, fallbackText = "") => ({
				tag: selector?.includes("Input") || selector?.includes("field") ? "input" : "button",
				selector,
				text: fallbackText,
			});
			if (name === "activate_tab") {
				return { tab: smokeTab({ id: Number(args.tabId || 101), active: true }) };
			}
			if (name === "navigate") {
				return {
					tab: smokeTab({
						id: args.newTab ? 102 : 101,
						title: "Navigated smoke page",
						url: String(args.url || "https://example.com/onhand-smoke?nav=1"),
					}),
				};
			}
			if (name === "pdf_search") {
				return {
					tab,
					search: {
						query: String(args.query || "Alpha smoke content"),
						matchCount: 1,
						matches: [
							{
								pageNumber: 1,
								occurrence: 1,
								matchedText: "Alpha smoke content",
								snippet: "Alpha smoke content is available in the smoke PDF.",
							},
						],
					},
				};
			}
			if (name === "pdf_read_pages") {
				return {
					tab,
					pages: {
						pageNumbers: [Number(args.pageNumber || 1)],
						blocks: [{ pageNumber: Number(args.pageNumber || 1), text: "Alpha smoke content is available in the smoke PDF." }],
					},
				};
			}
			if (name === "pdf_jump_to_page") {
				return { tab, jump: { pageNumber: Number(args.pageNumber || 1), matchedText: String(args.text || "Alpha smoke content") } };
			}
			if (name === "pdf_capture_page_image") {
				return {
					tab,
					pageNumber: Number(args.pageNumber || 1),
					mimeType: "image/png",
					dataUrl: "data:image/png;base64,UE9SVFM=",
					width: 100,
					height: 120,
				};
			}
			if (name === "highlight_text") {
				return {
					tab,
					annotation: {
						annotationId: "smoke-highlight",
						matchedText: String(args.text || "browser-only runtime testing is active"),
					},
				};
			}
			if (name === "show_note") {
				return {
					tab,
					note: {
						annotationId: String(args.annotationId || "smoke-highlight"),
						note: String(args.note || "Ports smoke note"),
						label: String(args.label || "Onhand"),
					},
				};
			}
			if (name === "scroll_to_annotation") {
				return { tab, annotation: { annotationId: String(args.annotationId || "smoke-highlight") } };
			}
			if (name === "clear_annotations") {
				return { tab, cleared: true };
			}
			if (name === "get_selection") {
				return { selection: { text: "" } };
			}
			if (name === "get_visible_text") {
				return {
					tab,
					visible: {
						text: "Onhand browser-only runtime testing is active. Alpha smoke content is visible on the page.",
					},
				};
			}
			if (name === "extract_content") {
				return {
					tab,
					content: {
						title: "Browser runtime smoke page",
						url: tab.url,
						markdown: "# Browser runtime smoke page\n\nAlpha smoke content is available for readable extraction.",
					},
				};
			}
			if (name === "get_viewport_headings") {
				return {
					tab,
					headings: {
						currentHeading: { level: 2, text: "Readable Section" },
						headings: [
							{ level: 1, text: "Browser runtime smoke page" },
							{ level: 2, text: "Readable Section" },
							{ level: 2, text: "Interaction Section" },
						],
					},
				};
			}
			if (name === "get_scroll_state") {
				return {
					tab,
					scroll: { scrollX: 0, scrollY: 0, maxScrollY: 600, progressY: 0, atTop: true, atBottom: false },
				};
			}
			if (name === "capture_state") {
				return {
					tab,
					page: {
						title: tab.title,
						url: tab.url,
						scrollX: 0,
						scrollY: 0,
						annotations: [
							{
								matchedText: "Alpha smoke content",
								note: { text: "Ports smoke note", label: "Onhand" },
							},
						],
						annotationCount: 1,
					},
				};
			}
			if (name === "find_elements") {
				return { tab, matches: [{ tag: "button", selector: "#demoButton", text: "Demo button" }] };
			}
			if (name === "wait_for_selector") {
				return { tab, element: { tag: "output", selector: String(args.selector || "#result"), text: "Result idle" } };
			}
			if (name === "click") {
				return { tab, element: elementBySelector(String(args.selector || "#cssButton"), "CSS button") };
			}
			if (name === "type_text") {
				return { tab, element: { tag: "input", selector: String(args.selector || "#cssInput"), text: String(args.text || "") } };
			}
			if (name === "click_text") {
				return { tab, element: { tag: "button", selector: "#demoButton", text: String(args.text || "Demo button") } };
			}
			if (name === "type_by_label") {
				return { tab, element: { tag: "input", selector: "#demoField", text: String(args.text || "") } };
			}
			if (name === "pick_elements") {
				return { tab, selection: [{ tag: "button", selector: "#demoButton", text: "Demo button" }] };
			}
			if (name === "collect_console") {
				return { tab, entries: [{ level: "log", text: "onhand-console-smoke" }] };
			}
			if (name === "collect_network") {
				return { tab, entries: [{ method: "GET", status: 200, url: "https://example.com/onhand-smoke/fixture.json" }] };
			}
			if (name === "get_dom") {
				return { tab, outerHTML: "<main><h1>Browser runtime smoke page</h1><p>Alpha smoke content</p></main>" };
			}
			if (name === "capture_screenshot") {
				return { tab, method: "debugger", dataUrl: "data:image/png;base64,UE9SVFM=" };
			}
			if (name === "run_js") {
				return { tab, result: { fixture: "ready", expectedPhrase: "Alpha smoke content", version: 1 } };
			}
			return { ok: true, name, args };
		},
		async snapshotState() {
			calls.push({ name: "snapshot_state", args: {} });
			return {
				windows: [
					{
						id: 1,
						focused: true,
						tabs: [
							{
								...smokeTab(),
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

const EXPECTED_PORT_TOOLS = [
	"browser_list_tabs",
	"browser_activate_tab",
	"browser_navigate",
	"browser_open_pdf_in_onhand_viewer",
	"browser_pdf_search",
	"browser_pdf_read_pages",
	"browser_pdf_jump_to_page",
	"browser_pdf_capture_page_image",
	"browser_get_visible_text",
	"browser_extract_content",
	"browser_get_selection",
	"browser_get_viewport_headings",
	"browser_get_scroll_state",
	"browser_highlight_text",
	"browser_show_note",
	"browser_scroll_to_annotation",
	"browser_clear_annotations",
	"browser_capture_state",
	"browser_list_artifacts",
	"browser_restore_state",
	"browser_find_elements",
	"browser_wait_for_selector",
	"browser_click",
	"browser_type",
	"browser_click_text",
	"browser_type_by_label",
	"browser_pick_elements",
	"browser_collect_console",
	"browser_collect_network",
	"browser_get_dom",
	"browser_capture_screenshot",
	"browser_run_js",
];

function buildResult({ args, state, provider, model, host }) {
	const latestTurn = state?.turns?.at(-1) || null;
	const reply = latestTurn?.reply || latestAssistantText(state);
	const failures = [];
	if (state?.activeRequestId) failures.push("Runtime did not complete before timeout.");
	if (state?.status !== "Reply ready") failures.push(`Expected status Reply ready, found ${state?.status || "(missing)"}.`);
	if (latestTurn?.error) failures.push(`Latest turn is marked as an error: ${reply || "(no reply)"}`);
	if (!reply) failures.push("No assistant reply was recorded.");
	if (args.ports) {
		const toolNames = (latestTurn?.activities || []).map((activity) => activity.toolName).filter(Boolean);
		const erroredTools = (latestTurn?.activities || []).filter((activity) => activity.state === "error").map((activity) => activity.toolName);
		const missingTools = EXPECTED_PORT_TOOLS.filter((toolName) => !toolNames.includes(toolName));
		const networkCall = (host?.calls || []).find((call) => call.name === "collect_network");
		if (reply !== "Browser runtime ports ok") failures.push(`Expected deterministic ports reply, found ${reply || "(missing)"}.`);
		if (missingTools.length) failures.push(`Missing tool activity for: ${missingTools.join(", ")}.`);
		if (erroredTools.length) failures.push(`Tool activities failed for: ${erroredTools.join(", ")}.`);
		if (!networkCall?.args?.reload || !networkCall?.args?.ignoreCache) {
			failures.push("Expected collect_network port smoke to exercise reload=true and ignoreCache=true.");
		}
	} else if (args.realOpenAI) {
		if (!/Onhand smoke ok/i.test(reply)) failures.push("Real OpenAI reply did not include the expected smoke text.");
	} else {
		if (reply !== "Browser runtime smoke ok") failures.push(`Expected deterministic faux reply, found ${reply || "(missing)"}.`);
		if ((latestTurn?.pageActions || []).length < 1) failures.push("Expected at least one page action from the highlight tool.");
	}
	const toolNames = (latestTurn?.activities || []).map((activity) => activity.toolName).filter(Boolean);
	return {
		ok: failures.length === 0,
		mode: args.ports ? "ports" : args.realOpenAI ? "real-openai" : "faux",
		provider,
		model,
		status: state?.status || null,
		reply,
		toolNames,
		hostCalls: host?.calls || [],
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
	if (result.toolNames.length) console.log(`Tools: ${result.toolNames.join(", ")}`);
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
	if (args.realOpenAI && args.ports) {
		throw new Error("--real-openai and --ports cannot be combined.");
	}
	installChromeStorageStub();
	if (args.ports) seedArtifacts();
	const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	let provider = "openai";
	let model = "gpt-4.1-mini";
	let apiKey = process.env.OPENAI_API_KEY || "";

	if (!args.realOpenAI) {
		provider = "onhand-smoke";
		model = args.ports ? "onhand-smoke-ports-1" : "onhand-smoke-1";
		apiKey = "test";
	} else if (!apiKey) {
		throw new Error("OPENAI_API_KEY is required for --real-openai.");
	}

	const host = createHost();
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: provider,
		aiModel: model,
		aiApiKey: apiKey,
		authMode: "api-key",
		// Deterministic smoke: the mocked turn does not script a classifier model
		// call, so keep the (now default-on) classifier off and exercise the regex
		// router.
		experimentalModelLaneClassifier: false,
	});
	await runtime.submitPrompt({
		prompt: args.realOpenAI
			? "Reply with exactly these words and no punctuation: Onhand smoke ok"
			: args.ports
				? "Port smoke all browser tools: exercise every browser_* port once and then reply exactly Browser runtime ports ok."
				: "Use browser_highlight_text to highlight the exact text Alpha smoke content, then reply exactly Browser runtime smoke ok.",
		displayPrompt: "browser runtime smoke",
		attachments: [],
		learningMode: false,
	});
	const state = await waitForCompletion(runtime, args.timeoutMs);
	const result = buildResult({ args, state, provider, model, host });
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
