import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectBrowserToolManifest, syncBrowserToolWebsite } from "./sync-browser-tools.mjs";

const PROJECT_ROOT = process.cwd();

const REQUIRED_FILES = [
	"packages/browser-extension/manifest.json",
	"packages/browser-extension/background.js",
	"packages/browser-extension/sidepanel.html",
	"packages/browser-extension/sidebar.js",
	"packages/browser-extension/options.html",
	"packages/browser-extension/options.js",
	"packages/browser-extension/onhand-runtime.bundle.js",
	"packages/browser-extension/runtime-revision.js",
	"packages/browser-extension/src/browser-runtime.ts",
	"packages/browser-extension/src/browser-oauth.ts",
	"packages/browser-extension/src/agent/constitution.ts",
	"packages/browser-extension/src/agent/execution-profile.ts",
	"packages/browser-extension/src/research/evidence-types.ts",
	"packages/browser-extension/src/tools/registry.ts",
	"packages/browser-extension/src/tools/runtime-invariants.ts",
	"docs/ONHAND_CONSTITUTION.md",
	"scripts/build-browser-runtime.mjs",
	"scripts/run-browser-runtime-regressions.mjs",
	"scripts/run-agent-runtime-module-regressions.mjs",
	"scripts/run-agent-trajectory-eval.mjs",
	"scripts/run-agent-trajectory-baseline.mjs",
	"scripts/run-agent-trajectory-eval-regressions.mjs",
	"scripts/serve-agent-trajectory-fixtures.mjs",
	"scripts/lib/agent-trajectory-fixtures.mjs",
	"scripts/run-page-toolkit-regressions.mjs",
	"scripts/run-sidebar-regressions.mjs",
	"scripts/run-browser-runtime-smoke.mjs",
	"scripts/generate-realtime-voice-fixture.mjs",
	"scripts/show-chrome-acceptance.mjs",
	"scripts/sync-browser-tools.mjs",
	"shared/browser-tools.json",
	"evals/agent-trajectories/cases.json",
	"evals/agent-trajectories/schema.json",
	"evals/agent-trajectories/trace-schema.json",
];

const REMOVED_PATHS = [
	"apps/desktop/main.mjs",
	"packages/browser-bridge/server.mjs",
	"packages/pi-extension/index.ts",
	"scripts/run-browser-bridge-regression.mjs",
	"scripts/run-tier2-smoke.mjs",
];

const REQUIRED_SCRIPTS = [
	"build:browser-runtime",
	"build:extension",
	"acceptance:chrome",
	"generate:realtime-voice-fixture",
	"serve:fixture",
	"test:fixtures",
	"test:preflight",
	"website:sync-tools",
	"website:check-tools",
	"test:sidebar-regressions",
	"test:browser-runtime-regressions",
	"test:agent-runtime-modules",
	"eval:agent-trajectories",
	"eval:agent-trajectories:live",
	"serve:agent-trajectories",
	"test:agent-trajectory-eval",
	"smoke:browser-runtime",
];

const REMOVED_SCRIPTS = [
	"bridge",
	"bridge:token",
	"bridge:config",
	"desktop",
	"tmux:start",
	"tmux:stop",
	"tmux:attach",
	"tmux:status",
	"test:browser-bridge",
	"test:note-layout",
	"test:session-restore",
	"smoke:tier2",
];

async function exists(path) {
	try {
		await access(join(PROJECT_ROOT, path));
		return true;
	} catch {
		return false;
	}
}

function printCheck(label, ok, detail = "") {
	const status = ok ? "OK" : "FAIL";
	console.log(`${label}: ${status}${detail ? ` (${detail})` : ""}`);
}

