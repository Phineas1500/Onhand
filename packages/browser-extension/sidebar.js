(async () => {
	if (globalThis.__onhandSidebarInjected) return;
	globalThis.__onhandSidebarInjected = true;

	const SIDEBAR_WIDTH = 420;
	const POLL_INTERVAL_MS = 900;
	const ACTION_ACTIVATION_DEDUP_MS = 900;
	const PAGE_OPEN_CLASS = "onhand-extension-sidebar-open";
	const PAGE_STYLE_ID = "onhand-extension-sidebar-layout";
	const HOST_ID = "onhand-extension-sidebar-host";
	const HOST_SELECTOR = `[id="${HOST_ID}"]`;
	const SIDEBAR_THEME_STORAGE_KEY = "onhandSidebarTheme";
	const SIDEBAR_QUICK_OPEN_REQUEST_KEY = "onhandSidebarQuickOpenRequest";
	const SIDEBAR_QUICK_OPEN_MAX_AGE_MS = 30 * 1000;
	const SIDEBAR_QUICK_OPEN_FOCUS_DELAYS_MS = [0, 80, 240, 600, 1200];
	const SIDEBAR_QUICK_OPEN_KEY_CAPTURE_MS = 15 * 1000;
	const REALTIME_MIC_DEVICE_STORAGE_KEY = "onhandRealtimeMicDeviceId";
	const REALTIME_SESSION_URL = "http://127.0.0.1:8787/session";
	const REALTIME_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
	const REALTIME_BACKEND_PREAMBLE_DELAY_MS = 1200;
	const REALTIME_TRANSCRIPTION_FALLBACK_MS = 1800;
	const REALTIME_TRANSCRIPT_FINALIZE_DELAY_MS = 1000;
	const REALTIME_SERVER_VAD_GRACE_MS = 1200;
	const REALTIME_LOCAL_SPEECH_RMS = 0.002;
	const REALTIME_LOCAL_SPEECH_MIN_RMS = 0.00085;
	const REALTIME_LOCAL_SPEECH_NOISE_MULTIPLIER = 3.2;
	const REALTIME_MIC_IDLE_STATUS_MS = 1200;
	const REALTIME_MIC_SILENCE_DIAGNOSTIC_MS = 6500;
	const REALTIME_API_KEY_SETUP_MESSAGE =
		"Voice needs an OpenAI platform API key. Open Onhand options, paste a platform key with Realtime API access in the OpenAI platform API key field, then Save.";
	const CODEX_PROVIDER = "openai-codex";
	const CODEX_MODEL = "gpt-5.5";
	const TOKEN_PREFIX = "@@ONHAND_TOKEN_";
	const SIDEBAR_THEME_VALUES = new Set(["system", "light", "dark"]);
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
	let progressExpanded = null;
	let lastActiveRequestId = null;
	let katexModule = null;
	let katexLoadPromise = null;
	let currentWindowId = null;
	let sessionOverview = null;
	let sessionLoading = false;
	let sessionSwitching = false;
	let pendingSessionPath = "";
	let creatingSession = false;
	let restoringSession = false;
	let openingPdfViewer = false;
	let lastRestoreResult = null;
	let stoppingRequest = false;
	let authSigningIn = false;
	let authStatusText = "";
	let authStatusKind = "";
	let sidebarTheme = "system";
	let attachmentDrafts = [];
	let quickOpenFocusGeneration = 0;
	let quickOpenFocusUntil = 0;
	let quickOpenKeyCaptureUntil = 0;
	let learnerSourceFeedback = null;
	let learnerSourceFeedbackSequence = 0;
	let learnerPanelCollapsed = false;
	let learnerGridScrollTop = 0;
	let realtimePeerConnection = null;
	let realtimeDataChannel = null;
	let realtimeMediaStream = null;
	let realtimeAudio = null;
	let realtimeConnecting = false;
	let realtimeConnected = false;
	let realtimeStatus = "Voice idle";
	let realtimeError = "";
	let realtimeErrorExpanded = false;
	let realtimeAnswer = null;
	let realtimeTranscriptBuffer = "";
	let realtimeRestartAfterMicPermission = false;
	let realtimeMicPermissionTabId = null;
	let realtimeAudioContext = null;
	let realtimeMicMonitorSource = null;
	let realtimeMicMonitorAnalyser = null;
	let realtimeMicMonitorTimer = null;
	let realtimeMicCurrentRms = 0;
	let realtimeMicPeakRms = 0;
	let realtimeMicLastIdleStatusAt = 0;
	let realtimeMicNoiseFloorRms = 0;
	let realtimeMicMonitorStartedAt = 0;
	let realtimeMicMonitorFrames = 0;
	let realtimeMicDeviceId = "default";
	let realtimeMicDevices = [];
	let realtimeActiveMicLabel = "";
	let realtimeMicTrackDetails = "";
	let realtimeMicSelectSignature = "";
	let realtimeVoiceFallbackTimer = null;
	let realtimeManualVoiceResponseTimer = null;
	let realtimeTranscriptionFallbackTimer = null;
	let realtimePendingTranscriptTimer = null;
	let realtimePendingTranscriptSegments = [];
	let realtimeBackendPreambleTimer = null;
	let realtimeIdleTimeoutTimer = null;
	let realtimeLocalSpeechActive = false;
	let realtimeServerSpeechSeenAt = 0;
	let realtimeManualVoiceCommitPending = false;
	let realtimePendingTranscriptionItemId = "";
	let realtimeResponseInProgress = false;
	let realtimeResponseCreateQueued = false;
	let realtimeQueuedResponseRequest = null;
	let realtimeResponseVoiceTurnId = "";
	let realtimeSuppressTranscriptForResponse = false;
	let realtimeResponseAfterDoneStatus = "";
	let realtimePendingDirectAnswerRequestId = "";
	let realtimePendingDirectAnswerPrompt = "";
	let realtimePendingDirectAnswerVoiceTurnId = "";
	let realtimePendingSocraticMove = null;
	let realtimeSocraticTurnCounter = 0;
	let realtimeVoiceTurnCounter = 0;
	let realtimeActiveVoiceTurn = null;
	const realtimeNarratedDirectAnswerRequestIds = new Set();
	const realtimePersistedVoiceTurnIds = new Set();
	const realtimeHandledCallIds = new Set();
	const realtimeAudioFallbackItemIds = new Set();
	let replayArtifactsScrollLeft = 0;
	let replayState = {
		open: false,
		loading: false,
		loadingArtifact: false,
		error: "",
		session: null,
		turns: [],
		pageActions: [],
		artifacts: [],
		replayableAnnotations: [],
		selectedArtifactId: "",
		sessionPath: "",
		artifact: null,
	};
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

	function normalizeSidebarTheme(value) {
		const normalized = String(value || "system").toLowerCase();
		return SIDEBAR_THEME_VALUES.has(normalized) ? normalized : "system";
	}

	async function loadSidebarThemePreference() {
		try {
			const stored = await chrome.storage.local.get({ [SIDEBAR_THEME_STORAGE_KEY]: "system" });
			return normalizeSidebarTheme(stored[SIDEBAR_THEME_STORAGE_KEY]);
		} catch {
			return "system";
		}
	}

	async function saveSidebarThemePreference(nextTheme) {
		await chrome.storage.local.set({ [SIDEBAR_THEME_STORAGE_KEY]: normalizeSidebarTheme(nextTheme) });
	}

	function normalizeRealtimeMicDeviceId(value) {
		const normalized = String(value || "default").trim();
		return normalized || "default";
	}

	async function loadRealtimeMicDevicePreference() {
		try {
			const stored = await chrome.storage.local.get({ [REALTIME_MIC_DEVICE_STORAGE_KEY]: "default" });
			return normalizeRealtimeMicDeviceId(stored[REALTIME_MIC_DEVICE_STORAGE_KEY]);
		} catch {
			return "default";
		}
	}

	async function saveRealtimeMicDevicePreference(deviceId) {
		await chrome.storage.local.set({ [REALTIME_MIC_DEVICE_STORAGE_KEY]: normalizeRealtimeMicDeviceId(deviceId) });
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
			.map(normalizeCitationToken)
			.filter((token) => {
				if (!token) return false;
				if (CITATION_STOP_WORDS.has(token)) return false;
				if (/^\d+$/.test(token)) return token.length >= 3;
				return token.length >= 3;
			});
	}

	function normalizeCitationToken(token) {
		const value = String(token || "").trim();
		if (/^[a-z]{5,}s$/.test(value) && !/(?:ss|us|is)$/.test(value)) return value.slice(0, -1);
		return value;
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

	function getCitationTargetKey(action) {
		const url = String(action?.url || "").trim().split("#")[0];
		if (url) return `url:${url}`;
		const title = normalizeCitationText(action?.title || "");
		if (title) return `title:${title}`;
		return "page";
	}

	function getCitationEvidenceKey(action) {
		const citationText = normalizeCitationText(action?.citationText || action?.detail || "");
		if (!citationText) return "";
		return `${getCitationTargetKey(action)}:${citationText}`;
	}

	function createCitationRegistry() {
		return {
			groups: [],
			groupMap: new Map(),
			evidenceMap: new Map(),
		};
	}

	function ensureCitationGroup(registry, action) {
		if (!action || typeof action !== "object") return null;
		if (action.type !== "annotation" && action.type !== "note") return null;
		const targetKey = getCitationTargetKey(action);
		const annotationGroupId = action.annotationId ? `annotation:${targetKey}:${action.annotationId}` : "";
		const evidenceKey = getCitationEvidenceKey(action);
		let group = (annotationGroupId && registry.groupMap.get(annotationGroupId)) || (evidenceKey && registry.evidenceMap.get(evidenceKey)) || null;
		if (!group) {
			const groupId = annotationGroupId || evidenceKey || action.key;
			group = {
				groupId,
				sourceIndex: registry.groups.length,
				actionKey: action.key,
				noteKey: null,
				highlightKey: null,
				matchTokens: new Set(),
				snippets: new Set(),
				titles: [],
			};
			registry.groupMap.set(groupId, group);
			registry.groups.push(group);
		}
		if (annotationGroupId) registry.groupMap.set(annotationGroupId, group);
		if (evidenceKey) registry.evidenceMap.set(evidenceKey, group);
		return group;
	}

	function addCitationActionToRegistry(registry, action) {
		const group = ensureCitationGroup(registry, action);
		if (!group) return null;
		const citationText = String(action.citationText || action.detail || "").trim();
		for (const token of tokenizeCitationText(citationText)) {
			group.matchTokens.add(token);
		}
		for (const snippet of buildCitationSnippets(citationText)) {
			group.snippets.add(snippet);
		}
		if (action.type === "annotation" && !group.highlightKey) {
			group.highlightKey = action.key;
		}
		if (action.type === "note" && !group.noteKey) {
			group.noteKey = action.key;
		}
		group.actionKey = group.noteKey || group.highlightKey || group.actionKey || action.key;
		group.titles.push(action.detail ? `${action.label}: ${action.detail}` : action.label || "Open page evidence");
		return group;
	}

	function getPublicCitationGroups(registry, currentGroupIds = new Set()) {
		return registry.groups.map((group) => ({
			groupId: group.groupId,
			sourceIndex: group.sourceIndex,
			actionKey: group.noteKey || group.highlightKey || group.actionKey,
			matchTokens: [...group.matchTokens],
			snippets: [...group.snippets],
			title: group.titles[0] || "Open page evidence",
			current: currentGroupIds.has(group.groupId),
		}));
	}

	function buildTurnCitationGroups(turns) {
		const registry = createCitationRegistry();
		const byTurnId = new Map();
		for (const turn of Array.isArray(turns) ? turns : []) {
			const currentGroupIds = new Set();
			for (const action of Array.isArray(turn?.pageActions) ? turn.pageActions : []) {
				const group = addCitationActionToRegistry(registry, action);
				if (group) currentGroupIds.add(group.groupId);
			}
			if (turn?.id) byTurnId.set(turn.id, getPublicCitationGroups(registry, currentGroupIds));
		}
		return byTurnId;
	}

	function buildCitationGroups(actions) {
		const registry = createCitationRegistry();
		const currentGroupIds = new Set();
		for (const action of Array.isArray(actions) ? actions : []) {
			const group = addCitationActionToRegistry(registry, action);
			if (group) currentGroupIds.add(group.groupId);
		}
		return getPublicCitationGroups(registry, currentGroupIds);
	}

	function createCitationNumbering() {
		return {
			nextNumber: 1,
			groupNumbers: new Map(),
		};
	}

	function getCitationGroupKey(citation) {
		return citation?.groupId || citation?.actionKey || citation?.title || "";
	}

	function assignCitationNumber(citation, numbering) {
		if (!numbering) return citation;
		const groupKey = getCitationGroupKey(citation);
		if (!groupKey) return { ...citation, number: citation.number || numbering.nextNumber++ };
		if (!numbering.groupNumbers.has(groupKey)) {
			numbering.groupNumbers.set(groupKey, numbering.nextNumber++);
		}
		return { ...citation, number: numbering.groupNumbers.get(groupKey) };
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
			let position = Number.POSITIVE_INFINITY;
			for (const snippet of group.snippets) {
				if (!snippet) continue;
				const blockIndex = blockNormalized.indexOf(snippet);
				const snippetIndex = snippet.indexOf(blockNormalized);
				if (blockIndex >= 0 || snippetIndex >= 0) {
					phraseBonus = Math.max(phraseBonus, snippet.split(" ").length >= 5 ? 4 : 2.5);
					position = Math.min(position, blockIndex >= 0 ? blockIndex : 0);
				}
			}
			if (!Number.isFinite(position)) {
				for (const token of group.matchTokens) {
					const tokenIndex = blockNormalized.indexOf(token);
					if (tokenIndex >= 0) position = Math.min(position, tokenIndex);
				}
			}

			const score = overlap + numericOverlap * 1.5 + phraseBonus;
			const minimumOverlap = numericOverlap > 0 ? 1 : 2;
			const minimumScore = numericOverlap > 0 ? 2.5 : blockTokens.size <= 18 ? 2 : 3;
			const matchedCurrentEvidence = group.current && overlap >= minimumOverlap && score >= minimumScore;
			if (phraseBonus >= 4 || matchedCurrentEvidence) {
				matches.push({
					groupId: group.groupId,
					sourceIndex: group.sourceIndex,
					actionKey: group.actionKey,
					title: group.title,
					position,
					score,
				});
			}
		}

		return matches
			.sort((left, right) => right.score - left.score || (left.sourceIndex || 0) - (right.sourceIndex || 0))
			.slice(0, 2)
			.sort((left, right) => {
				const leftPosition = Number.isFinite(left.position) ? left.position : Number.POSITIVE_INFINITY;
				const rightPosition = Number.isFinite(right.position) ? right.position : Number.POSITIVE_INFINITY;
				if (leftPosition !== rightPosition) return leftPosition - rightPosition;
				return right.score - left.score || (left.sourceIndex || 0) - (right.sourceIndex || 0);
			});
	}

	function renderReplyCitations(citations, citationNumbering) {
		if (!citations.length) return "";
		const numberedCitations = citations.map((citation) => assignCitationNumber(citation, citationNumbering));
		return `
			<span class="reply-citations">
				${numberedCitations
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

	function renderCitedBlock(tag, text, citationGroups, citationNumbering) {
		const citations = findCitationsForBlock(text, citationGroups);
		return `<${tag}>${renderInlineRichText(text)}${renderReplyCitations(citations, citationNumbering)}</${tag}>`;
	}

	function renderReplyMarkdown(text, citationGroups = [], citationNumbering = createCitationNumbering()) {
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
			parts.push(renderCitedBlock("p", paragraphLines.join(" "), citationGroups, citationNumbering));
			paragraphLines = [];
		}

		function flushList() {
			if (!listItems.length) return;
			const tag = listKind === "ordered" ? "ol" : "ul";
			parts.push(`<${tag}>${listItems.map((item) => renderCitedBlock("li", item, citationGroups, citationNumbering)).join("")}</${tag}>`);
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
				parts.push(renderCitedBlock("blockquote", quoteMatch[1], citationGroups, citationNumbering));
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

		return blockStore.restore(parts.join("")) || renderCitedBlock("p", source, citationGroups, citationNumbering);
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

	sidebarTheme = await loadSidebarThemePreference();
	realtimeMicDeviceId = await loadRealtimeMicDevicePreference();

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

	const sidebarThemeTargets = [host];

	function applySidebarTheme(nextTheme) {
		sidebarTheme = normalizeSidebarTheme(nextTheme);
		for (const target of sidebarThemeTargets) {
			if (!(target instanceof HTMLElement)) continue;
			if (sidebarTheme === "system") {
				target.removeAttribute("data-onhand-theme");
			} else {
				target.setAttribute("data-onhand-theme", sidebarTheme);
			}
		}
	}

	applySidebarTheme(sidebarTheme);

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
			.reply-rich .onhand-cite {
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
			.reply-rich .onhand-cite:hover {
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
				color-scheme: light;
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
					color-scheme: dark;
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

			:host([data-onhand-theme="light"]),
			.onhand-sidebar[data-onhand-theme="light"] {
				color-scheme: light;
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
			}

			:host([data-onhand-theme="dark"]),
			.onhand-sidebar[data-onhand-theme="dark"] {
				color-scheme: dark;
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
			.onhand-logo-mark {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 20px;
				height: 20px;
				font: 22px/1 "Apple Symbols", "Segoe UI Symbol", "Noto Sans Symbols 2", "Noto Sans Symbols", serif;
				color: currentColor;
				transform: translateY(-1px);
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
			.onhand-auth-panel[hidden] {
				display: none;
			}
			.onhand-auth-panel {
				border-bottom: 1px solid var(--rm-surface-1);
				padding: 14px 18px;
				background: color-mix(in srgb, var(--rm-gold) 10%, transparent);
			}
			.onhand-auth-title {
				color: var(--rm-text);
				font: 700 13px/1.3 var(--rm-font-mono);
				margin-bottom: 5px;
			}
			.onhand-auth-copy {
				color: var(--rm-subtext);
				font: 12.5px/1.45 var(--rm-font-serif);
				margin: 0 0 10px;
			}
			.onhand-auth-actions {
				display: flex;
				align-items: center;
				gap: 9px;
				flex-wrap: wrap;
			}
			.onhand-auth-button {
				border: 0;
				border-radius: 3px;
				background: var(--rm-pine);
				color: var(--rm-base);
				font: 700 11px/1 var(--rm-font-mono);
				padding: 8px 10px;
				cursor: pointer;
			}
			.onhand-auth-button:hover {
				background: var(--rm-foam);
			}
			.onhand-auth-button:disabled {
				opacity: 0.62;
				cursor: wait;
			}
			.onhand-auth-status {
				min-width: 0;
				color: var(--rm-subtext);
				font: 10.5px/1.35 var(--rm-font-mono);
			}
			.onhand-auth-status.error {
				color: var(--rm-love);
			}
			.onhand-auth-status.ok {
				color: var(--rm-pine);
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
			.onhand-restore-head {
				display: flex;
				align-items: baseline;
				justify-content: space-between;
				gap: 8px;
				margin-bottom: 8px;
			}
			.onhand-menu-restore-result[hidden] {
				display: none;
			}
			.onhand-restore-result {
				margin-top: 10px;
				border-top: 1px solid var(--rm-surface-1);
				padding-top: 10px;
			}
			.onhand-restore-pages {
				display: flex;
				flex-direction: column;
				gap: 6px;
			}
			.onhand-restore-page {
				padding: 7px 8px;
				background: var(--rm-crust);
				border: 1px solid var(--rm-surface-1);
				font-size: 12px;
				line-height: 1.35;
			}
			.onhand-restore-title {
				display: block;
				font-weight: 600;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}
			.onhand-restore-meta,
			.onhand-restore-failure {
				display: block;
				margin-top: 3px;
				color: var(--rm-subtext);
				font: 10px/1.35 var(--rm-font-mono);
			}
			.onhand-restore-failure {
				color: var(--rm-love);
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}
			.onhand-index[hidden] {
				display: none;
			}
			.onhand-learner-panel[hidden] {
				display: none;
			}
			.onhand-learner-panel {
				border-top: 1px solid var(--rm-surface-2);
				background: color-mix(in srgb, var(--rm-mantle) 58%, transparent);
				padding: 10px 14px 11px;
			}
			.onhand-learner-head {
				display: flex;
				align-items: baseline;
				justify-content: space-between;
				gap: 10px;
				margin-bottom: 8px;
			}
			.onhand-learner-head-main {
				display: flex;
				align-items: baseline;
				gap: 7px;
				min-width: 0;
			}
			.onhand-learner-toggle {
				border: 0;
				background: transparent;
				color: var(--rm-pine);
				font: 700 10.5px/1.2 var(--rm-font-mono);
				padding: 1px 0;
				cursor: pointer;
			}
			.onhand-learner-toggle:hover {
				color: var(--rm-foam);
				text-decoration: underline;
			}
			.onhand-learner-body[hidden] {
				display: none;
			}
			.onhand-learner-grid {
				display: grid;
				grid-template-columns: minmax(0, 1fr);
				gap: 8px;
				max-height: min(260px, 36vh);
				overflow-y: auto;
				padding-right: 2px;
			}
			.onhand-learner-group {
				min-width: 0;
			}
			.onhand-learner-group-title {
				display: block;
				margin-bottom: 4px;
				font: 700 10px/1 var(--rm-font-mono);
				letter-spacing: 0.05em;
				text-transform: uppercase;
				color: var(--rm-subtext);
			}
			.onhand-learner-items {
				display: flex;
				flex-direction: column;
				gap: 4px;
			}
			.onhand-learner-item {
				display: grid;
				grid-template-columns: minmax(0, 1fr) auto;
				align-items: start;
				gap: 8px;
				min-width: 0;
				padding: 6px 7px;
				background: color-mix(in srgb, var(--rm-base) 60%, transparent);
				border: 1px solid var(--rm-surface-1);
				border-radius: 3px;
			}
			.onhand-learner-main {
				min-width: 0;
			}
			.onhand-learner-title {
				display: block;
				color: var(--rm-text);
				font-size: 13px;
				line-height: 1.3;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.onhand-learner-detail {
				display: block;
				margin-top: 2px;
				color: var(--rm-subtext);
				font: 10.5px/1.35 var(--rm-font-mono);
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.onhand-learner-source {
				border: 0;
				background: transparent;
				color: var(--rm-pine);
				font: 700 10.5px/1.2 var(--rm-font-mono);
				padding: 2px 0;
				cursor: pointer;
			}
			.onhand-learner-source:hover {
				color: var(--rm-foam);
				text-decoration: underline;
			}
			.onhand-learner-feedback {
				margin: -2px 0 8px;
				color: var(--rm-subtext);
				font: 10.5px/1.35 var(--rm-font-mono);
			}
			.onhand-learner-feedback.ok {
				color: var(--rm-pine);
			}
			.onhand-learner-feedback.error {
				color: var(--rm-love);
			}
			.onhand-learner-more {
				color: var(--rm-subtext);
				font: 10.5px/1.3 var(--rm-font-mono);
				padding: 1px 7px;
			}
			.onhand-replay[hidden] {
				display: none;
			}
			.onhand-replay {
				padding: 10px 16px 12px;
				border-bottom: 1px solid var(--rm-surface-1);
				background: color-mix(in srgb, var(--rm-mantle) 28%, transparent);
			}
			.onhand-replay-head {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 10px;
			}
			.onhand-replay-toggle {
				flex: 1 1 auto;
				min-width: 0;
				display: flex;
				align-items: baseline;
				gap: 7px;
				padding: 2px 0;
				border: 0;
				background: transparent;
				color: var(--rm-text);
				text-align: left;
				cursor: pointer;
			}
			.onhand-replay-toggle:hover .onhand-replay-title {
				color: var(--rm-foam);
			}
			.onhand-replay-caret {
				width: 12px;
				color: var(--rm-pine);
				font: 700 11px/1 var(--rm-font-mono);
			}
			.onhand-replay-title {
				font-size: 13px;
				line-height: 1.3;
				font-weight: 600;
				color: var(--rm-text);
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.onhand-replay-body[hidden] {
				display: none;
			}
			.onhand-replay-body {
				margin-top: 10px;
			}
			.onhand-replay-actions {
				display: flex;
				flex-wrap: wrap;
				justify-content: flex-end;
				gap: 7px;
			}
			.onhand-replay-button {
				border: 1px solid var(--rm-surface-2);
				background: var(--rm-base);
				color: var(--rm-text);
				border-radius: 2px;
				padding: 6px 8px;
				font: 11px/1 var(--rm-font-mono);
				cursor: pointer;
			}
			.onhand-replay-button:hover {
				background: var(--rm-surface-0);
			}
			.onhand-replay-button:disabled {
				opacity: 0.55;
				cursor: not-allowed;
			}
			.onhand-replay-meta {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
				margin-bottom: 12px;
				color: var(--rm-subtext);
				font: 10.5px/1.35 var(--rm-font-mono);
			}
			.onhand-replay-head > .onhand-replay-meta {
				flex: 0 0 auto;
				justify-content: flex-end;
				margin-bottom: 0;
			}
			.onhand-replay-artifacts {
				display: flex;
				gap: 8px;
				overflow-x: auto;
				padding-bottom: 8px;
				margin-bottom: 10px;
			}
			.onhand-replay-artifact {
				flex: 0 0 168px;
				min-height: 58px;
				text-align: left;
				border: 1px solid var(--rm-surface-2);
				background: var(--rm-base);
				color: var(--rm-text);
				border-radius: 3px;
				padding: 8px;
				cursor: pointer;
			}
			.onhand-replay-artifact.active {
				border-color: var(--rm-pine);
				background: color-mix(in srgb, var(--rm-pine) 10%, var(--rm-base));
			}
			.onhand-replay-artifact-title {
				display: block;
				font-size: 12px;
				font-weight: 600;
				line-height: 1.25;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}
			.onhand-replay-artifact-meta {
				display: block;
				margin-top: 4px;
				color: var(--rm-subtext);
				font: 10px/1.35 var(--rm-font-mono);
			}
			.onhand-replay-snapshot {
				border: 1px solid var(--rm-surface-2);
				background: var(--rm-crust);
				border-radius: 3px;
				overflow: hidden;
				margin-bottom: 12px;
			}
			.onhand-replay-snapshot-head {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 8px;
				padding: 8px 10px;
				border-bottom: 1px solid var(--rm-surface-1);
				font: 10.5px/1.35 var(--rm-font-mono);
				color: var(--rm-subtext);
			}
			.onhand-replay-image,
			.onhand-replay-frame {
				display: block;
				width: 100%;
				height: 220px;
				border: 0;
				background: #fff;
			}
			.onhand-replay-image {
				object-fit: contain;
			}
			.onhand-replay-empty,
			.onhand-replay-error {
				padding: 14px 12px;
				color: var(--rm-subtext);
				font-size: 13px;
				line-height: 1.45;
				border: 1px solid var(--rm-surface-1);
				background: var(--rm-crust);
			}
			.onhand-replay-error {
				color: var(--rm-love);
			}
			.onhand-replay-section {
				margin-top: 12px;
			}
			.onhand-replay-annotations {
				display: flex;
				flex-direction: column;
				gap: 7px;
			}
			.onhand-replay-annotation {
				padding: 8px 9px;
				border: 1px solid var(--rm-surface-1);
				background: var(--rm-base);
				border-left: 2px solid var(--rm-gold);
			}
			.onhand-replay-annotation-head {
				display: flex;
				align-items: flex-start;
				justify-content: space-between;
				gap: 8px;
			}
			.onhand-replay-quote {
				display: block;
				font-size: 13px;
				line-height: 1.35;
				color: var(--rm-text);
				font-style: italic;
			}
			.onhand-replay-source {
				flex: 0 0 auto;
				border: 1px solid var(--rm-surface-2);
				background: var(--rm-mantle);
				color: var(--rm-text);
				border-radius: 2px;
				padding: 4px 6px;
				font: 10px/1 var(--rm-font-mono);
				cursor: pointer;
			}
			.onhand-replay-source:hover {
				background: var(--rm-surface-0);
			}
			.onhand-replay-note {
				display: block;
				margin-top: 5px;
				color: var(--rm-pine);
				font-size: 12px;
				line-height: 1.35;
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
			.onhand-index-list {
				display: flex;
				flex-direction: column;
				gap: 2px;
			}
			.onhand-index-row {
				margin: 2px -8px;
				border-left: 2px solid transparent;
				border-radius: 3px;
			}
			.onhand-index-row:hover {
				background: var(--rm-mantle);
				border-left-color: var(--rm-gold);
			}
			.onhand-index-item {
				width: 100%;
				display: flex;
				gap: 10px;
				padding: 6px 8px;
				margin: 0;
				border-radius: 3px;
				cursor: pointer;
				align-items: flex-start;
				border: 0;
				background: transparent;
				text-align: left;
			}
			.onhand-index-item:hover {
				background: color-mix(in srgb, var(--rm-surface-0) 38%, transparent);
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
			.onhand-index-kind {
				font: 700 10px var(--rm-font-mono);
				color: var(--rm-foam);
				padding-top: 3px;
				text-transform: uppercase;
			}
			.onhand-index-note-preview {
				width: 100%;
				display: flex;
				gap: 8px;
				align-items: flex-start;
				margin: -1px 0 1px;
				padding: 2px 8px 7px 36px;
				border: 0;
				border-radius: 3px;
				background: transparent;
				color: var(--rm-pine);
				text-align: left;
				cursor: pointer;
			}
			.onhand-index-note-preview:hover {
				background: color-mix(in srgb, var(--rm-pine) 9%, transparent);
			}
			.onhand-index-note-label {
				flex: 0 0 auto;
				font: 700 10px/1.35 var(--rm-font-mono);
				text-transform: uppercase;
				color: var(--rm-pine);
			}
			.onhand-index-note-text {
				min-width: 0;
				font: 11.5px/1.35 var(--rm-font-mono);
				color: var(--rm-subtext);
				display: -webkit-box;
				-webkit-line-clamp: 2;
				-webkit-box-orient: vertical;
				overflow: hidden;
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
			.onhand-support {
				margin: 0 0 12px;
			}
			.onhand-support > .onhand-progress:first-child,
			.onhand-support > .onhand-actions:first-child {
				margin-top: 0;
			}
			.onhand-response > :first-child {
				margin-top: 0;
			}
			.onhand-response > :last-child {
				margin-bottom: 0;
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
				display: inline-flex;
				align-items: center;
				gap: 2px;
				margin-left: 3px;
				vertical-align: super;
			}
			.onhand-cite {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				min-width: 18px;
				min-height: 18px;
				font-family: var(--rm-font-mono);
				font-size: 0.72em;
				color: var(--rm-pine);
				font-weight: 700;
				line-height: 1;
				padding: 1px 3px;
				text-decoration: none;
				cursor: pointer;
				border: 0;
				background: transparent;
				border-radius: 3px;
				-webkit-user-select: none;
				user-select: none;
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
			.onhand-progress {
				margin: 10px 0 0;
				font: 11px/1 var(--rm-font-mono);
				color: var(--rm-subtext);
			}
			.onhand-progress summary {
				cursor: pointer;
				list-style: none;
				display: inline-flex;
				align-items: center;
				gap: 6px;
				padding: 4px 8px;
				margin-left: -8px;
				border-radius: 2px;
			}
			.onhand-progress summary::-webkit-details-marker {
				display: none;
			}
			.onhand-progress summary::before {
				content: ">";
				color: var(--rm-surface-2);
				transition: transform 120ms;
				display: inline-block;
			}
			.onhand-progress[open] summary::before {
				transform: rotate(90deg);
			}
			.onhand-progress summary:hover {
				background: var(--rm-mantle);
				color: var(--rm-text);
			}
			.onhand-progress-body {
				padding: 8px 0 0 14px;
				color: var(--rm-subtext);
				border-left: 1px solid var(--rm-surface-1);
				margin-left: 2px;
				display: flex;
				flex-direction: column;
				gap: 6px;
			}
			.onhand-progress-line {
				display: grid;
				grid-template-columns: 54px minmax(0, 1fr);
				gap: 8px;
				font: 12px/1.35 var(--rm-font-mono);
			}
			.onhand-progress-status {
				color: var(--rm-foam);
				font-size: 10px;
				text-transform: uppercase;
			}
			.onhand-actions {
				margin-top: 10px;
				display: flex;
				flex-wrap: wrap;
				gap: 10px;
				font: 11px var(--rm-font-mono);
			}
			.onhand-action {
				display: inline-flex;
				align-items: center;
				min-height: 22px;
				color: var(--rm-pine);
				cursor: pointer;
				padding: 2px 4px;
				border: 0;
				border-bottom: 1px solid transparent;
				background: transparent;
				border-radius: 3px;
				-webkit-user-select: none;
				user-select: none;
			}
			.onhand-action:hover {
				background: var(--rm-mantle);
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
				box-sizing: border-box;
				min-width: 0;
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
				width: 100%;
				min-width: 0;
				box-sizing: border-box;
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
				display: grid;
				grid-template-columns: auto auto minmax(0, 1fr) auto auto;
				align-items: center;
				column-gap: 5px;
				row-gap: 6px;
				width: 100%;
				min-width: 0;
				overflow: visible;
				font: 10.5px var(--rm-font-mono);
				color: var(--rm-subtext);
			}
			.onhand-row .ctl {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				gap: 5px;
				cursor: pointer;
				padding: 3px 6px;
				border-radius: 2px;
				border: 0;
				background: transparent;
				color: inherit;
			}
			.onhand-row .ctl svg {
				width: 13px;
				height: 18px;
				flex: 0 0 auto;
				stroke: currentColor;
			}
			.onhand-sr-only {
				position: absolute;
				width: 1px;
				height: 1px;
				padding: 0;
				margin: -1px;
				overflow: hidden;
				clip: rect(0, 0, 0, 0);
				white-space: nowrap;
				border: 0;
			}
			.onhand-row .ctl:hover {
				background: var(--rm-mantle);
				color: var(--rm-text);
			}
			.onhand-voice-control {
				display: inline-flex;
				align-items: center;
				flex: 0 0 auto;
				height: 28px;
				border-radius: 4px;
				overflow: hidden;
			}
			.onhand-row .voice {
				flex: 0 0 auto;
				width: 30px;
				min-width: 30px;
				height: 28px;
				padding: 3px 5px;
				border: 1px solid transparent;
				border-radius: 2px;
				font: 10.5px var(--rm-font-mono);
			}
			.onhand-row .voice svg {
				width: 18px;
				height: 18px;
				fill: none;
				stroke: currentColor;
				stroke-width: 2;
				stroke-linecap: round;
				stroke-linejoin: round;
			}
			.onhand-row .voice.on {
				color: var(--rm-base);
				background: var(--rm-love);
				border-color: var(--rm-love);
			}
			.onhand-row .voice.connecting {
				color: var(--rm-base);
				background: var(--rm-gold);
				border-color: var(--rm-gold);
			}
			.onhand-row .voice.error {
				color: var(--rm-love);
				border-color: color-mix(in srgb, var(--rm-love) 45%, transparent);
			}
			.onhand-row .voice.on.error,
			.onhand-row .voice.connecting.error {
				color: var(--rm-base);
			}
			.onhand-realtime-status {
				flex: 1 1 82px;
				min-width: 0;
				max-width: none;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
				padding: 0;
				border: 0;
				background: transparent;
				color: inherit;
				font: inherit;
				text-align: left;
				cursor: default;
			}
			.onhand-realtime-status.error {
				color: var(--rm-love);
				cursor: pointer;
			}
			.onhand-realtime-status.error:hover,
			.onhand-realtime-status.error:focus-visible {
				text-decoration: underline;
				text-underline-offset: 2px;
			}
			.onhand-realtime-error-bubble {
				position: relative;
				margin-top: -2px;
				padding: 9px 10px;
				border: 1px solid color-mix(in srgb, var(--rm-love) 34%, var(--rm-overlay));
				border-radius: 4px;
				background: color-mix(in srgb, var(--rm-love) 8%, var(--rm-base));
				color: var(--rm-text);
				box-shadow: 0 8px 24px color-mix(in srgb, var(--rm-shadow) 16%, transparent);
				font: 10.5px/1.45 var(--rm-font-mono);
			}
			.onhand-realtime-error-bubble[hidden] {
				display: none;
			}
			.onhand-realtime-error-bubble::before {
				content: "";
				position: absolute;
				top: -6px;
				left: 64px;
				width: 10px;
				height: 10px;
				border-left: 1px solid color-mix(in srgb, var(--rm-love) 34%, var(--rm-overlay));
				border-top: 1px solid color-mix(in srgb, var(--rm-love) 34%, var(--rm-overlay));
				background: inherit;
				transform: rotate(45deg);
			}
			.onhand-realtime-error-text {
				white-space: pre-wrap;
				overflow-wrap: anywhere;
			}
			.onhand-realtime-error-actions {
				display: flex;
				justify-content: flex-end;
				gap: 6px;
				margin-top: 8px;
			}
			.onhand-realtime-error-actions button {
				border: 1px solid var(--rm-overlay);
				border-radius: 2px;
				background: var(--rm-base);
				color: var(--rm-text);
				font: 10.5px var(--rm-font-mono);
				padding: 4px 7px;
				cursor: pointer;
			}
			.onhand-realtime-error-actions button:hover {
				background: var(--rm-mantle);
			}
			.onhand-mic-picker {
				position: relative;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 24px;
				min-width: 24px;
				max-width: 24px;
				height: 28px;
				padding: 0;
				box-sizing: border-box;
				border: 1px solid transparent;
				border-radius: 2px;
				background: transparent;
				color: var(--rm-subtext);
				font: 10.5px var(--rm-font-mono);
				cursor: pointer;
			}
			.onhand-mic-picker[hidden] {
				display: none;
			}
			.onhand-mic-picker:hover {
				background: var(--rm-mantle);
				color: var(--rm-text);
			}
			.onhand-mic-picker.disabled {
				opacity: 0.55;
				cursor: not-allowed;
			}
			.onhand-mic-picker svg {
				width: 14px;
				height: 14px;
				flex: 0 0 auto;
				fill: none;
				stroke: currentColor;
				stroke-width: 2;
				stroke-linecap: round;
				stroke-linejoin: round;
			}
			.onhand-mic-label {
				display: none;
			}
			.onhand-row .mic {
				position: absolute;
				inset: 0;
				width: 100%;
				height: 100%;
				margin: 0;
				padding: 0;
				border: 0;
				opacity: 0;
				cursor: pointer;
				-webkit-appearance: none;
				appearance: none;
			}
			.onhand-row .mic:disabled {
				cursor: not-allowed;
			}
			.onhand-realtime-answer {
				border-bottom: 1px solid var(--rm-surface-1);
				background: color-mix(in srgb, var(--rm-pine) 7%, transparent);
			}
			.onhand-realtime-sources {
				margin-top: 10px;
			}
			.onhand-realtime-sources .onhand-label {
				display: block;
				margin-bottom: 4px;
			}
			.onhand-row .learn {
				display: inline-flex;
				align-items: center;
				gap: 4px;
				cursor: pointer;
				padding: 3px 4px;
				border-radius: 2px;
				flex: 0 0 auto;
				white-space: nowrap;
			}
			.onhand-row .learn .sw {
				width: 22px;
				height: 12px;
				flex: 0 0 22px;
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
			.onhand-row .speed {
				display: inline-flex;
				align-items: center;
				gap: 5px;
				padding: 3px 6px;
				color: var(--rm-subtext);
				font: 10.5px var(--rm-font-mono);
			}
			.onhand-row .speed select {
				max-width: 72px;
				border: 1px solid var(--rm-overlay);
				border-radius: 2px;
				background: var(--rm-mantle);
				color: var(--rm-text);
				font: 10.5px var(--rm-font-mono);
				padding: 2px 4px;
			}
			.onhand-row .speed select:disabled {
				opacity: 0.55;
				cursor: not-allowed;
			}
			.onhand-row .spacer {
				display: none;
			}
			.onhand-send {
				font: 11px var(--rm-font-mono);
				background: var(--rm-pine);
				color: var(--rm-base);
				border: 0;
				border-radius: 2px;
				padding: 6px 10px;
				cursor: pointer;
				display: inline-flex;
				align-items: center;
				gap: 6px;
				justify-self: end;
				margin-left: 0;
				max-width: 100%;
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
			@media (max-width: 420px) {
				.onhand-compose {
					padding: 10px 10px 8px;
					gap: 6px;
				}
				.onhand-row {
					grid-template-columns: auto auto minmax(0, 1fr) auto;
					column-gap: 4px;
				}
				.onhand-row .ctl {
					padding: 3px 5px;
				}
				.onhand-row .voice {
					width: 28px;
					min-width: 28px;
					padding-inline: 4px;
				}
				.onhand-row .learn {
					grid-column: 4;
					grid-row: 2;
					justify-self: end;
					padding: 3px;
				}
				.onhand-realtime-status {
					grid-column: 3;
					min-width: 0;
				}
				.onhand-row .learn > span:last-of-type,
				.onhand-send .kbd {
					display: none;
				}
				.onhand-send {
					grid-column: 4;
					grid-row: 1;
					padding: 5px 8px;
				}
			}
			@media (max-width: 360px) {
				.onhand-row {
					grid-template-columns: auto auto minmax(0, 1fr) auto;
					column-gap: 3px;
				}
				.onhand-send {
					padding-inline: 7px;
				}
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
					<span class="onhand-logo-mark" aria-hidden="true">☞</span>
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
						<label class="onhand-menu-field">
							<span>Theme</span>
							<select id="themeSelect" class="onhand-select">
								<option value="system">System</option>
								<option value="light">Light</option>
								<option value="dark">Dark</option>
							</select>
							</label>
								<div class="onhand-menu-actions">
									<button id="newSessionButton" class="session-button" type="button">New</button>
									<button id="openPdfViewerButton" class="session-button" type="button">Open PDF</button>
									<button id="restoreSessionButton" class="session-button" type="button">Restore pages</button>
									<button id="stopButton" class="session-button stop-button" type="button">Stop</button>
									<button id="closeButton" class="session-button" type="button">Close Onhand</button>
								</div>
							<div id="restoreResult" class="onhand-menu-restore-result" hidden></div>
							<div class="onhand-hotkeys">esc dismiss · cmd+n new entry · enter ask · shift+enter newline</div>
						</div>
					</div>
					</header>
					<div id="scroll" class="onhand-scroll">
					<section id="replayView" class="onhand-replay" hidden></section>
					<section id="authPanel" class="onhand-auth-panel" hidden></section>
					<section id="pageIndex" class="onhand-index" hidden></section>
					<div id="messages" class="message-list"></div>
				<div id="activity" hidden></div>
				<div id="actions" hidden></div>
				<section id="replySection" hidden>
					<div id="reply"></div>
				</section>
			</div>
			<section id="learnerPanel" class="onhand-learner-panel" hidden></section>
			<form id="composer" class="onhand-compose">
				<div id="attachmentList" class="onhand-draft-chips"></div>
				<textarea id="input" class="onhand-input" placeholder="Ask about this page or your selection..."></textarea>
				<div class="onhand-row">
					<button id="attachButton" class="ctl" type="button" aria-label="Attach files" title="Attach files">
						<svg class="onhand-attach-icon" viewBox="0 0 13 18" fill="none" aria-hidden="true" focusable="false">
							<path d="M4.6 5.2v7.3a1.9 1.9 0 1 0 3.8 0V4.6a2.9 2.9 0 0 0-5.8 0v8a4.2 4.2 0 1 0 8.4 0V5.7" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</button>
					<input id="fileInput" type="file" multiple hidden />
					<div id="realtimeVoiceControl" class="onhand-voice-control">
						<button id="realtimeVoiceButton" class="ctl voice" type="button" aria-label="Start realtime voice tutor" title="Start realtime voice tutor"><svg class="onhand-voice-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M5 10v2a7 7 0 0 0 14 0v-2" /><path d="M12 19v3" /><path d="M8 22h8" /></svg><span class="onhand-sr-only">Voice</span></button>
						<label id="realtimeMicPicker" class="onhand-mic-picker" title="Realtime microphone input" hidden>
							<span id="realtimeMicLabel" class="onhand-mic-label">Mic</span>
							<select id="realtimeMicSelect" class="mic" aria-label="Realtime microphone input" title="Realtime microphone input" hidden></select>
							<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4" /></svg>
						</label>
					</div>
					<button id="realtimeStatus" class="onhand-realtime-status" type="button" aria-expanded="false">Voice idle</button>
					<label id="learningModeLabel" class="learn" title="Learning asks Onhand to tutor from the page: anchor prompts, scaffold concepts, and check understanding.">
						<span class="sw"></span>
						<input id="learningModeToggle" type="checkbox" hidden />
						<span>Learning</span>
					</label>
					<span class="spacer"></span>
					<button id="sendButton" class="onhand-send" type="submit">Ask <span class="kbd">&#8617;</span></button>
				</div>
				<div id="realtimeErrorBubble" class="onhand-realtime-error-bubble" role="dialog" aria-label="Voice error details" hidden>
					<div id="realtimeErrorText" class="onhand-realtime-error-text"></div>
					<div class="onhand-realtime-error-actions">
						<button id="realtimeErrorOptionsButton" type="button" hidden>Open options</button>
						<button id="realtimeErrorDismissButton" type="button">Dismiss</button>
					</div>
				</div>
				<div id="helper" class="onhand-hint">enter ask · shift+enter newline · cmd+n new entry</div>
			</form>
		</div>
	`;

	(document.body || document.documentElement).appendChild(host);

	const sidebarRoot = shadow.querySelector("[data-onhand-sidebar]");
	if (sidebarRoot instanceof HTMLElement) {
		sidebarThemeTargets.push(sidebarRoot);
		applySidebarTheme(sidebarTheme);
	}

	const closeButton = shadow.getElementById("closeButton");
	const meta = shadow.getElementById("meta");
	const body = shadow.getElementById("scroll");
	const menuButton = shadow.getElementById("menuButton");
	const menuPanel = shadow.getElementById("menuPanel");
	const sessionTitleInput = shadow.getElementById("sessionTitleInput");
	const restoreResultEl = shadow.getElementById("restoreResult");
	const pageIndexEl = shadow.getElementById("pageIndex");
	const replayViewEl = shadow.getElementById("replayView");
	const authPanelEl = shadow.getElementById("authPanel");
	const sessionSelect = shadow.getElementById("sessionSelect");
	const themeSelect = shadow.getElementById("themeSelect");
	const learningModeLabel = shadow.getElementById("learningModeLabel");
	const learningModeToggle = shadow.getElementById("learningModeToggle");
	const newSessionButton = shadow.getElementById("newSessionButton");
	const openPdfViewerButton = shadow.getElementById("openPdfViewerButton");
	const restoreSessionButton = shadow.getElementById("restoreSessionButton");
	const stopButton = shadow.getElementById("stopButton");
	const messagesEl = shadow.getElementById("messages");
	const activityEl = shadow.getElementById("activity");
	const replySectionEl = shadow.getElementById("replySection");
	const replyEl = shadow.getElementById("reply");
	const actionsEl = shadow.getElementById("actions");
	const learnerPanelEl = shadow.getElementById("learnerPanel");
	const composer = shadow.getElementById("composer");
	const attachButton = shadow.getElementById("attachButton");
	const fileInput = shadow.getElementById("fileInput");
	const realtimeVoiceButton = shadow.getElementById("realtimeVoiceButton");
	const realtimeStatusEl = shadow.getElementById("realtimeStatus");
	const realtimeErrorBubble = shadow.getElementById("realtimeErrorBubble");
	const realtimeErrorText = shadow.getElementById("realtimeErrorText");
	const realtimeErrorOptionsButton = shadow.getElementById("realtimeErrorOptionsButton");
	const realtimeErrorDismissButton = shadow.getElementById("realtimeErrorDismissButton");
	const realtimeMicPicker = shadow.getElementById("realtimeMicPicker");
	const realtimeMicLabel = shadow.getElementById("realtimeMicLabel");
	const realtimeMicSelect = shadow.getElementById("realtimeMicSelect");
	const attachmentList = shadow.getElementById("attachmentList");
	const input = shadow.getElementById("input");
	const helper = shadow.getElementById("helper");
	const sendButton = shadow.getElementById("sendButton");
	themeSelect.value = sidebarTheme;

	function setOpen(nextOpen) {
		const wasOpen = open;
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
			if (!wasOpen) schedulePanelComposerFocus();
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

	function getStateSessionPath(state) {
		return state?.currentSession?.sessionFile || state?.currentSession?.sessionId || "";
	}

	function renderMeta(state) {
		const sessionKey = getSessionDraftKey(state);
		const sessionName = sessionTitleDrafts.get(sessionKey) || state?.currentSession?.sessionName || "Current session";
		const status = state?.status || "Ready";
		const statusKind = /failed|error|not implemented/i.test(status) ? "error" : /ready|complete/i.test(status) ? "ok" : "";
		const revision = state?.preferences?.runtimeRevision || "";
		const extensionVersion = state?.preferences?.extensionVersion || "";
		if (sessionTitleInput instanceof HTMLInputElement && shadow.activeElement !== sessionTitleInput) {
			sessionTitleInput.value = sessionName;
			sessionTitleInput.title = sessionName;
		}
		meta.className = `onhand-status ${statusKind}`;
		meta.title = [extensionVersion ? `Onhand ${extensionVersion}` : "", revision ? `runtime ${revision}` : ""].filter(Boolean).join(" / ");
		meta.innerHTML = `
			<div>Runtime</div>
			<div class="onhand-status-pill">
				<span class="onhand-status-dot"></span>
				<span>${escapeHtml(status)}</span>
			</div>
		`;
	}

	function getCurrentSessionPath(state) {
		return (
			getStateSessionPath(state) ||
			sessionOverview?.currentSession?.sessionFile ||
			sessionOverview?.currentSession?.sessionId ||
			""
		);
	}

	function renderSessionControls(state) {
		const currentPath = getCurrentSessionPath(state);
		if (pendingSessionPath && pendingSessionPath === currentPath) {
			pendingSessionPath = "";
		}
		const selectedPath = pendingSessionPath || currentPath;
		const sessions = Array.isArray(sessionOverview?.sessions) ? sessionOverview.sessions : [];
		const learningMode = Boolean(state?.preferences?.learningMode);
		let sessionOptionsHtml = "";
		if (!sessions.length) {
			sessionOptionsHtml = `<option value="">${sessionLoading ? "Loading sessions…" : "Current session"}</option>`;
		} else {
			sessionOptionsHtml = sessions
				.map((session) => {
					const title = session?.title || session?.name || "Session";
					const path = session.path || session.id || session.sessionId || "";
					return `<option value="${escapeAttribute(path)}" ${path === selectedPath ? "selected" : ""}>${escapeHtml(title)}</option>`;
				})
				.join("");
		}
		const sessionSelectFocused = shadow.activeElement === sessionSelect;
		const optionsSignature = `${selectedPath}\n${sessionOptionsHtml}`;
		if (!sessionSelectFocused && sessionSelect.dataset.optionsSignature !== optionsSignature) {
			sessionSelect.innerHTML = sessionOptionsHtml;
			sessionSelect.dataset.optionsSignature = optionsSignature;
		}
		if (!sessionSelectFocused && sessionSelect.value !== selectedPath) {
			sessionSelect.value = selectedPath;
		}

		const activeRequest = Boolean(state?.activeRequestId);
		sessionSelect.disabled = sessionLoading || sessionSwitching || creatingSession || restoringSession || activeRequest;
		sessionSelect.title = sessionSwitching ? "Switching session..." : "";
		themeSelect.value = sidebarTheme;
		learningModeToggle.checked = learningMode;
		learningModeToggle.disabled = activeRequest || sessionLoading || sessionSwitching || creatingSession || restoringSession || stoppingRequest;
		learningModeLabel.classList.toggle("on", learningMode);
		composer.classList.toggle("learning", learningMode);
		newSessionButton.disabled = creatingSession || sessionSwitching || activeRequest;
		openPdfViewerButton.disabled =
			openingPdfViewer || creatingSession || sessionSwitching || activeRequest || !canOpenCurrentPdfInViewer(state);
		openPdfViewerButton.textContent = openingPdfViewer ? "Opening PDF..." : "Open PDF";
		openPdfViewerButton.title = canOpenCurrentPdfInViewer(state)
			? "Open this PDF in Onhand's viewer"
			: "Open a PDF tab to use Onhand's PDF viewer";
		restoreSessionButton.disabled = restoringSession || creatingSession || sessionSwitching || activeRequest || !currentPath;
		stopButton.disabled = !activeRequest || stoppingRequest;
		stopButton.textContent = stoppingRequest ? "Stopping..." : "Stop";
		newSessionButton.textContent = creatingSession ? "Creating..." : "New";
		restoreSessionButton.textContent = restoringSession ? "Restoring..." : "Restore pages";
	}

	function hasUsableOnhandAuth(state) {
		const preferences = state?.preferences || {};
		return Boolean(preferences.hasAiApiKey || preferences.hasOAuthCredentials);
	}

	function renderAuthPanel(state) {
		if (!(authPanelEl instanceof HTMLElement)) return;
		const hiddenByView = replayState.open || pageIndexEl.hidden === false;
		const needsAuth = !hasUsableOnhandAuth(state);
		authPanelEl.hidden = hiddenByView || !needsAuth;
		if (authPanelEl.hidden) {
			authPanelEl.innerHTML = "";
			return;
		}
		const statusClass = authStatusKind ? ` ${escapeAttribute(authStatusKind)}` : "";
		authPanelEl.innerHTML = `
			<div class="onhand-auth-title">Sign in to Onhand</div>
			<p class="onhand-auth-copy">Use OpenAI Codex sign-in from here instead of opening options.</p>
			<div class="onhand-auth-actions">
				<button id="authSignInButton" class="onhand-auth-button" type="button" ${authSigningIn ? "disabled" : ""}>${authSigningIn ? "Signing in..." : "Sign in with OpenAI"}</button>
				${authStatusText ? `<span class="onhand-auth-status${statusClass}">${escapeHtml(authStatusText)}</span>` : ""}
			</div>
		`;
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
		renderState(currentState || {});
		try {
			const response = await chrome.runtime.sendMessage({ type: "sidebar:list-sessions", limit });
			if (!response?.ok) {
				throw new Error(response?.error || "Could not load sessions.");
			}
			sessionOverview = {
				currentSession: response.currentSession || null,
				sessions: Array.isArray(response.sessions) ? response.sessions : [],
			};
			renderState(currentState || {});
		} finally {
			sessionLoading = false;
			renderState(currentState || {});
		}
	}

	async function createNewSession() {
		creatingSession = true;
		lastRestoreResult = null;
		resetReplayState();
		renderState(currentState || {});
		try {
			const response = await chrome.runtime.sendMessage({
				type: "sidebar:new-session",
				windowId: await ensureCurrentWindowId(),
			});
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
		sessionPath = String(sessionPath || "").trim();
		if (!sessionPath) return;
		const currentPath = getCurrentSessionPath(currentState);
		if (sessionPath === currentPath && !pendingSessionPath) return;
		pendingSessionPath = sessionPath;
		sessionSwitching = true;
		lastRestoreResult = null;
		resetReplayState();
		renderState(currentState || {});
		try {
			const response = await chrome.runtime.sendMessage({
				type: "sidebar:switch-session",
				sessionPath,
				windowId: await ensureCurrentWindowId(),
			});
			if (!response?.ok) {
				throw new Error(response?.error || "Could not switch sessions.");
			}
			await Promise.all([requestState(), requestSessions()]);
		} finally {
			sessionSwitching = false;
			if (pendingSessionPath === sessionPath) {
				pendingSessionPath = "";
			}
			renderState(currentState || {});
		}
	}

	async function restoreSessionPages(targetSessionPath = "") {
		const sessionPath = getSelectedSessionPath(targetSessionPath);
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
			lastRestoreResult = {
				sessionPath,
				restoredPages: Array.isArray(response.restoredPages) ? response.restoredPages : [],
				restoredCount: Number(response.restoredCount || 0),
			};
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

	async function openCurrentPdfInViewer() {
		openingPdfViewer = true;
		lastRestoreResult = null;
		renderState(currentState || {});
		try {
			const tabId = Number(currentState?.tab?.id);
			const response = await chrome.runtime.sendMessage({
				type: "sidebar:open-pdf-viewer",
				tabId: Number.isFinite(tabId) ? tabId : undefined,
				windowId: await ensureCurrentWindowId(),
			});
			if (!response?.ok) {
				throw new Error(response?.error || "Could not open this PDF in Onhand's viewer.");
			}
			setMenuOpen(false);
			await requestState();
			const initialPageNumber = Number(response.result?.initialPageNumber);
			const pageSuffix = Number.isFinite(initialPageNumber) && initialPageNumber > 0 ? ` at page ${initialPageNumber}` : "";
			const sourceSuffix = response.result?.initialPageSource ? ` (${response.result.initialPageSource})` : "";
			renderState({
				...(currentState || {}),
				status: response.result?.alreadyOpen ? "This PDF is already open in Onhand's viewer." : `Opened PDF in Onhand viewer${pageSuffix}${sourceSuffix}.`,
			});
			return response.result;
		} finally {
			openingPdfViewer = false;
			renderState(currentState || {});
		}
	}

	async function loadReplayArtifact(artifactId) {
		const id = String(artifactId || "").trim();
		if (!id) return;
		replayState = {
			...replayState,
			open: true,
			loadingArtifact: true,
			error: "",
			selectedArtifactId: id,
		};
		renderState(currentState || {});
		try {
			const response = await chrome.runtime.sendMessage({
				type: "sidebar:get-replay-artifact",
				artifactId: id,
			});
			if (!response?.ok) {
				throw new Error(response?.error || "Could not load that saved artifact.");
			}
			if (replayState.selectedArtifactId !== id) return;
			replayState = {
				...replayState,
				loadingArtifact: false,
				artifact: response.artifact || null,
				error: "",
			};
			renderState(currentState || {});
		} catch (error) {
			replayState = {
				...replayState,
				loadingArtifact: false,
				error: error?.message || String(error),
			};
			renderState(currentState || {});
		}
	}

	async function openReplaySession(targetSessionPath = "") {
		const sessionPath = getSelectedSessionPath(targetSessionPath);
		if (!sessionPath) {
			throw new Error("Choose a session to review first.");
		}
		setMenuOpen(false);
		resetReplayState({ open: true, loading: true });
		renderState(currentState || {});
		try {
			const response = await chrome.runtime.sendMessage({
				type: "sidebar:get-session-replay",
				sessionPath,
			});
			if (!response?.ok) {
				throw new Error(response?.error || "Could not open the review view.");
			}
			const artifacts = Array.isArray(response.artifacts) ? response.artifacts : [];
			const selectedArtifactId = response.selectedArtifactId || artifacts.at(-1)?.artifactId || artifacts[0]?.artifactId || "";
			replayState = {
				open: true,
				loading: false,
				loadingArtifact: false,
				error: "",
				session: response.session || response.currentSession || null,
				turns: Array.isArray(response.turns) ? response.turns : [],
				pageActions: Array.isArray(response.pageActions) ? response.pageActions : [],
				artifacts,
				replayableAnnotations: Array.isArray(response.replayableAnnotations) ? response.replayableAnnotations : [],
				selectedArtifactId,
				sessionPath,
				artifact: null,
			};
			renderState(currentState || {});
			if (selectedArtifactId) {
				await loadReplayArtifact(selectedArtifactId);
			}
		} catch (error) {
			replayState = {
				...replayState,
				open: true,
				loading: false,
				loadingArtifact: false,
				error: error?.message || String(error),
			};
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

	function compactLearnerPanelText(value, maxChars = 120) {
		const text = String(value || "")
			.replace(/\s+/g, " ")
			.trim();
		if (text.length <= maxChars) return text;
		return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
	}

	function normalizeLearnerStateForPanel(state) {
		const learnerState = state?.learnerState && typeof state.learnerState === "object" ? state.learnerState : {};
		return {
			concepts: Array.isArray(learnerState.conceptsIntroduced) ? learnerState.conceptsIntroduced.filter(Boolean) : [],
			openChecks: Array.isArray(learnerState.openChecks) ? learnerState.openChecks.filter(Boolean) : [],
		};
	}

	function getLearnerConceptLabel(concepts, conceptId) {
		const id = String(conceptId || "").trim();
		if (!id) return "Concept";
		const concept = concepts.find((item) => String(item?.conceptId || "") === id);
		return compactLearnerPanelText(concept?.label || id.replace(/^concept[_:-]?/, "").replace(/[_-]+/g, " "), 64) || "Concept";
	}

	function getLatestLearnerSource(concept) {
		const sources = Array.isArray(concept?.sources) ? concept.sources.filter(Boolean) : [];
		return sources.length ? sources[sources.length - 1] : null;
	}

	function getLearnerSourceLabel(source) {
		const title = compactLearnerPanelText(source?.tabTitle || source?.title, 54);
		if (title) return title;
		const hostname = safeHostname(source?.url);
		return hostname || "";
	}

	function isLearnerHighlightAction(action) {
		return action?.type === "annotation" && (String(action.key || "").startsWith("highlight:") || action.label === "Highlighted text");
	}

	function learnerSourceUrl(source) {
		return String(source?.url || "").trim().split("#")[0];
	}

	function learnerSourceTitle(source) {
		return String(source?.tabTitle || source?.title || "").trim().toLowerCase();
	}

	function actionMatchesLearnerSource(action, source) {
		const sourceUrl = learnerSourceUrl(source);
		const sourceTitle = learnerSourceTitle(source);
		const actionUrl = String(action?.url || "").trim().split("#")[0];
		const actionTitle = String(action?.title || "").trim().toLowerCase();
		return Boolean((sourceUrl && actionUrl === sourceUrl) || (sourceTitle && actionTitle === sourceTitle));
	}

	const LEARNER_SOURCE_STOPWORDS = new Set([
		"a",
		"an",
		"and",
		"are",
		"as",
		"at",
		"be",
		"by",
		"for",
		"from",
		"how",
		"in",
		"into",
		"is",
		"it",
		"of",
		"on",
		"or",
		"page",
		"that",
		"the",
		"this",
		"to",
		"what",
		"when",
		"where",
		"why",
		"with",
	]);

	function normalizeLearnerSourceText(value) {
		return String(value || "")
			.toLowerCase()
			.replace(/^concept[_-]+/, "")
			.replace(/[_-]+/g, " ")
			.replace(/[^a-z0-9]+/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	function normalizeLearnerSourceToken(token) {
		if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
		return token;
	}

	function tokenizeLearnerSourceText(value) {
		return normalizeLearnerSourceText(value)
			.split(" ")
			.map(normalizeLearnerSourceToken)
			.filter((token) => token.length >= 3 && !LEARNER_SOURCE_STOPWORDS.has(token));
	}

	function learnerActionKeySuffix(action, prefix) {
		const key = String(action?.key || "");
		return key.startsWith(prefix) ? key.slice(prefix.length) : "";
	}

	function actionSameLearnerPage(left, right) {
		const leftUrl = String(left?.url || "").trim().split("#")[0];
		const rightUrl = String(right?.url || "").trim().split("#")[0];
		if (leftUrl && rightUrl) return leftUrl === rightUrl;
		const leftTitle = String(left?.title || "").trim().toLowerCase();
		const rightTitle = String(right?.title || "").trim().toLowerCase();
		return Boolean(leftTitle && rightTitle && leftTitle === rightTitle);
	}

	function relatedLearnerActions(action, actions) {
		const annotationId = String(action?.annotationId || "").trim();
		const highlightSuffix = learnerActionKeySuffix(action, "highlight:");
		const noteSuffix = learnerActionKeySuffix(action, "note:");
		const suffix = highlightSuffix || noteSuffix;
		return actions.filter((candidate) => {
			if (!candidate || candidate === action || !actionSameLearnerPage(candidate, action)) return false;
			if (annotationId && String(candidate.annotationId || "").trim() === annotationId) return true;
			if (!suffix) return false;
			return learnerActionKeySuffix(candidate, "highlight:") === suffix || learnerActionKeySuffix(candidate, "note:") === suffix;
		});
	}

	function findRelatedHighlightAction(action, actions) {
		if (isLearnerHighlightAction(action)) return action;
		const related = relatedLearnerActions(action, actions);
		return related.find(isLearnerHighlightAction) || null;
	}

	function turnTextForLearnerAction(action) {
		const key = String(action?.key || "").trim();
		return (Array.isArray(currentState?.turns) ? currentState.turns : [])
			.filter((turn) => Array.isArray(turn?.pageActions) && turn.pageActions.some((candidate) => learnerTurnActionMatches(candidate, action, key)))
			.map((turn) => [turn?.userPrompt, turn?.reply].filter(Boolean).join(" "))
			.join(" ");
	}

	function learnerActionTextKey(action) {
		return normalizeLearnerSourceText(action?.citationText || action?.detail || "");
	}

	function learnerTurnActionMatches(candidate, action, actionKey = "") {
		if (!candidate || !action) return false;
		if (actionKey && String(candidate?.key || "").trim() === actionKey) return true;
		if (!actionSameLearnerPage(candidate, action)) return false;
		const candidateText = learnerActionTextKey(candidate);
		const actionText = learnerActionTextKey(action);
		return Boolean(candidateText && actionText && candidateText === actionText);
	}

	function actionLearnerSearchText(action, actions, options = {}) {
		const relatedText = relatedLearnerActions(action, actions)
			.map((candidate) => [candidate?.label, candidate?.detail, candidate?.citationText].filter(Boolean).join(" "))
			.join(" ");
		return [action?.label, action?.detail, action?.citationText, relatedText, options.includeTurnText === false ? "" : turnTextForLearnerAction(action)]
			.filter(Boolean)
			.join(" ");
	}

	function scoreLearnerActionMatch(action, actions, source, context = {}, options = {}) {
		const learnerText = [
			context?.label,
			context?.conceptLabel,
			context?.conceptId,
			context?.promptText,
			source?.label,
			source?.conceptLabel,
		]
			.filter(Boolean)
			.join(" ");
		const learnerTokens = [...new Set(tokenizeLearnerSourceText(learnerText))];
		if (!learnerTokens.length) return 0;
		const actionText = normalizeLearnerSourceText(actionLearnerSearchText(action, actions, { includeTurnText: options.includeTurnText }));
		if (!actionText) return 0;
		const actionTokens = new Set(tokenizeLearnerSourceText(actionText));
		let score = 0;
		for (const token of learnerTokens) {
			if (actionTokens.has(token)) score += 4;
		}
		const learnerPhrase = normalizeLearnerSourceText(context?.label || context?.conceptLabel || "");
		if (learnerPhrase && learnerPhrase.length >= 5 && ` ${actionText} `.includes(` ${learnerPhrase} `)) score += 12;
		const relatedActions = relatedLearnerActions(action, actions);
		if (isLearnerHighlightAction(action) && relatedActions.some((candidate) => candidate?.type === "note")) score += 16;
		if (action?.type === "note" && relatedActions.some(isLearnerHighlightAction)) score += 8;
		if (options.includeAnnotationIdBonus !== false && String(source?.annotationId || "").trim() && String(action?.annotationId || "").trim() === String(source.annotationId).trim()) score += 100;
		return score;
	}

	function learnerSourceContextHasText(source, context = {}) {
		return tokenizeLearnerSourceText([
			context?.label,
			context?.conceptLabel,
			context?.conceptId,
			context?.promptText,
			source?.label,
			source?.conceptLabel,
		].filter(Boolean).join(" ")).length > 0;
	}

	function findActionForLearnerSource(source, target = "annotation", context = {}) {
		const currentPageActions = dedupePageActions(Array.isArray(currentState?.pageActions) ? currentState.pageActions : []);
		const exactCurrentPage = findActionForAnnotation(source?.annotationId, target, currentPageActions);
		const actions = collectCurrentPageActions();
		const candidates = actions.filter((action) => action?.key && actionMatchesLearnerSource(action, source));
		const currentPageCandidates = currentPageActions.filter((action) => action?.key && actionMatchesLearnerSource(action, source));
		const preferredCandidates = currentPageCandidates.length ? currentPageCandidates : candidates;
		const hasContextText = learnerSourceContextHasText(source, context);
		const semanticRanked = preferredCandidates
			.map((action) => ({
				action,
				score: scoreLearnerActionMatch(action, actions, source, context, { includeAnnotationIdBonus: false, includeTurnText: false }),
			}))
			.filter((entry) => entry.score > 0)
			.sort((left, right) => right.score - left.score);
		if (exactCurrentPage) {
			const exactSemanticScore = scoreLearnerActionMatch(exactCurrentPage, actions, source, context, { includeAnnotationIdBonus: false, includeTurnText: false });
			const topSemanticScore = semanticRanked[0]?.score || 0;
			if (!hasContextText || (exactSemanticScore > 0 && exactSemanticScore >= topSemanticScore) || topSemanticScore < 4) return exactCurrentPage;
		}
		if (target === "note") {
			const noteCandidates = preferredCandidates.filter((action) => action?.type === "note");
			if (noteCandidates.length === 1) return noteCandidates[0];
		}
		const highlightCandidates = preferredCandidates.filter(isLearnerHighlightAction);
		if (highlightCandidates.length === 1) return highlightCandidates[0];
		const ranked = semanticRanked.length
			? semanticRanked
			: preferredCandidates
				.map((action) => ({ action, score: scoreLearnerActionMatch(action, actions, source, context) }))
				.filter((entry) => entry.score > 0)
				.sort((left, right) => right.score - left.score);
		if (!ranked.length || ranked[0].score < 4) return findActionForAnnotation(source?.annotationId, target);
		if (target === "annotation") {
			const topScore = ranked[0].score;
			const topActions = ranked
				.filter((entry) => entry.score === topScore)
				.map((entry) => findRelatedHighlightAction(entry.action, actions) || entry.action);
			const topKeys = new Set(topActions.map((action) => String(action?.key || "")).filter(Boolean));
			if (topKeys.size > 1) return null;
			return topActions[0] || null;
		}
		if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null;
		return ranked[0].action;
	}

	function renderLearnerSourceButton(annotationId, target = "annotation", actionKey = "") {
		const id = String(annotationId || "").trim();
		const key = String(actionKey || "").trim();
		if (!id && !key) return "";
		return `
			<button
				class="onhand-learner-source"
				data-learner-annotation-id="${escapeAttribute(id)}"
				${key ? `data-action-key="${escapeAttribute(key)}"` : ""}
				data-target="${escapeAttribute(target)}"
				type="button"
				title="Jump to source"
			>source</button>
		`;
	}

	function renderLearnerSourceFeedback() {
		if (!learnerSourceFeedback?.message) return "";
		const kind = ["pending", "ok", "error"].includes(learnerSourceFeedback.kind) ? learnerSourceFeedback.kind : "pending";
		return `<div class="onhand-learner-feedback ${escapeAttribute(kind)}" role="status">${escapeHtml(learnerSourceFeedback.message)}</div>`;
	}

	function renderLearnerConceptItem(concept) {
		const source = getLatestLearnerSource(concept);
		const sourceLabel = getLearnerSourceLabel(source);
		const label = compactLearnerPanelText(concept?.label || concept?.conceptId || "Concept", 64);
		const action = findActionForLearnerSource(source, "annotation", concept);
		return `
			<div class="onhand-learner-item">
				<span class="onhand-learner-main">
					<span class="onhand-learner-title">${escapeHtml(label)}</span>
					${sourceLabel ? `<span class="onhand-learner-detail">${escapeHtml(sourceLabel)}</span>` : ""}
				</span>
				${renderLearnerSourceButton(source?.annotationId, "annotation", action?.key)}
			</div>
		`;
	}

	function renderLearnerCheckItem(check, concepts) {
		const promptText = compactLearnerPanelText(check?.promptText || "Open learning check", 88);
		const kind = String(check?.kind || "check").replace(/[_-]+/g, " ");
		const conceptLabel = getLearnerConceptLabel(concepts, check?.conceptId);
		const concept = concepts.find((item) => String(item?.conceptId || "") === String(check?.conceptId || ""));
		const source = { ...(getLatestLearnerSource(concept) || {}), annotationId: check?.annotationId || getLatestLearnerSource(concept)?.annotationId || "" };
		const action = findActionForLearnerSource(source, "note", { ...concept, label: conceptLabel, promptText });
		return `
			<div class="onhand-learner-item">
				<span class="onhand-learner-main">
					<span class="onhand-learner-title">${escapeHtml(promptText)}</span>
					<span class="onhand-learner-detail">${escapeHtml(kind)} · ${escapeHtml(conceptLabel)}</span>
				</span>
				${renderLearnerSourceButton(check?.annotationId, "note", action?.key)}
			</div>
		`;
	}

	function renderLearnerPanel(state, hiddenByView = false) {
		const learningMode = Boolean(state?.preferences?.learningMode);
		const { concepts, openChecks } = normalizeLearnerStateForPanel(state);
		const hasState = concepts.length > 0 || openChecks.length > 0;
		learnerPanelEl.hidden = hiddenByView || !learningMode || !hasState;
		if (learnerPanelEl.hidden) {
			learnerPanelEl.innerHTML = "";
			learnerSourceFeedback = null;
			learnerGridScrollTop = 0;
			return;
		}
		const previousLearnerGrid = learnerPanelEl.querySelector(".onhand-learner-grid");
		if (previousLearnerGrid instanceof HTMLElement) {
			learnerGridScrollTop = previousLearnerGrid.scrollTop;
		}

		const visibleConcepts = concepts;
		const visibleChecks = openChecks;
		const summary = [concepts.length ? pluralize(concepts.length, "concept") : "", openChecks.length ? pluralize(openChecks.length, "open check") : ""]
			.filter(Boolean)
			.join(" · ");
		learnerPanelEl.innerHTML = `
			<div class="onhand-learner-head">
				<span class="onhand-learner-head-main">
					<span class="onhand-label">This session</span>
					<span class="onhand-count">${escapeHtml(summary)}</span>
				</span>
				<button class="onhand-learner-toggle" data-learner-toggle type="button" aria-expanded="${learnerPanelCollapsed ? "false" : "true"}">${learnerPanelCollapsed ? "Show" : "Hide"}</button>
			</div>
			${renderLearnerSourceFeedback()}
			<div class="onhand-learner-body" ${learnerPanelCollapsed ? "hidden" : ""}>
			<div class="onhand-learner-grid">
				${
					visibleConcepts.length
						? `
							<div class="onhand-learner-group">
								<span class="onhand-learner-group-title">Covered</span>
								<div class="onhand-learner-items">
									${visibleConcepts.map(renderLearnerConceptItem).join("")}
								</div>
							</div>
						`
						: ""
				}
				${
					visibleChecks.length
						? `
							<div class="onhand-learner-group">
								<span class="onhand-learner-group-title">To answer</span>
								<div class="onhand-learner-items">
									${visibleChecks.map((check) => renderLearnerCheckItem(check, concepts)).join("")}
								</div>
							</div>
						`
						: ""
				}
			</div>
			</div>
		`;
		const learnerGrid = learnerPanelEl.querySelector(".onhand-learner-grid");
		if (learnerGrid instanceof HTMLElement) {
			learnerGrid.scrollTop = learnerGridScrollTop;
			learnerGrid.addEventListener(
				"scroll",
				() => {
					learnerGridScrollTop = learnerGrid.scrollTop;
				},
				{ passive: true },
			);
		}
	}

	function getSelectedSessionPath(targetSessionPath = "") {
		return (
			String(targetSessionPath || "").trim() ||
			pendingSessionPath ||
			sessionSelect.value ||
			currentState?.currentSession?.sessionFile ||
			currentState?.currentSession?.sessionId ||
			sessionOverview?.currentSession?.sessionFile ||
			sessionOverview?.currentSession?.sessionId ||
			""
		);
	}

	function isLikelyPdfUrl(value) {
		try {
			const url = new URL(String(value || ""));
			const path = decodeURIComponent(url.pathname || "").toLowerCase();
			const search = decodeURIComponent(url.search || "").toLowerCase();
			return (
				path.endsWith(".pdf") ||
				path.includes(".pdf/") ||
				path.includes("/pdf/") ||
				path.endsWith("/pdf") ||
				path.endsWith("pdf-viewer.html") ||
				search.includes(".pdf") ||
				search.includes("format=pdf") ||
				search.includes("contenttype=pdf") ||
				search.includes("content-type=application/pdf")
			);
		} catch {
			return false;
		}
	}

	function canOpenCurrentPdfInViewer(state = currentState) {
		if (!state || typeof state !== "object") return false;
		const page = state.page && typeof state.page === "object" ? state.page : null;
		const tab = state.tab && typeof state.tab === "object" ? state.tab : null;
		if (page?.surface === "pdf" || page?.pdfUrl || page?.viewerUrl) return true;
		return isLikelyPdfUrl(tab?.url || page?.url || "");
	}

	function hasUsablePdfVoiceSurface(state = currentState) {
		if (!state || typeof state !== "object") return false;
		const page = state.page && typeof state.page === "object" ? state.page : null;
		const tab = state.tab && typeof state.tab === "object" ? state.tab : null;
		const pageText = String(page?.text || "").trim();
		const viewer = String(page?.viewer || "").trim();
		if (page?.surface === "pdf" && page?.unsupported !== true && (pageText || viewer === "onhand-pdf-viewer" || viewer === "google-scholar")) {
			return true;
		}
		const tabUrl = String(tab?.url || page?.url || "");
		return /\/pdf-viewer\.html(?:[?#]|$)|\/onhand-pdf-viewer\.html(?:[?#]|$)/i.test(tabUrl);
	}

	function shouldOpenPdfViewerForRealtime(state = currentState) {
		if (!canOpenCurrentPdfInViewer(state)) return false;
		if (hasUsablePdfVoiceSurface(state)) return false;
		const page = state?.page && typeof state.page === "object" ? state.page : null;
		const tab = state?.tab && typeof state.tab === "object" ? state.tab : null;
		return Boolean(page?.unsupported === true || state?.pageCaptureError || isLikelyPdfUrl(tab?.url || page?.url || ""));
	}

	async function ensureRealtimePdfSurfaceForVoice() {
		if (!shouldOpenPdfViewerForRealtime(currentState)) return { opened: false };
		setRealtimeStatus("Opening PDF in Onhand viewer...");
		const result = await openCurrentPdfInViewer();
		await requestState();
		return { opened: true, result };
	}

	function resetReplayState(partial = {}) {
		replayArtifactsScrollLeft = 0;
		replayState = {
			open: false,
			loading: false,
			loadingArtifact: false,
			error: "",
			session: null,
			turns: [],
			pageActions: [],
			artifacts: [],
			replayableAnnotations: [],
			selectedArtifactId: "",
			sessionPath: "",
			artifact: null,
			...partial,
		};
	}

	function replayAnnotationText(annotation) {
		return String(annotation?.matchedText || annotation?.text || annotation?.detail || "Saved highlight").trim();
	}

	function replayAnnotationNote(annotation) {
		return String(annotation?.noteText || annotation?.note?.text || "").trim();
	}

	function normalizeReplayLookupText(value) {
		return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
	}

	function replayCandidateActionKey(candidate) {
		if (!candidate || typeof candidate !== "object") return "";
		return String(candidate.actionKey || candidate.highlightKey || candidate.actionKeys?.[0] || candidate.key || "").trim();
	}

	function resolveReplayAnnotationActionKey(annotation) {
		const annotationId = String(annotation?.annotationId || "").trim();
		const quote = normalizeReplayLookupText(replayAnnotationText(annotation));
		for (const candidate of Array.isArray(replayState.replayableAnnotations) ? replayState.replayableAnnotations : []) {
			const actionKey = replayCandidateActionKey(candidate);
			if (!actionKey) continue;
			if (annotationId && String(candidate?.annotationId || "").trim() === annotationId) return actionKey;
			if (quote && normalizeReplayLookupText(candidate?.matchedText || candidate?.citationText || candidate?.detail) === quote) return actionKey;
		}
		for (const action of Array.isArray(replayState.pageActions) ? replayState.pageActions : []) {
			const actionKey = replayCandidateActionKey(action);
			if (!actionKey) continue;
			if (action?.type === "note") continue;
			if (annotationId && String(action?.annotationId || "").trim() === annotationId) return actionKey;
			if (quote && normalizeReplayLookupText(action?.citationText || action?.detail) === quote) return actionKey;
		}
		return "";
	}

	function safeHostname(url) {
		try {
			return new URL(String(url || "")).hostname;
		} catch {
			return "";
		}
	}

	function buildRestoreResultMarkup() {
		if (!lastRestoreResult) return "";
		const pages = Array.isArray(lastRestoreResult.restoredPages) ? lastRestoreResult.restoredPages : [];
		const restoredAnnotations = pages.reduce((total, page) => total + Number(page?.restoredAnnotations || 0), 0);
		const restoredNotes = pages.reduce((total, page) => total + Number(page?.restoredNotes || 0), 0);
		const failedCount = pages.reduce((total, page) => total + Number(page?.failedCount || 0), 0);
		const summary = pages.length
			? [pluralize(pages.length, "page"), pluralize(restoredAnnotations, "highlight"), pluralize(restoredNotes, "note"), failedCount ? pluralize(failedCount, "failure") : ""]
					.filter(Boolean)
					.join(" / ")
			: "No pages restored";
		return `
			<div class="onhand-restore-result">
				<div class="onhand-restore-head">
					<span class="onhand-label">Restore result</span>
					<span class="onhand-count">${escapeHtml(summary)}</span>
				</div>
				<div class="onhand-restore-pages">
					${
						pages.length
							? pages
									.map((page) => {
										const title = page?.title || page?.url || page?.artifactId || "Saved page";
										const source = page?.source === "browser-replay" ? "replay" : "artifact";
										const failures = Array.isArray(page?.failures) ? page.failures : [];
										return `
											<div class="onhand-restore-page">
												<span class="onhand-restore-title">${escapeHtml(title)}</span>
												<span class="onhand-restore-meta">${escapeHtml(source)} / ${escapeHtml(pluralize(Number(page?.restoredAnnotations || 0), "highlight"))} / ${escapeHtml(pluralize(Number(page?.restoredNotes || 0), "note"))}</span>
												${failures.length ? `<span class="onhand-restore-failure">${escapeHtml(failures[0])}</span>` : ""}
											</div>
										`;
									})
									.join("")
							: '<div class="onhand-restore-page"><span class="onhand-restore-title">Nothing restored</span><span class="onhand-restore-meta">No saved artifacts or replayable highlights were found.</span></div>'
					}
				</div>
			</div>
		`;
	}

	function renderRestoreResult() {
		if (!lastRestoreResult) {
			restoreResultEl.hidden = true;
			restoreResultEl.innerHTML = "";
			return;
		}
		restoreResultEl.hidden = false;
		restoreResultEl.innerHTML = buildRestoreResultMarkup();
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

	function normalizePageTargetUrl(value) {
		return String(value || "").trim().split("#")[0];
	}

	function pageTargetUrls(target) {
		return [
			target?.url,
			target?.pdfAnchor?.document?.viewerUrl,
			target?.pdfAnchor?.document?.url,
			target?.pdfAnchor?.document?.pdfUrl,
		]
			.map(normalizePageTargetUrl)
			.filter(Boolean);
	}

	function pageTargetTitle(target) {
		return normalizeCitationText(target?.title || target?.pdfAnchor?.document?.title || "");
	}

	function belongsToCurrentPageTarget(target, state) {
		if (!target || typeof target !== "object") return false;
		const currentTabId = typeof state?.tab?.id === "number" ? state.tab.id : null;
		const targetTabId = typeof target?.tabId === "number" ? target.tabId : null;
		if (currentTabId !== null && targetTabId !== null) return currentTabId === targetTabId;

		const currentUrl = normalizePageTargetUrl(state?.tab?.url);
		const targetUrls = pageTargetUrls(target);
		if (currentUrl && targetUrls.length) return targetUrls.includes(currentUrl);

		const currentTitle = normalizeCitationText(state?.tab?.title || "");
		const targetTitle = pageTargetTitle(target);
		if (currentTitle && targetTitle) return currentTitle === targetTitle;

		return targetTabId === null && !targetUrls.length && !targetTitle;
	}

	function buildAnnotationIndexItems(state) {
		const actions = (Array.isArray(state?.pageActions) ? state.pageActions : []).filter((action) => belongsToCurrentPageTarget(action, state));
		const actionGroups = new Map();
		for (const action of actions) {
			if (!action?.annotationId) continue;
			const annotationId = String(action.annotationId || "").trim();
			if (!annotationId) continue;
			const group =
				actionGroups.get(annotationId) || {
					firstAction: null,
					highlightAction: null,
					noteAction: null,
				};
			if (!group.firstAction) group.firstAction = action;
			if (action.type === "annotation" && !group.highlightAction) group.highlightAction = action;
			if (action.type === "note" && !group.noteAction) group.noteAction = action;
			actionGroups.set(annotationId, group);
		}

		const tabId = typeof state?.tab?.id === "number" ? state.tab.id : null;
		const seen = new Set();
		const items = [];
		for (const annotation of getCapturedAnnotations(state)) {
			if (!belongsToCurrentPageTarget(annotation, state)) continue;
			const annotationId = String(annotation?.annotationId || "").trim();
			if (!annotationId || seen.has(annotationId)) continue;
			seen.add(annotationId);
			const actionGroup = actionGroups.get(annotationId) || {};
			const action = actionGroup.highlightAction || actionGroup.noteAction || actionGroup.firstAction || null;
			const noteAction = actionGroup.noteAction || null;
			const note = annotation?.note || null;
			const noteText = String(note?.text || (noteAction ? noteAction.detail || noteAction.citationText : "") || "").trim();
			const matchedText = String(annotation?.matchedText || action?.citationText || action?.detail || note?.text || "Page annotation").trim();
			items.push({
				annotationId,
				tabId,
				actionKey: action?.key || "",
				kind: String(annotation?.kind || action?.type || "annotation"),
				text: matchedText,
				noteText,
				hasNote: Boolean(note || noteAction || noteText),
				target: "annotation",
			});
		}

		if (items.length) return items;
		for (const [annotationId, actionGroup] of actionGroups.entries()) {
			if (!annotationId || seen.has(annotationId)) continue;
			seen.add(annotationId);
			const action = actionGroup.highlightAction || actionGroup.noteAction || actionGroup.firstAction || null;
			const noteAction = actionGroup.noteAction || null;
			const noteText = String(noteAction ? noteAction.detail || noteAction.citationText : "").trim();
			items.push({
				annotationId,
				tabId: typeof action?.tabId === "number" ? action.tabId : tabId,
				actionKey: action?.key || "",
				kind: action?.type || "annotation",
				text: String(action?.citationText || action?.detail || "Page annotation").trim(),
				noteText,
				hasNote: Boolean(noteAction || noteText),
				target: action?.type === "note" && !actionGroup.highlightAction ? "note" : "annotation",
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
			<div class="onhand-index-list">
				${items
					.map(
						(item, index) => `
							<div class="onhand-index-row">
								<button
									class="onhand-index-item"
									data-annotation-id="${escapeAttribute(item.annotationId)}"
									data-tab-id="${typeof item.tabId === "number" ? escapeAttribute(String(item.tabId)) : ""}"
									data-target="${escapeAttribute(item.target || "annotation")}"
									type="button"
								>
									<span class="onhand-index-num">${index + 1}</span>
									<span class="onhand-index-text">${escapeHtml(item.text || "Page annotation")}</span>
									<span class="onhand-index-kind">highlight</span>
								</button>
								${
									item.noteText
										? `<button
											class="onhand-index-note-preview"
											data-annotation-id="${escapeAttribute(item.annotationId)}"
											data-tab-id="${typeof item.tabId === "number" ? escapeAttribute(String(item.tabId)) : ""}"
											data-target="note"
											type="button"
											title="${escapeAttribute(item.noteText)}"
										>
											<span class="onhand-index-note-label">Note</span>
											<span class="onhand-index-note-text">${escapeHtml(item.noteText)}</span>
										</button>`
										: ""
								}
							</div>
						`,
					)
					.join("")}
			</div>
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

	function getProgressActivities(activities) {
		return (Array.isArray(activities) ? activities : []).filter((activity) => activity?.kind === "tool");
	}

	function trimProgressLabel(value) {
		return String(value || "")
			.replace(/\s+/g, " ")
			.trim()
			.replace(/\.\.\.$/, "");
	}

	function getProgressStatus(activity) {
		if (activity?.state === "error") return "Failed";
		if (activity?.state === "running") return "Running";
		return "Done";
	}

	function formatProgressLine(activity) {
		const label = trimProgressLabel(activity?.label || activity?.toolName || "Working");
		return label ? { status: getProgressStatus(activity), label } : null;
	}

	function formatActionProgressLine(action) {
		const label = String(action?.label || "Page action").trim();
		const detail = String(action?.detail || "").trim();
		const line = detail ? `${label}: ${detail}` : label;
		return line ? { status: "Done", label: line } : null;
	}

	function buildProgressSummary(turn, tools, actions) {
		const running = tools.find((activity) => activity?.state === "running");
		if (turn?.pending) return running ? `Working · ${trimProgressLabel(running.label || running.toolName)}` : "Working";
		const parts = ["Done"];
		if (tools.length) parts.push(pluralize(tools.length, "page step"));
		const highlightCount = actions.filter((action) => action?.type === "annotation").length;
		const noteCount = actions.filter((action) => action?.type === "note").length;
		const artifactCount = actions.filter((action) => action?.type === "artifact").length;
		if (highlightCount) parts.push(`highlighted ${pluralize(highlightCount, "passage")}`);
		if (noteCount) parts.push(`added ${pluralize(noteCount, "note")}`);
		if (artifactCount) parts.push(pluralize(artifactCount, "artifact"));
		if (!tools.length && actions.length && !highlightCount && !noteCount && !artifactCount) {
			parts.push(pluralize(actions.length, "page action"));
		}
		return parts.join(" · ");
	}

	function renderProgressDetails(turn) {
		const activities = Array.isArray(turn?.activities) ? turn.activities : [];
		const tools = getProgressActivities(activities);
		const actions = Array.isArray(turn?.pageActions) ? turn.pageActions : [];
		const lines = [...tools.map(formatProgressLine), ...actions.map(formatActionProgressLine)].filter(Boolean);
		if (!lines.length && turn?.pending) lines.push({ status: "Working", label: "Preparing page context" });
		if (!lines.length && !turn?.pending) return "";

		const summary = buildProgressSummary(turn, tools, actions);
		const open = progressExpanded == null ? Boolean(turn?.pending) : Boolean(progressExpanded);
		return `
			<details class="onhand-progress" ${open ? "open" : ""}>
				<summary>${escapeHtml(summary || "Progress")}</summary>
				<div class="onhand-progress-body">
					${lines
						.map(
							(line) => `
								<div class="onhand-progress-line">
									<span class="onhand-progress-status">${escapeHtml(line.status)}</span>
									<span>${escapeHtml(line.label)}</span>
								</div>
							`,
						)
						.join("")}
				</div>
			</details>
		`;
	}

	function renderTurnListMarkup(turns, emptyMarkup = "") {
		const items = (Array.isArray(turns) ? turns : []).filter(Boolean);
		if (!items.length) {
			return emptyMarkup;
		}

		const citationGroupsByTurnId = buildTurnCitationGroups(items);
		const citationNumbering = createCitationNumbering();
		return items
			.map((turn) => {
				const citationGroups = citationGroupsByTurnId.get(turn?.id) || buildCitationGroups(turn?.pageActions);
				const reply = String(turn?.reply || "").trim();
				const sourceActions = getTurnSourceActions(turn);
				const supportMarkup = renderProgressDetails(turn);
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
							${supportMarkup ? `<div class="onhand-support">${supportMarkup}</div>` : ""}
							<div class="onhand-response">
								${reply ? renderReplyMarkdown(reply, citationGroups, citationNumbering) : '<p class="reply-placeholder">Thinking...</p>'}
								${turn?.pending ? '<span class="onhand-cursor"></span>' : ""}
								${renderRealtimeSourceButtons(sourceActions)}
							</div>
						</div>
					</article>
				`;
			})
			.join("");
	}

	function bindProgressToggles(root) {
		root.querySelectorAll(".onhand-progress").forEach((detailsEl) => {
			detailsEl.addEventListener("toggle", () => {
				progressExpanded = detailsEl.open;
			});
		});
	}

	function resolveActionSessionOptions(options = {}) {
		const sessionPath =
			typeof options.sessionPath === "function" ? String(options.sessionPath() || "").trim() : String(options.sessionPath || "").trim();
		return sessionPath ? { sessionPath } : {};
	}

	function handleActionActivationError(error, options = {}) {
		if (typeof options.onError === "function") {
			options.onError(error);
			return;
		}
		renderState({
			...(currentState || {}),
			status: error?.message || String(error),
		});
	}

	function getActionDedupeMap(root) {
		if (!(root instanceof Element)) return null;
		if (!root.__onhandActionLastActivatedAtByKey) {
			root.__onhandActionLastActivatedAtByKey = new Map();
		}
		return root.__onhandActionLastActivatedAtByKey;
	}

	function actionDedupeKey(key, sessionOptions = {}) {
		return `${key}\u0000${sessionOptions.sessionPath || ""}`;
	}

	function activateActionButton(button, options = {}, root = null) {
		const key = String(button?.dataset?.actionKey || "").trim();
		if (!key) {
			handleActionActivationError(new Error("Could not activate that Onhand link."), options);
			return;
		}
		const sessionOptions = resolveActionSessionOptions(options);
		const dedupeKey = actionDedupeKey(key, sessionOptions);
		const dedupeMap = getActionDedupeMap(root);
		if (button.dataset.onhandActionPending === "true") return;
		const now = Date.now();
		const lastActivatedAt = Number(button.dataset.onhandActionLastActivatedAt || 0);
		if (Number.isFinite(lastActivatedAt) && now - lastActivatedAt < ACTION_ACTIVATION_DEDUP_MS) return;
		const lastRootActivatedAt = Number(dedupeMap?.get(dedupeKey) || 0);
		if (Number.isFinite(lastRootActivatedAt) && now - lastRootActivatedAt < ACTION_ACTIVATION_DEDUP_MS) return;
		button.dataset.onhandActionLastActivatedAt = String(now);
		dedupeMap?.set(dedupeKey, now);
		button.dataset.onhandActionPending = "true";
		void activateAction(key, sessionOptions)
			.catch((error) => handleActionActivationError(error, options))
			.finally(() => {
				if (button.dataset.onhandActionPending === "true") {
					delete button.dataset.onhandActionPending;
				}
			});
	}

	function consumeActionPointer(event) {
		event.preventDefault();
		event.stopPropagation();
		if (typeof event.stopImmediatePropagation === "function") {
			event.stopImmediatePropagation();
		}
	}

	function actionButtonFromEvent(root, event) {
		const target = event.target instanceof Element ? event.target : null;
		const button = target?.closest("[data-action-key]");
		return button instanceof HTMLElement && root.contains(button) ? button : null;
	}

	function bindActionButtons(root, options = {}) {
		if (!(root instanceof Element)) return;
		root.__onhandActionOptions = options;
		if (root.dataset.onhandActionDelegationBound !== "true") {
			root.dataset.onhandActionDelegationBound = "true";
			for (const eventName of ["pointerdown", "mousedown"]) {
				root.addEventListener(
					eventName,
					(event) => {
						const button = actionButtonFromEvent(root, event);
						if (!button) return;
						consumeActionPointer(event);
					},
					true,
				);
			}
			for (const eventName of ["pointerup", "mouseup", "click"]) {
				root.addEventListener(
					eventName,
					(event) => {
						const button = actionButtonFromEvent(root, event);
						if (!button) return;
						consumeActionPointer(event);
						activateActionButton(button, root.__onhandActionOptions || options, root);
					},
					true,
				);
			}
		}
		root.querySelectorAll("[data-action-key]").forEach((button) => {
			if (!(button instanceof HTMLElement) || button.dataset.onhandActionBound === "true") return;
			button.dataset.onhandActionBound = "true";
		});
	}

	function renderMessages(turns, annotationCount = 0) {
		const emptyMarkup = annotationCount
			? ""
			: `
				<div class="onhand-empty">
					<div class="lede">Nothing on this page yet.</div>
					<div class="empty-body">Ask about the article, highlight a passage, or resume one of yesterday's entries from the menu.</div>
				</div>
		`;
		messagesEl.innerHTML = renderTurnListMarkup(turns, emptyMarkup);
		bindProgressToggles(messagesEl);
		bindActionButtons(messagesEl);
	}

	function renderReplayAnnotations(annotations) {
		const items = Array.isArray(annotations) ? annotations : [];
		if (!items.length) {
			return '<div class="onhand-replay-empty">No saved annotations were found for this session.</div>';
		}
		return `
			<div class="onhand-replay-annotations">
				${items
					.map((annotation) => {
						const quote = replayAnnotationText(annotation);
						const note = replayAnnotationNote(annotation);
						const actionKey = resolveReplayAnnotationActionKey(annotation);
						return `
							<div class="onhand-replay-annotation">
								<div class="onhand-replay-annotation-head">
									<span class="onhand-replay-quote">${escapeHtml(quote || "Saved highlight")}</span>
									${actionKey ? `<button class="onhand-replay-source" data-action-key="${escapeAttribute(actionKey)}" type="button">Source</button>` : ""}
								</div>
								${note ? `<span class="onhand-replay-note">${escapeHtml(note)}</span>` : ""}
							</div>
						`;
					})
					.join("")}
			</div>
		`;
	}

	function renderReplaySnapshot() {
		if (replayState.loading) {
			return '<div class="onhand-replay-empty">Loading saved review...</div>';
		}
		if (replayState.loadingArtifact) {
			return '<div class="onhand-replay-empty">Loading saved snapshot...</div>';
		}
		const artifact = replayState.artifact;
		if (!artifact) {
			return replayState.artifacts.length
				? '<div class="onhand-replay-empty">Choose a saved page to preview its snapshot.</div>'
				: '<div class="onhand-replay-empty">This session has no saved page snapshot yet. Review can still restore live-page highlights when the original page is available.</div>';
		}
		const title = artifact.title || artifact.page?.title || "Saved page";
		const url = artifact.url || artifact.page?.url || "";
		const snapshotBody = artifact.screenshotDataUrl
			? `<img class="onhand-replay-image" src="${escapeAttribute(artifact.screenshotDataUrl)}" alt="Saved snapshot of ${escapeAttribute(title)}" />`
			: artifact.outerHTML
				? '<iframe class="onhand-replay-frame" sandbox="" title="Saved HTML snapshot"></iframe>'
				: '<div class="onhand-replay-empty">This artifact has metadata, but no saved screenshot or HTML snapshot.</div>';
		return `
			<div class="onhand-replay-snapshot">
				<div class="onhand-replay-snapshot-head">
					<span>${escapeHtml(title)}</span>
					<span>${escapeHtml(safeHostname(url) || "saved page")}</span>
				</div>
				${snapshotBody}
			</div>
		`;
	}

	function renderReplayView() {
		const currentPath = getCurrentSessionPath(currentState);
		const hasSession = Boolean(currentPath || replayState.sessionPath || replayState.session);
		replayViewEl.hidden = !hasSession;
		if (!hasSession) {
			replayViewEl.innerHTML = "";
			return;
		}
		const previousArtifactsScroller = replayViewEl.querySelector(".onhand-replay-artifacts");
		if (previousArtifactsScroller instanceof HTMLElement) {
			replayArtifactsScrollLeft = previousArtifactsScroller.scrollLeft;
		}
		const session = replayState.session || {};
		const title = session.title || session.name || currentState?.currentSession?.sessionName || "Saved session";
		const artifacts = Array.isArray(replayState.artifacts) ? replayState.artifacts : [];
		const selectedArtifactId = replayState.selectedArtifactId || replayState.artifact?.artifactId || artifacts.at(-1)?.artifactId || "";
		const selectedSummary = artifacts.find((artifact) => artifact.artifactId === selectedArtifactId) || replayState.artifact || null;
		const annotations = replayState.artifact?.annotations?.length ? replayState.artifact.annotations : replayState.replayableAnnotations;
		const currentTurns = Array.isArray(currentState?.turns) ? currentState.turns : [];
		const turnCount = Array.isArray(replayState.turns) && replayState.turns.length ? replayState.turns.length : currentTurns.length;
		const meta = [
			turnCount ? pluralize(turnCount, "turn") : "",
			replayState.loading || replayState.session ? pluralize(artifacts.length, "snapshot") : "",
			replayState.loading || replayState.session ? pluralize(Array.isArray(annotations) ? annotations.length : 0, "highlight") : "",
		].filter(Boolean);
		replayViewEl.innerHTML = `
			<div class="onhand-replay-head">
				<button class="onhand-replay-toggle" data-replay-toggle type="button" aria-expanded="${replayState.open ? "true" : "false"}">
					<span class="onhand-replay-caret" aria-hidden="true">${replayState.open ? "v" : ">"}</span>
					<span class="onhand-label">Review</span>
					<div class="onhand-replay-title">${escapeHtml(title)}</div>
				</button>
				${meta.length ? `<div class="onhand-replay-meta">${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
			</div>
			<div class="onhand-replay-body" ${replayState.open ? "" : "hidden"}>
				<div class="onhand-replay-actions">
					<button class="onhand-replay-button" data-replay-restore type="button" ${restoringSession ? "disabled" : ""}>${restoringSession ? "Restoring..." : "Restore pages"}</button>
				</div>
				<div class="onhand-replay-meta">
					${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
					${replayState.loading ? "<span>Loading...</span>" : ""}
				</div>
				${replayState.error ? `<div class="onhand-replay-error">${escapeHtml(replayState.error)}</div>` : ""}
				${
					artifacts.length
						? `
							<div class="onhand-replay-artifacts">
								${artifacts
									.map((artifact) => {
										const artifactTitle = artifact.title || artifact.page?.title || artifact.artifactId || "Saved page";
										const bits = [
											artifact.hasScreenshot ? "screenshot" : "",
											artifact.hasHtml ? "HTML" : "",
											pluralize(Number(artifact.annotationCount || 0), "highlight"),
										].filter(Boolean);
										return `
											<button class="onhand-replay-artifact ${artifact.artifactId === selectedArtifactId ? "active" : ""}" data-replay-artifact-id="${escapeAttribute(artifact.artifactId)}" type="button">
												<span class="onhand-replay-artifact-title">${escapeHtml(artifactTitle)}</span>
												<span class="onhand-replay-artifact-meta">${escapeHtml(bits.join(" / ") || "metadata")}</span>
											</button>
										`;
									})
									.join("")}
							</div>
						`
						: ""
				}
				${renderReplaySnapshot()}
				<div class="onhand-replay-section">
					<div class="onhand-index-head">
						<span class="onhand-label">Saved annotations</span>
						<span class="onhand-count">· ${escapeHtml(selectedSummary?.title || selectedSummary?.page?.title || "session")}</span>
					</div>
					${renderReplayAnnotations(annotations)}
				</div>
			</div>
		`;
		const frame = replayViewEl.querySelector(".onhand-replay-frame");
		if (frame instanceof HTMLIFrameElement && replayState.artifact?.outerHTML) {
			frame.srcdoc = replayState.artifact.outerHTML;
		}
		const artifactsScroller = replayViewEl.querySelector(".onhand-replay-artifacts");
		if (artifactsScroller instanceof HTMLElement) {
			artifactsScroller.scrollLeft = replayArtifactsScrollLeft;
			artifactsScroller.addEventListener(
				"scroll",
				() => {
					replayArtifactsScrollLeft = artifactsScroller.scrollLeft;
				},
				{ passive: true },
			);
		}
		bindProgressToggles(replayViewEl);
		bindActionButtons(replayViewEl, {
			sessionPath: () => replayState.sessionPath || replayState.session?.path || replayState.session?.id || replayState.session?.sessionId || "",
			onError(error) {
				replayState = {
					...replayState,
					error: error?.message || String(error),
				};
				renderState(currentState || {});
			},
		});
	}

	function renderActivity() {
		activityEl.innerHTML = "";
	}

	function findTurnForRealtimeAnswer(state, sourceTurnId) {
		const id = String(sourceTurnId || "").trim();
		if (!id) return null;
		return (Array.isArray(state?.turns) ? state.turns : []).find((turn) => String(turn?.id || "") === id) || null;
	}

	function collectActionsThroughTurn(state, sourceTurnId = "") {
		const turns = Array.isArray(state?.turns) ? state.turns : [];
		const actions = [];
		const id = String(sourceTurnId || "").trim();
		for (const turn of turns) {
			actions.push(...(Array.isArray(turn?.pageActions) ? turn.pageActions : []));
			if (id && String(turn?.id || "") === id) break;
		}
		if (!id) actions.push(...(Array.isArray(state?.pageActions) ? state.pageActions : []));
		return dedupePageActions(actions);
	}

	function scoreCitationActionAgainstText(action, text) {
		if (!action || (action.type !== "annotation" && action.type !== "note")) return 0;
		const actionText = [action.citationText, action.detail, action.label].filter(Boolean).join(" ");
		const actionTokens = new Set(tokenizeCitationText(actionText));
		const textTokens = new Set(tokenizeCitationText(text));
		if (!actionTokens.size || !textTokens.size) return 0;
		let score = 0;
		for (const token of actionTokens) {
			if (textTokens.has(token)) score += /^\d+$/.test(token) ? 2 : 1;
		}
		const actionPhrase = normalizeCitationText(action.citationText || action.detail || "");
		const textPhrase = normalizeCitationText(text);
		if (actionPhrase && actionPhrase.length >= 18 && textPhrase.includes(actionPhrase)) score += 6;
		return score;
	}

	function selectRelevantCitationActions(actions, text, limit = 3) {
		return dedupePageActions(
			(Array.isArray(actions) ? actions : [])
				.map((action) => ({ action, score: scoreCitationActionAgainstText(action, text) }))
				.filter((entry) => entry.score >= 2)
				.sort((left, right) => right.score - left.score)
				.map((entry) => entry.action),
		).slice(0, limit);
	}

	function getRealtimeAnswerSourceActions(state, sourceTurn, markdown) {
		const directActions = dedupePageActions([
			...(Array.isArray(realtimeAnswer?.pageActions) ? realtimeAnswer.pageActions : []),
			...(Array.isArray(sourceTurn?.pageActions) ? sourceTurn.pageActions : []),
		]);
		if (directActions.length) return directActions;
		const sourceText = [sourceTurn?.userPrompt, realtimeAnswer?.userPrompt, markdown].filter(Boolean).join(" ");
		const priorActions = collectActionsThroughTurn(state, sourceTurn?.id || "");
		return selectRelevantCitationActions(priorActions, sourceText);
	}

	function renderRealtimeSourceButtons(actions) {
		const items = Array.isArray(actions) ? actions : [];
		if (!items.length) return "";
		return `
			<div class="onhand-realtime-sources">
				<span class="onhand-label">Sources</span>
				${renderActionButtons(items, "onhand-actions onhand-realtime-source-actions")}
			</div>
		`;
	}

	function getTurnSourceActions(turn) {
		return dedupePageActions(Array.isArray(turn?.pageActions) ? turn.pageActions : []).filter(
			(action) => action?.type === "annotation" || action?.type === "note" || action?.type === "visual" || action?.type === "tab",
		);
	}

	function renderLatestReply(state) {
		const sessionPath = getStateSessionPath(state);
		const answerSessionPath = String(realtimeAnswer?.sessionPath || "").trim();
		const answerBelongsToSession = !answerSessionPath || !sessionPath || answerSessionPath === sessionPath;
		if (answerBelongsToSession && (realtimeAnswer?.markdown || realtimeAnswer?.pending)) {
			const markdown = String(realtimeAnswer.markdown || "").trim();
			const sourceTurn = findTurnForRealtimeAnswer(state, realtimeAnswer?.sourceTurnId);
			const sourceActions = getRealtimeAnswerSourceActions(state, sourceTurn, markdown);
			const citationGroups = buildCitationGroups(sourceActions);
			const status =
				realtimeAnswer.status || (sourceActions.length ? "Page-grounded" : "");
			replySectionEl.hidden = false;
			replyEl.innerHTML = `
				<article class="onhand-entry onhand-realtime-answer">
					<div class="onhand-eyebrow">
						<time>${escapeHtml(formatEntryTime(realtimeAnswer.updatedAt || new Date().toISOString()))}</time>
						<span class="dot"></span>
						<span>Realtime tutor</span>
						${status ? `<span class="dot"></span><span>${escapeHtml(status)}</span>` : ""}
					</div>
					${realtimeAnswer.userPrompt ? `<p class="onhand-q">${escapeHtml(realtimeAnswer.userPrompt)}</p>` : ""}
					<div class="onhand-a">
						<div class="onhand-response">
							${markdown ? renderReplyMarkdown(markdown, citationGroups) : '<p class="reply-placeholder">Listening...</p>'}
							${realtimeAnswer.pending ? '<span class="onhand-cursor"></span>' : ""}
							${renderRealtimeSourceButtons(sourceActions)}
						</div>
					</div>
				</article>
			`;
			bindActionButtons(replyEl);
			return;
		}
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
			progressExpanded = null;
		}
		const previousSessionPath = getStateSessionPath(currentState);
		const nextSessionPath = getStateSessionPath(state);
		if (previousSessionPath && nextSessionPath && previousSessionPath !== nextSessionPath) {
			clearRealtimeSessionLocalState();
		}
		lastActiveRequestId = state?.activeRequestId || null;
		const archivedTurns = Array.isArray(state?.turns) ? state.turns : [];
		const currentTurn = deriveCurrentTurn(state);
		const displayTurns = [...archivedTurns];
		if (currentTurn && !displayTurns.some((turn) => turn?.id === currentTurn.id)) {
			displayTurns.push(currentTurn);
		}
		currentState = state;
		maybeSpeakCompletedRealtimeDirectAnswer(state);
		renderMeta(state);
		renderSessionControls(state);
		renderRealtimeControls();
		renderAttachmentDrafts();
		renderRestoreResult();
		renderReplayView();
		renderAuthPanel(state);
		renderLearnerPanel(state, false);
		pageIndexEl.hidden = true;
		messagesEl.hidden = false;
		const annotationCount = renderPageIndex(state);
		renderMessages(displayTurns, annotationCount);
		renderActivity();
		renderLatestReply(state, currentTurn);
		renderActions(state);

		const activeRequest = Boolean(state?.activeRequestId);
		composer.hidden = false;
		input.disabled = activeRequest || sending;
		sendButton.disabled = activeRequest || sending;
		attachButton.disabled = activeRequest || sending;
		fileInput.disabled = activeRequest || sending;
		refocusQuickAskComposerAfterRender();
		helper.textContent = activeRequest
			? "Onhand is responding · use Stop from the menu"
			: realtimeConnected
				? "voice is live · speak then pause, or type here"
			: attachmentDrafts.length
				? "attachments ready · enter ask"
				: "esc dismiss · cmd+n new entry";
		if (body instanceof HTMLElement && (activeRequest || wasNearBottom)) {
			body.scrollTop = body.scrollHeight;
		}
	}

	async function requestState() {
		if (!open) return;
		const response = await chrome.runtime.sendMessage({
			type: "sidebar:fetch-state",
			windowId: await ensureCurrentWindowId(),
		});
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
		if (realtimeConnected && realtimeDataChannel?.readyState === "open" && trimmedPrompt && !attachments.length) {
			await sendRealtimeTextPrompt(trimmedPrompt);
			input.value = "";
			return;
		}
		sending = true;
		lastRestoreResult = null;
		resetReplayState();
		renderState(currentState || {});
		try {
			const response = await chrome.runtime.sendMessage({
				type: "sidebar:submit-prompt",
				prompt: trimmedPrompt,
				displayPrompt,
				attachments,
				learningMode,
				source: "sidebar",
				windowId: await ensureCurrentWindowId(),
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

	async function activateAction(key, options = {}) {
		const sessionPath = String(options?.sessionPath || "").trim();
		const response = await chrome.runtime.sendMessage({
			type: "sidebar:activate-action",
			key,
			...(sessionPath ? { sessionPath } : {}),
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

	function dedupePageActions(actions) {
		const seen = new Set();
		const unique = [];
		for (const action of actions) {
			if (!action || typeof action !== "object") continue;
			const key = String(action.key || "").trim();
			const signature =
				key ||
				[
					action.type || "",
					action.annotationId || "",
					action.artifactId || "",
					action.citationText || action.detail || "",
					action.url || "",
					action.title || "",
				].join("\u0000");
			if (signature && seen.has(signature)) continue;
			if (signature) seen.add(signature);
			unique.push(action);
		}
		return unique;
	}

	function collectCurrentPageActions() {
		return dedupePageActions([
			...(Array.isArray(currentState?.pageActions) ? currentState.pageActions : []),
			...(Array.isArray(currentState?.turns) ? currentState.turns.flatMap((turn) => turn?.pageActions || []) : []),
		]);
	}

	function findActionForAnnotation(annotationId, target = "annotation", actions = collectCurrentPageActions()) {
		const id = String(annotationId || "").trim();
		if (!id) return null;
		const matches = (Array.isArray(actions) ? actions : []).filter((action) => action?.key && String(action.annotationId || "").trim() === id);
		if (!matches.length) return null;
		const isHighlightAction = (action) => action?.type === "annotation" && (String(action.key || "").startsWith("highlight:") || action.label === "Highlighted text");
		if (target === "note") {
			return matches.find((action) => action?.type === "note") || matches.find(isHighlightAction) || matches[0];
		}
		return matches.find(isHighlightAction) || matches[0];
	}

	function learnerSourceErrorMessage(error) {
		const message = String(error?.message || error || "").trim();
		if (/not found|no annotation|source.*missing|annotation.*missing/i.test(message)) {
			return "Source not found on this page";
		}
		return message || "Could not jump to source";
	}

	function setLearnerSourceFeedback(feedback) {
		learnerSourceFeedback = feedback;
		renderState(currentState || {});
	}

	async function jumpToLearnerSource(annotationId, target = "annotation", preferredActionKey = "") {
		const id = String(annotationId || "").trim();
		const actionKey = String(preferredActionKey || "").trim();
		if (!id && !actionKey) return;
		const sequence = ++learnerSourceFeedbackSequence;
		setLearnerSourceFeedback({
			annotationId: id,
			kind: "pending",
			message: "Opening source...",
		});
		try {
			if (actionKey) {
				await activateAction(actionKey);
			} else {
				const action = findActionForAnnotation(id, target);
				if (action?.key) {
					await activateAction(action.key);
				} else {
					await scrollToAnnotation(id, null, target);
				}
			}
			if (sequence !== learnerSourceFeedbackSequence) return;
			setLearnerSourceFeedback({
				annotationId: id,
				kind: "ok",
				message: "Jumped to source",
			});
		} catch (error) {
			if (sequence !== learnerSourceFeedbackSequence) return;
			setLearnerSourceFeedback({
				annotationId: id,
				kind: "error",
				message: learnerSourceErrorMessage(error),
			});
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

	async function signInWithOpenAICodexFromSidebar() {
		if (authSigningIn) return;
		authSigningIn = true;
		authStatusKind = "";
		authStatusText = "Opening OpenAI sign-in...";
		renderState(currentState || {});
		try {
			const response = await chrome.runtime.sendMessage({
				type: "browser-runtime:oauth-sign-in",
				providerId: CODEX_PROVIDER,
				aiModel: CODEX_MODEL,
			});
			if (!response?.ok) {
				throw new Error(response?.error || "OpenAI sign-in failed.");
			}
			authStatusKind = "ok";
			authStatusText = "Signed in";
			currentState = {
				...(currentState || {}),
				preferences: {
					...(currentState?.preferences || {}),
					...(response.settings || {}),
				},
			};
			await Promise.all([requestState(), requestSessions()]);
		} catch (error) {
			authStatusKind = "error";
			authStatusText = error?.message || String(error);
			renderState(currentState || {});
		} finally {
			authSigningIn = false;
			renderState(currentState || {});
		}
	}

	function setRealtimeStatus(status, error = "") {
		realtimeStatus = status || "Voice idle";
		realtimeError = error || "";
		realtimeErrorExpanded = false;
		renderRealtimeControls();
	}

	function isRealtimeApiKeySetupError(message) {
		return /openai api key|platform key|realtime api access|invalid_api_key|incorrect api key|unauthorized|forbidden/i.test(
			String(message || ""),
		);
	}

	function realtimeVoiceErrorMessage(error) {
		const message = String(error?.message || error || "").trim();
		if (isRealtimeApiKeySetupError(message)) return REALTIME_API_KEY_SETUP_MESSAGE;
		return message || "Could not start Voice.";
	}

	async function openOnhandOptionsPage() {
		if (chrome.runtime?.openOptionsPage) {
			await chrome.runtime.openOptionsPage();
			return;
		}
		throw new Error("Open chrome://extensions, find Onhand, click Details, then Extension options.");
	}

	function isRealtimeMicDiagnosticStatus(status = realtimeStatus) {
		return /^(Voice ready · (checking mic|mic silent|mic level)|Chrome mic silent|Mic monitor suspended|Mic monitor unavailable|Mic monitor failed)/i.test(
			String(status || ""),
		);
	}

	function setRealtimeReadyStatus(status = "Voice ready · ask, then pause") {
		if (isRealtimeMicDiagnosticStatus()) {
			renderRealtimeControls();
			return;
		}
		setRealtimeStatus(status);
	}

	function clearRealtimeSessionLocalState() {
		clearRealtimeTranscriptionFallback();
		clearRealtimePendingTranscript();
		clearRealtimeBackendPreamble();
		realtimeAnswer = null;
		realtimeTranscriptBuffer = "";
		realtimePendingDirectAnswerRequestId = "";
		realtimePendingDirectAnswerPrompt = "";
		realtimePendingDirectAnswerVoiceTurnId = "";
		realtimePendingSocraticMove = null;
		realtimeActiveVoiceTurn = null;
		realtimeResponseVoiceTurnId = "";
		realtimeSuppressTranscriptForResponse = false;
		realtimeResponseAfterDoneStatus = "";
		realtimeAudioFallbackItemIds.clear();
	}

	function beginRealtimeVoiceTurn(kind, prompt) {
		const text = String(prompt || "").trim();
		const turn = {
			id: `voice_turn_${++realtimeVoiceTurnCounter}`,
			kind: String(kind || "voice").trim() || "voice",
			prompt: text,
			createdAt: new Date().toISOString(),
			pageActions: [],
		};
		realtimeActiveVoiceTurn = turn;
		realtimeTranscriptBuffer = "";
		return turn;
	}

	function isRealtimeVoiceTurnCurrent(turnOrId) {
		const id = typeof turnOrId === "string" ? turnOrId : turnOrId?.id;
		return Boolean(id && realtimeActiveVoiceTurn?.id === id);
	}

	function markRealtimeVoiceTurnStale(reason = "interrupted") {
		if (!realtimeActiveVoiceTurn) return null;
		const staleTurn = {
			...realtimeActiveVoiceTurn,
			staleReason: reason,
		};
		clearRealtimeBackendPreamble();
		realtimeActiveVoiceTurn = null;
		return staleTurn;
	}

	function updateRealtimeAnswerForTurn(turn, partial) {
		if (turn && !isRealtimeVoiceTurnCurrent(turn)) return false;
		updateRealtimeAnswer({
			voiceTurnId: turn?.id || realtimeAnswer?.voiceTurnId || "",
			...(turn?.prompt ? { userPrompt: turn.prompt } : {}),
			...partial,
		});
		return true;
	}

	function clearRealtimeAnswerForTurn(turn = null) {
		if (!realtimeAnswer) return;
		if (!turn?.id || realtimeAnswer.voiceTurnId === turn.id) {
			realtimeAnswer = null;
		}
	}

	async function persistRealtimeVoiceTurn(turn, reply, options = {}) {
		if (!turn || !isRealtimeVoiceTurnCurrent(turn)) return false;
		const text = String(reply || "").trim();
		if (!text || realtimePersistedVoiceTurnIds.has(turn.id)) return false;
		const pageActions = Array.isArray(options.pageActions)
			? options.pageActions
			: Array.isArray(turn.pageActions)
				? turn.pageActions
				: [];
		const response = await chrome.runtime.sendMessage({
			type: "sidebar:realtime-record-turn",
			voiceTurnId: turn.id,
			kind: turn.kind,
			userPrompt: `[Voice] ${turn.prompt || "Voice turn"}`,
			reply: text,
			status: String(options.status || "Voice answer").trim(),
			pageActions,
			windowId: await ensureCurrentWindowId(),
		});
		if (!response?.ok) throw new Error(response?.error || "Could not save the voice turn.");
		realtimePersistedVoiceTurnIds.add(turn.id);
		if (options.clearLiveAnswer !== false) clearRealtimeAnswerForTurn(turn);
		await Promise.all([requestState(), requestSessions()]);
		return true;
	}

	function clearRealtimeIdleTimeout() {
		if (!realtimeIdleTimeoutTimer) return;
		clearTimeout(realtimeIdleTimeoutTimer);
		realtimeIdleTimeoutTimer = null;
	}

	function expireRealtimeIdleTimeout() {
		if (!realtimeConnected) return false;
		if (realtimeResponseInProgress) {
			scheduleRealtimeIdleTimeout();
			return false;
		}
		stopRealtimeVoice("Voice ended after idle");
		return true;
	}

	function scheduleRealtimeIdleTimeout() {
		clearRealtimeIdleTimeout();
		if (!realtimeConnected) return;
		realtimeIdleTimeoutTimer = setTimeout(() => {
			realtimeIdleTimeoutTimer = null;
			expireRealtimeIdleTimeout();
		}, REALTIME_IDLE_TIMEOUT_MS);
	}

	function noteRealtimeActivity() {
		if (realtimeConnected) scheduleRealtimeIdleTimeout();
	}

	function isRealtimeMicrophonePermissionError(error) {
		const name = String(error?.name || "");
		const message = String(error?.message || error || "");
		return /notallowed|permissiondenied/i.test(name) || /permission.*(dismissed|denied|disallowed|blocked)/i.test(message);
	}

	function realtimeMicrophoneErrorMessage(error) {
		const message = String(error?.message || error || "").trim();
		if (/permission dismissed/i.test(message)) {
			return "Chrome dismissed the side-panel mic prompt. I opened an Onhand mic permission tab; click Allow there, then this will retry.";
		}
		if (/permission denied by system/i.test(message)) {
			return "macOS is blocking Chrome microphone access. Enable Chrome in System Settings > Privacy & Security > Microphone.";
		}
		return message || "Could not access the microphone.";
	}

	function stopRealtimeMicMonitor() {
		if (realtimeMicMonitorTimer) {
			clearInterval(realtimeMicMonitorTimer);
			realtimeMicMonitorTimer = null;
		}
		if (realtimeVoiceFallbackTimer) {
			clearTimeout(realtimeVoiceFallbackTimer);
			realtimeVoiceFallbackTimer = null;
		}
		if (realtimeManualVoiceResponseTimer) {
			clearTimeout(realtimeManualVoiceResponseTimer);
			realtimeManualVoiceResponseTimer = null;
		}
		clearRealtimeTranscriptionFallback();
		clearRealtimePendingTranscript();
		clearRealtimeBackendPreamble();
		realtimeLocalSpeechActive = false;
		realtimeManualVoiceCommitPending = false;
		realtimeMicCurrentRms = 0;
		realtimeMicPeakRms = 0;
		realtimeMicNoiseFloorRms = 0;
		realtimeMicMonitorStartedAt = 0;
		realtimeMicMonitorFrames = 0;
		realtimeMicLastIdleStatusAt = 0;
		realtimeMicMonitorSource = null;
		realtimeMicMonitorAnalyser = null;
		if (realtimeAudioContext) {
			void realtimeAudioContext.close().catch(() => {});
			realtimeAudioContext = null;
		}
	}

	function getRealtimeMicDeviceLabel(deviceId) {
		const normalized = normalizeRealtimeMicDeviceId(deviceId);
		if (normalized === "default") {
			const defaultDevice = realtimeMicDevices.find((device) => device.deviceId === "default");
			return defaultDevice?.label ? defaultDevice.label.replace(/^Default\s*[-:]\s*/i, "Default: ") : "Default mic";
		}
		const device = realtimeMicDevices.find((candidate) => candidate.deviceId === normalized);
		return device?.label || (normalized === realtimeMicDeviceId && realtimeActiveMicLabel) || "Selected mic";
	}

	function getRealtimeMicCompactLabel(label, deviceId) {
		const normalized = normalizeRealtimeMicDeviceId(deviceId);
		const raw = String(label || "").trim();
		if (!raw) return normalized === "default" ? "Default" : "Mic";
		if (normalized === "default") return "Default";
		return raw
			.replace(/^Default\s*[-:]\s*/i, "")
			.replace(/\s*\([^)]*\)\s*$/g, "")
			.replace(/\bMicrophone\b/gi, "Mic")
			.replace(/\bBuilt-in\b/gi, "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 18) || "Mic";
	}

	function getRealtimeMicSelectOptions() {
		const options = [];
		const seen = new Set();
		const pushOption = (deviceId, label) => {
			const normalized = normalizeRealtimeMicDeviceId(deviceId);
			if (seen.has(normalized)) return;
			seen.add(normalized);
			options.push({
				deviceId: normalized,
				label: String(label || "").trim() || (normalized === "default" ? "Default mic" : "Microphone"),
			});
		};
		pushOption("default", getRealtimeMicDeviceLabel("default"));
		for (const device of realtimeMicDevices) {
			if (device.kind !== "audioinput" || !device.deviceId || device.deviceId === "default") continue;
			pushOption(device.deviceId, device.label || `Mic ${options.length}`);
		}
		if (!seen.has(realtimeMicDeviceId)) {
			pushOption(realtimeMicDeviceId, realtimeActiveMicLabel || "Selected mic");
		}
		return options;
	}

	function renderRealtimeMicDeviceSelect() {
		if (!(realtimeMicSelect instanceof HTMLSelectElement)) return;
		const supportsMicSelection = Boolean(navigator.mediaDevices?.getUserMedia);
		if (realtimeMicPicker instanceof HTMLElement) {
			realtimeMicPicker.hidden = !supportsMicSelection;
		}
		realtimeMicSelect.hidden = !supportsMicSelection;
		if (!supportsMicSelection) return;
		const options = getRealtimeMicSelectOptions();
		const selectedId = options.some((option) => option.deviceId === realtimeMicDeviceId) ? realtimeMicDeviceId : "default";
		const signature = JSON.stringify({ options, selectedId });
		if (signature !== realtimeMicSelectSignature) {
			realtimeMicSelect.innerHTML = options
				.map((option) => {
					const selected = option.deviceId === selectedId ? " selected" : "";
					const compactLabel = getRealtimeMicCompactLabel(option.label, option.deviceId);
					return `<option value="${escapeAttribute(option.deviceId)}" title="${escapeAttribute(option.label)}"${selected}>${escapeHtml(compactLabel)}</option>`;
				})
				.join("");
			realtimeMicSelectSignature = signature;
		}
		realtimeMicSelect.value = selectedId;
		realtimeMicSelect.disabled = realtimeConnecting;
		const selectedLabel = getRealtimeMicDeviceLabel(selectedId);
		const pickerTitle = realtimeConnected
			? `Realtime microphone: ${selectedLabel}. Change to restart voice with another input.`
			: `Realtime microphone: ${selectedLabel}`;
		realtimeMicSelect.title = pickerTitle;
		if (realtimeMicPicker instanceof HTMLElement) {
			realtimeMicPicker.title = pickerTitle;
			realtimeMicPicker.classList.toggle("disabled", realtimeConnecting);
		}
		if (realtimeMicLabel instanceof HTMLElement) {
			realtimeMicLabel.textContent = getRealtimeMicCompactLabel(selectedLabel, selectedId);
		}
	}

	async function refreshRealtimeMicDevices() {
		if (!navigator.mediaDevices?.enumerateDevices) {
			realtimeMicDevices = [];
			renderRealtimeMicDeviceSelect();
			return [];
		}
		try {
			const devices = await navigator.mediaDevices.enumerateDevices();
			realtimeMicDevices = devices
				.filter((device) => device?.kind === "audioinput")
				.map((device) => ({
					kind: "audioinput",
					deviceId: String(device.deviceId || ""),
					label: String(device.label || ""),
					groupId: String(device.groupId || ""),
				}))
				.filter((device) => device.deviceId);
			renderRealtimeMicDeviceSelect();
			return realtimeMicDevices;
		} catch {
			realtimeMicDevices = [];
			renderRealtimeMicDeviceSelect();
			return [];
		}
	}

	async function createRealtimeInputMediaStream() {
		if (!navigator.mediaDevices?.getUserMedia) {
			throw new Error("Microphone capture is unavailable in this browser surface.");
		}
		setRealtimeStatus("Requesting mic...");
		const selectedDeviceId = normalizeRealtimeMicDeviceId(realtimeMicDeviceId);
		const audio = {
			echoCancellation: true,
			noiseSuppression: true,
			autoGainControl: true,
		};
		if (selectedDeviceId !== "default") {
			audio.deviceId = { exact: selectedDeviceId };
		}
		try {
			return await navigator.mediaDevices.getUserMedia({ audio });
		} catch (error) {
			if (selectedDeviceId !== "default" && /notfound|overconstrained/i.test(String(error?.name || error?.message || ""))) {
				realtimeMicDeviceId = "default";
				void saveRealtimeMicDevicePreference(realtimeMicDeviceId).catch(() => {});
				renderRealtimeMicDeviceSelect();
				setRealtimeStatus("Selected mic unavailable · using default");
				const fallbackAudio = { ...audio };
				delete fallbackAudio.deviceId;
				return await navigator.mediaDevices.getUserMedia({ audio: fallbackAudio });
			}
			throw error;
		}
	}

	function clearRealtimeVoiceFallback() {
		if (realtimeVoiceFallbackTimer) {
			clearTimeout(realtimeVoiceFallbackTimer);
			realtimeVoiceFallbackTimer = null;
		}
		if (realtimeManualVoiceResponseTimer) {
			clearTimeout(realtimeManualVoiceResponseTimer);
			realtimeManualVoiceResponseTimer = null;
		}
		clearRealtimeTranscriptionFallback();
		realtimeManualVoiceCommitPending = false;
	}

	function clearRealtimeTranscriptionFallback() {
		if (realtimeTranscriptionFallbackTimer) {
			clearTimeout(realtimeTranscriptionFallbackTimer);
			realtimeTranscriptionFallbackTimer = null;
		}
		realtimePendingTranscriptionItemId = "";
	}

	function clearRealtimePendingTranscript() {
		if (realtimePendingTranscriptTimer) {
			clearTimeout(realtimePendingTranscriptTimer);
			realtimePendingTranscriptTimer = null;
		}
		realtimePendingTranscriptSegments = [];
	}

	function pauseRealtimePendingTranscriptFlush() {
		if (!realtimePendingTranscriptTimer) return;
		clearTimeout(realtimePendingTranscriptTimer);
		realtimePendingTranscriptTimer = null;
	}

	function clearRealtimeBackendPreamble(turn = null) {
		if (turn && !isRealtimeVoiceTurnCurrent(turn)) return;
		if (realtimeBackendPreambleTimer) {
			clearTimeout(realtimeBackendPreambleTimer);
			realtimeBackendPreambleTimer = null;
		}
	}

	function startRealtimeAudioResponseFallback(itemId = "", reason = "response_for_voice_pause") {
		clearRealtimeTranscriptionFallback();
		if (!realtimeConnected || realtimeResponseInProgress || !realtimeDataChannel || realtimeDataChannel.readyState !== "open") return false;
		const audioItemId = String(itemId || "").trim();
		if (audioItemId) realtimeAudioFallbackItemIds.add(audioItemId);
		const voiceTurn = beginRealtimeVoiceTurn("realtime_response", "Voice question");
		voiceTurn.audioItemId = audioItemId;
		updateRealtimeAnswerForTurn(voiceTurn, {
			markdown: "",
			status: "Thinking",
			pending: true,
			published: false,
		});
		setRealtimeStatus("Thinking...");
		requestRealtimeResponse(reason);
		return true;
	}

	function scheduleRealtimeTranscriptionFallbackResponse(itemId = "") {
		if (!realtimeConnected || realtimeResponseInProgress || !realtimeDataChannel || realtimeDataChannel.readyState !== "open") return;
		clearRealtimeTranscriptionFallback();
		realtimePendingTranscriptionItemId = String(itemId || "").trim();
		realtimeTranscriptionFallbackTimer = setTimeout(() => {
			const fallbackItemId = realtimePendingTranscriptionItemId;
			startRealtimeAudioResponseFallback(fallbackItemId, "response_for_voice_pause");
		}, REALTIME_TRANSCRIPTION_FALLBACK_MS);
	}

	function noteRealtimeTranscriptHandledByAudioFallback(itemId, transcript) {
		const audioItemId = String(itemId || "").trim();
		if (!audioItemId || !realtimeAudioFallbackItemIds.has(audioItemId)) return false;
		const text = String(transcript || "").trim();
		if (text && realtimeActiveVoiceTurn?.audioItemId === audioItemId) {
			realtimeActiveVoiceTurn.prompt = text;
			updateRealtimeAnswerForTurn(realtimeActiveVoiceTurn, {});
		}
		return true;
	}

	async function processRealtimeVoiceTranscript(transcript) {
		const text = String(transcript || "").replace(/\s+/g, " ").trim();
		if (!text) return false;
		if (shouldRouteRealtimePromptThroughSocraticEvaluation(text)) {
			await startRealtimeSocraticEvaluation(text, beginRealtimeVoiceTurn("socratic_evaluation", text));
		} else if (shouldRouteRealtimePromptThroughSocraticPlan(text)) {
			await startRealtimeSocraticPlan(text, beginRealtimeVoiceTurn("socratic_plan", text));
		} else if (shouldRouteRealtimePromptThroughOnhand(text)) {
			await startRealtimeDirectAnswer(text, beginRealtimeVoiceTurn("direct_answer", text));
		} else {
			const voiceTurn = beginRealtimeVoiceTurn("realtime_response", text);
			updateRealtimeAnswerForTurn(voiceTurn, {
				markdown: "",
				status: "Thinking",
				pending: true,
				published: false,
			});
			sendRealtimeSessionUpdate();
			requestRealtimeResponse("response_for_voice_transcript");
			setRealtimeStatus("Thinking...");
		}
		return true;
	}

	async function flushRealtimePendingTranscript() {
		pauseRealtimePendingTranscriptFlush();
		const transcript = realtimePendingTranscriptSegments.join(" ").replace(/\s+/g, " ").trim();
		realtimePendingTranscriptSegments = [];
		if (!transcript) return false;
		return await processRealtimeVoiceTranscript(transcript);
	}

	function scheduleRealtimePendingTranscriptFlush() {
		pauseRealtimePendingTranscriptFlush();
		realtimePendingTranscriptTimer = setTimeout(() => {
			realtimePendingTranscriptTimer = null;
			void flushRealtimePendingTranscript().catch((error) => {
				setRealtimeStatus("Voice error", error?.message || String(error));
			});
		}, REALTIME_TRANSCRIPT_FINALIZE_DELAY_MS);
	}

	function queueRealtimeVoiceTranscript(transcript) {
		const text = String(transcript || "").trim();
		if (!text) return false;
		realtimePendingTranscriptSegments.push(text);
		setRealtimeStatus("Heard you · waiting for a pause...");
		scheduleRealtimePendingTranscriptFlush();
		return true;
	}

	function scheduleRealtimeVoiceFallbackCommit() {
		if (!realtimeConnected || realtimeResponseInProgress || realtimeManualVoiceCommitPending) return;
		const serverVadElapsed = realtimeServerSpeechSeenAt ? Date.now() - realtimeServerSpeechSeenAt : Number.POSITIVE_INFINITY;
		const serverVadGraceDelay = Number.isFinite(serverVadElapsed) ? Math.max(0, REALTIME_SERVER_VAD_GRACE_MS - serverVadElapsed) : 0;
		if (realtimeVoiceFallbackTimer) clearTimeout(realtimeVoiceFallbackTimer);
		realtimeVoiceFallbackTimer = setTimeout(() => {
			realtimeVoiceFallbackTimer = null;
			commitRealtimeVoiceFallback();
		}, 650 + serverVadGraceDelay);
	}

	function commitRealtimeVoiceFallback() {
		if (!realtimeConnected || realtimeResponseInProgress || !realtimeDataChannel || realtimeDataChannel.readyState !== "open") return false;
		if (realtimeServerSpeechSeenAt && Date.now() - realtimeServerSpeechSeenAt <= REALTIME_SERVER_VAD_GRACE_MS) {
			scheduleRealtimeVoiceFallbackCommit();
			return false;
		}
		try {
			realtimeManualVoiceCommitPending = true;
			setRealtimeStatus("Submitting voice...");
			sendRealtimeEvent({
				event_id: realtimeEventId("onhand_voice_commit"),
				type: "input_audio_buffer.commit",
			});
			realtimeManualVoiceResponseTimer = setTimeout(() => {
				realtimeManualVoiceResponseTimer = null;
				if (!realtimeManualVoiceCommitPending || realtimeResponseInProgress) return;
				realtimeManualVoiceCommitPending = false;
				requestRealtimeResponse("response_for_voice_pause");
			}, 900);
			return true;
		} catch (error) {
			realtimeManualVoiceCommitPending = false;
			setRealtimeStatus("Voice error", error?.message || String(error));
			return false;
		}
	}

	function formatRealtimeMicLevel(rms) {
		return String(Math.min(99, Math.max(0, Math.round(Number(rms || 0) * 1000))));
	}

	function realtimeLocalSpeechThreshold() {
		const noiseFloor = Number(realtimeMicNoiseFloorRms || 0);
		const dynamicThreshold = noiseFloor > 0 ? noiseFloor * REALTIME_LOCAL_SPEECH_NOISE_MULTIPLIER : REALTIME_LOCAL_SPEECH_RMS;
		return Math.max(REALTIME_LOCAL_SPEECH_MIN_RMS, Math.min(REALTIME_LOCAL_SPEECH_RMS, dynamicThreshold));
	}

	function describeRealtimeMicTrack(track) {
		if (!track) return "";
		const settings = typeof track.getSettings === "function" ? track.getSettings() || {} : {};
		const details = [
			track.label ? `Track: ${track.label}` : "",
			track.readyState ? `State: ${track.readyState}` : "",
			track.muted ? "Muted" : "",
			settings.sampleRate ? `Rate: ${settings.sampleRate}` : "",
			settings.channelCount ? `Channels: ${settings.channelCount}` : "",
			settings.echoCancellation === false ? "Echo cancellation off" : "",
			settings.noiseSuppression === false ? "Noise suppression off" : "",
			settings.autoGainControl === false ? "Auto gain off" : "",
		].filter(Boolean);
		return details.join(" · ");
	}

	function canUpdateRealtimeMicIdleStatus() {
		return (
			realtimeConnected &&
			!realtimeError &&
			!realtimeResponseInProgress &&
			/^(Voice ready|Mic idle|Mic silent|Mic level|Mic active|Chrome mic silent|Mic monitor suspended|Mic monitor unavailable|Mic monitor failed)/i.test(
				realtimeStatus,
			)
		);
	}

	function startRealtimeMicMonitor(stream) {
		stopRealtimeMicMonitor();
		const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
		if (!AudioContextCtor) {
			setRealtimeStatus("Mic monitor unavailable");
			return;
		}
		try {
			const context = new AudioContextCtor();
			const analyser = context.createAnalyser();
			analyser.fftSize = 1024;
			realtimeMicMonitorSource = context.createMediaStreamSource(stream);
			realtimeMicMonitorSource.connect(analyser);
			realtimeMicMonitorAnalyser = analyser;
			const samples = new Uint8Array(analyser.fftSize);
			let loudFrames = 0;
			let quietFrames = 0;
			realtimeMicMonitorStartedAt = Date.now();
			realtimeMicMonitorFrames = 0;
			realtimeMicNoiseFloorRms = 0;
			realtimeAudioContext = context;
			void context.resume().catch(() => {});
			realtimeMicMonitorTimer = setInterval(() => {
				if (!realtimeConnected || realtimeResponseInProgress) return;
				if (context.state === "suspended") {
					void context.resume().catch(() => {});
					if (Date.now() - realtimeMicMonitorStartedAt > 3000 && canUpdateRealtimeMicIdleStatus()) {
						setRealtimeStatus("Mic monitor suspended · click Voice again");
					}
				}
				analyser.getByteTimeDomainData(samples);
				realtimeMicMonitorFrames += 1;
				let sum = 0;
				for (const sample of samples) {
					const centered = (sample - 128) / 128;
					sum += centered * centered;
				}
				const rms = Math.sqrt(sum / samples.length);
				realtimeMicCurrentRms = rms;
				realtimeMicPeakRms = Math.max(rms, realtimeMicPeakRms * 0.94);
				if (!realtimeLocalSpeechActive) {
					realtimeMicNoiseFloorRms = realtimeMicNoiseFloorRms ? realtimeMicNoiseFloorRms * 0.96 + rms * 0.04 : rms;
				}
				if (rms > realtimeLocalSpeechThreshold()) {
					loudFrames += 1;
					quietFrames = 0;
					if (realtimeVoiceFallbackTimer) {
						clearTimeout(realtimeVoiceFallbackTimer);
						realtimeVoiceFallbackTimer = null;
					}
					if (loudFrames >= 2 && !realtimeLocalSpeechActive) {
						realtimeLocalSpeechActive = true;
						if (Date.now() - realtimeServerSpeechSeenAt > REALTIME_SERVER_VAD_GRACE_MS) {
							setRealtimeStatus(`Mic hears you · level ${formatRealtimeMicLevel(realtimeMicPeakRms)}`);
						}
					}
					return;
				}
				if (!realtimeLocalSpeechActive && canUpdateRealtimeMicIdleStatus() && Date.now() - realtimeMicLastIdleStatusAt > REALTIME_MIC_IDLE_STATUS_MS) {
					realtimeMicLastIdleStatusAt = Date.now();
					const level = formatRealtimeMicLevel(realtimeMicPeakRms);
					if (Date.now() - realtimeMicMonitorStartedAt > REALTIME_MIC_SILENCE_DIAGNOSTIC_MS && level === "0") {
						setRealtimeStatus("Chrome mic silent · choose input");
					} else {
						setRealtimeStatus(level === "0" ? "Voice ready · mic silent" : `Voice ready · mic level ${level}`);
					}
				}
				if (!realtimeLocalSpeechActive) return;
				quietFrames += 1;
				if (quietFrames >= 7) {
					realtimeLocalSpeechActive = false;
					loudFrames = 0;
					quietFrames = 0;
					setRealtimeStatus("Mic heard a pause · waiting for API");
					scheduleRealtimeVoiceFallbackCommit();
					if (Date.now() - realtimeServerSpeechSeenAt <= REALTIME_SERVER_VAD_GRACE_MS) {
						realtimeMicLastIdleStatusAt = Date.now();
					}
				}
			}, 100);
		} catch {
			setRealtimeStatus("Mic monitor failed");
		}
	}

	function renderRealtimeControls() {
		if (!realtimeVoiceButton || !realtimeStatusEl) return;
		const needsApiKeySetup = Boolean(realtimeError && isRealtimeApiKeySetupError(realtimeError));
		const buttonLabel = realtimeConnecting ? "..." : realtimeConnected ? "End" : needsApiKeySetup ? "Setup" : "Voice";
		realtimeVoiceButton.dataset.state = realtimeConnecting ? "connecting" : realtimeConnected ? "connected" : needsApiKeySetup ? "setup" : "idle";
		const hiddenLabel = realtimeVoiceButton.querySelector(".onhand-sr-only");
		if (hiddenLabel) hiddenLabel.textContent = buttonLabel;
		realtimeVoiceButton.title = realtimeConnected
			? "End realtime voice tutor"
			: needsApiKeySetup
				? "Open Onhand options to add an OpenAI platform API key for Voice."
				: "Start realtime voice tutor.";
		realtimeVoiceButton.setAttribute("aria-label", realtimeVoiceButton.title);
		realtimeVoiceButton.classList.toggle("connecting", realtimeConnecting);
		realtimeVoiceButton.classList.toggle("on", realtimeConnected);
		realtimeVoiceButton.classList.toggle("error", Boolean(realtimeError));
		realtimeVoiceButton.disabled = realtimeConnecting;
		realtimeStatusEl.textContent = realtimeError || realtimeStatus;
		realtimeStatusEl.setAttribute("aria-expanded", realtimeErrorExpanded && realtimeError ? "true" : "false");
		realtimeStatusEl.setAttribute("aria-controls", "realtimeErrorBubble");
		realtimeStatusEl.tabIndex = realtimeError ? 0 : -1;
		const micLabel = realtimeActiveMicLabel || getRealtimeMicDeviceLabel(realtimeMicDeviceId);
		const micDiagnostics =
			realtimeConnected || realtimeConnecting
				? `Level: ${formatRealtimeMicLevel(realtimeMicCurrentRms)} · peak ${formatRealtimeMicLevel(realtimeMicPeakRms)} · threshold ${formatRealtimeMicLevel(
						realtimeLocalSpeechThreshold(),
					)}`
				: "";
		realtimeStatusEl.title = [realtimeError || realtimeStatus, micLabel ? `Mic: ${micLabel}` : "", micDiagnostics, realtimeMicTrackDetails]
			.filter(Boolean)
			.join("\n");
		realtimeStatusEl.classList.toggle("error", Boolean(realtimeError));
		if (realtimeErrorBubble instanceof HTMLElement && realtimeErrorText instanceof HTMLElement) {
			realtimeErrorBubble.hidden = !(realtimeError && realtimeErrorExpanded);
			realtimeErrorText.textContent = realtimeError || "";
		}
		if (realtimeErrorOptionsButton instanceof HTMLElement) {
			realtimeErrorOptionsButton.hidden = !(realtimeError && isRealtimeApiKeySetupError(realtimeError));
		}
		renderRealtimeMicDeviceSelect();
	}

	async function openRealtimeMicPermissionPage() {
		const url = chrome.runtime.getURL("mic-permission.html");
		if (typeof realtimeMicPermissionTabId === "number") {
			try {
				await chrome.tabs.update(realtimeMicPermissionTabId, { active: true });
				return;
			} catch {
				realtimeMicPermissionTabId = null;
			}
		}
		const tab = await chrome.tabs.create({ url, active: true });
		realtimeMicPermissionTabId = tab?.id ?? null;
	}

	function realtimeEventId(prefix) {
		const suffix = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
		return `${prefix}_${suffix}`;
	}

	function waitForRealtimeIceGathering(peerConnection, timeoutMs = 1200) {
		if (!peerConnection || peerConnection.iceGatheringState === "complete") return Promise.resolve();
		return new Promise((resolve) => {
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				peerConnection.removeEventListener("icegatheringstatechange", onChange);
				resolve();
			};
			const onChange = () => {
				if (peerConnection.iceGatheringState === "complete") finish();
			};
			const timer = setTimeout(finish, timeoutMs);
			peerConnection.addEventListener("icegatheringstatechange", onChange);
		});
	}

	function validateRealtimeSdpOffer(sdp) {
		const text = String(sdp || "");
		const normalized = text.replace(/\r\n/g, "\n");
		if (!normalized.startsWith("v=0")) {
			return `Realtime SDP offer was empty or invalid before session setup (${text.length} chars).`;
		}
		if (!/\nm=audio\s/i.test(normalized)) {
			return `Realtime SDP offer did not include an audio media section (${text.length} chars).`;
		}
		if (!/\nm=application\s/i.test(normalized)) {
			return `Realtime SDP offer did not include the oai-events data channel section (${text.length} chars).`;
		}
		return "";
	}

	function sendRealtimeEvent(event) {
		if (!realtimeDataChannel || realtimeDataChannel.readyState !== "open") {
			throw new Error("Realtime voice is not connected.");
		}
		realtimeDataChannel.send(JSON.stringify(event));
	}

	function requestRealtimeResponse(reason = "response", responseOptions = {}, controlOptions = {}) {
		if (!realtimeDataChannel || realtimeDataChannel.readyState !== "open") return;
		if (realtimeResponseInProgress) {
			realtimeResponseCreateQueued = true;
			realtimeQueuedResponseRequest = {
				reason,
				responseOptions,
				controlOptions,
			};
			setRealtimeStatus("Finishing current response...");
			noteRealtimeActivity();
			return;
		}
		realtimeResponseInProgress = true;
		realtimeResponseCreateQueued = false;
		realtimeQueuedResponseRequest = null;
		realtimeResponseVoiceTurnId =
			controlOptions.trackVoiceTurn === false ? "" : String(controlOptions.voiceTurnId || realtimeActiveVoiceTurn?.id || "");
		realtimeSuppressTranscriptForResponse = Boolean(controlOptions.suppressTranscript);
		realtimeResponseAfterDoneStatus = String(controlOptions.afterDoneStatus || "").trim();
		noteRealtimeActivity();
		sendRealtimeEvent({
			event_id: realtimeEventId(`onhand_${reason}`),
			type: "response.create",
			response: {
				output_modalities: ["audio"],
				...responseOptions,
			},
		});
	}

	function realtimeToolDefinitions() {
		return [
			{
				type: "function",
				name: "check_calendar",
				description: "Check whether a requested tutoring time is available.",
				parameters: {
					type: "object",
					properties: {
						date: { type: "string", description: "Requested date, for example 2026-05-23." },
						time: { type: "string", description: "Requested local time, for example 15:30." },
					},
					required: ["date", "time"],
				},
			},
			{
				type: "function",
				name: "get_current_learning_context",
				description: "Read compact context from the current Onhand page, selection, visible text, and Learning Mode state for lightweight follow-up or clarification. For a user's substantive page question, prefer answer_directly.",
				parameters: {
					type: "object",
					properties: {},
					required: [],
				},
			},
			{
				type: "function",
				name: "annotate_page",
				description: "Highlight exact visible page text and optionally attach short tutor notes. Use this before or alongside page-grounded spoken explanations.",
				parameters: {
					type: "object",
					properties: {
						anchors: {
							type: "array",
							items: {
								type: "object",
								properties: {
									text: { type: "string", description: "Exact visible text to highlight." },
									note: { type: "string", maxLength: 80, description: "Short marginal note to attach to the highlight." },
									label: { type: "string", description: "Short note label." },
									conceptLabel: { type: "string", description: "Reviewable learning concept introduced by this anchor." },
									checkKind: { type: "string", enum: ["prediction", "retrieval"] },
									checkPrompt: { type: "string", maxLength: 180, description: "Optional prediction or retrieval prompt shown as learner state." },
								},
								required: ["text"],
							},
						},
					},
					required: ["anchors"],
				},
			},
			{
				type: "function",
				name: "open_pdf_in_onhand_viewer",
				description:
					"Open the current direct or unsupported PDF tab in Onhand's PDF viewer before reading, highlighting, or tutoring from it. Use when PDF context is unavailable or marked unsupported.",
				parameters: {
					type: "object",
					properties: {},
					required: [],
				},
			},
			{
				type: "function",
				name: "search_pdf",
				description:
					"Search the full extracted text of the current Onhand PDF viewer, including offscreen pages. Use this to find where a term, topic, slide section, or phrase appears in a PDF.",
				parameters: {
					type: "object",
					properties: {
						query: { type: "string", description: "Word or phrase to search for in the PDF." },
						max_matches: { type: "number", description: "Maximum number of matches to return." },
					},
					required: ["query"],
				},
			},
			{
				type: "function",
				name: "read_pdf_pages",
				description: "Read extracted text from specific PDF pages or a page range in the current Onhand PDF viewer.",
				parameters: {
					type: "object",
					properties: {
						pages: { type: "string", description: "Comma-separated PDF page numbers, for example '8,9,10'." },
						page_number: { type: "number", description: "Single PDF page number to read." },
						start_page: { type: "number", description: "First PDF page in a range." },
						end_page: { type: "number", description: "Last PDF page in a range." },
						max_chars: { type: "number", description: "Maximum returned characters." },
					},
					required: [],
				},
			},
			{
				type: "function",
				name: "jump_to_pdf_page",
				description: "Scroll the current Onhand PDF viewer to a PDF page, optionally near exact text on that page.",
				parameters: {
					type: "object",
					properties: {
						page_number: { type: "number", description: "PDF page number to show." },
						text: { type: "string", description: "Exact text on that page to scroll near." },
						occurrence: { type: "number", description: "1-based occurrence of the text on the page." },
					},
					required: ["page_number"],
				},
			},
			{
				type: "function",
				name: "publish_sidebar_answer",
				description: "Publish the concise final answer in the Onhand sidebar while you speak it.",
				parameters: {
					type: "object",
					properties: {
						markdown: { type: "string", description: "Concise sidebar answer in markdown." },
						status: { type: "string", description: "Short status label." },
					},
					required: ["markdown"],
				},
			},
			{
				type: "function",
				name: "answer_directly",
				description: "Start Onhand's gpt-5.5-backed page-grounded answer flow. Use this first for any substantive question about the current page, selection, passage, concept, equation, chart, or document.",
				parameters: {
					type: "object",
					properties: {
						prompt: { type: "string", description: "Prompt to answer with Onhand's page-grounded runtime." },
					},
					required: ["prompt"],
				},
			},
			{
				type: "function",
				name: "plan_pedagogical_move",
				description:
					"Ask Onhand's gpt-5.5-backed planner for one Socratic Learning Mode move. Use for new conceptual page questions when Learning Mode is on. The result has no answer field: it returns an anchor, a short voice prompt, sidebar copy, expected concepts, and fallback nudges.",
				parameters: {
					type: "object",
					properties: {
						user_question: { type: "string", description: "The student's page-grounded conceptual question." },
					},
					required: ["user_question"],
				},
			},
			{
				type: "function",
				name: "evaluate_response",
				description:
					"Ask Onhand's gpt-5.5-backed evaluator to assess the student's answer to the previous Socratic move. Use when Learning Mode has an open voice prompt and the user responds aloud.",
				parameters: {
					type: "object",
					properties: {
						user_response: { type: "string", description: "The student's spoken answer or typed response." },
						previous_move: {
							type: "object",
							description: "The previous plan_pedagogical_move result, including anchor and voice_script.",
							properties: {
								anchor: {
									type: "object",
									properties: {
										text_excerpt: { type: "string", description: "Required page anchor from the previous move." },
									},
									required: ["text_excerpt"],
								},
								voice_script: { type: "string" },
								expected_concepts: { type: "array", items: { type: "string" } },
							},
							required: ["anchor", "voice_script"],
						},
					},
					required: ["user_response", "previous_move"],
				},
			},
		];
	}

	function realtimeTutorInstructions() {
		const learningMode = Boolean(currentState?.preferences?.learningMode);
		return [
			"You are Onhand's realtime voice tutor for a student reading the current browser page.",
			"Answer quickly and pedagogically. Keep spoken answers short enough to follow, usually two to five sentences.",
			"For substantive questions about the page, passage, selection, document, concept, equation, or chart, call answer_directly before answering. Do not answer those questions from realtime context alone.",
			"Use get_current_learning_context only for lightweight orientation or clarification; it is not enough to answer a page-material question.",
			"If the current document is a PDF and context is missing or unsupported, call open_pdf_in_onhand_viewer before tutoring from it. For PDF questions about offscreen content, first use search_pdf to locate likely pages, then read_pdf_pages for the relevant pages, and jump_to_pdf_page when you need to show the student where it is.",
			"Use annotate_page for the key source passage when the answer depends on page content. Prefer one strong highlight and one short note.",
			"Use publish_sidebar_answer whenever you give a substantive answer so the sidebar mirrors the spoken explanation.",
			learningMode
				? "Learning Mode is on: call plan_pedagogical_move for new conceptual page questions, then use annotate_page and speak the returned voice_script. If the student answers a previous Socratic prompt, call evaluate_response."
				: "Learning Mode is off: answer directly, but still ground page-specific claims.",
			"If answer_directly is running, briefly tell the student that Onhand is grounding the answer in the page and that the sidebar will update.",
		].join(" ");
	}

	function realtimeInputAudioConfig() {
		return {
			noise_reduction: { type: "far_field" },
			transcription: { model: "gpt-4o-mini-transcribe" },
			turn_detection: {
				type: "server_vad",
				threshold: 0.35,
				prefix_padding_ms: 300,
				silence_duration_ms: 1300,
				create_response: false,
				interrupt_response: true,
			},
		};
	}

	function sendRealtimeSessionUpdate() {
		sendRealtimeEvent({
			event_id: realtimeEventId("onhand_session_update"),
			type: "session.update",
			session: {
				type: "realtime",
				output_modalities: ["audio"],
				audio: { input: realtimeInputAudioConfig() },
				instructions: realtimeTutorInstructions(),
				tools: realtimeToolDefinitions(),
				tool_choice: "auto",
			},
		});
	}

	async function requestRealtimeContext() {
		const response = await chrome.runtime.sendMessage({
			type: "sidebar:realtime-context",
			windowId: await ensureCurrentWindowId(),
		});
		if (!response?.ok) throw new Error(response?.error || "Could not read current Onhand context.");
		return response.context;
	}

	async function createRealtimeSessionAnswer(browserSdp) {
		const sdp = String(browserSdp || "");
		const sdpError = validateRealtimeSdpOffer(sdp);
		if (sdpError) throw new Error(sdpError);
		const errors = [];
		let authMissing = false;
		try {
			const response = await chrome.runtime.sendMessage({
				type: "sidebar:realtime-session",
				sdp,
			});
			if (response?.ok && response.result?.sdp) return response.result.sdp;
			const errorText = realtimeVoiceErrorMessage(response?.error || "Extension auth setup failed.");
			authMissing = /sign in|api key|auth/i.test(errorText);
			errors.push(errorText);
		} catch (error) {
			const errorText = realtimeVoiceErrorMessage(error);
			authMissing = /sign in|api key|auth/i.test(errorText);
			errors.push(errorText);
		}

		if (!authMissing) {
			try {
				const secretResponse = await chrome.runtime.sendMessage({
					type: "sidebar:realtime-client-secret",
				});
				if (!secretResponse?.ok || !secretResponse.result?.value) {
					throw new Error(secretResponse?.error || "Could not create Realtime client secret.");
				}
				const directResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${secretResponse.result.value}`,
						"Content-Type": "application/sdp",
					},
					body: sdp,
				});
				const answerSdp = await directResponse.text();
				if (directResponse.ok) return answerSdp;
				errors.push(answerSdp || `OpenAI direct Realtime call setup failed with ${directResponse.status}.`);
			} catch (error) {
				errors.push(error?.message || String(error));
			}
		}

		try {
			const response = await fetch(REALTIME_SESSION_URL, {
				method: "POST",
				headers: { "Content-Type": "application/sdp" },
				body: sdp,
			});
			const answerSdp = await response.text();
			if (response.ok) return answerSdp;
			errors.push(answerSdp || `Local Realtime session server returned ${response.status}.`);
		} catch (error) {
			errors.push(error?.message || String(error));
		}

		throw new Error(`Could not create Realtime session. ${errors.filter(Boolean).join(" ")}`);
	}

	function updateRealtimeAnswer(partial) {
		realtimeAnswer = {
			...(realtimeAnswer || {}),
			sessionPath: getStateSessionPath(currentState) || realtimeAnswer?.sessionPath || "",
			updatedAt: new Date().toISOString(),
			...partial,
		};
		renderState(currentState || {});
	}

	function hasRealtimePageMaterialContext(state = currentState) {
		const pageUrl = String(state?.page?.url || "").trim();
		const tabUrl = String(state?.tab?.url || "").trim();
		const pageText = String(state?.page?.text || state?.page?.selectedText || state?.page?.selection || "").trim();
		const candidateUrl = pageUrl || tabUrl;
		if (pageText) return true;
		if (!candidateUrl) return false;
		try {
			const protocol = new URL(candidateUrl).protocol;
			return protocol === "http:" || protocol === "https:" || protocol === "chrome-extension:";
		} catch {
			return false;
		}
	}

	function isRealtimeCalendarRequest(prompt) {
		return /\b(calendar|schedule|appointment|available|availability|book|meeting|slot)\b/i.test(String(prompt || ""));
	}

	function shouldRouteRealtimePromptThroughOnhand(prompt, state = currentState) {
		const text = String(prompt || "").trim();
		if (!text) return false;
		if (isRealtimeCalendarRequest(text)) return false;
		if (shouldRouteRealtimePromptThroughSocraticPlan(text, state) || shouldRouteRealtimePromptThroughSocraticEvaluation(text, state)) return false;
		return hasRealtimePageMaterialContext(state);
	}

	function shouldRouteRealtimePromptThroughSocraticPlan(prompt, state = currentState) {
		const text = String(prompt || "").trim();
		if (!text) return false;
		if (!Boolean(state?.preferences?.learningMode)) return false;
		if (isRealtimeCalendarRequest(text)) return false;
		if (!hasRealtimePageMaterialContext(state)) return false;
		return !realtimePendingSocraticMove;
	}

	function looksLikeNewRealtimeQuestion(prompt) {
		const text = String(prompt || "").trim();
		if (!text) return false;
		if (/[?]\s*$/.test(text)) return true;
		return /^(what|why|how|where|when|which|who|can you|could you|would you|explain|tell me|show me)\b/i.test(text);
	}

	function shouldRouteRealtimePromptThroughSocraticEvaluation(prompt, state = currentState) {
		const text = String(prompt || "").trim();
		if (!text || !realtimePendingSocraticMove) return false;
		if (!Boolean(state?.preferences?.learningMode)) return false;
		if (isRealtimeCalendarRequest(text)) return false;
		return !looksLikeNewRealtimeQuestion(text);
	}

	function compactRealtimeTutorText(value, maxLength = 240) {
		const text = String(value || "").replace(/\s+/g, " ").trim();
		return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…` : text;
	}

	function canonicalRealtimeSpeechText(value) {
		return String(value || "")
			.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/?[^>]+>/g, "")
			.replace(/^\s{0,3}#{1,6}\s+/gm, "")
			.replace(/^\s{0,3}>\s?/gm, "")
			.replace(/[*_`~]/g, "")
			.replace(/\s+/g, " ")
			.trim();
	}

	function buildExactRealtimeSpeechPrompt(label, value) {
		const text = canonicalRealtimeSpeechText(value);
		return [
			`Speak this ${label} exactly as written below.`,
			"Do not paraphrase, summarize, add examples, omit clauses, or change the meaning.",
			"Read symbols naturally, but keep the same words as the sidebar text.",
			"Text:",
			text,
		].join("\n\n");
	}

	function buildRealtimeAnnotationPageActions(result) {
		const annotations = Array.isArray(result?.annotations) ? result.annotations : [];
		const actions = [];
		for (const annotation of annotations) {
			if (!annotation || typeof annotation !== "object") continue;
			const tab = annotation.tab && typeof annotation.tab === "object" ? annotation.tab : {};
			const annotationId = String(annotation.annotationId || annotation.noteAnnotationId || "").trim();
			const matchedText = compactRealtimeTutorText(annotation.matchedText || annotation.text, 240);
			const noteText = compactRealtimeTutorText(annotation.note, 240);
			const base = {
				tabId: typeof tab.id === "number" ? tab.id : null,
				windowId: typeof tab.windowId === "number" ? tab.windowId : null,
				title: String(tab.title || "").trim(),
				url: String(tab.url || "").trim(),
			};
			if (matchedText) {
				actions.push({
					key: `highlight:${annotationId || matchedText}`,
					type: "annotation",
					...base,
					annotationId: annotationId || null,
					label: "Highlighted text",
					detail: compactRealtimeTutorText(matchedText, 72),
					citationText: matchedText,
				});
			}
			if (noteText) {
				actions.push({
					key: `note:${annotationId || noteText}`,
					type: "note",
					...base,
					annotationId: annotationId || null,
					label: "Added note",
					detail: compactRealtimeTutorText(noteText, 72),
					citationText: noteText,
				});
			}
		}
		return dedupePageActions(actions);
	}

	function appendRealtimeTurnPageActions(turn, actions) {
		const items = dedupePageActions(actions);
		if (!turn || !items.length) return [];
		turn.pageActions = dedupePageActions([...(Array.isArray(turn.pageActions) ? turn.pageActions : []), ...items]);
		return turn.pageActions;
	}

	function normalizeRealtimePedagogicalMove(value, fallbackPrompt = "") {
		const raw = value?.move && typeof value.move === "object" ? value.move : value && typeof value === "object" ? value : {};
		const rawAnchor = raw.anchor && typeof raw.anchor === "object" ? raw.anchor : {};
		const anchorText = compactRealtimeTutorText(rawAnchor.text_excerpt || rawAnchor.text || raw.text_excerpt || fallbackPrompt, 220);
		const voiceScript =
			compactRealtimeTutorText(raw.voice_script || raw.question || raw.prompt, 220) ||
			"Looking at the highlighted line, what do you think it is saying in your own words?";
		const expectedConcepts = Array.isArray(raw.expected_concepts)
			? raw.expected_concepts.map((entry) => compactRealtimeTutorText(entry, 80)).filter(Boolean).slice(0, 4)
			: [];
		return {
			anchor: {
				text_excerpt: anchorText,
				kind: compactRealtimeTutorText(rawAnchor.kind || "question_anchor", 40) || "question_anchor",
				note: compactRealtimeTutorText(rawAnchor.note || raw.note || "Look here first", 80),
			},
			move_type: compactRealtimeTutorText(raw.move_type || "prediction_prompt", 40) || "prediction_prompt",
			voice_script: voiceScript,
			sidebar_markdown: compactRealtimeTutorText(raw.sidebar_markdown || `**Your turn:** ${voiceScript}`, 360),
			expected_concepts: expectedConcepts.length ? expectedConcepts : ["Page concept"],
			stuck_fallback: compactRealtimeTutorText(raw.stuck_fallback || "Focus on the highlighted wording.", 180),
			misconceptions: Array.isArray(raw.misconceptions) ? raw.misconceptions.slice(0, 3) : [],
		};
	}

	function normalizeRealtimePedagogicalEvaluation(value) {
		const raw = value?.evaluation && typeof value.evaluation === "object" ? value.evaluation : value && typeof value === "object" ? value : {};
		const feedback = compactRealtimeTutorText(raw.feedback_summary || raw.voice_script || raw.sidebar_markdown, 220) || "Good start. Tie that back to the highlighted line.";
		return {
			correct_points: Array.isArray(raw.correct_points) ? raw.correct_points.slice(0, 3) : [],
			missed_points: Array.isArray(raw.missed_points) ? raw.missed_points.slice(0, 3) : [],
			next_move: ["nudge", "deeper", "move_on", "direct_answer_escape"].includes(raw.next_move) ? raw.next_move : "nudge",
			feedback_summary: feedback,
			voice_script: compactRealtimeTutorText(raw.voice_script || feedback, 220),
			sidebar_markdown: compactRealtimeTutorText(raw.sidebar_markdown || feedback, 420),
			assessment: compactRealtimeTutorText(raw.assessment || "partial", 24) || "partial",
			evidence: compactRealtimeTutorText(raw.evidence || feedback, 260),
		};
	}

	function findRealtimeOpenedCheck(learnerState, promptText) {
		const target = compactRealtimeTutorText(promptText, 180).toLowerCase();
		const checks = Array.isArray(learnerState?.openChecks) ? learnerState.openChecks : [];
		if (!checks.length) return null;
		return (
			[...checks]
				.reverse()
				.find((check) => target && compactRealtimeTutorText(check?.promptText, 180).toLowerCase() === target) ||
			checks.at(-1) ||
			null
		);
	}

	function speakRealtimeTutorText(kind, prompt, instructions, controlOptions = {}) {
		if (!realtimeConnected || !realtimeDataChannel || realtimeDataChannel.readyState !== "open") return;
		sendRealtimeEvent({
			event_id: realtimeEventId(`onhand_${kind}`),
			type: "conversation.item.create",
			item: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: prompt }],
			},
		});
		requestRealtimeResponse(
			kind,
			{
				instructions,
				tool_choice: "none",
			},
			controlOptions,
		);
	}

	function realtimeBackendPreambleLine(kind) {
		if (kind === "socratic_plan") return "Let me find the right line first.";
		if (kind === "socratic_evaluation") return "Let me check that against the page.";
		return "Let me ground that in the page.";
	}

	function buildRealtimeBackendPreamblePrompt(kind) {
		const line = realtimeBackendPreambleLine(kind);
		return [
			`Say exactly this sentence, with no extra words: "${line}"`,
			"Do not answer, evaluate, summarize, cite the page, or say whether the student is correct.",
		]
			.filter(Boolean)
			.join("\n");
	}

	function realtimeBackendPreambleStatus(kind) {
		if (kind === "socratic_plan") return "Planning tutor move...";
		if (kind === "socratic_evaluation") return "Checking answer...";
		return "Using Onhand...";
	}

	function scheduleRealtimeBackendPreamble(turn, kind) {
		clearRealtimeBackendPreamble();
		if (!turn || !isRealtimeVoiceTurnCurrent(turn)) return;
		if (!realtimeConnected || !realtimeDataChannel || realtimeDataChannel.readyState !== "open") return;
		realtimeBackendPreambleTimer = setTimeout(() => {
			realtimeBackendPreambleTimer = null;
			if (!isRealtimeVoiceTurnCurrent(turn)) return;
			if (!realtimeConnected || !realtimeDataChannel || realtimeDataChannel.readyState !== "open") return;
			sendRealtimeEvent({
				event_id: realtimeEventId("onhand_backend_preamble"),
				type: "conversation.item.create",
				item: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: buildRealtimeBackendPreamblePrompt(kind) }],
				},
			});
			requestRealtimeResponse(
				"backend_preamble",
				{
					instructions: "Speak only the exact sentence provided. Do not answer, evaluate, call tools, or add page claims.",
					tool_choice: "none",
				},
				{
					trackVoiceTurn: false,
					suppressTranscript: true,
					afterDoneStatus: realtimeBackendPreambleStatus(kind),
				},
			);
			setRealtimeStatus("Starting answer...");
		}, REALTIME_BACKEND_PREAMBLE_DELAY_MS);
	}

	async function requestRealtimePedagogicalMove(prompt, voiceTurn = null) {
		const response = await chrome.runtime.sendMessage({
			type: "sidebar:realtime-plan-pedagogical-move",
			userQuestion: prompt,
			voiceTurnId: voiceTurn?.id || "",
			windowId: await ensureCurrentWindowId(),
		});
		if (!response?.ok) throw new Error(response?.error || "Could not plan a Learning Mode voice move.");
		return normalizeRealtimePedagogicalMove(response.result?.move || response.result, prompt);
	}

	async function requestRealtimePedagogicalEvaluation(userResponse, previousMove, voiceTurn = null) {
		const response = await chrome.runtime.sendMessage({
			type: "sidebar:realtime-evaluate-response",
			userResponse,
			previousMove,
			voiceTurnId: voiceTurn?.id || "",
			windowId: await ensureCurrentWindowId(),
		});
		if (!response?.ok) throw new Error(response?.error || "Could not evaluate the Learning Mode voice response.");
		return normalizeRealtimePedagogicalEvaluation(response.result?.evaluation || response.result);
	}

	async function annotateRealtimePedagogicalMove(move) {
		const anchorText = compactRealtimeTutorText(move?.anchor?.text_excerpt, 220);
		if (!anchorText) return null;
		const response = await chrome.runtime.sendMessage({
			type: "sidebar:realtime-annotate",
			windowId: await ensureCurrentWindowId(),
			anchors: [
				{
					text: anchorText,
					note: compactRealtimeTutorText(move?.anchor?.note || "Look here first", 80),
					label: "Tutor prompt",
					conceptLabel: compactRealtimeTutorText(move?.expected_concepts?.[0] || "Page concept", 80),
					checkKind: move?.move_type === "retrieval_prompt" ? "retrieval" : "prediction",
					checkPrompt: compactRealtimeTutorText(move?.voice_script, 180),
				},
			],
		});
		if (!response?.ok) throw new Error(response?.error || "Could not annotate the Socratic prompt.");
		await requestState();
		const result = response.result || null;
		if (result && typeof result === "object" && !Array.isArray(result.pageActions)) {
			result.pageActions = buildRealtimeAnnotationPageActions(result);
		}
		return result;
	}

	async function recordRealtimePedagogicalEvaluation(evaluation, pendingMove) {
		const checkId = compactRealtimeTutorText(pendingMove?.checkId, 120);
		if (!checkId) return null;
		const response = await chrome.runtime.sendMessage({
			type: "sidebar:realtime-record-learning-event",
			event: {
				kind: "check_resolved",
				checkId,
				assessment: evaluation.assessment,
				evidence: evaluation.evidence || evaluation.feedback_summary,
			},
		});
		if (!response?.ok) throw new Error(response?.error || "Could not update learner state.");
		await requestState();
		return response.result || null;
	}

	async function startRealtimeSocraticPlan(prompt, existingVoiceTurn = null) {
		const text = String(prompt || "").trim();
		if (!text) throw new Error("A Learning Mode voice question is required.");
		const voiceTurn = existingVoiceTurn || beginRealtimeVoiceTurn("socratic_plan", text);
		const voiceTurnId = voiceTurn.id || `voice_turn_${++realtimeSocraticTurnCounter}`;
		realtimePendingDirectAnswerRequestId = "";
		realtimePendingDirectAnswerPrompt = "";
		realtimePendingDirectAnswerVoiceTurnId = "";
		updateRealtimeAnswerForTurn(voiceTurn, {
			markdown: "Planning a page-grounded tutor prompt...",
			status: "Planning",
			pending: true,
			published: true,
		});
		scheduleRealtimeBackendPreamble(voiceTurn, "socratic_plan");
		let move;
		try {
			await ensureRealtimePdfSurfaceForVoice();
			if (!isRealtimeVoiceTurnCurrent(voiceTurn)) return { stale: true, voiceTurnId, responseAlreadyRequested: true };
			setRealtimeStatus("Planning tutor move...");
			move = await requestRealtimePedagogicalMove(text, voiceTurn);
		} finally {
			clearRealtimeBackendPreamble(voiceTurn);
		}
		if (!isRealtimeVoiceTurnCurrent(voiceTurn)) return { stale: true, voiceTurnId, responseAlreadyRequested: true };
		const annotationResult = await annotateRealtimePedagogicalMove(move);
		if (!isRealtimeVoiceTurnCurrent(voiceTurn)) return { stale: true, voiceTurnId, responseAlreadyRequested: true };
		const openedCheck = findRealtimeOpenedCheck(annotationResult?.learnerState, move.voice_script);
		const pageActions = dedupePageActions(Array.isArray(annotationResult?.pageActions) ? annotationResult.pageActions : []);
		appendRealtimeTurnPageActions(voiceTurn, pageActions);
		realtimePendingSocraticMove = {
			voiceTurnId,
			userQuestion: text,
			move,
			checkId: openedCheck?.checkId || "",
			pageActions,
			createdAt: new Date().toISOString(),
		};
		const sidebarText = move.sidebar_markdown || `**Your turn:** ${move.voice_script}`;
		updateRealtimeAnswerForTurn(voiceTurn, {
			markdown: sidebarText,
			status: "Tutor prompt",
			pending: false,
			published: true,
		});
		await persistRealtimeVoiceTurn(voiceTurn, sidebarText, { status: "Tutor prompt", pageActions });
		speakRealtimeTutorText(
			"speak_socratic_prompt",
			buildExactRealtimeSpeechPrompt("Socratic prompt", sidebarText),
			"Speak only the provided text. Do not paraphrase, summarize, add or remove words, answer the prompt, or call tools.",
			{
				trackVoiceTurn: false,
				suppressTranscript: true,
				afterDoneStatus: "Voice ready · ask, then pause",
			},
		);
		setRealtimeStatus("Speaking tutor prompt...");
		return { planned: true, voiceTurnId, move, checkId: openedCheck?.checkId || "", responseAlreadyRequested: true };
	}

	async function startRealtimeSocraticEvaluation(userResponse, existingVoiceTurn = null) {
		const text = String(userResponse || "").trim();
		if (!text) throw new Error("A student response is required.");
		const pendingMove = realtimePendingSocraticMove;
		if (!pendingMove) return await startRealtimeSocraticPlan(text, existingVoiceTurn);
		const voiceTurn = existingVoiceTurn || beginRealtimeVoiceTurn("socratic_evaluation", text);
		updateRealtimeAnswerForTurn(voiceTurn, {
			markdown: "Checking your answer against the page...",
			status: "Checking answer",
			pending: true,
			published: true,
		});
		scheduleRealtimeBackendPreamble(voiceTurn, "socratic_evaluation");
		let evaluation;
		try {
			await ensureRealtimePdfSurfaceForVoice();
			if (!isRealtimeVoiceTurnCurrent(voiceTurn)) return { stale: true, responseAlreadyRequested: true };
			setRealtimeStatus("Checking answer...");
			evaluation = await requestRealtimePedagogicalEvaluation(text, pendingMove.move, voiceTurn);
		} finally {
			clearRealtimeBackendPreamble(voiceTurn);
		}
		if (!isRealtimeVoiceTurnCurrent(voiceTurn)) return { stale: true, responseAlreadyRequested: true };
		await recordRealtimePedagogicalEvaluation(evaluation, pendingMove);
		if (!isRealtimeVoiceTurnCurrent(voiceTurn)) return { stale: true, responseAlreadyRequested: true };
		realtimePendingSocraticMove = null;
		const pageActions = dedupePageActions(Array.isArray(pendingMove.pageActions) ? pendingMove.pageActions : []);
		appendRealtimeTurnPageActions(voiceTurn, pageActions);
		const sidebarText = evaluation.sidebar_markdown || evaluation.feedback_summary;
		updateRealtimeAnswerForTurn(voiceTurn, {
			markdown: sidebarText,
			status: "Tutor feedback",
			pending: false,
			published: true,
		});
		await persistRealtimeVoiceTurn(voiceTurn, sidebarText, { status: "Tutor feedback", pageActions });
		speakRealtimeTutorText(
			"speak_socratic_feedback",
			buildExactRealtimeSpeechPrompt("Learning Mode feedback", sidebarText),
			"Speak only the provided text. Do not paraphrase, summarize, add or remove words, call tools, or add page claims.",
			{
				trackVoiceTurn: false,
				suppressTranscript: true,
				afterDoneStatus: "Voice ready · ask, then pause",
			},
		);
		setRealtimeStatus("Speaking tutor feedback...");
		return { evaluated: true, evaluation, responseAlreadyRequested: true };
	}

	function stripRealtimeVoiceDisplayPrefix(value) {
		return String(value || "").replace(/^\[Voice\]\s*/i, "").trim();
	}

	function findRealtimeDirectAnswerTurn(state, requestId) {
		const id = String(requestId || "").trim();
		if (!id) return null;
		const turns = Array.isArray(state?.turns) ? state.turns : [];
		return turns.find((turn) => turn?.id === id) || null;
	}

	async function startRealtimeDirectAnswer(prompt, existingVoiceTurn = null) {
		const text = String(prompt || "").trim();
		if (!text) throw new Error("answer_directly requires a prompt.");
		const voiceTurn = existingVoiceTurn || beginRealtimeVoiceTurn("direct_answer", text);
		realtimePendingSocraticMove = null;
		updateRealtimeAnswerForTurn(voiceTurn, {
			markdown: "Grounding this with Onhand...",
			status: "Using Onhand",
			pending: true,
			published: true,
		});
		scheduleRealtimeBackendPreamble(voiceTurn, "direct_answer");
		let response;
		try {
			await ensureRealtimePdfSurfaceForVoice();
			if (!isRealtimeVoiceTurnCurrent(voiceTurn)) return { stale: true, responseAlreadyRequested: true };
			setRealtimeStatus("Using Onhand...");
			response = await chrome.runtime.sendMessage({
				type: "sidebar:submit-prompt",
				prompt: text,
				displayPrompt: `[Voice] ${text}`,
				attachments: [],
				learningMode: Boolean(currentState?.preferences?.learningMode),
				source: "realtime-voice-direct-answer",
				windowId: await ensureCurrentWindowId(),
			});
		} finally {
			clearRealtimeBackendPreamble(voiceTurn);
		}
		if (!response?.ok) throw new Error(response?.error || "Could not start Onhand's direct answer flow.");
		if (!isRealtimeVoiceTurnCurrent(voiceTurn)) return { stale: true, requestId: response.requestId || "", responseAlreadyRequested: true };
		realtimePendingDirectAnswerRequestId = String(response.requestId || "");
		realtimePendingDirectAnswerPrompt = text;
		realtimePendingDirectAnswerVoiceTurnId = voiceTurn.id;
		await requestState();
		return { started: true, requestId: response.requestId || "", responseAlreadyRequested: true };
	}

	function maybeSpeakCompletedRealtimeDirectAnswer(state = currentState) {
		const requestId = realtimePendingDirectAnswerRequestId;
		if (!requestId || realtimeNarratedDirectAnswerRequestIds.has(requestId)) return;
		if (realtimePendingDirectAnswerVoiceTurnId && !isRealtimeVoiceTurnCurrent(realtimePendingDirectAnswerVoiceTurnId)) {
			realtimePendingDirectAnswerRequestId = "";
			realtimePendingDirectAnswerPrompt = "";
			realtimePendingDirectAnswerVoiceTurnId = "";
			return;
		}
		const turn = findRealtimeDirectAnswerTurn(state, requestId);
		if (!turn || turn.pending || turn.error || state?.activeRequestId === requestId) return;
		const reply = String(turn.reply || "").trim();
		if (!reply) return;
		realtimeNarratedDirectAnswerRequestIds.add(requestId);
		realtimePendingDirectAnswerRequestId = "";
		realtimePendingDirectAnswerVoiceTurnId = "";
		const prompt = realtimePendingDirectAnswerPrompt || stripRealtimeVoiceDisplayPrefix(turn.userPrompt);
		realtimePendingDirectAnswerPrompt = "";
		updateRealtimeAnswer({
			userPrompt: prompt,
			markdown: reply,
			status: "Onhand answer",
			pending: false,
			published: true,
			sourceTurnId: turn.id || requestId,
			pageActions: Array.isArray(turn.pageActions) ? turn.pageActions : [],
		});
		if (!realtimeConnected || !realtimeDataChannel || realtimeDataChannel.readyState !== "open") return;
		const voicePrompt = buildExactRealtimeSpeechPrompt("Onhand answer", reply);
		try {
			sendRealtimeEvent({
				event_id: realtimeEventId("onhand_direct_answer_ready"),
				type: "conversation.item.create",
				item: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: voicePrompt }],
				},
			});
			requestRealtimeResponse(
				"speak_onhand_answer",
				{
					instructions: "Speak only the provided Onhand answer text. Do not paraphrase, summarize, add or remove words, call tools, or add new page claims.",
					tool_choice: "none",
				},
				{
					trackVoiceTurn: false,
					suppressTranscript: true,
					afterDoneStatus: "Voice ready · ask, then pause",
				},
			);
			setRealtimeStatus("Speaking Onhand answer...");
		} catch (error) {
			setRealtimeStatus("Voice ready · ask, then pause", error?.message || String(error));
		}
	}

	function appendRealtimeTranscript(delta) {
		if (realtimeSuppressTranscriptForResponse) return;
		const text = String(delta || "");
		if (!text) return;
		const activeTurn = realtimeActiveVoiceTurn;
		if (!activeTurn) return;
		realtimeTranscriptBuffer += text;
		updateRealtimeAnswerForTurn(activeTurn, {
			markdown: realtimeTranscriptBuffer,
			status: "Speaking",
			pending: true,
		});
	}

	function noteRealtimeResponseDone() {
		const queuedRequest = realtimeQueuedResponseRequest || (realtimeResponseCreateQueued ? { reason: "queued_response", responseOptions: {}, controlOptions: {} } : null);
		realtimeResponseInProgress = false;
		realtimeResponseAfterDoneStatus = "";
		if (!queuedRequest) return false;
		realtimeResponseCreateQueued = false;
		realtimeQueuedResponseRequest = null;
		queueMicrotask(() => {
			try {
				requestRealtimeResponse(queuedRequest.reason || "queued_response", queuedRequest.responseOptions || {}, queuedRequest.controlOptions || {});
			} catch (error) {
				setRealtimeStatus("Voice error", error?.message || String(error));
			}
		});
		return true;
	}

	function extractRealtimeResponseText(response) {
		const parts = [];
		for (const item of Array.isArray(response?.output) ? response.output : []) {
			for (const content of Array.isArray(item?.content) ? item.content : []) {
				const text = content?.text || content?.transcript || content?.audio_transcript || "";
				if (text) parts.push(text);
			}
		}
		return parts.join("\n").trim();
	}

	function parseRealtimeArguments(value) {
		if (!value) return {};
		if (typeof value === "object") return value;
		try {
			return JSON.parse(String(value));
		} catch {
			return {};
		}
	}

	function collectRealtimeFunctionCalls(event) {
		const calls = [];
		const pushCall = (item) => {
			if (!item || item.type !== "function_call") return;
			const callId = item.call_id || item.callId || item.id || "";
			if (!callId || realtimeHandledCallIds.has(callId)) return;
			calls.push({
				callId,
				name: item.name || "",
				arguments: item.arguments || "{}",
			});
		};
		if (event?.type === "response.function_call_arguments.done" && event.name) {
			pushCall({
				type: "function_call",
				call_id: event.call_id,
				name: event.name,
				arguments: event.arguments,
			});
		}
		pushCall(event?.item);
		for (const item of Array.isArray(event?.response?.output) ? event.response.output : []) {
			pushCall(item);
		}
		return calls;
	}

	async function executeRealtimeTool(name, args) {
		switch (name) {
			case "check_calendar": {
				const date = String(args?.date || "").trim();
				const time = String(args?.time || "").trim();
				const unavailable = /^(12:00|15:00|3:00)/.test(time);
				return {
					date,
					time,
					available: Boolean(date && time && !unavailable),
					message: unavailable ? "That tutoring slot is already booked." : "That tutoring slot is available.",
				};
			}
			case "get_current_learning_context":
				return await requestRealtimeContext();
			case "annotate_page": {
				const response = await chrome.runtime.sendMessage({
					type: "sidebar:realtime-annotate",
					windowId: await ensureCurrentWindowId(),
					anchors: Array.isArray(args?.anchors) ? args.anchors : [],
				});
				if (!response?.ok) throw new Error(response?.error || "Could not annotate the page.");
				await requestState();
				const result = response.result || {};
				const pageActions = Array.isArray(result.pageActions) ? result.pageActions : buildRealtimeAnnotationPageActions(result);
				const activeTurn = realtimeActiveVoiceTurn;
				if (activeTurn) {
					appendRealtimeTurnPageActions(activeTurn, pageActions);
					updateRealtimeAnswerForTurn(activeTurn, { pageActions: activeTurn.pageActions });
				}
				return {
					...result,
					pageActions,
				};
			}
			case "open_pdf_in_onhand_viewer": {
				const result = await ensureRealtimePdfSurfaceForVoice();
				return {
					opened: Boolean(result?.opened),
					result: result?.result || null,
				};
			}
			case "search_pdf": {
				const response = await chrome.runtime.sendMessage({
					type: "sidebar:realtime-pdf-tool",
					windowId: await ensureCurrentWindowId(),
					tool: "pdf_search",
					args: {
						query: String(args?.query || "").trim(),
						maxMatches: Number.isFinite(Number(args?.max_matches)) ? Number(args.max_matches) : undefined,
					},
				});
				if (!response?.ok) throw new Error(response?.error || "Could not search the PDF.");
				return response.result || {};
			}
			case "read_pdf_pages": {
				const response = await chrome.runtime.sendMessage({
					type: "sidebar:realtime-pdf-tool",
					windowId: await ensureCurrentWindowId(),
					tool: "pdf_read_pages",
					args: {
						pages: args?.pages,
						pageNumber: Number.isFinite(Number(args?.page_number)) ? Number(args.page_number) : undefined,
						startPage: Number.isFinite(Number(args?.start_page)) ? Number(args.start_page) : undefined,
						endPage: Number.isFinite(Number(args?.end_page)) ? Number(args.end_page) : undefined,
						maxChars: Number.isFinite(Number(args?.max_chars)) ? Number(args.max_chars) : undefined,
					},
				});
				if (!response?.ok) throw new Error(response?.error || "Could not read PDF pages.");
				return response.result || {};
			}
			case "jump_to_pdf_page": {
				const response = await chrome.runtime.sendMessage({
					type: "sidebar:realtime-pdf-tool",
					windowId: await ensureCurrentWindowId(),
					tool: "pdf_jump_to_page",
					args: {
						pageNumber: Number(args?.page_number),
						text: typeof args?.text === "string" ? args.text : undefined,
						occurrence: Number.isFinite(Number(args?.occurrence)) ? Number(args.occurrence) : undefined,
					},
				});
				if (!response?.ok) throw new Error(response?.error || "Could not move to the PDF page.");
				return response.result || {};
			}
			case "publish_sidebar_answer": {
				const activeTurn = realtimeActiveVoiceTurn;
				updateRealtimeAnswerForTurn(activeTurn, {
					markdown: String(args?.markdown || "").trim(),
					status: String(args?.status || "Voice answer").trim(),
					pending: false,
					published: true,
					pageActions: Array.isArray(activeTurn?.pageActions) ? activeTurn.pageActions : [],
				});
				if (activeTurn?.kind === "realtime_response") {
					await persistRealtimeVoiceTurn(activeTurn, args?.markdown || "", {
						status: args?.status || "Voice answer",
						pageActions: activeTurn.pageActions,
					});
				}
				return { published: true };
			}
			case "answer_directly": {
				return await startRealtimeDirectAnswer(args?.prompt);
			}
			case "plan_pedagogical_move": {
				return await startRealtimeSocraticPlan(args?.user_question || args?.userQuestion || args?.prompt);
			}
			case "evaluate_response": {
				return await startRealtimeSocraticEvaluation(args?.user_response || args?.userResponse || args?.response);
			}
			default:
				throw new Error(`Unknown realtime tool: ${name || "(blank)"}`);
		}
	}

	async function handleRealtimeFunctionCall(call) {
		realtimeHandledCallIds.add(call.callId);
		let output = null;
		try {
			output = await executeRealtimeTool(call.name, parseRealtimeArguments(call.arguments));
			sendRealtimeEvent({
				event_id: realtimeEventId("onhand_tool_result"),
				type: "conversation.item.create",
				item: {
					type: "function_call_output",
					call_id: call.callId,
					output: JSON.stringify(output),
				},
			});
		} catch (error) {
			sendRealtimeEvent({
				event_id: realtimeEventId("onhand_tool_error"),
				type: "conversation.item.create",
				item: {
					type: "function_call_output",
					call_id: call.callId,
					output: JSON.stringify({ error: error?.message || String(error) }),
				},
			});
		}
		if (!output?.responseAlreadyRequested) requestRealtimeResponse("response_after_tool");
	}

	async function handleRealtimeServerEvent(rawEvent) {
		let event;
		try {
			event = JSON.parse(rawEvent?.data || rawEvent);
		} catch {
			return;
		}
		noteRealtimeActivity();

		if (event.type === "error") {
			const message = event.error?.message || event.message || "Realtime API error";
			if (/active response in progress/i.test(message)) {
				realtimeResponseCreateQueued = true;
				setRealtimeStatus("Waiting for response to finish...");
				return;
			}
			if (/input audio buffer.*empty|buffer is empty/i.test(message)) {
				clearRealtimeVoiceFallback();
				setRealtimeStatus("OpenAI received no mic audio");
				return;
			}
			stopRealtimeVoice();
			setRealtimeStatus("Voice error", message);
			return;
		}
		if (event.type === "session.updated") {
			setRealtimeReadyStatus();
			return;
		}
		if (event.type === "input_audio_buffer.speech_started") {
			clearRealtimeVoiceFallback();
			pauseRealtimePendingTranscriptFlush();
			realtimeServerSpeechSeenAt = Date.now();
			if (realtimeActiveVoiceTurn) markRealtimeVoiceTurnStale("user_interrupted");
			setRealtimeStatus("Listening...");
			return;
		}
		if (event.type === "input_audio_buffer.speech_stopped") {
			clearRealtimeVoiceFallback();
			realtimeServerSpeechSeenAt = Date.now();
			setRealtimeStatus("Transcribing...");
			scheduleRealtimeTranscriptionFallbackResponse(event.item_id);
			return;
		}
		if (event.type === "input_audio_buffer.committed") {
			clearRealtimeVoiceFallback();
			realtimeServerSpeechSeenAt = Date.now();
			setRealtimeStatus("Transcribing...");
			scheduleRealtimeTranscriptionFallbackResponse(event.item_id);
			return;
		}
		if (event.type === "conversation.item.input_audio_transcription.failed") {
			if (startRealtimeAudioResponseFallback(event.item_id, "response_after_transcription_failed")) {
				setRealtimeStatus("Thinking from audio...");
			} else {
				setRealtimeReadyStatus();
			}
			return;
		}
		if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript) {
			const transcript = String(event.transcript || "").trim();
			if (noteRealtimeTranscriptHandledByAudioFallback(event.item_id, transcript)) return;
			clearRealtimeTranscriptionFallback();
			queueRealtimeVoiceTranscript(transcript);
			return;
		}
		if (event.type === "response.created") {
			clearRealtimeVoiceFallback();
			realtimeResponseInProgress = true;
			realtimeTranscriptBuffer = "";
			setRealtimeStatus("Thinking...");
			return;
		}
		if (event.type === "response.output_audio.delta" || event.type === "response.audio.delta") {
			setRealtimeStatus("Speaking...");
			return;
		}
		if (
			event.type === "response.output_audio_transcript.delta" ||
			event.type === "response.audio_transcript.delta" ||
			event.type === "response.text.delta" ||
			event.type === "response.output_text.delta"
		) {
			appendRealtimeTranscript(event.delta || event.text || "");
			return;
		}
		if (
			(event.type === "response.output_audio_transcript.done" || event.type === "response.audio_transcript.done") &&
			event.transcript &&
			!realtimeSuppressTranscriptForResponse
		) {
			updateRealtimeAnswer({ markdown: event.transcript, status: "Voice answer", pending: false });
		}

		for (const call of collectRealtimeFunctionCalls(event)) {
			await handleRealtimeFunctionCall(call);
		}

		if (event.type === "response.done") {
			const text = extractRealtimeResponseText(event.response);
			const responseVoiceTurnId = realtimeResponseVoiceTurnId;
			const responseAfterDoneStatus = realtimeResponseAfterDoneStatus;
			const activeTurn = responseVoiceTurnId && isRealtimeVoiceTurnCurrent(responseVoiceTurnId) ? realtimeActiveVoiceTurn : null;
			const continuingAfterTool = noteRealtimeResponseDone();
			if (text && !realtimeAnswer?.published && activeTurn) {
				updateRealtimeAnswerForTurn(activeTurn, { markdown: text, status: "Voice answer", pending: false });
			} else if (continuingAfterTool && realtimeAnswer?.pending && activeTurn) {
				updateRealtimeAnswerForTurn(activeTurn, { status: "Using page context...", pending: true });
			} else if (realtimeAnswer?.pending && activeTurn) {
				updateRealtimeAnswerForTurn(activeTurn, { pending: false });
			}
			if (activeTurn?.kind === "realtime_response" && !continuingAfterTool) {
				const finalText = text || realtimeAnswer?.markdown || realtimeTranscriptBuffer;
				await persistRealtimeVoiceTurn(activeTurn, finalText, { status: "Voice answer" });
			}
			if (activeTurn?.audioItemId) realtimeAudioFallbackItemIds.delete(activeTurn.audioItemId);
			if (!continuingAfterTool) realtimeResponseVoiceTurnId = "";
			if (!continuingAfterTool && !activeTurn && realtimeActiveVoiceTurn) {
				if (responseAfterDoneStatus) setRealtimeStatus(responseAfterDoneStatus);
				return;
			}
			if (continuingAfterTool) setRealtimeStatus("Using page context...");
			else setRealtimeReadyStatus();
		}
	}

	async function startRealtimeVoice() {
		if (realtimeConnecting || realtimeConnected) return;
		realtimeConnecting = true;
		realtimeError = "";
		realtimeTranscriptBuffer = "";
		renderRealtimeControls();
		try {
			await ensureRealtimePdfSurfaceForVoice();
			realtimeMediaStream = await createRealtimeInputMediaStream();
			const audioTracks = realtimeMediaStream.getAudioTracks();
			if (!audioTracks.length) {
				throw new Error("Chrome granted microphone access but returned no audio track.");
			}
			realtimeActiveMicLabel = String(audioTracks[0]?.label || getRealtimeMicDeviceLabel(realtimeMicDeviceId) || "").trim();
			realtimeMicTrackDetails = describeRealtimeMicTrack(audioTracks[0]);
			void refreshRealtimeMicDevices();
			startRealtimeMicMonitor(realtimeMediaStream);

			const pc = new RTCPeerConnection();
			const dc = pc.createDataChannel("oai-events");
			const audio = new Audio();
			audio.autoplay = true;
			realtimePeerConnection = pc;
			realtimeDataChannel = dc;
			realtimeAudio = audio;

			pc.ontrack = (event) => {
				audio.srcObject = event.streams[0];
				void audio.play().catch((playError) => {
					setRealtimeStatus("Audio playback blocked", playError?.message || "Click Voice again to enable audio playback.");
				});
			};
			pc.onconnectionstatechange = () => {
				if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
					setRealtimeStatus("Voice disconnected", "Realtime connection ended.");
				}
			};
			dc.onopen = () => {
				realtimeConnecting = false;
				realtimeConnected = true;
				setRealtimeStatus("Voice ready");
				scheduleRealtimeIdleTimeout();
				try {
					sendRealtimeSessionUpdate();
				} catch (error) {
					setRealtimeStatus("Voice error", error?.message || String(error));
				}
			};
			dc.onclose = () => {
				realtimeConnected = false;
				if (!realtimeConnecting && !realtimeError) setRealtimeStatus("Voice idle");
			};
			dc.onmessage = (event) => {
				void handleRealtimeServerEvent(event).catch((error) => setRealtimeStatus("Voice error", error?.message || String(error)));
			};

			for (const track of audioTracks) {
				track.onmute = () => setRealtimeStatus("Mic muted");
				track.onunmute = () => {
					if (realtimeConnected) setRealtimeReadyStatus();
					else setRealtimeStatus("Mic unmuted");
				};
				track.onended = () => {
					if (realtimeConnected) setRealtimeStatus("Mic ended", "Chrome ended the microphone track.");
				};
				pc.addTrack(track, realtimeMediaStream);
			}

			await pc.setLocalDescription(await pc.createOffer());
			await waitForRealtimeIceGathering(pc);
			const offerSdp = pc.localDescription?.sdp || "";
			const answerSdp = await createRealtimeSessionAnswer(offerSdp);
			await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
			setRealtimeStatus("Connecting...");
		} catch (error) {
			stopRealtimeVoice();
			realtimeConnecting = false;
			if (isRealtimeMicrophonePermissionError(error)) {
				realtimeRestartAfterMicPermission = true;
				try {
					await openRealtimeMicPermissionPage();
				} catch {}
				setRealtimeStatus("Mic permission needed", realtimeMicrophoneErrorMessage(error));
				return;
			}
			const errorMessage = realtimeVoiceErrorMessage(error);
			setRealtimeStatus(isRealtimeApiKeySetupError(errorMessage) ? "Voice setup needed" : "Voice error", errorMessage);
		}
	}

	function stopRealtimeVoice(status = "Voice idle") {
		clearRealtimeIdleTimeout();
		stopRealtimeMicMonitor();
		try {
			realtimeDataChannel?.close();
		} catch {}
		try {
			realtimePeerConnection?.close();
		} catch {}
		try {
			for (const track of realtimeMediaStream?.getTracks?.() || []) track.stop();
		} catch {}
		if (realtimeAudio) {
			realtimeAudio.pause();
			realtimeAudio.srcObject = null;
		}
		realtimePeerConnection = null;
		realtimeDataChannel = null;
		realtimeMediaStream = null;
		realtimeAudio = null;
		realtimeMicTrackDetails = "";
		realtimeConnecting = false;
		realtimeConnected = false;
		realtimeHandledCallIds.clear();
		realtimeRestartAfterMicPermission = false;
		realtimeResponseInProgress = false;
		realtimeResponseCreateQueued = false;
		realtimeQueuedResponseRequest = null;
		realtimeResponseVoiceTurnId = "";
		realtimeSuppressTranscriptForResponse = false;
		realtimeResponseAfterDoneStatus = "";
		realtimeServerSpeechSeenAt = 0;
		realtimePendingDirectAnswerRequestId = "";
		realtimePendingDirectAnswerPrompt = "";
		realtimePendingDirectAnswerVoiceTurnId = "";
		realtimePendingSocraticMove = null;
		realtimeActiveVoiceTurn = null;
		realtimePendingTranscriptionItemId = "";
		realtimeAudioFallbackItemIds.clear();
		setRealtimeStatus(status);
	}

	async function sendRealtimeTextPrompt(prompt) {
		if (!realtimeConnected || !realtimeDataChannel || realtimeDataChannel.readyState !== "open") {
			throw new Error("Start Voice before sending a voice-chat message.");
		}
		const text = String(prompt || "").trim();
		if (!text) return;
		if (shouldRouteRealtimePromptThroughSocraticEvaluation(text)) {
			await startRealtimeSocraticEvaluation(text, beginRealtimeVoiceTurn("socratic_evaluation", text));
			return;
		}
		if (shouldRouteRealtimePromptThroughSocraticPlan(text)) {
			await startRealtimeSocraticPlan(text, beginRealtimeVoiceTurn("socratic_plan", text));
			return;
		}
		if (shouldRouteRealtimePromptThroughOnhand(text)) {
			await startRealtimeDirectAnswer(text, beginRealtimeVoiceTurn("direct_answer", text));
			return;
		}
		noteRealtimeActivity();
		const voiceTurn = beginRealtimeVoiceTurn("realtime_response", text);
		updateRealtimeAnswerForTurn(voiceTurn, {
			markdown: "",
			status: "Thinking",
			pending: true,
			published: false,
		});
		sendRealtimeSessionUpdate();
		sendRealtimeEvent({
			event_id: realtimeEventId("onhand_user_text"),
			type: "conversation.item.create",
			item: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text }],
			},
		});
		requestRealtimeResponse("response_for_text");
		setRealtimeStatus("Thinking...");
	}

	function setMenuOpen(nextOpen) {
		menuPanel.hidden = !nextOpen;
		menuButton.setAttribute("aria-expanded", nextOpen ? "true" : "false");
	}

	function eventTargetsMenu(event) {
		const path = typeof event.composedPath === "function" ? event.composedPath() : [];
		if (path.includes(menuPanel) || path.includes(menuButton)) return true;
		const target = event.target instanceof Element ? event.target : null;
		return Boolean(target?.closest?.("#menuPanel, #menuButton"));
	}

	function isQuickOpenRequestCurrent(request, windowId) {
		if (!request || typeof request !== "object") return false;
		if (typeof request.windowId === "number" && typeof windowId === "number" && request.windowId !== windowId) return false;
		const createdAt = Number(request.createdAt) || 0;
		return !createdAt || Date.now() - createdAt <= SIDEBAR_QUICK_OPEN_MAX_AGE_MS;
	}

	function isQuickOpenRequestStale(request) {
		const createdAt = Number(request?.createdAt) || 0;
		return Boolean(createdAt && Date.now() - createdAt > SIDEBAR_QUICK_OPEN_MAX_AGE_MS);
	}

	async function clearQuickOpenRequest(request) {
		try {
			const stored = await chrome.storage.local.get({ [SIDEBAR_QUICK_OPEN_REQUEST_KEY]: null });
			const pending = stored?.[SIDEBAR_QUICK_OPEN_REQUEST_KEY];
			if (pending?.id && request?.id && pending.id !== request.id) return;
			await chrome.storage.local.remove(SIDEBAR_QUICK_OPEN_REQUEST_KEY);
		} catch {
			// Best-effort cleanup only; focus should still work if storage cleanup fails.
		}
	}

	function focusQuickAskComposer({ ensureOpen = false } = {}) {
		if (ensureOpen) setOpen(true);
		setMenuOpen(false);
		if (input instanceof HTMLTextAreaElement) {
			const isJsdom = /jsdom/i.test(String(globalThis.navigator?.userAgent || ""));
			if (!isJsdom) {
				try {
					globalThis.focus();
				} catch {
					// Some embedded browser surfaces do not expose window focus.
				}
			}
			try {
				input.click();
			} catch {
				// Click is only used to mirror a user-targeted focus; focus below is authoritative.
			}
			input.focus({ preventScroll: true });
			const insertionPoint = input.value.length;
			try {
				input.setSelectionRange(insertionPoint, insertionPoint);
			} catch {
				// Some browser surfaces may not support text selection while focus is settling.
			}
		}
	}

	function queueQuickAskComposerFocus(delayMs, generation) {
		setTimeout(() => {
			if (generation !== quickOpenFocusGeneration || Date.now() > quickOpenFocusUntil) return;
			focusQuickAskComposer();
		}, delayMs);
	}

	function scheduleQuickAskComposerFocus({ ensureOpen = true } = {}) {
		quickOpenFocusGeneration += 1;
		quickOpenFocusUntil = Date.now() + Math.max(...SIDEBAR_QUICK_OPEN_FOCUS_DELAYS_MS) + 250;
		quickOpenKeyCaptureUntil = Date.now() + SIDEBAR_QUICK_OPEN_KEY_CAPTURE_MS;
		const generation = quickOpenFocusGeneration;
		focusQuickAskComposer({ ensureOpen });
		for (const delayMs of SIDEBAR_QUICK_OPEN_FOCUS_DELAYS_MS) {
			queueQuickAskComposerFocus(delayMs, generation);
		}
	}

	function schedulePanelComposerFocus() {
		if (!IS_NATIVE_SIDE_PANEL && !open) return;
		scheduleQuickAskComposerFocus({ ensureOpen: false });
	}

	function refocusQuickAskComposerAfterRender() {
		if (!quickOpenFocusUntil || Date.now() > quickOpenFocusUntil || input.disabled) return;
		queueQuickAskComposerFocus(0, quickOpenFocusGeneration);
	}

	function isEditableTarget(target) {
		if (!(target instanceof Element)) return false;
		if (target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return true;
		return false;
	}

	function insertComposerText(text) {
		if (!(input instanceof HTMLTextAreaElement) || input.disabled) return;
		const start = Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length;
		const end = Number.isFinite(input.selectionEnd) ? input.selectionEnd : start;
		input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
		const nextPosition = start + text.length;
		try {
			input.setSelectionRange(nextPosition, nextPosition);
		} catch {
			// Ignore selection failures in embedded test/browser surfaces.
		}
		input.dispatchEvent(new Event("input", { bubbles: true }));
	}

	async function handleQuickOpenRequest(request) {
		const windowId = await ensureCurrentWindowId();
		if (!isQuickOpenRequestCurrent(request, windowId)) {
			if (isQuickOpenRequestStale(request)) await clearQuickOpenRequest(request);
			return;
		}
		await clearQuickOpenRequest(request);
		scheduleQuickAskComposerFocus();
	}

	async function consumePendingQuickOpenRequest() {
		try {
			const stored = await chrome.storage.local.get({ [SIDEBAR_QUICK_OPEN_REQUEST_KEY]: null });
			const request = stored?.[SIDEBAR_QUICK_OPEN_REQUEST_KEY];
			if (request) await handleQuickOpenRequest(request);
		} catch {
			// The direct runtime message path still handles shortcut focus if storage is unavailable.
		}
	}

	menuButton.addEventListener("click", () => {
		setMenuOpen(Boolean(menuPanel.hidden));
	});

	shadow.addEventListener("pointerdown", (event) => {
		if (menuPanel.hidden || eventTargetsMenu(event)) return;
		setMenuOpen(false);
	});

	shadow.addEventListener("keydown", (event) => {
		if (event.key !== "Escape" || menuPanel.hidden) return;
		event.preventDefault();
		setMenuOpen(false);
		menuButton.focus();
	});

	globalThis.addEventListener("keydown", (event) => {
		if (!quickOpenKeyCaptureUntil || Date.now() > quickOpenKeyCaptureUntil) return;
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
		if (!(input instanceof HTMLTextAreaElement) || input.disabled || shadow.activeElement === input) return;
		const path = typeof event.composedPath === "function" ? event.composedPath() : [];
		const target = path[0] || event.target;
		if (isEditableTarget(target)) return;
		if (event.key === "Backspace") {
			event.preventDefault();
			focusQuickAskComposer();
			const start = Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length;
			const end = Number.isFinite(input.selectionEnd) ? input.selectionEnd : start;
			if (start !== end) {
				input.value = `${input.value.slice(0, start)}${input.value.slice(end)}`;
				try {
					input.setSelectionRange(start, start);
				} catch {
					// Ignore selection failures in embedded test/browser surfaces.
				}
			} else if (start > 0) {
				input.value = `${input.value.slice(0, start - 1)}${input.value.slice(start)}`;
				try {
					input.setSelectionRange(start - 1, start - 1);
				} catch {
					// Ignore selection failures in embedded test/browser surfaces.
				}
			}
			input.dispatchEvent(new Event("input", { bubbles: true }));
			return;
		}
		if (event.key.length !== 1) return;
		event.preventDefault();
		focusQuickAskComposer();
		insertComposerText(event.key);
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
		stopRealtimeVoice();
		setOpen(false);
		void ensureCurrentWindowId()
			.then((windowId) => chrome.runtime.sendMessage({ type: "sidebar:close", windowId }))
			.catch(() => {});
	});

	function handleSessionSelection() {
		const nextSessionPath = String(sessionSelect.value || "").trim();
		if (!nextSessionPath) return;
		if (sessionSwitching && nextSessionPath === pendingSessionPath) return;
		void switchSession(nextSessionPath).catch((error) => {
			renderState({
				...(currentState || {}),
				status: error?.message || String(error),
			});
		});
	}

	sessionSelect.addEventListener("input", handleSessionSelection);
	sessionSelect.addEventListener("change", handleSessionSelection);
	sessionSelect.addEventListener("blur", () => {
		renderSessionControls(currentState || {});
	});

	function updateSidebarThemeFromSelect() {
		const previousTheme = sidebarTheme;
		const nextTheme = normalizeSidebarTheme(themeSelect.value);
		if (nextTheme === previousTheme) return;
		applySidebarTheme(nextTheme);
		themeSelect.value = sidebarTheme;
		void saveSidebarThemePreference(nextTheme).catch((error) => {
			applySidebarTheme(previousTheme);
			themeSelect.value = sidebarTheme;
			renderState({
				...(currentState || {}),
				status: error?.message || String(error),
			});
		});
	}

	themeSelect.addEventListener("input", updateSidebarThemeFromSelect);
	themeSelect.addEventListener("change", updateSidebarThemeFromSelect);

	function updateRealtimeMicFromSelect() {
		if (!(realtimeMicSelect instanceof HTMLSelectElement)) return;
		const previousDeviceId = realtimeMicDeviceId;
		const nextDeviceId = normalizeRealtimeMicDeviceId(realtimeMicSelect.value);
		if (nextDeviceId === previousDeviceId) return;
		realtimeMicDeviceId = nextDeviceId;
		realtimeActiveMicLabel = getRealtimeMicDeviceLabel(nextDeviceId);
		realtimeMicSelectSignature = "";
		renderRealtimeMicDeviceSelect();
		void saveRealtimeMicDevicePreference(nextDeviceId).catch(() => {
			realtimeMicDeviceId = previousDeviceId;
			realtimeActiveMicLabel = getRealtimeMicDeviceLabel(previousDeviceId);
			realtimeMicSelectSignature = "";
			renderRealtimeMicDeviceSelect();
		});
		if (realtimeConnected || realtimeConnecting) {
			stopRealtimeVoice("Switching mic...");
			setTimeout(() => {
				void startRealtimeVoice();
			}, 250);
		}
	}

	if (realtimeMicSelect instanceof HTMLSelectElement) {
		realtimeMicSelect.addEventListener("input", updateRealtimeMicFromSelect);
		realtimeMicSelect.addEventListener("change", updateRealtimeMicFromSelect);
		void refreshRealtimeMicDevices();
	}

	if (navigator.mediaDevices?.addEventListener) {
		navigator.mediaDevices.addEventListener("devicechange", () => {
			void refreshRealtimeMicDevices();
		});
	}

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

	openPdfViewerButton.addEventListener("click", () => {
		void openCurrentPdfInViewer().catch((error) => {
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

	replayViewEl.addEventListener("click", (event) => {
		const target = event.target instanceof Element ? event.target : null;
		if (!target) return;
		const artifactButton = target.closest("[data-replay-artifact-id]");
		if (artifactButton instanceof HTMLElement) {
			void loadReplayArtifact(artifactButton.dataset.replayArtifactId || "");
			return;
		}
		if (target.closest("[data-replay-toggle]")) {
			if (replayState.open) {
				replayState = {
					...replayState,
					open: false,
					error: "",
				};
				renderState(currentState || {});
				return;
			}
			const currentPath = getSelectedSessionPath();
			const loadedPath = replayState.sessionPath || replayState.session?.path || replayState.session?.id || replayState.session?.sessionId || "";
			if (replayState.session && currentPath && loadedPath === currentPath) {
				replayState = {
					...replayState,
					open: true,
					error: "",
				};
				renderState(currentState || {});
				return;
			}
			void openReplaySession().catch((error) => {
				renderState({
					...(currentState || {}),
					status: error?.message || String(error),
				});
			});
			return;
		}
		if (target.closest("[data-replay-restore]")) {
			const sessionPath = replayState.sessionPath || replayState.session?.path || replayState.session?.id || replayState.session?.sessionId || "";
			void restoreSessionPages(sessionPath).catch((error) => {
				replayState = {
					...replayState,
					error: error?.message || String(error),
				};
				renderState(currentState || {});
			});
			return;
		}
		const actionButton = target.closest("[data-action-key]");
		if (actionButton instanceof HTMLElement) {
			const sessionPath = replayState.sessionPath || replayState.session?.path || replayState.session?.id || replayState.session?.sessionId || "";
			void activateAction(actionButton.dataset.actionKey || "", { sessionPath }).catch((error) => {
				replayState = {
					...replayState,
					error: error?.message || String(error),
				};
				renderState(currentState || {});
			});
		}
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

	realtimeVoiceButton.addEventListener("click", () => {
		if (realtimeConnected || realtimeConnecting) {
			stopRealtimeVoice();
			return;
		}
		if (realtimeError && isRealtimeApiKeySetupError(realtimeError)) {
			void openOnhandOptionsPage().catch((error) => {
				setRealtimeStatus("Voice setup needed", `${REALTIME_API_KEY_SETUP_MESSAGE} ${error?.message || String(error)}`);
			});
			return;
		}
		void startRealtimeVoice().catch((error) => {
			const errorMessage = realtimeVoiceErrorMessage(error);
			setRealtimeStatus(isRealtimeApiKeySetupError(errorMessage) ? "Voice setup needed" : "Voice error", errorMessage);
		});
	});

	realtimeStatusEl.addEventListener("click", () => {
		if (!realtimeError) return;
		realtimeErrorExpanded = !realtimeErrorExpanded;
		renderRealtimeControls();
	});

	realtimeStatusEl.addEventListener("keydown", (event) => {
		if (!realtimeError || event.key !== "Escape") return;
		event.preventDefault();
		realtimeErrorExpanded = false;
		renderRealtimeControls();
		realtimeStatusEl.focus();
	});

	realtimeErrorDismissButton.addEventListener("click", () => {
		realtimeErrorExpanded = false;
		renderRealtimeControls();
		realtimeStatusEl.focus();
	});

	realtimeErrorOptionsButton.addEventListener("click", () => {
		void openOnhandOptionsPage().catch((error) => {
			setRealtimeStatus("Voice setup needed", `${REALTIME_API_KEY_SETUP_MESSAGE} ${error?.message || String(error)}`);
		});
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

	authPanelEl.addEventListener("click", (event) => {
		const target = event.target instanceof Element ? event.target : null;
		if (!target?.closest("#authSignInButton")) return;
		void signInWithOpenAICodexFromSidebar();
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

	learnerPanelEl.addEventListener("click", (event) => {
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest("[data-learner-toggle]")) {
			learnerPanelCollapsed = !learnerPanelCollapsed;
			renderState(currentState || {});
			return;
		}
		const button = target?.closest("[data-learner-annotation-id]");
		if (!(button instanceof HTMLElement)) return;
		void jumpToLearnerSource(button.dataset.learnerAnnotationId || "", button.dataset.target === "note" ? "note" : "annotation", button.dataset.actionKey || "");
	});

	function submitComposerInput() {
		void submitPrompt(input.value).catch((error) => {
			renderState({
				...(currentState || {}),
				status: error?.message || String(error),
			});
		});
	}

	input.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
		event.preventDefault();
		submitComposerInput();
	});

	composer.addEventListener("submit", (event) => {
		event.preventDefault();
		submitComposerInput();
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

	chrome.runtime.onMessage.addListener((message) => {
		if (message?.type === "browser-runtime:auth-progress") {
			authStatusKind = "";
			authStatusText = message.detail || message.status || "Signing in...";
			renderState(currentState || {});
			return;
		}
		if (message?.type === "sidebar:quick-open") {
			void handleQuickOpenRequest(message.request || message);
			return;
		}
		if (message?.type !== "sidebar:mic-permission-result") return;
		if (typeof realtimeMicPermissionTabId === "number") {
			chrome.tabs.remove(realtimeMicPermissionTabId).catch(() => {});
			realtimeMicPermissionTabId = null;
		}
		if (!message.ok) {
			setRealtimeStatus("Mic permission needed", message.error || "Microphone permission was not granted.");
			return;
		}
		setRealtimeStatus("Mic allowed");
		if (realtimeRestartAfterMicPermission) {
			realtimeRestartAfterMicPermission = false;
			setTimeout(() => {
				void startRealtimeVoice();
			}, 300);
		}
	});

	if (globalThis.__onhandSidebarExposeTestHooks) {
		globalThis.__onhandSidebarTestHooks = {
			setRealtimeDataChannel(channel) {
				realtimeDataChannel = channel;
			},
			setRealtimeConnected(connected = true) {
				realtimeConnected = Boolean(connected);
				realtimeConnecting = false;
				renderRealtimeControls();
			},
			setRealtimeStatus,
			setRealtimeMicDeviceId(deviceId = "default") {
				realtimeMicDeviceId = normalizeRealtimeMicDeviceId(deviceId);
				realtimeMicSelectSignature = "";
				renderRealtimeMicDeviceSelect();
			},
			createRealtimeInputMediaStream,
			refreshRealtimeMicDevices,
			setRealtimeResponseInProgress(inProgress = true) {
				realtimeResponseInProgress = Boolean(inProgress);
			},
			setRealtimeManualVoiceCommitPending(pending = true) {
				realtimeManualVoiceCommitPending = Boolean(pending);
			},
			setRealtimeServerSpeechSeenAt(value = Date.now()) {
				realtimeServerSpeechSeenAt = Number(value) || 0;
			},
			clearRealtimeVoiceFallback,
			commitRealtimeVoiceFallback,
			scheduleRealtimeVoiceFallbackCommit,
			expireRealtimeIdleTimeout,
			getRealtimeToolDefinitions: realtimeToolDefinitions,
			handleRealtimeServerEvent,
			ensureRealtimePdfSurfaceForVoice,
			requestRealtimeResponse,
			flushRealtimePendingTranscript,
			requestState,
			sendRealtimeTextPrompt,
			getRealtimeDebugState() {
				return {
					connected: realtimeConnected,
					connecting: realtimeConnecting,
					status: realtimeStatus,
					error: realtimeError,
					responseInProgress: realtimeResponseInProgress,
					responseCreateQueued: realtimeResponseCreateQueued,
					queuedResponseReason: realtimeQueuedResponseRequest?.reason || "",
					suppressTranscriptForResponse: realtimeSuppressTranscriptForResponse,
					manualVoiceCommitPending: realtimeManualVoiceCommitPending,
					pendingTranscriptionItemId: realtimePendingTranscriptionItemId,
					audioFallbackItemIds: Array.from(realtimeAudioFallbackItemIds),
					micCurrentRms: realtimeMicCurrentRms,
					micPeakRms: realtimeMicPeakRms,
					micNoiseFloorRms: realtimeMicNoiseFloorRms,
					micSpeechThresholdRms: realtimeLocalSpeechThreshold(),
					micMonitorFrames: realtimeMicMonitorFrames,
					micDeviceId: realtimeMicDeviceId,
					micDevices: realtimeMicDevices,
					activeMicLabel: realtimeActiveMicLabel,
					micTrackDetails: realtimeMicTrackDetails,
					pendingDirectAnswerRequestId: realtimePendingDirectAnswerRequestId,
					pendingSocraticMove: realtimePendingSocraticMove,
					activeVoiceTurn: realtimeActiveVoiceTurn,
				};
			},
		};
	}

	if (!IS_NATIVE_SIDE_PANEL) {
		chrome.runtime.onMessage.addListener((message) => {
			if (message?.type === "onhand:sidebar-visibility") {
				setOpen(Boolean(message.open));
			}
		});
	}

	if (chrome.storage?.onChanged?.addListener) {
		chrome.storage.onChanged.addListener((changes, areaName) => {
			if (areaName !== "local" || !changes[SIDEBAR_THEME_STORAGE_KEY]) return;
			applySidebarTheme(changes[SIDEBAR_THEME_STORAGE_KEY].newValue);
			themeSelect.value = sidebarTheme;
		});
	}

	try {
		void ensureKatexLoaded();
		if (IS_NATIVE_SIDE_PANEL) {
			await ensureCurrentWindowId();
			setOpen(true);
			void consumePendingQuickOpenRequest();
		} else {
			const response = await chrome.runtime.sendMessage({
				type: "sidebar:get-window-state",
				windowId: await ensureCurrentWindowId(),
			});
			setOpen(Boolean(response?.open));
			void consumePendingQuickOpenRequest();
		}
	} catch {
		setOpen(false);
	}
})();
