// Real-browser anchoring + restore test.
//
// Every anchoring/restore bug this project has hit slipped past the unit
// suites because they mock chrome.scripting, so real DOM ranges, the PDF.js
// text layer, the native PDF-viewer frame, and the restore orchestration are
// never exercised. This test drives the UNPACKED extension in a real Chromium
// browser against a generated PDF with controlled repeated text.
//
// Two groups run:
//   1. Anchoring: highlight + re-find, occurrence disambiguation by stored
//      context, context-anchored recovery of drifted text, backward-compatible
//      Nth-occurrence selection.
//   2. Restore cycle: seed a session + artifact into IndexedDB, relaunch the
//      browser on the same profile (fresh service worker reads it from disk),
//      and "Restore pages" — asserting the artifact replays onto the live
//      viewer with the right occurrence and ZERO failures (the artifact carries
//      a scroll position so the native-viewer-frame scroll-restore step, whose
//      benign access error used to be miscounted as a failure, is exercised).
//
// Usage:   node scripts/run-real-browser-anchoring.mjs
// Browser: ONHAND_TEST_BROWSER=/path/to/chromium (defaults to Helium; branded
//          Chrome dropped --load-extension). SKIPS (exit 0) when none is found.
import WebSocket from "ws";
import http from "node:http";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const EXT_DIR = fileURLToPath(new URL("../packages/browser-extension", import.meta.url));
const CDP_PORT_OVERRIDE = process.env.ONHAND_TEST_CDP_PORT ? Number(process.env.ONHAND_TEST_CDP_PORT) : null;
const EXT_ID_FALLBACK = "hpjpjeehgbloadhdidmecpijppodibim";
const VERBOSE = Boolean(process.env.ONHAND_TEST_VERBOSE);
const RESTORE_TEST_SESSION_ID = "seed-session-anchor-test";

const BROWSER_CANDIDATES = [
	process.env.ONHAND_TEST_BROWSER,
	"/Applications/Helium.app/Contents/MacOS/Helium",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
].filter(Boolean);

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

