// Official API contract and Standard pricing verified 2026-09-22:
// https://developers.openai.com/api/docs/models/gpt-6-luna
// https://developers.openai.com/api/docs/pricing
// https://developers.openai.com/api/docs/guides/prompt-caching
export const FREE_TIER_MODEL = "gpt-6-luna";
export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
export const MAX_OUTPUT_TOKENS = 16_384;
// Existing published extensions keep working across the server rollout.
export const ALLOWED_CLIENT_MODELS = new Set([FREE_TIER_MODEL, "openai/gpt-5.6-luna"]);

export function prepareOpenAIRequestBody(body) {
	const next = {};
	// An allowlist prevents provider routing, billing tiers, or unsupported
	// OpenRouter parameters from crossing into the official API.
	for (const key of ["messages", "tools", "tool_choice", "parallel_tool_calls", "response_format", "temperature", "top_p", "stop", "frequency_penalty", "presence_penalty", "seed", "verbosity"]) {
		if (Object.hasOwn(body, key)) next[key] = structuredClone(body[key]);
	}
	const requested = Number(body.max_completion_tokens ?? body.max_tokens);
	Object.assign(next, {
		model: FREE_TIER_MODEL,
		max_completion_tokens: Number.isFinite(requested) && requested > 0 ? Math.max(1, Math.min(Math.floor(requested), MAX_OUTPUT_TOKENS)) : MAX_OUTPUT_TOKENS,
		n: 1,
		store: false,
		service_tier: "default",
		// GPT-6 Luna function calling on Chat Completions requires none.
		reasoning_effort: "none",
		stream: body.stream === true,
	});
	if (next.stream) next.stream_options = { include_usage: true };
	return next;
}

export function openAIUsageCost(usage) {
	const input = usage?.prompt_tokens;
	const output = usage?.completion_tokens;
	const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
	const written = usage?.prompt_tokens_details?.cache_write_tokens ?? 0;
	if (![input, output, cached, written].every((v) => Number.isSafeInteger(v) && v >= 0) || cached + written > input) return undefined;
	const longContext = input > 272_000;
	const inputRate = longContext ? 0.20 : 0.10;
	const outputRate = longContext ? 0.75 : 0.50;
	return ((input - cached - written) * inputRate + cached * inputRate * 0.1 + written * inputRate * 1.25 + output * outputRate) / 1_000_000;
}
