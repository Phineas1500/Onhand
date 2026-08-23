import assert from "node:assert/strict";
import { __browserRuntimeTest } from "../packages/browser-extension/onhand-runtime.bundle.js";

const {
	buildSavedArtifactEvidenceRepresentationForTest: buildEvidenceSource,
	buildSavedSourceRepresentationForTest: buildSource,
	searchSavedSourceArtifactsForTest: searchSources,
	formatSavedSourceSearchForModelForTest: formatSearch,
	getToolNamesForTest,
} = __browserRuntimeTest;

assert.equal(typeof buildSource, "function", "source-memory normalizer test hook is missing");
assert.equal(typeof buildEvidenceSource, "function", "session-evidence projection test hook is missing");
assert.equal(typeof searchSources, "function", "source-memory search test hook is missing");

const capturedAt = "2026-08-19T12:00:00.000Z";
const articleSource = buildSource({
	capturedAt,
	tab: { title: "Calibration field notes", url: "https://fixtures.onhand.test/calibration#results" },
	page: { title: "Calibration field notes", url: "https://fixtures.onhand.test/calibration#results" },
	extraction: {
		title: "Calibration field notes",
		url: "https://fixtures.onhand.test/calibration#results",
		blocks: [
			{ tag: "h2", selector: "#results", text: "Results" },
			{
				tag: "p",
				selector: "#results + p",
				text: "The calibration remains stable because every reading is compared with the same reference window.",
			},
		],
	},
});

assert.ok(articleSource, "readable HTML should create a source representation");
assert.equal(articleSource.schemaVersion, 1);
assert.equal(articleSource.sourceKind, "html");
assert.equal(articleSource.captureScope, "full-source");
assert.equal(articleSource.sourceUrl, "https://fixtures.onhand.test/calibration", "URL fragments should not create duplicate saved sources");
assert.equal(articleSource.blocks.length, 2);
assert.match(articleSource.contentFingerprint, /^fnv1a-[a-f0-9]{16}$/);

const articleSourceAgain = buildSource({
	capturedAt: "2026-08-20T12:00:00.000Z",
	tab: { title: "Calibration field notes", url: "https://fixtures.onhand.test/calibration" },
	extraction: {
		title: "Calibration field notes",
		url: "https://fixtures.onhand.test/calibration",
		blocks: articleSource.blocks,
	},
});
assert.equal(articleSourceAgain.contentFingerprint, articleSource.contentFingerprint, "capture time must not alter the content fingerprint");

const articleSourceRelabeled = buildSource({
	tab: { title: "Renamed mirror", url: "https://mirror.onhand.test/calibration" },
	extraction: {
		title: "Renamed mirror",
		url: "https://mirror.onhand.test/calibration",
		blocks: articleSource.blocks,
	},
});
assert.equal(articleSourceRelabeled.contentFingerprint, articleSource.contentFingerprint, "title and URL changes must not masquerade as content drift");

const changedArticleSource = buildSource({
	tab: { title: "Calibration field notes", url: "https://fixtures.onhand.test/calibration" },
	extraction: {
		title: "Calibration field notes",
		url: "https://fixtures.onhand.test/calibration",
		blocks: [{ tag: "p", text: "The calibration now uses a rolling reference window." }],
	},
});
assert.notEqual(changedArticleSource.contentFingerprint, articleSource.contentFingerprint, "content drift must change the fingerprint");

const sessionEvidenceArtifact = {
	id: "artifact_session_evidence",
	createdAt: capturedAt,
	label: "Review snapshot: calibration question",
	tab: { title: "Calibration field notes", url: "https://fixtures.onhand.test/calibration" },
	page: {
		title: "Calibration field notes",
		url: "https://fixtures.onhand.test/calibration",
		capturedAt,
		annotations: [
			{
				annotationId: "calibration-evidence",
				kind: "inline",
				matchedText: "every reading is compared with the same reference window",
				anchor: {
					selector: "#results + p",
					textQuote: {
						prefix: "The calibration remains stable because ",
						exact: "every reading is compared with the same reference window",
						suffix: ". Subsequent measurements use the same procedure.",
					},
				},
				note: { text: "This note must not become source evidence.", label: "Onhand" },
			},
		],
	},
};
const sessionEvidenceSource = buildEvidenceSource(sessionEvidenceArtifact);
assert.ok(sessionEvidenceSource, "existing artifact annotations should project into searchable session evidence");
assert.equal(sessionEvidenceSource.captureScope, "session-evidence");
assert.equal(sessionEvidenceSource.extractorVersion, "onhand-session-evidence-v1");
assert.equal(sessionEvidenceSource.sourceKind, "html");
assert.match(sessionEvidenceSource.blocks[0].text, /calibration remains stable because every reading/);
assert.equal(sessionEvidenceSource.blocks[0].selector, "#results + p");
assert.equal(
	searchSources([sessionEvidenceArtifact], "same reference window", { limit: 5 })[0]?.captureScope,
	"session-evidence",
	"search should use existing evidence-only artifacts without storing a full source representation",
);
assert.deepEqual(searchSources([sessionEvidenceArtifact], "must become source evidence", { limit: 5 }), [], "interpretive note text must not masquerade as source evidence");
assert.equal(buildEvidenceSource({ id: "artifact_without_evidence", page: { annotations: [] } }), null);

