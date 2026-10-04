#!/usr/bin/env node
// Places a real Onhand voice call without a microphone or speakers. It opens
// the actual side panel next to a fresh tab in a new window, swaps the panel's
// microphone for a synthetic stream before pressing Voice, and plays each
// question into that stream (synthesized silently with macOS `say -o`). Live
// hears it as speech; nothing is played aloud and no room audio is captured.
//
// The synthetic mic carries a faint noise floor by default. With pure digital
// silence after the question, Live never speaks the delegated answer (a real
// microphone always has room tone, so real calls are unaffected).
//
// Calls are bounded by --max-seconds and always end by closing the panel and
// its window, which tears down the call and the stream.
import WebSocket from "ws";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const DEFAULT_PORT = Number(process.env.ONHAND_CDP_PORT || process.env.ONHAND_TEST_CDP_PORT || 9343);
const DEFAULT_EXTENSION_ID = process.env.ONHAND_EXTENSION_ID || "hpjpjeehgbloadhdidmecpijppodibim";
const QUIET_AFTER_SPEECH_MS = 6000;
const NO_SPEECH_AFTER_ANSWER_MS = 45000;
// Live occasionally misses the first utterance of a call entirely. A question
// with no input caption this long after its audio ends is played once more.
const UNHEARD_RETRY_MS = 8000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function usage() {
	return `Usage: npm run eval:voice-call -- --url <page> --question "<text>" [--question "<follow-up>"] [options]

Places a real Live voice call in the Onhand side panel with a synthetic
microphone, asks each question in turn, and reports what Live heard and said.

Options:
  --url <url>             Page to open in a new window (required)
  --question <text>       Question to speak (repeat for follow-ups; macOS say)
  --audio <file.wav>      Use a recorded question instead (repeatable)
  --voice <name>          say voice. Default: Samantha
  --mute-after            Press the panel's Mute button after the first question
  --room-tone-db <dB|off> Synthetic mic noise floor. Default: -50
  --max-seconds <n>       Hard cap on the whole call. Default: 120
  --timeline              Print the Live data-channel timeline
  --json                  Print the result as JSON
  --port <port>           Browser remote-debugging port. Default: ${DEFAULT_PORT}
  --host <host>           Default: 127.0.0.1
  --extension-id <id>     Default: ${DEFAULT_EXTENSION_ID}

Uses the panel's saved voice settings (engine, delegation, model). Each run
starts a new Onhand session and costs one real Live call.`;
}

function parseArgs(argv) {
	const args = { url: "", questions: [], voice: "Samantha", muteAfter: false, roomToneDb: -50, maxSeconds: 120, timeline: false, json: false, port: DEFAULT_PORT, host: "127.0.0.1", extensionId: DEFAULT_EXTENSION_ID };
	for (let index = 0; index < argv.length; index++) {
		const raw = argv[index];
		const [flag, inline] = raw.startsWith("--") && raw.includes("=") ? [raw.slice(0, raw.indexOf("=")), raw.slice(raw.indexOf("=") + 1)] : [raw, undefined];
		const value = () => {
			if (inline !== undefined) return inline;
			if (index + 1 >= argv.length) throw new Error(`${flag} needs a value.`);
			return argv[++index];
		};
		if (flag === "-h" || flag === "--help") { console.log(usage()); process.exit(0); }
		else if (flag === "--url") args.url = value();
		else if (flag === "--question") args.questions.push({ text: value() });
		else if (flag === "--audio") args.questions.push({ audio: value() });
		else if (flag === "--voice") args.voice = value();
		else if (flag === "--mute-after") args.muteAfter = true;
		else if (flag === "--room-tone-db") { const v = value(); args.roomToneDb = v === "off" ? null : Number(v); }
		else if (flag === "--max-seconds") args.maxSeconds = Number(value());
		else if (flag === "--timeline") args.timeline = true;
		else if (flag === "--json") args.json = true;
		else if (flag === "--port") args.port = Number(value());
		else if (flag === "--host") args.host = value();
		else if (flag === "--extension-id") args.extensionId = value();
		else throw new Error(`Unknown option: ${raw}`);
	}
	if (!args.url) throw new Error("--url is required.");
	if (!args.questions.length) throw new Error("Pass at least one --question or --audio.");
	if (args.roomToneDb !== null && !(Number.isFinite(args.roomToneDb) && args.roomToneDb < 0)) throw new Error("--room-tone-db must be a negative number or off.");
	if (!(args.maxSeconds > 0)) throw new Error("--max-seconds must be positive.");
	return args;
}

