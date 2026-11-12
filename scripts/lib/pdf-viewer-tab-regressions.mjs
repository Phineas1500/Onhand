import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Exercise the production command branch and handoff, with Chrome and PDF
// rendering replaced by deterministic fakes. No real browser is controlled.
export async function runPdfViewerTabRegressions() {
	const source = await readFile(new URL("../../packages/browser-extension/background.js", import.meta.url), "utf8");
	const names = ["wakeTabForPageCommand", "resolveTargetTab", "focusTab", "isFileUrl", "isHttpLikeUrl", "isHttpsUrl",
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
	const messageMatch = /const WEB_PAGE_AT_PDF_ADDRESS_MESSAGE =\s*("(?:[^"\\]|\\.)*");/.exec(source);
	assert.ok(messageMatch, "Missing production message WEB_PAGE_AT_PDF_ADDRESS_MESSAGE");
	// webPages: addresses that answer with a web page instead of a PDF, and the PDF each one embeds.
	function harness(initialTabs, { existingViewer = null, isFirefox = false, inlineInstallError = null, webPages = {} } = {}) {
		const tabs = new Map(initialTabs.map((tab) => [tab.id, { status: "complete", ...tab }]));
		const created = [], installed = [], queues = [], inferred = [], updated = [], removed = [];
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
				remove: async (id) => { removed.push(id); tabs.delete(id); },
			},
		};
		const dependencies = {
			chrome,
			IS_FIREFOX: isFirefox,
			isRestrictedScriptingError: (error) => /Missing host permission/.test(String(error?.message || error)),
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
			installInlineOnhandPdfViewer: async (id, url, options) => {
				if (inlineInstallError) throw inlineInstallError;
				installed.push({ id, url, options });
				return { ok: true };
			},
			safeWaitForInlineOnhandPdfViewerReady: async () => ({ ready: true }),
			safeWaitForOnhandPdfViewerReady: async () => ({ ready: true }),
			withTabCommand: async (id, run) => { queues.push(id); return await run(); },
			classifyBlockedNavigation: () => null,
			WEB_PAGE_AT_PDF_ADDRESS_MESSAGE: JSON.parse(messageMatch[1]),
			describeWebPageAtPdfAddress: async (tab) => webPages[String(tab?.url || "").split("#")[0]] ?? null,
		};
		const api = new Function(...Object.keys(dependencies), `${functions}\nreturn {
			open: async (args) => { switch ("open_pdf_in_onhand_viewer") { ${command} } }
		};`)(...Object.values(dependencies));
		return { ...api, created, installed, queues, inferred, tabs, updated, removed };
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
		// Without file access Chrome can't read the PDF either: the viewer asks
		// the reader to choose it, and the agent is told to wait for that.
		const viewerUrl = `chrome-extension://onhand-test/pdf-viewer.html?url=${encodeURIComponent("file:///tmp/test.pdf")}`;
		const h = harness([{ ...native, url: "file:///tmp/test.pdf" }]);
		await assert.rejects(h.open({ tabId: 1, newTab: true }), /doesn't have access to files on this computer yet.*asking the reader to choose test\.pdf/);
		assert.equal(h.created.length, 0, "the chooser replaces the local file tab");
		assert.equal(h.tabs.get(1).url, viewerUrl);
		// The sidebar's Open PDF button gets a result instead of an error.
		const button = harness([{ ...native, url: "file:///tmp/test.pdf" }]);
		const result = await button.open({ tabId: 1, localFileChoiceResult: true });
		assert.deepEqual(result.localFileChoice, { fileName: "test.pdf" });
		assert.equal(button.tabs.get(1).url, viewerUrl);
	}
	{
		// Firefox's built-in PDF viewer can't be scripted: open Onhand's viewer in the tab instead.
		const h = harness([native], { inlineInstallError: new Error("Missing host permission for the tab") });
		const result = await h.open({ tabId: 1, pdfUrl: pdf, newTab: false });
		assert.equal(result.opened, true);
		assert.equal(h.installed.length, 0);
		assert.equal(h.tabs.get(1).url, `chrome-extension://onhand-test/pdf-viewer.html?url=${encodeURIComponent(pdf)}`);
	}
	{
		// Firefox can't read file:// URLs; its viewer asks the reader to choose the file.
		const h = harness([{ ...native, url: "file:///tmp/test.pdf" }], { isFirefox: true });
		await assert.rejects(h.open({ tabId: 1 }), /asking the reader to choose test\.pdf/);
		assert.equal(h.tabs.get(1).url, `chrome-extension://onhand-test/pdf-viewer.html?url=${encodeURIComponent("file:///tmp/test.pdf")}`);
	}
	// An address can look like a PDF and be a web page: publishers serve
	// ".../doi/pdf/..." as a page with the PDF in a frame. Laying the viewer
	// over it loaded the page's HTML as a PDF ("Invalid PDF structure").
	const wrapper = "https://journal.example.test/doi/pdf/10.1000/paper";
	const embedded = "https://journal.example.test/doi/pdfdirect/10.1000/paper.pdf";
	const index = "https://example.test/index";
	{
		const h = harness([{ ...native, url: wrapper }], { webPages: { [wrapper]: { embeddedPdfUrl: embedded } } });
		const result = await h.open({ tabId: 1, newTab: false, active: true });
		assert.deepEqual(h.created.map((tab) => tab.url), [embedded], "the PDF the page embeds gets its own tab");
		assert.equal(result.tab.id, 100);
		assert.deepEqual(h.installed.map(({ id, url }) => ({ id, url })), [{ id: 100, url: embedded }], "the viewer goes over the PDF, never over the page");
		assert.equal(h.tabs.get(1).url, wrapper, "the page stays where it was");
		assert.equal(h.updated.length, 0);
	}
	{
		const h = harness([{ ...native, url: wrapper }], { webPages: { [wrapper]: { embeddedPdfUrl: "" } } });
		await assert.rejects(h.open({ tabId: 1 }), /^Error: This tab is a web page, not a PDF file/);
		assert.equal(h.installed.length + h.created.length + h.updated.length, 0, "a page with no PDF to follow is left alone");
	}
	{
		// A link taken for the PDF turns out to be a page: the tab opened for it is closed again.
		const h = harness([{ ...native, url: index }], { webPages: { [wrapper]: { embeddedPdfUrl: "" } } });
		await assert.rejects(h.open({ tabId: 1, pdfUrl: wrapper, newTab: true }), /^Error: That address is a web page, not a PDF file/);
		assert.deepEqual(h.removed, [100]);
		assert.equal(h.installed.length, 0);
		assert.equal(h.tabs.get(1).url, index);
	}
	{
		// The same link, opened without a source tab, when the page does embed the PDF: one tab, ending on the PDF.
		const h = harness([{ ...native, url: index }], { webPages: { [wrapper]: { embeddedPdfUrl: embedded } } });
		const result = await h.open({ pdfUrl: wrapper, newTab: true });
		assert.equal(h.created.length, 1, "no second tab for the PDF");
		assert.equal(result.tab.id, 100);
		assert.equal(h.tabs.get(100).url, embedded);
		assert.deepEqual(h.installed.map(({ id, url }) => ({ id, url })), [{ id: 100, url: embedded }]);
		assert.deepEqual(h.removed, []);
		assert.equal(result.replacedCurrentTab, false);
	}
	{
		// A page that embeds another page is not followed twice.
		const h = harness([{ ...native, url: wrapper }], { webPages: { [wrapper]: { embeddedPdfUrl: embedded }, [embedded]: { embeddedPdfUrl: "https://journal.example.test/again.pdf" } } });
		await assert.rejects(h.open({ tabId: 1 }), /^Error: That address is a web page, not a PDF file/);
		assert.deepEqual(h.removed, [100], "the tab opened for the embedded address is closed");
		assert.equal(h.installed.length, 0);
		assert.equal(h.tabs.get(1).url, wrapper);
	}
	console.log("PDF tab handoff: native/inline/standalone reuse, page preservation, distinct URLs, window isolation, Docs and file gates, Firefox viewer fallbacks, web pages at PDF-looking addresses passed");
}