const pdfSessionEvidenceArtifact = {
	id: "artifact_pdf_session_evidence",
	createdAt: capturedAt,
	tab: { title: "Attention paper", url: "chrome-extension://fixture/pdf-viewer.html" },
	page: {
		title: "Attention paper",
		url: "chrome-extension://fixture/pdf-viewer.html",
		annotations: [
			{
				annotationId: "attention-heads",
				kind: "pdf",
				matchedText: "we employ h = 8 parallel attention layers",
				pdfAnchor: {
					surface: "pdf",
					pageNumber: 5,
					textQuote: { exact: "we employ h = 8 parallel attention layers" },
					document: { pdfUrl: "https://fixtures.onhand.test/papers/attention.pdf" },
				},
			},
		],
	},
};
const pdfSessionEvidenceSource = buildEvidenceSource(pdfSessionEvidenceArtifact);
assert.equal(pdfSessionEvidenceSource.sourceKind, "pdf");
assert.equal(pdfSessionEvidenceSource.sourceUrl, "https://fixtures.onhand.test/papers/attention.pdf");
assert.equal(pdfSessionEvidenceSource.blocks[0].pageNumber, 5);
assert.equal(searchSources([pdfSessionEvidenceArtifact], "8 parallel attention layers")[0]?.pageNumber, 5);

const pdfSource = buildSource({
	capturedAt,
	tab: { title: "Retrieval paper", url: "https://fixtures.onhand.test/papers/a.pdf" },
	extraction: {
		surface: "pdf",
		title: "Retrieval paper",
		url: "https://fixtures.onhand.test/papers/a.pdf",
		blocks: [
			{ tag: "pdf-page", pageNumber: 4, text: "Paper A precomputes compressed document vectors and searches them with an approximate index." },
			{ tag: "pdf-page", pageNumber: 9, text: "The evaluation reports recall and query latency." },
		],
	},
});
assert.equal(pdfSource.sourceKind, "pdf");
assert.equal(pdfSource.blocks[0].pageNumber, 4);
assert.equal(pdfSource.blocks[0].id, "p4-b1");

const longPdfSource = buildSource({
	capturedAt,
	tab: { title: "Long lecture page", url: "https://fixtures.onhand.test/notes/trees.pdf" },
	extraction: {
		surface: "pdf",
		title: "Long lecture page",
		url: "https://fixtures.onhand.test/notes/trees.pdf",
		blocks: [
			{
				tag: "pdf-page",
				pageNumber: 5,
				text: `${"Early regularization discussion covers depth limits and leaf counts. ".repeat(32)}Later, pruning evaluates whether the increased performance is worth the extra model size. If not, it merges the nodes back into the tree.`,
			},
		],
	},
});
assert.ok(longPdfSource.blocks.length > 1, "long PDF pages should be split into searchable page-numbered passages");
assert.ok(longPdfSource.blocks.every((block) => block.pageNumber === 5));
assert.ok(longPdfSource.blocks.every((block) => block.text.length <= 1_200));
const longPdfResults = searchSources([{ id: "artifact_long_pdf", source: longPdfSource }], "pruning increased performance extra model size merges nodes", { sourceKinds: ["pdf"] });
assert.match(longPdfResults[0].text, /pruning evaluates whether the increased performance/);
assert.equal(longPdfResults[0].pageNumber, 5);

const adjacentPdfSource = buildSource({
	capturedAt,
	tab: { title: "Decision-tree notes", url: "https://fixtures.onhand.test/notes/decision-trees.pdf" },
	extraction: {
		surface: "pdf",
		title: "Decision-tree notes",
		url: "https://fixtures.onhand.test/notes/decision-trees.pdf",
		blocks: [
			{ tag: "pdf-page", pageNumber: 5, text: "Excessive depth creates the twin problems of overfitting and an undesirably large model." },
			{ tag: "pdf-page", pageNumber: 5, text: "Pruning evaluates whether increased performance is worth extra model size and reduced generalization, then merges nodes back into the tree." },
		],
	},
});
const adjacentPdfResults = searchSources(
	[{ id: "artifact_adjacent_pdf", source: adjacentPdfSource }],
	"what pruning evaluates and does",
	{ sourceKinds: ["pdf"], limit: 5 },
);
assert.match(adjacentPdfResults[0].text, /Pruning evaluates/);
assert.match(
	adjacentPdfResults.map((result) => result.text).join("\n"),
	/twin problems of overfitting and an undesirably large model/,
	"a PDF search should include adjacent same-page context when the answer crosses a passage boundary",
);

