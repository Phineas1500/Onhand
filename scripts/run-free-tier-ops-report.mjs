import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_DATASET = "onhand_events";
const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 20;
const DEFAULT_OUT_DIR = "tmp/free-tier-ops";
const API_BASE = "https://api.cloudflare.com/client/v4";
const DEFAULT_HEALTH_SOURCES = ["free-tier", "extension"];
const SESSION_CLI = fileURLToPath(new URL("./dump-onhand-sessions.mjs", import.meta.url));
const DEFAULT_THRESHOLDS = {
	maxDailyCostUsd: 1,
	maxAvgCostUsd: 0.01,
	maxPromptFailures: 0,
	maxProviderErrors: 0,
	maxQuotaDenials: 0,
	maxFinalToolFailures: 0,
	maxRecoveredToolFailures: 5,
	maxBrowserRunJsFailures: 0,
	maxBrowserRunJsEvents: 10,
	maxHeavyTurns: 5,
};

function parseArgs(argv) {
	const args = {
		accountId: process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || "",
		apiTokenEnv: "CLOUDFLARE_API_TOKEN",
		check: false,
		dataset: DEFAULT_DATASET,
		days: DEFAULT_DAYS,
		dryRun: false,
		failOnAlert: false,
		failOnCritical: false,
		healthSources: parseSourceList(process.env.FREE_TIER_HEALTH_SOURCES, DEFAULT_HEALTH_SOURCES),
		json: false,
		limit: DEFAULT_LIMIT,
		outDir: DEFAULT_OUT_DIR,
		printSql: false,
		testDeviceHashes: parseIdentifierList(process.env.FREE_TIER_TEST_DEVICE_HASHES, [], "test device hash"),
		thresholds: buildDefaultThresholds(),
	};
	for (const value of argv) {
		if (value === "--check") {
			args.check = true;
			continue;
		}
		if (value === "--dry-run") {
			args.dryRun = true;
			continue;
		}
		if (value === "--fail-on-alert") {
			args.check = true;
			args.failOnAlert = true;
			continue;
		}
		if (value === "--fail-on-critical") {
			args.check = true;
			args.failOnCritical = true;
			continue;
		}
		if (value === "--json") {
			args.json = true;
			continue;
		}
		if (value === "--print-sql") {
			args.printSql = true;
			continue;
		}
		if (value.startsWith("--account-id=")) {
			args.accountId = value.slice("--account-id=".length).trim();
			continue;
		}
		if (value.startsWith("--api-token-env=")) {
			args.apiTokenEnv = value.slice("--api-token-env=".length).trim();
			continue;
		}
		if (value.startsWith("--dataset=")) {
			args.dataset = value.slice("--dataset=".length).trim();
			continue;
		}
		if (value.startsWith("--health-sources=")) {
			args.healthSources = parseSourceList(value.slice("--health-sources=".length), DEFAULT_HEALTH_SOURCES);
			continue;
		}
		if (value.startsWith("--test-device-hashes=")) {
			args.testDeviceHashes = parseIdentifierList(value.slice("--test-device-hashes=".length), [], "test device hash");
			continue;
		}
		if (value.startsWith("--days=")) {
			args.days = parsePositiveInt(value, "--days=");
			continue;
		}
		if (value.startsWith("--limit=")) {
			args.limit = parsePositiveInt(value, "--limit=");
			continue;
		}
		if (value.startsWith("--out-dir=")) {
			args.outDir = value.slice("--out-dir=".length).trim();
			continue;
		}
		if (value.startsWith("--max-daily-cost=")) {
			args.thresholds.maxDailyCostUsd = parseNonNegativeNumber(value, "--max-daily-cost=");
			continue;
		}
		if (value.startsWith("--max-avg-cost=")) {
			args.thresholds.maxAvgCostUsd = parseNonNegativeNumber(value, "--max-avg-cost=");
			continue;
		}
		if (value.startsWith("--max-prompt-failures=")) {
			args.thresholds.maxPromptFailures = parseNonNegativeNumber(value, "--max-prompt-failures=");
			continue;
		}
		if (value.startsWith("--max-provider-errors=")) {
			args.thresholds.maxProviderErrors = parseNonNegativeNumber(value, "--max-provider-errors=");
			continue;
		}
		if (value.startsWith("--max-quota-denials=")) {
			args.thresholds.maxQuotaDenials = parseNonNegativeNumber(value, "--max-quota-denials=");
			continue;
		}
		if (value.startsWith("--max-final-tool-failures=")) {
			args.thresholds.maxFinalToolFailures = parseNonNegativeNumber(value, "--max-final-tool-failures=");
			continue;
		}
		if (value.startsWith("--max-recovered-tool-failures=")) {
			args.thresholds.maxRecoveredToolFailures = parseNonNegativeNumber(value, "--max-recovered-tool-failures=");
			continue;
		}
		if (value.startsWith("--max-browser-run-js-failures=")) {
			args.thresholds.maxBrowserRunJsFailures = parseNonNegativeNumber(value, "--max-browser-run-js-failures=");
			continue;
		}
		if (value.startsWith("--max-browser-run-js-events=")) {
			args.thresholds.maxBrowserRunJsEvents = parseNonNegativeNumber(value, "--max-browser-run-js-events=");
			continue;
		}
		if (value.startsWith("--max-heavy-turns=")) {
			args.thresholds.maxHeavyTurns = parseNonNegativeNumber(value, "--max-heavy-turns=");
			continue;
		}
		if (value === "--help" || value === "-h") {
			printUsage();
			process.exit(0);
		}
		throw new Error(`Unknown option: ${value}`);
	}
	validateIdentifier(args.dataset, "dataset");
	return args;
}

