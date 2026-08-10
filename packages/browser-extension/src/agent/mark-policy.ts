// The single source of truth for mark-policy wording that more than one
// prompt surface states. The 2026-08-09 ethos-audit review found the retired
// v2.x budgets surviving in five surfaces (launcher contract, both mark tool
// descriptions, the source-marker retry prompt, four guard messages) because
// each carried its own paraphrase of the policy and they drifted apart.
// Surfaces compose these fragments instead, so a policy change lands
// everywhere at once.
//
// Naming convention: `*Phrase` fragments compose mid-sentence (no leading
// capital, no final period); everything else is one or more complete
// sentences usable verbatim as a bullet or clause.

export const MARK_POLICY = {
	/** Advisory highlight budget for broad teach/review/summarize prompts. */
	teachBudgetPhrase: "typically three to six",
	/** Note shape: length and character budget. */
	noteShapePhrase: "one to two sentences, under 280 characters",
	/** What an interpretive note does. */
	noteJobPhrase: "naming its role or explaining the hard step",
	/** The per-interpretive-mark note rule (v3.0: marks carry the depth). */
	perMarkNotes:
		"Give each interpretive highlight a short note (one to two sentences, under 280 characters) naming its role or explaining the hard step; do not paraphrase the highlight, and skip notes on purely confirmatory marks.",
	/** Where the depth lives (v3.0). */
	notesCarryTheDepth:
		"The notes carry the depth: put the explanation on the mark it belongs to, and keep the chat to the verdict and the synthesis across marks.",
	/** Comparison mark treatment: a support highlight and note per side. */
	comparisonMarks:
		"For compare/contrast prompts, usually create two concise source highlights, one for each side, each with a short note on its side of the difference; add at most one direct contrast/conclusion highlight when the page states it.",
	/** Weak-anchor ban shared by every marker surface. */
	noHeadingMarkers:
		"Do not use the page title, course title, reading list, or a generic heading as a source marker.",
	/** Sidebar table policy (v3.0: the blanket ban narrowed to non-comparisons). */
	sidebarTables:
		"Use a small Markdown table only when the user asks for one or a genuine multi-dimension comparison reads better as a grid; otherwise use compact labeled bullets. Do not use horizontal rules like --- as section separators.",
} as const;