// Speech is written to a file only; `say -o` never plays through the speakers.
async function synthesizeQuestion(text, voice, dir, index) {
	const aiff = path.join(dir, `q${index}.aiff`);
	const wav = path.join(dir, `q${index}.wav`);
	await run("say", ["-v", voice, "-o", aiff, text]);
	await run("afconvert", ["-f", "WAVE", "-d", "LEI16@24000", "-c", "1", aiff, wav]);
	return wav;
}

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.nextId = 0;
		this.pending = new Map();
		ws.on("message", (raw) => {
			const message = JSON.parse(raw);
			const waiter = message.id && this.pending.get(message.id);
			if (!waiter) return;
			this.pending.delete(message.id);
			if (message.error) waiter.reject(new Error(message.error.message));
			else waiter.resolve(message.result);
		});
	}
	send(method, params = {}, sessionId) {
		return new Promise((resolve, reject) => {
			const id = ++this.nextId;
			this.pending.set(id, { resolve, reject });
			this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
		});
	}
	async attach(targetId) {
		const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
		await this.send("Runtime.enable", {}, sessionId);
		return sessionId;
	}
	async evaluate(sessionId, expression, userGesture = false) {
		const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture }, sessionId);
		if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "evaluation failed");
		const value = result.result?.value;
		return typeof value === "string" ? JSON.parse(value) : value;
	}
}

// Installed in the panel before Voice starts: the synthetic microphone and a
// read-only recorder of every Live data-channel message.
function panelInstrumentation(roomToneDb) {
	return `(() => {
		const ctx = new AudioContext({ sampleRate: 24000 });
		const dest = ctx.createMediaStreamDestination();
		const roomToneDb = ${JSON.stringify(roomToneDb)};
		if (roomToneDb !== null) {
			const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
			const data = noise.getChannelData(0);
			for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
			const source = ctx.createBufferSource();
			source.buffer = noise;
			source.loop = true;
			const gain = ctx.createGain();
			gain.gain.value = Math.pow(10, roomToneDb / 20);
			source.connect(gain).connect(dest);
			source.start();
		}
		navigator.mediaDevices.getUserMedia = async () => dest.stream;
		const started = Date.now();
		const events = [];
		const record = (direction, raw) => {
			try {
				const e = JSON.parse(raw);
				const item = e.event?.item;
				events.push({
					t: Date.now() - started,
					d: direction,
					type: e.type,
					inner: e.event ? e.event.type + (item?.type ? "/" + item.type : "") : "",
					phase: item?.phase || "",
					text: typeof e.delta === "string" ? e.delta : String(e.transcript || e.content || item?.content?.[0]?.text || "").slice(0, 400),
					error: e.error?.message || e.event?.error?.message || "",
				});
			} catch {}
		};
		const original = RTCPeerConnection.prototype.createDataChannel;
		RTCPeerConnection.prototype.createDataChannel = function (...args) {
			const channel = original.apply(this, args);
			channel.addEventListener("message", (event) => record("in", event.data));
			const send = channel.send.bind(channel);
			channel.send = (data) => { record("out", data); return send(data); };
			return channel;
		};
		globalThis.__onhandVoiceCall = {
			ctx,
			events,
			now: () => Date.now() - started,
			async play(b64, label) {
				const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
				const buffer = await ctx.decodeAudioData(bytes.buffer);
				await ctx.resume();
				const source = ctx.createBufferSource();
				source.buffer = buffer;
				source.connect(dest);
				const t = Date.now() - started;
				events.push({ t, d: "eval", type: "eval.question", inner: "", phase: "", text: label, error: "" });
				source.start();
				return { t, duration: buffer.duration };
			},
		};
		return true;
	})()`;
}

const SHADOW_FIND = (id) => `(() => { const roots = [document, ...Array.from(document.querySelectorAll("*")).map((e) => e.shadowRoot).filter(Boolean)]; for (const r of roots) { const b = r.getElementById?.(${JSON.stringify(id)}); if (b) return b; } return null; })()`;

