import assert from "node:assert/strict";
import { startFixtureServer } from "./serve-browser-runtime-fixture.mjs";

async function assertSelectionFormatting() {
	const { __browserRuntimeTest } = await import("../packages/browser-extension/onhand-runtime.bundle.js");
	const { formatToolResultForModel, getSelectionText } = __browserRuntimeTest || {};
	assert.equal(typeof formatToolResultForModel, "function", "browser runtime test formatter export is missing");
	assert.equal(typeof getSelectionText, "function", "browser runtime selection formatter export is missing");

	const emptyCases = [
		undefined,
		null,
		"",
		{},
		{ text: "" },
		{ text: "   " },
		{ rangeCount: 0 },
		{ anchorNode: {}, focusNode: {} },
	];
	for (const selection of emptyCases) {
		assert.equal(getSelectionText(selection), "", `expected empty selection for ${JSON.stringify(selection)}`);
		const resultText = formatToolResultForModel("browser_get_selection", { selection });
		assert.equal(resultText, "No selected text.");
		assert.doesNotMatch(resultText, /\[object Object\]/);
	}

	const selectedText = formatToolResultForModel("browser_get_selection", { selection: { text: " Alpha smoke content " } });
	assert.equal(selectedText, "Selected text:\nAlpha smoke content");
}

async function assertFixtureResponses() {
	const fixture = await startFixtureServer({ port: 0 });
	try {
		const pageResponse = await fetch(fixture.url, { headers: { "Cache-Control": "no-store" } });
		assert.equal(pageResponse.status, 200);
		assert.match(await pageResponse.text(), /Alpha smoke content/);

		const jsonResponse = await fetch(new URL("/fixture.json?source=regression", fixture.url), { headers: { "Cache-Control": "no-store" } });
		assert.equal(jsonResponse.status, 200);
		assert.equal(jsonResponse.headers.get("cache-control"), "no-store");
		const json = await jsonResponse.json();
		assert.equal(json.ok, true);
		assert.equal(json.label, "fixture-json");
	} finally {
		await new Promise((resolve, reject) => fixture.server.close((error) => (error ? reject(error) : resolve())));
	}
}

async function main() {
	await assertSelectionFormatting();
	await assertFixtureResponses();
	console.log("Browser runtime regressions: PASS");
}

main().catch((error) => {
	console.error(error?.stack || error?.message || String(error));
	process.exitCode = 1;
});
