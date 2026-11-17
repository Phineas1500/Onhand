import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Every note on a page used to be headed "Onhand". A note now carries a short
// title saying what it is about, whether it is added with its highlight or on
// its own, and the title stays with the note when a session is saved,
// restored or exported.
export async function runNoteTitleRegressions({ installChromeStorageStub }) {
	installChromeStorageStub();
	const { __browserRuntimeTest: test } = await import("../../packages/browser-extension/onhand-runtime.bundle.js");

	// What counts as a title.
	const title = test.compactOnPageNoteTitleForTest;
	assert.equal(title("Why L2 helps"), "Why L2 helps");
	assert.equal(title("  **Isolate x:**  "), "Isolate x", "Markdown and closing punctuation are dropped, casing is kept");
	assert.equal(title('"The pH buffer."'), "The pH buffer");
	assert.equal(title("# Chain rule"), "Chain rule");
	assert.equal(title("Why does it converge?"), "Why does it converge?", "a question keeps its mark");
	assert.equal(title("注意力机制的作用"), "注意力机制的作用", "titles need not be in English");
	for (const standIn of ["", "   ", "Onhand", "onhand note", "Note", "Notes:", "Untitled", "N/A"]) {
		assert.equal(title(standIn), "", `${JSON.stringify(standIn)} is not a title`);
	}
	assert.equal(title("Chain rule: multiply the outer derivative by the inner derivative"), "Chain rule", "a long title keeps its leading phrase");
	assert.equal(title("This passage explains why the second term dominates when n grows large"), "", "a sentence is not a title");
	assert.equal(title("Note: the second term dominates the whole sum as n grows"), "", "a stand-in leading phrase is not a title either");

	// What a note call asks the page to draw.
	const prepare = test.onPageNoteParamsForTest;
	assert.deepEqual(prepare({ annotationId: "a1", note: "The penalty shrinks large weights.", label: "Why L2 helps." }), {
		annotationId: "a1",
		note: "The penalty shrinks large weights.",
		label: "Why L2 helps",
	});
	assert.deepEqual(prepare({ annotationId: "a1", note: "The penalty shrinks large weights." }), { annotationId: "a1", note: "The penalty shrinks large weights." }, "no title, no label: the page draws its plain header");
	assert.deepEqual(prepare({ annotationId: "a1", note: "The penalty shrinks large weights.", label: "Note" }), { annotationId: "a1", note: "The penalty shrinks large weights." });
	assert.equal(prepare({ note: "Why L2 helps: the penalty shrinks large weights.", label: "Why L2 helps" }).note, "The penalty shrinks large weights.", "a note does not repeat its title");
	assert.equal(prepare({ note: "**Why L2 helps** — the penalty shrinks large weights.", label: "Why L2 helps" }).note, "The penalty shrinks large weights.");
	assert.equal(prepare({ note: "Why L2 helps the model generalize to unseen data.", label: "Why L2 helps" }).note, "Why L2 helps the model generalize to unseen data.", "a sentence that merely starts with the title's words is left alone");
	assert.equal(prepare({ note: "Why L2 helps: yes.", label: "Why L2 helps" }).note, "Why L2 helps: yes.", "nothing is cut when too little would remain");
	assert.deepEqual(prepare({ annotationId: "a1", label: "Only a label was given here." }), { annotationId: "a1", note: "Only a label was given here." }, "a call with only a label still shows it as the note");
	assert.deepEqual(prepare({ tabId: 4, annotationId: "a1", note: "The penalty shrinks large weights.", noteTitle: "Why L2 helps" }), {
		tabId: 4,
		annotationId: "a1",
		note: "The penalty shrinks large weights.",
		label: "Why L2 helps",
	}, "the highlight tool's name for the title is understood");

	// The model is asked for a title on both ways of adding a note.
	const commands = [];
	const host = {
		async runCommand(name, args) {
			commands.push({ name, args });
			if (name === "highlight_text") return { tab: { id: 5, title: "Page", url: "https://example.test/" }, annotation: { annotationId: `onhand-${commands.length}`, matchedText: args.text } };
			if (name === "show_note") return { tab: { id: 5 }, note: { annotationId: args.annotationId, text: args.note, label: args.label || "Onhand" } };
			return {};
		},
	};
	const recorded = [];
	const tools = test.createToolsForTest(host, {}, (params, commandName) => (commandName === "show_note" ? prepare(params) : params), undefined, () => {}, () => null, async () => null,
		(toolName, toolCallId, args, effectiveArgs, result, isError) => recorded.push({ toolName, toolCallId, args, effectiveArgs, result, isError }));
	const highlight = tools.find((tool) => tool.name === "browser_highlight_text");
	const showNote = tools.find((tool) => tool.name === "browser_show_note");
	assert.match(highlight.parameters.properties.noteTitle?.description || "", /Title shown above the note: two to four words[\s\S]*Set it whenever note is set/);
	assert.match(showNote.parameters.properties.label?.description || "", /Title shown above the note: two to four words[\s\S]*Give every note one/);
	assert.match(test.systemPromptForTest, /only on highlights that carry explanatory weight[^\n]*Give every note a title \(two to four words saying what this note is about[^\n]*Do not repeat the title at the start of the note\./, "the system prompt asks for note titles");

	await highlight.execute("h1", { text: "L2 regularization adds a penalty on large weights.", note: "The penalty shrinks large weights.", noteTitle: "Why L2 helps" });
	const highlightCommand = commands.find((call) => call.name === "highlight_text");
	assert.equal(highlightCommand.args.note, undefined);
	assert.equal(highlightCommand.args.noteTitle, undefined, "the title is not sent with the highlight command");
	assert.deepEqual(commands.find((call) => call.name === "show_note").args, { annotationId: "onhand-1", note: "The penalty shrinks large weights.", label: "Why L2 helps" }, "a note added with its highlight carries its title");
	assert.equal(recorded[0].toolName, "browser_show_note");
	assert.equal(recorded[0].result.details.note.label, "Why L2 helps");

	commands.length = 0;
	await highlight.execute("h2", { text: "Dropout switches units off at random.", noteTitle: "Stray title" });
	assert.deepEqual(commands.map((call) => call.name), ["highlight_text"], "a title without a note adds nothing");
	assert.equal(commands[0].args.noteTitle, undefined);

	commands.length = 0;
	await showNote.execute("n1", { annotationId: "onhand-1", note: "Early stopping: halt when validation loss turns up.", label: "Early stopping" });
	assert.deepEqual(commands[0].args, { annotationId: "onhand-1", note: "Halt when validation loss turns up.", label: "Early stopping" });

	// The title is saved with the note and comes back on restore and export.
	const noted = (label) => test.buildPageActionForTest("browser_show_note", { details: { tab: { id: 5, windowId: 2, title: "Page", url: "https://example.test/" }, note: { annotationId: "a1", text: "The penalty shrinks large weights.", ...(label ? { label } : {}) } } });
	assert.equal(noted("Why L2 helps").noteLabel, "Why L2 helps");
	assert.equal("noteLabel" in noted("Onhand"), false, "the plain header is not saved as a title");
	assert.equal("noteLabel" in noted(""), false);
	const page = { tabId: 5, windowId: 2, title: "Regularization", url: "https://example.test/regularization" };
	const actions = [
		{ key: "highlight:a1", type: "annotation", annotationId: "a1", label: "Highlighted text", detail: "L2 adds a penalty.", citationText: "L2 adds a penalty.", ...page },
		{ ...noted("Why L2 helps"), ...page },
		{ key: "highlight:a2", type: "annotation", annotationId: "a2", label: "Highlighted text", detail: "Dropout switches units off.", citationText: "Dropout switches units off.", ...page },
		{ key: "note:a2", type: "note", annotationId: "a2", label: "Added note", detail: "Each unit must work alone.", citationText: "Each unit must work alone.", ...page },
	];
	const replayed = test.buildReplayAnnotationsFromPageActions(actions);
	assert.deepEqual(replayed.map((annotation) => [annotation.noteText, annotation.noteLabel]), [
		["The penalty shrinks large weights.", "Why L2 helps"],
		["Each unit must work alone.", undefined],
	], "a restored note gets its title back; an older note without one keeps the plain header");
	const exported = test.buildSessionNotesMarkdownForTest({ id: "s", name: "Regularization", messages: [], artifactIds: [], pageActions: actions, turns: [] }, new Date(2026, 10, 13));
	assert.match(exported.markdown, /\n> L2 adds a penalty\.\n\nNote \(Why L2 helps\): The penalty shrinks large weights\.\n/);
	assert.match(exported.markdown, /\n> Dropout switches units off\.\n\nNote: Each unit must work alone\.\n/);

	const runtimeSource = await readFile(new URL("../../packages/browser-extension/src/browser-runtime.ts", import.meta.url), "utf8");
	assert.equal((runtimeSource.match(/label: storedOnPageNoteTitle\(action\.noteLabel\) \|\| ON_PAGE_NOTE_DEFAULT_LABEL/g) || []).length, 2, "notes redrawn from a saved action keep their title");
	assert.match(runtimeSource, /label: annotation\.noteLabel \|\| "Onhand"/, "session restore passes the saved title to the page");
	const viewerSource = await readFile(new URL("../../packages/browser-extension/src/pdf-viewer.ts", import.meta.url), "utf8");
	assert.match(viewerSource, /const titled = labelText !== NOTE_DEFAULT_LABEL;[\s\S]*textTransform: titled \? "none" : "uppercase"[\s\S]*label: labelText,/, "the PDF viewer shows a title in its own casing and reports it");
	console.log("Note titles: cleanup, both note paths, saved title, restore and export passed");
}
