import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

// Right-clicking selected text offers "Explain with Onhand". The production
// menu code runs here against fakes: the click opens the panel before
// anything is awaited and hands the panel the selected text.
export async function runContextMenuRegressions() {
	const manifest = JSON.parse(await read("packages/browser-extension/manifest.json"));
	assert.ok(manifest.permissions.includes("contextMenus"), "the manifest asks for the right-click menu");

	const source = await read("packages/browser-extension/background.js");
	const start = source.indexOf("const ONHAND_CONTEXT_MENU_ID =");
	const end = source.indexOf("chrome.windows.onRemoved.addListener(", start);
	assert.ok(start > 0 && end > start, "background.js defines the right-click menu");
	const menuCalls = [];
	const order = [];
	const requests = [];
	let onClicked = null;
	const storage = { onhandContextMenuEnabled: true };
	const fakeChrome = {
		runtime: { lastError: undefined },
		storage: { local: { get: async (defaults) => ({ ...defaults, ...storage }) } },
		contextMenus: {
			removeAll: async () => { menuCalls.push("removeAll"); },
			create: (properties, callback) => { menuCalls.push(properties); callback?.(); },
			onClicked: { addListener: (listener) => { onClicked = listener; } },
		},
	};
	const syncContextMenu = new Function(
		"chrome", "openSidebarForWindow", "requestSidebarQuickOpen", "resolveSidebarWindowId", "log",
		`${source.slice(start, end)}\nreturn syncContextMenu;`,
	)(
		fakeChrome,
		(windowId) => {
			order.push(`open:${windowId}`);
			return windowId === 99 ? Promise.reject(new Error("Chrome blocked auto-opening the side panel.")) : Promise.resolve({ windowId, open: true });
		},
		async (windowId, extra) => { order.push(`request:${windowId}`); requests.push({ windowId, ...extra }); },
		async () => 5,
		() => {},
	);

	assert.equal(await syncContextMenu(), true);
	assert.deepEqual(menuCalls, ["removeAll", { id: "onhand-explain-selection", title: "Explain with Onhand", contexts: ["selection"] }]);
	storage.onhandContextMenuEnabled = false;
	menuCalls.length = 0;
	assert.equal(await syncContextMenu(), false, "Options can turn the entry off");
	assert.deepEqual(menuCalls, ["removeAll"]);

	const click = async (info, tab) => {
		onClicked(info, tab);
		const openedSynchronously = [...order];
		await new Promise((resolve) => setTimeout(resolve, 10));
		return openedSynchronously;
	};
	assert.deepEqual(await click({ menuItemId: "onhand-explain-selection", selectionText: "  a selected sentence  " }, { windowId: 3 }), ["open:3"], "the panel opens while the click is still being handled");
	assert.deepEqual(requests, [{ windowId: 3, ask: { text: "a selected sentence" } }]);
	assert.deepEqual(order, ["open:3", "request:3"]);

	// A click inside the panel has no tab: nothing to open, and the question still goes through.
	await click({ menuItemId: "onhand-explain-selection", selectionText: "from the answer" }, undefined);
	assert.deepEqual(requests.at(-1), { windowId: 5, ask: { text: "from the answer" } });
	assert.equal(order.includes("open:5"), false);

	// The question still waits for a panel the browser refused to open.
	await click({ menuItemId: "onhand-explain-selection", selectionText: "blocked" }, { windowId: 99 });
	assert.deepEqual(requests.at(-1), { windowId: 99, ask: { text: "blocked" } });

	const before = requests.length;
	await click({ menuItemId: "another-extension-item", selectionText: "x" }, { windowId: 3 });
	await click({ menuItemId: "onhand-explain-selection", selectionText: "   " }, { windowId: 3 });
	assert.equal(requests.length, before, "other menu items and empty selections do nothing");
	await click({ menuItemId: "onhand-explain-selection", selectionText: "x".repeat(9000) }, { windowId: 3 });
	assert.equal(requests.at(-1).ask.text.length, 4000, "a huge selection is cut");
	console.log("Right-click menu opens the panel and asks passed");
}
