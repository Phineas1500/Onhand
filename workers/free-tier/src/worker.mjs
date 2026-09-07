import { DurableObject } from "cloudflare:workers";
import { DailyCostLedger } from "./daily-cost-ledger.mjs";

export { default } from "./index.mjs";

export class FreeTierCostLedger extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env);
		this.ledger = new DailyCostLedger(this.ctx.storage, this.env);
	}

	total(day) { return this.ledger.total(day); }
	record(entry) { return this.ledger.record(entry); }
	alarm() { return this.ledger.alarm(); }
}
