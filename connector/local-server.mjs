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
// A second copy of this program proves the pairing code to the copy that
// owns the port, and checks that copy in turn, without sending the code.
const FORWARD_HELLO_PREFIX = "onhand-forward-hello:";
const FORWARD_CALL_PREFIX = "onhand-forward-call:";
const FORWARD_RESULT_PREFIX = "onhand-forward-result:";
const FORWARD_HELLO_TIMEOUT_MS = 5000;
const FORWARD_NONCE_TTL_MS = 30000;
const MAX_FORWARD_NONCES = 256;
const NONCE_PATTERN = /^[0-9a-f]{32}$/;

const NOT_PAIRED_TEXT =
	"Onhand is not paired with this agent. Ask the person to open Onhand's settings in their browser, turn on the connector, copy the pairing code, and set it as ONHAND_CONNECTOR_TOKEN for this connector.";
const OTHER_CODE_TEXT =
	"Another Onhand connector is already running on this computer with a different pairing code. Use the same pairing code for every agent, or close the other one.";
const PORT_TAKEN_TEXT = (port) =>
	`Another program is using Onhand's connector port (${port}) on this computer, and it is not Onhand's connector. Close that program and try again. Nothing was sent to it.`;
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
	// Nonces this copy has handed to forwarding copies: each is good for one
	// call, for a short time.
	const forwardNonces = new Map();

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
	// calls here. A web page can reach 127.0.0.1 too, and so can any other
	// program on this computer, so nothing is run for a caller that has not
	// proved it holds the pairing code. The code itself never crosses: the
	// caller asks for a nonce (and gets this copy's proof with it), then signs
	// that nonce and its request. A nonce is used once, so a request that was
	// captured cannot be sent again.
	async function handleHttp(request, response) {
		const send = (status, body) => {
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(body));
		};
		if (request.method !== "POST" || (request.url !== "/hello" && request.url !== "/call")) return send(404, { error: "not found" });
		if (request.headers.origin !== undefined) return send(403, { error: "forbidden" });
		if (!paired) return send(401, { error: "not paired" });
		let raw;
		try {
			raw = await readBody(request);
		} catch {
			return send(413, { error: "too large" });
		}
		const now = Date.now();
		for (const [nonce, expires] of forwardNonces) {
			if (expires <= now) forwardNonces.delete(nonce);
		}
		if (request.url === "/hello") {
			let clientNonce = "";
			try {
				clientNonce = String(JSON.parse(raw)?.nonce || "");
			} catch {}
			if (!NONCE_PATTERN.test(clientNonce)) return send(400, { error: "bad nonce" });
			if (forwardNonces.size >= MAX_FORWARD_NONCES) return send(429, { error: "too many pending calls" });
			const nonce = randomHex();
			forwardNonces.set(nonce, now + FORWARD_NONCE_TTL_MS);
			return send(200, { nonce, proof: await hmacHex(token, `${FORWARD_HELLO_PREFIX}${clientNonce}`) });
		}
		const nonce = String(request.headers["x-onhand-nonce"] || "");
		const known = forwardNonces.delete(nonce);
		const expected = await hmacHex(token, `${FORWARD_CALL_PREFIX}${nonce}:${raw}`);
		if (!known || !sameText(request.headers["x-onhand-proof"], expected)) return send(401, { error: "pairing code does not match" });
		try {
			const body = JSON.parse(raw);
			const outcome = await callExtensionDirect(String(body.tool || ""), body.args ?? {}, String(body.client || ""));
			const text = String(outcome?.text || "");
			const isError = Boolean(outcome?.isError);
			send(200, { text, isError, proof: await hmacHex(token, `${FORWARD_RESULT_PREFIX}${nonce}:${JSON.stringify([text, isError])}`) });
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

	// `client` is the name the calling app gave for itself, for display.
	async function callExtensionDirect(tool, args, client = "") {
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
			socket.send(JSON.stringify({ type: "call", id, tool, args, client }));
		});
	}

	// Whatever holds the port is not trusted until it proves the pairing code:
	// a program that got there first is told nothing about the call, and what
	// it sends back is not passed on as page text.
	async function forwardToOwner(tool, args, client = "") {
		const base = `http://127.0.0.1:${port}`;
		const headers = { "content-type": "application/json" };
		const clientNonce = randomHex();
		let greeting = null;
		try {
			const hello = await fetch(`${base}/hello`, { method: "POST", headers, body: JSON.stringify({ nonce: clientNonce }), signal: AbortSignal.timeout(FORWARD_HELLO_TIMEOUT_MS) });
			greeting = hello.ok ? await hello.json().catch(() => null) : null;
		} catch (error) {
			// Nothing answering at all means the owner has exited; a program that
			// accepts the connection and then stalls is not Onhand's connector.
			if (error?.name !== "TimeoutError") throw error;
		}
		const ownerNonce = String(greeting?.nonce || "");
		const answeredLikeConnector = NONCE_PATTERN.test(ownerNonce) && typeof greeting?.proof === "string";
		if (!answeredLikeConnector || !sameText(greeting.proof, await hmacHex(token, `${FORWARD_HELLO_PREFIX}${clientNonce}`))) {
			log(`The program on 127.0.0.1:${port} could not prove the pairing code; the call was not sent to it.`);
			return { text: answeredLikeConnector ? OTHER_CODE_TEXT : PORT_TAKEN_TEXT(port), isError: true };
		}
		const body = JSON.stringify({ tool, args, client });
		const response = await fetch(`${base}/call`, {
			method: "POST",
			headers: { ...headers, "x-onhand-nonce": ownerNonce, "x-onhand-proof": await hmacHex(token, `${FORWARD_CALL_PREFIX}${ownerNonce}:${body}`) },
			body,
			signal: AbortSignal.timeout(callTimeoutMs + Math.max(extensionWaitMs, startupGraceMs) + 2000),
		});
		const reply = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(reply?.error || `the running connector answered ${response.status}`);
		const text = String(reply.text || "");
		const isError = Boolean(reply.isError);
		if (!sameText(reply.proof, await hmacHex(token, `${FORWARD_RESULT_PREFIX}${ownerNonce}:${JSON.stringify([text, isError])}`))) {
			return { text: PORT_TAKEN_TEXT(port), isError: true };
		}
		return { text, isError };
	}

	async function callExtension(tool, args, meta = {}) {
		if (!paired) return { text: NOT_PAIRED_TEXT, isError: true };
		const client = String(meta?.client || "");
		for (let attempt = 0; attempt < 2; attempt += 1) {
			if (!server && !(await listen())) {
				try {
					return await forwardToOwner(tool, args, client);
				} catch (error) {
					// The copy that owned the port has exited: take the port over.
					if (attempt === 0 && /ECONNREFUSED|fetch failed/i.test(`${error?.cause?.code || ""} ${error?.message || ""}`)) continue;
					throw error;
				}
			}
			return await callExtensionDirect(tool, args, client);
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
	// One program serves one app, so what the app said about itself when it
	// connected holds for every later call.
	const session = {};
	lines.on("line", (line) => {
		if (!line.trim()) return;
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			write(parseErrorResponse());
			return;
		}
		handleRpcMessage(message, { callExtension: connector.callExtension, session })
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
	// The pairing code comes from the environment only: a command-line
	// argument is visible to every user of the computer in the process list.
	const token = String(process.env.ONHAND_CONNECTOR_TOKEN || "").trim();
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
