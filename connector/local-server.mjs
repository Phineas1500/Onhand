#!/usr/bin/env node
// Onhand connector for agents that run on this computer (Claude Code, Codex,
// the Claude desktop app, Gemini CLI). The agent starts this program and
// talks MCP to it over stdin/stdout. The Onhand extension connects to it on
// 127.0.0.1, so page text goes from the browser to the agent without leaving
// the machine, and no Onhand server is involved.
//
//   ONHAND_CONNECTOR_TOKEN=<pairing code from Onhand's settings> node local-server.mjs
//
// Several agents can run at once. The first copy owns the port and holds the
// extension's connection; later copies pass their tool calls to it.

import { realpathSync } from "node:fs";
import http from "node:http";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import {
	EXTENSION_PROOF_PREFIX,
	HOST_PROOF_PREFIX,
	PAIRING_CODE_PATTERN,
	handleRpcMessage,
	hmacHex,
	parseErrorResponse,
	randomHex,
	sameText,
} from "./mcp-core.mjs";

export const DEFAULT_PORT = 8793;
const EXTENSION_ORIGIN_PATTERN = /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i;
const HANDSHAKE_TIMEOUT_MS = 5000;
const CALL_TIMEOUT_MS = 45000;
const EXTENSION_WAIT_MS = 8000;
// The extension retries a closed connection every 30 s at the slowest, so a
// call that arrives right after this program starts waits that long once.
const STARTUP_GRACE_MS = 35000;
const MAX_FORWARD_BODY_BYTES = 256 * 1024;

const NOT_PAIRED_TEXT =
	"Onhand is not paired with this agent. Ask the person to open Onhand's settings in their browser, turn on the connector, copy the pairing code, and set it as ONHAND_CONNECTOR_TOKEN for this connector.";
const NOT_CONNECTED_TEXT =
	"Onhand's browser extension is not connected. Ask the person to open the browser where Onhand is installed and check that the connector is turned on in Onhand's settings, then try again.";