function printUsage() {
	console.log(`Usage: npm run ops:free-tier -- [options]

Builds a Cloudflare Analytics Engine operations report for Onhand Free.

Required for live mode:
  CLOUDFLARE_ACCOUNT_ID          Cloudflare account id, or pass --account-id
  CLOUDFLARE_API_TOKEN           Token with Account Analytics Read permission

Options:
  --check                        Evaluate default health thresholds
  --fail-on-critical             Exit 1 when critical checks fail
  --fail-on-alert                Exit 1 when warning or critical checks fail
  --dry-run                      Print the report plan without network calls
  --print-sql                    Print SQL queries
  --json                         Print summary JSON
  --dataset=<name>               Analytics Engine dataset/table name
  --health-sources=<csv>         Sources used for summaries/checks; default ${DEFAULT_HEALTH_SOURCES.join(",")}
  --test-device-hashes=<csv>     Device hashes whose quota denials are classified as test cap hits.
                                  Use "auto" to read the current local Onhand Free device hash.
  --days=<n>                     Lookback window
  --limit=<n>                    Max rows for top-N sections
  --out-dir=<path>               Output directory for JSON and Markdown reports
  --account-id=<id>              Cloudflare account id
  --api-token-env=<name>         Environment variable containing the API token

Threshold options:
  --max-daily-cost=<usd>         Default ${DEFAULT_THRESHOLDS.maxDailyCostUsd}
  --max-avg-cost=<usd>           Default ${DEFAULT_THRESHOLDS.maxAvgCostUsd}
  --max-prompt-failures=<n>      Default ${DEFAULT_THRESHOLDS.maxPromptFailures}
  --max-provider-errors=<n>      Default ${DEFAULT_THRESHOLDS.maxProviderErrors}
  --max-quota-denials=<n>        Default ${DEFAULT_THRESHOLDS.maxQuotaDenials}
  --max-final-tool-failures=<n>  Default ${DEFAULT_THRESHOLDS.maxFinalToolFailures}
  --max-recovered-tool-failures=<n>
                                  Default ${DEFAULT_THRESHOLDS.maxRecoveredToolFailures}
  --max-browser-run-js-failures=<n>
                                  Default ${DEFAULT_THRESHOLDS.maxBrowserRunJsFailures}
  --max-browser-run-js-events=<n>
                                  Default ${DEFAULT_THRESHOLDS.maxBrowserRunJsEvents}
  --max-heavy-turns=<n>          Default ${DEFAULT_THRESHOLDS.maxHeavyTurns}

Threshold env overrides:
  FREE_TIER_HEALTH_SOURCES
  FREE_TIER_TEST_DEVICE_HASHES
  FREE_TIER_ALERT_MAX_DAILY_COST_USD
  FREE_TIER_ALERT_MAX_AVG_COST_USD
  FREE_TIER_ALERT_MAX_PROMPT_FAILURES
  FREE_TIER_ALERT_MAX_PROVIDER_ERRORS
  FREE_TIER_ALERT_MAX_QUOTA_DENIALS
  FREE_TIER_ALERT_MAX_FINAL_TOOL_FAILURES
  FREE_TIER_ALERT_MAX_RECOVERED_TOOL_FAILURES
  FREE_TIER_ALERT_MAX_BROWSER_RUN_JS_FAILURES
  FREE_TIER_ALERT_MAX_BROWSER_RUN_JS_EVENTS
  FREE_TIER_ALERT_MAX_HEAVY_TURNS
`);
}

function buildDefaultThresholds() {
	return {
		maxDailyCostUsd: readThresholdEnv("FREE_TIER_ALERT_MAX_DAILY_COST_USD", DEFAULT_THRESHOLDS.maxDailyCostUsd),
		maxAvgCostUsd: readThresholdEnv("FREE_TIER_ALERT_MAX_AVG_COST_USD", DEFAULT_THRESHOLDS.maxAvgCostUsd),
		maxPromptFailures: readThresholdEnv("FREE_TIER_ALERT_MAX_PROMPT_FAILURES", DEFAULT_THRESHOLDS.maxPromptFailures),
		maxProviderErrors: readThresholdEnv("FREE_TIER_ALERT_MAX_PROVIDER_ERRORS", DEFAULT_THRESHOLDS.maxProviderErrors),
		maxQuotaDenials: readThresholdEnv("FREE_TIER_ALERT_MAX_QUOTA_DENIALS", DEFAULT_THRESHOLDS.maxQuotaDenials),
		maxFinalToolFailures: readThresholdEnv("FREE_TIER_ALERT_MAX_FINAL_TOOL_FAILURES", DEFAULT_THRESHOLDS.maxFinalToolFailures),
		maxRecoveredToolFailures: readThresholdEnv("FREE_TIER_ALERT_MAX_RECOVERED_TOOL_FAILURES", DEFAULT_THRESHOLDS.maxRecoveredToolFailures),
		maxBrowserRunJsFailures: readThresholdEnv("FREE_TIER_ALERT_MAX_BROWSER_RUN_JS_FAILURES", DEFAULT_THRESHOLDS.maxBrowserRunJsFailures),
		maxBrowserRunJsEvents: readThresholdEnv("FREE_TIER_ALERT_MAX_BROWSER_RUN_JS_EVENTS", DEFAULT_THRESHOLDS.maxBrowserRunJsEvents),
		maxHeavyTurns: readThresholdEnv("FREE_TIER_ALERT_MAX_HEAVY_TURNS", DEFAULT_THRESHOLDS.maxHeavyTurns),
	};
}

function readThresholdEnv(name, fallback) {
	const rawValue = process.env[name];
	if (!rawValue) return fallback;
	const parsed = Number.parseFloat(rawValue);
	if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`);
	return parsed;
}

function parsePositiveInt(value, prefix) {
	const parsed = Number.parseInt(value.slice(prefix.length), 10);
	if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${prefix.slice(2, -1)} must be a positive integer`);
	return parsed;
}

function parseNonNegativeNumber(value, prefix) {
	const parsed = Number.parseFloat(value.slice(prefix.length));
	if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${prefix.slice(2, -1)} must be a non-negative number`);
	return parsed;
}

function parseSourceList(value, fallback) {
	return parseIdentifierList(value, fallback, "health source");
}

function parseIdentifierList(value, fallback, label) {
	const values = String(value || "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	const selected = values.length ? values : fallback;
	for (const entry of selected) {
		if (!/^[A-Za-z0-9_.:-]+$/.test(entry)) throw new Error(`Invalid ${label}: ${entry}`);
	}
	return selected;
}

function validateIdentifier(value, label) {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Invalid ${label}: ${value}`);
}

