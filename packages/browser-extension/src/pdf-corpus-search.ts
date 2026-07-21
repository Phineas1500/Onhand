import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import type { PdfCorpusEvidenceSlot, PdfCorpusPage, PdfCorpusSource } from "./research/evidence-types";

export type { PdfCorpusEvidenceSlot, PdfCorpusPage, PdfCorpusSource } from "./research/evidence-types";

// MV3 extension service workers cannot start PDF.js's normal nested worker or
// dynamically import its fallback worker reliably. Supplying the bundled
// handler lets PDF.js use its in-process fake-worker path without opening tabs.
(globalThis as any).pdfjsWorker ||= { WorkerMessageHandler };

const DEFAULT_PDF_FETCH_TIMEOUT_MS = 15000;
const DEFAULT_MAX_PDF_BYTES = 40 * 1024 * 1024;
const DEFAULT_CORPUS_SEARCH_TIMEOUT_MS = 30000;

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

function pdfSizeLimitError() {
	return new Error("PDF exceeds the corpus-search size limit");
}

async function readResponseBytes(response: Response, controller: AbortController, maxPdfBytes: number) {
	const contentLength = Number(response.headers.get("content-length") || 0);
	if (contentLength > maxPdfBytes) {
		const error = pdfSizeLimitError();
		controller.abort(error);
		throw error;
	}
	if (!response.body) {
		const data = new Uint8Array(await response.arrayBuffer());
		if (data.byteLength > maxPdfBytes) throw pdfSizeLimitError();
		return data;
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
			byteLength += chunk.byteLength;
			if (byteLength > maxPdfBytes) {
				const error = pdfSizeLimitError();
				await reader.cancel(error).catch(() => {});
				controller.abort(error);
				throw error;
			}
			chunks.push(chunk);
		}
	} finally {
		reader.releaseLock();
	}
	const data = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		data.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return data;
}

async function readPdfPages(
	source: PdfCorpusSource,
	fetchTimeoutMs: number,
	maxPdfBytes: number,
	corpusController?: AbortController,
	corpusDeadlineAt = 0,
) {
	// Corpus candidates are normally public course/paper PDFs. Cross-origin
	// credentialed fetches from an extension worker are rejected by many servers
	// that otherwise serve the PDF, so keep the batch path credential-free. An
	// authenticated PDF can still fall back to the normal tab/viewer workflow.
	const controller = new AbortController();
	let timeoutTriggered = false;
	let corpusDeadlineTriggered = false;
	let loadingTask: any = null;
	let destroyLoadingTaskPromise: Promise<void> | null = null;
	const destroyLoadingTask = () => {
		if (!loadingTask) return Promise.resolve();
		if (!destroyLoadingTaskPromise) {
			destroyLoadingTaskPromise = Promise.resolve(loadingTask.destroy()).then(() => undefined).catch(() => undefined);
		}
		return destroyLoadingTaskPromise;
	};
	const abortForCorpusDeadline = () => {
		corpusDeadlineTriggered = true;
		controller.abort(corpusSignal?.reason || new Error("PDF corpus search deadline exceeded"));
		void destroyLoadingTask();
	};
	const corpusSignal = corpusController?.signal;
	const enforceCorpusDeadline = () => {
		if (corpusDeadlineAt > 0 && Date.now() >= corpusDeadlineAt && !corpusSignal?.aborted) {
			corpusController?.abort(new Error("PDF corpus search deadline exceeded"));
		}
		if (corpusSignal?.aborted) throw new Error("PDF corpus search deadline exceeded");
	};
	if (corpusSignal?.aborted) abortForCorpusDeadline();
	else corpusSignal?.addEventListener("abort", abortForCorpusDeadline, { once: true });
	const timeoutId = setTimeout(
		() => {
			timeoutTriggered = true;
			controller.abort(new Error(`PDF fetch timed out after ${fetchTimeoutMs}ms`));
		},
		fetchTimeoutMs,
	);
	try {
		const response = await fetch(source.url, { credentials: "omit", signal: controller.signal });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const data = await readResponseBytes(response, controller, maxPdfBytes);
		clearTimeout(timeoutId);
		enforceCorpusDeadline();
		// The corpus path extracts text only. Supplying browser font/CMap URLs makes
		// PDF.js's display-layer fetch helper read `document.baseURI`, which does not
		// exist in an MV3 service worker. Embedded text extraction works without
		// those display resources and keeps the batch reader DOM-free.
		loadingTask = getDocument({ data });
		const document = await loadingTask.promise;
		enforceCorpusDeadline();
		const pages: PdfCorpusPage[] = [];
		for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
			enforceCorpusDeadline();
			const page = await document.getPage(pageNumber);
			try {
				enforceCorpusDeadline();
				const content = await page.getTextContent();
				enforceCorpusDeadline();
				const text = (content.items as any[]).map((item) => String(item?.str || "")).filter(Boolean).join(" ");
				pages.push({ pageNumber, text: compactText(text, 24000) });
			} finally {
				page.cleanup();
			}
		}
		return pages;
	} catch (error) {
		if (timeoutTriggered) throw new Error(`PDF fetch timed out after ${fetchTimeoutMs}ms`);
		if (corpusDeadlineTriggered || corpusSignal?.aborted) throw new Error("PDF corpus search deadline exceeded");
		throw error;
	} finally {
		clearTimeout(timeoutId);
		corpusSignal?.removeEventListener("abort", abortForCorpusDeadline);
		await destroyLoadingTask();
	}
}

