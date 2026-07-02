// Renders a saved browser artifact snapshot when the live page cannot be
// restored. The captured HTML already contains the Onhand highlights, notes,
// and their style element as they were on the page, so rendering it verbatim
// in a fully sandboxed iframe (no scripts, no same-origin access) is enough
// to give the user their marks back.
(() => {
	const statusEl = document.getElementById("status");
	const contentEl = document.getElementById("content");
	const bannerEl = document.getElementById("banner");

	const showStatus = (message) => {
		statusEl.hidden = false;
		statusEl.textContent = message;
	};

	// Point relative resource URLs (stylesheets, images) at the original site
	// so the sandboxed copy renders faithfully. Skipped when the capture
	// already carries a <base> or the original URL is unavailable.
	const injectBaseHref = (html, originalUrl) => {
		if (!originalUrl || /<base[\s>]/i.test(html)) return html;
		const baseTag = `<base href="${String(originalUrl).replace(/"/g, "&quot;")}">`;
		const headMatch = html.match(/<head(\s[^>]*)?>/i);
		if (!headMatch) return html;
		const insertAt = headMatch.index + headMatch[0].length;
		return `${html.slice(0, insertAt)}${baseTag}${html.slice(insertAt)}`;
	};

	const render = (artifact) => {
		const page = artifact.page || {};
		const title = String(page.title || artifact.label || "Saved page").trim();
		const url = String(page.url || "").trim();
		document.title = `${title} — Onhand snapshot`;
		bannerEl.hidden = false;
		document.getElementById("pageTitle").textContent = title;
		const capturedAt = Number(page.capturedAt || 0);
		document.getElementById("capturedAt").textContent = capturedAt ? `captured ${new Date(capturedAt).toLocaleString()}` : "";
		const link = document.getElementById("originalLink");
		if (url && /^https?:\/\//i.test(url)) {
			link.href = url;
			link.hidden = false;
		}
		const outerHTML = String(artifact.outerHTML || "");
		const screenshotDataUrl = String(artifact.screenshotDataUrl || "");
		if (outerHTML.trim()) {
			const frame = document.createElement("iframe");
			frame.className = "onhand-snapshot-frame";
			frame.setAttribute("sandbox", "");
			frame.setAttribute("title", "Saved page snapshot");
			frame.srcdoc = injectBaseHref(outerHTML, url);
			statusEl.hidden = true;
			contentEl.appendChild(frame);
			return;
		}
		if (screenshotDataUrl.startsWith("data:image/")) {
			const wrap = document.createElement("div");
			wrap.className = "onhand-snapshot-image-wrap";
			const image = document.createElement("img");
			image.alt = "Saved page screenshot";
			image.src = screenshotDataUrl;
			wrap.appendChild(image);
			statusEl.hidden = true;
			contentEl.appendChild(wrap);
			return;
		}
		showStatus("This saved snapshot has no stored page copy. Open the session's Review view for its details instead.");
	};

	const load = async () => {
		const artifactId = new URLSearchParams(location.search).get("artifact") || "";
		if (!artifactId) {
			showStatus("No snapshot was specified.");
			return;
		}
		try {
			const response = await chrome.runtime.sendMessage({ type: "sidebar:get-replay-artifact", artifactId });
			if (!response?.ok || !response.artifact) {
				throw new Error(response?.error || "Snapshot not found.");
			}
			render(response.artifact);
		} catch (error) {
			showStatus(`Could not load this snapshot: ${error?.message || error}`);
		}
	};

	void load();
})();
