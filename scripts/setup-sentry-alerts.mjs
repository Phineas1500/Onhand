import process from "node:process";

const DEFAULT_ORG = "ramaway";
const DEFAULT_PROJECT = "onhand-browser-extension";
const DEFAULT_API_URL = "https://sentry.io";

const FIRST_SEEN_CONDITION = { id: "sentry.rules.conditions.first_seen_event.FirstSeenEventCondition" };
const REGRESSION_CONDITION = { id: "sentry.rules.conditions.regression_event.RegressionEventCondition" };
const REAPPEARED_CONDITION = { id: "sentry.rules.conditions.reappeared_event.ReappearedEventCondition" };
const HIGH_PRIORITY_NEW_CONDITION = { id: "sentry.rules.conditions.high_priority_issue.NewHighPriorityIssueCondition" };
const HIGH_PRIORITY_EXISTING_CONDITION = { id: "sentry.rules.conditions.high_priority_issue.ExistingHighPriorityIssueCondition" };
const BURST_CONDITION = {
	id: "sentry.rules.conditions.event_frequency.EventFrequencyCondition",
	comparisonType: "count",
	value: 5,
	interval: "1h",
};

const EMAIL_ISSUE_OWNERS_ACTION = {
	id: "sentry.mail.actions.NotifyEmailAction",
	targetType: "IssueOwners",
	fallthroughType: "ActiveMembers",
	targetIdentifier: "",
};

const NON_SMOKE_ERROR_FILTERS = [
	{
		id: "sentry.rules.filters.issue_category.IssueCategoryFilter",
		include: "true",
		value: "1",
	},
	{
		id: "sentry.rules.filters.tagged_event.TaggedEventFilter",
		key: "kind",
		match: "ne",
		value: "sentry_source_map_smoke",
	},
	{
		id: "sentry.rules.filters.tagged_event.TaggedEventFilter",
		key: "message_type",
		match: "ne",
		value: "sentry_runtime_smoke",
	},
];

