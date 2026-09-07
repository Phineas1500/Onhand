// Behavior checks for PDF extraction failures and annotations edited during zoom.
// Exercises production functions with controlled PDF.js failures/render timing;
// real canvas geometry is covered by run-real-pdf-zoom-regressions.mjs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { JSDOM } from "jsdom";

const source = await readFile(new URL("../packages/browser-extension/src/pdf-viewer.ts", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "ts", target: "es2022" });

function declaration(name, sourceCode = code) {
	const match = [...sourceCode.matchAll(/^[ \t]*(?:async )?function ([\w$]+)\(/gm)].find((entry) => entry[1] === name);
	assert.ok(match, `Missing production function: ${name}`);
	const bodyStart = sourceCode.indexOf("{", sourceCode.indexOf(")", match.index));
	let depth = 0;
	for (let index = bodyStart; index < sourceCode.length; index += 1) {
		if (sourceCode[index] === "{") depth += 1;
		if (sourceCode[index] === "}" && --depth === 0) return sourceCode.slice(match.index, index + 1);
	}
	assert.fail(`Unterminated production function: ${name}`);
}

function loadFunctions(names, dependencies) {
	return new Function(...Object.keys(dependencies), `${names.map((name) => declaration(name)).join("\n")}\nreturn { ${names.join(", ")} };`)(...Object.values(dependencies));
}

async function assertExtractionCoverage() {
	const failures = new Set([2]);
	const pageTextContentCache = new Map();
	const pages = [1, 2, 3].map((pageNumber) => ({
		pageNumber,
		// A render creates its empty text-layer container before extraction is
		// ready. Search must still ask PDF.js for that pending page's text.
		querySelector: (selector) => pageNumber === 2 && selector === ".textLayer" ? {} : null,
		getBoundingClientRect: () => ({}),
	}));
	const dependencies = {
		pageTextContentCache,
		cachedPdfTextLayerInfo: null,
		pdfDocument: { numPages: 3, async getPage(pageNumber) {
			return { async getTextContent() {
				if (failures.has(pageNumber)) throw new Error("Damaged page stream");
				return { items: [{ str: pageNumber === 3 ? "" : `Page ${pageNumber} readable content`, hasEOL: true }] };
			} };
		} },
		getPdfPages: () => pages,
		getPdfPageByNumber: (pageNumber) => pages[pageNumber - 1],
		getPageNumber: (page) => page.pageNumber,
		parsePdfPageNumbers: () => [1, 2, 3],
		isPendingPage: () => false,
		pdfPageText: () => "",
		rectToObject: (rect) => rect,
		sourceUrl: "https://example.test/fixture.pdf",
		document: { title: "Fixture" },
	};
	const viewer = loadFunctions(["normalizeText", "getPageTextContent", "describePdfTextLayer", "pdfSearch", "pdfReadPages"], dependencies);
	await assert.rejects(viewer.getPageTextContent(2), /Damaged page stream/);
	assert.equal(pageTextContentCache.has(2), false, "failed extraction must remain retryable");
	const search = await viewer.pdfSearch({ query: "absent needle" });
	assert.equal(search.matchCount, 0);
	assert.equal(search.coverage.searchedAllPages, false);
	assert.deepEqual(search.coverage.searchedPageNumbers, [1, 3]);
	assert.deepEqual(search.coverage.failedPageNumbers, [2]);
	assert.equal(search.textLayer.likelyScanned, null, "failed text extraction cannot establish that a PDF is scanned");
	assert.equal(search.textLayer.checkedPages, 2);
	assert.deepEqual(search.textLayer.failedPageNumbers, [2]);
	const read = await viewer.pdfReadPages();
	assert.deepEqual(read.readPageNumbers, [1, 3], "successfully read blank pages count as readable");
	assert.deepEqual(read.failedPageNumbers, [2]);
	assert.equal(read.incomplete, true);
	assert.equal(read.blockCount, 1, "other readable pages survive a neighboring extraction failure");
	failures.clear();
	const retry = await viewer.pdfSearch({ query: "absent needle" });
	assert.equal(retry.coverage.searchedAllPages, true);
	assert.deepEqual(retry.coverage.failedPageNumbers, []);
	assert.equal(retry.textLayer.checkedPages, 3);
	assert.equal(retry.textLayer.likelyScanned, false);
	const successfulRead = await viewer.pdfReadPages();
	assert.equal(successfulRead.incomplete, false);
	assert.equal(successfulRead.blockCount, 2);

	const blank = loadFunctions(["normalizeText", "getPageTextContent", "describePdfTextLayer"], {
		...dependencies, pageTextContentCache: new Map(), cachedPdfTextLayerInfo: null,
		pdfDocument: { numPages: 1, async getPage() { return { async getTextContent() { return { items: [] }; } }; } },
	});
	assert.equal((await blank.describePdfTextLayer()).likelyScanned, true, "a successfully extracted empty page remains a scanned-page candidate");
	const unavailable = loadFunctions(["normalizeText", "getPageTextContent"], {
		...dependencies, pageTextContentCache: new Map(),
		pdfDocument: { async getPage() { throw new Error("Page unavailable"); } },
	});
	await assert.rejects(unavailable.getPageTextContent(1), /Page unavailable/);
}

async function assertZoomPreservesLiveEdits(pendingPages) {
	const dom = new JSDOM('<body><section class="page" data-page-number="1"><div class="onhand-pdf-annotation-layer" data-onhand-pdf-coordinate-scale="1"></div></section></body>');
	const { document } = dom.window;
	const page = document.querySelector(".page");
	const layer = page.firstElementChild;
	layer.style.transform = "scale(2)";
	const addMark = (id) => {
		const mark = document.createElement("div");
		mark.setAttribute("data-onhand-annotation-id", id);
		mark.setAttribute("data-onhand-highlight-kind", "pdf");
		mark.setAttribute("data-onhand-pdf-anchor", JSON.stringify({ rects: [{ left: 10, top: 20, width: 30, height: 10 }], pageNumber: 1 }));
		layer.append(mark);
		return mark;
	};
	const keep = addMark("keep");
	addMark("delete-during-sharpen");
	const note = document.createElement("aside");
	note.setAttribute("data-onhand-note-for", "keep");
	note.setAttribute("data-onhand-note-collapsed", "true");
	note.textContent = "Original note";
	layer.append(note);
	let callback;
	let releaseRender;
	let reachedRender;
	const blockedRender = new Promise((resolve) => { releaseRender = resolve; });
	const startedRender = new Promise((resolve) => { reachedRender = resolve; });
	const positioned = [];
	const dependencies = {
		document, Element: dom.window.Element, CSS: { escape: (value) => value },
		getPdfPages: () => [page], getPageLayoutSize: () => ({ width: 200, height: 300 }),
		currentScale: 2, PDF_VIEWER_ANNOTATION_THEME: "light",
		findNoteForAnnotation: (id) => document.querySelector(`[data-onhand-note-for="${id}"]`),
		removeNotesForAnnotation: (id) => document.querySelector(`[data-onhand-note-for="${id}"]`)?.remove(),
		positionPdfNote: (...args) => positioned.push(args),
		window: { clearTimeout() {}, setTimeout(fn) { callback = fn; return 1; } },
		zoomRenderTimer: null, renderSequence: 1, zoomRevision: 1, ZOOM_RENDER_DELAY_MS: 1,
		commitTransientZoom() {}, countPendingPages: () => pendingPages,
		pagesNearViewport: () => [page], pageNeedsSharperRender: () => true, setStatus() {},
		pdfDocument: { numPages: 3 },
		async renderSharpPagesNearViewport() { reachedRender(); await blockedRender; },
	};
	const viewer = loadFunctions(["parsePdfAnchor", "clampPdfRectToPageSize", "unionRects", "makePdfHighlightPassive", "applyHighlightStyles", "refreshPdfAnnotationLayers", "settleZoomRender", "pdfRemoveAnnotations"], dependencies);
	viewer.settleZoomRender(1, 1);
	const settling = callback();
	if (!pendingPages) await startedRender;
	assert.equal(document.querySelector('[data-onhand-annotation-id="keep"]'), keep, "zoom must retain the actual mark element");
	assert.equal(keep.style.left, "20px");
	assert.equal(keep.style.width, "60px");
	assert.equal(layer.style.transform, "none");
	assert.equal(layer.getAttribute("data-onhand-pdf-coordinate-scale"), "2");
	assert.equal(document.querySelector('[data-onhand-note-for="keep"]'), note);
	assert.equal(note.getAttribute("data-onhand-note-collapsed"), "true");
	assert.equal(positioned.length, 1);
	const added = addMark("created-during-sharpen");
	viewer.pdfRemoveAnnotations(["delete-during-sharpen"]);
	note.textContent = "Edited during sharpening";
	note.setAttribute("data-onhand-note-collapsed", "false");
	releaseRender();
	await settling;
	assert.equal(document.querySelector('[data-onhand-annotation-id="created-during-sharpen"]'), added);
	assert.equal(document.querySelector('[data-onhand-annotation-id="delete-during-sharpen"]'), null);
	assert.equal(note.textContent, "Edited during sharpening");
	assert.equal(note.getAttribute("data-onhand-note-collapsed"), "false");
	viewer.refreshPdfAnnotationLayers();
	assert.equal(keep.style.left, "20px", "refresh at the same scale must not compound geometry");
	assert.equal(keep.children.length, 1, "refresh must replace old painted segments, not accumulate them");
	dom.window.close();
}

async function assertCitationAndHighlightSearchSurvivePageFailures() {
	const failures = new Set([3]);
	const texts = ["Page one", "References [14] Valid paper. [15] Another paper.", "Target passage"];
	const pages = [2, 3].map((pageNumber) => ({ pageNumber, querySelector: () => null,
		getBoundingClientRect: () => ({ width: 100, height: 150, top: 0 }) }));
	const dependencies = {
		pdfDocument: { numPages: 3 },
		async getPageTextContent(pageNumber) {
			if (failures.has(pageNumber)) throw new Error(`Damaged page ${pageNumber}`);
			return texts[pageNumber - 1];
		},
		sourceUrl: "https://example.test/fixture.pdf", document: { title: "Fixture" },
		extractCitationIdentifiers: () => ({}),
		getPdfPages: () => pages,
		isPendingPage: () => true, getPageNumber: (page) => page.pageNumber,
	};
	const viewer = loadFunctions(["normalizeText", "compactPendingSearchText", "pdfFindCitation", "findPendingPageWithText"], dependencies);
	const citation = await viewer.pdfFindCitation({ reference: "14" });
	assert.equal(citation.found, true, "an unreadable unrelated last page must not hide a healthy bibliography entry");
	assert.equal(citation.pageNumber, 2);
	assert.deepEqual(citation.coverage.failedPageNumbers, [3]);
	assert.equal(citation.coverage.incomplete, true);
	const missing = await viewer.pdfFindCitation({ reference: "99" });
	assert.equal(missing.found, false);
	assert.equal(missing.coverage.incomplete, true);
	assert.match(missing.message, /incomplete/i, "a partial miss must report its extraction gap");
	failures.clear();
	const complete = await viewer.pdfFindCitation({ reference: "14" });
	assert.equal(complete.coverage.incomplete, false);
	assert.deepEqual(complete.coverage.failedPageNumbers, []);
	failures.add(2);
	const failedPageNumbers = [];
	assert.equal(await viewer.findPendingPageWithText("Target passage", failedPageNumbers), 3,
		"a failed pending page must not hide a matching later page");
	assert.deepEqual(failedPageNumbers, [2]);
	const highlightViewer = loadFunctions(["pdfHighlightText"], {
		...dependencies, ...viewer, normalizePdfRegionRect: () => null, pdfAnchorPageNumber: () => null,
		visibleEnough: () => false, window: { innerHeight: 600 },
	});
	await assert.rejects(highlightViewer.pdfHighlightText("Absent passage"), /search is incomplete: could not read pages 2/,
		"a pending-page miss must preserve the extraction failure instead of claiming a complete no-match");
	failures.clear();
	await assert.rejects(highlightViewer.pdfHighlightText("Absent passage"), /No visible text matched/);
}

function assertFirstAnnotationCreatedDuringTransientZoom() {
	const dom = new JSDOM('<section class="page"></section>');
	try {
		const { document } = dom.window;
		const page = document.querySelector(".page");
		let width = 100, height = 150;
		Object.defineProperties(page, { clientWidth: { get: () => width }, clientHeight: { get: () => height } });
		page.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 300 });
		const viewer = loadFunctions(["getPageLayoutSize", "clampPdfRectToPageSize", "rangeRectsForPage", "unionRects", "ensureAnnotationLayer", "refreshPdfAnnotationLayers"], {
			document, currentScale: 2, committedScale: 1, getPdfPages: () => [page],
			textSegmentRectsForPage: () => [],
			parsePdfAnchor: (mark) => JSON.parse(mark.getAttribute("data-onhand-pdf-anchor")),
			applyHighlightStyles: (mark, rects) => mark.setAttribute("painted", JSON.stringify(rects)),
			findNoteForAnnotation: () => null,
		});
		const rects = viewer.rangeRectsForPage({ getClientRects: () => [{ left: 20, top: 40, width: 60, height: 20 }] }, page);
		assert.deepEqual(rects, [{ left: 10, top: 20, width: 30, height: 10 }]);
		const layer = viewer.ensureAnnotationLayer(page);
		const mark = document.createElement("div");
		mark.setAttribute("data-onhand-highlight-kind", "pdf");
		mark.setAttribute("data-onhand-pdf-anchor", JSON.stringify({ rects }));
		layer.append(mark);
		// The gesture now commits its scale to the page's actual layout.
		width = 200; height = 300;
		viewer.refreshPdfAnnotationLayers();
		assert.deepEqual(JSON.parse(mark.getAttribute("painted")), [{ left: 20, top: 40, width: 60, height: 20 }],
			"the first mark created during a gesture must scale from its committed-layout coordinates");
		assert.equal(layer.firstElementChild, mark, "settling preserves the mark identity");
	} finally { dom.window.close(); }
}

