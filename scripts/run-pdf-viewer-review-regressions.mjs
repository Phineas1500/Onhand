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

function constant(name) {
	const match = code.match(new RegExp(`^const ${name} = ([^;]+);`, "m"));
	assert.ok(match, `Missing production constant: ${name}`);
	return new Function(`return (${match[1]});`)();
}

// Every page of a long PDF used to be drawn and kept: 883 pages held 5.8 GB of
// page images, and on a slower computer a highlight ran past its time limit
// behind that work and behind a walk of every page's text. The viewer now
// keeps the images of the pages around the reading position, inside a budget;
// the other pages keep only their text, for find-in-page and selection.
async function assertLongPdfsKeepOnlyNearbyPageImages() {
	const pageCount = 100;
	const dom = new JSDOM(`<body>${Array.from({ length: pageCount }, (_, index) => `<section class="page" data-page-number="${index + 1}" data-onhand-pdf-pending="true"></section>`).join("")}</body>`);
	const { document } = dom.window;
	const constants = Object.fromEntries(["PAGE_IMAGE_BUDGET_BYTES", "PAGE_IMAGE_MAX_PAGES", "PAGE_IMAGE_MIN_PAGES", "PAGE_IMAGE_RELEASE_GRACE_MS"].map((name) => [name, constant(name)]));
	const pageInput = { value: "1" };
	const pageRenderedAt = new Map();
	const pageRenderPromises = new Map();
	const cleaned = [];
	const statuses = [];
	const visiblePages = new Set();
	let canvasSide = 1000;
	let warmed = 0;
	let renders = 0;
	let sharpenPasses = 0;
	const dependencies = {
		...constants,
		document, window: dom.window, HTMLElement: dom.window.HTMLElement,
		pageInput, pageRenderedAt, pageRenderPromises,
		renderSequence: 1, backgroundFillSequence: null, activeToolkitCommands: 0, lastToolkitCommandAt: 0, TOOLKIT_QUIET_MS: 400,
		findViewportPage: () => null,
		visibleEnough: (rect) => Boolean(rect.onScreen),
		pdfDocument: { numPages: pageCount, async getPage(pageNumber) { return { cleanup() { cleaned.push(pageNumber); } }; } },
		// A rendered page is a canvas and a ready text layer, as renderPageContent leaves it.
		async ensurePageRendered(pageNumber) {
			renders += 1;
			const page = document.querySelector(`.page[data-page-number="${pageNumber}"]`);
			page.innerHTML = '<div class="canvasWrapper"><canvas></canvas></div><div class="textLayer" data-onhand-pdf-text-ready="true"><span>text</span></div>';
			const canvas = page.querySelector("canvas");
			canvas.width = canvasSide;
			canvas.height = canvasSide;
			page.getBoundingClientRect = () => ({ onScreen: visiblePages.has(pageNumber) });
			page.removeAttribute("data-onhand-pdf-pending");
			// Rendered long enough ago to be released.
			pageRenderedAt.set(pageNumber, 0);
		},
		setStatus: (message) => statuses.push(message),
		statusElement: { get textContent() { return statuses.at(-1) || ""; } },
		scheduleViewportRender() { sharpenPasses += 1; },
		fillPendingPageText: async () => { warmed += 1; },
	};
	const names = [
		"getPdfPages", "getPageNumber", "isPendingPage", "currentReadingPageNumber", "renderedPageImages", "pageImagesExceedBudget", "canReleasePageImage",
		"releasePageImage", "trimPageImages", "backgroundFillHasRoomFor", "backgroundFillRunning", "nextPendingPageNumber", "countPendingPages",
		"waitForToolkitIdle", "renderRemainingPages",
	];
	const viewer = loadFunctions(names, dependencies);
	const renderedNumbers = () => viewer.getPdfPages().filter((page) => !viewer.isPendingPage(page)).map((page) => viewer.getPageNumber(page));
	const pageAt = (pageNumber) => document.querySelector(`.page[data-page-number="${pageNumber}"]`);

	// Opening the PDF: the fill stops at the page limit, nearest pages first.
	await viewer.renderRemainingPages(1);
	assert.deepEqual(renderedNumbers(), Array.from({ length: constants.PAGE_IMAGE_MAX_PAGES }, (_, index) => index + 1), "the fill renders the pages nearest the reading position and stops at the limit");
	assert.equal(document.body.getAttribute("data-onhand-pdf-rendered"), "true");
	assert.equal(statuses.at(-1), "Ready", "the viewer is ready although pages stay unrendered");
	assert.equal(warmed, 1, "the pages left without an image get their text");
	assert.equal(viewer.backgroundFillRunning(1), false);

	// The reader jumps to page 90. Page 3 holds a mark, page 5 a note, page 7 is
	// still on screen in a second window, page 9 is rendering and page 11 only
	// just rendered: all keep their images. The rest make room, farthest first.
	const mark = document.createElement("div");
	mark.setAttribute("data-onhand-annotation-id", "onhand-1");
	pageAt(3).append(mark);
	const note = document.createElement("aside");
	note.setAttribute("data-onhand-note-for", "onhand-2");
	pageAt(5).append(note);
	visiblePages.add(7);
	pageRenderPromises.set(9, Promise.resolve());
	pageRenderedAt.set(11, Date.now());
	pageInput.value = "90";
	renders = 0;
	await viewer.renderRemainingPages(1, { quiet: true });
	const afterJump = renderedNumbers();
	assert.ok(afterJump.length <= constants.PAGE_IMAGE_MAX_PAGES, "the rendered pages stay within the limit");
	for (const kept of [3, 5, 7, 9, 11]) assert.ok(afterJump.includes(kept), `page ${kept} keeps its image`);
	for (const near of [80, 88, 89, 90, 91, 92, 100]) assert.ok(afterJump.includes(near), `page ${near} near the reading position is rendered`);
	assert.equal(afterJump.includes(1), false, "a far page with nothing on it gives its image back");
	assert.equal(pageAt(1).querySelector("canvas, .canvasWrapper"), null, "a released page has no image");
	assert.equal(pageAt(1).querySelector('.textLayer[data-onhand-pdf-text-ready="true"]')?.textContent, "text", "and keeps its text for find-in-page");
	assert.equal(pageAt(1).getAttribute("data-onhand-pdf-pending"), "true", "it counts as unrendered again");
	assert.equal(pageAt(3).contains(mark), true, "the mark is untouched");
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.ok(cleaned.includes(1), "PDF.js is told to drop a released page's fonts and images");
	assert.equal(cleaned.includes(3), false);
	assert.ok(renders > 0 && renders <= pageCount - 5, "the fill renders pages around the new position without churning");
	const settledRenders = renders;
	await viewer.renderRemainingPages(1, { quiet: true });
	assert.equal(renders, settledRenders, "a second pass at the same position renders nothing");
	assert.equal(statuses.at(-1), "Ready", "a fill that follows scrolling leaves the status alone");

	// A zoom that settles while a fill runs shows the page count and leaves
	// its sharpening to the end of that fill, whichever kind of fill it is.
	statuses.push("Rendered 60/100");
	sharpenPasses = 0;
	await viewer.renderRemainingPages(1, { quiet: true });
	assert.equal(statuses.at(-1), "Ready", "the fill clears the page count a zoom left");
	assert.equal(sharpenPasses, 1, "and sharpens the pages on screen");
	statuses.push("Zoom 150%");
	await viewer.renderRemainingPages(1, { quiet: true });
	assert.equal(statuses.at(-1), "Zoom 150%", "another status is not the fill's to change");

	// Large page images (a zoomed or scanned PDF) fill the byte budget first.
	for (const page of viewer.getPdfPages()) {
		if (!viewer.isPendingPage(page)) viewer.releasePageImage(page, viewer.getPageNumber(page));
		page.querySelector("[data-onhand-annotation-id], [data-onhand-note-for]")?.remove();
	}
	pageRenderPromises.clear();
	visiblePages.clear();
	canvasSide = 4000;
	pageInput.value = "50";
	await viewer.renderRemainingPages(1, { quiet: true });
	const largePages = renderedNumbers();
	const bytesPerPage = canvasSide * canvasSide * 4;
	assert.equal(largePages.length, Math.floor(constants.PAGE_IMAGE_BUDGET_BYTES / bytesPerPage), "large images stop the fill at the byte budget");
	assert.ok(largePages.includes(50) && largePages.every((pageNumber) => Math.abs(pageNumber - 50) <= 3), "and the pages kept are the ones around the reading position");

	// Over the budget with marks on ten far pages: the marked pages stay, and so
	// do the pages beside the reading position, whatever the budget says.
	canvasSide = 9000;
	const marked = Array.from({ length: 10 }, (_, index) => 20 + index);
	for (const pageNumber of [...marked, 48, 49, 50, 51, 52]) {
		await dependencies.ensurePageRendered(pageNumber);
		if (!marked.includes(pageNumber)) continue;
		const farMark = document.createElement("div");
		farMark.setAttribute("data-onhand-annotation-id", `onhand-${pageNumber}`);
		pageAt(pageNumber).append(farMark);
	}
	viewer.trimPageImages();
	for (const pageNumber of [...marked, 48, 49, 50, 51, 52]) assert.ok(renderedNumbers().includes(pageNumber), `page ${pageNumber} is kept over the budget`);
	assert.equal(renderedNumbers().includes(47) || renderedNumbers().includes(53), false, "the unmarked page three away is released");
	dom.window.close();
}

