import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const DEFAULT_ROOT = process.cwd();
const MANIFEST_PATH = "shared/browser-tools.json";
const RUNTIME_PATH = "packages/browser-extension/src/browser-runtime.ts";
const WEBSITE_PATH = "website/index.html";
const START_MARKER = "<!-- browser-tool-manifest:start -->";
const END_MARKER = "<!-- browser-tool-manifest:end -->";

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export function publicToolNames(manifest) {
	return (Array.isArray(manifest?.categories) ? manifest.categories : []).flatMap((category) =>
		Array.isArray(category?.tools) ? category.tools : [],
	);
}

export function extractRuntimePublicToolNames(source) {
	const start = source.indexOf("function createTools(");
	const end = source.indexOf("function getToolStatusMessage", start);
	if (start < 0 || end < 0) throw new Error("Could not locate createTools in browser-runtime.ts");
	const body = source.slice(start, end);
	const names = [
		...Array.from(body.matchAll(/commandTool\(\s*"(browser_[a-z0-9_]+)"/g), (match) => match[1]),
		...Array.from(body.matchAll(/name:\s*"(browser_[a-z0-9_]+)"/g), (match) => match[1]),
	];
	return Array.from(new Set(names)).sort();
}

export function renderBrowserToolManifest(manifest) {
	const categories = Array.isArray(manifest?.categories) ? manifest.categories : [];
	return categories.map((category) => {
		const tools = Array.isArray(category?.tools) ? category.tools : [];
		const items = tools.map((name) => {
			const suffix = String(name).replace(/^browser_/, "");
			const optional = name === "browser_run_js" ? ' <span class="muted">(optional, constrained)</span>' : "";
			return `          <li><span class="verb">browser_</span>${escapeHtml(suffix)}${optional}</li>`;
		}).join("\n");
		return [
			"      <div class=\"tool-col\">",
			`        <h5>${escapeHtml(category.icon || "☞")} ${escapeHtml(category.title || "Tools")}</h5>`,
			"        <ul>",
			items,
			"        </ul>",
			"      </div>",
		].join("\n");
	}).join("\n\n");
}

export async function inspectBrowserToolManifest(root = DEFAULT_ROOT) {
	const manifest = JSON.parse(await readFile(join(root, MANIFEST_PATH), "utf8"));
	const names = publicToolNames(manifest);
	const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
	const invalid = names.filter((name) => !/^browser_[a-z0-9_]+$/.test(String(name)));
	const runtimeNames = extractRuntimePublicToolNames(await readFile(join(root, RUNTIME_PATH), "utf8"));
	const manifestNames = Array.from(new Set(names)).sort();
	const missingFromManifest = runtimeNames.filter((name) => !manifestNames.includes(name));
	const missingFromRuntime = manifestNames.filter((name) => !runtimeNames.includes(name));
	return {
		manifest,
		names,
		runtimeNames,
		duplicates,
		invalid,
		missingFromManifest,
		missingFromRuntime,
		ok: !duplicates.length && !invalid.length && !missingFromManifest.length && !missingFromRuntime.length,
	};
}

export async function syncBrowserToolWebsite({ root = DEFAULT_ROOT, check = false } = {}) {
	const inspection = await inspectBrowserToolManifest(root);
	if (!inspection.ok) {
		throw new Error([
			"Browser tool manifest does not match the runtime registry.",
			inspection.duplicates.length ? `Duplicate manifest tools: ${inspection.duplicates.join(", ")}` : "",
			inspection.invalid.length ? `Invalid manifest tools: ${inspection.invalid.join(", ")}` : "",
			inspection.missingFromManifest.length ? `Missing from manifest: ${inspection.missingFromManifest.join(", ")}` : "",
			inspection.missingFromRuntime.length ? `Missing from runtime: ${inspection.missingFromRuntime.join(", ")}` : "",
		].filter(Boolean).join("\n"));
	}
	const websitePath = join(root, WEBSITE_PATH);
	const source = await readFile(websitePath, "utf8");
	const start = source.indexOf(START_MARKER);
	const end = source.indexOf(END_MARKER, start + START_MARKER.length);
	if (start < 0 || end < 0) throw new Error(`Missing ${START_MARKER} / ${END_MARKER} in ${WEBSITE_PATH}`);
	const count = inspection.names.length;
	const heading = `    <h2 class="section-title">${count} small, auditable tools that act across your pages.</h2>`;
	const withHeading = source.replace(/    <h2 class="section-title">[^\n]*small tools that act on the page\.<\/h2>/, heading)
		.replace(/    <h2 class="section-title">\d+ small, auditable tools that act across your pages\.<\/h2>/, heading);
	const nextStart = withHeading.indexOf(START_MARKER);
	const nextEnd = withHeading.indexOf(END_MARKER, nextStart + START_MARKER.length);
	const next = `${withHeading.slice(0, nextStart + START_MARKER.length)}\n    <div class="tools-wrap">\n${renderBrowserToolManifest(inspection.manifest)}\n    </div>\n    ${withHeading.slice(nextEnd)}`;
	if (check) {
		if (next !== source) throw new Error(`${WEBSITE_PATH} is out of sync. Run npm run website:sync-tools.`);
		return { ...inspection, changed: false };
	}
	if (next !== source) await writeFile(websitePath, next, "utf8");
	return { ...inspection, changed: next !== source };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const check = process.argv.includes("--check");
	syncBrowserToolWebsite({ check }).then((result) => {
		console.log(`${check ? "Checked" : result.changed ? "Updated" : "Already current"}: ${result.names.length} public browser tools.`);
	}).catch((error) => {
		console.error(error?.stack || error?.message || String(error));
		process.exitCode = 1;
	});
}
