import { fetchOpenRouterGenerationMetadata, reportedGenerationCost } from "./generation-metadata.mjs";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECONCILIATION_ATTEMPTS = 12;
const RECONCILIATION_DELAY_MS = 15_000;

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
		const entries = await this.storage.list({ prefix: "pending:", limit: 25 });
		for (const [key, pending] of entries) {
			const metadata = await fetchOpenRouterGenerationMetadata(this.env, pending.generationId, 1);
			const cost = reportedGenerationCost(metadata);
			if (cost !== undefined) {
				const { delta } = await this.record({ ...pending, cost, reconcile: false });
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
			if (!pending.size) await txn.setAlarm(expiresAt);
		});
	}
}
