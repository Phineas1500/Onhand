#!/usr/bin/env node

import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { WebSocketServer } from "ws";

const CONFIG_DIR = join(homedir(), ".config", "pi-browser-bridge");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const DEFAULT_HOST = process.env.PI_BROWSER_BRIDGE_HOST || "127.0.0.1";
const DEFAULT_PORT = Number(process.env.PI_BROWSER_BRIDGE_PORT || 3210);
const DEFAULT_TIMEOUT_MS = Number(process.env.PI_BROWSER_BRIDGE_TIMEOUT_MS || 15000);

function nowIso() {
	return new Date().toISOString();
}

function log(...args) {
	console.log(`[${nowIso()}]`, ...args);
}

function createHttpError(status, message) {
	const error = new Error(message);
	error.statusCode = status;
	return error;
}

async function ensureConfig() {
	await mkdir(CONFIG_DIR, { recursive: true });

	if (!existsSync(CONFIG_FILE)) {
		const config = {
			host: DEFAULT_HOST,
			port: DEFAULT_PORT,
			token: randomBytes(24).toString("hex"),
		};
		await writeFile(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, "utf8");
		log(`Created config: ${CONFIG_FILE}`);
		return config;
	}

	const raw = await readFile(CONFIG_FILE, "utf8");
	const parsed = JSON.parse(raw);
	return {
		host: process.env.PI_BROWSER_BRIDGE_HOST || parsed.host || DEFAULT_HOST,
		port: Number(process.env.PI_BROWSER_BRIDGE_PORT || parsed.port || DEFAULT_PORT),
		token: process.env.PI_BROWSER_BRIDGE_TOKEN || parsed.token,
	};
}

function printUsage() {
	console.log("Usage: node packages/browser-bridge/server.mjs [token|config]");
}

const config = await ensureConfig();

if (!config.token) {
	throw new Error(`Missing token in ${CONFIG_FILE}`);
}

if (process.argv[2] === "token") {
	console.log(config.token);
	process.exit(0);
}

if (process.argv[2] === "config") {
	console.log(JSON.stringify(config, null, 2));
	process.exit(0);
}

if (process.argv[2] && !["token", "config"].includes(process.argv[2])) {
	printUsage();
	process.exit(1);
}

const clients = new Map();
const pendingCommands = new Map();

function getCorsHeaders() {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Headers": "Authorization, Content-Type, X-Bridge-Token",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	};
}

function sendJson(res, statusCode, payload) {
	res.writeHead(statusCode, {
		"Content-Type": "application/json; charset=utf-8",
		...getCorsHeaders(),
	});
	res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function getAuthToken(req) {
	const authHeader = req.headers.authorization;
	if (authHeader?.startsWith("Bearer ")) {
		return authHeader.slice("Bearer ".length).trim();
	}

	const bridgeHeader = req.headers["x-bridge-token"];
	if (typeof bridgeHeader === "string") return bridgeHeader;
	return undefined;
}

function assertAuthorized(req) {
	const token = getAuthToken(req);
	if (token !== config.token) {
		throw createHttpError(401, "Unauthorized");
	}
}

async function readJsonBody(req) {
	let body = "";
	for await (const chunk of req) {
		body += chunk;
		if (body.length > 1024 * 1024) {
			throw createHttpError(413, "Request body too large");
		}
	}
	if (!body.trim()) return {};
	try {
		return JSON.parse(body);
	} catch {
		throw createHttpError(400, "Invalid JSON body");
	}
}

function summarizeState(state) {
	if (!state) return { windowCount: 0, tabCount: 0 };
	const windows = Array.isArray(state.windows) ? state.windows : [];
	const tabCount = windows.reduce((sum, windowState) => {
		return sum + (Array.isArray(windowState.tabs) ? windowState.tabs.length : 0);
	}, 0);
	return {
		windowCount: windows.length,
		tabCount,
		focusedWindowId: state.focusedWindowId,
		capturedAt: state.capturedAt,
	};
}

function getClientSnapshot(client) {
	return {
		clientId: client.clientId,
		hello: client.hello,
		lastSeen: client.lastSeen,
		connectedAt: client.connectedAt,
		stateSummary: summarizeState(client.state),
		state: client.state,
	};
}

function listClientSnapshots() {
	return [...clients.values()].map(getClientSnapshot);
}

function pickClient(clientId) {
	if (clientId) {
		const client = clients.get(clientId);
		if (!client) throw createHttpError(404, `No browser client connected with id ${clientId}`);
		return client;
	}

	const firstClient = clients.values().next().value;
	if (!firstClient) {
		throw createHttpError(503, "No browser extension client is connected to the bridge");
	}
	return firstClient;
}

function rejectPendingForClient(clientId, errorMessage) {
	for (const [commandId, pending] of pendingCommands.entries()) {
		if (pending.clientId !== clientId) continue;
		clearTimeout(pending.timeoutId);
		pending.reject(new Error(errorMessage));
		pendingCommands.delete(commandId);
	}
}

async function sendCommandToClient({ name, args = {}, clientId, timeoutMs = DEFAULT_TIMEOUT_MS }) {
	const client = pickClient(clientId);
	const commandId = randomUUID();

	if (client.ws.readyState !== 1) {
		throw createHttpError(503, `Browser client ${client.clientId} is not ready`);
	}

	return await new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			pendingCommands.delete(commandId);
			reject(new Error(`Timed out waiting for browser command result: ${name}`));
		}, timeoutMs);

		pendingCommands.set(commandId, {
			clientId: client.clientId,
			resolve,
			reject,
			timeoutId,
			name,
		});

		client.ws.send(
			JSON.stringify({
				type: "command",
				id: commandId,
				name,
				args,
			}),
		);
	});
}

