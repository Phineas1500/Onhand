import { access, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

const FIXTURE_TEXT =
	process.env.REALTIME_VOICE_FIXTURE_TEXT ||
	"What does this page say about Alpha smoke content? Please answer briefly and point to the page.";
const OUTPUT_PATH = process.env.REALTIME_VOICE_FIXTURE_OUTPUT || join(tmpdir(), "onhand-realtime-voice", "voice-question.wav");
const TEMP_CAF_PATH = join(dirname(OUTPUT_PATH), "voice-question.caf");
const ESPEAK_CANDIDATES = [
	process.env.REALTIME_VOICE_ESPEAK_PATH,
	"/opt/homebrew/bin/espeak",
	"/opt/homebrew/bin/espeak-ng",
	"/usr/local/bin/espeak",
	"/usr/local/bin/espeak-ng",
	"/usr/bin/espeak",
	"/usr/bin/espeak-ng",
].filter(Boolean);

async function firstExecutable(paths) {
	for (const path of paths) {
		try {
			await access(path);
			return path;
		} catch {}
	}
	return "";
}

async function audioByteCount(path) {
	try {
		const { stdout } = await execFileAsync("/usr/bin/afinfo", [path]);
		const match = stdout.match(/audio bytes:\s*(\d+)/i);
		if (match) return Number(match[1]);
	} catch {}
	try {
		const info = await stat(path);
		return Math.max(0, info.size - 44);
	} catch {
		return 0;
	}
}

async function assertAudioFixture(path) {
	const bytes = await audioByteCount(path);
	if (!Number.isFinite(bytes) || bytes <= 0) {
		throw new Error(`Generated voice fixture has no audio samples: ${path}`);
	}
}

async function main() {
	await mkdir(dirname(OUTPUT_PATH), { recursive: true });
	const espeak = await firstExecutable(ESPEAK_CANDIDATES);
	if (espeak) {
		await execFileAsync(espeak, ["-w", OUTPUT_PATH, FIXTURE_TEXT]);
	} else if (process.platform === "darwin") {
		await execFileAsync("/usr/bin/say", ["-v", process.env.REALTIME_VOICE_FIXTURE_VOICE || "Samantha", "-o", TEMP_CAF_PATH, FIXTURE_TEXT]);
		await execFileAsync("/usr/bin/afconvert", ["-f", "WAVE", "-d", "LEI16", TEMP_CAF_PATH, OUTPUT_PATH]);
		await rm(TEMP_CAF_PATH, { force: true });
	} else {
		throw new Error("Install espeak/espeak-ng, or run this script on macOS with say and afconvert.");
	}
	await assertAudioFixture(OUTPUT_PATH);
	console.log(`Generated ${OUTPUT_PATH}`);
	console.log(`Text: ${FIXTURE_TEXT}`);
}

main().catch((error) => {
	console.error(error?.stack || error?.message || String(error));
	process.exitCode = 1;
});
