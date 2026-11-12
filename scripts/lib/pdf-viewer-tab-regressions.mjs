import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Exercise the production command branch and handoff, with Chrome and PDF
// rendering replaced by deterministic fakes. No real browser is controlled.
export async function runPdfViewerTabRegressions() {
	const source = await readFile(new URL("../../packages/browser-extension/background.js", import.meta.url), "utf8");
	const names = ["wakeTabForPageCommand", "resolveTargetTab", "focusTab", "isFileUrl", "isHttpLikeUrl", "isHttpsUrl",
		"isLikelyPdfResourceUrl", "normalizePdfUrlCandidate", "isOwnExtensionPdfViewerUrl", "isOnhandPdfViewerLikeUrl",
		"extractPdfSourceUrlFromViewerLikeUrl", "resolvePdfSourceUrlForViewer", "stripUrlHash", "normalizePdfPageNumber",
		"shouldDetachPdfViewerOpenFromSourceTab", "pdfTabMatchesSource", "findExistingPdfViewerTab", "tabNavigationWait", "openPdfInOnhandViewer"];
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
		const created = [], installed = [], queues = [], inferred = [], updated = [], removed = [], tabWaits = [], viewerWaits = [];
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
			waitForTabComplete: (id, _timeoutMs, options = {}) => { tabWaits.push({ id, ...options }); return chrome.tabs.get(id); },
			ensureInlinePdfViewerBridgeToken: async () => {},
			grantOnhandPdfViewerCredentialedSource: () => {},
			installInlineOnhandPdfViewer: async (id, url, options) => {
				if (inlineInstallError) throw inlineInstallError;
				installed.push({ id, url, options });
				return { ok: true };
			},
			safeWaitForInlineOnhandPdfViewerReady: async () => ({ ready: true }),
			safeWaitForOnhandPdfViewerReady: async (id, _timeoutMs, pdfUrl) => { viewerWaits.push({ id, pdfUrl }); return { ready: true }; },
			withTabCommand: async (id, run) => { queues.push(id); return await run(); },
			classifyBlockedNavigation: () => null,
			WEB_PAGE_AT_PDF_ADDRESS_MESSAGE: JSON.parse(messageMatch[1]),
			describeWebPageAtPdfAddress: async (tab) => webPages[String(tab?.url || "").split("#")[0]] ?? null,
		};
		const api = new Function(...Object.keys(dependencies), `${functions}\nreturn {
			open: async (args) => { switch ("open_pdf_in_onhand_viewer") { ${command} } }
		};`)(...Object.values(dependencies));
		return { ...api, created, installed, queues, inferred, tabs, updated, removed, tabWaits, viewerWaits };
	}
	const native = { id: 1, windowId: 1, active: true, url: `${pdf}#page=7` };
	const index = "https://example.test/index";
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
		const viewerUrl = `chrome-extension://onhand-test/pdf-viewer.html?url=${encodeURIComponent(pdf)}`;
		assert.equal(h.tabs.get(1).url, viewerUrl);
		// Firefox resolves tabs.update with the tab still "complete" at the PDF's
		// address: the wait has to be for the viewer, and then for the viewer to
		// answer for this PDF. The open step used to report done before either.
		const showing = h.tabWaits.at(-1)?.showing;
		assert.equal(typeof showing, "function", "the tab is waited on until it shows the viewer");
		assert.equal(showing({ url: native.url }), false, "the PDF's own address is not the viewer");
		assert.equal(showing({ url: `chrome-extension://onhand-test/pdf-viewer.html?url=${encodeURIComponent("https://papers.example.test/other.pdf")}` }), false, "nor is the viewer showing another PDF");
		assert.equal(showing({ url: `${viewerUrl}&page=7` }), true);
		assert.deepEqual(h.viewerWaits, [{ id: 1, pdfUrl: pdf }], "the viewer is asked whether this PDF is ready");
	}
	{
		// A PDF address opened in the tab that is on another page: only Firefox
		// needs to be told where the tab is navigating from.
		for (const isFirefox of [false, true]) {
			const h = harness([{ ...native, url: index }], { isFirefox });
			await h.open({ tabId: 1, pdfUrl: pdf, newTab: false });
			assert.deepEqual(h.tabWaits.map((wait) => wait.navigatingFrom), [isFirefox ? index : undefined]);
		}
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
	await assertTabWaitsFollowTheNavigation(source);
	await assertViewerTabReadinessUsesTheViewerPort(source);
	console.log("PDF tab handoff: native/inline/standalone reuse, page preservation, distinct URLs, window isolation, Docs and file gates, Firefox viewer fallbacks, web pages at PDF-looking addresses, tab waits that follow the navigation, viewer readiness over its port passed");
}

