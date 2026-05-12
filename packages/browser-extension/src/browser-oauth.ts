declare const chrome: any;

export interface BrowserOAuthCredentials {
	refresh: string;
	access: string;
	expires: number;
	accountId?: string;
	projectId?: string;
	email?: string;
	enterpriseUrl?: string;
	[key: string]: unknown;
}

export interface BrowserOAuthProgressEvent {
	providerId: string;
	status: string;
	detail?: string;
	url?: string;
	userCode?: string;
}

export interface BrowserOAuthProviderConfig {
	id: string;
	name: string;
	defaultModel: string;
	authKind: "callback" | "device";
}

export interface BrowserOAuthSignInOptions {
	providerId: string;
	onProgress?: (event: BrowserOAuthProgressEvent) => void;
}

export interface BrowserOAuthApiKeyOptions {
	onProgress?: (event: BrowserOAuthProgressEvent) => void;
}

interface CallbackAuthResult {
	code: string;
	state?: string;
	redirectUrl: string;
}

const OAUTH_TIMEOUT_MS = 10 * 60 * 1000;
const OAUTH_EXPIRY_SKEW_MS = 5 * 60 * 1000;
const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";

const OAUTH_PROVIDER_CONFIGS: BrowserOAuthProviderConfig[] = [
	{
		id: "openai-codex",
		name: "OpenAI Codex",
		defaultModel: "gpt-5.5",
		authKind: "callback",
	},
];

const OPENAI_CODEX = {
	clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
	authorizeUrl: "https://auth.openai.com/oauth/authorize",
	tokenUrl: "https://auth.openai.com/oauth/token",
	redirectUri: "http://localhost:1455/auth/callback",
	scope: "openid profile email offline_access",
};

function notify(options: BrowserOAuthSignInOptions | BrowserOAuthApiKeyOptions, providerId: string, status: string, detail?: string, extra: Record<string, unknown> = {}) {
	options.onProgress?.({
		providerId,
		status,
		detail,
		...extra,
	});
}

function base64UrlEncode(bytes: Uint8Array) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBase64Url(byteLength: number) {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return base64UrlEncode(bytes);
}

async function sha256Base64Url(value: string) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return base64UrlEncode(new Uint8Array(digest));
}

async function generatePKCE() {
	const verifier = randomBase64Url(32);
	return {
		verifier,
		challenge: await sha256Base64Url(verifier),
	};
}

function decodeJwtPayload(token: string): any | null {
	try {
		const payload = token.split(".")[1];
		if (!payload) return null;
		const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
		return JSON.parse(atob(padded));
	} catch {
		return null;
	}
}

function extractOpenAIAccountId(accessToken: string) {
	const auth = decodeJwtPayload(accessToken)?.[OPENAI_AUTH_CLAIM];
	const accountId = auth?.chatgpt_account_id;
	return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
}

function expiresAt(expiresIn: unknown, skewMs = OAUTH_EXPIRY_SKEW_MS) {
	const seconds = typeof expiresIn === "number" && Number.isFinite(expiresIn) ? expiresIn : 3600;
	return Date.now() + seconds * 1000 - skewMs;
}

