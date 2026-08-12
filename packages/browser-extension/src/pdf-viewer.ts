import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist/legacy/build/pdf.mjs";

declare const chrome: any;

const DEFAULT_SCALE = 1;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const SCALE_STEP = 0.15;
const RESIZE_RENDER_DELAY_MS = 160;
const ZOOM_RENDER_DELAY_MS = 180;
const VIEWPORT_RENDER_DELAY_MS = 100;
const MAX_CANVAS_PIXELS = 32 * 1024 * 1024;
const MAX_CANVAS_DIMENSION = 8192;
const PDF_LOAD_TIMEOUT_MS = 20000;
const CREDENTIALED_PDF_LOAD_RETRY_TIMEOUT_MS = 12000;
const PDF_VIEWER_ANNOTATION_THEME = "light";

const viewer = document.getElementById("viewer") as HTMLElement;
const titleElement = document.getElementById("onhand-pdf-title") as HTMLElement;
const statusElement = document.getElementById("onhand-pdf-status") as HTMLElement;
const pageInput = document.getElementById("onhand-pdf-page") as HTMLInputElement;
const pageCountElement = document.getElementById("onhand-pdf-page-count") as HTMLElement;
const zoomInButton = document.getElementById("onhand-pdf-zoom-in") as HTMLButtonElement;
const zoomOutButton = document.getElementById("onhand-pdf-zoom-out") as HTMLButtonElement;
const zoomValueButton = document.getElementById("onhand-pdf-zoom-value") as HTMLButtonElement;

let pdfDocument: any = null;
let sourceUrl = "";
let currentScale = DEFAULT_SCALE;
let committedScale = DEFAULT_SCALE;
let scaleMode: "fit" | "custom" = "fit";
let renderSequence = 0;
let runtimeBridgePort: any = null;
let runtimeBridgeReconnectTimer: number | null = null;
let annotationSequence = 0;
let resizeRenderTimer: number | null = null;
let zoomRenderTimer: number | null = null;
let viewportRenderTimer: number | null = null;
let gestureAnimationFrame: number | null = null;
let zoomRevision = 0;
let queuedGestureScale = DEFAULT_SCALE;
let queuedGestureClientX = 0;
let queuedGestureClientY = 0;
let nativeGestureStartScale = DEFAULT_SCALE;
let transientZoomAnchor: PdfZoomAnchor | null = null;
let transientZoomGeometry: PdfTransientZoomGeometry | null = null;
let transientZoomCentersHorizontally = false;
let lastFitRenderWidth = 0;

type PdfRect = {
	left: number;
	top: number;
	width: number;
	height: number;
};

type PdfNoteSnapshot = {
	text: string;
	label: string;
	collapsed: boolean;
};

type PdfAnnotationSnapshot = {
	annotationId: string;
	text: string;
	occurrence: number;
	pdfAnchor: any;
	note: PdfNoteSnapshot | null;
};

type PdfViewSnapshot = {
	pageNumber: number;
	pageOffsetRatio: number;
	annotations: PdfAnnotationSnapshot[];
};

type PdfZoomAnchor = {
	pageNumber: number;
	xRatio: number;
	yRatio: number;
	clientX: number;
	clientY: number;
};

type PdfTransientZoomGeometry = {
	viewerClientLeft: number;
	viewerClientTop: number;
	pageLeft: number;
	pageTop: number;
	pageWidth: number;
	pageHeight: number;
	availableWidth: number;
};

function inlinePdfViewerBridgeStorageKey(pdfUrl: string) {
	return `onhandInlinePdfViewerBridge:${encodeURIComponent(String(pdfUrl || ""))}`;
}

// requestAnimationFrame never fires while the tab is hidden or the window is
// occluded, which left annotation commands hanging until the surface became
// visible again (and their stale completions then clobbered newer state).
// Race a short timeout so layout-settling waits always resolve.
function waitForNextFrame(timeoutMs = 150) {
	return new Promise<void>((resolve) => {
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		requestAnimationFrame(finish);
		setTimeout(finish, timeoutMs);
	});
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

function getPdfPageByNumber(pageNumber: number) {
	if (!Number.isFinite(pageNumber) || pageNumber < 1) return null;
	return document.querySelector<HTMLElement>(`.page[data-page-number="${Math.floor(pageNumber)}"]`);
}

function visibleEnough(rect: DOMRect | ClientRect) {
	return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
}

function clampScale(value: number) {
	const scale = Number.isFinite(value) && value > 0 ? value : DEFAULT_SCALE;
	return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number(scale.toFixed(3))));
}

function updateZoomControls() {
	const percent = Math.round(currentScale * 100);
	zoomValueButton.textContent = `${percent}%`;
	zoomValueButton.setAttribute("aria-label", `Zoom ${percent}%. Click to fit the page to the window.`);
	zoomOutButton.disabled = currentScale <= MIN_SCALE + 0.001;
	zoomInButton.disabled = currentScale >= MAX_SCALE - 0.001;
}

function defaultZoomClientPoint() {
	const toolbar = document.querySelector<HTMLElement>(".onhand-pdf-toolbar");
	const toolbarBottom = toolbar?.getBoundingClientRect().bottom || 0;
	return {
		clientX: window.innerWidth / 2,
		clientY: toolbarBottom + Math.max(1, window.innerHeight - toolbarBottom) / 2,
	};
}

function captureZoomAnchor(clientX?: number, clientY?: number): PdfZoomAnchor | null {
	const fallbackPoint = defaultZoomClientPoint();
	const x = Number.isFinite(clientX) ? Number(clientX) : fallbackPoint.clientX;
	const y = Number.isFinite(clientY) ? Number(clientY) : fallbackPoint.clientY;
	const hit = document.elementFromPoint(x, y);
	const page = (hit instanceof Element ? hit.closest<HTMLElement>(".page[data-page-number]") : null) || findViewportPage();
	const pageNumber = getPageNumber(page);
	if (!page || !pageNumber) return null;
	const rect = page.getBoundingClientRect();
	return {
		pageNumber,
		xRatio: Math.max(0, Math.min(1, (x - rect.left) / Math.max(1, rect.width))),
		yRatio: Math.max(0, Math.min(1, (y - rect.top) / Math.max(1, rect.height))),
		clientX: x,
		clientY: y,
	};
}

function restoreZoomAnchor(anchor: PdfZoomAnchor | null) {
	if (!anchor) return;
	const page = getPdfPageByNumber(anchor.pageNumber);
	if (!page) return;
	const rect = page.getBoundingClientRect();
	const targetDocumentX = window.scrollX + rect.left + rect.width * anchor.xRatio;
	const targetDocumentY = window.scrollY + rect.top + rect.height * anchor.yRatio;
	window.scrollTo({
		left: Math.max(0, targetDocumentX - anchor.clientX),
		top: Math.max(0, targetDocumentY - anchor.clientY),
		behavior: "auto",
	});
}

function hasTransientZoom() {
	return Math.abs(currentScale - committedScale) >= 0.001 || Boolean(transientZoomAnchor) || Boolean(viewer.style.transform && viewer.style.transform !== "none");
}

function captureTransientZoomGeometry(anchor: PdfZoomAnchor | null): PdfTransientZoomGeometry | null {
	const page = (anchor ? getPdfPageByNumber(anchor.pageNumber) : null) || findViewportPage();
	if (!page) return null;
	const viewerRect = viewer.getBoundingClientRect();
	const pageRect = page.getBoundingClientRect();
	const padding = viewerPadding();
	return {
		viewerClientLeft: viewerRect.left,
		viewerClientTop: viewerRect.top,
		pageLeft: pageRect.left - viewerRect.left,
		pageTop: pageRect.top - viewerRect.top,
		pageWidth: pageRect.width,
		pageHeight: pageRect.height,
		availableWidth: Math.max(1, window.innerWidth - padding.left - padding.right),
	};
}

function centeredTransientZoomAnchor(anchor: PdfZoomAnchor | null) {
	if (!anchor || !transientZoomCentersHorizontally) return anchor;
	return {
		...anchor,
		xRatio: 0.5,
		clientX: window.innerWidth / 2,
	};
}

