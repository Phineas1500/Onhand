// Real-browser anchoring test.
//
// Every anchoring/restore bug this project has hit slipped past the unit
// suites because they mock chrome.scripting — real DOM ranges, the PDF.js
// text layer, and the re-find logic are never exercised. This test drives the
// UNPACKED extension in a real Chromium browser against a generated PDF with
// controlled, repeated text, and asserts the behaviors that only show up on a
// live surface: highlight + re-find, occurrence disambiguation by stored
// context, context-anchored recovery of drifted text, and backward-compatible
// occurrence selection.
//
// Usage:   node scripts/run-real-browser-anchoring.mjs
// Browser: ONHAND_TEST_BROWSER=/path/to/chromium  (defaults to Helium; the
//          branded Chrome 137+ dropped --load-extension, so a Chromium fork is
//          required). SKIPS (exit 0) when no usable browser is found.
import WebSocket from "ws";
import http from "node:http";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const EXT_DIR = fileURLToPath(new URL("../packages/browser-extension", import.meta.url));
const CDP_PORT = Number(process.env.ONHAND_TEST_CDP_PORT || 9343);
const EXT_ID_FALLBACK = "hpjpjeehgbloadhdidmecpijppodibim";
const OVERALL_TIMEOUT_MS = 120000;

const BROWSER_CANDIDATES = [
	process.env.ONHAND_TEST_BROWSER,
	"/Applications/Helium.app/Contents/MacOS/Helium",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
].filter(Boolean);

function findBrowser() {
	for (const candidate of BROWSER_CANDIDATES) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

// --- Minimal single-page text PDF generator (no dependencies) ---------------
function pdfEscape(value) {
	return String(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function generateTextPdf(lines) {
	let content = "BT\n/F1 16 Tf\n72 720 Td\n";
	lines.forEach((line, index) => {
		if (index > 0) content += "0 -32 Td\n";
		content += `(${pdfEscape(line)}) Tj\n`;
	});
	content += "ET";
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
	];
	let pdf = "%PDF-1.4\n";
	const offsets = [];
	objects.forEach((body, index) => {
		offsets.push(pdf.length);
		pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xrefStart = pdf.length;
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
	return Buffer.from(pdf, "latin1");
}

// "gamma marker" repeats three times with distinct surrounding context;
// "uniquesentinel" appears exactly once.
const FIXTURE_LINES = [
	"Section alpha introduces the GAMMA marker among first listed items.",
	"Section beta then revisits the GAMMA marker among middle listed items.",
	"Section kappa finally shows the GAMMA marker among final listed items.",
	"A single UNIQUESENTINEL phrase appears exactly once inside this document.",
];

// --- CDP plumbing -----------------------------------------------------------
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
			if (message.id && this.pending.has(message.id)) {
				const entry = this.pending.get(message.id);
				this.pending.delete(message.id);
				if (message.error) entry.reject(new Error(message.error.message + (message.error.data ? `: ${message.error.data}` : "")));
				else entry.resolve(message.result);
			}
		});
	}
	send(method, params = {}, sessionId) {
		return new Promise((resolve, reject) => {
			const id = this.nextId++;
			this.pending.set(id, { resolve, reject });
			this.ws.send(JSON.stringify({ id, method, params, sessionId }));
		});
	}
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForCdp(port, timeoutMs = 20000) {
	const startedAt = Date.now();
	for (;;) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (res.ok) return await res.json();
		} catch {}
		if (Date.now() - startedAt > timeoutMs) throw new Error("Browser CDP endpoint did not come up");
		await delay(300);
	}
}

