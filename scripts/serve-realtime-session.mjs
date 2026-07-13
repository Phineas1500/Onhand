import http from "node:http";

const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const PORT = Number(process.env.REALTIME_SESSION_PORT || 8787);
const HOST = process.env.REALTIME_SESSION_HOST || "127.0.0.1";
const MODEL = process.env.REALTIME_MODEL || "gpt-realtime-2.1";
const VOICE = process.env.REALTIME_VOICE || "marin";

const sessionConfig = JSON.stringify({
	type: "realtime",
	model: MODEL,
	output_modalities: ["audio"],
	audio: {
		input: {
			noise_reduction: { type: "far_field" },
			transcription: { model: "gpt-4o-mini-transcribe" },
			turn_detection: {
				type: "semantic_vad",
				eagerness: "low",
				create_response: false,
				interrupt_response: false,
			},
		},
		output: { voice: VOICE },
	},
	instructions: [
		"You are Onhand's realtime audio interface.",
		"Use semantic patience for microphone turns.",
		"Do not answer page questions from audio by yourself; Onhand will send exact answer text to speak when the runtime agent has finished page grounding.",
	].join(" "),
});

function setCorsHeaders(res) {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

function sendJson(res, status, body) {
	setCorsHeaders(res);
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
}

async function createRealtimeCall(browserSdp) {
	const fd = new FormData();
	fd.set("sdp", browserSdp);
	fd.set("session", sessionConfig);

	return await fetch(OPENAI_REALTIME_CALLS_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
			"OpenAI-Safety-Identifier": process.env.OPENAI_SAFETY_IDENTIFIER || "onhand-local-dev",
		},
		body: fd,
	});
}

const server = http.createServer(async (req, res) => {
	setCorsHeaders(res);

	if (req.method === "OPTIONS") {
		res.writeHead(204);
		res.end();
		return;
	}

	if (req.method === "GET" && req.url === "/health") {
		sendJson(res, 200, {
			ok: true,
			model: MODEL,
			voice: VOICE,
			hasApiKey: Boolean(process.env.OPENAI_API_KEY),
		});
		return;
	}

	if (req.method !== "POST" || req.url !== "/session") {
		sendJson(res, 404, { error: "Use POST /session with a raw browser SDP body." });
		return;
	}

	if (!process.env.OPENAI_API_KEY) {
		sendJson(res, 500, { error: "OPENAI_API_KEY is required." });
		return;
	}

	try {
		const browserSdp = await readBody(req);
		if (!browserSdp.trim()) {
			sendJson(res, 400, { error: "Browser SDP body is required." });
			return;
		}

		const upstream = await createRealtimeCall(browserSdp);
		const sdp = await upstream.text();
		if (!upstream.ok) {
			sendJson(res, upstream.status || 502, {
				error: "OpenAI Realtime call setup failed.",
				detail: sdp,
			});
			return;
		}

		res.writeHead(200, { "Content-Type": "application/sdp" });
		res.end(sdp);
	} catch (error) {
		sendJson(res, 500, {
			error: "Failed to create Realtime session.",
			detail: error?.message || String(error),
		});
	}
});

server.listen(PORT, HOST, () => {
	console.log(`Onhand Realtime session server listening at http://${HOST}:${PORT}/session`);
	console.log(`Model: ${MODEL}; voice: ${VOICE}`);
});
