import http from "node:http";

function escapeHtml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function escapePdfText(value) {
	return String(value ?? "")
		.replace(/\\/g, "\\\\")
		.replace(/\(/g, "\\(")
		.replace(/\)/g, "\\)")
		.replace(/[^\x20-\x7e]/g, "?");
}

function locationPage(location, fallback = 1) {
	const match = String(location || "").match(/page(?:-image)?:\s*(\d+)/i);
	return match ? Math.max(1, Number(match[1])) : fallback;
}

function wrapPdfLine(value, maxChars = 74) {
	const words = String(value || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
	const lines = [];
	let line = "";
	for (const word of words) {
		if (!line || `${line} ${word}`.length <= maxChars) line = line ? `${line} ${word}` : word;
		else {
			lines.push(line);
			line = word;
		}
	}
	if (line) lines.push(line);
	return lines;
}

export function buildTrajectoryPdf(resource, { title = resource.id, linkedUrls = [], visual = false } = {}) {
	const passagesByPage = new Map();
	for (const passage of resource.passages || []) {
		const page = locationPage(passage.location);
		const lines = passagesByPage.get(page) || [];
		lines.push(...wrapPdfLine(passage.text));
		passagesByPage.set(page, lines);
	}
	if (linkedUrls.length) {
		const page = Math.max(1, ...passagesByPage.keys());
		const lines = passagesByPage.get(page) || [];
		for (const url of linkedUrls) lines.push(...wrapPdfLine(`Source URL: ${url}`, 66));
		passagesByPage.set(page, lines);
	}
	const pageCount = Math.max(1, ...passagesByPage.keys());
	const objects = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
	const pageRefs = [];
	for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
		const pageObjectNumber = objects.length + 1;
		const contentObjectNumber = pageObjectNumber + 1;
		pageRefs.push(`${pageObjectNumber} 0 R`);
		objects.push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${2 * pageCount + 3} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
		);
		const pageLines = [pageNumber === 1 ? title : `${title} - page ${pageNumber}`, ...(passagesByPage.get(pageNumber) || [])];
		const commands = pageLines
			.flatMap((line) => wrapPdfLine(line))
			.map((line, index) => `${index === 0 ? "0 0 Td" : "0 -28 Td"} (${escapePdfText(line)}) Tj`)
			.join("\n");
		const visualCommands =
			visual && pageNumber === locationPage(resource.passages?.find((passage) => String(passage.location || "").startsWith("page-image:"))?.location)
				? "\n0.1 0.35 0.8 RG 4 w 80 250 m 180 210 l 280 175 l 380 155 l 500 150 l S\n"
				: "";
		const stream = `BT\n/F1 16 Tf\n54 730 Td\n${commands}\nET${visualCommands}`;
		objects.push(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
	}
	objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageCount} >>`;
	objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
	let pdf = "%PDF-1.4\n";
	const offsets = [0];
	for (const [index, body] of objects.entries()) {
		offsets.push(Buffer.byteLength(pdf, "utf8"));
		pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
	}
	const xrefOffset = Buffer.byteLength(pdf, "utf8");
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f\n`;
	for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n\n`;
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
	return Buffer.from(pdf, "utf8");
}

function directResources(testCase, tabId) {
	return (testCase.workspace.resources || []).filter((resource) => resource.tabId === tabId && resource.kind !== "linked-pdf");
}

function linkedResources(testCase, tabId) {
	return (testCase.workspace.resources || []).filter((resource) => resource.tabId === tabId && resource.kind === "linked-pdf");
}

function directResourceForTab(testCase, tabId) {
	return directResources(testCase, tabId)[0] || null;
}

function slug(value) {
	return encodeURIComponent(String(value || ""));
}

export function createTrajectoryFixtureCatalog(suite, baseUrl) {
	const caseMap = new Map(suite.cases.map((testCase) => [testCase.id, testCase]));
	const prefix = `${String(baseUrl).replace(/\/$/, "")}/agent-trajectory`;
	const tabUrl = (testCase, tab) => {
		const resource = directResourceForTab(testCase, tab.id);
		const selectionNeedsHtml = tab.id === testCase.workspace.activeTabId && Boolean(testCase.turn.selectedText);
		const extension = resource?.kind === "pdf" && !selectionNeedsHtml ? ".pdf" : ".html";
		return `${prefix}/${slug(testCase.id)}/tab/${slug(tab.id)}${extension}`;
	};
	const resourceUrl = (testCase, resource) => `${prefix}/${slug(testCase.id)}/resource/${slug(resource.id)}.pdf`;
	const catalog = {
		baseUrl: prefix,
		caseMap,
		tabUrl,
		resourceUrl,
		resolve(urlValue) {
			let url;
			try {
				url = new URL(String(urlValue || ""));
			} catch {
				return null;
			}
			const marker = "/agent-trajectory/";
			const markerIndex = url.pathname.indexOf(marker);
			if (markerIndex < 0) {
				// PDF annotations recorded in the Onhand viewer carry the viewer URL
				// (chrome-extension://.../pdf-viewer.html?url=<fixture pdf>), with the
				// real fixture URL in the `url` query parameter. Unwrap and retry so
				// PDF receipts map to their source instead of normalizing to zero
				// annotations (the July pilot's P0 evaluator gap).
				const wrapped = url.searchParams.get("url") || url.searchParams.get("pdfUrl") || "";
				return wrapped && wrapped !== String(urlValue || "") ? catalog.resolve(wrapped) : null;
			}
			const parts = url.pathname.slice(markerIndex + marker.length).split("/").map((part) => decodeURIComponent(part.replace(/\.(?:html|pdf)$/i, "")));
			const [caseId, kind, id] = parts;
			const testCase = caseMap.get(caseId);
			if (!testCase || !id) return null;
			if (kind === "resource") {
				const resource = testCase.workspace.resources.find((candidate) => candidate.id === id);
				return resource ? { caseId, tabId: resource.tabId, sourceId: resource.id, resource } : null;
			}
			if (kind === "tab") {
				const resource = directResourceForTab(testCase, id);
				return resource ? { caseId, tabId: id, sourceId: resource.id, resource } : { caseId, tabId: id, sourceId: "", resource: null };
			}
			return null;
		},
	};
	return catalog;
}

function renderInteractionFixture(testCase) {
	if (testCase.id !== "explicit-page-interaction") return "";
	return `
		<section aria-labelledby="controls-heading">
			<h2 id="controls-heading">Mode controls</h2>
			<label for="mode">Mode</label>
			<select id="mode" aria-label="Mode"><option>Basic</option><option>Advanced</option></select>
			<button id="apply" type="button">Apply</button>
			<p id="status" role="status">Basic mode active</p>
		</section>
		<script>
			document.querySelector("#mode").addEventListener("change", () => {
				document.querySelector("#status").textContent = document.querySelector("#mode").value + " selected";
			});
			document.querySelector("#apply").addEventListener("click", () => {
				document.querySelector("#status").textContent = document.querySelector("#mode").value + " mode applied";
			});
		</script>`;
}

function renderTabHtml(testCase, tab, catalog) {
	const resources = directResources(testCase, tab.id);
	const linked = linkedResources(testCase, tab.id);
	const passages = resources.flatMap((resource) =>
		(resource.passages || []).map(
			(passage) => `<section data-source-id="${escapeHtml(resource.id)}" data-passage-id="${escapeHtml(passage.id)}">
				<h2>${escapeHtml(passage.location || passage.id)}</h2>
				<p>${escapeHtml(passage.text)}</p>
			</section>`,
		),
	);
	const links = linked.length
		? `<section aria-labelledby="resources-heading"><h2 id="resources-heading">Resources</h2><ul>${linked
				.map((resource) => `<li><a href="${escapeHtml(catalog.resourceUrl(testCase, resource))}">${escapeHtml(resource.id.replace(/-/g, " "))}</a></li>`)
				.join("")}</ul></section>`
		: "";
	const selectedText = tab.id === testCase.workspace.activeTabId && testCase.turn.selectedText
		? `<section aria-labelledby="selected-heading" data-selected-fixture="true"><h2 id="selected-heading">Selected problem</h2><p id="fixture-selection">${escapeHtml(testCase.turn.selectedText)}</p><button id="select-fixture-text" type="button">Select problem text</button></section>`
		: "";
	const selectionScript = selectedText
		? `<script>
			document.querySelector("#select-fixture-text").addEventListener("click", () => {
				const node = document.querySelector("#fixture-selection")?.firstChild;
				if (!node) return;
				const range = document.createRange();
				range.selectNodeContents(node);
				const selection = getSelection();
				selection.removeAllRanges();
				selection.addRange(range);
			});
		</script>`
		: "";
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escapeHtml(tab.title)}</title>
	<style>
		body { margin: 0; font: 18px/1.55 system-ui, sans-serif; color: #26231f; background: #f4f1ea; }
		main { width: min(850px, calc(100% - 48px)); margin: 0 auto; padding: 42px 0 120px; }
		section { margin: 24px 0; padding: 22px 24px; border: 1px solid #d8d0c3; border-radius: 10px; background: white; }
		h1, h2 { line-height: 1.2; } h2 { font-size: 1.05rem; color: #756b5d; }
		a { color: #075f76; } button, select { font: inherit; margin: 6px; padding: 8px 12px; }
	</style>
</head>
<body><main data-case-id="${escapeHtml(testCase.id)}" data-tab-id="${escapeHtml(tab.id)}">
	<h1>${escapeHtml(tab.title)}</h1>
	<p>Deterministic Onhand trajectory fixture. Only the evidence shown on this page and its linked resources should be used.</p>
	${selectedText}
	${passages.join("\n") || "<section><p>No relevant evidence is available on this page.</p></section>"}
	${links}
	${renderInteractionFixture(testCase)}
	${selectionScript}
</main></body></html>`;
}

