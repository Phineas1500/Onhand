import http from "node:http";
import { pathToFileURL } from "node:url";

export const DEFAULT_PORT = 8765;

function parseArgs(argv) {
	let port = DEFAULT_PORT;
	let host = "127.0.0.1";
	for (const value of argv) {
		if (value.startsWith("--port=")) {
			const parsed = Number.parseInt(value.slice("--port=".length), 10);
			if (Number.isFinite(parsed) && parsed > 0) port = parsed;
			continue;
		}
		if (value.startsWith("--host=")) {
			host = value.slice("--host=".length) || host;
			continue;
		}
		if (value === "--help" || value === "-h") {
			console.log("Usage: node scripts/serve-browser-runtime-fixture.mjs [--host=127.0.0.1] [--port=8765]");
			process.exit(0);
		}
		throw new Error(`Unknown option: ${value}`);
	}
	return { host, port };
}

export const html = `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Onhand Port Smoke Fixture</title>
	<style>
		body { font-family: system-ui, sans-serif; margin: 0; background: #f8f7f3; color: #24211c; }
		main { max-width: 860px; margin: 0 auto; padding: 40px 24px 120px; }
		section { background: white; border: 1px solid #ded9cf; border-radius: 8px; margin: 24px 0; padding: 24px; }
		button { appearance: none; border: 0; border-radius: 6px; background: #07566a; color: white; font: inherit; padding: 8px 12px; }
		label { display: block; margin: 14px 0 6px; font-weight: 600; }
		input { border: 1px solid #bcb6aa; border-radius: 6px; font: inherit; padding: 10px; width: 180px; }
		output { display: block; margin-top: 10px; font-weight: 700; }
	</style>
</head>
<body>
	<main>
		<h1>Onhand Port Smoke Fixture</h1>
		<p><strong>Alpha smoke content</strong> confirms readable extraction, visible text, highlighting, notes, and artifact restore on this local page. <span>SMOKE FIXTURE</span></p>
		<p>This phrase marks the readable content used to verify extraction, highlighting, notes, and restore behavior.</p>
		<p>The fixture also exposes safe buttons and fields for click and type testing without submitting any data.</p>

		<section>
			<h2>Readable Section</h2>
			<p>Bravo section text appears near the top of the viewport for heading and scroll-state tests.</p>
			<p>Charlie reference content is here so Onhand can verify DOM and extract-content ports.</p>
		</section>

		<section>
			<h2>Interaction Section</h2>
			<button id="demoButton" type="button">Demo button</button>
			<output id="result">Result idle</output>
			<label for="demoField">Demo field</label>
			<input id="demoField" value="initial">
		</section>

		<section>
			<h2>Selector Section</h2>
			<button id="cssButton" type="button">CSS button</button>
			<label for="cssInput">CSS field</label>
			<input id="cssInput" value="">
			<output id="cssValue">CSS field value: idle</output>
		</section>

		<section>
			<h2>Network Section</h2>
			<button id="fetchButton" type="button">Fetch fixture JSON</button>
			<output id="networkStatus">Network idle</output>
		</section>

		<section style="min-height: 480px;">
			<h2>Lower Section</h2>
			<p>Delta lower content gives scroll and scroll-to-annotation tests enough page height.</p>
		</section>
	</main>
	<script>
		document.querySelector("#demoButton").addEventListener("click", () => {
			document.querySelector("#result").textContent = "Demo button clicked";
		});
		document.querySelector("#cssButton").addEventListener("click", () => {
			const value = document.querySelector("#cssInput").value || "empty";
			document.querySelector("#cssValue").textContent = "CSS field value: " + value;
		});
		document.querySelector("#cssInput").addEventListener("input", (event) => {
			document.querySelector("#cssValue").textContent = "CSS field value: " + event.target.value;
		});
		document.querySelector("#fetchButton").addEventListener("click", async () => {
			const status = document.querySelector("#networkStatus");
			status.textContent = "Network loading";
			const response = await fetch("/fixture.json?source=button", { cache: "no-store" });
			const data = await response.json();
			status.textContent = "Network loaded: " + data.label;
		});
		window.__onhandPortSmoke = { fixture: "ready", expectedPhrase: "Alpha smoke content", version: 1 };
	</script>
</body>
</html>`;

function send(req, res, status, headers, body = "") {
	res.writeHead(status, {
		"Connection": "close",
		"Cache-Control": "no-store",
		...headers,
	});
	if (req.method === "HEAD") {
		res.end();
		return;
	}
	res.end(body);
}

export function createFixtureServer({ host = "127.0.0.1", port = DEFAULT_PORT } = {}) {
	const server = http.createServer((req, res) => {
		const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
		if (url.pathname === "/" || url.pathname === "/index.html") {
			send(req, res, 200, { "Content-Type": "text/html; charset=utf-8" }, html);
			return;
		}
		if (url.pathname === "/fixture.json") {
			send(
				req,
				res,
				200,
				{ "Content-Type": "application/json; charset=utf-8" },
				JSON.stringify({ ok: true, label: "fixture-json", now: new Date().toISOString() }),
			);
			return;
		}
		if (url.pathname === "/health") {
			send(req, res, 200, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify({ ok: true }));
			return;
		}
		send(req, res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found");
	});

	server.keepAliveTimeout = 0;
	server.headersTimeout = 5000;
	server.requestTimeout = 10000;
	server.on("clientError", (_error, socket) => {
		socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
	});

	return server;
}

export function startFixtureServer({ host = "127.0.0.1", port = DEFAULT_PORT } = {}) {
	const server = createFixtureServer({ host, port });
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => {
			server.off("error", reject);
			const address = server.address();
			const resolvedPort = typeof address === "object" && address ? address.port : port;
			resolve({
				server,
				host,
				port: resolvedPort,
				url: `http://${host}:${resolvedPort}/`,
			});
		});
	});
}

async function main() {
	const { host, port } = parseArgs(process.argv.slice(2));
	const fixture = await startFixtureServer({ host, port });
	console.log(`Onhand browser runtime fixture listening at ${fixture.url}`);

	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.on(signal, () => {
			fixture.server.close(() => process.exit(0));
		});
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error?.message || String(error));
		process.exitCode = 1;
	});
}
