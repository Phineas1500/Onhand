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
// Secrets/bindings: OPENROUTER_API_KEY, FREE_TIER_KV, FREE_TIER_COST_LEDGER.

import { fetchOpenRouterGenerationMetadata, reportedGenerationCost } from "./generation-metadata.mjs";

const FREE_TIER_TEXT_MODEL = "openai/gpt-5.6-luna";
const FREE_TIER_VISUAL_MODEL = "mistralai/mistral-small-3.2-24b-instruct";
const ALLOWED_MODELS = new Set([FREE_TIER_TEXT_MODEL]);
// Provider pinning is per-model: Luna is served by OpenAI itself (US-hosted,
// no PRC transit, tool calls validated in the scenario evals); the visual
// route keeps the vetted US host set that serves Mistral.
const ALLOWED_OPENROUTER_PROVIDERS_BY_MODEL = {
	"openai/gpt-5.6-luna": ["openai"],
	"mistralai/mistral-small-3.2-24b-instruct": ["deepinfra", "parasail", "novita", "wandb"],
};
const UPSTREAM_FALLBACK_STATUSES = new Set([404]);
const MAX_BODY_BYTES = 2_500_000;
const MAX_TELEMETRY_BODY_BYTES = 32_000;
const MAX_ERROR_REPORT_BODY_BYTES = 64_000;
const MAX_OUTPUT_TOKENS = 16_384;
const DEFAULT_DAILY_COST_CAP_USD = 5;
const DEFAULT_DAILY_REQUEST_CAP = 80;
const DEFAULT_TURN_MODEL_CALL_CAP = 50;
const DEFAULT_HEAVY_TURN_MODEL_CALLS = 10;
// Tuned for Luna pricing (~2x DeepSeek per-turn realized cost); env-overridable.
const DEFAULT_HEAVY_TURN_COST_USD = 0.01;
const DEFAULT_HEAVY_TURN_TOKENS = 100_000;
const DAILY_COUNTER_TTL_SECONDS = 60 * 60 * 48;
const ERROR_REPORT_TTL_SECONDS = 60 * 60 * 24 * 90;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_COMPLETION_BODY_BYTES = 8 * 1024 * 1024;
const QUOTA_BYPASS_HEADER = "X-Onhand-Quota-Bypass";
const QUOTA_BYPASS_SOURCE = "free-tier-bypass";
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
	"Access-Control-Allow-Headers": `Authorization, Content-Type, X-Onhand-Turn-Id, X-Onhand-Session-Id, ${QUOTA_BYPASS_HEADER}`,
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

function timingSafeEqualText(left, right) {
	const a = String(left || "");
	const b = String(right || "");
	if (!a || !b || a.length !== b.length) return false;
	let diff = 0;
	for (let index = 0; index < a.length; index += 1) {
		diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}
	return diff === 0;
}

function envIdentifierSet(value) {
	return String(value || "")
		.split(/[\s,]+/g)
		.map((entry) => compactIdentifier(entry, 120))
		.filter(Boolean);
}

function envDateMs(value) {
	const text = String(value || "").trim();
	if (!text) return 0;
	const numeric = Number(text);
	if (Number.isFinite(numeric) && numeric > 0) return numeric > 10_000_000_000 ? numeric : numeric * 1000;
	const parsed = Date.parse(text);
	return Number.isFinite(parsed) ? parsed : 0;
}

function quotaBypassAuthorized(request, env, deviceHash = "") {
	const secret = String(env?.ONHAND_FREE_QUOTA_BYPASS_SECRET || "").trim();
	if (secret.length < 16) return false;
	const provided = String(request.headers.get(QUOTA_BYPASS_HEADER) || "").trim();
	if (!timingSafeEqualText(provided, secret)) return false;
	const allowedDeviceHashes = envIdentifierSet(env?.ONHAND_FREE_QUOTA_BYPASS_DEVICE_HASHES);
	if (!allowedDeviceHashes.length || !allowedDeviceHashes.includes(compactIdentifier(deviceHash, 120))) return false;
	const expiresAtMs = envDateMs(env?.ONHAND_FREE_QUOTA_BYPASS_EXPIRES_AT);
	return expiresAtMs > Date.now();
}

