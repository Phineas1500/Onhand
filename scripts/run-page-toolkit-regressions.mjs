import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { scholarPdfHtml } from "./serve-browser-runtime-fixture.mjs";

const PROJECT_ROOT = process.cwd();
const GOOGLE_DOCS_FIXTURE_ID = "onhand-fixture-doc-id";
const GOOGLE_DOCS_FIXTURE_EDIT_URL = `https://docs.google.com/document/d/${GOOGLE_DOCS_FIXTURE_ID}/edit?tab=t.0`;
const GOOGLE_DOCS_FIXTURE_PDF_EXPORT_URL = `https://docs.google.com/document/d/${GOOGLE_DOCS_FIXTURE_ID}/export?format=pdf`;
const GOOGLE_DOCS_FIXTURE_TEXT_EXPORT_PATTERN = new RegExp(`/document/d/${GOOGLE_DOCS_FIXTURE_ID}/export\\?format=txt$`);

const sourceFileCache = new Map();

function readSourceFile(relativePath) {
	if (!sourceFileCache.has(relativePath)) {
		sourceFileCache.set(relativePath, readFile(join(PROJECT_ROOT, relativePath), "utf8"));
	}
	return sourceFileCache.get(relativePath);
}

async function loadPageToolkitFactory() {
	const source = await readSourceFile("packages/browser-extension/background.js");
	const start = source.indexOf("const createPageToolkit = ");
	const end = source.indexOf("\n};\n\nasync function evaluateInTab", start);
	assert.notEqual(start, -1, "createPageToolkit declaration not found");
	assert.notEqual(end, -1, "createPageToolkit end marker not found");
	const expressionStart = source.indexOf("=", start) + 1;
	const expression = source.slice(expressionStart, end + 2).trim().replace(/;$/, "");
	return expression;
}

async function loadBackgroundFunction(functionName) {
	return loadFunctionFromFile("packages/browser-extension/background.js", functionName);
}

async function loadFunctionFromFile(relativePath, functionName) {
	const source = await readSourceFile(relativePath);
	const start = source.indexOf(`function ${functionName}`);
	assert.notEqual(start, -1, `${functionName} declaration not found`);
	const signatureEnd = source.indexOf(")", start);
	assert.notEqual(signatureEnd, -1, `${functionName} signature end not found`);
	const bodyStart = source.indexOf("{", signatureEnd);
	assert.notEqual(bodyStart, -1, `${functionName} body not found`);
	const declarationStart = source.slice(Math.max(0, start - 6), start) === "async " ? start - 6 : start;
	let depth = 0;
	for (let index = bodyStart; index < source.length; index += 1) {
		const char = source[index];
		if (char === "{") depth += 1;
		if (char === "}") {
			depth -= 1;
			if (depth === 0) return source.slice(declarationStart, index + 1);
		}
	}
	assert.fail(`${functionName} body end not found`);
}

async function assertDetachedPdfViewerOpenRouting() {
	const functionNames = ["normalizePdfUrlCandidate", "shouldDetachPdfViewerOpenFromSourceTab"];
	const declarations = await Promise.all(functionNames.map((functionName) => loadBackgroundFunction(functionName)));
	const helpers = new Function(`${declarations.join("\n")}\nreturn { ${functionNames.join(", ")} };`)();
	const detach = helpers.shouldDetachPdfViewerOpenFromSourceTab;

	assert.equal(detach({ pdfUrl: "https://example.test/paper.pdf", newTab: true }), true, "pdfUrl-only newTab opens must detach from the active tab");
	assert.equal(detach({ pdfUrl: "https://example.test/paper.pdf", newTab: true, tabId: 12 }), false, "an explicit tabId keeps the source tab");
	assert.equal(detach({ pdfUrl: "https://example.test/paper.pdf" }), false, "without newTab the open converts the source tab");
	assert.equal(detach({ newTab: true }), false, "no pdfUrl means the source tab is the PDF");
	assert.equal(detach({ pdfUrl: "file:///Users/me/a.pdf", newTab: true }), false, "file: pdfUrl stays tied to the source tab trust check");
	assert.equal(detach({ pdfUrl: "https://example.test/paper.pdf", newTab: true, urlContains: "arxiv" }), false, "explicit tab targeting keeps the source tab");

	const backgroundSource = await readSourceFile("packages/browser-extension/background.js");
	assert.ok(
		backgroundSource.includes("if (shouldDetachPdfViewerOpenFromSourceTab(args)) {"),
		"open_pdf_in_onhand_viewer command must route detached opens before resolving a source tab",
	);
	assert.ok(
		backgroundSource.includes("newTab: false,\n\t\t\t\t\t\t\t\tdetachedNewTab: true,\n\t\t\t\t\t\t\t\tdisableSelectionHandoff: true,"),
		"detached opens must convert the fresh tab in place and skip selection handoff",
	);
	assert.ok(
		backgroundSource.includes("async function withTabCommand(tabId, fn, timeoutMs = TAB_COMMAND_TIMEOUT_MS)"),
		"withTabCommand must accept a per-command timeout so detached PDF opens outlive the 15s default",
	);
}

async function assertRemoveAnnotationsTargetsSingleMarks() {
	const { dom, toolkit } = await createToolkit(
		`<main><p>The actual failure was due to aeroelastic flutter. Heavy cross winds drove the bridge into oscillations at its resonant frequency.</p></main>`,
	);
	const document = dom.window.document;
	const first = await toolkit.highlightText("aeroelastic flutter", { scrollIntoView: false });
	const second = await toolkit.highlightText("resonant frequency", { scrollIntoView: false });
	await toolkit.showNote(second.annotationId, "Keep this one.", { scrollIntoView: false });

	const removed = toolkit.removeAnnotations([first.annotationId]);
	assert.equal(removed.removedCount, 1);
	assert.equal(
		document.querySelectorAll(`[data-onhand-annotation-id="${first.annotationId}"]`).length,
		0,
		"the removed mark must leave the DOM",
	);
	assert.ok(
		document.body.textContent.includes("aeroelastic flutter"),
		"removing a highlight must keep the underlying page text",
	);
	assert.ok(
		document.querySelectorAll(`[data-onhand-annotation-id="${second.annotationId}"]`).length >= 1,
		"other marks must survive a targeted removal",
	);
	assert.ok(
		document.querySelector(`[data-onhand-note-for="${second.annotationId}"]`),
		"notes on surviving marks must stay",
	);
	assert.throws(
		() => toolkit.removeAnnotations(["onhand-9999-missing"]),
		/No annotation found/,
		"removing an unknown id fails loud so frame dispatch can try the next frame",
	);
}