// Keep pinch/trackpad interaction on the compositor. Updating the width and
// height of every page shell makes Chromium lay out the entire document for
// every gesture frame, which is especially expensive when each page contains
// a full-page scan. The real page geometry is committed once the gesture rests.
function applyTransientZoom(nextScale: number, anchor: PdfZoomAnchor | null) {
	const startsNewGesture = !hasTransientZoom();
	currentScale = clampScale(nextScale);
	if (startsNewGesture) {
		transientZoomAnchor = anchor;
		transientZoomGeometry = captureTransientZoomGeometry(anchor);
	}
	const ratio = currentScale / Math.max(0.001, committedScale);
	const geometry = transientZoomGeometry;
	if (!geometry || !transientZoomAnchor || Math.abs(ratio - 1) < 0.001) {
		viewer.style.transformOrigin = "0 0";
		viewer.style.transform = "none";
		return;
	}

	// Match the grid's resting geometry during the compositor preview. When
	// the page fits between the gray margins, keep it centered regardless of
	// pointer position. Once it overflows, preserve the point under the cursor.
	transientZoomCentersHorizontally = geometry.pageWidth * ratio <= geometry.availableWidth + 0.5;
	const horizontalRatio = transientZoomCentersHorizontally ? 0.5 : transientZoomAnchor.xRatio;
	const targetClientX = transientZoomCentersHorizontally ? window.innerWidth / 2 : transientZoomAnchor.clientX;
	const localAnchorX = geometry.pageLeft + geometry.pageWidth * horizontalRatio;
	const localAnchorY = geometry.pageTop + geometry.pageHeight * transientZoomAnchor.yRatio;
	const translateX = targetClientX - geometry.viewerClientLeft - localAnchorX * ratio;
	const translateY = transientZoomAnchor.clientY - geometry.viewerClientTop - localAnchorY * ratio;
	viewer.style.transformOrigin = "0 0";
	// Translate after scaling in the resulting matrix so these offsets stay in
	// viewport pixels and land on the same geometry as the committed layout.
	viewer.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${ratio})`;
}

function commitTransientZoom() {
	if (!hasTransientZoom()) return;
	const ratio = currentScale / Math.max(0.001, committedScale);
	const anchor = centeredTransientZoomAnchor(transientZoomAnchor);
	if (Math.abs(ratio - 1) >= 0.001) {
		for (const pageElement of getPdfPages()) {
			const width = Number.parseFloat(pageElement.style.width || "0") * ratio;
			const height = Number.parseFloat(pageElement.style.height || "0") * ratio;
			if (width > 0) pageElement.style.width = `${width}px`;
			if (height > 0) pageElement.style.height = `${height}px`;
			scaleAnnotationLayerForZoom(pageElement, currentScale);
		}
		committedScale = currentScale;
		viewer.style.setProperty("--scale-factor", String(committedScale));
	}
	viewer.style.transform = "none";
	viewer.style.transformOrigin = "0 0";
	transientZoomAnchor = null;
	transientZoomGeometry = null;
	transientZoomCentersHorizontally = false;
	restoreZoomAnchor(anchor);
}

function canvasOutputScale(viewport: { width: number; height: number }) {
	const requested = Math.max(1, Number(window.devicePixelRatio) || 1);
	const dimensionLimit = MAX_CANVAS_DIMENSION / Math.max(1, viewport.width, viewport.height);
	const pixelLimit = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, viewport.width * viewport.height));
	return Math.min(requested, dimensionLimit, pixelLimit);
}

function parsePixelValue(value: string) {
	const parsed = Number.parseFloat(value || "");
	return Number.isFinite(parsed) ? parsed : 0;
}

function viewerPadding() {
	const style = window.getComputedStyle(viewer);
	return {
		left: parsePixelValue(style.paddingLeft),
		right: parsePixelValue(style.paddingRight),
		top: parsePixelValue(style.paddingTop),
		bottom: parsePixelValue(style.paddingBottom),
	};
}

async function computeFitScale(pageNumber = 1) {
	if (!pdfDocument) return DEFAULT_SCALE;
	// Hidden or reclaimed surfaces report zero-sized layout; computing a
	// "fit" from that produces a garbage scale and a pointless full
	// re-render. Keep the current scale until real dimensions are back.
	if (document.hidden || viewer.clientWidth <= 1 || window.innerHeight <= 1) return currentScale || DEFAULT_SCALE;
	const targetPage = Math.max(1, Math.min(Number(pdfDocument.numPages || 1) || 1, Math.floor(Number(pageNumber) || 1)));
	const page = await pdfDocument.getPage(targetPage);
	const viewport = page.getViewport({ scale: 1 });
	const padding = viewerPadding();
	const toolbar = document.querySelector<HTMLElement>(".onhand-pdf-toolbar");
	const toolbarHeight = toolbar?.getBoundingClientRect().height || 0;
	const availableWidth = Math.max(1, viewer.clientWidth - padding.left - padding.right - 2);
	const availableHeight = Math.max(1, window.innerHeight - toolbarHeight - padding.top - padding.bottom - 2);
	const widthScale = availableWidth / Math.max(1, viewport.width);
	const heightScale = availableHeight / Math.max(1, viewport.height);
	return clampScale(Math.min(widthScale, heightScale));
}

function findViewportPage() {
	const pages = getPdfPages();
	if (!pages.length) return null;
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
	return bestPage;
}

// pdf.js renders one absolutely positioned span per text item and emits no
// whitespace between spans, so a naive node walk glues wrapped lines and
// adjacent words together ("…everywhereThis paragraph…") while the text the
// model copies from (pdf_read_pages) separates them — every cross-line quote
// then silently degrades to the compact tier, and short ones fail outright.
// Geometry tells the cases apart: a new line or a visible horizontal gap is a
// word boundary; a kerning split inside one word has neither.
function pdfTextNodeBoundaryNeedsSpace(previous: Text | null, next: Text) {
	if (!previous) return false;
	const previousElement = previous.parentElement;
	const nextElement = next.parentElement;
	if (!previousElement || !nextElement || previousElement === nextElement) return false;
	const previousRect = previousElement.getBoundingClientRect();
	const nextRect = nextElement.getBoundingClientRect();
	const lineHeight = Math.max(previousRect.height, nextRect.height);
	if (!lineHeight) {
		// Layout-less environments cannot measure; distinct spans are distinct
		// pdf.js text items, which read as separate words in reading order.
		return true;
	}
	if (Math.abs(nextRect.top - previousRect.top) > lineHeight / 2) return true;
	return nextRect.left - previousRect.right > lineHeight * 0.12;
}

function buildNormalizedTextMap(root: Element) {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const positions: Array<{ node: Text; offset: number }> = [];
	let text = "";
	let pendingSpace: { node: Text; offset: number } | null = null;
	let previousNode: Text | null = null;
	// Search projection: the same text with punctuation collapsed to spaces,
	// mirroring buildSearchText's query normalization. The exact tier compares
	// normalizeSearchText(query) against THIS projection — comparing a
	// punctuation-stripped query against the punctuation-preserving text made
	// every sentence with an internal comma silently fall to the compact tier.
	const searchPositions: Array<{ node: Text; offset: number }> = [];
	let searchText = "";
	let pendingSearchSpace: { node: Text; offset: number } | null = null;

	while (walker.nextNode()) {
		const node = walker.currentNode as Text;
		const value = node.nodeValue || "";
		if (text && !text.endsWith(" ") && !pendingSpace && pdfTextNodeBoundaryNeedsSpace(previousNode, node)) {
			pendingSpace = { node, offset: 0 };
			if (searchText && !searchText.endsWith(" ") && !pendingSearchSpace) pendingSearchSpace = { node, offset: 0 };
		}
		previousNode = node;
		for (let offset = 0; offset < value.length; offset += 1) {
			const normalized = normalizeSearchChar(value[offset]);
			if (!normalized) continue;
			if (normalized === " ") {
				if (text && !text.endsWith(" ")) pendingSpace = { node, offset };
				if (searchText && !searchText.endsWith(" ")) pendingSearchSpace = { node, offset };
				continue;
			}
			if (pendingSpace) {
				text += " ";
				positions.push(pendingSpace);
				pendingSpace = null;
			}
			// NFKC can expand one source char into several (e.g. the "ﬁ"
			// ligature -> "fi"); push one position per emitted char so
			// text.length stays in lockstep with positions and every text
			// index maps back to a real node offset.
			for (const char of normalized) {
				text += char;
				positions.push({ node, offset });
				const isSearchable = /[a-z0-9]/i.test(char) || /[^\x00-\x7F]/.test(char);
				if (isSearchable) {
					if (pendingSearchSpace) {
						searchText += " ";
						searchPositions.push(pendingSearchSpace);
						pendingSearchSpace = null;
					}
					searchText += char;
					searchPositions.push({ node, offset });
				} else if (searchText && !searchText.endsWith(" ") && !pendingSearchSpace) {
					pendingSearchSpace = { node, offset };
				}
			}
		}
	}
	return { text, positions, searchText, searchPositions };
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

// How many characters of surrounding text an anchor stores on each side to
// disambiguate and re-find its highlight. Matches the native-viewer path in
// background.js so the anchor shape is consistent across PDF surfaces.
const ANCHOR_CONTEXT_LENGTH = 80;

type AnchorContext = { prefix?: string; suffix?: string } | null | undefined;

function collectMatchIndices(haystack: string, needle: string) {
	const indices: number[] = [];
	if (!needle) return indices;
	let from = 0;
	for (;;) {
		const index = haystack.indexOf(needle, from);
		if (index === -1) break;
		indices.push(index);
		from = index + Math.max(needle.length, 1);
	}
	return indices;
}

function commonSuffixLength(a: string, b: string) {
	let i = a.length - 1;
	let j = b.length - 1;
	let count = 0;
	while (i >= 0 && j >= 0 && a[i] === b[j]) {
		i -= 1;
		j -= 1;
		count += 1;
	}
	return count;
}

function commonPrefixLength(a: string, b: string) {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
	return i;
}

// How well the text around a candidate match position agrees with the
// anchor's stored prefix/suffix context. Compared in compact (alphanumeric)
// space so punctuation and whitespace differences between the stored context
// and the live page text never sink the score. Higher = more confident.
function scoreContextAt(haystack: string, startIndex: number, matchLength: number, compactPrefix: string, compactSuffix: string) {
	let score = 0;
	if (compactPrefix) {
		const before = compactSearchText(haystack.slice(Math.max(0, startIndex - ANCHOR_CONTEXT_LENGTH), startIndex));
		score += commonSuffixLength(before, compactPrefix);
	}
	if (compactSuffix) {
		const after = compactSearchText(haystack.slice(startIndex + matchLength, startIndex + matchLength + ANCHOR_CONTEXT_LENGTH));
		score += commonPrefixLength(after, compactSuffix);
	}
	return score;
}

// Choose which occurrence of a match to use. With stored context, pick the
// occurrence whose surroundings match it best — this is what lets re-finding
// survive edits and repeated text. Without context, fall back to the Nth
// occurrence exactly as before.
// A 1-2 char boundary coincidence is meaningless; require a real run of
// agreeing context before trusting it over the stored occurrence.
const MIN_CONTEXT_SCORE = 6;

function pickMatchIndex(haystack: string, indices: number[], matchLength: number, occurrence: number, compactPrefix: string, compactSuffix: string) {
	if (!indices.length) return -1;
	if (compactPrefix || compactSuffix) {
		const scores = indices.map((index) => scoreContextAt(haystack, index, matchLength, compactPrefix, compactSuffix));
		const bestScore = Math.max(...scores);
		if (bestScore >= MIN_CONTEXT_SCORE) {
			// Several occurrences can share identical surroundings (repeated
			// rows, boilerplate); among the tied best, honor the stored
			// occurrence so the right copy still wins.
			const tied = indices.filter((_, i) => scores[i] === bestScore);
			return tied.length === 1 ? tied[0] : tied[Math.min(Math.max(occurrence, 1), tied.length) - 1];
		}
	}
	return occurrence <= indices.length ? indices[occurrence - 1] : -1;
}

function extractNormalizedContext(haystack: string, startIndex: number, matchLength: number) {
	const prefix = haystack.slice(Math.max(0, startIndex - ANCHOR_CONTEXT_LENGTH), startIndex).trim();
	const suffix = haystack.slice(startIndex + matchLength, startIndex + matchLength + ANCHOR_CONTEXT_LENGTH).trim();
	const context: { prefix?: string; suffix?: string } = {};
	if (prefix) context.prefix = prefix;
	if (suffix) context.suffix = suffix;
	return Object.keys(context).length ? context : undefined;
}

function rangeFromMapPositions(positions: Array<{ node: Text; offset: number }>, startIndex: number, endIndexInclusive: number) {
	const start = positions[startIndex];
	const end = positions[endIndexInclusive];
	if (!start || !end) return null;
	const range = document.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset + 1);
	return range;
}

function findMappedTextRange(root: Element, query: string, occurrence = 1, context?: AnchorContext) {
	const map = buildNormalizedTextMap(root);
	const queryText = normalizeSearchText(query);
	// Context is always compared in compact (alphanumeric) space so punctuation
	// and spacing differences between the stored anchor and the live page text
	// never break re-finding.
	const compactPrefix = context?.prefix ? compactSearchText(context.prefix) : "";
	const compactSuffix = context?.suffix ? compactSearchText(context.suffix) : "";

	// 1) Exact normalized match, disambiguated by stored context when present.
	// Compared in the map's search projection so both sides normalize
	// punctuation identically.
	const exactIndices = collectMatchIndices(map.searchText, queryText);
	const exactIndex = pickMatchIndex(map.searchText, exactIndices, queryText.length, occurrence, compactPrefix, compactSuffix);
	if (exactIndex !== -1) {
		const range = rangeFromMapPositions(map.searchPositions, exactIndex, exactIndex + queryText.length - 1);
		if (range) {
			return {
				range,
				matchedText: normalizeText(range.toString()) || normalizeText(query),
				fallback: undefined,
				context: extractNormalizedContext(map.searchText, exactIndex, queryText.length),
			};
		}
	}

	// Build the compact (whitespace/punctuation-insensitive) projection of the
	// page once; tiers 2 and 3 both work in it.
	const compactPositions: number[] = [];
	let compactText = "";
	for (let index = 0; index < map.text.length; index += 1) {
		const char = map.text[index];
		if (!char || char === " " || !/[a-z0-9]|[^\x00-\x7F]/i.test(char)) continue;
		compactText += char;
		compactPositions.push(index);
	}

	// 2) Compact match, context-aware.
	const compactQuery = compactSearchText(query);
	if (compactQuery.length >= 8) {
		const compactIndices = collectMatchIndices(compactText, compactQuery);
		const compactIndex = pickMatchIndex(compactText, compactIndices, compactQuery.length, occurrence, compactPrefix, compactSuffix);
		if (compactIndex !== -1) {
			const startMapIndex = compactPositions[compactIndex];
			const endMapIndex = compactPositions[compactIndex + compactQuery.length - 1];
			const range = rangeFromMapPositions(map.positions, startMapIndex, endMapIndex);
			if (range) {
				return {
					range,
					matchedText: normalizeText(range.toString()) || normalizeText(query),
					fallback: "compact-text",
					context: extractNormalizedContext(map.text, startMapIndex, endMapIndex - startMapIndex + 1),
				};
			}
		}
	}

	// 3) Context-anchored recovery: the exact text drifted, but the stored
	// surrounding context is stable. Highlight the compact span sitting between
	// the stored prefix and suffix, choosing — across every prefix occurrence —
	// the gap closest to the original match length, when it is plausible.
	if (compactPrefix.length >= 6 && compactSuffix.length >= 6) {
		const maxSpan = Math.max(compactQuery.length * 2, compactQuery.length + 24, 16);
		let best: { spanStart: number; suffixIndex: number; spanLength: number } | null = null;
		for (const prefixIndex of collectMatchIndices(compactText, compactPrefix)) {
			const spanStart = prefixIndex + compactPrefix.length;
			const suffixIndex = compactText.indexOf(compactSuffix, spanStart);
			if (suffixIndex <= spanStart || suffixIndex - spanStart > maxSpan) continue;
			const spanLength = suffixIndex - spanStart;
			if (!best || Math.abs(spanLength - compactQuery.length) < Math.abs(best.spanLength - compactQuery.length)) {
				best = { spanStart, suffixIndex, spanLength };
			}
		}
		if (best) {
			const startMapIndex = compactPositions[best.spanStart];
			const endMapIndex = compactPositions[best.suffixIndex - 1];
			const range = rangeFromMapPositions(map.positions, startMapIndex, endMapIndex);
			if (range) {
				return {
					range,
					matchedText: normalizeText(range.toString()) || normalizeText(query),
					fallback: "context",
					context: extractNormalizedContext(map.text, startMapIndex, endMapIndex - startMapIndex + 1),
				};
			}
		}
	}

	return null;
}

function ensureAnnotationLayer(page: HTMLElement) {
	let layer = page.querySelector<HTMLElement>(".onhand-pdf-annotation-layer");
	if (layer) return layer;
	layer = document.createElement("div");
	layer.className = "onhand-pdf-annotation-layer";
	layer.setAttribute("data-onhand-pdf-coordinate-scale", String(currentScale));
	Object.assign(layer.style, {
		position: "absolute",
		left: "0",
		top: "0",
		width: `${page.clientWidth}px`,
		height: `${page.clientHeight}px`,
		transformOrigin: "0 0",
		zIndex: "12",
		pointerEvents: "none",
	});
	page.append(layer);
	return layer;
}

function scaleAnnotationLayerForZoom(page: HTMLElement, nextScale: number) {
	const layer = page.querySelector<HTMLElement>(".onhand-pdf-annotation-layer");
	if (!layer) return;
	const coordinateScale = Number(layer.getAttribute("data-onhand-pdf-coordinate-scale") || currentScale) || currentScale;
	const ratio = nextScale / Math.max(0.001, coordinateScale);
	layer.style.transform = Math.abs(ratio - 1) < 0.001 ? "none" : `scale(${ratio})`;
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
		const rect = clampPdfRectToPageSize({
			left: (left - pageRect.left) * scaleX,
			top: (spanRect.top - pageRect.top) * scaleY,
			width: width * scaleX,
			height: spanRect.height * scaleY,
		}, size);
		if (rect) rects.push(rect);
	}
	return rects;
}

function clampPdfRectToPageSize(rect: PdfRect, size: { width: number; height: number }) {
	const pageWidth = Math.max(1, Number(size.width) || 1);
	const pageHeight = Math.max(1, Number(size.height) || 1);
	const left = Math.max(0, Math.min(pageWidth, Number(rect.left) || 0));
	const top = Math.max(0, Math.min(pageHeight, Number(rect.top) || 0));
	const right = Math.max(0, Math.min(pageWidth, Number(rect.left + rect.width) || 0));
	const bottom = Math.max(0, Math.min(pageHeight, Number(rect.top + rect.height) || 0));
	const width = right - left;
	const height = bottom - top;
	if (width <= 0.5 || height <= 0.5) return null;
	return { left, top, width, height };
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
		}))
		.map((rect) => clampPdfRectToPageSize(rect, size))
		.filter((rect): rect is PdfRect => Boolean(rect));
}

function unionRects(rects: PdfRect[]) {
	const left = Math.min(...rects.map((rect) => rect.left));
	const top = Math.min(...rects.map((rect) => rect.top));
	const right = Math.max(...rects.map((rect) => rect.left + rect.width));
	const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));
	return { left, top, width: right - left, height: bottom - top };
}

function applyHighlightStyles(highlight: HTMLElement, rects: PdfRect[], union: PdfRect) {
	highlight.setAttribute("data-onhand-pdf-highlight-container", "true");
	highlight.setAttribute("data-onhand-theme", PDF_VIEWER_ANNOTATION_THEME);
	makePdfHighlightPassive(highlight);
	Object.assign(highlight.style, {
		position: "absolute",
		left: `${union.left}px`,
		top: `${union.top}px`,
		width: `${union.width}px`,
		height: `${union.height}px`,
		pointerEvents: "none",
		cursor: "default",
		userSelect: "none",
		// Highlights and note cards share one annotation layer, so paint
		// order would otherwise follow DOM order — a highlight added after
		// a card would cover it. Pin highlights below cards explicitly.
		zIndex: "1",
		scrollMarginTop: "22vh",
		scrollMarginBottom: "22vh",
	});
	for (const rect of rects) {
		const segment = document.createElement("div");
		segment.setAttribute("data-onhand-pdf-highlight-segment", "true");
		segment.setAttribute("data-onhand-theme", PDF_VIEWER_ANNOTATION_THEME);
		makePdfHighlightPassive(segment);
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
	highlight.style.setProperty("background", "transparent", "important");
	highlight.style.setProperty("border-radius", "0", "important");
	highlight.style.setProperty("pointer-events", "none", "important");
	highlight.style.setProperty("cursor", "default", "important");
	highlight.style.setProperty("user-select", "none", "important");
	highlight.style.setProperty("-webkit-user-select", "none", "important");
}

function makePdfHighlightPassive(element: HTMLElement) {
	element.removeAttribute("role");
	element.removeAttribute("tabindex");
	element.removeAttribute("title");
	element.removeAttribute("data-onhand-note-trigger-bound");
	element.setAttribute("aria-hidden", "true");
	element.style.setProperty("pointer-events", "none", "important");
	element.style.setProperty("cursor", "default", "important");
	element.style.setProperty("user-select", "none", "important");
	element.style.setProperty("-webkit-user-select", "none", "important");
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

function normalizePdfRegionRect(value: any) {
	if (!value || typeof value !== "object") return null;
	const left = Number(value.left);
	const top = Number(value.top);
	const width = Number(value.width);
	const height = Number(value.height);
	if (![left, top, width, height].every((entry) => Number.isFinite(entry))) return null;
	if (left < 0 || top < 0 || width <= 0 || height <= 0 || left >= 1 || top >= 1) return null;
	const clampedLeft = Math.max(0, Math.min(0.98, left));
	const clampedTop = Math.max(0, Math.min(0.98, top));
	return {
		left: clampedLeft,
		top: clampedTop,
		width: Math.max(0.02, Math.min(1 - clampedLeft, width)),
		height: Math.max(0.01, Math.min(1 - clampedTop, height)),
	};
}

// §3.13 region marks: a durable overlay on a SCANNED page, anchored by
// normalized page fractions instead of a text quote. Reserved for pages with
// no extractable text — text pages must anchor to exact quotes so citations
// stay verifiable. Replays through the same path on zoom rebuilds and
// artifact restores because the anchor carries regionRect.
async function pdfHighlightRegion(label: string, regionRect: { left: number; top: number; width: number; height: number }, options: Record<string, any> = {}) {
	const pageNumber = pdfAnchorPageNumber(options.pdfAnchor);
	if (!pageNumber) throw new Error("A region highlight requires pdfAnchor.pageNumber.");
	await ensurePageRendered(pageNumber, renderSequence, { sharpen: false });
	const page = getPdfPageByNumber(pageNumber);
	if (!page) throw new Error(`PDF page not found: ${pageNumber}`);
	const pageText = normalizeText(isPendingPage(page) ? await getPageTextContent(pageNumber) : pdfPageText(page));
	if (pageText.length >= 40) throw new Error("This page has extractable text; anchor with an exact text quote instead of a region.");
	const size = { width: page.clientWidth || 1, height: page.clientHeight || 1 };
	const rect = clampPdfRectToPageSize(
		{
			left: regionRect.left * size.width,
			top: regionRect.top * size.height,
			width: regionRect.width * size.width,
			height: regionRect.height * size.height,
		},
		size,
	);
	if (!rect) throw new Error("Region rect resolved outside the page bounds.");
	const annotationId = nextAnnotationId();
	const pdfAnchor = {
		surface: "pdf",
		viewer: "onhand-pdf-viewer",
		document: { url: sourceUrl, title: document.title },
		pageNumber,
		matchedText: label,
		textQuote: { exact: label },
		regionRect,
		rects: [rect],
		occurrence: 1,
		region: true,
	};
	const highlight = document.createElement("div");
	highlight.setAttribute("data-onhand-highlight-kind", "pdf");
	highlight.setAttribute("data-onhand-region", "true");
	highlight.setAttribute("data-onhand-annotation-id", annotationId);
	highlight.setAttribute("data-onhand-matched-text", label);
	highlight.setAttribute("data-onhand-pdf-anchor", JSON.stringify(pdfAnchor));
	applyHighlightStyles(highlight, [rect], rect);
	ensureAnnotationLayer(page).append(highlight);
	if (options.scrollIntoView !== false) {
		highlight.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
		await waitForNextFrame();
		updatePageFromScroll();
	}
	return buildAnnotationResult(highlight, label, { region: true });
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
				await waitForNextFrame();
				updatePageFromScroll();
			}
			return buildAnnotationResult(existing, rawQuery, {
				reusedExisting: true,
				...(duplicateCount ? { duplicateCount } : {}),
			});
		}
	}
	const regionRect = normalizePdfRegionRect(options.pdfAnchor?.regionRect);
	if (regionRect) return await pdfHighlightRegion(rawQuery, regionRect, options);
	const targetPageNumber = pdfAnchorPageNumber(options.pdfAnchor);
	if (targetPageNumber) await ensurePageRendered(targetPageNumber);

	async function applyHighlightToPage(page: HTMLElement) {
		const textLayer = page.querySelector<HTMLElement>(".textLayer");
		if (!textLayer) return null;
		const match = findMappedTextRange(textLayer, rawQuery, occurrence, options.pdfAnchor?.textQuote);
		if (!match) return null;
		const rects = rangeRectsForPage(match.range, page);
		if (!rects.length) return null;
		const union = unionRects(rects);
		const annotationId = nextAnnotationId();
		const pdfAnchor = {
			surface: "pdf",
			viewer: "onhand-pdf-viewer",
			document: { url: sourceUrl, title: document.title },
			pageNumber: getPageNumber(page),
			matchedText: match.matchedText,
			textQuote: {
				exact: match.matchedText,
				...(match.context?.prefix ? { prefix: match.context.prefix } : {}),
				...(match.context?.suffix ? { suffix: match.context.suffix } : {}),
			},
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
			await waitForNextFrame();
			updatePageFromScroll();
		}
		return buildAnnotationResult(highlight, rawQuery, { approximate: Boolean(match.fallback), fallback: match.fallback });
	}

	const pages = getPdfPages()
		.map((page, index) => {
			const rect = page.getBoundingClientRect();
			const pageNumber = getPageNumber(page);
			return {
				page,
				index,
				targeted: Boolean(targetPageNumber && pageNumber === targetPageNumber),
				visible: visibleEnough(rect),
				distance: Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2),
			};
		})
		.sort((a, b) => {
			if (a.targeted !== b.targeted) return a.targeted ? -1 : 1;
			if (a.visible !== b.visible) return a.visible ? -1 : 1;
			if (a.visible && b.visible && a.distance !== b.distance) return a.distance - b.distance;
			return a.index - b.index;
		});

	for (const { page } of pages) {
		const result = await applyHighlightToPage(page);
		if (result) return result;
	}

	// Nothing matched in the rendered text layers; check pages that have
	// not rendered yet via their PDF.js text content, render the first
	// page that contains the text, and anchor there.
	const pendingPageNumber = await findPendingPageWithText(rawQuery);
	if (pendingPageNumber) {
		await ensurePageRendered(pendingPageNumber);
		const pendingPage = getPdfPageByNumber(pendingPageNumber);
		if (pendingPage) {
			const result = await applyHighlightToPage(pendingPage);
			if (result) return result;
		}
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

function setImportantStyles(element: HTMLElement, styles: Record<string, string>) {
	for (const [property, value] of Object.entries(styles)) {
		setImportantStyle(element, property, value);
	}
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

function scorePdfNoteCandidate(candidate: PageRect & { order: number }, textRects: PageRect[], anchorRect: PageRect, noteRects: PageRect[] = []) {
	// Normalize overlaps to fractions so they stay comparable to the
	// distance term: raw overlap areas are in the tens of thousands of
	// square pixels and used to crush distance entirely, dumping notes at
	// the bottom of the page whenever no fully-clear spot existed near the
	// highlight. A note brushing some text near its anchor reads far
	// better than an overlap-free note far away from it.
	const candidateArea = Math.max(1, candidate.width * candidate.height);
	const anchorArea = Math.max(1, anchorRect.width * anchorRect.height);
	const textOverlap = textRects.reduce((sum, rect) => sum + rectOverlapArea(candidate, rect), 0) / candidateArea;
	const anchorOverlap = rectOverlapArea(candidate, anchorRect) / anchorArea;
	// Stacking two cards is worse than brushing text: a covered card is
	// unreadable until dismissed, so weigh note-on-note overlap far above
	// every other term and prefer any non-overlapping spot the page offers.
	const noteOverlap = noteRects.reduce((sum, rect) => sum + rectOverlapArea(candidate, rect), 0) / candidateArea;
	const anchorDistance = Math.abs(candidate.left - anchorRect.left) + Math.abs(candidate.top - anchorRect.top);
	return textOverlap * 800 + anchorOverlap * 1600 + noteOverlap * 6000 + anchorDistance + candidate.order * 4;
}

function collectOtherPdfNoteRects(note: HTMLElement, page: HTMLElement, pageRect: DOMRect): PageRect[] {
	const overlay = page.querySelector<HTMLElement>(".onhand-pdf-annotation-layer");
	if (!overlay) return [];
	return Array.from(overlay.querySelectorAll<HTMLElement>("[data-onhand-pdf-note]"))
		.filter((element) => element !== note)
		.map((element) => {
			const rect = element.getBoundingClientRect();
			if (!rect || rect.width <= 0 || rect.height <= 0) return null;
			return toPageRect(rect, page, pageRect);
		})
		.filter((rect): rect is PageRect => Boolean(rect));
}

function choosePdfNotePosition(page: HTMLElement, pageRect: DOMRect, anchorRect: PageRect, noteWidth: number, noteHeight: number, noteRects: PageRect[] = []) {
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
		[rightOfAnchor, belowAnchor],
		[alignedWithAnchor, belowAnchor],
		[rightOfAnchor, aboveAnchor],
		[alignedWithAnchor, aboveAnchor],
		[leftOfAnchor, belowAnchor],
		[leftOfAnchor, aboveAnchor],
		[rightOfAnchor, alignedTop],
		[leftOfAnchor, alignedTop],
		[rightEdge, alignedTop],
		[leftEdge, alignedTop],
		[rightEdge, belowAnchor],
		[rightEdge, aboveAnchor],
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
		const score = scorePdfNoteCandidate(candidate, textRects, anchorRect, noteRects);
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
	setImportantStyles(note, {
		position: "absolute",
		"max-width": `${maxWidth}px`,
		"min-width": "220px",
		"min-height": "76px",
		"box-sizing": "border-box",
		padding: "12px 14px",
		background: "#e6dbd1",
		color: "#575279",
		border: "1px solid #cac1b9",
		"border-left": "3px solid #286983",
		"border-radius": "0 4px 4px 0",
		"box-shadow": "0 1px 3px rgba(47, 44, 40, 0.16)",
		font: '15px/1.55 "New York", "Iowan Old Style", Charter, Georgia, serif',
		"pointer-events": "auto",
		// Cards sit above highlights (z-index 1) in the shared layer.
		"z-index": "4",
		"scroll-margin-top": "22vh",
		"scroll-margin-bottom": "22vh",
	});
	const measuredRect = note.getBoundingClientRect();
	const measuredHeight = measuredRect.height || note.offsetHeight || 0;
	const noteHeight = wasCollapsed ? 30 : Math.max(76, Math.min(240, measuredHeight || 96));
	// Score candidates with the note's rendered width, not the CSS
	// max-width cap — overestimating width inflates overlap penalties and
	// pushes notes away from their highlight.
	const noteWidth = Math.max(220, Math.min(maxWidth, measuredRect.width || maxWidth));
	const otherNoteRects = collectOtherPdfNoteRects(note, page, pageRect);
	const positioned = choosePdfNotePosition(page, pageRect, toPageRect(annotationRect, page, pageRect), noteWidth, noteHeight, otherNoteRects);
	if (positioned) {
		setImportantStyle(note, "left", `${positioned.left}px`);
		setImportantStyle(note, "top", `${positioned.top}px`);
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
	makePdfHighlightPassive(annotation);
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
	note.setAttribute("data-onhand-theme", PDF_VIEWER_ANNOTATION_THEME);
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
		await waitForNextFrame();
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
	await waitForNextFrame();
	updatePageFromScroll();
	return buildAnnotationResult(annotation);
}

function pdfClearAnnotations() {
	const highlights = Array.from(document.querySelectorAll("[data-onhand-highlight-kind='pdf']"));
	const notes = Array.from(document.querySelectorAll("[data-onhand-note-kind='card']"));
	for (const element of [...highlights, ...notes]) element.remove();
	return { clearedPdf: highlights.length, clearedNotes: notes.length, cleared: highlights.length + notes.length };
}

function pdfRemoveAnnotations(annotationIds: unknown) {
	const ids = Array.from(
		new Set(
			(Array.isArray(annotationIds) ? annotationIds : [annotationIds])
				.map((id) => String(id || "").trim())
				.filter(Boolean),
		),
	);
	let removedCount = 0;
	for (const annotationId of ids) {
		const elements = Array.from(document.querySelectorAll<HTMLElement>(`[data-onhand-annotation-id="${CSS.escape(annotationId)}"]`));
		if (!elements.length) continue;
		for (const element of elements) element.remove();
		removeNotesForAnnotation(annotationId);
		removedCount += 1;
	}
	if (!removedCount) throw new Error(`No annotation found with id: ${ids.join(", ") || "(blank)"}`);
	return { removedCount, requestedCount: ids.length };
}

function capturePdfAnnotationSnapshots(): PdfAnnotationSnapshot[] {
	return Array.from(document.querySelectorAll<HTMLElement>("[data-onhand-highlight-kind='pdf']"))
		.map((annotation) => {
			const annotationId = annotation.getAttribute("data-onhand-annotation-id") || "";
			const pdfAnchor = parsePdfAnchor(annotation);
			const note = annotationId ? findNoteForAnnotation(annotationId) : null;
			const body = note?.querySelector<HTMLElement>("[data-onhand-note-part='body']");
			const label = note?.querySelector<HTMLElement>("[data-onhand-note-part='label']");
			const text = pdfAnchorText(pdfAnchor, annotation.getAttribute("data-onhand-matched-text") || "");
			return {
				annotationId,
				text,
				occurrence: Math.max(1, Math.min(100, Number(pdfAnchor?.occurrence || 1) || 1)),
				pdfAnchor,
				note:
					note && body
						? {
								text: normalizeText(body.getAttribute("data-onhand-note-source") || body.textContent || ""),
								label: normalizeText(label?.textContent || "") || "Onhand",
								collapsed: note.getAttribute("data-onhand-note-collapsed") === "true",
							}
						: null,
			};
		})
		.filter((snapshot) => Boolean(snapshot.text));
}

function capturePdfViewSnapshot(): PdfViewSnapshot {
	const page = findViewportPage() || getPdfPageByNumber(Number(pageInput.value || 1));
	const pageNumber = getPageNumber(page) || Number(pageInput.value || 1) || 1;
	let pageOffsetRatio = 0;
	if (page) {
		const rect = page.getBoundingClientRect();
		const pageTop = window.scrollY + rect.top;
		pageOffsetRatio = Math.max(0, Math.min(1, (window.scrollY - pageTop) / Math.max(1, rect.height)));
	}
	return {
		pageNumber,
		pageOffsetRatio,
		annotations: capturePdfAnnotationSnapshots(),
	};
}

async function restorePdfAnnotationSnapshots(annotations: PdfAnnotationSnapshot[], sequence: number) {
	for (const snapshot of annotations) {
		if (sequence !== renderSequence) return;
		try {
			const highlighted = await pdfHighlightText(snapshot.text, {
				pdfAnchor: snapshot.pdfAnchor,
				occurrence: snapshot.occurrence,
				scrollIntoView: false,
				reuseExisting: true,
			});
			if (sequence !== renderSequence) return;
			if (snapshot.note?.text && highlighted.annotationId) {
				await pdfShowNote(highlighted.annotationId, snapshot.note.text, {
					label: snapshot.note.label || "Onhand",
					scrollIntoView: false,
				});
				const restoredNote = findNoteForAnnotation(highlighted.annotationId);
				if (restoredNote && snapshot.note.collapsed) setPdfNoteCollapsed(restoredNote, true);
			}
		} catch {}
	}
}

async function rebuildPdfAnnotationLayers(annotations: PdfAnnotationSnapshot[], sequence: number) {
	if (!annotations.length) return;
	for (const layer of Array.from(document.querySelectorAll(".onhand-pdf-annotation-layer"))) layer.remove();
	await restorePdfAnnotationSnapshots(annotations, sequence);
}

async function restorePdfViewSnapshot(snapshot: PdfViewSnapshot | null, sequence: number) {
	if (!snapshot) {
		updatePageFromScroll();
		return;
	}
	await restorePdfAnnotationSnapshots(snapshot.annotations, sequence);
	if (sequence !== renderSequence) return;
	const page = getPdfPageByNumber(snapshot.pageNumber);
	if (page) {
		const rect = page.getBoundingClientRect();
		const pageTop = window.scrollY + rect.top;
		window.scrollTo({ top: Math.max(0, pageTop + rect.height * snapshot.pageOffsetRatio), left: 0, behavior: "auto" });
		setCurrentPageNumber(snapshot.pageNumber);
		await waitForNextFrame();
	}
	updatePageFromScroll();
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
		const text = pdfPageText(page);
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
	const text = blocks
		.map((block) => (block.pageNumber ? `[p. ${block.pageNumber}] ${block.text}` : block.text))
		.join("\n\n")
		.slice(0, maxChars);
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

// textContent glues the text layer's line fragments together ("FixtureThe
// important phrase…") because PDF.js marks line ends with <br> elements
// that contribute no text. Convert them to whitespace before reading.
function textLayerVisibleText(textLayer: HTMLElement | null) {
	if (!textLayer) return "";
	const clone = textLayer.cloneNode(true) as HTMLElement;
	clone.querySelectorAll("br").forEach((lineBreak) => lineBreak.replaceWith("\n"));
	return normalizeText(clone.textContent || "");
}

function pdfPageText(page: HTMLElement | null) {
	if (!page) return "";
	const textLayer = page.querySelector<HTMLElement>(".textLayer");
	if (textLayer) return textLayerVisibleText(textLayer);
	return normalizeText(page.textContent || "");
}

function buildPdfAnchor(page: HTMLElement, match: { range: Range; matchedText: string; fallback?: string; context?: { prefix?: string; suffix?: string } }, occurrence = 1) {
	const rects = rangeRectsForPage(match.range, page);
	return {
		surface: "pdf",
		viewer: "onhand-pdf-viewer",
		document: { url: sourceUrl, title: document.title },
		pageNumber: getPageNumber(page),
		matchedText: match.matchedText,
		textQuote: {
			exact: match.matchedText,
			...(match.context?.prefix ? { prefix: match.context.prefix } : {}),
			...(match.context?.suffix ? { suffix: match.context.suffix } : {}),
		},
		rects,
		occurrence,
		fallback: match.fallback,
	};
}

function getPdfPageForNode(node: Node | null | undefined) {
	const element = node instanceof Element ? node : node?.parentElement || null;
	return element?.closest?.(".page[data-page-number]") as HTMLElement | null;
}

function rectIntersectionArea(a: DOMRect | ClientRect, b: DOMRect | ClientRect) {
	const left = Math.max(a.left, b.left);
	const right = Math.min(a.right, b.right);
	const top = Math.max(a.top, b.top);
	const bottom = Math.min(a.bottom, b.bottom);
	return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function rangeIntersectsPage(range: Range, page: HTMLElement) {
	const textLayer = page.querySelector<HTMLElement>(".textLayer, [data-onhand-pdf-text-layer]") || page;
	try {
		if (typeof range.intersectsNode === "function" && range.intersectsNode(textLayer)) return true;
	} catch {}
	const rangeRects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
	if (!rangeRects.length) return false;
	const pageRect = page.getBoundingClientRect();
	return rangeRects.some((rect) => rectIntersectionArea(rect, pageRect) > 0);
}

function buildTextQuoteForSelection(page: HTMLElement, matchedText: string) {
	const textQuote: { exact: string; prefix?: string; suffix?: string } = { exact: matchedText };
	const pageText = pdfPageText(page);
	const lowerPageText = pageText.toLowerCase();
	const lowerMatchedText = matchedText.toLowerCase();
	const index = lowerMatchedText ? lowerPageText.indexOf(lowerMatchedText) : -1;
	if (index > 0) textQuote.prefix = pageText.slice(Math.max(0, index - ANCHOR_CONTEXT_LENGTH), index).trim();
	if (index >= 0) textQuote.suffix = pageText.slice(index + matchedText.length, index + matchedText.length + ANCHOR_CONTEXT_LENGTH).trim();
	return textQuote;
}

function buildPdfAnchorForSelection(range: Range, matchedText: string) {
	const startPage = getPdfPageForNode(range.startContainer);
	const endPage = getPdfPageForNode(range.endContainer);
	const commonPage = getPdfPageForNode(range.commonAncestorContainer);
	const entries = getPdfPages()
		.filter((page) => page === startPage || page === endPage || page === commonPage || rangeIntersectsPage(range, page))
		.map((page) => {
			const pageNumber = getPageNumber(page);
			const rects = rangeRectsForPage(range, page).filter((rect) => rect.width > 0 && rect.height > 0);
			return pageNumber && rects.length ? { page, pageNumber, rects } : null;
		})
		.filter(Boolean) as Array<{ page: HTMLElement; pageNumber: number; rects: PdfRect[] }>;
	if (!entries.length) return null;

	const primary = entries[0];
	const rects = entries.flatMap((entry) => entry.rects.map((rect) => ({ ...rect, pageNumber: entry.pageNumber })));
	return {
		surface: "pdf",
		viewer: "onhand-pdf-viewer",
		document: { url: sourceUrl, title: document.title },
		pageNumber: primary.pageNumber,
		matchedText,
		textQuote: buildTextQuoteForSelection(primary.page, matchedText),
		rects,
		occurrence: 1,
	};
}

function pdfGetSelectionInfo() {
	const selection = window.getSelection();
	const base = {
		surface: "pdf",
		viewer: "onhand-pdf-viewer",
		source: "onhand-pdf-viewer",
		url: sourceUrl,
		title: document.title,
		scrollX: window.scrollX,
		scrollY: window.scrollY,
		viewport: { width: window.innerWidth, height: window.innerHeight },
	};
	if (!selection || selection.rangeCount === 0) {
		return {
			...base,
			hasSelection: false,
			isCollapsed: true,
			text: "",
			rangeCount: 0,
			rect: null,
			container: null,
		};
	}

	const range = selection.getRangeAt(0);
	const text = normalizeText(selection.toString());
	let rect: DOMRect | null = null;
	try {
		rect = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
	} catch {
		rect = null;
	}
	if (!text) {
		return {
			...base,
			hasSelection: false,
			isCollapsed: selection.isCollapsed,
			text: "",
			rangeCount: selection.rangeCount,
			rect: rect && (rect.width || rect.height) ? rectToObject(rect) : null,
			container: null,
		};
	}

	const pdfAnchor = buildPdfAnchorForSelection(range, text);
	const pageNumber = pdfAnchor?.pageNumber || getPageNumber(getPdfPageForNode(range.startContainer));
	return {
		...base,
		hasSelection: true,
		isCollapsed: selection.isCollapsed,
		text,
		rangeCount: selection.rangeCount,
		rect: rect && (rect.width || rect.height) ? rectToObject(rect) : null,
		container: pageNumber
			? {
					tag: "pdf-page",
					selector: `.page[data-page-number="${pageNumber}"]`,
					text: `Page ${pageNumber}`,
					pageNumber,
				}
			: null,
		pageNumber: pageNumber || null,
		...(pdfAnchor ? { pdfAnchor } : {}),
	};
}

function snippetForMatch(pageText: string, matchedText: string, maxContextChars: number, matchIndex: number | null = null) {
	const text = normalizeText(pageText);
	const match = normalizeText(matchedText);
	if (!text) return { before: "", text: match, after: "", snippet: match };
	const index = Number.isInteger(matchIndex) && Number(matchIndex) >= 0 ? Number(matchIndex) : match ? text.toLowerCase().indexOf(match.toLowerCase()) : -1;
	if (index === -1) {
		const snippet = text.slice(0, Math.max(0, maxContextChars * 2));
		return { before: "", text: match, after: snippet, snippet };
	}
	const before = text.slice(Math.max(0, index - maxContextChars), index);
	const after = text.slice(index + match.length, index + match.length + maxContextChars);
	return {
		before,
		text: text.slice(index, index + match.length),
		after,
		snippet: normalizeText(`${before} ${text.slice(index, index + match.length)} ${after}`),
	};
}

function parsePdfPageNumbers(options: Record<string, any> = {}) {
	const pageCount = Number(pdfDocument?.numPages || getPdfPages().length || 0);
	const clamp = (value: number) => Math.max(1, Math.min(pageCount || 1, Math.floor(value)));
	const values: number[] = [];
	const rawPages = options.pages;
	if (Array.isArray(rawPages)) {
		for (const value of rawPages) {
			const pageNumber = Number(value);
			if (Number.isFinite(pageNumber) && pageNumber > 0) values.push(clamp(pageNumber));
		}
	} else if (typeof rawPages === "string") {
		for (const part of rawPages.split(/[\s,]+/)) {
			const pageNumber = Number(part);
			if (Number.isFinite(pageNumber) && pageNumber > 0) values.push(clamp(pageNumber));
		}
	}
	if (!values.length) {
		const singlePage = Number(options.pageNumber || options.page || options.pdfAnchor?.pageNumber || "");
		if (Number.isFinite(singlePage) && singlePage > 0) values.push(clamp(singlePage));
	}
	if (!values.length) {
		const startPage = Number(options.startPage || options.start || pageInput.value || 1);
		const endPage = Number(options.endPage || options.end || startPage);
		if (Number.isFinite(startPage) && Number.isFinite(endPage) && startPage > 0 && endPage > 0) {
			const start = clamp(Math.min(startPage, endPage));
			const end = clamp(Math.max(startPage, endPage));
			for (let pageNumber = start; pageNumber <= end; pageNumber += 1) values.push(pageNumber);
		}
	}
	return [...new Set(values)].sort((a, b) => a - b);
}

let cachedPdfTextLayerInfo: { extractableChars: number; checkedPages: number; likelyScanned: boolean } | null = null;

// Distinguish "no matches" from "nothing searchable": a scanned/image-only
// PDF has no text layer at all, and reporting a plain miss misleads the model
// into thinking the terms are absent rather than the document unreadable.
async function describePdfTextLayer() {
	if (cachedPdfTextLayerInfo) return cachedPdfTextLayerInfo;
	const pageCount = Number(pdfDocument?.numPages || 0);
	const maxPages = Math.min(pageCount, 30);
	let extractableChars = 0;
	let checkedPages = 0;
	for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
		try {
			extractableChars += normalizeText(await getPageTextContent(pageNumber)).length;
		} catch {}
		checkedPages += 1;
		if (extractableChars >= 400) break;
	}
	const info = { extractableChars, checkedPages, likelyScanned: extractableChars < 40 };
	cachedPdfTextLayerInfo = info;
	return info;
}

async function pdfSearch(options: Record<string, any> = {}) {
	const query = String(options.query || options.text || "").trim();
	if (!query) throw new Error("PDF search requires a non-empty query.");
	const maxMatches = Math.max(1, Math.min(50, Number(options.maxMatches || options.limit || 8) || 8));
	const maxContextChars = Math.max(40, Math.min(1000, Number(options.maxContextChars || 220) || 220));
	const pages = getPdfPages();
	const totalPageCount = Math.max(Number(pdfDocument?.numPages || 0), pages.length);
	const normalizedQuery = normalizeText(query).toLowerCase();
	const matches: any[] = [];
	const searchedPageNumbers: number[] = [];
	const failedPageNumbers: number[] = [];
	const matchedPageNumbers = new Set<number>();
	let totalMatchCount = 0;
	for (const page of pages) {
		const pageNumber = getPageNumber(page);
		if (!pageNumber) continue;
		const textLayer = page.querySelector<HTMLElement>(".textLayer");
		let pageText = "";
		try {
			// Rendered pages already have normalized text in the DOM. Pending or
			// otherwise unrendered pages use PDF.js text content, so every page is
			// searched even after the returned-snippet limit is reached.
			pageText = textLayer ? pdfPageText(page) : await getPageTextContent(pageNumber);
			searchedPageNumbers.push(pageNumber);
		} catch {
			failedPageNumbers.push(pageNumber);
			continue;
		}
		const lowerText = pageText.toLowerCase();
		let fromIndex = 0;
		for (let occurrence = 1; ; occurrence += 1) {
			const index = normalizedQuery ? lowerText.indexOf(normalizedQuery, fromIndex) : -1;
			if (index === -1) break;
			fromIndex = index + Math.max(1, normalizedQuery.length);
			totalMatchCount += 1;
			matchedPageNumbers.add(pageNumber);
			if (matches.length >= maxMatches) continue;
			const matchedText = pageText.slice(index, index + normalizedQuery.length);
			const mappedMatch = textLayer ? findMappedTextRange(textLayer, query, occurrence) : null;
			const anchoredText = mappedMatch?.matchedText || matchedText;
			const snippet = snippetForMatch(pageText, anchoredText, maxContextChars, index);
			const pendingRender = !textLayer;
			const pdfAnchor = mappedMatch
				? buildPdfAnchor(page, mappedMatch, occurrence)
				: {
					surface: "pdf",
					viewer: "onhand-pdf-viewer",
					document: { url: sourceUrl, title: document.title },
					pageNumber,
					matchedText: anchoredText,
					textQuote: { exact: anchoredText },
					occurrence,
				};
			matches.push({
				pageNumber,
				occurrence,
				matchedText: anchoredText,
				before: snippet.before,
				after: snippet.after,
				snippet: snippet.snippet,
				visible: textLayer ? visibleEnough(page.getBoundingClientRect()) : false,
				...(pendingRender ? { pendingRender: true } : {}),
				pdfAnchor,
			});
		}
	}
	const searchedAllPages = totalPageCount > 0 && searchedPageNumbers.length === totalPageCount && failedPageNumbers.length === 0;
	const truncated = totalMatchCount > matches.length;
	const textLayer = totalMatchCount === 0 ? await describePdfTextLayer() : null;
	return {
		surface: "pdf",
		viewer: "onhand-pdf-viewer",
		url: sourceUrl,
		title: document.title,
		query,
		matchCount: totalMatchCount,
		totalMatchCount,
		returnedMatchCount: matches.length,
		truncated,
		coverage: {
			searchKind: "exact-text",
			searchedPageCount: searchedPageNumbers.length,
			totalPageCount,
			searchedAllPages,
			searchedPageNumbers,
			failedPageNumbers,
			matchedPageNumbers: [...matchedPageNumbers].sort((left, right) => left - right),
		},
		matches,
		...(textLayer ? { textLayer } : {}),
	};
}

async function pdfReadPages(options: Record<string, any> = {}) {
	const maxChars = Math.max(500, Math.min(50000, Number(options.maxChars || 12000) || 12000));
	const pageNumbers = parsePdfPageNumbers(options).slice(0, Math.max(1, Math.min(30, Number(options.maxPages || 12) || 12)));
	const blocks: any[] = [];
	let usedChars = 0;
	for (const pageNumber of pageNumbers) {
		const page = getPdfPageByNumber(pageNumber);
		if (!page) continue;
		const text = isPendingPage(page) ? await getPageTextContent(pageNumber) : pdfPageText(page);
		if (!text) continue;
		const remaining = maxChars - usedChars;
		if (remaining <= 0) break;
		const clipped = text.length > remaining ? `${text.slice(0, Math.max(0, remaining - 3))}...` : text;
		usedChars += clipped.length + 2;
		blocks.push({
			tag: "pdf-page",
			pageNumber,
			selector: `.page[data-page-number="${pageNumber}"]`,
			text: clipped,
			rect: rectToObject(page.getBoundingClientRect()),
		});
	}
	return {
		surface: "pdf",
		viewer: "onhand-pdf-viewer",
		url: sourceUrl,
		title: document.title,
		pageNumbers,
		blockCount: blocks.length,
		charCount: blocks.reduce((total, block) => total + String(block.text || "").length, 0),
		truncated: usedChars >= maxChars,
		blocks,
		text: blocks.map((block) => `[p. ${block.pageNumber}] ${block.text}`).join("\n\n").slice(0, maxChars),
	};
}

// --- Citation lookup ---
//
// Deterministically locate a bibliography entry so the agent can chase a
// citation without freestyle-searching: find the references section in
// the page text (rendered or not), slice out the entry for a bracket
// label like [14], and extract identifiers that resolve to an openable
// URL (arXiv id, DOI, or a plain link).
function isPrivateIpv4Address(hostname: string) {
	const octets = hostname.split(".");
	if (octets.length !== 4) return false;
	const numbers = octets.map((part) => Number(part));
	if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
	const [first, second, third] = numbers;
	return (
		first === 0 ||
		first === 10 ||
		first === 127 ||
		(first === 100 && second >= 64 && second <= 127) ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168) ||
		(first === 192 && second === 0) ||
		(first === 192 && second === 0 && third === 2) ||
		(first === 198 && (second === 18 || second === 19)) ||
		(first === 198 && second === 51 && third === 100) ||
		(first === 203 && second === 0 && third === 113) ||
		first >= 224
	);
}

const PUBLIC_CITATION_TLDS = new Set(["com", "org", "net", "edu", "gov", "mil", "int", "io", "ai", "dev", "app", "info", "science", "technology"]);

function hasPublicCitationTld(hostname: string) {
	const tld = hostname.split(".").pop() || "";
	return /^[a-z]{2}$/.test(tld) || PUBLIC_CITATION_TLDS.has(tld);
}

function isSafeCitationUrl(rawUrl: string) {
	try {
		const parsed = new URL(String(rawUrl || "").trim());
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
		const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
		if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) return false;
		if (hostname.includes(":")) return false;
		const isIpv4 = /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
		if (isIpv4) return !isPrivateIpv4Address(hostname);
		if (!hostname.includes(".") || /\.(local|lan|home|internal|intranet|corp|test|invalid|example|onion)$/i.test(hostname)) return false;
		if (!hasPublicCitationTld(hostname)) return false;
		return true;
	} catch {
		return false;
	}
}

function extractCitationIdentifiers(entryText: string) {
	const text = String(entryText || "");
	// Covers "arXiv:1409.0473", "arxiv.org/abs/1409.0473", and the CoRR
	// style "abs/1409.0473".
	const arxivId =
		text.match(/arxiv[:\s]*(\d{4}\.\d{4,5})(v\d+)?/i)?.[1] ||
		text.match(/\babs\/(\d{4}\.\d{4,5})/i)?.[1] ||
		text.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i)?.[1] ||
		"";
	const doi = text.match(/\b10\.\d{4,9}\/[^\s,;)\]]+/)?.[0]?.replace(/[.,;]+$/, "") || "";
	const rawUrl = text.match(/https?:\/\/[^\s)\]]+/)?.[0]?.replace(/[.,;]+$/, "") || "";
	const url = rawUrl && isSafeCitationUrl(rawUrl) ? rawUrl : "";
	const suggestedUrl = arxivId ? `https://arxiv.org/pdf/${arxivId}` : url || (doi ? `https://doi.org/${doi}` : "");
	return {
		...(arxivId ? { arxivId } : {}),
		...(doi ? { doi } : {}),
		...(url ? { url } : {}),
		...(suggestedUrl ? { suggestedUrl } : {}),
	};
}

