(async () => {
	if (globalThis.__onhandSidebarInjected) return;
	globalThis.__onhandSidebarInjected = true;

	const SIDEBAR_WIDTH = 420;
	const POLL_INTERVAL_MS = 900;
	const PAGE_OPEN_CLASS = "onhand-extension-sidebar-open";
	const PAGE_STYLE_ID = "onhand-extension-sidebar-layout";
	const HOST_ID = "onhand-extension-sidebar-host";
	const HOST_SELECTOR = `[id="${HOST_ID}"]`;
	const TOKEN_PREFIX = "@@ONHAND_TOKEN_";
	const IS_NATIVE_SIDE_PANEL =
		globalThis.location?.protocol === "chrome-extension:" && /\/sidepanel\.html$/.test(globalThis.location?.pathname || "");
	const FONT_ASSET_PATHS = Object.freeze({
		newYorkRegular: "fonts/NewYork.woff2",
		newYorkItalic: "fonts/NewYorkItalic.woff2",
		ioskeleyRegular: "fonts/IoskeleyMono-Regular.woff2",
		ioskeleyBold: "fonts/IoskeleyMono-Bold.woff2",
		ioskeleyItalic: "fonts/IoskeleyMono-Italic.woff2",
	});
	const extensionUrl = (path) => {
		try {
			return chrome.runtime.getURL(path);
		} catch {
			return path;
		}
	};
	const FONT_URLS = Object.fromEntries(Object.entries(FONT_ASSET_PATHS).map(([key, path]) => [key, extensionUrl(path)]));
	const CITATION_STOP_WORDS = new Set([
		"a",
		"an",
		"and",
		"are",
		"as",
		"at",
		"be",
		"been",
		"but",
		"by",
		"did",
		"does",
		"for",
		"from",
		"had",
		"has",
		"have",
		"he",
		"her",
		"his",
		"if",
		"in",
		"into",
		"is",
		"it",
		"its",
		"many",
		"more",
		"not",
		"of",
		"on",
		"or",
		"said",
		"says",
		"she",
		"so",
		"than",
		"that",
		"the",
		"their",
		"them",
		"there",
		"they",
		"this",
		"those",
		"through",
		"to",
		"was",
		"were",
		"what",
		"when",
		"which",
		"while",
		"who",
		"with",
		"won",
		"would",
		"you",
		"your",
	]);
	let open = false;
	let currentState = null;
	let pollingTimer = null;
	let sending = false;
	let reasoningExpanded = null;
	let lastActiveRequestId = null;
	let katexModule = null;
	let katexLoadPromise = null;
	let currentWindowId = null;
	let sessionOverview = null;
	let sessionLoading = false;
	let sessionSwitching = false;
	let creatingSession = false;
	let restoringSession = false;
	let stoppingRequest = false;
	let attachmentDrafts = [];
	const sessionTitleDrafts = new Map();

	const TEXT_ATTACHMENT_EXTENSIONS = new Set([
		"c",
		"cc",
		"cpp",
		"cs",
		"css",
		"csv",
		"go",
		"h",
		"html",
		"java",
		"js",
		"json",
		"jsx",
		"md",
		"py",
		"rb",
		"rs",
		"sh",
		"sql",
		"svg",
		"tex",
		"toml",
		"ts",
		"tsx",
		"txt",
		"xml",
		"yaml",
		"yml",
	]);

	function removeStaleSidebarDom() {
		for (const existingHost of Array.from(document.querySelectorAll(HOST_SELECTOR))) {
			existingHost.remove();
		}
		for (const existingStyle of Array.from(document.querySelectorAll(`[id="${PAGE_STYLE_ID}"]`))) {
			existingStyle.remove();
		}
		document.documentElement.classList.remove(PAGE_OPEN_CLASS);
		document.documentElement.style.removeProperty("--onhand-sidebar-width");
	}

	if (!IS_NATIVE_SIDE_PANEL) {
		removeStaleSidebarDom();
	}

	async function ensureCurrentWindowId() {
		if (typeof currentWindowId === "number") return currentWindowId;
		try {
			const windowInfo = await chrome.windows.getCurrent();
			currentWindowId = windowInfo?.id ?? null;
		} catch {
			currentWindowId = null;
		}
		return currentWindowId;
	}

	function escapeHtml(value) {
		return String(value || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	function escapeAttribute(value) {
		return escapeHtml(value).replace(/`/g, "&#96;");
	}

	function isTextAttachment(file) {
		const mimeType = String(file?.type || "").toLowerCase();
		if (mimeType.startsWith("text/")) return true;
		if (
			[
				"application/json",
				"application/ld+json",
				"application/xml",
				"application/javascript",
				"application/x-javascript",
				"application/typescript",
				"application/x-typescript",
				"image/svg+xml",
			].includes(mimeType)
		) {
			return true;
		}
		const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
		return extension ? TEXT_ATTACHMENT_EXTENSIONS.has(extension) : false;
	}

	function createTokenStore() {
		const tokens = [];
		return {
			replace(html) {
				const token = `${TOKEN_PREFIX}${tokens.length}@@`;
				tokens.push(html);
				return token;
			},
			restore(text) {
				let restored = String(text || "");
				for (let index = 0; index < tokens.length; index += 1) {
					restored = restored.split(`${TOKEN_PREFIX}${index}@@`).join(tokens[index]);
				}
				return restored;
			},
		};
	}

	function renderMathExpression(source, displayMode = false) {
		const expression = String(source || "").trim();
		if (!expression) return "";
		try {
			if (katexModule?.renderToString) {
				return katexModule.renderToString(expression, {
					displayMode,
					throwOnError: false,
					output: "mathml",
					strict: "ignore",
				});
			}
		} catch {}
		const tag = displayMode ? "div" : "span";
		const className = displayMode ? "reply-math-block" : "reply-math-inline";
		return `<${tag} class="${className} reply-math-fallback">${escapeHtml(expression)}</${tag}>`;
	}

	function renderInlineRichText(text) {
		const store = createTokenStore();
		let working = String(text || "");

		working = working.replace(/`([^`]+)`/g, (_match, code) =>
			store.replace(`<code class="reply-inline-code">${escapeHtml(code)}</code>`),
		);
		working = working.replace(/\\\(([\s\S]+?)\\\)/g, (_match, math) => store.replace(renderMathExpression(math, false)));
		working = working.replace(/\$(?!\$)([^$\n]+?)\$/g, (_match, math) => store.replace(renderMathExpression(math, false)));

		let html = escapeHtml(working);
		html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, href) => {
			const safeHref = escapeAttribute(href);
			return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
		});
		html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
		html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
		return store.restore(html);
	}

	function normalizeCitationText(value) {
		return String(value || "")
			.toLowerCase()
			.replace(/[`*_~>#()[\]{}]/g, " ")
			.replace(/[^a-z0-9]+/gi, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	function tokenizeCitationText(value) {
		return normalizeCitationText(value)
			.split(" ")
			.filter((token) => {
				if (!token) return false;
				if (CITATION_STOP_WORDS.has(token)) return false;
				if (/^\d+$/.test(token)) return token.length >= 3;
				return token.length >= 3;
			});
	}

	function buildCitationSnippets(value) {
		const tokens = tokenizeCitationText(value);
		const normalized = normalizeCitationText(value);
		const snippets = [];
		if (normalized.length >= 18) {
			snippets.push(normalized);
		}
		if (tokens.length >= 4) {
			snippets.push(tokens.slice(0, Math.min(8, tokens.length)).join(" "));
		}
		return [...new Set(snippets)];
	}

	function buildCitationGroups(actions) {
		const groups = [];
		const groupMap = new Map();
		for (const action of Array.isArray(actions) ? actions : []) {
			if (!action || typeof action !== "object") continue;
			if (action.type !== "annotation" && action.type !== "note") continue;

			const groupId = action.annotationId || action.key;
			let group = groupMap.get(groupId);
			if (!group) {
				group = {
					groupId,
					number: groups.length + 1,
					actionKey: action.key,
					noteKey: null,
					highlightKey: null,
					matchTokens: new Set(),
					snippets: new Set(),
					titles: [],
				};
				groupMap.set(groupId, group);
				groups.push(group);
			}

			const citationText = String(action.citationText || action.detail || "").trim();
			for (const token of tokenizeCitationText(citationText)) {
				group.matchTokens.add(token);
			}
			for (const snippet of buildCitationSnippets(citationText)) {
				group.snippets.add(snippet);
			}
			if (action.type === "annotation") {
				group.highlightKey = action.key;
			}
			if (action.type === "note") {
				group.noteKey = action.key;
			}
			group.actionKey = group.noteKey || group.highlightKey || group.actionKey || action.key;
			group.titles.push(action.detail ? `${action.label}: ${action.detail}` : action.label || "Open page evidence");
		}

		return groups.map((group) => ({
			number: group.number,
			actionKey: group.noteKey || group.highlightKey || group.actionKey,
			matchTokens: [...group.matchTokens],
			snippets: [...group.snippets],
			title: group.titles[0] || "Open page evidence",
		}));
	}

	function findCitationsForBlock(text, citationGroups) {
		const blockText = String(text || "").trim();
		if (!blockText || !citationGroups.length) return [];

		const blockNormalized = normalizeCitationText(blockText);
		if (!blockNormalized) return [];

		const blockTokens = new Set(tokenizeCitationText(blockText));
		const matches = [];

		for (const group of citationGroups) {
			let overlap = 0;
			let numericOverlap = 0;
			for (const token of group.matchTokens) {
				if (!blockTokens.has(token)) continue;
				overlap += 1;
				if (/^\d+$/.test(token)) numericOverlap += 1;
			}

			let phraseBonus = 0;
			for (const snippet of group.snippets) {
				if (!snippet) continue;
				if (blockNormalized.includes(snippet) || snippet.includes(blockNormalized)) {
					phraseBonus = Math.max(phraseBonus, snippet.split(" ").length >= 5 ? 4 : 2.5);
				}
			}

			const score = overlap + numericOverlap * 1.5 + phraseBonus;
			const minimumOverlap = numericOverlap > 0 ? 1 : 2;
			const minimumScore = numericOverlap > 0 ? 2.5 : 3;
			if (phraseBonus >= 4 || (overlap >= minimumOverlap && score >= minimumScore)) {
				matches.push({
					number: group.number,
					actionKey: group.actionKey,
					title: group.title,
					score,
				});
			}
		}

		return matches
			.sort((left, right) => right.score - left.score || left.number - right.number)
			.slice(0, 2);
	}

	function renderReplyCitations(citations) {
		if (!citations.length) return "";
		return `
			<span class="reply-citations">
				${citations
					.map(
						(citation) => `
							<button
								class="onhand-cite"
								data-action-key="${escapeAttribute(citation.actionKey)}"
								title="${escapeAttribute(citation.title || "Open page evidence")}"
								type="button"
							>[${citation.number}]</button>
						`,
					)
					.join("")}
			</span>
		`;
	}

	function renderCitedBlock(tag, text, citationGroups) {
		const citations = findCitationsForBlock(text, citationGroups);
		return `<${tag}>${renderInlineRichText(text)}${renderReplyCitations(citations)}</${tag}>`;
	}

	function renderReplyMarkdown(text, citationGroups = []) {
		const source = String(text || "").replace(/\r\n?/g, "\n");
		if (!source.trim()) {
			return '<p class="reply-placeholder">Thinking…</p>';
		}

		const blockStore = createTokenStore();
		let prepared = source;

		prepared = prepared.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_match, language, code) => {
			const className = language ? ` language-${escapeAttribute(String(language).trim())}` : "";
			return `\n${blockStore.replace(`<pre class="reply-code-block"><code class="${className}">${escapeHtml(String(code || "").replace(/\n$/, ""))}</code></pre>`)}\n`;
		});
		prepared = prepared.replace(/\\\[([\s\S]+?)\\\]/g, (_match, math) => `\n${blockStore.replace(renderMathExpression(math, true))}\n`);
		prepared = prepared.replace(/\$\$([\s\S]+?)\$\$/g, (_match, math) => `\n${blockStore.replace(renderMathExpression(math, true))}\n`);

		const lines = prepared.split("\n");
		const parts = [];
		let paragraphLines = [];
		let listItems = [];
		let listKind = null;

		function flushParagraph() {
			if (!paragraphLines.length) return;
			parts.push(renderCitedBlock("p", paragraphLines.join(" "), citationGroups));
			paragraphLines = [];
		}

		function flushList() {
			if (!listItems.length) return;
			const tag = listKind === "ordered" ? "ol" : "ul";
			parts.push(`<${tag}>${listItems.map((item) => renderCitedBlock("li", item, citationGroups)).join("")}</${tag}>`);
			listItems = [];
			listKind = null;
		}

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) {
				flushParagraph();
				flushList();
				continue;
			}

			if (trimmed.startsWith(TOKEN_PREFIX)) {
				flushParagraph();
				flushList();
				parts.push(trimmed);
				continue;
			}

			const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
			if (headingMatch) {
				flushParagraph();
				flushList();
				const level = Math.min(4, Math.max(1, headingMatch[1].length));
				parts.push(`<h${level}>${renderInlineRichText(headingMatch[2])}</h${level}>`);
				continue;
			}

			const quoteMatch = trimmed.match(/^>\s?(.*)$/);
			if (quoteMatch) {
				flushParagraph();
				flushList();
				parts.push(renderCitedBlock("blockquote", quoteMatch[1], citationGroups));
				continue;
			}

			const unorderedListMatch = trimmed.match(/^[-*]\s+(.*)$/);
			if (unorderedListMatch) {
				flushParagraph();
				if (listKind && listKind !== "unordered") flushList();
				listKind = "unordered";
				listItems.push(unorderedListMatch[1]);
				continue;
			}

			const orderedListMatch = trimmed.match(/^\d+\.\s+(.*)$/);
			if (orderedListMatch) {
				flushParagraph();
				if (listKind && listKind !== "ordered") flushList();
				listKind = "ordered";
				listItems.push(orderedListMatch[1]);
				continue;
			}

			paragraphLines.push(trimmed);
		}

		flushParagraph();
		flushList();

		return blockStore.restore(parts.join("")) || renderCitedBlock("p", source, citationGroups);
	}

	function ensureKatexLoaded() {
		if (katexLoadPromise) return katexLoadPromise;
		katexLoadPromise = import(chrome.runtime.getURL("vendor/katex.mjs"))
			.then((module) => {
				katexModule = module.default || module;
				if (currentState) renderState(currentState);
				return katexModule;
			})
			.catch(() => null);
		return katexLoadPromise;
	}

	const host = document.createElement("div");
	host.id = HOST_ID;
	if (IS_NATIVE_SIDE_PANEL) {
		document.documentElement.style.height = "100%";
		if (document.body) {
			document.body.style.margin = "0";
			document.body.style.height = "100%";
			document.body.style.background = "transparent";
		}
		host.style.height = "100%";
		host.style.width = "100%";
		host.style.display = "block";
	} else {
		host.style.position = "fixed";
		host.style.top = "0";
		host.style.right = "0";
		host.style.height = "100vh";
		host.style.width = `${SIDEBAR_WIDTH}px`;
		host.style.zIndex = "2147483647";
		host.style.pointerEvents = "none";
		host.style.display = "none";
	}

	function ensurePageLayoutStyle() {
		if (IS_NATIVE_SIDE_PANEL) return null;
		let style = document.getElementById(PAGE_STYLE_ID);
		if (style) return style;

		style = document.createElement("style");
		style.id = PAGE_STYLE_ID;
		style.textContent = `
			html.${PAGE_OPEN_CLASS} {
				overflow-x: clip !important;
			}
			html.${PAGE_OPEN_CLASS} body {
				position: relative !important;
				width: calc(100vw - var(--onhand-sidebar-width, ${SIDEBAR_WIDTH}px)) !important;
				max-width: calc(100vw - var(--onhand-sidebar-width, ${SIDEBAR_WIDTH}px)) !important;
				margin-right: var(--onhand-sidebar-width, ${SIDEBAR_WIDTH}px) !important;
				min-width: 0 !important;
				overflow-x: clip !important;
				transform: translateZ(0) !important;
				transform-origin: top left !important;
				transition:
					width 160ms ease,
					max-width 160ms ease,
					margin-right 160ms ease !important;
			}
			html.${PAGE_OPEN_CLASS} body > * {
				max-width: 100% !important;
			}
		`;

		(document.head || document.documentElement).appendChild(style);
		return style;
	}

	function syncPageLayout(nextOpen) {
		if (IS_NATIVE_SIDE_PANEL) return;
		ensurePageLayoutStyle();
		document.documentElement.style.setProperty("--onhand-sidebar-width", `${SIDEBAR_WIDTH}px`);
		document.documentElement.classList.toggle(PAGE_OPEN_CLASS, Boolean(nextOpen));
	}

	const shadow = host.attachShadow({ mode: "open" });
	shadow.innerHTML = `
		<style>
			:host {
				all: initial;
			}
			* {
				box-sizing: border-box;
			}
			@font-face {
				font-family: "New York";
				font-style: normal;
				font-weight: 400 1000;
				font-display: swap;
				src: url("${FONT_URLS.newYorkRegular}") format("woff2");
			}
			@font-face {
				font-family: "New York";
				font-style: italic;
				font-weight: 400 1000;
				font-display: swap;
				src: url("${FONT_URLS.newYorkItalic}") format("woff2");
			}
			@font-face {
				font-family: "Ioskeley Mono";
				font-style: normal;
				font-weight: 400;
				font-display: swap;
				src: url("${FONT_URLS.ioskeleyRegular}") format("woff2");
			}
			@font-face {
				font-family: "Ioskeley Mono";
				font-style: normal;
				font-weight: 700;
				font-display: swap;
				src: url("${FONT_URLS.ioskeleyBold}") format("woff2");
			}
			@font-face {
				font-family: "Ioskeley Mono";
				font-style: italic;
				font-weight: 400;
				font-display: swap;
				src: url("${FONT_URLS.ioskeleyItalic}") format("woff2");
			}
			.panel {
				width: 100%;
				height: 100%;
				display: flex;
				flex-direction: column;
				background:
					radial-gradient(circle at top right, rgba(246, 125, 80, 0.12), transparent 24%),
					linear-gradient(180deg, #171614 0%, #0f0f10 100%);
				color: #f6f1e8;
				border-left: 1px solid rgba(255, 255, 255, 0.08);
				box-shadow: -24px 0 60px rgba(0, 0, 0, 0.38);
				font-family: var(--rm-font-serif);
				pointer-events: auto;
			}
			.header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				padding: 18px 18px 14px;
				border-bottom: 1px solid rgba(255, 255, 255, 0.08);
			}
			.brand {
				display: flex;
				flex-direction: column;
				gap: 4px;
			}
			.eyebrow {
				color: #c6b8a5;
				font-size: 11px;
				font-weight: 700;
				letter-spacing: 0.12em;
				text-transform: uppercase;
			}
			.title {
				font-size: 18px;
				font-weight: 620;
				letter-spacing: -0.02em;
			}
			.status {
				display: inline-flex;
				align-items: center;
				gap: 8px;
				padding: 7px 10px;
				border-radius: 999px;
				background: rgba(255, 255, 255, 0.06);
				color: #d8cec1;
				font-size: 11px;
			}
			.status-dot {
				width: 8px;
				height: 8px;
				border-radius: 999px;
				background: #f67d50;
				box-shadow: 0 0 0 4px rgba(246, 125, 80, 0.16);
				flex-shrink: 0;
			}
			.status.ok .status-dot {
				background: #7ccf8a;
				box-shadow: 0 0 0 4px rgba(124, 207, 138, 0.16);
			}
			.status.error .status-dot {
				background: #ff8e86;
				box-shadow: 0 0 0 4px rgba(255, 142, 134, 0.16);
			}
			.close-button {
				border: none;
				background: rgba(255, 255, 255, 0.04);
				color: #d8cec1;
				border-radius: 999px;
				padding: 8px 10px;
				font-size: 12px;
				cursor: pointer;
			}
			.close-button:hover {
				background: rgba(255, 255, 255, 0.08);
			}
			.meta {
				padding: 12px 18px;
				color: #a99d90;
				font-size: 12px;
				border-bottom: 1px solid rgba(255, 255, 255, 0.05);
			}
			.body {
				flex: 1;
				min-height: 0;
				overflow-y: auto;
				padding: 16px 18px 18px;
				display: flex;
				flex-direction: column;
				gap: 18px;
			}
			.session-toolbar {
				display: flex;
				align-items: center;
				gap: 8px;
			}
			.session-actions {
				display: flex;
				align-items: center;
				gap: 8px;
				flex-wrap: wrap;
			}
			.mode-toggle {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				padding: 7px 10px;
				border-radius: 999px;
				border: 1px solid rgba(255, 255, 255, 0.08);
				background: rgba(255, 255, 255, 0.035);
				color: #b9ad9d;
				font-size: 12px;
				font-weight: 600;
				white-space: nowrap;
				user-select: none;
			}
			.mode-toggle.active {
				color: #c9f0d1;
				border-color: rgba(201, 240, 209, 0.18);
				background: rgba(201, 240, 209, 0.08);
			}
			.mode-toggle input {
				margin: 0;
				accent-color: #c9f0d1;
			}
			.session-select {
				flex: 1;
				min-width: 0;
				border: 1px solid rgba(255, 255, 255, 0.08);
				background: rgba(255, 255, 255, 0.05);
				color: #f6f1e8;
				border-radius: 12px;
				padding: 10px 12px;
				font-size: 12px;
			}
			.session-select:disabled {
				opacity: 0.6;
			}
			.session-button {
				border: 1px solid rgba(255, 255, 255, 0.1);
				background: rgba(255, 255, 255, 0.05);
				color: #f2e6d8;
				border-radius: 12px;
				padding: 9px 12px;
				font-size: 12px;
				font-weight: 600;
				cursor: pointer;
				white-space: nowrap;
			}
			.session-button:hover {
				background: rgba(255, 255, 255, 0.08);
			}
			.session-button:disabled {
				opacity: 0.6;
				cursor: not-allowed;
			}
			.stop-button {
				color: #ffd2cb;
				border-color: rgba(255, 142, 134, 0.24);
				background: rgba(255, 142, 134, 0.08);
			}
			.stop-button:hover {
				background: rgba(255, 142, 134, 0.14);
			}
			.section {
				display: flex;
				flex-direction: column;
				gap: 10px;
			}
			.section-title {
				color: #c6b8a5;
				font-size: 11px;
				font-weight: 700;
				letter-spacing: 0.12em;
				text-transform: uppercase;
			}
			.message-list {
				display: flex;
				flex-direction: column;
				gap: 18px;
			}
			.turn-card {
				display: flex;
				flex-direction: column;
				gap: 12px;
				padding-bottom: 18px;
				border-bottom: 1px solid rgba(255, 255, 255, 0.06);
			}
			.turn-card:last-child {
				padding-bottom: 0;
				border-bottom: none;
			}
			.turn-subtitle {
				color: #b9ad9d;
				font-size: 11px;
				font-weight: 700;
				letter-spacing: 0.08em;
				text-transform: uppercase;
			}
			.message-card {
				padding: 12px 14px;
				border-radius: 16px;
				background: rgba(255, 255, 255, 0.04);
				border: 1px solid rgba(255, 255, 255, 0.07);
			}
			.message-card.user {
				background: rgba(246, 125, 80, 0.12);
				border-color: rgba(246, 125, 80, 0.22);
			}
			.message-role {
				color: #b9ad9d;
				font-size: 11px;
				margin-bottom: 8px;
				text-transform: uppercase;
				letter-spacing: 0.08em;
			}
			.message-body {
				color: #f6f1e8;
				font-size: 13px;
				line-height: 1.55;
				white-space: pre-wrap;
			}
			.reply-rich {
				color: #f7f1e8;
				font-size: 16px;
				line-height: 1.72;
				letter-spacing: -0.01em;
			}
			.reply-rich.pending {
				opacity: 0.9;
			}
			.reply-rich .message-role {
				margin-bottom: 12px;
			}
			.reply-rich .message-body {
				color: inherit;
				font-size: inherit;
				line-height: inherit;
				white-space: normal;
			}
			.reply-rich .message-body > * {
				overflow-wrap: anywhere;
			}
			.reply-rich > :first-child {
				margin-top: 0;
			}
			.reply-rich > :last-child {
				margin-bottom: 0;
			}
			.reply-rich p,
			.reply-rich ul,
			.reply-rich ol,
			.reply-rich pre,
			.reply-rich blockquote,
			.reply-rich h1,
			.reply-rich h2,
			.reply-rich h3,
			.reply-rich h4,
			.reply-rich .katex-display,
			.reply-rich .reply-math-block {
				margin: 0 0 14px;
			}
			.reply-rich h1,
			.reply-rich h2,
			.reply-rich h3,
			.reply-rich h4 {
				color: #fff8ef;
				line-height: 1.3;
				font-weight: 700;
			}
			.reply-rich h1 {
				font-size: 24px;
			}
			.reply-rich h2 {
				font-size: 21px;
			}
			.reply-rich h3 {
				font-size: 18px;
			}
			.reply-rich h4 {
				font-size: 16px;
			}
			.reply-rich ul,
			.reply-rich ol {
				padding-left: 22px;
			}
			.reply-rich li + li {
				margin-top: 6px;
			}
			.reply-rich strong {
				color: #fff3e5;
				font-weight: 620;
			}
			.reply-rich em {
				color: #f1dcc5;
			}
			.reply-rich a {
				color: #ffb590;
				text-decoration: underline;
				text-decoration-color: rgba(255, 181, 144, 0.45);
			}
			.reply-rich .reply-citations {
				display: inline-flex;
				gap: 4px;
				margin-left: 6px;
				vertical-align: super;
			}
			.reply-rich .reply-citation {
				border: none;
				background: rgba(246, 125, 80, 0.16);
				color: #ffd4ba;
				border-radius: 999px;
				padding: 0 6px;
				min-height: 18px;
				font-size: 11px;
				font-weight: 700;
				line-height: 18px;
				cursor: pointer;
			}
			.reply-rich .reply-citation:hover {
				background: rgba(246, 125, 80, 0.28);
			}
			.reply-inline-code,
			.reply-code-block code {
				font-family: var(--rm-font-mono);
			}
			.reply-inline-code {
				background: rgba(255, 255, 255, 0.08);
				border: 1px solid rgba(255, 255, 255, 0.08);
				border-radius: 7px;
				padding: 0.14em 0.42em;
				font-size: 0.88em;
			}
			.reply-code-block {
				background: rgba(255, 255, 255, 0.05);
				border: 1px solid rgba(255, 255, 255, 0.08);
				border-radius: 14px;
				padding: 14px 15px;
				overflow-x: auto;
			}
			.reply-code-block code {
				display: block;
				color: #f5ede2;
				font-size: 13px;
				line-height: 1.6;
				white-space: pre;
			}
			.reply-rich blockquote {
				border-left: 3px solid rgba(246, 125, 80, 0.55);
				padding-left: 14px;
				color: #e2d8ca;
			}
			.reply-placeholder {
				color: #a99d90;
			}
			.reply-math-block,
			.reply-math-inline {
				color: #fff8ef;
			}
			.reply-math-block {
				display: block;
				overflow-x: auto;
			}
			.reply-math-fallback {
				font-family: var(--rm-font-serif);
				font-style: italic;
			}
			.empty-card,
			.activity-card,
			.reasoning-card {
				padding: 12px 14px;
				border-radius: 16px;
				background: rgba(255, 255, 255, 0.03);
				border: 1px solid rgba(255, 255, 255, 0.06);
			}
			.turn-actions {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
			}
			.empty-card {
				color: #b9ad9d;
				font-size: 13px;
				line-height: 1.5;
			}
			.activity-card {
				display: flex;
				align-items: center;
				gap: 10px;
				color: #e4ddd2;
				font-size: 13px;
			}
			.activity-dot {
				width: 9px;
				height: 9px;
				border-radius: 999px;
				background: #a99d90;
				flex-shrink: 0;
			}
			.activity-card.running .activity-dot {
				background: #f67d50;
			}
			.activity-card.complete .activity-dot {
				background: #7ccf8a;
			}
			.activity-card.error .activity-dot {
				background: #ff8e86;
			}
			.reasoning-card summary {
				cursor: pointer;
				list-style: none;
				color: #f2dfc8;
				font-size: 13px;
				font-weight: 600;
			}
			.reasoning-card summary::-webkit-details-marker {
				display: none;
			}
			.reasoning-body {
				margin-top: 10px;
				color: #d9d1c4;
				font-size: 12px;
				line-height: 1.5;
				white-space: pre-wrap;
			}
			.action-list {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
			}
			.action-button {
				border: 1px solid rgba(255, 255, 255, 0.09);
				background: rgba(255, 255, 255, 0.04);
				color: #f6f1e8;
				border-radius: 999px;
				padding: 9px 12px;
				font-size: 12px;
				cursor: pointer;
			}
			.action-button:hover {
				background: rgba(255, 255, 255, 0.08);
			}
			.composer {
				padding: 14px 18px 18px;
				border-top: 1px solid rgba(255, 255, 255, 0.08);
				display: flex;
				flex-direction: column;
				gap: 10px;
			}
			.composer-top {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 10px;
			}
			.attach-button {
				border: 1px solid rgba(255, 255, 255, 0.1);
				background: rgba(255, 255, 255, 0.05);
				color: #f2e6d8;
				border-radius: 999px;
				padding: 8px 12px;
				font-size: 12px;
				font-weight: 600;
				cursor: pointer;
			}
			.attach-button:hover {
				background: rgba(255, 255, 255, 0.08);
			}
			.attach-button:disabled {
				opacity: 0.6;
				cursor: not-allowed;
			}
			.attachment-list {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
			}
			.attachment-chip {
				display: inline-flex;
				align-items: center;
				gap: 8px;
				max-width: 100%;
				padding: 8px 10px;
				border-radius: 999px;
				background: rgba(255, 255, 255, 0.06);
				border: 1px solid rgba(255, 255, 255, 0.08);
				color: #e7ddd1;
				font-size: 12px;
			}
			.attachment-chip span {
				max-width: 240px;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.attachment-remove {
				border: none;
				background: transparent;
				color: #d8cec1;
				font-size: 14px;
				line-height: 1;
				cursor: pointer;
				padding: 0;
			}
			.input {
				width: 100%;
				min-height: 92px;
				border-radius: 16px;
				border: 1px solid rgba(255, 255, 255, 0.08);
				background: rgba(255, 255, 255, 0.03);
				color: #f6f1e8;
				padding: 12px 14px;
				font: 13px/1.45 var(--rm-font-serif);
				resize: vertical;
				outline: none;
			}
			.input::placeholder {
				color: #948879;
			}
			.actions-row {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 12px;
			}
			.helper {
				color: #a99d90;
				font-size: 12px;
			}
			.send-button {
				border: none;
				background: linear-gradient(135deg, #f67d50, #e55633);
				color: white;
				border-radius: 999px;
				padding: 10px 14px;
				font-size: 12px;
				font-weight: 700;
				cursor: pointer;
			}
			.send-button:disabled,
			.input:disabled {
				opacity: 0.6;
				cursor: not-allowed;
			}

			:host {
				--rm-base: #eee6dd;
				--rm-mantle: #e6dbd1;
				--rm-crust: #ddd0c6;
				--rm-surface-0: #dcd3cb;
				--rm-surface-1: #d1c9c2;
				--rm-surface-2: #cac1b9;
				--rm-text: #575279;
				--rm-subtext: #797593;
				--rm-love: #b4637a;
				--rm-pine: #286983;
				--rm-foam: #56949f;
				--rm-iris: #907aa9;
				--rm-gold: #ea9d34;
				--rm-rose: #d6817d;
				--rm-hl-bg: rgba(234, 157, 52, 0.32);
				--rm-font-serif: "New York", "Iowan Old Style", Charter, Georgia, serif;
				--rm-font-mono: "Ioskeley Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
			}

			@media (prefers-color-scheme: dark) {
				:host {
					--rm-base: #191724;
					--rm-mantle: #1f1d2e;
					--rm-crust: #26233a;
					--rm-surface-0: #2a273f;
					--rm-surface-1: #393552;
					--rm-surface-2: #44415a;
					--rm-text: #e0def4;
					--rm-subtext: #908caa;
					--rm-love: #eb6f92;
					--rm-pine: #31748f;
					--rm-foam: #9ccfd8;
					--rm-iris: #c4a7e7;
					--rm-gold: #f6c177;
					--rm-rose: #ebbcba;
					--rm-hl-bg: rgba(246, 193, 119, 0.28);
				}
			}

			.onhand-sidebar {
				background: var(--rm-base);
				color: var(--rm-text);
				font: 15px/1.6 var(--rm-font-serif);
				border-left: 1px solid var(--rm-surface-2);
				box-shadow: none;
				display: flex;
				flex-direction: column;
				height: 100%;
				width: 100%;
				pointer-events: auto;
			}
			.onhand-sidebar button,
			.onhand-sidebar input,
			.onhand-sidebar select,
			.onhand-sidebar textarea {
				font: inherit;
			}
			.onhand-head {
				display: flex;
				align-items: center;
				gap: 10px;
				padding: 12px 16px;
				border-bottom: 1px solid var(--rm-surface-2);
				background: color-mix(in srgb, var(--rm-mantle) 60%, transparent);
				position: relative;
				z-index: 2;
			}
			.onhand-brand {
				display: flex;
				align-items: center;
				color: var(--rm-text);
				flex: 0 0 auto;
			}
			.onhand-brand svg {
				width: 20px;
				height: 20px;
				color: currentColor;
			}
			.onhand-title {
				flex: 1;
				min-width: 0;
				font-size: 16px;
				font-weight: 600;
				letter-spacing: -0.01em;
				color: var(--rm-text);
				border: 0;
				background: transparent;
				outline: none;
				padding: 2px 0;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}
			.onhand-title:focus {
				box-shadow: inset 0 -1px 0 var(--rm-pine);
			}
			.onhand-menu-wrap {
				position: relative;
				flex: 0 0 auto;
			}
			.onhand-menu {
				width: 28px;
				height: 28px;
				display: grid;
				place-items: center;
				border: 0;
				background: transparent;
				color: var(--rm-subtext);
				font-size: 18px;
				line-height: 1;
				border-radius: 3px;
				cursor: pointer;
			}
			.onhand-menu:hover,
			.onhand-menu[aria-expanded="true"] {
				background: var(--rm-surface-1);
				color: var(--rm-text);
			}
			.onhand-menu-panel {
				position: absolute;
				top: calc(100% + 8px);
				right: 0;
				width: 310px;
				max-width: calc(100vw - 28px);
				padding: 12px;
				background: var(--rm-base);
				color: var(--rm-text);
				border: 1px solid var(--rm-surface-2);
				box-shadow: 0 16px 34px rgba(25, 23, 36, 0.18);
				display: flex;
				flex-direction: column;
				gap: 10px;
			}
			.onhand-menu-panel[hidden] {
				display: none;
			}
			.onhand-status {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 10px;
				color: var(--rm-subtext);
				font: 11px/1.4 var(--rm-font-mono);
				padding-bottom: 8px;
				border-bottom: 1px solid var(--rm-surface-1);
			}
			.onhand-status-pill {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				color: var(--rm-subtext);
			}
			.onhand-status-dot {
				width: 7px;
				height: 7px;
				border-radius: 999px;
				background: var(--rm-gold);
			}
			.onhand-status.ok .onhand-status-dot {
				background: var(--rm-foam);
			}
			.onhand-status.error .onhand-status-dot {
				background: var(--rm-love);
			}
			.onhand-menu-field {
				display: flex;
				flex-direction: column;
				gap: 5px;
				font: 10.5px/1.2 var(--rm-font-mono);
				letter-spacing: 0.05em;
				text-transform: uppercase;
				color: var(--rm-subtext);
			}
			.onhand-select {
				width: 100%;
				min-width: 0;
				border: 1px solid var(--rm-surface-2);
				background: var(--rm-mantle);
				color: var(--rm-text);
				border-radius: 3px;
				padding: 8px 9px;
				font: 12px/1.4 var(--rm-font-serif);
				text-transform: none;
				letter-spacing: 0;
			}
			.onhand-menu-actions {
				display: flex;
				flex-wrap: wrap;
				gap: 7px;
			}
			.onhand-menu-actions .session-button {
				border: 1px solid var(--rm-surface-2);
				background: var(--rm-mantle);
				color: var(--rm-text);
				border-radius: 2px;
				padding: 6px 8px;
				font: 11px/1 var(--rm-font-mono);
				cursor: pointer;
			}
			.onhand-menu-actions .session-button:hover {
				background: var(--rm-surface-0);
			}
			.onhand-menu-actions .session-button:disabled {
				opacity: 0.55;
				cursor: not-allowed;
			}
			.onhand-menu-actions .stop-button {
				color: var(--rm-love);
				border-color: color-mix(in srgb, var(--rm-love) 38%, var(--rm-surface-2));
			}
			.onhand-hotkeys {
				color: var(--rm-subtext);
				font: 10px/1.45 var(--rm-font-mono);
				border-top: 1px solid var(--rm-surface-1);
				padding-top: 8px;
			}
			.onhand-scroll {
				flex: 1;
				min-height: 0;
				overflow-y: auto;
				overflow-x: hidden;
			}
			.onhand-scroll::-webkit-scrollbar {
				width: 8px;
			}
			.onhand-scroll::-webkit-scrollbar-thumb {
				background: var(--rm-surface-2);
				border-radius: 999px;
			}
			.onhand-index {
				padding: 10px 16px 14px;
				border-bottom: 1px solid var(--rm-surface-1);
				background: color-mix(in srgb, var(--rm-mantle) 40%, transparent);
			}
			.onhand-index[hidden] {
				display: none;
			}
			.onhand-index-head {
				display: flex;
				align-items: baseline;
				gap: 8px;
				margin-bottom: 8px;
			}
			.onhand-label {
				font: 700 10.5px/1 var(--rm-font-mono);
				letter-spacing: 0.06em;
				text-transform: uppercase;
				color: var(--rm-subtext);
			}
			.onhand-count {
				font: 10.5px var(--rm-font-mono);
				color: var(--rm-subtext);
			}
			.onhand-index-item {
				width: 100%;
				display: flex;
				gap: 10px;
				padding: 6px 8px;
				margin: 2px -8px;
				border-radius: 3px;
				cursor: pointer;
				align-items: flex-start;
				border: 0;
				border-left: 2px solid transparent;
				background: transparent;
				text-align: left;
			}
			.onhand-index-item:hover {
				background: var(--rm-mantle);
				border-left-color: var(--rm-gold);
			}
			.onhand-index-num {
				font: 700 11px var(--rm-font-mono);
				color: var(--rm-foam);
				min-width: 18px;
				padding-top: 2px;
			}
			.onhand-index-text {
				flex: 1;
				font-size: 13.5px;
				line-height: 1.4;
				color: var(--rm-text);
				font-style: italic;
				min-width: 0;
				display: -webkit-box;
				-webkit-line-clamp: 2;
				-webkit-box-orient: vertical;
				overflow: hidden;
			}
			.onhand-index-note {
				font: 10px var(--rm-font-mono);
				color: var(--rm-pine);
				padding-top: 3px;
			}
			.message-list {
				display: block;
			}
			.onhand-entry {
				padding: 16px 18px;
				border-bottom: 1px solid var(--rm-surface-1);
			}
			.onhand-eyebrow {
				font: 10.5px/1 var(--rm-font-mono);
				letter-spacing: 0.05em;
				color: var(--rm-subtext);
				margin-bottom: 6px;
				display: flex;
				align-items: center;
				gap: 8px;
				flex-wrap: wrap;
			}
			.onhand-eyebrow .dot {
				width: 3px;
				height: 3px;
				border-radius: 50%;
				background: var(--rm-surface-2);
			}
			.onhand-q {
				font-style: italic;
				font-size: 16px;
				color: var(--rm-subtext);
				line-height: 1.4;
				margin: 0 0 10px;
				border-left: 2px solid var(--rm-surface-2);
				padding-left: 10px;
				max-width: 52ch;
				white-space: pre-wrap;
			}
			.onhand-a {
				color: var(--rm-text);
				max-width: 52ch;
			}
			.onhand-a p,
			.onhand-a ul,
			.onhand-a ol,
			.onhand-a pre,
			.onhand-a blockquote,
			.onhand-a h1,
			.onhand-a h2,
			.onhand-a h3,
			.onhand-a h4,
			.onhand-a .reply-math-block {
				margin: 0 0 10px;
			}
			.onhand-a p:last-child {
				margin-bottom: 0;
			}
			.onhand-a h1,
			.onhand-a h2,
			.onhand-a h3,
			.onhand-a h4 {
				color: var(--rm-text);
				line-height: 1.28;
			}
			.onhand-a strong {
				color: var(--rm-love);
				font-weight: 600;
			}
			.onhand-a em {
				color: var(--rm-foam);
				font-style: italic;
			}
			.onhand-a a {
				color: var(--rm-pine);
				text-decoration: underline;
				text-decoration-color: color-mix(in srgb, var(--rm-pine) 42%, transparent);
			}
			.onhand-a ul,
			.onhand-a ol {
				padding-left: 22px;
			}
			.onhand-a li + li {
				margin-top: 6px;
			}
			.onhand-a blockquote {
				border-left: 3px solid var(--rm-gold);
				padding-left: 12px;
				color: var(--rm-subtext);
			}
			.onhand-a code,
			.reply-inline-code {
				font-family: var(--rm-font-mono);
				font-size: 0.88em;
				background: var(--rm-surface-0);
				color: var(--rm-love);
				padding: 1px 4px;
				border-radius: 2px;
				border: 0;
			}
			.reply-code-block {
				background: var(--rm-surface-0);
				border: 1px solid var(--rm-surface-2);
				border-radius: 3px;
				padding: 12px;
				overflow-x: auto;
			}
			.reply-code-block code {
				display: block;
				color: var(--rm-text);
				background: transparent;
				padding: 0;
				white-space: pre;
			}
			.reply-citations {
				display: inline;
				margin-left: 3px;
			}
			.onhand-cite {
				font-family: var(--rm-font-mono);
				font-size: 0.72em;
				color: var(--rm-pine);
				font-weight: 700;
				vertical-align: super;
				line-height: 0;
				padding: 0 1px;
				text-decoration: none;
				cursor: pointer;
				border: 0;
				background: transparent;
			}
			.onhand-cite:hover {
				color: var(--rm-foam);
				text-decoration: underline;
			}
			.reply-placeholder {
				color: var(--rm-subtext);
				font-style: italic;
			}
			.reply-math-block,
			.reply-math-inline {
				color: var(--rm-text);
			}
			.reply-math-block {
				display: block;
				overflow-x: auto;
			}
			.reply-math-fallback {
				font-family: var(--rm-font-serif);
				font-style: italic;
			}
			.onhand-reason {
				margin: 10px 0 0;
				font: 11px/1 var(--rm-font-mono);
				color: var(--rm-subtext);
			}
			.onhand-reason summary {
				cursor: pointer;
				list-style: none;
				display: inline-flex;
				align-items: center;
				gap: 6px;
				padding: 4px 8px;
				margin-left: -8px;
				border-radius: 2px;
			}
			.onhand-reason summary::-webkit-details-marker {
				display: none;
			}
			.onhand-reason summary::before {
				content: ">";
				color: var(--rm-surface-2);
				transition: transform 120ms;
				display: inline-block;
			}
			.onhand-reason[open] summary::before {
				transform: rotate(90deg);
			}
			.onhand-reason summary:hover {
				background: var(--rm-mantle);
				color: var(--rm-text);
			}
			.onhand-reason-body {
				padding: 8px 0 0 14px;
				color: var(--rm-subtext);
				font: italic 13px/1.5 var(--rm-font-serif);
				border-left: 1px solid var(--rm-surface-1);
				margin-left: 2px;
				white-space: pre-wrap;
			}
			.onhand-actions {
				margin-top: 10px;
				display: flex;
				flex-wrap: wrap;
				gap: 10px;
				font: 11px var(--rm-font-mono);
			}
			.onhand-action {
				color: var(--rm-pine);
				cursor: pointer;
				padding: 2px 0;
				border: 0;
				border-bottom: 1px solid transparent;
				background: transparent;
			}
			.onhand-action:hover {
				border-bottom-color: var(--rm-pine);
			}
			.onhand-cursor {
				display: inline-block;
				width: 2px;
				height: 1em;
				background: var(--rm-pine);
				vertical-align: text-bottom;
				margin-left: 1px;
				animation: onhand-blink 1s steps(2) infinite;
			}
			@keyframes onhand-blink {
				50% {
					opacity: 0;
				}
			}
			.onhand-compose {
				border-top: 1px solid var(--rm-surface-2);
				padding: 12px 14px 10px;
				background: color-mix(in srgb, var(--rm-mantle) 40%, transparent);
				display: flex;
				flex-direction: column;
				gap: 8px;
			}
			.onhand-compose.learning {
				border-top-color: var(--rm-gold);
				box-shadow: inset 0 2px 0 var(--rm-gold);
			}
			.onhand-draft-chips {
				display: flex;
				flex-wrap: wrap;
				gap: 6px;
			}
			.onhand-chip {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				max-width: 100%;
				font: 10.5px var(--rm-font-mono);
				padding: 3px 8px;
				background: var(--rm-crust);
				border: 1px solid var(--rm-surface-2);
				border-radius: 2px;
				color: var(--rm-text);
			}
			.onhand-chip span {
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.onhand-chip .x {
				cursor: pointer;
				color: var(--rm-subtext);
				font-size: 12px;
				line-height: 1;
				border: 0;
				background: transparent;
				padding: 0;
			}
			.onhand-input {
				background: var(--rm-base);
				border: 1px solid var(--rm-surface-2);
				border-radius: 3px;
				padding: 10px 12px;
				font: 15px/1.5 var(--rm-font-serif);
				color: var(--rm-text);
				min-height: 54px;
				resize: vertical;
				outline: none;
			}
			.onhand-input::placeholder {
				color: var(--rm-subtext);
				font-style: italic;
			}
			.onhand-input:focus {
				border-color: var(--rm-pine);
				box-shadow: 0 0 0 2px color-mix(in srgb, var(--rm-pine) 18%, transparent);
			}
			.onhand-row {
				display: flex;
				align-items: center;
				gap: 10px;
				font: 10.5px var(--rm-font-mono);
				color: var(--rm-subtext);
			}
			.onhand-row .ctl {
				display: inline-flex;
				align-items: center;
				gap: 5px;
				cursor: pointer;
				padding: 3px 6px;
				border-radius: 2px;
				border: 0;
				background: transparent;
				color: inherit;
			}
			.onhand-row .ctl:hover {
				background: var(--rm-mantle);
				color: var(--rm-text);
			}
			.onhand-row .learn {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				cursor: pointer;
				padding: 3px 6px;
				border-radius: 2px;
			}
			.onhand-row .learn .sw {
				width: 22px;
				height: 12px;
				border-radius: 999px;
				background: var(--rm-surface-2);
				position: relative;
				transition: background 120ms;
			}
			.onhand-row .learn .sw::after {
				content: "";
				position: absolute;
				top: 1px;
				left: 1px;
				width: 10px;
				height: 10px;
				border-radius: 50%;
				background: #fff;
				transition: transform 120ms;
			}
			.onhand-row .learn.on .sw {
				background: var(--rm-gold);
			}
			.onhand-row .learn.on .sw::after {
				transform: translateX(10px);
			}
			.onhand-row .spacer {
				flex: 1;
			}
			.onhand-send {
				font: 11px var(--rm-font-mono);
				background: var(--rm-pine);
				color: var(--rm-base);
				border: 0;
				border-radius: 2px;
				padding: 6px 12px;
				cursor: pointer;
				display: inline-flex;
				align-items: center;
				gap: 6px;
			}
			.onhand-send:hover {
				background: var(--rm-foam);
			}
			.onhand-send:disabled,
			.onhand-input:disabled,
			.onhand-row .ctl:disabled {
				opacity: 0.55;
				cursor: not-allowed;
			}
			.onhand-send .kbd {
				background: color-mix(in srgb, var(--rm-base) 18%, transparent);
				padding: 1px 4px;
				border-radius: 2px;
				font-size: 10px;
			}
			.onhand-hint {
				font: 10px var(--rm-font-mono);
				color: var(--rm-subtext);
				text-align: center;
				letter-spacing: 0.04em;
				margin-top: 2px;
			}
			.onhand-empty {
				padding: 20px 22px;
				font-size: 15px;
				line-height: 1.55;
				max-width: 46ch;
			}
			.onhand-empty .lede {
				color: var(--rm-text);
				font-weight: 600;
				margin-bottom: 6px;
			}
			.onhand-empty .empty-body {
				color: var(--rm-subtext);
				font-style: italic;
			}
		</style>
		<div class="onhand-sidebar panel" data-onhand-sidebar>
			<header class="onhand-head">
				<div class="onhand-brand" aria-label="Onhand">
					<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="M12 3.5 19.5 8v8L12 20.5 4.5 16V8L12 3.5Z" stroke="currentColor" stroke-width="1.8" />
						<path d="M12 8v8M8.5 10.2l7 4.1M15.5 10.2l-7 4.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
					</svg>
				</div>
				<input id="sessionTitleInput" class="onhand-title" type="text" value="Current session" aria-label="Session title" spellcheck="false" />
				<div class="onhand-menu-wrap">
					<button id="menuButton" class="onhand-menu" type="button" aria-label="Open Onhand menu" aria-haspopup="menu" aria-expanded="false">&#8943;</button>
					<div id="menuPanel" class="onhand-menu-panel" hidden>
						<div id="meta" class="onhand-status">Connecting to Onhand...</div>
						<label class="onhand-menu-field">
							<span>Session</span>
							<select id="sessionSelect" class="onhand-select"></select>
						</label>
						<div class="onhand-menu-actions">
							<button id="newSessionButton" class="session-button" type="button">New</button>
							<button id="restoreSessionButton" class="session-button" type="button">Restore pages</button>
							<button id="stopButton" class="session-button stop-button" type="button">Stop</button>
							<button id="closeButton" class="session-button" type="button">Close</button>
						</div>
						<div class="onhand-hotkeys">esc dismiss · cmd+n new entry · enter ask</div>
					</div>
				</div>
			</header>
			<div id="scroll" class="onhand-scroll">
				<section id="pageIndex" class="onhand-index" hidden></section>
				<div id="messages" class="message-list"></div>
				<div id="activity" hidden></div>
				<div id="actions" hidden></div>
				<section id="replySection" hidden>
					<div id="reply"></div>
				</section>
			</div>
			<form id="composer" class="onhand-compose">
				<div id="attachmentList" class="onhand-draft-chips"></div>
				<textarea id="input" class="onhand-input" placeholder="Ask about this page or your selection..."></textarea>
				<div class="onhand-row">
					<button id="attachButton" class="ctl" type="button" aria-label="Attach files" title="Attach files">&#128206;</button>
					<input id="fileInput" type="file" multiple hidden />
					<label id="learningModeLabel" class="learn" title="Learning Mode slows down the first answer and asks Onhand to scaffold and check understanding.">
						<span class="sw"></span>
						<input id="learningModeToggle" type="checkbox" hidden />
						<span>Learning</span>
					</label>
					<span class="spacer"></span>
					<button id="sendButton" class="onhand-send" type="submit">Ask <span class="kbd">&#8617;</span></button>
				</div>
				<div id="helper" class="onhand-hint">esc dismiss · cmd+n new entry</div>
			</form>
		</div>
	`;

	(document.body || document.documentElement).appendChild(host);

	const closeButton = shadow.getElementById("closeButton");
	const meta = shadow.getElementById("meta");
	const body = shadow.getElementById("scroll");
	const menuButton = shadow.getElementById("menuButton");
	const menuPanel = shadow.getElementById("menuPanel");
	const sessionTitleInput = shadow.getElementById("sessionTitleInput");
	const pageIndexEl = shadow.getElementById("pageIndex");
	const sessionSelect = shadow.getElementById("sessionSelect");
	const learningModeLabel = shadow.getElementById("learningModeLabel");
	const learningModeToggle = shadow.getElementById("learningModeToggle");
	const newSessionButton = shadow.getElementById("newSessionButton");
	const restoreSessionButton = shadow.getElementById("restoreSessionButton");
	const stopButton = shadow.getElementById("stopButton");
	const messagesEl = shadow.getElementById("messages");
	const activityEl = shadow.getElementById("activity");
	const replySectionEl = shadow.getElementById("replySection");
	const replyEl = shadow.getElementById("reply");
	const actionsEl = shadow.getElementById("actions");
	const composer = shadow.getElementById("composer");
	const attachButton = shadow.getElementById("attachButton");
	const fileInput = shadow.getElementById("fileInput");
	const attachmentList = shadow.getElementById("attachmentList");
	const input = shadow.getElementById("input");
	const helper = shadow.getElementById("helper");
	const sendButton = shadow.getElementById("sendButton");

	function setOpen(nextOpen) {
		open = Boolean(nextOpen);
		if (IS_NATIVE_SIDE_PANEL) {
			host.style.display = open ? "block" : "none";
		} else {
			for (const existingHost of Array.from(document.querySelectorAll(HOST_SELECTOR))) {
				if (!(existingHost instanceof HTMLElement)) continue;
				existingHost.style.display = existingHost === host && open ? "block" : "none";
			}
		}
		syncPageLayout(open);
		if (open) {
			startPolling();
			void requestState();
			void requestSessions().catch(() => {});
		} else {
			stopPolling();
		}
	}

	function stopPolling() {
		if (!pollingTimer) return;
		clearInterval(pollingTimer);
		pollingTimer = null;
	}

	function startPolling() {
		stopPolling();
		pollingTimer = setInterval(() => {
			void requestState();
		}, POLL_INTERVAL_MS);
	}

	function getSessionDraftKey(state) {
		return state?.currentSession?.sessionFile || state?.currentSession?.sessionId || "current";
	}

	function renderMeta(state) {
		const sessionKey = getSessionDraftKey(state);
		const sessionName = sessionTitleDrafts.get(sessionKey) || state?.currentSession?.sessionName || "Current session";
		const status = state?.status || "Ready";
		const statusKind = /failed|error/i.test(status) ? "error" : /ready|complete/i.test(status) ? "ok" : "";
		if (sessionTitleInput instanceof HTMLInputElement && shadow.activeElement !== sessionTitleInput) {
			sessionTitleInput.value = sessionName;
			sessionTitleInput.title = sessionName;
		}
		meta.className = `onhand-status ${statusKind}`;
		meta.innerHTML = `
			<div>Runtime</div>
			<div class="onhand-status-pill">
				<span class="onhand-status-dot"></span>
				<span>${escapeHtml(status)}</span>
			</div>
		`;
	}

	function renderSessionControls(state) {
		const currentPath = state?.currentSession?.sessionFile || sessionOverview?.currentSession?.sessionFile || "";
		const sessions = Array.isArray(sessionOverview?.sessions) ? sessionOverview.sessions : [];
		const learningMode = Boolean(state?.preferences?.learningMode);
		if (!sessions.length) {
			sessionSelect.innerHTML = `<option value="">${sessionLoading ? "Loading sessions…" : "Current session"}</option>`;
		} else {
			sessionSelect.innerHTML = sessions
				.map((session) => {
					const title = session?.title || session?.name || "Session";
					return `<option value="${escapeAttribute(session.path || "")}" ${session.path === currentPath ? "selected" : ""}>${escapeHtml(title)}</option>`;
				})
				.join("");
		}

		const activeRequest = Boolean(state?.activeRequestId);
		sessionSelect.disabled = sessionLoading || sessionSwitching || creatingSession || activeRequest;
		learningModeToggle.checked = learningMode;
		learningModeToggle.disabled = activeRequest || sessionLoading || sessionSwitching || creatingSession || restoringSession || stoppingRequest;
		learningModeLabel.classList.toggle("on", learningMode);
		composer.classList.toggle("learning", learningMode);
		newSessionButton.disabled = creatingSession || sessionSwitching || activeRequest;
		restoreSessionButton.disabled = restoringSession || creatingSession || sessionSwitching || activeRequest || !currentPath;
		stopButton.disabled = !activeRequest || stoppingRequest;
		stopButton.textContent = stoppingRequest ? "Stopping..." : "Stop";
		newSessionButton.textContent = creatingSession ? "Creating..." : "New";
		restoreSessionButton.textContent = restoringSession ? "Restoring..." : "Restore pages";
	}

	function renderAttachmentDrafts() {
		if (!attachmentDrafts.length) {
			attachmentList.innerHTML = "";
			return;
		}
		attachmentList.innerHTML = attachmentDrafts
			.map(
				(attachment) => `
					<div class="onhand-chip">
						<span>${escapeHtml(attachment.name || "attachment")}</span>
						<button class="x" data-attachment-id="${escapeAttribute(attachment.id || "")}" type="button" aria-label="Remove attachment">×</button>
					</div>
				`,
			)
			.join("");
	}

	function removeAttachmentDraft(attachmentId) {
		attachmentDrafts = attachmentDrafts.filter((attachment) => attachment.id !== attachmentId);
		renderAttachmentDrafts();
	}

	function buildDisplayPrompt(prompt, attachments) {
		const trimmedPrompt = String(prompt || "").trim();
		const attachmentNames = Array.isArray(attachments)
			? attachments.map((attachment) => String(attachment?.name || "attachment")).filter(Boolean)
			: [];
		const attachmentLine = attachmentNames.length ? `Attached: ${attachmentNames.join(", ")}` : "";
		return [trimmedPrompt, attachmentLine].filter(Boolean).join("\n\n") || attachmentLine;
	}

	async function requestSessions(limit = 20) {
		sessionLoading = true;
		renderSessionControls(currentState || {});
		try {
			const response = await chrome.runtime.sendMessage({ type: "sidebar:list-sessions", limit });
			if (!response?.ok) {
				throw new Error(response?.error || "Could not load sessions.");
			}
			sessionOverview = {
				currentSession: response.currentSession || null,
				sessions: Array.isArray(response.sessions) ? response.sessions : [],
			};
			renderSessionControls(currentState || {});
		} finally {
			sessionLoading = false;
			renderSessionControls(currentState || {});
		}
	}

	async function createNewSession() {
		creatingSession = true;
		renderState(currentState || {});
		try {
			const response = await chrome.runtime.sendMessage({ type: "sidebar:new-session" });
			if (!response?.ok) {
				throw new Error(response?.error || "Could not create a new session.");
			}
			await Promise.all([requestState(), requestSessions()]);
		} finally {
			creatingSession = false;
			renderState(currentState || {});
		}
	}

	async function switchSession(sessionPath) {
		if (!sessionPath) return;
		sessionSwitching = true;
		renderState(currentState || {});
		try {
			const response = await chrome.runtime.sendMessage({
				type: "sidebar:switch-session",
				sessionPath,
			});
			if (!response?.ok) {
				throw new Error(response?.error || "Could not switch sessions.");
			}
			await Promise.all([requestState(), requestSessions()]);
		} finally {
			sessionSwitching = false;
			renderState(currentState || {});
		}
	}

	async function restoreSessionPages() {
		const sessionPath =
			sessionSelect.value ||
			currentState?.currentSession?.sessionFile ||
			sessionOverview?.currentSession?.sessionFile ||
			"";
		if (!sessionPath) {
			throw new Error("Choose a session to restore first.");
		}
		restoringSession = true;
		renderState(currentState || {});
		try {
			const response = await chrome.runtime.sendMessage({
				type: "sidebar:restore-session",
				sessionPath,
			});
			if (!response?.ok) {
				throw new Error(response?.error || "Could not restore pages for that session.");
			}
			renderState({
				...(currentState || {}),
				status:
					response.restoredCount > 0
						? `Restored ${response.restoredCount} page${response.restoredCount === 1 ? "" : "s"} for this session.`
						: "No saved pages were restored for this session.",
			});
		} finally {
			restoringSession = false;
			renderState(currentState || {});
		}
	}

	async function stopActiveRun() {
		stoppingRequest = true;
		renderState(currentState || {});
		try {
			const response = await chrome.runtime.sendMessage({ type: "sidebar:stop" });
			if (!response?.ok) {
				throw new Error(response?.error || "Could not stop the current run.");
			}
			await Promise.all([requestState(), requestSessions()]);
		} finally {
			stoppingRequest = false;
			renderState(currentState || {});
		}
	}

	async function fileToAttachment(file) {
		const fileId = `${file.name}:${file.size}:${file.lastModified}:${crypto.randomUUID()}`;
		if (String(file.type || "").startsWith("image/")) {
			const dataUrl = await new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(String(reader.result || ""));
				reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`));
				reader.readAsDataURL(file);
			});
			const data = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
			return {
				id: fileId,
				kind: "image",
				name: file.name,
				mimeType: file.type || "image/png",
				data,
			};
		}

		if (isTextAttachment(file)) {
			return {
				id: fileId,
				kind: "text",
				name: file.name,
				mimeType: file.type || "text/plain",
				text: await file.text(),
			};
		}

		throw new Error("Only image and text-based attachments are supported in the sidebar right now.");
	}

	function deriveCurrentTurn(state) {
		const currentTurnId = state?.currentTurnId || state?.activeRequestId;
		if (!currentTurnId) return null;
		const messages = Array.isArray(state?.messages) ? state.messages : [];
		const userMessage = messages.find((message) => message?.id === `user:${currentTurnId}`);
		const assistantMessage = messages.find((message) => message?.id === `assistant:${currentTurnId}`);
		const userPrompt = String(userMessage?.text || "").trim();
		const reply = String(assistantMessage?.text || "").trim();
		const activities = Array.isArray(state?.activities) ? state.activities : [];
		const pageActions = Array.isArray(state?.pageActions) ? state.pageActions : [];
		if (!userPrompt && !reply && !activities.length && !pageActions.length) return null;
		return {
			id: currentTurnId,
			userPrompt,
			reply,
			activities,
			pageActions,
			pending: Boolean(state?.activeRequestId === currentTurnId || assistantMessage?.pending),
			error: Boolean(assistantMessage?.error),
			createdAt: userMessage?.createdAt || assistantMessage?.createdAt || new Date().toISOString(),
		};
	}

	function formatEntryTime(value) {
		const date = value ? new Date(value) : new Date();
		if (Number.isNaN(date.getTime())) return "";
		return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}

	function pluralize(count, singular, plural = `${singular}s`) {
		return `${count} ${count === 1 ? singular : plural}`;
	}

	function getCapturedAnnotations(state) {
		const candidates = [
			state?.page?.annotations,
			state?.captureState?.annotations,
			state?.pageState?.annotations,
			state?.browserState?.annotations,
			state?.annotations,
		];
		for (const candidate of candidates) {
			if (Array.isArray(candidate)) return candidate;
		}
		return [];
	}

	function buildAnnotationIndexItems(state) {
		const actions = Array.isArray(state?.pageActions) ? state.pageActions : [];
		const actionByAnnotation = new Map();
		for (const action of actions) {
			if (!action?.annotationId) continue;
			const previous = actionByAnnotation.get(action.annotationId);
			if (!previous || action.type === "note") {
				actionByAnnotation.set(action.annotationId, action);
			}
		}

		const tabId = typeof state?.tab?.id === "number" ? state.tab.id : null;
		const seen = new Set();
		const items = [];
		for (const annotation of getCapturedAnnotations(state)) {
			const annotationId = String(annotation?.annotationId || "").trim();
			if (!annotationId || seen.has(annotationId)) continue;
			seen.add(annotationId);
			const action = actionByAnnotation.get(annotationId);
			const note = annotation?.note || null;
			const matchedText = String(annotation?.matchedText || action?.citationText || action?.detail || note?.text || "Page annotation").trim();
			items.push({
				annotationId,
				tabId,
				actionKey: action?.key || "",
				kind: String(annotation?.kind || action?.type || "annotation"),
				text: matchedText,
				hasNote: Boolean(note || action?.type === "note"),
			});
		}

		if (items.length) return items;
		for (const action of actions) {
			const annotationId = String(action?.annotationId || "").trim();
			if (!annotationId || seen.has(annotationId)) continue;
			seen.add(annotationId);
			items.push({
				annotationId,
				tabId: typeof action?.tabId === "number" ? action.tabId : tabId,
				actionKey: action?.key || "",
				kind: action?.type || "annotation",
				text: String(action?.citationText || action?.detail || "Page annotation").trim(),
				hasNote: action?.type === "note",
			});
		}
		return items;
	}

	function renderPageIndex(state) {
		const items = buildAnnotationIndexItems(state);
		pageIndexEl.hidden = !items.length;
		if (!items.length) {
			pageIndexEl.innerHTML = "";
			return 0;
		}

		const noteCount = items.filter((item) => item.hasNote).length;
		const summary = [pluralize(items.length, "highlight"), noteCount ? pluralize(noteCount, "note") : ""]
			.filter(Boolean)
			.join(", ");
		pageIndexEl.innerHTML = `
			<div class="onhand-index-head">
				<span class="onhand-label">On this page</span>
				<span class="onhand-count">· ${escapeHtml(summary)}</span>
			</div>
			${items
				.map(
					(item, index) => `
						<button
							class="onhand-index-item"
							data-annotation-id="${escapeAttribute(item.annotationId)}"
							data-tab-id="${typeof item.tabId === "number" ? escapeAttribute(String(item.tabId)) : ""}"
							data-target="${item.hasNote ? "note" : "annotation"}"
							type="button"
						>
							<span class="onhand-index-num">${index + 1}</span>
							<span class="onhand-index-text">${escapeHtml(item.text || "Page annotation")}</span>
							${item.hasNote ? '<span class="onhand-index-note">edit</span>' : ""}
						</button>
					`,
				)
				.join("")}
		`;
		return items.length;
	}

	function renderActionButtons(actions, className = "onhand-actions") {
		const items = Array.isArray(actions) ? actions : [];
		if (!items.length) return "";
		return `
			<div class="${className}">
				${items
					.map(
						(action) => `
							<button class="onhand-action" data-action-key="${escapeAttribute(action.key)}" type="button">
								${escapeHtml(action.detail ? `${action.label}: ${action.detail}` : action.label || "Open")}
							</button>
						`,
					)
					.join("")}
			</div>
		`;
	}

	function getReasoningActivity(activities) {
		const allActivities = Array.isArray(activities) ? activities : [];
		return allActivities.filter((activity) => activity?.kind === "reasoning").slice(-1)[0] || null;
	}

	function renderReasoningDetails(turn) {
		const activities = Array.isArray(turn?.activities) ? turn.activities : [];
		const reasoning = getReasoningActivity(activities);
		const tools = activities.filter((activity) => activity?.kind !== "reasoning");
		const actions = Array.isArray(turn?.pageActions) ? turn.pageActions : [];
		const highlightCount = actions.filter((action) => action?.type === "annotation").length;
		const noteCount = actions.filter((action) => action?.type === "note").length;
		const lines = [
			String(reasoning?.text || "").trim(),
			...tools.map((activity) => String(activity?.label || activity?.toolName || "Activity").trim()).filter(Boolean),
		].filter(Boolean);
		if (!lines.length && !turn?.pending) return "";

		const summary = [
			turn?.pending ? "thinking" : "thought",
			highlightCount ? `highlighted ${pluralize(highlightCount, "passage")}` : "",
			noteCount ? `added ${pluralize(noteCount, "note")}` : "",
		]
			.filter(Boolean)
			.join(" · ");
		const open = reasoningExpanded == null ? Boolean(turn?.pending) : Boolean(reasoningExpanded);
		return `
			<details class="onhand-reason" ${open ? "open" : ""}>
				<summary>${escapeHtml(summary || "reasoning")}</summary>
				<div class="onhand-reason-body">${escapeHtml(lines.join("\n")) || "Working through the page context..."}</div>
			</details>
		`;
	}

	function renderMessages(turns, annotationCount = 0) {
		const items = (Array.isArray(turns) ? turns : []).filter(Boolean);
		if (!items.length) {
			messagesEl.innerHTML = annotationCount
				? ""
				: `
					<div class="onhand-empty">
						<div class="lede">Nothing on this page yet.</div>
						<div class="empty-body">Ask about the article, highlight a passage, or resume one of yesterday's entries from the menu.</div>
					</div>
				`;
			return;
		}

		messagesEl.innerHTML = items
			.map((turn) => {
				const citationGroups = buildCitationGroups(turn?.pageActions);
				const reply = String(turn?.reply || "").trim();
				return `
					<article class="onhand-entry ${turn?.error ? "error" : ""}">
						<div class="onhand-eyebrow">
							<time>${escapeHtml(formatEntryTime(turn?.createdAt))}</time>
							<span class="dot"></span>
							<span>Onhand</span>
							${Array.isArray(turn?.pageActions) && turn.pageActions.length ? '<span class="dot"></span><span>Page-grounded</span>' : ""}
						</div>
						${turn?.userPrompt ? `<p class="onhand-q">${escapeHtml(turn.userPrompt)}</p>` : ""}
						<div class="onhand-a ${turn?.pending ? "pending" : ""}">
							${reply ? renderReplyMarkdown(reply, citationGroups) : '<p class="reply-placeholder">Thinking...</p>'}
							${turn?.pending ? '<span class="onhand-cursor"></span>' : ""}
							${renderReasoningDetails(turn)}
							${renderActionButtons(turn?.pageActions)}
						</div>
					</article>
				`;
			})
			.join("");

		messagesEl.querySelectorAll(".onhand-reason").forEach((detailsEl) => {
			detailsEl.addEventListener("toggle", () => {
				reasoningExpanded = detailsEl.open;
			});
		});
	}

	function renderActivity() {
		activityEl.innerHTML = "";
	}

	function renderLatestReply() {
		replySectionEl.hidden = true;
		replyEl.innerHTML = "";
	}

	function renderActions() {
		actionsEl.innerHTML = "";
	}

	function renderState(state) {
		const wasNearBottom =
			body instanceof HTMLElement
				? body.scrollHeight - body.scrollTop - body.clientHeight < 96
				: false;
		if (state?.activeRequestId && state.activeRequestId !== lastActiveRequestId) {
			reasoningExpanded = null;
		}
		lastActiveRequestId = state?.activeRequestId || null;
		const archivedTurns = Array.isArray(state?.turns) ? state.turns : [];
		const currentTurn = deriveCurrentTurn(state);
		const displayTurns = [...archivedTurns];
		if (currentTurn && !displayTurns.some((turn) => turn?.id === currentTurn.id)) {
			displayTurns.push(currentTurn);
		}
		currentState = state;
		renderMeta(state);
		renderSessionControls(state);
		renderAttachmentDrafts();
		const annotationCount = renderPageIndex(state);
		renderMessages(displayTurns, annotationCount);
		renderActivity();
		renderLatestReply(state, currentTurn);
		renderActions(state);

		const activeRequest = Boolean(state?.activeRequestId);
		input.disabled = activeRequest || sending;
		sendButton.disabled = activeRequest || sending;
		attachButton.disabled = activeRequest || sending;
		fileInput.disabled = activeRequest || sending;
		helper.textContent = activeRequest
			? "Onhand is responding · use Stop from the menu"
			: attachmentDrafts.length
				? "attachments ready · enter ask"
				: "esc dismiss · cmd+n new entry";
		if (body instanceof HTMLElement && (activeRequest || wasNearBottom)) {
			body.scrollTop = body.scrollHeight;
		}
	}

	async function requestState() {
		if (!open) return;
		const response = await chrome.runtime.sendMessage({ type: "sidebar:fetch-state" });
		if (!response?.ok) {
			renderState({
				currentSession: { sessionName: "Onhand unavailable" },
				status: response?.error || "Could not reach the local Onhand runtime.",
				messages: [],
				activities: [],
				pageActions: [],
			});
			return;
		}
		renderState(response.state);
	}

	async function submitPrompt(prompt) {
		const trimmedPrompt = String(prompt || "").trim();
		if (!trimmedPrompt && !attachmentDrafts.length) return;
		const attachments = attachmentDrafts.map((attachment) => ({ ...attachment }));
		const displayPrompt = buildDisplayPrompt(trimmedPrompt, attachments);
		const learningMode = Boolean(currentState?.preferences?.learningMode);
		sending = true;
		renderState(currentState || {});
		try {
			const response = await chrome.runtime.sendMessage({
				type: "sidebar:submit-prompt",
				prompt: trimmedPrompt,
				displayPrompt,
				attachments,
				learningMode,
				source: "sidebar",
			});
			if (!response?.ok) {
				throw new Error(response?.error || "Could not submit prompt.");
			}
			input.value = "";
			attachmentDrafts = [];
			await Promise.all([requestState(), requestSessions()]);
		} finally {
			sending = false;
			renderState(currentState || {});
		}
	}

	async function activateAction(key) {
		const response = await chrome.runtime.sendMessage({
			type: "sidebar:activate-action",
			key,
		});
		if (!response?.ok) {
			throw new Error(response?.error || "Could not activate that Onhand link.");
		}
	}

	async function scrollToAnnotation(annotationId, tabId = null, target = "annotation") {
		const payload = {
			type: "sidebar:scroll-to-annotation",
			annotationId,
			target,
		};
		if (typeof tabId === "number" && Number.isFinite(tabId)) {
			payload.tabId = tabId;
		}
		const response = await chrome.runtime.sendMessage(payload);
		if (!response?.ok) {
			throw new Error(response?.error || "Could not scroll to that annotation.");
		}
	}

	async function renameSessionTitle(sessionName) {
		const response = await chrome.runtime.sendMessage({
			type: "sidebar:rename-session",
			sessionName,
		});
		if (!response?.ok) {
			throw new Error(response?.error || "Could not rename this session.");
		}
		if (response.currentSession) {
			currentState = {
				...(currentState || {}),
				currentSession: response.currentSession,
			};
		}
		await requestSessions();
	}

	async function updateLearningMode(learningMode) {
		const response = await chrome.runtime.sendMessage({
			type: "sidebar:set-learning-mode",
			learningMode,
		});
		if (!response?.ok) {
			throw new Error(response?.error || "Could not update Learning Mode.");
		}
		renderState({
			...(currentState || {}),
			preferences: {
				...(currentState?.preferences || {}),
				...(response.settings || {}),
				learningMode: Boolean(response.settings?.learningMode),
			},
		});
	}

	function setMenuOpen(nextOpen) {
		menuPanel.hidden = !nextOpen;
		menuButton.setAttribute("aria-expanded", nextOpen ? "true" : "false");
	}

	menuButton.addEventListener("click", () => {
		setMenuOpen(Boolean(menuPanel.hidden));
	});

	sessionTitleInput.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			sessionTitleInput.blur();
		}
		if (event.key === "Escape") {
			event.preventDefault();
			renderMeta(currentState || {});
			sessionTitleInput.blur();
		}
	});

	sessionTitleInput.addEventListener("blur", () => {
		const nextTitle = String(sessionTitleInput.value || "").trim();
		if (nextTitle && currentState?.currentSession) {
			sessionTitleDrafts.set(getSessionDraftKey(currentState), nextTitle);
			currentState.currentSession.sessionName = nextTitle;
			void renameSessionTitle(nextTitle)
				.then(() => requestState())
				.catch((error) => {
					renderState({
						...(currentState || {}),
						status: error?.message || String(error),
					});
				});
		}
		renderMeta(currentState || {});
	});

	closeButton.addEventListener("click", () => {
		setOpen(false);
		void ensureCurrentWindowId()
			.then((windowId) => chrome.runtime.sendMessage({ type: "sidebar:close", windowId }))
			.catch(() => {});
	});

	sessionSelect.addEventListener("change", () => {
		const nextSessionPath = sessionSelect.value;
		if (!nextSessionPath) return;
		void switchSession(nextSessionPath).catch((error) => {
			renderState({
				...(currentState || {}),
				status: error?.message || String(error),
			});
		});
	});

	learningModeToggle.addEventListener("change", () => {
		const nextValue = Boolean(learningModeToggle.checked);
		void updateLearningMode(nextValue).catch((error) => {
			learningModeToggle.checked = !nextValue;
			learningModeLabel.classList.toggle("on", !nextValue);
			renderState({
				...(currentState || {}),
				status: error?.message || String(error),
			});
		});
	});

	newSessionButton.addEventListener("click", () => {
		void createNewSession().catch((error) => {
			renderState({
				...(currentState || {}),
				status: error?.message || String(error),
			});
		});
	});

	restoreSessionButton.addEventListener("click", () => {
		void restoreSessionPages().catch((error) => {
			renderState({
				...(currentState || {}),
				status: error?.message || String(error),
			});
		});
	});

	stopButton.addEventListener("click", () => {
		void stopActiveRun().catch((error) => {
			renderState({
				...(currentState || {}),
				status: error?.message || String(error),
			});
		});
	});

	attachButton.addEventListener("click", () => {
		fileInput.click();
	});

	fileInput.addEventListener("change", () => {
		const files = Array.from(fileInput.files || []);
		if (!files.length) return;
		void Promise.all(files.map((file) => fileToAttachment(file)))
			.then((attachments) => {
				attachmentDrafts = [...attachmentDrafts, ...attachments];
				fileInput.value = "";
				renderState(currentState || {});
			})
			.catch((error) => {
				fileInput.value = "";
				renderState({
					...(currentState || {}),
					status: error?.message || String(error),
				});
			});
	});

	attachmentList.addEventListener("click", (event) => {
		const target = event.target instanceof Element ? event.target : null;
		const button = target?.closest("[data-attachment-id]");
		if (!(button instanceof HTMLElement)) return;
		removeAttachmentDraft(button.dataset.attachmentId || "");
		renderState(currentState || {});
	});

	pageIndexEl.addEventListener("click", (event) => {
		const target = event.target instanceof Element ? event.target : null;
		const button = target?.closest("[data-annotation-id]");
		if (!(button instanceof HTMLElement)) return;
		const tabId = button.dataset.tabId ? Number(button.dataset.tabId) : null;
		void scrollToAnnotation(
			button.dataset.annotationId || "",
			Number.isFinite(tabId) ? tabId : null,
			button.dataset.target === "note" ? "note" : "annotation",
		).catch((error) => {
			renderState({
				...(currentState || {}),
				status: error?.message || String(error),
			});
		});
	});

	composer.addEventListener("submit", (event) => {
		event.preventDefault();
		void submitPrompt(input.value).catch((error) => {
			renderState({
				...(currentState || {}),
				status: error?.message || String(error),
			});
		});
	});

	actionsEl.addEventListener("click", (event) => {
		const target = event.target instanceof Element ? event.target : null;
		const button = target?.closest("[data-action-key]");
		if (!(button instanceof HTMLElement)) return;
		void activateAction(button.dataset.actionKey || "").catch((error) => {
			renderState({
				...(currentState || {}),
				status: error?.message || String(error),
			});
		});
	});

	messagesEl.addEventListener("click", (event) => {
		const target = event.target instanceof Element ? event.target : null;
		const button = target?.closest("[data-action-key]");
		if (!(button instanceof HTMLElement)) return;
		void activateAction(button.dataset.actionKey || "").catch((error) => {
			renderState({
				...(currentState || {}),
				status: error?.message || String(error),
			});
		});
	});

	replyEl.addEventListener("click", (event) => {
		const target = event.target instanceof Element ? event.target : null;
		const button = target?.closest("[data-action-key]");
		if (!(button instanceof HTMLElement)) return;
		void activateAction(button.dataset.actionKey || "").catch((error) => {
			renderState({
				...(currentState || {}),
				status: error?.message || String(error),
			});
		});
	});

	if (!IS_NATIVE_SIDE_PANEL) {
		chrome.runtime.onMessage.addListener((message) => {
			if (message?.type === "onhand:sidebar-visibility") {
				setOpen(Boolean(message.open));
			}
		});
	}

	try {
		void ensureKatexLoaded();
		if (IS_NATIVE_SIDE_PANEL) {
			await ensureCurrentWindowId();
			setOpen(true);
		} else {
			const response = await chrome.runtime.sendMessage({
				type: "sidebar:get-window-state",
				windowId: await ensureCurrentWindowId(),
			});
			setOpen(Boolean(response?.open));
		}
	} catch {
		setOpen(false);
	}
})();
