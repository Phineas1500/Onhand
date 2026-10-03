#!/usr/bin/env node
// Reloads the unpacked Onhand extension in a Chromium browser that was
// started with --remote-debugging-port, the debug-port equivalent of clicking
// reload on chrome://extensions. chrome.runtime.reload() does not reliably
// swap unpacked MV3 code (the old service worker can stay alive), but
// chrome.developerPrivate.reload from the chrome://extensions page does.
import WebSocket from "ws";

function parseArgs(argv) {
	const args = { port: Number(process.env.ONHAND_DEBUG_PORT || 9343), host: "127.0.0.1", id: "" };
	for (const value of argv) {
		if (value.startsWith("--port=")) args.port = Number(value.slice("--port=".length));
		else if (value.startsWith("--host=")) args.host = value.slice("--host=".length);
		else if (value.startsWith("--id=")) args.id = value.slice("--id=".length);
		else if (value === "-h" || value === "--help") {
			console.log(`Usage: npm run debug:reload-extension -- [--port=9343] [--host=127.0.0.1] [--id=<extension id>]

Reloads the unpacked Onhand extension through chrome://extensions over the
browser's remote-debugging port. Without --id, the unpacked extension named
Onhand is found automatically.`);
			process.exit(0);
		} else throw new Error(`Unknown option: ${value}`);
	}
	if (!Number.isInteger(args.port) || args.port <= 0) throw new Error("--port must be a positive integer.");
	return args;
}

function evaluate(ws, expression) {
	return new Promise((resolve, reject) => {
		const id = Math.floor(Math.random() * 1e9);
		const onMessage = (raw) => {
			const message = JSON.parse(raw);
			if (message.id !== id) return;
			ws.off("message", onMessage);
			if (message.error) reject(new Error(message.error.message));
			else if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.exception?.description || "evaluation failed"));
			else resolve(message.result?.result?.value);
		};
		ws.on("message", onMessage);
		ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
	});
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const base = `http://${args.host}:${args.port}`;
	const tab = await (await fetch(`${base}/json/new?chrome://extensions/`, { method: "PUT" })).json();
	const ws = new WebSocket(tab.webSocketDebuggerUrl, { perMessageDeflate: false });
	try {
		await new Promise((resolve, reject) => {
			ws.once("open", resolve);
			ws.once("error", reject);
		});
		// The extensions page exposes chrome.developerPrivate once it has loaded.
		for (let attempt = 0; attempt < 40; attempt++) {
			if (await evaluate(ws, "typeof chrome !== 'undefined' && Boolean(chrome.developerPrivate)")) break;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		let id = args.id;
		if (!id) {
			const candidates = await evaluate(
				ws,
				`chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true }).then((items) => items
					.filter((item) => item.location === "UNPACKED" && /^Onhand\\b/i.test(item.name))
					.map((item) => ({ id: item.id, name: item.name, path: item.prettifiedPath || "" })))`,
			);
			if (!candidates?.length) throw new Error("No unpacked extension named Onhand is loaded in this browser.");
			if (candidates.length > 1) {
				throw new Error(`Several unpacked Onhand extensions are loaded; pass --id. ${candidates.map((item) => `${item.id} (${item.path})`).join(", ")}`);
			}
			id = candidates[0].id;
		}
		const result = await evaluate(
			ws,
			`new Promise((resolve) => chrome.developerPrivate.reload(${JSON.stringify(id)}, { failQuietly: true }, () =>
				resolve(chrome.runtime.lastError ? "error: " + chrome.runtime.lastError.message : "ok")))`,
		);
		if (result !== "ok") throw new Error(`Reload failed for ${id}: ${result}`);
		console.log(`Reloaded Onhand (${id}) on ${args.host}:${args.port}`);
	} finally {
		ws.close();
		await fetch(`${base}/json/close/${tab.id}`).catch(() => {});
	}
}

main().catch((error) => {
	console.error(`reload-onhand-extension: ${error.message}`);
	process.exitCode = 1;
});
