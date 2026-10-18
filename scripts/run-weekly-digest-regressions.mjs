// Regressions for the weekly Onhand Free digest (workers/weekly-digest).
import assert from "node:assert/strict";
import { buildDigest } from "../workers/weekly-digest/src/digest.mjs";

const now = new Date("2026-10-26T13:00:00Z");
const row = (fields) => ({ events: "1", auth_mode: "api-key", ai_provider: "onhand-free", ai_model: "unknown", turn_id: "unknown", session_id: "", user_agent: "chrome/chromeos", extension_version: "", country: "US", first_seen: "2026-10-24 15:00:00", last_seen: "2026-10-24 15:05:00", ...fields });
const rows = [
	// A new ChromeOS student: the extension and Worker hashes share a turn id.
	row({ device_hash: "ext-student", source: "extension", event: "register_success", extension_version: "0.4.10" }),
	row({ device_hash: "ext-student", source: "extension", event: "prompt_succeeded", turn_id: "turn-1", extension_version: "0.4.10", events: "2" }),
	row({ device_hash: "worker-student", source: "free-tier", event: "chat_stream_complete", turn_id: "turn-1", ai_provider: "unknown", events: "5" }),
	// A Windows install that only opened the panel, first seen weeks ago.
	row({ device_hash: "ext-windows", source: "extension", event: "sidepanel_opened", user_agent: "chrome/windows", country: "IN", extension_version: "0.4.9", first_seen: "2026-10-01 10:00:00", last_seen: "2026-10-22 10:00:00" }),
	// Our own test traffic.
	row({ device_hash: "ext-test", source: "extension-cli", event: "prompt_succeeded", turn_id: "turn-test" }),
	row({ device_hash: "worker-test", source: "free-tier", event: "chat_stream_complete", turn_id: "turn-test", events: "7" }),
	// Seen only before this week.
	row({ device_hash: "ext-old", source: "extension", event: "extension_updated", first_seen: "2026-10-02 10:00:00", last_seen: "2026-10-03 10:00:00" }),
];
const { subject, text } = buildDigest(rows, { now });
assert.equal(subject, "Onhand Free, 2026-10-19 to 2026-10-26: 1 new, 1 asked");
assert.match(text, /Real installs seen this week: 2 \(new this week: 1\)/);
assert.match(text, /Asked at least one question: 1 \(answers: 5, questions: 2\)/);
assert.match(text, /On ChromeOS: 1 seen, 1 asked/);
assert.match(text, /By OS: chromeos 1, windows 1/);
assert.match(text, /- 2026-10-24 NEW {2}chromeos {2}US {2}0\.4\.10 {2}registered, asked \(2 questions, 5 answers\)/);
assert.match(text, /- 2026-10-01 {2}windows {2}IN {2}0\.4\.9 {2}opened the panel/);
assert.match(text, /Left out as tests: 1 installs, 7 answers\./);
assert.doesNotMatch(text, /ext-old|2026-10-02/);
console.log("Weekly digest: counts, ChromeOS split, install list and test exclusion passed");
