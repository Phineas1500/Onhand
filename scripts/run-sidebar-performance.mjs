import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const DEFAULT_SOURCE = fileURLToPath(new URL("../packages/browser-extension/sidebar.js", import.meta.url));
const EXTENSION_DIRECTORY = dirname(DEFAULT_SOURCE);

export function createPerformanceState(turnCount = 100, citationsPerTurn = 6) {
	const evidence = (turn, source) => `Experiment ${turn}, passage ${source}: the measured temperature rose by ${turn + source} degrees after the controlled exposure.`;
	const actions = (turn) => Array.from({ length: citationsPerTurn }, (_, index) => ({
		key: `highlight:perf-${turn}-${index + 1}`,
		type: "annotation",
		annotationId: `perf-${turn}-${index + 1}`,
		label: "Highlighted text",
		title: "Synthetic research notebook",
		url: "https://example.test/sidebar-performance.pdf",
		citationText: evidence(turn, index + 1),
		detail: evidence(turn, index + 1),
		pdfAnchor: { pageNumber: turn, occurrence: index + 1 },
	}));
	const paragraph = (turn, source) => `${evidence(turn, source)} [[cite:perf-${turn}-${source}]]`;
	const createdAt = "2026-09-07T12:00:00.000Z";
	return {
		status: "Working",
		currentSession: { sessionId: "sidebar-performance", sessionName: "Synthetic long conversation" },
		preferences: { learningMode: false, realtimeVoiceEnabled: false, extensionVersion: "performance-fixture", runtimeRevision: "performance-fixture" },
		turns: Array.from({ length: turnCount }, (_, index) => ({
			id: `turn-${index + 1}`,
			userPrompt: `Explain the ${citationsPerTurn} results from experiment ${index + 1}.`,
			reply: Array.from({ length: citationsPerTurn }, (_, sourceIndex) => paragraph(index + 1, sourceIndex + 1)).join("\n\n"),
			activities: [],
			pageActions: actions(index + 1),
			pending: false,
			error: false,
			createdAt,
		})),
		activeRequestId: "streaming-turn",
		currentTurnId: "streaming-turn",
		messages: [
			{ id: "user:streaming-turn", text: "Explain the next experiment as results arrive.", createdAt },
			{ id: "assistant:streaming-turn", text: paragraph(turnCount + 1, 1), pending: true, createdAt },
		],
		pageActions: actions(turnCount + 1),
		activities: [],
	};
}

