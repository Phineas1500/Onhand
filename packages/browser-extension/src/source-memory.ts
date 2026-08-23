export type SavedSourceKind = "html" | "pdf" | "upload";

export interface SavedSourceBlock {
	id: string;
	ordinal: number;
	tag: string;
	text: string;
	selector?: string;
	pageNumber?: number;
}

export interface SavedSourceRepresentation {
	schemaVersion: 1;
	extractorVersion: string;
	captureScope?: "full-source" | "session-evidence";
	sourceKind: SavedSourceKind;
	capturedAt: string;
	sourceUrl: string;
	title: string;
	contentFingerprint: string;
	truncated: boolean;
	charCount: number;
	blocks: SavedSourceBlock[];
}

export interface SavedSourceArtifactLike {
	id: string;
	createdAt?: string;
	updatedAt?: string;
	label?: string | null;
	tab?: any;
	page?: any;
	source?: SavedSourceRepresentation | null;
}

export interface SavedSourceSearchResult {
	artifactId: string;
	captureScope: "full-source" | "session-evidence";
	sourceKind: SavedSourceKind;
	title: string;
	url: string;
	capturedAt: string;
	contentFingerprint: string;
	blockId: string;
	ordinal: number;
	tag: string;
	text: string;
	score: number;
	selector?: string;
	pageNumber?: number;
}

function savedSourceResultKey(result: Pick<SavedSourceSearchResult, "artifactId" | "blockId">) {
	return `${result.artifactId}\u0000${result.blockId}`;
}

const SOURCE_MEMORY_SCHEMA_VERSION = 1 as const;
export const SOURCE_MEMORY_EXTRACTOR_VERSION = "onhand-source-memory-v1";
export const SESSION_EVIDENCE_EXTRACTOR_VERSION = "onhand-session-evidence-v1";
const DEFAULT_MAX_CHARS = 50_000;
const DEFAULT_MAX_BLOCKS = 240;
const MAX_BLOCK_CHARS = 4_000;
const MAX_PDF_PASSAGE_CHARS = 1_200;

const SEARCH_STOP_WORDS = new Set([
	"about",
	"also",
	"and",
	"are",
	"does",
	"for",
	"from",
	"have",
	"how",
	"into",
	"its",
	"page",
	"source",
	"that",
	"the",
	"their",
	"this",
	"was",
	"what",
	"when",
	"where",
	"which",
	"with",
]);

