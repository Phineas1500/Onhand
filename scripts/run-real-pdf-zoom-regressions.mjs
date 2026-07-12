// Real-browser PDF zoom geometry regression.
//
// Generates a deterministic multi-page PDF whose pages are full-page raster
// images (the expensive shape of a scanned document), serves it locally, then
// launches a fresh Chromium/Helium profile with the unpacked extension. Trusted
// ctrl+wheel input verifies the two native-feeling zoom rules:
//   1. pages that fit between gray margins remain centered during and after zoom
//   2. oversized pages preserve the point under the cursor
//
// The fixture also mixes page sizes so grid alignment cannot accidentally test
// only the widest page. No model calls or personal/local PDF files are needed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import WebSocket from "ws";

const EXT_DIR = fileURLToPath(new URL("../packages/browser-extension", import.meta.url));
const EXT_ID_FALLBACK = "hpjpjeehgbloadhdidmecpijppodibim";
const OVERALL_TIMEOUT_MS = 120_000;
const CENTER_TOLERANCE_PX = 0.5;
const ANCHOR_TOLERANCE_PX = 1;
const MAX_PREVIEW_LATENCY_MS = 250;
const MAX_SETTLE_LATENCY_MS = 1_500;
const VERBOSE = Boolean(process.env.ONHAND_TEST_VERBOSE);

const BROWSER_CANDIDATES = [
	process.env.ONHAND_TEST_BROWSER,
	"/Applications/Helium.app/Contents/MacOS/Helium",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
].filter(Boolean);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => VERBOSE && console.log(...args);

function findBrowser() {
	for (const candidate of BROWSER_CANDIDATES) if (existsSync(candidate)) return candidate;
	return null;
}

function extraBrowserFlags() {
	return String(process.env.ONHAND_TEST_BROWSER_FLAGS || "")
		.split(/\s+/)
		.map((flag) => flag.trim())
		.filter(Boolean);
}

function pickAvailablePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() => {
				if (port > 0) resolve(port);
				else reject(new Error("Could not allocate a CDP port"));
			});
		});
	});
}

function launchBrowser(profile, port) {
	const browserPath = findBrowser();
	if (!browserPath) throw new Error("No Chromium-based browser found. Set ONHAND_TEST_BROWSER.");
	return spawn(
		browserPath,
		[
			`--user-data-dir=${profile}`,
			`--load-extension=${EXT_DIR}`,
			`--disable-extensions-except=${EXT_DIR}`,
			`--remote-debugging-port=${port}`,
			"--no-first-run",
			"--no-default-browser-check",
			"--force-device-scale-factor=1",
			"--window-size=1280,1000",
			...extraBrowserFlags(),
			"about:blank",
		],
		{ stdio: "ignore", detached: false },
	);
}

function scanPixels(width, height) {
	const pixels = Buffer.allocUnsafe(width * height);
	let seed = 0x51f15e;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			const noise = (seed >>> 29) - 3;
			const textBand = y > 120 && y < height - 120 && y % 92 < 8 && x > 110 && x < width - 90;
			const heading = y > 70 && y < 105 && x > 180 && x < width - 180;
			const marginMark = x > 60 && x < 78 && y > 160 && y < height - 180 && y % 210 < 80;
			pixels[y * width + x] = Math.max(18, Math.min(250, (textBand || heading || marginMark ? 45 : 242) + noise));
		}
	}
	return pixels;
}

