import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const CONFIG_PATH = join(homedir(), ".config", "pi-browser-bridge", "config.json");
const FAST_TIMEOUT_MS = 3000;
const RESTORE_TIMEOUT_MS = 60000;
const CAPTURE_TIMEOUT_MS = 10000;
const PAGE_TITLE = "Onhand Session Restore Regression";
const HIGHLIGHT_TEXT = "Future sessions should restore from saved browser tool history.";
const NOTE_TEXT = "Session replay restored this note from saved tool history.";
const NOTE_LABEL = "Session Replay";

function parseArgs(argv) {
	const args = {
		browserClient: "",
		browserClientId: "",
		expectClientLabel: "",
		keepSession: false,
		json: false,
		help: false,
	};

	for (const value of argv) {
		if (value === "--help" || value === "-h") {
			args.help = true;
			continue;
		}
		if (value === "--json") {
			args.json = true;
			continue;
		}
		if (value === "--keep-session") {
			args.keepSession = true;
			continue;
		}
		if (value.startsWith("--browser-client=")) {
			args.browserClient = value.slice("--browser-client=".length).trim();
			continue;
		}
		if (value.startsWith("--client-id=")) {
			args.browserClientId = value.slice("--client-id=".length).trim();
			continue;
		}
		if (value.startsWith("--expect-client-label=")) {
			args.expectClientLabel = value.slice("--expect-client-label=".length).trim();
			continue;
		}
		if (value.startsWith("--")) {
			throw new Error(`Unknown option: ${value}`);
		}
		args.browserClient = value.trim();
	}

	return args;
}

function printUsage() {
	console.log(`Usage: npm run test:session-restore -- [options]

Restores a synthetic session from saved browser tool-result history without calling the model.

Options:
  --browser-client=<text>        Match connected browser by label, browser name, or id
  --client-id=<id>               Exact connected browser client id
  --expect-client-label=<text>   Fail unless the chosen client label/name includes this text
  --keep-session                 Keep the generated temporary session JSONL for debugging
  --json                         Print machine-readable output

Example:
  npm run test:session-restore -- --browser-client="Chrome Test" --expect-client-label="Chrome Test"
`);
}

async function loadBridgeConfig() {
	const raw = await readFile(CONFIG_PATH, "utf8");
	const parsed = JSON.parse(raw);
	return {
		host: parsed.host || "127.0.0.1",
		port: Number(parsed.port || 3210),
		token: parsed.token || "",
	};
}

function buildAuthHeaders(token, hasBody = false) {
	const headers = new Headers();
	if (token) headers.set("Authorization", `Bearer ${token}`);
	if (hasBody) headers.set("Content-Type", "application/json");
	return headers;
}

async function requestJson(url, { token, method = "GET", body, timeoutMs = FAST_TIMEOUT_MS } = {}) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs).unref();
	try {
		const response = await fetch(url, {
			method,
			headers: buildAuthHeaders(token, body !== undefined),
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: controller.signal,
		});
		const text = await response.text();
		const data = text ? JSON.parse(text) : null;
		if (!response.ok || data?.ok === false) {
			throw new Error(data?.error || `HTTP ${response.status}`);
		}
		return data;
	} catch (error) {
		if (error?.name === "AbortError") throw new Error(`Request timed out: ${url}`);
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
}

function clientSearchText(client) {
	return [
		client?.clientId,
		client?.hello?.clientLabel,
		client?.hello?.browserName,
		client?.hello?.userAgent,
		client?.stateSummary?.activeTabTitle,
		client?.stateSummary?.activeTabUrl,
	]
		.filter(Boolean)
		.join("\n")
		.toLowerCase();
}

function clientLabel(client) {
	return client?.hello?.clientLabel || client?.hello?.browserName || "Browser";
}

function describeClient(client) {
	const tabs = Number(client?.stateSummary?.tabCount || 0);
	return `${clientLabel(client)} (${client?.clientId || "unknown id"}, ${tabs} tab${tabs === 1 ? "" : "s"})`;
}

function chooseClient(clients, args) {
	if (!Array.isArray(clients) || clients.length === 0) {
		throw new Error("No browser extension clients are connected to the bridge.");
	}
	if (args.browserClientId) {
		const exact = clients.find((client) => client?.clientId === args.browserClientId);
		if (!exact) throw new Error(`No connected browser client has id ${args.browserClientId}.`);
		return exact;
	}
	if (args.browserClient) {
		const needle = args.browserClient.toLowerCase();
		const matches = clients.filter((client) => clientSearchText(client).includes(needle));
		if (!matches.length) throw new Error(`No connected browser client matched "${args.browserClient}".`);
		if (matches.length > 1) {
			throw new Error(`Browser client selector "${args.browserClient}" matched multiple clients. Use --client-id.`);
		}
		return matches[0];
	}
	if (clients.length > 1) {
		const descriptions = clients.map((client) => `- ${describeClient(client)}`).join("\n");
		throw new Error(`Multiple browser clients are connected. Use --browser-client or --client-id.\n${descriptions}`);
	}
	return clients[0];
}