function productionFunctions(source, names) {
	return names.map((name) => {
		const match = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
		assert.ok(match, `Missing production function ${name}`);
		const end = source.indexOf("\n}", match.index);
		assert.ok(end > match.index);
		return source.slice(match.index, end + 2);
	}).join("\n");
}

// Firefox resolves tabs.update before the navigation shows on the tab: the
// tab still reads "complete" at the address it is leaving. A wait for
// "complete" returned at once, so a same-tab navigation reported the old page
// as loaded and a PDF moved into Onhand's viewer reported done before the
// viewer had loaded.
async function assertTabWaitsFollowTheNavigation(source) {
	const functions = productionFunctions(source, ["stripUrlHash", "tabNavigationWait", "waitForTabComplete"]);
	const old = "https://example.test/old";
	const next = "https://example.test/new";
	// states: what tabs.get answers, one entry per call (the last one repeats).
	const build = (states, { isFirefox = true, graceMs = 5000 } = {}) => {
		let reads = 0;
		const listeners = new Set();
		const chrome = {
			tabs: {
				get: async () => ({ id: 1, ...states[Math.min(reads++, states.length - 1)] }),
				onUpdated: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
			},
		};
		const api = new Function("chrome", "IS_FIREFOX", "TAB_COMPLETE_POLL_MS", "TAB_NAVIGATION_START_GRACE_MS", `${functions}\nreturn { waitForTabComplete, tabNavigationWait };`)(chrome, isFirefox, 5, graceMs);
		return { ...api, listeners, reads: () => reads };
	};
	const atOld = { status: "complete", url: old };
	const loading = { status: "loading", url: next };
	const atNew = { status: "complete", url: next };
	{
		// The default wait is unchanged: a tab that reads "complete" is loaded.
		const h = build([atOld, loading, atNew]);
		assert.equal((await h.waitForTabComplete(1, 1000)).url, old);
		assert.equal(h.reads(), 1);
	}
	{
		// Told where the tab is navigating from, the wait outlasts the moment it still shows that address.
		const h = build([atOld, atOld, loading, loading, atNew]);
		const tab = await h.waitForTabComplete(1, 1000, { navigatingFrom: old });
		assert.equal(tab.url, next, "a just-navigated tab is not loaded while it still shows the old page");
		assert.equal(h.listeners.size, 0, "the wait cleans up its listener");
	}
	{
		// A navigation that finished between two looks shows as a changed address.
		const h = build([atOld, atNew]);
		assert.equal((await h.waitForTabComplete(1, 1000, { navigatingFrom: old })).url, next);
	}
	{
		// A reload shows as a status change at the same address.
		const h = build([atOld, { status: "loading", url: old }, atOld]);
		const tab = await h.waitForTabComplete(1, 1000, { navigatingFrom: old });
		assert.equal(tab.url, old);
		assert.equal(h.reads(), 3, "the reload was waited for");
	}
	{
		// A tab that was not going anywhere (a download) is given up on after the grace time, not the whole timeout.
		const h = build([atOld], { graceMs: 40 });
		const startedAt = Date.now();
		assert.equal((await h.waitForTabComplete(1, 5000, { navigatingFrom: old })).url, old);
		assert.ok(Date.now() - startedAt < 1500, "the grace time ends the wait");
		assert.ok(h.reads() > 2, "the tab was watched for the grace time");
	}
	{
		// showing: a tab sent to Onhand's viewer is loaded once it shows the viewer, whatever it reads first.
		const viewer = "moz-extension://onhand-test/pdf-viewer.html?url=x";
		const h = build([atOld, { status: "complete", url: "about:blank" }, { status: "loading", url: viewer }, { status: "complete", url: viewer }]);
		const tab = await h.waitForTabComplete(1, 1000, { showing: (candidate) => candidate.url === viewer });
		assert.equal(tab.url, viewer);
	}
	{
		// A "complete" event for another address does not end a wait for the viewer; the timeout still does.
		const viewer = "moz-extension://onhand-test/pdf-viewer.html?url=x";
		const h = build([atOld]);
		const waiting = h.waitForTabComplete(1, 120, { showing: (candidate) => candidate.url === viewer });
		await new Promise((resolve) => setTimeout(resolve, 20));
		for (const listener of [...h.listeners]) listener(1, { status: "complete" }, { id: 1, ...atOld });
		assert.equal(h.listeners.size, 1, "the wait goes on");
		assert.equal((await waiting).url, old, "the timeout hands back the tab as it is");
	}
	{
		// Only Firefox is told, and not for a move within the same document.
		const firefox = build([atOld]);
		assert.deepEqual(firefox.tabNavigationWait({ url: old }, next), { navigatingFrom: old });
		assert.deepEqual(firefox.tabNavigationWait({ url: old }, `${old}#section`), {});
		assert.deepEqual(firefox.tabNavigationWait({ url: "" }, next), {});
		assert.deepEqual(build([atOld], { isFirefox: false }).tabNavigationWait({ url: old }, next), {});
	}
}