async function pdfFindCitation(options: Record<string, any> = {}) {
	const rawReference = String(options.reference ?? options.label ?? options.query ?? "").trim();
	if (!rawReference) throw new Error('findCitation requires a reference, like "14" or "[14]".');
	const pageCount = Number(pdfDocument?.numPages || 0);
	if (!pageCount) throw new Error("No PDF document is loaded.");
	const bracketNumber = rawReference.match(/^\[?(\d{1,3})\]?$/)?.[1] || "";

	// Find where the references section starts; bibliographies live at the
	// back, so scan from the end.
	let referencesStartPage = 0;
	for (let pageNumber = pageCount; pageNumber >= 1; pageNumber -= 1) {
		const text = await getPageTextContent(pageNumber);
		if (/\b(references|bibliography)\b/i.test(text)) {
			referencesStartPage = pageNumber;
			break;
		}
	}

	const searchStartPage = referencesStartPage || 1;
	let entryText = "";
	let entryPageNumber = 0;
	if (bracketNumber) {
		const entryPattern = new RegExp(`\\[${bracketNumber}\\]\\s`);
		const nextEntryPattern = /\[\d{1,3}\]\s/g;
		for (let pageNumber = searchStartPage; pageNumber <= pageCount; pageNumber += 1) {
			const text = await getPageTextContent(pageNumber);
			const match = entryPattern.exec(text);
			if (!match) continue;
			const start = match.index;
			nextEntryPattern.lastIndex = start + match[0].length;
			const next = nextEntryPattern.exec(text);
			entryText = normalizeText(text.slice(start, next ? next.index : start + 600)).slice(0, 600);
			entryPageNumber = pageNumber;
			break;
		}
	} else {
		const needle = normalizeText(rawReference).toLowerCase();
		for (let pageNumber = searchStartPage; pageNumber <= pageCount; pageNumber += 1) {
			const text = await getPageTextContent(pageNumber);
			const index = text.toLowerCase().indexOf(needle);
			if (index === -1) continue;
			entryText = normalizeText(text.slice(index, index + 600)).slice(0, 600);
			entryPageNumber = pageNumber;
			break;
		}
	}

	if (!entryText) {
		return {
			surface: "pdf",
			viewer: "onhand-pdf-viewer",
			url: sourceUrl,
			found: false,
			reference: rawReference,
			referencesStartPage: referencesStartPage || null,
			message: referencesStartPage
				? `No bibliography entry matched "${rawReference}" from page ${referencesStartPage} onward.`
				: `No references section was found, and nothing matched "${rawReference}".`,
		};
	}

	// An exact prefix of the entry anchors a highlight on that page once
	// it renders (highlights render pending pages on demand).
	const anchorQuote = entryText.slice(0, 110);
	return {
		surface: "pdf",
		viewer: "onhand-pdf-viewer",
		url: sourceUrl,
		found: true,
		reference: rawReference,
		pageNumber: entryPageNumber,
		referencesStartPage: referencesStartPage || null,
		entryText,
		identifiers: extractCitationIdentifiers(entryText),
		highlightAnchor: {
			surface: "pdf",
			viewer: "onhand-pdf-viewer",
			document: { url: sourceUrl, title: document.title },
			pageNumber: entryPageNumber,
			matchedText: anchorQuote,
			textQuote: { exact: anchorQuote },
			occurrence: 1,
		},
	};
}