export function createLocalConnector({ token = "", port = DEFAULT_PORT, log = () => {}, extensionWaitMs = EXTENSION_WAIT_MS, startupGraceMs = STARTUP_GRACE_MS, callTimeoutMs = CALL_TIMEOUT_MS } = {}) {
	const paired = PAIRING_CODE_PATTERN.test(token);
	let server = null;
	let sockets = null;
	let extension = null;
	let listeningSince = 0;
	let nextCallId = 1;
	const pendingCalls = new Map();
	const extensionWaiters = new Set();

	function setExtension(socket) {
		if (extension && extension !== socket) extension.close(4000, "Replaced by a newer connection");
		extension = socket;
		for (const waiter of [...extensionWaiters]) waiter();
	}

	function dropExtension(socket) {
		if (extension === socket) extension = null;
		for (const [id, pending] of pendingCalls) {
			if (pending.socket !== socket) continue;
			pendingCalls.delete(id);
			pending.reject(new Error("the browser disconnected before it answered"));
		}
	}

	async function acceptExtension(socket) {
		const nonce = randomHex();
		let authenticated = false;
		const timer = setTimeout(() => {
			if (!authenticated) socket.close(4001, "Pairing timed out");
		}, HANDSHAKE_TIMEOUT_MS);
		socket.on("close", () => {
			clearTimeout(timer);
			dropExtension(socket);
		});
		socket.on("error", () => {});
		socket.on("message", async (raw) => {
			const text = raw.toString();
			if (text === "ping") {
				socket.send("pong");
				return;
			}
			let message;
			try {
				message = JSON.parse(text);
			} catch {
				return;
			}
			if (!authenticated) {
				if (message?.type !== "auth" || typeof message.nonce !== "string") return socket.close(4002, "Expected pairing proof");
				const expected = await hmacHex(token, `${EXTENSION_PROOF_PREFIX}${nonce}`);
				if (!sameText(message.proof, expected)) {
					log("An extension tried to connect with a different pairing code.");
					return socket.close(4003, "Pairing code does not match");
				}
				authenticated = true;
				clearTimeout(timer);
				socket.send(JSON.stringify({ type: "ready", proof: await hmacHex(token, `${HOST_PROOF_PREFIX}${message.nonce}`) }));
				setExtension(socket);
				log(`Onhand extension connected (version ${String(message.version || "unknown").slice(0, 20)}).`);
				return;
			}
			if (message?.type === "result" && pendingCalls.has(message.id)) {
				const pending = pendingCalls.get(message.id);
				pendingCalls.delete(message.id);
				pending.resolve({ text: String(message.text || ""), isError: Boolean(message.isError) });
			}
		});
		socket.send(JSON.stringify({ type: "challenge", nonce }));
	}

	async function readBody(request) {
		const chunks = [];
		let size = 0;
		for await (const chunk of request) {
			size += chunk.length;
			if (size > MAX_FORWARD_BODY_BYTES) throw new Error("too large");
			chunks.push(chunk);
		}
		return Buffer.concat(chunks).toString("utf8");
	}

	// Another copy of this program, started by a second agent, sends its tool
	// calls here. A web page can reach 127.0.0.1 too, so the request must carry
	// the pairing code and must not come from a browser origin.
	async function handleHttp(request, response) {
		const send = (status, body) => {
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(body));
		};
		if (request.method !== "POST" || request.url !== "/call") return send(404, { error: "not found" });
		if (request.headers.origin !== undefined) return send(403, { error: "forbidden" });
		const bearer = /^Bearer (.+)$/.exec(String(request.headers.authorization || ""))?.[1] || "";
		if (!paired || !sameText(bearer, token)) return send(401, { error: "pairing code does not match" });
		try {
			const body = JSON.parse(await readBody(request));
			send(200, await callExtensionDirect(String(body.tool || ""), body.args ?? {}));
		} catch (error) {
			send(400, { error: error?.message || String(error) });
		}
	}

	function listen() {
		return new Promise((resolve, reject) => {
			const candidate = http.createServer((request, response) => {
				handleHttp(request, response).catch(() => response.destroy());
			});
			const socketServer = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
			candidate.on("upgrade", (request, socket, head) => {
				const origin = String(request.headers.origin || "");
				if (!paired || request.url !== "/socket" || !EXTENSION_ORIGIN_PATTERN.test(origin)) {
					socket.destroy();
					return;
				}
				socketServer.handleUpgrade(request, socket, head, (webSocket) => {
					acceptExtension(webSocket).catch(() => webSocket.close(1011, "Pairing failed"));
				});
			});
			candidate.once("error", (error) => {
				if (error?.code === "EADDRINUSE") resolve(false);
				else reject(error);
			});
			candidate.listen(port, "127.0.0.1", () => {
				server = candidate;
				sockets = socketServer;
				listeningSince = Date.now();
				log(`Listening for the Onhand extension on 127.0.0.1:${port}.`);
				resolve(true);
			});
		});
	}

	function waitForExtension(timeoutMs) {
		if (extension) return Promise.resolve(true);
		return new Promise((resolve) => {
			const done = (value) => {
				clearTimeout(timer);
				extensionWaiters.delete(onConnect);
				resolve(value);
			};
			const onConnect = () => done(true);
			const timer = setTimeout(() => done(false), timeoutMs);
			extensionWaiters.add(onConnect);
		});
	}

	async function callExtensionDirect(tool, args) {
		const waitMs = Math.max(extensionWaitMs, startupGraceMs - (Date.now() - listeningSince));
		if (!(await waitForExtension(waitMs))) return { text: NOT_CONNECTED_TEXT, isError: true };
		const socket = extension;
		const id = `call-${nextCallId++}`;
		return await new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				pendingCalls.delete(id);
				reject(new Error("the browser took too long to answer"));
			}, callTimeoutMs);
			pendingCalls.set(id, {
				socket,
				resolve: (value) => {
					clearTimeout(timer);
					resolve(value);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			socket.send(JSON.stringify({ type: "call", id, tool, args }));
		});
	}

	async function forwardToOwner(tool, args) {
		const response = await fetch(`http://127.0.0.1:${port}/call`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
			body: JSON.stringify({ tool, args }),
			signal: AbortSignal.timeout(callTimeoutMs + Math.max(extensionWaitMs, startupGraceMs) + 2000),
		});
		const body = await response.json().catch(() => ({}));
		if (response.status === 401) {
			return {
				text: "Another Onhand connector is already running on this computer with a different pairing code. Use the same pairing code for every agent, or close the other one.",
				isError: true,
			};
		}
		if (!response.ok) throw new Error(body?.error || `the running connector answered ${response.status}`);
		return { text: String(body.text || ""), isError: Boolean(body.isError) };
	}

	async function callExtension(tool, args) {
		if (!paired) return { text: NOT_PAIRED_TEXT, isError: true };
		for (let attempt = 0; attempt < 2; attempt += 1) {
			if (!server && !(await listen())) {
				try {
					return await forwardToOwner(tool, args);
				} catch (error) {
					// The copy that owned the port has exited: take the port over.
					if (attempt === 0 && /ECONNREFUSED|fetch failed/i.test(`${error?.cause?.code || ""} ${error?.message || ""}`)) continue;
					throw error;
				}
			}
			return await callExtensionDirect(tool, args);
		}
		return { text: NOT_CONNECTED_TEXT, isError: true };
	}

	return {
		paired,
		callExtension,
		// Take the port now if it is free, so the extension can connect before
		// the first tool call arrives.
		async start() {
			if (paired && !server) await listen().catch((error) => log(`Could not listen on 127.0.0.1:${port}: ${error?.message || error}`));
			return Boolean(server);
		},
		async close() {
			for (const client of sockets?.clients || []) client.terminate();
			sockets?.close();
			await new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
			server = null;
			sockets = null;
		},
		isOwner: () => Boolean(server),
		isExtensionConnected: () => Boolean(extension),
	};
}