const PANEL_SNAPSHOT = `(async () => {
	const r = await chrome.runtime.sendMessage({ type: "sidebar:fetch-state" });
	const st = r?.state || r || {};
	const turns = (st.turns || []).map((t) => ({
		prompt: t.userPrompt || "",
		pending: Boolean(t.pending),
		error: t.error || "",
		reply: t.reply || "",
		marks: (t.pageActions || []).filter((a) => a.type === "annotation").length,
		tools: (t.toolTraces || []).map((x) => String(x.toolName || "").replace(/^browser_/, "")),
	}));
	return JSON.stringify({ status: st.status || "", busy: Boolean(st.activeRequestId) || turns.some((t) => t.pending), turns, events: globalThis.__onhandVoiceCall?.events || [] });
})()`;

// The moment the backend's answer reaches Live: hosted delegation streams a
// final_answer message; the Onhand agent (client delegation) appends it as
// commentary for Live to speak.
function isAnswerHandoff(e) {
	return (e.inner === "response.output_item.done/message" && e.phase === "final_answer") || (e.d === "out" && e.type === "session.commentary.append");
}

function joined(events, type, from, to = Infinity) {
	return events.filter((e) => e.type === type && e.t >= from && e.t < to).map((e) => e.text).join("").replace(/\s+/g, " ").trim();
}