const pageBreakPdfSource = buildSource({
	capturedAt,
	tab: { title: "Attention paper", url: "https://fixtures.onhand.test/papers/attention.pdf" },
	extraction: {
		surface: "pdf",
		title: "Attention paper",
		url: "https://fixtures.onhand.test/papers/attention.pdf",
		blocks: [
			{ tag: "pdf-page", pageNumber: 4, text: "The queries, keys, and values use different learned linear projections." },
			{ tag: "pdf-page", pageNumber: 5, text: "The main model employs eight heads with 64-dimensional keys and values per head." },
		],
	},
});
const pageBreakPdfResults = searchSources(
	[{ id: "artifact_page_break_pdf", source: pageBreakPdfSource }],
	"different learned linear projections",
	{ sourceKinds: ["pdf"], limit: 5 },
);
assert.match(
	pageBreakPdfResults.map((result) => result.text).join("\n"),
	/eight heads with 64-dimensional keys and values per head/,
	"a PDF search should retain adjacent context across a page break",
);

assert.equal(buildSource({ extraction: { unsupported: true, reason: "blocked", blocks: [] } }), null);
assert.equal(buildSource({ extraction: { blocks: [], text: "" } }), null);

const artifacts = [
	{ id: "artifact_article", createdAt: capturedAt, label: "Calibration", source: articleSource },
	{ id: "artifact_pdf", createdAt: capturedAt, label: "Paper A", source: pdfSource },
	{
		id: "artifact_distractor",
		createdAt: capturedAt,
		label: "Billing notes",
		source: buildSource({
			capturedAt,
			tab: { title: "Billing notes", url: "https://fixtures.onhand.test/billing" },
			extraction: { blocks: [{ tag: "p", text: "The billing dashboard caches monthly summaries." }] },
		}),
	},
];

const calibrationResults = searchSources(artifacts, "same reference window", { limit: 5 });
assert.equal(calibrationResults[0].artifactId, "artifact_article");
assert.match(calibrationResults[0].text, /same reference window/);
assert.equal(calibrationResults.some((result) => result.artifactId === "artifact_distractor"), false);

const explicitSourceWithEvidence = {
	...sessionEvidenceArtifact,
	id: "artifact_explicit_with_evidence",
	source: articleSource,
};
const explicitSourceResults = searchSources([explicitSourceWithEvidence], "same reference window", { limit: 5 });
assert.equal(explicitSourceResults.every((result) => result.captureScope === "full-source"), true, "explicit full-source content should take precedence over its duplicate annotation projection");

const titleOnlyResults = searchSources(artifacts, "Calibration field notes", { limit: 2 });
assert.equal(titleOnlyResults[0].artifactId, "artifact_article", "source-title searches should recover body blocks from that saved source");

const pdfResults = searchSources(artifacts, "compressed vectors approximate index", { sourceKinds: ["pdf"] });
assert.equal(pdfResults.length, 1);
assert.equal(pdfResults[0].artifactId, "artifact_pdf");
assert.equal(pdfResults[0].pageNumber, 4);

const filteredOut = searchSources(artifacts, "reference window", { artifactIds: ["artifact_pdf"] });
assert.deepEqual(filteredOut, []);

const formatted = formatSearch({ query: "reference window", results: calibrationResults });
assert.match(formatted, /saved snapshots, not proof of the current live page/i);
assert.match(formatted, /stop using browser tools and answer from these passages now/i);
assert.match(formatted, /Do not search again, navigate to, reopen, highlight, annotate, or add notes/i);
assert.match(formatted, /artifact_article/);
assert.match(formatted, /captured 2026-08-19/);

const formattedPdf = formatSearch({ query: "compressed vectors", results: pdfResults });
assert.match(formattedPdf, /matching saved PDF passage and its saved page number are sufficient evidence/i);
assert.match(formattedPdf, /saved result is already the durable provenance marker/i);
assert.match(formattedPdf, /do not restore, reopen, search again, highlight, annotate, or add notes/i);

const ordinaryTools = getToolNamesForTest("What does this page say?");
assert.equal(ordinaryTools.includes("browser_search_saved_sources"), false, "source-memory tools must stay absent while the experiment is off");
assert.equal(ordinaryTools.includes("browser_delete_artifact"), false, "deletion tool must stay absent while the experiment is off");

const sourceMemoryTools = getToolNamesForTest("Compare my saved sources", false, null, { sourceMemoryEnabled: true });
assert.equal(sourceMemoryTools.includes("browser_search_saved_sources"), true);
assert.equal(sourceMemoryTools.includes("browser_delete_artifact"), true);

const savedOnlyTools = getToolNamesForTest("Answer only from the research paper I saved earlier.", false, null, { sourceMemoryEnabled: true });
assert.deepEqual(savedOnlyTools, ["browser_search_saved_sources"], "an explicit saved-only question must not expose live-page or annotation tools");

const deletionTools = getToolNamesForTest("Delete only the saved artifact I named.", false, null, { sourceMemoryEnabled: true });
assert.equal(deletionTools.includes("browser_delete_artifact"), true, "saved-only retrieval gating must not block explicit deletion requests");

console.log("Source memory regressions: PASS");
