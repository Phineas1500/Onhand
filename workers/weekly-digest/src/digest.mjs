// Builds the weekly Onhand Free digest from Analytics Engine usage rows.
// Kept separate from index.mjs so Node tests can run it without the Workers
// email module.
import { summarizeRealInstalls, usageDevicesSql } from "../../../scripts/lib/free-tier-usage.mjs";

const DAY_MS = 86_400_000;
// Five weeks of history tells new installs from returning ones.
const LOOKBACK_DAYS = 35;
const MAX_LISTED = 25;

export function digestSql(dataset) {
	return usageDevicesSql({ dataset, days: LOOKBACK_DAYS });
}

// Analytics Engine timestamps are UTC without a zone: "2026-10-18 07:55:14".
function parseTimestamp(value) {
	const time = Date.parse(`${String(value || "").replace(" ", "T")}Z`);
	return Number.isFinite(time) ? time : 0;
}

function tally(installs, key) {
	const counts = new Map();
	for (const install of installs) {
		const values = [...install[key]];
		for (const value of values.length ? values : ["unknown"]) counts.set(value, (counts.get(value) || 0) + 1);
	}
	return [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([value, count]) => `${value} ${count}`).join(", ") || "none";
}

function activity(install) {
	const steps = [];
	if (install.events.has("extension_installed")) steps.push("installed");
	if (install.events.has("extension_updated")) steps.push("updated");
	if (install.events.has("sidepanel_opened")) steps.push("opened the panel");
	if (install.events.has("register_success")) steps.push("registered");
	if (install.questions || install.answers) steps.push("asked");
	return steps.join(", ") || "seen";
}

export function buildDigest(rows, { now = new Date(), testDeviceHashes = [] } = {}) {
	const { installs, testInstalls, testAnswers } = summarizeRealInstalls(rows, testDeviceHashes);
	const weekStart = now.getTime() - 7 * DAY_MS;
	const day = (time) => new Date(time).toISOString().slice(0, 10);
	const active = installs.filter((install) => parseTimestamp(install.lastSeen) >= weekStart);
	const fresh = new Set(installs.filter((install) => parseTimestamp(install.firstSeen) >= weekStart));
	const answered = active.filter((install) => install.answers > 0 || install.questions > 0);
	const chromeos = active.filter((install) => install.os.has("chromeos"));
	const subject = `Onhand Free, ${day(weekStart)} to ${day(now.getTime())}: ${fresh.size} new, ${answered.length} asked`;
	const lines = [
		`Onhand Free, ${day(weekStart)} to ${day(now.getTime())} (UTC)`,
		"",
		`Real installs seen this week: ${active.length} (new this week: ${fresh.size})`,
		`Asked at least one question: ${answered.length} (answers: ${active.reduce((sum, install) => sum + install.answers, 0)}, questions: ${active.reduce((sum, install) => sum + install.questions, 0)})`,
		`On ChromeOS: ${chromeos.length} seen, ${chromeos.filter((install) => answered.includes(install)).length} asked`,
		"",
		`By OS: ${tally(active, "os")}`,
		`By country: ${tally(active, "countries")}`,
		`By version: ${tally(active, "versions")}`,
		"",
	];
	if (active.length) {
		lines.push("Installs (first seen, OS, country, version, what they did):");
		for (const install of active.slice(-MAX_LISTED).reverse()) {
			const os = [...install.os].join("/") || "unknown OS";
			const country = [...install.countries].join("/") || "--";
			const version = [...install.versions].join("/") || "--";
			const counts = install.answers || install.questions ? ` (${install.questions} questions, ${install.answers} answers)` : "";
			lines.push(`- ${install.firstSeen.slice(0, 10)}${fresh.has(install) ? " NEW" : ""}  ${os}  ${country}  ${version}  ${activity(install)}${counts}`);
		}
		if (active.length > MAX_LISTED) lines.push(`  ...and ${active.length - MAX_LISTED} more`);
		lines.push("");
	}
	lines.push(
		`Left out as tests: ${testInstalls} installs, ${testAnswers} answers.`,
		"",
		"OS is known for events since 2026-10-18; older ones show \"unknown OS\". Installs that never pick Onhand Free, or whose network blocks it, don't appear here: compare with installs in the Chrome Web Store dashboard.",
		"Full report: npm run ops:free-tier -- --days=7",
	);
	return { subject, text: lines.join("\n") };
}
