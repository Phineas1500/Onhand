import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Exercise the production command branch and handoff, with Chrome and PDF
// rendering replaced by deterministic fakes. No real browser is controlled.
export async function runPdfViewerTabRegressions() {
	const source = await readFile(new URL("../../packages/browser-extension/background.js", import.meta.url), "utf8");
	const names = ["resolveTargetTab", "focusTab", "isFileUrl", "isHttpLikeUrl", "isHttpsUrl",
		"isLikelyPdfResourceUrl", "normalizePdfUrlCandidate", "isOwnExtensionPdfViewerUrl", "isOnhandPdfViewerLikeUrl",
		"extractPdfSourceUrlFromViewerLikeUrl", "resolvePdfSourceUrlForViewer", "stripUrlHash", "normalizePdfPageNumber",
		"shouldDetachPdfViewerOpenFromSourceTab", "pdfTabMatchesSource", "findExistingPdfViewerTab", "openPdfInOnhandViewer"];
	const functions = names.map((name) => {
		const match = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
		assert.ok(match, `Missing production function ${name}`);
		const end = source.indexOf("\n}", match.index);
		assert.ok(end > match.index);
		return source.slice(match.index, end + 2);
	}).join("\n");
	const caseStart = source.indexOf('case "open_pdf_in_onhand_viewer": {');
	const caseEnd = source.indexOf('case "get_cookies":', caseStart);
	assert.ok(caseStart > 0 && caseEnd > caseStart);
	const command = source.slice(caseStart, caseEnd);
	const pdf = "https://papers.example.test/paper.pdf";
	const exportUrl = "https://docs.google.com/document/d/test/export?format=pdf";
	function harness(initialTabs, { existingViewer = null } = {}) {
		const tabs = new Map(initialTabs.map((tab) => [tab.id, { status: "complete", ...tab }]));
		const created = [], installed = [], queues = [], inferred = [], updated = [];
		let nextId = 100;
		const chrome = {
			runtime: { getURL: (path) => `chrome-extension://onhand-test/${path}` },
			windows: { getLastFocused: async () => ({ id: 1 }), update: async () => {} },
			tabs: {
				get: async (id) => { assert.ok(tabs.has(id)); return { ...tabs.get(id) }; },
				query: async (query) => [...tabs.values()].filter((tab) =>
					(query.windowId === undefined || tab.windowId === query.windowId)
					&& (!query.lastFocusedWindow || tab.windowId === 1) && (!query.active || tab.active)),
				create: async (args) => {
					const tab = { id: nextId++, windowId: 1, url: "about:blank", status: "complete", ...args };
					created.push(args); tabs.set(tab.id, tab); return { ...tab };
				},
				update: async (id, args) => { updated.push({ id, ...args }); Object.assign(tabs.get(id), args); return { ...tabs.get(id) }; },
			},
		};
		const dependencies = {
			chrome,
			isGoogleDocsDocumentUrl: (url) => String(url).startsWith("https://docs.google.com/document/d/") && !String(url).includes("/export"),
			buildGoogleDocsPdfExportUrl: () => exportUrl,
			isAllowedFileSchemeAccess: async () => false,
			localFileAccessMessage: () => "Allow access to file URLs",
			createPdfViewerHandoffDiagnostics: () => null,
			normalizePdfSelectionForViewerHandoff: () => null,
			getPdfSelectionForViewerHandoff: async () => null,
			withOperationTimeout: (promise) => promise,
			PDF_SELECTION_HANDOFF_TIMEOUT_MS: 100,
			getPdfPageNumberFromSelectionPayload: () => null,
			inferInitialPdfViewerPageLocation: async (_args, tab) => { inferred.push(tab.id); return { pageNumber: 7, source: "native-viewer" }; },
			probeInlineOnhandPdfViewerStatus: async () => existingViewer,
			buildOnhandPdfViewerUrl: (url) => `chrome-extension://onhand-test/pdf-viewer.html?url=${encodeURIComponent(url)}`,
			clampNumber: (value, fallback) => value ?? fallback,
			simplifyTab: (tab) => ({ ...tab }),
			log: () => {},
			waitForTabComplete: (id) => chrome.tabs.get(id),
			ensureInlinePdfViewerBridgeToken: async () => {},
			grantOnhandPdfViewerCredentialedSource: () => {},
			installInlineOnhandPdfViewer: async (id, url, options) => { installed.push({ id, url, options }); return { ok: true }; },
			safeWaitForInlineOnhandPdfViewerReady: async () => ({ ready: true }),
			safeWaitForOnhandPdfViewerReady: async () => ({ ready: true }),
			withTabCommand: async (id, run) => { queues.push(id); return await run(); },
			classifyBlockedNavigation: () => null,
		};
		const api = new Function(...Object.keys(dependencies), `${functions}\nreturn {
			open: async (args) => { switch ("open_pdf_in_onhand_viewer") { ${command} } }
		};`)(...Object.values(dependencies));
		return { ...api, created, installed, queues, inferred, tabs, updated };
	}
	const native = { id: 1, windowId: 1, active: true, url: `${pdf}#page=7` };
	for (const args of [{ tabId: 1 }, {}, { titleContains: "Paper" }]) {
		const h = harness([{ ...native, title: "Paper" }]);
		const result = await h.open({ ...args, pdfUrl: pdf, newTab: true, active: false });
		assert.equal(result.tab.id, 1);
		assert.equal(h.created.length, 0, "first native-PDF handoff must not create a duplicate");
		assert.deepEqual(h.queues, [1]);
		assert.deepEqual(h.inferred, [1], "page and selection probes belong to the existing PDF");
		assert.deepEqual(h.installed[0], { id: 1, url: pdf, options: { pageNumber: 7 } });
		assert.equal(h.updated.length, 0, "in-place handoff preserves native URL and background focus");
	}
	{
		const h = harness([native]);
		assert.equal((await h.open({ tabId: 1, newTab: true, active: false })).tab.id, 1);
		assert.equal(h.created.length, 0, "inferred PDF URLs also reuse the current tab");
	}
	{
		const h = harness([native, { ...native, id: 2, active: false }]);
		assert.equal((await h.open({ pdfUrl: pdf, newTab: true })).tab.id, 1, "prefer the current PDF if duplicates already exist");
		assert.equal(h.created.length, 0);
	}
	{
		const h = harness([{ ...native, url: "https://example.test/index" }, { ...native, id: 2, active: false }]);
		assert.equal((await h.open({ pdfUrl: pdf, newTab: true, active: false })).tab.id, 2);
		assert.equal(h.created.length, 0);
		assert.equal(h.tabs.get(1).url, "https://example.test/index");
	}
	for (const url of ["https://example.test/different.pdf", `${pdf}?version=2`]) {
		const h = harness([native, { ...native, id: 2, windowId: 2, url }]);
		await h.open({ pdfUrl: url, newTab: true, active: false, windowId: 1 });
		assert.equal(h.created.length, 1, "different documents or other windows cannot hijack the source tab");
		assert.equal(h.tabs.get(1).url, native.url);
		assert.deepEqual(h.queues, [100]);
	}
	{
		const h = harness([native], { existingViewer: { ready: true, pageNumber: 9, sourceUrl: pdf } });
		const result = await h.open({ pdfUrl: pdf, newTab: true });
		assert.equal(result.reusedExistingViewer, true);
		assert.equal(result.initialPageNumber, 9);
		assert.equal(h.installed.length, 0);
		assert.equal(h.created.length, 0);
	}
	{
		const viewer = `chrome-extension://onhand-test/pdf-viewer.html?url=${encodeURIComponent(pdf)}`;
		const h = harness([{ ...native, url: viewer }]);
		assert.equal((await h.open({ pdfUrl: pdf, newTab: true })).tab.id, 1);
		assert.equal(h.created.length, 0);
	}
	{
		const h = harness([{ ...native, url: "https://docs.google.com/document/d/test/edit" }]);
		await h.open({ tabId: 1, newTab: true, active: false });
		assert.equal(h.created.length, 1, "Google Docs exports keep their document tab");
		assert.equal(h.tabs.get(1).url, "https://docs.google.com/document/d/test/edit");
	}
	{
		const h = harness([{ ...native, url: "file:///tmp/test.pdf" }]);
		await assert.rejects(h.open({ tabId: 1, newTab: true }), /Allow access/);
		assert.equal(h.created.length, 0, "local-file permission gates are preserved");
	}
	console.log("PDF tab handoff: native/inline/standalone reuse, page preservation, distinct URLs, window isolation, Docs and file gates passed");
}
