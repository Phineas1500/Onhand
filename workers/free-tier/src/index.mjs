// Onhand free tier proxy.
//
// An OpenAI-compatible passthrough to OpenRouter that lets the extension's
// "Onhand Free" provider work without any user key:
//   POST /v1/register           -> issues an anonymous device token
//   POST /v1/chat/completions   -> forwards to OpenRouter (streaming)
//   POST /v1/telemetry          -> records opt-in diagnostics events
//   POST /v1/error-reports      -> stores explicit anonymized error reports
//
// Cost and abuse controls:
// - model allowlist (cheap models only)
// - server-side OpenRouter provider pinning (US hosts; user pages and PDFs
//   never transit PRC-hosted APIs)
// - per-device daily request cap, per-turn model-call cap, daily shared cost cap
// - per-IP daily registration cap
// - request body size and max_tokens clamps
//
// Secrets/bindings: OPENROUTER_API_KEY (secret), FREE_TIER_KV (KV).

const FREE_TIER_TEXT_MODEL = "deepseek/deepseek-v4-flash";
const FREE_TIER_VISUAL_MODEL = "mistralai/mistral-small-3.2-24b-instruct";
const ALLOWED_MODELS = new Set([FREE_TIER_TEXT_MODEL]);
const ALLOWED_OPENROUTER_PROVIDERS = ["deepinfra", "parasail", "novita", "wandb"];
const MAX_BODY_BYTES = 900_000;
const MAX_TELEMETRY_BODY_BYTES = 32_000;
const MAX_ERROR_REPORT_BODY_BYTES = 64_000;
const MAX_OUTPUT_TOKENS = 16_384;
const DEFAULT_DAILY_COST_CAP_USD = 5;
const DEFAULT_DAILY_REQUEST_CAP = 80;
const DEFAULT_TURN_MODEL_CALL_CAP = 20;
const DEFAULT_HEAVY_TURN_MODEL_CALLS = 10;
const DEFAULT_HEAVY_TURN_COST_USD = 0.005;
const DEFAULT_HEAVY_TURN_TOKENS = 100_000;
const DAILY_COUNTER_TTL_SECONDS = 60 * 60 * 48;
const ERROR_REPORT_TTL_SECONDS = 60 * 60 * 24 * 90;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_GENERATION_URL = "https://openrouter.ai/api/v1/generation";
const TELEMETRY_EVENT_NAMES = new Set([
	"diagnostics_enabled",
	"extension_installed",
	"extension_updated",
	"options_opened",
	"settings_saved",
	"sidepanel_opened",
	"sidepanel_closed",
	"prompt_submitted",
	"prompt_succeeded",
	"prompt_failed",
	"prompt_stopped",
	"session_started",
	"session_restored",
	"session_restore_failed",
	"browser_run_js_started",
	"browser_run_js_succeeded",
	"browser_run_js_failed",
]);
const ERROR_REPORT_TYPES = new Set(["prompt_error", "runtime_error", "voice_error", "options_error"]);

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Authorization, Content-Type, X-Onhand-Turn-Id, X-Onhand-Session-Id",
	"Access-Control-Max-Age": "86400",
};

function json(status, body) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...CORS_HEADERS },
	});
}

function todayKey() {
	return new Date().toISOString().slice(0, 10);
}

function clientIp(request) {
	return request.headers.get("CF-Connecting-IP") || "unknown";
}

function compactString(value, maxLength = 120) {
	return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function compactIdentifier(value, maxLength = 120) {
	return String(value || "")
		.trim()
		.replace(/[^A-Za-z0-9_.:-]/g, "_")
		.slice(0, maxLength);
}

function compactStructuredString(value, maxLength = 1200) {
	const text = String(value || "")
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t\f\v]+/g, " ")
		.replace(/\n[ \t]+/g, "\n")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function finiteNumber(value, fallback = 0) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function telemetryToolStepCount(data) {
	const explicitCount = finiteNumber(data.tool_step_count ?? data.toolStepCount);
	const actionCount = finiteNumber(data.action_count ?? data.actionCount);
	return Math.max(explicitCount, actionCount);
}