async function pdfJumpToPage(options: Record<string, any> = {}) {
	const anchor = options.pdfAnchor || null;
	const pageNumber = Number(options.pageNumber || options.page || anchor?.pageNumber || "");
	if (!Number.isFinite(pageNumber) || pageNumber < 1) throw new Error("PDF jump requires a valid pageNumber.");
	const page = getPdfPageByNumber(pageNumber);
	if (!page) throw new Error(`PDF page not found: ${pageNumber}`);
	await ensurePageRendered(pageNumber);
	scrollToPage(pageNumber);
	await waitForNextFrame();
	const text = String(options.text || anchor?.matchedText || anchor?.textQuote?.exact || "").trim();
	let matchAnchor = null;
	if (text) {
		const textLayer = page.querySelector<HTMLElement>(".textLayer");
		const occurrence = Math.max(1, Math.min(100, Number(options.occurrence || anchor?.occurrence || 1) || 1));
		const match = textLayer ? findMappedTextRange(textLayer, text, occurrence, anchor?.textQuote) : null;
		if (match) {
			match.range.startContainer.parentElement?.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
			await waitForNextFrame();
			matchAnchor = buildPdfAnchor(page, match, occurrence);
		}
	}
	updatePageFromScroll();
	return {
		surface: "pdf",
		viewer: "onhand-pdf-viewer",
		url: sourceUrl,
		title: document.title,
		pageNumber,
		text: text || "",
		pdfAnchor: matchAnchor || anchor || null,
		viewport: { width: window.innerWidth, height: window.innerHeight, scrollY: window.scrollY },
	};
}

