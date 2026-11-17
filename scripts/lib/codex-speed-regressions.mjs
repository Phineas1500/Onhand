import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ChatGPT sign-in offers GPT-6.2 Sol and a three-way speed choice. Fast is
// service_tier "priority" on every Codex model; Ultrafast is service_tier
// "ultrafast" on the models Codex lists it for, and falls back to Fast on the
// others (the internal calls that run on GPT-6 Luna).
export async function runCodexSpeedRegressions({ installChromeStorageStub, createReplayHost }) {
	installChromeStorageStub();
	const { createOnhandBrowserRuntime, __browserRuntimeTest: test } = await import("../../packages/browser-extension/onhand-runtime.bundle.js");

	// The picker.
	const codexModels = test.getProviderModelOptions("openai-codex");
	const byId = (id) => codexModels.find((model) => model.id === id);
	assert.equal(codexModels[0]?.id, "gpt-6.2-sol", "the newest Codex model leads the picker");
	assert.equal(byId("gpt-6.2-sol").name, "GPT-6.2 Sol");
	assert.deepEqual(byId("gpt-6.2-sol").speeds, ["standard", "fast", "ultrafast"], "GPT-6.2 Sol offers Ultrafast");
	for (const id of ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra", "gpt-5.6-sol"]) {
		assert.deepEqual(byId(id)?.speeds, ["standard", "fast"], `${id} offers Standard and Fast`);
	}
	assert.equal(codexModels.filter((model) => model.id === "gpt-6.2-sol").length, 1, "a catalog that later lists the model must not duplicate it");
	assert.equal(test.getProviderModelOptions("openai")[0]?.speeds, undefined, "speed is a ChatGPT sign-in setting only");
	assert.equal(test.normalizeModelForProvider("gpt-6.2-sol", "openai-codex", "oauth"), "gpt-6.2-sol", "the choice is kept");
	const fallback = test.buildOpenAICodexFallbackModel("gpt-6.2-sol");
	assert.equal(fallback?.api, "openai-codex-responses");
	assert.equal(fallback?.thinkingLevelMap?.off, null, "GPT-6.2 Sol cannot turn reasoning off");
	assert.equal(fallback?.contextWindow, 500000);

	// The tier one request carries.
	const tier = test.codexServiceTierForTest;
	assert.equal(tier("gpt-6.2-sol", "ultrafast"), "ultrafast");
	assert.equal(tier("gpt-6.2-sol", "fast"), "priority");
	assert.equal(tier("gpt-6.2-sol", "standard"), undefined);
	assert.equal(tier("gpt-6-luna", "ultrafast"), "priority", "a model without Ultrafast gets Fast");
	assert.equal(tier("gpt-6.1-sol", "fast"), "priority");
	for (const unset of [undefined, null, "", true, "priority", "ULTRAFAST"]) assert.equal(tier("gpt-6.2-sol", unset), undefined, `${JSON.stringify(unset)} is Standard`);

	// The saved setting, including the checkbox it replaced.
	const speed = test.normalizeCodexSpeedForTest;
	assert.equal(speed("ultrafast"), "ultrafast");
	assert.equal(speed("fast"), "fast");
	assert.equal(speed("standard", true), "standard", "a saved choice wins over the old checkbox");
	assert.equal(speed(undefined, true), "fast", "the old Fast mode checkbox carries over as Fast");
	assert.equal(speed(undefined, false), "standard");
	assert.equal(speed("turbo"), "standard");

	globalThis.chrome.storage.local.data.onhandBrowserRuntime.settings.codexFastModeEnabled = true;
	const runtime = createOnhandBrowserRuntime(createReplayHost());
	assert.equal((await runtime.getSettings()).codexSpeed, "fast", "a profile with Fast mode on opens on Fast");
	assert.equal((await runtime.updateSettings({ codexSpeed: "ultrafast" })).codexSpeed, "ultrafast");
	assert.equal((await runtime.updateSettings({ learningMode: false })).codexSpeed, "ultrafast", "an unrelated save keeps the speed");
	assert.equal(globalThis.chrome.storage.local.data.onhandBrowserRuntime.settings.codexSpeed, "ultrafast", "the choice is stored");
	assert.equal((await runtime.updateSettings({ codexSpeed: "warp" })).codexSpeed, "standard", "an unknown value is Standard");
	assert.equal((await runtime.getSettings()).codexFastModeEnabled, undefined, "the old field is gone from what pages read");

	// What goes to Codex. The request is captured as it is built and stopped
	// before any network call.
	const token = `x.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_test" } })).toString("base64url")}.x`;
	const originalFetch = globalThis.fetch;
	const originalWebSocket = globalThis.WebSocket;
	let networkCalls = 0;
	globalThis.fetch = async () => {
		networkCalls += 1;
		throw new Error("no network in this test");
	};
	globalThis.WebSocket = class {
		constructor() {
			networkCalls += 1;
			throw new Error("no network in this test");
		}
	};
	const requestBody = async (modelId, onhandCodexSpeed) => {
		const model = modelId === "gpt-6.2-sol" ? fallback : { ...fallback, id: modelId, name: modelId, thinkingLevelMap: { off: "none", minimal: "low", low: "low" } };
		let body = null;
		const stream = test.streamOnhandProviderForTest(
			model,
			{ systemPrompt: "Answer briefly.", messages: [{ role: "user", content: [{ type: "text", text: "Hello" }], timestamp: 0 }] },
			{
				apiKey: token,
				onhandCodexSpeed,
				onPayload: (payload) => {
					body = payload;
					throw new Error("captured");
				},
			},
		);
		await stream.result();
		assert.ok(body, `${modelId} should build a Codex request`);
		return body;
	};
	try {
		const ultrafast = await requestBody("gpt-6.2-sol", "ultrafast");
		assert.equal(ultrafast.model, "gpt-6.2-sol");
		assert.equal(ultrafast.service_tier, "ultrafast", "Ultrafast on GPT-6.2 Sol asks for the ultrafast tier");
		assert.equal(ultrafast.reasoning?.effort, "low", "GPT-6.2 Sol rejects effort none, so Onhand asks for low");
		assert.equal((await requestBody("gpt-6.2-sol", "fast")).service_tier, "priority");
		assert.equal("service_tier" in (await requestBody("gpt-6.2-sol", "standard")), false, "Standard sends no tier");
		assert.equal("service_tier" in (await requestBody("gpt-6.2-sol", undefined)), false);
		assert.equal((await requestBody("gpt-6-luna", "ultrafast")).service_tier, "priority", "Luna calls under an Ultrafast choice run on Fast");
		assert.equal("service_tier" in (await requestBody("gpt-6-luna", "standard")), false);
	} finally {
		globalThis.fetch = originalFetch;
		globalThis.WebSocket = originalWebSocket;
	}
	assert.equal(networkCalls, 0, "the request-shape check must not reach the network");

	// The settings page: a Speed menu in place of the checkbox, the old saved
	// checkbox read as Fast, and Ultrafast offered per model.
	const optionsHtml = await readFile(new URL("../../packages/browser-extension/options.html", import.meta.url), "utf8");
	const optionsJs = await readFile(new URL("../../packages/browser-extension/options.js", import.meta.url), "utf8");
	const backgroundJs = await readFile(new URL("../../packages/browser-extension/background.js", import.meta.url), "utf8");
	const speedSelect = optionsHtml.match(/<select id="codexSpeed">([\s\S]*?)<\/select>/)?.[1] || "";
	assert.deepEqual([...speedSelect.matchAll(/<option value="([a-z]+)">/g)].map((match) => match[1]), ["standard", "fast", "ultrafast"]);
	assert.doesNotMatch(optionsHtml, /codexFastMode/);
	assert.match(optionsJs, /codexSpeed: codexSpeedInput\.value,/, "the page saves the chosen speed");
	assert.match(optionsJs, /runtimeSettings\.codexSpeed \|\| \(runtimeSettings\.codexFastModeEnabled === true \? "fast" : "standard"\)/, "the page reads the old checkbox as Fast");
	assert.match(backgroundJs, /codexSpeed: message\.codexSpeed,/, "the background passes the speed to the runtime");
	assert.doesNotMatch(backgroundJs, /codexFastModeEnabled/);

	console.log("Codex speed: GPT-6.2 Sol is offered, Ultrafast goes out as its own tier and falls back to Fast elsewhere passed");
}