function pdfStream(dictionary, data) {
	return Buffer.concat([
		Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`, "latin1"),
		data,
		Buffer.from("\nendstream", "latin1"),
	]);
}

function generateScannedPdf() {
	const imageWidth = 1200;
	const imageHeight = 1600;
	const compressedImage = deflateSync(scanPixels(imageWidth, imageHeight), { level: 6 });
	const pageSizes = [
		{ width: 612, height: 792 },
		{ width: 540, height: 720 },
		{ width: 612, height: 792 },
	];
	const pageObjectIds = pageSizes.map((_, index) => 3 + index);
	const imageObjectId = 6;
	const contentObjectIds = pageSizes.map((_, index) => 7 + index);
	const objects = new Map();
	objects.set(1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"));
	objects.set(2, Buffer.from(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageSizes.length} >>`, "latin1"));
	pageSizes.forEach((size, index) => {
		objects.set(
			pageObjectIds[index],
			Buffer.from(
				`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size.width} ${size.height}] /Resources << /XObject << /Scan ${imageObjectId} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`,
				"latin1",
			),
		);
		const paint = Buffer.from(`q\n${size.width} 0 0 ${size.height} 0 0 cm\n/Scan Do\nQ`, "latin1");
		objects.set(contentObjectIds[index], pdfStream("", paint));
	});
	objects.set(
		imageObjectId,
		pdfStream(
			`/Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
			compressedImage,
		),
	);

	const chunks = [Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "latin1")];
	const offsets = new Array(10).fill(0);
	let length = chunks[0].length;
	for (let id = 1; id <= 9; id += 1) {
		const body = objects.get(id);
		assert.ok(body, `missing generated PDF object ${id}`);
		offsets[id] = length;
		const object = Buffer.concat([Buffer.from(`${id} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
		chunks.push(object);
		length += object.length;
	}
	const xrefOffset = length;
	let xref = "xref\n0 10\n0000000000 65535 f \n";
	for (let id = 1; id <= 9; id += 1) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
	xref += `trailer\n<< /Size 10 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
	chunks.push(Buffer.from(xref, "latin1"));
	return Buffer.concat(chunks);
}

function connect(url) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
		ws.on("open", () => resolve(ws));
		ws.on("error", reject);
	});
}

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.nextId = 1;
		this.pending = new Map();
		ws.on("message", (raw) => {
			const message = JSON.parse(raw);
			if (!message.id || !this.pending.has(message.id)) return;
			const entry = this.pending.get(message.id);
			this.pending.delete(message.id);
			clearTimeout(entry.timeout);
			if (message.error) entry.reject(new Error(message.error.message + (message.error.data ? `: ${message.error.data}` : "")));
			else entry.resolve(message.result);
		});
		const rejectPending = (reason) => {
			for (const entry of this.pending.values()) {
				clearTimeout(entry.timeout);
				entry.reject(new Error(reason));
			}
			this.pending.clear();
		};
		ws.on("close", () => rejectPending("CDP connection closed"));
		ws.on("error", (error) => rejectPending(`CDP connection failed: ${error?.message || error}`));
	}

	send(method, params = {}, sessionId) {
		return new Promise((resolve, reject) => {
			const id = this.nextId++;
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP ${method} timed out`));
			}, 10_000);
			this.pending.set(id, { resolve, reject, timeout });
			this.ws.send(JSON.stringify({ id, method, params, sessionId }));
		});
	}

	close() {
		this.ws.close();
	}
}

async function waitForCdp(port, timeoutMs = 20_000) {
	const startedAt = Date.now();
	for (;;) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (response.ok) return await response.json();
		} catch {}
		if (Date.now() - startedAt > timeoutMs) throw new Error("Browser CDP endpoint did not come up");
		await delay(250);
	}
}

async function discoverExtensionId(cdp) {
	for (let attempt = 0; attempt < 80; attempt += 1) {
		const targets = (await cdp.send("Target.getTargets")).targetInfos;
		const extensionTarget = targets.find((target) => /^chrome-extension:\/\/[a-p]{32}\/(background\.js|sidepanel\.html|options\.html)/.test(String(target.url || "")));
		if (extensionTarget?.url) return new URL(extensionTarget.url).host;
		await delay(250);
	}
	return EXT_ID_FALLBACK;
}

async function openViewer(port, pdfUrl) {
	const version = await waitForCdp(port);
	const cdp = new Cdp(await connect(version.webSocketDebuggerUrl));
	const extensionId = await discoverExtensionId(cdp);
	const viewerUrl = `chrome-extension://${extensionId}/pdf-viewer.html?url=${encodeURIComponent(pdfUrl)}`;
	const { targetId } = await cdp.send("Target.createTarget", { url: viewerUrl });
	await cdp.send("Target.activateTarget", { targetId });
	const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
	await cdp.send("Page.bringToFront", {}, sessionId);
	const evaluate = async (expression) => {
		const response = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
		if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "viewer evaluation failed");
		return response.result?.value;
	};
	return { cdp, sessionId, evaluate, viewerUrl };
}

async function waitForViewer(viewer) {
	for (let attempt = 0; attempt < 160; attempt += 1) {
		const raw = await viewer.evaluate(`JSON.stringify({
			readyState: document.readyState,
			pageCount: document.querySelectorAll('.page[data-page-number]').length,
			firstCanvasWidth: document.querySelector('.page[data-page-number="1"] canvas')?.width || 0,
			status: document.querySelector('#onhand-pdf-status')?.textContent || '',
			error: document.querySelector('.onhand-pdf-error')?.textContent || ''
		})`);
		const state = JSON.parse(String(raw || "{}"));
		if (state.error) throw new Error(`PDF viewer error: ${state.error}`);
		if (state.pageCount === 3 && state.firstCanvasWidth > 0) return state;
		await delay(100);
	}
	throw new Error("Timed out waiting for scanned PDF viewer pages");
}

