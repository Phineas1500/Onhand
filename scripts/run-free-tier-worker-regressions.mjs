import assert from "node:assert/strict";
import worker, { __freeTierTest } from "../workers/free-tier/src/index.mjs";

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



// Exercise the real request/stream handlers. Only the external provider and
// bindings are mocked; no production credentials or model calls are used.
const { DailyCostLedger } = await import("../workers/free-tier/src/daily-cost-ledger.mjs");
class MemoryStorage {
	values = new Map();
	alarmAt = null;
	tail = Promise.resolve();
	async get(key) { return structuredClone(this.values.get(key)); }
	async put(key, value) {
		for (const [k, v] of typeof key === "string" ? [[key, value]] : Object.entries(key)) this.values.set(k, structuredClone(v));
	}
	async delete(key) { return this.values.delete(key); }
	async list({ prefix = "", limit = Infinity } = {}) {
		return new Map([...this.values].filter(([key]) => key.startsWith(prefix)).slice(0, limit).map(([k, v]) => [k, structuredClone(v)]));
	}
	async getAlarm() { return this.alarmAt; }
	async setAlarm(at) { this.alarmAt = at; }
	async deleteAll() { this.values.clear(); this.alarmAt = null; }
	async transaction(fn) {
		const run = this.tail.then(async () => {
			const before = structuredClone(this.values);
			const alarm = this.alarmAt;
			try { return await fn(this); }
			catch (error) { this.values = before; this.alarmAt = alarm; throw error; }
		});
		this.tail = run.catch(() => {});
		return await run;
	}
}