export function serveStdio(connector, { input = process.stdin, output = process.stdout, onEnd = () => {} } = {}) {
	const lines = createInterface({ input, crlfDelay: Infinity });
	const write = (message) => output.write(`${JSON.stringify(message)}\n`);
	lines.on("line", (line) => {
		if (!line.trim()) return;
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			write(parseErrorResponse());
			return;
		}
		handleRpcMessage(message, { callExtension: connector.callExtension })
			.then(({ response }) => {
				if (response) write(response);
			})
			.catch((error) => {
				if (message?.id !== undefined && message?.id !== null) write({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: `Internal error: ${error?.message || error}` } });
			});
	});
	lines.on("close", onEnd);
	return lines;
}

function argumentValue(name) {
	const index = process.argv.indexOf(name);
	return index > 0 ? process.argv[index + 1] : undefined;
}

function isMainModule() {
	try {
		return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
	} catch {
		return false;
	}
}

if (isMainModule()) {
	const log = (text) => process.stderr.write(`[onhand-connector] ${text}\n`);
	const token = String(argumentValue("--token") || process.env.ONHAND_CONNECTOR_TOKEN || "").trim();
	const port = Number(argumentValue("--port") || process.env.ONHAND_CONNECTOR_PORT || DEFAULT_PORT);
	const connector = createLocalConnector({ token, port, log });
	if (!connector.paired) log("No valid pairing code. Set ONHAND_CONNECTOR_TOKEN to the code shown in Onhand's settings.");
	await connector.start();
	serveStdio(connector, {
		onEnd: () => {
			connector.close().finally(() => process.exit(0));
		},
	});
}
