import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { scholarPdfHtml } from "./serve-browser-runtime-fixture.mjs";

const PROJECT_ROOT = process.cwd();

async function loadPageToolkitFactory() {
	const source = await readFile(join(PROJECT_ROOT, "packages/browser-extension/background.js"), "utf8");
	const start = source.indexOf("const createPageToolkit = ");
	const end = source.indexOf("\n};\n\nasync function evaluateInTab", start);
	assert.notEqual(start, -1, "createPageToolkit declaration not found");
	assert.notEqual(end, -1, "createPageToolkit end marker not found");
	const expressionStart = source.indexOf("=", start) + 1;
	const expression = source.slice(expressionStart, end + 2).trim().replace(/;$/, "");
	return expression;
}

async function loadBackgroundFunction(functionName) {
	const source = await readFile(join(PROJECT_ROOT, "packages/browser-extension/background.js"), "utf8");
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

async function assertPdfViewerHandoffHelpers() {
	const functionNames = [
		"isOwnExtensionPdfViewerUrl",
		"isOnhandPdfViewerLikeUrl",
		"isHttpLikeUrl",
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
		"inferPdfPageNumberFromAccessibilityNodes",
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
			{ url: "https://docs.google.com/document/d/1sfsGQurJ444vXKXcqcHg32SBRYz3LVrvOt4Hwig-ai8/edit?tab=t.0" },
		),
		"https://docs.google.com/document/d/1sfsGQurJ444vXKXcqcHg32SBRYz3LVrvOt4Hwig-ai8/export?format=pdf",
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
	assert.match(backgroundSource, /Allow access to file URLs/, "local file access failures should tell the user which Chrome extension toggle to enable");
	assert.match(backgroundSource, /browser_navigate cannot open file:\/\/ URLs/, "browser navigation should not be able to open arbitrary local file URLs");
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
	assert.match(backgroundSource, /for \(const entry of readableFrameEntries\)[\s\S]*return await readTree\(\);/, "PDF handoff should read PDF viewer frames before falling back to the whole-tab accessibility tree");
	assert.doesNotMatch(backgroundSource, /frameEntries\s*\.\s*slice\(1\)/, "PDF handoff should not skip the top frame when it may be Chrome's native PDF viewer");
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
	assert.match(backgroundSource, /tabId: typeof message\.tabId === "number"/, "Sidebar PDF handoff should preserve the current page tab id");
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
	assert.match(htmlSource, /--scale-factor:\s*1/, "PDF viewer text layer should define a default PDF.js scale factor");
	assert.match(source, /textLayer\.style\.setProperty\("--scale-factor",\s*String\(currentScale\)\)/, "PDF viewer text layer should use the same scale factor as the canvas");
	assert.match(source, /options\.reuseExisting === true/, "PDF viewer highlight replay should honor reuseExisting");
	assert.match(source, /findExistingPdfHighlight/, "PDF viewer highlight replay should find existing PDF annotations before creating new ones");
	assert.match(source, /removeDuplicatePdfHighlights/, "PDF viewer highlight replay should consolidate duplicate saved-artifact overlays");
	assert.match(source, /function pdfSearch/, "PDF viewer should expose full-document text search");
	assert.match(source, /function pdfReadPages/, "PDF viewer should expose page-specific text reads");
	assert.match(source, /function pdfJumpToPage/, "PDF viewer should expose page navigation for found PDF matches");
	assert.match(source, /function pdfCapturePageImage/, "PDF viewer should expose page image capture for visual PDF grounding");
	assert.match(source, /const DEFAULT_SCALE = 1;/, "PDF viewer should not default to an over-zoomed fixed scale");
	assert.match(source, /function computeFitScale/, "PDF viewer should calculate an initial fit scale from the rendered viewport");
	assert.match(source, /function parseInitialPageNumber/, "PDF viewer should read an initial page from the viewer URL");
	assert.match(source, /scrollToPage\(initialPageNumber\)/, "PDF viewer should scroll to the requested initial page after rendering");
	assert.match(source, /function updateViewerPageUrl/, "PDF viewer should keep the current page in the viewer URL");
	assert.match(source, /function capturePdfViewSnapshot/, "PDF viewer should snapshot page position and annotations before re-rendering");
	assert.match(source, /function restorePdfViewSnapshot/, "PDF viewer should restore page position and annotations after re-rendering");
	assert.match(source, /window\.addEventListener\("resize",\s*scheduleResizeRender/, "PDF viewer should handle resize without resetting the document");
	assert.match(source, /renderDocument\(\{\s*preserveView:\s*true\s*\}\)/, "PDF viewer zoom/resize re-renders should preserve view state");
	assert.match(source, /case "searchPdf":/, "PDF toolkit bridge should route full-document search");
	assert.match(source, /case "readPdfPages":/, "PDF toolkit bridge should route page text reads");
	assert.doesNotMatch(source, /parentBridgeToken/, "PDF viewer bridge must not trust a token supplied by an embedding page");
	assert.match(source, /const expectedToken = await getBridgeToken\(\)/, "PDF viewer bridge commands should authorize against the session-stored token");
	assert.match(source, /commandSourceUrl !== sourceUrl/, "PDF viewer bridge commands should be scoped to the loaded PDF URL");
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
			url: "https://docs.google.com/document/d/1sfsGQurJ444vXKXcqcHg32SBRYz3LVrvOt4Hwig-ai8/edit?tab=t.0",
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
	assert.match(requestedUrls[0].url, /\/document\/d\/1sfsGQurJ444vXKXcqcHg32SBRYz3LVrvOt4Hwig-ai8\/export\?format=txt$/);
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

async function loadGoogleDocsBackgroundExportHelpers(fetchImpl) {
	const functionNames = [
		"normalizeGoogleDocsExportText",
		"isGoogleDocsDocumentUrl",
		"googleDocsDocumentIdFromUrl",
		"buildGoogleDocsTextExportUrl",
		"buildGoogleDocsPdfExportUrl",
		"googleDocsTextExportUnsupportedPayload",
		"googleDocsTextExportPayloadFromText",
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
			url: "https://docs.google.com/document/d/1sfsGQurJ444vXKXcqcHg32SBRYz3LVrvOt4Hwig-ai8/edit?tab=t.0",
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
	assert.match(requestedUrls[0].url, /\/document\/d\/1sfsGQurJ444vXKXcqcHg32SBRYz3LVrvOt4Hwig-ai8\/export\?format=txt$/);
	assert.equal(requestedUrls[0].credentials, "include");
	assert.equal(requestedUrls[0].cache, "no-store");
	assert.equal(requestedUrls[0].redirect, "follow");
	assert.equal(
		helpers.buildGoogleDocsPdfExportUrl("https://docs.google.com/document/d/1sfsGQurJ444vXKXcqcHg32SBRYz3LVrvOt4Hwig-ai8/edit?tab=t.0"),
		"https://docs.google.com/document/d/1sfsGQurJ444vXKXcqcHg32SBRYz3LVrvOt4Hwig-ai8/export?format=pdf",
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

async function assertExtractContentUsesBackgroundGoogleDocsExportBeforePageEval() {
	const source = await readFile(join(PROJECT_ROOT, "packages/browser-extension/background.js"), "utf8");
	assert.match(
		source,
		/case "extract_content":\s*{[\s\S]*extractGoogleDocsTextExportForTab\(tab,\s*\{\s*maxChars:\s*args\.maxChars\s*\}\)[\s\S]*evaluateInTab/,
		"browser_extract_content should read Google Docs through the background text export before page-world evaluation",
	);
}

async function assertGoogleDocsHighlightUsesPdfViewerHandoff() {
	const backgroundSource = await readFile(join(PROJECT_ROOT, "packages/browser-extension/background.js"), "utf8");
	const pdfViewerSource = await readFile(join(PROJECT_ROOT, "packages/browser-extension/src/pdf-viewer.ts"), "utf8");
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
	assert.match(
		pdfViewerSource,
		/function isGoogleDocsPdfExportUrl/,
		"Onhand PDF viewer should detect Google Docs PDF exports",
	);
	assert.match(
		pdfViewerSource,
		/getPdfDocumentWithTimeout\(\{\s*\.\.\.baseOptions,\s*withCredentials:\s*true\s*\},\s*GOOGLE_DOCS_CREDENTIAL_RETRY_TIMEOUT_MS\)/,
		"Onhand PDF viewer should retry Google Docs PDF exports with credentials",
	);
	assert.match(
		pdfViewerSource,
		/Timed out loading the PDF\./,
		"Onhand PDF viewer should not leave failed Google Docs exports spinning silently",
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
	assert.equal(note.getAttribute("data-onhand-note-collapsed"), "false", "clicking the highlight should reopen the note");
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
	assert.equal(highlight.style.width, "120px", "scaled PDF highlights should use page layout coordinates for width");
	assert.equal(highlight.style.height, "40px", "scaled PDF highlights should use page layout coordinates for height");
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

	const highlight = await toolkit.highlightText("recurrent neural networks", { scrollIntoView: false });
	assert.equal(highlight.kind, "pdf");
	assert.equal(highlight.pdfAnchor.pageNumber, 2);
	assert.equal(highlight.pdfAnchor.textQuote.exact, "recurrent neural networks");
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
	await assertPdfViewerShowNoteKeepsExpandedLayoutOrder();
	await assertGoogleDocsReadableContentUsesTextExport();
	await assertGoogleDocsReadableContentDoesNotFallbackToToolbarOnExportFailure();
	await assertGoogleDocsBackgroundExportReadsText();
	await assertGoogleDocsBackgroundExportDoesNotReturnHtml();
	await assertExtractContentUsesBackgroundGoogleDocsExportBeforePageEval();
	await assertGoogleDocsHighlightUsesPdfViewerHandoff();

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

	await assertNoHighlight({
		name: "avoid low-coverage missing concept match",
		html: `<main><p>Markov chain Monte Carlo is used for sampling from complex probability distributions.</p></main>`,
		query: "Hamiltonian Monte Carlo specifically",
	});

	await assertNoteDoesNotClearFloats();
	await assertExactSourceModeDoesNotApproximate();
	await assertExactSourceModeReusesExistingHighlight();
	await assertHighlightTextPreservesExistingAnnotationsByDefault();
	await assertTweetTextContainerCanBeHighlightedAcrossNodes();
	await assertNestedListHighlightUsesBlockContainer();
	await assertExactMathSourceModeMatchesRenderedMathJax();
	await assertMathJaxQueueSettlesBeforeMathSourceRestore();
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
	await assertOnhandPdfViewerSurfaceAndAnchorRestore();
	await assertPdfAnchorRestoreUsesLayoutCoordinatesWhenPageIsScaled();
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

	console.log("Page toolkit regressions: PASS");
}

main().catch((error) => {
	console.error(error?.stack || error?.message || String(error));
	process.exitCode = 1;
});
