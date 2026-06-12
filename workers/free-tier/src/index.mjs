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
const MAX_OUTPUT_TOKENS = 16_384;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

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

async function bumpDailyCounter(env, key, cap) {
	const current = Number((await env.FREE_TIER_KV.get(key)) || 0);
	if (current >= cap) return { allowed: false, current };
	// get+put is racy under parallel requests; for a per-device daily cap
	// the worst case is a couple of extra requests, which is fine.
	await env.FREE_TIER_KV.put(key, String(current + 1), { expirationTtl: 60 * 60 * 48 });
	return { allowed: true, current: current + 1 };
}

async function handleRegister(request, env) {
	const cap = Number(env.REGISTRATIONS_PER_IP_PER_DAY || 5);
	const ipKey = `reg:${clientIp(request)}:${todayKey()}`;
	const { allowed } = await bumpDailyCounter(env, ipKey, cap);
	if (!allowed) {
		return json(429, { error: { message: "Too many free-tier registrations from this network today. Try again tomorrow or use your own API key." } });
	}
	const token = `oft_${crypto.randomUUID().replaceAll("-", "")}`;
	await env.FREE_TIER_KV.put(`token:${token}`, JSON.stringify({ createdAt: new Date().toISOString() }));
	return json(200, { token });
}

async function handleChatCompletions(request, env) {
	const auth = request.headers.get("Authorization") || "";
	const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
	if (!token || !token.startsWith("oft_")) {
		return json(401, { error: { message: "Missing free-tier token. The Onhand extension registers one automatically; try re-selecting Onhand Free in options." } });
	}
	const known = await env.FREE_TIER_KV.get(`token:${token}`);
	if (!known) {
		return json(401, { error: { message: "Unknown free-tier token. Re-select Onhand Free in the extension options to register again." } });
	}

	const cap = Number(env.DAILY_REQUEST_CAP || 80);
	const usage = await bumpDailyCounter(env, `use:${token}:${todayKey()}`, cap);
	if (!usage.allowed) {
		return json(429, {
			error: {
				message: "You've reached today's Onhand Free limit. It resets tomorrow — or switch to your own API key in options for unlimited use.",
			},
		});
	}

	const raw = await request.text();
	if (raw.length > MAX_BODY_BYTES) {
		return json(413, { error: { message: "Request too large for the free tier." } });
	}
	let body;
	try {
		body = JSON.parse(raw);
	} catch {
		return json(400, { error: { message: "Request body must be JSON." } });
	}
	if (!ALLOWED_MODELS.has(String(body.model || ""))) {
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

	const headers = new Headers(CORS_HEADERS);
	const contentType = upstream.headers.get("Content-Type");
	if (contentType) headers.set("Content-Type", contentType);
	return new Response(upstream.body, { status: upstream.status, headers });
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}
		if (request.method === "POST" && url.pathname === "/v1/register") {
			return await handleRegister(request, env);
		}
		if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
			return await handleChatCompletions(request, env);
		}
		return json(404, { error: { message: "Not found." } });
	},
};