async function fetchJson(url: string, init: RequestInit = {}) {
	const response = await fetch(url, init);
	const text = await response.text();
	let json: any = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		// Keep the raw body for the error path below.
	}
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}: ${text || "empty response"}`);
	}
	return json;
}

async function createTab(url: string) {
	if (!chrome?.tabs?.create) {
		throw new Error("Chrome tabs API is unavailable for OAuth sign-in.");
	}
	return await chrome.tabs.create({ url, active: true });
}

async function closeTab(tabId: number | undefined | null) {
	if (typeof tabId !== "number") return;
	try {
		await chrome.tabs.remove(tabId);
	} catch {
		// The user may have closed the tab already.
	}
}

function matchesRedirect(urlValue: string, redirectUri: string) {
	try {
		const url = new URL(urlValue);
		const redirect = new URL(redirectUri);
		if (url.protocol !== redirect.protocol) return false;
		if (url.hostname !== redirect.hostname && !(url.hostname === "127.0.0.1" && redirect.hostname === "localhost")) return false;
		if (url.port !== redirect.port) return false;
		return url.pathname === redirect.pathname;
	} catch {
		return false;
	}
}

async function openAuthTabAndWaitForRedirect(
	providerId: string,
	authUrl: string,
	redirectUri: string,
	expectedState: string,
	options: BrowserOAuthSignInOptions,
): Promise<CallbackAuthResult> {
	notify(options, providerId, "Opening sign-in page", "Complete the sign-in in the tab that just opened.", { url: authUrl });
	let authTabId: number | undefined;

	return await new Promise((resolve, reject) => {
		let settled = false;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;

		const cleanup = () => {
			if (timeoutId) clearTimeout(timeoutId);
			chrome.tabs.onUpdated.removeListener(onUpdated);
			chrome.tabs.onRemoved.removeListener(onRemoved);
		};

		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			fn();
		};

		const inspectUrl = (urlValue: string | undefined) => {
			if (!urlValue || !matchesRedirect(urlValue, redirectUri)) return;
			let parsed: URL;
			try {
				parsed = new URL(urlValue);
			} catch {
				return;
			}
			const error = parsed.searchParams.get("error");
			const code = parsed.searchParams.get("code");
			const state = parsed.searchParams.get("state") || undefined;
			if (error) {
				settle(() => reject(new Error(`OAuth sign-in failed: ${error}`)));
				void closeTab(authTabId);
				return;
			}
			if (!code) {
				settle(() => reject(new Error("OAuth callback did not include an authorization code.")));
				void closeTab(authTabId);
				return;
			}
			if (state && state !== expectedState) {
				settle(() => reject(new Error("OAuth state mismatch.")));
				void closeTab(authTabId);
				return;
			}
			notify(options, providerId, "Authorization received", "Exchanging authorization code for tokens.");
			settle(() => resolve({ code, state, redirectUrl: urlValue }));
			void closeTab(authTabId);
		};

		const onUpdated = (tabId: number, changeInfo: any, tab: any) => {
			if (authTabId !== undefined && tabId !== authTabId) return;
			inspectUrl(changeInfo?.url || tab?.url);
		};

		const onRemoved = (tabId: number) => {
			if (authTabId !== undefined && tabId !== authTabId) return;
			settle(() => reject(new Error("OAuth sign-in tab was closed before authorization completed.")));
		};

		chrome.tabs.onUpdated.addListener(onUpdated);
		chrome.tabs.onRemoved.addListener(onRemoved);
		timeoutId = setTimeout(() => {
			settle(() => reject(new Error("OAuth sign-in timed out.")));
			void closeTab(authTabId);
		}, OAUTH_TIMEOUT_MS);

		createTab(authUrl)
			.then((tab) => {
				authTabId = tab?.id;
				inspectUrl(tab?.url);
			})
			.catch((error) => {
				settle(() => reject(error instanceof Error ? error : new Error(String(error))));
			});
	});
}

function buildAuthUrl(baseUrl: string, params: Record<string, string>) {
	const url = new URL(baseUrl);
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value);
	}
	return url.toString();
}

async function loginOpenAICodex(options: BrowserOAuthSignInOptions): Promise<BrowserOAuthCredentials> {
	const { verifier, challenge } = await generatePKCE();
	const state = randomBase64Url(16);
	const authUrl = buildAuthUrl(OPENAI_CODEX.authorizeUrl, {
		response_type: "code",
		client_id: OPENAI_CODEX.clientId,
		redirect_uri: OPENAI_CODEX.redirectUri,
		scope: OPENAI_CODEX.scope,
		code_challenge: challenge,
		code_challenge_method: "S256",
		state,
		id_token_add_organizations: "true",
		codex_cli_simplified_flow: "true",
		originator: "pi",
	});
	const result = await openAuthTabAndWaitForRedirect("openai-codex", authUrl, OPENAI_CODEX.redirectUri, state, options);
	const tokenData = await fetchJson(OPENAI_CODEX.tokenUrl, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: OPENAI_CODEX.clientId,
			code: result.code,
			code_verifier: verifier,
			redirect_uri: OPENAI_CODEX.redirectUri,
		}),
	});
	if (!tokenData?.access_token || !tokenData?.refresh_token) {
		throw new Error("OpenAI token exchange did not return access and refresh tokens.");
	}
	const accountId = extractOpenAIAccountId(tokenData.access_token);
	if (!accountId) {
		throw new Error("OpenAI token did not include a ChatGPT account id.");
	}
	return {
		access: tokenData.access_token,
		refresh: tokenData.refresh_token,
		expires: expiresAt(tokenData.expires_in, 0),
		accountId,
	};
}

async function refreshOpenAICodexToken(credentials: BrowserOAuthCredentials): Promise<BrowserOAuthCredentials> {
	const tokenData = await fetchJson(OPENAI_CODEX.tokenUrl, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: credentials.refresh,
			client_id: OPENAI_CODEX.clientId,
		}),
	});
	if (!tokenData?.access_token || !tokenData?.refresh_token) {
		throw new Error("OpenAI token refresh did not return access and refresh tokens.");
	}
	const accountId = extractOpenAIAccountId(tokenData.access_token);
	if (!accountId) {
		throw new Error("OpenAI token did not include a ChatGPT account id.");
	}
	return {
		...credentials,
		access: tokenData.access_token,
		refresh: tokenData.refresh_token,
		expires: expiresAt(tokenData.expires_in, 0),
		accountId,
	};
}

export function getBrowserOAuthProviders() {
	return OAUTH_PROVIDER_CONFIGS.map((provider) => ({ ...provider }));
}

export function getBrowserOAuthProvider(providerId: string) {
	return OAUTH_PROVIDER_CONFIGS.find((provider) => provider.id === providerId) || null;
}

export function isBrowserOAuthProvider(providerId: string) {
	return Boolean(getBrowserOAuthProvider(providerId));
}

export function getDefaultOAuthModel(providerId: string) {
	return getBrowserOAuthProvider(providerId)?.defaultModel || "";
}

export async function loginBrowserOAuthProvider(options: BrowserOAuthSignInOptions): Promise<BrowserOAuthCredentials> {
	const provider = getBrowserOAuthProvider(options.providerId);
	if (!provider) throw new Error(`Unknown direct sign-in provider: ${options.providerId}`);
	switch (provider.id) {
		case "openai-codex":
			return await loginOpenAICodex(options);
		default:
			throw new Error(`Unsupported direct sign-in provider: ${provider.id}`);
	}
}

export async function getBrowserOAuthApiKey(
	providerId: string,
	credentials: BrowserOAuthCredentials,
	options: BrowserOAuthApiKeyOptions = {},
) {
	let nextCredentials = credentials;
	if (Date.now() >= Number(credentials.expires || 0)) {
		notify(options, providerId, "Refreshing sign-in token");
		switch (providerId) {
			case "openai-codex":
				nextCredentials = await refreshOpenAICodexToken(credentials);
				break;
			default:
				throw new Error(`Unknown direct sign-in provider: ${providerId}`);
		}
	}

	const apiKey = nextCredentials.access;
	if (!apiKey) throw new Error(`No usable OAuth token for provider: ${providerId}`);
	return {
		credentials: nextCredentials,
		apiKey,
	};
}

export function summarizeOAuthCredentials(credentials: Record<string, BrowserOAuthCredentials> = {}) {
	return OAUTH_PROVIDER_CONFIGS.map((provider) => {
		const credential = credentials[provider.id];
		return {
			id: provider.id,
			name: provider.name,
			defaultModel: provider.defaultModel,
			authKind: provider.authKind,
			signedIn: Boolean(credential),
			expires: typeof credential?.expires === "number" ? credential.expires : null,
			expired: credential ? Date.now() >= Number(credential.expires || 0) : false,
			accountId: typeof credential?.accountId === "string" ? credential.accountId : null,
			projectId: typeof credential?.projectId === "string" ? credential.projectId : null,
			email: typeof credential?.email === "string" ? credential.email : null,
			enterpriseUrl: typeof credential?.enterpriseUrl === "string" ? credential.enterpriseUrl : null,
		};
	});
}