export async function searchPdfCorpus(options: {
	sources: PdfCorpusSource[];
	evidenceSlots: PdfCorpusEvidenceSlot[];
	maxSources?: number;
	maxMatchesPerSlot?: number;
	concurrency?: number;
	fetchTimeoutMs?: number;
	maxPdfBytes?: number;
	overallTimeoutMs?: number;
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
	const maxPdfBytes = Math.max(1024, Math.min(DEFAULT_MAX_PDF_BYTES, Number(options.maxPdfBytes) || DEFAULT_MAX_PDF_BYTES));
	const overallTimeoutMs = Number(options.overallTimeoutMs) > 0
		? Math.max(100, Math.min(120000, Number(options.overallTimeoutMs)))
		: DEFAULT_CORPUS_SEARCH_TIMEOUT_MS;
	const corpusController = new AbortController();
	const corpusDeadlineAt = Date.now() + overallTimeoutMs;
	let deadlineExceeded = false;
	const deadlineId = setTimeout(() => {
			deadlineExceeded = true;
			corpusController.abort(new Error("PDF corpus search deadline exceeded"));
		}, overallTimeoutMs);
	let cursor = 0;
	let searchedSourceCount = 0;
	const worker = async () => {
		while (cursor < sources.length && !corpusController.signal.aborted) {
			const source = sources[cursor++];
			searchedSourceCount += 1;
			try {
				readable.push({ ...source, pages: await readPdfPages(source, fetchTimeoutMs, maxPdfBytes, corpusController, corpusDeadlineAt) });
			} catch (error: any) {
				failures.push({ ...source, error: compactText(error?.message || error, 300) });
			}
		}
	};
	try {
		await Promise.all(Array.from({ length: Math.max(1, Math.min(4, Number(options.concurrency) || 2)) }, worker));
	} finally {
		clearTimeout(deadlineId);
	}
	deadlineExceeded = deadlineExceeded || corpusController.signal.aborted;
	return {
		searchedSourceCount,
		readableSourceCount: readable.length,
		deadlineExceeded,
		// These are recall candidates only. The browser runtime gives this broad
		// pool to a model that decides semantic relevance and evidence coverage.
		retrievalCandidates: rankPdfCorpusTextPages(readable, options.evidenceSlots || [], options.maxMatchesPerSlot),
		failures: failures.slice(0, 12),
	};
}
