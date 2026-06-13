import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const DEFAULT_DATASET = "onhand_events";
const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 20;
const DEFAULT_OUT_DIR = "tmp/free-tier-ops";
const API_BASE = "https://api.cloudflare.com/client/v4";

function parseArgs(argv) {
	const args = {
		accountId: process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || "",
		apiTokenEnv: "CLOUDFLARE_API_TOKEN",
		dataset: DEFAULT_DATASET,
		days: DEFAULT_DAYS,
		dryRun: false,
		json: false,
		limit: DEFAULT_LIMIT,
		outDir: DEFAULT_OUT_DIR,
		printSql: false,
	};
	for (const value of argv) {
		if (value === "--dry-run") {
			args.dryRun = true;
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
  --dry-run                      Print the report plan without network calls
  --print-sql                    Print SQL queries
  --json                         Print summary JSON
  --dataset=<name>               Analytics Engine dataset/table name
  --days=<n>                     Lookback window
  --limit=<n>                    Max rows for top-N sections
  --out-dir=<path>               Output directory for JSON and Markdown reports
  --account-id=<id>              Cloudflare account id
  --api-token-env=<name>         Environment variable containing the API token
`);
}

function parsePositiveInt(value, prefix) {
	const parsed = Number.parseInt(value.slice(prefix.length), 10);
	if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${prefix.slice(2, -1)} must be a positive integer`);
	return parsed;
}

function validateIdentifier(value, label) {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Invalid ${label}: ${value}`);
}

function buildQueries({ dataset, days, limit }) {
	const where = `timestamp >= NOW() - INTERVAL '${days}' DAY`;
	const chatEvents = [
		"chat_upstream_response",
		"chat_stream_complete",
		"chat_stream_error",
		"chat_stream_cancelled",
		"chat_request_rejected",
		"chat_quota_denied",
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
			name: "chat_latency",
			description: "Request and stream latency by chat event/result.",
			sql: `
SELECT
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
GROUP BY event, result
ORDER BY event, result`,
		},
		{
			name: "chat_cost",
			description: "Completion tokens and OpenRouter reported/forwarded cost.",
			sql: `
SELECT
  SUM(_sample_interval) AS completions,
  SUM(_sample_interval * double7) AS prompt_tokens,
  SUM(_sample_interval * double8) AS completion_tokens,
  SUM(_sample_interval * double9) AS total_tokens,
  SUM(_sample_interval * double10) AS total_cost,
  SUM(_sample_interval * double10) / SUM(_sample_interval) AS avg_cost,
  SUM(_sample_interval * double9) / SUM(_sample_interval) AS avg_tokens
FROM ${dataset}
WHERE ${where}
  AND blob1 = 'chat_stream_complete'`,
		},
		{
			name: "model_provider_health",
			description: "Model/provider routing, errors, latency, cost, and tokens by chat event.",
			sql: `
SELECT
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
GROUP BY event, model, provider, result
ORDER BY event, events DESC
LIMIT ${limit}`,
		},
		{
			name: "turn_costs",
			description: "Per Onhand turn cost, tokens, latency, and model-call count.",
			sql: `
SELECT
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
GROUP BY turn_id, session_id, model, provider
ORDER BY cost DESC, model_calls DESC
LIMIT ${limit}`,
		},
		{
			name: "quota_and_rejections",
			description: "Quota denials, rejected requests, and rate-limited diagnostics.",
			sql: `
SELECT
  blob1 AS event,
  blob15 AS error_code,
  SUM(_sample_interval) AS events,
  MAX(double5) AS max_current,
  MAX(double6) AS cap
FROM ${dataset}
WHERE ${where}
  AND blob1 IN (
    'chat_quota_denied',
    'chat_request_rejected',
    'telemetry_rate_limited',
    'telemetry_rejected',
    'error_report_rate_limited',
    'error_report_rejected'
  )
GROUP BY event, error_code
ORDER BY events DESC
LIMIT ${limit}`,
		},
		{
			name: "top_errors",
			description: "Provider/runtime error codes by event.",
			sql: `
SELECT
  blob1 AS event,
  blob15 AS error_code,
  blob5 AS provider,
  double2 AS status,
  SUM(_sample_interval) AS events
FROM ${dataset}
WHERE ${where}
  AND (blob3 = 'error' OR blob15 != '')
GROUP BY event, error_code, provider, status
ORDER BY events DESC
LIMIT ${limit}`,
		},
		{
			name: "browser_run_js",
			description: "Advanced runtime-inspection usage and failures.",
			sql: `
SELECT
  blob1 AS event,
  blob3 AS result,
  blob13 AS ai_model,
  SUM(_sample_interval) AS events
FROM ${dataset}
WHERE ${where}
  AND blob1 IN ('browser_run_js_started', 'browser_run_js_succeeded', 'browser_run_js_failed')
GROUP BY event, result, ai_model
ORDER BY events DESC
LIMIT ${limit}`,
		},
		{
			name: "extension_prompts",
			description: "Extension-side prompt lifecycle diagnostics.",
			sql: `
SELECT
  blob1 AS event,
  blob3 AS result,
  blob13 AS ai_model,
  blob15 AS error_code,
  SUM(_sample_interval) AS events,
  SUM(_sample_interval * double3) / SUM(_sample_interval) AS avg_ms
FROM ${dataset}
WHERE ${where}
  AND blob1 IN ('prompt_submitted', 'prompt_succeeded', 'prompt_failed', 'prompt_stopped')
GROUP BY event, result, ai_model, error_code
ORDER BY events DESC
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
	const plan = {
		runId,
		accountId: args.accountId ? maskAccountId(args.accountId) : "",
		dataset: args.dataset,
		days: args.days,
		limit: args.limit,
		queries: queries.map(({ name, description, sql }) => ({ name, description, sql })),
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

	const report = { plan, sections };
	const paths = await writeReports(args.outDir, runId, report);
	report.paths = paths;
	printReport(report, args);
	return report;
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
	const cost = first(report.sections.chat_cost);
	const overview = first(report.sections.overview);
	console.log("");
	console.log(`Free tier ops report: ${report.plan.dataset}, last ${report.plan.days} day(s)`);
	if (overview) console.log(`Events: ${formatInteger(overview.events)} (${formatNumber(Number(overview.events || 0) / report.plan.days)}/day)`);
	if (cost) {
		console.log(`Completions: ${formatInteger(cost.completions)} (${formatNumber(Number(cost.completions || 0) / report.plan.days)}/day)`);
		console.log(`Cost: ${formatDollars(cost.total_cost)} total, ${formatDollars(cost.avg_cost)} avg/completion`);
		console.log(`Tokens: ${formatInteger(cost.total_tokens)} total, ${formatInteger(cost.avg_tokens)} avg/completion`);
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
	lines.push("");

	const overview = first(report.sections.overview);
	const cost = first(report.sections.chat_cost);
	lines.push("## Summary");
	lines.push("");
	if (overview) {
		lines.push(`- Events: ${formatInteger(overview.events)} (${formatNumber(Number(overview.events || 0) / report.plan.days)}/day)`);
		lines.push(`- First seen: ${overview.first_seen || "-"}`);
		lines.push(`- Last seen: ${overview.last_seen || "-"}`);
	}
	if (cost) {
		lines.push(`- Chat completions: ${formatInteger(cost.completions)} (${formatNumber(Number(cost.completions || 0) / report.plan.days)}/day)`);
		lines.push(`- Total cost: ${formatDollars(cost.total_cost)}`);
		lines.push(`- Average cost/completion: ${formatDollars(cost.avg_cost)}`);
		lines.push(`- Total tokens: ${formatInteger(cost.total_tokens)}`);
		lines.push(`- Average tokens/completion: ${formatInteger(cost.avg_tokens)}`);
	}
	lines.push("");

	addTable(lines, "Event Counts", report.sections.event_counts, ["event", "events"]);
	addTable(lines, "Chat Latency", report.sections.chat_latency, ["event", "result", "events", "avg_ms", "p50_ms", "p95_ms", "avg_body_bytes"]);
	addTable(lines, "Model Provider Health", report.sections.model_provider_health, ["event", "model", "provider", "result", "events", "cost", "total_tokens", "avg_ms", "p95_ms"]);
	addTable(lines, "Turn Costs", report.sections.turn_costs, ["turn_id", "session_id", "model", "provider", "model_calls", "cost", "total_tokens", "prompt_tokens", "completion_tokens", "total_ms", "last_seen"]);
	addTable(lines, "Quota And Rejections", report.sections.quota_and_rejections, ["event", "error_code", "events", "max_current", "cap"]);
	addTable(lines, "Top Errors", report.sections.top_errors, ["event", "error_code", "provider", "status", "events"]);
	addTable(lines, "Browser Run JS", report.sections.browser_run_js, ["event", "result", "ai_model", "events"]);
	addTable(lines, "Extension Prompts", report.sections.extension_prompts, ["event", "result", "ai_model", "error_code", "events", "avg_ms"]);

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

function maskAccountId(value) {
	const text = String(value || "");
	return text.length <= 8 ? "set" : `${text.slice(0, 4)}...${text.slice(-4)}`;
}

try {
	await runReport(parseArgs(process.argv.slice(2)));
} catch (error) {
	console.error(error.stack || error.message);
	process.exit(1);
}
