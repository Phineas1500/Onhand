// Reports uncaught errors and unhandled promise rejections on Onhand's own
// pages (side panel, options, PDF viewer and the rest) to the background
// worker. The runtime redacts them like its own errors and sends them to
// Sentry only when diagnostics are on. Each page loads this script first, so it
// also sees errors thrown while the page's other scripts start.
(() => {
	const page = location.pathname.replace(/^\/+|\.html$/g, "") || "page";
	const MAX_REPORTS_PER_PAGE = 5;
	// Browser noise rather than Onhand bugs.
	const IGNORED_MESSAGE_PATTERN = /ResizeObserver loop|Extension context invalidated|Receiving end does not exist|message port closed before a response/i;
	const reported = new Set();

	function report(error, fallbackMessage) {
		const message = String(error?.message || fallbackMessage || error || "").slice(0, 1000);
		if (!message || IGNORED_MESSAGE_PATTERN.test(message) || reported.has(message) || reported.size >= MAX_REPORTS_PER_PAGE) return;
		reported.add(message);
		try {
			chrome.runtime
				.sendMessage({ type: "page:runtime-error", page, message, stack: String(error?.stack || "").slice(0, 4000) })
				.catch(() => {});
		} catch {}
	}

	addEventListener("error", (event) => {
		if (event instanceof ErrorEvent) report(event.error, event.message);
	});
	addEventListener("unhandledrejection", (event) => report(event.reason, "Unhandled promise rejection"));
})();
