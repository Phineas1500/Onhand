import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { inspectLatestTurn, loadSessionEntries } from "./inspect-latest-session.mjs";
import { pickFixtureMap } from "./show-test-fixtures.mjs";

const CONFIG_PATH = join(homedir(), ".config", "pi-browser-bridge", "config.json");
const DEFAULT_FIXTURE_ID = "onhand_github_repo";
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_INTERVAL_MS = 1000;
const FAST_TIMEOUT_MS = 3000;
const NAVIGATION_TIMEOUT_MS = 30000;

function parseArgs(argv) {
	const args = {
		fixtureId: DEFAULT_FIXTURE_ID,
		prompt: "0",
		browserClient: "",
		browserClientId: "",
		timeoutMs: DEFAULT_TIMEOUT_MS,
		intervalMs: DEFAULT_INTERVAL_MS,
		navigationTimeoutMs: NAVIGATION_TIMEOUT_MS,
		navigate: true,
		newTab: true,
		reuseExistingTab: true,
		startNewSession: true,
		learningMode: false,
		json: false,
		minPageActions: 0,
		allowToolErrors: false,
		expectProvider: "",
		expectModel: "",
		expectApi: "",
		expectReplyIncludes: [],
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
		if (value === "--no-navigate") {
			args.navigate = false;
			continue;
		}
		if (value === "--reuse-tab") {
			args.reuseExistingTab = false;
			args.newTab = false;
			continue;
		}
		if (value === "--always-new-tab") {
			args.reuseExistingTab = false;
			args.newTab = true;
			continue;
		}
		if (value === "--continue") {
			args.startNewSession = false;
			continue;
		}
		if (value === "--learning-mode") {
			args.learningMode = true;
			continue;
		}
		if (value === "--expect-actions" || value === "--expect-page-actions") {
			args.minPageActions = Math.max(args.minPageActions, 1);
			continue;
		}
		if (value === "--allow-tool-errors") {
			args.allowToolErrors = true;
			continue;
		}
		if (value.startsWith("--fixture=")) {
			args.fixtureId = value.slice("--fixture=".length).trim();
			continue;
		}
		if (value.startsWith("--prompt=")) {
			args.prompt = value.slice("--prompt=".length);
			continue;
		}
		if (value.startsWith("--prompt-index=")) {
			args.prompt = value.slice("--prompt-index=".length);
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
		if (value.startsWith("--timeout-ms=")) {
			args.timeoutMs = parsePositiveInt(value.slice("--timeout-ms=".length), args.timeoutMs);
			continue;
		}
		if (value.startsWith("--interval-ms=")) {
			args.intervalMs = parsePositiveInt(value.slice("--interval-ms=".length), args.intervalMs);
			continue;
		}
		if (value.startsWith("--navigation-timeout-ms=")) {
			args.navigationTimeoutMs = parsePositiveInt(value.slice("--navigation-timeout-ms=".length), args.navigationTimeoutMs);
			continue;
		}
		if (value.startsWith("--min-page-actions=")) {
			args.minPageActions = parsePositiveInt(value.slice("--min-page-actions=".length), args.minPageActions);
			continue;
		}
		if (value.startsWith("--expect-reply-includes=")) {
			const expected = value.slice("--expect-reply-includes=".length).trim();
			if (expected) args.expectReplyIncludes.push(expected);
			continue;
		}
		if (value.startsWith("--expect-provider=")) {
			args.expectProvider = value.slice("--expect-provider=".length).trim();
			continue;
		}
		if (value.startsWith("--expect-model=")) {
			args.expectModel = value.slice("--expect-model=".length).trim();
			continue;
		}
		if (value.startsWith("--expect-api=")) {
			args.expectApi = value.slice("--expect-api=".length).trim();
			continue;
		}
		if (value.startsWith("--")) {
			throw new Error(`Unknown option: ${value}`);
		}
		positionals.push(value);
	}

	if (positionals[0]) args.fixtureId = positionals[0];
	if (positionals[1]) args.prompt = positionals.slice(1).join(" ");

	return args;
}

function parsePositiveInt(value, fallback) {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function printUsage() {
	console.log(`Usage: npm run smoke:tier2 -- [options]

Runs a desktop/API Tier 2 smoke against a known fixture and inspects the saved session.

Options:
  --fixture=<id>                  Fixture id from npm run test:fixtures -- --json
  --prompt=<index-or-text>         Fixture prompt index or custom prompt text
  --browser-client=<text>          Match connected browser by label, browser name, or id
  --client-id=<id>                 Exact connected browser client id
  --no-navigate                    Do not navigate before submitting the prompt
  --always-new-tab                 Always open a new fixture tab, even if one exists
  --reuse-tab                      Navigate the active tab instead of opening a new tab
  --continue                       Use the current launcher session instead of creating a fresh one
  --learning-mode                  Submit with Learning Mode enabled
  --expect-actions                 Fail unless at least one page action/artifact is recorded
  --min-page-actions=<n>           Fail unless at least n page actions/artifacts are recorded
  --expect-reply-includes=<text>   Fail unless the final reply contains this text
  --expect-provider=<provider>     Fail unless the session used this provider
  --expect-model=<model>           Fail unless the session used this model id
  --expect-api=<api>               Fail unless the session used this pi model API
  --allow-tool-errors              Do not fail on browser tool errors
  --timeout-ms=<n>                 Wait timeout for the final reply
  --json                           Print machine-readable output

Default fixture: ${DEFAULT_FIXTURE_ID}
If more than one browser client is connected, pass --browser-client or --client-id.
Example: npm run smoke:tier2 -- --fixture=onhand_github_repo --prompt=0 --expect-actions
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
		const data = await response.json();
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

function resolvePrompt(fixture, promptSpec) {
	const prompts = Array.isArray(fixture.prompts) ? fixture.prompts : [];
	const spec = String(promptSpec ?? "").trim();
	if (!spec) {
		return prompts[0] || `Use this page to answer the main question.`;
	}
	if (/^\d+$/.test(spec)) {
		const index = Number.parseInt(spec, 10);
		if (!prompts[index]) {
			throw new Error(`Fixture ${fixture.id} has no prompt at index ${index}.`);
		}
		return prompts[index];
	}
	return spec;
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

function describeClient(client) {
	const label = client?.hello?.clientLabel || client?.hello?.browserName || "Browser";
	const tabs = Number(client?.stateSummary?.tabCount || 0);
	return `${label} (${client?.clientId || "unknown id"}, ${tabs} tab${tabs === 1 ? "" : "s"})`;
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

function findExactUrlTabs(state, url) {
	return flattenTabs(state).filter((tab) => tab?.url && urlsMatch(tab.url, url));
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

function appendClientId(path, clientId) {
	if (!clientId) return path;
	const separator = path.includes("?") ? "&" : "?";
	return `${path}${separator}clientId=${encodeURIComponent(clientId)}`;
}

async function sleep(ms) {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForActiveTabUrl({ bridgeBaseUrl, token, clientId, url, timeoutMs = 8000, intervalMs = 500 }) {
	const startedAt = Date.now();
	let latestTab = null;
	while (Date.now() - startedAt <= timeoutMs) {
		const state = await requestJson(`${bridgeBaseUrl}${appendClientId("/state", clientId)}`, {
			token,
			timeoutMs: FAST_TIMEOUT_MS,
		});
		latestTab = pickActiveTab(state.client?.state);
		if (latestTab?.url && urlsMatch(latestTab.url, url)) {
			return latestTab;
		}
		await sleep(intervalMs);
	}
	return latestTab;
}

async function getClientState({ bridgeBaseUrl, token, clientId }) {
	const state = await requestJson(`${bridgeBaseUrl}${appendClientId("/state", clientId)}`, {
		token,
		timeoutMs: FAST_TIMEOUT_MS,
	});
	return state.client?.state || null;
}

async function getCurrentSessionPath(desktopBaseUrl, token) {
	const state = await requestJson(`${desktopBaseUrl}/state`, { token });
	return state.state?.currentSession?.sessionFile || null;
}

async function startFreshSession(desktopBaseUrl, token) {
	const result = await requestJson(`${desktopBaseUrl}/sessions/new`, {
		token,
		method: "POST",
		body: {},
	});
	return result.currentSession?.sessionFile || null;
}

function latestTurnMatchesPrompt(turn, prompt) {
	if (!turn) return false;
	const userPrompt = String(turn.userPrompt || "").trim();
	return userPrompt === prompt || userPrompt.includes(prompt) || prompt.includes(userPrompt);
}

async function waitForPromptTurn(sessionPath, prompt, { timeoutMs, intervalMs }) {
	const startedAt = Date.now();
	let latestReport = null;
	while (Date.now() - startedAt <= timeoutMs) {
		try {
			const report = inspectLatestTurn(await loadSessionEntries(sessionPath), sessionPath);
			if (report.latestTurn) {
				latestReport = report;
				if (latestTurnMatchesPrompt(report.latestTurn, prompt)) {
					if (report.latestTurn.isComplete || report.latestTurn.isStopped) return report;
				}
			}
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
		await sleep(intervalMs);
	}
	return latestReport;
}

function truncate(value, maxChars = 220) {
	const text = String(value || "").replace(/\s+/g, " ").trim();
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars - 1)}…`;
}

function validateReport(report, args, prompt) {
	const failures = [];
	const turn = report?.latestTurn || null;
	if (!turn) {
		failures.push("No user turn was written to the session.");
		return failures;
	}
	if (!latestTurnMatchesPrompt(turn, prompt)) {
		failures.push("The latest session turn does not match the submitted prompt.");
	}
	if (!turn.finalReply) {
		failures.push(turn.isStopped ? `Turn stopped without a final reply (${turn.stopReason || "stopped"}).` : "Timed out before a final reply was written.");
	}
	if (!args.allowToolErrors && turn.errors.length > 0) {
		failures.push(`${turn.errors.length} browser tool error(s) were recorded.`);
	}
	if (turn.pageActions.length < args.minPageActions) {
		failures.push(`Expected at least ${args.minPageActions} page action(s), found ${turn.pageActions.length}.`);
	}
	if (args.expectProvider && turn.model?.provider !== args.expectProvider) {
		failures.push(`Expected provider ${args.expectProvider}, found ${turn.model?.provider || "(unknown)"}.`);
	}
	if (args.expectModel && turn.model?.modelId !== args.expectModel) {
		failures.push(`Expected model ${args.expectModel}, found ${turn.model?.modelId || "(unknown)"}.`);
	}
	if (args.expectApi && turn.model?.api !== args.expectApi) {
		failures.push(`Expected model API ${args.expectApi}, found ${turn.model?.api || "(unknown)"}.`);
	}
	for (const expected of args.expectReplyIncludes) {
		if (!String(turn.finalReply || "").toLowerCase().includes(expected.toLowerCase())) {
			failures.push(`Final reply did not include expected text: ${expected}`);
		}
	}
	return failures;
}

function buildResult({ args, fixture, prompt, bridgeBaseUrl, desktopBaseUrl, client, navigatedTab, activeTabAfterNavigate, promptResponse, sessionPath, report, failures }) {
	return {
		ok: failures.length === 0,
		fixture: {
			id: fixture.id,
			title: fixture.title,
			url: fixture.url,
		},
		prompt,
		bridgeBaseUrl,
		desktopBaseUrl,
		browserClient: {
			id: client.clientId,
			label: client.hello?.clientLabel || client.hello?.browserName || "Browser",
		},
		navigation: args.navigate
			? {
					requestedUrl: fixture.url,
					newTab: args.newTab,
					navigatedTab,
					activeTabAfterNavigate,
				}
			: null,
		requestId: promptResponse?.requestId || null,
		sessionPath,
		report,
		failures,
	};
}

function printHumanReadable(result) {
	console.log(`Tier 2 smoke: ${result.ok ? "PASS" : "FAIL"}`);
	console.log(`Fixture: ${result.fixture.id} - ${result.fixture.title}`);
	console.log(`Prompt: ${result.prompt}`);
	console.log(`Browser client: ${result.browserClient.label} (${result.browserClient.id})`);
	if (result.navigation) {
		const tab = result.navigation.activeTabAfterNavigate || result.navigation.navigatedTab?.tab || result.navigation.navigatedTab;
		console.log(`Navigated: ${tab?.title || "(untitled)"} - ${tab?.url || result.navigation.requestedUrl}`);
	}
	console.log(`Session: ${result.sessionPath || "(unknown)"}`);
	if (result.requestId) console.log(`Request: ${result.requestId}`);

	const turn = result.report?.latestTurn || null;
	if (turn?.model?.provider || turn?.model?.modelId || turn?.model?.api) {
		const providerModel = [turn.model.provider, turn.model.modelId].filter(Boolean).join("/");
		const api = turn.model.api ? ` via ${turn.model.api}` : "";
		console.log(`Model: ${providerModel || "(unknown)"}${api}`);
	}
	console.log("");
	console.log(`Final reply: ${turn?.finalReply ? truncate(turn.finalReply, 320) : "(none)"}`);
	console.log(`Page actions: ${turn?.pageActions?.length || 0}`);
	for (const action of turn?.pageActions || []) {
		console.log(`- ${action.label}: ${truncate(action.detail, 180)}`);
	}
	if (turn?.errors?.length) {
		console.log("Tool errors:");
		for (const error of turn.errors) {
			console.log(`- ${error.label}: ${truncate(error.detail, 180)}`);
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
	const prompt = resolvePrompt(fixture, args.prompt);
	const bridgeConfig = await loadBridgeConfig();
	const bridgeBaseUrl = `http://${bridgeConfig.host}:${bridgeConfig.port}`;
	const desktopBaseUrl = `http://${bridgeConfig.host}:${process.env.ONHAND_UI_PORT || 3211}`;

	await requestJson(`${bridgeBaseUrl}/health`, { token: bridgeConfig.token });
	await requestJson(`${desktopBaseUrl}/health`, { token: bridgeConfig.token });
	const clientsResponse = await requestJson(`${bridgeBaseUrl}/clients`, { token: bridgeConfig.token });
	const client = chooseClient(clientsResponse.clients, args);

	let navigatedTab = null;
	let activeTabAfterNavigate = null;
	if (args.navigate) {
		const state = args.reuseExistingTab
			? await getClientState({ bridgeBaseUrl, token: bridgeConfig.token, clientId: client.clientId })
			: null;
		const exactTabs = args.reuseExistingTab ? findExactUrlTabs(state, fixture.url) : [];
		if (exactTabs.length > 1) {
			const matches = exactTabs.map((tab) => `- ${tab.id}: ${tab.title || "(untitled)"}`).join("\n");
			throw new Error(`Multiple exact fixture tabs are already open. Close duplicates or use another fixture before running this smoke.\n${matches}`);
		}
		if (exactTabs.length === 1) {
			navigatedTab = await requestJson(`${bridgeBaseUrl}/command`, {
				token: bridgeConfig.token,
				method: "POST",
				timeoutMs: 5000,
				body: {
					name: "activate_tab",
					clientId: client.clientId,
					timeoutMs: 2500,
					args: {
						tabId: exactTabs[0].id,
					},
				},
			});
			activeTabAfterNavigate = navigatedTab?.result?.tab || exactTabs[0];
		} else {
			navigatedTab = await requestJson(`${bridgeBaseUrl}/command`, {
				token: bridgeConfig.token,
				method: "POST",
				timeoutMs: args.navigationTimeoutMs + 5000,
				body: {
					name: "navigate",
					clientId: client.clientId,
					timeoutMs: args.navigationTimeoutMs,
					args: {
						url: fixture.url,
						newTab: args.newTab,
						active: true,
						waitForLoad: true,
						timeoutMs: args.navigationTimeoutMs,
					},
				},
			});
		}
		activeTabAfterNavigate = await waitForActiveTabUrl({
			bridgeBaseUrl,
			token: bridgeConfig.token,
			clientId: client.clientId,
			url: fixture.url,
		});
	}

	const sessionPath = args.startNewSession
		? await startFreshSession(desktopBaseUrl, bridgeConfig.token)
		: await getCurrentSessionPath(desktopBaseUrl, bridgeConfig.token);
	if (!sessionPath) {
		throw new Error("Could not determine the desktop session path.");
	}

	const promptResponse = await requestJson(`${desktopBaseUrl}/prompt`, {
		token: bridgeConfig.token,
		method: "POST",
		body: {
			prompt,
			displayPrompt: prompt,
			source: "desktop",
			browserClientId: client.clientId,
			learningMode: args.learningMode,
		},
	});

	const report = await waitForPromptTurn(sessionPath, prompt, {
		timeoutMs: args.timeoutMs,
		intervalMs: args.intervalMs,
	});
	const failures = validateReport(report, args, prompt);
	if (args.navigate && !urlsMatch(activeTabAfterNavigate?.url, fixture.url)) {
		failures.unshift(`Browser active tab did not settle on fixture URL. Last active URL: ${activeTabAfterNavigate?.url || "(unknown)"}`);
	}
	const result = buildResult({
		args,
		fixture,
		prompt,
		bridgeBaseUrl,
		desktopBaseUrl,
		client,
		navigatedTab: navigatedTab?.result || navigatedTab,
		activeTabAfterNavigate,
		promptResponse,
		sessionPath,
		report,
		failures,
	});

	if (args.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		printHumanReadable(result);
	}
	if (!result.ok) {
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(error?.message || String(error));
	process.exitCode = 1;
});