async function pdfCapturePageImage(options: Record<string, any> = {}) {
	const pageNumber = Number(options.pageNumber || options.page || pageInput.value || 1);
	if (!Number.isFinite(pageNumber) || pageNumber < 1) throw new Error("PDF page image capture requires a valid pageNumber.");
	const page = getPdfPageByNumber(pageNumber);
	if (!page) throw new Error(`PDF page not found: ${pageNumber}`);
	commitTransientZoom();
	await ensurePageRendered(pageNumber, renderSequence, { sharpen: true });
	const canvas = page.querySelector<HTMLCanvasElement>("canvas");
	if (!canvas) throw new Error(`PDF page ${pageNumber} has no rendered canvas.`);
	const format = String(options.format || "png").toLowerCase() === "jpeg" ? "jpeg" : "png";
	const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
	const quality = Math.max(0.1, Math.min(1, Number(options.quality || 0.92) || 0.92));
	scrollToPage(pageNumber);
	await waitForNextFrame();
	const dataUrl = format === "jpeg" ? canvas.toDataURL(mimeType, quality) : canvas.toDataURL(mimeType);
	return {
		surface: "pdf",
		viewer: "onhand-pdf-viewer",
		url: sourceUrl,
		title: document.title,
		pageNumber,
		mimeType,
		dataUrl,
		data: dataUrl.includes(",") ? dataUrl.split(",")[1] : "",
		width: canvas.width,
		height: canvas.height,
		cssWidth: Number(canvas.style.width?.replace("px", "")) || page.clientWidth,
		cssHeight: Number(canvas.style.height?.replace("px", "")) || page.clientHeight,
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
		case "searchPdf":
			return pdfSearch(args[0] || {});
		case "findCitation":
			return await pdfFindCitation(args[0] || {});
		case "readPdfPages":
			return pdfReadPages(args[0] || {});
		case "jumpToPdfPage":
			return await pdfJumpToPage(args[0] || {});
		case "capturePdfPageImage":
			return await pdfCapturePageImage(args[0] || {});
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
		case "removeAnnotations":
			return pdfRemoveAnnotations(args[0] || []);
		case "getSelectionInfo":
			return pdfGetSelectionInfo();
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
			pageNumber: Number.parseInt(pageInput?.value || "1", 10) || 1,
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
		const commandSourceUrl = String(data?.sourceUrl || "");
		if (!sourceUrl || commandSourceUrl !== sourceUrl) {
			throw new Error("Unauthorized Onhand PDF viewer bridge command.");
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
	if (data?.type === "onhand-pdf-viewer-bridge-init") return;
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
		// file: is allowed so the viewer can open local PDFs (requires the user's
		// "Allow access to file URLs" grant; loadPdfDocumentFromUrl reads the bytes).
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "file:") return "";
		return parsed.href;
	} catch {
		return "";
	}
}