async function selectPageAndFit(viewer, pageNumber) {
	await viewer.evaluate(`new Promise((resolve) => {
		const input = document.querySelector('#onhand-pdf-page');
		input.value = ${JSON.stringify(String(pageNumber))};
		input.dispatchEvent(new Event('change', { bubbles: true }));
		setTimeout(() => {
			document.querySelector('#onhand-pdf-zoom-value')?.click();
			setTimeout(resolve, 450);
		}, 80);
	})`);
	return readGeometry(viewer, pageNumber);
}

async function readGeometry(viewer, pageNumber) {
	const raw = await viewer.evaluate(`(() => {
		const page = document.querySelector('.page[data-page-number=${JSON.stringify(String(pageNumber))}]');
		const rect = page?.getBoundingClientRect();
		if (!rect) return JSON.stringify({ error: 'page missing' });
		const canvases = [...page.querySelectorAll('canvas')];
		return JSON.stringify({
			zoom: document.querySelector('#onhand-pdf-zoom-value')?.textContent || '',
			left: rect.left,
			top: rect.top,
			center: rect.left + rect.width / 2,
			width: rect.width,
			height: rect.height,
			viewportWidth: innerWidth,
			viewportCenter: innerWidth / 2,
			transform: document.querySelector('#viewer')?.style.transform || 'none',
			status: document.querySelector('#onhand-pdf-status')?.textContent || '',
			canvasCount: canvases.length,
			canvasPixels: canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0),
		});
	})()`);
	const geometry = JSON.parse(String(raw || "{}"));
	if (geometry.error) throw new Error(geometry.error);
	return geometry;
}

async function traceWheel(viewer, pageNumber, { deltaY, clientX }) {
	const before = await readGeometry(viewer, pageNumber);
	const startedAt = performance.now();
	await viewer.cdp.send(
		"Input.dispatchMouseEvent",
		{ type: "mouseWheel", x: clientX, y: Math.max(120, Math.min(700, before.top + Math.min(before.height / 2, 320))), deltaX: 0, deltaY, modifiers: 2 },
		viewer.sessionId,
	);
	let during = null;
	let settled = null;
	let previewLatencyMs = null;
	let settleLatencyMs = null;
	for (let attempt = 0; attempt < 120; attempt += 1) {
		await delay(16);
		const state = await readGeometry(viewer, pageNumber);
		if (!during && state.transform !== "none") {
			during = state;
			previewLatencyMs = performance.now() - startedAt;
		}
		if (during && state.transform === "none" && state.zoom !== before.zoom) {
			settled = state;
			settleLatencyMs = performance.now() - startedAt;
			break;
		}
	}
	assert.ok(during, `page ${pageNumber}: pinch should produce a compositor preview`);
	assert.ok(settled, `page ${pageNumber}: pinch should commit its geometry`);
	return { before, during, settled, previewLatencyMs, settleLatencyMs };
}

function assertRasterStayedVisible(trace, label) {
	assert.ok(trace.before.canvasCount >= 1, `${label}: scanned page should have a rendered canvas`);
	assert.equal(trace.during.canvasCount, trace.before.canvasCount, `${label}: pinch preview should not remove the scanned canvas`);
	assert.ok(trace.during.canvasPixels > 0, `${label}: pinch preview should keep raster pixels available`);
	assert.ok(trace.previewLatencyMs <= MAX_PREVIEW_LATENCY_MS, `${label}: preview took ${trace.previewLatencyMs.toFixed(1)}ms`);
	assert.ok(trace.settleLatencyMs <= MAX_SETTLE_LATENCY_MS, `${label}: settle took ${trace.settleLatencyMs.toFixed(1)}ms`);
}

async function assertCenteredZoom(viewer, pageNumber) {
	const fitted = await selectPageAndFit(viewer, pageNumber);
	assert.ok(fitted.width <= fitted.viewportWidth - 48 + CENTER_TOLERANCE_PX, `page ${pageNumber}: fitted page should leave gray margins`);
	assert.ok(Math.abs(fitted.center - fitted.viewportCenter) <= CENTER_TOLERANCE_PX, `page ${pageNumber}: fitted page should start centered`);
	const trace = await traceWheel(viewer, pageNumber, { deltaY: -5, clientX: 80 });
	const previewOffset = Math.abs(trace.during.center - trace.during.viewportCenter);
	const centerJump = Math.abs(trace.during.center - trace.settled.center);
	assert.ok(previewOffset <= CENTER_TOLERANCE_PX, `page ${pageNumber}: preview center offset ${previewOffset.toFixed(3)}px`);
	assert.ok(centerJump <= CENTER_TOLERANCE_PX, `page ${pageNumber}: settled center jumped ${centerJump.toFixed(3)}px`);
	assertRasterStayedVisible(trace, `page ${pageNumber} centered zoom`);
	return { trace, previewOffset, centerJump };
}

