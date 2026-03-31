(async () => {
	if (globalThis.__onhandSidebarInjected) return;
	globalThis.__onhandSidebarInjected = true;

	const SIDEBAR_WIDTH = 420;
	const POLL_INTERVAL_MS = 900;
	const PAGE_OPEN_CLASS = "onhand-extension-sidebar-open";
	const PAGE_STYLE_ID = "onhand-extension-sidebar-layout";
	let open = false;
	let currentState = null;
	let pollingTimer = null;
	let sending = false;

	const host = document.createElement("div");
	host.id = "onhand-extension-sidebar-host";
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
				width: calc(100% - var(--onhand-sidebar-width, ${SIDEBAR_WIDTH}px)) !important;
				max-width: calc(100% - var(--onhand-sidebar-width, ${SIDEBAR_WIDTH}px)) !important;
				margin-right: var(--onhand-sidebar-width, ${SIDEBAR_WIDTH}px) !important;
				overflow-x: clip !important;
				transition:
					width 160ms ease,
					max-width 160ms ease,
					margin-right 160ms ease !important;
			}
			html.${PAGE_OPEN_CLASS} body {
				max-width: 100% !important;
				transition: max-width 160ms ease !important;
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
	const messagesEl = shadow.getElementById("messages");
	const activityEl = shadow.getElementById("activity");
	const actionsEl = shadow.getElementById("actions");
	const composer = shadow.getElementById("composer");
	const input = shadow.getElementById("input");
	const helper = shadow.getElementById("helper");
	const sendButton = shadow.getElementById("sendButton");

	function escapeHtml(value) {
		return String(value || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	function setOpen(nextOpen) {
		open = Boolean(nextOpen);
		host.style.display = open ? "block" : "none";
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

	function renderMessages(state) {
		const messages = Array.isArray(state?.messages) ? state.messages : [];
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

	function renderActivity(state) {
		const activities = Array.isArray(state?.activities) ? state.activities : [];
		if (!activities.length) {
			activityEl.innerHTML = `<div class="empty-card">Tool runs and reasoning traces will show up here while Onhand is answering.</div>`;
			return;
		}

		activityEl.innerHTML = activities
			.slice(-8)
			.map((activity) => {
				if (activity.kind === "reasoning") {
					return `
						<details class="reasoning-card" open>
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
		currentState = state;
		renderMeta(state);
		renderMessages(state);
		renderActivity(state);
		renderActions(state);

		const activeRequest = Boolean(state?.activeRequestId);
		input.disabled = activeRequest || sending;
		sendButton.disabled = activeRequest || sending;
		helper.textContent = activeRequest
			? "Onhand is currently responding. Wait for this turn to finish before sending another message."
			: "Messages here continue the current Onhand session.";
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
		void chrome.runtime.sendMessage({ type: "sidebar:close" });
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

	chrome.runtime.onMessage.addListener((message) => {
		if (message?.type === "onhand:sidebar-visibility") {
			setOpen(Boolean(message.open));
		}
	});

	try {
		const response = await chrome.runtime.sendMessage({ type: "sidebar:get-window-state" });
		setOpen(Boolean(response?.open));
	} catch {
		setOpen(false);
	}
})();