function buildQueries({ dataset, days, limit }) {
	const where = `timestamp >= NOW() - INTERVAL '${days}' DAY`;
	const sourceExpr = `if(blob2 = '', 'unknown', blob2)`;
	const chatEvents = [
		"chat_upstream_response",
		"chat_upstream_retry",
		"chat_stream_complete",
		"chat_stream_error",
		"chat_stream_cancelled",
		"chat_request_rejected",
		"chat_quota_denied",
		"chat_turn_quota_denied",
		"chat_cost_quota_denied",
	];
	const queryList = [
		{
			name: "overview",
			description: "Total sampled events and time coverage.",
			sql: `
SELECT
  SUM(_sample_interval) AS events,
  MIN(timestamp) AS first_seen,
  MAX(timestamp) AS last_seen
FROM ${dataset}
WHERE ${where}`,
		},
		{
			name: "event_counts",
			description: "All event names by sampled count.",
			sql: `
SELECT
  blob1 AS event,
  SUM(_sample_interval) AS events
FROM ${dataset}
WHERE ${where}
GROUP BY event
ORDER BY events DESC
LIMIT ${limit}`,
		},
		{
			name: "source_counts",
			description: "Sampled event counts by telemetry source.",
			sql: `
SELECT
  ${sourceExpr} AS source,
  blob1 AS event,
  SUM(_sample_interval) AS events
FROM ${dataset}
WHERE ${where}
GROUP BY source, event
ORDER BY source, events DESC
LIMIT ${limit}`,
		},
		{
			name: "chat_latency",
			description: "Request and stream latency by chat event/result.",
			sql: `
SELECT
  ${sourceExpr} AS source,
  blob1 AS event,
  blob3 AS result,
  SUM(_sample_interval) AS events,
  SUM(_sample_interval * double3) / SUM(_sample_interval) AS avg_ms,
  QUANTILEEXACTWEIGHTED(0.50)(double3, _sample_interval) AS p50_ms,
  QUANTILEEXACTWEIGHTED(0.95)(double3, _sample_interval) AS p95_ms,
  SUM(_sample_interval * double4) / SUM(_sample_interval) AS avg_body_bytes
FROM ${dataset}
WHERE ${where}
  AND blob1 IN (${quotedList(chatEvents)})
  AND double3 > 0
GROUP BY source, event, result
ORDER BY source, event, result`,
		},
		{
			name: "chat_cost",
			description: "Completion tokens and OpenRouter reported/forwarded cost.",
			sql: `
SELECT
  ${sourceExpr} AS source,
  SUM(_sample_interval) AS completions,
  SUM(_sample_interval * double7) AS prompt_tokens,
  SUM(_sample_interval * double8) AS completion_tokens,
  SUM(_sample_interval * double9) AS total_tokens,
  SUM(_sample_interval * double10) AS total_cost,
  SUM(_sample_interval * double10) / SUM(_sample_interval) AS avg_cost,
  SUM(_sample_interval * double9) / SUM(_sample_interval) AS avg_tokens
FROM ${dataset}
WHERE ${where}
  AND blob1 = 'chat_stream_complete'
GROUP BY source
ORDER BY completions DESC`,
		},
		{
			name: "usage_devices",
			description: "Device-level free-tier usage signals for real-user estimates.",
			sql: `
SELECT
  blob14 AS device_hash,
  ${sourceExpr} AS source,
  blob1 AS event,
  if(blob11 = '', 'unknown', blob11) AS auth_mode,
  if(blob12 = '', 'unknown', blob12) AS ai_provider,
  if(blob13 = '', 'unknown', blob13) AS ai_model,
  if(blob16 = '', 'unknown', blob16) AS turn_id,
  blob17 AS session_id,
  SUM(_sample_interval) AS events,
  MIN(timestamp) AS first_seen,
  MAX(timestamp) AS last_seen
FROM ${dataset}
WHERE ${where}
  AND blob14 != ''
  AND blob1 IN (
    'chat_stream_complete',
    'chat_quota_denied',
    'prompt_submitted',
    'prompt_succeeded',
    'prompt_failed',
    'prompt_stopped',
    'session_started',
    'register_success'
  )
GROUP BY device_hash, source, event, auth_mode, ai_provider, ai_model, turn_id, session_id
ORDER BY device_hash, source, event`,
		},
		{
			name: "model_provider_health",
			description: "Model/provider routing, errors, latency, cost, and tokens by chat event.",
			sql: `
SELECT
  ${sourceExpr} AS source,
  blob1 AS event,
  blob4 AS model,
  blob5 AS provider,
  blob3 AS result,
  SUM(_sample_interval) AS events,
  SUM(_sample_interval * double10) AS cost,
  SUM(_sample_interval * double9) AS total_tokens,
  SUM(_sample_interval * double3) / SUM(_sample_interval) AS avg_ms,
  QUANTILEEXACTWEIGHTED(0.95)(double3, _sample_interval) AS p95_ms
FROM ${dataset}
WHERE ${where}
  AND blob1 IN ('chat_upstream_response', 'chat_stream_complete', 'chat_stream_error')
GROUP BY source, event, model, provider, result
ORDER BY source, event, events DESC
LIMIT ${limit}`,
		},
		{
			name: "upstream_retries",
			description: "Recovered upstream model/provider failures that were retried before returning to the user.",
			sql: `
SELECT
  ${sourceExpr} AS source,
  blob4 AS model,
  blob5 AS provider,
  blob15 AS error_code,
  if(blob16 = '', 'unknown', blob16) AS turn_id,
  blob17 AS session_id,
  blob14 AS device_hash,
  SUM(_sample_interval) AS events,
  MAX(timestamp) AS last_seen
FROM ${dataset}
WHERE ${where}
  AND blob1 = 'chat_upstream_retry'
GROUP BY source, model, provider, error_code, turn_id, session_id, device_hash
ORDER BY events DESC, last_seen DESC
LIMIT ${limit}`,
		},
		{
			name: "turn_costs",
			description: "Per Onhand turn cost, tokens, latency, and model-call count.",
			sql: `
SELECT
  ${sourceExpr} AS source,
  if(blob16 = '', 'unknown', blob16) AS turn_id,
  blob17 AS session_id,
  blob4 AS model,
  blob5 AS provider,
  SUM(_sample_interval) AS model_calls,
  SUM(_sample_interval * double10) AS cost,
  SUM(_sample_interval * double9) AS total_tokens,
  SUM(_sample_interval * double7) AS prompt_tokens,
  SUM(_sample_interval * double8) AS completion_tokens,
  SUM(_sample_interval * double3) AS total_ms,
  MAX(timestamp) AS last_seen
FROM ${dataset}
WHERE ${where}
  AND blob1 = 'chat_stream_complete'
GROUP BY source, turn_id, session_id, model, provider
ORDER BY cost DESC, model_calls DESC
LIMIT ${limit}`,
		},
		{
			name: "quota_and_rejections",
			description: "Quota denials, rejected requests, and rate-limited diagnostics.",
			sql: `
SELECT
  ${sourceExpr} AS source,
  blob1 AS event,
  blob15 AS error_code,
  if(blob16 = '', 'unknown', blob16) AS turn_id,
  blob17 AS session_id,
  blob14 AS device_hash,
  SUM(_sample_interval) AS events,
  MAX(double5) AS max_current,
  MAX(double6) AS cap,
  MAX(timestamp) AS last_seen
FROM ${dataset}
WHERE ${where}
  AND blob1 IN (
    'chat_quota_denied',
    'chat_turn_quota_denied',
    'chat_cost_quota_denied',
    'chat_request_rejected',
    'telemetry_rate_limited',
    'telemetry_rejected',
    'error_report_rate_limited',
    'error_report_rejected'
  )
GROUP BY source, event, error_code, turn_id, session_id, device_hash
ORDER BY events DESC, last_seen DESC
LIMIT ${limit}`,
		},
		{
			name: "guardrail_events",
			description: "Free-tier cost and heavy-turn guardrails.",
			sql: `
SELECT
  ${sourceExpr} AS source,
  blob1 AS event,
  blob3 AS result,
  blob15 AS reason,
  blob4 AS model,
  blob5 AS provider,
  SUM(_sample_interval) AS events,
  MAX(double5) AS max_current,
  MAX(double6) AS cap,
  SUM(_sample_interval * double10) AS cost,
  SUM(_sample_interval * double9) AS total_tokens,
  MAX(double11) AS max_turn_model_calls
FROM ${dataset}
WHERE ${where}
  AND blob1 IN ('free_tier_heavy_turn', 'chat_turn_quota_denied', 'chat_cost_quota_denied')
GROUP BY source, event, result, reason, model, provider
ORDER BY events DESC
LIMIT ${limit}`,
		},
		{
			name: "top_errors",
			description: "Provider/runtime error codes by event.",
			sql: `
SELECT
  ${sourceExpr} AS source,
  blob1 AS event,
  blob4 AS model,
  blob15 AS error_code,
  blob5 AS provider,
  double2 AS status,
  if(blob16 = '', 'unknown', blob16) AS turn_id,
  blob17 AS session_id,
  blob14 AS device_hash,
  SUM(_sample_interval) AS events,
  MAX(timestamp) AS last_seen
FROM ${dataset}
WHERE ${where}
  AND (blob3 = 'error' OR (blob15 != '' AND blob1 != 'free_tier_heavy_turn'))
GROUP BY source, event, model, error_code, provider, status, turn_id, session_id, device_hash
ORDER BY events DESC, last_seen DESC
LIMIT ${limit}`,
		},
		{
			name: "browser_run_js",
			description: "Advanced runtime-inspection usage and failures.",
			sql: `
SELECT
  ${sourceExpr} AS source,
  blob1 AS event,
  blob3 AS result,
  blob13 AS ai_model,
  if(blob16 = '', 'unknown', blob16) AS turn_id,
  blob17 AS session_id,
  SUM(_sample_interval) AS events
FROM ${dataset}
WHERE ${where}
  AND blob1 IN ('browser_run_js_started', 'browser_run_js_succeeded', 'browser_run_js_failed')
GROUP BY source, event, result, ai_model, turn_id, session_id
ORDER BY events DESC
LIMIT ${limit}`,
		},
		{
			name: "extension_prompts",
			description: "Extension-side prompt lifecycle diagnostics.",
			sql: `
SELECT
  ${sourceExpr} AS source,
  blob1 AS event,
  blob3 AS result,
  blob13 AS ai_model,
  blob15 AS error_code,
  if(blob16 = '', 'unknown', blob16) AS turn_id,
  blob17 AS session_id,
  SUM(_sample_interval) AS events,
  SUM(_sample_interval * double3) / SUM(_sample_interval) AS avg_ms
FROM ${dataset}
WHERE ${where}
  AND blob1 IN ('prompt_submitted', 'prompt_succeeded', 'prompt_failed', 'prompt_stopped')
GROUP BY source, event, result, ai_model, error_code, turn_id, session_id
ORDER BY events DESC
LIMIT ${limit}`,
		},
		{
			name: "tool_reliability",
			description: "Extension-side browser/PDF tool retries and final failures by prompt outcome.",
			sql: `
SELECT
  ${sourceExpr} AS source,
  blob1 AS event,
  blob3 AS result,
  blob13 AS ai_model,
  if(blob16 = '', 'unknown', blob16) AS turn_id,
  blob17 AS session_id,
  SUM(_sample_interval) AS prompts,
  SUM(_sample_interval * if(double13 > double11, double13, double11)) AS tool_steps,
  SUM(_sample_interval * double14) AS tool_failures,
  SUM(_sample_interval * double15) AS recovered_tool_failures,
  SUM(_sample_interval * double16) AS final_tool_failures,
  SUM(_sample_interval * double15) / SUM(_sample_interval) AS avg_recovered_failures,
  SUM(_sample_interval * double16) / SUM(_sample_interval) AS avg_final_failures
FROM ${dataset}
WHERE ${where}
  AND blob1 IN ('prompt_succeeded', 'prompt_failed', 'prompt_stopped')
GROUP BY source, event, result, ai_model, turn_id, session_id
ORDER BY final_tool_failures DESC, recovered_tool_failures DESC, prompts DESC
LIMIT ${limit}`,
		},
	];
	return queryList.map((query) => ({
		...query,
		sql: `${query.sql.trim()}\nFORMAT JSON`,
	}));
}

