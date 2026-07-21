#!/usr/bin/env node

import assert from "node:assert/strict";
import { build } from "esbuild";

async function loadRuntimeModules() {
	const result = await build({
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		stdin: {
			resolveDir: process.cwd(),
			sourcefile: "agent-runtime-module-regressions.ts",
			contents: `
				export * from "./packages/browser-extension/src/agent/constitution";
				export * from "./packages/browser-extension/src/agent/execution-profile";
				export * from "./packages/browser-extension/src/tools/registry";
				export * from "./packages/browser-extension/src/tools/runtime-invariants";
			`,
		},
	});
	const source = result.outputFiles[0].text;
	return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

async function main() {
	const runtime = await loadRuntimeModules();

	assert.equal(runtime.resolveExecutionProfile().profile, "legacy");
	assert.equal(runtime.resolveExecutionProfile({ requestedProfile: "guided-agent" }).profile, "legacy");
	assert.deepEqual(
		runtime.resolveExecutionProfile({ requestedProfile: "guided-agent", legacyOnly: false }),
		{
			profile: "guided-agent",
			source: "requested",
			capabilities: runtime.DEFAULT_MODEL_EXECUTION_CAPABILITIES,
		},
	);
	assert.equal(runtime.resolveExecutionProfile({ legacyOnly: false }).profile, "full-agent");

	const constitutionPrompt = runtime.ONHAND_CONSTITUTION_PRINCIPLES.join("\n");
	assert.equal(runtime.assertConstitutionPrompt(constitutionPrompt), constitutionPrompt);
	assert.throws(() => runtime.assertConstitutionPrompt("The page is the canvas"), /missing constitution principles/);

	const registry = runtime.browserToolRegistrySnapshot();
	assert.equal(registry.all.length, new Set(registry.all).size);
	assert.ok(runtime.KNOWN_BROWSER_TOOL_NAMES.has("browser_list_tabs"));
	assert.ok(runtime.KNOWN_BROWSER_TOOL_NAMES.has("browser_pdf_read_pages"));
	assert.ok(registry.groups.learning.includes("onhand_record_learning_event"));

	assert.equal(runtime.normalizeOpenTabUrlForComparison("HTTPS://Example.COM/"), "https://example.com");
	assert.equal(runtime.normalizeOpenTabUrlForComparison("https://Example.COM/docs#intro"), "https://example.com/docs");
	assert.equal(
		runtime.normalizeOpenTabUrlForComparison("https://Example.COM/docs#intro", { keepFragment: true }),
		"https://example.com/docs#intro",
	);
	assert.equal(runtime.normalizeOpenTabUrlForComparison("https://example.com/Docs"), "https://example.com/Docs");

	const unchanged = { newTab: true, active: true };
	assert.equal(runtime.applyBackgroundFocusDefault(unchanged, "navigate"), unchanged);
	assert.deepEqual(
		runtime.applyBackgroundFocusDefault(unchanged, "navigate", { learningMode: true }),
		{ newTab: true, active: false },
	);
	assert.deepEqual(
		runtime.applyBackgroundFocusDefault({ active: true }, "open_pdf_in_onhand_viewer", { learningMode: true }),
		{ active: false },
	);
	assert.equal(
		runtime.applyBackgroundFocusDefault(unchanged, "navigate", { learningMode: true, sourceFocusRequested: true }),
		unchanged,
	);

	assert.equal(runtime.buildEmptyHighlightTextGuardResult("browser_highlight_text", "highlight_text", { text: "evidence" }), null);
	assert.equal(
		runtime.buildEmptyHighlightTextGuardResult("browser_highlight_text", "highlight_text", { text: " " }).guardrail.kind,
		"empty_highlight_text",
	);

	console.log("Agent runtime module regressions: PASS");
}

main().catch((error) => {
	console.error(error.stack || error.message || String(error));
	process.exitCode = 1;
});
