// Synthetic live checks only; never reads browser content or prints credentials.
// Direct: node scripts/run-free-tier-openai-smoke.mjs
// Hosted: node --env-file=.env scripts/run-free-tier-openai-smoke.mjs --hosted
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { prepareOpenAIRequestBody, openAIUsageCost } from "../workers/free-tier/src/openai-upstream.mjs";

const hosted = process.argv.includes("--hosted");
const base = (hosted ? process.env.ONHAND_FREE_TIER_BASE_URL : "https://api.openai.com/v1")?.replace(/\/+$/, "");
assert.ok(base, "Missing ONHAND_FREE_TIER_BASE_URL");
let key = process.env.OPENAI_API_KEY;
if (hosted) {
	const registration = await fetch(`${base}/register`, { method: "POST", signal: AbortSignal.timeout(30_000) });
	assert.equal(registration.status, 200, "Hosted registration failed");
	key = (await registration.json()).token;
}
assert.ok(key, "Missing API key or hosted token");
const results = [];
async function request(body) {
	const started = performance.now();
	const upstream = prepareOpenAIRequestBody(body);
	// Exercise both the new client ID and published extension compatibility.
	if (hosted && body.model) upstream.model = body.model;
	const response = await fetch(`${base}/chat/completions`, {
		method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Onhand-Turn-Id": `luna-smoke-${Date.now()}` },
		body: JSON.stringify(upstream), signal: AbortSignal.timeout(60_000),
	});
	assert.equal(response.status, 200, `Completion failed: ${await (response.ok ? Promise.resolve("") : response.text())}`);
	const text = await response.text();
	const payloads = body.stream ? text.split(/\r?\n/).filter((l) => l.startsWith("data:") && !l.includes("[DONE]")).map((l) => JSON.parse(l.slice(5))) : [JSON.parse(text)];
	assert.ok(payloads.some((p) => p.model === "gpt-6-luna"), "Must return the exact requested model");
	const usage = payloads.findLast((p) => p.usage)?.usage;
	assert.ok(openAIUsageCost(usage) !== undefined, "Final token usage must support accounting");
	results.push({ model: "gpt-6-luna", stream: Boolean(body.stream), latencyMs: Math.round(performance.now() - started), usage, estimatedCostUsd: openAIUsageCost(usage) });
	return payloads;
}

// A small generated red PNG tests the actual image-input route.
function pngChunk(type, data) {
	const content = Buffer.concat([Buffer.from(type), data]);
	let crc = 0xffffffff;
	for (const byte of content) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
	const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
	const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
	return Buffer.concat([size, content, checksum]);
}
const header = Buffer.alloc(13); header.writeUInt32BE(32, 0); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 2;
const pixels = Buffer.alloc(32 * (1 + 32 * 3));
for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) pixels[y * 97 + 1 + x * 3] = 255;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(pixels)), pngChunk("IEND", Buffer.alloc(0))]);
const vision = await request({ model: "openai/gpt-5.6-luna", max_tokens: 64, messages: [{ role: "user", content: [{ type: "text", text: "Name the dominant color of this image in one word." }, { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } }] }] });
assert.match(vision[0].choices[0].message.content, /red/i);

const messages = [{ role: "user", content: "Use lookup_fixture_fact to retrieve the verification code, then repeat that code exactly." }];
const tools = [{ type: "function", function: { name: "lookup_fixture_fact", description: "Retrieve the verification code.", parameters: { type: "object", properties: {}, additionalProperties: false } } }];
const chunks = await request({ stream: true, messages, tools, max_tokens: 128 });
let id = "", name = "", args = "";
for (const chunk of chunks) for (const call of chunk.choices?.[0]?.delta?.tool_calls || []) { id ||= call.id || ""; name += call.function?.name || ""; args += call.function?.arguments || ""; }
assert.equal(name, "lookup_fixture_fact"); assert.ok(id); assert.deepEqual(JSON.parse(args), {});
messages.push({ role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name, arguments: args } }] });
messages.push({ role: "tool", tool_call_id: id, content: "The verification code is aqua-47." });
const followup = await request({ messages, tools, max_tokens: 128 });
assert.match(followup[0].choices[0].message.content, /aqua-47/);
console.log(JSON.stringify({ hosted, checks: ["vision", "streamed_function_call", "tool_result_continuation", "terminal_usage"], results }, null, 2));