function isHttpsUrl(value: string) {
	try {
		return new URL(String(value || "")).protocol === "https:";
	} catch {
		return false;
	}
}

async function getPdfDocumentWithTimeout(options: Record<string, any>, timeoutMs: number) {
	const loadingTask = getDocument(options);
	let timeoutId: number | null = null;
	try {
		return await Promise.race([
			loadingTask.promise,
			new Promise((_, reject) => {
				timeoutId = window.setTimeout(() => reject(new Error("Timed out loading the PDF.")), timeoutMs);
			}),
		]);
	} catch (error) {
		try {
			await loadingTask.destroy();
		} catch {}
		throw error;
	} finally {
		if (timeoutId !== null) window.clearTimeout(timeoutId);
	}
}

async function loadLocalFilePdfBytes(value: string): Promise<ArrayBuffer> {
	// XHR is the reliable transport for file:// from an extension page once the
	// user grants "Allow access to file URLs"; successful file reads report status 0.
	return await new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("GET", value, true);
		xhr.responseType = "arraybuffer";
		xhr.onload = () => {
			if (xhr.response && (xhr.status === 200 || xhr.status === 0)) resolve(xhr.response as ArrayBuffer);
			else reject(new Error(`Could not read the local PDF (status ${xhr.status}).`));
		};
		xhr.onerror = () => reject(new Error("Could not read the local PDF file."));
		xhr.send();
	});
}

