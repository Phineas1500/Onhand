import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";

// MV3 extension service workers cannot start PDF.js's normal nested worker or
// dynamically import its fallback worker reliably. Supplying the bundled
// handler lets PDF.js use its in-process fake-worker path without opening tabs.
(globalThis as any).pdfjsWorker ||= { WorkerMessageHandler };

export interface PdfCorpusSource {
	title?: string;
	url: string;
}

export interface PdfCorpusEvidenceSlot {
	id: string;
	description?: string;
	queries: string[];
}

interface PdfCorpusPage {
	pageNumber: number;
	text: string;
}

const DEFAULT_PDF_FETCH_TIMEOUT_MS = 15000;

const STOP_WORDS = new Set([
	"a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "into", "is", "it", "of", "on", "or", "that", "the", "their", "this", "to", "using", "what", "when", "with",
]);

function compactText(value: unknown, maxChars = 1200) {
	const text = String(value || "").replace(/\s+/g, " ").trim();
	return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text;
}

function queryTokens(value: unknown) {
	return Array.from(new Set(String(value || "").toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) || []))
		.filter((token) => !STOP_WORDS.has(token));
}

function tokenStems(token: string) {
	const stems = new Set([token]);
	for (const suffix of ["ations", "ation", "ments", "ment", "ingly", "edly", "ing", "ized", "izes", "ize", "ed", "es", "s"]) {
		if (token.endsWith(suffix) && token.length - suffix.length >= 4) stems.add(token.slice(0, -suffix.length));
	}
	return stems;
}

