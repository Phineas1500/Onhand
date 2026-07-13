import http from "node:http";
import { readFile } from "node:fs/promises";
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
		.visual-fixture { display: grid; gap: 10px; }
		.visual-fixture svg { width: min(100%, 520px); height: auto; border: 1px solid #d4cec3; background: #fffdfa; }
		.visual-fixture text { font: 13px system-ui, sans-serif; fill: #24211c; }
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

		<section class="visual-fixture" aria-label="Validation chart fixture">
			<h2>Visual Section</h2>
			<p>The chart below is intentionally visual: the orange series ends above the blue series.</p>
			<svg id="validationChart" viewBox="0 0 560 300" role="img" aria-label="Validation chart showing orange ending above blue">
				<line x1="60" y1="240" x2="520" y2="240" stroke="#6f675d" stroke-width="2" />
				<line x1="60" y1="40" x2="60" y2="240" stroke="#6f675d" stroke-width="2" />
				<text x="60" y="275">Epoch</text>
				<text x="14" y="36">Accuracy</text>
				<polyline points="80,215 170,178 260,142 350,102 500,68" fill="none" stroke="#d56b2a" stroke-width="5" />
				<polyline points="80,226 170,196 260,172 350,148 500,126" fill="none" stroke="#286983" stroke-width="5" />
				<circle cx="500" cy="68" r="7" fill="#d56b2a" />
				<circle cx="500" cy="126" r="7" fill="#286983" />
				<text x="390" y="62">orange validation</text>
				<text x="390" y="122">blue baseline</text>
			</svg>
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

export const pdfHtml = `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Onhand PDF Adapter Fixture</title>
	<style>
		body { margin: 0; background: #3f3f3f; color: #2f2d2a; font-family: system-ui, sans-serif; }
		header { position: sticky; top: 0; z-index: 10; display: flex; gap: 18px; align-items: center; height: 54px; padding: 0 24px; background: #252525; color: #f5f1ea; box-shadow: 0 1px 2px rgba(0,0,0,.35); }
		header strong { letter-spacing: .03em; }
		.pdf-shell { max-width: 920px; margin: 0 auto; padding: 28px 24px 80px; }
		.pdfViewer { display: grid; gap: 18px; }
		.page { position: relative; width: 816px; min-height: 1056px; margin: 0 auto; background: #fffdfa; box-shadow: 0 3px 18px rgba(0,0,0,.32); overflow: hidden; }
		.page::before { content: attr(data-page-number); position: absolute; right: 20px; bottom: 16px; color: #928a7e; font-size: 13px; }
		.slide-title { position: absolute; left: 76px; top: 74px; font-size: 42px; line-height: 1.1; letter-spacing: .03em; color: #3d3b38; }
		.slide-subtitle { position: absolute; left: 76px; top: 204px; font-size: 24px; color: #b88700; }
		.slide-body { position: absolute; left: 76px; top: 118px; right: 76px; font-size: 26px; line-height: 1.45; color: #34322f; }
		.slide-body h2 { margin: 0 0 22px; font-size: 38px; font-weight: 500; letter-spacing: .03em; }
		.slide-body p { margin: 0 0 22px; }
		.textLayer { position: absolute; inset: 0; color: transparent; user-select: text; }
		.textLayer span { position: absolute; color: transparent; white-space: pre; transform-origin: 0 0; }
		.textLayer ::selection { background: rgba(251, 191, 36, .35); }
		#p1-title { left: 76px; top: 74px; font-size: 42px; }
		#p1-subtitle { left: 76px; top: 204px; font-size: 24px; }
		#p2-title { left: 76px; top: 118px; font-size: 38px; }
		#p2-line-1 { left: 76px; top: 190px; font-size: 26px; }
		#p2-line-2 { left: 76px; top: 232px; font-size: 26px; }
		#p2-line-3 { left: 76px; top: 274px; font-size: 26px; }
	</style>
</head>
<body>
	<header>
		<strong>Onhand PDF Adapter Fixture</strong>
		<span>PDF.js-style text layer</span>
	</header>
	<main class="pdf-shell">
		<div class="pdfViewer" data-onhand-fixture="pdf">
			<section class="page" data-page-number="1" aria-label="Page 1">
				<div class="slide-title">CS 577: Natural Language Processing</div>
				<div class="slide-subtitle">Lecture 4: Recurrent Neural Networks</div>
				<div class="textLayer" aria-hidden="false">
					<span id="p1-title">CS 577: Natural Language Processing</span>
					<span id="p1-subtitle">Lecture 4: Recurrent Neural Networks</span>
				</div>
			</section>
			<section class="page" data-page-number="2" aria-label="Page 2">
				<div class="slide-body">
					<h2>Previously: Data Sparsity And Overfitting</h2>
					<p>The important phrase is recurrent neural networks in sequence models.</p>
					<p>Recurrent neural networks preserve sequence state across tokens.</p>
					<p>This controlled fixture lets Onhand test PDF highlights, notes, capture, and restore.</p>
				</div>
				<div class="textLayer" aria-hidden="false">
					<span id="p2-title">Previously: Data Sparsity And Overfitting</span>
					<span id="p2-line-1">The important phrase is recurrent neural networks in sequence models.</span>
					<span id="p2-line-2">Recurrent neural networks preserve sequence state across tokens.</span>
					<span id="p2-line-3">This controlled fixture lets Onhand test PDF highlights, notes, capture, and restore.</span>
				</div>
			</section>
		</div>
	</main>
</body>
</html>`;

export const scholarPdfHtml = `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Google Scholar PDF Reader</title>
	<style>
		body { margin: 0; background: #2f3033; color: #34322f; font-family: Arial, sans-serif; }
		header { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 18px; height: 58px; padding: 0 24px; background: #202124; color: #f1f3f4; box-shadow: 0 1px 3px rgba(0,0,0,.45); }
		header button { border: 0; border-radius: 4px; background: #3c4043; color: #f1f3f4; font: inherit; padding: 6px 10px; }
		.scholar-reader { display: grid; grid-template-columns: 190px minmax(760px, 1fr) 72px; gap: 18px; padding: 24px; }
		.scholar-thumbs { color: #f1f3f4; font-size: 14px; }
		.scholar-thumb { height: 104px; margin: 0 0 14px; background: #f8f5ef; border: 3px solid #5f6368; }
		.scholar-document { display: grid; gap: 18px; }
		.scholar-page { position: relative; width: 816px; min-height: 1056px; margin: 0 auto; background: #fffdfa; box-shadow: 0 3px 18px rgba(0,0,0,.34); overflow: hidden; }
		.scholar-page::after { content: attr(aria-label); position: absolute; right: 20px; bottom: 16px; color: #9a948b; font-size: 13px; }
		.scholar-slide-title { position: absolute; left: 78px; top: 84px; font-size: 42px; letter-spacing: .04em; line-height: 1.15; color: #3d3b38; }
		.scholar-slide-subtitle { position: absolute; left: 78px; top: 232px; font-size: 28px; color: #b88700; }
		.scholar-selectable-text { position: absolute; inset: 0; user-select: text; color: transparent; }
		.scholar-selectable-text span { position: absolute; white-space: pre-wrap; color: transparent; transform-origin: 0 0; }
		.scholar-selectable-text ::selection { background: rgba(251, 191, 36, .35); }
		.scholar-selected-native { position: absolute; left: 76px; top: 80px; width: 416px; height: 64px; border-radius: 4px; background: rgba(251, 191, 36, .45); outline: 2px solid rgba(217, 143, 21, .8); pointer-events: none; }
		.scholar-native-comment-popup { position: absolute; left: 474px; top: 196px; width: 280px; padding: 14px 16px 12px; background: #fff; border-radius: 3px; box-shadow: 0 2px 10px rgba(60,64,67,.35); color: #202124; font-size: 14px; line-height: 1.35; z-index: 5; }
		.scholar-native-comment-popup strong { display: block; margin-bottom: 8px; }
		.scholar-native-colors { display: flex; gap: 4px; margin-top: 10px; }
		.scholar-native-colors span { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
		.scholar-toolbar { position: sticky; top: 82px; align-self: start; display: grid; gap: 10px; justify-items: center; padding: 12px 8px; border-radius: 28px; background: #fff; box-shadow: 0 2px 10px rgba(60,64,67,.35); }
		.scholar-toolbar button { width: 36px; height: 36px; border: 1px solid #d0d3d7; border-radius: 50%; background: #fff; color: #5f6368; font-size: 16px; }
		#gs-title { left: 78px; top: 84px; font-size: 42px; }
		#gs-subtitle { left: 78px; top: 232px; font-size: 28px; }
		#gs-line-1 { left: 78px; top: 378px; font-size: 26px; }
		#gs-line-2 { left: 78px; top: 420px; font-size: 26px; }
		#gs-line-3 { left: 78px; top: 462px; font-size: 26px; }
	</style>
</head>
<body aria-label="Google Scholar PDF Reader">
	<header role="toolbar" aria-label="Google Scholar PDF Reader toolbar">
		<strong>Google Scholar PDF Reader</strong>
		<button type="button" aria-label="Toggle sidebar">Sidebar</button>
		<button type="button" aria-label="Highlight selected text">Highlight</button>
		<button type="button" aria-label="Comment on selected text">Comment</button>
		<span>Page 4 / 48</span>
	</header>
	<main class="scholar-reader" data-onhand-fixture="scholar-pdf">
		<aside class="scholar-thumbs" aria-label="Page thumbnails">
			<div class="scholar-thumb"></div>
			<div class="scholar-thumb"></div>
			<div class="scholar-thumb"></div>
			<div class="scholar-thumb"></div>
			<span>4</span>
		</aside>
		<div class="scholar-document">
			<section class="scholar-page gsr-page" role="region" aria-label="Page 4" data-page-index="3" data-pn="4">
				<div class="scholar-slide-title">CS 577: Natural Language Processing</div>
				<div class="scholar-slide-subtitle">Lecture 4: Recurrent Neural Networks</div>
				<p style="position:absolute;left:78px;top:372px;width:620px;font-size:26px;line-height:1.6;margin:0;color:#34322f;">
					Recurrent neural networks preserve sequence state across tokens.
					Scholar-compatible anchors should ignore native comments.
					Onhand notes should stay separate from Scholar Library comments.
				</p>
				<div class="scholar-selectable-text gsr-text-ctn" data-testid="selectable-text-layer" aria-label="selectable text layer">
					<span id="gs-title" class="gsr-text" data-idx="0">CS 577: Natural Language Processing</span>
					<span id="gs-subtitle" class="gsr-text" data-idx="1">Lecture 4: Recurrent Neural Networks</span>
					<span id="gs-line-1" class="gsr-text" data-idx="2">Recurrent neural networks preserve sequence state across tokens.</span>
					<span id="gs-line-2" class="gsr-text" data-idx="3">Scholar-compatible anchors should ignore native comments.</span>
					<span id="gs-line-3" class="gsr-text" data-idx="4">Onhand notes should stay separate from Scholar Library comments.</span>
				</div>
				<div class="scholar-selected-native" aria-hidden="true"></div>
				<div class="scholar-native-comment-popup" role="dialog" aria-label="Scholar comment">
					<strong>Native Scholar note</strong>
					<span>Native Scholar note should not become source PDF text.</span>
					<div class="scholar-native-colors" aria-label="Scholar annotation colors">
						<span style="background:#fde293"></span>
						<span style="background:#a7e8d3"></span>
						<span style="background:#b7c7f3"></span>
					</div>
				</div>
			</section>
		</div>
		<nav class="scholar-toolbar" role="toolbar" aria-label="Scholar annotation toolbar">
			<button type="button" aria-label="Open comments">C</button>
			<button type="button" aria-label="Yellow highlight">Y</button>
			<button type="button" aria-label="Blue highlight">B</button>
		</nav>
	</main>
</body>
</html>`;

function escapePdfText(value) {
	return String(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildSimplePdfFixture() {
	const lines = [
		"Onhand PDF Viewer Fixture",
		"The important phrase is recurrent neural networks.",
		"Sequence models preserve state across tokens.",
		"This real PDF validates Onhand PDF annotations.",
	];
	const textCommands = lines
		.map((line, index) => `${index === 0 ? "0 0 Td" : "0 -34 Td"} (${escapePdfText(line)}) Tj`)
		.join("\n");
	const stream = `BT
/F1 24 Tf
72 720 Td
${textCommands}
ET`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
		`<< /Length ${Buffer.byteLength(stream, "utf8")} >>
stream
${stream}
endstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	let pdf = "%PDF-1.4\n";
	const offsets = [0];
	for (const [index, body] of objects.entries()) {
		offsets.push(Buffer.byteLength(pdf, "utf8"));
		pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
	}
	const xrefOffset = Buffer.byteLength(pdf, "utf8");
	pdf += `xref
0 ${objects.length + 1}
0000000000 65535 f
`;
	for (const offset of offsets.slice(1)) {
		pdf += `${String(offset).padStart(10, "0")} 00000 n\n`;
	}
	pdf += `trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${xrefOffset}
%%EOF
`;
	return Buffer.from(pdf, "utf8");
}

export const samplePdf = buildSimplePdfFixture();

function buildManyPagePdfFixture(pageCount = 3000) {
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"",
	];
	const pageRefs = [];
	for (let index = 0; index < pageCount; index += 1) {
		const pageObjectNumber = objects.length + 1;
		const contentObjectNumber = pageObjectNumber + 1;
		pageRefs.push(`${pageObjectNumber} 0 R`);
		objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents ${contentObjectNumber} 0 R >>`);
		const stream = "";
		objects.push(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
	}
	objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageCount} >>`;
	let pdf = "%PDF-1.4\n";
	const offsets = [0];
	for (const [index, body] of objects.entries()) {
		offsets.push(Buffer.byteLength(pdf, "utf8"));
		pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
	}
	const xrefOffset = Buffer.byteLength(pdf, "utf8");
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f\n`;
	for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n\n`;
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
	return Buffer.from(pdf, "utf8");
}

const manyPagePdf = buildManyPagePdfFixture();

function extensionAssetContentType(pathname) {
	if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
	if (pathname.endsWith(".js") || pathname.endsWith(".mjs")) return "text/javascript; charset=utf-8";
	if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
	if (pathname.endsWith(".bcmap")) return "application/octet-stream";
	if (pathname.endsWith(".ttf")) return "font/ttf";
	if (pathname.endsWith(".pfb")) return "application/octet-stream";
	return "application/octet-stream";
}

async function readExtensionViewerAsset(urlPathname) {
	const routeMap = new Map([
		["/onhand-pdf-viewer.html", "pdf-viewer.html"],
		["/pdf-viewer.bundle.js", "pdf-viewer.bundle.js"],
		["/vendor/pdf.worker.mjs", "vendor/pdf.worker.mjs"],
	]);
	const mapped = routeMap.get(urlPathname);
	if (mapped) {
		return {
			body: await readFile(new URL(`../packages/browser-extension/${mapped}`, import.meta.url)),
			contentType: extensionAssetContentType(mapped),
		};
	}
	for (const prefix of ["/vendor/cmaps/", "/vendor/standard_fonts/"]) {
		if (!urlPathname.startsWith(prefix)) continue;
		const suffix = urlPathname.slice(prefix.length);
		if (!suffix || suffix.includes("..") || suffix.includes("/") || suffix.includes("\\")) return null;
		const mappedPath = `${prefix.slice(1)}${suffix}`;
		return {
			body: await readFile(new URL(`../packages/browser-extension/${mappedPath}`, import.meta.url)),
			contentType: extensionAssetContentType(mappedPath),
		};
	}
	return null;
}

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
	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
		try {
			if (url.pathname === "/" || url.pathname === "/index.html") {
				send(req, res, 200, { "Content-Type": "text/html; charset=utf-8" }, html);
				return;
			}
			if (url.pathname === "/pdf.html") {
				send(req, res, 200, { "Content-Type": "text/html; charset=utf-8" }, pdfHtml);
				return;
			}
			if (url.pathname === "/scholar-pdf.html") {
				send(req, res, 200, { "Content-Type": "text/html; charset=utf-8" }, scholarPdfHtml);
				return;
			}
			if (url.pathname === "/fixtures/onhand-viewer.pdf" || url.pathname === "/pdf/onhand-viewer") {
				send(req, res, 200, { "Content-Type": "application/pdf", "Content-Length": String(samplePdf.length) }, samplePdf);
				return;
			}
			if (url.pathname === "/fixtures/many-pages.pdf") {
				send(req, res, 200, { "Content-Type": "application/pdf", "Content-Length": String(manyPagePdf.length) }, manyPagePdf);
				return;
			}
			if (url.pathname === "/fixtures/stalled.pdf") {
				res.writeHead(200, { "Content-Type": "application/pdf", "Cache-Control": "no-store" });
				res.write("%PDF-1.7\n");
				const timeoutId = setTimeout(() => res.end(), 5000);
				req.once("close", () => {
					clearTimeout(timeoutId);
					res.destroy();
				});
				return;
			}
			if (url.pathname === "/fixtures/oversized-stream.pdf") {
				res.writeHead(200, { "Content-Type": "application/pdf", "Cache-Control": "no-store" });
				res.write("%PDF-1.7\n");
				res.write(Buffer.alloc(768, 0x20));
				res.write(Buffer.alloc(768, 0x20));
				res.end();
				return;
			}
			const extensionAsset = await readExtensionViewerAsset(url.pathname);
			if (extensionAsset) {
				send(req, res, 200, { "Content-Type": extensionAsset.contentType }, extensionAsset.body);
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
		} catch (error) {
			send(req, res, 500, { "Content-Type": "text/plain; charset=utf-8" }, error?.message || String(error));
		}
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