function envNumber(env, name, fallback) {
	const number = Number(env?.[name]);
	return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function firstFiniteNumber(...values) {
	for (const value of values) {
		const number = Number(value);
		if (Number.isFinite(number)) return number;
	}
	return undefined;
}

function finiteBoolean(value) {
	return Boolean(value);
}

function userAgentFamily(request) {
	const ua = request.headers.get("User-Agent") || "";
	if (/Edg\//.test(ua)) return "edge";
	if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return "chrome";
	if (/Chromium\//.test(ua)) return "chromium";
	if (/Firefox\//.test(ua)) return "firefox";
	if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "safari";
	return ua ? "other" : "unknown";
}

function analyticsContext(request) {
	const cf = request?.cf || {};
	return {
		country: compactString(cf.country || "", 16),
		colo: compactString(cf.colo || "", 16),
		userAgentFamily: request ? userAgentFamily(request) : "unknown",
	};
}

function analyticsDataPoint(eventName, fields, context) {
	return {
		indexes: [compactString(eventName, 80)],
		blobs: [
			compactString(eventName, 80),
			compactString(fields.source || "free-tier", 48),
			compactString(fields.result || "", 48),
			compactString(fields.model || "", 120),
			compactString(fields.provider || "", 80),
			context.country,
			context.colo,
			context.userAgentFamily,
			compactString(fields.extensionVersion || "", 40),
			compactString(fields.runtimeRevision || "", 80),
			compactString(fields.authMode || "", 40),
			compactString(fields.aiProvider || "", 80),
			compactString(fields.aiModel || "", 120),
			compactString(fields.deviceHash || "", 80),
			compactString(fields.errorCode || "", 80),
			compactIdentifier(fields.turnId || "", 80),
			compactIdentifier(fields.sessionId || "", 80),
			compactIdentifier(fields.generationId || "", 120),
			compactString(fields.upstreamModel || "", 160),
			compactIdentifier(fields.providerRequestId || "", 120),
		],
		doubles: [
			Date.now(),
			finiteNumber(fields.status),
			finiteNumber(fields.durationMs),
			finiteNumber(fields.bodyBytes),
			finiteNumber(fields.current),
			finiteNumber(fields.cap),
			finiteNumber(fields.promptTokens),
			finiteNumber(fields.completionTokens),
			finiteNumber(fields.totalTokens),
			finiteNumber(fields.cost),
			finiteNumber(fields.actionCount),
			finiteNumber(fields.artifactCount),
			finiteNumber(fields.toolStepCount),
			finiteNumber(fields.toolFailureCount),
			finiteNumber(fields.recoveredToolFailureCount),
			finiteNumber(fields.finalToolFailureCount),
		],
	};
}

function writeAnalytics(ctx, env, eventName, fields = {}, request = null) {
	const analytics = env?.ONHAND_ANALYTICS;
	if (!analytics || typeof analytics.writeDataPoint !== "function") return;
	const context = analyticsContext(request);
	const task = Promise.resolve().then(() => {
		analytics.writeDataPoint(analyticsDataPoint(eventName, fields, context));
	}).catch(() => {});
	if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(task);
}

function writeCompletionAnalyticsAndAccounting(ctx, env, fields, request = null) {
	const analytics = env?.ONHAND_ANALYTICS;
	const context = analyticsContext(request);
	const task = Promise.resolve()
		.then(() => enrichCompletionFields(env, fields))
		.then(async (enrichedFields) => {
			if (analytics && typeof analytics.writeDataPoint === "function") {
				analytics.writeDataPoint(analyticsDataPoint("chat_stream_complete", enrichedFields, context));
			}
			await recordCompletionAccounting(env, analytics, context, enrichedFields);
		})
		.catch(() => {});
	if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(task);
	else void task;
}

async function hashIdentifier(value) {
	const text = compactString(value, 512);
	if (!text) return "";
	const bytes = new TextEncoder().encode(text);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")
		.slice(0, 32);
}

async function bumpDailyCounter(env, key, cap) {
	const current = await readKvNumber(env, key);
	if (current >= cap) return { allowed: false, current };
	// get+put is racy under parallel requests; for a per-device daily cap
	// the worst case is a couple of extra requests, which is fine.
	await writeKvNumber(env, key, current + 1, DAILY_COUNTER_TTL_SECONDS);
	return { allowed: true, current: current + 1 };
}

async function readKvNumber(env, key) {
	const current = Number((await env.FREE_TIER_KV.get(key)) || 0);
	return Number.isFinite(current) && current > 0 ? current : 0;
}

async function writeKvNumber(env, key, value, expirationTtl = DAILY_COUNTER_TTL_SECONDS) {
	await env.FREE_TIER_KV.put(key, String(value), { expirationTtl });
}

async function addKvNumber(env, key, amount, expirationTtl = DAILY_COUNTER_TTL_SECONDS) {
	const delta = finiteNumber(amount);
	if (delta <= 0) return await readKvNumber(env, key);
	const current = await readKvNumber(env, key);
	const next = current + delta;
	await writeKvNumber(env, key, next, expirationTtl);
	return next;
}

function dailyCostKey() {
	return `cost:${todayKey()}`;
}

function turnModelCallKey(deviceHash, telemetryIds) {
	const turnKey = compactIdentifier(telemetryIds.turnId || telemetryIds.sessionId || "", 80);
	if (!turnKey) return "";
	return `turn-call:${deviceHash}:${todayKey()}:${turnKey}`;
}

async function bumpTurnModelCalls(env, deviceHash, telemetryIds, cap) {
	const key = turnModelCallKey(deviceHash, telemetryIds);
	if (!key) return { allowed: true, current: 0 };
	return await bumpDailyCounter(env, key, cap);
}

function heavyTurnReasons(env, fields) {
	const reasons = [];
	const turnModelCalls = finiteNumber(fields.actionCount);
	const totalTokens = finiteNumber(fields.totalTokens);
	const cost = finiteNumber(fields.cost);
	const modelCallThreshold = envNumber(env, "HEAVY_TURN_MODEL_CALLS", DEFAULT_HEAVY_TURN_MODEL_CALLS);
	const tokenThreshold = envNumber(env, "HEAVY_TURN_TOKENS", DEFAULT_HEAVY_TURN_TOKENS);
	const costThreshold = envNumber(env, "HEAVY_TURN_COST_USD", DEFAULT_HEAVY_TURN_COST_USD);
	if (modelCallThreshold > 0 && turnModelCalls >= modelCallThreshold) reasons.push("model_calls");
	if (tokenThreshold > 0 && totalTokens >= tokenThreshold) reasons.push("tokens");
	if (costThreshold > 0 && cost >= costThreshold) reasons.push("cost");
	return reasons;
}

async function markHeavyTurnOnce(env, fields) {
	const turnKey = compactIdentifier(fields.turnId || fields.sessionId || "", 80);
	const deviceHash = compactIdentifier(fields.deviceHash || "", 80);
	if (!turnKey || !deviceHash) return true;
	const key = `heavy-turn:${deviceHash}:${todayKey()}:${turnKey}`;
	if (await env.FREE_TIER_KV.get(key)) return false;
	await env.FREE_TIER_KV.put(key, "1", { expirationTtl: DAILY_COUNTER_TTL_SECONDS });
	return true;
}

async function recordCompletionAccounting(env, analytics, context, fields) {
	if (finiteNumber(fields.cost) > 0) await addKvNumber(env, dailyCostKey(), fields.cost);
	const reasons = heavyTurnReasons(env, fields);
	if (!reasons.length || !(await markHeavyTurnOnce(env, fields))) return;
	if (!analytics || typeof analytics.writeDataPoint !== "function") return;
	const cap = envNumber(env, "TURN_MODEL_CALL_CAP", DEFAULT_TURN_MODEL_CALL_CAP);
	analytics.writeDataPoint(analyticsDataPoint("free_tier_heavy_turn", {
		...fields,
		result: "warn",
		current: fields.actionCount,
		cap,
		errorCode: reasons.join(","),
	}, context));
}

function requestTelemetryIds(request) {
	return {
		turnId: compactIdentifier(request.headers.get("X-Onhand-Turn-Id") || "", 80),
		sessionId: compactIdentifier(request.headers.get("X-Onhand-Session-Id") || "", 80),
	};
}

function valueContainsImage(value) {
	if (!value) return false;
	if (typeof value === "string") return value.startsWith("data:image/");
	if (Array.isArray(value)) return value.some(valueContainsImage);
	if (typeof value !== "object") return false;
	const type = String(value.type || "").toLowerCase();
	if (type === "image" || type === "image_url" || type === "input_image") return true;
	if (typeof value.image_url === "string" || value.image_url?.url) return true;
	if (typeof value.url === "string" && value.url.startsWith("data:image/")) return true;
	if (typeof value.data === "string" && value.mimeType?.startsWith?.("image/")) return true;
	if (typeof value.data === "string" && value.media_type?.startsWith?.("image/")) return true;
	return Object.values(value).some(valueContainsImage);
}

function routedModelForRequestBody(body) {
	return valueContainsImage(body?.messages) ? FREE_TIER_VISUAL_MODEL : FREE_TIER_TEXT_MODEL;
}

async function handleRegister(request, env, ctx) {
	const startedAt = Date.now();
	const cap = Number(env.REGISTRATIONS_PER_IP_PER_DAY || 5);
	const ipKey = `reg:${clientIp(request)}:${todayKey()}`;
	const { allowed, current } = await bumpDailyCounter(env, ipKey, cap);
	if (!allowed) {
		writeAnalytics(ctx, env, "register_rate_limited", {
			result: "denied",
			status: 429,
			durationMs: Date.now() - startedAt,
			current,
			cap,
		}, request);
		return json(429, { error: { message: "Too many free-tier registrations from this network today. Try again tomorrow or use your own API key." } });
	}
	const token = `oft_${crypto.randomUUID().replaceAll("-", "")}`;
	await env.FREE_TIER_KV.put(`token:${token}`, JSON.stringify({ createdAt: new Date().toISOString() }));
	writeAnalytics(ctx, env, "register_success", {
		result: "ok",
		status: 200,
		durationMs: Date.now() - startedAt,
		current,
		cap,
	}, request);
	return json(200, { token });
}

function extractSsePayload(line) {
	const trimmed = line.trim();
	if (!trimmed.startsWith("data:")) return null;
	const data = trimmed.slice(5).trim();
	if (!data || data === "[DONE]") return null;
	try {
		return JSON.parse(data);
	} catch {
		return null;
	}
}

function providerFromPayload(payload) {
	const metadata = payload?.openrouter_metadata && typeof payload.openrouter_metadata === "object" ? payload.openrouter_metadata : {};
	const provider = metadata.provider_name || metadata.provider || payload?.provider_name || payload?.provider;
	return compactString(provider || "", 80);
}

async function fetchOpenRouterGenerationMetadata(env, generationId) {
	const id = compactIdentifier(generationId, 160);
	if (!id || !env?.OPENROUTER_API_KEY) return null;
	const url = new URL(OPENROUTER_GENERATION_URL);
	url.searchParams.set("id", id);
	for (let attempt = 1; attempt <= 2; attempt += 1) {
		try {
			const response = await fetch(url, {
				headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
			});
			if (!response.ok) {
				if (attempt === 2 || ![404, 408, 429, 500, 502, 503].includes(response.status)) return null;
				await new Promise((resolve) => setTimeout(resolve, 750));
				continue;
			}
			const payload = await response.json().catch(() => null);
			return payload?.data && typeof payload.data === "object" ? payload.data : null;
		} catch {
			if (attempt === 2) return null;
			await new Promise((resolve) => setTimeout(resolve, 750));
		}
	}
	return null;
}

async function enrichCompletionFields(env, fields) {
	const metadata = await fetchOpenRouterGenerationMetadata(env, fields.generationId);
	if (!metadata) return fields;
	const promptTokens = firstFiniteNumber(metadata.tokens_prompt, metadata.native_tokens_prompt, fields.promptTokens);
	const completionTokens = firstFiniteNumber(metadata.tokens_completion, metadata.native_tokens_completion, fields.completionTokens);
	const metadataTotalTokens = Number.isFinite(promptTokens) && Number.isFinite(completionTokens) ? promptTokens + completionTokens : undefined;
	const totalTokens = firstFiniteNumber(
		metadata.total_tokens,
		metadataTotalTokens,
		fields.totalTokens,
	);
	return {
		...fields,
		provider: compactString(metadata.provider_name || fields.provider || "", 80),
		generationId: compactIdentifier(metadata.id || fields.generationId || "", 120),
		upstreamModel: compactString(metadata.model || fields.upstreamModel || "", 160),
		providerRequestId: compactIdentifier(metadata.request_id || fields.providerRequestId || "", 120),
		promptTokens,
		completionTokens,
		totalTokens,
		cost: firstFiniteNumber(metadata.total_cost, metadata.usage, fields.cost),
	};
}

function instrumentSseBody(body, env, ctx, baseFields, request) {
	if (!body) return body;
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffered = "";
	let usage = null;
	let generationId = "";
	let upstreamModel = "";
	let provider = compactString(baseFields.provider || "", 80);
	let providerRequestId = "";
	let streamedBytes = 0;

	function readPayloads(text) {
		buffered += text;
		const lines = buffered.split(/\r?\n/);
		buffered = lines.pop() || "";
		for (const line of lines) {
			readPayload(extractSsePayload(line));
		}
	}

	function readPayload(payload) {
		if (!payload || typeof payload !== "object") return;
		if (payload?.usage && typeof payload.usage === "object") usage = payload.usage;
		if (payload?.id) generationId = compactIdentifier(payload.id, 120) || generationId;
		if (payload?.model) upstreamModel = compactString(payload.model, 160) || upstreamModel;
		if (payload?.request_id) providerRequestId = compactIdentifier(payload.request_id, 120) || providerRequestId;
		provider = providerFromPayload(payload) || provider;
	}

	function usageFields() {
		return {
			promptTokens: usage?.prompt_tokens,
			completionTokens: usage?.completion_tokens,
			totalTokens: usage?.total_tokens,
			cost: usage?.cost,
		};
	}

	function streamFields(result, overrides = {}) {
		const startedAt = finiteNumber(baseFields.startedAtMs);
		return {
			...baseFields,
			result,
			bodyBytes: streamedBytes,
			durationMs: startedAt > 0 ? Date.now() - startedAt : baseFields.durationMs,
			provider,
			generationId,
			upstreamModel,
			providerRequestId,
			...usageFields(),
			...overrides,
		};
	}

	return new ReadableStream({
		async pull(controller) {
			try {
				const result = await reader.read();
				if (result.done) {
					const trailing = decoder.decode();
					if (trailing) readPayloads(trailing);
					if (buffered) {
						readPayload(extractSsePayload(buffered));
					}
					const fields = streamFields("ok");
					writeCompletionAnalyticsAndAccounting(ctx, env, fields, request);
					controller.close();
					return;
				}
				streamedBytes += result.value.byteLength;
				readPayloads(decoder.decode(result.value, { stream: true }));
				controller.enqueue(result.value);
			} catch (error) {
				writeAnalytics(ctx, env, "chat_stream_error", streamFields("error", {
					errorCode: "stream_read_error",
				}), request);
				controller.error(error);
			}
		},
		cancel(reason) {
			writeAnalytics(ctx, env, "chat_stream_cancelled", streamFields("cancelled", {
				errorCode: compactString(reason?.message || reason || "cancelled", 80),
			}), request);
			return reader.cancel(reason).catch(() => {});
		},
	});
}

async function handleChatCompletions(request, env, ctx) {
	const startedAt = Date.now();
	const telemetryIds = requestTelemetryIds(request);
	const auth = request.headers.get("Authorization") || "";
	const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
	if (!token || !token.startsWith("oft_")) {
		writeAnalytics(ctx, env, "chat_auth_denied", {
			...telemetryIds,
			result: "denied",
			status: 401,
			durationMs: Date.now() - startedAt,
			errorCode: "missing_token",
		}, request);
		return json(401, { error: { message: "Missing free-tier token. The Onhand extension registers one automatically; try re-selecting Onhand Free in options." } });
	}
	const deviceHash = await hashIdentifier(token);
	const known = await env.FREE_TIER_KV.get(`token:${token}`);
	if (!known) {
		writeAnalytics(ctx, env, "chat_auth_denied", {
			...telemetryIds,
			result: "denied",
			status: 401,
			durationMs: Date.now() - startedAt,
			deviceHash,
			errorCode: "unknown_token",
		}, request);
		return json(401, { error: { message: "Unknown free-tier token. Re-select Onhand Free in the extension options to register again." } });
	}

	const dailyCostCap = envNumber(env, "DAILY_COST_CAP_USD", DEFAULT_DAILY_COST_CAP_USD);
	const dailyCostUsed = await readKvNumber(env, dailyCostKey());
	if (dailyCostUsed >= dailyCostCap) {
		writeAnalytics(ctx, env, "chat_cost_quota_denied", {
			...telemetryIds,
			result: "denied",
			status: 429,
			durationMs: Date.now() - startedAt,
			deviceHash,
			current: dailyCostUsed,
			cap: dailyCostCap,
			errorCode: "daily_cost_cap",
		}, request);
		return json(429, {
			error: {
				message: "Onhand Free is at today's shared compute limit. It resets tomorrow, or you can switch to your own API key in options.",
			},
		});
	}

	const dailyRequestCap = envNumber(env, "DAILY_REQUEST_CAP", DEFAULT_DAILY_REQUEST_CAP);
	const usage = await bumpDailyCounter(env, `use:${token}:${todayKey()}`, dailyRequestCap);
	if (!usage.allowed) {
		writeAnalytics(ctx, env, "chat_quota_denied", {
			...telemetryIds,
			result: "denied",
			status: 429,
			durationMs: Date.now() - startedAt,
			deviceHash,
			current: usage.current,
			cap: dailyRequestCap,
		}, request);
		return json(429, {
			error: {
				message: "You've reached today's Onhand Free limit. It resets tomorrow — or switch to your own API key in options for unlimited use.",
			},
		});
	}

	const turnModelCallCap = envNumber(env, "TURN_MODEL_CALL_CAP", DEFAULT_TURN_MODEL_CALL_CAP);
	const turnUsage = await bumpTurnModelCalls(env, deviceHash, telemetryIds, turnModelCallCap);
	if (!turnUsage.allowed) {
		writeAnalytics(ctx, env, "chat_turn_quota_denied", {
			...telemetryIds,
			result: "denied",
			status: 429,
			durationMs: Date.now() - startedAt,
			deviceHash,
			current: turnUsage.current,
			cap: turnModelCallCap,
			errorCode: "turn_model_call_cap",
		}, request);
		return json(429, {
			error: {
				message: "This Onhand Free turn needs more compute than the free tier can provide. Switch to your own API key in options to continue on this page.",
			},
		});
	}

	const raw = await request.text();
	if (raw.length > MAX_BODY_BYTES) {
		writeAnalytics(ctx, env, "chat_request_rejected", {
			...telemetryIds,
			result: "denied",
			status: 413,
			durationMs: Date.now() - startedAt,
			bodyBytes: raw.length,
			deviceHash,
			current: usage.current,
			cap: dailyRequestCap,
			actionCount: turnUsage.current,
			errorCode: "body_too_large",
		}, request);
		return json(413, { error: { message: "Request too large for the free tier." } });
	}
	let body;
	try {
		body = JSON.parse(raw);
	} catch {
		writeAnalytics(ctx, env, "chat_request_rejected", {
			...telemetryIds,
			result: "denied",
			status: 400,
			durationMs: Date.now() - startedAt,
			bodyBytes: raw.length,
			deviceHash,
			current: usage.current,
			cap: dailyRequestCap,
			actionCount: turnUsage.current,
			errorCode: "invalid_json",
		}, request);
		return json(400, { error: { message: "Request body must be JSON." } });
	}
	if (!ALLOWED_MODELS.has(String(body.model || ""))) {
		writeAnalytics(ctx, env, "chat_request_rejected", {
			...telemetryIds,
			result: "denied",
			status: 400,
			durationMs: Date.now() - startedAt,
			bodyBytes: raw.length,
			deviceHash,
			current: usage.current,
			cap: dailyRequestCap,
			actionCount: turnUsage.current,
			model: body.model,
			errorCode: "model_not_allowed",
		}, request);
		return json(400, { error: { message: `The free tier serves ${[...ALLOWED_MODELS].join(", ")} only.` } });
	}

	body.model = routedModelForRequestBody(body);
	body.max_tokens = Math.min(Number(body.max_tokens || MAX_OUTPUT_TOKENS) || MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
	// Server-side routing policy always wins over anything client-supplied.
	body.provider = { only: ALLOWED_OPENROUTER_PROVIDERS };
	delete body.transforms;

	const upstream = await fetch(OPENROUTER_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
			"HTTP-Referer": "https://github.com/Phineas1500/Onhand",
			"X-Title": "Onhand Free Tier",
			"X-OpenRouter-Metadata": "enabled",
		},
		body: JSON.stringify(body),
	});
	const upstreamDurationMs = Date.now() - startedAt;
	const upstreamProvider = upstream.headers.get("X-OpenRouter-Provider") || "";
	const metricBase = {
		...telemetryIds,
		status: upstream.status,
		durationMs: upstreamDurationMs,
		startedAtMs: startedAt,
		bodyBytes: raw.length,
		deviceHash,
		current: usage.current,
		cap: dailyRequestCap,
		actionCount: turnUsage.current,
		model: body.model,
		provider: upstreamProvider,
	};
	writeAnalytics(ctx, env, "chat_upstream_response", {
		...metricBase,
		result: upstream.ok ? "ok" : "error",
		errorCode: upstream.ok ? "" : `upstream_${upstream.status}`,
	}, request);

	const headers = new Headers(CORS_HEADERS);
	const contentType = upstream.headers.get("Content-Type");
	if (contentType) headers.set("Content-Type", contentType);
	const responseBody = contentType?.includes("text/event-stream")
		? instrumentSseBody(upstream.body, env, ctx, metricBase, request)
		: upstream.body;
	return new Response(responseBody, { status: upstream.status, headers });
}

function telemetryData(payload) {
	const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
	return {
		extensionVersion: compactString(payload.extension_version || data.extension_version, 40),
		runtimeRevision: compactString(payload.runtime_revision || data.runtime_revision, 80),
		authMode: compactString(data.auth_mode, 40),
		aiProvider: compactString(data.ai_provider, 80),
		aiModel: compactString(data.ai_model, 120),
		result: compactString(data.result, 48),
		errorCode: compactString(data.error_kind || data.error_code, 80),
		status: finiteNumber(data.status),
		durationMs: finiteNumber(data.duration_ms),
		bodyBytes: finiteNumber(data.body_bytes),
		actionCount: finiteNumber(data.action_count),
		artifactCount: finiteNumber(data.artifact_count),
		toolStepCount: telemetryToolStepCount(data),
		toolFailureCount: finiteNumber(data.tool_failure_count ?? data.toolFailureCount),
		recoveredToolFailureCount: finiteNumber(data.recovered_tool_failure_count ?? data.recoveredToolFailureCount),
		finalToolFailureCount: finiteNumber(data.final_tool_failure_count ?? data.finalToolFailureCount),
	};
}

function safeActivitySummary(value) {
	const items = Array.isArray(value) ? value : [];
	return items
		.slice(0, 16)
		.map((activity) => ({
			kind: compactString(activity?.kind, 32),
			tool_name: compactString(activity?.tool_name || activity?.toolName, 80),
			state: compactString(activity?.state, 32),
		}))
		.filter((activity) => activity.kind || activity.tool_name || activity.state);
}

function errorReportData(payload) {
	const report = payload?.report && typeof payload.report === "object" ? payload.report : payload && typeof payload === "object" ? payload : {};
	const type = compactString(report.type || "prompt_error", 48);
	return {
		schema_version: 1,
		type: ERROR_REPORT_TYPES.has(type) ? type : "runtime_error",
		created_at: compactString(report.created_at, 48),
		extension_version: compactString(report.extension_version, 40),
		runtime_revision: compactString(report.runtime_revision, 80),
		auth_mode: compactString(report.auth_mode, 40),
		ai_provider: compactString(report.ai_provider, 80),
		ai_model: compactString(report.ai_model, 120),
		realtime_voice_enabled: finiteBoolean(report.realtime_voice_enabled),
		learning_mode: finiteBoolean(report.learning_mode),
		error_kind: compactString(report.error_kind, 80),
		error_message: compactStructuredString(report.error_message, 700),
		error_stack: compactStructuredString(report.error_stack, 2400),
		duration_ms: finiteNumber(report.duration_ms),
		action_count: finiteNumber(report.action_count),
		artifact_count: finiteNumber(report.artifact_count),
		activity_summary: safeActivitySummary(report.activity_summary),
	};
}

async function handleTelemetry(request, env, ctx) {
	const cap = Number(env.TELEMETRY_EVENTS_PER_IP_PER_DAY || 1000);
	const ipKey = `telemetry:${clientIp(request)}:${todayKey()}`;
	const quota = await bumpDailyCounter(env, ipKey, cap);
	if (!quota.allowed) {
		writeAnalytics(ctx, env, "telemetry_rate_limited", {
			source: "extension",
			result: "denied",
			status: 429,
			current: quota.current,
			cap,
		}, request);
		return json(202, { ok: true, accepted: false });
	}

	const raw = await request.text();
	if (raw.length > MAX_TELEMETRY_BODY_BYTES) {
		writeAnalytics(ctx, env, "telemetry_rejected", {
			source: "extension",
			result: "denied",
			status: 413,
			bodyBytes: raw.length,
			errorCode: "body_too_large",
			current: quota.current,
			cap,
		}, request);
		return json(202, { ok: true, accepted: false });
	}

	let payload;
	try {
		payload = JSON.parse(raw);
	} catch {
		return json(202, { ok: true, accepted: false });
	}
	const eventName = compactString(payload?.event_name, 80);
	if (!TELEMETRY_EVENT_NAMES.has(eventName)) return json(202, { ok: true, accepted: false });
	const deviceHash = await hashIdentifier(payload?.client_id);
	const data = telemetryData(payload);
	writeAnalytics(ctx, env, eventName, {
		...data,
		source: "extension",
		deviceHash,
		current: quota.current,
		cap,
	}, request);
	return json(202, { ok: true, accepted: true });
}

async function handleErrorReport(request, env, ctx) {
	const startedAt = Date.now();
	const cap = Number(env.ERROR_REPORTS_PER_IP_PER_DAY || 50);
	const ipKey = `error-report:${clientIp(request)}:${todayKey()}`;
	const quota = await bumpDailyCounter(env, ipKey, cap);
	if (!quota.allowed) {
		writeAnalytics(ctx, env, "error_report_rate_limited", {
			source: "extension",
			result: "denied",
			status: 429,
			current: quota.current,
			cap,
		}, request);
		return json(202, { ok: true, accepted: false, reason: "rate_limited" });
	}

	const raw = await request.text();
	if (raw.length > MAX_ERROR_REPORT_BODY_BYTES) {
		writeAnalytics(ctx, env, "error_report_rejected", {
			source: "extension",
			result: "denied",
			status: 413,
			bodyBytes: raw.length,
			errorCode: "body_too_large",
			current: quota.current,
			cap,
		}, request);
		return json(202, { ok: true, accepted: false, reason: "body_too_large" });
	}

	let payload;
	try {
		payload = JSON.parse(raw);
	} catch {
		writeAnalytics(ctx, env, "error_report_rejected", {
			source: "extension",
			result: "denied",
			status: 400,
			bodyBytes: raw.length,
			errorCode: "invalid_json",
			current: quota.current,
			cap,
		}, request);
		return json(202, { ok: true, accepted: false, reason: "invalid_json" });
	}

	const report = errorReportData(payload);
	if (!report.error_kind && !report.error_message && !report.error_stack) {
		writeAnalytics(ctx, env, "error_report_rejected", {
			source: "extension",
			result: "denied",
			status: 400,
			bodyBytes: raw.length,
			errorCode: "empty_report",
			current: quota.current,
			cap,
		}, request);
		return json(202, { ok: true, accepted: false, reason: "empty_report" });
	}

	const reportId = `err_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
	const context = analyticsContext(request);
	const storedReport = {
		report_id: reportId,
		received_at: new Date().toISOString(),
		source: "extension",
		context,
		report,
	};
	await env.FREE_TIER_KV.put(`error-report:${reportId}`, JSON.stringify(storedReport), {
		expirationTtl: ERROR_REPORT_TTL_SECONDS,
		metadata: {
			type: report.type,
			error_kind: report.error_kind,
			extension_version: report.extension_version,
			runtime_revision: report.runtime_revision,
			received_at: storedReport.received_at,
		},
	});

	writeAnalytics(ctx, env, "error_report_submitted", {
		source: "extension",
		result: "ok",
		status: 202,
		durationMs: Date.now() - startedAt,
		bodyBytes: raw.length,
		current: quota.current,
		cap,
		extensionVersion: report.extension_version,
		runtimeRevision: report.runtime_revision,
		authMode: report.auth_mode,
		aiProvider: report.ai_provider,
		aiModel: report.ai_model,
		errorCode: report.error_kind,
		actionCount: report.action_count,
		artifactCount: report.artifact_count,
	}, request);
	return json(202, { ok: true, accepted: true, report_id: reportId });
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}
		if (request.method === "POST" && url.pathname === "/v1/register") {
			return await handleRegister(request, env, ctx);
		}
		if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
			return await handleChatCompletions(request, env, ctx);
		}
		if (request.method === "POST" && url.pathname === "/v1/telemetry") {
			return await handleTelemetry(request, env, ctx);
		}
		if (request.method === "POST" && url.pathname === "/v1/error-reports") {
			return await handleErrorReport(request, env, ctx);
		}
		return json(404, { error: { message: "Not found." } });
	},
};

export const __freeTierTest = {
	FREE_TIER_TEXT_MODEL,
	FREE_TIER_VISUAL_MODEL,
	valueContainsImage,
	routedModelForRequestBody,
};
