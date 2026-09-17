// Keep source and image bytes out of Live's small response.item.create history. Upload to
// the same OpenAI account; server-side expiry also covers panel/worker crashes.
async function uploadFile(blob, filename, purpose, apiKey, fetchImpl) {
	const body = new FormData();
	body.append("purpose", purpose);
	body.append("expires_after[anchor]", "created_at");
	body.append("expires_after[seconds]", "3600");
	body.append("file", blob, filename);
	const response = await fetchImpl("https://api.openai.com/v1/files", {
		method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body, signal: AbortSignal.timeout(30000),
	});
	const result = await response.json().catch(() => null);
	if (!response.ok || !result?.id) throw new Error(`Live file upload failed: ${String(result?.error?.message || `HTTP ${response.status}`).slice(0, 500)}`);
	return result.id;
}

export async function uploadLiveText(text, apiKey, fetchImpl = fetch) {
	if (typeof text !== "string" || !text.trim()) throw new Error("Live source text is empty.");
	const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
	if (blob.size > 2_000_000) throw new Error("Live source result exceeds 2 MB. Request a smaller section.");
	const id = await uploadFile(blob, "onhand-source.txt", "user_data", apiKey, fetchImpl);
	return { type: "input_file", file_id: id };
}

export async function uploadLiveImage(dataUrl, apiKey, fetchImpl = fetch) {
	const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
	if (!match || match[2].length > 28_000_000) throw new Error("Live image must be PNG, JPEG, WebP or GIF and under 20 MB.");
	const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
	if (!bytes.length || bytes.length > 20_000_000) throw new Error("Live image is empty or exceeds 20 MB.");
	const id = await uploadFile(new Blob([bytes], { type: match[1] }), `onhand-live.${match[1].split("/")[1]}`, "vision", apiKey, fetchImpl);
	return { type: "input_image", file_id: id, detail: "auto" };
}