async function assertPdfScrollRestoresInsideViewerWithPausedFrames() {
	let refreshed = false;
	const window = { scrollX: 0, scrollY: 0, scrollTo({ left, top, behavior }) {
		assert.equal(behavior, "auto");
		this.scrollX = Math.min(80, left); this.scrollY = Math.min(2400, top);
	} };
	const viewer = loadFunctions(["waitForNextFrame", "pdfRestoreScrollPosition", "runPdfToolkitMethod"], {
		window, requestAnimationFrame: () => 1, setTimeout, updatePageFromScroll: () => { refreshed = true; },
	});
	const result = await viewer.runPdfToolkitMethod("restoreScrollPosition", [{ scrollX: 25, scrollY: 1200 }]);
	assert.deepEqual(result, { surface: "pdf", viewer: "onhand-pdf-viewer", scrollX: 25, scrollY: 1200 });
	assert.equal(refreshed, true, "restoring scroll updates the viewer page indicator");
	assert.deepEqual(await viewer.pdfRestoreScrollPosition({ scrollX: 500, scrollY: 5000 }),
		{ surface: "pdf", viewer: "onhand-pdf-viewer", scrollX: 80, scrollY: 2400 }, "return the actual clamped viewer position");

	const background = await readFile(new URL("../packages/browser-extension/background.js", import.meta.url), "utf8");
	for (const useBridge of [false, true]) {
		const calls = [];
		const dependencies = {
			resolveTargetTab: async () => ({ id: 7 }), withTabCommand: async (_id, fn) => fn(), simplifyTab: (tab) => tab,
			async callOnhandPdfViewerFrameViaRuntimePort(tabId, payload) {
				calls.push("port"); assert.equal(tabId, 7);
				if (useBridge) throw new Error("Port disconnected");
				return viewer.runPdfToolkitMethod(payload.methodName, payload.args);
			},
			async callOnhandPdfViewerFrameViaBridge(tabId, payload) {
				calls.push("bridge"); assert.equal(tabId, 7);
				return viewer.runPdfToolkitMethod(payload.methodName, payload.args);
			},
			evaluateInTab: () => assert.fail("PDF scroll must not evaluate the tab's native top frame"),
		};
		const command = new Function(...Object.keys(dependencies), `${declaration("handleCommandInner", background)}\nreturn handleCommandInner;`)(...Object.values(dependencies));
		const restored = await command("pdf_restore_scroll", { tabId: 7, scrollX: 25, scrollY: 1200 });
		assert.equal(restored.scroll.scrollY, 1200);
		assert.deepEqual(calls, useBridge ? ["port", "bridge"] : ["port"]);
	}
}

