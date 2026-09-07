const OPENROUTER_GENERATION_URL = "https://openrouter.ai/api/v1/generation";

export function reportedGenerationCost(metadata) {
	for (const value of [metadata?.total_cost, metadata?.usage]) {
		if (value == null || value === "") continue;
		const cost = Number(value);
		if (Number.isFinite(cost) && cost >= 0) return cost;
	}
	return undefined;
}

export async function fetchOpenRouterGenerationMetadata(env, generationId, attempts = 2) {
	const id = String(generationId || "").replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 160);
	if (!id || !env?.OPENROUTER_API_KEY) return null;
	const url = new URL(OPENROUTER_GENERATION_URL);
	url.searchParams.set("id", id);
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const response = await fetch(url, {
				headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
				signal: AbortSignal.timeout(5_000),
			});
			if (response.ok) {
				const payload = await response.json().catch(() => null);
				return payload?.data && typeof payload.data === "object" ? payload.data : null;
			}
			await response.body?.cancel();
			if (![404, 408, 429, 500, 502, 503].includes(response.status)) return null;
		} catch {}
		if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 750));
	}
	return null;
}