async function bridgeCommand({ bridgeBaseUrl, token, clientId }, name, commandArgs = {}, timeoutMs = FAST_TIMEOUT_MS) {
	const data = await requestJson(`${bridgeBaseUrl}/command`, {
		token,
		method: "POST",
		timeoutMs: timeoutMs + 1000,
		body: {
			name,
			args: commandArgs,
			timeoutMs,
			clientId,
		},
	});
	return data.result;
}

function fixtureHtml() {
	return `<!doctype html>
<html>
	<head>
		<meta charset="utf-8">
		<title>${PAGE_TITLE}</title>
		<style>
			body {
				font-family: Georgia, serif;
				line-height: 1.55;
				margin: 64px auto;
				max-width: 760px;
				padding: 0 24px;
			}
			code {
				background: #f0eee8;
				border-radius: 4px;
				padding: 1px 4px;
			}
		</style>
	</head>
	<body>
		<main>
			<h1>${PAGE_TITLE}</h1>
			<p>This local fixture exists only while the session restore regression is running.</p>
			<p>${HIGHLIGHT_TEXT} The restored annotation should include a note, a stable citation target, and a capture-state record.</p>
			<p>Unrelated text keeps the page realistic enough for inline highlight placement.</p>
		</main>
	</body>
</html>`;
}

async function startFixtureServer() {
	const server = createServer((req, res) => {
		if (req.url === "/favicon.ico") {
			res.writeHead(404);
			res.end();
			return;
		}
		res.writeHead(200, {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store",
			Connection: "close",
		});
		res.end(fixtureHtml());
	});

	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Could not determine local fixture server address.");
	}
	return {
		server,
		url: `http://127.0.0.1:${address.port}/session-restore-regression.html`,
	};
}

async function stopFixtureServer(server) {
	if (!server) return;
	await new Promise((resolve) => {
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		server.close(finish);
		server.closeIdleConnections?.();
		server.closeAllConnections?.();
		setTimeout(finish, 1000).unref();
	});
}

function sessionEntry(type, message, id) {
	return {
		type,
		id,
		timestamp: new Date().toISOString(),
		message,
	};
}

