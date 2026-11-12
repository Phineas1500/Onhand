import assert from "node:assert/strict";

// One real turn made 26 failed tool calls, 16 of them highlights whose reason
// reached telemetry only as "other". These pin what was learned from it: the
// refusals that never reach a matcher have their own reason names, a missed
// quote in Onhand's PDF viewer keeps the matcher's message, and a run of
// misses ends highlighting whatever landed earlier.
export async function runHighlightRefusalRegressions({ installChromeStorageStub }) {
	installChromeStorageStub();
	const { __browserRuntimeTest: test } = await import("../../packages/browser-extension/onhand-runtime.bundle.js");
	const failed = (toolName, error, args = {}) => ({ toolName, state: "error", error, duration_ms: 100, args });
	const reasons = (traces, context) => test.summarizeToolReliabilityForTest([], [], traces, context).tool_failure_reasons;
	const highlightReason = (error, context) => reasons([failed("browser_highlight_text", error, { text: "a private sentence" })], context);

	// Refusals, each named for its cause.
	assert.equal(highlightReason("Unsupported PDF annotation surface: PDF surface has no readable text layer"), "highlight_text:pdf_surface*1");
	assert.equal(
		highlightReason(
			"No visible text matched: a private sentence\nThis page shows a PDF in an embedded viewer that Onhand cannot mark in place. If the quote is from that PDF, open it with browser_open_pdf_in_onhand_viewer (pdfUrl: https://example.edu/handout.pdf) and highlight it there.",
		),
		"highlight_text:pdf_surface*1",
		"a miss on a page around an embedded PDF is told apart from a miss on an ordinary page",
	);
	assert.equal(highlightReason("Onhand page tools only run on web or local-file tabs, not New Tab"), "highlight_text:tab_kind*1");
	assert.equal(highlightReason("This page has extractable text; anchor with an exact text quote instead of a region."), "highlight_text:region*1");
	assert.equal(highlightReason("A region highlight requires pdfAnchor.pageNumber."), "highlight_text:region*1");
	assert.equal(highlightReason("highlight_text requires a non-empty 'text'"), "highlight_text:bad_args*1");
	assert.equal(
		reasons([failed("browser_open_pdf_in_onhand_viewer", "This tab is a web page, not a PDF file, although its address looks like one, so it was not opened in Onhand's PDF viewer.")]),
		"open_pdf_in_onhand_viewer:not_pdf*1",
	);
	assert.equal(reasons([failed("browser_open_pdf_in_onhand_viewer", "Could not determine a PDF URL for the Onhand viewer. Open a direct PDF tab.")]), "open_pdf_in_onhand_viewer:not_pdf*1");
	assert.equal(reasons([failed("browser_pdf_read_pages", "No PDF page text returned.")]), "pdf_read_pages:pdf_load*1");
	assert.equal(reasons([failed("browser_open_pdf_in_onhand_viewer", "Onhand PDF viewer failed to load the PDF: Invalid PDF structure.")]), "open_pdf_in_onhand_viewer:pdf_load*1");
	assert.equal(
		reasons([failed("browser_open_pdf_in_onhand_viewer", "Onhand PDF viewer failed to load the PDF: Unexpected server response (403).")]),
		"open_pdf_in_onhand_viewer:network*1",
		"a refused download stays a network failure",
	);
	// The page scan's message means the quote is nowhere on the page: a miss.
	assert.equal(highlightReason("Saved source text is not currently loaded in this page: a private sentence", { pdf: true }), "highlight_text:no_match_pdf*1");
	// The older reasons are what they were.
	assert.equal(highlightReason("No visible text matched: a private sentence"), "highlight_text:no_match*1");
	assert.equal(highlightReason("browser_highlight_text tool call timed out after 12000ms"), "highlight_text:timeout*1");
	assert.equal(highlightReason("Something nobody has seen before"), "highlight_text:other*1");
	for (const entry of [
		highlightReason("Unsupported PDF annotation surface: PDF surface has no readable text layer"),
		highlightReason("Onhand page tools only run on web or local-file tabs, not New Tab"),
		highlightReason("A region highlight requires pdfAnchor.pageNumber."),
		reasons([failed("browser_open_pdf_in_onhand_viewer", "This tab is a web page, not a PDF file, although its address looks like one.")]),
		reasons([failed("browser_pdf_read_pages", "No PDF page text returned.")]),
	]) {
		assert.match(entry, /^[a-z0-9_]{1,48}:[a-z_]{1,16}\*\d{1,3}$/, `the worker accepts ${entry}`);
	}

	// Onhand's viewer searches the whole PDF itself, so a missed quote there
	// isn't followed by a scroll through the tab.
	const onViewer = test.highlightTargetIsOnhandPdfViewerForTest;
	const done = (toolName, details) => ({ toolName, state: "complete", resultDetails: details });
	const pdfRead = done("browser_pdf_read_pages", { tab: { id: 7, url: "https://example.edu/paper.pdf" } });
	assert.equal(onViewer({ toolTraces: [pdfRead] }, 7), true, "a PDF read on the tab this turn");
	assert.equal(onViewer({ toolTraces: [pdfRead] }, 8), false, "another tab is not that viewer");
	assert.equal(onViewer({ toolTraces: [done("browser_open_pdf_in_onhand_viewer", { tab: { id: 7 } })] }, 7), true);
	assert.equal(onViewer({ toolTraces: [done("browser_highlight_text", { tab: { id: 7 }, annotation: { kind: "pdf" } })] }, 7), true, "a PDF highlight landed there");
	assert.equal(onViewer({ toolTraces: [{ ...pdfRead, state: "error" }] }, 7), false, "a failed PDF read proves nothing");
	assert.equal(
		onViewer({ toolTraces: [done("browser_extract_content", { tab: { id: 7, url: "https://example.edu/article" } })] }, 7),
		false,
		"a web page keeps its scan (text that loads on scroll)",
	);
	assert.equal(onViewer({ toolTraces: [], initialActiveTab: { id: 9, url: "chrome-extension://onhand-test/pdf-viewer.html?url=https%3A%2F%2Fexample.edu%2Fpaper.pdf" } }, 9), true);
	assert.equal(onViewer({ toolTraces: [pdfRead] }, 0), false);

	// When the scan does run and finds nothing, the matcher's miss is the one
	// the model and the miss reasons get.
	const prefer = test.preferredHighlightMissErrorForTest;
	const weakMiss = new Error('No visible text matched the quoted passage; the closest text only shares part of it: "x".');
	const notLoaded = new Error("Saved source text is not currently loaded in this page: a private sentence");
	const timedOut = new Error("browser_highlight_text timed out after 12000ms");
	assert.equal(prefer(weakMiss, notLoaded), weakMiss);
	assert.equal(prefer(null, notLoaded), notLoaded, "with nothing better, the scan's message stands");
	assert.equal(prefer(weakMiss, timedOut), timedOut, "any other scan failure is still reported");
	assert.equal(prefer(weakMiss, null), weakMiss);

	// The failure limit.
	const guard = (toolTraces) => test.buildRepeatedHighlightFailureGuardResultForTest("browser_highlight_text", "highlight_text", { displayPrompt: "Take notes on this chapter for me.", toolTraces });
	const miss = () => failed("browser_highlight_text", "No visible text matched: a private sentence");
	const landed = () => ({ toolName: "browser_highlight_text", state: "complete", resultSummary: 'Highlighted "x" on Chapter 3 [tabId 1]. annotationId: onhand-1-a' });
	const blocked = () => ({ ...miss(), resultDetails: { guardrail: { kind: "weak_structured_highlight_text" } } });
	const switchTab = (url) => ({ toolName: "browser_activate_tab", state: "complete", resultDetails: { tab: { id: 2, url } } });
	const times = (count, make) => Array.from({ length: count }, make);

	assert.equal(guard(times(3, miss)), null);
	assert.match(guard(times(4, miss)).guardrail.message, /durable source highlights are not available here/, "four misses with nothing landed: as before");

	assert.equal(guard([landed(), ...times(3, miss)]), null, "three misses after a landed highlight may still be bad luck");
	const afterLanded = guard([landed(), ...times(4, miss)]);
	assert.equal(afterLanded?.guardrail?.kind, "repeated_highlight_failure", "four misses in a row end highlighting even after one landed");
	assert.match(afterLanded.guardrail.message, /Keep the highlights that landed/);
	assert.doesNotMatch(afterLanded.guardrail.message, /not available here/, "highlights do work on this page");
	assert.equal(guard([landed(), ...times(3, miss), landed(), ...times(3, miss)]), null, "a landed highlight starts the run again");
	assert.equal(guard([landed(), ...times(3, miss), ...times(5, blocked)]), null, "attempts a guard turned away are not misses");

	// Over the whole turn, whatever landed and whichever pages were tried.
	const interleaved = [];
	for (let index = 0; index < 8; index += 1) interleaved.push(landed(), miss());
	assert.equal(guard(interleaved.slice(0, 14)), null, "seven scattered misses among landed highlights");
	assert.equal(guard(interleaved)?.guardrail?.kind, "repeated_highlight_failure", "eight misses in one turn end highlighting");
	const acrossPages = [...times(4, miss), switchTab("https://example.edu/reader/chapter-3"), ...times(3, miss), switchTab("https://example.edu/reader/chapter-4")];
	assert.equal(guard(acrossPages), null, "a new page gets its own tries");
	const stopped = guard([...acrossPages, miss()]);
	assert.equal(stopped?.guardrail?.kind, "repeated_highlight_failure", "switching pages no longer buys tries without end");
	assert.match(stopped.guardrail.message, /Answer the user's question now/);
	assert.doesNotMatch(stopped.guardrail.message, /Keep the highlights that landed/, "nothing landed to keep");
	assert.equal(test.buildRepeatedHighlightFailureGuardResultForTest("browser_show_note", "show_note", { displayPrompt: "Take notes.", toolTraces: [landed(), ...times(9, miss)] }), null, "notes are not highlights");
	console.log("Highlight refusal reasons, the viewer scan skip and the failure limit passed");
}
