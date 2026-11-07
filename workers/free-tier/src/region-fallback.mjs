// OpenAI doesn't serve every country and territory, and its terms warn that
// "offering access" outside its list can get the funding account blocked
// (https://developers.openai.com/api/docs/supported-countries). Requests from
// the places in REGION_FALLBACK_COUNTRIES go instead to a model whose makers
// serve them, through OpenRouter, pinned to vetted US hosts that don't collect
// data (the same host set the free tier used before the OpenAI migration).
// Mainland China stays off the list because its generative-AI rules cover
// foreign services offered there, and sanctioned countries stay off because
// US hosts can't serve them. Elsewhere an OpenAI region refusal becomes a
// clear message instead of OpenAI's raw error.
//
// DeepSeek V4.1 Flash was chosen 2026-10-25: on these hosts it read images,
// called tools, and matched GPT-6 Luna on docs/FREE_TIER_MODEL_EVAL.md's
// battery at a similar price. A Hong Kong user's first two questions had
// failed with OpenAI's 403.
import { clampOutputTokens } from "./openai-upstream.mjs";

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_REGION_FALLBACK_COUNTRIES = "HK,MO";
// Places OpenAI's list leaves out that the fallback doesn't take either:
// mainland China (see above), Russia, Belarus, Venezuela and the sanctioned
// countries (OpenAI's list as of 2026-11-07). These are refused up front, at
// registration and before any model call, so the user hears it when they pick
// Onhand Free instead of after their first question (a mainland China user's
// first question failed that way on 2026-11-07), and Onhand doesn't offer
// OpenAI's service where OpenAI doesn't. Anywhere else OpenAI refuses still
// gets REGION_UNAVAILABLE_MESSAGE through isOpenAIRegionRefusal.
export const DEFAULT_REGION_UNAVAILABLE_COUNTRIES = "CN,RU,BY,VE,IR,KP,SY,CU";
export const DEFAULT_REGION_FALLBACK_MODEL = "deepseek/deepseek-v4.1-flash-1017";
export const REGION_FALLBACK_PROVIDERS = ["deepinfra", "parasail", "novita", "together", "fireworks", "wandb"];
export const REGION_UNAVAILABLE_MESSAGE =
	"Onhand Free isn't available in your region, because OpenAI, which runs it, doesn't serve it there. To use Onhand, choose another AI provider in Onhand's settings.";

function requestCountryIn(request, list) {
	const country = String(request?.cf?.country || "").toUpperCase();
	if (!country) return false;
	return String(list)
		.split(",")
		.map((value) => value.trim().toUpperCase())
		.filter(Boolean)
		.includes(country);
}

export function regionFallbackModel(env, request) {
	if (!env?.OPENROUTER_API_KEY) return "";
	if (!requestCountryIn(request, env.REGION_FALLBACK_COUNTRIES ?? DEFAULT_REGION_FALLBACK_COUNTRIES)) return "";
	return String(env.REGION_FALLBACK_MODEL || DEFAULT_REGION_FALLBACK_MODEL).trim();
}

export function regionUnavailable(env, request) {
	if (regionFallbackModel(env, request)) return false;
	return requestCountryIn(request, env?.REGION_UNAVAILABLE_COUNTRIES ?? DEFAULT_REGION_UNAVAILABLE_COUNTRIES);
}

export function prepareRegionFallbackRequestBody(body, model) {
	const next = {};
	// The same allowlist as the OpenAI route, minus OpenAI-only fields: client
	// provider routing, model lists and transforms never reach OpenRouter.
	for (const key of ["messages", "tools", "tool_choice", "parallel_tool_calls", "response_format", "temperature", "top_p", "stop", "frequency_penalty", "presence_penalty", "seed"]) {
		if (Object.hasOwn(body, key)) next[key] = structuredClone(body[key]);
	}
	return Object.assign(next, {
		model,
		max_tokens: clampOutputTokens(body),
		n: 1,
		stream: body.stream === true,
		// Like the OpenAI route's reasoning_effort "none": by default the model
		// reasoned before every answer, spending about twice the output tokens.
		reasoning: { enabled: false },
		// Terminal usage carries OpenRouter's billed cost for the ledger.
		usage: { include: true },
		provider: { only: REGION_FALLBACK_PROVIDERS, data_collection: "deny" },
	});
}

export function isOpenAIRegionRefusal(status, text) {
	return status === 403 && String(text || "").includes("unsupported_country_region_territory");
}

export function openRouterUsageCost(usage) {
	const cost = usage?.cost;
	return Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}