function decodeBase64PdfBytes(value: string) {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

async function loadPdfDocumentFromUrl(value: string) {
	const baseOptions = {
		url: value,
		cMapUrl: extensionUrl("vendor/cmaps/"),
		cMapPacked: true,
		standardFontDataUrl: extensionUrl("vendor/standard_fonts/"),
	};
	if (value.startsWith("file:")) {
		// pdf-viewer.html is web-accessible, so any site can open it with a
		// url=file:/// parameter. Only read local bytes when this launch was
		// granted by the background (handoff or session restore) — otherwise a
		// hostile page could render an arbitrary local file under Onhand's
		// file permission.
		let authorized = false;
		try {
			const auth = await chrome.runtime.sendMessage({ type: "pdf-viewer:authorize-file-source", url: value });
			authorized = Boolean((auth as any)?.ok);
		} catch {}
		if (!authorized) {
			throw new Error(
				"For security, Onhand only opens local PDFs it handed off itself. Open the file in a browser tab and ask Onhand from there, or reopen it from your Onhand session.",
			);
		}
		try {
			const data = await loadLocalFilePdfBytes(value);
			const { url: _url, ...optionsWithoutUrl } = baseOptions;
			return await getPdfDocumentWithTimeout({ ...optionsWithoutUrl, data }, PDF_LOAD_TIMEOUT_MS);
		} catch (error: any) {
			throw new Error(
				`Could not open this local PDF. If Onhand does not have file access, open chrome://extensions, find Onhand, enable "Allow access to file URLs", then retry. (${error?.message || String(error)})`,
			);
		}
	}
	try {
		return await getPdfDocumentWithTimeout(baseOptions, PDF_LOAD_TIMEOUT_MS);
	} catch (initialError) {
		if (!isHttpsUrl(value)) throw initialError;
		let authorized = false;
		try {
			const auth = await chrome.runtime.sendMessage({ type: "pdf-viewer:authorize-credentialed-source", url: value });
			authorized = Boolean((auth as any)?.ok);
		} catch {}
		if (!authorized) throw initialError;
		setStatus("Retrying with browser credentials...");
		try {
			return await getPdfDocumentWithTimeout(
				{ ...baseOptions, withCredentials: true },
				CREDENTIALED_PDF_LOAD_RETRY_TIMEOUT_MS,
			);
		} catch (credentialError: any) {
			setStatus("Retrying through the authenticated browser tab...");
			let browserLoad: any = null;
			try {
				browserLoad = await chrome.runtime.sendMessage({ type: "pdf-viewer:load-authorized-source", url: value });
			} catch {}
			if (!browserLoad?.ok || !browserLoad?.dataBase64) {
				throw new Error(
					browserLoad?.error || credentialError?.message || initialError?.message || "Could not load the protected PDF.",
				);
			}
			const data = decodeBase64PdfBytes(String(browserLoad.dataBase64));
			const { url: _url, ...optionsWithoutUrl } = baseOptions;
			return await getPdfDocumentWithTimeout({ ...optionsWithoutUrl, data }, PDF_LOAD_TIMEOUT_MS);
		}
	}
}

function normalizeViewerPageNumber(value: any, maxPage = Number.MAX_SAFE_INTEGER) {
	const match = String(value ?? "").match(/\d+/);
	if (!match) return null;
	const parsed = Number.parseInt(match[0], 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return null;
	const upperBound = Number.isFinite(maxPage) && maxPage > 0 ? Math.floor(maxPage) : Number.MAX_SAFE_INTEGER;
	return Math.max(1, Math.min(upperBound, parsed));
}

function normalizeViewerScrollRatio(value: any) {
	const parsed = Number.parseFloat(String(value ?? ""));
	if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) return null;
	return Math.max(0, Math.min(1, parsed));
}

function parseInitialPageNumber(maxPage = Number.MAX_SAFE_INTEGER) {
	const params = new URLSearchParams(location.search);
	for (const key of ["page", "pageNumber", "initialPage", "p"]) {
		const pageNumber = normalizeViewerPageNumber(params.get(key), maxPage);
		if (pageNumber) return pageNumber;
	}
	const hash = String(location.hash || "").replace(/^#/, "");
	if (!hash) return null;
	const hashParams = new URLSearchParams(hash.includes("=") ? hash : `page=${hash}`);
	for (const key of ["page", "pageNumber", "initialPage", "p"]) {
		const pageNumber = normalizeViewerPageNumber(hashParams.get(key), maxPage);
		if (pageNumber) return pageNumber;
	}
	return normalizeViewerPageNumber(hash.match(/\bpage[=/:-](\d+)\b/i)?.[1], maxPage);
}

function parseInitialScrollRatio() {
	const params = new URLSearchParams(location.search);
	for (const key of ["scrollRatio", "initialScrollRatio"]) {
		const scrollRatio = normalizeViewerScrollRatio(params.get(key));
		if (scrollRatio) return scrollRatio;
	}
	const hash = String(location.hash || "").replace(/^#/, "");
	if (!hash) return null;
	const hashParams = new URLSearchParams(hash.includes("=") ? hash : `scrollRatio=${hash}`);
	for (const key of ["scrollRatio", "initialScrollRatio"]) {
		const scrollRatio = normalizeViewerScrollRatio(hashParams.get(key));
		if (scrollRatio) return scrollRatio;
	}
	return normalizeViewerScrollRatio(hash.match(/\bscrollRatio[=/:-]([.\d]+)\b/i)?.[1]);
}

function pageNumberFromScrollRatio(scrollRatio: number | null, maxPage: number) {
	if (!scrollRatio || !Number.isFinite(maxPage) || maxPage <= 1) return null;
	return normalizeViewerPageNumber(Math.round(scrollRatio * (maxPage - 1)) + 1, maxPage);
}

function updateViewerPageUrl(pageNumber: number) {
	const normalized = normalizeViewerPageNumber(pageNumber, Number(pdfDocument?.numPages || 0) || Number.MAX_SAFE_INTEGER);
	if (!normalized) return;
	try {
		const nextUrl = new URL(location.href);
		if (normalized <= 1) {
			nextUrl.searchParams.delete("page");
		} else {
			nextUrl.searchParams.set("page", String(normalized));
		}
		const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
		const currentPath = `${location.pathname}${location.search}${location.hash}`;
		if (nextPath !== currentPath) history.replaceState(null, "", nextPath);
	} catch {}
}

function setCurrentPageNumber(pageNumber: any, options: { updateUrl?: boolean } = {}) {
	const normalized = normalizeViewerPageNumber(pageNumber, Number(pdfDocument?.numPages || 0) || Number.MAX_SAFE_INTEGER);
	if (!normalized) return;
	pageInput.value = String(normalized);
	if (options.updateUrl !== false) updateViewerPageUrl(normalized);
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
	const bestPage = findViewportPage();
	if (!bestPage) return;
	setCurrentPageNumber(bestPage.getAttribute("data-page-number") || "1");
}

function scrollToPage(pageNumber: number) {
	const target = document.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
	if (!target) return;
	target.scrollIntoView({ behavior: "auto", block: "start", inline: "nearest" });
	setCurrentPageNumber(pageNumber);
	// Jump targets render immediately instead of waiting for the
	// background fill to reach them.
	void ensurePageRendered(pageNumber);
}

async function renderPageContent(pageElement: HTMLElement, pageNumber: number, sequence: number) {
	const page = await pdfDocument.getPage(pageNumber);
	if (sequence !== renderSequence) return;
	const renderScale = committedScale;
	const viewport = page.getViewport({ scale: renderScale });
	pageElement.style.width = `${viewport.width}px`;
	pageElement.style.height = `${viewport.height}px`;

	const canvasWrapper = document.createElement("div");
	canvasWrapper.className = "canvasWrapper";
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d", { alpha: false });
	if (!context) throw new Error("Could not create canvas context for PDF page.");
	const outputScale = canvasOutputScale(viewport);
	canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
	canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
	canvas.style.width = `${viewport.width}px`;
	canvas.style.height = `${viewport.height}px`;
	canvasWrapper.append(canvas);

	let textLayer = pageElement.querySelector<HTMLElement>(".textLayer");
	const needsTextLayer = textLayer?.getAttribute("data-onhand-pdf-text-ready") !== "true";
	if (needsTextLayer) {
		textLayer?.remove();
		textLayer = document.createElement("div");
		textLayer.className = "textLayer";
		textLayer.setAttribute("data-onhand-pdf-text-layer", "true");
		// TextLayer needs a live container while it builds. The old canvas can
		// stay visible, so a crisp zoom pass never blanks an already-rendered page.
		pageElement.append(textLayer);
	}

	await page.render({
		canvasContext: context,
		viewport,
		transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
		// Display-intent rendering schedules every paint chunk on
		// requestAnimationFrame, which never fires while this document is
		// hidden (background tab or occluded window) — the render promise
		// stalls forever, the viewer never reports ready, and background
		// viewer opens die on the page-command budget ("Timed out waiting for
		// page command"). Print intent paints through microtasks instead;
		// rasters are equivalent for reading, and visible tabs keep the
		// cooperative display scheduling.
		intent: document.visibilityState === "hidden" ? "print" : "display",
	}).promise;
	if (sequence !== renderSequence) return;
	const oldCanvasWrapper = pageElement.querySelector<HTMLElement>(".canvasWrapper");
	if (oldCanvasWrapper) oldCanvasWrapper.replaceWith(canvasWrapper);
	else pageElement.prepend(canvasWrapper);
	pageElement.setAttribute("data-onhand-pdf-raster-scale", String(renderScale));
	pageElement.setAttribute("data-onhand-pdf-output-scale", String(outputScale));

	if (needsTextLayer) {
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
		if (sequence !== renderSequence) return;
		textLayer.setAttribute("data-onhand-pdf-text-ready", "true");
		textLayer.querySelectorAll("span").forEach((span, index) => {
			span.setAttribute("data-onhand-pdf-text-span", String(index));
		});
	}
}

// --- Progressive rendering ---
//
// Page shells for the whole document are created upfront (instant
// scrollbar and jump targets), the pages around the reading position
// render first, the viewer reports ready as soon as those land, and the
// rest fill in from a background loop that follows the user's scroll
// position. Pages render on demand when a jump, highlight, or capture
// targets them, with a PDF.js text-content fallback for searching pages
// that have no text layer yet.
const pageRenderPromises = new Map<number, Promise<void>>();
const pageTextContentCache = new Map<number, string>();

function isPendingPage(pageElement: Element | null) {
	return pageElement?.getAttribute("data-onhand-pdf-pending") === "true";
}

function pageNeedsSharperRender(pageElement: Element | null) {
	if (!pageElement?.querySelector("canvas")) return true;
	const rasterScale = Number(pageElement.getAttribute("data-onhand-pdf-raster-scale") || 0) || 0;
	return rasterScale + 0.01 < currentScale;
}

function compactPendingSearchText(value: string) {
	return String(value || "").toLowerCase().replace(/[\s ]+/g, "");
}

async function getPageTextContent(pageNumber: number) {
	const cached = pageTextContentCache.get(pageNumber);
	if (cached !== undefined) return cached;
	try {
		const page = await pdfDocument.getPage(pageNumber);
		const content = await page.getTextContent();
		// Glue items the way the rendered text layer does: fragments run
		// together within a line, and hasEOL marks the line breaks.
		const text = normalizeText(
			content.items
				.map((item: any) => `${typeof item?.str === "string" ? item.str : ""}${item?.hasEOL ? "\n" : ""}`)
				.join(""),
		);
		pageTextContentCache.set(pageNumber, text);
		return text;
	} catch {
		return "";
	}
}

async function createPageShells(sequence: number) {
	const firstPage = await pdfDocument.getPage(1);
	if (sequence !== renderSequence) return;
	const baseViewport = firstPage.getViewport({ scale: committedScale });
	for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
		const pageElement = document.createElement("section");
		pageElement.className = "page";
		pageElement.setAttribute("data-page-number", String(pageNumber));
		pageElement.setAttribute("data-onhand-pdf-page", "true");
		pageElement.setAttribute("data-onhand-pdf-pending", "true");
		pageElement.setAttribute("data-onhand-pdf-raster-scale", "0");
		pageElement.style.width = `${baseViewport.width}px`;
		pageElement.style.height = `${baseViewport.height}px`;
		viewer.append(pageElement);
	}
}

function ensurePageRendered(pageNumber: number, sequence = renderSequence, options: { sharpen?: boolean } = {}): Promise<void> {
	const pageElement = getPdfPageByNumber(pageNumber);
	const needsInitialRender = Boolean(pageElement && (isPendingPage(pageElement) || !pageElement.querySelector("canvas") || !pageElement.querySelector('[data-onhand-pdf-text-ready="true"]')));
	const needsSharperRender = Boolean(pageElement && options.sharpen && pageNeedsSharperRender(pageElement));
	if (!pageElement || (!needsInitialRender && !needsSharperRender)) return Promise.resolve();
	const existing = pageRenderPromises.get(pageNumber);
	if (existing) return existing;
	let promise: Promise<void>;
	promise = (async () => {
		await renderPageContent(pageElement, pageNumber, sequence);
		if (sequence === renderSequence && pageElement.querySelector("canvas") && pageElement.querySelector('[data-onhand-pdf-text-ready="true"]')) {
			pageElement.removeAttribute("data-onhand-pdf-pending");
		}
	})().finally(() => {
		if (pageRenderPromises.get(pageNumber) === promise) pageRenderPromises.delete(pageNumber);
	});
	pageRenderPromises.set(pageNumber, promise);
	return promise;
}

function nextPendingPageNumber() {
	const currentNumber = Number(pageInput.value || 1) || getPageNumber(findViewportPage()) || 1;
	let best: number | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const pageElement of getPdfPages()) {
		if (!isPendingPage(pageElement)) continue;
		const pageNumber = getPageNumber(pageElement);
		if (!pageNumber) continue;
		const distance = Math.abs(pageNumber - currentNumber);
		if (distance < bestDistance) {
			best = pageNumber;
			bestDistance = distance;
		}
	}
	return best;
}

function countPendingPages() {
	return getPdfPages().filter((pageElement) => isPendingPage(pageElement)).length;
}

async function renderRemainingPages(sequence: number) {
	while (sequence === renderSequence) {
		const pageNumber = nextPendingPageNumber();
		if (!pageNumber) break;
		await ensurePageRendered(pageNumber, sequence);
		if (sequence !== renderSequence) return;
		const total = Number(pdfDocument?.numPages || 0);
		const pendingCount = countPendingPages();
		if (pendingCount > 0) setStatus(`Rendered ${total - pendingCount}/${total}`);
	}
	if (sequence === renderSequence && !countPendingPages()) {
		document.body.setAttribute("data-onhand-pdf-rendered", "true");
		setStatus("Ready");
		// If the reader zoomed while the initial background queue was still
		// filling, sharpen the visible page only after that queue drains. Large
		// scanned pages can otherwise make PDF.js serialize the foreground
		// repaint behind a slow offscreen image decode.
		scheduleViewportRender();
	}
}

async function findPendingPageWithText(query: string) {
	const normalizedQuery = normalizeText(query).toLowerCase();
	const compactQuery = compactPendingSearchText(query);
	if (!normalizedQuery) return null;
	for (const pageElement of getPdfPages()) {
		if (!isPendingPage(pageElement)) continue;
		const pageNumber = getPageNumber(pageElement);
		if (!pageNumber) continue;
		const text = (await getPageTextContent(pageNumber)).toLowerCase();
		if (text.includes(normalizedQuery) || compactPendingSearchText(text).includes(compactQuery)) return pageNumber;
	}
	return null;
}

async function renderDocument(options: { preserveView?: boolean } = {}) {
	if (!pdfDocument) return;
	commitTransientZoom();
	const snapshot = options.preserveView ? capturePdfViewSnapshot() : null;
	const sequence = ++renderSequence;
	document.body.removeAttribute("data-onhand-pdf-rendered");
	viewer.replaceChildren();
	pageRenderPromises.clear();
	pageCountElement.textContent = `/ ${pdfDocument.numPages}`;
	pageInput.max = String(pdfDocument.numPages);
	setStatus(`Preparing ${pdfDocument.numPages} pages...`);
	await createPageShells(sequence);
	if (sequence !== renderSequence) return;
	// Render the pages nearest the reading position, then report ready so
	// highlights, notes, and citation jumps work while the rest fill in.
	for (let i = 0; i < 3; i += 1) {
		const pageNumber = nextPendingPageNumber();
		if (!pageNumber) break;
		await ensurePageRendered(pageNumber, sequence);
		if (sequence !== renderSequence) return;
	}
	document.body.setAttribute("data-onhand-pdf-rendered", "true");
	const pendingCount = countPendingPages();
	setStatus(pendingCount ? `Rendered ${pdfDocument.numPages - pendingCount}/${pdfDocument.numPages}` : "Ready");
	void renderRemainingPages(sequence);
	await restorePdfViewSnapshot(snapshot, sequence);
}

function pagesOrderedFromViewport() {
	const pages = getPdfPages();
	const current = findViewportPage();
	const currentNumber = getPageNumber(current) || Number(pageInput.value || 1) || 1;
	return [...pages].sort(
		(left, right) => Math.abs((getPageNumber(left) || 0) - currentNumber) - Math.abs((getPageNumber(right) || 0) - currentNumber),
	);
}

function pagesNearViewport() {
	const ordered = pagesOrderedFromViewport();
	const toolbar = document.querySelector<HTMLElement>(".onhand-pdf-toolbar");
	const toolbarBottom = toolbar?.getBoundingClientRect().bottom || 0;
	const visible = ordered.filter((pageElement) => {
		const rect = pageElement.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0 && rect.bottom > toolbarBottom && rect.top < window.innerHeight;
	});
	return (visible.length ? visible : ordered).slice(0, 2);
}

async function renderSharpPagesNearViewport(sequence = renderSequence, expectedZoomRevision = zoomRevision) {
	for (const pageElement of pagesNearViewport()) {
		if (sequence !== renderSequence || expectedZoomRevision !== zoomRevision) return;
		const pageNumber = getPageNumber(pageElement);
		if (!pageNumber) continue;
		await ensurePageRendered(pageNumber, sequence, { sharpen: true });
		// A page that was already rendering when zoom began is allowed to
		// finish at its old scale. Upgrade it once more at the latest scale
		// instead of cancelling it and starting an overlapping PDF.js render.
		if (sequence !== renderSequence || expectedZoomRevision !== zoomRevision) return;
		if (pageNeedsSharperRender(pageElement)) {
			await ensurePageRendered(pageNumber, sequence, { sharpen: true });
		}
	}
}

function settleZoomRender(sequence: number, expectedZoomRevision: number) {
	if (zoomRenderTimer !== null) window.clearTimeout(zoomRenderTimer);
	zoomRenderTimer = window.setTimeout(async () => {
		zoomRenderTimer = null;
		if (sequence !== renderSequence || expectedZoomRevision !== zoomRevision) return;
		commitTransientZoom();
		const annotations = capturePdfAnnotationSnapshots();
		const pendingCountBeforeSharpen = countPendingPages();
		if (pendingCountBeforeSharpen) {
			await rebuildPdfAnnotationLayers(annotations, sequence);
			if (sequence !== renderSequence || expectedZoomRevision !== zoomRevision) return;
			setStatus(`Rendered ${Number(pdfDocument?.numPages || 0) - pendingCountBeforeSharpen}/${pdfDocument?.numPages || 0}`);
			return;
		}
		if (pagesNearViewport().some((page) => pageNeedsSharperRender(page))) {
			setStatus(`Sharpening visible pages at ${Math.round(currentScale * 100)}%...`);
		}
		await renderSharpPagesNearViewport(sequence, expectedZoomRevision);
		if (sequence !== renderSequence || expectedZoomRevision !== zoomRevision) return;
		await rebuildPdfAnnotationLayers(annotations, sequence);
		if (sequence !== renderSequence || expectedZoomRevision !== zoomRevision) return;
		const pendingCount = countPendingPages();
		setStatus(pendingCount ? `Rendered ${Number(pdfDocument?.numPages || 0) - pendingCount}/${pdfDocument?.numPages || 0}` : "Ready");
	}, ZOOM_RENDER_DELAY_MS);
}

function scheduleViewportRender() {
	if (!pdfDocument) return;
	if (viewportRenderTimer !== null) window.clearTimeout(viewportRenderTimer);
	const sequence = renderSequence;
	viewportRenderTimer = window.setTimeout(async () => {
		viewportRenderTimer = null;
		const expectedZoomRevision = zoomRevision;
		if (sequence !== renderSequence || hasTransientZoom()) return;
		await renderSharpPagesNearViewport(sequence, expectedZoomRevision);
	}, VIEWPORT_RENDER_DELAY_MS);
}

// Zoom without blanking or rebuilding the document. Gesture frames only apply
// one compositor transform; page geometry is committed once after interaction
// settles, and offscreen canvases keep their existing raster until needed.
function rescaleDocument(nextScale: number, anchor = captureZoomAnchor()) {
	if (!pdfDocument) return;
	const normalized = clampScale(nextScale);
	if (Math.abs(normalized - currentScale) < 0.001) return;
	const sequence = renderSequence;
	const expectedZoomRevision = ++zoomRevision;
	applyTransientZoom(normalized, transientZoomAnchor || anchor);
	updateZoomControls();
	setStatus(`Zoom ${Math.round(normalized * 100)}%`);
	settleZoomRender(sequence, expectedZoomRevision);
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
	pdfDocument = await loadPdfDocumentFromUrl(sourceUrl);
	cachedPdfTextLayerInfo = null;
	const pageCount = Number(pdfDocument.numPages || 0);
	const explicitInitialPageNumber = parseInitialPageNumber(pageCount);
	const initialPageNumber = explicitInitialPageNumber || pageNumberFromScrollRatio(parseInitialScrollRatio(), pageCount) || 1;
	setCurrentPageNumber(initialPageNumber);
	currentScale = await computeFitScale(initialPageNumber);
	committedScale = currentScale;
	viewer.style.setProperty("--scale-factor", String(committedScale));
	updateZoomControls();
	lastFitRenderWidth = viewer.clientWidth;
	await renderDocument();
	scrollToPage(initialPageNumber);
}

zoomInButton.addEventListener("click", () => {
	scaleMode = "custom";
	void rescaleDocument(currentScale + SCALE_STEP);
});

zoomOutButton.addEventListener("click", () => {
	scaleMode = "custom";
	void rescaleDocument(currentScale - SCALE_STEP);
});

async function fitPageToWindow() {
	if (!pdfDocument) return;
	commitTransientZoom();
	scaleMode = "fit";
	const nextScale = await computeFitScale(Number(pageInput.value || 1) || 1);
	lastFitRenderWidth = viewer.clientWidth;
	rescaleDocument(nextScale);
	updateZoomControls();
}

zoomValueButton.addEventListener("click", () => {
	void fitPageToWindow();
});

function queueGestureZoom(nextScale: number, clientX: number, clientY: number) {
	queuedGestureScale = clampScale(nextScale);
	queuedGestureClientX = clientX;
	queuedGestureClientY = clientY;
	if (gestureAnimationFrame !== null) return;
	gestureAnimationFrame = requestAnimationFrame(() => {
		gestureAnimationFrame = null;
		const anchor = transientZoomAnchor || captureZoomAnchor(queuedGestureClientX, queuedGestureClientY);
		rescaleDocument(queuedGestureScale, anchor);
	});
}

window.addEventListener(
	"wheel",
	(event) => {
		// Chromium represents a trackpad pinch as a ctrl+wheel gesture. Keep
		// ordinary two-finger scrolling untouched.
		if (!event.ctrlKey || !pdfDocument) return;
		event.preventDefault();
		scaleMode = "custom";
		const deltaPixels = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1);
		const factor = Math.exp(-Math.max(-60, Math.min(60, deltaPixels)) * 0.01);
		const baseScale = gestureAnimationFrame !== null ? queuedGestureScale : currentScale;
		queueGestureZoom(baseScale * factor, event.clientX, event.clientY);
	},
	{ passive: false },
);

