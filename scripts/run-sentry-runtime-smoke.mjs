import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(rootDir, "packages/browser-extension/manifest.json");
const DEFAULT_ORG = "ramaway";
const DEFAULT_PROJECT = "onhand-browser-extension";
const DEFAULT_API_URL = "https://sentry.io";

function parseArgs(argv) {
	const options = {
		apiUrl: process.env.SENTRY_API_URL || process.env.SENTRY_URL || DEFAULT_API_URL,
		org: process.env.SENTRY_ORG || DEFAULT_ORG,
		project: process.env.SENTRY_PROJECT || DEFAULT_PROJECT,
		timeoutMs: 90_000,
		pollMs: 5_000,
		tokenEnv: process.env.SENTRY_SMOKE_AUTH_TOKEN ? "SENTRY_SMOKE_AUTH_TOKEN" : "SENTRY_AUTH_TOKEN",
	};
	for (const arg of argv) {
		if (arg.startsWith("--api-url=")) options.apiUrl = arg.slice("--api-url=".length);
		else if (arg.startsWith("--org=")) options.org = arg.slice("--org=".length);
		else if (arg.startsWith("--project=")) options.project = arg.slice("--project=".length);
		else if (arg.startsWith("--timeout-ms=")) options.timeoutMs = Number(arg.slice("--timeout-ms=".length));
		else if (arg.startsWith("--poll-ms=")) options.pollMs = Number(arg.slice("--poll-ms=".length));
		else if (arg.startsWith("--token-env=")) options.tokenEnv = arg.slice("--token-env=".length);
		else if (arg === "--help" || arg === "-h") {
			printUsage();
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error("--timeout-ms must be a positive number");
	if (!Number.isFinite(options.pollMs) || options.pollMs <= 0) throw new Error("--poll-ms must be a positive number");
	return options;
}

function printUsage() {
	console.log(`Usage: npm run sentry:runtime-smoke -- [options]

Sends a real Sentry event through the shipped Onhand browser runtime and reads it
back to verify diagnostics gating and redaction.

Options:
  --org=<slug>             Sentry org slug. Default ${DEFAULT_ORG}.
  --project=<slug>         Sentry project slug. Default ${DEFAULT_PROJECT}.
  --api-url=<url>          Sentry base URL. Default ${DEFAULT_API_URL}.
  --timeout-ms=<n>         Readback timeout. Default 90000.
  --poll-ms=<n>            Readback poll interval. Default 5000.
  --token-env=<name>       Env var containing a token with project event read.
`);
}

async function readManifestVersion() {
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	if (!manifest.version) throw new Error("packages/browser-extension/manifest.json does not include version");
	return manifest.version;
}

function installChromeStorageStub(settings) {
	globalThis.chrome = {
		runtime: {
			getManifest() {
				return { version: settings.extensionVersion };
			},
		},
		storage: {
			local: {
				data: {
					onhandBrowserRuntime: {
						settings: {
							authMode: "oauth",
							aiProvider: "openai-codex",
							aiModel: "gpt-5.5",
							diagnosticsEnabled: settings.diagnosticsEnabled,
							learningMode: false,
							realtimeVoiceEnabled: false,
						},
						currentSessionId: "",
					},
					onhandBrowserSessions: {},
				},
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

function createSmokeHost(extensionVersion) {
	return {
		extensionVersion,
		runtimeRevision: "sentry-runtime-smoke",
		async runCommand() {
			return {};
		},
		log() {},
		notifyAuthProgress() {},
	};
}

async function sentryRequest(options, path) {
	const token = process.env[options.tokenEnv];
	if (!token) throw new Error(`Missing ${options.tokenEnv}. Use a token with project event read access.`);
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
	if (response.status === 404) return null;
	if (!response.ok) {
		const detail = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
		throw new Error(`Sentry API GET ${path} failed (${response.status}): ${String(detail || "").slice(0, 500)}`);
	}
	return parsed;
}

function projectPath(options, suffix) {
	return `/api/0/projects/${encodeURIComponent(options.org)}/${encodeURIComponent(options.project)}${suffix}`;
}

function eventId(event) {
	return event?.eventID || event?.eventId || event?.id || "";
}

function tagValue(event, key) {
	const tags = Array.isArray(event?.tags) ? event.tags : [];
	const entry = tags.find((tag) => tag?.key === key);
	return entry?.value || "";
}

async function pollForSmokeEvent(options, smokeId) {
	const deadline = Date.now() + options.timeoutMs;
	let lastEvents = [];
	while (Date.now() < deadline) {
		const events = await sentryRequest(options, projectPath(options, "/events/?full=true"));
		lastEvents = Array.isArray(events) ? events : [];
		const found = lastEvents.find((event) => JSON.stringify(event).includes(smokeId));
		if (found) {
			const id = eventId(found);
			if (!id) return found;
			return (await sentryRequest(options, projectPath(options, `/events/${encodeURIComponent(id)}/`))) || found;
		}
		await new Promise((resolve) => setTimeout(resolve, options.pollMs));
	}
	const titles = lastEvents
		.slice(0, 5)
		.map((event) => event.title || event.message || eventId(event) || "(untitled)")
		.join(" | ");
	throw new Error(`Sentry runtime smoke event was not readable before timeout. Recent events: ${titles}`);
}

function assertDoesNotContain(serialized, value, label) {
	if (serialized.includes(value)) throw new Error(`Sentry runtime smoke leaked ${label}`);
}

function hasStoredUserData(value) {
	if (!value) return false;
	if (Array.isArray(value)) return value.some(hasStoredUserData);
	if (typeof value === "object") return Object.values(value).some(hasStoredUserData);
	return value !== "" && value !== null && value !== undefined;
}

function assertEventRedaction(event, smokeId) {
	const serialized = JSON.stringify(event);
	if (!serialized.includes(smokeId)) throw new Error("Sentry runtime smoke readback did not include the smoke id");
	if (tagValue(event, "kind") !== "runtime_exception") throw new Error(`Expected kind=runtime_exception, saw ${tagValue(event, "kind") || "(missing)"}`);
	if (tagValue(event, "message_type") !== "sentry_runtime_smoke") throw new Error(`Expected message_type=sentry_runtime_smoke, saw ${tagValue(event, "message_type") || "(missing)"}`);

	assertDoesNotContain(serialized, "private prompt text", "prompt text");
	assertDoesNotContain(serialized, "https://example.test/private", "URL");
	assertDoesNotContain(serialized, "token=secret", "query token");
	assertDoesNotContain(serialized, "file:///Users/sriram/private.pdf", "file URL");
	assertDoesNotContain(serialized, "/Users/sriram", "local user path");
	assertDoesNotContain(serialized, "sk-or-secret", "API key");
	assertDoesNotContain(serialized, "sriram@example.com", "email address");
	assertDoesNotContain(serialized, "chrome-extension://abcdefghijklmnopabcdefghijklmnop", "Chrome extension id");

	if (!serialized.includes("[redacted text]")) throw new Error("Expected redacted text marker in Sentry runtime smoke event");
	if (!serialized.includes("app:///onhand-runtime.bundle.js")) throw new Error("Expected normalized app:/// stack frame in Sentry runtime smoke event");
	if (hasStoredUserData(event.user)) {
		throw new Error(
			"Sentry runtime smoke event included processed user or IP-derived geo data. Enable Sentry's project-side IP storage prevention/scrubbing or route events through an Onhand tunnel, then rerun this smoke.",
		);
	}
	if (event.request && Object.keys(event.request).length > 0) throw new Error("Sentry runtime smoke event unexpectedly included request data");
	if (Array.isArray(event.breadcrumbs?.values) && event.breadcrumbs.values.length > 0) throw new Error("Sentry runtime smoke event unexpectedly included breadcrumbs");
}

const options = parseArgs(process.argv.slice(2));
const extensionVersion = await readManifestVersion();
const smokeId = `onhand-runtime-sentry-smoke-${Date.now()}`;
installChromeStorageStub({ diagnosticsEnabled: true, extensionVersion });

const { createOnhandBrowserRuntime } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
const runtime = createOnhandBrowserRuntime(createSmokeHost(extensionVersion));
const sensitiveMessage = [
	`Onhand runtime Sentry smoke ${smokeId}.`,
	"No visible text matched: private prompt text at https://example.test/private?token=secret-value",
	"from file:///Users/sriram/private.pdf using sk-or-secret and sriram@example.com.",
].join(" ");
const sensitiveStack = [
	`Error: ${sensitiveMessage}`,
	"    at smoke (chrome-extension://abcdefghijklmnopabcdefghijklmnop/onhand-runtime.bundle.js:123:45)",
	"    at test (file:///Users/sriram/private.js:1:2)",
].join("\n");

const result = await runtime.captureRuntimeException({
	messageType: "sentry_runtime_smoke",
	message: sensitiveMessage,
	stack: sensitiveStack,
});

if (!result?.captured) throw new Error("Runtime did not capture the Sentry smoke event");
console.log(`Sent Sentry runtime smoke: ${smokeId}`);
console.log(`Release: onhand-extension@${extensionVersion}`);

const event = await pollForSmokeEvent(options, smokeId);
assertEventRedaction(event, smokeId);
console.log(`Event ID: ${eventId(event) || "(unknown)"}`);
console.log("Sentry runtime redaction smoke: PASS");
