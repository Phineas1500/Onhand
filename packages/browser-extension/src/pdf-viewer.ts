import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist/legacy/build/pdf.mjs";

declare const chrome: any;

const DEFAULT_SCALE = 1.25;
const MIN_SCALE = 0.6;
const MAX_SCALE = 2.6;
const SCALE_STEP = 0.15;

const viewer = document.getElementById("viewer") as HTMLElement;
const titleElement = document.getElementById("onhand-pdf-title") as HTMLElement;
const statusElement = document.getElementById("onhand-pdf-status") as HTMLElement;
const pageInput = document.getElementById("onhand-pdf-page") as HTMLInputElement;
const pageCountElement = document.getElementById("onhand-pdf-page-count") as HTMLElement;
const zoomInButton = document.getElementById("onhand-pdf-zoom-in") as HTMLButtonElement;
const zoomOutButton = document.getElementById("onhand-pdf-zoom-out") as HTMLButtonElement;

let pdfDocument: any = null;
let sourceUrl = "";
let currentScale = DEFAULT_SCALE;
let renderSequence = 0;
let runtimeBridgePort: any = null;
let runtimeBridgeReconnectTimer: number | null = null;
let parentBridgeToken = "";
let annotationSequence = 0;

type PdfRect = {
	left: number;
	top: number;
	width: number;
	height: number;
};

function inlinePdfViewerBridgeStorageKey(pdfUrl: string) {
	return `onhandInlinePdfViewerBridge:${encodeURIComponent(String(pdfUrl || ""))}`;
}

function extensionUrl(path: string) {
	if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) return chrome.runtime.getURL(path);
	return path;
}

function serializeBridgeValue(value: any) {
	if (value == null) return value;
	if (["string", "number", "boolean"].includes(typeof value)) return value;
	try {
		return JSON.parse(JSON.stringify(value));
	} catch {
		return String(value);
	}
}

async function getBridgeToken() {
	if (parentBridgeToken) return parentBridgeToken;
	if (!sourceUrl || typeof chrome === "undefined" || !chrome?.storage?.session) return "";
	const key = inlinePdfViewerBridgeStorageKey(sourceUrl);
	const stored = await chrome.storage.session.get(key);
	return String(stored?.[key] || "");
}

async function evaluateBridgeExpression(expression: any) {
	const source = String(expression || "");
	const value = await (0, eval)(source);
	return serializeBridgeValue(value);
}

function rectToObject(rect: DOMRect | ClientRect | null) {
	if (!rect) return null;
	return {
		x: Math.round(rect.x),
		y: Math.round(rect.y),
		left: Math.round(rect.left),
		top: Math.round(rect.top),
		right: Math.round(rect.right),
		bottom: Math.round(rect.bottom),
		width: Math.round(rect.width),
		height: Math.round(rect.height),
	};
}

