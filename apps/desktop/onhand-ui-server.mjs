import http from "node:http";

function getCorsHeaders() {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Headers": "Authorization, Content-Type",
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

async function readJsonBody(req) {
	let body = "";
	for await (const chunk of req) {
		body += chunk;
		if (body.length > 20 * 1024 * 1024) {
			throw new Error("Request body too large");
		}
	}
	if (!body.trim()) return {};
	return JSON.parse(body);
}

function getAuthToken(req) {
	const authHeader = req.headers.authorization;
	if (authHeader?.startsWith("Bearer ")) {
		return authHeader.slice("Bearer ".length).trim();
	}
	return undefined;
}

function assertAuthorized(req, token) {
	if (!token) return;
	if (getAuthToken(req) !== token) {
		const error = new Error("Unauthorized");
		error.statusCode = 401;
		throw error;
	}
}

export function createOnhandUiServer({
	host = "127.0.0.1",
	port = 3211,
	token,
	getState,
	getSettings,
	updateSettings,
	listSessions,
	startNewSession,
	switchSession,
	restoreSession,
	stopPrompt,
	submitPrompt,
	activateAction,
}) {
	const server = http.createServer(async (req, res) => {
		try {
			const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
			const pathname = url.pathname;

			if (req.method === "OPTIONS") {
				res.writeHead(204, getCorsHeaders());
				res.end();
				return;
			}

			assertAuthorized(req, token);

			if (req.method === "GET" && pathname === "/health") {
				sendJson(res, 200, {
					ok: true,
					host,
					port,
				});
				return;
			}

			if (req.method === "GET" && pathname === "/state") {
				sendJson(res, 200, {
					ok: true,
					state: await getState(),
				});
				return;
			}

			if (req.method === "GET" && pathname === "/settings") {
				sendJson(res, 200, {
					ok: true,
					settings: (await getSettings?.()) || {},
				});
				return;
			}

			if (req.method === "POST" && pathname === "/settings") {
				if (!updateSettings) {
					const error = new Error("Settings updates are unavailable.");
					error.statusCode = 501;
					throw error;
				}
				const body = await readJsonBody(req);
				sendJson(res, 200, {
					ok: true,
					settings: await updateSettings(body),
				});
				return;
			}

			if (req.method === "GET" && pathname === "/sessions") {
				const limit = Math.max(1, Number.parseInt(url.searchParams.get("limit") || "12", 10) || 12);
				sendJson(res, 200, {
					ok: true,
					...(await listSessions(limit)),
				});
				return;
			}

			if (req.method === "POST" && pathname === "/sessions/new") {
				sendJson(res, 200, {
					ok: true,
					...(await startNewSession()),
				});
				return;
			}

			if (req.method === "POST" && pathname === "/sessions/switch") {
				const body = await readJsonBody(req);
				if (typeof body.sessionPath !== "string" || !body.sessionPath.trim()) {
					const error = new Error("Session path is required.");
					error.statusCode = 400;
					throw error;
				}
				sendJson(res, 200, {
					ok: true,
					...(await switchSession(body.sessionPath)),
				});
				return;
			}

			if (req.method === "POST" && pathname === "/sessions/restore") {
				const body = await readJsonBody(req);
				if (typeof body.sessionPath !== "string" || !body.sessionPath.trim()) {
					const error = new Error("Session path is required.");
					error.statusCode = 400;
					throw error;
				}
				sendJson(res, 200, {
					ok: true,
					...(await restoreSession(body.sessionPath, body.browserClientId)),
				});
				return;
			}

			if (req.method === "POST" && pathname === "/prompt") {
				const body = await readJsonBody(req);
				const hasPrompt = typeof body.prompt === "string" && body.prompt.trim();
				const hasAttachments = Array.isArray(body.attachments) && body.attachments.length > 0;
				if (!hasPrompt && !hasAttachments) {
					const error = new Error("Prompt or attachments are required.");
					error.statusCode = 400;
					throw error;
				}
				const result = await submitPrompt(body);
				sendJson(res, 200, {
					ok: true,
					...result,
				});
				return;
			}

			if (req.method === "POST" && pathname === "/stop") {
				sendJson(res, 200, {
					ok: true,
					...(await stopPrompt()),
				});
				return;
			}

			if (req.method === "POST" && pathname === "/action") {
				const body = await readJsonBody(req);
				if (typeof body.key !== "string" || !body.key.trim()) {
					const error = new Error("Action key is required.");
					error.statusCode = 400;
					throw error;
				}
				const result = await activateAction(body.key, body.browserClientId);
				sendJson(res, 200, {
					ok: true,
					result,
				});
				return;
			}

			const error = new Error(`Unknown route: ${pathname}`);
			error.statusCode = 404;
			throw error;
		} catch (error) {
			sendJson(res, error.statusCode || 500, {
				ok: false,
				error: error?.message || String(error),
			});
		}
	});

	return {
		async listen() {
			await new Promise((resolve, reject) => {
				server.once("error", reject);
				server.listen(port, host, () => {
					server.removeListener("error", reject);
					resolve();
				});
			});
		},
		async close() {
			await new Promise((resolve) => {
				server.close(() => resolve());
			});
		},
		getInfo() {
			return {
				host,
				port,
				baseUrl: `http://${host}:${port}`,
			};
		},
	};
}