function parseArgs(argv) {
	const options = {
		apply: false,
		apiUrl: process.env.SENTRY_API_URL || process.env.SENTRY_URL || DEFAULT_API_URL,
		org: process.env.SENTRY_ORG || DEFAULT_ORG,
		project: process.env.SENTRY_PROJECT || DEFAULT_PROJECT,
		tokenEnv: process.env.SENTRY_ALERT_AUTH_TOKEN ? "SENTRY_ALERT_AUTH_TOKEN" : process.env.SENTRY_SMOKE_AUTH_TOKEN ? "SENTRY_SMOKE_AUTH_TOKEN" : "SENTRY_AUTH_TOKEN",
	};
	for (const arg of argv) {
		if (arg === "--apply") options.apply = true;
		else if (arg === "--dry-run") options.apply = false;
		else if (arg.startsWith("--api-url=")) options.apiUrl = arg.slice("--api-url=".length);
		else if (arg.startsWith("--org=")) options.org = arg.slice("--org=".length);
		else if (arg.startsWith("--project=")) options.project = arg.slice("--project=".length);
		else if (arg.startsWith("--token-env=")) options.tokenEnv = arg.slice("--token-env=".length);
		else if (arg === "--help" || arg === "-h") {
			printUsage();
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return options;
}

function printUsage() {
	console.log(`Usage: npm run sentry:alerts -- [options]

Creates or updates Onhand Sentry issue-alert rules.

Options:
  --apply                  Write changes to Sentry. Default is dry-run.
  --dry-run                Print planned changes without writing.
  --org=<slug>             Sentry org slug. Default ${DEFAULT_ORG}.
  --project=<slug>         Sentry project slug. Default ${DEFAULT_PROJECT}.
  --api-url=<url>          Sentry base URL. Default ${DEFAULT_API_URL}.
  --token-env=<name>       Env var containing an alert-management token.

Token lookup defaults to SENTRY_ALERT_AUTH_TOKEN, then SENTRY_SMOKE_AUTH_TOKEN,
then SENTRY_AUTH_TOKEN. The token needs alert-rule read/write access.
`);
}

function desiredRules() {
	return [
		{
			name: "Send a notification for high priority issues",
			actionMatch: "any",
			filterMatch: "all",
			frequency: 5,
			conditions: [HIGH_PRIORITY_NEW_CONDITION, HIGH_PRIORITY_EXISTING_CONDITION],
			filters: NON_SMOKE_ERROR_FILTERS,
			actions: [EMAIL_ISSUE_OWNERS_ACTION],
		},
		{
			name: "Onhand: new extension error (non-smoke)",
			actionMatch: "all",
			filterMatch: "all",
			frequency: 30,
			conditions: [FIRST_SEEN_CONDITION],
			filters: NON_SMOKE_ERROR_FILTERS,
			actions: [EMAIL_ISSUE_OWNERS_ACTION],
		},
		{
			name: "Onhand: regression or burst (non-smoke)",
			actionMatch: "any",
			filterMatch: "all",
			frequency: 30,
			conditions: [REGRESSION_CONDITION, REAPPEARED_CONDITION, BURST_CONDITION],
			filters: NON_SMOKE_ERROR_FILTERS,
			actions: [EMAIL_ISSUE_OWNERS_ACTION],
		},
	];
}

async function sentryRequest(options, path, { method = "GET", body } = {}) {
	const token = process.env[options.tokenEnv];
	if (!token) throw new Error(`Missing ${options.tokenEnv}. Use a token with Sentry alert-rule read/write access.`);
	const response = await fetch(`${options.apiUrl.replace(/\/+$/, "")}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
			...(body ? { "Content-Type": "application/json" } : {}),
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	});
	const text = await response.text();
	let parsed = null;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = text;
	}
	if (!response.ok) {
		const detail = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
		throw new Error(`Sentry API ${method} ${path} failed (${response.status}): ${String(detail || "").slice(0, 500)}`);
	}
	return parsed;
}

function rulesPath(options, suffix = "") {
	return `/api/0/projects/${encodeURIComponent(options.org)}/${encodeURIComponent(options.project)}/rules/${suffix}`;
}

function comparableRule(rule) {
	return {
		actionMatch: rule.actionMatch,
		filterMatch: rule.filterMatch,
		frequency: Number(rule.frequency),
		conditions: normalizeRuleParts(rule.conditions),
		filters: normalizeRuleParts(rule.filters),
		actions: normalizeRuleParts(rule.actions),
	};
}

function normalizeRuleParts(parts = []) {
	return parts.map((part) => {
		const copy = {};
		for (const [key, value] of Object.entries(part || {})) {
			if (key === "name" || key === "label") continue;
			copy[key] = value;
		}
		return sortObject(copy);
	});
}

function sortObject(value) {
	if (Array.isArray(value)) return value.map(sortObject);
	if (!value || typeof value !== "object") return value;
	return Object.keys(value)
		.sort()
		.reduce((sorted, key) => {
			sorted[key] = sortObject(value[key]);
			return sorted;
		}, {});
}

function needsUpdate(existing, desired) {
	return JSON.stringify(comparableRule(existing)) !== JSON.stringify(comparableRule(desired));
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const existingRules = await sentryRequest(options, rulesPath(options));
	if (!Array.isArray(existingRules)) throw new Error("Sentry did not return a rule list.");

	const byName = new Map(existingRules.map((rule) => [rule.name, rule]));
	const changes = [];
	for (const rule of desiredRules()) {
		const existing = byName.get(rule.name);
		if (!existing) {
			changes.push({ type: "create", rule });
			continue;
		}
		if (needsUpdate(existing, rule)) changes.push({ type: "update", id: existing.id, rule });
		else changes.push({ type: "unchanged", id: existing.id, rule });
	}

	for (const change of changes) {
		const label = change.id ? `${change.rule.name} (#${change.id})` : change.rule.name;
		if (change.type === "unchanged") {
			console.log(`unchanged: ${label}`);
			continue;
		}
		if (!options.apply) {
			console.log(`${change.type}: ${label}`);
			continue;
		}
		if (change.type === "create") {
			const created = await sentryRequest(options, rulesPath(options), { method: "POST", body: change.rule });
			console.log(`created: ${change.rule.name} (#${created?.id || "unknown"})`);
			continue;
		}
		await sentryRequest(options, rulesPath(options, `${encodeURIComponent(change.id)}/`), { method: "PUT", body: change.rule });
		console.log(`updated: ${label}`);
	}

	if (!options.apply) console.log("Dry run only. Re-run with --apply to write changes.");
}

try {
	await main();
} catch (error) {
	console.error(error.stack || error.message);
	process.exit(1);
}
