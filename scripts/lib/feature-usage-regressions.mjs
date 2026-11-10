import assert from "node:assert/strict";

// Feature-usage events carry one name from a fixed list and nothing else.
export async function runFeatureUsageRegressions({ installChromeStorageStub, createReplayHost }) {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime, __browserRuntimeTest: test } = await import("../../packages/browser-extension/onhand-runtime.bundle.js");

	const names = test.askFeatureNamesForTest;
	assert.deepEqual(names({ entry: "typed", url: "https://example.test/article" }), [], "a typed question on a web page adds nothing");
	assert.deepEqual(
		names({ entry: "starter", learningMode: true, attachmentCount: 2, selectionText: " a selected line ", url: "https://example.test/paper.pdf" }),
		["ask_starter", "ask_learning", "ask_attachment", "ask_selection", "ask_on_pdf"],
	);
	assert.deepEqual(names({ entry: "followup", url: "chrome-extension://abc/pdf-viewer.html?url=https%3A%2F%2Fexample.test%2Fa" }), ["ask_followup", "ask_on_pdf"]);
	assert.deepEqual(names({ entry: "context-menu", url: "https://docs.google.com/document/d/abc123/edit" }), ["ask_context_menu", "ask_on_doc"]);
	assert.deepEqual(names({ entry: "Explain this private sentence", url: "file:///Users/me/notes.pdf" }), ["ask_on_pdf"], "an unknown entry is not a name");

	const originalFetch = globalThis.fetch;
	const sent = [];
	globalThis.chrome.storage.local.data.onhandFreeTierBaseUrl = "https://free.test/v1";
	globalThis.fetch = async (url, init = {}) => {
		if (String(url) === "https://free.test/v1/telemetry") sent.push(JSON.parse(String(init.body || "{}")));
		return new Response("", { status: 202 });
	};
	try {
		const settings = globalThis.chrome.storage.local.data.onhandBrowserRuntime.settings;
		globalThis.chrome.storage.local.data.onhandBrowserRuntime.settings = { ...settings, diagnosticsEnabled: false };
		let runtime = createOnhandBrowserRuntime(createReplayHost());
		assert.deepEqual(await runtime.trackEvent("feature_used", { result: "notes_copied" }), { tracked: false }, "nothing is sent while usage data isn't shared");

		globalThis.chrome.storage.local.data.onhandBrowserRuntime.settings = { ...settings, diagnosticsEnabled: true };
		runtime = createOnhandBrowserRuntime(createReplayHost());
		assert.deepEqual(await runtime.trackEvent("feature_used", { result: "notes_copied" }), { tracked: true });
		assert.deepEqual(await runtime.trackEvent("feature_used", { result: "Explain this private sentence" }), { tracked: false }, "an unlisted name is dropped");
		assert.deepEqual(await runtime.trackEvent("feature_used", {}), { tracked: false });
		assert.equal(sent.length, 1);
		assert.equal(sent[0].event_name, "feature_used");
		assert.equal(sent[0].data.result, "notes_copied");
	} finally {
		globalThis.fetch = originalFetch;
		delete globalThis.chrome.storage.local.data.onhandFreeTierBaseUrl;
	}
	console.log("Feature usage events carry only listed names passed");
}
