import { promises as fs } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(new URL("..", import.meta.url).pathname);
const SESSION_DIR = join(PROJECT_ROOT, ".onhand", "sessions", "desktop");

function parseArgs(argv) {
	const args = {
		json: false,
		sessionRef: "",
		wait: false,
		timeoutMs: 20000,
		intervalMs: 500,
	};

	for (const value of argv) {
		if (value === "--json") {
			args.json = true;
			continue;
		}
		if (value === "--wait") {
			args.wait = true;
			continue;
		}
		if (value.startsWith("--timeout-ms=")) {
			const parsed = Number.parseInt(value.slice("--timeout-ms=".length), 10);
			if (Number.isFinite(parsed) && parsed > 0) args.timeoutMs = parsed;
			continue;
		}
		if (value.startsWith("--interval-ms=")) {
			const parsed = Number.parseInt(value.slice("--interval-ms=".length), 10);
			if (Number.isFinite(parsed) && parsed > 0) args.intervalMs = parsed;
			continue;
		}
		if (!args.sessionRef) {
			args.sessionRef = value;
		}
	}

	return args;
}

function extractTextBlocks(content = []) {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter((block) => block?.type === "text")
		.map((block) => String(block.text || ""))
		.join("")
		.trim();
}

function extractFinalAnswer(content = []) {
	if (!Array.isArray(content)) return "";
	for (let index = content.length - 1; index >= 0; index -= 1) {
		const block = content[index];
		if (block?.type !== "text") continue;
		if (String(block.textSignature || "").includes('"phase":"final_answer"')) {
			return String(block.text || "").trim();
		}
	}
	return extractTextBlocks(content);
}

function extractReasoningSummaries(content = []) {
	if (!Array.isArray(content)) return [];
	const summaries = [];
	for (const block of content) {
		if (block?.type !== "thinking" || !Array.isArray(block.summary)) continue;
		for (const summary of block.summary) {
			if (summary?.type !== "summary_text") continue;
			const text = String(summary.text || "").trim();
			if (!text) continue;
			summaries.push(text);
		}
	}
	return summaries;
}

function extractAssistantModelInfo(entry) {
	const message = entry?.message || {};
	const provider = String(message.provider || "").trim();
	const modelId = String(message.model || message.modelId || "").trim();
	const api = String(message.api || "").trim();
	const responseId = String(message.responseId || "").trim();
	if (!provider && !modelId && !api && !responseId) return null;
	return {
		provider,
		modelId,
		api,
		responseId,
	};
}

function extractTurnModelInfo(entries, latestUserIndex, assistantEntries) {
	const assistantModelInfo = [...assistantEntries].reverse().map(extractAssistantModelInfo).find(Boolean) || {};
	const modelChange = [...entries.slice(0, latestUserIndex + 1)]
		.reverse()
		.find((entry) => entry?.type === "model_change");
	return {
		provider: assistantModelInfo.provider || String(modelChange?.provider || "").trim(),
		modelId: assistantModelInfo.modelId || String(modelChange?.modelId || "").trim(),
		api: assistantModelInfo.api || "",
		responseId: assistantModelInfo.responseId || "",
	};
}

function extractUserQuestion(text) {
	const source = String(text || "");
	const match = source.match(/User question:\s*([\s\S]*?)\s*Captured browser context/i);
	return (match ? match[1] : source).trim();
}