const server = http.createServer(async (req, res) => {
	try {
		const url = new URL(req.url || "/", `http://${req.headers.host || `${config.host}:${config.port}`}`);
		const pathname = url.pathname;

		if (req.method === "OPTIONS") {
			res.writeHead(204, getCorsHeaders());
			res.end();
			return;
		}

		assertAuthorized(req);

		if (req.method === "GET" && pathname === "/health") {
			sendJson(res, 200, {
				ok: true,
				host: config.host,
				port: config.port,
				connectedClients: listClientSnapshots().map((client) => ({
					clientId: client.clientId,
					stateSummary: client.stateSummary,
					hello: client.hello,
					lastSeen: client.lastSeen,
				})),
			});
			return;
		}

		if (req.method === "GET" && pathname === "/clients") {
			sendJson(res, 200, {
				ok: true,
				clients: listClientSnapshots(),
			});
			return;
		}

		if (req.method === "GET" && pathname === "/state") {
			const clientId = url.searchParams.get("clientId") || undefined;
			const client = pickClient(clientId);
			sendJson(res, 200, {
				ok: true,
				client: getClientSnapshot(client),
			});
			return;
		}

		if (req.method === "POST" && pathname === "/command") {
			const body = await readJsonBody(req);
			if (!body.name || typeof body.name !== "string") {
				throw createHttpError(400, "Body must include a string 'name'");
			}

			const result = await sendCommandToClient({
				name: body.name,
				args: body.args,
				clientId: body.clientId,
				timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : DEFAULT_TIMEOUT_MS,
			});

			sendJson(res, 200, {
				ok: true,
				result,
			});
			return;
		}

		throw createHttpError(404, `Unknown route: ${pathname}`);
	} catch (error) {
		sendJson(res, error.statusCode || 500, {
			ok: false,
			error: error.message || String(error),
		});
	}
});

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws, req) => {
	const url = new URL(req.url || "/", `http://${req.headers.host || `${config.host}:${config.port}`}`);
	const clientId = url.searchParams.get("clientId") || randomUUID();

	const existing = clients.get(clientId);
	if (existing) {
		try {
			existing.ws.close(1000, "replaced by new connection");
		} catch {}
	}

	const client = {
		clientId,
		ws,
		hello: null,
		state: null,
		connectedAt: Date.now(),
		lastSeen: Date.now(),
	};
	clients.set(clientId, client);
	log(`Browser client connected: ${clientId}`);

	ws.send(
		JSON.stringify({
			type: "welcome",
			clientId,
			serverTime: Date.now(),
		}),
	);

	ws.on("message", (buffer) => {
		client.lastSeen = Date.now();
		let message;
		try {
			message = JSON.parse(buffer.toString("utf8"));
		} catch {
			log(`Invalid JSON from client ${clientId}`);
			return;
		}

		if (message.type === "hello") {
			client.hello = message;
			log(`Client hello from ${clientId}: ${message.browserName || "unknown browser"}`);
			return;
		}

		if (message.type === "state") {
			client.state = message.state;
			return;
		}

		if (message.type === "result") {
			const pending = pendingCommands.get(message.id);
			if (!pending) return;
			clearTimeout(pending.timeoutId);
			pendingCommands.delete(message.id);
			if (message.ok) {
				pending.resolve(message.result);
			} else {
				pending.reject(new Error(message.error || `Browser command failed: ${pending.name}`));
			}
			return;
		}
	});

	ws.on("close", () => {
		clients.delete(clientId);
		rejectPendingForClient(clientId, `Browser client disconnected: ${clientId}`);
		log(`Browser client disconnected: ${clientId}`);
	});

	ws.on("error", (error) => {
		log(`WebSocket error from ${clientId}: ${error.message}`);
	});
});

server.on("upgrade", (req, socket, head) => {
	try {
		const url = new URL(req.url || "/", `http://${req.headers.host || `${config.host}:${config.port}`}`);
		if (url.pathname !== "/ws") {
			socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
			socket.destroy();
			return;
		}

		const token = url.searchParams.get("token");
		if (token !== config.token) {
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
			socket.destroy();
			return;
		}

		wss.handleUpgrade(req, socket, head, (ws) => {
			wss.emit("connection", ws, req);
		});
	} catch {
		socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
		socket.destroy();
	}
});

server.listen(config.port, config.host, () => {
	log(`Bridge listening on http://${config.host}:${config.port}`);
	log(`WebSocket endpoint: ws://${config.host}:${config.port}/ws`);
	log(`Config file: ${CONFIG_FILE}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		log(`Received ${signal}, shutting down`);
		for (const pending of pendingCommands.values()) {
			clearTimeout(pending.timeoutId);
			pending.reject(new Error("Bridge shutting down"));
		}
		pendingCommands.clear();
		for (const client of clients.values()) {
			try {
				client.ws.close(1001, "server shutdown");
			} catch {}
		}
		server.close(() => process.exit(0));
		setTimeout(() => process.exit(0), 500).unref();
	});
}