// Pages without an image get their text layer, built from one read of the
// page's text that also feeds Onhand's own search of unrendered pages. Search,
// read and highlight then use that text and leave those layers alone.
async function assertUnrenderedPagesKeepTextWithoutBeingWalked() {
	const dom = new JSDOM(`<body>${[1, 2, 3].map((pageNumber) => `<section class="page" data-page-number="${pageNumber}" data-onhand-pdf-pending="true"></section>`).join("")}</body>`);
	const { document } = dom.window;
	const pageAt = (pageNumber) => document.querySelector(`.page[data-page-number="${pageNumber}"]`);
	const pageTextContentCache = new Map();
	const pageRenderPromises = new Map();
	const reads = [];
	class TextLayer {
		constructor({ textContentSource, container }) { this.items = textContentSource.items; this.container = container; }
		async render() {
			for (const item of this.items) {
				if (typeof item.str !== "string") continue;
				const span = document.createElement("span");
				span.textContent = item.str;
				this.container.append(span);
			}
		}
	}
	const textFor = (pageNumber) => `Page ${pageNumber} holds the phrase alpha${pageNumber} beta.`;
	const dependencies = {
		document, HTMLElement: dom.window.HTMLElement, TextLayer, pageTextContentCache, pageRenderPromises,
		renderSequence: 1, textFillSequence: null, committedScale: 1, activeToolkitCommands: 0, lastToolkitCommandAt: 0, TOOLKIT_QUIET_MS: 400, window: dom.window,
		pdfDocument: { numPages: 3, async getPage(pageNumber) {
			return {
				getViewport: () => ({ width: 600, height: 800 }),
				async getTextContent(options) {
					reads.push({ pageNumber, markedContent: options?.includeMarkedContent === true });
					if (pageNumber === 3) throw new Error("Damaged page stream");
					return { items: [{ type: "beginMarkedContent" }, { str: textFor(pageNumber), hasEOL: true }, { type: "endMarkedContent" }] };
				},
			};
		} },
	};
	const viewer = loadFunctions(["normalizeText", "getPdfPages", "getPageNumber", "isPendingPage", "textFromPdfTextItems", "waitForToolkitIdle", "renderPageTextOnly", "fillPendingPageText"], dependencies);
	// Page 2 is rendering in full: its render builds the text itself.
	pageRenderPromises.set(2, Promise.resolve());
	await viewer.fillPendingPageText(1);
	const layer = pageAt(1).querySelector(".textLayer");
	assert.equal(layer?.getAttribute("data-onhand-pdf-text-ready"), "true", "an unrendered page gets a ready text layer");
	assert.equal(layer.textContent, textFor(1));
	assert.equal(layer.querySelector("span").getAttribute("data-onhand-pdf-text-span"), "0", "its spans are numbered as a full render numbers them");
	assert.equal(pageAt(1).querySelector("canvas"), null, "and no image");
	assert.equal(pageAt(1).getAttribute("data-onhand-pdf-pending"), "true", "the page still counts as unrendered");
	assert.equal(pageTextContentCache.get(1), textFor(1), "the same read fills the text Onhand's search uses");
	assert.deepEqual(reads.filter((read) => read.pageNumber === 1), [{ pageNumber: 1, markedContent: true }], "one read per page");
	assert.equal(pageAt(2).querySelector(".textLayer"), null, "a page that is rendering is left to its render");
	assert.equal(pageAt(3).querySelector(".textLayer"), null, "a page that cannot be read has no text layer");
	assert.equal(pageTextContentCache.has(3), false, "and stays readable later");
	await viewer.fillPendingPageText(1);
	assert.equal(reads.filter((read) => read.pageNumber === 1).length, 1, "a second pass does not read the page again");

	// Search and read take an unrendered page's text from the cache, not from its layer.
	layer.querySelector("span").textContent = "Stale layer text that tools must not read.";
	const walked = [];
	const tools = loadFunctions(["normalizeText", "foldTypesetPunctuation", "isPendingPage", "pdfSearch", "pdfReadPages"], {
		pageTextContentCache, cachedPdfTextLayerInfo: null, pdfDocument: dependencies.pdfDocument,
		getPdfPages: () => [pageAt(1)], getPdfPageByNumber: () => pageAt(1), getPageNumber: () => 1, parsePdfPageNumbers: () => [1],
		getPageTextContent: async (pageNumber) => pageTextContentCache.get(pageNumber), loadPageTexts: async () => {},
		pdfPageText: (page) => { walked.push(page); return page.textContent; },
		findMappedTextRange: () => assert.fail("search must not walk an unrendered page's text layer"),
		describePdfTextLayer: async () => null, snippetForMatch: () => ({ before: "", after: "", snippet: "" }),
		rectToObject: () => ({}), visibleEnough: () => false, sourceUrl: "https://example.test/long.pdf", document: { title: "Long" },
	});
	const search = await tools.pdfSearch({ query: "alpha1 beta" });
	assert.equal(search.matchCount, 1);
	assert.equal(search.matches[0].pendingRender, true, "the match is reported on an unrendered page");
	assert.equal((await tools.pdfReadPages({ pages: "1" })).text, `[p. 1] ${textFor(1)}`);
	assert.deepEqual(walked, [], "neither walked the layer");
	dom.window.close();
}

