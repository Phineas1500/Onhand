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

	removeStaleSidebarDom();

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
	host.style.position = "fixed";
	host.style.top = "0";
	host.style.right = "0";
	host.style.height = "100vh";
	host.style.width = `${SIDEBAR_WIDTH}px`;
	host.style.zIndex = "2147483647";
	host.style.pointerEvents = "none";
	host.style.display = "none";

	function ensurePageLayoutStyle() {
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
				gap: 12px;
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
				<textarea id="input" class="input" placeholder="Send another message to Onhand…"></textarea>
				<div class="actions-row">
					<div id="helper" class="helper">Messages here continue the current Onhand session.</div>
					<button id="sendButton" class="send-button" type="submit">Send</button>
				</div>
			</form>
		</div>
	`;

	document.documentElement.appendChild(host);

	const closeButton = shadow.getElementById("closeButton");
	const meta = shadow.getElementById("meta");
	const body = shadow.querySelector(".body");
	const messagesEl = shadow.getElementById("messages");
	const activityEl = shadow.getElementById("activity");
	const replySectionEl = shadow.getElementById("replySection");
	const replyEl = shadow.getElementById("reply");
	const actionsEl = shadow.getElementById("actions");
	const composer = shadow.getElementById("composer");
	const input = shadow.getElementById("input");
	const helper = shadow.getElementById("helper");
	const sendButton = shadow.getElementById("sendButton");

	function setOpen(nextOpen) {
		open = Boolean(nextOpen);
		for (const existingHost of Array.from(document.querySelectorAll(HOST_SELECTOR))) {
			if (!(existingHost instanceof HTMLElement)) continue;
			existingHost.style.display = existingHost === host && open ? "block" : "none";
		}
		syncPageLayout(open);
		if (open) {
			startPolling();
			void requestState();
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

	function deriveMessageView(state) {
		const messages = Array.isArray(state?.messages) ? state.messages : [];
		const visibleMessages = messages.filter((message) => {
			if (!message || typeof message !== "object") return false;
			if (message.role === "assistant") {
				return Boolean(String(message.text || "").trim());
			}
			return true;
		});
		let latestAssistantIndex = -1;
		for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
			if (visibleMessages[index]?.role === "assistant") {
				latestAssistantIndex = index;
				break;
			}
		}
		return {
			conversationMessages: visibleMessages.filter((_, index) => index !== latestAssistantIndex),
			latestAssistant: latestAssistantIndex >= 0 ? visibleMessages[latestAssistantIndex] : null,
		};
	}

	function renderMessages(messages) {
		if (!messages.length) {
			messagesEl.innerHTML = `<div class="empty-card">Ask from the popup or here in the sidebar. Onhand will keep this conversation live while you browse.</div>`;
			return;
		}

		messagesEl.innerHTML = messages
			.map((message) => {
				const roleLabel = message.role === "user" ? "You" : "Onhand";
				return `
					<div class="message-card ${message.role === "user" ? "user" : "assistant"}">
						<div class="message-role">${escapeHtml(roleLabel)}</div>
						<div class="message-body">${escapeHtml(message.text || "")}</div>
					</div>
				`;
			})
			.join("");
	}

	function renderActivity(state, options = {}) {
		const activities = Array.isArray(state?.activities) ? state.activities : [];
		if (!activities.length) {
			activityEl.innerHTML = `<div class="empty-card">Tool runs and reasoning traces will show up here while Onhand is answering.</div>`;
			return;
		}

		const reasoningOpen =
			reasoningExpanded == null ? Boolean(options.activeRequest) || !options.hasLatestReply : reasoningExpanded;
		const reasoningActivities = activities.filter((activity) => activity.kind === "reasoning");
		const nonReasoningActivities = activities.filter((activity) => activity.kind !== "reasoning");
		const visibleActivities = [...reasoningActivities.slice(-1), ...nonReasoningActivities.slice(-7)];

		activityEl.innerHTML = visibleActivities
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

		activityEl.querySelectorAll(".reasoning-card").forEach((detailsEl) => {
			detailsEl.addEventListener("toggle", () => {
				reasoningExpanded = detailsEl.open;
			});
		});
	}

	function renderLatestReply(state, latestAssistant) {
		const replyText = String(latestAssistant?.text || "").trim();
		const hasReply = Boolean(replyText);
		replySectionEl.style.display = hasReply ? "flex" : "none";
		if (!hasReply) {
			replyEl.innerHTML = "";
			return;
		}
		const citationGroups = buildCitationGroups(state?.pageActions);

		replyEl.innerHTML = `
			<div class="reply-rich ${state?.activeRequestId ? "pending" : ""}">
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

		actionsEl.innerHTML = actions
			.map(
				(action) => `
					<button class="action-button" data-action-key="${escapeHtml(action.key)}" type="button">
						${escapeHtml(action.detail ? `${action.label} · ${action.detail}` : action.label || "Open")}
					</button>
				`,
			)
			.join("");
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
		const messageView = deriveMessageView(state);
		currentState = state;
		renderMeta(state);
		renderMessages(messageView.conversationMessages);
		renderActivity(state, {
			hasLatestReply: Boolean(messageView.latestAssistant?.text?.trim()),
			activeRequest: Boolean(state?.activeRequestId),
		});
		renderLatestReply(state, messageView.latestAssistant);
		renderActions(state);

		const activeRequest = Boolean(state?.activeRequestId);
		input.disabled = activeRequest || sending;
		sendButton.disabled = activeRequest || sending;
		helper.textContent = activeRequest
			? "Onhand is currently responding. Wait for this turn to finish before sending another message."
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
		if (!prompt.trim()) return;
		sending = true;
		renderState(currentState || {});
		try {
			const response = await chrome.runtime.sendMessage({
				type: "sidebar:submit-prompt",
				prompt,
			});
			if (!response?.ok) {
				throw new Error(response?.error || "Could not submit prompt.");
			}
			input.value = "";
			await requestState();
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

	closeButton.addEventListener("click", () => {
		setOpen(false);
		void chrome.runtime.sendMessage({ type: "sidebar:close" }).catch(() => {});
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

	chrome.runtime.onMessage.addListener((message) => {
		if (message?.type === "onhand:sidebar-visibility") {
			setOpen(Boolean(message.open));
		}
	});

	try {
		void ensureKatexLoaded();
		const response = await chrome.runtime.sendMessage({ type: "sidebar:get-window-state" });
		setOpen(Boolean(response?.open));
	} catch {
		setOpen(false);
	}
})();