function send(request, response, status, headers, body = "") {
	response.writeHead(status, { "Cache-Control": "no-store", Connection: "close", ...headers });
	if (request.method === "HEAD") response.end();
	else response.end(body);
}

export async function startAgentTrajectoryFixtureServer(suite, { host = "127.0.0.1", port = 0 } = {}) {
	let catalog = null;
	const server = http.createServer((request, response) => {
		const url = new URL(request.url || "/", `http://${request.headers.host || host}`);
		if (url.pathname === "/health") {
			send(request, response, 200, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify({ ok: true }));
			return;
		}
		const resolved = catalog?.resolve(url.href);
		if (!resolved) {
			send(request, response, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found");
			return;
		}
		const testCase = catalog.caseMap.get(resolved.caseId);
		const tab = testCase.workspace.tabs.find((candidate) => candidate.id === resolved.tabId);
		if (!testCase || !tab) {
			send(request, response, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Fixture not found");
			return;
		}
		const isResourceRoute = url.pathname.includes("/resource/");
		const resource = isResourceRoute ? resolved.resource : directResourceForTab(testCase, tab.id);
		const selectionNeedsHtml = tab.id === testCase.workspace.activeTabId && Boolean(testCase.turn.selectedText);
		if (resource?.kind === "pdf" || resource?.kind === "linked-pdf") {
			if (!selectionNeedsHtml || isResourceRoute) {
				const childUrls = (testCase.workspace.resources || [])
					.filter((candidate) => candidate.parentSourceId === resource.id)
					.map((candidate) => catalog.resourceUrl(testCase, candidate));
				const body = buildTrajectoryPdf(resource, {
					title: isResourceRoute ? resource.id.replace(/-/g, " ") : tab.title,
					linkedUrls: childUrls,
					visual: testCase.id === "visual-pdf-figure",
				});
				send(request, response, 200, { "Content-Type": "application/pdf", "Content-Length": String(body.length) }, body);
				return;
			}
		}
		const body = renderTabHtml(testCase, tab, catalog);
		send(request, response, 200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": String(Buffer.byteLength(body)) }, body);
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => resolve());
	});
	const address = server.address();
	const actualPort = typeof address === "object" && address ? address.port : port;
	catalog = createTrajectoryFixtureCatalog(suite, `http://${host}:${actualPort}`);
	return {
		server,
		catalog,
		baseUrl: catalog.baseUrl,
		close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
	};
}

function successfulTrace(trace) {
	return trace?.state === "complete" || trace?.state === "recovered";
}

function traceText(trace) {
	return JSON.stringify({
		args: trace?.args || null,
		effectiveArgs: trace?.effectiveArgs || null,
		resultSummary: trace?.resultSummary || "",
		resultDetails: trace?.resultDetails || trace?.details || null,
	});
}

function actionText(action) {
	return [action?.citationText, action?.detail, action?.noteText, action?.title, action?.url].filter(Boolean).join("\n");
}

function normalizedEvidenceText(value) {
	return String(value || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function actionMatchesPassage(action, passageText) {
	const passage = normalizedEvidenceText(passageText);
	if (!passage) return false;
	const candidates = [
		action?.citationText,
		action?.detail,
		action?.noteText,
		action?.anchor?.textQuote?.exact,
		// PDF-viewer annotation actions carry their exact quote under pdfAnchor
		// (and learning-enriched actions under matchedText), not anchor.
		action?.pdfAnchor?.textQuote?.exact,
		action?.matchedText,
	]
		.map(normalizedEvidenceText)
		.filter((candidate) => candidate.length >= 8);
	if (candidates.some((candidate) => passage.includes(candidate) || candidate.includes(passage))) return true;
	// PDF text layers glue words across line and label boundaries ("with a" +
	// "approximate" records as "aapproximate"), so space-sensitive containment
	// misses genuine PDF quotes. Compare space-free forms as a fallback.
	const passageCompact = passage.replace(/ /g, "");
	if (passageCompact.length < 12) return false;
	return candidates
		.map((candidate) => candidate.replace(/ /g, ""))
		.filter((candidate) => candidate.length >= 12)
		.some((candidate) => passageCompact.includes(candidate) || candidate.includes(passageCompact));
}

function urlsInValue(value) {
	const matches = String(value || "").match(/https?:\/\/[^\s"'<>\\]+/g) || [];
	return matches.map((url) => url.replace(/[),.;]+$/, ""));
}

function evidenceReceipt(testCase, sourceId, passageId, turn, catalog) {
	const resource = testCase.workspace.resources.find((candidate) => candidate.id === sourceId);
	const passage = resource?.passages?.find((candidate) => candidate.id === passageId);
	if (!resource || !passage) return { read: false, cited: false, annotated: false, annotationId: "" };
	const completed = (turn.toolTraces || []).filter(successfulTrace);
	const actions = Array.isArray(turn.pageActions) ? turn.pageActions : [];
	const passageInTrace = completed.some((trace) => traceText(trace).includes(passage.text));
	const sourceInTrace = completed.some((trace) => {
		const text = traceText(trace);
		return urlsInValue(text).some((url) => catalog.resolve(url)?.sourceId === sourceId);
	});
	const sourceActions = actions.filter((action) => {
		const resolved = catalog.resolve(action?.url || "");
		return resolved?.sourceId === sourceId;
	});
	const passageActions = sourceActions.filter((action) => actionMatchesPassage(action, passage.text));
	const annotation = passageActions.find((action) => action?.annotationId || action?.type === "annotation" || String(action?.key || "").startsWith("highlight:"));
	const read = passageInTrace || passageActions.length > 0 || (sourceInTrace && completed.some((trace) => ["browser_pdf_capture_page_image", "browser_capture_page"].includes(trace.toolName)));
	const cited = passageActions.length > 0 || sourceActions.length > 0 || /\[\d+\]/.test(String(turn.reply || ""));
	return {
		read,
		cited,
		annotated: Boolean(annotation),
		annotationId: String(annotation?.annotationId || ""),
	};
}

function countDuplicateSources(turn, catalog) {
	const opened = [];
	for (const trace of turn.toolTraces || []) {
		if (!successfulTrace(trace) || !["browser_navigate", "browser_open_pdf_in_onhand_viewer"].includes(trace.toolName)) continue;
		const traceSources = new Set();
		for (const url of urlsInValue(traceText(trace))) {
			const sourceId = catalog.resolve(url)?.sourceId;
			if (sourceId) traceSources.add(sourceId);
		}
		opened.push(...traceSources);
	}
	const seen = new Set();
	let duplicates = 0;
	for (const sourceId of opened) {
		if (seen.has(sourceId)) duplicates += 1;
		else seen.add(sourceId);
	}
	return duplicates;
}

function countUnsupportedActionClaims(turn) {
	const reply = String(turn.reply || "");
	const completedNames = new Set((turn.toolTraces || []).filter(successfulTrace).map((trace) => trace.toolName));
	let count = 0;
	if (/\b(?:I(?:'ve| have)|now)\s+(?:highlighted|marked)\b/i.test(reply) && !completedNames.has("browser_highlight_text")) count += 1;
	if (/\b(?:I(?:'ve| have)|now)\s+(?:opened|navigated)\b/i.test(reply) && !completedNames.has("browser_navigate") && !completedNames.has("browser_open_pdf_in_onhand_viewer")) count += 1;
	if (/\b(?:I(?:'ve| have)|now)\s+(?:clicked|selected|applied)\b/i.test(reply) && !completedNames.has("browser_click") && !completedNames.has("browser_click_text")) count += 1;
	return count;
}

export function normalizeLiveTrajectoryTrace(testCase, result, { profile = "legacy", model = "configured-model", iteration = 1, elapsedMs = 0, catalog } = {}) {
	if (!catalog) throw new Error("normalizeLiveTrajectoryTrace requires a fixture catalog");
	const turn = result?.turn || {};
	const evidenceUses = [];
	const annotations = [];
	for (const slot of testCase.expectations.evidenceSlots || []) {
		for (const acceptable of slot.acceptableEvidence || []) {
			for (const passageId of acceptable.passageIds || []) {
				const receipt = evidenceReceipt(testCase, acceptable.sourceId, passageId, turn, catalog);
				if (!receipt.read) continue;
				evidenceUses.push({
					slotId: slot.id,
					sourceId: acceptable.sourceId,
					passageId,
					citationPresent: receipt.cited,
				});
				if (receipt.annotated && !annotations.some((annotation) => annotation.sourceId === acceptable.sourceId && annotation.passageId === passageId)) {
					annotations.push({ sourceId: acceptable.sourceId, passageId, annotationId: receipt.annotationId || `${acceptable.sourceId}:${passageId}` });
				}
			}
		}
	}
	const toolCalls = (turn.toolTraces || []).map((trace) => ({
		name: String(trace.toolName || "unknown-tool"),
		state: ["complete", "error", "blocked", "recovered"].includes(trace.state) ? trace.state : trace.state === "running" ? "error" : "error",
		...(Number.isFinite(Number(trace.duration_ms)) ? { durationMs: Math.max(0, Number(trace.duration_ms)) } : {}),
	}));
	const mutationTools = new Set([
		"browser_highlight_text",
		"browser_show_note",
		"browser_click",
		"browser_click_text",
		"browser_type",
		"browser_type_by_label",
		"browser_navigate",
		"browser_open_pdf_in_onhand_viewer",
		"browser_clear_annotations",
	]);
	const pageMutations = (turn.toolTraces || []).filter((trace) => successfulTrace(trace) && mutationTools.has(trace.toolName)).length;
	const reply = String(turn.reply || "").trim();
	const limitationPattern = /\b(?:cannot|can't|could not|couldn't|not enough|insufficient|not reported|does not report|no supporting evidence|unable to determine)\b/i;
	return {
		caseId: testCase.id,
		profile: String(turn.executionProfile || profile),
		model: String(model || "configured-model"),
		iteration,
		completed: Boolean(reply) && !turn.error && !turn.pending,
		honestLimitation: limitationPattern.test(reply),
		reply,
		toolCalls,
		evidenceUses,
		annotations,
		modelCalls: Math.max(0, Number(turn.modelCalls || 0)),
		latencyMs: Math.max(0, Number(turn.durationMs || elapsedMs || 0)),
		duplicateSources: countDuplicateSources(turn, catalog),
		focusChanges: (turn.toolTraces || []).filter((trace) => successfulTrace(trace) && trace.toolName === "browser_activate_tab").length,
		unsupportedActionClaims: countUnsupportedActionClaims(turn),
		pageMutations,
		provisionalAnswerExposed: Boolean(turn.provisionalAnswerExposed),
	};
}

export function normalizeConfiguredRuntimeMetadata(value) {
	const candidates = [value, value?.state, value?.state?.state].filter((candidate) => candidate && typeof candidate === "object");
	const preferences = candidates
		.map((candidate) => candidate.preferences || candidate.settings)
		.find((candidate) => candidate && typeof candidate === "object") || {};
	const readFirst = (key) => candidates.map((candidate) => candidate[key]).find((candidate) => candidate != null && String(candidate).trim());
	return {
		provider: String(preferences.aiProvider || "configured-provider"),
		model: String(preferences.aiModel || "configured-model"),
		extensionVersion: String(preferences.extensionVersion || readFirst("extensionVersion") || ""),
		runtimeRevision: String(preferences.runtimeRevision || readFirst("runtimeRevision") || ""),
	};
}