// This function is also serialized unchanged into the optional HTTP fixture.
// The renderer is production sidebar.js; runtime responses are synthetic and
// cloned for every fetch, as extension messaging would clone them.
export function installPerformanceFixture(window, initialState, configuration) {
	let state = initialState;
	const listeners = [];
	const storageValues = {};
	const runtimeMessages = [];
	window.__onhandSidebarExposeTestHooks = true;
	window.confirm = () => true;
	window.setInterval = () => 1; // Drive polls explicitly so samples never overlap.
	window.clearInterval = () => {};
	window.chrome = {
		runtime: {
			getURL: (path) => `/assets/${path}`,
			onMessage: { addListener: (listener) => listeners.push(listener) },
			openOptionsPage: async () => {},
			async sendMessage(message) {
				runtimeMessages.push(message);
				if (message.type === "sidebar:fetch-state") return { ok: true, state: JSON.parse(JSON.stringify(state)) };
				if (message.type === "sidebar:get-window-state") return { ok: true, open: true };
				if (message.type === "sidebar:list-sessions") return {
					ok: true,
					currentSession: { ...state.currentSession, sessionFile: state.currentSession.sessionId },
					sessions: [{ id: state.currentSession.sessionId, path: state.currentSession.sessionId, name: state.currentSession.sessionName }],
				};
				return { ok: true };
			},
		},
		storage: {
			local: {
				async get(defaults) {
					if (typeof defaults === "string") return { [defaults]: storageValues[defaults] };
					if (Array.isArray(defaults)) return Object.fromEntries(defaults.map((key) => [key, storageValues[key]]));
					return { ...defaults, ...storageValues };
				},
				async set(values) { Object.assign(storageValues, values); },
				async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete storageValues[key]; },
			},
			onChanged: { addListener() {} },
		},
		windows: { getCurrent: async () => ({ id: 1 }) },
		tabs: { create: async (values) => ({ id: 1, ...values }) },
	};
	const tick = () => new Promise((resolve) => window.setTimeout(resolve, 0));
	const nextPaint = () => new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
	const entries = () => [...window.document.querySelector("#onhand-extension-sidebar-host").shadowRoot.querySelectorAll("#messages > .onhand-entry")];
	const assertFixture = (condition, message) => { if (!condition) throw new Error(message); };
	const summarize = (values) => {
		const ordered = [...values].sort((left, right) => left - right);
		const rounded = (value) => Number(value.toFixed(3));
		return {
			samplesMs: values.map(rounded),
			medianMs: rounded(ordered[Math.floor(ordered.length / 2)]),
			p95Ms: rounded(ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)]),
			minMs: rounded(ordered[0]),
			maxMs: rounded(ordered.at(-1)),
		};
	};
	window.__onhandPerformanceFixture = {
		async ready() {
			for (let attempt = 0; attempt < 200; attempt += 1) {
				if (window.__onhandSidebarTestHooks && entries().length === configuration.turns + 1) {
					await tick();
					return;
				}
				await tick();
			}
			throw new Error("The synthetic sidebar fixture did not finish rendering.");
		},
		getState: () => JSON.parse(JSON.stringify(state)),
		getRuntimeMessages: () => JSON.parse(JSON.stringify(runtimeMessages)),
		async replaceState(nextState) {
			state = JSON.parse(JSON.stringify(nextState));
			await window.__onhandSidebarTestHooks.requestState();
		},
		async run({ paint = false } = {}) {
			await this.ready();
			const hooks = window.__onhandSidebarTestHooks;
			state = JSON.parse(JSON.stringify(initialState));
			// Initial <details> toggle events may change disclosure state after the
			// first paint. Settle those events before measuring steady-state polls.
			const warmupTimes = [];
			for (let index = 0; index < 3; index += 1) {
				const start = window.performance.now();
				await hooks.requestState();
				warmupTimes.push(Number((window.performance.now() - start).toFixed(3)));
				await tick();
			}
			const originalNodes = entries().slice(0, configuration.turns);
			const originalCitations = originalNodes.map((entry) => [...entry.querySelectorAll(".onhand-cite")].map((button) => button.textContent.trim()));
			assertFixture(originalCitations.every((citations) => citations.length === configuration.citations), "Expected all completed source citations to render.");
			assertFixture(originalCitations.flat().every((label, index) => label === `[${index + 1}]`), "Expected session-wide sequential citation numbering.");
			const renderCountBefore = hooks.getMessageRenderCount();
			const idleTimes = [];
			for (let index = 0; index < configuration.updates; index += 1) {
				const start = window.performance.now();
				await hooks.requestState();
				idleTimes.push(window.performance.now() - start);
			}
			const idleRenderCount = hooks.getMessageRenderCount() - renderCountBefore;
			const streamTimes = [];
			const paintTimes = [];
			const replacedCompletedNodes = [];
			const retainedOriginalNodes = [];
			for (let index = 0; index < configuration.updates; index += 1) {
				const previousNodes = entries().slice(0, configuration.turns);
				const source = index % configuration.citations + 1;
				state.messages[1].text += `\n\nStreaming update ${index + 1}: the evidence supports this observation. [[cite:perf-${configuration.turns + 1}-${source}]]`;
				const start = window.performance.now();
				await hooks.requestState();
				streamTimes.push(window.performance.now() - start);
				if (paint) {
					await nextPaint();
					paintTimes.push(window.performance.now() - start);
				}
				const nextNodes = entries().slice(0, configuration.turns);
				replacedCompletedNodes.push(previousNodes.filter((node, nodeIndex) => nextNodes[nodeIndex] !== node).length);
				retainedOriginalNodes.push(originalNodes.filter((node, nodeIndex) => nextNodes[nodeIndex] === node).length);
				assertFixture(nextNodes.every((entry, turnIndex) => JSON.stringify([...entry.querySelectorAll(".onhand-cite")].map((button) => button.textContent.trim())) === JSON.stringify(originalCitations[turnIndex])), "Completed citation numbering changed during streaming.");
				assertFixture(entries().at(-1).textContent.includes(`Streaming update ${index + 1}`), "The active answer did not update.");
			}
			return {
				environment: configuration.environment,
				sourceSha256: configuration.sourceSha256,
				syntheticRuntime: true,
				completedTurns: configuration.turns,
				completedCitations: configuration.turns * configuration.citations,
				streamUpdates: configuration.updates,
				warmupSamplesMs: warmupTimes,
				idle: { ...summarize(idleTimes), transcriptRenders: idleRenderCount },
				streaming: {
					...summarize(streamTimes),
					...(paint ? { throughNextPaint: summarize(paintTimes) } : {}),
					replacedCompletedNodes,
					retainedOriginalNodes,
					citationNumbersStable: true,
				},
			};
		},
	};
}