async function main() {
	const failures = [];
	console.log(`Project root: ${PROJECT_ROOT}`);
	console.log("");

	const missingRequired = [];
	for (const path of REQUIRED_FILES) {
		if (!(await exists(path))) missingRequired.push(path);
	}
	printCheck("Browser extension runtime files", missingRequired.length === 0, missingRequired.length ? missingRequired.join(", ") : "");
	if (missingRequired.length) failures.push("Required browser-only files are missing.");

	const lingeringRemoved = [];
	for (const path of REMOVED_PATHS) {
		if (await exists(path)) lingeringRemoved.push(path);
	}
	printCheck("Legacy desktop/bridge files removed", lingeringRemoved.length === 0, lingeringRemoved.length ? lingeringRemoved.join(", ") : "");
	if (lingeringRemoved.length) failures.push("Legacy desktop/bridge files are still present.");

	const packageJson = JSON.parse(await readFile(join(PROJECT_ROOT, "package.json"), "utf8"));
	const scripts = packageJson.scripts || {};
	const missingScripts = REQUIRED_SCRIPTS.filter((name) => !scripts[name]);
	const lingeringScripts = REMOVED_SCRIPTS.filter((name) => scripts[name]);
	printCheck("Browser-only npm scripts", missingScripts.length === 0, missingScripts.length ? `missing ${missingScripts.join(", ")}` : "");
	printCheck("Legacy npm scripts removed", lingeringScripts.length === 0, lingeringScripts.length ? lingeringScripts.join(", ") : "");
	if (missingScripts.length) failures.push("Browser-only npm scripts are missing.");
	if (lingeringScripts.length) failures.push("Legacy npm scripts are still present.");

	const manifest = JSON.parse(await readFile(join(PROJECT_ROOT, "packages/browser-extension/manifest.json"), "utf8"));
	const hasSidePanel = Boolean(manifest.side_panel?.default_path);
	const hasOperaSidebar = manifest.sidebar_action?.default_panel === manifest.side_panel?.default_path && Boolean(manifest.sidebar_action?.default_icon);
	const hasBackgroundWorker = manifest.background?.service_worker === "background.js";
	const hasFileHostPermission = Array.isArray(manifest.host_permissions) && manifest.host_permissions.includes("file:///*");
	printCheck("Chrome side panel manifest", hasSidePanel && hasBackgroundWorker, `side_panel=${hasSidePanel}, background=${hasBackgroundWorker}`);
	if (!hasSidePanel || !hasBackgroundWorker) failures.push("Manifest is missing the side panel or background worker.");
	printCheck("Opera sidebar manifest", hasOperaSidebar, `sidebar_action=${hasOperaSidebar}`);
	if (!hasOperaSidebar) failures.push("Manifest is missing the Opera sidebar action.");
	printCheck("Local file host permission", hasFileHostPermission, "host_permissions includes file:///*");
	if (!hasFileHostPermission) failures.push("Manifest is missing local file host permission.");

	const backgroundSource = await readFile(join(PROJECT_ROOT, "packages/browser-extension/background.js"), "utf8");
	const realtimeSessionSource = await readFile(join(PROJECT_ROOT, "scripts/serve-realtime-session.mjs"), "utf8");
	const realtimeModel = "gpt-realtime-2.1";
	const hasCurrentRealtimeModel =
		backgroundSource.includes(`const OPENAI_REALTIME_MODEL = "${realtimeModel}";`) &&
		realtimeSessionSource.includes(`const MODEL = process.env.REALTIME_MODEL || "${realtimeModel}";`);
	printCheck("Realtime voice model", hasCurrentRealtimeModel, realtimeModel);
	if (!hasCurrentRealtimeModel) failures.push(`Realtime voice defaults must use ${realtimeModel}.`);

	const operaSidebarHelpSource = await readFile(join(PROJECT_ROOT, "packages/browser-extension/opera-sidebar-help.html"), "utf8");
	const hasOperaToolbarHint =
		backgroundSource.includes('const OPERA_TOOLBAR_POPUP_PATH = "opera-sidebar-help.html";') &&
		backgroundSource.includes("chrome.action.setPopup({ popup: OPERA_TOOLBAR_POPUP_PATH })") &&
		backgroundSource.includes("async function handleOperaToolbarAction") &&
		backgroundSource.includes('surface: "opera-sidebar-instructions"') &&
		backgroundSource.includes("await showOperaToolbarInstruction(tabId)") &&
		backgroundSource.includes("const isOperaSidebarToolbarAction = !chrome.sidePanel?.open && Boolean(getOperaSidebarAction());") &&
		backgroundSource.includes("await handleOperaToolbarAction(windowId, tab?.id);") &&
		!backgroundSource.includes("async function openOperaSidebarFallbackTab") &&
		operaSidebarHelpSource.includes("Use the Onhand button in Opera's left sidebar");
	printCheck("Opera toolbar hint", hasOperaToolbarHint, "toolbar action shows native-sidebar instructions instead of opening a fallback page");
	if (!hasOperaToolbarHint) failures.push("Background worker is missing the Opera toolbar hint behavior.");

	const runtimeRevisionSource = await readFile(join(PROJECT_ROOT, "packages/browser-extension/runtime-revision.js"), "utf8");
	const runtimeRevision = runtimeRevisionSource.match(/ONHAND_EXTENSION_RUNTIME_REVISION\s*=\s*"([^"]+)"/)?.[1] || "";
	printCheck("Browser extension runtime revision", Boolean(runtimeRevision), runtimeRevision);
	if (!runtimeRevision) failures.push("Runtime revision is missing.");

	const constitutionSource = await readFile(join(PROJECT_ROOT, "docs/ONHAND_CONSTITUTION.md"), "utf8");
	const constitutionRequiredPhrases = ["The page is the canvas", "Every claim is anchored", "Teach, don't tell", "The session is the artifact"];
	const missingConstitutionPhrases = constitutionRequiredPhrases.filter((phrase) => !constitutionSource.includes(phrase));
	printCheck(
		"Onhand constitution",
		missingConstitutionPhrases.length === 0,
		missingConstitutionPhrases.length ? `missing ${missingConstitutionPhrases.join(", ")}` : "core principles present",
	);
	if (missingConstitutionPhrases.length) failures.push("Onhand constitution is missing core principles.");

	try {
		const toolInspection = await inspectBrowserToolManifest(PROJECT_ROOT);
		await syncBrowserToolWebsite({ root: PROJECT_ROOT, check: true });
		printCheck("Shared browser tool manifest", toolInspection.ok, `${toolInspection.names.length} public tools; runtime and website synchronized`);
		if (!toolInspection.ok) failures.push("Shared browser tool manifest does not match the runtime registry.");
	} catch (error) {
		printCheck("Shared browser tool manifest", false, error?.message || String(error));
		failures.push("Shared browser tool manifest or generated website list is stale.");
	}

	console.log("");
	console.log("Manual reminders:");
	console.log("- Before a release, run `npm run test:real-browser-anchoring` (needs a Chromium-based browser, e.g. Helium): it exercises live DOM highlight anchoring/re-find that the mocked suites cannot.");
	console.log("- Reload the unpacked extension after changing the generated runtime bundle, using Computer Use on chrome://extensions when validating from Codex.");
	console.log("- Confirm OpenAI Codex OAuth status before real Chrome validation: authMode oauth, aiProvider openai-codex, aiModel gpt-5.5, hasOAuthCredentials true, expired false.");
	console.log("- For real Chrome validation, run the prompts from `npm run acceptance:chrome -- --suite=all` in the Onhand side panel with Computer Use.");
	console.log("- Use the Codex Chrome Extension backend only for normal web pages after Onhand extension UI is closed.");
	console.log("- The browser-only runtime no longer requires Electron, tmux, or a localhost bridge.");

	if (failures.length) {
		console.log("");
		for (const failure of failures) console.error(`- ${failure}`);
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(error?.stack || error?.message || String(error));
	process.exitCode = 1;
});