async function assertAnchoredOverflowZoom(viewer, pageNumber) {
	let state = await readGeometry(viewer, pageNumber);
	for (let attempt = 0; attempt < 4 && state.width <= state.viewportWidth - 48; attempt += 1) {
		const enlarged = await traceWheel(viewer, pageNumber, { deltaY: -50, clientX: state.viewportCenter });
		state = enlarged.settled;
	}
	assert.ok(state.width > state.viewportWidth - 48, `page ${pageNumber}: setup should make the page horizontally overflow`);
	const clientX = Math.max(140, Math.min(state.viewportCenter - 180, state.left + state.width - 140));
	const xRatio = (clientX - state.left) / state.width;
	assert.ok(xRatio > 0 && xRatio < 1, `page ${pageNumber}: pointer should land inside the oversized page`);
	const trace = await traceWheel(viewer, pageNumber, { deltaY: -5, clientX });
	const previewAnchorX = trace.during.left + trace.during.width * xRatio;
	const settledAnchorX = trace.settled.left + trace.settled.width * xRatio;
	const previewAnchorOffset = Math.abs(previewAnchorX - clientX);
	const settledAnchorOffset = Math.abs(settledAnchorX - clientX);
	assert.ok(previewAnchorOffset <= ANCHOR_TOLERANCE_PX, `page ${pageNumber}: preview anchor offset ${previewAnchorOffset.toFixed(3)}px`);
	assert.ok(settledAnchorOffset <= ANCHOR_TOLERANCE_PX, `page ${pageNumber}: settled anchor offset ${settledAnchorOffset.toFixed(3)}px`);
	assertRasterStayedVisible(trace, `page ${pageNumber} overflow zoom`);
	return { trace, clientX, previewAnchorOffset, settledAnchorOffset };
}

async function main() {
	if (!findBrowser()) {
		console.log("Real PDF zoom regressions: SKIP (no Chromium/Helium binary found; set ONHAND_TEST_BROWSER)");
		return;
	}
	const fixture = generateScannedPdf();
	assert.ok(fixture.length > 250_000, "scan fixture should contain a substantial raster image");
	const fixtureServer = http.createServer((request, response) => {
		if ((request.url || "").startsWith("/scanned-mixed-pages.pdf")) {
			response.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": fixture.length, "Cache-Control": "no-store" });
			response.end(fixture);
			return;
		}
		response.writeHead(404);
		response.end();
	});
	await new Promise((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
	const fixtureUrl = `http://127.0.0.1:${fixtureServer.address().port}/scanned-mixed-pages.pdf`;
	const profile = await mkdtemp(join(tmpdir(), "onhand-pdf-zoom-"));
	const port = await pickAvailablePort();
	const browser = launchBrowser(profile, port);
	let viewer = null;
	try {
		viewer = await openViewer(port, fixtureUrl);
		const ready = await waitForViewer(viewer);
		log("viewer ready", ready);
		const wideCentered = await assertCenteredZoom(viewer, 1);
		const narrowCentered = await assertCenteredZoom(viewer, 2);
		const anchored = await assertAnchoredOverflowZoom(viewer, 1);
		console.log("Real PDF zoom regressions: PASS");
		console.log(`Fixture: full-page raster image, mixed page sizes, ${Math.round(fixture.length / 1024)} KiB`);
		console.log(
			`Centered page 1: preview=${wideCentered.previewOffset.toFixed(3)}px settle=${wideCentered.centerJump.toFixed(3)}px latency=${wideCentered.trace.previewLatencyMs.toFixed(1)}ms`,
		);
		console.log(
			`Centered page 2: preview=${narrowCentered.previewOffset.toFixed(3)}px settle=${narrowCentered.centerJump.toFixed(3)}px latency=${narrowCentered.trace.previewLatencyMs.toFixed(1)}ms`,
		);
		console.log(
			`Oversized page 1: preview anchor=${anchored.previewAnchorOffset.toFixed(3)}px settled anchor=${anchored.settledAnchorOffset.toFixed(3)}px latency=${anchored.trace.previewLatencyMs.toFixed(1)}ms`,
		);
	} finally {
		viewer?.cdp.close();
		browser.kill();
		await delay(500);
		fixtureServer.closeAllConnections?.();
		await new Promise((resolve) => fixtureServer.close(resolve));
		await rm(profile, { recursive: true, force: true }).catch(() => {});
	}
}

let overallTimeout = null;
await Promise.race([
	main(),
	new Promise((_, reject) => {
		overallTimeout = setTimeout(() => reject(new Error(`Real PDF zoom regressions timed out after ${OVERALL_TIMEOUT_MS}ms`)), OVERALL_TIMEOUT_MS);
	}),
])
	.catch((error) => {
		console.error(`Real PDF zoom regressions: FAIL — ${error?.message || error}`);
		process.exitCode = 1;
	})
	.finally(() => {
		if (overallTimeout !== null) clearTimeout(overallTimeout);
	});