async function main() {
	const args = process.argv.slice(2);
	const option = (name, fallback) => {
		const index = args.indexOf(name);
		return index === -1 ? fallback : args[index + 1];
	};
	if (args.includes("--help")) {
		console.log("Usage: node scripts/run-sidebar-performance.mjs [--source FILE] [--output JSON] [--turns 100] [--citations 6] [--updates 10] [--serve PORT]\n--serve exposes a synthetic HTTP fixture; invoke await window.__onhandPerformanceFixture.run({paint:true}) in the browser. Timings include cloned state fetch and the full sidebar update; throughNextPaint additionally includes two animation frames. This is not a hosted-provider end-to-end test.");
		return;
	}
	const configuration = {
		turns: Number(option("--turns", "100")),
		citations: Number(option("--citations", "6")),
		updates: Number(option("--updates", "10")),
		environment: args.includes("--serve") ? "browser HTTP fixture" : "JSDOM (no layout or paint)",
	};
	for (const name of ["turns", "citations", "updates"]) assert.ok(Number.isInteger(configuration[name]) && configuration[name] > 0, `--${name} must be a positive integer`);
	const sourcePath = resolve(option("--source", DEFAULT_SOURCE));
	const source = await readFile(sourcePath, "utf8");
	const sourceSha256 = createHash("sha256").update(source).digest("hex");
	configuration.sourceSha256 = sourceSha256;
	const fixtureState = createPerformanceState(configuration.turns, configuration.citations);
	if (args.includes("--serve")) {
		const port = Number(option("--serve", "8877"));
		const clientSource = `(${installPerformanceFixture.toString()})(window, ${JSON.stringify(fixtureState)}, ${JSON.stringify(configuration)});`;
		const server = createServer(async (request, response) => {
			try {
				const pathname = new URL(request.url, "http://127.0.0.1").pathname;
				let content;
				let type;
				if (pathname === "/") {
					type = "text/html";
					// The embedded sidebar sits inside a transformed body. A short body
					// can paint its host but exclude it from pointer and wheel hit testing.
					content = '<!doctype html><html><head><meta charset="utf-8"><title>Onhand synthetic sidebar performance</title><style>html, body { min-height: 100vh; }</style></head><body><p>Synthetic long-conversation fixture. Runtime APIs are mocked; production sidebar.js is used.</p><script src="/harness.js"></script><script src="/sidebar.js"></script></body></html>';
				} else if (pathname === "/harness.js" || pathname === "/sidebar.js") {
					type = "text/javascript";
					content = pathname === "/harness.js" ? clientSource : source;
				} else if (/^\/assets\/(fonts\/[A-Za-z0-9_.-]+\.woff2|vendor\/katex\.mjs)$/.test(pathname)) {
					type = pathname.endsWith(".mjs") ? "text/javascript" : "font/woff2";
					content = await readFile(resolve(EXTENSION_DIRECTORY, pathname.slice("/assets/".length)));
				} else {
					response.writeHead(404).end();
					return;
				}
				response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }).end(content);
			} catch {
				response.writeHead(500).end();
			}
		});
		server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/`, sourcePath, sourceSha256, configuration })));
		return;
	}
	const dom = new JSDOM("<!doctype html><html><body></body></html>", {
		url: "chrome-extension://performance-fixture/sidepanel.html",
		pretendToBeVisual: true,
		runScripts: "outside-only",
	});
	try {
		installPerformanceFixture(dom.window, fixtureState, configuration);
		dom.window.eval(source);
		const result = { sourcePath, sourceSha256, measuredAt: new Date().toISOString(), ...await dom.window.__onhandPerformanceFixture.run() };
		const json = JSON.stringify(result, null, 2);
		if (args.includes("--output")) {
			const output = resolve(option("--output"));
			await mkdir(dirname(output), { recursive: true });
			await writeFile(output, `${json}\n`);
		}
		console.log(json);
	} finally {
		dom.window.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	await main();
}