async function run() {
	const browserBinary = findBrowser();
	if (!browserBinary) {
		console.log("SKIPPED: no Chromium-based browser found (set ONHAND_TEST_BROWSER). Real-browser anchoring test not run.");
		return "skipped";
	}

	const pdfBytes = generateTextPdf(FIXTURE_LINES);
	const server = http.createServer((req, res) => {
		if ((req.url || "").startsWith("/fixture.pdf")) {
			res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": pdfBytes.length });
			res.end(pdfBytes);
			return;
		}
		res.writeHead(404).end("not found");
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const pdfPort = server.address().port;
	const pdfUrl = `http://127.0.0.1:${pdfPort}/fixture.pdf`;

	const profile = await mkdtemp(join(tmpdir(), "onhand-anchor-test-"));
	const child = spawn(
		browserBinary,
		[
			`--user-data-dir=${profile}`,
			`--load-extension=${EXT_DIR}`,
			`--disable-extensions-except=${EXT_DIR}`,
			`--remote-debugging-port=${CDP_PORT}`,
			"--no-first-run",
			"--no-default-browser-check",
			"--window-size=1200,1000",
			"about:blank",
		],
		{ stdio: "ignore", detached: false },
	);

	let cdp = null;
	let timer = null;
	try {
		await new Promise((resolve, reject) => {
			timer = setTimeout(() => reject(new Error("Overall timeout")), OVERALL_TIMEOUT_MS);
			runAssertions(child, pdfUrl)
				.then(resolve)
				.catch(reject)
				.finally(() => clearTimeout(timer));
		});
		console.log("Real-browser anchoring test: PASS");
		return "passed";
	} finally {
		try {
			child.kill("SIGKILL");
		} catch {}
		server.close();
		await rm(profile, { recursive: true, force: true }).catch(() => {});
	}

	async function runAssertions() {
		const version = await waitForCdp(CDP_PORT);
		cdp = new Cdp(await connect(version.webSocketDebuggerUrl));

		// Resolve the extension id from its background worker, falling back to
		// the path-derived id (the worker may be dormant until first message).
		const targets = (await cdp.send("Target.getTargets")).targetInfos;
		const sw = targets.find((t) => t.type === "service_worker" && /chrome-extension:\/\/[a-p]{32}\/background\.js$/.test(t.url));
		const extId = sw ? new URL(sw.url).host : EXT_ID_FALLBACK;

		// A driver page inside the extension origin gives us chrome.runtime.
		const driverUrl = `chrome-extension://${extId}/pdf-viewer.html?driver=1`;
		const { targetId } = await cdp.send("Target.createTarget", { url: driverUrl, background: true });
		const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
		await delay(900);
		const stage = (label) => process.env.ONHAND_TEST_VERBOSE && console.log(`  [stage] ${label}`);

		const evalIn = async (sid, expression) => {
			const res = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sid);
			if (res.exceptionDetails) throw new Error(`page exception: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
			return res.result?.value;
		};
		const sendMessage = (payload) => evalIn(sessionId, `chrome.runtime.sendMessage(${JSON.stringify(payload)})`);
		const tool = (name, args) => sendMessage({ type: "sidebar:realtime-browser-tool", tool: name, args });

		// Open the fixture PDF in the Onhand viewer (the first call can report a
		// transient miss; the second reuses the freshly created tab).
		stage("opening pdf in viewer");
		await tool("browser_open_pdf_in_onhand_viewer", { pdfUrl }).catch(() => {});
		await delay(2500);
		await tool("browser_open_pdf_in_onhand_viewer", { pdfUrl }).catch(() => {});
		await delay(2500);

		stage("listing tabs");
		const listTabs = await tool("browser_list_tabs", {});
		const tabs = (listTabs?.result?.windows || []).flatMap((w) => w.tabs || []);
		const pdfTab = tabs.find((t) => String(t.url || "").includes("/fixture.pdf"));
		assert.ok(pdfTab, "fixture PDF tab should be open");
		const tabId = pdfTab.id;

		// Attach to the inline viewer iframe (pdf-viewer.html?url=...), distinct
		// from the ?driver=1 page, and wait for its text layer to render. The
		// frame is re-created as PDF.js renders, so re-resolve it each attempt.
		stage("waiting for viewer text layer");
		let viewerSession = null;
		for (let attempt = 0; attempt < 50 && !viewerSession; attempt += 1) {
			try {
				const all = (await cdp.send("Target.getTargets")).targetInfos;
				const frame = all.find((t) => (t.type === "iframe" || t.type === "page") && /pdf-viewer\.html\?url=/.test(t.url));
				if (frame) {
					const attached = await cdp.send("Target.attachToTarget", { targetId: frame.targetId, flatten: true });
					const ready = await evalIn(attached.sessionId, "document.querySelectorAll('.textLayer span').length");
					if (Number(ready) > 0) viewerSession = attached.sessionId;
				}
			} catch {
				// frame navigated/closed mid-render; retry
			}
			if (!viewerSession) await delay(500);
		}
		assert.ok(viewerSession, "inline PDF viewer text layer should render");
		stage("viewer ready");

		const clearAnnotations = () =>
			evalIn(viewerSession, "(()=>{document.querySelectorAll('[data-onhand-annotation-id]').forEach(e=>e.remove());return true})()");
		const compact = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
		const highlight = async (text, opts = {}) => {
			const res = await tool("browser_highlight_text", { tabId, text, clearExisting: true, ...opts });
			return { ok: Boolean(res?.ok), annotation: res?.result?.annotation || null };
		};

		// --- Test 1: basic highlight + re-find by anchor ---
		const unique = await highlight("UNIQUESENTINEL phrase");
		assert.ok(unique.ok && unique.annotation, "unique phrase should highlight");
		assert.ok(compact(unique.annotation.matchedText).includes("uniquesentinelphrase"), "unique highlight should match the phrase");
		await clearAnnotations();
		const uniqueRefind = await highlight("UNIQUESENTINEL phrase", { pdfAnchor: unique.annotation.pdfAnchor });
		assert.ok(uniqueRefind.ok && compact(uniqueRefind.annotation.matchedText).includes("uniquesentinelphrase"), "unique phrase should re-find by anchor");

		// --- Test 2: occurrence disambiguation by stored context ---
		await clearAnnotations();
		const occ3 = await highlight("GAMMA marker", { occurrence: 3 });
		assert.ok(occ3.ok, "third occurrence should highlight");
		const occ3Prefix = compact(occ3.annotation.pdfAnchor?.textQuote?.prefix);
		assert.ok(occ3Prefix.includes("shows"), `occurrence 3 anchor context should reference its surroundings (got prefix ${JSON.stringify(occ3.annotation.pdfAnchor?.textQuote?.prefix)})`);
		await clearAnnotations();
		// occurrence reset to 1 (the restore default) but with occurrence-3's
		// context: context must override and land on occurrence 3, not 1.
		const disambiguated = await highlight("GAMMA marker", { occurrence: 1, pdfAnchor: occ3.annotation.pdfAnchor });
		assert.ok(disambiguated.ok, "context re-find should succeed");
		const disambiguatedPrefix = compact(disambiguated.annotation.pdfAnchor?.textQuote?.prefix);
		assert.ok(disambiguatedPrefix.includes("shows"), "context should override occurrence=1 and re-anchor on occurrence 3");
		assert.ok(!disambiguatedPrefix.includes("introduces"), "context re-find must not land on occurrence 1");

		// --- Test 3: context-anchored recovery of drifted exact text ---
		await clearAnnotations();
		const recovered = await highlight("GAMMA markerDRIFTED", { occurrence: 1, pdfAnchor: occ3.annotation.pdfAnchor });
		assert.ok(recovered.ok, "drifted text should recover via context");
		assert.equal(compact(recovered.annotation.matchedText), "gammamarker", "recovery should land on the real passage");
		assert.ok(compact(recovered.annotation.pdfAnchor?.textQuote?.prefix).includes("shows"), "recovery should land at the context-matching occurrence");

		// --- Test 4: backward-compatible occurrence selection (no context) ---
		await clearAnnotations();
		const occ2 = await highlight("GAMMA marker", { occurrence: 2 });
		assert.ok(occ2.ok, "second occurrence should highlight without context");
		assert.ok(compact(occ2.annotation.pdfAnchor?.textQuote?.prefix).includes("revisits"), "no-context highlight should honor the Nth occurrence");
	}
}

run()
	.then((outcome) => process.exit(outcome === "passed" || outcome === "skipped" ? 0 : 1))
	.catch((error) => {
		console.error(`Real-browser anchoring test: FAIL\n${error?.stack || error}`);
		process.exit(1);
	});
