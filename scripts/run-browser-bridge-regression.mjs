import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { ONHAND_EXTENSION_RUNTIME_REVISION } from "../packages/browser-extension/runtime-revision.js";
import { pickFixtureMap } from "./show-test-fixtures.mjs";

const CONFIG_PATH = join(homedir(), ".config", "pi-browser-bridge", "config.json");
const DEFAULT_FIXTURE_ID = "onhand_github_repo";
const FAST_TIMEOUT_MS = 3000;
const NAVIGATION_TIMEOUT_MS = 30000;
const ANNOTATION_TIMEOUT_MS = 5000;

function parseArgs(argv) {
	const args = {
		fixtureId: DEFAULT_FIXTURE_ID,
		browserClient: "",
		browserClientId: "",
		expectClientLabel: "",
		assertClientIsolation: true,
		checkRuntimeRevision: true,
		json: false,
		help: false,
	};
	const positionals = [];

	for (const value of argv) {
		if (value === "--help" || value === "-h") {
			args.help = true;
			continue;
		}
		if (value === "--json") {
			args.json = true;
			continue;
		}
		if (value === "--no-client-isolation") {
			args.assertClientIsolation = false;
			continue;
		}
		if (value === "--skip-runtime-check") {
			args.checkRuntimeRevision = false;
			continue;
		}
		if (value.startsWith("--fixture=")) {
			args.fixtureId = value.slice("--fixture=".length).trim();
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
		positionals.push(value);
	}

	if (positionals[0]) args.fixtureId = positionals[0];

	return args;
}

function printUsage() {
	console.log(`Usage: npm run test:browser-bridge -- [options]

Runs direct bridge/browser regression checks without calling the model.

Options:
  --fixture=<id>                    Fixture id from npm run test:fixtures -- --json
  --browser-client=<text>           Match connected browser by label, browser name, or id
  --client-id=<id>                  Exact connected browser client id
  --expect-client-label=<text>      Fail unless the chosen client label/name includes this text
  --no-client-isolation             Do not check that other connected clients stayed unchanged
  --skip-runtime-check              Do not compare running extension runtime revision to source
  --json                            Print machine-readable output

Default fixture: ${DEFAULT_FIXTURE_ID}
Example:
  npm run test:browser-bridge -- --browser-client="Chrome Test" --expect-client-label="Chrome Test"
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
		if (error?.name === "AbortError") {
			throw new Error(`Request timed out: ${url}`);
		}
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

function flattenTabs(state) {
	return (state?.windows || []).flatMap((windowInfo) =>
		(windowInfo.tabs || []).map((tab) => ({
			...tab,
			windowFocused: Boolean(windowInfo.focused),
		})),
	);
}

function pickActiveTab(state) {
	const tabs = flattenTabs(state);
	return (
		tabs.find((tab) => tab.active && tab.windowFocused) ||
		tabs.find((tab) => tab.active) ||
		tabs[0] ||
		null
	);
}

function normalizeComparableUrl(value) {
	try {
		const url = new URL(String(value || ""));
		url.hash = "";
		return url.toString().replace(/\/$/, "");
	} catch {
		return String(value || "").replace(/[#?].*$/, "").replace(/\/$/, "");
	}
}

function urlsMatch(actual, expected) {
	return normalizeComparableUrl(actual) === normalizeComparableUrl(expected);
}

async function getClientState({ bridgeBaseUrl, token, clientId }) {
	const state = await requestJson(`${bridgeBaseUrl}/state?clientId=${encodeURIComponent(clientId)}`, {
		token,
		timeoutMs: FAST_TIMEOUT_MS,
	});
	return state.client?.state || null;
}

async function snapshotOtherClients({ bridgeBaseUrl, token, clients, selectedClientId }) {
	const snapshots = [];
	for (const client of clients) {
		if (client?.clientId === selectedClientId) continue;
		const state = await getClientState({ bridgeBaseUrl, token, clientId: client.clientId });
		const activeTab = pickActiveTab(state);
		snapshots.push({
			clientId: client.clientId,
			label: clientLabel(client),
			activeTabId: activeTab?.id || null,
			activeTabUrl: activeTab?.url || "",
			activeTabTitle: activeTab?.title || "",
		});
	}
	return snapshots;
}

function compareClientSnapshots(before, after) {
	const afterById = new Map(after.map((snapshot) => [snapshot.clientId, snapshot]));
	const changes = [];
	for (const initial of before) {
		const latest = afterById.get(initial.clientId);
		if (!latest) {
			changes.push({
				clientId: initial.clientId,
				label: initial.label,
				before: initial,
				after: null,
				reason: "client disconnected",
			});
			continue;
		}
		if (initial.activeTabId !== latest.activeTabId || initial.activeTabUrl !== latest.activeTabUrl) {
			changes.push({
				clientId: initial.clientId,
				label: initial.label,
				before: initial,
				after: latest,
				reason: "active tab changed",
			});
		}
	}
	return changes;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printUsage();
		return;
	}

	const fixture = pickFixtureMap().get(args.fixtureId);
	if (!fixture) {
		throw new Error(`Unknown fixture id "${args.fixtureId}". Run npm run test:fixtures to list fixtures.`);
	}

	const bridgeConfig = await loadBridgeConfig();
	const bridgeBaseUrl = `http://${bridgeConfig.host}:${bridgeConfig.port}`;
	const clientsResponse = await requestJson(`${bridgeBaseUrl}/clients`, { token: bridgeConfig.token });
	const clients = clientsResponse.clients || [];
	const client = chooseClient(clients, args);
	const failures = [];
	const steps = [];

	if (args.expectClientLabel) {
		const actualLabel = clientLabel(client);
		if (!actualLabel.toLowerCase().includes(args.expectClientLabel.toLowerCase())) {
			failures.push(`Expected selected client label/name to include "${args.expectClientLabel}", found "${actualLabel}".`);
		}
	}

	const otherClientsBefore = args.assertClientIsolation
		? await snapshotOtherClients({
				bridgeBaseUrl,
				token: bridgeConfig.token,
				clients,
				selectedClientId: client.clientId,
			})
		: [];

	async function command(name, commandArgs = {}, timeoutMs = FAST_TIMEOUT_MS) {
		const startedAt = Date.now();
		try {
			const data = await requestJson(`${bridgeBaseUrl}/command`, {
				token: bridgeConfig.token,
				method: "POST",
				timeoutMs: timeoutMs + 1000,
				body: {
					name,
					args: commandArgs,
					timeoutMs,
					clientId: client.clientId,
				},
			});
			const step = {
				name,
				ok: true,
				ms: Date.now() - startedAt,
				error: "",
			};
			steps.push(step);
			return data.result;
		} catch (error) {
			const step = {
				name,
				ok: false,
				ms: Date.now() - startedAt,
				error: error?.message || String(error),
			};
			steps.push(step);
			failures.push(`${name}: ${step.error}`);
			return null;
		}
	}

	const ping = await command("ping", {}, FAST_TIMEOUT_MS);
	if (args.checkRuntimeRevision) {
		const actualRevision = String(ping?.runtimeRevision || client?.hello?.runtimeRevision || "").trim();
		if (actualRevision !== ONHAND_EXTENSION_RUNTIME_REVISION) {
			failures.push(
				`Extension runtime revision mismatch for ${describeClient(client)}. Expected ${ONHAND_EXTENSION_RUNTIME_REVISION}, found ${actualRevision || "(missing)"}; reload the unpacked extension.`,
			);
		}
	}

	const initialState = await getClientState({
		bridgeBaseUrl,
		token: bridgeConfig.token,
		clientId: client.clientId,
	});
	const exactTab = flattenTabs(initialState).find((tab) => tab?.url && urlsMatch(tab.url, fixture.url));
	const targetTab = exactTab
		? await command("activate_tab", { tabId: exactTab.id }, FAST_TIMEOUT_MS)
		: await command(
				"navigate",
				{
					url: fixture.url,
					newTab: true,
					active: true,
					waitForLoad: true,
					timeoutMs: NAVIGATION_TIMEOUT_MS,
				},
				NAVIGATION_TIMEOUT_MS,
			);
	const tab = targetTab?.tab || exactTab;
	if (!tab?.id) {
		failures.push("Could not determine target tab after navigation/activation.");
	} else if (!urlsMatch(tab.url, fixture.url)) {
		failures.push(`Target tab did not settle on fixture URL. Found ${tab.url || "(unknown)"}.`);
	}

	if (tab?.id) {
		await command("clear_annotations", { tabId: tab.id }, FAST_TIMEOUT_MS);
		const scrollResult = await command(
			"run_js",
			{
				tabId: tab.id,
				expression:
					'(() => { const el = [...document.querySelectorAll("h1,h2,h3")].find((node) => node.textContent.includes("Current repository layout")); el?.scrollIntoView({ block: "center" }); return { found: Boolean(el), scrollY: scrollY }; })()',
			},
			FAST_TIMEOUT_MS,
		);
		if (!scrollResult?.result?.found) {
			failures.push('Fixture heading "Current repository layout" was not found.');
		}
		const highlighted = await command(
			"highlight_text",
			{
				tabId: tab.id,
				text: "Current repository layout",
				occurrence: 1,
				clearExisting: false,
				scrollIntoView: true,
			},
			ANNOTATION_TIMEOUT_MS,
		);
		const annotationId = highlighted?.annotation?.annotationId;
		if (!annotationId) {
			failures.push("Heading highlight did not return an annotation id.");
		}
		await command("get_visible_text", { tabId: tab.id, maxChars: 1000, maxBlocks: 8 }, FAST_TIMEOUT_MS);
		if (annotationId) {
			await command(
				"show_note",
				{
					tabId: tab.id,
					annotationId,
					note: "Bridge regression check: heading highlights must return promptly.",
					label: "Regression",
				},
				ANNOTATION_TIMEOUT_MS,
			);
		}
	}

	let isolation = {
		checked: false,
		unchanged: true,
		changes: [],
		before: otherClientsBefore,
		after: [],
	};
	if (args.assertClientIsolation && otherClientsBefore.length > 0) {
		const latestClientsResponse = await requestJson(`${bridgeBaseUrl}/clients`, { token: bridgeConfig.token });
		isolation.after = await snapshotOtherClients({
			bridgeBaseUrl,
			token: bridgeConfig.token,
			clients: latestClientsResponse.clients || [],
			selectedClientId: client.clientId,
		});
		isolation.checked = true;
		isolation.changes = compareClientSnapshots(otherClientsBefore, isolation.after);
		isolation.unchanged = isolation.changes.length === 0;
		if (!isolation.unchanged) {
			failures.push(`${isolation.changes.length} non-target browser client(s) changed active tab during the targeted test.`);
		}
	}

	const result = {
		ok: failures.length === 0,
		fixture: {
			id: fixture.id,
			title: fixture.title,
			url: fixture.url,
		},
		browserClient: {
			id: client.clientId,
			label: clientLabel(client),
			runtimeRevision: ping?.runtimeRevision || client?.hello?.runtimeRevision || "",
			expectedRuntimeRevision: ONHAND_EXTENSION_RUNTIME_REVISION,
		},
		steps,
		isolation,
		failures,
	};

	if (args.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(`Browser bridge regression: ${result.ok ? "PASS" : "FAIL"}`);
		console.log(`Fixture: ${result.fixture.id} - ${result.fixture.title}`);
		console.log(`Browser client: ${result.browserClient.label} (${result.browserClient.id})`);
		console.log(`Runtime revision: ${result.browserClient.runtimeRevision || "(missing)"}`);
		console.log("");
		console.log("Steps:");
		for (const step of result.steps) {
			console.log(`- ${step.name}: ${step.ok ? "OK" : "FAIL"} (${step.ms} ms)${step.error ? ` - ${step.error}` : ""}`);
		}
		if (result.isolation.checked) {
			console.log("");
			console.log(`Other clients unchanged: ${result.isolation.unchanged ? "yes" : "no"}`);
			for (const change of result.isolation.changes) {
				console.log(`- ${change.label} (${change.clientId}): ${change.reason}`);
			}
		}
		if (result.failures.length) {
			console.log("");
			console.log("Failures:");
			for (const failure of result.failures) {
				console.log(`- ${failure}`);
			}
		}
	}

	if (!result.ok) {
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(error?.message || String(error));
	process.exitCode = 1;
});