// The standalone viewer's readiness was read through the debugger alone.
// Firefox has none, so the wait sat out its whole timeout there; the viewer's
// own runtime port answers in every browser.
async function assertViewerTabReadinessUsesTheViewerPort(source) {
	const functions = productionFunctions(source, ["readOnhandPdfViewerTabStatus", "waitForOnhandPdfViewerReady"]);
	const pdf = "https://papers.example.test/paper.pdf";
	const build = ({ portAnswers, hasDebugger, debuggerAnswer = { ready: true } }) => {
		const portCalls = [], debuggerCalls = [];
		const chrome = hasDebugger ? { debugger: {} } : {};
		const callOnhandPdfViewerFrameViaRuntimePort = async (tabId, command, _message, sourceUrl) => {
			portCalls.push({ tabId, command, sourceUrl });
			const answer = portAnswers[Math.min(portCalls.length - 1, portAnswers.length - 1)];
			if (answer instanceof Error) throw answer;
			return answer;
		};
		const evaluateInTab = async (tabId, _expression, options) => {
			debuggerCalls.push({ tabId, options });
			if (debuggerAnswer instanceof Error) throw debuggerAnswer;
			return debuggerAnswer;
		};
		const delay = (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5)));
		const api = new Function("chrome", "callOnhandPdfViewerFrameViaRuntimePort", "evaluateInTab", "delay", `${functions}\nreturn { waitForOnhandPdfViewerReady };`)(chrome, callOnhandPdfViewerFrameViaRuntimePort, evaluateInTab, delay);
		return { ...api, portCalls, debuggerCalls };
	};
	const noPort = new Error("No Onhand PDF viewer runtime port found");
	{
		// Firefox: the port is not there until the viewer page connects, then says when the first pages are drawn.
		const h = build({ portAnswers: [noPort, noPort, { ready: false, statusText: "Preparing 12 pages..." }, { ready: true, statusText: "Ready" }], hasDebugger: false });
		const ready = await h.waitForOnhandPdfViewerReady(7, 2000, pdf);
		assert.equal(ready.ok, true);
		assert.equal(ready.statusText, "Ready");
		assert.equal(h.portCalls.length, 4);
		assert.deepEqual(h.portCalls[0], { tabId: 7, command: { command: "status" }, sourceUrl: pdf }, "the port is asked for this PDF's viewer");
		assert.equal(h.debuggerCalls.length, 0, "no debugger is asked for where there is none");
	}
	{
		// Firefox, viewer never connects: the wait ends at its timeout with the port's message.
		const h = build({ portAnswers: [noPort], hasDebugger: false });
		await assert.rejects(h.waitForOnhandPdfViewerReady(7, 60, pdf), /No Onhand PDF viewer runtime port found/);
		assert.equal(h.debuggerCalls.length, 0);
	}
	{
		// Chrome: the port answers first; the debugger is not attached at all.
		const h = build({ portAnswers: [{ ready: true }], hasDebugger: true });
		assert.equal((await h.waitForOnhandPdfViewerReady(7, 2000, pdf)).ok, true);
		assert.equal(h.debuggerCalls.length, 0);
	}
	{
		// Chrome, port not connected: the debugger still reads the viewer page.
		const h = build({ portAnswers: [noPort], hasDebugger: true, debuggerAnswer: { ready: true, statusText: "Ready" } });
		const ready = await h.waitForOnhandPdfViewerReady(7, 2000, pdf);
		assert.equal(ready.ok, true);
		assert.deepEqual(h.debuggerCalls, [{ tabId: 7, options: { skipScripting: true } }]);
	}
}
