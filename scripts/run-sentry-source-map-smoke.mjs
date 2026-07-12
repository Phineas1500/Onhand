import * as Sentry from "@sentry/browser";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(rootDir, "packages/browser-extension/manifest.json");
const shippedBundlePath = path.join(rootDir, "packages/browser-extension/onhand-runtime.bundle.js");
const ONHAND_SENTRY_DSN = "https://f08b1742f4020abed600bca50fbb7458@o4511248777478144.ingest.us.sentry.io/4511565377110016";
const EXTENSION_STACK_URL = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/onhand-runtime.bundle.js";
const MAPPED_SOURCE = "packages/browser-extension/src/browser-runtime.ts";
const MAPPED_SOURCE_BUNDLE_MARKER = `// ${MAPPED_SOURCE}`;

function parseArgs(argv) {
	const options = {
		line: null,
		column: null,
		timeoutMs: 90_000,
		pollMs: 5_000,
		printFrame: false,
		org: process.env.SENTRY_ORG || "ramaway",
		project: process.env.SENTRY_PROJECT || "onhand-browser-extension",
		apiUrl: process.env.SENTRY_API_URL || process.env.SENTRY_URL || "https://sentry.io",
		release: process.env.SENTRY_RELEASE || "",
	};
	for (const arg of argv) {
		if (arg === "--print-frame") options.printFrame = true;
		else if (arg.startsWith("--line=")) options.line = Number(arg.slice("--line=".length));
		else if (arg.startsWith("--column=")) options.column = Number(arg.slice("--column=".length));
		else if (arg.startsWith("--timeout-ms=")) options.timeoutMs = Number(arg.slice("--timeout-ms=".length));
		else if (arg.startsWith("--poll-ms=")) options.pollMs = Number(arg.slice("--poll-ms=".length));
		else if (arg.startsWith("--org=")) options.org = arg.slice("--org=".length);
		else if (arg.startsWith("--project=")) options.project = arg.slice("--project=".length);
		else if (arg.startsWith("--api-url=")) options.apiUrl = arg.slice("--api-url=".length);
		else if (arg.startsWith("--release=")) options.release = arg.slice("--release=".length);
		else throw new Error(`Unknown argument: ${arg}`);
	}
	if (options.line !== null && (!Number.isFinite(options.line) || options.line <= 0)) throw new Error("--line must be a positive number");
	if (options.column !== null && (!Number.isFinite(options.column) || options.column < 0)) throw new Error("--column must be a non-negative number");
	if (options.line === null && options.column !== null) throw new Error("--column requires --line");
	if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error("--timeout-ms must be a positive number");
	if (!Number.isFinite(options.pollMs) || options.pollMs <= 0) throw new Error("--poll-ms must be a positive number");
	return options;
}

async function resolveSmokeFramePosition(options) {
	if (options.line !== null) {
		return { line: options.line, column: options.column ?? 1, derived: false };
	}

	const bundleLines = (await readFile(shippedBundlePath, "utf8")).split(/\r?\n/);
	const markerIndex = bundleLines.findIndex((line) => line.trim() === MAPPED_SOURCE_BUNDLE_MARKER);
	if (markerIndex < 0) {
		throw new Error(`Shipped runtime bundle does not include ${MAPPED_SOURCE_BUNDLE_MARKER}`);
	}
	const statementIndex = bundleLines.findIndex((line, index) => index > markerIndex && line.trim() && !line.trimStart().startsWith("//"));
	if (statementIndex < 0) {
		throw new Error(`Shipped runtime bundle does not include executable code after ${MAPPED_SOURCE_BUNDLE_MARKER}`);
	}
	const firstCodeColumn = bundleLines[statementIndex].search(/\S/);
	return {
		line: statementIndex + 1,
		column: firstCodeColumn >= 0 ? firstCodeColumn + 1 : 1,
		derived: true,
	};
}

async function readManifestVersion() {
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	if (!manifest.version) throw new Error("packages/browser-extension/manifest.json does not include version");
	return manifest.version;
}

