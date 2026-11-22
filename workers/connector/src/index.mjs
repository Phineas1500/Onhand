// Relay Worker for the Onhand connector. See wrangler.toml and
// connector/mcp-core.mjs. One Durable Object per pairing code holds that
// person's extension connection and forwards tool calls to it.
import { DurableObject } from "cloudflare:workers";
import {
	EXTENSION_PROOF_PREFIX,
	HOST_PROOF_PREFIX,
	PAIRING_CODE_PATTERN,
	handleRpcMessage,
	hmacHex,
	parseErrorResponse,
	randomHex,
	sameText,
} from "../../../connector/mcp-core.mjs";

const EXTENSION_ORIGIN_PATTERN = /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i;
const MAX_BODY_BYTES = 256 * 1024;
const CALL_TIMEOUT_MS = 45000;
const EXTENSION_WAIT_MS = 5000;
const NOT_CONNECTED_TEXT =
	"Onhand's browser extension is not connected. Ask the person to open the browser where Onhand is installed and check that the connector is turned on in Onhand's settings, then try again.";

const json = (body, status = 200, headers = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

async function sha256Hex(text) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const match = /^\/(socket|mcp)\/([^/]+)$/.exec(url.pathname);
		if (!match || !PAIRING_CODE_PATTERN.test(match[2])) return json({ error: "Not found" }, 404);
		const [, kind, token] = match;
		// The object's name is a hash, so the pairing code is not an object id.
		const relay = env.CONNECTOR_RELAY.get(env.CONNECTOR_RELAY.idFromName(await sha256Hex(token)));

		if (kind === "socket") {
			if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "Expected a WebSocket" }, 426);
			if (!EXTENSION_ORIGIN_PATTERN.test(request.headers.get("origin") || "")) return json({ error: "Forbidden" }, 403);
			return relay.fetch(request);
		}

		// The MCP endpoint takes POST only: no session, no stream to open.
		if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { allow: "POST" });
		const text = await request.text();
		if (text.length > MAX_BODY_BYTES) return json({ error: "Request too large" }, 413);
		let message;
		try {
			message = JSON.parse(text);
		} catch {
			return json(parseErrorResponse(), 400);
		}
		const headers = Object.fromEntries([...request.headers].map(([name, value]) => [name.toLowerCase(), value]));
		const { response, status } = await handleRpcMessage(message, {
			headers,
			callExtension: (tool, args) => relay.callExtension(tool, args),
		});
		return json(response, status);
	},
};

export class ConnectorRelay extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env);
		this.pending = new Map();
		// The extension's keepalive is answered without waking this object.
		this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
	}

	// The extension connecting. It proves it holds the pairing code the same
	// way it does to the local program, so the extension has one code path.
	async fetch(request) {
		const token = new URL(request.url).pathname.split("/").pop();
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		const nonce = randomHex();
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({ token, nonce, ready: false });
		server.send(JSON.stringify({ type: "challenge", nonce }));
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(socket, raw) {
		if (typeof raw !== "string") return;
		let message;
		try {
			message = JSON.parse(raw);
		} catch {
			return;
		}
		const state = socket.deserializeAttachment() || {};
		if (!state.ready) {
			if (message?.type !== "auth" || typeof message.nonce !== "string") return socket.close(4002, "Expected pairing proof");
			if (!sameText(message.proof, await hmacHex(state.token, `${EXTENSION_PROOF_PREFIX}${state.nonce}`))) return socket.close(4003, "Pairing code does not match");
			socket.serializeAttachment({ ...state, ready: true });
			socket.send(JSON.stringify({ type: "ready", proof: await hmacHex(state.token, `${HOST_PROOF_PREFIX}${message.nonce}`) }));
			for (const other of this.ctx.getWebSockets()) {
				if (other !== socket) other.close(4000, "Replaced by a newer connection");
			}
			return;
		}
		if (message?.type !== "result") return;
		const pending = this.pending.get(message.id);
		if (!pending) return;
		this.pending.delete(message.id);
		pending.resolve({ text: String(message.text || ""), isError: Boolean(message.isError) });
	}

	async webSocketClose(socket) {
		for (const [id, pending] of this.pending) {
			if (pending.socket !== socket) continue;
			this.pending.delete(id);
			pending.resolve({ text: "The browser disconnected before it answered. Try again.", isError: true });
		}
	}

	readySocket() {
		return this.ctx.getWebSockets().find((socket) => socket.deserializeAttachment()?.ready) || null;
	}

	// Called by the Worker for each tools/call.
	async callExtension(tool, args) {
		let socket = this.readySocket();
		for (let waited = 0; !socket && waited < EXTENSION_WAIT_MS; waited += 250) {
			await new Promise((resolve) => setTimeout(resolve, 250));
			socket = this.readySocket();
		}
		if (!socket) return { text: NOT_CONNECTED_TEXT, isError: true };
		const id = crypto.randomUUID();
		return await new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				resolve({ text: "The browser took too long to answer. Try again.", isError: true });
			}, CALL_TIMEOUT_MS);
			this.pending.set(id, {
				socket,
				resolve: (value) => {
					clearTimeout(timer);
					resolve(value);
				},
			});
			socket.send(JSON.stringify({ type: "call", id, tool, args }));
		});
	}
}