const token = "oft_worker_regression_fixture";
const day = new Date().toISOString().slice(0, 10);
const encoder = new TextEncoder();
const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;
const originalConsoleError = console.error;
let generationSequence = 0;
function fixture(startingCost = 0) {
	const data = new Map([[`token:${token}`, "{}"], [`cost:${day}`, String(startingCost)]]);
	const events = [];
	const tasks = [];
	const ledgers = new Map();
	const env = {
		OPENROUTER_API_KEY: "mock-only-no-real-network",
		DAILY_COST_CAP_USD: "5",
		FREE_TIER_KV: { get: async (key) => data.get(key) ?? null, put: async (key, value) => { data.set(key, value); } },
		ONHAND_ANALYTICS: { writeDataPoint: (point) => { events.push(point); } },
	};
	env.FREE_TIER_COST_LEDGER = {
		getByName(name) {
			if (!ledgers.has(name)) ledgers.set(name, new DailyCostLedger(new MemoryStorage(), env));
			return ledgers.get(name);
		},
	};
	return {
		env, data, events, ledgers,
		ctx: { waitUntil: (task) => { tasks.push(task); } },
		async flush() { for (let i = 0; i < tasks.length; i++) await tasks[i]; },
		async cost(targetDay = day) { return env.FREE_TIER_COST_LEDGER.getByName(targetDay).total(targetDay); },
	};
}
function chatRequest(stream = true, headers = {}) {
	return new Request("https://worker.test/v1/chat/completions", {
		method: "POST",
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Onhand-Turn-Id": "fixture-turn", ...headers },
		body: JSON.stringify({ model: FREE_TIER_TEXT_MODEL, stream, messages: [{ role: "user", content: "fixture" }] }),
	});
}
function completionPayload(cost = 0.25) {
	return { id: `gen-fixture-${++generationSequence}`, model: FREE_TIER_TEXT_MODEL,
		choices: [{ delta: { content: "fixture" } }], usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5, cost } };
}
function providerResponse(payload, kind = "complete") {
	if (kind === "json") return Response.json(payload);
	let pulls = 0;
	return new Response(new ReadableStream({ pull(controller) {
		if (pulls++ === 0) controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
		else if (kind === "error") controller.error(new Error("fixture stream disconnected"));
		else if (kind === "cancel") return new Promise(() => {});
		else controller.close();
	} }), { headers: { "Content-Type": "text/event-stream" } });
}
async function handle(f, stream = true, headers = {}) { return worker.fetch(chatRequest(stream, headers), f.env, f.ctx); }
function providerMock(payload, kind = "complete", metadata = { total_cost: 0.25 }) {
	return async (url, init) => {
		if (String(url).includes("/generation")) return Response.json({ data: { id: payload.id, ...metadata } });
		return providerResponse(payload, kind);
	};
}
try {
	for (const kind of ["complete", "json", "cancel", "error"]) {
		const f = fixture();
		globalThis.fetch = providerMock(completionPayload(), kind);
		const response = await handle(f, kind !== "json");
		assert.equal(response.status, 200);
		if (kind === "cancel") {
			const reader = response.body.getReader();
			await reader.read();
			// The stream has another reader.read pending when cancellation fires.
			await reader.cancel("fixture stop");
		} else if (kind === "error") await assert.rejects(response.text(), /disconnected/);
		else assert.match(await response.text(), /fixture/);
		await f.flush();
		assert.equal(await f.cost(), 0.25, `${kind}: charged response reaches daily total`);
		const terminal = f.events.filter((event) => ["chat_stream_complete", "chat_response_complete", "chat_stream_error", "chat_stream_cancelled"].includes(event.indexes[0]));
		assert.equal(terminal.length, 1, `${kind}: exactly one finalization even during pending-read cancellation`);
		assert.equal(terminal[0].doubles[9], 0.25);
	}

	// Incoming network abort and ReadableStream.cancel can both notify the same
	// response. Their pending-read race must still account and emit exactly once.
	{
		const f = fixture();
		globalThis.fetch = providerMock(completionPayload(), "cancel");
		const abort = new AbortController();
		const request = new Request(chatRequest(), { signal: abort.signal });
		const response = await worker.fetch(request, f.env, f.ctx);
		const reader = response.body.getReader();
		await reader.read();
		abort.abort();
		await reader.cancel();
		await f.flush();
		assert.equal(await f.cost(), 0.25);
		assert.equal(f.events.filter((event) => event.indexes[0] === "chat_stream_cancelled").length, 1);
	}

	// Cancelling a JSON body still collects its final usage, without forwarding
	// further bytes to the cancelled client.
	{
		const f = fixture();
		const payload = completionPayload();
		const bytes = encoder.encode(JSON.stringify(payload));
		let pull = 0;
		globalThis.fetch = async (url) => String(url).includes("/generation")
			? Response.json({ data: { id: payload.id, total_cost: 0.25 } })
			: new Response(new ReadableStream({ pull(c) { if (pull++ === 0) c.enqueue(bytes.slice(0, 12)); else if (pull === 2) c.enqueue(bytes.slice(12)); else c.close(); } }), { headers: { "Content-Type": "application/json" } });
		const reader = (await handle(f, false)).body.getReader();
		await reader.read();
		await reader.cancel();
		await f.flush();
		assert.equal(await f.cost(), 0.25);
		assert.equal(f.events.filter((event) => event.indexes[0] === "chat_stream_cancelled").length, 1);
	}

	// Parallel Worker requests share the same durable ledger and cannot overwrite
	// each other's charges. The next admission sees all completed costs.
	{
		const f = fixture(4.6);
		globalThis.fetch = async (url) => String(url).includes("/generation")
			? Response.json({ data: { id: new URL(url).searchParams.get("id"), total_cost: 0.25 } })
			: providerResponse(completionPayload());
		const responses = await Promise.all([handle(f), handle(f)]);
		await Promise.all(responses.map((r) => r.text()));
		await f.flush();
		assert.ok(Math.abs(await f.cost() - 5.1) < 1e-10);
		globalThis.fetch = async () => { throw new Error("Quota-denied request must not contact provider"); };
		assert.equal((await handle(f)).status, 429);
		assert.equal(f.data.get(`cost:${day}`), "4.6", "legacy KV is imported once and never used as the live ledger");
	}

	// Replaying the same provider generation (including a retried finalization)
	// may increase a provisional cost, but cannot add the whole cost twice.
	{
		const f = fixture(1);
		const ledger = f.env.FREE_TIER_COST_LEDGER.getByName(day);
		await Promise.all(Array.from({ length: 50 }, (_, i) => ledger.record({ day, id: "gen-same", cost: i % 2 ? 0.25 : 0.20 })));
		assert.equal(await ledger.total(day), 1.25);
		await ledger.record({ day, id: "gen-same", cost: 0.30 });
		assert.equal(await ledger.total(day), 1.30);
		await assert.rejects(ledger.total("2000-01-01"), /mismatch/);
	}

	// Terminal usage survives null metadata. If metadata is temporarily absent,
	// the DO alarm can add a later charge even after the Worker has finished.
	{
		const f = fixture();
		const payload = completionPayload();
		globalThis.fetch = providerMock(payload, "complete", { total_cost: null, usage: null });
		await (await handle(f)).text();
		await f.flush();
		assert.equal(await f.cost(), 0.25, "null metadata must not overwrite real usage with zero");
		const ledger = f.env.FREE_TIER_COST_LEDGER.getByName(day);
		assert.equal((await ledger.storage.list({ prefix: "pending:" })).size, 1);
		globalThis.fetch = async () => Response.json({ data: { id: payload.id, total_cost: 0.30 } });
		await ledger.alarm();
		await ledger.alarm();
		assert.equal(await f.cost(), 0.30, "only the missing delta is reconciled, once");
		assert.equal((await ledger.storage.list({ prefix: "pending:" })).size, 0);
		assert.equal(f.events.filter((e) => e.indexes[0] === "free_tier_cost_adjustment").length, 1);
		assert.ok(Math.abs(f.events.find((e) => e.indexes[0] === "free_tier_cost_adjustment").doubles[9] - 0.05) < 1e-10);
	}
	{
		const f = fixture();
		const payload = completionPayload(undefined);
		delete payload.usage;
		globalThis.fetch = providerMock(payload, "cancel", {});
		const reader = (await handle(f)).body.getReader();
		await reader.read(); await reader.cancel(); await f.flush();
		assert.equal(await f.cost(), 0);
		globalThis.fetch = async () => Response.json({ data: { id: payload.id, total_cost: 0.25 } });
		await f.env.FREE_TIER_COST_LEDGER.getByName(day).alarm();
		assert.equal(await f.cost(), 0.25, "cancelled generation with no terminal usage reconciles durably");
	}

	// Real zero-cost generations resolve without retries; metadata that never
	// becomes available stays visible for operators, then expires with the day.
	{
		const f = fixture();
		const ledger = f.env.FREE_TIER_COST_LEDGER.getByName(day);
		await ledger.record({ day, id: "gen-free", generationId: "gen-free", cost: 0, reconcile: true });
		globalThis.fetch = async () => Response.json({ data: { total_cost: 0 } });
		await ledger.alarm();
		assert.equal((await ledger.storage.list({ prefix: "pending:" })).size, 0);
		await ledger.record({ day, id: "gen-missing", generationId: "gen-missing", cost: 0.1, reconcile: true });
		globalThis.fetch = async () => Response.json({ data: {} });
		console.error = () => {};
		for (let i = 0; i < 12; i++) await ledger.alarm();
		console.error = originalConsoleError;
		assert.equal((await ledger.storage.list({ prefix: "pending:" })).size, 0);
		assert.equal((await ledger.storage.list({ prefix: "unresolved:" })).size, 1);
		assert.equal(await f.cost(), 0.1, "unresolved metadata cannot erase known usage");
		Date.now = () => Date.parse(`${day}T00:00:00Z`) + 7 * 24 * 60 * 60 * 1000;
		await ledger.alarm();
		assert.equal(ledger.storage.values.size, 0);
		assert.equal(ledger.storage.alarmAt, null);
		Date.now = originalDateNow;
	}

	// A DO RPC can commit its write and then lose the reply. Retry uses the same
	// generation identity and a fresh stub, so it cannot double charge.
	{
		const f = fixture();
		const ledger = f.env.FREE_TIER_COST_LEDGER.getByName(day);
		let attempts = 0;
		f.env.FREE_TIER_COST_LEDGER.getByName = () => ({
			total: (d) => ledger.total(d),
			async record(entry) {
				const result = await ledger.record(entry);
				if (++attempts === 1) throw new Error("fixture lost RPC reply after commit");
				return result;
			},
		});
		globalThis.fetch = providerMock(completionPayload());
		await (await handle(f)).text(); await f.flush();
		assert.equal(attempts, 2);
		assert.equal(await f.cost(), 0.25);
	}

	// Failure of optional analytics cannot suppress mandatory accounting.
	for (const analytics of [undefined, { writeDataPoint() { throw new Error("analytics unavailable"); } }]) {
		const f = fixture(); f.env.ONHAND_ANALYTICS = analytics;
		globalThis.fetch = providerMock(completionPayload());
		console.error = () => {};
		await (await handle(f)).text(); await f.flush();
		assert.equal(await f.cost(), 0.25);
		console.error = originalConsoleError;
	}

	// Requests admitted before midnight remain charged to their admission day.
	{
		const f = fixture();
		const beforeMidnight = Date.parse("2026-09-07T23:59:59Z");
		Date.now = () => beforeMidnight;
		globalThis.fetch = providerMock(completionPayload());
		const response = await handle(f);
		Date.now = () => beforeMidnight + 2_000;
		await response.text(); await f.flush();
		assert.equal(await f.cost("2026-09-07"), 0.25);
		assert.equal(await f.cost("2026-09-08"), 0);
		Date.now = originalDateNow;
	}

	// The intentional test-device bypass still excludes hosted cost and counters.
	{
		const f = fixture(5);
		const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
		Object.assign(f.env, { ONHAND_FREE_QUOTA_BYPASS_SECRET: bypassSecret, ONHAND_FREE_QUOTA_BYPASS_DEVICE_HASHES: hash, ONHAND_FREE_QUOTA_BYPASS_EXPIRES_AT: String(Date.now() + 60_000), DAILY_REQUEST_CAP: "0", TURN_MODEL_CALL_CAP: "0" });
		globalThis.fetch = providerMock(completionPayload());
		await (await handle(f, true, { [QUOTA_BYPASS_HEADER]: bypassSecret })).text(); await f.flush();
		assert.equal(await f.cost(), 5);
		assert.equal(f.events.find((e) => e.indexes[0] === "chat_stream_complete").blobs[1], "free-tier-bypass");
		assert.equal([...f.data.keys()].some((key) => key.startsWith("use:") || key.startsWith("turn-call:")), false);
	}
	{
		const f = fixture(); delete f.env.FREE_TIER_COST_LEDGER;
		globalThis.fetch = async () => { throw new Error("Missing ledger must fail closed"); };
		assert.equal((await handle(f)).status, 503);
	}
	console.log("Free-tier worker regressions: PASS (routing, streaming/JSON/cancel/error accounting, concurrency, idempotency, reconciliation, midnight, bypass, binding failure)");
} finally {
	globalThis.fetch = originalFetch;
	Date.now = originalDateNow;
	console.error = originalConsoleError;
}

if (process.env.ONHAND_MINIFLARE_MODULE) {
	const { runLocalWorkerRegressions } = await import("../workers/free-tier/tests/runtime-regressions.mjs");
	await runLocalWorkerRegressions(process.env.ONHAND_MINIFLARE_MODULE);
}
