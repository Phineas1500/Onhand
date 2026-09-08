import { fetchOpenRouterGenerationMetadata, reportedGenerationCost } from "./generation-metadata.mjs";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECONCILIATION_ATTEMPTS = 12;
const RECONCILIATION_DELAY_MS = 15_000;
const REQUEST_LEASE_MS = 5 * 60_000;

function validAmount(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

// Each UTC request day is one coordination unit. SQLite-backed DO storage
// transactions serialize the read-modify-write across all Worker isolates.
// Kept independent of the platform base class for deterministic Node tests.
export class DailyCostLedger {
	constructor(storage, env) {
		this.storage = storage;
		this.env = env;
	}

	async initialize(day) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Invalid accounting day");
		const savedDay = await this.storage.get("day");
		if (savedDay && savedDay !== day) throw new Error("Accounting day mismatch");
		if (savedDay) return;
		// Import the old total once, never overwrite newer DO charges with a stale
		// KV read. Rollout must first drain the old Worker (see FREE_TIER.md).
		const legacy = Number(await this.env.FREE_TIER_KV.get(`cost:${day}`));
		await this.storage.transaction(async (txn) => {
			if (await txn.get("day")) return;
			await txn.put({ day, total: Number.isFinite(legacy) && legacy > 0 ? legacy : 0 });
			await txn.setAlarm(Date.parse(`${day}T00:00:00Z`) + RETENTION_MS);
		});
	}

	async total(day) {
		await this.initialize(day);
		return (await this.storage.get("total")) || 0;
	}

	// Counter imports are only seeds. Once present, the transaction's value wins
	// over stale legacy KV reads from another Worker isolate.
	async counterSeeds(keys) {
		return await Promise.all(keys.map(async (key) => {
			if (!key) return { storageKey: "", seed: 0 };
			const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
			const storageKey = `counter:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
			if (await this.storage.get(storageKey) !== undefined) return { storageKey, seed: 0 };
			const seed = Number(await this.env.FREE_TIER_KV.get(key));
			return { storageKey, seed: Number.isFinite(seed) && seed > 0 ? seed : 0 };
		}));
	}

	async increment({ day, key, cap }) {
		await this.initialize(day);
		const [{ storageKey, seed }] = await this.counterSeeds([key]);
		return await this.storage.transaction(async (txn) => {
			const current = (await txn.get(storageKey)) ?? seed;
			if (current >= cap) return { allowed: false, current };
			await txn.put(storageKey, current + 1);
			return { allowed: true, current: current + 1 };
		});
	}

	async admit({ day, id, deviceHash, dailyKey, turnKey, dailyCap, turnCap, costCap, reserve, concurrencyCap, deviceConcurrencyCap }) {
		await this.initialize(day);
		if (!id || !deviceHash || !(reserve > 0) || !Number.isFinite(reserve)) throw new Error("Invalid admission");
		const [dailyCounter, turnCounter] = await this.counterSeeds([dailyKey, turnKey]);
		return await this.storage.transaction(async (txn) => {
			const prior = await txn.get(`request:${id}`);
			if (prior) return prior.active && prior.expiresAt > Date.now()
				? { ...prior.admission, replayed: true }
				: { allowed: false, reason: "admission_expired" };
			const total = (await txn.get("total")) || 0;
			const reserved = (await txn.get("reserved")) || 0;
			const active = (await txn.get("active")) || 0;
			const deviceActive = (await txn.get(`active:${deviceHash}`)) || 0;
			const current = (await txn.get(dailyCounter.storageKey)) ?? dailyCounter.seed;
			const turnCurrent = turnKey ? (await txn.get(turnCounter.storageKey)) ?? turnCounter.seed : 0;
			if (total + reserved + reserve > costCap + 1e-10) return { allowed: false, reason: "daily_cost_cap", current: total + reserved, cap: costCap };
			if (current >= dailyCap) return { allowed: false, reason: "daily_request_cap", current, cap: dailyCap };
			if (turnKey && turnCurrent >= turnCap) return { allowed: false, reason: "turn_model_call_cap", current: turnCurrent, cap: turnCap };
			if (active >= concurrencyCap || deviceActive >= deviceConcurrencyCap) return { allowed: false, reason: "concurrency_cap", current: active, cap: concurrencyCap };
			const expiresAt = Date.now() + REQUEST_LEASE_MS;
			const admission = { allowed: true, current: current + 1, turnCurrent: turnKey ? turnCurrent + 1 : 0, expiresAt };
			await txn.put({
				[`request:${id}`]: { day, id, deviceHash, reserve, active: true, expiresAt, generationId: "", admission },
				[`lease:${id}`]: expiresAt,
				[dailyCounter.storageKey]: current + 1,
				...(turnKey ? { [turnCounter.storageKey]: turnCurrent + 1 } : {}),
				reserved: reserved + reserve, active: active + 1, [`active:${deviceHash}`]: deviceActive + 1,
			});
			const alarm = await txn.getAlarm();
			if (alarm == null || alarm > expiresAt) await txn.setAlarm(expiresAt);
			return admission;
		});
	}

	// Commit the provider identity before forwarding its first bytes. If the
	// Worker dies before finalization, the existing lease/intent can reconcile it.
	async observe({ day, id, generationId }) {
		await this.initialize(day);
		if (!generationId || typeof generationId !== "string" || generationId.length > 160) throw new Error("Invalid generation id");
		await this.storage.transaction(async (txn) => {
			const row = await txn.get(`request:${id}`);
			if (!row) throw new Error("Unknown admission");
			if (row.generationId && row.generationId !== generationId) throw new Error("Generation identity changed");
			row.generationId = generationId;
			await txn.put(`request:${id}`, row);
			if (!row.active && !row.resolved) {
				const pending = await txn.get(`pending:${id}`);
				await txn.put(`pending:${id}`, { ...pending, day, id, generationId, admission: true, attempts: pending?.attempts || 0 });
				await txn.delete(`unresolved:${id}`);
				const next = Date.now() + RECONCILIATION_DELAY_MS;
				const alarm = await txn.getAlarm();
				if (alarm == null || alarm > next) await txn.setAlarm(next);
			}
		});
	}

	async finishActive(txn, row) {
		if (!row.active) return;
		row.active = false;
		await txn.put({ active: Math.max(0, ((await txn.get("active")) || 0) - 1),
			[`active:${row.deviceHash}`]: Math.max(0, ((await txn.get(`active:${row.deviceHash}`)) || 0) - 1) });
		await txn.delete(`lease:${row.id}`);
	}

	async settle({ day, id, generationId = "", cost, resolved = false, noCharge = false, adjustmentPoint = null }) {
		await this.initialize(day);
		return await this.storage.transaction(async (txn) => {
			const row = await txn.get(`request:${id}`);
			if (!row) throw new Error("Unknown admission");
			if (generationId && row.generationId && generationId !== row.generationId) throw new Error("Generation identity changed");
			row.generationId ||= generationId;
			await this.finishActive(txn, row);
			const chargeId = row.generationId || id;
			const previous = (await txn.get(`charge:${chargeId}`)) || 0;
			// Usage can precede the provider ID. Move its provisional charge into
			// the generation's existing dedupe entry instead of charging it twice.
			const provisional = chargeId !== id ? (await txn.get(`charge:${id}`)) || 0 : 0;
			const amount = Math.max(previous, provisional, validAmount(cost));
			const delta = amount - previous - provisional;
			const total = ((await txn.get("total")) || 0) + delta;
			await txn.put({ [`charge:${chargeId}`]: amount, total });
			if (provisional) await txn.delete(`charge:${id}`);
			row.resolved ||= resolved || noCharge;
			// A known partial charge replaces only that much of the hold. Uncertain
			// outcomes cannot reopen the budget while provider metadata is missing.
			const remaining = row.resolved ? 0 : Math.max(0, row.reserve - amount);
			const oldHold = row.hold ?? row.reserve;
			await txn.put("reserved", Math.max(0, ((await txn.get("reserved")) || 0) + remaining - oldHold));
			row.hold = remaining;
			await txn.put(`request:${id}`, row);
			if (!row.resolved && row.generationId) {
				const key = `pending:${id}`;
				const pending = await txn.get(key);
				await txn.put(key, { ...pending, day, id, generationId: row.generationId, admission: true, attempts: pending?.attempts || 0, adjustmentPoint: adjustmentPoint || pending?.adjustmentPoint || null });
				const next = Date.now() + RECONCILIATION_DELAY_MS;
				const alarm = await txn.getAlarm();
				if (alarm == null || alarm > next) await txn.setAlarm(next);
			} else if (row.resolved) {
				await txn.delete(`pending:${id}`);
				await txn.delete(`unresolved:${id}`);
			} else {
				await txn.put(`unresolved:${id}`, { day, id, reason: "missing_generation_id", reserve: remaining });
			}
			return { total, delta, reserved: (await txn.get("reserved")) || 0 };
		});
	}

	async record({ day, id, generationId = "", cost, reconcile = false, adjustmentPoint = null }) {
		await this.initialize(day);
		if (!id || typeof id !== "string" || id.length > 160) throw new Error("Invalid accounting id");
		const amount = typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : 0;
		return await this.storage.transaction(async (txn) => {
			const key = `charge:${id}`;
			const previous = (await txn.get(key)) || 0;
			const current = (await txn.get("total")) || 0;
			// Usage and generation metadata may arrive twice or out of order. Only
			// an increase for the same provider generation contributes to the total.
			const delta = Math.max(0, amount - previous);
			const total = current + delta;
			await txn.put({ [key]: Math.max(previous, amount), total });
			const pendingKey = `pending:${id}`;
			if (reconcile && generationId) {
				const pending = await txn.get(pendingKey);
				if (!pending) {
					await txn.put(pendingKey, { day, id, generationId, attempts: 0, adjustmentPoint });
				}
				const alarm = await txn.getAlarm();
				const next = Date.now() + RECONCILIATION_DELAY_MS;
				if (alarm == null || alarm > next) await txn.setAlarm(next);
			} else await txn.delete(pendingKey);
			return { total, delta };
		});
	}

	async alarm() {
		const day = await this.storage.get("day");
		if (!day) return;
		const expiresAt = Date.parse(`${day}T00:00:00Z`) + RETENTION_MS;
		if (Date.now() >= expiresAt) {
			await this.storage.deleteAll();
			return;
		}
		// Schedule before external I/O: a process interruption must not orphan
		// pending generations. Alarms and record() may interleave at fetch awaits.
		await this.storage.setAlarm(Math.min(expiresAt, Date.now() + 60_000));
		const leases = await this.storage.list({ prefix: "lease:" });
		for (const [key, deadline] of leases) {
			if (deadline > Date.now()) continue;
			const id = key.slice("lease:".length);
			// settle reads the latest identity inside its transaction, so an
			// observe/finalize interleaving cannot erase an already resolved charge.
			await this.settle({ day, id });
		}
		const entries = await this.storage.list({ prefix: "pending:", limit: 25 });
		for (const [key, pending] of entries) {
			const metadata = await fetchOpenRouterGenerationMetadata(this.env, pending.generationId, 1);
			const cost = reportedGenerationCost(metadata);
			if (cost !== undefined) {
				const { delta } = pending.admission
					? await this.settle({ ...pending, cost, resolved: true })
					: await this.record({ ...pending, cost, reconcile: false });
				if (delta > 0 && pending.adjustmentPoint && this.env.ONHAND_ANALYTICS) {
					const point = structuredClone(pending.adjustmentPoint);
					point.doubles[0] = Date.now();
					point.doubles[9] = delta;
					try { this.env.ONHAND_ANALYTICS.writeDataPoint(point); } catch {}
				}
				continue;
			}
			await this.storage.transaction(async (txn) => {
				const current = await txn.get(key);
				// Another finalization may have resolved it while metadata was fetched.
				if (!current) return;
				current.attempts += 1;
				if (current.attempts >= MAX_RECONCILIATION_ATTEMPTS) {
					await txn.put(`unresolved:${pending.id}`, current);
					await txn.delete(key);
					console.error("free_tier_accounting_unresolved", pending.generationId);
				} else await txn.put(key, current);
			});
		}
		// Leaving the next alarm scheduled also handles a concurrently added entry;
		// empty days need only the retention cleanup alarm.
		await this.storage.transaction(async (txn) => {
			const pending = await txn.list({ prefix: "pending:", limit: 1 });
			const leases = await txn.list({ prefix: "lease:" });
			if (!pending.size) await txn.setAlarm(Math.min(expiresAt, ...leases.values()));
		});
	}
}
