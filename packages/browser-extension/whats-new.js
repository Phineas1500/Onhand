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
		version: "0.4.13",
		items: ["Onhand Free now works in Hong Kong and Macau, where OpenAI doesn't offer its service."],
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
