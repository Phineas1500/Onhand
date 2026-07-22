import type { Agent } from "@earendil-works/pi-agent-core";

declare const __ONHAND_RAINDROP_WORKSHOP_URL__: string;

export interface DevelopmentAgentObserver {
	close: () => Promise<void>;
	workshopUrl: string;
}

export interface DevelopmentAgentObserverContext {
	turnId: string;
	sessionId: string;
	extensionVersion?: string;
	provider?: string;
	model?: string;
	executionProfile?: string;
	learningMode?: boolean;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function normalizeLocalWorkshopUrl(value: unknown) {
	const raw = String(value || "").trim();
	if (!raw) return "";
	try {
		const parsed = new URL(raw);
		if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(parsed.hostname)) return "";
		parsed.username = "";
		parsed.password = "";
		parsed.search = "";
		parsed.hash = "";
		return parsed.toString().endsWith("/") ? parsed.toString() : `${parsed.toString()}/`;
	} catch {
		return "";
	}
}

export function developmentAgentObserverWorkshopUrl() {
	return normalizeLocalWorkshopUrl(__ONHAND_RAINDROP_WORKSHOP_URL__);
}

export async function attachDevelopmentAgentObserver(
	agent: Agent,
	context: DevelopmentAgentObserverContext,
): Promise<DevelopmentAgentObserver | null> {
	const workshopUrl = developmentAgentObserverWorkshopUrl();
	if (!workshopUrl) return null;

	try {
		const { createRaindropPiAgent } = await import("@raindrop-ai/pi-agent");
		const client = createRaindropPiAgent({
			localWorkshopUrl: workshopUrl,
			userId: "onhand-local-development",
			convoId: context.sessionId,
			eventName: "onhand_browser_turn",
			properties: {
				application: "onhand",
				environment: "local-development",
				surface: "browser-extension",
				onhand_turn_id: context.turnId,
				extension_version: context.extensionVersion || "",
				provider: context.provider || "",
				model: context.model || "",
				execution_profile: context.executionProfile || "legacy",
				learning_mode: Boolean(context.learningMode),
			},
			traces: {
				enabled: true,
				flushIntervalMs: 250,
				maxBatchSize: 100,
				maxQueueSize: 1000,
			},
			events: {
				enabled: true,
				partialFlushMs: 250,
			},
		});
		const unsubscribe = client.subscribe(agent);
		let closed = false;
		return {
			workshopUrl,
			close: async () => {
				if (closed) return;
				closed = true;
				unsubscribe();
				// Workshop mirrors are asynchronous. Give loopback requests a short
				// drain window before shutting down this request-scoped client.
				await new Promise((resolve) => setTimeout(resolve, 150));
				await client.shutdown();
			},
		};
	} catch (error) {
		console.warn("[onhand] Local Raindrop observer unavailable", error);
		return null;
	}
}

export async function closeDevelopmentAgentObserver(observer: DevelopmentAgentObserver | null) {
	if (!observer) return;
	try {
		await observer.close();
	} catch (error) {
		console.warn("[onhand] Local Raindrop observer shutdown failed", error);
	}
}
