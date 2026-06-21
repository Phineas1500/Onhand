import process from "node:process";

const DEFAULT_ORG = "ramaway";
const DEFAULT_PROJECT = "onhand-browser-extension";
const DEFAULT_API_URL = "https://sentry.io";
const DEFAULT_STATS_PERIOD = "24h";
const DEFAULT_QUERY = "is:unresolved";
const DEFAULT_LIMIT = 100;
const VALID_STATS_PERIODS = new Set(["24h", "14d"]);

function parseArgs(argv) {
	const options = {
		apiUrl: process.env.SENTRY_API_URL || process.env.SENTRY_URL || DEFAULT_API_URL,
		json: false,
		limit: DEFAULT_LIMIT,
		org: process.env.SENTRY_ORG || DEFAULT_ORG,
		project: process.env.SENTRY_PROJECT || DEFAULT_PROJECT,
		query: DEFAULT_QUERY,
		statsPeriod: DEFAULT_STATS_PERIOD,
		tokenEnv: defaultTokenEnv(),
	};
	for (const arg of argv) {
		if (arg === "--json") options.json = true;
		else if (arg.startsWith("--api-url=")) options.apiUrl = arg.slice("--api-url=".length);
		else if (arg.startsWith("--org=")) options.org = arg.slice("--org=".length);
		else if (arg.startsWith("--project=")) options.project = arg.slice("--project=".length);
		else if (arg.startsWith("--query=")) options.query = arg.slice("--query=".length);
		else if (arg.startsWith("--stats-period=")) options.statsPeriod = arg.slice("--stats-period=".length);
		else if (arg.startsWith("--token-env=")) options.tokenEnv = arg.slice("--token-env=".length);
		else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice("--limit=".length));
		else if (arg === "--help" || arg === "-h") {
			printUsage();
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	if (!VALID_STATS_PERIODS.has(options.statsPeriod)) {
		throw new Error(`--stats-period must be one of: ${[...VALID_STATS_PERIODS].join(", ")}`);
	}
	if (!Number.isFinite(options.limit) || options.limit <= 0) throw new Error("--limit must be a positive number");
	return options;
}

function defaultTokenEnv() {
	if (process.env.SENTRY_ISSUE_AUTH_TOKEN) return "SENTRY_ISSUE_AUTH_TOKEN";
	if (process.env.SENTRY_SMOKE_AUTH_TOKEN) return "SENTRY_SMOKE_AUTH_TOKEN";
	if (process.env.SENTRY_AUTH_TOKEN) return "SENTRY_AUTH_TOKEN";
	return "SENTRY_ALERT_AUTH_TOKEN";
}

function printUsage() {
	console.log(`Usage: npm run sentry:issues -- [options]

Reads unresolved Sentry issue health for the Onhand browser-extension project.

Options:
  --org=<slug>             Sentry org slug. Default ${DEFAULT_ORG}.
  --project=<slug>         Sentry project slug. Default ${DEFAULT_PROJECT}.
  --api-url=<url>          Sentry base URL. Default ${DEFAULT_API_URL}.
  --stats-period=<value>   Sentry stats period: 24h or 14d. Default ${DEFAULT_STATS_PERIOD}.
  --query=<query>          Sentry issue search query. Default "${DEFAULT_QUERY}".
  --limit=<n>              Max issues to read. Default ${DEFAULT_LIMIT}.
  --json                   Print JSON instead of text.
  --token-env=<name>       Env var containing a token with project/issue read.

Token lookup defaults to SENTRY_ISSUE_AUTH_TOKEN, then SENTRY_SMOKE_AUTH_TOKEN,
then SENTRY_AUTH_TOKEN, then SENTRY_ALERT_AUTH_TOKEN.
`);
}

async function sentryRequest(options, path) {
	const token = process.env[options.tokenEnv];
	if (!token) {
		throw new Error(
			`Missing ${options.tokenEnv}. Set SENTRY_ISSUE_AUTH_TOKEN to a token with project and issue read access, or pass --token-env.`,
		);
	}
	const response = await fetch(`${options.apiUrl.replace(/\/+$/, "")}${path}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
		},
	});
	const text = await response.text();
	let parsed = null;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = text;
	}
	if (response.status === 403) {
		throw new Error(
			[
				"Sentry issue health failed: HTTP 403.",
				`The token in ${options.tokenEnv} can reach Sentry but cannot list project issues.`,
				"Set SENTRY_ISSUE_AUTH_TOKEN to a token with Project Read and Issue/Event Read access, then rerun `npm run sentry:issues`.",
			].join(" "),
		);
	}
	if (!response.ok) {
		const detail = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
		throw new Error(`Sentry API GET ${path} failed (${response.status}): ${String(detail || "").slice(0, 500)}`);
	}
	return parsed;
}

function projectIssuesPath(options) {
	const params = new URLSearchParams({
		statsPeriod: options.statsPeriod,
		query: options.query,
		limit: String(options.limit),
	});
	return `/api/0/projects/${encodeURIComponent(options.org)}/${encodeURIComponent(options.project)}/issues/?${params.toString()}`;
}

function isSmokeIssue(issue) {
	const text = [
		issue?.title,
		issue?.culprit,
		issue?.permalink,
		issue?.metadata?.type,
		issue?.metadata?.value,
		issue?.metadata?.title,
		issue?.metadata?.filename,
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return [
		"sentry_source_map_smoke",
		"sentry_runtime_smoke",
		"onhandsentrysourcemapsmoke",
		"onhandsentryruntimesmoke",
		"onhand sentry source-map smoke",
		"onhand runtime sentry smoke",
	].some((marker) => text.includes(marker));
}

function compactIssue(issue) {
	return {
		id: issue?.id || "",
		short_id: issue?.shortId || issue?.short_id || "",
		title: issue?.title || "",
		culprit: issue?.culprit || "",
		count: Number(issue?.count || 0),
		user_count: Number(issue?.userCount || issue?.user_count || 0),
		first_seen: issue?.firstSeen || issue?.first_seen || "",
		last_seen: issue?.lastSeen || issue?.last_seen || "",
		permalink: issue?.permalink || "",
		is_smoke: isSmokeIssue(issue),
	};
}

function buildReport(options, issues) {
	const compact = (Array.isArray(issues) ? issues : []).map(compactIssue);
	const nonSmoke = compact.filter((issue) => !issue.is_smoke);
	return {
		generated_at: new Date().toISOString(),
		org: options.org,
		project: options.project,
		stats_period: options.statsPeriod,
		query: options.query,
		token_env: options.tokenEnv,
		total_unresolved_issues: compact.length,
		smoke_issues: compact.length - nonSmoke.length,
		non_smoke_unresolved_issues: nonSmoke.length,
		issues: nonSmoke,
	};
}

function printReport(report, options) {
	if (options.json) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}
	console.log(`Sentry issue health: ${report.org}/${report.project}, ${report.stats_period}, query "${report.query}"`);
	console.log(
		`Unresolved issues: ${report.total_unresolved_issues} total, ${report.smoke_issues} smoke, ${report.non_smoke_unresolved_issues} non-smoke`,
	);
	if (!report.issues.length) {
		console.log("No non-smoke unresolved issues found.");
		return;
	}
	for (const issue of report.issues.slice(0, 10)) {
		const id = issue.short_id || issue.id || "(unknown)";
		const count = Number.isFinite(issue.count) ? issue.count : 0;
		const users = Number.isFinite(issue.user_count) ? issue.user_count : 0;
		const lastSeen = issue.last_seen || "-";
		console.log(`- ${id}: ${issue.title || "(untitled)"} (${count} events, ${users} users, last seen ${lastSeen})`);
		if (issue.permalink) console.log(`  ${issue.permalink}`);
	}
}

const options = parseArgs(process.argv.slice(2));
try {
	const issues = await sentryRequest(options, projectIssuesPath(options));
	const report = buildReport(options, issues);
	printReport(report, options);
} catch (error) {
	console.error(error.stack || error.message);
	process.exit(1);
}