function normalizeText(value: any) {
	return String(value ?? "")
		.replace(/\u00ad/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeSearchChar(char: string) {
	if (!char) return "";
	if (/\s/.test(char)) return " ";
	return char
		.normalize("NFKC")
		.replace(/[’`´]/g, "'")
		.toLowerCase();
}

function nextAnnotationId() {
	annotationSequence += 1;
	return `onhand-pdf-${Date.now().toString(36)}-${annotationSequence.toString(36)}`;
}

function getPdfPages() {
	return Array.from(document.querySelectorAll<HTMLElement>(".page[data-page-number]"));
}

function getPageNumber(page: Element | null) {
	if (!(page instanceof HTMLElement)) return null;
	const value = Number(page.getAttribute("data-page-number") || "");
	return Number.isFinite(value) && value > 0 ? value : null;
}

function visibleEnough(rect: DOMRect | ClientRect) {
	return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
}

function buildNormalizedTextMap(root: Element) {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const positions: Array<{ node: Text; offset: number }> = [];
	let text = "";
	let pendingSpace: { node: Text; offset: number } | null = null;

	while (walker.nextNode()) {
		const node = walker.currentNode as Text;
		const value = node.nodeValue || "";
		for (let offset = 0; offset < value.length; offset += 1) {
			const normalized = normalizeSearchChar(value[offset]);
			if (!normalized) continue;
			if (normalized === " ") {
				if (text && !text.endsWith(" ")) pendingSpace = { node, offset };
				continue;
			}
			if (pendingSpace) {
				text += " ";
				positions.push(pendingSpace);
				pendingSpace = null;
			}
			text += normalized;
			positions.push({ node, offset });
		}
	}
	return { text, positions };
}

function normalizeSearchText(value: string) {
	return buildSearchText(value, true);
}

function compactSearchText(value: string) {
	return buildSearchText(value, false);
}

function buildSearchText(value: string, keepSpaces: boolean) {
	let text = "";
	let lastWasSpace = false;
	for (const char of String(value || "")) {
		const normalized = normalizeSearchChar(char);
		if (!normalized) continue;
		if (normalized === " ") {
			if (keepSpaces && text && !lastWasSpace) {
				text += " ";
				lastWasSpace = true;
			}
			continue;
		}
		if (!/[a-z0-9]/i.test(normalized) && !/[^\x00-\x7F]/.test(normalized)) {
			if (keepSpaces && text && !lastWasSpace) {
				text += " ";
				lastWasSpace = true;
			}
			continue;
		}
		text += normalized;
		lastWasSpace = false;
	}
	return text.trim();
}

function findMappedTextRange(root: Element, query: string, occurrence = 1) {
	const map = buildNormalizedTextMap(root);
	const queryText = normalizeSearchText(query);
	let foundIndex = -1;
	let searchFrom = 0;
	for (let count = 0; count < occurrence; count += 1) {
		foundIndex = map.text.indexOf(queryText, searchFrom);
		if (foundIndex === -1) break;
		searchFrom = foundIndex + Math.max(queryText.length, 1);
	}
	if (foundIndex === -1 && compactSearchText(query).length >= 8) {
		const compactQuery = compactSearchText(query);
		const compactPositions: number[] = [];
		let compactText = "";
		for (let index = 0; index < map.text.length; index += 1) {
			const char = map.text[index];
			if (!char || char === " " || !/[a-z0-9]|[^\x00-\x7F]/i.test(char)) continue;
			compactText += char;
			compactPositions.push(index);
		}
		let compactFound = -1;
		let compactSearchFrom = 0;
		for (let count = 0; count < occurrence; count += 1) {
			compactFound = compactText.indexOf(compactQuery, compactSearchFrom);
			if (compactFound === -1) break;
			compactSearchFrom = compactFound + Math.max(compactQuery.length, 1);
		}
		if (compactFound !== -1) {
			foundIndex = compactPositions[compactFound];
			const endCompactIndex = compactPositions[compactFound + compactQuery.length - 1];
			const start = map.positions[foundIndex];
			const end = map.positions[endCompactIndex];
			if (start && end) {
				const range = document.createRange();
				range.setStart(start.node, start.offset);
				range.setEnd(end.node, end.offset + 1);
				return { range, matchedText: normalizeText(range.toString()) || normalizeText(query), fallback: "compact-text" };
			}
		}
	}
	const start = map.positions[foundIndex];
	const end = map.positions[foundIndex + queryText.length - 1];
	if (!start || !end) return null;
	const range = document.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset + 1);
	return { range, matchedText: normalizeText(range.toString()) || normalizeText(query), fallback: undefined };
}

function ensureAnnotationLayer(page: HTMLElement) {
	let layer = page.querySelector<HTMLElement>(".onhand-pdf-annotation-layer");
	if (layer) return layer;
	layer = document.createElement("div");
	layer.className = "onhand-pdf-annotation-layer";
	Object.assign(layer.style, {
		position: "absolute",
		inset: "0",
		zIndex: "12",
		pointerEvents: "none",
	});
	page.append(layer);
	return layer;
}

let textMeasureCanvas: HTMLCanvasElement | null = null;

function getTextMeasureContext() {
	if (!textMeasureCanvas) textMeasureCanvas = document.createElement("canvas");
	return textMeasureCanvas.getContext("2d");
}

function measureElementText(element: HTMLElement, text: string) {
	const context = getTextMeasureContext();
	if (!context) return 0;
	const style = window.getComputedStyle(element);
	context.font =
		style.font && style.font !== ""
			? style.font
			: `${style.fontStyle || "normal"} ${style.fontWeight || "400"} ${style.fontSize || "16px"} ${style.fontFamily || "sans-serif"}`;
	return context.measureText(text).width;
}

function rangeIntersectsTextNode(range: Range, node: Text) {
	try {
		return typeof range.intersectsNode === "function" ? range.intersectsNode(node) : true;
	} catch {
		return false;
	}
}

function textSegmentRectsForPage(range: Range, page: HTMLElement) {
	const textLayer = page.querySelector<HTMLElement>(".textLayer, [data-onhand-pdf-text-layer]");
	if (!textLayer) return [];
	const pageRect = page.getBoundingClientRect();
	const size = getPageLayoutSize(page, pageRect);
	const scaleX = pageRect.width ? size.width / pageRect.width : 1;
	const scaleY = pageRect.height ? size.height / pageRect.height : 1;
	const rects: PdfRect[] = [];
	const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
	while (walker.nextNode()) {
		const node = walker.currentNode as Text;
		if (!rangeIntersectsTextNode(range, node)) continue;
		const text = node.nodeValue || "";
		const startOffset = node === range.startContainer ? range.startOffset : 0;
		const endOffset = node === range.endContainer ? range.endOffset : text.length;
		if (endOffset <= startOffset) continue;
		const segmentText = text.slice(startOffset, endOffset);
		if (!normalizeText(segmentText)) continue;
		const element = node.parentElement;
		if (!(element instanceof HTMLElement)) continue;
		const spanRect = element.getBoundingClientRect();
		if (!spanRect || spanRect.width <= 0 || spanRect.height <= 0) continue;
		const fullWidth = measureElementText(element, text);
		const segmentWidth = measureElementText(element, segmentText);
		if (!fullWidth || !segmentWidth) continue;
		const prefixWidth = measureElementText(element, text.slice(0, startOffset));
		const left = spanRect.left + (prefixWidth / fullWidth) * spanRect.width;
		const width = Math.min(spanRect.right, left + (segmentWidth / fullWidth) * spanRect.width) - left;
		if (width <= 0) continue;
		rects.push({
			left: (left - pageRect.left) * scaleX,
			top: (spanRect.top - pageRect.top) * scaleY,
			width: width * scaleX,
			height: spanRect.height * scaleY,
		});
	}
	return rects;
}

function rangeRectsForPage(range: Range, page: HTMLElement) {
	const textSegmentRects = textSegmentRectsForPage(range, page);
	if (textSegmentRects.length) return textSegmentRects;
	const pageRect = page.getBoundingClientRect();
	const size = getPageLayoutSize(page, pageRect);
	const scaleX = pageRect.width ? size.width / pageRect.width : 1;
	const scaleY = pageRect.height ? size.height / pageRect.height : 1;
	return Array.from(range.getClientRects())
		.filter((rect) => rect.width > 0 && rect.height > 0)
		.map((rect) => ({
			left: (rect.left - pageRect.left) * scaleX,
			top: (rect.top - pageRect.top) * scaleY,
			width: rect.width * scaleX,
			height: rect.height * scaleY,
		}));
}

function unionRects(rects: PdfRect[]) {
	const left = Math.min(...rects.map((rect) => rect.left));
	const top = Math.min(...rects.map((rect) => rect.top));
	const right = Math.max(...rects.map((rect) => rect.left + rect.width));
	const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));
	return { left, top, width: right - left, height: bottom - top };
}

function applyHighlightStyles(highlight: HTMLElement, rects: PdfRect[], union: PdfRect) {
	Object.assign(highlight.style, {
		position: "absolute",
		left: `${union.left}px`,
		top: `${union.top}px`,
		width: `${union.width}px`,
		height: `${union.height}px`,
		pointerEvents: "auto",
		cursor: "pointer",
		scrollMarginTop: "22vh",
		scrollMarginBottom: "22vh",
	});
	for (const rect of rects) {
		const segment = document.createElement("div");
		segment.setAttribute("data-onhand-pdf-highlight-segment", "true");
		Object.assign(segment.style, {
			position: "absolute",
			left: `${rect.left - union.left}px`,
			top: `${rect.top - union.top}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`,
			background: "rgba(234, 157, 52, 0.34)",
			borderRadius: "2px",
		});
		highlight.append(segment);
	}
}

function buildAnnotationResult(annotation: HTMLElement, rawQuery = "", extra: Record<string, any> = {}) {
	const page = annotation.closest<HTMLElement>(".page[data-page-number]");
	return {
		annotationId: annotation.getAttribute("data-onhand-annotation-id") || "",
		kind: annotation.getAttribute("data-onhand-highlight-kind") || "pdf",
		matchedText: normalizeText(annotation.getAttribute("data-onhand-matched-text") || rawQuery).slice(0, 500),
		container: {
			tag: "pdf-page",
			text: page ? `Page ${getPageNumber(page) || "?"}` : "PDF page",
			pageNumber: getPageNumber(page),
		},
		rect: rectToObject(annotation.getBoundingClientRect()),
		scrollY: window.scrollY,
		pdfAnchor: parsePdfAnchor(annotation),
		...extra,
	};
}

function parsePdfAnchor(annotation: Element | null) {
	if (!(annotation instanceof Element)) return null;
	try {
		return JSON.parse(annotation.getAttribute("data-onhand-pdf-anchor") || "null");
	} catch {
		return null;
	}
}

function pdfAnchorText(anchor: any, fallback = "") {
	return compactSearchText(anchor?.matchedText || anchor?.textQuote?.exact || fallback || "");
}

function pdfAnchorPageNumber(anchor: any) {
	const pageNumber = Number(anchor?.pageNumber || anchor?.rects?.find?.((rect: any) => Number(rect?.pageNumber) > 0)?.pageNumber || "");
	return Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : null;
}

function pdfDocumentUrl(anchor: any) {
	return String(anchor?.document?.pdfUrl || anchor?.document?.url || "").trim();
}

function pdfHighlightMatches(annotation: HTMLElement, rawQuery: string, options: Record<string, any> = {}, occurrence = 1) {
	const targetAnchor = options.pdfAnchor;
	const existingAnchor = parsePdfAnchor(annotation);
	const targetPage = pdfAnchorPageNumber(targetAnchor);
	const existingPage = pdfAnchorPageNumber(existingAnchor) || getPageNumber(annotation.closest(".page[data-page-number]"));
	if (targetPage && existingPage && targetPage !== existingPage) return false;
	const targetUrl = pdfDocumentUrl(targetAnchor);
	const existingUrl = pdfDocumentUrl(existingAnchor);
	if (targetUrl && existingUrl && targetUrl !== existingUrl) return false;
	const targetText = pdfAnchorText(targetAnchor, rawQuery);
	const existingText = pdfAnchorText(existingAnchor, annotation.getAttribute("data-onhand-matched-text") || "");
	if (targetText && existingText && targetText !== existingText && !targetText.includes(existingText) && !existingText.includes(targetText)) return false;
	const targetOccurrence = Number(targetAnchor?.occurrence || options.occurrence || occurrence || 1);
	const existingOccurrence = Number(existingAnchor?.occurrence || 1);
	if (Number.isFinite(targetOccurrence) && Number.isFinite(existingOccurrence) && targetOccurrence > 0 && existingOccurrence > 0 && targetOccurrence !== existingOccurrence) {
		return false;
	}
	return Boolean(targetText || existingText);
}

function findExistingPdfHighlight(rawQuery: string, options: Record<string, any> = {}, occurrence = 1) {
	for (const annotation of Array.from(document.querySelectorAll<HTMLElement>("[data-onhand-highlight-kind='pdf']"))) {
		if (pdfHighlightMatches(annotation, rawQuery, options, occurrence)) return annotation;
	}
	return null;
}

function removeDuplicatePdfHighlights(keeper: HTMLElement, rawQuery: string, options: Record<string, any> = {}, occurrence = 1) {
	let removed = 0;
	for (const annotation of Array.from(document.querySelectorAll<HTMLElement>("[data-onhand-highlight-kind='pdf']"))) {
		if (annotation === keeper || !pdfHighlightMatches(annotation, rawQuery, options, occurrence)) continue;
		const annotationId = annotation.getAttribute("data-onhand-annotation-id") || "";
		if (annotationId) removeNotesForAnnotation(annotationId);
		annotation.remove();
		removed += 1;
	}
	return removed;
}

async function pdfHighlightText(query: string, options: Record<string, any> = {}) {
	const rawQuery = String(query || "").trim();
	if (!rawQuery) throw new Error("highlightText requires a non-empty query");
	if (options.clearExisting === true) pdfClearAnnotations();
	const occurrence = Math.max(1, Math.min(20, Number(options.occurrence || 1) || 1));
	if (options.clearExisting !== true && options.reuseExisting === true) {
		const existing = findExistingPdfHighlight(rawQuery, options, occurrence);
		if (existing) {
			const duplicateCount = removeDuplicatePdfHighlights(existing, rawQuery, options, occurrence);
			if (options.scrollIntoView !== false) {
				existing.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
				await new Promise((resolve) => requestAnimationFrame(resolve));
				updatePageFromScroll();
			}
			return buildAnnotationResult(existing, rawQuery, {
				reusedExisting: true,
				...(duplicateCount ? { duplicateCount } : {}),
			});
		}
	}
	const pages = getPdfPages()
		.map((page, index) => {
			const rect = page.getBoundingClientRect();
			return {
				page,
				index,
				visible: visibleEnough(rect),
				distance: Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2),
			};
		})
		.sort((a, b) => {
			if (a.visible !== b.visible) return a.visible ? -1 : 1;
			if (a.visible && b.visible && a.distance !== b.distance) return a.distance - b.distance;
			return a.index - b.index;
		});

	for (const { page } of pages) {
		const textLayer = page.querySelector<HTMLElement>(".textLayer");
		if (!textLayer) continue;
		const match = findMappedTextRange(textLayer, rawQuery, occurrence);
		if (!match) continue;
		const rects = rangeRectsForPage(match.range, page);
		if (!rects.length) continue;
		const union = unionRects(rects);
		const annotationId = nextAnnotationId();
		const pdfAnchor = {
			surface: "pdf",
			viewer: "onhand-pdf-viewer",
			document: { url: sourceUrl, title: document.title },
			pageNumber: getPageNumber(page),
			matchedText: match.matchedText,
			textQuote: { exact: match.matchedText },
			rects,
			occurrence,
			fallback: match.fallback,
		};
		const highlight = document.createElement("div");
		highlight.setAttribute("data-onhand-highlight-kind", "pdf");
		highlight.setAttribute("data-onhand-annotation-id", annotationId);
		highlight.setAttribute("data-onhand-matched-text", match.matchedText);
		highlight.setAttribute("data-onhand-pdf-anchor", JSON.stringify(pdfAnchor));
		applyHighlightStyles(highlight, rects, union);
		ensureAnnotationLayer(page).append(highlight);
		if (options.scrollIntoView !== false) {
			highlight.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
			await new Promise((resolve) => requestAnimationFrame(resolve));
			updatePageFromScroll();
		}
		return buildAnnotationResult(highlight, rawQuery, { approximate: Boolean(match.fallback), fallback: match.fallback });
	}
	throw new Error(`No visible text matched: ${rawQuery}`);
}

function findAnnotation(annotationId: string) {
	const escaped = CSS.escape(annotationId);
	const annotation = document.querySelector<HTMLElement>(`[data-onhand-annotation-id="${escaped}"]`);
	if (!annotation) throw new Error(`Annotation not found: ${annotationId}`);
	return annotation;
}

function removeNotesForAnnotation(annotationId: string) {
	let count = 0;
	for (const note of Array.from(document.querySelectorAll(`[data-onhand-note-for="${CSS.escape(annotationId)}"]`))) {
		note.remove();
		count += 1;
	}
	return count;
}

function findNoteForAnnotation(annotationId: string) {
	return document.querySelector<HTMLElement>(`[data-onhand-note-for="${CSS.escape(annotationId)}"]`);
}

function setImportantStyle(element: HTMLElement, property: string, value: string) {
	element.style.setProperty(property, value, "important");
}

type PageRect = {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
};

function getPageLayoutSize(page: HTMLElement, pageRect = page.getBoundingClientRect()) {
	const width = Number(page.clientWidth || page.offsetWidth || pageRect.width || 1) || 1;
	const height = Number(page.clientHeight || page.offsetHeight || pageRect.height || 1) || 1;
	return {
		width: Math.max(1, width),
		height: Math.max(1, height),
	};
}

function toPageRect(rect: DOMRect, page: HTMLElement, pageRect: DOMRect): PageRect {
	const size = getPageLayoutSize(page, pageRect);
	const scaleX = pageRect.width ? size.width / pageRect.width : 1;
	const scaleY = pageRect.height ? size.height / pageRect.height : 1;
	const left = (rect.left - pageRect.left) * scaleX;
	const top = (rect.top - pageRect.top) * scaleY;
	const width = rect.width * scaleX;
	const height = rect.height * scaleY;
	return {
		left,
		top,
		right: left + width,
		bottom: top + height,
		width,
		height,
	};
}

function rectOverlapArea(a: PageRect, b: PageRect) {
	const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
	const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
	return width * height;
}

function getPdfTextRects(page: HTMLElement, pageRect: DOMRect) {
	return Array.from(page.querySelectorAll<HTMLElement>(".textLayer span, [data-onhand-pdf-text-layer] span"))
		.map((element) => {
			const rect = element.getBoundingClientRect();
			if (!rect || rect.width <= 0 || rect.height <= 0) return null;
			return toPageRect(rect, page, pageRect);
		})
		.filter((rect): rect is PageRect => Boolean(rect));
}

function scorePdfNoteCandidate(candidate: PageRect & { order: number }, textRects: PageRect[], anchorRect: PageRect) {
	const textOverlap = textRects.reduce((sum, rect) => sum + rectOverlapArea(candidate, rect), 0);
	const anchorOverlap = rectOverlapArea(candidate, anchorRect);
	const anchorDistance = Math.abs(candidate.left - anchorRect.left) + Math.abs(candidate.top - anchorRect.top);
	return textOverlap * 1000 + anchorOverlap * 1200 + anchorDistance * 0.01 + candidate.order;
}

function choosePdfNotePosition(page: HTMLElement, pageRect: DOMRect, anchorRect: PageRect, noteWidth: number, noteHeight: number) {
	const { width: pageWidth, height: pageHeight } = getPageLayoutSize(page, pageRect);
	const margin = Math.max(12, Math.min(20, pageWidth * 0.025));
	const gap = Math.max(10, Math.min(18, pageHeight * 0.018));
	const clamp = (value: number, min: number, max: number) => {
		if (max < min) return min;
		return Math.max(min, Math.min(max, value));
	};
	const maxLeft = Math.max(margin, pageWidth - noteWidth - margin);
	const maxTop = Math.max(margin, pageHeight - noteHeight - margin);
	const rightOfAnchor = clamp(anchorRect.right + gap, margin, maxLeft);
	const leftOfAnchor = clamp(anchorRect.left - noteWidth - gap, margin, maxLeft);
	const alignedWithAnchor = clamp(anchorRect.left, margin, maxLeft);
	const rightEdge = maxLeft;
	const leftEdge = margin;
	const aboveAnchor = anchorRect.top - noteHeight - gap;
	const belowAnchor = anchorRect.bottom + gap;
	const alignedTop = anchorRect.top;
	const candidates = [
		[rightOfAnchor, aboveAnchor],
		[rightEdge, aboveAnchor],
		[alignedWithAnchor, aboveAnchor],
		[leftOfAnchor, aboveAnchor],
		[rightOfAnchor, belowAnchor],
		[rightEdge, belowAnchor],
		[alignedWithAnchor, belowAnchor],
		[leftOfAnchor, belowAnchor],
		[rightEdge, alignedTop],
		[leftEdge, alignedTop],
		[rightEdge, margin],
		[rightEdge, maxTop],
		[leftEdge, maxTop],
	].map(([left, top], order) => ({
		left: clamp(left, margin, maxLeft),
		top: clamp(top, margin, maxTop),
		right: clamp(left, margin, maxLeft) + noteWidth,
		bottom: clamp(top, margin, maxTop) + noteHeight,
		width: noteWidth,
		height: noteHeight,
		order,
	}));
	const textRects = getPdfTextRects(page, pageRect);
	return candidates.reduce<(PageRect & { order: number; score: number }) | null>((best, candidate) => {
		const score = scorePdfNoteCandidate(candidate, textRects, anchorRect);
		return !best || score < best.score ? { ...candidate, score } : best;
	}, null);
}

function setPdfNoteCollapsed(note: HTMLElement, collapsed: boolean) {
	const body = note.querySelector<HTMLElement>("[data-onhand-note-part='body']");
	const label = note.querySelector<HTMLElement>("[data-onhand-note-part='label']");
	const toggle = note.querySelector<HTMLButtonElement>("[data-onhand-note-toggle]");
	note.setAttribute("data-onhand-note-collapsed", collapsed ? "true" : "false");
	if (body) body.hidden = collapsed;
	if (label) label.hidden = collapsed;
	if (toggle) {
		toggle.textContent = collapsed ? "+" : "x";
		toggle.setAttribute("aria-label", collapsed ? "Expand note" : "Collapse note");
		toggle.setAttribute("title", collapsed ? "Expand note" : "Collapse note");
		toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
	}
	if (collapsed) {
		setImportantStyle(note, "width", "30px");
		setImportantStyle(note, "inline-size", "30px");
		setImportantStyle(note, "min-width", "0");
		setImportantStyle(note, "max-width", "30px");
		setImportantStyle(note, "height", "30px");
		setImportantStyle(note, "min-height", "30px");
		setImportantStyle(note, "padding", "0");
		setImportantStyle(note, "overflow", "hidden");
		setImportantStyle(note, "display", "flex");
		setImportantStyle(note, "align-items", "center");
		setImportantStyle(note, "justify-content", "center");
		setImportantStyle(note, "cursor", "pointer");
		setImportantStyle(note, "border-radius", "4px");
		setImportantStyle(note, "opacity", "0.48");
		return;
	}
	for (const property of [
		"width",
		"inline-size",
		"min-width",
		"max-width",
		"height",
		"min-height",
		"padding",
		"padding-top",
		"padding-right",
		"padding-bottom",
		"padding-left",
		"overflow",
		"display",
		"align-items",
		"justify-content",
		"cursor",
		"border-radius",
		"opacity",
	]) {
		note.style.removeProperty(property);
	}
}

function positionPdfNote(note: HTMLElement, annotation: HTMLElement, page: HTMLElement) {
	const wasCollapsed = note.getAttribute("data-onhand-note-collapsed") === "true";
	if (!wasCollapsed) setPdfNoteCollapsed(note, false);
	const annotationRect = annotation.getBoundingClientRect();
	const pageRect = page.getBoundingClientRect();
	const pageSize = getPageLayoutSize(page, pageRect);
	const maxWidth = Math.min(420, Math.max(220, pageSize.width - 32));
	Object.assign(note.style, {
		position: "absolute",
		maxWidth: `${maxWidth}px`,
		minWidth: "220px",
		minHeight: "76px",
		boxSizing: "border-box",
		padding: "12px 14px",
		background: "#e6dbd1",
		color: "#575279",
		border: "1px solid #cac1b9",
		borderLeft: "3px solid #286983",
		borderRadius: "0 4px 4px 0",
		boxShadow: "0 1px 3px rgba(47, 44, 40, 0.16)",
		font: '15px/1.55 "New York", "Iowan Old Style", Charter, Georgia, serif',
		pointerEvents: "auto",
		scrollMarginTop: "22vh",
		scrollMarginBottom: "22vh",
	});
	const measuredHeight = note.getBoundingClientRect().height || note.offsetHeight || 0;
	const noteHeight = wasCollapsed ? 30 : Math.max(76, Math.min(240, measuredHeight || 96));
	const positioned = choosePdfNotePosition(page, pageRect, toPageRect(annotationRect, page, pageRect), maxWidth, noteHeight);
	if (positioned) {
		note.style.left = `${positioned.left}px`;
		note.style.top = `${positioned.top}px`;
	}
	if (wasCollapsed) setPdfNoteCollapsed(note, true);
}

function expandPdfNoteForAnnotation(annotationId: string) {
	const note = findNoteForAnnotation(annotationId);
	if (!note) return null;
	setPdfNoteCollapsed(note, false);
	try {
		const annotation = findAnnotation(annotationId);
		const page = annotation.closest<HTMLElement>(".page[data-page-number]");
		if (page) positionPdfNote(note, annotation, page);
	} catch {}
	return note;
}

function attachPdfNoteInteractions(note: HTMLElement, annotation: HTMLElement) {
	const annotationId = String(note.getAttribute("data-onhand-note-for") || annotation.getAttribute("data-onhand-annotation-id") || "");
	if (!annotationId) return;
	if (!annotation.hasAttribute("data-onhand-note-trigger-bound")) {
		annotation.setAttribute("data-onhand-note-trigger-bound", "true");
		annotation.setAttribute("role", "button");
		annotation.setAttribute("tabindex", "0");
		annotation.setAttribute("title", "Show Onhand note");
		annotation.addEventListener("click", () => {
			expandPdfNoteForAnnotation(annotationId);
		});
		annotation.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			expandPdfNoteForAnnotation(annotationId);
		});
	}
	if (note.hasAttribute("data-onhand-note-toggle-bound")) return;
	note.setAttribute("data-onhand-note-toggle-bound", "true");
	const toggle = note.querySelector<HTMLButtonElement>("[data-onhand-note-toggle]");
	toggle?.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		const nextCollapsed = note.getAttribute("data-onhand-note-collapsed") !== "true";
		setPdfNoteCollapsed(note, nextCollapsed);
		if (!nextCollapsed) expandPdfNoteForAnnotation(annotationId);
	});
	note.addEventListener("click", (event) => {
		if (note.getAttribute("data-onhand-note-collapsed") !== "true") return;
		event.preventDefault();
		expandPdfNoteForAnnotation(annotationId);
	});
}

async function pdfShowNote(annotationId: string, noteText: string, options: Record<string, any> = {}) {
	const rawAnnotationId = String(annotationId || "").trim();
	const rawNoteText = String(noteText || "").trim();
	if (!rawAnnotationId) throw new Error("showNote requires a non-empty annotationId");
	if (!rawNoteText) throw new Error("showNote requires non-empty note text");
	const annotation = findAnnotation(rawAnnotationId);
	const page = annotation.closest<HTMLElement>(".page[data-page-number]");
	if (!page) throw new Error(`PDF annotation page not found for id: ${rawAnnotationId}`);
	const overlay = ensureAnnotationLayer(page);
	const replacedCount = removeNotesForAnnotation(rawAnnotationId);
	const noteId = nextAnnotationId();
	const note = document.createElement("div");
	note.setAttribute("data-onhand-note-kind", "card");
	note.setAttribute("data-onhand-pdf-note", "true");
	note.setAttribute("data-onhand-note-id", noteId);
	note.setAttribute("data-onhand-note-for", rawAnnotationId);
	const header = document.createElement("div");
	header.setAttribute("data-onhand-note-part", "header");
	const label = document.createElement("span");
	label.setAttribute("data-onhand-note-part", "label");
	label.textContent = String(options.label || "Onhand");
	const toggle = document.createElement("button");
	toggle.type = "button";
	toggle.setAttribute("data-onhand-note-toggle", "true");
	toggle.textContent = "x";
	const body = document.createElement("div");
	body.setAttribute("data-onhand-note-part", "body");
	body.setAttribute("data-onhand-note-source", rawNoteText);
	body.textContent = rawNoteText;
	header.append(label, toggle);
	note.append(header, body);
	Object.assign(label.style, {
		font: "700 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
		letterSpacing: "0.08em",
		textTransform: "uppercase",
		color: "#286983",
	});
	Object.assign(header.style, {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "10px",
		marginBottom: "6px",
	});
	Object.assign(toggle.style, {
		width: "22px",
		height: "22px",
		border: "1px solid #cac1b9",
		borderRadius: "3px",
		background: "rgba(255, 255, 255, 0.35)",
		color: "#286983",
		cursor: "pointer",
		font: "700 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
		padding: "0",
	});
	setPdfNoteCollapsed(note, false);
	attachPdfNoteInteractions(note, annotation);
	overlay.append(note);
	positionPdfNote(note, annotation, page);
	if (options.scrollIntoView !== false) {
		note.scrollIntoView({ behavior: "auto", block: options.block || "center", inline: "nearest" });
		await new Promise((resolve) => requestAnimationFrame(resolve));
		positionPdfNote(note, annotation, page);
		updatePageFromScroll();
	}
	return {
		noteId,
		annotationId: rawAnnotationId,
		text: rawNoteText.slice(0, 500),
		replacedCount,
		container: { tag: "pdf-page", text: `Page ${getPageNumber(page) || "?"}`, pageNumber: getPageNumber(page) },
		insertionTarget: { tag: "pdf-overlay" },
		insertionPosition: "pdf-overlay",
		anchorRect: rectToObject(annotation.getBoundingClientRect()),
		rect: rectToObject(note.getBoundingClientRect()),
		scrollY: window.scrollY,
		pdfAnchor: parsePdfAnchor(annotation),
	};
}

async function pdfScrollToAnnotation(annotationId: string, options: Record<string, any> = {}) {
	const annotation = findAnnotation(String(annotationId || "").trim());
	const note = findNoteForAnnotation(annotationId);
	if (options.target === "note" && note) expandPdfNoteForAnnotation(annotationId);
	const target = options.target === "note" && note ? note : annotation;
	target.scrollIntoView({ behavior: "auto", block: options.block || "center", inline: "nearest" });
	await new Promise((resolve) => requestAnimationFrame(resolve));
	updatePageFromScroll();
	return buildAnnotationResult(annotation);
}

function pdfClearAnnotations() {
	const highlights = Array.from(document.querySelectorAll("[data-onhand-highlight-kind='pdf']"));
	const notes = Array.from(document.querySelectorAll("[data-onhand-note-kind='card']"));
	for (const element of [...highlights, ...notes]) element.remove();
	return { clearedPdf: highlights.length, clearedNotes: notes.length, cleared: highlights.length + notes.length };
}

function pdfGetVisibleText(options: Record<string, any> = {}) {
	const maxBlocks = Math.max(1, Math.min(80, Number(options.maxBlocks || 25) || 25));
	const maxChars = Math.max(200, Math.min(20000, Number(options.maxChars || 6000) || 6000));
	const blocks: any[] = [];
	let totalChars = 0;
	for (const page of getPdfPages()) {
		const rect = page.getBoundingClientRect();
		if (!visibleEnough(rect)) continue;
		const pageNumber = getPageNumber(page);
		const text = normalizeText(page.querySelector(".textLayer")?.textContent || page.textContent || "");
		if (!text) continue;
		const clipped = text.slice(0, Math.max(0, maxChars - totalChars));
		totalChars += clipped.length;
		blocks.push({
			tag: "pdf-page",
			selector: `.page[data-page-number="${pageNumber || ""}"]`,
			text: clipped,
			rect: rectToObject(rect),
			pageNumber,
		});
		if (blocks.length >= maxBlocks || totalChars >= maxChars) break;
	}
	const text = blocks.map((block) => block.text).join("\n\n").slice(0, maxChars);
	return {
		surface: "pdf",
		viewer: "onhand-pdf-viewer",
		url: sourceUrl,
		title: document.title,
		text,
		blocks,
		viewport: { width: window.innerWidth, height: window.innerHeight, scrollY: window.scrollY },
	};
}

function pdfCaptureState() {
	const annotations = Array.from(document.querySelectorAll<HTMLElement>("[data-onhand-highlight-kind='pdf']")).map((annotation) => {
		const annotationId = annotation.getAttribute("data-onhand-annotation-id") || "";
		const note = annotationId ? document.querySelector<HTMLElement>(`[data-onhand-note-for="${CSS.escape(annotationId)}"]`) : null;
		const body = note?.querySelector<HTMLElement>("[data-onhand-note-part='body']");
		const label = note?.querySelector<HTMLElement>("[data-onhand-note-part='label']");
		return {
			...buildAnnotationResult(annotation),
			note: note
				? {
						noteId: note.getAttribute("data-onhand-note-id") || null,
						label: normalizeText(label?.textContent || "") || null,
						text: normalizeText(body?.getAttribute("data-onhand-note-source") || body?.textContent || "").slice(0, 1000),
						rect: rectToObject(note.getBoundingClientRect()),
					}
				: null,
		};
	});
	return {
		surface: "pdf",
		viewer: "onhand-pdf-viewer",
		url: sourceUrl,
		title: document.title,
		text: pdfGetVisibleText({ maxChars: 4000, maxBlocks: 8 }).text,
		annotations,
		annotationCount: annotations.length,
		scrollY: window.scrollY,
		viewport: { width: window.innerWidth, height: window.innerHeight },
	};
}

async function runPdfToolkitMethod(methodName: string, args: any[] = []) {
	switch (methodName) {
		case "getVisibleText":
			return pdfGetVisibleText(args[0] || {});
		case "highlightText":
			return await pdfHighlightText(String(args[0] || ""), args[1] || {});
		case "showNote":
			return await pdfShowNote(String(args[0] || ""), String(args[1] || ""), args[2] || {});
		case "scrollToAnnotation":
			return await pdfScrollToAnnotation(String(args[0] || ""), args[1] || {});
		case "captureState":
			return pdfCaptureState();
		case "clearAnnotations":
			return pdfClearAnnotations();
		case "getSelectionInfo":
			return { hasSelection: false, text: "", source: "onhand-pdf-viewer" };
		default:
			throw new Error(`Unsupported Onhand PDF viewer toolkit method: ${methodName || "(blank)"}`);
	}
}

async function runViewerCommand(data: any) {
	const command = String(data?.command || "");
	if (command === "evaluate") return await evaluateBridgeExpression(data?.expression);
	if (command === "status") {
		return {
			ready: document.body?.getAttribute("data-onhand-pdf-rendered") === "true",
			error: document.querySelector(".onhand-pdf-error")?.textContent || "",
			statusText: document.querySelector("#onhand-pdf-status")?.textContent || "",
			pageCountText: document.querySelector("#onhand-pdf-page-count")?.textContent || "",
			sourceUrl,
		};
	}
	if (command === "page-toolkit-method") {
		return await runPdfToolkitMethod(String(data?.methodName || ""), Array.isArray(data?.args) ? data.args : []);
	}
	throw new Error(`Unsupported Onhand PDF viewer bridge command: ${command || "(blank)"}`);
}

function postRuntimeBridgeResult(port: any, requestId: string, payload: Record<string, any>) {
	try {
		port.postMessage({
			type: "onhand-pdf-viewer-evaluate-result",
			requestId,
			...payload,
		});
	} catch {}
}

async function handleRuntimeBridgeCommand(data: any, port: any) {
	const requestId = String(data?.requestId || "");
	try {
		const value = await runViewerCommand(data);
		postRuntimeBridgeResult(port, requestId, {
			ok: true,
			value,
		});
	} catch (error: any) {
		postRuntimeBridgeResult(port, requestId, {
			ok: false,
			error: error?.message || String(error),
		});
	}
}

function scheduleRuntimeBridgeReconnect() {
	if (runtimeBridgeReconnectTimer !== null || !sourceUrl) return;
	runtimeBridgeReconnectTimer = window.setTimeout(() => {
		runtimeBridgeReconnectTimer = null;
		connectRuntimeBridge();
	}, 500);
}

function connectRuntimeBridge() {
	if (!sourceUrl || typeof chrome === "undefined" || !chrome?.runtime?.connect || runtimeBridgePort) return;
	try {
		const port = chrome.runtime.connect({ name: "onhand-pdf-viewer" });
		runtimeBridgePort = port;
		port.postMessage({
			type: "onhand-pdf-viewer-register",
			sourceUrl,
		});
		port.onMessage?.addListener?.((data: any) => {
			if (data?.type !== "onhand-pdf-viewer-evaluate") return;
			void handleRuntimeBridgeCommand(data, port);
		});
		port.onDisconnect?.addListener?.(() => {
			runtimeBridgePort = null;
			scheduleRuntimeBridgeReconnect();
		});
	} catch {
		runtimeBridgePort = null;
		scheduleRuntimeBridgeReconnect();
	}
}

async function handleBridgeCommand(data: any, port: MessagePort) {
	const requestId = data?.requestId || "";
	const postResult = (payload: Record<string, any>) => {
		try {
			port.postMessage({
				type: "onhand-pdf-viewer-bridge-result",
				requestId,
				...payload,
			});
		} finally {
			try {
				port.close();
			} catch {}
		}
	};

	try {
		const commandToken = String(data?.token || "");
		const commandSourceUrl = String(data?.sourceUrl || "");
		if (commandToken && (!sourceUrl || commandSourceUrl === sourceUrl) && !parentBridgeToken) {
			parentBridgeToken = commandToken;
		}
		const expectedToken = await getBridgeToken();
		if (!expectedToken || data?.token !== expectedToken) {
			throw new Error("Unauthorized Onhand PDF viewer bridge command.");
		}
		const value = await runViewerCommand(data);
		postResult({
			ok: true,
			value,
		});
	} catch (error: any) {
		postResult({
			ok: false,
			error: error?.message || String(error),
		});
	}
}

window.addEventListener("message", (event) => {
	const data = event?.data || {};
	if (data?.type === "onhand-pdf-viewer-bridge-init") {
		const token = String(data?.token || "");
		const messageSourceUrl = String(data?.sourceUrl || "");
		if (token && (!sourceUrl || messageSourceUrl === sourceUrl) && !parentBridgeToken) {
			parentBridgeToken = token;
		}
		return;
	}
	if (data?.type !== "onhand-pdf-viewer-bridge-command") return;
	const port = event.ports?.[0];
	if (!port) return;
	void handleBridgeCommand(data, port);
});

function setStatus(message: string) {
	statusElement.textContent = message;
}

function showError(message: string) {
	viewer.replaceChildren();
	const error = document.createElement("section");
	error.className = "onhand-pdf-error";
	error.textContent = message;
	viewer.append(error);
	setStatus("Error");
}

function parseSourceUrl() {
	const params = new URLSearchParams(location.search);
	const raw = params.get("url") || params.get("file") || "";
	if (!raw.trim()) return "";
	try {
		const parsed = new URL(raw);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
		return parsed.href;
	} catch {
		return "";
	}
}

function sourceTitle(url: string) {
	try {
		const parsed = new URL(url);
		return decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname);
	} catch {
		return "PDF";
	}
}

function updatePageFromScroll() {
	const pages = Array.from(document.querySelectorAll<HTMLElement>(".page[data-page-number]"));
	if (!pages.length) return;
	const viewportMiddle = window.scrollY + window.innerHeight * 0.45;
	let bestPage = pages[0];
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const page of pages) {
		const rect = page.getBoundingClientRect();
		const middle = window.scrollY + rect.top + rect.height / 2;
		const distance = Math.abs(middle - viewportMiddle);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestPage = page;
		}
	}
	pageInput.value = bestPage.getAttribute("data-page-number") || "1";
}

function scrollToPage(pageNumber: number) {
	const target = document.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
	if (!target) return;
	target.scrollIntoView({ behavior: "auto", block: "start", inline: "nearest" });
	pageInput.value = String(pageNumber);
}

async function renderPage(pageNumber: number, sequence: number) {
	const page = await pdfDocument.getPage(pageNumber);
	if (sequence !== renderSequence) return;
	const viewport = page.getViewport({ scale: currentScale });
	const pageElement = document.createElement("section");
	pageElement.className = "page";
	pageElement.setAttribute("data-page-number", String(pageNumber));
	pageElement.setAttribute("data-onhand-pdf-page", "true");
	pageElement.style.width = `${viewport.width}px`;
	pageElement.style.height = `${viewport.height}px`;

	const canvasWrapper = document.createElement("div");
	canvasWrapper.className = "canvasWrapper";
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d", { alpha: false });
	if (!context) throw new Error("Could not create canvas context for PDF page.");
	const outputScale = window.devicePixelRatio || 1;
	canvas.width = Math.floor(viewport.width * outputScale);
	canvas.height = Math.floor(viewport.height * outputScale);
	canvas.style.width = `${viewport.width}px`;
	canvas.style.height = `${viewport.height}px`;
	canvasWrapper.append(canvas);

	const textLayer = document.createElement("div");
	textLayer.className = "textLayer";
	textLayer.setAttribute("data-onhand-pdf-text-layer", "true");
	textLayer.style.setProperty("--scale-factor", String(currentScale));
	pageElement.append(canvasWrapper, textLayer);
	viewer.append(pageElement);

	await page.render({
		canvasContext: context,
		viewport,
		transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
	}).promise;

	const textContentSource =
		typeof page.streamTextContent === "function"
			? page.streamTextContent({ includeMarkedContent: true })
			: await page.getTextContent({ includeMarkedContent: true });
	const layer = new TextLayer({
		textContentSource,
		container: textLayer,
		viewport,
	});
	await layer.render();
	textLayer.querySelectorAll("span").forEach((span, index) => {
		span.setAttribute("data-onhand-pdf-text-span", String(index));
	});
}

async function renderDocument() {
	if (!pdfDocument) return;
	const sequence = ++renderSequence;
	viewer.replaceChildren();
	pageCountElement.textContent = `/ ${pdfDocument.numPages}`;
	pageInput.max = String(pdfDocument.numPages);
	setStatus(`Rendering ${pdfDocument.numPages} pages...`);
	for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
		await renderPage(pageNumber, sequence);
		if (sequence !== renderSequence) return;
		setStatus(`Rendered ${pageNumber}/${pdfDocument.numPages}`);
	}
	document.body.setAttribute("data-onhand-pdf-rendered", "true");
	setStatus("Ready");
	updatePageFromScroll();
}

async function loadPdf() {
	sourceUrl = parseSourceUrl();
	if (!sourceUrl) {
		showError("Open this viewer with a valid http(s) PDF URL parameter.");
		return;
	}
	(globalThis as any).__ONHAND_PDF_VIEWER_SOURCE_URL = sourceUrl;
	document.body.setAttribute("data-onhand-pdf-url", sourceUrl);
	connectRuntimeBridge();
	const title = sourceTitle(sourceUrl);
	document.title = `${title} - Onhand PDF Viewer`;
	titleElement.textContent = title;
	GlobalWorkerOptions.workerSrc = extensionUrl("vendor/pdf.worker.mjs");
	setStatus("Loading PDF...");
	pdfDocument = await getDocument({
		url: sourceUrl,
		cMapUrl: extensionUrl("vendor/cmaps/"),
		cMapPacked: true,
		standardFontDataUrl: extensionUrl("vendor/standard_fonts/"),
	}).promise;
	await renderDocument();
}

zoomInButton.addEventListener("click", () => {
	currentScale = Math.min(MAX_SCALE, Number((currentScale + SCALE_STEP).toFixed(2)));
	void renderDocument();
});

zoomOutButton.addEventListener("click", () => {
	currentScale = Math.max(MIN_SCALE, Number((currentScale - SCALE_STEP).toFixed(2)));
	void renderDocument();
});

pageInput.addEventListener("change", () => {
	const pageNumber = Number.parseInt(pageInput.value, 10);
	if (Number.isFinite(pageNumber) && pageNumber > 0) scrollToPage(pageNumber);
});

pageInput.addEventListener("keydown", (event) => {
	if (event.key !== "Enter") return;
	const pageNumber = Number.parseInt(pageInput.value, 10);
	if (Number.isFinite(pageNumber) && pageNumber > 0) scrollToPage(pageNumber);
});

window.addEventListener("scroll", updatePageFromScroll, { passive: true });

loadPdf().catch((error) => {
	showError(error?.message || String(error));
});