function matchedQueryTokens(text: string, tokens: string[]) {
	const textTokens = Array.from(new Set(text.match(/[a-z0-9][a-z0-9'-]{2,}/g) || []));
	const textStems = new Set(textTokens.flatMap((token) => Array.from(tokenStems(token))));
	return tokens.filter((token) => Array.from(tokenStems(token)).some((stem) => textStems.has(stem)));
}

function scoreTextForQuery(text: string, query: string) {
	const normalizedText = text.toLowerCase();
	const normalizedQuery = compactText(query, 300).toLowerCase();
	const tokens = queryTokens(normalizedQuery);
	if (!normalizedQuery || !tokens.length) return 0;
	const matched = matchedQueryTokens(normalizedText, tokens);
	const coverage = matched.length / tokens.length;
	if (!matched.length || (tokens.length >= 3 && coverage < 0.34)) return 0;
	const exactBonus = normalizedText.includes(normalizedQuery) ? 8 : 0;
	const densityBonus = matched.reduce((sum, token) => sum + Math.min(3, normalizedText.split(token).length - 1), 0) * 0.15;
	return exactBonus + coverage * 5 + matched.length * 0.45 + densityBonus;
}

function bestExcerpt(text: string, queries: string[], maxChars = 900) {
	const normalized = text.toLowerCase();
	let bestIndex = -1;
	for (const query of queries) {
		const exact = normalized.indexOf(compactText(query, 300).toLowerCase());
		if (exact >= 0 && (bestIndex < 0 || exact < bestIndex)) bestIndex = exact;
		for (const token of queryTokens(query)) {
			const index = normalized.indexOf(token);
			if (index >= 0 && (bestIndex < 0 || index < bestIndex)) bestIndex = index;
		}
	}
	if (bestIndex < 0) return compactText(text, maxChars);
	const start = Math.max(0, bestIndex - Math.floor(maxChars * 0.3));
	return compactText(`${start > 0 ? "…" : ""}${text.slice(start, start + maxChars)}${start + maxChars < text.length ? "…" : ""}`, maxChars + 2);
}

export function rankPdfCorpusTextPages(
	sources: Array<PdfCorpusSource & { pages: PdfCorpusPage[] }>,
	evidenceSlots: PdfCorpusEvidenceSlot[],
	maxMatchesPerSlot = 3,
) {
	return evidenceSlots.map((slot) => {
		const queries = Array.from(new Set([
			...(Array.isArray(slot.queries) ? slot.queries : []),
			slot.description || "",
		].map((query) => compactText(query, 300)).filter(Boolean)));
		const matches = sources.flatMap((source) => source.pages.map((page) => {
			const queryScores = queries.map((query) => scoreTextForQuery(page.text, query)).filter((score) => score > 0).sort((a, b) => b - a);
			const score = (queryScores[0] || 0) + queryScores.slice(1).reduce((sum, value) => sum + value * 0.35, 0);
			return {
				title: compactText(source.title || source.url, 240),
				url: source.url,
				pageNumber: page.pageNumber,
				score: Number(score.toFixed(3)),
				excerpt: bestExcerpt(page.text, queries),
			};
		})).filter((match) => match.score > 0)
			.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url) || a.pageNumber - b.pageNumber)
			.slice(0, Math.max(1, Math.min(8, maxMatchesPerSlot)));
		return {
			id: compactText(slot.id, 80),
			description: compactText(slot.description, 300),
			queries,
			matches,
		};
	});
}

async function readPdfPages(source: PdfCorpusSource, fetchTimeoutMs: number) {
	// Corpus candidates are normally public course/paper PDFs. Cross-origin
	// credentialed fetches from an extension worker are rejected by many servers
	// that otherwise serve the PDF, so keep the batch path credential-free. An
	// authenticated PDF can still fall back to the normal tab/viewer workflow.
	const controller = new AbortController();
	const timeoutId = setTimeout(
		() => controller.abort(new Error(`PDF fetch timed out after ${fetchTimeoutMs}ms`)),
		fetchTimeoutMs,
	);
	let data: Uint8Array;
	try {
		const response = await fetch(source.url, { credentials: "omit", signal: controller.signal });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const contentLength = Number(response.headers.get("content-length") || 0);
		if (contentLength > 40 * 1024 * 1024) throw new Error("PDF exceeds the 40 MB corpus-search limit");
		data = new Uint8Array(await response.arrayBuffer());
	} catch (error) {
		if (controller.signal.aborted) throw new Error(`PDF fetch timed out after ${fetchTimeoutMs}ms`);
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
	if (data.byteLength > 40 * 1024 * 1024) throw new Error("PDF exceeds the 40 MB corpus-search limit");
	// The corpus path extracts text only. Supplying browser font/CMap URLs makes
	// PDF.js's display-layer fetch helper read `document.baseURI`, which does not
	// exist in an MV3 service worker. Embedded text extraction works without
	// those display resources and keeps the batch reader DOM-free.
	const loadingTask = getDocument({ data });
	const document = await loadingTask.promise;
	try {
		const pages: PdfCorpusPage[] = [];
		for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
			const page = await document.getPage(pageNumber);
			const content = await page.getTextContent();
			const text = (content.items as any[]).map((item) => String(item?.str || "")).filter(Boolean).join(" ");
			pages.push({ pageNumber, text: compactText(text, 24000) });
			page.cleanup();
		}
		return pages;
	} finally {
		await loadingTask.destroy();
	}
}

export async function searchPdfCorpus(options: {
	sources: PdfCorpusSource[];
	evidenceSlots: PdfCorpusEvidenceSlot[];
	maxSources?: number;
	maxMatchesPerSlot?: number;
	concurrency?: number;
	fetchTimeoutMs?: number;
}) {
	GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.mjs", import.meta.url).href;
	const maximum = Math.max(1, Math.min(50, Number(options.maxSources) || 30));
	const seen = new Set<string>();
	const sources = (Array.isArray(options.sources) ? options.sources : []).map((source) => ({
		title: compactText(source?.title, 240),
		url: String(source?.url || "").trim(),
	})).filter((source) => {
		if (!/^https?:\/\//i.test(source.url) || !/\.pdf(?:[?#]|$)/i.test(source.url)) return false;
		const key = source.url.replace(/#.*$/, "");
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	}).slice(0, maximum);
	const readable: Array<PdfCorpusSource & { pages: PdfCorpusPage[] }> = [];
	const failures: Array<{ title: string; url: string; error: string }> = [];
	const fetchTimeoutMs = Math.max(100, Math.min(60000, Number(options.fetchTimeoutMs) || DEFAULT_PDF_FETCH_TIMEOUT_MS));
	let cursor = 0;
	const worker = async () => {
		while (cursor < sources.length) {
			const source = sources[cursor++];
			try {
				readable.push({ ...source, pages: await readPdfPages(source, fetchTimeoutMs) });
			} catch (error: any) {
				failures.push({ ...source, error: compactText(error?.message || error, 300) });
			}
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, Math.min(4, Number(options.concurrency) || 2)) }, worker));
	return {
		searchedSourceCount: sources.length,
		readableSourceCount: readable.length,
		// These are recall candidates only. The browser runtime gives this broad
		// pool to a model that decides semantic relevance and evidence coverage.
		retrievalCandidates: rankPdfCorpusTextPages(readable, options.evidenceSlots || [], options.maxMatchesPerSlot),
		failures: failures.slice(0, 12),
	};
}