function quotedList(values) {
	return values.map((value) => `'${value}'`).join(", ");
}

async function runReport(args) {
	const queries = buildQueries(args);
	const runId = new Date().toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, "Z");
	const checksEnabled = shouldEvaluateChecks(args);
	const testDeviceHashes = await resolveTestDeviceHashes(args.testDeviceHashes);
	const plan = {
		runId,
		accountId: args.accountId ? maskAccountId(args.accountId) : "",
		checksEnabled,
		dataset: args.dataset,
		days: args.days,
		healthSources: args.healthSources,
		limit: args.limit,
		testDeviceHashes,
		queries: queries.map(({ name, description, sql }) => ({ name, description, sql })),
		thresholds: checksEnabled ? args.thresholds : undefined,
	};

	if (args.printSql) printQueries(queries);
	if (args.dryRun) {
		const report = { plan, sections: {} };
		printReport(report, args);
		return report;
	}

	if (!args.accountId) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID. Pass --account-id or set the env var.");
	const apiToken = process.env[args.apiTokenEnv];
	if (!apiToken) throw new Error(`Missing ${args.apiTokenEnv}. Use a token with Account Analytics Read permission.`);

	const sections = {};
	for (const query of queries) {
		sections[query.name] = await runSql({ accountId: args.accountId, apiToken, sql: query.sql });
	}
	sections.quota_classification = classifyQuotaRows(sections.quota_and_rejections, testDeviceHashes);
	sections.error_classification = classifyErrorRows(sections.top_errors, testDeviceHashes);
	sections.tool_reliability_classification = classifyToolReliabilityRows(sections.tool_reliability);
	sections.usage_summary = summarizeUsageDevices(sections.usage_devices, testDeviceHashes, args.days);

	const report = { plan, sections };
	if (checksEnabled) report.checks = evaluateChecks(report, args.thresholds);
	const paths = await writeReports(args.outDir, runId, report);
	report.paths = paths;
	printReport(report, args);
	return report;
}

function shouldEvaluateChecks(args) {
	return Boolean(args.check || args.failOnAlert || args.failOnCritical);
}

async function resolveTestDeviceHashes(values = []) {
	const selected = new Set((values || []).filter((value) => value !== "auto"));
	if ((values || []).includes("auto")) {
		const autoHash = await readCurrentFreeTierDeviceHash().catch((error) => {
			console.warn(`Warning: could not auto-read current Onhand Free test device hash: ${error.message}`);
			return "";
		});
		if (autoHash) selected.add(autoHash);
	}
	return [...selected];
}

async function readCurrentFreeTierDeviceHash() {
	const result = await runChild(process.execPath, [SESSION_CLI, "free-tier-bypass", "device-hash", "--json"]);
	const parsed = JSON.parse(result.stdout || "{}");
	const deviceHash = String(parsed.deviceHash || "").trim();
	if (!/^[a-f0-9]{32}$/i.test(deviceHash)) throw new Error("debug:sessions did not return a valid device hash.");
	return deviceHash;
}

