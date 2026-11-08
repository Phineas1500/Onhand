import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The welcome page's "Open Onhand on this page" button messages the
// extension, whose listener opens the side panel for the sender's window.
// Only useonhand.com may message it, and Firefox (no website messaging) drops
// the manifest entry. The production listener runs here against fakes.
export async function runWelcomeOpenRegressions() {
	const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
	const manifest = JSON.parse(await read("packages/browser-extension/manifest.json"));
	assert.deepEqual(manifest.externally_connectable, { matches: ["https://useonhand.com/*"] }, "only the Onhand website may message the extension");
	assert.match(await read("scripts/package-extension.mjs"), /delete firefox\.externally_connectable;/, "the Firefox package drops externally_connectable");

	const source = await read("packages/browser-extension/background.js");
	const start = source.indexOf("chrome.runtime.onMessageExternal?.addListener(");
	assert.ok(start > 0, "background.js listens for the welcome page");
	const block = source.slice(start, source.indexOf("\n});\n", start) + 4);
	let listener = null;
	const opened = [];
	const fakeChrome = { runtime: { onMessageExternal: { addListener: (fn) => { listener = fn; } } } };
	new Function("chrome", "openSidebarForWindow", "requestSidebarQuickOpen", block)(
		fakeChrome,
		async (windowId) => { if (windowId === 99) throw new Error("Chrome blocked auto-opening the side panel."); opened.push(windowId); },
		async () => {},
	);
	const send = (message, sender) => new Promise((resolve) => {
		const keepsChannel = listener(message, sender, resolve);
		if (!keepsChannel) setTimeout(() => resolve("no reply"), 20);
	});
	assert.deepEqual(await send({ type: "onhand:ping" }, { tab: { windowId: 3 } }), { ok: true });
	assert.deepEqual(await send({ type: "onhand:open-panel" }, { tab: { windowId: 3 } }), { ok: true });
	assert.deepEqual(opened, [3], "the panel opens in the welcome page's window");
	assert.deepEqual(await send({ type: "onhand:open-panel" }, { tab: { windowId: 99 } }), { ok: false, error: "Chrome blocked auto-opening the side panel." });
	assert.equal(await send({ type: "onhand:open-panel" }, {}), "no reply", "a message without a tab is ignored");
	assert.equal(await send({ type: "browser-runtime:update-settings" }, { tab: { windowId: 3 } }), "no reply", "other messages are ignored");
	console.log("Welcome page opens the side panel passed");
}
