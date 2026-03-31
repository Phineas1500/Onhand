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
		if (body.length > 1024 * 1024) {
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

			if (req.method === "POST" && pathname === "/prompt") {
				const body = await readJsonBody(req);
				if (typeof body.prompt !== "string" || !body.prompt.trim()) {
					const error = new Error("Prompt cannot be empty.");
					error.statusCode = 400;
					throw error;
				}
				const result = await submitPrompt(body.prompt);
				sendJson(res, 200, {
					ok: true,
					...result,
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
				const result = await activateAction(body.key);
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
