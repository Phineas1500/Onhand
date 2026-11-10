import assert from "node:assert/strict";

// A missed highlight reports which kind of miss it was, as a fixed word and
// never the text; and the helpers that retry a missed quote work in scripts
// other than Latin (they once counted A-Z words only).
export async function runHighlightMissRegressions({ installChromeStorageStub }) {
	installChromeStorageStub();
	const { __browserRuntimeTest: test } = await import("../../packages/browser-extension/onhand-runtime.bundle.js");
	const failed = (error, args = {}) => ({ toolName: "browser_highlight_text", state: "error", error, duration_ms: 100, args });
	const reasons = (traces, context) => test.summarizeToolReliabilityForTest([], [], traces, context).tool_failure_reasons;

	assert.equal(reasons([failed("No visible text matched: a private sentence", { text: "a private sentence" })]), "highlight_text:no_match*1");
	assert.equal(
		reasons([failed('No visible text matched the quoted passage; the closest text only shares part of it: "another private sentence".', { text: "a private sentence" })]),
		"highlight_text:weak*1",
		"a quote that wasn't the page's words is told apart from text that isn't there",
	);
	assert.equal(reasons([failed("No visible text matched: 光合成とは光エネルギーを変換する反応", { text: "光合成とは光エネルギーを変換する反応" })]), "highlight_text:no_match_nl*1");
	assert.equal(reasons([failed("No visible text matched: a private sentence", { text: "a private sentence" })], { pdf: true }), "highlight_text:no_match_pdf*1");
	assert.equal(reasons([failed("No visible text matched: Таким образом результат", { text: "Таким образом результат", pdfAnchor: { pageNumber: 3 } })]), "highlight_text:no_match_pdf_nl*1");
	assert.equal(reasons([failed("That passage is on the page but hidden (in a collapsed or inactive section), so it cannot be highlighted.", { text: "x" })]), "highlight_text:hidden*1");
	assert.equal(reasons([failed("No visible text matched that formula: rendered math rarely reads back as the same text.", { text: "E = mc^2" })]), "highlight_text:formula*1");
	for (const summary of [
		reasons([failed("No visible text matched: 光合成とは光エネルギーを変換する反応", { text: "光合成とは光エネルギーを変換する反応" })], { pdf: true }),
		reasons([failed('No visible text matched the quoted passage; the closest text only shares part of it: "x".', { text: "Таким образом результат" })], { pdf: true }),
	]) {
		for (const entry of summary.split(",")) assert.match(entry, /^[a-z0-9_]{1,48}:[a-z_]{1,16}\*\d{1,3}$/, `the worker accepts ${entry}`);
	}

	// Retry fragments for a two-sentence quote, in several scripts.
	const fragments = test.buildHighlightRetryCandidatesForTest;
	assert.deepEqual(
		fragments("Таким образом, фотосинтез преобразует энергию света. Этот процесс происходит в хлоропластах растений."),
		["Таким образом, фотосинтез преобразует энергию света.", "Этот процесс происходит в хлоропластах растений."],
	);
	assert.deepEqual(
		fragments("光合成は光エネルギーを化学エネルギーに変換する。この反応は葉緑体の中で行われる。"),
		["光合成は光エネルギーを化学エネルギーに変換する。", "この反応は葉緑体の中で行われる。"],
	);
	assert.equal(fragments("يتغذى الحيوان على المنتجات النباتية؟ نعم، وكذلك الكائنات الحية الدقيقة والفطريات.").length, 2);
	assert.deepEqual(
		fragments("React runs the cleanup function first. Then it runs the setup function with the new values."),
		["React runs the cleanup function first.", "Then it runs the setup function with the new values.", "Then it runs the setup function"],
		"English fragments are what they were",
	);

	const complete = test.looksLikeCompleteSentenceForTest;
	assert.equal(complete("Таким образом, фотосинтез преобразует энергию света в химическую."), true);
	assert.equal(complete("光合成は光エネルギーを化学エネルギーに変換する。"), true);
	assert.equal(complete("प्रकाश-संश्लेषण वह क्रिया है जिसमें पौधे अपना भोजन बनाते हैं।"), true);
	assert.equal(complete("фотосинтез преобразует энергию"), false, "a fragment without a full stop is not a sentence");
	assert.equal(complete("React runs the cleanup function first."), true);
	assert.equal(complete("runs the cleanup function"), false);

	const split = test.splitReadablePhraseCandidatesForTest;
	const japanese = split("光合成は光エネルギーを化学エネルギーに変換する反応である。この反応は植物の葉緑体の中で行われることが知られている。");
	assert.ok(japanese.includes("光合成は光エネルギーを化学エネルギーに変換する反応である。"), "a Japanese block splits into its sentences");
	const russian = split("Таким образом, фотосинтез преобразует энергию света. Этот процесс происходит в хлоропластах растений.");
	assert.ok(russian.includes("Этот процесс происходит в хлоропластах растений."), "a Russian block splits into its sentences");
	// A whole sentence is not a "title or heading", whatever its language. The
	// guard knew a few English verbs and took a sentence with a dash or colon
	// and none of them for a heading, blocking the mark and costing a round.
	const weak = (text) => test.looksLikeWeakCompactTeachingHighlightTextForTest(text, { initialActiveTab: { title: "Photosynthesis - Wikipedia" } });
	assert.equal(weak("प्रकाश-संश्लेषण वह क्रिया है जिसमें पौधे सूर्य के प्रकाश में अपना भोजन बनाते हैं।"), false);
	assert.equal(weak("光合成（こうごうせい、英語: photosynthesis）とは、光エネルギーを化学エネルギーに変換する反応である。"), false);
	assert.equal(weak("The light-dependent reactions occur in the thylakoid membranes of the chloroplast."), false);
	assert.equal(weak("Light-dependent reactions: an overview"), true, "a heading is still too weak");
	assert.equal(weak("Photosynthesis - Wikipedia"), true, "so is the page title");
	assert.equal(weak(""), true);
	console.log("Highlight miss reasons, non-Latin retry fragments and the weak-marker guard passed");
}
