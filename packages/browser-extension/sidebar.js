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
								class="reply-citation"
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
				font-family: "SF Pro Text", "Segoe UI", sans-serif;
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
				font-family: "SFMono-Regular", "JetBrains Mono", "Menlo", monospace;
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
				font-family: "Times New Roman", serif;
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
				font: 13px/1.45 "SF Pro Text", "Segoe UI", sans-serif;
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
		</style>
		<div class="panel">
			<div class="header">
				<div class="brand">
					<div class="eyebrow">Onhand</div>
					<div class="title">Browser Sidebar</div>
				</div>
				<button id="closeButton" class="close-button" type="button">Close</button>
			</div>
			<div id="meta" class="meta">Connecting to Onhand…</div>
			<div class="body">
				<section class="section">
					<div class="section-title">Session</div>
					<div class="session-toolbar">
						<select id="sessionSelect" class="session-select"></select>
						<label id="learningModeLabel" class="mode-toggle" title="Learning Mode slows down the first answer and pushes Onhand to scaffold and check understanding.">
							<input id="learningModeToggle" type="checkbox" />
							<span>Learning</span>
						</label>
					</div>
					<div class="session-actions">
						<button id="newSessionButton" class="session-button" type="button">New</button>
						<button id="restoreSessionButton" class="session-button" type="button">Restore Pages</button>
						<button id="stopButton" class="session-button stop-button" type="button">Stop</button>
					</div>
				</section>
				<section class="section">
					<div class="section-title">Conversation</div>
					<div id="messages" class="message-list"></div>
				</section>
				<section class="section">
					<div class="section-title">Live Activity</div>
					<div id="activity"></div>
				</section>
				<section class="section">
					<div class="section-title">On Page</div>
					<div id="actions" class="action-list"></div>
				</section>
				<section id="replySection" class="section">
					<div class="section-title">Latest Reply</div>
					<div id="reply"></div>
				</section>
			</div>
			<form id="composer" class="composer">
				<div class="composer-top">
					<button id="attachButton" class="attach-button" type="button">Attach</button>
					<input id="fileInput" type="file" multiple hidden />
				</div>
				<div id="attachmentList" class="attachment-list"></div>
				<textarea id="input" class="input" placeholder="Send another message to Onhand…"></textarea>
				<div class="actions-row">
					<div id="helper" class="helper">Messages here continue the current Onhand session.</div>
					<button id="sendButton" class="send-button" type="submit">Send</button>
				</div>
			</form>
		</div>
	`;

	(document.body || document.documentElement).appendChild(host);

	const closeButton = shadow.getElementById("closeButton");
	const meta = shadow.getElementById("meta");
	const body = shadow.querySelector(".body");
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

	function renderMeta(state) {
		const sessionName = state?.currentSession?.sessionName || "Current session";
		const status = state?.status || "Ready";
		const statusKind = /failed|error/i.test(status) ? "error" : /ready|complete/i.test(status) ? "ok" : "";
		meta.innerHTML = `
			<div>${escapeHtml(sessionName)}</div>
			<div class="status ${statusKind}">
				<span class="status-dot"></span>
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
		learningModeLabel.classList.toggle("active", learningMode);
		newSessionButton.disabled = creatingSession || sessionSwitching || activeRequest;
		restoreSessionButton.disabled = restoringSession || creatingSession || sessionSwitching || activeRequest || !currentPath;
		stopButton.disabled = !activeRequest || stoppingRequest;
		stopButton.textContent = stoppingRequest ? "Stopping…" : "Stop";
		newSessionButton.textContent = creatingSession ? "Creating…" : "New";
		restoreSessionButton.textContent = restoringSession ? "Restoring…" : "Restore Pages";
	}

	function renderAttachmentDrafts() {
		if (!attachmentDrafts.length) {
			attachmentList.innerHTML = "";
			return;
		}
		attachmentList.innerHTML = attachmentDrafts
			.map(
				(attachment) => `
					<div class="attachment-chip">
						<span>${escapeHtml(attachment.name || "attachment")}</span>
						<button class="attachment-remove" data-attachment-id="${escapeAttribute(attachment.id || "")}" type="button" aria-label="Remove attachment">×</button>
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
		};
	}

	function renderActionButtons(actions, className = "action-list") {
		const items = Array.isArray(actions) ? actions : [];
		if (!items.length) return "";
		return `
			<div class="${className}">
				${items
					.map(
						(action) => `
							<button class="action-button" data-action-key="${escapeHtml(action.key)}" type="button">
								${escapeHtml(action.detail ? `${action.label} · ${action.detail}` : action.label || "Open")}
							</button>
						`,
					)
					.join("")}
			</div>
		`;
	}

	function buildActivityMarkup(activities, options = {}) {
		const allActivities = Array.isArray(activities) ? activities : [];
		if (!allActivities.length) {
			return `<div class="empty-card">Tool runs and reasoning traces will show up here while Onhand is answering.</div>`;
		}

		const reasoningOpen = Boolean(options.reasoningOpen);
		const reasoningActivities = allActivities.filter((activity) => activity.kind === "reasoning");
		const nonReasoningActivities = allActivities.filter((activity) => activity.kind !== "reasoning");
		const visibleActivities = options.limitToRecent === false
			? [...reasoningActivities.slice(-1), ...nonReasoningActivities]
			: [...reasoningActivities.slice(-1), ...nonReasoningActivities.slice(-7)];

		return visibleActivities
			.map((activity) => {
				if (activity.kind === "reasoning") {
					return `
						<details class="reasoning-card" ${reasoningOpen ? "open" : ""}>
							<summary>${escapeHtml(activity.label || "Reasoning")}</summary>
							<div class="reasoning-body">${escapeHtml(activity.text || "")}</div>
						</details>
					`;
				}

				return `
					<div class="activity-card ${escapeHtml(activity.state || "")}">
						<div class="activity-dot"></div>
						<div>${escapeHtml(activity.label || activity.toolName || "Activity")}</div>
					</div>
				`;
			})
			.join("");
	}

	function renderMessages(turns) {
		const items = Array.isArray(turns) ? turns : [];
		if (!items.length) {
			messagesEl.innerHTML = `<div class="empty-card">Ask from the popup or here in the sidebar. Onhand will keep this conversation live while you browse.</div>`;
			return;
		}

		messagesEl.innerHTML = items
			.map((turn) => {
				const citationGroups = buildCitationGroups(turn?.pageActions);
				return `
					<div class="turn-card">
						${turn?.userPrompt
							? `
								<div class="message-card user">
									<div class="message-role">You</div>
									<div class="message-body">${escapeHtml(turn.userPrompt)}</div>
								</div>
							`
							: ""}
						${Array.isArray(turn?.activities) && turn.activities.length
							? `
								<div class="turn-subtitle">Live Activity</div>
								<div>${buildActivityMarkup(turn.activities, { reasoningOpen: false, limitToRecent: false })}</div>
							`
							: ""}
						${Array.isArray(turn?.pageActions) && turn.pageActions.length
							? `
								<div class="turn-subtitle">On Page</div>
								${renderActionButtons(turn.pageActions, "turn-actions")}
							`
							: ""}
						${String(turn?.reply || "").trim()
							? `
								<div class="reply-rich ${turn.pending ? "pending" : ""}">
									<div class="message-role">Onhand</div>
									<div class="message-body">${renderReplyMarkdown(turn.reply, citationGroups)}</div>
								</div>
							`
							: `<div class="empty-card">Thinking…</div>`}
					</div>
				`;
			})
			.join("");
	}

	function renderActivity(state, options = {}) {
		const activities = Array.isArray(state?.activities) ? state.activities : [];
		const reasoningOpen =
			reasoningExpanded == null ? Boolean(options.activeRequest) || !options.hasLatestReply : reasoningExpanded;
		activityEl.innerHTML = buildActivityMarkup(activities, {
			reasoningOpen,
			limitToRecent: true,
		});

		activityEl.querySelectorAll(".reasoning-card").forEach((detailsEl) => {
			detailsEl.addEventListener("toggle", () => {
				reasoningExpanded = detailsEl.open;
			});
		});
	}

	function renderLatestReply(state, latestAssistant) {
		const replyText = String(latestAssistant?.reply || latestAssistant?.text || "").trim();
		const hasReply = Boolean(replyText);
		replySectionEl.style.display = hasReply ? "flex" : "none";
		if (!hasReply) {
			replyEl.innerHTML = "";
			return;
		}
		const citationGroups = buildCitationGroups(latestAssistant?.pageActions || state?.pageActions);

		replyEl.innerHTML = `
			<div class="reply-rich ${latestAssistant?.pending || state?.activeRequestId ? "pending" : ""}">
				<div class="message-role">Onhand</div>
				<div class="message-body">${renderReplyMarkdown(replyText, citationGroups)}</div>
			</div>
		`;
	}

	function renderActions(state) {
		const actions = Array.isArray(state?.pageActions) ? state.pageActions : [];
		if (!actions.length) {
			actionsEl.innerHTML = `<div class="empty-card">When Onhand grounds an answer on the page, jump links will appear here.</div>`;
			return;
		}

		actionsEl.innerHTML = renderActionButtons(actions);
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
		currentState = state;
		renderMeta(state);
		renderSessionControls(state);
		renderAttachmentDrafts();
		renderMessages(archivedTurns);
		renderActivity(state, {
			hasLatestReply: Boolean(currentTurn?.reply?.trim()),
			activeRequest: Boolean(state?.activeRequestId),
		});
		renderLatestReply(state, currentTurn);
		renderActions(state);

		const activeRequest = Boolean(state?.activeRequestId);
		input.disabled = activeRequest || sending;
		sendButton.disabled = activeRequest || sending;
		attachButton.disabled = activeRequest || sending;
		fileInput.disabled = activeRequest || sending;
		helper.textContent = activeRequest
			? "Onhand is currently responding. You can stop this run or wait for it to finish."
			: attachmentDrafts.length
				? "Messages and attachments will continue the current Onhand session."
				: "Messages here continue the current Onhand session.";
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
			learningModeLabel.classList.toggle("active", !nextValue);
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
