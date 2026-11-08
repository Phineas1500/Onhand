import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Page commands on a tab Memory Saver discarded timed out after 9 s, and on a
// tab still opening were refused as not a web page. The production helpers
// run here against a fake chrome.tabs; no real browser is controlled.
export async function runTabWakeRegressions() {
	const source = await readFile(new URL("../../packages/browser-extension/background.js", import.meta.url), "utf8");
	const functions = ["wakeTabForPageCommand", "waitForTabComplete"].map((name) => {
		const match = new RegExp(`^async function ${name}\\(`, "m").exec(source);
		assert.ok(match, `Missing production function ${name}`);
		return source.slice(match.index, source.indexOf("\n}", match.index) + 2);
	}).join("\n");
	function harness(tab, { loadsAfterMs = 30 } = {}) {
		const state = { ...tab };
		const reloads = [];
		const listeners = new Set();
		const finishLoading = () => setTimeout(() => {
			Object.assign(state, { status: "complete", discarded: false, pendingUrl: undefined, url: state.pendingUrl || state.url });
			for (const listener of listeners) listener(state.id, { status: "complete" }, { ...state });
		}, loadsAfterMs);
		const chrome = {
			tabs: {
				get: async () => ({ ...state }),
				reload: async (id) => { reloads.push(id); Object.assign(state, { status: "loading", discarded: false }); finishLoading(); },
				onUpdated: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
			},
		};
		if (state.status === "loading") finishLoading();
		const wake = new Function("chrome", "log", "TAB_WAKE_TIMEOUT_MS", "TAB_COMPLETE_POLL_MS", `${functions}\nreturn wakeTabForPageCommand;`)(chrome, () => {}, 2000, 20);
		return { wake, reloads };
	}

	const discarded = harness({ id: 7, status: "unloaded", discarded: true, active: false, url: "https://example.test/a" });
	const woken = await discarded.wake({ id: 7, status: "unloaded", discarded: true, active: false, url: "https://example.test/a" });
	assert.deepEqual(discarded.reloads, [7], "a discarded tab is reloaded in place");
	assert.equal(woken.status, "complete");
	assert.equal(woken.discarded, false);

	const opening = harness({ id: 8, status: "loading", active: false, url: "", pendingUrl: "https://example.test/b" });
	const opened = await opening.wake({ id: 8, status: "loading", active: false, url: "", pendingUrl: "https://example.test/b" });
	assert.deepEqual(opening.reloads, [], "a tab still opening is waited for, not reloaded");
	assert.equal(opened.url, "https://example.test/b");

	const loaded = harness({ id: 9, status: "complete", active: false, url: "https://example.test/c" });
	const same = { id: 9, status: "complete", active: false, url: "https://example.test/c" };
	assert.equal(await loaded.wake(same), same, "a loaded tab passes straight through");
	const slowPage = { id: 10, status: "loading", active: true, url: "https://example.test/d" };
	assert.equal(await harness(slowPage).wake(slowPage), slowPage, "a page that is loading at its own URL is left to the page tools");
	console.log("Discarded and still-opening tabs wake for page commands passed");
}
