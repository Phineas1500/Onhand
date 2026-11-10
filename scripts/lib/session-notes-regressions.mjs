import assert from "node:assert/strict";

// Copy notes / Download notes: a session's highlights, notes and answers as
// Markdown, grouped by page, without Onhand's internal citation markers.
export async function runSessionNotesRegressions({ installChromeStorageStub }) {
	installChromeStorageStub();
	const { __browserRuntimeTest: test } = await import("../../packages/browser-extension/onhand-runtime.bundle.js");
	const highlight = (id, text, page) => ({ key: `highlight:${id}`, type: "annotation", annotationId: id, label: "Highlighted text", detail: text.slice(0, 72), citationText: text, ...page });
	const note = (id, text, page) => ({ key: `note:${id}`, type: "note", annotationId: id, label: "Added note", detail: text.slice(0, 72), citationText: text, ...page });
	const article = { title: "Why leaves change color", url: "https://example.test/leaves" };
	const paper = { title: "attention.pdf", url: "chrome-extension://abc/pdf-viewer.html?url=https%3A%2F%2Fexample.test%2Fattention.pdf" };
	const paperHighlight = highlight("p1", "Self-attention relates different positions of a single sequence.", { ...paper, pdfAnchor: { pageNumber: 2 } });
	const session = {
		id: "session-1",
		name: "Autumn leaves",
		createdAt: "2026-11-09T10:00:00.000Z",
		updatedAt: "2026-11-09T10:05:00.000Z",
		messages: [],
		// The session keeps the latest turn's actions here too; pages still
		// come out in the order they were read.
		pageActions: [paperHighlight],
		artifactIds: [],
		turns: [
			{
				id: "t1",
				userPrompt: "Why do leaves turn yellow?",
				reply: "Chlorophyll breaks down, so the **carotenoids** show. [[cite:a1]]\n\n- They were there all along. [[cite:a2]]",
				pageActions: [
					highlight("a1", "As days shorten, trees stop making chlorophyll.", article),
					note("a1", "This is the trigger.", article),
					highlight("a2", "Yellow and orange carotenoids become visible.", article),
					{ key: "scroll:a1", type: "annotation", annotationId: "a1", label: "Moved to section", detail: "Brought the relevant part of the page into view", ...article },
				],
				pending: false,
				error: false,
			},
			{
				id: "t2",
				userPrompt: "[Voice] What does the paper say about attention?",
				reply: "It relates positions of one sequence. [[cite:p1]]",
				pageActions: [paperHighlight],
				pending: false,
				error: false,
			},
			{ id: "t3", userPrompt: "And this?", reply: "Error: the model call failed.", pageActions: [], pending: false, error: true },
		],
	};
	const notes = test.buildSessionNotesMarkdownForTest(session, new Date(2026, 10, 9));
	assert.equal(
		notes.markdown,
		[
			"# Autumn leaves",
			"",
			"Notes from Onhand, November 9, 2026",
			"",
			"## Why leaves change color",
			"",
			"<https://example.test/leaves>",
			"",
			"> As days shorten, trees stop making chlorophyll.",
			"",
			"Note: This is the trigger.",
			"",
			"> Yellow and orange carotenoids become visible.",
			"",
			"## attention.pdf",
			"",
			"<https://example.test/attention.pdf>",
			"",
			"> Self-attention relates different positions of a single sequence. (p. 2)",
			"",
			"## Questions and answers",
			"",
			"### Why do leaves turn yellow?",
			"",
			"Chlorophyll breaks down, so the **carotenoids** show.\n\n- They were there all along.",
			"",
			"### What does the paper say about attention?",
			"",
			"It relates positions of one sequence.",
			"",
		].join("\n"),
	);
	assert.deepEqual([notes.highlightCount, notes.noteCount, notes.questionCount], [3, 1, 2]);
	assert.equal(notes.fileName, "onhand-notes-autumn-leaves.md");

	const untitled = test.buildSessionNotesMarkdownForTest({ ...session, name: null, turns: [], pageActions: [] }, new Date(2026, 10, 9));
	assert.equal(untitled.markdown, "# Onhand notes\n\nNotes from Onhand, November 9, 2026\n");
	assert.equal(untitled.fileName, "onhand-notes.md");
	console.log("Session notes export as Markdown passed");
}