async function assertPdfViewerHandoffHelpers() {
	const functionNames = [
		"isOwnExtensionPdfViewerUrl",
		"isOnhandPdfViewerLikeUrl",
		"isHttpLikeUrl",
		"isFileUrl",
		"isLikelyPdfResourceUrl",
		"normalizePdfUrlCandidate",
		"extractPdfSourceUrlFromViewerLikeUrl",
		"isGoogleDocsDocumentUrl",
		"googleDocsDocumentIdFromUrl",
		"buildGoogleDocsPdfExportUrl",
		"resolvePdfSourceUrlForViewer",
		"normalizePdfPageNumber",
			"normalizePdfScrollRatio",
			"buildOnhandPdfViewerUrl",
			"getPdfPageNumberFromSelectionPayload",
			"inferPdfPageNumberFromAccessibilityNodes",
			"inferPdfPageFractionFromDebuggerDomDetails",
			"getGoogleScholarReaderPageExpression",
			"isUnsupportedPdfSurfacePayload",
			"isLikelyPdfTabUrl",
			"shouldTryOnhandPdfViewerFrameForTab",
	];
	const declarations = await Promise.all(functionNames.map((functionName) => loadBackgroundFunction(functionName)));
	const helpers = new Function(
		"chrome",
		`${declarations.join("\n")}\nreturn { ${functionNames.join(", ")} };`,
	)({
		runtime: {
			getURL(path) {
				return `chrome-extension://onhand-test/${path}`;
			},
		},
	});

	assert.equal(helpers.isLikelyPdfResourceUrl("https://arxiv.org/pdf/2509.03345"), true);
	assert.equal(helpers.isLikelyPdfResourceUrl("https://example.test/article"), false);
	assert.equal(helpers.isOnhandPdfViewerLikeUrl("chrome-extension://onhand-test/pdf-viewer.html?url=https%3A%2F%2Fexample.test%2Fpaper.pdf"), true);
	assert.equal(
		helpers.isOnhandPdfViewerLikeUrl("http://127.0.0.1:8765/onhand-pdf-viewer.html?url=http%3A%2F%2F127.0.0.1%3A8765%2Ffixtures%2Fonhand-viewer.pdf"),
		true,
	);
	assert.equal(
		helpers.resolvePdfSourceUrlForViewer({}, { url: "http://127.0.0.1:8765/scholar-pdf.html?file=/fixtures/scholar-reader.pdf" }),
		"http://127.0.0.1:8765/fixtures/scholar-reader.pdf",
	);
	assert.equal(
		helpers.resolvePdfSourceUrlForViewer(
			{},
			{
				url: "http://127.0.0.1:8765/onhand-pdf-viewer.html?url=http%3A%2F%2F127.0.0.1%3A8765%2Ffixtures%2Fonhand-viewer.pdf",
			},
		),
		"http://127.0.0.1:8765/fixtures/onhand-viewer.pdf",
	);
	assert.equal(
		helpers.resolvePdfSourceUrlForViewer({ pdfUrl: "https://example.test/download?id=paper-123" }, { url: "https://example.test/article" }),
		"https://example.test/download?id=paper-123",
	);
	assert.equal(
		helpers.resolvePdfSourceUrlForViewer(
			{},
			{ url: GOOGLE_DOCS_FIXTURE_EDIT_URL },
		),
		GOOGLE_DOCS_FIXTURE_PDF_EXPORT_URL,
	);
	assert.equal(
		helpers.buildOnhandPdfViewerUrl("https://example.test/paper.pdf"),
		"chrome-extension://onhand-test/pdf-viewer.html?url=https%3A%2F%2Fexample.test%2Fpaper.pdf",
	);
	assert.equal(
		helpers.buildOnhandPdfViewerUrl("https://example.test/paper.pdf", { pageNumber: 7 }),
		"chrome-extension://onhand-test/pdf-viewer.html?url=https%3A%2F%2Fexample.test%2Fpaper.pdf&page=7",
	);
	assert.equal(
		helpers.buildOnhandPdfViewerUrl("https://example.test/paper.pdf", { scrollRatio: 0.3076923 }),
		"chrome-extension://onhand-test/pdf-viewer.html?url=https%3A%2F%2Fexample.test%2Fpaper.pdf&scrollRatio=0.307692",
	);
	assert.equal(
		helpers.buildOnhandPdfViewerUrl("https://example.test/paper.pdf", { pageNumber: 7, scrollRatio: 0.3076923 }),
		"chrome-extension://onhand-test/pdf-viewer.html?url=https%3A%2F%2Fexample.test%2Fpaper.pdf&page=7",
	);
	assert.equal(helpers.getPdfPageNumberFromSelectionPayload({ text: "", viewer: "google-scholar", pageNumber: 13 }), 13);
	assert.equal(helpers.getPdfPageNumberFromSelectionPayload({ text: "", pdfAnchor: { pageNumber: 9 } }), 9);
	assert.equal(
		helpers.shouldTryOnhandPdfViewerFrameForTab({
			url: "chrome-extension://onhand-test/pdf-viewer.html?url=https%3A%2F%2Fexample.test%2Fpaper.pdf",
		}),
		true,
		"Own-extension PDF viewer tabs should fall back to the runtime bridge when direct scripting is blocked",
	);
	assert.equal(
		helpers.shouldTryOnhandPdfViewerFrameForTab(
			{ url: "chrome-extension://onhand-test/pdf-viewer.html?url=https%3A%2F%2Fexample.test%2Fpaper.pdf" },
			{ annotation: { annotationId: "onhand-pdf-test" } },
		),
		false,
		"Own-extension PDF viewer tabs should not rerun the bridge after a successful direct toolkit result",
	);
	assert.deepEqual(
		helpers.inferPdfPageNumberFromAccessibilityNodes([
			{ role: "textbox", name: "Page number", value: "13" },
		]),
		{ pageNumber: 13, source: "accessibility-page-control" },
	);
	assert.deepEqual(
		helpers.inferPdfPageNumberFromAccessibilityNodes([
			{ role: "textField", value: "4" },
			{ role: "text", name: "/" },
			{ role: "text", name: "15" },
		]),
		{ pageNumber: 4, source: "accessibility-page-fraction" },
	);
	assert.deepEqual(
		helpers.inferPdfPageNumberFromAccessibilityNodes([
			{ role: "textField", value: "4" },
			{ role: "text", name: "/ 15" },
			{ role: "spinbutton", name: "Page number", value: "1" },
			{ role: "text", name: "/ 15" },
		]),
		{ pageNumber: 4, source: "accessibility-page-fraction" },
		"Scholar's current page should win over an already-open Onhand viewer stuck on page 1",
	);
		assert.deepEqual(
			helpers.inferPdfPageNumberFromAccessibilityNodes(
				[
					{ role: { value: "button" }, name: { value: "Previous page" } },
					{ role: { value: "textbox" }, value: { value: "2" } },
				{ role: { value: "text" }, name: { value: "/" } },
				{ role: { value: "text" }, name: { value: "15" } },
				{ role: { value: "button" }, name: { value: "Next page" } },
			],
			"google-scholar-accessibility",
			),
			{ pageNumber: 2, source: "google-scholar-accessibility-page-fraction" },
		);
		assert.equal(
			helpers.inferPdfPageFractionFromDebuggerDomDetails({
				value: "4",
				parentTextContent: "4 / 15",
				toolbarTextContent: "Previous page 4 / 15 Next page 105%",
			}),
			4,
			"Debugger DOM inference should detect an unlabeled Google Scholar page fraction",
		);
		assert.equal(
			helpers.inferPdfPageFractionFromDebuggerDomDetails({
				value: "105%",
				parentTextContent: "Previous page 4 / 15 Next page 105%",
				toolbarTextContent: "Previous page 4 / 15 Next page 105%",
			}),
			null,
			"Debugger DOM inference should not confuse the zoom input with the current page",
		);
		{
			const dom = new JSDOM(`
				<!doctype html>
				<body>
				<div role="toolbar" class="gsr-toolbar">
					<button aria-label="Previous page"></button>
					<input type="text" value="4">
					<span>/</span>
					<span>15</span>
					<button aria-label="Next page"></button>
					<input type="text" value="105%">
				</div>
			</body>
		`);
		const previousDocument = globalThis.document;
		const previousElement = globalThis.Element;
		const previousWindow = globalThis.window;
		globalThis.document = dom.window.document;
		globalThis.Element = dom.window.Element;
		globalThis.window = dom.window;
		let detection;
		try {
			detection = Function(`return ${helpers.getGoogleScholarReaderPageExpression()};`)();
		} finally {
			if (previousDocument === undefined) delete globalThis.document;
			else globalThis.document = previousDocument;
			if (previousElement === undefined) delete globalThis.Element;
			else globalThis.Element = previousElement;
			if (previousWindow === undefined) delete globalThis.window;
			else globalThis.window = previousWindow;
		}
		assert.deepEqual(detection, { pageNumber: 4, source: "google-scholar-page-fraction", score: -1 });
	}
	assert.deepEqual(
		helpers.inferPdfPageNumberFromAccessibilityNodes([
			{
				role: { value: "tab" },
				name: { value: "Thumbnail for page 13" },
				properties: [{ name: "selected", value: true }],
			},
		]),
		{ pageNumber: 13, source: "accessibility-selected-thumbnail" },
	);
	assert.equal(
		helpers.resolvePdfSourceUrlForViewer({}, { url: "chrome-extension://onhand-test/pdf-viewer.html?url=https%3A%2F%2Fexample.test%2Fdownload%3Fid%3Dpaper-123" }),
		"https://example.test/download?id=paper-123",
	);
	assert.throws(() => helpers.resolvePdfSourceUrlForViewer({}, { url: "https://example.test/article" }), /Could not determine a PDF URL/);

	const backgroundSource = await readFile(join(PROJECT_ROOT, "packages/browser-extension/background.js"), "utf8");
	assert.match(
		backgroundSource,
		/if \(!sourceIsGoogleDocs && !isOnhandPdfViewerLikeUrl\(sourceTab\.url\) && isHttpLikeUrl\(pdfUrl\)\)/,
		"Open PDF should not redirect an existing Onhand PDF viewer-like tab back to its raw PDF source",
	);
	// Every PDF tab has the browser's native PDF-viewer frame (a different
	// extension). allFrames injection aborts wholesale on it, so frame
	// execution must fall back to the frames Onhand can actually script.
	assert.match(backgroundSource, /function executeScriptInFramesWithFallback/, "frame execution should fall back when a foreign-extension frame blocks allFrames injection");
	assert.match(backgroundSource, /function isInjectableFrameUrl/, "frame fallback should skip frames Onhand cannot script");
	assert.match(backgroundSource, /parsed\.protocol === "file:"/, "frame fallback should include local file frames when Chrome grants file access");
	assert.match(backgroundSource, /protocol === "file:"/, "page toolkit should allow local file tabs when Chrome grants file access");
	assert.match(backgroundSource, /function executePageToolkitMethodViaScriptingFrames/, "page toolkit should be able to run annotation commands inside nested web frames");
	assert.match(backgroundSource, /function executePageToolkitMethodViaGenericWebFrames/, "page toolkit should be able to capture and clear annotations created through debugger-targeted web frames");
	assert.match(backgroundSource, /GENERIC_WEB_FRAME_PAGE_TOOLKIT_METHODS[\s\S]*"highlightText"[\s\S]*"showNote"[\s\S]*"scrollToAnnotation"/, "web-frame fallback should support highlight, note, and scroll annotation commands");
	assert.match(backgroundSource, /methodName === "clearAnnotations"[\s\S]*executePageToolkitMethodViaScriptingFrames[\s\S]*mergeClearAnnotationResults/, "clear annotations should also clear nested textbook frames");
	assert.match(backgroundSource, /methodName === "captureState"[\s\S]*executePageToolkitMethodViaGenericWebFrames/, "capture state should inspect nested textbook frames when the top page has no annotations");
	assert.match(backgroundSource, /function aggregateClearAnnotationFrameValues\(payloads,\s*method = "chrome-scripting-all-frames"\)/, "clear aggregation should label the frame mechanism that actually ran");
	assert.match(
		backgroundSource,
		/shouldAggregateGenericWebFramePageToolkit\(methodName\)[\s\S]*frameCount > 0 \|\| Number\(scriptingFramePayload\?\.clearedTotal \|\| 0\) > 0[\s\S]*executePageToolkitMethodViaGenericWebFrames/,
		"aggregate textbook-frame commands should try debugger frames when all-frames scripting finds no usable frames",
	);
	assert.ok(
		backgroundSource.indexOf("if (shouldTryGenericWebFramePageToolkit(methodName))") < backgroundSource.indexOf("{ skipScripting: true }", backgroundSource.indexOf("async function runPageToolkitMethod")),
		"page toolkit should try ordinary web frames before falling back to whole-tab debugger evaluation",
	);
	assert.match(backgroundSource, /Allow access to file URLs/, "local file access failures should tell the user which Chrome extension toggle to enable");
	assert.match(backgroundSource, /browser_navigate cannot open file:\/\/ URLs/, "browser navigation should not be able to open arbitrary local file URLs");
	assert.match(backgroundSource, /function findExistingNavigationTab\(url,\s*windowId\)/, "new-tab navigation should look for an already-open matching URL first");
	assert.ok(
		backgroundSource.indexOf("const existingTab = await findExistingNavigationTab(args.url, windowId);") <
			backgroundSource.indexOf("const createdTab = await chrome.tabs.create", backgroundSource.indexOf("async function navigateBrowser")),
		"browser_navigate with newTab should reuse an existing distinct URL tab before creating another tab",
	);
	assert.match(backgroundSource, /href: element instanceof HTMLAnchorElement \? element\.href \|\| null : null/, "element search should expose resolved link hrefs for navigation");
	assert.match(backgroundSource, /isRestrictedScriptingError\(error\)/, "frame fallback should only engage on a restricted-scripting error");
	// A restricted main-frame error on a PDF tab (native viewer is a different
	// extension) must not abort before trying Onhand's inline viewer frame.
	assert.match(
		backgroundSource,
		/isRestrictedScriptingError\(scriptError\) &&\s*!isOwnExtensionPdfViewerUrl\(tab\?\.url\) &&\s*!shouldTryOnhandPdfViewerFrameForTab\(tab\)/,
		"page toolkit should try the PDF viewer frame before giving up on a restricted main-frame error",
	);
	assert.ok(
		backgroundSource.indexOf("if (mainFrameScriptingRestricted)") < backgroundSource.indexOf("{ skipScripting: true }", backgroundSource.indexOf("async function runPageToolkitMethod")),
		"page toolkit should not fall through to the whole-tab debugger fallback after a restricted main-frame scripting error",
	);
	assert.match(backgroundSource, /function inferInitialPdfViewerPageNumber/, "PDF handoff should infer the current page before opening Onhand's viewer");
	assert.match(backgroundSource, /function inferPdfPageNumberFromNativeChromePdfViewerFrame/, "PDF handoff should read Chrome's native PDF viewer frame for the current page");
	assert.match(backgroundSource, /function inferPdfPageNumberFromDebuggerDefaultContext/, "PDF handoff should fall back to the debugger default context for native PDF pages");
	assert.match(backgroundSource, /function inferPdfPageNumberFromDebuggerDom/, "PDF handoff should inspect Chrome's native PDF viewer DOM controls for the current page");
	assert.match(backgroundSource, /function evaluateInMatchingDebuggerFrame/, "PDF handoff should directly target existing PDF viewer frames");
	assert.match(backgroundSource, /Page\.createIsolatedWorld/, "PDF handoff should evaluate in already-created Chrome PDF viewer frames");
	assert.match(backgroundSource, /DOM\.getFlattenedDocument/, "PDF handoff should pierce Chrome PDF viewer DOM controls when page runtime probes fail");
	assert.match(backgroundSource, /DOM\.resolveNode/, "PDF handoff should read live page-number input values from debugger DOM nodes");
	assert.match(backgroundSource, /frameOrContextLooksLikeNativeChromePdfViewer/, "PDF handoff should locate Chrome's built-in PDF viewer runtime context");
	assert.match(backgroundSource, /viewer-page-selector input/, "PDF handoff should inspect Chrome PDF viewer shadow-DOM page controls");
	assert.match(backgroundSource, /Accessibility\.getFullAXTree/, "PDF handoff should use the accessibility tree to infer native Chrome PDF page controls");
	assert.match(backgroundSource, /\/tab\/i\.test\(role\)/, "PDF handoff should accept Chrome PDF selected thumbnail tabs with numeric names");
	assert.ok(
		backgroundSource.indexOf("'viewer-page-selector input'") < backgroundSource.indexOf('"native-pdf-viewer-property"'),
		"PDF handoff should prefer visible Chrome PDF page controls over stale viewer properties",
	);
	assert.match(backgroundSource, /Page\.getFrameTree/, "PDF handoff should inspect child frames for Chrome's native PDF viewer controls");
	assert.match(backgroundSource, /chrome-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai\//, "PDF handoff should prefer Chrome's native PDF viewer frame");
	assert.match(backgroundSource, /chrome\.runtime\.getURL\(""\)/, "PDF handoff should avoid reading stale Onhand viewer frames when inferring the source PDF page");
	assert.match(backgroundSource, /function resolveInlineOnhandPdfViewerSourceUrl/, "inline PDF viewer bridge calls should resolve the source URL from the installed viewer");
	assert.match(backgroundSource, /data-onhand-pdf-url/, "inline PDF viewer bridge calls should prefer the viewer's own source URL over a normalized PDF tab URL");
	assert.match(
		backgroundSource,
		/callOnhandPdfViewerFrameViaBridge[\s\S]*await resolveInlineOnhandPdfViewerSourceUrl/,
		"inline PDF viewer postMessage bridge should use the installed viewer source URL for token lookup",
	);
	assert.match(
		backgroundSource,
		/callOnhandPdfViewerFrameViaRuntimePort[\s\S]*await resolveInlineOnhandPdfViewerSourceUrl/,
		"inline PDF viewer runtime port should use the installed viewer source URL for port lookup",
	);
	assert.match(backgroundSource, /for \(const entry of readableFrameEntries\)[\s\S]*return await readTree\(\);/, "PDF handoff should read PDF viewer frames before falling back to the whole-tab accessibility tree");
	assert.doesNotMatch(backgroundSource, /frameEntries\s*\.\s*slice\(1\)/, "PDF handoff should not skip the top frame when it may be Chrome's native PDF viewer");
	assert.match(backgroundSource, /function getNativeChromePdfViewerSelectionForHandoff/, "PDF handoff should capture selected text from Chrome's native PDF viewer before opening Onhand's viewer");
	assert.match(backgroundSource, /function getGoogleScholarReaderSelectionForHandoff/, "PDF handoff should capture selected text from Google Scholar PDF Reader before opening Onhand's viewer");
	assert.match(backgroundSource, /function getGoogleScholarReaderSelectionExpression/, "Google Scholar PDF Reader selected text should have a debugger-target expression");
	assert.match(backgroundSource, /function maybeGetBrowserClipboardPdfSelection/, "PDF handoff should have a browser-level selected-text clipboard fallback");
	assert.match(backgroundSource, /function getDebuggerPageTargetForTab/, "PDF selected-text clipboard fallback should resolve the tab's page debugger target");
	assert.match(backgroundSource, /Input\.dispatchKeyEvent[\s\S]*code:\s*"KeyC"/, "PDF selected-text clipboard fallback should dispatch the copy shortcut to the active PDF tab");
	assert.match(backgroundSource, /function getPdfSelectionForViewerHandoff/, "PDF handoff should capture selected text from the current PDF reader before opening Onhand's viewer");
	assert.match(
		backgroundSource,
		/getPdfSelectionForViewerHandoff\(sourceTab,\s*pdfUrl\)[\s\S]*PDF_SELECTION_HANDOFF_TIMEOUT_MS/,
		"PDF handoff should time-bound selected-text capture so Open PDF cannot hang indefinitely",
	);
	assert.match(
		backgroundSource,
		/getPdfSelectionForViewerHandoff[\s\S]*runPageToolkitMethod\(tab\.id,\s*"getSelectionInfo"\)[\s\S]*getGoogleScholarReaderSelectionForHandoff[\s\S]*getNativeChromePdfViewerSelectionForHandoff[\s\S]*maybeGetBrowserClipboardPdfSelection[\s\S]*maybeGetDebuggerFrameSelection/,
		"PDF handoff should try reader selections before native and debugger-frame fallbacks",
	);
	assert.match(backgroundSource, /function transferPdfSelectionToOnhandViewer/, "PDF handoff should transfer selected PDF text into Onhand's viewer");
	assert.ok(
		backgroundSource.indexOf("inferPdfPageNumberFromNativeChromePdfViewerFrame(tab.id)") <
			backgroundSource.indexOf("inferPdfPageNumberFromDebuggerDefaultContext(tab.id)"),
		"PDF handoff should try the matched native PDF frame before the debugger default context",
	);
	assert.ok(
		backgroundSource.indexOf("inferPdfPageNumberFromDebuggerDefaultContext(tab.id)") <
			backgroundSource.indexOf("inferPdfPageNumberFromDebuggerDom(tab.id)"),
		"PDF handoff should try runtime controls before debugger DOM controls",
	);
	assert.ok(
		backgroundSource.indexOf("inferPdfPageNumberFromDebuggerDom(tab.id)") <
			backgroundSource.indexOf("inferPdfPageNumberFromAccessibilityTree(tab.id)"),
		"PDF handoff should try debugger DOM controls before accessibility fallbacks",
	);
	assert.ok(
		backgroundSource.indexOf("inferPdfPageNumberFromAccessibilityTree(tab.id)") <
			backgroundSource.indexOf("inferPdfPageNumberFromTabDom(tab.id)"),
		"PDF handoff should prefer Chrome's native PDF page number before DOM fallbacks",
	);
	assert.match(backgroundSource, /installInlineOnhandPdfViewer\(finalTab\.id,\s*pdfUrl,\s*viewerOptions\)/, "Inline PDF handoff should pass the inferred page into the viewer URL");
	assert.match(
		backgroundSource,
		/frame && frame\.getAttribute\("src"\) === targetViewerUrl[\s\S]*frame\.remove\(\)/,
		"a failed inline PDF viewer should be recreated when the next handoff retries the same URL",
	);
	assert.match(backgroundSource, /function runPdfPageLocationDetector/, "PDF handoff should record per-detector page inference diagnostics");
	assert.match(backgroundSource, /PDF page detector timed out: \$\{label\}/, "PDF page inference detectors should be time-bounded");
	assert.match(backgroundSource, /pageLocationDiagnostics:\s*diagnostics/, "PDF handoff results should include page-location diagnostics when requested");
	assert.match(
		backgroundSource,
		/existingPageNumber !== initialPageNumber[\s\S]*Reusing inline Onhand PDF viewer without reload; requested page differs/,
		"Inline PDF handoff should preserve an existing viewer when the source reader reports a different page",
	);
	assert.match(
		backgroundSource,
		/initialSelectionHandoff\?\.pageNumber[\s\S]*source:\s*`\$\{initialSelectionHandoff\.source[\s\S]*:selection`[\s\S]*inferInitialPdfViewerPageLocation/,
		"PDF handoff should use the selected native PDF page before generic page inference",
	);
	assert.match(
		backgroundSource,
		/executePageToolkitMethodViaOnhandPdfViewerFrame\(tabId,\s*"highlightText"[\s\S]*pdfAnchor:\s*handoffSelection\.pdfAnchor[\s\S]*scrollIntoView:\s*true/,
		"PDF handoff should highlight the transferred selection inside Onhand's PDF viewer",
	);
	assert.match(
		backgroundSource,
		/function safeWaitForInlineOnhandPdfViewerReady[\s\S]*pdfViewerReadyFailure/,
		"Inline PDF handoff should report viewer-ready failures instead of aborting the open command",
	);
	assert.match(backgroundSource, /function loadAuthorizedPdfBytesFromTab/, "protected PDF handoff should have a browser-context byte fallback");
	assert.match(
		backgroundSource,
		/Network\.loadNetworkResource[\s\S]*includeCredentials:\s*true/,
		"protected PDF fallback should load through the authenticated source tab instead of hardcoded site logic",
	);
	assert.match(
		backgroundSource,
		/trustedSourceUrl[\s\S]*stripUrlHash\(trustedSourceUrl\) !== stripUrlHash\(pdfUrl\)/,
		"protected PDF fallback should stay bound to the exact viewer tab and source URL",
	);
	assert.match(backgroundSource, /looksLikePdfBytes/, "protected PDF fallback should reject login pages and other non-PDF responses");
	const pdfViewerSource = await readFile(join(PROJECT_ROOT, "packages/browser-extension/src/pdf-viewer.ts"), "utf8");
	assert.match(
		pdfViewerSource,
		/pdf-viewer:load-authorized-source/,
		"the PDF viewer should request a browser-context fallback only after its credentialed load fails",
	);
	assert.match(
		backgroundSource,
		/getSelectionHandoffResult[\s\S]*transferPdfSelectionToOnhandViewer\(tabId,\s*initialSelectionHandoff,\s*pdfUrl\)[\s\S]*safeWaitForInlineOnhandPdfViewerReady\(finalTab\.id,\s*timeoutMs,\s*pdfUrl\)[\s\S]*getSelectionHandoffResult\(finalTab\.id\)/,
		"Inline PDF handoff should transfer selection through the safe handoff helper after viewer readiness",
	);
	assert.match(
		backgroundSource,
		/No selected PDF text could be captured before opening the Onhand viewer[\s\S]*getSelectionHandoffResult[\s\S]*initialSelectionHandoffFailure/,
		"PDF viewer open should report an explicit failed selection handoff when capture was attempted but no selected text was available",
	);
	assert.match(backgroundSource, /tabId: typeof message\.tabId === "number"/, "Sidebar PDF handoff should preserve the current page tab id");
	assert.match(backgroundSource, /forceReload:\s*true[\s\S]*includeDiagnostics:\s*true/, "Sidebar Open PDF should force a real refresh and request diagnostics");
	assert.match(
		backgroundSource,
		/REALTIME_BROWSER_TOOL_COMMANDS[\s\S]*browser_pdf_capture_page_image:\s*"pdf_capture_page_image"[\s\S]*browser_pdf_find_citation:\s*"pdf_find_citation"/,
		"Realtime browser bridge should expose PDF page image capture and citation lookup",
	);
	assert.match(
		backgroundSource,
		/new Set\(\["pdf_search", "pdf_read_pages", "pdf_jump_to_page", "pdf_capture_page_image", "pdf_find_citation"\]\)/,
		"Realtime PDF bridge should allow search, read, jump, image capture, and citation lookup",
	);
}

async function assertPdfViewerShowNoteKeepsExpandedLayoutOrder() {
	const source = await readFile(join(PROJECT_ROOT, "packages/browser-extension/src/pdf-viewer.ts"), "utf8");
	const htmlSource = await readFile(join(PROJECT_ROOT, "packages/browser-extension/pdf-viewer.html"), "utf8");
	const start = source.indexOf("async function pdfShowNote");
	const end = source.indexOf("\nasync function pdfScrollToAnnotation", start);
	assert.notEqual(start, -1, "pdfShowNote declaration not found");
	assert.notEqual(end, -1, "pdfShowNote end marker not found");
	const body = source.slice(start, end);
	const collapseResetIndex = body.indexOf("setPdfNoteCollapsed(note, false);");
	const positionIndex = body.indexOf("positionPdfNote(note, annotation, page);");
	assert.notEqual(collapseResetIndex, -1, "pdfShowNote should explicitly normalize the expanded note state");
	assert.notEqual(positionIndex, -1, "pdfShowNote should position the PDF note");
	assert.ok(
		collapseResetIndex < positionIndex,
		"pdfShowNote must clear collapsed note styles before positioning; doing it after positioning removes the expanded layout",
	);
	assert.match(source, /setImportantStyle\(note,\s*"min-height",\s*"30px"\)/, "collapsed PDF viewer notes should constrain their minimum height");
	assert.match(source, /"min-height":\s*"76px"/, "expanded PDF viewer notes should have a minimum height on first render");
	assert.match(source, /PDF_VIEWER_ANNOTATION_THEME\s*=\s*"light"/, "PDF viewer annotations should pin to the viewer light palette");
	assert.match(source, /note\.setAttribute\("data-onhand-theme",\s*PDF_VIEWER_ANNOTATION_THEME\)/, "PDF viewer notes should resist shared dark annotation CSS");
	assert.match(source, /highlight\.style\.setProperty\("background",\s*"transparent",\s*"important"\)/, "PDF viewer highlight containers should not paint the full union rectangle");
	assert.match(source, /setImportantStyles\(note,[\s\S]*?position:\s*"absolute"/, "PDF viewer notes should override shared page-note positioning CSS");
	// Two cards stacking on the same spot, or a highlight painting over a
	// card, both make the note unreadable until dismissed. Cards must avoid
	// other cards when positioning and sit above highlights in the layer.
	assert.match(source, /function collectOtherPdfNoteRects/, "PDF viewer should gather other note rects so cards do not stack");
	assert.match(source, /choosePdfNotePosition\([\s\S]*?otherNoteRects\)/, "PDF note positioning should avoid other placed notes");
	assert.match(source, /noteOverlap\s*\*\s*\d+/, "PDF note scoring should penalize overlapping another note");
	assert.ok(
		source.indexOf('zIndex: "1"') !== -1 && source.indexOf('"z-index": "4"') !== -1,
		"PDF highlights (z-index 1) must sit below note cards (z-index 4) in the shared annotation layer",
	);
	assert.match(source, /function getPageLayoutSize/, "PDF viewer highlights should have a layout coordinate helper for scaled pages");
	assert.match(source, /function rangeRectsForPage[\s\S]*getPageLayoutSize/, "PDF viewer highlight rects should convert viewport rects into page layout coordinates");
	// Robust anchoring: highlights capture surrounding context and re-find by
	// it (disambiguating repeated text and surviving occurrence drift) rather
	// than blindly trusting the Nth-occurrence number.
	assert.match(source, /function findMappedTextRange\(root: Element, query: string, occurrence = 1, context\?/, "PDF re-find should accept stored anchor context");
	assert.match(source, /function scoreContextAt/, "PDF re-find should score candidate positions by stored prefix/suffix context");
	assert.match(source, /function pickMatchIndex/, "PDF re-find should pick the occurrence whose context matches best");
	assert.match(source, /function extractNormalizedContext/, "PDF highlights should capture surrounding context for the anchor");
	assert.match(source, /findMappedTextRange\(textLayer, rawQuery, occurrence, options\.pdfAnchor\?\.textQuote\)/, "PDF highlight should pass the stored anchor context into re-finding");
	assert.match(source, /textQuote: \{\s*exact: match\.matchedText,\s*\.\.\.\(match\.context\?\.prefix/, "PDF anchor should persist prefix/suffix context in textQuote");
	// Robustness fixes from adversarial review:
	assert.match(source, /for \(const char of normalized\) \{\s*text \+= char;\s*positions\.push/, "normalized text map must push one position per emitted char (NFKC ligature expansion)");
	assert.match(source, /MIN_CONTEXT_SCORE/, "context disambiguation should require a minimum agreement before overriding occurrence");
	assert.match(source, /tied\.length === 1 \? tied\[0\] : tied\[/, "tied context scores should break by stored occurrence, not pick the first");
	assert.match(source, /for \(const prefixIndex of collectMatchIndices\(compactText, compactPrefix\)\)/, "context recovery should consider every prefix occurrence, not just the first");
	assert.match(source, /function textSegmentRectsForPage/, "PDF viewer highlights should compute text-span segment rects for partial PDF text matches");
	assert.match(source, /function rangeRectsForPage[\s\S]*textSegmentRectsForPage/, "PDF viewer highlights should prefer text-span segment rects before browser range rects");
	assert.match(source, /function clampPdfRectToPageSize/, "PDF viewer highlight rects should be clamped to page bounds before rendering");
	assert.match(source, /function makePdfHighlightPassive/, "PDF viewer highlights should have a shared passive-overlay helper");
	assert.match(source, /pointerEvents:\s*"none"/, "PDF viewer highlight containers should not intercept text selection or clicks");
	assert.doesNotMatch(source, /annotation\.setAttribute\("role",\s*"button"\)/, "PDF viewer highlights should not become note trigger buttons");
	assert.match(htmlSource, /--scale-factor:\s*1/, "PDF viewer text layer should define a default PDF.js scale factor");
	assert.match(source, /viewer\.style\.setProperty\("--scale-factor",\s*String\(committedScale\)\)/, "PDF viewer should set the PDF.js scale factor on the viewer to match the committed canvas scale");
	assert.match(source, /options\.reuseExisting === true/, "PDF viewer highlight replay should honor reuseExisting");
	assert.match(source, /findExistingPdfHighlight/, "PDF viewer highlight replay should find existing PDF annotations before creating new ones");
	assert.match(source, /removeDuplicatePdfHighlights/, "PDF viewer highlight replay should consolidate duplicate saved-artifact overlays");
	assert.match(source, /function pdfSearch/, "PDF viewer should expose full-document text search");
	assert.match(source, /for \(const page of pages\)/, "PDF search should inspect every PDF page instead of stopping at the returned-snippet limit");
	assert.doesNotMatch(source, /if \(matches\.length >= maxMatches\) break;/, "PDF search must not stop document coverage when its snippet limit is reached");
	assert.match(source, /searchedAllPages/, "PDF search should report whether full-page coverage completed");
	assert.match(source, /failedPageNumbers/, "PDF search should disclose pages whose text could not be searched");
	assert.match(source, /totalMatchCount/, "PDF search should count omitted matches separately from returned snippets");
	assert.match(source, /function pdfReadPages/, "PDF viewer should expose page-specific text reads");
	assert.match(source, /function pdfJumpToPage/, "PDF viewer should expose page navigation for found PDF matches");
	assert.match(source, /function pdfCapturePageImage/, "PDF viewer should expose page image capture for visual PDF grounding");
	assert.match(source, /function pdfGetSelectionInfo\(\)/, "Onhand PDF viewer should expose a real selected-text reader");
	assert.match(source, /window\.getSelection\(\)/, "Onhand PDF viewer selected-text reader should inspect the current browser selection");
	assert.match(source, /function buildPdfAnchorForSelection/, "Onhand PDF viewer selected text should retain a PDF anchor for highlight/note follow-up");
	assert.match(source, /const DEFAULT_SCALE = 1;/, "PDF viewer should not default to an over-zoomed fixed scale");
	assert.match(source, /function computeFitScale/, "PDF viewer should calculate an initial fit scale from the rendered viewport");
	assert.match(source, /function parseInitialPageNumber/, "PDF viewer should read an initial page from the viewer URL");
	assert.match(source, /scrollToPage\(initialPageNumber\)/, "PDF viewer should scroll to the requested initial page after rendering");
	assert.match(source, /function updateViewerPageUrl/, "PDF viewer should keep the current page in the viewer URL");
	assert.match(source, /function capturePdfViewSnapshot/, "PDF viewer should snapshot page position and annotations before re-rendering");
	assert.match(source, /function restorePdfViewSnapshot/, "PDF viewer should restore page position and annotations after re-rendering");
	assert.match(source, /window\.addEventListener\("resize",\s*scheduleResizeRender/, "PDF viewer should handle resize without resetting the document");
	assert.match(source, /anchor = captureZoomAnchor\(\)/, "PDF viewer zoom re-renders should anchor the current view before rescaling");
	assert.match(source, /const annotations = capturePdfAnnotationSnapshots\(\)/, "PDF viewer zoom re-renders should snapshot annotations before rebuilding layers");
	assert.match(source, /rebuildPdfAnnotationLayers\(annotations, sequence\)/, "PDF viewer zoom re-renders should restore annotations after the re-render");
	assert.match(source, /function describePdfTextLayer/, "the viewer must diagnose missing text layers instead of reporting bare no-match results");
	assert.match(source, /likelyScanned: extractableChars < 40/, "scan detection should key on near-zero extractable text");
	assert.match(source, /function pdfHighlightRegion/, "scanned pages need region marks (behavior doc §3.13)");
	assert.match(source, /This page has extractable text; anchor with an exact text quote instead of a region\./, "region marks must be refused on text pages so citations stay verifiable");
	assert.match(source, /if \(regionRect\) return await pdfHighlightRegion\(rawQuery, regionRect, options\);/, "region anchors must replay through the normal highlight path for zoom rebuilds and restores");
	assert.match(source, /case "searchPdf":/, "PDF toolkit bridge should route full-document search");
	assert.match(source, /case "readPdfPages":/, "PDF toolkit bridge should route page text reads");
	assert.match(source, /case "getSelectionInfo":\s*return pdfGetSelectionInfo\(\);/, "PDF toolkit bridge should route selected-text reads");
	assert.doesNotMatch(source, /case "getSelectionInfo":\s*return\s*\{\s*hasSelection:\s*false,\s*text:\s*""/, "PDF toolkit bridge must not hard-code selected text as empty");
	assert.doesNotMatch(source, /parentBridgeToken/, "PDF viewer bridge must not trust a token supplied by an embedding page");
	assert.match(source, /const expectedToken = await getBridgeToken\(\)/, "PDF viewer bridge commands should authorize against the session-stored token");
	assert.match(source, /commandSourceUrl !== sourceUrl/, "PDF viewer bridge commands should be scoped to the loaded PDF URL");
}

async function assertNativeChromePdfViewerSelectionFallback() {
	const source = await readFile(join(PROJECT_ROOT, "packages/browser-extension/background.js"), "utf8");
	assert.match(source, /function getNativeChromePdfViewerSelectionExpression\(\)/, "Native Chrome PDF selected text should have a debugger expression");
	assert.match(source, /source:\s*"native-chrome-pdf-viewer-selection"/, "Native Chrome PDF selection fallback should identify its source");
	assert.match(source, /function maybeGetNativeChromePdfViewerSelection\(tab,\s*currentSelection\)/, "browser_get_selection should have a native PDF empty-selection fallback");
	assert.match(source, /function maybeGetGoogleScholarReaderSelection\(tab,\s*currentSelection\)/, "browser_get_selection should have a Google Scholar PDF Reader target-selection fallback");
	assert.match(source, /function detectGoogleScholarReaderSurface\(tab\s*=\s*null\)/, "browser_get_selection should detect Google Scholar PDF Reader before falling back to native-PDF wording");
	assert.match(source, /function markGoogleScholarReaderSelectionSurface\(currentSelection,\s*readerSurface\s*=\s*null/, "blocked Google Scholar selections should preserve the Google Scholar reader label");
	assert.match(source, /viewer:\s*"google-scholar"[\s\S]*readerName:\s*"Google Scholar PDF Reader"/, "Google Scholar reader detection should surface a model-visible reader label");
	assert.match(source, /function maybeGetBrowserClipboardPdfSelection\(tab,\s*currentSelection\)/, "browser_get_selection should have a browser-level PDF clipboard selection fallback");
	assert.match(source, /function getGoogleScholarReaderPageExpression\(\)/, "Google Scholar PDF Reader should expose a page-only detector for viewer handoff");
	assert.match(source, /function inferPdfPageNumberFromGoogleScholarReaderTarget\(tab\)/, "PDF viewer handoff should infer the current page from Google Scholar Reader");
	assert.match(source, /function inferPdfPageNumberFromGoogleScholarReaderFrame\(tabId\)/, "PDF viewer handoff should infer the current page from an embedded Google Scholar Reader frame");
	assert.match(source, /function inferPdfPageNumberFromGoogleScholarReaderContexts\(tabId\)/, "PDF viewer handoff should infer the current page from non-Onhand debugger contexts");
	assert.match(source, /function inferPdfPageFractionFromDebuggerDomDetails\(details\)/, "PDF viewer handoff should detect unlabeled debugger DOM page fractions");
	assert.match(
		source,
		/fallbackReaders = \[[\s\S]*label:\s*"google-scholar-target"[\s\S]*inferPdfPageNumberFromGoogleScholarReaderTarget\(tab\)[\s\S]*label:\s*"google-scholar-frame"[\s\S]*inferPdfPageNumberFromGoogleScholarReaderFrame\(tab\.id\)[\s\S]*label:\s*"google-scholar-contexts"[\s\S]*inferPdfPageNumberFromGoogleScholarReaderContexts\(tab\.id\)[\s\S]*label:\s*"native-chrome-target"[\s\S]*inferPdfPageNumberFromNativeChromePdfViewerTarget/,
		"PDF viewer handoff should try Google Scholar Reader page detection before generic PDF fallbacks, including embedded reader frames and contexts",
	);
	assert.match(
		source,
		/focusTab\(tab\.id\)[\s\S]*dispatchCopyShortcutToTab\(tab\)[\s\S]*readTextFromFocusedBrowserClipboard\(tab\)/,
		"browser-level PDF copy fallback should focus the source tab, send Copy, then read from the focused browser target",
	);
	assert.match(
		source,
		/case "get_selection":\s*{[\s\S]*runPageToolkitMethod\(tab\.id,\s*"getSelectionInfo"\)[\s\S]*maybeGetGoogleScholarReaderSelection\(tab,\s*pageSelection\)[\s\S]*maybeGetNativeChromePdfViewerSelection\(tab,\s*selection\)[\s\S]*maybeGetBrowserClipboardPdfSelection\(tab,\s*selection\)/,
		"browser_get_selection should retry Google Scholar and native PDF frames when the page toolkit cannot see selected PDF text",
	);
	assert.match(
		source,
		/catch \(error\) \{[\s\S]*isRestrictedScriptingError\(error\)[\s\S]*isLikelyNativeChromePdfSelectionTab\(tab\)[\s\S]*native-chrome-pdf-viewer-restricted-main-frame/,
		"browser_get_selection should still try native PDF selection when main-frame scripting is restricted",
	);
	assert.match(source, /function getDebuggerFrameSelectionExpression\(\)/, "Cross-frame selected text should have a debugger expression");
	assert.match(source, /source:\s*"debugger-frame-selection"/, "Cross-frame selected text fallback should identify its source");
	assert.match(source, /function maybeGetDebuggerFrameSelection\(tab,\s*currentSelection\)/, "browser_get_selection should have a generic frame selected-text fallback");
	assert.match(
		source,
		/case "get_selection":\s*{[\s\S]*maybeGetGoogleScholarReaderSelection\(tab,\s*pageSelection\)[\s\S]*maybeGetNativeChromePdfViewerSelection\(tab,\s*selection\)[\s\S]*maybeGetBrowserClipboardPdfSelection\(tab,\s*selection\)[\s\S]*maybeGetDebuggerFrameSelection\(tab,\s*selection\)/,
		"browser_get_selection should retry debugger frame contexts when normal selection readers are empty",
	);
}

async function assertVisibleRegionCaptureFallsBackWhenDomIsRestricted() {
	const source = await readFile(join(PROJECT_ROOT, "packages/browser-extension/background.js"), "utf8");
	const manifest = JSON.parse(await readFile(join(PROJECT_ROOT, "packages/browser-extension/manifest.json"), "utf8"));
	assert.ok(manifest.permissions.includes("activeTab"), "visible-region capture should be allowed after the user activates Onhand");
	assert.match(source, /browser_get_visible_region_image:\s*"get_visible_region_image"/, "visible-region capture should be whitelisted for realtime browser tools");
	assert.match(source, /function getVisibleRegionViewportFallback\(focusedTab,\s*scriptError\s*=\s*null\)/, "visible-region capture should have a non-DOM viewport fallback");
	assert.match(
		source,
		/catch \(error\) \{[\s\S]*getVisibleRegionViewportFallback\(focusedTab,\s*error\)/,
		"visible-region capture should fall back when page DOM access is restricted",
	);
	assert.match(source, /source:\s*"debugger-layout"/, "visible-region fallback should try debugger layout metrics");
	assert.match(source, /source:\s*"window-approximation"/, "visible-region fallback should still return a capture target if debugger layout is unavailable");
	assert.match(source, /viewportScriptError/, "visible-region fallback should surface the page-script failure in metadata");
}

async function assertGoogleDocsReadableContentUsesTextExport() {
	const declaration = await loadBackgroundFunction("extractReadableContentInPage");
	const dom = new JSDOM(
		`
		<!doctype html>
		<html>
			<head><title>heyclicky vision - Google Docs</title></head>
			<body>
				<main>
					<div role="toolbar">File Edit View Tools Help</div>
					<div>Google Docs side panel and toolbar text should not become document content.</div>
				</main>
			</body>
		</html>
		`,
		{
			url: GOOGLE_DOCS_FIXTURE_EDIT_URL,
			pretendToBeVisual: true,
			runScripts: "outside-only",
		},
	);
	const requestedUrls = [];
	dom.window.fetch = async (url, options = {}) => {
		requestedUrls.push({ url: String(url), credentials: options.credentials, cache: options.cache });
		return {
			ok: true,
			status: 200,
			headers: {
				get(name) {
					return String(name || "").toLowerCase() === "content-type" ? "text/plain; charset=utf-8" : "";
				},
			},
			async text() {
				return [
					"My name is Farza.",
					"",
					"I am going all-in on building a new interface for computers.",
					"",
					"My first major swing is heyclicky, a simple AI buddy that lives on your Mac.",
				].join("\n");
			},
		};
	};
	const extractReadableContentInPage = dom.window.eval(`(${declaration})`);
	const content = await extractReadableContentInPage({ maxChars: 2000 });

	assert.equal(content.surface, "google-docs");
	assert.equal(content.source, "google-docs-export");
	assert.equal(content.blockCount, 3);
	assert.match(content.text, /My name is Farza/);
	assert.match(content.text, /new interface for computers/);
	assert.doesNotMatch(content.text, /Google Docs side panel/);
	assert.equal(requestedUrls.length, 1);
	assert.match(requestedUrls[0].url, GOOGLE_DOCS_FIXTURE_TEXT_EXPORT_PATTERN);
	assert.equal(requestedUrls[0].credentials, "include");
	assert.equal(requestedUrls[0].cache, "no-store");
}

async function assertGoogleDocsReadableContentDoesNotFallbackToToolbarOnExportFailure() {
	const declaration = await loadBackgroundFunction("extractReadableContentInPage");
	const dom = new JSDOM(
		`
		<!doctype html>
		<html>
			<head><title>Restricted Doc - Google Docs</title></head>
			<body>
				<main>
					<p>File Edit View Tools Help Share Request edit access</p>
				</main>
			</body>
		</html>
		`,
		{
			url: "https://docs.google.com/document/d/restricted-doc/edit",
			pretendToBeVisual: true,
			runScripts: "outside-only",
		},
	);
	dom.window.fetch = async () => ({
		ok: false,
		status: 403,
		headers: { get: () => "text/plain" },
		async text() {
			return "";
		},
	});
	const extractReadableContentInPage = dom.window.eval(`(${declaration})`);
	const content = await extractReadableContentInPage({ maxChars: 2000 });

	assert.equal(content.surface, "google-docs");
	assert.equal(content.unsupported, true);
	assert.match(content.text, /Could not export this Google Doc as text \(403\)/);
	assert.doesNotMatch(content.text, /File Edit View/);
}

async function assertReadableContentChoosesFullRootAndIncludesTables() {
	const declaration = await loadBackgroundFunction("extractReadableContentInPage");
	const longPrefix = Array.from(
		{ length: 90 },
		(_, index) => `<p>Early filler paragraph ${index + 1} about tokenization, self-attention, and unrelated notebook setup.</p>`,
	).join("\n");
	const dom = new JSDOM(
		`
		<!doctype html>
		<html>
			<head><title>Transformer notes</title></head>
			<body>
				<main id="first-fragment">
					<h1>1. Intro</h1>
					<p>Only the first visible fragment appears here.</p>
				</main>
				<main id="full-notes">
					<h1>1. Intro</h1>
					<p>Only the first visible fragment appears here.</p>
					${longPrefix}
					<h2>Parameter Count Example (Qwen 3.5)</h2>
					<table>
						<thead>
							<tr><th>Tensor</th><th>Shape</th><th># Params</th><th>% Layer</th></tr>
						</thead>
						<tbody>
							<tr><td>blk.4.ffn_down_exps.weight</td><td>256×3072×1024</td><td>805.306 M</td><td>32.0%</td></tr>
							<tr><td>blk.4.ffn_gate_exps.weight</td><td>256×1024×3072</td><td>805.306 M</td><td>32.0%</td></tr>
							<tr><td>blk.4.ffn_up_exps.weight</td><td>256×1024×3072</td><td>805.306 M</td><td>32.0%</td></tr>
						</tbody>
					</table>
				</main>
			</body>
		</html>
		`,
		{
			url: "https://example.test/transformers_part1.html",
			pretendToBeVisual: true,
			runScripts: "outside-only",
		},
	);
	Object.defineProperty(dom.window.Element.prototype, "getBoundingClientRect", {
		configurable: true,
		value() {
			return {
				x: 0,
				y: 0,
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				width: 0,
				height: 0,
				toJSON() {
					return { x: this.x, y: this.y, top: this.top, left: this.left, right: this.right, bottom: this.bottom, width: this.width, height: this.height };
				},
			};
		},
	});
	const extractReadableContentInPage = dom.window.eval(`(${declaration})`);
	const content = await extractReadableContentInPage({ maxChars: 2000, query: "Qwen tensors 32.0% layer parameters" });

	assert.match(content.headingOutlineMarkdown, /Parameter Count Example \(Qwen 3\.5\)/);
	assert.match(content.headingOutlineMarkdown, /blk\.4\.ffn_down_exps\.weight/);
	assert.match(content.markdown, /blk\.4\.ffn_down_exps\.weight/);
	assert.match(content.markdown, /blk\.4\.ffn_gate_exps\.weight/);
	assert.match(content.markdown, /blk\.4\.ffn_up_exps\.weight/);
	assert.match(content.markdown, /32\.0%/);
}

async function assertReadableContentMatchesHighlightableSurface() {
	// Everything readable extraction emits must be anchorable by highlightText:
	// no hidden-dialog headings, no tooltip text, no chrome outside the semantic
	// root, no nested-list glue, no heading anchor glyphs.
	const declaration = await loadBackgroundFunction("extractReadableContentInPage");
	const filler = Array.from({ length: 8 }, (_, index) => `<p>Body paragraph ${index + 1} explains the topic with enough prose to make the main region clearly dominant.</p>`).join("\n");
	const dom = new JSDOM(
		`
		<!doctype html>
		<html>
			<head><title>Article</title></head>
			<body>
				<div id="site-banner"><p>Official notice: this banner text lives outside the main content region.</p></div>
				<div class="overlay"><h1 id="dialog-heading">Search everything from this hidden dialog heading</h1></div>
				<main>
					<h1>Visible article title</h1>
					<h2>Data Structures<a href="#data-structures">¶</a></h2>
					<p>Lists support appending and iteration with stable ordering guarantees.<tool-tip role="tooltip">You must hover to see this tooltip text.</tool-tip></p>
					<ul>
						<li>Browse
							<ul><li>Table of contents entry one</li><li>Archive entry two</li></ul>
						</li>
					</ul>
					${filler}
				</main>
			</body>
		</html>
		`,
		{
			url: "https://example.test/article",
			pretendToBeVisual: true,
			runScripts: "outside-only",
		},
	);
	installLayoutShims(dom.window);
	setElementRect(dom.window.document.getElementById("dialog-heading"), { left: 0, top: 0, width: 0, height: 0 });
	const extractReadableContentInPage = dom.window.eval(`(${declaration})`);
	const content = await extractReadableContentInPage({ maxChars: 6000 });

	assert.match(content.markdown, /# Visible article title/, "visible h1 should be the title block");
	assert.doesNotMatch(content.markdown, /hidden dialog heading/, "zero-rect dialog headings must not become the title");
	assert.doesNotMatch(content.markdown, /hover to see this tooltip/, "tooltip text is never rendered inside the block");
	assert.doesNotMatch(content.markdown, /banner text lives outside/, "chrome outside the semantic root should be excluded");
	assert.doesNotMatch(content.markdown, /Browse\s+Table of contents/, "nested lists must not glue into the parent item");
	assert.match(content.markdown, /- Table of contents entry one/, "nested list items should appear as their own blocks");
	assert.match(content.headingOutlineMarkdown, /Data Structures/, "section heading should be in the outline");
	assert.doesNotMatch(content.headingOutlineMarkdown, /¶/, "heading anchor glyphs must be stripped");
	assert.doesNotMatch(content.markdown, /Data Structures¶/, "heading blocks must not keep anchor glyphs");
}

async function assertReadableContentQuerySnippetsCoverDistantTerms() {
	const declaration = await loadBackgroundFunction("extractReadableContentInPage");
	const filler = Array.from({ length: 180 }, (_, index) => `neutral filler ${index}`).join(" ");
	const dom = new JSDOM(
		`
		<!doctype html>
		<html>
			<head><title>Long reader section</title></head>
			<body>
				<main>
					<h1>Long reader section</h1>
					<blockquote>Alphacase starts the first very long block. ${filler} Betacase ends the first very long block.</blockquote>
					<p>${filler} Gammacase appears in a separate later paragraph.</p>
					<p>${filler} Deltacase appears near the end of the loaded section.</p>
				</main>
			</body>
		</html>
		`,
		{
			url: "https://reader.example.test/section",
			pretendToBeVisual: true,
			runScripts: "outside-only",
		},
	);
	dom.window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
		return {
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 800,
			bottom: 20,
			width: 800,
			height: 20,
			toJSON() {
				return { x: this.x, y: this.y, top: this.top, left: this.left, right: this.right, bottom: this.bottom, width: this.width, height: this.height };
			},
		};
	};
	const extractReadableContentInPage = dom.window.eval(`(${declaration})`);
	const content = await extractReadableContentInPage({ maxChars: 2600, query: "Alphacase Betacase Gammacase Deltacase" });

	assert.match(content.markdown, /Alphacase/);
	assert.match(content.markdown, /Betacase/);
	assert.match(content.markdown, /Gammacase/);
	assert.match(content.markdown, /Deltacase/);
	assert.equal(content.markdown.length <= 2600, true);
}

async function assertTextbookReaderSearchUsesGenericSearchUi() {
	const source = await readFile(join(PROJECT_ROOT, "packages/browser-extension/background.js"), "utf8");
	assert.match(source, /const evaluationTimeoutMs = searchTimeoutMs \+ readyTimeoutMs \+ 2500/, "textbook_search should allow no-result reader searches to outlive the default script timeout");
	assert.match(source, /evaluateInTab\([\s\S]*\{\s*timeoutMs:\s*evaluationTimeoutMs\s*\}/, "textbook_search should pass a custom page-evaluation timeout");
	const declaration = await loadBackgroundFunction("searchTextbookReaderInPage");
	const dom = new JSDOM(
		`
		<!doctype html>
		<html>
			<head><title>Generic Online Reader</title></head>
			<body>
				<button id="open-search" aria-label="Search across book">Search</button>
				<button id="reader-highlights">Highlights, Notes, Bookmarks, and Flashcards</button>
				<section id="search-panel" role="search" hidden>
					<button id="close-search" aria-label="Close">Close</button>
					<label for="book-search">Search this book</label>
					<input id="book-search" type="search" placeholder="Search this book" />
					<div>Content (2)</div>
					<ul id="results"></ul>
				</section>
			</body>
		</html>
		`,
		{
			url: "https://reader.example.test/book/123",
			pretendToBeVisual: true,
			runScripts: "outside-only",
		},
	);
	dom.window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
		if (this.hasAttribute("hidden") || this.closest("[hidden]")) {
			return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
		}
		return { x: 0, y: 0, top: 0, left: 0, right: 220, bottom: 32, width: 220, height: 32 };
	};
	Object.defineProperty(dom.window.HTMLElement.prototype, "innerText", {
		configurable: true,
		get() {
			if (this.hasAttribute("hidden") || this.closest("[hidden]")) return "";
			const visibleText = (node) => {
				if (node.nodeType === dom.window.Node.TEXT_NODE) return node.nodeValue || "";
				if (!(node instanceof dom.window.HTMLElement)) return "";
				if (node.hasAttribute("hidden") || node.closest("[hidden]")) return "";
				return Array.from(node.childNodes || []).map(visibleText).join("");
			};
			return visibleText(this);
		},
	});
	const document = dom.window.document;
	const panel = document.getElementById("search-panel");
	const input = document.getElementById("book-search");
	const results = document.getElementById("results");
	document.getElementById("open-search").addEventListener("click", () => {
		panel.removeAttribute("hidden");
	});
	document.getElementById("close-search").addEventListener("click", () => {
		panel.setAttribute("hidden", "");
	});
	input.addEventListener("input", () => {
		if (!input.value.toLowerCase().includes("lochner")) return;
		results.innerHTML = `
			<li class="reader-search-result"><button>Chapter 8 Individual Rights page 497 Lochner and substantive due process</button></li>
			<li class="reader-search-result"><button>Chapter 10 Modern doctrine page 533 due process after Lochner</button></li>
		`;
		results.querySelector("button")?.addEventListener("click", () => {
			dom.window.history.pushState({}, "", "/book/123/page/497");
			document.title = "Chapter 8 Individual Rights";
		});
	});
	const searchTextbookReaderInPage = dom.window.eval(`(${declaration})`);
	const result = await searchTextbookReaderInPage({ query: "Lochner", maxResults: 4, timeoutMs: 1000 });

	assert.equal(result.ok, true);
	assert.equal(result.surface, "textbook-search");
	assert.equal(result.source, "reader-search-ui");
	assert.equal(result.capabilities.hasSearchControl, true);
	assert.equal(result.capabilities.hasSearchInput, true);
	assert.equal(result.adapter.name, "generic-textbook-reader");
	assert.match(result.searchControl.label, /Search across book/);
	assert.equal(result.resultCount >= 1, true);
	assert.equal(result.results.some((entry) => /Highlights, Notes/.test(entry.snippet || "")), false);
	assert.equal(result.results.some((entry) => /Lochner/.test(entry.snippet || "")), true);
	assert.equal(result.results.some((entry) => /page 497/i.test(entry.pageLabel || "")), true);
	assert.equal(result.capabilities.canOpenResult, true);
	assert.equal(
		result.dismissedSearchUi?.dismissed,
		true,
		`results-only searches must close the reader search panel before returning: ${JSON.stringify(result.dismissedSearchUi)}`,
	);

	const opened = await searchTextbookReaderInPage({ query: "Lochner", maxResults: 4, openResult: true, resultIndex: 1, timeoutMs: 1000 });
	assert.equal(opened.openedResult?.index, 1);
	assert.equal(opened.openedResult?.error, undefined);
	assert.match(opened.openedResult?.title || "", /Chapter/);
	assert.equal(opened.openedResult?.dismissedSearchUi?.dismissed, true, JSON.stringify(opened.openedResult?.dismissedSearchUi));

	const noResult = await searchTextbookReaderInPage({ query: "quantum llama positional hyperweaving", maxResults: 4, timeoutMs: 300, readyTimeoutMs: 300 });
	assert.equal(noResult.ok, true);
	assert.equal(noResult.resultCount, 0);
	assert.equal(noResult.results.length, 0);
}

async function loadGoogleDocsBackgroundExportHelpers(fetchImpl) {
	const functionNames = [
		"normalizeGoogleDocsExportText",
		"isGoogleDocsDocumentUrl",
		"googleDocsDocumentIdFromUrl",
		"buildGoogleDocsTextExportUrl",
		"buildGoogleDocsPdfExportUrl",
		"googleDocsTextExportUnsupportedPayload",
		"googleDocsTextExportPayloadFromText",
		"googleDocsCaptureStatePayload",
		"googleDocsVisibleTextPayloadFromExport",
		"googleDocsViewportHeadingsPayloadFromExport",
		"extractGoogleDocsTextExportForTab",
	];
	const declarations = await Promise.all(functionNames.map((functionName) => loadBackgroundFunction(functionName)));
	return new Function("fetch", `${declarations.join("\n")}\nreturn { ${functionNames.join(", ")} };`)(fetchImpl);
}

async function assertGoogleDocsBackgroundExportReadsText() {
	const requestedUrls = [];
	const helpers = await loadGoogleDocsBackgroundExportHelpers(async (url, options = {}) => {
		requestedUrls.push({ url: String(url), credentials: options.credentials, cache: options.cache, redirect: options.redirect });
		return {
			ok: true,
			status: 200,
			headers: {
				get(name) {
					return String(name || "").toLowerCase() === "content-type" ? "text/plain; charset=utf-8" : "";
				},
			},
			async text() {
				return [
					"\uFEFFMy name is Farza.",
					"",
					"I am going all-in on building a new interface for computers.",
					"",
					"My first major swing is heyclicky, a simple AI buddy that lives on your Mac.",
				].join("\n");
			},
		};
	});
	const content = await helpers.extractGoogleDocsTextExportForTab(
		{
			url: GOOGLE_DOCS_FIXTURE_EDIT_URL,
			title: "heyclicky vision - Google Docs",
		},
		{ maxChars: 2000 },
	);

	assert.equal(content.surface, "google-docs");
	assert.equal(content.source, "google-docs-export");
	assert.equal(content.blockCount, 3);
	assert.match(content.text, /^My name is Farza/);
	assert.match(content.text, /new interface for computers/);
	assert.equal(requestedUrls.length, 1);
	assert.match(requestedUrls[0].url, GOOGLE_DOCS_FIXTURE_TEXT_EXPORT_PATTERN);
	assert.equal(requestedUrls[0].credentials, "include");
	assert.equal(requestedUrls[0].cache, "no-store");
	assert.equal(requestedUrls[0].redirect, "follow");
	assert.equal(
		helpers.buildGoogleDocsPdfExportUrl(GOOGLE_DOCS_FIXTURE_EDIT_URL),
		GOOGLE_DOCS_FIXTURE_PDF_EXPORT_URL,
	);
}

async function assertGoogleDocsBackgroundExportDoesNotReturnHtml() {
	const helpers = await loadGoogleDocsBackgroundExportHelpers(async () => ({
		ok: true,
		status: 200,
		headers: { get: () => "text/html; charset=utf-8" },
		async text() {
			return "<!doctype html><html><body>Google Docs toolbar</body></html>";
		},
	}));
	const content = await helpers.extractGoogleDocsTextExportForTab(
		{
			url: "https://docs.google.com/document/d/restricted-doc/edit",
			title: "Restricted Doc - Google Docs",
		},
		{ maxChars: 2000 },
	);

	assert.equal(content.surface, "google-docs");
	assert.equal(content.unsupported, true);
	assert.match(content.text, /Google Docs returned an HTML page instead of document text/);
	assert.doesNotMatch(content.text, /toolbar/);
}

async function assertGoogleDocsBackgroundVisiblePayloadsUseExportShape() {
	const helpers = await loadGoogleDocsBackgroundExportHelpers(async () => ({
		ok: true,
		status: 200,
		headers: { get: () => "text/plain" },
		async text() {
			return [
				"My name is Farza.",
				"",
				"I am going all-in on building a new interface for computers.",
				"",
				"My first major swing is heyclicky, a simple AI buddy that lives on your Mac.",
			].join("\n");
		},
	}));
	const tab = {
		url: GOOGLE_DOCS_FIXTURE_EDIT_URL,
		title: "heyclicky vision - Google Docs",
	};
	const content = await helpers.extractGoogleDocsTextExportForTab(tab, { maxChars: 2000 });
	const visible = helpers.googleDocsVisibleTextPayloadFromExport(tab, content, { maxChars: 120, maxBlocks: 2 });
	const headings = helpers.googleDocsViewportHeadingsPayloadFromExport(tab, content, { maxHeadings: 4 });
	const capture = helpers.googleDocsCaptureStatePayload(tab);

	assert.equal(visible.surface, "google-docs");
	assert.equal(visible.source, "google-docs-export-visible-text");
	assert.equal(visible.blockCount, 2);
	assert.match(visible.text, /My name is Farza/);
	assert.match(visible.text, /new interface/);
	assert.equal(headings.source, "google-docs-export-headings");
	assert.equal(headings.currentHeading.text, "heyclicky vision");
	assert.match(headings.message, /inferred from the document title/);
	assert.equal(capture.source, "google-docs-fast-capture");
	assert.deepEqual(capture.annotations, []);
}

async function assertExtractContentUsesBackgroundGoogleDocsExportBeforePageEval() {
	const source = await readFile(join(PROJECT_ROOT, "packages/browser-extension/background.js"), "utf8");
	assert.match(
		source,
		/case "extract_content":\s*{[\s\S]*extractGoogleDocsTextExportForTab\(tab,\s*\{\s*maxChars:\s*args\.maxChars\s*\}\)[\s\S]*evaluateInTab/,
		"browser_extract_content should read Google Docs through the background text export before page-world evaluation",
	);
}

async function assertGoogleDocsReadCommandsBypassEditorToolkit() {
	const source = await readFile(join(PROJECT_ROOT, "packages/browser-extension/background.js"), "utf8");
	assert.match(
		source,
		/case "capture_state":\s*{[\s\S]*isGoogleDocsDocumentUrl\(tab\.url\)[\s\S]*googleDocsCaptureStatePayload\(tab\)[\s\S]*runPageToolkitMethod\(tab\.id,\s*"captureState"/,
		"Google Docs sidebar capture should use a fast payload before the generic editor toolkit",
	);
	assert.match(
		source,
		/case "get_visible_text":\s*{[\s\S]*isGoogleDocsDocumentUrl\(tab\.url\)[\s\S]*extractGoogleDocsTextExportForTab\(tab,\s*\{\s*maxChars:\s*args\.maxChars\s*\}\)[\s\S]*googleDocsVisibleTextPayloadFromExport[\s\S]*runPageToolkitMethod\(tab\.id,\s*"getVisibleText"/,
		"Google Docs visible-text reads should use text export before the generic editor toolkit",
	);
	assert.match(
		source,
		/case "get_viewport_headings":\s*{[\s\S]*isGoogleDocsDocumentUrl\(tab\.url\)[\s\S]*extractGoogleDocsTextExportForTab\(tab,\s*\{\s*maxChars:\s*2000\s*\}\)[\s\S]*googleDocsViewportHeadingsPayloadFromExport[\s\S]*runPageToolkitMethod\(tab\.id,\s*"getViewportHeadings"/,
		"Google Docs heading reads should return export-derived context before probing the editor",
	);
}

async function assertExtractContentUsesDebuggerFrameReadableFallback() {
	const source = await readFile(join(PROJECT_ROOT, "packages/browser-extension/background.js"), "utf8");
	assert.match(source, /function getDebuggerFrameReadableContent\(tabId,\s*options\s*=\s*\{\},\s*currentContent\s*=\s*null,\s*tab\s*=\s*null\)/, "browser_extract_content should have a debugger frame readable-content fallback");
	assert.match(source, /source:\s*"debugger-frame-readable-content"/, "debugger frame readable-content fallback should identify its source");
	assert.match(source, /function isLikelyOnlineTextbookReaderTab\(tab\)/, "textbook reader tabs should force a nested readable-frame check");
	assert.match(source, /function readableContentLooksLikeReaderSearchUi\(payload\)/, "reader search panels should not be treated as final readable textbook content");
	assert.match(
		source,
		/readableContentLooksLikeReaderSearchUi\(currentContent\)[\s\S]*!readableContentLooksLikeReaderSearchUi\(candidate\)[\s\S]*return true/,
		"body-frame content should beat top-level textbook search-result chrome",
	);
	assert.match(
		source,
		/case "extract_content":\s*{[\s\S]*evaluateInTab\(tab\.id,[\s\S]*maybeGetDebuggerFrameReadableContent\(tab,\s*content,\s*\{[\s\S]*query:\s*args\.query/,
		"browser_extract_content should try nested readable frames after the main-page extractor",
	);

	const functionNames = [
		"normalizeReadableContentText",
		"readableContentQueryTokens",
		"readableContentQueryScore",
		"isLikelyOnlineTextbookReaderUrl",
		"isLikelyOnlineTextbookReaderTab",
		"sameOriginUrls",
		"readableContentLooksLikeReaderSearchUi",
		"shouldTryDebuggerFrameReadableContent",
		"tabHasCrossOriginContentSubframe",
		"getAllFramesForTab",
	];
	const declarations = await Promise.all(functionNames.map((functionName) => loadBackgroundFunction(functionName)));
	const buildHelpers = (chromeStubSource) =>
		new Function(
			`const EMBEDDED_CONTENT_SHELL_TOP_TEXT_MAX_CHARS = 600;\nconst chrome = ${chromeStubSource};\n${declarations.join("\n")}\nreturn { ${functionNames.join(", ")} };`,
		)();
	const helpers = buildHelpers("{ webNavigation: null }");
	const shortContent = { markdown: "# Short page", blockCount: 1 };
	assert.equal(
		await helpers.shouldTryDebuggerFrameReadableContent({ url: "https://attacker.example/", title: "Reader" }, shortContent, { query: "private" }),
		false,
		"generic pages and title-only reader claims must not trigger debugger frame extraction",
	);
	assert.equal(
		await helpers.shouldTryDebuggerFrameReadableContent({ url: "https://bookshelf.vitalsource.com/reader/books/123" }, shortContent, { query: "private" }),
		true,
		"known textbook reader URLs can still trigger debugger frame extraction",
	);
	// Embedded-content shells (Claude artifact pages): chrome-thin top text
	// plus a cross-origin body subframe triggers frame extraction; a page
	// with rich top text does not, even with the same subframe.
	const shellHelpers = buildHelpers(
		`{
			webNavigation: {
				getAllFrames: (query, callback) =>
					callback([
						{ frameId: 0, url: "https://claude.ai/code/artifact/abc" },
						{ frameId: 5, url: "https://abc.frame.claudeusercontent.com/_f/1" },
					]),
			},
			runtime: { lastError: null },
		}`,
	);
	assert.equal(
		await shellHelpers.shouldTryDebuggerFrameReadableContent({ id: 1, url: "https://claude.ai/code/artifact/abc" }, shortContent, {}),
		true,
		"a shell page with thin top text and a cross-origin body frame should trigger frame extraction",
	);
	assert.equal(
		await shellHelpers.shouldTryDebuggerFrameReadableContent(
			{ id: 1, url: "https://claude.ai/code/artifact/abc" },
			{ markdown: `# Rich page\n${"body text ".repeat(120)}`, blockCount: 12 },
			{},
		),
		false,
		"a page with rich top text keeps the single-frame fast path even with a subframe",
	);
	assert.equal(helpers.isLikelyOnlineTextbookReaderUrl("https://private.example/account"), false);
	assert.equal(helpers.isLikelyOnlineTextbookReaderUrl("https://jigsaw.vitalsource.com/books/123/part-11.xhtml"), true);
	assert.equal(helpers.sameOriginUrls("https://example.test/a", "https://example.test/frame"), true);
	assert.equal(helpers.sameOriginUrls("https://example.test/a", "https://private.example/frame"), false);
}

async function assertTextbookHighlightPrefersBodyFrameOverSearchUi() {
	const source = await readFile(join(PROJECT_ROOT, "packages/browser-extension/background.js"), "utf8");
	const functionNames = [
		"normalizePageToolkitPayloadText",
		"pageToolkitPayloadLooksLikeReaderSearchUi",
		"pageToolkitFramePayloadLooksLikeReaderSearchUi",
		"isLikelyOnlineTextbookReaderUrl",
		"isLikelyOnlineTextbookReaderTab",
		"shouldPreferTextbookFramePageToolkit",
		"pickBestPageToolkitFramePayload",
	];
	const declarations = await Promise.all(functionNames.map((functionName) => loadBackgroundFunction(functionName)));
	const helpers = new Function(`${declarations.join("\n")}\nreturn { ${functionNames.join(", ")} };`)();
	const query = "Americans United for Separation of Church and State";
	const searchUiHighlight = {
		matchedText: `III. Individual Rights 61 results ${query} Content (61) Figures (0) Workbook (0) Page 502`,
		container: {
			text: `Search across book 61 results ${query}`,
		},
	};
	const compactVitalSourceSearchUiHighlight = {
		matchedText:
			"III. Individual Rights30 results...constitutional politics of religion. “Protestants United for Separation of Church and State” became “Americans...502...Separation of Church and State” became “Americans United for Separation of Church and State.” The “Moral...502The constitutional politics of religious freedom took contemporary shape during...502",
		container: {
			selector: "div.sc-dZpvmy.QHjwi:nth-of-type(2) > ul > li.sc-jWULZn.gJkQNN",
			tag: "li",
			text: "III. Individual Rights30 results...constitutional politics of religion. “Protestants United for Separation of Church and State” became “Americans...502",
		},
	};
	const singleVitalSourceSearchResultHighlight = {
		matchedText: "“Americans United for Separation of Church and State.” The “Moral Majority” became a",
		container: {
			selector: "li.sc-jWULZn.gJkQNN:nth-of-type(7)",
			tag: "li",
			text: "...became “Americans United for Separation of Church and State.” The “Moral Majority” became a leading voice for...502",
		},
	};
	const bodyHighlight = {
		matchedText: `"Protestants United for Separation of Church and State" became "Americans United for Separation of Church and State."`,
		container: {
			text: `Public debates over funding and prayer once pitted Protestants against Catholics, but the Moral Majority changed the alignment.`,
		},
	};
	assert.equal(helpers.pageToolkitPayloadLooksLikeReaderSearchUi(searchUiHighlight, query), true);
	assert.equal(helpers.pageToolkitPayloadLooksLikeReaderSearchUi(compactVitalSourceSearchUiHighlight, query), true);
	assert.equal(helpers.pageToolkitPayloadLooksLikeReaderSearchUi(singleVitalSourceSearchResultHighlight, query), true);
	assert.equal(helpers.pageToolkitPayloadLooksLikeReaderSearchUi(bodyHighlight, query), false);
	assert.equal(
		helpers.shouldPreferTextbookFramePageToolkit(
			{ url: "https://online.vitalsource.com/reader/books/example/page/502", title: "VitalSource Bookshelf" },
			"highlightText",
			searchUiHighlight,
			[query],
		),
		true,
	);
	const picked = helpers.pickBestPageToolkitFramePayload(
		[
			{ ok: true, value: compactVitalSourceSearchUiHighlight, frameUrl: "https://online.vitalsource.com/reader/books/example" },
			{ ok: true, value: bodyHighlight, frameUrl: "https://jigsaw.vitalsource.com/books/example/content" },
		],
		"highlightText",
		[query],
	);
	assert.equal(picked.value, bodyHighlight, "textbook highlights should prefer the body frame over search-result chrome");
	assert.match(
		source,
		/shouldPreferTextbookFramePageToolkit\(tab,\s*methodName,\s*payload,\s*args\)[\s\S]*executePageToolkitMethodViaScriptingFrames[\s\S]*executePageToolkitMethodViaGenericWebFrames/,
		"suspicious textbook top-frame highlights should retry nested body frames before returning",
	);
}

async function assertGoogleDocsHighlightUsesPdfViewerHandoff() {
	const backgroundSource = await readFile(join(PROJECT_ROOT, "packages/browser-extension/background.js"), "utf8");
	const pdfViewerSource = await readFile(join(PROJECT_ROOT, "packages/browser-extension/src/pdf-viewer.ts"), "utf8");
	const browserRuntimeSource = await readFile(join(PROJECT_ROOT, "packages/browser-extension/src/browser-runtime.ts"), "utf8");
	const sidebarSource = await readFile(join(PROJECT_ROOT, "packages/browser-extension/sidebar.js"), "utf8");
	assert.match(
		backgroundSource,
		/isGoogleDocsDocumentUrl\(tabUrl\)[\s\S]*buildGoogleDocsPdfExportUrl\(tabUrl\)/,
		"PDF viewer source resolution should infer a Google Docs PDF export URL from document tabs",
	);
	assert.match(
		backgroundSource,
		/const sourceIsGoogleDocs = isGoogleDocsDocumentUrl\(sourceTab\.url\);/,
		"PDF viewer opening should detect Google Docs source tabs",
	);
	assert.match(
		backgroundSource,
		/const shouldOpenViewerInNewTab = args\.newTab === true \|\| \(sourceIsGoogleDocs && args\.newTab !== false\);/,
		"Google Docs PDF handoff should preserve the original Docs tab by default",
	);
	assert.match(backgroundSource, /async function highlightGoogleDocsViaPdfViewer/, "Google Docs highlights should use a PDF viewer handoff helper");
	assert.match(
		backgroundSource,
		/case "highlight_text":\s*{[\s\S]*!args\.pdfAnchor && isGoogleDocsDocumentUrl\(tab\.url\)[\s\S]*highlightGoogleDocsViaPdfViewer\(tab,\s*args\)/,
		"browser_highlight_text should hand Google Docs tabs to the PDF viewer before annotating",
	);
	assert.match(
		backgroundSource,
		/handoff:\s*{[\s\S]*surface:\s*"google-docs"[\s\S]*mode:\s*"pdf-export"/,
		"Google Docs PDF highlights should report the handoff surface and mode",
	);
	assert.doesNotMatch(
		pdfViewerSource,
		/function isGoogleDocsPdfExportUrl/,
		"Authenticated PDF loading should not be hard-coded to Google Docs",
	);
	assert.match(
		pdfViewerSource,
		/pdf-viewer:authorize-credentialed-source/,
		"Onhand PDF viewer should request a scoped authorization before retrying an HTTPS PDF with credentials",
	);
	assert.match(
		pdfViewerSource,
		/withCredentials:\s*true[\s\S]*CREDENTIALED_PDF_LOAD_RETRY_TIMEOUT_MS/,
		"Onhand PDF viewer should retry an authorized HTTPS PDF with browser credentials",
	);
	assert.match(
		backgroundSource,
		/function grantOnhandPdfViewerCredentialedSource[\s\S]*onhandPdfViewerCredentialGrantKey\(tabId, pdfUrl\)/,
		"Authenticated PDF retries should be granted to an exact tab and source pair",
	);
	assert.match(
		backgroundSource,
		/message\?\.type === "pdf-viewer:authorize-credentialed-source"[\s\S]*authorizeOnhandPdfViewerCredentialedSource\(_sender, message\.url\)/,
		"The background should enforce the scoped authenticated-PDF authorization",
	);
	assert.match(
		pdfViewerSource,
		/Timed out loading the PDF\./,
		"Onhand PDF viewer should not leave failed Google Docs exports spinning silently",
	);
	for (const [source, label] of [
		[browserRuntimeSource, "typed agent"],
		[sidebarSource, "Realtime voice agent"],
	]) {
		assert.match(source, /negative, absence, or whole-document PDF claims/i, `${label} should treat broad PDF absence claims as a distinct verification task`);
		assert.match(source, /multiple conceptually distinct phrasings/i, `${label} should require semantic query variation for PDF absence claims`);
		assert.match(source, /Never say you read or verified the entire PDF unless you actually read every page/i, `${label} should not overclaim whole-document reading`);
	}
}

async function assertGoogleDocsSelectionUsesTextEventClipboardFallback() {
	const backgroundSource = await readFile(join(PROJECT_ROOT, "packages/browser-extension/background.js"), "utf8");
	const manifestSource = await readFile(join(PROJECT_ROOT, "packages/browser-extension/manifest.json"), "utf8");
	const offscreenSource = await readFile(join(PROJECT_ROOT, "packages/browser-extension/offscreen.js"), "utf8");
	const sidebarSource = await readFile(join(PROJECT_ROOT, "packages/browser-extension/sidebar.js"), "utf8");
	assert.match(manifestSource, /"clipboardRead"/, "Google Docs selection recovery needs clipboardRead permission");
	assert.match(manifestSource, /"clipboardWrite"/, "Google Docs selection recovery needs clipboardWrite permission for clipboard restoration");
	assert.match(offscreenSource, /offscreen:clipboard-read/, "offscreen document should read clipboard text for selection recovery");
	assert.match(offscreenSource, /offscreen:clipboard-write/, "offscreen document should restore clipboard text after selection recovery");
	assert.match(sidebarSource, /sidebar:clipboard-read/, "focused sidebar should read clipboard text for Google Docs selection recovery");
	assert.match(sidebarSource, /sidebar:clipboard-write/, "focused sidebar should write clipboard markers for Google Docs selection recovery");
	assert.match(
		backgroundSource,
		/readTextFromExtensionClipboard\(\)[\s\S]*sendSidebarClipboardMessage\("sidebar:clipboard-read"\)[\s\S]*readTextFromOffscreenClipboard\(\)/,
		"Google Docs selection recovery should prefer focused sidebar clipboard reads before offscreen fallback",
	);
	assert.match(
		backgroundSource,
		/function getGoogleDocsTextEventCopyExpression\(\)[\s\S]*iframe\.docs-texteventtarget-iframe[\s\S]*execCommand\?\.\("copy"\)/,
		"Google Docs selection recovery should copy through the Docs text-event iframe",
	);
	assert.match(
		backgroundSource,
		/case "get_selection":\s*{[\s\S]*maybeGetGoogleScholarReaderSelection\(tab,\s*pageSelection\)[\s\S]*maybeGetNativeChromePdfViewerSelection\(tab,\s*selection\)[\s\S]*maybeGetBrowserClipboardPdfSelection\(tab,\s*selection\)[\s\S]*maybeGetGoogleDocsClipboardSelection\(tab,\s*selection\)[\s\S]*maybeGetDebuggerFrameSelection\(tab,\s*selection\)/,
		"browser_get_selection should try Google Docs clipboard selection before generic frame fallback",
	);
	assert.match(
		backgroundSource,
		/googleDocsExportTextContainsSelection\(content,\s*copiedText\)/,
		"Google Docs copied selection should be checked against document text export",
	);
}

function installLayoutShims(window) {
	Object.defineProperty(window.HTMLElement.prototype, "innerText", {
		get() {
			return this.textContent || "";
		},
		set(value) {
			this.textContent = String(value ?? "");
		},
		configurable: true,
	});
	window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
	window.scrollBy = function scrollBy() {};
	window.scrollTo = function scrollTo() {};
	window.HTMLCanvasElement.prototype.getContext = function getContext() {
		return {
			font: "",
			measureText(text) {
				return { width: String(text || "").length };
			},
		};
	};
	window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
		return {
			x: 16,
			y: 16,
			top: 16,
			left: 16,
			right: 656,
			bottom: 40,
			width: 640,
			height: 24,
			toJSON() {
				return { x: this.x, y: this.y, top: this.top, left: this.left, right: this.right, bottom: this.bottom, width: this.width, height: this.height };
			},
		};
	};
}

function fixedRect({ left, top, width, height }) {
	return {
		x: left,
		y: top,
		top,
		left,
		right: left + width,
		bottom: top + height,
		width,
		height,
		toJSON() {
			return { x: this.x, y: this.y, top: this.top, left: this.left, right: this.right, bottom: this.bottom, width: this.width, height: this.height };
		},
	};
}

function setElementRect(element, rect) {
	element.getBoundingClientRect = () => fixedRect(rect);
}

function assertPassivePdfHighlightElement(element, label = "PDF highlight") {
	assert.ok(element, `${label} should exist`);
	assert.equal(element.style.pointerEvents, "none", `${label} should not intercept mouse events`);
	assert.equal(element.style.getPropertyPriority("pointer-events"), "important", `${label} should force pointer-events through inline style`);
	assert.equal(element.style.cursor, "default", `${label} should not advertise clickability`);
	assert.equal(element.style.userSelect, "none", `${label} should not become selectable overlay text`);
	assert.equal(element.getAttribute("role"), null, `${label} should not be exposed as a button`);
	assert.equal(element.getAttribute("tabindex"), null, `${label} should not be keyboard-focusable`);
	assert.equal(element.getAttribute("title"), null, `${label} should not show a click-target tooltip`);
	assert.equal(element.getAttribute("aria-hidden"), "true", `${label} should be hidden from accessibility navigation`);
}

async function createToolkit(html, toolkitOptions = {}) {
	const dom = new JSDOM(html, {
		url: "https://example.test/article",
		pretendToBeVisual: true,
		runScripts: "outside-only",
	});
	installLayoutShims(dom.window);
	const factoryExpression = await loadPageToolkitFactory();
	const createPageToolkit = dom.window.eval(`(${factoryExpression})`);
	return {
		dom,
		toolkit: createPageToolkit({ theme: "light", ...toolkitOptions }),
	};
}

async function createToolkitAtUrl(html, url, toolkitOptions = {}) {
	const dom = new JSDOM(html, {
		url,
		pretendToBeVisual: true,
		runScripts: "outside-only",
	});
	installLayoutShims(dom.window);
	const factoryExpression = await loadPageToolkitFactory();
	const createPageToolkit = dom.window.eval(`(${factoryExpression})`);
	return {
		dom,
		toolkit: createPageToolkit({ theme: "light", ...toolkitOptions }),
	};
}

async function assertHiddenTabAnnotationCommandsSkipThrottledWaits() {
	const { dom, toolkit } = await createToolkit(
		`<main><p>Hidden tab throttling target sentence for the note placement path.</p></main>`,
	);
	const { window } = dom;
	const highlight = await toolkit.highlightText("Hidden tab throttling target sentence for the note placement path.", {
		scrollIntoView: false,
	});
	assert.ok(highlight?.annotationId, "highlight lands before throttling begins");
	// Simulate an occluded/background tab: rAF never fires and timers clamp to
	// one-second ticks. The annotation path must not stack throttled layout
	// waits — pre-fix each waitForLayout cost ~1s and a non-converging settle
	// loop stacked 6+ of them, blowing the 6s annotation command budget.
	Object.defineProperty(window.document, "visibilityState", { configurable: true, get: () => "hidden" });
	window.requestAnimationFrame = () => 0;
	const nativeSetTimeout = window.setTimeout.bind(window);
	window.setTimeout = (handler, delay = 0, ...rest) => nativeSetTimeout(handler, Math.max(Number(delay) || 0, 1000), ...rest);
	const startedAt = Date.now();
	const note = await toolkit.showNote(highlight.annotationId, "Throttled-tab note must land without waiting on paint.", {
		scrollIntoView: true,
	});
	const scrolled = await toolkit.scrollToAnnotation(highlight.annotationId, { target: "note" });
	const elapsedMs = Date.now() - startedAt;
	assert.ok(note?.noteId, "showNote lands on a hidden tab");
	assert.equal(scrolled?.annotationId, highlight.annotationId, "scrollToAnnotation succeeds on a hidden tab");
	assert.ok(elapsedMs < 900, `hidden-tab note/scroll must not stack throttled waits (took ${elapsedMs}ms)`);
	window.close();
}

async function assertHighlight({ name, html, query, expectedText, expectedFallback, options = {} }) {
	const { toolkit } = await createToolkit(html);
	const result = await toolkit.highlightText(query, { scrollIntoView: false, ...options });
	assert.match(result.matchedText, expectedText, `${name}: matched text`);
	if (expectedFallback) {
		assert.equal(result.fallback, expectedFallback, `${name}: fallback`);
	}
}

async function assertNoHighlight({ name, html, query }) {
	const { toolkit } = await createToolkit(html);
	await assert.rejects(
		() => toolkit.highlightText(query, { scrollIntoView: false }),
		/error|No visible text matched/i,
		`${name}: expected no highlight`,
	);
}

async function assertHyphenatedProseHeadingDoesNotWaitForMathJax() {
	const { dom, toolkit } = await createToolkit(`
		<main>
			<script type="math/tex">$$q = qP$$</script>
			<h2>Metropolis-Hastings Sampling</h2>
			<p>Now we can build a Markov chain whose stationary distribution is the posterior.</p>
		</main>
	`);
	let touchedMathJaxQueue = false;
	dom.window.MathJax = {
		startup: {
			promise: {
				then() {
					touchedMathJaxQueue = true;
					return new Promise(() => {});
				},
			},
		},
	};
	const highlight = await toolkit.highlightText("Metropolis-Hastings Sampling", { scrollIntoView: false });
	assert.match(highlight.matchedText, /Metropolis-Hastings Sampling/, "hyphenated prose heading should be highlighted");
	assert.equal(touchedMathJaxQueue, false, "hyphenated prose should not be treated as math-like");
}

async function assertNoteDoesNotClearFloats() {
	const { dom, toolkit } = await createToolkit(`
		<main>
			<aside style="float:right;width:320px;height:520px">Floating page media</aside>
			<p>A Markov chain or Markov process is a stochastic process describing a sequence of possible events.</p>
		</main>
	`);
	const highlight = await toolkit.highlightText("Markov chain or Markov process", { scrollIntoView: false });
	await toolkit.showNote(highlight.annotationId, "The note should stay visually attached to the highlighted paragraph.", {
		scrollIntoView: false,
	});
	const note = dom.window.document.querySelector('[data-onhand-note-kind="card"]');
	assert.ok(note, "note card was not inserted");
	assert.equal(dom.window.getComputedStyle(note).clear, "none", "note cards must not clear floated page media");
	assert.equal(
		dom.window.getComputedStyle(note).display,
		"flow-root",
		"note cards must establish a BFC so they cannot slide under floated figures when an open side panel narrows the column",
	);
	assert.equal(note.previousElementSibling?.tagName, "P", "note should be inserted directly after the highlighted paragraph");
}

async function assertExactSourceModeDoesNotApproximate() {
	const { toolkit } = await createToolkit(`
		<main>
			<p>The Promise object represents the eventual completion (or failure) of an asynchronous operation and its resulting value.</p>
		</main>
	`);
	await assert.rejects(
		() =>
			toolkit.highlightText("Promise represents eventual completion failure asynchronous operation resulting value", {
				scrollIntoView: false,
				exactOnly: true,
				allowApproximate: false,
			}),
		/No visible text matched/i,
	);
}

async function assertExactSourceModeReusesExistingHighlight() {
	const { dom, toolkit } = await createToolkit(`
		<main>
			<p>The convergence property is Q = QP for a stationary distribution.</p>
		</main>
	`);
	const first = await toolkit.highlightText("Q = QP", { scrollIntoView: false });
	const second = await toolkit.highlightText("Q = QP", {
		scrollIntoView: false,
		clearExisting: false,
		exactOnly: true,
		allowApproximate: false,
		reuseExisting: true,
	});
	assert.equal(second.annotationId, first.annotationId);
	assert.equal(second.reusedExisting, true);
	assert.equal(dom.window.document.querySelectorAll("[data-onhand-highlight-kind]").length, 1);
}

async function assertHighlightTextPreservesExistingAnnotationsByDefault() {
	const { dom, toolkit } = await createToolkit(`
		<main>
			<p>The Perron-Frobenius theorem identifies the largest eigenvalue.</p>
			<p>The aperiodic condition prevents fixed-cycle behavior.</p>
		</main>
	`);
	await toolkit.highlightText("Perron-Frobenius theorem", { scrollIntoView: false });
	await toolkit.highlightText("aperiodic condition", { scrollIntoView: false });
	const highlights = Array.from(dom.window.document.querySelectorAll("[data-onhand-highlight-kind]"));
	assert.equal(highlights.length, 2, "follow-up highlights should accumulate unless clearExisting=true");
	assert.match(highlights[0].textContent, /Perron-Frobenius/);
	assert.match(highlights[1].textContent, /aperiodic condition/);
}

async function assertInlineHighlightRecordsTextQuoteAnchor() {
	const { dom, toolkit } = await createToolkit(`
		<main>
			<p>Markov chains converge to a stationary distribution when they are irreducible and aperiodic. The detailed balance condition offers a convenient sufficient test. Convergence rates depend on the spectral gap of the transition matrix.</p>
		</main>
	`);
	const result = await toolkit.highlightText("The detailed balance condition offers a convenient sufficient test.", {
		scrollIntoView: false,
	});
	assert.equal(result.anchor?.surface, "html", "inline highlights should record an html text-quote anchor");
	assert.match(result.anchor?.textQuote?.exact || "", /detailed balance condition/i, "anchor exact quote");
	assert.match(result.anchor?.textQuote?.prefix || "", /irreducible and aperiodic/i, "anchor prefix context");
	assert.match(result.anchor?.textQuote?.suffix || "", /convergence rates depend/i, "anchor suffix context");
	const highlight = dom.window.document.querySelector('[data-onhand-highlight-kind="inline"]');
	const storedAnchor = JSON.parse(highlight.getAttribute("data-onhand-anchor") || "null");
	assert.match(storedAnchor?.textQuote?.prefix || "", /irreducible and aperiodic/i, "anchor should persist on the element");
	assert.ok(highlight.getAttribute("data-onhand-matched-text"), "matched text should persist on the element");
	const captured = await toolkit.captureState();
	assert.equal(captured.annotations.length, 1);
	assert.match(captured.annotations[0].anchor?.textQuote?.suffix || "", /convergence rates/i, "captureState should serialize the anchor");
}

async function assertAnchorContextDisambiguatesRepeatedText() {
	const created = await createToolkit(`
		<main>
			<p id="first">Chapter one introduces the estimator. The proof follows directly. Nothing else in this section depends on it.</p>
			<p id="second">Chapter two extends the argument to continuous domains. The proof follows directly. A worked example closes the chapter.</p>
			<p id="third">Chapter three studies degenerate cases. The proof follows directly. Careful readers will spot the missing assumption.</p>
		</main>
	`);
	const result = await created.toolkit.highlightText("The proof follows directly.", {
		scrollIntoView: false,
		exactOnly: true,
		allowApproximate: false,
		anchor: {
			surface: "html",
			textQuote: {
				exact: "The proof follows directly.",
				prefix: "extends the argument to continuous domains.",
				suffix: "A worked example closes the chapter.",
			},
			occurrence: 1,
		},
	});
	assert.ok(!result.approximate, "context-disambiguated exact match should not be approximate");
	const highlight = created.dom.window.document.querySelector('[data-onhand-highlight-kind="inline"]');
	assert.equal(highlight.closest("p")?.id, "second", "anchored restore should pick the occurrence whose stored context agrees");
}

async function assertAnchorOccurrenceBreaksContextTies() {
	const created = await createToolkit(`
		<main>
			<p id="p1">Same lead-in prose for every row. Target sentence sits right here. Same tail prose for every row.</p>
			<p id="p2">Same lead-in prose for every row. Target sentence sits right here. Same tail prose for every row.</p>
		</main>
	`);
	await created.toolkit.highlightText("Target sentence sits right here.", {
		scrollIntoView: false,
		exactOnly: true,
		allowApproximate: false,
		anchor: {
			surface: "html",
			textQuote: {
				exact: "Target sentence sits right here.",
				prefix: "Same lead-in prose for every row.",
				suffix: "Same tail prose for every row.",
			},
			occurrence: 2,
		},
	});
	const highlight = created.dom.window.document.querySelector('[data-onhand-highlight-kind="inline"]');
	assert.equal(highlight.closest("p")?.id, "p2", "identical contexts should fall back to the stored occurrence");
}

async function assertAnchorContextRecoversDriftedText() {
	// Capture an anchor on the original page, then restore onto a page whose
	// highlighted sentence was rewritten while its surroundings survived.
	const original = await createToolkit(`
		<main>
			<p>The sampler explores the posterior efficiently. Detailed balance guarantees stationarity of the target distribution. Mixing times degrade when correlations are strong.</p>
		</main>
	`);
	const createdAnnotation = await original.toolkit.highlightText(
		"Detailed balance guarantees stationarity of the target distribution.",
		{ scrollIntoView: false },
	);
	assert.ok(createdAnnotation.anchor?.textQuote?.prefix && createdAnnotation.anchor?.textQuote?.suffix, "created highlight should carry anchor context");
	const drifted = await createToolkit(`
		<main>
			<p>The sampler explores the posterior efficiently. Reversibility now ensures the chain keeps the intended target. Mixing times degrade when correlations are strong.</p>
		</main>
	`);
	const restored = await drifted.toolkit.highlightText(
		"Detailed balance guarantees stationarity of the target distribution.",
		{
			scrollIntoView: false,
			exactOnly: true,
			allowApproximate: false,
			anchor: createdAnnotation.anchor,
		},
	);
	assert.equal(restored.fallback, "context", "drifted text should be recovered from the stored context");
	assert.equal(restored.approximate, true, "context recovery is reported as approximate");
	assert.match(restored.matchedText, /Reversibility now ensures the chain keeps the intended target/, "the recovered span should be the rewritten sentence");
}

async function assertAnchorRecoveryRequiresBothContextSides() {
	// A weak anchor (no suffix) must not trigger drift recovery — exact-only
	// restores should still fail cleanly rather than guess.
	const created = await createToolkit(`
		<main>
			<p>The sampler explores the posterior efficiently. Reversibility now ensures the chain keeps the intended target. Mixing times degrade when correlations are strong.</p>
		</main>
	`);
	await assert.rejects(
		() =>
			created.toolkit.highlightText("Detailed balance guarantees stationarity of the target distribution.", {
				scrollIntoView: false,
				exactOnly: true,
				allowApproximate: false,
				anchor: {
					surface: "html",
					textQuote: {
						exact: "Detailed balance guarantees stationarity of the target distribution.",
						prefix: "The sampler explores the posterior efficiently.",
					},
					occurrence: 1,
				},
			}),
		/No visible text matched/,
		"one-sided context should not authorize recovery",
	);
}

async function assertTweetTextContainerCanBeHighlightedAcrossNodes() {
	const target =
		"current goal: fund better dev hardware, ideally a MacBook, so I can test more AI coding workflows and keep building OSS faster";
	const { dom, toolkit } = await createToolkit(`
		<main>
			<article role="article">
				<div data-testid="tweetText" lang="en" dir="auto">
					<span>updated my GitHub Sponsors page for Taste Skill :)</span>
					<br>
					<br>
					<span>current goal:</span>
					<span> fund better dev hardware, ideally a MacBook, so I can test more AI </span>
					<span>coding workflows and keep building OSS faster</span>
					<br>
					<br>
					<span>if Taste Skill helped you or you want to support, would mean a lot!!</span>
				</div>
			</article>
		</main>
	`);
	const visible = toolkit.getVisibleText({ maxChars: 1000 });
	assert.match(visible.text, /current goal: fund better dev hardware/, "tweet text should be readable as visible page text");

	const highlight = await toolkit.highlightText(target, { scrollIntoView: false, exactOnly: true, allowApproximate: false });
	assert.match(highlight.matchedText, /current goal: fund better dev hardware/);
	assert.equal(highlight.fallback, undefined);
	assert.equal(dom.window.document.querySelectorAll("[data-onhand-highlight-kind]").length, 1);
}

async function assertNestedListHighlightUsesBlockContainer() {
	const query =
		'A transformer is essentially a graph neural network (GNN) with a specially constructed graph ("fully" connected with relevance weights on the edges)';
	const { dom, toolkit } = await createToolkit(`
		<main>
			<ul>
				<li id="transformer-claim">
					A transformer is essentially a graph neural network (GNN) with
					<ul>
						<li>a specially constructed graph ("fully" connected with relevance weights on the edges)</li>
					</ul>
				</li>
				<li>a few tricks that allow it to also learn token order.</li>
			</ul>
		</main>
	`);
	const highlight = await toolkit.highlightText(query, { scrollIntoView: false });
	const block = dom.window.document.querySelector('[data-onhand-highlight-kind="block"]');

	assert.equal(highlight.kind, "block", "nested list-spanning matches should use a block highlight");
	assert.equal(block?.id, "transformer-claim", "expected the shared list item to carry the highlight");
	assert.equal(dom.window.document.querySelectorAll('span[data-onhand-highlight-kind="inline"]').length, 0);
	assert.equal(dom.window.document.querySelectorAll("li").length, 3, "highlighting should not split list item structure");
}

async function assertExactMathSourceModeMatchesRenderedMathJax() {
	const { dom, toolkit } = await createToolkit(`
		<main>
			<p>
				Thus, the process converges to a unique stationary distribution.
				<script type="math/tex; mode=display" id="MathJax-Element-1">{\\bf q} = {\\bf q} {\\bf P}  .</script>
				<span class="MathJax_Display"><span class="MathJax" id="MathJax-Element-1-Frame"></span></span>
			</p>
			<p>Algorithm 1 begins after the display equation.</p>
		</main>
	`);
	const highlight = await toolkit.highlightText("q = qP", {
		scrollIntoView: false,
		exactOnly: true,
		allowApproximate: false,
	});
	assert.equal(highlight.fallback, "math-source");
	assert.equal(highlight.approximate, false);
	const highlighted = dom.window.document.querySelector("[data-onhand-highlight-kind]");
	assert.ok(highlighted?.classList.contains("MathJax_Display"), "expected rendered MathJax display to be highlighted");
	await toolkit.showNote(highlight.annotationId, "Stationary means applying the transition leaves q unchanged.", {
		scrollIntoView: false,
	});
	const note = dom.window.document.querySelector('[data-onhand-note-kind="card"]');
	assert.ok(note, "math-source highlight should support notes");
	assert.equal(note.previousElementSibling?.getAttribute("data-onhand-highlight-kind"), "block");
}

async function assertMixedLabelAndRenderedMathUsesBlockHighlight() {
	const { dom, toolkit } = await createToolkit(`
		<main>
			<p id="posterior">
				Bayes theorem:
				<span id="posterior-equation" class="MathJax_Display">
					<span class="MathJax">p(W|D)=p(D|W)P(W)/p(D)</span>
				</span>
			</p>
		</main>
	`);
	const highlight = await toolkit.highlightText("Bayes theorem: p(W|D)=p(D|W)P(W)/p(D)", {
		scrollIntoView: false,
	});
	const equation = dom.window.document.getElementById("posterior-equation");

	assert.equal(highlight.kind, "block", "label-plus-rendered-math matches should use the block formula highlight path");
	assert.equal(highlight.fallback, "math-range", "mixed math ranges should report the formula-safe fallback");
	assert.equal(equation?.getAttribute("data-onhand-highlight-kind"), "block", "display equation wrapper should carry the highlight");
	assert.equal(
		dom.window.document.querySelectorAll('span[data-onhand-highlight-kind="inline"]').length,
		0,
		"rendered math should not be wrapped in an inline highlight span",
	);
}

async function assertMathJaxQueueSettlesBeforeMathSourceRestore() {
	const { dom, toolkit } = await createToolkit(`
		<main>
			<p id="stationary">
				Thus, the process converges to a unique stationary distribution.
				And this unique stationary distribution $$ {\\bf q} = {\\bf q} {\\bf P}  .$$
			</p>
			<p>Algorithm 1 begins after the display equation.</p>
		</main>
	`);
	let converted = false;
	dom.window.MathJax = {
		Hub: {
			Queue(callback) {
				if (!converted) {
					converted = true;
					const paragraph = dom.window.document.getElementById("stationary");
					paragraph.innerHTML = `
						Thus, the process converges to a unique stationary distribution.
						And this unique stationary distribution
						<script type="math/tex; mode=display" id="MathJax-Element-2">{\\bf q} = {\\bf q} {\\bf P}  .</script>
						<span class="MathJax_Display"><span class="MathJax" id="MathJax-Element-2-Frame"></span></span>
					`;
				}
				dom.window.setTimeout(callback, 0);
			},
		},
	};
	const highlight = await toolkit.highlightText("q = qP", {
		scrollIntoView: false,
		exactOnly: true,
		allowApproximate: false,
	});
	assert.equal(highlight.fallback, "math-source");
	const highlighted = dom.window.document.querySelector("[data-onhand-highlight-kind]");
	assert.ok(highlighted?.classList.contains("MathJax_Display"), "expected delayed MathJax render target to be highlighted");
	assert.notEqual(highlighted?.id, "stationary", "raw TeX paragraph should not be highlighted");
}

async function assertImageRenderedMathMatchesTexAltSource() {
	// MediaWiki-style rendered math: hidden MathML for a11y plus a visible fallback
	// image whose alt carries the TeX source. There are no visible math text nodes.
	const { dom, toolkit } = await createToolkit(`
		<main>
			<p>
				Bayes' theorem is stated mathematically as the following equation:
				<span id="bayes-equation" class="mwe-math-element">
					<span class="mwe-math-mathml-inline" style="display: none;">
						<math xmlns="http://www.w3.org/1998/Math/MathML" alttext="{\\displaystyle P(A\\vert B)={\\frac {P(B\\vert A)P(A)}{P(B)}}}">
							<semantics>
								<mrow><mi>P</mi><mo>(</mo><mi>A</mi><mo>|</mo><mi>B</mi><mo>)</mo></mrow>
								<annotation encoding="application/x-tex">{\\displaystyle P(A\\vert B)={\\frac {P(B\\vert A)P(A)}{P(B)}}}</annotation>
							</semantics>
						</math>
					</span>
					<img src="https://render.example/svg/abc" aria-hidden="true" alt="{\\displaystyle P(A\\vert B)={\\frac {P(B\\vert A)P(A)}{P(B)}}}">
				</span>
			</p>
		</main>
	`);
	const highlight = await toolkit.highlightText("P(A|B) = P(B|A)P(A)/P(B)", {
		scrollIntoView: false,
		exactOnly: true,
		allowApproximate: false,
	});
	assert.equal(highlight.kind, "block", "image-rendered math should use a block highlight");
	assert.equal(highlight.fallback, "math-source", "image alt TeX should count as math source");
	const highlighted = dom.window.document.querySelector("[data-onhand-highlight-kind]");
	assert.equal(highlighted?.id, "bayes-equation", "the math wrapper should carry the highlight, not the prose paragraph");
}

async function assertRenderedMathPageDoesNotWaitForMathJaxEngine() {
	// Pages whose math is already rendered (MathML + fallback images) but whose
	// annotation TeX looks like raw source must not sit in the wait-for-MathJax
	// loops — background tabs throttle timers to ~1s, which used to burn the
	// entire highlight tool budget before matching even started.
	const { toolkit } = await createToolkit(`
		<main>
			<p>
				The chain rule expands the joint distribution into conditionals.
				<span class="mwe-math-element">
					<span style="display: none;">
						<math alttext="{\\displaystyle {\\begin{aligned}P(A,B)&=P(A|B)P(B)\\end{aligned}}}">
							<semantics>
								<mrow><mi>P</mi></mrow>
								<annotation encoding="application/x-tex">{\\displaystyle {\\begin{aligned}P(A,B)&amp;=P(A|B)P(B)\\end{aligned}}}</annotation>
							</semantics>
						</math>
					</span>
					<img src="https://render.example/svg/chain" alt="{\\displaystyle {\\begin{aligned}P(A,B)&amp;=P(A|B)P(B)\\end{aligned}}}">
				</span>
			</p>
		</main>
	`);
	const startedAt = Date.now();
	const highlight = await toolkit.highlightText("The chain rule expands the joint distribution into conditionals.", {
		scrollIntoView: false,
	});
	const elapsedMs = Date.now() - startedAt;
	assert.match(highlight.matchedText, /chain rule expands/, "prose on a rendered-math page should highlight");
	assert.ok(elapsedMs < 1500, `highlight should not wait for a MathJax engine on rendered-math pages (took ${elapsedMs}ms)`);
}

async function assertImageRenderedMathIgnoresUnrelatedImageAlt() {
	const { toolkit } = await createToolkit(`
		<main>
			<p>An article about probability pioneers.</p>
			<img src="https://images.example/portrait" alt="Portrait of a mathematician (1701-1761)">
		</main>
	`);
	await assert.rejects(
		() => toolkit.highlightText("P(H|E) = P(E|H)P(H)/P(E)", { scrollIntoView: false, exactOnly: true, allowApproximate: false }),
		/No visible text matched/i,
		"non-matching image alt text should not produce a math highlight",
	);
}

async function assertSentenceSpanningFootnoteMarkerMatchesExactly() {
	// Footnote/citation markers render inside the prose text stream but are stripped
	// from readable extractions, so copied sentences that span them must still match.
	const { dom, toolkit } = await createToolkit(`
		<main>
			<p>
				The posterior probability follows from the definition of conditional probability.<sup class="reference"><a href="#cite_note-1"><span>[</span>1<span>]</span></a></sup>
				This symmetry gives the standard statement of the result.<sup role="doc-noteref"><a href="#fn-2">[note 2]</a></sup>
				The remainder of the section works an example.
			</p>
		</main>
	`);
	const highlight = await toolkit.highlightText(
		"definition of conditional probability. This symmetry gives the standard statement of the result.",
		{ scrollIntoView: false, exactOnly: true, allowApproximate: false },
	);
	assert.equal(highlight.approximate, false, "sentence spanning a citation marker should exact-match");
	assert.match(highlight.matchedText, /conditional probability/, "matched text should cover the copied span");
	assert.match(highlight.matchedText, /statement of the result/, "matched text should cover the second sentence");
	assert.ok(
		dom.window.document.querySelector("[data-onhand-highlight-kind]"),
		"a durable highlight should exist after matching across the citation marker",
	);
}

async function assertCitationMarkerInQueryStillMatches() {
	// Readable extraction keeps bracketed footnote markers while the page text
	// map skips them; copied text that includes the marker must still match.
	const { toolkit } = await createToolkit(`
		<main>
			<p>Interest in the topic revived in the twentieth century.<sup class="reference"><a href="#cite_note-15">[15]</a></sup> Later editions expanded the treatment considerably.</p>
		</main>
	`);
	const highlight = await toolkit.highlightText(
		"Interest in the topic revived in the twentieth century.[15] Later editions expanded the treatment considerably.",
		{ scrollIntoView: false, exactOnly: true, allowApproximate: false },
	);
	assert.equal(highlight.fallback, "citation-stripped-text", "marker-stripped query should exact-match against the marker-free map");
	assert.match(highlight.matchedText, /Later editions expanded/, "match should span across the citation marker");
}

async function assertExistingInlineHighlightDoesNotBlockLongerExactMatch() {
	// A partial highlight left by an earlier attempt or turn must not make the
	// surrounding sentence unmatchable — inline highlight spans wrap original
	// page text, so longer overlapping spans still need to exact-match.
	const { dom, toolkit } = await createToolkit(`
		<main>
			<p>The posterior may be derived from the relation between joint and conditional probabilities. A worked example follows.</p>
		</main>
	`);
	await toolkit.highlightText("may be derived from the relation", { scrollIntoView: false });
	const highlight = await toolkit.highlightText(
		"The posterior may be derived from the relation between joint and conditional probabilities.",
		{ scrollIntoView: false, exactOnly: true, allowApproximate: false, reuseExisting: true },
	);
	assert.equal(highlight.approximate, false, "overlapping longer span should exact-match despite the existing highlight");
	assert.match(highlight.matchedText, /joint and conditional probabilities/, "the full sentence should be covered");
	assert.ok(dom.window.document.querySelectorAll("[data-onhand-highlight-kind]").length >= 1, "highlights should exist");
}

async function assertMeaningfulSuperscriptTextStillMatches() {
	const { toolkit } = await createToolkit(`
		<main>
			<p>The runtime grows as n<sup>2</sup> in the worst case.</p>
		</main>
	`);
	const highlight = await toolkit.highlightText("grows as n2 in the worst case", { scrollIntoView: false });
	assert.match(highlight.matchedText, /grows as n2 in the worst case/i, "plain exponent superscripts should stay matchable");
}

async function assertPdfTextLayerVisibleTextUsesPdfSurface() {
	const { toolkit } = await createToolkit(`
		<main id="viewer" class="pdfViewer">
			<div class="page" data-page-number="3">
				<div class="canvasWrapper"></div>
				<div class="textLayer">
					<span>Recurrent</span>
					<span> neural networks</span>
					<span> preserve sequence state.</span>
				</div>
			</div>
		</main>
	`);
	const surface = toolkit.getAnnotationSurfaceInfo();
	assert.equal(surface.surface, "pdf");
	assert.equal(surface.viewer, "pdfjs");
	assert.equal(surface.pageCount, 1);

	const visible = toolkit.getVisibleText({ maxChars: 1000 });
	assert.equal(visible.surface, "pdf");
	assert.equal(visible.viewer, "pdfjs");
	assert.equal(visible.blocks.length, 1);
	assert.equal(visible.blocks[0].tag, "pdf-page");
	assert.equal(visible.blocks[0].pageNumber, 3);
	assert.match(visible.text, /\[p\. 3\] Recurrent neural networks preserve sequence state\./);
}

async function assertPdfDocumentIdentityUsesEmbeddedPdfUrl() {
	const { toolkit } = await createToolkit(`
		<title>Wrapped PDF Lecture</title>
		<embed type="application/pdf" src="/files/lecture.pdf?download=1#page=3">
		<main id="viewer" class="pdfViewer">
			<div class="page" data-page-number="3">
				<div class="textLayer">
					<span>Recurrent neural networks preserve sequence state.</span>
				</div>
			</div>
		</main>
	`);
	const surface = toolkit.getAnnotationSurfaceInfo();
	assert.equal(surface.surface, "pdf");
	assert.equal(surface.viewer, "pdfjs");
	assert.equal(surface.url, "https://example.test/article");
	assert.equal(surface.viewerUrl, "https://example.test/article");
	assert.equal(surface.pdfUrl, "https://example.test/files/lecture.pdf?download=1#page=3");

	const highlight = await toolkit.highlightText("recurrent neural networks", { scrollIntoView: false });
	assert.equal(highlight.kind, "pdf");
	assert.equal(highlight.pdfAnchor.document.url, "https://example.test/files/lecture.pdf?download=1#page=3");
	assert.equal(highlight.pdfAnchor.document.pdfUrl, "https://example.test/files/lecture.pdf?download=1#page=3");
	assert.equal(highlight.pdfAnchor.document.viewerUrl, "https://example.test/article");
	assert.equal(highlight.pdfAnchor.document.title, "Wrapped PDF Lecture");
}

async function assertPdfDocumentIdentityUsesViewerFileParameter() {
	const { toolkit } = await createToolkitAtUrl(
		`
			<title>PDF.js Wrapped Lecture</title>
			<main id="viewer" class="pdfViewer">
				<div class="page" data-page-number="7">
					<div class="textLayer">
						<span>Recurrent neural networks preserve sequence state.</span>
					</div>
				</div>
			</main>
		`,
		"https://example.test/pdfjs/web/viewer.html?file=%2Ffiles%2Flecture.pdf%3Fdownload%3D1%23page%3D7",
	);
	const surface = toolkit.getAnnotationSurfaceInfo();
	assert.equal(surface.surface, "pdf");
	assert.equal(surface.viewer, "pdfjs");
	assert.equal(surface.viewerUrl, "https://example.test/pdfjs/web/viewer.html?file=%2Ffiles%2Flecture.pdf%3Fdownload%3D1%23page%3D7");
	assert.equal(surface.pdfUrl, "https://example.test/files/lecture.pdf?download=1#page=7");

	const highlight = await toolkit.highlightText("recurrent neural networks", { scrollIntoView: false });
	assert.equal(highlight.kind, "pdf");
	assert.equal(highlight.pdfAnchor.document.url, "https://example.test/files/lecture.pdf?download=1#page=7");
	assert.equal(highlight.pdfAnchor.document.pdfUrl, "https://example.test/files/lecture.pdf?download=1#page=7");
	assert.equal(highlight.pdfAnchor.document.viewerUrl, "https://example.test/pdfjs/web/viewer.html?file=%2Ffiles%2Flecture.pdf%3Fdownload%3D1%23page%3D7");
}

async function assertLikelyPdfTabUrlCoversContentTypePdfRoutes() {
	const functionSource = await loadBackgroundFunction("isLikelyPdfTabUrl");
	const isLikelyPdfTabUrl = (0, eval)(`(${functionSource})`);
	assert.equal(isLikelyPdfTabUrl("https://example.test/files/lecture.pdf"), true);
	assert.equal(isLikelyPdfTabUrl("https://example.test/viewer?file=%2Ffiles%2Flecture.pdf%23page%3D2"), true);
	assert.equal(isLikelyPdfTabUrl("https://arxiv.org/pdf/1706.03762"), true);
	assert.equal(isLikelyPdfTabUrl("https://example.test/download?format=pdf"), true);
	assert.equal(isLikelyPdfTabUrl("https://example.test/article"), false);
	assert.equal(isLikelyPdfTabUrl("https://example.test/profile/pdfshelf"), false);
}

async function assertReaderFrameFallbackDiagnosticsSurviveDebuggerFallback() {
	const sources = await Promise.all([
		loadBackgroundFunction("isUnsupportedPdfSurfacePayload"),
		loadBackgroundFunction("shouldRetryGoogleScholarReaderFrame"),
		loadBackgroundFunction("annotateGoogleScholarReaderFrameFallbackFailure"),
		loadBackgroundFunction("annotateGoogleScholarReaderFrameFallbackFailureIfRelevant"),
	]);
	const { annotateGoogleScholarReaderFrameFallbackFailureIfRelevant } = (0, eval)(
		`(() => { ${sources.join("\n")} return { annotateGoogleScholarReaderFrameFallbackFailureIfRelevant }; })()`,
	);
	const error = new Error("No Google Scholar PDF Reader frame context found");
	const unsupported = annotateGoogleScholarReaderFrameFallbackFailureIfRelevant(
		"getVisibleText",
		{ surface: "pdf", viewer: "google-scholar", unsupported: true },
		error,
	);
	assert.equal(unsupported.readerFrameFallback.attempted, true);
	assert.equal(unsupported.readerFrameFallback.ok, false);
	assert.match(unsupported.readerFrameFallback.error, /No Google Scholar PDF Reader frame context found/);

	const emptySelection = annotateGoogleScholarReaderFrameFallbackFailureIfRelevant(
		"getSelectionInfo",
		{ hasSelection: false, surface: "pdf", viewer: "google-scholar" },
		error,
	);
	assert.equal(emptySelection.readerFrameFallback.attempted, true);

	const htmlPayload = { surface: "html", blocks: [] };
	assert.equal(annotateGoogleScholarReaderFrameFallbackFailureIfRelevant("getVisibleText", htmlPayload, error), htmlPayload);
	assert.equal(annotateGoogleScholarReaderFrameFallbackFailureIfRelevant("getVisibleText", unsupported, null), unsupported);
}

async function assertGenericPdfReaderPageRegionUsesPdfSurfaceOnlyWithPdfSignal() {
	const { toolkit } = await createToolkit(`
		<title>Google Scholar PDF Reader</title>
		<main>
			<section role="region" aria-label="Page 4" data-page-index="3">
				<div class="scholar-selectable-text">
					<span>Recurrent neural networks preserve sequence state.</span>
				</div>
			</section>
		</main>
	`);
	const surface = toolkit.getAnnotationSurfaceInfo();
	assert.equal(surface.surface, "pdf");
	assert.equal(surface.viewer, "google-scholar");
	assert.equal(surface.pageCount, 1);

	const visible = toolkit.getVisibleText({ maxChars: 1000 });
	assert.equal(visible.surface, "pdf");
	assert.equal(visible.blocks[0].pageNumber, 4);
	assert.match(visible.text, /\[p\. 4\] Recurrent neural networks preserve sequence state\./);

	const highlight = await toolkit.highlightText("recurrent neural networks", { scrollIntoView: false });
	assert.equal(highlight.kind, "pdf");
	assert.equal(highlight.viewer, "google-scholar");
	assert.equal(highlight.pdfAnchor.pageNumber, 4);
	assert.equal(highlight.pdfAnchor.textQuote.exact, "Recurrent neural networks");
}

async function assertGenericPdfReaderFallbackIgnoresOnhandOverlayText() {
	const { toolkit } = await createToolkit(`
		<title>Google Scholar PDF Reader</title>
		<main>
			<section role="region" aria-label="Page 4" data-page-index="3">
				<div class="scholar-selectable-text">
					<span>Recurrent neural networks preserve sequence state.</span>
				</div>
			</section>
		</main>
	`);
	const highlight = await toolkit.highlightText("recurrent neural networks", { scrollIntoView: false });
	await toolkit.showNote(highlight.annotationId, "RNNs carry state across a sequence.", { scrollIntoView: false });

	const visible = toolkit.getVisibleText({ maxChars: 1000 });
	assert.equal(visible.surface, "pdf");
	assert.match(visible.text, /\[p\. 4\] Recurrent neural networks preserve sequence state\./);
	assert.doesNotMatch(visible.text, /RNNs carry state across a sequence/);

	await assert.rejects(
		() => toolkit.highlightText("RNNs carry state across a sequence", { scrollIntoView: false }),
		/No visible PDF text matched/i,
		"Onhand PDF note text should not be searchable as source PDF text",
	);

	const secondHighlight = await toolkit.highlightText("preserve sequence state", { scrollIntoView: false });
	assert.equal(secondHighlight.kind, "pdf");
	assert.equal(secondHighlight.pdfAnchor.pageNumber, 4);
	assert.equal(secondHighlight.pdfAnchor.textQuote.exact, "preserve sequence state");
}

async function assertScholarNativeAnnotationsStaySeparateFromOnhandPdfState() {
	const { dom, toolkit } = await createToolkit(`
		<title>Google Scholar PDF Reader</title>
		<main>
			<section role="region" aria-label="Page 6" data-page-index="5">
				<div class="scholar-selectable-text">
					<span class="scholar-native-highlight">Recurrent neural networks</span>
					<span> preserve sequence state across tokens.</span>
				</div>
				<div class="scholar-native-comment-popup" role="dialog" aria-label="Scholar comment">
					<p>Native Scholar note should not become source PDF text.</p>
					<button type="button">Delete comment</button>
				</div>
				<div class="scholar-toolbar" role="toolbar" aria-label="Scholar annotation toolbar">
					<button type="button">Highlight</button>
					<button type="button">Comment</button>
				</div>
			</section>
		</main>
	`);
	const document = dom.window.document;
	const nativeComment = document.querySelector(".scholar-native-comment-popup");
	const nativeToolbar = document.querySelector(".scholar-toolbar");

	const visible = toolkit.getVisibleText({ maxChars: 1000 });
	assert.equal(visible.surface, "pdf");
	assert.match(visible.text, /\[p\. 6\] Recurrent neural networks preserve sequence state across tokens\./);
	assert.doesNotMatch(visible.text, /Native Scholar note/);
	assert.doesNotMatch(visible.text, /Delete comment/);
	assert.doesNotMatch(visible.text, /Highlight Comment/);

	const initialCapture = await toolkit.captureState();
	assert.equal(initialCapture.annotationCount, 0, "native Scholar annotations should not be captured as Onhand annotations");

	await assert.rejects(
		() => toolkit.highlightText("Native Scholar note should not become source PDF text", { scrollIntoView: false }),
		/No visible PDF text matched/i,
		"native Scholar comments should not be searchable as source PDF text",
	);

	const highlight = await toolkit.highlightText("Recurrent neural networks", { scrollIntoView: false });
	assert.equal(highlight.kind, "pdf");
	assert.equal(highlight.viewer, "google-scholar");
	assert.equal(highlight.pdfAnchor.pageNumber, 6);
	assert.equal(highlight.pdfAnchor.textQuote.exact, "Recurrent neural networks");
	await toolkit.showNote(highlight.annotationId, "Onhand note text stays in the Onhand overlay only.", { scrollIntoView: false });

	const onhandCapture = await toolkit.captureState();
	assert.equal(onhandCapture.annotationCount, 1);
	assert.equal(onhandCapture.annotations[0].kind, "pdf");
	assert.equal(onhandCapture.annotations[0].note.text, "Onhand note text stays in the Onhand overlay only.");

	const cleared = toolkit.clearAnnotations();
	assert.equal(cleared.clearedPdf, 1);
	assert.equal(cleared.clearedNotes, 1);
	assert.ok(document.body.contains(nativeComment), "clearing Onhand annotations should not remove native Scholar comments");
	assert.ok(document.body.contains(nativeToolbar), "clearing Onhand annotations should not remove native Scholar toolbar UI");
	assert.equal(document.querySelectorAll('[data-onhand-highlight-kind], [data-onhand-note-kind="card"]').length, 0);
}

async function assertControlledScholarPdfFixtureMatchesAdapterContract() {
	const { dom, toolkit } = await createToolkitAtUrl(
		scholarPdfHtml,
		"https://example.test/scholar-pdf.html?file=%2Ffixtures%2Fscholar-reader.pdf",
	);
	const document = dom.window.document;
	const surface = toolkit.getAnnotationSurfaceInfo();
	assert.equal(surface.surface, "pdf");
	assert.equal(surface.viewer, "google-scholar");
	assert.equal(surface.pdfUrl, "https://example.test/fixtures/scholar-reader.pdf");
	assert.equal(surface.pageCount, 1);

	const visible = toolkit.getVisibleText({ maxChars: 1000 });
	assert.equal(visible.surface, "pdf");
	assert.match(visible.text, /\[p\. 4\] CS 577: Natural Language Processing/);
	assert.match(visible.text, /Recurrent neural networks preserve sequence state across tokens/);
	assert.doesNotMatch(visible.text, /Native Scholar note should not become source PDF text/);
	assert.doesNotMatch(visible.text, /Yellow highlight/);

	const nativeComment = document.querySelector(".scholar-native-comment-popup");
	const nativeToolbar = document.querySelector(".scholar-toolbar");
	const highlight = await toolkit.highlightText("Recurrent neural networks", { scrollIntoView: false });
	assert.equal(highlight.kind, "pdf");
	assert.equal(highlight.viewer, "google-scholar");
	assert.equal(highlight.pdfAnchor.pageNumber, 4);
	await toolkit.showNote(highlight.annotationId, "Onhand note stays separate from native Scholar comments.", { scrollIntoView: false });

	const capture = await toolkit.captureState();
	assert.equal(capture.annotationCount, 1);
	assert.equal(capture.annotations[0].kind, "pdf");
	assert.equal(capture.annotations[0].note.text, "Onhand note stays separate from native Scholar comments.");
	assert.ok(document.body.contains(nativeComment), "native Scholar comment should remain in the page");
	assert.ok(document.body.contains(nativeToolbar), "native Scholar toolbar should remain in the page");
}

async function assertGoogleScholarReaderDomMatchesAdapterContract() {
	const { dom, toolkit } = await createToolkitAtUrl(
		`
		<!doctype html>
		<title>Google Scholar Reader</title>
		<body>
			<div class="gsr-root">
				<div class="gsr-toolbar" role="toolbar" aria-label="Google Scholar PDF Reader toolbar">
					<button type="button" aria-label="Highlight">Highlight</button>
					<button type="button" aria-label="Comment">Comment</button>
				</div>
				<div class="gsr-body">
					<div class="gsr-content-wrapper">
						<div class="gsr-page-wrapper">
							<div class="gsr-page" data-pn="7" style="position:relative;width:640px;height:880px">
								<div class="gsr-page-ps"></div>
								<div class="gsr-text-ctn" dir="ltr">
									<span class="gsr-text" data-idx="0">Real Reader text layer exposes recurrent neural networks.</span>
									<span class="gsr-text" data-idx="1">Onhand should anchor against this actual Google Scholar Reader DOM.</span>
								</div>
								<div class="gsr-comment-bubble" role="dialog">
									<div class="gsr-comment-hl-text">Native Scholar note should not become source PDF text.</div>
									<div class="gsr-comment-text" contenteditable="plaintext-only">Native comment body</div>
								</div>
							</div>
						</div>
						<div class="gsr-comment-wrapper"></div>
					</div>
				</div>
			</div>
		</body>
		`,
		"chrome-extension://dahenjhkoodjbpjheillcadbppiidmhp/reader.html",
	);
	const document = dom.window.document;
	const surface = toolkit.getAnnotationSurfaceInfo();
	assert.equal(surface.surface, "pdf");
	assert.equal(surface.viewer, "google-scholar");
	assert.equal(surface.pageCount, 1);

	const visible = toolkit.getVisibleText({ maxChars: 1000 });
	assert.equal(visible.surface, "pdf");
	assert.match(visible.text, /\[p\. 7\] Real Reader text layer exposes recurrent neural networks/);
	assert.doesNotMatch(visible.text, /Native Scholar note/);

	const highlight = await toolkit.highlightText("recurrent neural networks", { scrollIntoView: false });
	assert.equal(highlight.kind, "pdf");
	assert.equal(highlight.viewer, "google-scholar");
	assert.equal(highlight.pdfAnchor.pageNumber, 7);
	await toolkit.showNote(highlight.annotationId, "Onhand note belongs to the real Reader DOM.", { scrollIntoView: false });
	assert.ok(document.querySelector('[data-onhand-highlight-kind="pdf"]'), "expected Onhand PDF overlay highlight");
	assert.ok(document.querySelector('[data-onhand-note-kind="card"]'), "expected Onhand PDF note");
	assert.ok(document.querySelector(".gsr-comment-bubble"), "native Scholar comment bubble should remain");
}

async function assertGenericPageRegionWithoutPdfSignalStaysHtmlSurface() {
	const { toolkit } = await createToolkit(`
		<main>
			<section role="region" aria-label="Page 1">
				<p>Normal article text that should not be treated as a PDF page.</p>
			</section>
		</main>
	`);
	const surface = toolkit.getAnnotationSurfaceInfo();
	assert.equal(surface.surface, "html");
	assert.equal(surface.viewer, "html");
}

async function assertPdfEmbedWithoutTextLayerReturnsUnsupportedInsteadOfHtmlFallback() {
	const { toolkit } = await createToolkit(`
		<main>
			<h1>Wrapper page text that should not be highlighted as PDF source</h1>
			<embed type="application/pdf" src="lecture.pdf">
		</main>
	`);
	const surface = toolkit.getAnnotationSurfaceInfo();
	assert.equal(surface.surface, "pdf");
	assert.equal(surface.viewer, "unknown-pdf");
	assert.equal(surface.hasTextLayer, false);
	assert.equal(surface.pdfUrl, "https://example.test/lecture.pdf");
	assert.match(surface.unsupportedReason, /no readable text layer/i);

	const visible = toolkit.getVisibleText({ maxChars: 1000 });
	assert.equal(visible.surface, "pdf");
	assert.equal(visible.unsupported, true);
	assert.equal(visible.blocks.length, 0);
	assert.match(visible.text, /does not expose selectable page text/i);
	assert.doesNotMatch(visible.text, /Wrapper page text/);

	await assert.rejects(
		() => toolkit.highlightText("Wrapper page text", { scrollIntoView: false }),
		/Unsupported PDF annotation surface/i,
		"PDF surfaces without readable text should not silently fall back to HTML highlighting",
	);

	const { toolkit: topPdfToolkit } = await createToolkitAtUrl(
		`
		<body>
			<iframe src="chrome-extension://dahenjhkoodjbpjheillcadbppiidmhp/reader.html"></iframe>
		</body>
		`,
		"https://example.test/lecture.pdf",
	);
	const topSurface = topPdfToolkit.getAnnotationSurfaceInfo();
	assert.equal(topSurface.surface, "pdf");
	assert.equal(topSurface.hasTextLayer, false);
	assert.match(topSurface.unsupportedReason, /no readable text layer/i);

	const { toolkit: nativePdfShellToolkit } = await createToolkitAtUrl(
		`
		<body></body>
		`,
		"https://arxiv.org/pdf/2509.03345",
	);
	const nativePdfShellSurface = nativePdfShellToolkit.getAnnotationSurfaceInfo();
	assert.equal(nativePdfShellSurface.surface, "pdf");
	assert.equal(nativePdfShellSurface.viewer, "unknown-pdf");
	assert.equal(nativePdfShellSurface.hasTextLayer, false);
	assert.match(nativePdfShellSurface.unsupportedReason, /no readable text layer/i);
	const nativePdfShellVisible = nativePdfShellToolkit.getVisibleText({ maxChars: 1000 });
	assert.equal(nativePdfShellVisible.unsupported, true);
	assert.equal(nativePdfShellVisible.blocks.length, 0);
	assert.match(nativePdfShellVisible.text, /does not expose selectable page text/i);
	await assert.rejects(
		() => nativePdfShellToolkit.highlightText("Do Language Models Follow Occam", { scrollIntoView: false }),
		/Unsupported PDF annotation surface/i,
		"Chrome native PDF shells without DOM text should remain unsupported instead of using approximate HTML matching",
	);

	const { toolkit: nonPdfUrlReaderWrapperToolkit } = await createToolkitAtUrl(
		`
		<body>
			<main>Wrapper page text should not become source text for a content-type PDF.</main>
			<iframe src="chrome-extension://dahenjhkoodjbpjheillcadbppiidmhp/reader.html"></iframe>
		</body>
		`,
		"https://arxiv.org/pdf/1706.03762",
	);
	const readerWrapperSurface = nonPdfUrlReaderWrapperToolkit.getAnnotationSurfaceInfo();
	assert.equal(readerWrapperSurface.surface, "pdf");
	assert.equal(readerWrapperSurface.viewer, "google-scholar");
	assert.equal(readerWrapperSurface.hasTextLayer, false);
	assert.equal(readerWrapperSurface.pdfUrl, "https://arxiv.org/pdf/1706.03762");
	assert.equal(readerWrapperSurface.viewerUrl, "https://arxiv.org/pdf/1706.03762");
	assert.match(readerWrapperSurface.unsupportedReason, /no readable text layer/i);
	const readerWrapperVisible = nonPdfUrlReaderWrapperToolkit.getVisibleText({ maxChars: 1000 });
	assert.equal(readerWrapperVisible.unsupported, true);
	assert.equal(readerWrapperVisible.viewer, "google-scholar");
	assert.equal(readerWrapperVisible.pdfUrl, "https://arxiv.org/pdf/1706.03762");
	assert.doesNotMatch(readerWrapperVisible.text, /Wrapper page text/);
}

async function assertGoogleScholarReaderFrameUsesTopTabUrlForPdfIdentity() {
	const topPdfUrl = "https://arxiv.org/pdf/1706.03762";
	const topPdfTitle = "Attention Is All You Need";
	const { toolkit } = await createToolkitAtUrl(
		`
		<!doctype html>
		<title>Google Scholar Reader</title>
		<body>
			<div class="gsr-root">
				<div class="gsr-body">
					<div class="gsr-content-wrapper">
						<div class="gsr-page-wrapper">
							<div class="gsr-page" data-pn="2" style="position:relative;width:640px;height:880px">
								<div class="gsr-text-ctn" dir="ltr">
									<span class="gsr-text" data-idx="0">Scaled dot-product attention computes weighted value vectors.</span>
								</div>
							</div>
						</div>
						<div class="gsr-comment-wrapper"></div>
					</div>
				</div>
			</div>
		</body>
		`,
		"chrome-extension://dahenjhkoodjbpjheillcadbppiidmhp/reader.html",
		{ sourceTabUrl: topPdfUrl, sourceTabTitle: topPdfTitle },
	);
	const surface = toolkit.getAnnotationSurfaceInfo();
	assert.equal(surface.surface, "pdf");
	assert.equal(surface.viewer, "google-scholar");
	assert.equal(surface.url, topPdfUrl);
	assert.equal(surface.viewerUrl, topPdfUrl);
	assert.equal(surface.pdfUrl, topPdfUrl);
	assert.equal(surface.title, topPdfTitle);

	const visible = toolkit.getVisibleText({ maxChars: 1000 });
	assert.equal(visible.url, topPdfUrl);
	assert.equal(visible.viewerUrl, topPdfUrl);
	assert.equal(visible.pdfUrl, topPdfUrl);
	assert.equal(visible.title, topPdfTitle);
	assert.match(visible.text, /\[p\. 2\] Scaled dot-product attention/);

	const highlight = await toolkit.highlightText("Scaled dot-product attention", { scrollIntoView: false });
	assert.equal(highlight.kind, "pdf");
	assert.equal(highlight.pdfAnchor.document.url, topPdfUrl);
	assert.equal(highlight.pdfAnchor.document.viewerUrl, topPdfUrl);
	assert.equal(highlight.pdfAnchor.document.pdfUrl, topPdfUrl);
	assert.equal(highlight.pdfAnchor.document.title, topPdfTitle);
}

async function assertPdfHighlightAndNoteUseOverlayAnchors() {
	const { dom, toolkit } = await createToolkit(`
		<main id="viewer" class="pdfViewer">
			<div class="page" data-page-number="5">
				<div class="canvasWrapper"></div>
				<div class="textLayer">
					<span>The important phrase is </span>
					<span>recurrent neural networks</span>
					<span> in sequence models.</span>
				</div>
			</div>
		</main>
	`);
	const page = dom.window.document.querySelector(".page");
	const textSpans = Array.from(dom.window.document.querySelectorAll(".textLayer span"));
	setElementRect(page, { left: 0, top: 0, width: 600, height: 800 });
	Object.defineProperties(page, {
		clientWidth: { value: 600, configurable: true },
		clientHeight: { value: 800, configurable: true },
	});
	setElementRect(textSpans[0], { left: 150, top: 230, width: 190, height: 24 });
	setElementRect(textSpans[1], { left: 340, top: 230, width: 210, height: 24 });
	setElementRect(textSpans[2], { left: 150, top: 260, width: 300, height: 24 });

	const highlight = await toolkit.highlightText("recurrent neural networks", { scrollIntoView: false });
	assert.equal(highlight.kind, "pdf");
	assert.equal(highlight.surface, "pdf");
	assert.equal(highlight.pdfAnchor.pageNumber, 5);
	assert.equal(highlight.pdfAnchor.textQuote.exact, "recurrent neural networks");
	assert.equal(highlight.pdfAnchor.rects[0].coordinateSpace, "page-normalized");

	const overlay = dom.window.document.querySelector('[data-onhand-highlight-kind="pdf"]');
	assert.ok(overlay, "expected an Onhand PDF highlight overlay");
	assert.equal(overlay.getAttribute("data-onhand-annotation-id"), highlight.annotationId);
	assert.equal(overlay.getAttribute("data-onhand-matched-text"), "recurrent neural networks");
	assert.equal(overlay.style.getPropertyPriority("width"), "important");
	setElementRect(overlay, { left: 340, top: 230, width: 210, height: 24 });

	const noteResult = await toolkit.showNote(highlight.annotationId, "RNNs carry state across a sequence.", { scrollIntoView: false });
	assert.equal(noteResult.pdfAnchor.pageNumber, highlight.pdfAnchor.pageNumber, "PDF note results should carry the source page anchor");
	assert.equal(noteResult.pdfAnchor.matchedText, highlight.pdfAnchor.matchedText, "PDF note results should carry the source text anchor");
	assert.deepEqual(noteResult.pdfAnchor.rects, highlight.pdfAnchor.rects, "PDF note results should carry the source rect anchor");
	const note = dom.window.document.querySelector('[data-onhand-note-kind="card"]');
	assert.ok(note, "expected PDF highlight to support an Onhand note card");
	assert.equal(note.getAttribute("data-onhand-note-for"), highlight.annotationId);
	assert.ok(note.closest("[data-onhand-pdf-overlay-layer]"), "PDF note should live in the Onhand overlay layer");
	assert.equal(note.style.getPropertyPriority("position"), "important");
	assert.equal(dom.window.getComputedStyle(note).position, "absolute");
	assert.equal(note.style.getPropertyPriority("width"), "important");
	assert.equal(note.style.display, "block", "expanded PDF notes should start in the same block layout used after reopen");
	assert.equal(note.style.height, "auto", "expanded PDF notes should not keep collapsed marker height");
	assert.equal(note.style.minHeight, "76px", "expanded PDF notes should have enough breathing room on first restore");
	assert.equal(note.style.padding, "12px 14px", "expanded PDF notes should start with normal card padding");
	assert.equal(note.style.overflow, "visible", "expanded PDF notes should not clip the note body");
	assert.equal(note.style.getPropertyPriority("pointer-events"), "important");
	assert.equal(note.style.pointerEvents, "auto", "PDF note card should remain interactive");
	assertPassivePdfHighlightElement(overlay, "PDF highlight overlay after note");
	assert.ok(
		Number.parseFloat(note.style.top) + 76 < 230,
		`expanded PDF notes should prefer available whitespace over covering adjacent PDF text; got top=${note.style.top}`,
	);
	const toggle = note.querySelector("[data-onhand-note-toggle]");
	const noteBody = note.querySelector('[data-onhand-note-part="body"]');
	assert.ok(toggle, "PDF note should have a collapse toggle");
	assert.ok(noteBody, "PDF note should keep its body element");
	toggle.click();
	assert.equal(note.getAttribute("data-onhand-note-collapsed"), "true", "PDF note toggle should collapse the note");
	assert.equal(noteBody.hidden, true, "collapsed PDF notes should hide their body text");
	assert.equal(note.style.width, "30px", "collapsed PDF notes should shrink to a small marker");
	assert.equal(note.style.minHeight, "30px", "collapsed PDF notes should not keep the expanded card minimum height");
	assert.equal(note.style.opacity, "0.48", "collapsed PDF notes should be translucent over PDF text");

	const collapsedCapture = await toolkit.captureState();
	assert.equal(collapsedCapture.annotations[0].note.text, "RNNs carry state across a sequence.", "collapsed PDF notes should still be captured");

	overlay.click();
	assert.equal(note.getAttribute("data-onhand-note-collapsed"), "true", "clicking the highlight should not reopen the PDF note");
	assert.equal(noteBody.hidden, true, "highlight clicks should leave collapsed PDF note bodies hidden");
	assert.equal(note.style.opacity, "0.48", "highlight clicks should leave collapsed PDF notes translucent");
	note.click();
	assert.equal(note.getAttribute("data-onhand-note-collapsed"), "false", "clicking the note marker should reopen the note");
	assert.equal(noteBody.hidden, false, "reopened PDF notes should show their body text");
	assert.equal(note.style.opacity, "", "reopened PDF notes should not stay translucent");

	note.setAttribute("data-onhand-note-collapsed", "false");
	for (const [property, value] of [
		["display", "flex"],
		["align-items", "center"],
		["justify-content", "center"],
		["height", "30px"],
		["min-height", "30px"],
		["padding", "0"],
		["overflow", "hidden"],
		["opacity", "0.48"],
	]) {
		note.style.setProperty(property, value, "important");
	}
	dom.window.__onhandPdfOverlayMutationObserver?.disconnect?.();
	dom.window.dispatchEvent(new dom.window.Event("resize"));
	await new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
	assert.equal(note.style.display, "block", "PDF overlay sync should restore expanded block layout after stale collapsed display");
	assert.equal(note.style.height, "auto", "PDF overlay sync should restore expanded auto height after stale collapsed height");
	assert.equal(note.style.minHeight, "76px", "PDF overlay sync should restore expanded minimum height after stale collapsed minimum height");
	assert.equal(note.style.padding, "12px 14px", "PDF overlay sync should restore expanded card padding after stale collapsed padding");
	assert.equal(note.style.overflow, "visible", "PDF overlay sync should restore expanded overflow after stale collapsed clipping");
	assert.equal(note.style.opacity, "", "PDF overlay sync should clear stale collapsed opacity from expanded notes");

	toggle.click();
	const noteJump = await toolkit.scrollToAnnotation(highlight.annotationId, { target: "note", block: "center" });
	assert.equal(noteJump.targetKind, "note", "jumping to a note should target the note card");
	assert.equal(note.getAttribute("data-onhand-note-collapsed"), "false", "jumping to a note should reopen a collapsed PDF note");

	const captured = await toolkit.captureState();
	assert.equal(captured.annotationCount, 1);
	assert.equal(captured.annotations[0].kind, "pdf");
	assert.equal(captured.annotations[0].matchedText, "recurrent neural networks");
	assert.equal(captured.annotations[0].pdfAnchor.pageNumber, 5);
	assert.equal(captured.annotations[0].note.text, "RNNs carry state across a sequence.");

	toolkit.clearAnnotations();
	dom.window.document.querySelector(".textLayer").textContent = "The visible PDF text changed after capture.";
	const restored = await toolkit.highlightText("recurrent neural networks", {
		scrollIntoView: false,
		exactOnly: true,
		allowApproximate: false,
		pdfAnchor: captured.annotations[0].pdfAnchor,
	});
	assert.equal(restored.kind, "pdf");
	assert.equal(restored.fallback, "pdf-anchor");
	assert.equal(restored.pdfAnchor.pageNumber, 5);
	assert.equal(restored.pdfAnchor.textQuote.exact, "recurrent neural networks");
	assert.ok(dom.window.document.querySelector('[data-onhand-highlight-kind="pdf"]'), "expected PDF anchor restore to recreate overlay");

	await toolkit.showNote(restored.annotationId, "RNNs carry state across a sequence.", { scrollIntoView: false });
	const duplicate = await toolkit.highlightText("recurrent neural networks", {
		scrollIntoView: false,
		exactOnly: true,
		allowApproximate: false,
		pdfAnchor: captured.annotations[0].pdfAnchor,
	});
	await toolkit.showNote(duplicate.annotationId, "Duplicate replay note should be consolidated.", { scrollIntoView: false });
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-highlight-kind="pdf"]').length, 2, "test setup should reproduce stacked PDF highlights");
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-note-kind="card"]').length, 2, "test setup should reproduce stacked PDF notes");
	const replayed = await toolkit.highlightText("recurrent neural networks", {
		scrollIntoView: false,
		exactOnly: true,
		allowApproximate: false,
		reuseExisting: true,
		pdfAnchor: captured.annotations[0].pdfAnchor,
	});
	assert.equal(replayed.annotationId, restored.annotationId, "PDF saved-artifact replay should reuse the restored annotation");
	assert.equal(replayed.duplicateCount, 1, "PDF saved-artifact replay should remove stacked duplicate highlights");
	const replayedAgain = await toolkit.highlightText("recurrent neural networks", {
		scrollIntoView: false,
		exactOnly: true,
		allowApproximate: false,
		reuseExisting: true,
		pdfAnchor: captured.annotations[0].pdfAnchor,
	});
	assert.equal(replayedAgain.annotationId, restored.annotationId, "repeated PDF saved-artifact replay should stay idempotent");
	await toolkit.showNote(replayedAgain.annotationId, "RNNs carry state across a sequence.", { scrollIntoView: false });
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-highlight-kind="pdf"]').length, 1);
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-note-kind="card"]').length, 1);
}

async function assertPdfHighlightUsesTextOffsetsInsideSingleSpan() {
	const { dom, toolkit } = await createToolkit(`
		<main id="viewer" class="pdfViewer">
			<div class="page" data-page-number="2">
				<div class="canvasWrapper"></div>
				<div class="textLayer">
					<span id="single-line">The important phrase is recurrent neural networks.</span>
				</div>
			</div>
		</main>
	`);
	const page = dom.window.document.querySelector(".page");
	const span = dom.window.document.querySelector("#single-line");
	Object.defineProperties(page, {
		clientWidth: { value: 600, configurable: true },
		clientHeight: { value: 800, configurable: true },
	});
	setElementRect(page, { left: 0, top: 0, width: 600, height: 800 });
	setElementRect(span, { left: 120, top: 160, width: 480, height: 28 });
	const originalGetClientRects = dom.window.Range.prototype.getClientRects;
	dom.window.Range.prototype.getClientRects = function getClientRects() {
		return [fixedRect({ left: 120, top: 160, width: 480, height: 28 })];
	};
	try {
		const highlight = await toolkit.highlightText("recurrent neural networks", { scrollIntoView: false });
		const overlay = dom.window.document.querySelector('[data-onhand-highlight-kind="pdf"]');
		assert.ok(overlay, "expected a PDF highlight overlay");
		const fullText = "The important phrase is recurrent neural networks.";
		const prefixText = "The important phrase is ";
		const queryText = "recurrent neural networks";
		const expectedLeft = 120 + (prefixText.length / fullText.length) * 480;
		const expectedWidth = (queryText.length / fullText.length) * 480;
		assert.equal(Number.parseFloat(overlay.style.left).toFixed(3), expectedLeft.toFixed(3));
		assert.equal(Number.parseFloat(overlay.style.width).toFixed(3), expectedWidth.toFixed(3));
		assert.equal(highlight.pdfAnchor.textQuote.exact, queryText);
	} finally {
		dom.window.Range.prototype.getClientRects = originalGetClientRects;
	}
}

async function assertPdfWrappedLineHighlightMatchesExactly() {
	// pdf.js emits one positioned span per text item with no whitespace between
	// spans. Wrapped lines must read as word boundaries (the extraction the
	// model copies from separates them), while a kerning split inside one word
	// must keep gluing — geometry tells them apart.
	const { dom, toolkit } = await createToolkit(`
		<main id="viewer" class="pdfViewer">
			<div class="page" data-page-number="1">
				<div class="canvasWrapper"></div>
				<div class="textLayer"><span id="line-1">The longest chain not only serves as proof of the sequence of</span><span id="line-2">events witnessed, but proof of the largest pool of CPU po</span><span id="line-2-tail">wer available.</span></div>
			</div>
		</main>
	`);
	const page = dom.window.document.querySelector(".page");
	Object.defineProperties(page, {
		clientWidth: { value: 600, configurable: true },
		clientHeight: { value: 800, configurable: true },
	});
	setElementRect(page, { left: 0, top: 0, width: 600, height: 800 });
	setElementRect(dom.window.document.getElementById("line-1"), { left: 50, top: 100, width: 500, height: 20 });
	setElementRect(dom.window.document.getElementById("line-2"), { left: 50, top: 126, width: 460, height: 20 });
	// Same line as line-2, visually touching: a kerning split, not a word gap.
	setElementRect(dom.window.document.getElementById("line-2-tail"), { left: 510.5, top: 126, width: 90, height: 20 });
	const originalGetClientRects = dom.window.Range.prototype.getClientRects;
	dom.window.Range.prototype.getClientRects = function getClientRects() {
		return [fixedRect({ left: 50, top: 100, width: 500, height: 46 })];
	};
	try {
		const crossLine = await toolkit.highlightText("proof of the sequence of events witnessed", {
			scrollIntoView: false,
			exactOnly: true,
			allowApproximate: false,
		});
		assert.equal(crossLine.kind, "pdf", "cross-line span should highlight on the PDF surface");
		assert.equal(crossLine.fallback, undefined, "wrapped-line boundary should exact-match, not degrade to compact");

		const gluedWord = await toolkit.highlightText("pool of CPU power available", {
			scrollIntoView: false,
			exactOnly: true,
			allowApproximate: false,
		});
		assert.equal(gluedWord.fallback, undefined, "kerning-split word should stay glued and exact-match");
	} finally {
		dom.window.Range.prototype.getClientRects = originalGetClientRects;
	}
}

async function assertOnhandViewerMapInjectsLineBoundaries() {
	// Same contract for the Onhand viewer's own matcher (pdf-viewer bundle).
	const [boundarySource, mapSource, charSource] = await Promise.all([
		loadFunctionFromFile("packages/browser-extension/pdf-viewer.bundle.js", "pdfTextNodeBoundaryNeedsSpace"),
		loadFunctionFromFile("packages/browser-extension/pdf-viewer.bundle.js", "buildNormalizedTextMap"),
		loadFunctionFromFile("packages/browser-extension/pdf-viewer.bundle.js", "normalizeSearchChar"),
	]);
	const dom = new JSDOM(
		`
		<div class="textLayer"><span id="line-1">Rejection sampling, as used here, requires a global constant</span><span id="line-2">that bounds the target den</span><span id="line-2-tail">sity everywhere.</span></div>
		`,
		{ url: "https://example.test/viewer", pretendToBeVisual: true, runScripts: "outside-only" },
	);
	installLayoutShims(dom.window);
	setElementRect(dom.window.document.getElementById("line-1"), { left: 50, top: 100, width: 400, height: 18 });
	setElementRect(dom.window.document.getElementById("line-2"), { left: 50, top: 124, width: 220, height: 18 });
	setElementRect(dom.window.document.getElementById("line-2-tail"), { left: 270.4, top: 124, width: 140, height: 18 });
	const map = dom.window.eval(`(() => {
		${charSource}
		${boundarySource}
		${mapSource}
		return buildNormalizedTextMap(document.querySelector(".textLayer"));
	})()`);
	assert.equal(
		map.text,
		"rejection sampling, as used here, requires a global constant that bounds the target density everywhere.",
		"viewer map should inject a space at the wrapped-line boundary and keep the kerning split glued",
	);
	assert.equal(
		map.searchText,
		"rejection sampling as used here requires a global constant that bounds the target density everywhere",
		"viewer search projection should collapse punctuation like the query normalizer so exact matches are symmetric",
	);
	assert.equal(map.searchPositions.length, map.searchText.length, "search projection positions must stay in lockstep");
}

async function assertOnhandPdfViewerSurfaceAndAnchorRestore() {
	const sourceUrl = "http://127.0.0.1:8765/pdf/onhand-viewer";
	const { dom, toolkit } = await createToolkitAtUrl(
		`
		<body data-onhand-pdf-rendered="true" data-onhand-pdf-url="${sourceUrl}">
			<div id="viewer" data-onhand-pdf-viewer-root>
				<section class="page" data-page-number="1" data-onhand-pdf-page="true">
					<div class="canvasWrapper"></div>
					<div class="textLayer" data-onhand-pdf-text-layer="true">
						<span>The important phrase is </span>
						<span>recurrent neural networks</span>
						<span> in sequence models.</span>
					</div>
				</section>
			</div>
		</body>
	`,
		`chrome-extension://onhand-test/pdf-viewer.html?url=${encodeURIComponent(sourceUrl)}`,
	);
	const surface = toolkit.getAnnotationSurfaceInfo();
	assert.equal(surface.surface, "pdf");
	assert.equal(surface.hasTextLayer, true);
	assert.equal(surface.pdfUrl, sourceUrl);
	const page = dom.window.document.querySelector(".page");
	const textSpans = Array.from(dom.window.document.querySelectorAll(".textLayer span"));
	setElementRect(page, { left: 0, top: 0, width: 600, height: 800 });
	Object.defineProperties(page, {
		clientWidth: { value: 600, configurable: true },
		clientHeight: { value: 800, configurable: true },
	});
	setElementRect(textSpans[0], { left: 150, top: 230, width: 190, height: 24 });
	setElementRect(textSpans[1], { left: 340, top: 230, width: 210, height: 24 });
	setElementRect(textSpans[2], { left: 150, top: 260, width: 300, height: 24 });

	const highlight = await toolkit.highlightText("recurrent neural networks", { scrollIntoView: false });
	assert.equal(highlight.kind, "pdf");
	assert.equal(highlight.pdfAnchor.document.pdfUrl, sourceUrl);
	assert.equal(highlight.pdfAnchor.pageNumber, 1);

	toolkit.clearAnnotations();
	dom.window.document.querySelector("[data-onhand-pdf-text-layer]").textContent = "The rendered PDF text changed after capture.";
	const restored = await toolkit.highlightText("recurrent neural networks", {
		scrollIntoView: false,
		exactOnly: true,
		allowApproximate: false,
		pdfAnchor: highlight.pdfAnchor,
	});
	assert.equal(restored.kind, "pdf");
	assert.equal(restored.fallback, "pdf-anchor");
	assert.equal(restored.pdfAnchor.pageNumber, 1);
	assert.ok(dom.window.document.querySelector('[data-onhand-highlight-kind="pdf"]'), "expected own PDF viewer anchor restore to recreate overlay");
}

async function assertPdfAnchorRestoreUsesLayoutCoordinatesWhenPageIsScaled() {
	const { dom, toolkit } = await createToolkit(`
		<main id="viewer" class="pdfViewer">
			<div class="page" data-page-number="1">
				<div class="canvasWrapper"></div>
				<div class="textLayer">
					<span>scaled phrase</span>
				</div>
			</div>
		</main>
	`);
	const page = dom.window.document.querySelector(".page");
	setElementRect(page, { left: 100, top: 50, width: 300, height: 400 });
	Object.defineProperties(page, {
		clientWidth: { value: 600, configurable: true },
		clientHeight: { value: 800, configurable: true },
	});
	const restored = await toolkit.highlightText("scaled phrase", {
		scrollIntoView: false,
		exactOnly: true,
		allowApproximate: false,
		pdfAnchor: {
			surface: "pdf",
			viewer: "pdfjs",
			document: {
				url: "https://example.test/scaled.pdf",
				title: "Scaled PDF",
			},
			pageNumber: 1,
			matchedText: "scaled phrase",
			textQuote: { exact: "scaled phrase" },
			rects: [
				{
					pageNumber: 1,
					x: 0.5,
					y: 0.25,
					width: 0.2,
					height: 0.05,
					coordinateSpace: "page-normalized",
				},
			],
		},
	});
	assert.equal(restored.kind, "pdf");
	const highlight = dom.window.document.querySelector('[data-onhand-highlight-kind="pdf"]');
	assert.ok(highlight, "expected restored PDF highlight");
	assert.equal(highlight.style.left, "300px", "scaled PDF highlights should use page layout coordinates for left");
	assert.equal(highlight.style.top, "200px", "scaled PDF highlights should use page layout coordinates for top");
	assert.equal(Number.parseFloat(highlight.style.width).toFixed(3), "120.000", "scaled PDF highlights should use page layout coordinates for width");
	assert.equal(Number.parseFloat(highlight.style.height).toFixed(3), "40.000", "scaled PDF highlights should use page layout coordinates for height");
}

async function assertPdfAnchorRestoreBoundsAndRejectsBadRects() {
	const { dom, toolkit } = await createToolkit(`
		<main id="viewer" class="pdfViewer">
			<div class="page" data-page-number="1">
				<div class="textLayer">
					<span>Visible text does not contain the restored anchor phrase.</span>
				</div>
			</div>
		</main>
	`);
	const page = dom.window.document.querySelector(".page");
	setElementRect(page, { left: 20, top: 40, width: 500, height: 600 });
	Object.defineProperties(page, {
		clientWidth: { value: 1000, configurable: true },
		clientHeight: { value: 1200, configurable: true },
	});

	const boundedAnchor = {
		surface: "pdf",
		viewer: "pdfjs",
		document: {
			url: "https://example.test/bounded.pdf",
			title: "Bounded PDF",
		},
		pageNumber: 1,
		matchedText: "anchor-only phrase",
		textQuote: { exact: "anchor-only phrase" },
		rects: [
			{
				pageNumber: 1,
				x: 0.94,
				y: 0.1,
				width: 0.2,
				height: 0.05,
				coordinateSpace: "page-normalized",
			},
		],
	};
	const restored = await toolkit.highlightText("anchor-only phrase", {
		scrollIntoView: false,
		pdfAnchor: boundedAnchor,
	});
	assert.equal(restored.fallback, "pdf-anchor");
	const highlight = dom.window.document.querySelector('[data-onhand-highlight-kind="pdf"]');
	assertPassivePdfHighlightElement(highlight, "bounded PDF anchor highlight");
	assert.equal(highlight.style.left, "940px");
	assert.equal(Number.parseFloat(highlight.style.width).toFixed(2), "60.00", "overflowing PDF anchor rects should be clipped to the page edge");
	assert.equal(restored.pdfAnchor.rects[0].width.toFixed(2), "0.06");

	toolkit.clearAnnotations();
	const invalidAnchor = {
		...boundedAnchor,
		matchedText: "missing stale phrase",
		textQuote: { exact: "missing stale phrase" },
		rects: [
			{ pageNumber: 1, x: 2.2, y: 0.1, width: 0.2, height: 0.04, coordinateSpace: "page-normalized" },
			{ pageNumber: 1, x: 0.1, y: 0.2, width: 0.6, height: 0.8, coordinateSpace: "page-normalized" },
		],
	};
	await assert.rejects(
		() => toolkit.highlightText("missing stale phrase", { scrollIntoView: false, pdfAnchor: invalidAnchor }),
		/No visible PDF text matched|No visible text matched/,
	);
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-highlight-kind="pdf"]').length, 0, "bad PDF anchor rects should not render random highlights");
}

async function assertPdfAnchorCanRenderMultipleOverlaySegmentsAcrossPages() {
	const { dom, toolkit } = await createToolkit(`
		<main id="viewer" class="pdfViewer">
			<div class="page" data-page-number="1">
				<div class="textLayer">
					<span>Cross-page PDF selection starts here.</span>
				</div>
			</div>
			<div class="page" data-page-number="2">
				<div class="textLayer">
					<span>Cross-page PDF selection continues here.</span>
				</div>
			</div>
		</main>
	`);
	const pdfAnchor = {
		surface: "pdf",
		viewer: "pdfjs",
		document: {
			url: "https://example.test/lecture.pdf",
			title: "Lecture PDF",
			pageCount: 2,
		},
		pageNumber: 1,
		matchedText: "Cross-page PDF selection starts here. Cross-page PDF selection continues here.",
		textQuote: {
			exact: "Cross-page PDF selection starts here. Cross-page PDF selection continues here.",
		},
		rects: [
			{ pageNumber: 1, x: 0.1, y: 0.1, width: 0.4, height: 0.04, coordinateSpace: "page-normalized" },
			{ pageNumber: 1, x: 0.1, y: 0.16, width: 0.36, height: 0.04, coordinateSpace: "page-normalized" },
			{ pageNumber: 2, x: 0.14, y: 0.12, width: 0.48, height: 0.04, coordinateSpace: "page-normalized" },
		],
	};
	const restored = await toolkit.highlightText(pdfAnchor.matchedText, {
		scrollIntoView: false,
		pdfAnchor,
	});
	assert.equal(restored.kind, "pdf");
	assert.equal(restored.fallback, "pdf-anchor");
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-highlight-kind="pdf"]').length, 1);
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-pdf-segment-kind="highlight"]').length, 2);

	const root = dom.window.document.querySelector('[data-onhand-highlight-kind="pdf"]');
	const segments = Array.from(dom.window.document.querySelectorAll('[data-onhand-pdf-segment-kind="highlight"]'));
	assert.equal(root.closest(".page")?.getAttribute("data-page-number"), "1");
	assert.equal(segments[0].closest(".page")?.getAttribute("data-page-number"), "1");
	assert.equal(segments[1].closest(".page")?.getAttribute("data-page-number"), "2");
	assert.equal(segments[0].getAttribute("data-onhand-pdf-segment-for"), restored.annotationId);
	assert.equal(segments[1].style.getPropertyPriority("width"), "important");

	await toolkit.showNote(restored.annotationId, "A single Onhand note belongs to the multi-segment PDF anchor.", { scrollIntoView: false });
	const captured = await toolkit.captureState();
	assert.equal(captured.annotationCount, 1);
	assert.equal(captured.annotations[0].annotationId, restored.annotationId);
	assert.equal(captured.annotations[0].pdfAnchor.rects.length, 3);
	assert.equal(captured.annotations[0].note.text, "A single Onhand note belongs to the multi-segment PDF anchor.");

	const cleared = toolkit.clearAnnotations();
	assert.equal(cleared.clearedPdf, 1);
	assert.equal(cleared.clearedPdfSegments, 2);
	assert.equal(cleared.clearedNotes, 1);
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-highlight-kind="pdf"], [data-onhand-pdf-segment-kind="highlight"], [data-onhand-note-kind="card"]').length, 0);
}

async function assertPdfAnchorRehydratesVisibleSecondaryPageWhenPrimaryPageMissing() {
	const { dom, toolkit } = await createToolkit(`
		<main id="viewer" class="pdfViewer">
			<div class="page" data-page-number="2">
				<div class="textLayer">
					<span>Only the secondary page is currently rendered.</span>
				</div>
			</div>
		</main>
	`);
	const pdfAnchor = {
		surface: "pdf",
		viewer: "pdfjs",
		document: {
			url: "https://example.test/lecture.pdf",
			title: "Lecture PDF",
			pageCount: 2,
		},
		pageNumber: 1,
		matchedText: "Cross-page PDF selection starts here. Cross-page PDF selection continues here.",
		textQuote: {
			exact: "Cross-page PDF selection starts here. Cross-page PDF selection continues here.",
		},
		rects: [
			{ pageNumber: 1, x: 0.1, y: 0.1, width: 0.4, height: 0.04, coordinateSpace: "page-normalized" },
			{ pageNumber: 2, x: 0.14, y: 0.12, width: 0.48, height: 0.04, coordinateSpace: "page-normalized" },
		],
	};
	const restored = await toolkit.highlightText(pdfAnchor.matchedText, {
		scrollIntoView: false,
		pdfAnchor,
	});
	assert.equal(restored.kind, "pdf");
	assert.equal(restored.fallback, "pdf-anchor");
	assert.equal(restored.pdfAnchor.pageNumber, 1);
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-highlight-kind="pdf"]').length, 1);
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-pdf-segment-kind="highlight"]').length, 0);
	assert.equal(dom.window.document.querySelector('[data-onhand-highlight-kind="pdf"]').closest(".page")?.getAttribute("data-page-number"), "2");

	await toolkit.showNote(restored.annotationId, "The note can attach to the rendered segment while page 1 is virtualized.", { scrollIntoView: false });
	const captured = await toolkit.captureState();
	assert.equal(captured.annotationCount, 1);
	assert.equal(captured.annotations[0].pdfAnchor.pageNumber, 1);
	assert.equal(captured.annotations[0].pdfAnchor.rects.length, 2);
	assert.equal(captured.annotations[0].note.text, "The note can attach to the rendered segment while page 1 is virtualized.");
}

async function assertPdfOverlayReprojectsAfterPageResize() {
	const { dom, toolkit } = await createToolkit(`
		<main id="viewer" class="pdfViewer">
			<div class="page" data-page-number="8">
				<div class="textLayer">
					<span>Recurrent neural networks preserve sequence state.</span>
				</div>
			</div>
		</main>
	`);
	const page = dom.window.document.querySelector(".page");
	const textLayer = dom.window.document.querySelector(".textLayer");
	const textSpan = dom.window.document.querySelector(".textLayer span");
	const pageRect = { left: 20, top: 40, width: 1000, height: 1200 };
	const rectForPage = () => ({
		x: pageRect.left,
		y: pageRect.top,
		top: pageRect.top,
		left: pageRect.left,
		right: pageRect.left + pageRect.width,
		bottom: pageRect.top + pageRect.height,
		width: pageRect.width,
		height: pageRect.height,
		toJSON() {
			return { x: this.x, y: this.y, top: this.top, left: this.left, right: this.right, bottom: this.bottom, width: this.width, height: this.height };
		},
	});
	page.getBoundingClientRect = rectForPage;
	textLayer.getBoundingClientRect = rectForPage;
	textSpan.getBoundingClientRect = () => fixedRect({ left: pageRect.left, top: pageRect.top, width: pageRect.width, height: 30 });

	const highlight = await toolkit.highlightText("recurrent neural networks", { scrollIntoView: false });
	const overlay = dom.window.document.querySelector('[data-onhand-highlight-kind="pdf"]');
	assert.ok(overlay, "expected PDF overlay before resize");
	const fullText = "Recurrent neural networks preserve sequence state.";
	const queryText = "recurrent neural networks";
	const expectedWidth = () => (queryText.length / fullText.length) * pageRect.width;
	assert.equal(Number.parseFloat(overlay.style.width).toFixed(3), expectedWidth().toFixed(3));
	assert.equal(overlay.style.height, "30px");
	overlay.getBoundingClientRect = () => ({
		x: pageRect.left + Number.parseFloat(overlay.style.left || "0"),
		y: pageRect.top + Number.parseFloat(overlay.style.top || "0"),
		top: pageRect.top + Number.parseFloat(overlay.style.top || "0"),
		left: pageRect.left + Number.parseFloat(overlay.style.left || "0"),
		right: pageRect.left + Number.parseFloat(overlay.style.left || "0") + Number.parseFloat(overlay.style.width || "0"),
		bottom: pageRect.top + Number.parseFloat(overlay.style.top || "0") + Number.parseFloat(overlay.style.height || "0"),
		width: Number.parseFloat(overlay.style.width || "0"),
		height: Number.parseFloat(overlay.style.height || "0"),
		toJSON() {
			return { x: this.x, y: this.y, top: this.top, left: this.left, right: this.right, bottom: this.bottom, width: this.width, height: this.height };
		},
	});

	await toolkit.showNote(highlight.annotationId, "RNNs carry state across a sequence.", { scrollIntoView: false });
	const note = dom.window.document.querySelector('[data-onhand-note-kind="card"]');
	assert.equal(note.style.width, "300px");

	pageRect.width = 1200;
	pageRect.height = 1500;
	await toolkit.captureState();
	assert.equal(Number.parseFloat(overlay.style.width).toFixed(3), expectedWidth().toFixed(3));
	assert.equal(overlay.style.height, "37.5px");
	assert.equal(note.style.width, "360px");
}

async function assertPdfAnnotationRehydratesAfterPageVirtualization() {
	const { dom, toolkit } = await createToolkit(`
		<main id="viewer" class="pdfViewer">
			<div class="page" data-page-number="9">
				<div class="textLayer">
					<span>Recurrent neural networks preserve sequence state.</span>
				</div>
			</div>
		</main>
	`);
	const highlight = await toolkit.highlightText("recurrent neural networks", { scrollIntoView: false });
	await toolkit.showNote(highlight.annotationId, "RNNs carry state across a sequence.", { scrollIntoView: false });
	const originalPage = dom.window.document.querySelector(".page");
	const replacementPage = dom.window.document.createElement("div");
	replacementPage.className = "page";
	replacementPage.setAttribute("data-page-number", "9");
	replacementPage.innerHTML = `
		<div class="textLayer">
			<span>Recurrent neural networks preserve sequence state.</span>
		</div>
	`;
	originalPage.replaceWith(replacementPage);
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-highlight-kind="pdf"]').length, 0);

	const captured = await toolkit.captureState();
	assert.equal(captured.annotationCount, 1);
	assert.equal(captured.annotations[0].annotationId, highlight.annotationId);
	assert.equal(captured.annotations[0].kind, "pdf");
	assert.equal(captured.annotations[0].pdfAnchor.pageNumber, 9);
	assert.equal(captured.annotations[0].note.text, "RNNs carry state across a sequence.");
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-highlight-kind="pdf"]').length, 1);
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-note-kind="card"]').length, 1);

	dom.window.document.querySelector('[data-onhand-highlight-kind="pdf"]').remove();
	dom.window.document.querySelector('[data-onhand-note-kind="card"]').remove();
	const scrolled = await toolkit.scrollToAnnotation(highlight.annotationId, { block: "center" });
	assert.equal(scrolled.annotationId, highlight.annotationId);
	assert.equal(scrolled.targetKind, "annotation");
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-highlight-kind="pdf"]').length, 1);
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-note-kind="card"]').length, 1);
}

async function assertPdfAnnotationRehydratesWhenPageMutatesAsync() {
	const { dom, toolkit } = await createToolkit(`
		<main id="viewer" class="pdfViewer">
			<div class="page" data-page-number="6">
				<div class="textLayer">
					<span>Recurrent neural networks preserve sequence state.</span>
				</div>
			</div>
		</main>
	`);
	const highlight = await toolkit.highlightText("recurrent neural networks", { scrollIntoView: false });
	await toolkit.showNote(highlight.annotationId, "RNNs carry state across a sequence.", { scrollIntoView: false });
	const originalPage = dom.window.document.querySelector(".page");
	const replacementPage = dom.window.document.createElement("div");
	replacementPage.className = "page";
	replacementPage.setAttribute("data-page-number", "6");
	replacementPage.innerHTML = `
		<div class="textLayer">
			<span>Recurrent neural networks preserve sequence state.</span>
		</div>
	`;
	originalPage.replaceWith(replacementPage);
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-highlight-kind="pdf"]').length, 0);
	await new Promise((resolve) => dom.window.setTimeout(resolve, 50));
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-highlight-kind="pdf"]').length, 1);
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-note-kind="card"]').length, 1);
}

async function assertPdfSourceJumpReportsNearestRenderedPageWhenTargetPageMissing() {
	const { dom, toolkit } = await createToolkit(`
		<main id="viewer" class="pdfViewer">
			<div class="page" data-page-number="9">
				<div class="textLayer">
					<span>Recurrent neural networks preserve sequence state.</span>
				</div>
			</div>
		</main>
	`);
	const highlight = await toolkit.highlightText("recurrent neural networks", { scrollIntoView: false });
	await toolkit.showNote(highlight.annotationId, "RNNs carry state across a sequence.", { scrollIntoView: false });

	const originalPage = dom.window.document.querySelector(".page");
	const page8 = dom.window.document.createElement("div");
	page8.className = "page";
	page8.setAttribute("data-page-number", "8");
	page8.innerHTML = `<div class="textLayer"><span>Previous rendered page.</span></div>`;
	const page10 = dom.window.document.createElement("div");
	page10.className = "page";
	page10.setAttribute("data-page-number", "10");
	page10.innerHTML = `<div class="textLayer"><span>Next rendered page.</span></div>`;
	originalPage.replaceWith(page8, page10);
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-highlight-kind="pdf"]').length, 0);

	const scrolled = await toolkit.scrollToAnnotation(highlight.annotationId, { block: "center" });
	assert.equal(scrolled.annotationId, highlight.annotationId);
	assert.equal(scrolled.targetKind, "pdf-page-estimate");
	assert.equal(scrolled.pageNumber, 9);
	assert.equal(scrolled.nearestPageNumber, 8);
	assert.equal(scrolled.virtualized, true);
}

async function assertPdfSourceJumpRehydratesVisibleSecondarySegmentWhenPrimaryPageMissing() {
	const { dom, toolkit } = await createToolkit(`
		<main id="viewer" class="pdfViewer">
			<div class="page" data-page-number="1">
				<div class="textLayer">
					<span>Cross-page PDF selection starts here.</span>
				</div>
			</div>
			<div class="page" data-page-number="2">
				<div class="textLayer">
					<span>Cross-page PDF selection continues here.</span>
				</div>
			</div>
		</main>
	`);
	const pdfAnchor = {
		surface: "pdf",
		viewer: "pdfjs",
		document: {
			url: "https://example.test/lecture.pdf",
			title: "Lecture PDF",
			pageCount: 2,
		},
		pageNumber: 1,
		matchedText: "Cross-page PDF selection starts here. Cross-page PDF selection continues here.",
		textQuote: {
			exact: "Cross-page PDF selection starts here. Cross-page PDF selection continues here.",
		},
		rects: [
			{ pageNumber: 1, x: 0.1, y: 0.1, width: 0.4, height: 0.04, coordinateSpace: "page-normalized" },
			{ pageNumber: 2, x: 0.14, y: 0.12, width: 0.48, height: 0.04, coordinateSpace: "page-normalized" },
		],
	};
	const restored = await toolkit.highlightText(pdfAnchor.matchedText, {
		scrollIntoView: false,
		pdfAnchor,
	});
	await toolkit.showNote(restored.annotationId, "Source should still jump to the rendered page 2 segment.", { scrollIntoView: false });
	assert.equal(dom.window.document.querySelector('[data-onhand-highlight-kind="pdf"]').closest(".page")?.getAttribute("data-page-number"), "1");
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-pdf-segment-kind="highlight"]').length, 1);

	dom.window.document.querySelector('[data-page-number="1"]').remove();
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-highlight-kind="pdf"]').length, 0);
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-note-kind="card"]').length, 0);

	const scrolled = await toolkit.scrollToAnnotation(restored.annotationId, { block: "center" });
	assert.equal(scrolled.annotationId, restored.annotationId);
	assert.equal(scrolled.targetKind, "annotation");
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-highlight-kind="pdf"]').length, 1);
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-pdf-segment-kind="highlight"]').length, 0);
	assert.equal(dom.window.document.querySelectorAll('[data-onhand-note-kind="card"]').length, 1);
	assert.equal(dom.window.document.querySelector('[data-onhand-highlight-kind="pdf"]').closest(".page")?.getAttribute("data-page-number"), "2");
}

async function assertPdfSourceJumpRequestsViewerRenderForVirtualizedPage() {
	const { dom, toolkit } = await createToolkit(`
		<div role="toolbar" aria-label="PDF controls">
			<label>Page <input type="number" aria-label="Page number" value="9"></label>
		</div>
		<main id="viewer" class="pdfViewer">
			<div class="page" data-page-number="9">
				<div class="textLayer">
					<span>Recurrent neural networks preserve sequence state.</span>
				</div>
			</div>
		</main>
	`);
	const document = dom.window.document;
	const highlight = await toolkit.highlightText("recurrent neural networks", { scrollIntoView: false });
	await toolkit.showNote(highlight.annotationId, "RNNs carry state across a sequence.", { scrollIntoView: false });

	const viewer = document.querySelector("#viewer");
	const originalPage = document.querySelector(".page");
	const page8 = document.createElement("div");
	page8.className = "page";
	page8.setAttribute("data-page-number", "8");
	page8.innerHTML = `<div class="textLayer"><span>Previous rendered page.</span></div>`;
	const page10 = document.createElement("div");
	page10.className = "page";
	page10.setAttribute("data-page-number", "10");
	page10.innerHTML = `<div class="textLayer"><span>Next rendered page.</span></div>`;
	originalPage.replaceWith(page8, page10);
	assert.equal(document.querySelectorAll('[data-onhand-highlight-kind="pdf"]').length, 0);

	let renderRequests = 0;
	const pageInput = document.querySelector('[aria-label="Page number"]');
	pageInput.value = "8";
	pageInput.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" || pageInput.value !== "9") return;
		renderRequests += 1;
		if (document.querySelector('[data-page-number="9"]')) return;
		const page9 = document.createElement("div");
		page9.className = "page";
		page9.setAttribute("data-page-number", "9");
		page9.innerHTML = `
			<div class="textLayer">
				<span>Recurrent neural networks preserve sequence state.</span>
			</div>
		`;
		viewer.insertBefore(page9, page10);
	});

	const scrolled = await toolkit.scrollToAnnotation(highlight.annotationId, { block: "center" });
	assert.equal(renderRequests, 1, "expected source jump to request the target PDF page through the page control");
	assert.equal(pageInput.value, "9");
	assert.equal(scrolled.annotationId, highlight.annotationId);
	assert.equal(scrolled.targetKind, "annotation");
	assert.equal(document.querySelectorAll('[data-onhand-highlight-kind="pdf"]').length, 1);
	assert.equal(document.querySelectorAll('[data-onhand-note-kind="card"]').length, 1);
	assert.equal(document.querySelector('[data-onhand-highlight-kind="pdf"]').closest(".page")?.getAttribute("data-page-number"), "9");
}

async function assertGoogleScholarReaderSourceJumpUsesUnlabelledPageInput() {
	const { dom, toolkit } = await createToolkitAtUrl(
		`
		<!doctype html>
		<title>Google Scholar Reader</title>
		<body>
			<div class="gsr-root">
				<div class="gsr-toolbar" role="toolbar" aria-label="Google Scholar PDF Reader toolbar">
					<div class="gsr-tb-pn">
						<button type="button" class="gsr-tb-pn-btn" aria-label="Previous page"></button>
						<input class="gsr-tb-pn-input gsr-tb-input" type="text" value="13">
						<span class="gsr-tb-pn-divider">/</span>
						<span class="gsr-tb-pn-tp">20</span>
						<button type="button" class="gsr-tb-pn-btn" aria-label="Next page"></button>
					</div>
				</div>
				<div class="gsr-body">
					<div class="gsr-content-wrapper">
						<div class="gsr-page-wrapper">
							<div class="gsr-page" data-pn="13">
								<div class="gsr-text-ctn">
									<span class="gsr-text" data-idx="0">Target Reader page text appears on the initially rendered page.</span>
								</div>
							</div>
						</div>
						<div class="gsr-comment-wrapper"></div>
					</div>
				</div>
			</div>
		</body>
		`,
		"chrome-extension://dahenjhkoodjbpjheillcadbppiidmhp/reader.html",
	);
	const document = dom.window.document;
	const pageWrapper = document.querySelector(".gsr-page-wrapper");
	const pageInput = document.querySelector(".gsr-tb-pn-input");
	const pdfAnchor = {
		surface: "pdf",
		viewer: "google-scholar",
		document: {
			url: "https://example.test/lecture.pdf",
			title: "Google Scholar Reader",
			pageCount: 20,
		},
		pageNumber: 13,
		matchedText: "Target Reader page text",
		textQuote: {
			exact: "Target Reader page text",
		},
		rects: [{ pageNumber: 13, x: 0.12, y: 0.18, width: 0.42, height: 0.04, coordinateSpace: "page-normalized" }],
	};

	const restored = await toolkit.highlightText(pdfAnchor.matchedText, {
		scrollIntoView: false,
		pdfAnchor,
	});
	assert.equal(restored.kind, "pdf");
	assert.equal(document.querySelector('[data-onhand-highlight-kind="pdf"]').closest(".gsr-page")?.getAttribute("data-pn"), "13");
	const page12 = document.createElement("div");
	page12.className = "gsr-page";
	page12.setAttribute("data-pn", "12");
	page12.innerHTML = `
		<div class="gsr-text-ctn">
			<span class="gsr-text" data-idx="0">The currently rendered Reader page.</span>
		</div>
	`;
	document.querySelector(".gsr-page").replaceWith(page12);
	pageInput.value = "12";
	assert.equal(document.querySelectorAll('[data-onhand-highlight-kind="pdf"]').length, 0);

	let renderRequests = 0;
	pageInput.addEventListener("change", () => {
		if (pageInput.value !== "13" || document.querySelector('[data-pn="13"]')) return;
		renderRequests += 1;
		const page13 = document.createElement("div");
		page13.className = "gsr-page";
		page13.setAttribute("data-pn", "13");
		page13.innerHTML = `
			<div class="gsr-text-ctn">
				<span class="gsr-text" data-idx="0">Target Reader page text appears after Reader navigation.</span>
			</div>
		`;
		pageWrapper.appendChild(page13);
	});

	const scrolled = await toolkit.scrollToAnnotation(restored.annotationId, { block: "center" });
	assert.equal(renderRequests, 1, "expected source jump to use Google Scholar Reader's unlabelled page input");
	assert.equal(pageInput.value, "13");
	assert.equal(scrolled.annotationId, restored.annotationId);
	assert.equal(scrolled.targetKind, "annotation");
	assert.equal(scrolled.requestedPageRender, "page-control");
	assert.equal(document.querySelector('[data-onhand-highlight-kind="pdf"]').closest(".gsr-page")?.getAttribute("data-pn"), "13");
}

async function assertPdfHighlightPrefersVisiblePageMatch() {
	const { dom, toolkit } = await createToolkit(`
		<main id="viewer" class="pdfViewer">
			<div class="page" data-page-number="1" data-testid="page-1">
				<div class="textLayer">
					<span>Lecture 4: Recurrent Neural Networks</span>
				</div>
			</div>
			<div class="page" data-page-number="2" data-testid="page-2">
				<div class="textLayer">
					<span>The important phrase is recurrent neural networks in sequence models.</span>
				</div>
			</div>
		</main>
	`);
	const page1 = dom.window.document.querySelector('[data-testid="page-1"]');
	const page2 = dom.window.document.querySelector('[data-testid="page-2"]');
	const page1Span = page1.querySelector(".textLayer span");
	const page2Span = page2.querySelector(".textLayer span");
	page1.getBoundingClientRect = () => ({
		x: 16,
		y: -640,
		top: -640,
		left: 16,
		right: 656,
		bottom: -140,
		width: 640,
		height: 500,
		toJSON() {
			return { x: this.x, y: this.y, top: this.top, left: this.left, right: this.right, bottom: this.bottom, width: this.width, height: this.height };
		},
	});
	page2.getBoundingClientRect = () => ({
		x: 16,
		y: 80,
		top: 80,
		left: 16,
		right: 656,
		bottom: 580,
		width: 640,
		height: 500,
		toJSON() {
			return { x: this.x, y: this.y, top: this.top, left: this.left, right: this.right, bottom: this.bottom, width: this.width, height: this.height };
			},
	});
	setElementRect(page1Span, { left: 32, top: -600, width: 360, height: 24 });
	setElementRect(page2Span, { left: 32, top: 120, width: 520, height: 24 });

	const highlight = await toolkit.highlightText("recurrent neural networks", { scrollIntoView: false });
	assert.equal(highlight.kind, "pdf");
	assert.equal(highlight.pdfAnchor.pageNumber, 2);
	assert.equal(highlight.pdfAnchor.textQuote.exact, "recurrent neural networks");
}

async function assertBlockedNavigationClassification() {
	const declaration = await loadBackgroundFunction("classifyBlockedNavigation");
	const classify = new Function(`${declaration}
return classifyBlockedNavigation;`)();
	const interstitial = new Error("Frame with ID 0 is showing error page");
	assert.equal(
		classify({ url: "http://spiff.cis.rit.edu/paper.pdf", title: "spiff.cis.rit.edu" }, interstitial).kind,
		"insecure-site-warning",
		"plain-HTTP interstitials must be named so the model reports them instead of silently moving on",
	);
	assert.match(classify({ url: "http://spiff.cis.rit.edu/paper.pdf", title: "" }, interstitial).detail, /Only the user can click Continue/);
	assert.equal(classify({ url: "https://broken.example/paper.pdf", title: "" }, interstitial).kind, "browser-interstitial");
	assert.equal(classify({ url: "https://pubs.aip.org/article", title: "Just a moment..." }, null).kind, "bot-challenge");
	assert.equal(classify({ url: "https://example.com/ok", title: "A normal page" }, null), null, "real destinations must not be classified as blocked");
	assert.equal(classify({ url: "https://example.com/ok", title: "A normal page" }, new Error("Missing host permission")), null, "permission errors are not interstitials");
}

async function assertPdfSelectionIncludesAnchor() {
	const { dom, toolkit } = await createToolkit(`
		<main id="viewer" class="pdfViewer">
			<div class="page" data-page-number="7">
				<div class="textLayer">
					<span>The selected phrase is </span>
					<span data-testid="phrase">recurrent neural networks</span>
					<span> in the slide text.</span>
				</div>
			</div>
		</main>
	`);
	const document = dom.window.document;
	const phraseNode = document.querySelector('[data-testid="phrase"]').firstChild;
	const range = document.createRange();
	range.setStart(phraseNode, 0);
	range.setEnd(phraseNode, phraseNode.textContent.length);
	const selection = dom.window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);

	const selectionInfo = toolkit.getSelectionInfo();
	assert.equal(selectionInfo.text, "recurrent neural networks");
	assert.equal(selectionInfo.surface, "pdf");
	assert.equal(selectionInfo.viewer, "pdfjs");
	assert.equal(selectionInfo.pageNumber, 7);
	assert.equal(selectionInfo.container.pageNumber, 7);
	assert.equal(selectionInfo.pdfAnchor.pageNumber, 7);
	assert.equal(selectionInfo.pdfAnchor.textQuote.exact, "recurrent neural networks");
	assert.equal(selectionInfo.pdfAnchor.rects[0].coordinateSpace, "page-normalized");
}

async function main() {
	await assertPdfViewerHandoffHelpers();
	await assertDetachedPdfViewerOpenRouting();
	await assertRemoveAnnotationsTargetsSingleMarks();
	await assertPdfViewerShowNoteKeepsExpandedLayoutOrder();
	await assertHiddenTabAnnotationCommandsSkipThrottledWaits();
	await assertNativeChromePdfViewerSelectionFallback();
	await assertVisibleRegionCaptureFallsBackWhenDomIsRestricted();
	await assertGoogleDocsReadableContentUsesTextExport();
	await assertGoogleDocsReadableContentDoesNotFallbackToToolbarOnExportFailure();
	await assertReadableContentChoosesFullRootAndIncludesTables();
	await assertReadableContentMatchesHighlightableSurface();
	await assertReadableContentQuerySnippetsCoverDistantTerms();
	await assertTextbookReaderSearchUsesGenericSearchUi();
	await assertGoogleDocsBackgroundExportReadsText();
	await assertGoogleDocsBackgroundExportDoesNotReturnHtml();
	await assertGoogleDocsBackgroundVisiblePayloadsUseExportShape();
	await assertExtractContentUsesBackgroundGoogleDocsExportBeforePageEval();
	await assertGoogleDocsReadCommandsBypassEditorToolkit();
	await assertExtractContentUsesDebuggerFrameReadableFallback();
	await assertTextbookHighlightPrefersBodyFrameOverSearchUi();
	await assertGoogleDocsHighlightUsesPdfViewerHandoff();
	await assertGoogleDocsSelectionUsesTextEventClipboardFallback();

	await assertHighlight({
		name: "curly quote exact projection",
		html: `<main><p>Use “steady state” proposals when the base sampler rejects too often.</p></main>`,
		query: `Use "steady state" proposals`,
		expectedText: /Use .steady state. proposals/,
		expectedFallback: "normalized-text",
	});

	await assertHighlight({
		name: "ellipsis exact projection",
		html: `<main><p>But sampling from P(W) still causes too many rejections… can we improve it?</p></main>`,
		query: "But sampling from P(W) still causes too many rejections... can we improve it?",
		expectedText: /too many rejections/,
		expectedFallback: "normalized-text",
	});

	await assertHighlight({
		name: "token window approximate projection",
		html: `<main><p>The Promise object represents the eventual completion (or failure) of an asynchronous operation and its resulting value.</p></main>`,
		query: "Promise represents eventual completion failure asynchronous operation resulting value",
		expectedText: /Promise object represents the eventual completion/,
	});

	await assertHyphenatedProseHeadingDoesNotWaitForMathJax();

	await assertNoHighlight({
		name: "avoid low-coverage missing concept match",
		html: `<main><p>Markov chain Monte Carlo is used for sampling from complex probability distributions.</p></main>`,
		query: "Hamiltonian Monte Carlo specifically",
	});

	await assertNoteDoesNotClearFloats();
	await assertExactSourceModeDoesNotApproximate();
	await assertExactSourceModeReusesExistingHighlight();
	await assertHighlightTextPreservesExistingAnnotationsByDefault();
	await assertInlineHighlightRecordsTextQuoteAnchor();
	await assertAnchorContextDisambiguatesRepeatedText();
	await assertAnchorOccurrenceBreaksContextTies();
	await assertAnchorContextRecoversDriftedText();
	await assertAnchorRecoveryRequiresBothContextSides();
	await assertTweetTextContainerCanBeHighlightedAcrossNodes();
	await assertNestedListHighlightUsesBlockContainer();
	await assertExactMathSourceModeMatchesRenderedMathJax();
	await assertMixedLabelAndRenderedMathUsesBlockHighlight();
	await assertMathJaxQueueSettlesBeforeMathSourceRestore();
	await assertImageRenderedMathMatchesTexAltSource();
	await assertRenderedMathPageDoesNotWaitForMathJaxEngine();
	await assertImageRenderedMathIgnoresUnrelatedImageAlt();
	await assertSentenceSpanningFootnoteMarkerMatchesExactly();
	await assertCitationMarkerInQueryStillMatches();
	await assertExistingInlineHighlightDoesNotBlockLongerExactMatch();
	await assertMeaningfulSuperscriptTextStillMatches();
	await assertPdfTextLayerVisibleTextUsesPdfSurface();
	await assertPdfDocumentIdentityUsesEmbeddedPdfUrl();
	await assertPdfDocumentIdentityUsesViewerFileParameter();
	await assertLikelyPdfTabUrlCoversContentTypePdfRoutes();
	await assertReaderFrameFallbackDiagnosticsSurviveDebuggerFallback();
	await assertGenericPdfReaderPageRegionUsesPdfSurfaceOnlyWithPdfSignal();
	await assertGenericPdfReaderFallbackIgnoresOnhandOverlayText();
	await assertScholarNativeAnnotationsStaySeparateFromOnhandPdfState();
	await assertControlledScholarPdfFixtureMatchesAdapterContract();
	await assertGoogleScholarReaderDomMatchesAdapterContract();
	await assertGenericPageRegionWithoutPdfSignalStaysHtmlSurface();
	await assertPdfEmbedWithoutTextLayerReturnsUnsupportedInsteadOfHtmlFallback();
	await assertGoogleScholarReaderFrameUsesTopTabUrlForPdfIdentity();
	await assertPdfHighlightAndNoteUseOverlayAnchors();
	await assertPdfHighlightUsesTextOffsetsInsideSingleSpan();
	await assertPdfWrappedLineHighlightMatchesExactly();
	await assertOnhandViewerMapInjectsLineBoundaries();
	await assertOnhandPdfViewerSurfaceAndAnchorRestore();
	await assertPdfAnchorRestoreUsesLayoutCoordinatesWhenPageIsScaled();
	await assertPdfAnchorRestoreBoundsAndRejectsBadRects();
	await assertPdfAnchorCanRenderMultipleOverlaySegmentsAcrossPages();
	await assertPdfAnchorRehydratesVisibleSecondaryPageWhenPrimaryPageMissing();
	await assertPdfOverlayReprojectsAfterPageResize();
	await assertPdfAnnotationRehydratesAfterPageVirtualization();
	await assertPdfAnnotationRehydratesWhenPageMutatesAsync();
	await assertPdfSourceJumpRequestsViewerRenderForVirtualizedPage();
	await assertGoogleScholarReaderSourceJumpUsesUnlabelledPageInput();
	await assertPdfSourceJumpRehydratesVisibleSecondarySegmentWhenPrimaryPageMissing();
	await assertPdfSourceJumpReportsNearestRenderedPageWhenTargetPageMissing();
	await assertPdfHighlightPrefersVisiblePageMatch();
	await assertPdfSelectionIncludesAnchor();
	await assertBlockedNavigationClassification();

	console.log("Page toolkit regressions: PASS");
}

main()
	.then(() => {
		// JSDOM windows created with pretendToBeVisual keep an animation-frame
		// clock alive, so the process can idle long after the last test (the
		// PDF overlay fixtures trigger this). All work is done — exit.
		process.exit(process.exitCode || 0);
	})
	.catch((error) => {
		console.error(error?.stack || error?.message || String(error));
		process.exit(1);
	});
