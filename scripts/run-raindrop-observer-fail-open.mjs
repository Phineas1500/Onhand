import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const entryPoint = join(ROOT, "packages", "browser-extension", "src", "observability", "development-agent-observer.ts");
const outfile = join(ROOT, "tmp", "raindrop-pilot", "observer-fail-open-test.mjs");

class FakeAgent {
	#subscriber = null;
	unsubscribed = false;

	subscribe(subscriber) {
		this.#subscriber = subscriber;
		return () => {
			this.unsubscribed = true;
			this.#subscriber = null;
		};
	}

	emit(event) {
		this.#subscriber?.(event);
	}
}

// Workshop's managed pilot uses 5899. This high loopback port is deliberately
// not started by the test, so every shipment takes the fail-open path without
// opening a listener or relying on external network access.
const workshopUrl = "http://127.0.0.1:65534/v1/";
await esbuild.build({
	entryPoints: [entryPoint],
	outfile,
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node20",
	define: { __ONHAND_RAINDROP_WORKSHOP_URL__: JSON.stringify(workshopUrl) },
	logLevel: "silent",
});

const unhandled = [];
const onUnhandled = (error) => unhandled.push(error);
process.on("unhandledRejection", onUnhandled);
try {
	const observerModule = await import(`${pathToFileURL(outfile).href}?test=${Date.now()}`);
	const agent = new FakeAgent();
	const startedAt = Date.now();
	const observer = await observerModule.attachDevelopmentAgentObserver(agent, {
		turnId: "fail-open-turn",
		sessionId: "fail-open-session",
		provider: "fixture-provider",
		model: "fixture-model",
	});
	assert.ok(observer, "The local observer should attach even when Workshop is unavailable");
	agent.emit({ type: "agent_start" });
	agent.emit({ type: "turn_start" });
	agent.emit({ type: "agent_end" });
	await observerModule.closeDevelopmentAgentObserver(observer);
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(agent.unsubscribed, true, "Observer shutdown must unsubscribe from the agent");
	assert.deepEqual(unhandled, [], "An unavailable Workshop must not create an unhandled rejection");
	assert.ok(Date.now() - startedAt < 3000, "An unavailable Workshop must not block the agent lifecycle");
} finally {
	process.off("unhandledRejection", onUnhandled);
	await rm(outfile, { force: true });
}

console.log("Raindrop observer fail-open regression: PASS");
