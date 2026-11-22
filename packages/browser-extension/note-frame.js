// Draws one note inside Onhand's own frame.
//
// A note that may quote another tab (one an outside app wrote through the
// connector) is not put into the page it sits on, where that page's scripts
// could read it. The page gets a card holding this frame; the frame's origin
// is the extension's, so the page cannot look inside. The address carries a
// random name for the note; its title and text are collected from the
// extension's session storage, which a web page cannot reach.
(async () => {
	const name = location.hash.slice(1);
	if (!/^[0-9a-f]{64}$/.test(name)) return;
	const key = `onhandNoteFrame:${name}`;
	const record = (await chrome.storage.session.get(key))?.[key];
	if (!record || typeof record.text !== "string" || !record.text) return;

	const params = new URLSearchParams(location.search);
	const fill = params.get("layout") === "fill";
	const toolkit = globalThis.__onhandPageToolkitFactory({
		fontUrls: record.fontUrls,
		katexUrl: record.katexUrl,
		theme: params.get("theme") === "dark" ? "dark" : "light",
	});
	const content = await toolkit.drawNoteInFrame(record.text, { label: record.label, layout: fill ? "fill" : "fit" });
	document.documentElement.style.background = getComputedStyle(content).backgroundColor;
	// Measure with the note's own fonts, not the stand-ins shown while they
	// load: a hidden tab would never report the corrected size.
	await Promise.race([Promise.allSettled(Array.from(document.fonts, (face) => face.load())), new Promise((resolve) => setTimeout(resolve, 500))]);

	// The page learns the note's size and nothing more. Measured on demand,
	// because a hidden tab runs no resize callbacks.
	let lastSize = "";
	const report = () => {
		let width = content.getBoundingClientRect().width;
		if (!fill) {
			// The width the note would take with room to spare: the page sizes
			// the frame to it, capped by the card's own limit.
			content.style.setProperty("width", "max-content", "important");
			content.style.setProperty("max-width", "none", "important");
			width = content.getBoundingClientRect().width + 1;
			content.style.removeProperty("width");
			content.style.removeProperty("max-width");
		}
		const size = { width: Math.ceil(width), height: Math.ceil(content.getBoundingClientRect().height) };
		const signature = `${size.width}x${size.height}`;
		if (signature === lastSize) return;
		lastSize = signature;
		window.parent.postMessage({ type: "onhand-note-frame-size", token: name, ...size }, "*");
	};
	report();
	new ResizeObserver(report).observe(content);
	document.fonts.addEventListener("loadingdone", report);
	document.addEventListener("visibilitychange", report);
	// The page asks for a fresh measurement when the card's width changes; an
	// off-screen frame is not told about its new size any other way. The
	// second look is for a request that arrives before the new size does.
	window.addEventListener("message", (event) => {
		if (event.source !== window.parent || event.data?.type !== "onhand-note-frame-measure") return;
		report();
		setTimeout(report, 150);
	});
})();