async function assertGenericScrollSettlesWithPausedFrames() {
	const runtimeSource = await readFile(new URL("../packages/browser-extension/src/browser-runtime.ts", import.meta.url), "utf8");
	const { code: runtimeCode } = await transform(runtimeSource, { loader: "ts", target: "es2022" });
	const roots = 'const collectRestoreScrollRoots = () => [{ type: "window", maxX: 100, maxY: 2000, scrollHeight: 2600, clientHeight: 600 }];';
	const expression = new Function("replayScrollRootsScript", `${declaration("replayScrollPositionExpression", runtimeCode)}\nreturn replayScrollPositionExpression;`)(() => roots)(25, 1200);
	const window = { scrollX: 0, scrollY: 0, innerHeight: 600, scrollTo(x, y) { this.scrollX = x; this.scrollY = y; } };
	let timeout;
	try {
		const result = await Promise.race([
			new Function("window", "requestAnimationFrame", "setTimeout", "clearTimeout", `return ${expression};`)(window, () => 1, setTimeout, clearTimeout),
			new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Scroll waited indefinitely for an animation frame")), 1000); }),
		]);
		assert.equal(result.scrollX, 25);
		assert.equal(result.scrollY, 1200, "generic page scroll must settle even when no animation frame arrives");
	} finally { clearTimeout(timeout); }
}

await assertExtractionCoverage();
await assertZoomPreservesLiveEdits(0);
await assertZoomPreservesLiveEdits(1);
await assertCitationAndHighlightSearchSurvivePageFailures();
assertFirstAnnotationCreatedDuringTransientZoom();
await assertPdfScrollRestoresInsideViewerWithPausedFrames();
await assertGenericScrollSettlesWithPausedFrames();
console.log("PDF viewer review regressions: PASS");