function firstFiniteNumber(...values) {
	for (const value of values) {
		if (value == null || value === "") continue;
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

function writeCompletionAnalyticsAndAccounting(ctx, env, eventName, fields, request = null) {
	const analytics = env?.ONHAND_ANALYTICS;
	const context = analyticsContext(request);
	const task = (async () => {
		const enrichedFields = await enrichCompletionFields(env, fields);
		// Accounting must not depend on the optional analytics binding succeeding.
		await recordCompletionAccounting(env, analytics, context, enrichedFields);
		if (analytics && typeof analytics.writeDataPoint === "function") {
			try { analytics.writeDataPoint(analyticsDataPoint(eventName, enrichedFields, context)); } catch {}
		}
	})().catch((error) => {
		console.error("free_tier_accounting_failed", fields.accountingId, String(error?.message || error));
		writeAnalytics(ctx, env, "free_tier_accounting_failed", { ...fields, result: "error", errorCode: "accounting_failed" }, request);
	});
	if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(task);
	return task;
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

function dailyCostLedger(env, day) {
	if (!env.FREE_TIER_COST_LEDGER) throw new Error("FREE_TIER_COST_LEDGER binding is required");
	return env.FREE_TIER_COST_LEDGER.getByName(day);
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
	if (!fields.quotaBypassed) {
		const entry = {
			day: fields.accountingDay,
			id: fields.generationId || fields.accountingId,
			generationId: fields.generationId,
			cost: firstFiniteNumber(fields.cost),
			reconcile: Boolean(fields.generationId) && !fields.costResolved,
			adjustmentPoint: analyticsDataPoint("free_tier_cost_adjustment", { ...fields, cost: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0, actionCount: 0, result: "reconciled" }, context),
		};
		for (let attempt = 1; ; attempt += 1) {
			try {
				await dailyCostLedger(env, fields.accountingDay).record(entry);
				break;
			} catch (error) {
				if (attempt === 3) throw error;
				await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
			}
		}
	}
	const reasons = heavyTurnReasons(env, fields);
	if (!reasons.length) return;
	try { if (!(await markHeavyTurnOnce(env, fields))) return; } catch { return; }
	if (!analytics || typeof analytics.writeDataPoint !== "function") return;
	const cap = envNumber(env, "TURN_MODEL_CALL_CAP", DEFAULT_TURN_MODEL_CALL_CAP);
	try { analytics.writeDataPoint(analyticsDataPoint("free_tier_heavy_turn", {
		...fields,
		result: "warn",
		current: fields.actionCount,
		cap,
		errorCode: reasons.join(","),
	}, context)); } catch {}
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

function upstreamCandidateModelsForRequestBody(body) {
	const primary = routedModelForRequestBody(body);
	if (primary === FREE_TIER_TEXT_MODEL) return [primary, FREE_TIER_VISUAL_MODEL];
	return [primary];
}

function prepareOpenRouterRequestBody(body, model) {
	const next = structuredClone(body || {});
	next.model = model;
	next.max_tokens = Math.min(Number(next.max_tokens || MAX_OUTPUT_TOKENS) || MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
	// Server-side routing policy always wins over anything client-supplied.
	next.provider = { only: ALLOWED_OPENROUTER_PROVIDERS_BY_MODEL[model] || ["openai"] };
	delete next.transforms;
	return next;
}

function shouldRetryUpstreamResponse(response, candidateIndex, candidateModels) {
	return !response.ok && UPSTREAM_FALLBACK_STATUSES.has(response.status) && candidateIndex < candidateModels.length - 1;
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
		cost: reportedGenerationCost(metadata) ?? firstFiniteNumber(fields.cost),
		costResolved: reportedGenerationCost(metadata) !== undefined,
	};
}

function instrumentCompletionBody(body, env, ctx, baseFields, request, isSse) {
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
	let finished = false;
	let cancelled = false;
	let jsonTooLarge = false;
	let activeRead = null;
	let cancelTask = null;
	const onRequestAbort = () => { cancel(request.signal.reason); };

	function readPayload(payload) {
		if (!payload || typeof payload !== "object") return;
		if (payload.usage && typeof payload.usage === "object") usage = { ...usage, ...payload.usage };
		if (payload.id) generationId = compactIdentifier(payload.id, 120) || generationId;
		if (payload.model) upstreamModel = compactString(payload.model, 160) || upstreamModel;
		if (payload.request_id) providerRequestId = compactIdentifier(payload.request_id, 120) || providerRequestId;
		provider = providerFromPayload(payload) || provider;
	}

	function readChunk(bytes) {
		streamedBytes += bytes.byteLength;
		if (!isSse && streamedBytes > MAX_COMPLETION_BODY_BYTES) {
			jsonTooLarge = true;
			buffered = "";
			return;
		}
		if (jsonTooLarge) return;
		buffered += decoder.decode(bytes, { stream: true });
		if (isSse) {
			const lines = buffered.split(/\r?\n/);
			buffered = lines.pop() || "";
			for (const line of lines) readPayload(extractSsePayload(line));
		}
	}

	function finalize(result, errorCode = "") {
		if (finished) return;
		finished = true;
		request?.signal?.removeEventListener("abort", onRequestAbort);
		if (!jsonTooLarge) {
			buffered += decoder.decode();
			if (isSse) readPayload(extractSsePayload(buffered));
			else { try { readPayload(JSON.parse(buffered)); } catch {} }
		}
		const startedAt = finiteNumber(baseFields.startedAtMs);
		const fields = {
			...baseFields, result, errorCode, bodyBytes: streamedBytes,
			durationMs: startedAt > 0 ? Date.now() - startedAt : baseFields.durationMs,
			provider, generationId, upstreamModel, providerRequestId,
			promptTokens: usage?.prompt_tokens, completionTokens: usage?.completion_tokens,
			totalTokens: usage?.total_tokens, cost: usage?.cost,
		};
		if (!generationId && firstFiniteNumber(fields.cost) === undefined && baseFields.status < 400) {
			writeAnalytics(ctx, env, "free_tier_accounting_unresolved", { ...fields, errorCode: "missing_generation_usage" }, request);
		}
		const eventName = result === "cancelled" ? "chat_stream_cancelled"
			: result === "error" ? "chat_stream_error"
				: isSse ? "chat_stream_complete" : "chat_response_complete";
		return writeCompletionAnalyticsAndAccounting(ctx, env, eventName, fields, request);
	}

	function cancel(reason) {
		if (finished) return cancelTask;
		if (cancelTask) return cancelTask;
		cancelled = true;
		cancelTask = (async () => {
			if (isSse) {
				await reader.cancel(reason).catch(() => {});
				await activeRead?.catch(() => {});
			} else {
				// JSON may not expose its generation/usage until the very last byte.
				// Finish reading this bounded model response after client disconnect.
				try {
					await activeRead;
					while (!jsonTooLarge) {
						const result = await reader.read();
						if (result.done) break;
						readChunk(result.value);
					}
				} catch {}
				await reader.cancel(reason).catch(() => {});
			}
			await finalize("cancelled", "client_cancelled");
		})();
		if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(cancelTask);
		return cancelTask;
	}

	// workerd can abandon its response pump on a real network disconnect without
	// calling the ReadableStream source's cancel hook. The incoming request signal
	// is the authoritative disconnect notification (enable_request_signal flag).
	request?.signal?.addEventListener("abort", onRequestAbort, { once: true });
	if (request?.signal?.aborted) cancel(request.signal.reason);

	return new ReadableStream({
		async pull(controller) {
			if (cancelled) return;
			// cancel can run while this read is pending. Parse any returned bytes before
			// it finalizes, and never enqueue/close an already cancelled controller.
			activeRead = (async () => {
				const result = await reader.read();
				if (!result.done) readChunk(result.value);
				return result;
			})();
			try {
				const result = await activeRead;
				if (cancelled) return;
				if (result.done) {
					finalize(baseFields.status >= 400 ? "error" : "ok");
					controller.close();
				} else controller.enqueue(result.value);
			} catch (error) {
				if (cancelled) return;
				finalize("error", "stream_read_error");
				controller.error(error);
			}
		},
		cancel,
	});
}

async function handleChatCompletions(request, env, ctx) {
	const startedAt = Date.now();
	const accountingDay = new Date(startedAt).toISOString().slice(0, 10);
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

	const quotaBypassed = quotaBypassAuthorized(request, env, deviceHash);
	const source = quotaBypassed ? QUOTA_BYPASS_SOURCE : "free-tier";
	const dailyCostCap = envNumber(env, "DAILY_COST_CAP_USD", DEFAULT_DAILY_COST_CAP_USD);
	let dailyCostUsed = 0;
	try {
		if (!quotaBypassed) dailyCostUsed = await dailyCostLedger(env, accountingDay).total(accountingDay);
	} catch {
		writeAnalytics(ctx, env, "free_tier_accounting_failed", { ...telemetryIds, result: "error", status: 503, errorCode: "ledger_unavailable" }, request);
		return json(503, { error: { message: "Onhand Free usage accounting is temporarily unavailable. Please try again shortly." } });
	}
	if (!quotaBypassed && dailyCostUsed >= dailyCostCap) {
		writeAnalytics(ctx, env, "chat_cost_quota_denied", {
			...telemetryIds,
			source,
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
	const usage = quotaBypassed
		? { allowed: true, current: 0 }
		: await bumpDailyCounter(env, `use:${token}:${todayKey()}`, dailyRequestCap);
	if (!usage.allowed) {
		writeAnalytics(ctx, env, "chat_quota_denied", {
			...telemetryIds,
			source,
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
	const turnUsage = quotaBypassed
		? { allowed: true, current: 0 }
		: await bumpTurnModelCalls(env, deviceHash, telemetryIds, turnModelCallCap);
	if (!turnUsage.allowed) {
		writeAnalytics(ctx, env, "chat_turn_quota_denied", {
			...telemetryIds,
			source,
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
			source,
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
			source,
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
			source,
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

	const candidateModels = upstreamCandidateModelsForRequestBody(body);
	let upstream = null;
	let metricBase = null;
	for (const [candidateIndex, candidateModel] of candidateModels.entries()) {
		const upstreamBody = prepareOpenRouterRequestBody(body, candidateModel);
		const response = await fetch(OPENROUTER_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
				"HTTP-Referer": "https://github.com/Phineas1500/Onhand",
				"X-Title": "Onhand Free Tier",
				"X-OpenRouter-Metadata": "enabled",
			},
			body: JSON.stringify(upstreamBody),
		});
		const candidateMetricBase = {
			...telemetryIds,
			source,
			quotaBypassed,
			accountingDay,
			accountingId: crypto.randomUUID(),
			status: response.status,
			durationMs: Date.now() - startedAt,
			startedAtMs: startedAt,
			bodyBytes: raw.length,
			deviceHash,
			current: usage.current,
			cap: dailyRequestCap,
			actionCount: turnUsage.current,
			model: upstreamBody.model,
			provider: response.headers.get("X-OpenRouter-Provider") || "",
		};
		if (shouldRetryUpstreamResponse(response, candidateIndex, candidateModels)) {
			writeAnalytics(ctx, env, "chat_upstream_retry", {
				...candidateMetricBase,
				result: "retry",
				errorCode: `upstream_${response.status}`,
			}, request);
			try {
				await response.body?.cancel?.();
			} catch {}
			continue;
		}
		upstream = response;
		metricBase = candidateMetricBase;
		break;
	}
	if (!upstream || !metricBase) {
		return json(502, { error: { message: "No upstream model was available for Onhand Free." } });
	}
	writeAnalytics(ctx, env, "chat_upstream_response", {
		...metricBase,
		result: upstream.ok ? "ok" : "error",
		errorCode: upstream.ok ? "" : `upstream_${upstream.status}`,
	}, request);

	const headers = new Headers(CORS_HEADERS);
	const contentType = upstream.headers.get("Content-Type");
	if (contentType) headers.set("Content-Type", contentType);
	const responseBody = instrumentCompletionBody(upstream.body, env, ctx, metricBase, request, Boolean(contentType?.includes("text/event-stream")));
	return new Response(responseBody, { status: upstream.status, headers });
}

function telemetryData(payload) {
	const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
	return {
		source: telemetrySource(data),
		extensionVersion: compactString(payload.extension_version || data.extension_version, 40),
		runtimeRevision: compactString(payload.runtime_revision || data.runtime_revision, 80),
		authMode: compactString(data.auth_mode, 40),
		aiProvider: compactString(data.ai_provider, 80),
		aiModel: compactString(data.ai_model, 120),
		result: compactString(data.result, 48),
		errorCode: compactString(data.error_kind || data.error_code, 80),
		turnId: compactIdentifier(data.turn_id || data.turnId, 80),
		sessionId: compactIdentifier(data.session_id || data.sessionId, 80),
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

function telemetrySource(data) {
	const source = compactString(data?.source, 48);
	return /^extension(?:-[A-Za-z0-9_.:-]+)?$/.test(source) ? source : "extension";
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
	MAX_BODY_BYTES,
	QUOTA_BYPASS_HEADER,
	prepareOpenRouterRequestBody,
	quotaBypassAuthorized,
	shouldRetryUpstreamResponse,
	timingSafeEqualText,
	upstreamCandidateModelsForRequestBody,
	valueContainsImage,
	routedModelForRequestBody,
};
