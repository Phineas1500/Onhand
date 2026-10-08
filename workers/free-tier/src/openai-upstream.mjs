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

// Decisions (https://developers.openai.com/api/docs/guides/decisions): bills
// input tokens only, at the model's input rate. Only text input and the three
// question kinds cross to OpenAI; images, files and other fields are refused,
// which bounds what one call can cost.
export const OPENAI_DECISIONS_URL = "https://api.openai.com/v1/decisions";
export const MAX_DECISIONS_QUESTIONS = 16;
export const MAX_DECISIONS_INPUT_CHARS = 24_000;

export function prepareDecisionsRequestBody(body) {
	if (!body || typeof body !== "object" || body.model !== FREE_TIER_MODEL) return null;
	const text = (value, max) => (typeof value === "string" && value.trim() && value.length <= max ? value : null);
	const input = text(body.input, MAX_DECISIONS_INPUT_CHARS);
	const questions = Array.isArray(body.questions) ? body.questions : [];
	if (!input || !questions.length || questions.length > MAX_DECISIONS_QUESTIONS) return null;
	const prepared = [];
	for (const question of questions) {
		const type = question?.type;
		const name = text(question?.name, 64);
		const instructions = text(question?.instructions, 2_000);
		if (!["predicate", "choice", "score"].includes(type) || !name || !instructions) return null;
		const item = { type, name, instructions };
		const options = type === "choice" ? question.choices : type === "score" ? question.levels : null;
		if (options) {
			if (!Array.isArray(options) || options.length < 2 || options.length > 16) return null;
			const key = type === "choice" ? "value" : "label";
			const cleaned = options.map((option) => {
				const value = text(option?.[key], 64);
				const description = option?.description === undefined ? undefined : text(option.description, 500);
				return value && description !== null ? { [key]: value, ...(description ? { description } : {}) } : null;
			});
			if (cleaned.some((option) => !option)) return null;
			item[type === "choice" ? "choices" : "levels"] = cleaned;
		} else if (type !== "predicate") return null;
		prepared.push(item);
	}
	return { model: FREE_TIER_MODEL, input, questions: prepared };
}

export function decisionsUsageCost(usage) {
	const input = usage?.input_tokens;
	if (!Number.isSafeInteger(input) || input < 0) return undefined;
	return (input * (input > 272_000 ? 0.20 : 0.10)) / 1_000_000;
}