// The first search of a long PDF read its pages' text one page at a time,
// each read a turn of a main thread busy drawing. They are now read several at
// a time, at most once each, and a page that fails is left for its caller.
async function assertPageTextsAreReadTogetherAndOnce() {
	const pageTextContentCache = new Map([[2, "already read"]]);
	const reads = [];
	let inFlight = 0;
	let mostInFlight = 0;
	const limit = constant("PAGE_TEXT_READS_AT_ONCE");
	const viewer = loadFunctions(["normalizeText", "textFromPdfTextItems", "getPageTextContent", "loadPageTexts"], {
		pageTextContentCache, pageTextReads: new Map(), PAGE_TEXT_READS_AT_ONCE: limit,
		pdfDocument: { async getPage(pageNumber) {
			return { async getTextContent() {
				reads.push(pageNumber);
				inFlight += 1;
				mostInFlight = Math.max(mostInFlight, inFlight);
				await new Promise((resolve) => setTimeout(resolve, 2));
				inFlight -= 1;
				if (pageNumber === 7) throw new Error("Damaged page stream");
				return { items: [{ str: `Text of page ${pageNumber}`, hasEOL: true }] };
			} };
		} },
	});
	const pageNumbers = Array.from({ length: 40 }, (_, index) => index + 1);
	// A second caller arrives while the first is still reading.
	await Promise.all([viewer.loadPageTexts(pageNumbers), viewer.loadPageTexts(pageNumbers), viewer.getPageTextContent(5)]);
	assert.equal(mostInFlight, limit, "pages are read several at a time, up to the limit");
	assert.equal(reads.filter((pageNumber) => pageNumber === 5).length, 1, "a page being read is not read again by a second caller");
	assert.equal(reads.includes(2), false, "a page already read is not read again");
	assert.equal(pageTextContentCache.get(40), "Text of page 40");
	assert.equal(pageTextContentCache.has(7), false, "a failed read is not kept");
	await assert.rejects(viewer.getPageTextContent(7), /Damaged page stream/, "and its caller still sees the failure");
}