const stage = (label) => VERBOSE && console.log(`  [stage] ${label}`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const compact = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

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

function launchBrowser(profile, port) {
	return spawn(
		findBrowser(),
		[
			`--user-data-dir=${profile}`,
			`--load-extension=${EXT_DIR}`,
			`--disable-extensions-except=${EXT_DIR}`,
			`--remote-debugging-port=${port}`,
			"--no-first-run",
			"--no-default-browser-check",
			"--window-size=1200,1000",
			...extraBrowserFlags(),
			"about:blank",
		],
		{ stdio: "ignore", detached: false },
	);
}

function pickAvailablePort() {
	if (Number.isFinite(CDP_PORT_OVERRIDE) && CDP_PORT_OVERRIDE > 0) return Promise.resolve(CDP_PORT_OVERRIDE);
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

// Open a driver page inside the extension origin (for chrome.runtime) and a
// matching set of helpers bound to it.
async function openContext(port) {
	const version = await waitForCdp(port);
	const cdp = new Cdp(await connect(version.webSocketDebuggerUrl));
	let extId = EXT_ID_FALLBACK;
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const targets = (await cdp.send("Target.getTargets")).targetInfos;
		const target = targets.find((t) => {
			const url = String(t.url || "");
			const title = String(t.title || "");
			return url.startsWith(`chrome-extension://${EXT_ID_FALLBACK}/`) || title.includes("Onhand");
		});
		if (target?.url) {
			extId = new URL(target.url).host;
			break;
		}
		await delay(250);
	}
	const driverUrl = `chrome-extension://${extId}/pdf-viewer.html?driver=1`;
	const { targetId } = await cdp.send("Target.createTarget", { url: driverUrl, background: true });
	const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
	const evalIn = async (sid, expression) => {
		const res = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sid);
		if (res.exceptionDetails) throw new Error(`page exception: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
		return res.result?.value;
	};
	const driverEval = (expression) => evalIn(sessionId, expression);
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const ready = await driverEval(
			`JSON.stringify({ href: location.href, ready: document.readyState, hasRuntime: typeof chrome?.runtime?.sendMessage === "function" })`,
		);
		const state = JSON.parse(String(ready || "{}"));
		if (state.hasRuntime) break;
		if (attempt === 39) {
			throw new Error(`Extension driver page did not expose chrome.runtime.sendMessage: ${ready}`);
		}
		await delay(250);
	}
	const sendMessage = (payload) => driverEval(`chrome.runtime.sendMessage(${JSON.stringify(payload)})`);
	const tool = async (name, args) => {
		const response = await sendMessage({ type: "sidebar:realtime-browser-tool", tool: name, args });
		if (!response?.ok) throw new Error(response?.error || `Could not run ${name}`);
		return response;
	};
	return { cdp, extId, evalIn, driverEval, sendMessage, tool };
}

async function createSourceTab(ctx, url) {
	const serialized = await ctx.driverEval(`new Promise((resolve, reject) => {
		chrome.tabs.create({ url: ${JSON.stringify(url)}, active: true }, (tab) => {
			const error = chrome.runtime.lastError;
			if (error) {
				reject(new Error(error.message));
				return;
			}
			resolve(JSON.stringify({ id: tab.id, windowId: tab.windowId, url: tab.url || "", title: tab.title || "" }));
		});
	})`);
	const tab = JSON.parse(String(serialized || "{}"));
	assert.ok(tab.id, `source tab should be created for ${url}: ${serialized}`);
	await delay(1200);
	return tab;
}

async function openFixtureInViewer(ctx, pdfUrl) {
	stage("opening pdf in viewer");
	const sourceTab = await createSourceTab(ctx, pdfUrl);
	let openResponse = null;
	openResponse = await ctx.tool("browser_open_pdf_in_onhand_viewer", { pdfUrl, tabId: sourceTab.id, windowId: sourceTab.windowId });
	await delay(2500);
	if (!openResponse?.result?.viewerReady?.ready) {
		openResponse = await ctx.tool("browser_open_pdf_in_onhand_viewer", { pdfUrl, tabId: sourceTab.id, windowId: sourceTab.windowId });
		await delay(2500);
	}
	const pdfTab = openResponse?.result?.tab;
	assert.ok(pdfTab?.id, `fixture PDF tab should be open: ${JSON.stringify(openResponse)}`);
	assert.match(String(pdfTab.url || ""), /\/fixture\.pdf|pdf-viewer\.html\?url=/, "fixture PDF tab should point at the fixture PDF or Onhand viewer");
	return pdfTab.id;
}

async function waitForViewerSession(ctx) {
	stage("waiting for viewer text layer");
	for (let attempt = 0; attempt < 50; attempt += 1) {
		try {
			const all = (await ctx.cdp.send("Target.getTargets")).targetInfos;
			const frame = all.find((t) => (t.type === "iframe" || t.type === "page") && /pdf-viewer\.html\?url=/.test(t.url));
			if (frame) {
				const attached = await ctx.cdp.send("Target.attachToTarget", { targetId: frame.targetId, flatten: true });
				const ready = await ctx.evalIn(attached.sessionId, "document.querySelectorAll('.textLayer span').length");
				if (Number(ready) > 0) {
					stage("viewer ready");
					return attached.sessionId;
				}
			}
		} catch {
			// frame navigated/closed mid-render; retry
		}
		await delay(500);
	}
	throw new Error("inline PDF viewer text layer did not render");
}

async function waitForViewerHighlights(ctx) {
	stage("waiting for restored viewer highlights");
	const expression = `(()=>{const els=[...document.querySelectorAll('[data-onhand-highlight-kind="pdf"]')];return JSON.stringify(els.map(e=>{let a={};try{a=JSON.parse(e.getAttribute('data-onhand-pdf-anchor')||'{}')}catch{};return {text:e.getAttribute('data-onhand-matched-text')||'',prefix:(a.textQuote||{}).prefix||''}}))})()`;
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const all = (await ctx.cdp.send("Target.getTargets")).targetInfos;
		const frames = all.filter((t) => (t.type === "iframe" || t.type === "page") && /pdf-viewer\.html\?url=/.test(t.url));
		for (const frame of frames) {
			try {
				const attached = await ctx.cdp.send("Target.attachToTarget", { targetId: frame.targetId, flatten: true });
				const live = await ctx.evalIn(attached.sessionId, expression);
				const highlights = JSON.parse(live || "[]");
				if (highlights.length) return highlights;
			} catch {
				// target may navigate while restore is still settling
			}
		}
		await delay(500);
	}
	return [];
}

// --- Group 1: anchoring ------------------------------------------------------
async function runAnchoringGroup(pdfUrl, profile, port) {
	const child = launchBrowser(profile, port);
	try {
		const ctx = await openContext(port);
		const tabId = await openFixtureInViewer(ctx, pdfUrl);
		const viewerSession = await waitForViewerSession(ctx);
		const clearAnnotations = () =>
			ctx.evalIn(viewerSession, "(()=>{document.querySelectorAll('[data-onhand-annotation-id]').forEach(e=>e.remove());return true})()");
		const highlight = async (text, opts = {}) => {
			const res = await ctx.tool("browser_highlight_text", { tabId, text, clearExisting: true, ...opts });
			return { ok: Boolean(res?.ok), annotation: res?.result?.annotation || null };
		};

		// 1: basic highlight + re-find by anchor
		const unique = await highlight("UNIQUESENTINEL phrase");
		assert.ok(unique.ok && unique.annotation, "unique phrase should highlight");
		assert.ok(compact(unique.annotation.matchedText).includes("uniquesentinelphrase"), "unique highlight should match");
		await clearAnnotations();
		const uniqueRefind = await highlight("UNIQUESENTINEL phrase", { pdfAnchor: unique.annotation.pdfAnchor });
		assert.ok(uniqueRefind.ok && compact(uniqueRefind.annotation.matchedText).includes("uniquesentinelphrase"), "unique phrase should re-find by anchor");

		// 2: occurrence disambiguation by stored context
		await clearAnnotations();
		const occ3 = await highlight("GAMMA marker", { occurrence: 3 });
		assert.ok(occ3.ok, "third occurrence should highlight");
		assert.ok(compact(occ3.annotation.pdfAnchor?.textQuote?.prefix).includes("shows"), "occurrence 3 anchor should capture its context");
		await clearAnnotations();
		const disambiguated = await highlight("GAMMA marker", { occurrence: 1, pdfAnchor: occ3.annotation.pdfAnchor });
		assert.ok(disambiguated.ok, "context re-find should succeed");
		assert.ok(compact(disambiguated.annotation.pdfAnchor?.textQuote?.prefix).includes("shows"), "context should override occurrence=1 and re-anchor on occurrence 3");
		assert.ok(!compact(disambiguated.annotation.pdfAnchor?.textQuote?.prefix).includes("introduces"), "context re-find must not land on occurrence 1");

		// 3: context-anchored recovery of drifted exact text
		await clearAnnotations();
		const recovered = await highlight("GAMMA markerDRIFTED", { occurrence: 1, pdfAnchor: occ3.annotation.pdfAnchor });
		assert.ok(recovered.ok, "drifted text should recover via context");
		assert.equal(compact(recovered.annotation.matchedText), "gammamarker", "recovery should land on the real passage");
		assert.ok(compact(recovered.annotation.pdfAnchor?.textQuote?.prefix).includes("shows"), "recovery should land at the context-matching occurrence");

		// 4: backward-compatible Nth-occurrence selection (no context)
		await clearAnnotations();
		const occ2 = await highlight("GAMMA marker", { occurrence: 2 });
		assert.ok(occ2.ok, "second occurrence should highlight without context");
		assert.ok(compact(occ2.annotation.pdfAnchor?.textQuote?.prefix).includes("revisits"), "no-context highlight should honor the Nth occurrence");
	} finally {
		try {
			child.kill("SIGKILL");
		} catch {}
	}
}

// --- Group 2: full session restore cycle ------------------------------------
function seedExpression(pdfUrl) {
	const now = new Date().toISOString();
	const sessionId = RESTORE_TEST_SESSION_ID;
	const artifactId = "seed-artifact-anchor-test";
	const pdfAnchor = {
		surface: "pdf",
		viewer: "onhand-pdf-viewer",
		document: { url: pdfUrl, title: "fixture" },
		pageNumber: 1,
		matchedText: "GAMMA marker",
		// occurrence is deliberately 1 while the context points at occurrence 3,
		// so a correct restore must use context to re-anchor on occurrence 3.
		occurrence: 1,
		textQuote: { exact: "GAMMA marker", prefix: "Section kappa finally shows the", suffix: "among final listed items" },
		rects: [],
	};
	const artifact = {
		id: artifactId,
		createdAt: now,
		updatedAt: now,
		sessionId,
		label: "seeded fixture",
		tab: { id: 0, title: "fixture", url: pdfUrl },
		page: {
			title: "fixture",
			url: pdfUrl,
			// a scroll position so restore runs its scroll-restore step, which
			// must script the native PDF-viewer frame and whose benign access
			// error must not count as a failure.
			scrollY: 240,
			annotations: [{ annotationId: "seed-ann-1", kind: "pdf", matchedText: "GAMMA marker", pdfAnchor, note: { text: "Seeded restore note", label: "Onhand" } }],
		},
	};
	const session = {
		id: sessionId,
		name: "seed",
		createdAt: now,
		updatedAt: now,
		messages: [],
		turns: [],
		pageActions: [],
		artifactIds: [artifactId],
		learnerState: null,
	};
	return `(async () => {
		const session = ${JSON.stringify(session)};
		const artifact = ${JSON.stringify(artifact)};
		const db = await new Promise((res, rej) => { const r = indexedDB.open('onhandBrowserRuntime'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
		const put = (storeName, value) => new Promise((res, rej) => { const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).put(value); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
		await put('runtimeSessions', session);
		await put('browserArtifacts', artifact);
		const existing = (await chrome.storage.local.get('onhandBrowserRuntime')).onhandBrowserRuntime || {};
		await chrome.storage.local.set({ onhandBrowserRuntime: { settings: existing.settings || {}, currentSessionId: ${JSON.stringify(sessionId)} } });
		return 'seeded';
	})()`;
}

async function runRestoreCycleGroup(pdfUrl, profile, port) {
	// Phase 1: ensure the runtime DB/stores exist, then seed a session+artifact.
	stage("restore phase 1: seed");
	let child = launchBrowser(profile, port);
	try {
		const ctx = await openContext(port);
		await ctx.sendMessage({ type: "get-status" }); // makes loadStore create the DB + stores
		await delay(400);
		const seeded = await ctx.driverEval(seedExpression(pdfUrl));
		assert.equal(seeded, "seeded", "session + artifact should seed into IndexedDB");
	} finally {
		try {
			child.kill("SIGKILL");
		} catch {}
	}
	await delay(1500); // let the profile lock release before relaunch

	// Phase 2: fresh service worker reads the seed from disk; restore it.
	stage("restore phase 2: relaunch + restore");
	child = launchBrowser(profile, port);
	try {
		const ctx = await openContext(port);
		await openFixtureInViewer(ctx, pdfUrl);
		await waitForViewerSession(ctx);

		const restore = await ctx.sendMessage({ type: "sidebar:restore-session", sessionPath: RESTORE_TEST_SESSION_ID });
		assert.ok(restore?.ok, `restore-session should succeed: ${JSON.stringify(restore)}`);
		const pages = Array.isArray(restore.restoredPages) ? restore.restoredPages : [];
		const totalFailures = pages.reduce((sum, p) => sum + Number(p?.failedCount || 0), 0);
		const totalAnnotations = pages.reduce((sum, p) => sum + Number(p?.restoredAnnotations || 0), 0);
		const totalNotes = pages.reduce((sum, p) => sum + Number(p?.restoredNotes || 0), 0);
		assert.equal(totalFailures, 0, `restore should report zero failures (got ${JSON.stringify(pages.map((p) => p?.failures))})`);
		assert.ok(totalAnnotations >= 1, "restore should report the highlight restored");
		assert.ok(totalNotes >= 1, "restore should report the note restored");

		// The highlight must actually be live in the viewer, at occurrence 3
		// (context overriding the stored occurrence=1).
		const highlights = await waitForViewerHighlights(ctx);
		assert.ok(highlights.length >= 1, "the restored highlight should be present in the viewer DOM");
		const gamma = highlights.find((h) => compact(h.text) === "gammamarker");
		assert.ok(gamma, "the restored highlight should match the seeded passage");
		assert.ok(compact(gamma.prefix).includes("shows"), "restore should re-anchor on occurrence 3 via context, not the stored occurrence 1");
	} finally {
		try {
			child.kill("SIGKILL");
		} catch {}
	}
}

async function run() {
	if (!findBrowser()) {
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
	const pdfUrl = `http://127.0.0.1:${server.address().port}/fixture.pdf`;

	const anchoringProfile = await mkdtemp(join(tmpdir(), "onhand-anchor-test-"));
	const restoreProfile = await mkdtemp(join(tmpdir(), "onhand-restore-test-"));
	try {
		const anchoringPort = await pickAvailablePort();
		const restorePort = await pickAvailablePort();
		await runAnchoringGroup(pdfUrl, anchoringProfile, anchoringPort);
		console.log("Real-browser anchoring group: PASS");
		await runRestoreCycleGroup(pdfUrl, restoreProfile, restorePort);
		console.log("Real-browser restore-cycle group: PASS");
		return "passed";
	} finally {
		server.close();
		await rm(anchoringProfile, { recursive: true, force: true }).catch(() => {});
		await rm(restoreProfile, { recursive: true, force: true }).catch(() => {});
	}
}

const OVERALL_TIMEOUT_MS = 240000;
const timeout = setTimeout(() => {
	console.error("Real-browser anchoring test: FAIL (overall timeout)");
	process.exit(1);
}, OVERALL_TIMEOUT_MS);
timeout.unref();

run()
	.then((outcome) => {
		if (outcome !== "skipped") console.log("Real-browser anchoring test: PASS");
		process.exit(0);
	})
	.catch((error) => {
		console.error(`Real-browser anchoring test: FAIL\n${error?.stack || error}`);
		process.exit(1);
	});
