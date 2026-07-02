import assert from "node:assert/strict";
import { __freeTierTest } from "../workers/free-tier/src/index.mjs";

const {
	FREE_TIER_TEXT_MODEL,
	FREE_TIER_VISUAL_MODEL,
	MAX_BODY_BYTES,
	QUOTA_BYPASS_HEADER,
	prepareOpenRouterRequestBody,
	quotaBypassAuthorized,
	shouldRetryUpstreamResponse,
	routedModelForRequestBody,
	timingSafeEqualText,
	upstreamCandidateModelsForRequestBody,
	valueContainsImage,
} = __freeTierTest;

assert.equal(MAX_BODY_BYTES, 2_500_000, "free-tier visual requests should have room for compressed image payloads");

const textOnlyBody = { messages: [{ role: "user", content: "hello" }] };
assert.equal(routedModelForRequestBody(textOnlyBody), FREE_TIER_TEXT_MODEL);
assert.deepEqual(upstreamCandidateModelsForRequestBody(textOnlyBody), [FREE_TIER_TEXT_MODEL, FREE_TIER_VISUAL_MODEL]);

assert.equal(
	routedModelForRequestBody({
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "What does this show?" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,VklTVUFM" } },
				],
			},
		],
	}),
	FREE_TIER_VISUAL_MODEL,
);
assert.deepEqual(
	upstreamCandidateModelsForRequestBody({
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "What does this show?" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,VklTVUFM" } },
				],
			},
		],
	}),
	[FREE_TIER_VISUAL_MODEL],
);

assert.equal(
	routedModelForRequestBody({
		messages: [
			{ role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "browser_get_visible_region_image", arguments: "{}" } }] },
			{ role: "tool", tool_call_id: "call_1", content: "Captured visible region image." },
			{
				role: "user",
				content: [
					{ type: "text", text: "Attached image(s) from tool result:" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,VklTVUFM" } },
				],
			},
		],
	}),
	FREE_TIER_VISUAL_MODEL,
);

assert.equal(valueContainsImage({ type: "image", data: "VklTVUFM", mimeType: "image/png" }), true);
assert.equal(valueContainsImage({ nested: [{ data: "VklTVUFM", media_type: "image/png" }] }), true);
assert.equal(valueContainsImage({ nested: [{ data: "VklTVUFM", mimeType: "text/plain" }] }), false);

const prepared = prepareOpenRouterRequestBody({ ...textOnlyBody, model: "bad/model", max_tokens: 999999, transforms: ["middle-out"] }, FREE_TIER_VISUAL_MODEL);
assert.equal(prepared.model, FREE_TIER_VISUAL_MODEL);
assert.equal(prepared.max_tokens, 16384);
assert.deepEqual(prepared.provider, { only: ["deepinfra", "parasail", "novita", "wandb"] });
assert.equal(Object.hasOwn(prepared, "transforms"), false);
assert.equal(shouldRetryUpstreamResponse(new Response("missing", { status: 404 }), 0, [FREE_TIER_TEXT_MODEL, FREE_TIER_VISUAL_MODEL]), true);
assert.equal(shouldRetryUpstreamResponse(new Response("bad", { status: 500 }), 0, [FREE_TIER_TEXT_MODEL, FREE_TIER_VISUAL_MODEL]), false);
assert.equal(shouldRetryUpstreamResponse(new Response("missing", { status: 404 }), 1, [FREE_TIER_TEXT_MODEL, FREE_TIER_VISUAL_MODEL]), false);

const bypassSecret = "dev-bypass-secret-123456";
const bypassDeviceHash = "devicehash123";
const bypassEnv = {
	ONHAND_FREE_QUOTA_BYPASS_SECRET: bypassSecret,
	ONHAND_FREE_QUOTA_BYPASS_DEVICE_HASHES: bypassDeviceHash,
	ONHAND_FREE_QUOTA_BYPASS_EXPIRES_AT: String(Date.now() + 60_000),
};
const requestWithBypass = (value) =>
	new Request("https://example.test/v1/chat/completions", {
		headers: value ? { [QUOTA_BYPASS_HEADER]: value } : {},
	});

assert.equal(timingSafeEqualText(bypassSecret, bypassSecret), true);
assert.equal(timingSafeEqualText(bypassSecret, "dev-bypass-secret-000000"), false);
assert.equal(quotaBypassAuthorized(requestWithBypass(bypassSecret), bypassEnv, bypassDeviceHash), true);
assert.equal(quotaBypassAuthorized(requestWithBypass("wrong"), bypassEnv, bypassDeviceHash), false);
assert.equal(quotaBypassAuthorized(requestWithBypass(bypassSecret), { ...bypassEnv, ONHAND_FREE_QUOTA_BYPASS_SECRET: "short" }, bypassDeviceHash), false);
assert.equal(quotaBypassAuthorized(requestWithBypass(""), bypassEnv, bypassDeviceHash), false);
assert.equal(quotaBypassAuthorized(requestWithBypass(bypassSecret), { ...bypassEnv, ONHAND_FREE_QUOTA_BYPASS_DEVICE_HASHES: "" }, bypassDeviceHash), false);
assert.equal(quotaBypassAuthorized(requestWithBypass(bypassSecret), bypassEnv, "other-device"), false);
assert.equal(quotaBypassAuthorized(requestWithBypass(bypassSecret), { ...bypassEnv, ONHAND_FREE_QUOTA_BYPASS_EXPIRES_AT: String(Date.now() - 60_000) }, bypassDeviceHash), false);

console.log("Free-tier worker regressions: PASS");