// PDF.js waits for an animation frame between the steps of drawing a page,
// and frames stop in a hidden tab: a page being drawn when the reader
// switched tabs stayed undrawn until they came back. Frames waited on in a
// hidden document now run from a task.
async function assertAnimationFramesContinueInAHiddenTab() {
	const nativeFrames = new Map();
	const cancelled = [];
	let nextId = 1;
	let visibilityListener = null;
	const document = { visibilityState: "visible", addEventListener: (type, fn) => { assert.equal(type, "visibilitychange"); visibilityListener = fn; } };
	const window = {
		requestAnimationFrame(callback) { const id = nextId++; nativeFrames.set(id, callback); return id; },
		cancelAnimationFrame(id) { cancelled.push(id); nativeFrames.delete(id); },
	};
	const paint = () => { for (const [id, callback] of [...nativeFrames]) { nativeFrames.delete(id); callback(16); } };
	const task = () => new Promise((resolve) => setTimeout(resolve, 5));
	loadFunctions(["installHiddenTabAnimationFrames"], { window, document, MessageChannel, performance }).installHiddenTabAnimationFrames();
	const ran = [];

	window.requestAnimationFrame(() => ran.push("visible"));
	await task();
	assert.deepEqual(ran, [], "a visible document waits for its frame");
	paint();
	assert.deepEqual(ran, ["visible"]);

	// The reader switches tabs while a frame is waited on.
	window.requestAnimationFrame(() => ran.push("waiting when hidden"));
	const dropped = window.requestAnimationFrame(() => ran.push("cancelled"));
	document.visibilityState = "hidden";
	visibilityListener();
	window.cancelAnimationFrame(dropped);
	await task();
	assert.deepEqual(ran, ["visible", "waiting when hidden"], "a frame still waited on when the tab is hidden runs from a task; a cancelled one never runs");
	assert.equal(nativeFrames.size, 0, "and is no longer left with the browser");

	window.requestAnimationFrame(() => ran.push("asked while hidden"));
	await task();
	assert.equal(ran.at(-1), "asked while hidden", "a frame asked for while hidden runs from a task");

	// Back in view: frames come from the browser again, each callback once.
	document.visibilityState = "visible";
	visibilityListener();
	window.requestAnimationFrame(() => ran.push("visible again"));
	await task();
	assert.equal(ran.at(-1), "asked while hidden");
	paint();
	paint();
	assert.deepEqual(ran.filter((entry) => entry === "visible again"), ["visible again"]);
}

function assertPendingPageSearchFormsAreCached() {
	const pageSearchFormsCache = new Map();
	const { pageSearchForms } = loadFunctions(["compactPendingSearchText", "normalizeSearchChar", "isSearchableChar", "buildSearchText", "compactSearchText", "pageSearchForms"], { pageSearchFormsCache });
	const first = pageSearchForms(4, "Bees Dance, to share: directions.");
	assert.equal(first.lower, "bees dance, to share: directions.");
	assert.equal(first.compact, "beesdance,toshare:directions.");
	assert.equal(first.letters, "beesdancetosharedirections");
	assert.equal(pageSearchForms(4, "Bees Dance, to share: directions."), first, "the same page text is prepared once");
	assert.notEqual(pageSearchForms(4, "Other text."), first, "new text for a page replaces its cached forms");
}