function runChild(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: process.cwd(),
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
			if (code === 0) resolve({ stdout, stderr });
			else reject(new Error(`${command} ${args.join(" ")} exited ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
		});
	});
}

async function runSql({ accountId, apiToken, sql }) {
	const response = await fetch(`${API_BASE}/accounts/${accountId}/analytics_engine/sql`, {
		method: "POST",
		headers: { Authorization: `Bearer ${apiToken}` },
		body: sql,
	});
	const text = await response.text();
	if (!response.ok) {
		const message = text.replace(/\s+/g, " ").slice(0, 600);
		throw new Error(`Analytics Engine SQL failed (${response.status}): ${message}`);
	}
	return parseSqlResponse(text);
}

function parseSqlResponse(text) {
	if (!text.trim()) return [];
	try {
		const parsed = JSON.parse(text);
		if (Array.isArray(parsed)) return parsed;
		if (Array.isArray(parsed.data)) return parsed.data;
		if (Array.isArray(parsed.result)) return parsed.result;
		return [parsed];
	} catch {
		return text
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				try {
					return JSON.parse(line);
				} catch {
					return { raw: line };
				}
			});
	}
}

function evaluateChecks(report, thresholds) {
	const sections = report.sections || {};
	const days = Math.max(1, Number(report.plan.days || 1));
	const healthSources = report.plan.healthSources || DEFAULT_HEALTH_SOURCES;
	const cost = aggregateChatCost(filterRowsBySource(sections.chat_cost, healthSources));
	const errorClassification = filterRowsBySource(sections.error_classification || classifyErrorRows(sections.top_errors, report.plan.testDeviceHashes), healthSources);
	const healthErrors = errorClassification.filter((row) => row.classification === "health_error");
	const quotaClassification = filterRowsBySource(sections.quota_classification || classifyQuotaRows(sections.quota_and_rejections, report.plan.testDeviceHashes), healthSources);
	const guardrailEvents = filterRowsBySource(sections.guardrail_events, healthSources);
	const browserRunJs = filterRowsBySource(sections.browser_run_js, healthSources);
	const toolReliability = filterRowsBySource(
		sections.tool_reliability_classification || classifyToolReliabilityRows(sections.tool_reliability),
		healthSources,
	).filter((row) => row.classification === "health_tool_reliability");
	const checks = [];

	const totalCost = numberValue(cost?.total_cost);
	const avgDailyCost = totalCost / days;
	const avgCost = numberValue(cost?.avg_cost);
	const promptFailures = sumRows(healthErrors, "events", (row) => row.event === "prompt_failed");
	const providerErrors = sumRows(healthErrors, "events", isProviderErrorRow);
	const quotaDenials = sumRows(quotaClassification, "events", (row) => row.classification === "health_quota_denial");
	const testQuotaDenials = sumRows(quotaClassification, "events", (row) => row.classification === "test_device_quota_denial");
	const finalToolFailures = sumRows(toolReliability, "final_tool_failures");
	const recoveredToolFailures = sumRows(toolReliability, "recovered_tool_failures");
	const browserRunJsFailures = sumRows(browserRunJs, "events", (row) => row.event === "browser_run_js_failed");
	const browserRunJsEvents = sumRows(browserRunJs, "events", (row) => row.event === "browser_run_js_started");
	const heavyTurns = sumRows(guardrailEvents, "events", (row) => row.event === "free_tier_heavy_turn");

	addThresholdCheck(checks, {
		metric: "avg_daily_cost_usd",
		actual: avgDailyCost,
		limit: thresholds.maxDailyCostUsd,
		severity: "critical",
		message: `Average daily free-tier Worker spend for health sources (${healthSources.join(", ")}).`,
	});
	addThresholdCheck(checks, {
		metric: "avg_completion_cost_usd",
		actual: avgCost,
		limit: thresholds.maxAvgCostUsd,
		severity: "warn",
		message: `Average OpenRouter cost per completed response for health sources (${healthSources.join(", ")}).`,
	});
	addThresholdCheck(checks, {
		metric: "prompt_failures",
		actual: promptFailures,
		limit: thresholds.maxPromptFailures,
		severity: "critical",
		message: `Extension-side prompt failures for health sources (${healthSources.join(", ")}).`,
	});
	addThresholdCheck(checks, {
		metric: "provider_errors",
		actual: providerErrors,
		limit: thresholds.maxProviderErrors,
		severity: "critical",
		message: `Worker-side free-tier chat stream errors for health sources (${healthSources.join(", ")}).`,
	});
	addThresholdCheck(checks, {
		metric: "quota_denials",
		actual: quotaDenials,
		limit: thresholds.maxQuotaDenials,
		severity: "critical",
		message: `User-visible free-tier quota or cost-cap denials for health sources (${healthSources.join(", ")}).`,
	});
	addThresholdCheck(checks, {
		metric: "test_device_quota_denials",
		actual: testQuotaDenials,
		limit: 0,
		severity: "warn",
		message: "Quota denials from known test devices; visible for load-test hygiene but not counted as real-user quota health.",
	});
	addThresholdCheck(checks, {
		metric: "final_tool_failures",
		actual: finalToolFailures,
		limit: thresholds.maxFinalToolFailures,
		severity: "critical",
		message: "Tool failures that were not recovered before the prompt finished.",
	});
	addThresholdCheck(checks, {
		metric: "recovered_tool_failures",
		actual: recoveredToolFailures,
		limit: thresholds.maxRecoveredToolFailures,
		severity: "warn",
		message: "Recovered extension tool failures; sustained growth means reliability is drifting.",
	});
	addThresholdCheck(checks, {
		metric: "browser_run_js_failures",
		actual: browserRunJsFailures,
		limit: thresholds.maxBrowserRunJsFailures,
		severity: "critical",
		message: "Failures from the constrained browser_run_js tool.",
	});
	addThresholdCheck(checks, {
		metric: "browser_run_js_started",
		actual: browserRunJsEvents,
		limit: thresholds.maxBrowserRunJsEvents,
		severity: "warn",
		message: "Advanced runtime-inspection invocations; unexpected growth needs review.",
	});
	addThresholdCheck(checks, {
		metric: "heavy_turns",
		actual: heavyTurns,
		limit: thresholds.maxHeavyTurns,
		severity: "warn",
		message: "Warning-only heavy-turn guardrail events.",
	});

	return checks;
}

function addThresholdCheck(checks, { metric, actual, limit, severity, message }) {
	const normalizedActual = normalizeMetric(actual);
	const normalizedLimit = normalizeMetric(limit);
	checks.push({
		status: normalizedActual > normalizedLimit ? severity : "ok",
		metric,
		actual: normalizedActual,
		limit: normalizedLimit,
		message,
	});
}

function normalizeMetric(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) return 0;
	return Math.round(number * 1_000_000) / 1_000_000;
}

async function writeReports(outDir, runId, report) {
	await mkdir(outDir, { recursive: true });
	const jsonPath = `${outDir}/${runId}.json`;
	const markdownPath = `${outDir}/${runId}.md`;
	await writeFile(jsonPath, JSON.stringify(report, null, 2));
	await writeFile(markdownPath, renderMarkdown(report));
	return { jsonPath, markdownPath };
}

function printQueries(queries) {
	for (const query of queries) {
		console.log(`\n-- ${query.name}: ${query.description}`);
		console.log(query.sql);
	}
}

function printReport(report, args) {
	if (args.json) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}
	const cost = healthChatCost(report);
	const overview = first(report.sections.overview);
	console.log("");
	console.log(`Free tier ops report: ${report.plan.dataset}, last ${report.plan.days} day(s)`);
	console.log(`Health sources: ${(report.plan.healthSources || DEFAULT_HEALTH_SOURCES).join(", ")}`);
	if (report.plan.testDeviceHashes?.length) console.log(`Known test devices: ${report.plan.testDeviceHashes.length}`);
	if (overview) console.log(`Events: ${formatInteger(overview.events)} (${formatNumber(Number(overview.events || 0) / report.plan.days)}/day)`);
	console.log(`Completions: ${formatInteger(cost.completions)} (${formatNumber(Number(cost.completions || 0) / report.plan.days)}/day)`);
	console.log(`Cost: ${formatDollars(cost.total_cost)} total, ${formatDollars(cost.avg_cost)} avg/completion`);
	console.log(`Tokens: ${formatInteger(cost.total_tokens)} total, ${formatInteger(cost.avg_tokens)} avg/completion`);
	const usage = first(report.sections.usage_summary);
	if (usage) {
		console.log(
			`Free-tier users: ${formatInteger(usage.estimated_non_test_free_tier_devices)} estimated non-test devices, ${formatInteger(
				usage.non_test_worker_chat_devices,
			)} completed-chat devices, ${formatInteger(usage.non_test_worker_chat_completions)} completed chats`,
		);
	}
	const toolReliability = healthToolReliabilityRows(report);
	if (toolReliability.length) {
		console.log(
			`Tool reliability: ${formatInteger(sumRows(toolReliability, "recovered_tool_failures"))} recovered retries, ${formatInteger(
				sumRows(toolReliability, "final_tool_failures"),
			)} final tool failures`,
		);
	}
	if (report.checks?.length) {
		const summary = summarizeChecks(report.checks);
		console.log(`Checks: ${summary.critical} critical, ${summary.warn} warning, ${summary.ok} ok`);
		for (const check of report.checks.filter((row) => row.status !== "ok")) {
			console.log(`- ${check.status}: ${check.metric} ${formatCheckValue(check.actual)} > ${formatCheckValue(check.limit)} (${check.message})`);
		}
	}
	if (report.paths) {
		console.log(`Wrote ${report.paths.jsonPath}`);
		console.log(`Wrote ${report.paths.markdownPath}`);
	}
}

function renderMarkdown(report) {
	const lines = [];
	lines.push(`# Free Tier Ops Report ${report.plan.runId}`);
	lines.push("");
	lines.push(`Dataset: \`${report.plan.dataset}\``);
	lines.push(`Window: last ${report.plan.days} day(s)`);
	lines.push(`Health sources: \`${(report.plan.healthSources || DEFAULT_HEALTH_SOURCES).join(", ")}\``);
	if (report.plan.testDeviceHashes?.length) lines.push(`Known test devices: \`${report.plan.testDeviceHashes.length}\``);
	lines.push("");

	const overview = first(report.sections.overview);
	const cost = healthChatCost(report);
	lines.push("## Summary");
	lines.push("");
	if (overview) {
		lines.push(`- Events: ${formatInteger(overview.events)} (${formatNumber(Number(overview.events || 0) / report.plan.days)}/day)`);
		lines.push(`- First seen: ${overview.first_seen || "-"}`);
		lines.push(`- Last seen: ${overview.last_seen || "-"}`);
	}
	lines.push(`- Chat completions: ${formatInteger(cost.completions)} (${formatNumber(Number(cost.completions || 0) / report.plan.days)}/day)`);
	lines.push(`- Total cost: ${formatDollars(cost.total_cost)}`);
	lines.push(`- Average cost/completion: ${formatDollars(cost.avg_cost)}`);
	lines.push(`- Total tokens: ${formatInteger(cost.total_tokens)}`);
	lines.push(`- Average tokens/completion: ${formatInteger(cost.avg_tokens)}`);
	const usage = first(report.sections.usage_summary);
	if (usage) {
		lines.push(`- Estimated non-test free-tier devices: ${formatInteger(usage.estimated_non_test_free_tier_devices)}`);
		lines.push(`- Non-test completed-chat devices: ${formatInteger(usage.non_test_worker_chat_devices)}`);
		lines.push(`- Non-test completed chats: ${formatInteger(usage.non_test_worker_chat_completions)}`);
	}
	lines.push("");

	addTable(lines, "Usage Summary", report.sections.usage_summary, [
		"window_days",
		"raw_free_tier_devices",
		"excluded_likely_test_devices",
		"estimated_non_test_free_tier_devices",
		"non_test_worker_chat_devices",
		"non_test_worker_chat_completions",
		"non_test_extension_prompt_succeeded_devices",
		"non_test_extension_prompt_succeeded_events",
		"first_seen",
		"last_seen",
	]);
	if (report.checks) addTable(lines, "Checks", report.checks, ["status", "metric", "actual", "limit", "message"]);
	addTable(lines, "Event Counts", report.sections.event_counts, ["event", "events"]);
	addTable(lines, "Source Counts", report.sections.source_counts, ["source", "event", "events"]);
	addTable(lines, "Chat Cost By Source", report.sections.chat_cost, ["source", "completions", "prompt_tokens", "completion_tokens", "total_tokens", "total_cost", "avg_cost", "avg_tokens"]);
	addTable(lines, "Chat Latency", report.sections.chat_latency, ["source", "event", "result", "events", "avg_ms", "p50_ms", "p95_ms", "avg_body_bytes"]);
	addTable(lines, "Model Provider Health", report.sections.model_provider_health, ["source", "event", "model", "provider", "result", "events", "cost", "total_tokens", "avg_ms", "p95_ms"]);
	addTable(lines, "Upstream Retries", report.sections.upstream_retries, ["source", "model", "provider", "error_code", "turn_id", "session_id", "device_hash", "events", "last_seen"]);
	addTable(lines, "Turn Costs", report.sections.turn_costs, ["source", "turn_id", "session_id", "model", "provider", "model_calls", "cost", "total_tokens", "prompt_tokens", "completion_tokens", "total_ms", "last_seen"]);
	addTable(lines, "Quota Classification", report.sections.quota_classification, ["source", "event", "classification", "error_code", "turn_id", "session_id", "device_hash", "events", "max_current", "cap", "last_seen"]);
	addTable(lines, "Quota And Rejections", report.sections.quota_and_rejections, ["source", "event", "error_code", "turn_id", "session_id", "device_hash", "events", "max_current", "cap", "last_seen"]);
	addTable(lines, "Guardrail Events", report.sections.guardrail_events, ["source", "event", "result", "reason", "model", "provider", "events", "max_current", "cap", "cost", "total_tokens", "max_turn_model_calls"]);
	addTable(lines, "Error Classification", report.sections.error_classification, ["source", "event", "classification", "model", "error_code", "provider", "status", "turn_id", "session_id", "device_hash", "events", "last_seen"]);
	addTable(lines, "Top Errors", report.sections.top_errors, ["source", "event", "model", "error_code", "provider", "status", "turn_id", "session_id", "device_hash", "events", "last_seen"]);
	addTable(lines, "Browser Run JS", report.sections.browser_run_js, ["source", "event", "result", "ai_model", "turn_id", "session_id", "events"]);
	addTable(lines, "Extension Prompts", report.sections.extension_prompts, ["source", "event", "result", "ai_model", "error_code", "turn_id", "session_id", "events", "avg_ms"]);
	addTable(lines, "Tool Reliability Classification", report.sections.tool_reliability_classification, [
		"source",
		"event",
		"classification",
		"result",
		"ai_model",
		"turn_id",
		"session_id",
		"prompts",
		"tool_steps",
		"tool_failures",
		"recovered_tool_failures",
		"final_tool_failures",
		"avg_recovered_failures",
		"avg_final_failures",
	]);
	addTable(lines, "Tool Reliability", report.sections.tool_reliability, [
		"source",
		"event",
		"result",
		"ai_model",
		"turn_id",
		"session_id",
		"prompts",
		"tool_steps",
		"tool_failures",
		"recovered_tool_failures",
		"final_tool_failures",
		"avg_recovered_failures",
		"avg_final_failures",
	]);

	lines.push("## SQL");
	lines.push("");
	for (const query of report.plan.queries) {
		lines.push(`### ${query.name}`);
		lines.push("");
		lines.push("```sql");
		lines.push(query.sql);
		lines.push("```");
		lines.push("");
	}
	return lines.join("\n");
}

function addTable(lines, title, rows = [], columns = []) {
	lines.push(`## ${title}`);
	lines.push("");
	if (!rows?.length) {
		lines.push("_No rows._");
		lines.push("");
		return;
	}
	lines.push(`| ${columns.join(" | ")} |`);
	lines.push(`| ${columns.map(() => "---").join(" | ")} |`);
	for (const row of rows) {
		lines.push(`| ${columns.map((column) => formatCell(row[column])).join(" | ")} |`);
	}
	lines.push("");
}

function first(rows) {
	return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function rowSource(row) {
	return String(row?.source || "unknown");
}

function rowDeviceHash(row) {
	return String(row?.device_hash || row?.deviceHash || "");
}

function rowTurnId(row) {
	return String(row?.turn_id || row?.turnId || "");
}

function rowSessionId(row) {
	return String(row?.session_id || row?.sessionId || "");
}

function rowAiProvider(row) {
	return String(row?.ai_provider || row?.aiProvider || "");
}

function rowAiModel(row) {
	return String(row?.ai_model || row?.aiModel || "");
}

function isFreeTierUsageRow(row) {
	const source = rowSource(row);
	const event = String(row?.event || "");
	if (source === "free-tier" && (event === "chat_stream_complete" || isQuotaDenial(row))) return true;
	if (source === "extension" && rowAiProvider(row) === "onhand-free") {
		return ["prompt_submitted", "prompt_succeeded", "prompt_failed", "prompt_stopped", "session_started", "register_success"].includes(event);
	}
	return false;
}

function isWorkerChatCompletionUsageRow(row) {
	return rowSource(row) === "free-tier" && String(row?.event || "") === "chat_stream_complete";
}

function isExtensionPromptSucceededUsageRow(row) {
	return rowSource(row) === "extension" && rowAiProvider(row) === "onhand-free" && String(row?.event || "") === "prompt_succeeded";
}

function isLikelyTestUsageRow(row, testDeviceHashes = []) {
	if (rowHasKnownTestDevice(row, testDeviceHashes)) return true;
	if (isProbeDiagnosticRow(row)) return true;
	if (/(^|[-_:])(cli|acceptance|bypass|smoke|test)([-_:]|$)/i.test(rowSource(row))) return true;
	if (/codex-smoke|acceptance|probe/i.test(rowAiModel(row))) return true;
	return false;
}

function isUnknownIdentifier(value) {
	const text = String(value || "").trim().toLowerCase();
	return !text || text === "-" || text === "unknown";
}

function rowHasKnownTestDevice(row, testDeviceHashes = []) {
	return new Set(testDeviceHashes || []).has(rowDeviceHash(row));
}

function isProbeDiagnosticRow(row) {
	const text = `${rowTurnId(row)} ${rowSessionId(row)}`.toLowerCase();
	return /\bprobe\b|codex-free-tier-probe|free-tier-probe|image-probe|probe-image/.test(text);
}

function isUnattributedExtensionError(row) {
	return rowSource(row) === "extension" && isUnknownIdentifier(rowTurnId(row)) && isUnknownIdentifier(rowSessionId(row));
}

function isProviderErrorRow(row) {
	const event = String(row?.event || "");
	return event === "chat_stream_error" || event === "chat_upstream_response" || event === "chat_request_rejected";
}

function isQuotaDenial(row) {
	return String(row?.event || "").endsWith("_quota_denied");
}

function classifyQuotaRows(rows, testDeviceHashes = []) {
	const testDevices = new Set(testDeviceHashes || []);
	return (Array.isArray(rows) ? rows : []).map((row) => {
		const testDevice = testDevices.has(rowDeviceHash(row));
		const classification = isQuotaDenial(row)
			? testDevice
				? "test_device_quota_denial"
				: "health_quota_denial"
			: "non_quota_rejection";
		return {
			...row,
			classification,
		};
	});
}

function classifyErrorRows(rows, testDeviceHashes = []) {
	return (Array.isArray(rows) ? rows : []).map((row) => {
		const testDevice = rowHasKnownTestDevice(row, testDeviceHashes);
		const probe = isProbeDiagnosticRow(row);
		let classification = "health_error";
		if (testDevice && probe) classification = "test_device_probe_error";
		else if (testDevice) classification = "test_device_error";
		else if (probe) classification = "probe_error";
		else if (isUnattributedExtensionError(row)) classification = "unattributed_extension_error";
		return {
			...row,
			classification,
		};
	});
}

function classifyToolReliabilityRows(rows) {
	return (Array.isArray(rows) ? rows : []).map((row) => {
		let classification = "health_tool_reliability";
		if (String(row?.event || "") === "prompt_stopped" || String(row?.result || "") === "stopped") {
			classification = "stopped_prompt_tool_reliability";
		} else if (isProbeDiagnosticRow(row)) {
			classification = "probe_tool_reliability";
		}
		return {
			...row,
			classification,
		};
	});
}

function summarizeUsageDevices(rows, testDeviceHashes = [], days = 1) {
	const allRows = Array.isArray(rows) ? rows : [];
	const likelyTestDevices = new Set();
	for (const row of allRows) {
		const deviceHash = rowDeviceHash(row);
		if (deviceHash && isLikelyTestUsageRow(row, testDeviceHashes)) likelyTestDevices.add(deviceHash);
	}

	const devices = new Map();
	for (const row of allRows) {
		if (!isFreeTierUsageRow(row)) continue;
		const deviceHash = rowDeviceHash(row);
		if (!deviceHash) continue;
		const device = devices.get(deviceHash) || {
			deviceHash,
			isTest: false,
			workerChatCompletions: 0,
			extensionPromptSucceededEvents: 0,
			firstSeen: "",
			lastSeen: "",
		};
		device.isTest ||= likelyTestDevices.has(deviceHash);
		if (isWorkerChatCompletionUsageRow(row)) device.workerChatCompletions += numberValue(row.events);
		if (isExtensionPromptSucceededUsageRow(row)) device.extensionPromptSucceededEvents += numberValue(row.events);
		device.firstSeen = earliestTimestamp(device.firstSeen, row.first_seen);
		device.lastSeen = latestTimestamp(device.lastSeen, row.last_seen);
		devices.set(deviceHash, device);
	}

	const allFreeTierDevices = [...devices.values()];
	const nonTestDevices = allFreeTierDevices.filter((device) => !device.isTest);
	const firstSeen = nonTestDevices.reduce((current, device) => earliestTimestamp(current, device.firstSeen), "");
	const lastSeen = nonTestDevices.reduce((current, device) => latestTimestamp(current, device.lastSeen), "");
	return [
		{
			window_days: days,
			raw_free_tier_devices: allFreeTierDevices.length,
			excluded_likely_test_devices: allFreeTierDevices.length - nonTestDevices.length,
			estimated_non_test_free_tier_devices: nonTestDevices.length,
			non_test_worker_chat_devices: nonTestDevices.filter((device) => device.workerChatCompletions > 0).length,
			non_test_worker_chat_completions: sumRows(nonTestDevices, "workerChatCompletions"),
			non_test_extension_prompt_succeeded_devices: nonTestDevices.filter((device) => device.extensionPromptSucceededEvents > 0).length,
			non_test_extension_prompt_succeeded_events: sumRows(nonTestDevices, "extensionPromptSucceededEvents"),
			first_seen: firstSeen || "-",
			last_seen: lastSeen || "-",
		},
	];
}

function earliestTimestamp(current, value) {
	const next = String(value || "").trim();
	if (!next) return current || "";
	if (!current) return next;
	return next < current ? next : current;
}

function latestTimestamp(current, value) {
	const next = String(value || "").trim();
	if (!next) return current || "";
	if (!current) return next;
	return next > current ? next : current;
}

function filterRowsBySource(rows, sources = DEFAULT_HEALTH_SOURCES) {
	const allowed = new Set(sources || DEFAULT_HEALTH_SOURCES);
	return (Array.isArray(rows) ? rows : []).filter((row) => allowed.has(rowSource(row)));
}

function aggregateChatCost(rows) {
	const selected = Array.isArray(rows) ? rows : [];
	const completions = sumRows(selected, "completions");
	const promptTokens = sumRows(selected, "prompt_tokens");
	const completionTokens = sumRows(selected, "completion_tokens");
	const totalTokens = sumRows(selected, "total_tokens");
	const totalCost = sumRows(selected, "total_cost");
	return {
		completions,
		prompt_tokens: promptTokens,
		completion_tokens: completionTokens,
		total_tokens: totalTokens,
		total_cost: totalCost,
		avg_cost: completions > 0 ? totalCost / completions : 0,
		avg_tokens: completions > 0 ? totalTokens / completions : 0,
	};
}

function healthChatCost(report) {
	return aggregateChatCost(filterRowsBySource(report.sections?.chat_cost, report.plan?.healthSources || DEFAULT_HEALTH_SOURCES));
}

function healthToolReliabilityRows(report) {
	return filterRowsBySource(
		report.sections?.tool_reliability_classification || classifyToolReliabilityRows(report.sections?.tool_reliability),
		report.plan?.healthSources || DEFAULT_HEALTH_SOURCES,
	).filter((row) => row.classification === "health_tool_reliability");
}

function sumRows(rows, column, predicate = () => true) {
	return (Array.isArray(rows) ? rows : []).reduce((total, row) => {
		if (!predicate(row)) return total;
		const value = Number(row?.[column]);
		return Number.isFinite(value) ? total + value : total;
	}, 0);
}

function numberValue(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : 0;
}

function summarizeChecks(checks = []) {
	return checks.reduce(
		(summary, check) => {
			if (check.status === "critical") summary.critical += 1;
			else if (check.status === "warn") summary.warn += 1;
			else summary.ok += 1;
			return summary;
		},
		{ critical: 0, warn: 0, ok: 0 },
	);
}

function formatCell(value) {
	if (value == null || value === "") return "-";
	if (typeof value === "number") {
		if (Number.isInteger(value)) return String(value);
		return formatNumber(value);
	}
	return String(value).replaceAll("|", "\\|");
}

function formatNumber(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) return "-";
	if (Math.abs(number) >= 100) return number.toFixed(0);
	if (Math.abs(number) >= 1) return number.toFixed(2);
	if (number === 0) return "0";
	return number.toPrecision(3);
}

function formatInteger(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) return "-";
	return Math.round(number).toLocaleString("en-US");
}

function formatDollars(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) return "-";
	if (number === 0) return "$0";
	if (number < 0.0001) return `$${number.toExponential(2)}`;
	return `$${number.toFixed(6)}`;
}

function formatCheckValue(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) return "-";
	if (Number.isInteger(number)) return formatInteger(number);
	return formatNumber(number);
}

function maskAccountId(value) {
	const text = String(value || "");
	return text.length <= 8 ? "set" : `${text.slice(0, 4)}...${text.slice(-4)}`;
}

try {
	const args = parseArgs(process.argv.slice(2));
	const report = await runReport(args);
	const checkSummary = summarizeChecks(report.checks);
	if (args.failOnAlert && checkSummary.critical + checkSummary.warn > 0) {
		console.error(`Free tier ops check failed: ${checkSummary.critical} critical, ${checkSummary.warn} warning`);
		process.exitCode = 1;
	} else if (args.failOnCritical && checkSummary.critical > 0) {
		console.error(`Free tier ops check failed: ${checkSummary.critical} critical`);
		process.exitCode = 1;
	}
} catch (error) {
	console.error(error.stack || error.message);
	process.exit(1);
}