function truncate(value, maxChars = 160) {
	const text = String(value || "").replace(/\s+/g, " ").trim();
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars - 1)}…`;
}

function dedupe(values) {
	const seen = new Set();
	const result = [];
	for (const value of values) {
		if (seen.has(value)) continue;
		seen.add(value);
		result.push(value);
	}
	return result;
}

function summarizeToolResult(message) {
	const toolName = message?.toolName || "";
	const details = message?.details || {};
	if (message?.isError) {
		const firstLine = String(extractTextBlocks(message.content) || "")
			.split("\n")
			.find((line) => line.trim()) || "Unknown error";
		return {
			kind: "error",
			label: toolName,
			detail: firstLine,
		};
	}

	switch (toolName) {
		case "browser_activate_tab":
			return {
				kind: "pageAction",
				label: "Switched tab",
				detail: details.tab?.title || details.tab?.url || "Relevant page",
			};
		case "browser_highlight_text":
			return {
				kind: "pageAction",
				label: "Highlighted text",
				detail: details.annotation?.matchedText || "Relevant passage",
			};
		case "browser_show_note":
			return {
				kind: "pageAction",
				label: "Added note",
				detail: details.note?.text || details.note?.note || "Short explanation",
			};
		case "browser_scroll_to_annotation":
			return {
				kind: "pageAction",
				label: "Moved to section",
				detail: "Brought the relevant part of the page into view",
			};
		case "browser_capture_state":
			if (details.persistedArtifact?.artifactId) {
				return {
					kind: "artifact",
					label: "Saved artifact",
					detail: details.persistedArtifact.artifactId,
					artifactId: details.persistedArtifact.artifactId,
				};
			}
			return null;
		case "browser_restore_state":
			return {
				kind: "pageAction",
				label: "Restored view",
				detail: details.artifact?.page?.title || details.artifactPath || "Saved browser state",
			};
		case "browser_clear_annotations":
			return {
				kind: "pageAction",
				label: "Cleared annotations",
				detail: `${details.clearedTotal ?? 0} annotation(s)`,
			};
		default:
			if (!toolName.startsWith("browser_")) return null;
			return {
				kind: "pageAction",
				label: toolName,
				detail: extractTextBlocks(message.content).split("\n")[0] || toolName,
			};
	}
}

export async function resolveSessionPath(sessionRef) {
	const entries = (await fs.readdir(SESSION_DIR)).filter((entry) => entry.endsWith(".jsonl")).sort();
	if (!entries.length) {
		throw new Error(`No session files found in ${SESSION_DIR}`);
	}

	if (!sessionRef) {
		return join(SESSION_DIR, entries.at(-1));
	}

	if (isAbsolute(sessionRef)) {
		return sessionRef;
	}

	const exact = entries.find((entry) => entry === sessionRef);
	if (exact) return join(SESSION_DIR, exact);

	const substringMatches = entries.filter((entry) => entry.includes(sessionRef));
	if (!substringMatches.length) {
		throw new Error(`No session file matched "${sessionRef}" in ${SESSION_DIR}`);
	}
	return join(SESSION_DIR, substringMatches.at(-1));
}

export async function loadSessionEntries(sessionPath) {
	const raw = await fs.readFile(sessionPath, "utf8");
	return raw
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

export function inspectLatestTurn(entries, sessionPath) {
	const sessionInfo = [...entries].reverse().find((entry) => entry?.type === "session_info") || null;
	const latestUserIndex = entries.findLastIndex(
		(entry) => entry?.type === "message" && entry?.message?.role === "user",
	);
	if (latestUserIndex < 0) {
		return {
			sessionPath,
			sessionName: sessionInfo?.name || basename(sessionPath),
			latestTurn: null,
		};
	}

	const turnEntries = entries.slice(latestUserIndex);
	const latestUserEntry = turnEntries.find((entry) => entry?.message?.role === "user");
	const assistantEntries = turnEntries.filter((entry) => entry?.message?.role === "assistant");
	const toolResultEntries = turnEntries.filter((entry) => entry?.message?.role === "toolResult");

	const userPrompt = extractUserQuestion(extractTextBlocks(latestUserEntry?.message?.content));
	const finalAssistantEntry = [...assistantEntries]
		.reverse()
		.find((entry) => extractFinalAnswer(entry?.message?.content));
	const lastAssistantEntry = assistantEntries.at(-1) || null;
	const finalReply = extractFinalAnswer(finalAssistantEntry?.message?.content);
	const model = extractTurnModelInfo(entries, latestUserIndex, assistantEntries);
	const reasoningSummaries = dedupe(assistantEntries.flatMap((entry) => extractReasoningSummaries(entry?.message?.content)));
	const pageActionItems = toolResultEntries.map((entry) => summarizeToolResult(entry.message)).filter(Boolean);
	const artifacts = pageActionItems
		.filter((item) => item.kind === "artifact" && item.artifactId)
		.map((item) => item.artifactId);
	const errors = pageActionItems.filter((item) => item.kind === "error");
	const pageActions = pageActionItems.filter((item) => item.kind === "pageAction" || item.kind === "artifact");
	const hasInFlightOutput = assistantEntries.length > 0 || toolResultEntries.length > 0;
	const terminalWithoutReply =
		!finalReply &&
		Boolean(
			lastAssistantEntry?.message?.stopReason === "aborted" ||
				lastAssistantEntry?.message?.stopReason === "cancelled" ||
				lastAssistantEntry?.message?.errorMessage,
		);

	return {
		sessionPath,
		sessionName: sessionInfo?.name || basename(sessionPath),
		sessionTimestamp: entries.find((entry) => entry?.type === "session")?.timestamp || null,
		latestTurn: {
			userPrompt,
			finalReply,
			model,
			reasoningSummaries,
			pageActions,
			artifacts,
			errors,
			entryCount: turnEntries.length,
			startedAt: latestUserEntry?.timestamp || null,
			endedAt: turnEntries.at(-1)?.timestamp || null,
			isComplete: Boolean(finalReply),
			isPossiblyRunning: !finalReply && hasInFlightOutput && !terminalWithoutReply,
			isStopped: terminalWithoutReply,
			stopReason:
				lastAssistantEntry?.message?.stopReason ||
				(lastAssistantEntry?.message?.errorMessage ? "error" : null),
		},
	};
}

async function sleep(ms) {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForLatestTurnCompletion(sessionPath, { timeoutMs, intervalMs }) {
	const startedAt = Date.now();
	let latestReport = null;
	while (true) {
		const entries = await loadSessionEntries(sessionPath);
		latestReport = inspectLatestTurn(entries, sessionPath);
		if (!latestReport.latestTurn || latestReport.latestTurn.isComplete || latestReport.latestTurn.isStopped) {
			return latestReport;
		}
		if (Date.now() - startedAt >= timeoutMs) {
			return latestReport;
		}
		await sleep(intervalMs);
	}
}

function printHumanReadable(report) {
	console.log(`Session: ${report.sessionName}`);
	console.log(`Path: ${report.sessionPath}`);
	if (report.sessionTimestamp) {
		console.log(`Started: ${report.sessionTimestamp}`);
	}
	if (!report.latestTurn) {
		console.log("\nNo user turn found in this session.");
		return;
	}

	const turn = report.latestTurn;
	console.log(`\nLatest user prompt:\n${turn.userPrompt || "(none)"}`);
	if (turn.model?.provider || turn.model?.modelId || turn.model?.api) {
		const providerModel = [turn.model.provider, turn.model.modelId].filter(Boolean).join("/");
		const api = turn.model.api ? ` via ${turn.model.api}` : "";
		console.log(`\nModel:\n${providerModel || "(unknown)"}${api}`);
	}
	console.log(`\nLatest assistant reply:\n${turn.finalReply || "(none)"}`);
	if (!turn.finalReply && turn.isPossiblyRunning) {
		console.log("\nNote: latest turn has page/tool activity but no final reply yet. Rerun with --wait to poll for completion.");
	}
	if (!turn.finalReply && turn.isStopped) {
		console.log(`\nNote: latest turn ended without a final reply (${turn.stopReason || "stopped"}).`);
	}

	console.log("\nReasoning summaries:");
	if (!turn.reasoningSummaries.length) {
		console.log("- (none)");
	} else {
		for (const summary of turn.reasoningSummaries) {
			console.log(`- ${truncate(summary, 220)}`);
		}
	}

	console.log("\nPage actions:");
	if (!turn.pageActions.length) {
		console.log("- (none)");
	} else {
		for (const action of turn.pageActions) {
			console.log(`- ${action.label}: ${truncate(action.detail, 220)}`);
		}
	}

	console.log("\nSaved artifacts:");
	if (!turn.artifacts.length) {
		console.log("- (none)");
	} else {
		for (const artifactId of turn.artifacts) {
			console.log(`- ${artifactId}`);
		}
	}

	if (turn.errors.length) {
		console.log("\nTool errors:");
		for (const error of turn.errors) {
			console.log(`- ${error.label}: ${truncate(error.detail, 220)}`);
		}
	}

	console.log(`\nTurn window: ${turn.startedAt || "?"} -> ${turn.endedAt || "?"}`);
	console.log(`Turn entries: ${turn.entryCount}`);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const sessionPath = await resolveSessionPath(args.sessionRef);
	const report = args.wait
		? await waitForLatestTurnCompletion(sessionPath, {
				timeoutMs: args.timeoutMs,
				intervalMs: args.intervalMs,
			})
		: inspectLatestTurn(await loadSessionEntries(sessionPath), sessionPath);

	if (args.json) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}

	printHumanReadable(report);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error?.message || String(error));
		process.exitCode = 1;
	});
}