function assertPageRangesParse() {
	// "pages": "1-6" used to fall back to the current page alone.
	const { parsePdfPageNumbers } = loadFunctions(["parsePdfPageNumbers"], {
		pdfDocument: { numPages: 8 },
		getPdfPages: () => [],
		pageInput: { value: "2" },
	});
	assert.deepEqual(parsePdfPageNumbers({ pages: "1-6" }), [1, 2, 3, 4, 5, 6]);
	assert.deepEqual(parsePdfPageNumbers({ pages: "2, 5–7" }), [2, 5, 6, 7], "en dash ranges mix with single pages");
	assert.deepEqual(parsePdfPageNumbers({ pages: "3 - 4,8" }), [3, 4, 8]);
	assert.deepEqual(parsePdfPageNumbers({ pages: "6 to 12" }), [6, 7, 8], "ranges clamp to the page count");
	assert.deepEqual(parsePdfPageNumbers({ pages: "2,8,9" }), [2, 8]);
	assert.deepEqual(parsePdfPageNumbers({}), [2], "no pages still reads the current page");
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
		pageTextReads: new Map(), PAGE_TEXT_READS_AT_ONCE: constant("PAGE_TEXT_READS_AT_ONCE"),
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
	const viewer = loadFunctions(["normalizeText", "foldTypesetPunctuation", "textFromPdfTextItems", "getPageTextContent", "loadPageTexts", "describePdfTextLayer", "pdfSearch", "pdfReadPages"], dependencies);
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

	// A typed ' " or - finds a PDF's typeset one: searching the IRS W-4 for
	// "Employee's Withholding Certificate" found nothing, because the form
	// sets its title with a curly apostrophe.
	const typeset = loadFunctions(["normalizeText", "foldTypesetPunctuation", "textFromPdfTextItems", "getPageTextContent", "loadPageTexts", "describePdfTextLayer", "pdfSearch"], {
		...dependencies, pageTextContentCache: new Map(), cachedPdfTextLayerInfo: null,
		pdfDocument: { numPages: 1, async getPage() {
			return { async getTextContent() { return { items: [{ str: "Form W-4 Employee\u2019s Withholding Certificate \u2013 \u201cStep 1\u201d", hasEOL: true }] }; } };
		} },
		getPdfPages: () => pages.slice(0, 1),
		snippetForMatch: (_text, matchedText) => ({ before: "", after: "", snippet: matchedText }),
		findMappedTextRange: () => null,
		buildPdfAnchor: () => ({}),
		visibleEnough: () => true,
	});
	for (const query of ["Employee's Withholding Certificate", "employee\u2019s withholding certificate", 'Certificate - "Step 1"']) {
		const found = await typeset.pdfSearch({ query });
		assert.equal(found.matchCount, 1, `a typed query finds typeset punctuation: ${query}`);
	}
	const typesetMatch = (await typeset.pdfSearch({ query: "Employee's Withholding" })).matches[0];
	assert.equal(typesetMatch.matchedText, "Employee\u2019s Withholding", "the match is reported in the page's own characters");
	assert.equal((await typeset.pdfSearch({ query: "Employer's Withholding Certificate" })).matchCount, 0, "other words still have to match");

	const blank = loadFunctions(["normalizeText", "textFromPdfTextItems", "getPageTextContent", "describePdfTextLayer"], {
		...dependencies, pageTextContentCache: new Map(), cachedPdfTextLayerInfo: null,
		pdfDocument: { numPages: 1, async getPage() { return { async getTextContent() { return { items: [] }; } }; } },
	});
	assert.equal((await blank.describePdfTextLayer()).likelyScanned, true, "a successfully extracted empty page remains a scanned-page candidate");
	const unavailable = loadFunctions(["normalizeText", "textFromPdfTextItems", "getPageTextContent"], {
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
		refreshPdfNotePositions: (...args) => positioned.push(args),
		window: { clearTimeout() {}, setTimeout(fn) { callback = fn; return 1; } },
		zoomRenderTimer: null, renderSequence: 1, zoomRevision: 1, ZOOM_RENDER_DELAY_MS: 1,
		commitTransientZoom() {}, countPendingPages: () => pendingPages,
		// "Still filling" is whether the background fill runs, not whether pages are unrendered.
		backgroundFillRunning: () => Boolean(pendingPages), scheduleBackgroundFill() {},
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
	assert.equal(positioned.length, 1, "zoom lays out the notes once");
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
	const layerLookups = [];
	const pages = [2, 3].map((pageNumber) => ({ pageNumber, querySelector: (selector) => { layerLookups.push(selector); return null; },
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
	const viewer = loadFunctions(
		["normalizeText", "compactPendingSearchText", "isSearchableChar", "normalizeSearchChar", "buildSearchText", "normalizeSearchText", "compactSearchText", "findFuzzyTokenRange", "pdfFindCitation", "pageSearchForms", "loadPageTexts", "findPendingPageWithText"],
		{ ...dependencies, pageSearchFormsCache: new Map(), pageTextContentCache: new Map(), PAGE_TEXT_READS_AT_ONCE: constant("PAGE_TEXT_READS_AT_ONCE") },
	);
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
	const highlightViewer = loadFunctions(["pdfHighlightText", "findNearPdfTextMatch"], {
		...dependencies, ...viewer, normalizePdfRegionRect: () => null, pdfAnchorPageNumber: () => null,
		visibleEnough: () => false, window: { innerHeight: 600 },
	});
	await assert.rejects(highlightViewer.pdfHighlightText("Absent passage"), /search is incomplete: could not read pages 2/,
		"a pending-page miss must preserve the extraction failure instead of claiming a complete no-match");
	failures.clear();
	await assert.rejects(highlightViewer.pdfHighlightText("Absent passage"), /No visible text matched/);
	// Unrendered pages of a long PDF hold a text layer for find-in-page. A
	// highlight compares their PDF.js text and never walks those layers.
	assert.deepEqual(layerLookups.filter((selector) => /textLayer/.test(selector)), [], "a highlight leaves the text layers of unrendered pages alone");
}

// A PDF's curly quotes and long dashes used to be compared as typed, so a
// quote with a plain " or - matched nothing; and with no near match at all, a
// quote that left out one word (or the "[12]" the PDF has mid-sentence) could
// not be marked. Punctuation no longer counts, and a near match lands when
// every page's exact passes found nothing.
async function assertPdfQuotesMatchDespitePunctuationAndMissingWords() {
	const dom = new JSDOM(`<body>
		<section class="page" data-page-number="1"><div class="textLayer">
			<span>Charlie Munger – The Architect of Berkshire Hathaway.</span>
			<span>He said “invest in wonderful businesses” and never looked back at the earlier mistakes.</span>
		</div></section>
		<section class="page" data-page-number="2"><div class="textLayer">
			<span>Recurrent models [12] typically factor computation along the symbol positions of the input and output sequences.</span>
		</div></section>
	</body>`);
	const { window } = dom;
	const pages = [...window.document.querySelectorAll(".page")];
	const names = [
		"normalizeText", "isSearchableChar", "normalizeSearchChar", "pdfTextNodeBoundaryNeedsSpace", "rangeTextWithPdfBoundarySpaces", "buildNormalizedTextMap",
		"buildSearchText", "normalizeSearchText", "compactSearchText", "collectMatchIndices", "commonSuffixLength", "commonPrefixLength", "scoreContextAt",
		"pickMatchIndex", "extractNormalizedContext", "rangeFromMapPositions", "findFuzzyTokenRange", "findMappedTextRange", "findNearPdfTextMatch",
	];
	const viewer = loadFunctions(names, {
		document: window.document, Node: window.Node, NodeFilter: window.NodeFilter, window,
		ANCHOR_CONTEXT_LENGTH: 80, MIN_CONTEXT_SCORE: 6,
		getPageNumber: (page) => Number(page.getAttribute("data-page-number")),
		isPendingPage: () => false,
		getPageTextContent: async () => "",
		ensurePageRendered: async () => {},
		getPdfPageByNumber: (pageNumber) => pages[pageNumber - 1],
	});
	const [first, second] = pages.map((page) => page.querySelector(".textLayer"));

	const plainQuotes = viewer.findMappedTextRange(first, 'He said "invest in wonderful businesses" and never looked back');
	assert.equal(plainQuotes?.fallback, undefined, "plain quotes for curly ones is an exact match");
	assert.match(plainQuotes.matchedText, /^He said “invest in wonderful businesses” and never looked back$/);
	assert.ok(viewer.findMappedTextRange(first, "Charlie Munger - The Architect of Berkshire Hathaway"), "a hyphen for an en dash matches");

	const withoutCitation = "Recurrent models typically factor computation along the symbol positions of the input and output sequences.";
	assert.equal(viewer.findMappedTextRange(second, withoutCitation), null, "the exact passes don't skip the citation number");
	const near = viewer.findMappedTextRange(second, withoutCitation, 1, null, { fuzzy: true });
	assert.equal(near?.fallback, "approximate");
	assert.match(near.matchedText, /^Recurrent models \[12\] typically factor .* output sequences$/, "the near match covers the sentence, citation number included");
	assert.ok(
		viewer.findMappedTextRange(second, "Recurrent models [12] typically factor computation along the symbol positions of the input sequences", 1, null, { fuzzy: true }),
		"a longer quote can leave a word out",
	);
	assert.equal(viewer.findMappedTextRange(second, "Recurrent models [12] usually factor computation", 1, null, { fuzzy: true }), null, "a short quote must have all its words");
	assert.equal(
		viewer.findMappedTextRange(second, "Convolutional networks rarely factor images along the spatial dimensions of each layer", 1, null, { fuzzy: true }),
		null,
		"a sentence that only shares a few words is not a match",
	);

	const found = await viewer.findNearPdfTextMatch(withoutCitation, pages);
	assert.equal(found?.page, pages[1], "the near match is taken from the page that holds the sentence");
	assert.equal(await viewer.findNearPdfTextMatch("Convolutional networks rarely factor images along the spatial dimensions of each layer", pages), null);
	dom.window.close();
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
			refreshPdfNotePositions() {},
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
		window, document: { visibilityState: "visible" }, requestAnimationFrame: () => 1, setTimeout, updatePageFromScroll: () => { refreshed = true; },
	});
	// A hidden viewer (background tab) has no frame to wait for and Chrome
	// clamps its timers to 1 s; it yields a message-channel task instead.
	const hiddenViewer = loadFunctions(["waitForNextFrame"], {
		document: { visibilityState: "hidden" }, MessageChannel,
		requestAnimationFrame: () => assert.fail("a hidden viewer must not wait for a frame"),
		setTimeout: () => assert.fail("a hidden viewer must not wait on a clamped timer"),
	});
	await hiddenViewer.waitForNextFrame();
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

// The viewer's own "not in this PDF" used to be sent again over three more
// routes to the same viewer, each running the search again, and on a tab the
// debugger may not attach to the last route added Chrome's refusal to the
// message (a failed page capture read as "restricted").
async function assertViewerAnswersAreNotSentAgain() {
	const background = await readFile(new URL("../packages/browser-extension/background.js", import.meta.url), "utf8");
	const load = (names, dependencies) => new Function(...Object.keys(dependencies), `${names.map((name) => declaration(name, background)).join("\n")}\nreturn { ${names.join(", ")} };`)(...Object.values(dependencies));

	// The runtime port marks an answer from the viewer; a missing port is not one.
	const listeners = [];
	const port = {
		onMessage: { addListener: (fn) => listeners.push(fn), removeListener: (fn) => listeners.splice(listeners.indexOf(fn), 1) },
		postMessage(message) {
			queueMicrotask(() => [...listeners].forEach((fn) => fn({ type: "onhand-pdf-viewer-evaluate-result", requestId: message.requestId, ok: false, error: "No visible text matched: absent quote" })));
		},
	};
	const records = new Map([["7|https://example.test/a.pdf", { port }]]);
	const { callOnhandPdfViewerFrameViaRuntimePort } = load(["callOnhandPdfViewerFrameViaRuntimePort"], {
		chrome: { tabs: { get: async (id) => ({ id }) } },
		resolveInlineOnhandPdfViewerSourceUrl: async () => "https://example.test/a.pdf",
		onhandPdfViewerPortRecords: records,
		onhandPdfViewerPortKey: (tabId, url) => `${tabId}|${url}`,
		normalizeExecuteScriptValue: (value) => value,
		PDF_READER_FRAME_EXECUTION_TIMEOUT_MS: 1000,
		setTimeout, clearTimeout,
	});
	const answered = await callOnhandPdfViewerFrameViaRuntimePort(7, { command: "page-toolkit-method" }, "missing").catch((error) => error);
	assert.equal(answered.message, "No visible text matched: absent quote");
	assert.equal(answered.onhandPdfViewerAnswered, true, "a failure the viewer reported is its answer");
	const missing = await callOnhandPdfViewerFrameViaRuntimePort(8, { command: "page-toolkit-method" }, "No Onhand PDF viewer frame context found for highlightText").catch((error) => error);
	assert.equal(missing.onhandPdfViewerAnswered, undefined, "a tab without a viewer port has not answered");

	const run = async (portError) => {
		const calls = [];
		const { executePageToolkitMethodViaOnhandPdfViewerFrame } = load(["isOnhandPdfViewerAnswer", "executePageToolkitMethodViaOnhandPdfViewerFrame"], {
			async callOnhandPdfViewerFrameViaRuntimePort() { calls.push("port"); throw portError; },
			async callOnhandPdfViewerFrameViaBridge() { calls.push("bridge"); throw new Error("No Onhand PDF viewer frame context found for highlightText"); },
			async evaluateInOnhandPdfViewerFrameViaScripting() { calls.push("scripting"); throw new Error("No Onhand PDF viewer frame context found for highlightText"); },
			async evaluateInMatchingFrame() { calls.push("debugger"); throw new Error("Cannot access a chrome-extension:// URL of different extension"); },
			frameOrContextLooksLikeOnhandPdfViewer: () => true,
			createPageToolkit: () => ({}),
		});
		const error = await executePageToolkitMethodViaOnhandPdfViewerFrame(7, "highlightText", ["absent quote", {}]).catch((caught) => caught);
		return { calls, message: error.message };
	};
	assert.deepEqual(await run(answered), { calls: ["port"], message: "No visible text matched: absent quote" }, "the viewer's answer stands as it is, with nothing added");
	const unsupported = Object.assign(new Error("Unsupported Onhand PDF viewer toolkit method: getScrollState"), { onhandPdfViewerAnswered: true });
	assert.deepEqual((await run(unsupported)).calls, ["port", "bridge", "scripting", "debugger"], "a method the viewer lacks still goes on to the generic toolkit");
	assert.deepEqual((await run(new Error("Timed out waiting for Onhand PDF viewer runtime bridge"))).calls, ["port", "bridge", "scripting", "debugger"], "a port that did not answer still falls back to the other routes");
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

// Notes without room beside the page: one card stays open, the rest fold into
// tabs at the page edge, level with their highlights.
function assertNarrowPdfNotesFoldToTabs() {
	const dom = new JSDOM('<section class="page" data-page-number="1"><div class="onhand-pdf-annotation-layer"></div></section>');
	try {
		const { document } = dom.window;
		const page = document.querySelector(".page");
		const layer = page.firstElementChild;
		Object.defineProperties(page, { clientWidth: { get: () => 500 }, clientHeight: { get: () => 650 } });
		const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
		page.getBoundingClientRect = () => rect(0, 0, 500, 650);
		const notes = [200, 215, 230].map((top, index) => {
			const id = `a${index + 1}`;
			const mark = document.createElement("div");
			mark.setAttribute("data-onhand-annotation-id", id);
			mark.getBoundingClientRect = () => rect(80, top, 340, 12);
			const note = document.createElement("div");
			note.setAttribute("data-onhand-pdf-note", "true");
			note.setAttribute("data-onhand-note-for", id);
			note.setAttribute("data-onhand-note-collapsed", "false");
			note.setAttribute("data-onhand-note-opened", String(index + 1));
			note.getBoundingClientRect = () => {
				const folded = note.getAttribute("data-onhand-note-collapsed") === "true";
				return rect(parseFloat(note.style.left) || 0, parseFloat(note.style.top) || 0, folded ? 30 : 300, folded ? 30 : 90);
			};
			layer.append(mark, note);
			return note;
		});
		const viewer = loadFunctions(
			["setImportantStyle", "setImportantStyles", "setPdfNoteCollapsed", "getPageLayoutSize", "toPageRect", "rectOverlapArea", "getPdfTextRects", "scorePdfNoteCandidate", "collectOtherPdfNoteRects", "choosePdfNotePosition", "layoutPdfInPageNotes"],
			{ document, CSS: { escape: (value) => value }, PDF_NOTE_FOLDED_ATTRIBUTE: "data-onhand-note-folded", PDF_NOTE_OPENED_ATTRIBUTE: "data-onhand-note-opened", PDF_NOTE_TAB_SIZE: 30, PDF_NOTE_TAB_INSET: 6, PDF_NOTE_TAB_GAP: 4 },
		);
		const open = () => notes.filter((note) => note.getAttribute("data-onhand-note-collapsed") !== "true");
		viewer.layoutPdfInPageNotes(page, page.getBoundingClientRect(), null);
		assert.deepEqual(open(), [notes[2]], "the latest note stays open");
		const tabs = notes.slice(0, 2);
		for (const tab of tabs) {
			assert.equal(tab.getAttribute("data-onhand-note-folded"), "true");
			assert.equal(tab.style.left, "6px", "a tab sits at the page edge nearer its highlight");
			assert.equal(tab.style.opacity, "0.9");
		}
		assert.equal(tabs[0].style.top, "200px", "a tab is level with its highlight");
		assert.equal(tabs[1].style.top, "234px", "tabs stack without covering each other");
		viewer.setPdfNoteCollapsed(notes[0], false);
		viewer.layoutPdfInPageNotes(page, page.getBoundingClientRect(), notes[0]);
		assert.deepEqual(open(), [notes[0]], "opening a tab folds the open card");
		assert.equal(notes[0].hasAttribute("data-onhand-note-folded"), false);
		assert.equal(notes[2].getAttribute("data-onhand-note-folded"), "true");
	} finally { dom.window.close(); }
}

// Centered pages split the spare width; when only the two gutters together fit
// a note column, the pages slide left to make one.
function assertPdfPagesSlideForOneNoteColumn() {
	const dom = new JSDOM('<section class="page" data-page-number="1"><div class="onhand-pdf-annotation-layer"></div></section>');
	try {
		const { document } = dom.window;
		const page = document.querySelector(".page");
		const layer = page.firstElementChild;
		let viewportWidth = 900, pageWidth = 509;
		Object.defineProperty(document.documentElement, "clientWidth", { get: () => viewportWidth });
		Object.defineProperties(page, { clientWidth: { get: () => pageWidth }, clientHeight: { get: () => 659 } });
		const viewer = { style: { translate: "", setProperty(name, value) { this[name] = value; }, removeProperty(name) { this[name] = ""; } } };
		page.getBoundingClientRect = () => {
			const left = (viewportWidth - pageWidth) / 2 + (parseFloat(viewer.style.translate) || 0);
			return { left, top: 0, width: pageWidth, height: 659, right: left + pageWidth, bottom: 659 };
		};
		const notes = loadFunctions(["getPageLayoutSize", "measurePdfMarginNoteSides", "updatePdfNoteShift"], {
			document, window: { innerWidth: viewportWidth }, viewer, pdfNoteShift: 0,
			PDF_MARGIN_NOTE_MIN_WIDTH: 180, PDF_MARGIN_NOTE_MAX_WIDTH: 300, PDF_MARGIN_NOTE_GAP: 16, PDF_NOTE_SHIFT_KEEP_LEFT: 24,
		});
		assert.equal(notes.updatePdfNoteShift(), false, "no notes, no shift");
		assert.equal(viewer.style.translate, "");
		const note = document.createElement("div");
		note.setAttribute("data-onhand-pdf-note", "true");
		layer.append(note);
		// Gutters of 195.5 px: neither fits a 180 px column with its gaps, together they do.
		assert.equal(notes.updatePdfNoteShift(), true);
		assert.equal(viewer.style.translate, "-138px 0");
		assert.deepEqual(notes.measurePdfMarginNoteSides(page, page.getBoundingClientRect()), { right: 300, left: 0 });
		assert.equal(notes.updatePdfNoteShift(), false, "an unchanged layout keeps its shift");
		viewportWidth = 1440;
		assert.equal(notes.updatePdfNoteShift(), true);
		assert.equal(viewer.style.translate, "", "wide windows keep the page centered");
		viewportWidth = 900; pageWidth = 785;
		notes.updatePdfNoteShift();
		assert.equal(viewer.style.translate, "", "without room for a column the page stays put");
	} finally { dom.window.close(); }
}

// A window resize refits through a zoom preview. A citation jump during the
// preview must survive the commit instead of snapping back to where the
// preview began (the "citation 2 reaches its PDF note" CI flake).
function assertZoomCommitKeepsScrollFromPreview() {
	const commitWith = (scrollY) => {
		const restored = [];
		const zoom = loadFunctions(["hasTransientZoom", "centeredTransientZoomAnchor", "commitTransientZoom"], {
			window: { scrollX: 0, scrollY }, viewer: { style: { transform: "translate3d(0px, 0px, 0) scale(0.9)", transformOrigin: "0 0", setProperty() {} } },
			currentScale: 0.8, committedScale: 0.86, transientZoomAnchor: { pageNumber: 1, xRatio: 0.5, yRatio: 0.4, clientX: 270, clientY: 500 },
			transientZoomGeometry: {}, transientZoomCentersHorizontally: false, transientZoomScroll: { x: 0, y: 0 },
			getPdfPages: () => [], scaleAnnotationLayerForZoom() {}, visibleViewportWidth: () => 540,
			captureZoomAnchor: () => ({ pageNumber: 3, xRatio: 0.5, yRatio: 0.1, clientX: 270, clientY: 500 }),
			restoreZoomAnchor: (anchor) => restored.push(anchor),
		});
		zoom.commitTransientZoom();
		return restored[0];
	};
	assert.equal(commitWith(0).pageNumber, 1, "an undisturbed preview restores its own anchor");
	assert.equal(commitWith(1339).pageNumber, 3, "a scroll during the preview keeps the new reading position");
}

assertZoomCommitKeepsScrollFromPreview();
assertNarrowPdfNotesFoldToTabs();
assertPdfPagesSlideForOneNoteColumn();
assertPageRangesParse();
await assertExtractionCoverage();
await assertLongPdfsKeepOnlyNearbyPageImages();
await assertUnrenderedPagesKeepTextWithoutBeingWalked();
await assertPageTextsAreReadTogetherAndOnce();
await assertAnimationFramesContinueInAHiddenTab();
assertPendingPageSearchFormsAreCached();
await assertZoomPreservesLiveEdits(0);
await assertZoomPreservesLiveEdits(1);
await assertCitationAndHighlightSearchSurvivePageFailures();
await assertPdfQuotesMatchDespitePunctuationAndMissingWords();
assertFirstAnnotationCreatedDuringTransientZoom();
await assertPdfScrollRestoresInsideViewerWithPausedFrames();
await assertViewerAnswersAreNotSentAgain();
await assertGenericScrollSettlesWithPausedFrames();
console.log("PDF viewer review regressions: PASS");