async function writeReplaySession(fixtureUrl) {
	const tempDir = await mkdtemp(join(tmpdir(), "onhand-session-restore-"));
	const sessionPath = join(tempDir, "session-restore-regression.jsonl");
	const tab = {
		id: 1,
		windowId: 1,
		title: PAGE_TITLE,
		url: fixtureUrl,
	};
	const highlightId = "onhand-session-restore-regression-highlight";
	const entries = [
		{
			type: "session",
			version: 3,
			id: "session-restore-regression",
			timestamp: new Date().toISOString(),
			cwd: process.cwd(),
		},
		sessionEntry(
			"message",
			{
				role: "user",
				content: [{ type: "text", text: "Restore this saved browser context." }],
			},
			"test-user",
		),
		sessionEntry(
			"message",
			{
				role: "toolResult",
				toolName: "browser_highlight_text",
				toolCallId: "test-highlight",
				content: [{ type: "text", text: `Highlighted: ${HIGHLIGHT_TEXT}` }],
				details: {
					tab,
					annotation: {
						annotationId: highlightId,
						kind: "inline",
						matchedText: HIGHLIGHT_TEXT,
						scrollY: 0,
					},
					clearExisting: true,
				},
			},
			"test-highlight",
		),
		sessionEntry(
			"message",
			{
				role: "toolResult",
				toolName: "browser_show_note",
				toolCallId: "test-note",
				content: [{ type: "text", text: `Displayed note: ${NOTE_TEXT}` }],
				details: {
					tab,
					note: {
						annotationId: highlightId,
						noteId: "onhand-session-restore-regression-note",
						label: NOTE_LABEL,
						text: NOTE_TEXT,
					},
				},
			},
			"test-note",
		),
		sessionEntry(
			"message",
			{
				role: "assistant",
				content: [{ type: "text", text: "The saved browser context is ready to restore." }],
			},
			"test-assistant",
		),
	];

	await writeFile(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
	return { tempDir, sessionPath };
}

function validateRestore({ restoreResponse, captureResult }) {
	const failures = [];
	const restoredPages = Array.isArray(restoreResponse?.restoredPages) ? restoreResponse.restoredPages : [];
	const pageSummary = restoredPages[0] || null;
	const annotations = Array.isArray(captureResult?.page?.annotations) ? captureResult.page.annotations : [];
	const matchingAnnotation = annotations.find((annotation) =>
		String(annotation?.matchedText || "").includes(HIGHLIGHT_TEXT),
	);
	const matchingNote = annotations.find((annotation) =>
		String(annotation?.note?.text || "").includes(NOTE_TEXT),
	);

	if (restoreResponse?.restoredCount !== 1) {
		failures.push(`Expected one restored page, found ${restoreResponse?.restoredCount ?? "(missing)"}.`);
	}
	if (pageSummary?.source !== "session-replay") {
		failures.push(`Expected session-replay restore source, found ${pageSummary?.source || "(missing)"}.`);
	}
	if (!pageSummary?.tabId) {
		failures.push("Restore response did not include a restored tab id.");
	}
	if (Number(pageSummary?.restoredCount || 0) < 1) {
		failures.push("Restore response did not report a restored annotation.");
	}
	if (Number(pageSummary?.failedCount || 0) !== 0) {
		failures.push(`Restore response reported ${pageSummary.failedCount} failed annotation(s).`);
	}
	if (!matchingAnnotation) {
		failures.push("Captured page state did not include the restored highlight text.");
	}
	if (!matchingNote) {
		failures.push("Captured page state did not include the restored note text.");
	}

	return {
		ok: failures.length === 0,
		failures,
		pageSummary,
		annotationCount: annotations.length,
		matchedAnnotationId: matchingAnnotation?.annotationId || null,
		matchedNoteId: matchingNote?.note?.noteId || null,
	};
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printUsage();
		return;
	}

	const bridgeConfig = await loadBridgeConfig();
	const bridgeBaseUrl = `http://${bridgeConfig.host}:${bridgeConfig.port}`;
	const desktopBaseUrl = `http://${bridgeConfig.host}:${process.env.ONHAND_UI_PORT || 3211}`;
	const failures = [];
	let fixture = null;
	let replaySession = null;

	try {
		await requestJson(`${bridgeBaseUrl}/health`, { token: bridgeConfig.token });
		await requestJson(`${desktopBaseUrl}/health`, { token: bridgeConfig.token });
		const clientsResponse = await requestJson(`${bridgeBaseUrl}/clients`, { token: bridgeConfig.token });
		const client = chooseClient(clientsResponse.clients || [], args);

		if (args.expectClientLabel) {
			const actualLabel = clientLabel(client);
			if (!actualLabel.toLowerCase().includes(args.expectClientLabel.toLowerCase())) {
				failures.push(`Expected selected client label/name to include "${args.expectClientLabel}", found "${actualLabel}".`);
			}
		}

		fixture = await startFixtureServer();
		replaySession = await writeReplaySession(fixture.url);
		const restoreResponse = await requestJson(`${desktopBaseUrl}/sessions/restore`, {
			token: bridgeConfig.token,
			method: "POST",
			timeoutMs: RESTORE_TIMEOUT_MS,
			body: {
				sessionPath: replaySession.sessionPath,
				browserClientId: client.clientId,
			},
		});
		const restoredTabId = restoreResponse?.restoredPages?.[0]?.tabId || null;
		const captureResult = restoredTabId
			? await bridgeCommand(
					{
						bridgeBaseUrl,
						token: bridgeConfig.token,
						clientId: client.clientId,
					},
					"capture_state",
					{ tabId: restoredTabId },
					CAPTURE_TIMEOUT_MS,
				)
			: null;
		const validation = validateRestore({ restoreResponse, captureResult });
		failures.push(...validation.failures);

		const result = {
			ok: failures.length === 0,
			browserClient: {
				id: client.clientId,
				label: clientLabel(client),
			},
			fixtureUrl: fixture.url,
			sessionPath: replaySession.sessionPath,
			keptSession: args.keepSession,
			restore: {
				restoredCount: restoreResponse?.restoredCount ?? null,
				page: validation.pageSummary,
			},
			capture: {
				annotationCount: validation.annotationCount,
				matchedAnnotationId: validation.matchedAnnotationId,
				matchedNoteId: validation.matchedNoteId,
			},
			failures,
		};

		if (args.json) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			console.log(`Session restore regression: ${result.ok ? "PASS" : "FAIL"}`);
			console.log(`Browser client: ${result.browserClient.label} (${result.browserClient.id})`);
			console.log(`Fixture URL: ${result.fixtureUrl}`);
			console.log(`Restore source: ${result.restore.page?.source || "(missing)"}`);
			console.log(`Restored pages: ${result.restore.restoredCount ?? "(missing)"}`);
			console.log(`Captured annotations: ${result.capture.annotationCount}`);
			if (result.failures.length) {
				console.log("");
				console.log("Failures:");
				for (const failure of result.failures) {
					console.log(`- ${failure}`);
				}
			}
			if (args.keepSession) {
				console.log("");
				console.log(`Session fixture: ${result.sessionPath}`);
			}
		}

		if (!result.ok) process.exitCode = 1;
	} finally {
		await stopFixtureServer(fixture?.server);
		if (replaySession?.tempDir && !args.keepSession) {
			await rm(replaySession.tempDir, { recursive: true, force: true });
		}
	}
}

main().catch((error) => {
	console.error(error?.message || String(error));
	process.exitCode = 1;
});
