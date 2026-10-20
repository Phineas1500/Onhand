import process from "node:process";

// Sentry moved issue alerts from the per-project rules API to organization
// "workflows" (alerts) attached to detectors; the old rules endpoint now returns
// 404. These are the workflow-API shapes of the same three rules.
const DEFAULT_ORG = "ramaway";
const DEFAULT_PROJECT = "onhand-browser-extension";
const DEFAULT_API_URL = "https://sentry.io";
// Only store installs page anyone; development and test events stay quiet.
const DEFAULT_ENVIRONMENT = "production";

const condition = (type, comparison = true) => ({ type, comparison, conditionResult: true });

const NON_SMOKE_ERROR_FILTERS = [
	condition("issue_category", { value: 1, include: true }),
	condition("tagged_event", { key: "kind", match: "ne", value: "sentry_source_map_smoke" }),
	condition("tagged_event", { key: "message_type", match: "ne", value: "sentry_runtime_smoke" }),
];

const EMAIL_ISSUE_OWNERS_ACTION = {
	type: "email",
	integrationId: null,
	data: { fallthroughType: "ActiveMembers" },
	config: { targetType: "issue_owners", targetIdentifier: null, targetDisplay: null },
};

function parseArgs(argv) {
	const options = {
		apply: false,
		apiUrl: process.env.SENTRY_API_URL || process.env.SENTRY_URL || DEFAULT_API_URL,
		org: process.env.SENTRY_ORG || DEFAULT_ORG,
		project: process.env.SENTRY_PROJECT || DEFAULT_PROJECT,
		environment: DEFAULT_ENVIRONMENT,
		tokenEnv: process.env.SENTRY_ALERT_AUTH_TOKEN ? "SENTRY_ALERT_AUTH_TOKEN" : process.env.SENTRY_SMOKE_AUTH_TOKEN ? "SENTRY_SMOKE_AUTH_TOKEN" : "SENTRY_AUTH_TOKEN",
	};
	for (const arg of argv) {
		if (arg === "--apply") options.apply = true;
		else if (arg === "--dry-run") options.apply = false;
		else if (arg.startsWith("--api-url=")) options.apiUrl = arg.slice("--api-url=".length);
		else if (arg.startsWith("--org=")) options.org = arg.slice("--org=".length);
		else if (arg.startsWith("--project=")) options.project = arg.slice("--project=".length);
		else if (arg.startsWith("--environment=")) options.environment = arg.slice("--environment=".length) || null;
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

Creates or updates Onhand's Sentry alerts (workflows).

Options:
  --apply                  Write changes to Sentry. Default is dry-run.
  --dry-run                Print planned changes without writing.
  --org=<slug>             Sentry org slug. Default ${DEFAULT_ORG}.
  --project=<slug>         Sentry project slug. Default ${DEFAULT_PROJECT}.
  --environment=<name>     Environment the alerts fire for. Default ${DEFAULT_ENVIRONMENT}.
  --api-url=<url>          Sentry base URL. Default ${DEFAULT_API_URL}.
  --token-env=<name>       Env var containing an alert-management token.

Token lookup defaults to SENTRY_ALERT_AUTH_TOKEN, then SENTRY_SMOKE_AUTH_TOKEN,
then SENTRY_AUTH_TOKEN. The token needs alert read/write access.
`);
}

function desiredWorkflows(environment) {
	return [
		{
			name: "Send a notification for high priority issues",
			environment,
			frequency: 5,
			triggerLogic: "any-short",
			triggers: [condition("new_high_priority_issue"), condition("existing_high_priority_issue")],
			filters: NON_SMOKE_ERROR_FILTERS,
		},
		{
			name: "Onhand: new extension error (non-smoke)",
			environment,
			frequency: 30,
			triggerLogic: "all",
			triggers: [condition("first_seen_event")],
			filters: NON_SMOKE_ERROR_FILTERS,
		},
		{
			name: "Onhand: regression or burst (non-smoke)",
			environment,
			frequency: 30,
			triggerLogic: "any-short",
			triggers: [condition("regression_event"), condition("reappeared_event"), condition("event_frequency_count", { value: 5, interval: "1h" })],
			filters: NON_SMOKE_ERROR_FILTERS,
		},
	];
}

async function sentryRequest(options, path, { method = "GET", body } = {}) {
	const token = process.env[options.tokenEnv];
	if (!token) throw new Error(`Missing ${options.tokenEnv}. Use a token with Sentry alert read/write access.`);
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

const orgPath = (options, suffix) => `/api/0/organizations/${encodeURIComponent(options.org)}/${suffix}`;

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

const comparableConditions = (conditions = []) => conditions.map((entry) => sortObject({ type: entry.type, comparison: entry.comparison }));

function comparableWorkflow(workflow) {
	const filter = workflow.actionFilters?.[0] || {};
	return JSON.stringify({
		environment: workflow.environment || null,
		frequency: Number(workflow.config?.frequency),
		triggerLogic: workflow.triggers?.logicType,
		triggers: comparableConditions(workflow.triggers?.conditions),
		filterLogic: filter.logicType,
		filters: comparableConditions(filter.conditions),
		actions: (filter.actions || []).map((action) => sortObject({ type: action.type, targetType: action.config?.targetType, fallthroughType: action.data?.fallthroughType })),
	});
}

// Builds the workflow body from the desired shape. An update keeps the
// existing rows' ids, actions and detectors so Sentry edits them in place.
function workflowBody(desired, existing, detectorIds) {
	const existingFilter = existing?.actionFilters?.[0];
	const withIds = (conditions, existingConditions = []) =>
		conditions.map((entry, index) => ({ ...(existingConditions[index]?.type === entry.type ? { id: existingConditions[index].id } : {}), ...entry }));
	return {
		name: desired.name,
		enabled: existing?.enabled ?? true,
		environment: desired.environment || null,
		config: { ...(existing?.config || {}), frequency: desired.frequency },
		detectorIds: existing?.detectorIds?.length ? existing.detectorIds : detectorIds,
		triggers: {
			...(existing?.triggers?.id ? { id: existing.triggers.id } : {}),
			logicType: desired.triggerLogic,
			conditions: withIds(desired.triggers, existing?.triggers?.conditions),
			actions: [],
		},
		actionFilters: [
			{
				...(existingFilter?.id ? { id: existingFilter.id } : {}),
				logicType: "all",
				conditions: withIds(desired.filters, existingFilter?.conditions),
				actions: existingFilter?.actions?.length ? existingFilter.actions : [EMAIL_ISSUE_OWNERS_ACTION],
			},
		],
	};
}

async function projectDetectorIds(options) {
	const projects = await sentryRequest(options, orgPath(options, "projects/"));
	const project = (Array.isArray(projects) ? projects : []).find((entry) => entry.slug === options.project);
	if (!project) throw new Error(`Sentry project ${options.project} not found in ${options.org}.`);
	const detectors = await sentryRequest(options, orgPath(options, `detectors/?project=${encodeURIComponent(project.id)}`));
	// The issue stream detector feeds error-issue alerts.
	const ids = (Array.isArray(detectors) ? detectors : []).filter((detector) => /issue_stream|error/.test(String(detector.type || ""))).map((detector) => String(detector.id));
	if (!ids.length) throw new Error(`No issue detector found for ${options.project}; create the alert in Sentry once, then rerun.`);
	return ids;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const existingWorkflows = await sentryRequest(options, orgPath(options, "workflows/"));
	if (!Array.isArray(existingWorkflows)) throw new Error("Sentry did not return a workflow list.");
	const byName = new Map(existingWorkflows.map((workflow) => [workflow.name, workflow]));
	let detectorIds = null;

	for (const desired of desiredWorkflows(options.environment)) {
		const existing = byName.get(desired.name);
		const label = existing ? `${desired.name} (#${existing.id})` : desired.name;
		if (existing && comparableWorkflow(existing) === comparableWorkflow(workflowBody(desired, existing, existing.detectorIds))) {
			console.log(`unchanged: ${label}`);
			continue;
		}
		const type = existing ? "update" : "create";
		if (!options.apply) {
			console.log(`${type}: ${label}${desired.environment ? ` (environment ${desired.environment})` : ""}`);
			continue;
		}
		if (!existing) detectorIds ||= await projectDetectorIds(options);
		const body = workflowBody(desired, existing, detectorIds || []);
		const saved = existing
			? await sentryRequest(options, orgPath(options, `workflows/${encodeURIComponent(existing.id)}/`), { method: "PUT", body })
			: await sentryRequest(options, orgPath(options, "workflows/"), { method: "POST", body });
		console.log(`${type === "create" ? "created" : "updated"}: ${desired.name} (#${saved?.id || existing?.id || "unknown"})`);
	}

	if (!options.apply) console.log("Dry run only. Re-run with --apply to write changes.");
}

try {
	await main();
} catch (error) {
	console.error(error.stack || error.message);
	process.exit(1);
}
