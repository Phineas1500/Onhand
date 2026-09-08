import assert from "node:assert/strict";
import { DailyCostLedger } from "../src/daily-cost-ledger.mjs";

export async function runAdmissionRegressions({ fixture, handle, providerMock, providerResponse, completionPayload, worker, day, token }) {
	const originalFetch = globalThis.fetch;
	const originalNow = Date.now;
	const originalError = console.error;
	const input = (id, options = {}) => ({ day, id, deviceHash: "device", dailyKey: "daily", turnKey: "turn", dailyCap: 100,
		turnCap: 100, costCap: 5, reserve: 0.25, concurrencyCap: 4, deviceConcurrencyCap: 2, ...options });
	try {
		for (const capName of ["DAILY_REQUEST_CAP", "TURN_MODEL_CALL_CAP"]) {
			const f = fixture();
			Object.assign(f.env, { [capName]: "1", DEVICE_CONCURRENT_REQUEST_CAP: "50", CONCURRENT_REQUEST_CAP: "50" });
			let calls = 0;
			globalThis.fetch = async (url) => String(url).includes("/generation") ? Response.json({ data: { total_cost: 0.25 } })
				: (calls++, providerResponse(completionPayload()));
			const responses = await Promise.all(Array.from({ length: 20 }, () => handle(f)));
			await Promise.all(responses.map((r) => r.text())); await f.flush();
			assert.equal(calls, 1, `${capName}: a burst cannot bypass the counter`);
			assert.equal(responses.filter((r) => r.status === 200).length, 1);
			assert.equal(await f.cost(), 0.25);
		}
		{
			const f = fixture(4.9); let calls = 0;
			globalThis.fetch = async () => { calls++; throw new Error("No budget reserved"); };
			const responses = await Promise.all(Array.from({ length: 20 }, () => handle(f)));
			assert.equal(calls, 0); assert.ok(responses.every((r) => r.status === 429));
			assert.equal(await f.cost(), 4.9);
		}
		{
			const f = fixture(); const ledger = f.env.FREE_TIER_COST_LEDGER.getByName(day);
			const admitted = await Promise.all(Array.from({ length: 20 }, (_, i) => ledger.admit(input(`burst-${i}`, { deviceHash: `device-${i}` }))));
			assert.equal(admitted.filter((r) => r.allowed).length, 4, "global concurrent admission is atomic");
			assert.equal(await ledger.storage.get("active"), 4);
			assert.equal(await ledger.storage.get("reserved"), 1);
			assert.equal(await ledger.total(day), 0, "reserved dollars are not reported as actual cost");
			await ledger.settle({ day, id: "burst-0", noCharge: true });
			assert.equal((await ledger.admit(input("after-release", { deviceHash: "new-device" }))).allowed, true);
		}
		{
			const f = fixture(); const ledger = f.env.FREE_TIER_COST_LEDGER.getByName(day);
			const results = await Promise.all(Array.from({ length: 20 }, () => ledger.admit(input("same-id"))));
			assert.ok(results.every((r) => r.allowed));
			assert.equal(await ledger.storage.get("active"), 1);
			assert.equal(await ledger.storage.get("reserved"), 0.25);
			const next = await ledger.admit(input("second"));
			assert.equal(next.current, 2, "retried admission uses one daily/turn quota unit");
			assert.equal((await ledger.admit(input("third"))).reason, "concurrency_cap");
		}
		{
			const f = fixture(); const ledger = f.env.FREE_TIER_COST_LEDGER.getByName(day);
			const normalGet = f.env.FREE_TIER_COST_LEDGER.getByName;
			let attempts = 0;
			f.env.FREE_TIER_COST_LEDGER.getByName = (name) => name !== day ? normalGet(name) : {
				async admit(value) { const result = await ledger.admit(value); if (++attempts === 1) throw new Error("lost admission reply"); return result; },
				observe: (value) => ledger.observe(value), settle: (value) => ledger.settle(value),
			};
			globalThis.fetch = providerMock(completionPayload());
			await (await handle(f)).text(); await f.flush();
			assert.equal(attempts, 2);
			assert.equal((await ledger.storage.list({ prefix: "request:" })).size, 1, "lost admission RPC reply cannot reserve twice");
			assert.equal(await ledger.total(day), 0.25);
		}
		{
			const f = fixture(); const ledger = f.env.FREE_TIER_COST_LEDGER.getByName(day);
			f.data.set("legacy-counter", "2");
			const results = await Promise.all(Array.from({ length: 20 }, () => ledger.increment({ day, key: "legacy-counter", cap: 3 })));
			assert.equal(results.filter((r) => r.allowed).length, 1, "legacy counts import once during concurrency");
			assert.equal(f.data.get("legacy-counter"), "2", "stale KV is never authoritative after import");
		}
		for (const route of ["register", "telemetry", "error-reports"]) {
			const f = fixture(); Object.assign(f.env, { REGISTRATIONS_PER_IP_PER_DAY: "3", TELEMETRY_EVENTS_PER_IP_PER_DAY: "3", ERROR_REPORTS_PER_IP_PER_DAY: "3" });
			const responses = await Promise.all(Array.from({ length: 20 }, () => worker.fetch(new Request(`https://fixture.test/v1/${route}`, {
				method: "POST", headers: { "CF-Connecting-IP": "192.0.2.1" }, body: JSON.stringify({ event_name: "prompt_submitted", report_type: "prompt_error", error_kind: "fixture" }),
			}), f.env, f.ctx)));
			const bodies = await Promise.all(responses.map((r) => r.json())); await f.flush();
			if (route === "register") assert.equal(responses.filter((r) => r.status === 200).length, 3);
			else if (route === "telemetry") assert.equal(bodies.filter((body) => body.accepted).length, 3);
			else assert.equal(bodies.filter((body) => body.reason === "rate_limited").length, 17);
		}
		for (const route of ["register", "telemetry", "error-reports"]) {
			const f = fixture(); delete f.env.FREE_TIER_COST_LEDGER;
			console.error = () => {};
			const response = await worker.fetch(new Request(`https://fixture.test/v1/${route}`, { method: "POST", body: "{}" }), f.env, f.ctx);
			console.error = originalError;
			assert.equal(response.status, route === "register" ? 503 : 202);
			const result = await response.json();
			assert.ok(!result.token && !result.accepted, "a quota outage cannot accept a request through KV fallback");
		}
		{
			const f = fixture(); let metadataDone;
			globalThis.fetch = async (url) => String(url).includes("/generation") ? new Promise((resolve) => { metadataDone = resolve; }) : providerResponse(completionPayload());
			await (await handle(f)).text();
			assert.equal(await f.cost(), 0.25, "terminal usage is durable while metadata is still pending");
			const ledger = f.env.FREE_TIER_COST_LEDGER.getByName(day);
			assert.equal(await ledger.storage.get("active"), 0, "EOF releases capacity without waiting for metadata");
			metadataDone(Response.json({ data: { total_cost: 0.25 } })); await f.flush();
		}
		{
			const f = fixture(); const ledger = f.env.FREE_TIER_COST_LEDGER.getByName(day);
			await ledger.admit(input("provisional"));
			await ledger.settle({ day, id: "provisional", cost: 0.2 });
			await ledger.observe({ day, id: "provisional", generationId: "gen-late" });
			await ledger.settle({ day, id: "provisional", generationId: "gen-late", cost: 0.2, resolved: true });
			assert.equal(await ledger.total(day), 0.2, "late generation identity does not double charge provisional usage");
			await ledger.settle({ day, id: "provisional", generationId: "gen-late", cost: 0.25, resolved: true });
			assert.equal(await ledger.total(day), 0.25);
			await ledger.admit(input("same-generation"));
			await ledger.settle({ day, id: "same-generation", cost: 0.2 });
			await ledger.settle({ day, id: "same-generation", generationId: "gen-late", cost: 0.25, resolved: true });
			assert.equal(await ledger.total(day), 0.25, "late identity also merges with an already-recorded generation");
		}
		{
			const f = fixture(); const ledger = f.env.FREE_TIER_COST_LEDGER.getByName(day);
			await ledger.admit(input("crash-before-id"));
			Date.now = () => originalNow() + 6 * 60_000;
			const restarted = new DailyCostLedger(ledger.storage, f.env);
			await restarted.alarm();
			assert.equal((await restarted.admit(input("crash-before-id"))).allowed, false, "an expired admission cannot be replayed into another provider call");
			assert.equal(await ledger.storage.get("active"), 0);
			assert.equal(await ledger.storage.get("reserved"), 0.25, "unknown provider outcomes retain budget after capacity lease expires");
			assert.equal((await ledger.storage.list({ prefix: "unresolved:" })).size, 1);
			await restarted.observe({ day, id: "crash-before-id", generationId: "gen-after-lease" });
			globalThis.fetch = async () => Response.json({ data: { total_cost: 0.15 } });
			await restarted.alarm();
			assert.equal(await ledger.total(day), 0.15, "late identity schedules recovery after the old lease was deleted");
			assert.equal(await ledger.storage.get("reserved"), 0);
			Date.now = originalNow;
		}
		{
			const f = fixture(); const ledger = f.env.FREE_TIER_COST_LEDGER.getByName(day);
			const normalGet = f.env.FREE_TIER_COST_LEDGER.getByName;
			let failedWrites = 0;
			f.env.FREE_TIER_COST_LEDGER.getByName = (name) => name !== day ? normalGet(name) : {
				admit: (value) => ledger.admit(value), observe: (value) => ledger.observe(value),
				settle: async () => { failedWrites++; throw new Error("fixture outage after provider acceptance"); },
			};
			globalThis.fetch = providerMock(completionPayload()); console.error = () => {};
			await (await handle(f)).text(); await f.flush(); console.error = originalError;
			assert.equal(failedWrites, 3);
			assert.equal(await ledger.total(day), 0);
			assert.equal(await ledger.storage.get("reserved"), 0.25);
			const rows = [...(await ledger.storage.list({ prefix: "request:" })).values()];
			assert.match(rows[0].generationId, /^gen-/, "generation survives a total accounting RPC outage");
			Date.now = () => originalNow() + 6 * 60_000;
			await new DailyCostLedger(ledger.storage, f.env).alarm();
			assert.equal(await ledger.total(day), 0.25);
			assert.equal(await ledger.storage.get("reserved"), 0);
			Date.now = originalNow;
		}
		for (const status of [400, 500, "network"]) {
			const f = fixture();
			globalThis.fetch = async () => { if (status === "network") throw new Error("ambiguous dispatch failure"); return Response.json({ error: "fixture" }, { status }); };
			const response = await handle(f); await response.text(); await f.flush();
			const ledger = f.env.FREE_TIER_COST_LEDGER.getByName(day);
			assert.equal(await ledger.storage.get("active"), 0);
			assert.equal(await ledger.storage.get("reserved"), status === 400 ? 0 : 0.25, "only known rejection releases unknown usage");
		}
		{
			const f = fixture(); const abort = new AbortController();
			let dispatched;
			const started = new Promise((resolve) => { dispatched = resolve; });
			globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
				init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
				dispatched();
			});
			const result = worker.fetch(new Request("https://fixture.test/v1/chat/completions", { method: "POST", signal: abort.signal,
				headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ model: "openai/gpt-5.6-luna" }) }), f.env, f.ctx);
			await started; abort.abort();
			assert.equal((await result).status, 502); await f.flush();
			const ledger = f.env.FREE_TIER_COST_LEDGER.getByName(day);
			assert.equal(await ledger.storage.get("active"), 0, "Stop before provider headers promptly releases active capacity");
			assert.equal(await ledger.storage.get("reserved"), 0.25, "pre-header cancellation remains an uncertain provider charge");
		}
		{
			const f = fixture();
			const cancelled = new AbortController(); cancelled.abort();
			globalThis.fetch = async () => { throw new Error("cancelled request must not dispatch"); };
			const response = await worker.fetch(new Request("https://fixture.test/v1/chat/completions", { method: "POST", signal: cancelled.signal,
				headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ model: "openai/gpt-5.6-luna" }) }), f.env, f.ctx);
			assert.equal(response.status, 499); assert.equal(f.ledgers.size, 0);
		}
		console.log("Hosted admission regressions: PASS (quota bursts, atomic reservations, capacity, retry identity, legacy import, usage-before-metadata, provisional charges, restart/late-ID recovery, accounting outage, uncertain errors, cancellation)");
	} finally { globalThis.fetch = originalFetch; Date.now = originalNow; console.error = originalError; }
}
