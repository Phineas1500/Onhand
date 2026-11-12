// What's new, shown once in the side panel the first time it opens after an
// update (see showWhatsNewAfterUpdate in sidebar.js).
//
// Every release adds an entry for its version, newest first: one to three
// short lines about changes a reader would notice, or an empty list when
// nothing visible changed. Packaging and the sidebar regressions refuse a
// manifest version without an entry. Someone updating across several
// releases sees the newest few lines.
globalThis.ONHAND_WHATS_NEW = Object.freeze([
	{
		version: "0.4.20",
		items: [
			"Long PDFs stay fast: highlights and search in a book of hundreds of pages no longer time out, and the viewer uses much less memory.",
			"PDF pages keep loading when you switch to another tab.",
		],
	},
	{
		version: "0.4.19",
		items: [
			"PDFs that a publisher or course page shows inside the page now open in Onhand's viewer, and the text around them can be highlighted.",
			"More PDFs behind a sign-in open, including when another extension is active on the tab.",
			"When highlights keep missing, Onhand stops retrying sooner and answers with what it has.",
		],
	},
	{
		version: "0.4.18",
		items: [
			"Select text on a page, right-click it and pick “Explain with Onhand” to ask about just that part.",
			"Highlights land on more pages: course sites and web apps, pages in other languages, and PDFs where the quoted words differ slightly.",
			"Copy or download a session's highlights, notes and answers from the ⋯ menu.",
		],
	},
	{
		version: "0.4.17",
		items: [
			"Highlights now land in tabs the browser put to sleep and in PDFs the browser is still opening.",
			"When a page action keeps failing, Onhand stops retrying and answers with what it has.",
			"Setup explains a rejected API key, or a country Onhand Free doesn't serve, before your first question.",
		],
	},
	{
		version: "0.4.16",
		items: [
			"Open a PDF saved on your computer by picking the file when Onhand asks. No browser setting to change.",
			"A new conversation suggests three questions that fit the page. Click one to ask it.",
			"Answers about PDFs and homework take fewer steps, so they arrive sooner.",
		],
	},
	{
		version: "0.4.15",
		items: [
			"Voice now tells you before it starts that it runs on your own OpenAI API key, instead of failing after you click it.",
			"Starting ChatGPT sign-in a second time brings you back to the sign-in tab that's already open.",
		],
	},
	{
		version: "0.4.14",
		items: [
			"After each answer, Onhand suggests a next question in the input box. Press Tab to use it, or turn this off in Settings.",
			"Gemini API keys now use Gemini 3.8 Flash, and running out of Google's free-tier requests shows a clear message instead of an error code.",
		],
	},
	{
		version: "0.4.13",
		items: [
			"Signing in with ChatGPT works again. OpenAI stopped offering GPT-5.5 to ChatGPT accounts, so Onhand now uses GPT-6 Luna.",
			"Ask for more sources and Onhand opens real articles from its search, two or three at a time, each with its own highlights.",
			"Onhand Free now works in Hong Kong and Macau, where OpenAI doesn't offer its service.",
		],
	},
	{
		version: "0.4.12",
		items: [],
	},
	{
		version: "0.4.11",
		items: [
			"PDF notes stay beside the page in narrow windows. When there's no room, they fold into tabs you can click open.",
			"Ask Learning mode to “quiz me as we go” and it keeps teaching and asking until you say stop.",
		],
	},
	{
		version: "0.4.10",
		items: ["Onhand Free now runs on api.useonhand.com, which school and work networks are less likely to block."],
	},
	{
		version: "0.4.9",
		items: ["PDF notes sit in the margin beside the page instead of over the text."],
	},
]);