// Spoken text should be plain speech: no citation tokens, markdown or TeX.
function speechProblems(text) {
	const problems = [];
	if (/\[\[cite:|onhand-\d{6,}/i.test(text)) problems.push("citation id in speech");
	if (/\*\*|__|^#|`/.test(text)) problems.push("markdown in speech");
	if (/\\\(|\\\[|\$\$|\\frac|\\cdot/.test(text)) problems.push("TeX in speech");
	return problems;
}

function analyzeQuestion(events, question, nextStart) {
	const from = question.t;
	const delegation = events.find((e) => e.type === "session.delegation.created" && e.t >= from && e.t < nextStart);
	const final = events.filter((e) => isAnswerHandoff(e) && e.t >= from && e.t < nextStart).at(-1);
	const speechAfterFinal = final ? events.filter((e) => e.type === "session.output_transcript.delta" && e.t > final.t && e.t < nextStart) : [];
	const errors = events.filter((e) => e.error && e.t >= from && e.t < nextStart).map((e) => e.error);
	const spoken = joined(events, "session.output_transcript.delta", from, nextStart);
	const spokenAnswer = final ? speechAfterFinal.map((e) => e.text).join("").replace(/\s+/g, " ").trim() : spoken;
	return {
		heard: joined(events, "session.input_transcript.delta", from, nextStart),
		spoken,
		spokenAnswer,
		delegated: Boolean(delegation),
		backend: !delegation ? "" : final?.d === "out" ? "onhand-agent" : final ? "hosted" : "",
		backendFinal: final?.text || "",
		answerSpoken: final ? speechAfterFinal.length > 0 : Boolean(spoken),
		answerSpeechDelayMs: final && speechAfterFinal.length ? speechAfterFinal[0].t - final.t : null,
		speechProblems: speechProblems(spoken),
		errors,
	};
}

function formatTimeline(events) {
	const lines = [];
	let previous = "";
	for (const e of events) {
		const key = e.d + e.type + e.inner;
		if (key === previous && /delta/.test(e.type + e.inner)) continue;
		previous = key;
		if (/function_call_arguments\.delta|output_text\.delta/.test(e.inner)) continue;
		const text = e.text && !/delta/.test(e.type + e.inner) ? ` | ${e.text.slice(0, 110)}` : "";
		lines.push(`${String(e.t).padStart(7)}ms ${e.d.padEnd(4)} ${e.type}${e.inner ? ` > ${e.inner}` : ""}${e.phase ? ` [${e.phase}]` : ""}${e.error ? ` ERROR ${e.error}` : ""}${text}`);
	}
	return lines.join("\n");
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const log = args.json ? () => {} : (...parts) => console.log(...parts);
	const audioDir = await mkdtemp(path.join(tmpdir(), "onhand-voice-call-"));
	const audio = [];
	for (const [index, question] of args.questions.entries()) {
		const file = question.audio || (await synthesizeQuestion(question.text, args.voice, audioDir, index));
		audio.push({ label: question.text || path.basename(question.audio), b64: (await readFile(file)).toString("base64") });
	}

	const base = `http://${args.host}:${args.port}`;
	const version = await (await fetch(`${base}/json/version`)).json();
	const ws = new WebSocket(version.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
	await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
	const cdp = new Cdp(ws);
	const panelUrl = `chrome-extension://${args.extensionId}/sidepanel.html`;
	const panelTargets = async () => ((await cdp.send("Target.getTargets")).targetInfos || []).filter((t) => t.url === panelUrl);

	let contentTargetId = "";
	let panelTargetId = "";
	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		if (panelTargetId) await cdp.send("Target.closeTarget", { targetId: panelTargetId }).catch(() => {});
		if (contentTargetId) await cdp.send("Target.closeTarget", { targetId: contentTargetId }).catch(() => {});
		await sleep(500);
		ws.close();
		await rm(audioDir, { recursive: true, force: true });
	};
	const interrupt = () => { close().finally(() => process.exit(130)); };
	process.once("SIGINT", interrupt);
	process.once("SIGTERM", interrupt);

	const callStarted = Date.now();
	const capAt = callStarted + args.maxSeconds * 1000;
	let hitCap = false;
	let snapshot = { turns: [], events: [] };
	const questions = [];
	try {
		// A new window keeps the call's panel apart from any panel already open.
		const existingPanels = new Set((await panelTargets()).map((t) => t.targetId));
		contentTargetId = (await cdp.send("Target.createTarget", { url: args.url, newWindow: true })).targetId;
		await sleep(3000);
		const helper = (await cdp.send("Target.createTarget", { url: `${panelUrl}?driver=1&panel-opener=1`, background: true })).targetId;
		try {
			await sleep(1000);
			const helperSession = await cdp.attach(helper);
			await cdp.evaluate(helperSession, `(async () => {
				const tabs = await chrome.tabs.query({ url: ${JSON.stringify(args.url)} });
				const tab = tabs.sort((a, b) => b.id - a.id)[0];
				if (!tab) throw new Error("The call's tab was not found.");
				await chrome.tabs.update(tab.id, { active: true });
				await chrome.sidePanel.open({ windowId: tab.windowId });
				return true;
			})()`, true);
		} finally {
			await cdp.send("Target.closeTarget", { targetId: helper }).catch(() => {});
		}
		for (let attempt = 0; attempt < 20 && !panelTargetId; attempt++) {
			await sleep(500);
			panelTargetId = (await panelTargets()).find((t) => !existingPanels.has(t.targetId))?.targetId || "";
		}
		if (!panelTargetId) throw new Error("The Onhand side panel did not open.");
		const panel = await cdp.attach(panelTargetId);
		await cdp.evaluate(panel, panelInstrumentation(args.roomToneDb), true);
		log(`Side panel open on ${args.url}`);

		await cdp.evaluate(panel, `(async () => JSON.stringify(await chrome.runtime.sendMessage({ type: "sidebar:new-session" })))()`);
		await sleep(1500);
		await cdp.evaluate(panel, `(async () => { await __onhandVoiceCall.ctx.resume(); const b = ${SHADOW_FIND("realtimeVoiceButton")}; if (!b) throw new Error("Voice button not found."); b.click(); return true; })()`, true);
		let started = false;
		for (let attempt = 0; attempt < 40 && !started; attempt++) {
			await sleep(500);
			started = await cdp.evaluate(panel, `__onhandVoiceCall.events.some((e) => e.type === "session.started")`);
		}
		if (!started) throw new Error("Live did not start (check the panel's voice settings and sign-in).");
		log("Voice started");
		await sleep(1500);

		for (const [index, clip] of audio.entries()) {
			const turnsBefore = (await cdp.evaluate(panel, PANEL_SNAPSHOT)).turns.length;
			const play = () => cdp.evaluate(panel, `__onhandVoiceCall.play(${JSON.stringify(clip.b64)}, ${JSON.stringify(clip.label)})`, true);
			let played = await play();
			const question = { label: clip.label, t: played.t, retried: false };
			questions.push(question);
			log(`Asked: ${clip.label}`);
			if (index === 0 && args.muteAfter) {
				await sleep(played.duration * 1000 + 1500);
				const pressed = await cdp.evaluate(panel, `(() => { const b = ${SHADOW_FIND("realtimeMuteButton")}; if (!b || b.hidden) return JSON.stringify(false); b.click(); return JSON.stringify(b.getAttribute("aria-pressed") === "true"); })()`, true);
				log(pressed ? "Pressed Mute" : "Mute button unavailable");
			}
			let questionEnd = played.t + played.duration * 1000;
			let settledAt = 0;
			while (true) {
				if (Date.now() >= capAt) { hitCap = true; break; }
				await sleep(1500);
				snapshot = await cdp.evaluate(panel, PANEL_SNAPSHOT);
				const now = await cdp.evaluate(panel, `__onhandVoiceCall.now()`);
				const events = snapshot.events.filter((e) => e.t >= played.t);
				const delegated = events.some((e) => e.type === "session.delegation.created");
				const final = events.filter(isAnswerHandoff).at(-1);
				const lastSpeech = events.filter((e) => e.type === "session.output_transcript.delta").at(-1);
				const settled = !snapshot.busy && snapshot.turns.length > turnsBefore;
				const heard = events.some((e) => e.type === "session.input_transcript.delta");
				if (!heard && !delegated && !question.retried && now - questionEnd > UNHEARD_RETRY_MS) {
					question.retried = true;
					played = await play();
					questionEnd = played.t + played.duration * 1000;
					log(`Not heard; asked again: ${clip.label}`);
					continue;
				}
				if (delegated) {
					if (!settled || !final) continue;
					settledAt ||= Date.now();
					if (lastSpeech && lastSpeech.t > final.t && now - lastSpeech.t > QUIET_AFTER_SPEECH_MS) break;
					if (!(lastSpeech && lastSpeech.t > final.t) && Date.now() - settledAt > NO_SPEECH_AFTER_ANSWER_MS) break;
				} else if (lastSpeech && lastSpeech.t > questionEnd && now - lastSpeech.t > QUIET_AFTER_SPEECH_MS && !snapshot.busy) {
					break; // Live answered directly without delegating.
				} else if (now - questionEnd > NO_SPEECH_AFTER_ANSWER_MS) {
					break;
				}
			}
			if (hitCap) break;
		}
		snapshot = await cdp.evaluate(panel, PANEL_SNAPSHOT);
	} finally {
		await close();
	}

	const events = snapshot.events;
	const results = questions.map((question, index) => ({
		question: question.label,
		retried: question.retried,
		...analyzeQuestion(events, question, questions[index + 1]?.t ?? Infinity),
	}));
	const turns = snapshot.turns.filter((t) => /^\[Voice\]/.test(t.prompt) || t.reply);
	const ok = !hitCap && results.length === audio.length && results.every((r) => r.heard && r.answerSpoken && !r.errors.length);
	const report = { ok, url: args.url, hitCap, elapsedSeconds: Math.round((Date.now() - callStarted) / 1000), muteAfter: args.muteAfter, roomToneDb: args.roomToneDb, questions: results, turns };
	if (args.timeline) report.timeline = formatTimeline(events);
	if (args.json) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		for (const [index, r] of results.entries()) {
			console.log(`\nQ${index + 1}: ${r.question}`);
			console.log(`  heard:   ${r.heard || "(nothing)"}${r.retried ? "  (asked twice: the first attempt was not heard)" : ""}`);
			console.log(`  spoken:  ${r.spoken || "(nothing)"}`);
			console.log(`  handled: ${r.delegated ? "handed to the backend" : "answered by Live itself"}`);
			if (r.delegated) console.log(`  answer:  ${r.answerSpoken ? `spoken ${r.answerSpeechDelayMs} ms after the ${r.backend === "hosted" ? "hosted backend" : "Onhand agent"} finished` : "NOT SPOKEN after the backend finished"}`);
			if (r.backend === "onhand-agent") console.log(`  handed:  ${r.backendFinal}`);
			if (r.speechProblems.length) console.log(`  speech:  ${r.speechProblems.join(", ")}`);
			if (r.errors.length) console.log(`  errors:  ${r.errors.join("; ")}`);
		}
		for (const t of turns) {
			console.log(`\nTurn: ${t.prompt}${t.error ? `  [error: ${t.error}]` : ""}`);
			console.log(`  tools: ${t.tools.join(", ") || "(none)"} | marks: ${t.marks}`);
			console.log(`  reply: ${t.reply.replace(/\s+/g, " ").slice(0, 360)}`);
		}
		if (args.timeline) console.log(`\nTimeline\n${report.timeline}`);
		console.log(`\n${ok ? "PASS" : "FAIL"}${hitCap ? ` (hit the ${args.maxSeconds}s cap)` : ""} · ${report.elapsedSeconds}s · panel and window closed`);
	}
	process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
	console.error(error.message || error);
	console.error(`\nMake sure Helium/Chromium is running with --remote-debugging-port=${DEFAULT_PORT} and Onhand is loaded.`);
	process.exitCode = 1;
});