function normalizeSentryFramePath(value) {
	return String(value || "").replace(/^chrome-extension:\/\/[a-z]{32}\//i, "app:///");
}

function sourceMapSmokeError(smokeId, line, column) {
	const error = new Error(`Onhand Sentry source-map smoke ${smokeId}`);
	error.name = "OnhandSentrySourceMapSmoke";
	error.stack = `${error.name}: ${error.message}\n    at captureRuntimeException (${EXTENSION_STACK_URL}:${line}:${column})`;
	return error;
}

function findExceptionFrames(event) {
	const entries = Array.isArray(event?.entries) ? event.entries : [];
	const exceptionEntry = entries.find((entry) => entry?.type === "exception");
	const values = Array.isArray(exceptionEntry?.data?.values) ? exceptionEntry.data.values : [];
	return values.flatMap((value) => {
		const frames = Array.isArray(value?.stacktrace?.frames) ? value.stacktrace.frames : [];
		return frames.map((frame) => ({
			filename: frame.filename || "",
			absPath: frame.absPath || frame.abs_path || "",
			lineNo: frame.lineNo ?? frame.lineno ?? null,
			colNo: frame.colNo ?? frame.colno ?? null,
			function: frame.function || "",
			context: Array.isArray(frame.context) ? frame.context : [],
		}));
	});
}

function mappedFrame(frames) {
	return frames.find((frame) => [frame.filename, frame.absPath].some((value) => String(value || "").includes(MAPPED_SOURCE)));
}

async function fetchSentryEvent(options, eventId) {
	const baseUrl = options.apiUrl.replace(/\/+$/, "");
	const eventUrl = `${baseUrl}/api/0/projects/${encodeURIComponent(options.org)}/${encodeURIComponent(options.project)}/events/${eventId}/`;
	const readToken = process.env.SENTRY_SMOKE_AUTH_TOKEN || process.env.SENTRY_AUTH_TOKEN;
	const response = await fetch(eventUrl, {
		headers: {
			Authorization: `Bearer ${readToken}`,
			Accept: "application/json",
		},
	});
	if (response.status === 404) return null;
	if (response.status === 403) {
		throw new Error(
			[
				"Sentry event lookup failed: HTTP 403.",
				"The smoke event was sent, but the readback token cannot read processed events.",
				"Set SENTRY_SMOKE_AUTH_TOKEN to a token with project/event read access, then rerun `npm run sentry:smoke`.",
			].join(" "),
		);
	}
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Sentry event lookup failed: HTTP ${response.status} ${body.slice(0, 300)}`);
	}
	return await response.json();
}

async function pollForMappedEvent(options, eventId) {
	const deadline = Date.now() + options.timeoutMs;
	let lastEvent = null;
	while (Date.now() < deadline) {
		lastEvent = await fetchSentryEvent(options, eventId);
		if (lastEvent) {
			const frames = findExceptionFrames(lastEvent);
			const frame = mappedFrame(frames);
			if (frame) return { event: lastEvent, frames, frame };
		}
		await new Promise((resolve) => setTimeout(resolve, options.pollMs));
	}
	const frames = lastEvent ? findExceptionFrames(lastEvent) : [];
	return { event: lastEvent, frames, frame: null };
}

const options = parseArgs(process.argv.slice(2));
if (!options.release) options.release = `onhand-extension@${await readManifestVersion()}`;
const framePosition = await resolveSmokeFramePosition(options);
if (options.printFrame) {
	console.log(`Generated frame: app:///onhand-runtime.bundle.js:${framePosition.line}:${framePosition.column}`);
	console.log(`Expected source: ${MAPPED_SOURCE}`);
	console.log(`Frame location: ${framePosition.derived ? "derived from shipped bundle" : "explicit override"}`);
	process.exit(0);
}
if (!process.env.SENTRY_SMOKE_AUTH_TOKEN && !process.env.SENTRY_AUTH_TOKEN) throw new Error("Missing SENTRY_SMOKE_AUTH_TOKEN or SENTRY_AUTH_TOKEN");
if (!options.org) throw new Error("Missing SENTRY_ORG");
if (!options.project) throw new Error("Missing SENTRY_PROJECT");

const smokeId = `onhand-source-map-smoke-${Date.now()}`;

Sentry.init({
	dsn: ONHAND_SENTRY_DSN,
	release: options.release,
	dist: "chrome",
	environment: "production",
	sendDefaultPii: false,
	defaultIntegrations: false,
	maxBreadcrumbs: 0,
	beforeSend(event) {
		event.user = undefined;
		event.request = undefined;
		event.breadcrumbs = undefined;
		event.extra = undefined;
		event.tags = {
			...(event.tags || {}),
			kind: "sentry_source_map_smoke",
			smoke_id: smokeId,
			surface: "browser_runtime",
		};
		const values = Array.isArray(event.exception?.values) ? event.exception.values : [];
		for (const value of values) {
			const frames = Array.isArray(value?.stacktrace?.frames) ? value.stacktrace.frames : [];
			for (const frame of frames) {
				if (frame.filename) frame.filename = normalizeSentryFramePath(frame.filename);
				if (frame.abs_path) frame.abs_path = normalizeSentryFramePath(frame.abs_path);
				if (frame.absPath) frame.absPath = normalizeSentryFramePath(frame.absPath);
				frame.in_app = true;
			}
		}
		return event;
	},
});

const eventId = Sentry.captureException(sourceMapSmokeError(smokeId, framePosition.line, framePosition.column));
await Sentry.flush(5_000);

console.log(`Sent Sentry source-map smoke: ${smokeId}`);
console.log(`Event ID: ${eventId}`);
console.log(`Release: ${options.release}`);
console.log(`Generated frame: app:///onhand-runtime.bundle.js:${framePosition.line}:${framePosition.column}`);

const result = await pollForMappedEvent(options, eventId);
if (!result.frame) {
	console.log("Resolved frames:");
	for (const frame of result.frames.slice(-8)) {
		console.log(`- ${frame.filename || frame.absPath || "(unknown)"}:${frame.lineNo ?? "?"}:${frame.colNo ?? "?"} ${frame.function || ""}`);
	}
	throw new Error(`Sentry did not resolve the smoke frame to ${MAPPED_SOURCE} before timeout`);
}

console.log(`Mapped frame: ${result.frame.filename || result.frame.absPath}:${result.frame.lineNo}:${result.frame.colNo}`);
console.log("Sentry source-map smoke: PASS");
