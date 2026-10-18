// Weekly email digest of real Onhand Free usage (see docs/FREE_TIER_OPS.md).
import { EmailMessage } from "cloudflare:email";
import { buildDigest, digestSql } from "./digest.mjs";

async function queryUsage(env) {
	const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`, {
		method: "POST",
		headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
		body: digestSql(env.ANALYTICS_DATASET || "onhand_events"),
	});
	const text = await response.text();
	if (!response.ok) throw new Error(`Analytics Engine SQL failed (${response.status}): ${text.replace(/\s+/g, " ").slice(0, 300)}`);
	const parsed = JSON.parse(text);
	return Array.isArray(parsed.data) ? parsed.data : [];
}

function mimeMessage({ from, to, subject, text }) {
	return [
		`From: Onhand digest <${from}>`,
		`To: ${to}`,
		`Subject: ${subject}`,
		`Date: ${new Date().toUTCString()}`,
		`Message-ID: <${crypto.randomUUID()}@useonhand.com>`,
		"MIME-Version: 1.0",
		'Content-Type: text/plain; charset="utf-8"',
		"Content-Transfer-Encoding: 8bit",
		"",
		text,
	].join("\r\n");
}

async function sendDigest(env) {
	const rows = await queryUsage(env);
	const testDeviceHashes = String(env.TEST_DEVICE_HASHES || "").split(",").map((hash) => hash.trim()).filter(Boolean);
	const { subject, text } = buildDigest(rows, { now: new Date(), testDeviceHashes });
	await env.DIGEST_EMAIL.send(new EmailMessage(env.DIGEST_FROM, env.DIGEST_TO, mimeMessage({ from: env.DIGEST_FROM, to: env.DIGEST_TO, subject, text })));
	return subject;
}

export default {
	async scheduled(event, env, ctx) {
		ctx.waitUntil(sendDigest(env));
	},
	// Sends a digest now, for testing: POST with the trigger secret.
	async fetch(request, env) {
		const authorized = request.method === "POST" && env.DIGEST_TRIGGER_SECRET && request.headers.get("Authorization") === `Bearer ${env.DIGEST_TRIGGER_SECRET}`;
		if (!authorized) return new Response("Not found", { status: 404 });
		try {
			return Response.json({ ok: true, subject: await sendDigest(env) });
		} catch (error) {
			return Response.json({ ok: false, error: String(error?.message || error) }, { status: 500 });
		}
	},
};
