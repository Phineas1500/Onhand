import assert from "node:assert/strict";
import { __freeTierTest } from "../workers/free-tier/src/index.mjs";

const { FREE_TIER_TEXT_MODEL, FREE_TIER_VISUAL_MODEL, routedModelForRequestBody, valueContainsImage } = __freeTierTest;

assert.equal(routedModelForRequestBody({ messages: [{ role: "user", content: "hello" }] }), FREE_TIER_TEXT_MODEL);

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

console.log("Free-tier worker regressions: PASS");