// WebKit-style gesture events are also supported so the same interaction
// remains native-feeling in Chromium-derived and Safari-derived shells.
window.addEventListener(
	"gesturestart" as any,
	((event: any) => {
		if (!pdfDocument) return;
		event.preventDefault?.();
		scaleMode = "custom";
		nativeGestureStartScale = currentScale;
	}) as EventListener,
	{ passive: false } as AddEventListenerOptions,
);
window.addEventListener(
	"gesturechange" as any,
	((event: any) => {
		if (!pdfDocument) return;
		event.preventDefault?.();
		queueGestureZoom(nativeGestureStartScale * (Number(event.scale) || 1), Number(event.clientX) || window.innerWidth / 2, Number(event.clientY) || window.innerHeight / 2);
	}) as EventListener,
	{ passive: false } as AddEventListenerOptions,
);

window.addEventListener(
	"keydown",
	(event) => {
		if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
		if (event.key === "+" || event.key === "=") {
			event.preventDefault();
			scaleMode = "custom";
			rescaleDocument(currentScale + SCALE_STEP);
		} else if (event.key === "-") {
			event.preventDefault();
			scaleMode = "custom";
			rescaleDocument(currentScale - SCALE_STEP);
		} else if (event.key === "0") {
			event.preventDefault();
			void fitPageToWindow();
		}
	},
	{ capture: true },
);

let pendingFitRender = false;

function hasUsableViewerViewport() {
	return !document.hidden && viewer.clientWidth > 1 && window.innerHeight > 1;
}

function scheduleResizeRender() {
	if (!pdfDocument || scaleMode !== "fit") return;
	// Background tabs and reclaimed iframes fire resize events with
	// zero-sized layouts; re-fitting from those re-rendered the whole
	// document twice per tab switch. Defer the check until visible.
	if (!hasUsableViewerViewport()) {
		pendingFitRender = true;
		return;
	}
	// Height-only changes (the chrome.debugger infobar appearing and
	// disappearing around tool calls, find bars, etc.) must not refit:
	// they shifted the height-bound fit scale a few percent and restarted
	// the whole document render around every agent command.
	if (viewer.clientWidth === lastFitRenderWidth) return;
	if (resizeRenderTimer !== null) window.clearTimeout(resizeRenderTimer);
	resizeRenderTimer = window.setTimeout(async () => {
		resizeRenderTimer = null;
		if (!pdfDocument || scaleMode !== "fit" || !hasUsableViewerViewport()) return;
		if (viewer.clientWidth === lastFitRenderWidth) return;
		const nextScale = await computeFitScale(Number(pageInput.value || 1) || 1);
		lastFitRenderWidth = viewer.clientWidth;
		if (Math.abs(nextScale - currentScale) < 0.01) return;
		rescaleDocument(nextScale);
	}, RESIZE_RENDER_DELAY_MS);
}

document.addEventListener("visibilitychange", () => {
	if (document.hidden || !pendingFitRender) return;
	pendingFitRender = false;
	scheduleResizeRender();
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

window.addEventListener(
	"scroll",
	() => {
		updatePageFromScroll();
		scheduleViewportRender();
	},
	{ passive: true },
);
window.addEventListener("resize", scheduleResizeRender, { passive: true });

loadPdf().catch((error) => {
	showError(error?.message || String(error));
});
