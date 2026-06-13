// Onhand free tier proxy.
//
// An OpenAI-compatible passthrough to OpenRouter that lets the extension's
// "Onhand Free" provider work without any user key:
//   POST /v1/register           -> issues an anonymous device token
//   POST /v1/chat/completions   -> forwards to OpenRouter (streaming)
//
// Cost and abuse controls:
// - model allowlist (cheap models only)
// - server-side OpenRouter provider pinning (US hosts; user pages and PDFs
//   never transit PRC-hosted APIs)
// - per-device daily request cap, per-IP daily registration cap
// - request body size and max_tokens clamps
//
// Secrets/bindings: OPENROUTER_API_KEY (secret), FREE_TIER_KV (KV).

const ALLOWED_MODELS = new Set(["deepseek/deepseek-v4-flash"]);
const ALLOWED_OPENROUTER_PROVIDERS = ["deepinfra", "parasail", "novita", "wandb"];
const MAX_BODY_BYTES = 900_000;
const MAX_TELEMETRY_BODY_BYTES = 32_000;
const MAX_OUTPUT_TOKENS = 16_384;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
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
]);

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Authorization, Content-Type",
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

function finiteNumber(value, fallback = 0) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
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

function writeAnalytics(ctx, env, eventName, fields = {}, request = null) {
	const analytics = env?.ONHAND_ANALYTICS;
	if (!analytics || typeof analytics.writeDataPoint !== "function") return;
	const context = analyticsContext(request);
	const task = Promise.resolve().then(() => {
		analytics.writeDataPoint({
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
			],
		});
	}).catch(() => {});
	if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(task);
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
	const current = Number((await env.FREE_TIER_KV.get(key)) || 0);
	if (current >= cap) return { allowed: false, current };
	// get+put is racy under parallel requests; for a per-device daily cap
	// the worst case is a couple of extra requests, which is fine.
	await env.FREE_TIER_KV.put(key, String(current + 1), { expirationTtl: 60 * 60 * 48 });
	return { allowed: true, current: current + 1 };
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

function extractUsageFromSseLine(line) {
	const trimmed = line.trim();
	if (!trimmed.startsWith("data:")) return null;
	const data = trimmed.slice(5).trim();
	if (!data || data === "[DONE]") return null;
	try {
		const payload = JSON.parse(data);
		return payload?.usage && typeof payload.usage === "object" ? payload.usage : null;
	} catch {
		return null;
	}
}

function instrumentSseBody(body, env, ctx, baseFields, request) {
	if (!body) return body;
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffered = "";
	let usage = null;
	let streamedBytes = 0;

	function readUsage(text) {
		buffered += text;
		const lines = buffered.split(/\r?\n/);
		buffered = lines.pop() || "";
		for (const line of lines) {
			const nextUsage = extractUsageFromSseLine(line);
			if (nextUsage) usage = nextUsage;
		}
	}

	function usageFields() {
		return {
			promptTokens: usage?.prompt_tokens,
			completionTokens: usage?.completion_tokens,
			totalTokens: usage?.total_tokens,
			cost: usage?.cost,
		};
	}

	return new ReadableStream({
		async pull(controller) {
			try {
				const result = await reader.read();
				if (result.done) {
					const trailing = decoder.decode();
					if (trailing) readUsage(trailing);
					if (buffered) {
						const nextUsage = extractUsageFromSseLine(buffered);
						if (nextUsage) usage = nextUsage;
					}
					writeAnalytics(ctx, env, "chat_stream_complete", {
						...baseFields,
						result: "ok",
						bodyBytes: streamedBytes,
						...usageFields(),
					}, request);
					controller.close();
					return;
				}
				streamedBytes += result.value.byteLength;
				readUsage(decoder.decode(result.value, { stream: true }));
				controller.enqueue(result.value);
			} catch (error) {
				writeAnalytics(ctx, env, "chat_stream_error", {
					...baseFields,
					result: "error",
					bodyBytes: streamedBytes,
					errorCode: "stream_read_error",
					...usageFields(),
				}, request);
				controller.error(error);
			}
		},
		cancel(reason) {
			writeAnalytics(ctx, env, "chat_stream_cancelled", {
				...baseFields,
				result: "cancelled",
				bodyBytes: streamedBytes,
				errorCode: compactString(reason?.message || reason || "cancelled", 80),
				...usageFields(),
			}, request);
			return reader.cancel(reason).catch(() => {});
		},
	});
}

async function handleChatCompletions(request, env, ctx) {
	const startedAt = Date.now();
	const auth = request.headers.get("Authorization") || "";
	const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
	if (!token || !token.startsWith("oft_")) {
		writeAnalytics(ctx, env, "chat_auth_denied", {
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
			result: "denied",
			status: 401,
			durationMs: Date.now() - startedAt,
			deviceHash,
			errorCode: "unknown_token",
		}, request);
		return json(401, { error: { message: "Unknown free-tier token. Re-select Onhand Free in the extension options to register again." } });
	}

	const cap = Number(env.DAILY_REQUEST_CAP || 80);
	const usage = await bumpDailyCounter(env, `use:${token}:${todayKey()}`, cap);
	if (!usage.allowed) {
		writeAnalytics(ctx, env, "chat_quota_denied", {
			result: "denied",
			status: 429,
			durationMs: Date.now() - startedAt,
			deviceHash,
			current: usage.current,
			cap,
		}, request);
		return json(429, {
			error: {
				message: "You've reached today's Onhand Free limit. It resets tomorrow — or switch to your own API key in options for unlimited use.",
			},
		});
	}

	const raw = await request.text();
	if (raw.length > MAX_BODY_BYTES) {
		writeAnalytics(ctx, env, "chat_request_rejected", {
			result: "denied",
			status: 413,
			durationMs: Date.now() - startedAt,
			bodyBytes: raw.length,
			deviceHash,
			current: usage.current,
			cap,
			errorCode: "body_too_large",
		}, request);
		return json(413, { error: { message: "Request too large for the free tier." } });
	}
	let body;
	try {
		body = JSON.parse(raw);
	} catch {
		writeAnalytics(ctx, env, "chat_request_rejected", {
			result: "denied",
			status: 400,
			durationMs: Date.now() - startedAt,
			bodyBytes: raw.length,
			deviceHash,
			current: usage.current,
			cap,
			errorCode: "invalid_json",
		}, request);
		return json(400, { error: { message: "Request body must be JSON." } });
	}
	if (!ALLOWED_MODELS.has(String(body.model || ""))) {
		writeAnalytics(ctx, env, "chat_request_rejected", {
			result: "denied",
			status: 400,
			durationMs: Date.now() - startedAt,
			bodyBytes: raw.length,
			deviceHash,
			current: usage.current,
			cap,
			model: body.model,
			errorCode: "model_not_allowed",
		}, request);
		return json(400, { error: { message: `The free tier serves ${[...ALLOWED_MODELS].join(", ")} only.` } });
	}

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
		},
		body: JSON.stringify(body),
	});
	const upstreamDurationMs = Date.now() - startedAt;
	const upstreamProvider = upstream.headers.get("X-OpenRouter-Provider") || "";
	const metricBase = {
		status: upstream.status,
		durationMs: upstreamDurationMs,
		bodyBytes: raw.length,
		deviceHash,
		current: usage.current,
		cap,
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
		return json(404, { error: { message: "Not found." } });
	},
};
