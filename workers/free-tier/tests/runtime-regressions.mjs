import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

export async function runLocalWorkerRegressions(modulePath) {
	const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(modulePath).href);
	const entry = fileURLToPath(new URL("../src/worker.mjs", import.meta.url));
	const { outputFiles } = await build({
		stdin: {
			contents: `import worker from ${JSON.stringify(entry)};
				export { FreeTierCostLedger } from ${JSON.stringify(entry)};
				const events = [];
				export default { async fetch(request, env, ctx) {
					if (new URL(request.url).pathname === "/fixture-events") {
						return Response.json(events);
					}
					if (new URL(request.url).pathname === "/fixture-ledger") {
						const input = await request.json();
						const stub = env.FREE_TIER_COST_LEDGER.getByName(input.day);
						if (["admit", "settle", "observe", "increment"].includes(input.op)) return Response.json((await stub[input.op](input)) ?? null);
						return Response.json(input.id ? await stub.record(input) : { total: await stub.total(input.day) });
					}
					return worker.fetch(request, {
						...env,
						ONHAND_ANALYTICS: { writeDataPoint(point) { events.push(point.indexes[0]); } },
					}, ctx);
				} };`,
			resolveDir: process.cwd(), sourcefile: "worker-accounting-fixture.mjs",
		},
		bundle: true, format: "esm", platform: "browser", external: ["cloudflare:workers"], write: false,
	});
	let generation = 0;
	const options = (cap = "5") => {
		const v4 = {
			modules: true, script: outputFiles[0].text, compatibilityDate: "2026-05-01",
			compatibilityFlags: ["enable_request_signal"],
			unsafeDirectSockets: [{ host: "127.0.0.1", port: 0 }],
			kvNamespaces: ["FREE_TIER_KV"],
			durableObjects: { FREE_TIER_COST_LEDGER: { className: "FreeTierCostLedger", useSQLite: true } },
			bindings: { OPENROUTER_API_KEY: "test-only", DAILY_COST_CAP_USD: cap },
			outboundService: async (request) => {
				const url = new URL(request.url);
				assert.equal(url.host, "openrouter.ai", "all upstream requests are intercepted locally");
				if (url.pathname.endsWith("/generation")) return Response.json({ data: { id: url.searchParams.get("id"), total_cost: 0.25 } });
				const input = await request.json();
				const payload = { id: `gen-runtime-${++generation}`, usage: { cost: 0.25 }, choices: [] };
				if (input.messages?.[0]?.content === "disconnect-fixture") {
					let cancelled = false;
					let remainingChunks = 20;
					return new Response(new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ id: payload.id, choices: [{ delta: { content: "first" } }] })}\n\n`));
						},
						async pull(controller) {
							await new Promise((resolve) => setTimeout(resolve, 50));
							if (cancelled) return;
							if (--remainingChunks === 0) { controller.close(); return; }
							controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ id: payload.id, choices: [{ delta: { content: "next" } }] })}\n\n`));
						},
						cancel() { cancelled = true; },
					}), { headers: { "Content-Type": "text/event-stream" } });
				}
				return input.stream ? new Response(`data: ${JSON.stringify(payload)}\n\n`, { headers: { "Content-Type": "text/event-stream" } }) : Response.json(payload);
			},
		};
		return convertV4MiniflareOptions ? convertV4MiniflareOptions(v4) : v4;
	};
	const mf = new Miniflare(options());
	const day = new Date().toISOString().slice(0, 10);
	async function ledger(input = {}) {
		const response = await mf.dispatchFetch("https://fixture.test/fixture-ledger", { method: "POST", body: JSON.stringify({ day, ...input }) });
		assert.equal(response.status, 200, await response.clone().text());
		return response.json();
	}
	async function expectCost(expected, timeoutMs = 5000) {
		const expires = Date.now() + timeoutMs;
		let actual;
		do {
			actual = (await ledger()).total;
			if (Math.abs(actual - expected) < 1e-10) return;
			await new Promise((resolve) => setTimeout(resolve, 100));
		} while (Date.now() < expires);
		assert.fail(`Expected ledger total ${expected}, got ${actual}`);
	}
	const request = (stream = true) => ({
		method: "POST", headers: { Authorization: "Bearer oft_fixture", "Content-Type": "application/json" },
		body: JSON.stringify({ model: "openai/gpt-5.6-luna", stream, messages: [{ role: "user", content: "fixture" }] }),
	});
	try {
		const kv = await mf.getKVNamespace("FREE_TIER_KV");
		await kv.put(`cost:${day}`, "4.6");
		await kv.put("token:oft_fixture", "{}");
		assert.equal((await ledger()).total, 4.6);
		await Promise.all(Array.from({ length: 50 }, (_, i) => ledger({ id: "gen-dupe", cost: i % 2 ? 0.25 : 0.20 })));
		await expectCost(4.85);
		await Promise.all([ledger({ id: "gen-one", cost: 0.1 }), ledger({ id: "gen-two", cost: 0.15 })]);
		await expectCost(5.1);
		assert.equal((await mf.dispatchFetch("https://fixture.test/v1/chat/completions", request())).status, 429);

		// Recreating the Worker runtime must retain the durable balance and dedupe.
		await mf.setOptions(options("6"));
		await ledger({ id: "gen-dupe", cost: 0.25 });
		await expectCost(5.1);
		for (const stream of [true, false]) {
			const response = await mf.dispatchFetch("https://fixture.test/v1/chat/completions", request(stream));
			assert.equal(response.status, 200);
			assert.match(await response.text(), /gen-runtime-/);
		}
		await expectCost(5.6);

		// A real HTTP disconnect cancels the request context in workerd. Calling
		// reader.cancel() on a directly returned fixture response misses this.
		const disconnectRequest = request();
		disconnectRequest.body = JSON.stringify({ model: "openai/gpt-5.6-luna", stream: true, messages: [{ role: "user", content: "disconnect-fixture" }] });
		const disconnect = new AbortController();
		// Miniflare's public proxy is another Worker and can mask cancellation;
		// hit this Worker's own workerd socket, just as production ingress does.
		const response = await fetch(new URL("/v1/chat/completions", await mf.unsafeGetDirectURL()), { ...disconnectRequest, signal: disconnect.signal });
		assert.equal(response.status, 200);
		const reader = response.body.getReader();
		assert.match(new TextDecoder().decode((await reader.read()).value), /gen-runtime-/);
		disconnect.abort();
		await reader.cancel().catch(() => {});
		await expectCost(5.85);
		const eventsResponse = await mf.dispatchFetch("https://fixture.test/fixture-events");
		assert.equal(eventsResponse.status, 200);
		const events = await eventsResponse.json();
		assert.equal(events.filter((event) => event === "chat_stream_cancelled").length, 1,
			"real HTTP disconnect must finalize as cancellation exactly once, not natural EOF");

		// Allow a real SQLite-backed alarm to reconcile a generation after the
		// originating request and its Worker have finished.
		await ledger({ id: "gen-alarm", generationId: "gen-alarm", cost: 0.20, reconcile: true });
		await expectCost(6.05);
		await expectCost(6.10, 25_000);
		await ledger({ id: "gen-alarm", cost: 0.25 });
		await expectCost(6.10);

		// Run admission against actual SQLite and RPC, not the Node storage mock.
		const admissionDay = new Date(Date.now() + 24 * 60 * 60_000).toISOString().slice(0, 10);
		const admission = (id, overrides = {}) => ({ day: admissionDay, op: "admit", id, deviceHash: id,
			dailyKey: `daily-${id}`, turnKey: `turn-${id}`, dailyCap: 100, turnCap: 100,
			costCap: 1, reserve: 0.25, concurrencyCap: 4, deviceConcurrencyCap: 2, ...overrides });
		const admissions = await Promise.all(Array.from({ length: 20 }, (_, i) => ledger(admission(`runtime-${i}`))));
		assert.equal(admissions.filter((result) => result.allowed).length, 4);
		assert.equal((await ledger({ day: admissionDay })).total, 0, "reservations are distinct from actual cost");
		await mf.setOptions(options("6"));
		assert.equal((await ledger(admission("after-restart"))).allowed, false, "reservations survive a runtime restart");
		const allowedIds = admissions.flatMap((result, i) => result.allowed ? [`runtime-${i}`] : []);
		await Promise.all(allowedIds.map((id) => ledger({ day: admissionDay, op: "settle", id, noCharge: true })));
		assert.equal((await ledger(admission("after-release"))).allowed, true);
		const quotaResults = await Promise.all(Array.from({ length: 20 }, () => ledger({ day: admissionDay, op: "increment", key: "atomic-quota", cap: 3 })));
		assert.equal(quotaResults.filter((result) => result.allowed).length, 3);
		await ledger({ day: admissionDay, op: "settle", id: "after-release", cost: 0.1 });
		await ledger({ day: admissionDay, op: "observe", id: "after-release", generationId: "gen-runtime-late" });
		await ledger({ day: admissionDay, op: "settle", id: "after-release", generationId: "gen-runtime-late", cost: 0.25, resolved: true });
		assert.equal((await ledger({ day: admissionDay })).total, 0.25, "late provider ID must not re-add provisional usage");
		console.log("Local workerd SQLite Durable Object integration: PASS (parallel updates, idempotency, legacy import, restart persistence, RPC, cap enforcement, SSE/JSON accounting, HTTP disconnect accounting, alarm reconciliation)");
	} finally {
		await mf.dispose();
	}
}