function normalizeText(value: unknown) {
	return String(value || "")
		.replace(/\r\n?/g, "\n")
		.replace(/\u0000/g, "")
		.replace(/[ \t]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function compactText(value: unknown, maxChars = MAX_BLOCK_CHARS) {
	return normalizeText(value).slice(0, maxChars);
}

function splitTextPassages(value: unknown, maxChars: number) {
	let remaining = normalizeText(value);
	const passages: string[] = [];
	while (remaining.length > maxChars) {
		const window = remaining.slice(0, maxChars + 1);
		const minimumBreak = Math.floor(maxChars * 0.55);
		let breakAt = -1;
		for (const match of window.matchAll(/[.!?](?:["'”’)]*)\s+/g)) {
			const candidate = Number(match.index || 0) + match[0].length;
			if (candidate >= minimumBreak && candidate <= maxChars) breakAt = candidate;
		}
		if (breakAt < minimumBreak) breakAt = window.lastIndexOf(" ", maxChars);
		if (breakAt < minimumBreak) breakAt = maxChars;
		const passage = remaining.slice(0, breakAt).trim();
		if (passage) passages.push(passage);
		remaining = remaining.slice(breakAt).trim();
	}
	if (remaining) passages.push(remaining);
	return passages;
}

function normalizeUrl(value: unknown) {
	const raw = String(value || "").trim();
	if (!raw) return "";
	try {
		const parsed = new URL(raw);
		parsed.hash = "";
		return parsed.toString();
	} catch {
		return raw;
	}
}

function positiveInteger(value: unknown) {
	const number = Number(value || 0);
	return Number.isInteger(number) && number > 0 ? number : 0;
}

function looksLikePdf(input: { tab?: any; page?: any; extraction?: any }, blocks: SavedSourceBlock[]) {
	const surfaceText = [
		input.extraction?.surface,
		input.extraction?.viewer,
		input.extraction?.source,
		input.page?.surface,
		input.page?.viewer,
		input.page?.source,
	]
		.join(" ")
		.toLowerCase();
	if (/\bpdf\b/.test(surfaceText)) return true;
	if (blocks.some((block) => block.tag === "pdf-page" || Boolean(block.pageNumber))) return true;
	const url = String(input.extraction?.url || input.page?.url || input.tab?.url || "").toLowerCase();
	return /(?:\.pdf(?:$|[?#/])|\/pdf(?:$|[/?#])|[?&](?:format|contenttype)=pdf\b)/i.test(url);
}

function fallbackBlocksFromText(value: unknown) {
	return compactText(value, DEFAULT_MAX_CHARS)
		.split(/\n{2,}/)
		.map((text) => compactText(text))
		.filter(Boolean)
		.map((text, index) => ({ tag: "p", text, ordinal: index + 1 }));
}

function normalizeBlocks(extraction: any, maxChars: number, maxBlocks: number) {
	const rawBlocks = Array.isArray(extraction?.blocks) && extraction.blocks.length
		? extraction.blocks
		: fallbackBlocksFromText(extraction?.markdown || extraction?.text);
	const blocks: SavedSourceBlock[] = [];
	let usedChars = 0;
	let truncated = Boolean(extraction?.truncated);
	for (const raw of rawBlocks) {
		if (blocks.length >= maxBlocks || usedChars >= maxChars) {
			truncated = true;
			break;
		}
		const pageNumber = positiveInteger(raw?.pageNumber || raw?.page || raw?.pdfAnchor?.pageNumber);
		const passages = splitTextPassages(raw?.text ?? raw, pageNumber ? MAX_PDF_PASSAGE_CHARS : MAX_BLOCK_CHARS);
		for (const passage of passages) {
			if (blocks.length >= maxBlocks || usedChars >= maxChars) {
				truncated = true;
				break;
			}
			const remaining = maxChars - usedChars;
			const text = passage.slice(0, remaining);
			if (!text) continue;
			const ordinal = blocks.length + 1;
			const block: SavedSourceBlock = {
				id: pageNumber ? `p${pageNumber}-b${ordinal}` : `b${ordinal}`,
				ordinal,
				tag: compactText(raw?.tag || (pageNumber ? "pdf-page" : "p"), 40).toLowerCase() || "p",
				text,
			};
			const selector = compactText(raw?.selector, 500);
			if (selector) block.selector = selector;
			if (pageNumber) block.pageNumber = pageNumber;
			blocks.push(block);
			usedChars += text.length + 2;
			if (text.length < passage.length) {
				truncated = true;
				break;
			}
		}
	}
	return { blocks, charCount: blocks.reduce((total, block) => total + block.text.length, 0), truncated };
}

// A deterministic non-cryptographic content fingerprint is sufficient here:
// it detects snapshot drift without implying authenticity or integrity.
function fingerprintText(value: string) {
	let hashA = 0x811c9dc5;
	let hashB = 0x9e3779b9;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		hashA ^= code;
		hashA = Math.imul(hashA, 0x01000193) >>> 0;
		hashB ^= code + index;
		hashB = Math.imul(hashB, 0x85ebca6b) >>> 0;
	}
	return `fnv1a-${hashA.toString(16).padStart(8, "0")}${hashB.toString(16).padStart(8, "0")}`;
}

export function buildSavedSourceRepresentation(
	input: { tab?: any; page?: any; extraction?: any; capturedAt?: string; sourceKind?: SavedSourceKind },
	options: { maxChars?: number; maxBlocks?: number } = {},
): SavedSourceRepresentation | null {
	const extraction = input?.extraction;
	if (!extraction || extraction.unsupported === true) return null;
	const maxChars = Math.max(1_000, Math.min(DEFAULT_MAX_CHARS, Number(options.maxChars || DEFAULT_MAX_CHARS) || DEFAULT_MAX_CHARS));
	const maxBlocks = Math.max(1, Math.min(DEFAULT_MAX_BLOCKS, Number(options.maxBlocks || DEFAULT_MAX_BLOCKS) || DEFAULT_MAX_BLOCKS));
	const normalized = normalizeBlocks(extraction, maxChars, maxBlocks);
	if (!normalized.blocks.length) return null;
	const sourceUrl = normalizeUrl(extraction.url || input.page?.sourceUrl || input.page?.url || input.tab?.url);
	const title = compactText(extraction.title || input.page?.title || input.tab?.title || "Saved source", 300);
	const sourceKind = input.sourceKind || (looksLikePdf(input, normalized.blocks) ? "pdf" : "html");
	const fingerprintInput = normalized.blocks.map((block) => `${block.pageNumber || ""}\t${block.tag}\t${block.text}`).join("\n");
	return {
		schemaVersion: SOURCE_MEMORY_SCHEMA_VERSION,
		extractorVersion: SOURCE_MEMORY_EXTRACTOR_VERSION,
		captureScope: "full-source",
		sourceKind,
		capturedAt: String(input.capturedAt || input.page?.capturedAt || new Date().toISOString()),
		sourceUrl,
		title,
		contentFingerprint: fingerprintText(fingerprintInput),
		truncated: normalized.truncated,
		charCount: normalized.charCount,
		blocks: normalized.blocks,
	};
}

function anchoredEvidenceText(annotation: any) {
	const quote = annotation?.pdfAnchor?.textQuote || annotation?.anchor?.textQuote || {};
	const main = normalizeText(annotation?.matchedText || annotation?.text || quote?.exact).slice(0, MAX_PDF_PASSAGE_CHARS);
	if (!main) return "";
	const remaining = Math.max(0, MAX_PDF_PASSAGE_CHARS - main.length - 2);
	const prefixBudget = Math.floor(remaining / 2);
	const suffixBudget = remaining - prefixBudget;
	const rawPrefix = normalizeText(quote?.prefix);
	const rawSuffix = normalizeText(quote?.suffix);
	const prefix = prefixBudget > 0 ? rawPrefix.slice(-prefixBudget) : "";
	const suffix = suffixBudget > 0 ? rawSuffix.slice(0, suffixBudget) : "";
	return normalizeText([prefix, main, suffix].filter(Boolean).join(" "));
}

function artifactEvidenceUrl(artifact: SavedSourceArtifactLike, annotations: any[]) {
	for (const annotation of annotations) {
		const document = annotation?.pdfAnchor?.document;
		const pdfUrl = document?.pdfUrl || document?.sourceUrl || document?.url;
		if (pdfUrl) return normalizeUrl(pdfUrl);
	}
	return normalizeUrl(artifact.page?.sourceUrl || artifact.page?.url || artifact.tab?.url);
}

export function buildSavedArtifactEvidenceRepresentation(artifact: SavedSourceArtifactLike): SavedSourceRepresentation | null {
	const annotations = Array.isArray(artifact?.page?.annotations) ? artifact.page.annotations : [];
	const seen = new Set<string>();
	const blocks = annotations.flatMap((annotation: any) => {
		const text = anchoredEvidenceText(annotation);
		if (!text) return [];
		const pageNumber = positiveInteger(annotation?.pdfAnchor?.pageNumber);
		const selector = compactText(annotation?.anchor?.selector || annotation?.container?.selector, 500);
		const key = `${pageNumber}\u0000${selector}\u0000${text.toLowerCase()}`;
		if (seen.has(key)) return [];
		seen.add(key);
		return [{
			tag: pageNumber ? "pdf-evidence" : "evidence",
			text,
			...(selector ? { selector } : {}),
			...(pageNumber ? { pageNumber } : {}),
		}];
	});
	if (!blocks.length) return null;
	const source = buildSavedSourceRepresentation({
		tab: artifact.tab,
		page: artifact.page,
		capturedAt: artifact.page?.capturedAt || artifact.createdAt || artifact.updatedAt,
		extraction: {
			surface: blocks.some((block) => block.pageNumber) ? "pdf" : "html",
			title: artifact.page?.title || artifact.tab?.title || artifact.label || "Saved session evidence",
			url: artifactEvidenceUrl(artifact, annotations),
			blocks,
		},
	});
	if (!source) return null;
	return {
		...source,
		extractorVersion: SESSION_EVIDENCE_EXTRACTOR_VERSION,
		captureScope: "session-evidence",
	};
}

function searchTokens(value: unknown) {
	const matches = String(value || "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) || [];
	return Array.from(new Set(matches.filter((token) => token.length >= 2 && !SEARCH_STOP_WORDS.has(token)))).slice(0, 24);
}

function countOccurrences(text: string, token: string) {
	let count = 0;
	let from = 0;
	while (count < 4) {
		const index = text.indexOf(token, from);
		if (index < 0) break;
		count += 1;
		from = index + token.length;
	}
	return count;
}

export function searchSavedSourceArtifacts(
	artifacts: SavedSourceArtifactLike[],
	query: unknown,
	options: { limit?: number; artifactIds?: string[]; sourceKinds?: SavedSourceKind[] } = {},
): SavedSourceSearchResult[] {
	const phrase = compactText(query, 500).toLowerCase();
	const tokens = searchTokens(query);
	if (!phrase || !tokens.length) return [];
	const limit = Math.max(1, Math.min(50, Number(options.limit || 8) || 8));
	const artifactIds = new Set((Array.isArray(options.artifactIds) ? options.artifactIds : []).map((id) => String(id || "").trim()).filter(Boolean));
	const sourceKinds = new Set(Array.isArray(options.sourceKinds) ? options.sourceKinds : []);
	const results: SavedSourceSearchResult[] = [];
	const searchableSources = new Map<string, SavedSourceRepresentation>();
	for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
		const artifactId = String(artifact?.id || "");
		if (artifactIds.size && !artifactIds.has(artifactId)) continue;
		const persistedSource = artifact?.source;
		const source = persistedSource?.schemaVersion === SOURCE_MEMORY_SCHEMA_VERSION && Array.isArray(persistedSource.blocks)
			? persistedSource
			: buildSavedArtifactEvidenceRepresentation(artifact);
		if (!source || source.schemaVersion !== SOURCE_MEMORY_SCHEMA_VERSION || !Array.isArray(source.blocks)) continue;
		if (sourceKinds.size && !sourceKinds.has(source.sourceKind)) continue;
		searchableSources.set(artifactId, source);
		const titleText = `${source.title || ""} ${artifact.label || ""}`.toLowerCase();
		const urlText = String(source.sourceUrl || "").toLowerCase();
		for (const block of source.blocks) {
			const blockText = String(block?.text || "").toLowerCase();
			if (!blockText) continue;
			let score = blockText.includes(phrase) ? 30 : 0;
			let matchedTokens = 0;
			let matchedMetadataTokens = 0;
			for (const token of tokens) {
				const occurrences = countOccurrences(blockText, token);
				if (occurrences) {
					matchedTokens += 1;
					score += 4 + Math.min(3, occurrences);
				}
				if (titleText.includes(token)) {
					matchedMetadataTokens += 1;
					score += 5;
				}
				if (urlText.includes(token)) {
					matchedMetadataTokens += 1;
					score += 1;
				}
			}
			if (!matchedTokens && !matchedMetadataTokens) continue;
			if (matchedTokens === tokens.length) score += 10;
			results.push({
				artifactId,
				captureScope: source.captureScope || "full-source",
				sourceKind: source.sourceKind,
				title: source.title,
				url: source.sourceUrl,
				capturedAt: source.capturedAt,
				contentFingerprint: source.contentFingerprint,
				blockId: block.id,
				ordinal: block.ordinal,
				tag: block.tag,
				text: block.text,
				score,
				...(block.selector ? { selector: block.selector } : {}),
				...(block.pageNumber ? { pageNumber: block.pageNumber } : {}),
			});
		}
	}
	const ranked = results.sort(
		(left, right) => right.score - left.score || String(right.capturedAt).localeCompare(String(left.capturedAt)) || left.ordinal - right.ordinal,
	);
	const selected: SavedSourceSearchResult[] = [];
	const selectedKeys = new Set<string>();
	const addResult = (result: SavedSourceSearchResult) => {
		const key = savedSourceResultKey(result);
		if (selected.length >= limit || selectedKeys.has(key)) return;
		selectedKeys.add(key);
		selected.push(result);
	};
	for (const result of ranked) {
		if (selected.length >= limit) break;
		addResult(result);
		if (result.sourceKind !== "pdf" || !result.pageNumber || selected.length >= limit) continue;
		const source = searchableSources.get(result.artifactId);
		const documentBlocks = source?.blocks.slice().sort((left, right) => left.ordinal - right.ordinal) || [];
		const blockIndex = documentBlocks.findIndex((block) => block.id === result.blockId);
		if (blockIndex < 0) continue;
		// PDF text is passage-chunked for retrieval, but a question can span the
		// sentence immediately before or after the best lexical match, including
		// across a page break. Return a bounded same-document context window so an
		// arbitrary chunk edge does not force another round trip or invite an
		// answer from memory.
		for (const offset of [-1, 1]) {
			const block = documentBlocks[blockIndex + offset];
			if (
				!block ||
				selected.length >= limit ||
				!block.pageNumber ||
				Math.abs(block.pageNumber - result.pageNumber) > 1
			) continue;
			addResult({
				artifactId: result.artifactId,
				captureScope: source!.captureScope || "full-source",
				sourceKind: source!.sourceKind,
				title: source!.title,
				url: source!.sourceUrl,
				capturedAt: source!.capturedAt,
				contentFingerprint: source!.contentFingerprint,
				blockId: block.id,
				ordinal: block.ordinal,
				tag: block.tag,
				text: block.text,
				score: result.score - 0.5,
				...(block.selector ? { selector: block.selector } : {}),
				...(block.pageNumber ? { pageNumber: block.pageNumber } : {}),
			});
		}
	}
	return selected;
}
