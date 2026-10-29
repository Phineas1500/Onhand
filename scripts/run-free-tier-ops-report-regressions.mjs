import assert from "node:assert/strict";
import { classifyQuotaRows, findLikelyTestDevices, summarizeUsageDevices } from "./run-free-tier-ops-report.mjs";
import { usageDevicesSql } from "./lib/free-tier-usage.mjs";

// Worker rows carry the Free token hash; extension rows carry the diagnostics client hash.
const worker = (device, session, turn, events, extra = {}) => ({
	device_hash: device, source: "free-tier", event: "chat_stream_complete", ai_provider: "unknown", ai_model: "unknown",
	turn_id: turn, session_id: session, user_agent: "chrome", events: String(events),
	first_seen: "2026-10-08 01:00:00", last_seen: "2026-10-08 01:05:00", ...extra,
});
const extension = (device, source, event, session, turn) => ({
	device_hash: device, source, event, ai_provider: "onhand-free", ai_model: "gpt-6-luna",
	turn_id: turn, session_id: session, user_agent: "chrome", events: "1",
	first_seen: "2026-10-08 01:00:00", last_seen: "2026-10-08 01:05:00",
});

const rows = [
	// Trajectory run in a fresh profile: only the extension's prompt rows carry the test tag.
	worker("w-trajectory", "session_a", "turn_a", 79),
	extension("e-trajectory", "extension", "session_started", "session_a", "unknown"),
	extension("e-trajectory", "extension-agent-trajectory", "prompt_succeeded", "session_a", "turn_a"),
	// Prompt eval: the source has a variant suffix.
	worker("w-eval", "session_b", "turn_b", 37),
	extension("e-eval", "extension-prompt-eval:baseline", "prompt_succeeded", "session_b", "turn_b"),
	// A script calling the Worker directly.
	worker("w-script", "", "unknown", 1, { event: "chat_response_complete", user_agent: "other" }),
	// A real user: one install under two hashes.
	worker("w-user", "session_c", "turn_c", 12),
	extension("e-user", "extension", "session_started", "session_c", "unknown"),
	extension("e-user", "extension", "prompt_succeeded", "session_c", "turn_c"),
	// A real voice turn is a product source, not a test.
	worker("w-voice", "session_d", "turn_d", 5),
	extension("e-voice", "extension-live-voice", "prompt_succeeded", "session_d", "turn_d"),
	// A real install that updated but never asked anything.
	extension("e-idle", "extension", "extension_updated", "", "unknown"),
	// A test profile's install event shares the client hash with its tagged turns.
	extension("e-trajectory", "extension", "extension_installed", "", "unknown"),
];

const testDevices = findLikelyTestDevices(rows);
for (const hash of ["w-trajectory", "e-trajectory", "w-eval", "e-eval", "w-script"]) assert.ok(testDevices.has(hash), `${hash} is a test device`);
for (const hash of ["w-user", "e-user", "w-voice", "e-voice"]) assert.ok(!testDevices.has(hash), `${hash} is a real device`);

const [usage] = summarizeUsageDevices(rows, [], 7);
assert.equal(usage.raw_free_tier_devices, 6, "the two hashes of one install count once");
assert.equal(usage.excluded_likely_test_devices, 3);
assert.equal(usage.estimated_non_test_free_tier_devices, 3);
assert.equal(usage.non_test_worker_chat_devices, 2);
assert.equal(usage.non_test_worker_chat_completions, 17);
assert.equal(usage.excluded_test_worker_chat_completions, 117);
assert.equal(usage.non_test_extension_prompt_succeeded_devices, 1);

// Firefox chat calls logged as "other" are not a script when the install's
// Decisions or extension calls carry the real browser.
assert.match(usageDevicesSql({ dataset: "onhand_events", days: 7 }), /'decisions_response'/);
const firefoxTestDevices = findLikelyTestDevices([
	worker("w-firefox", "session_f", "turn_f", 28, { user_agent: "other" }),
	worker("w-firefox", "session_f", "turn_f", 7, { event: "decisions_response", user_agent: "firefox/windows" }),
	worker("w-firefox-linked", "session_g", "turn_g", 8, { user_agent: "other" }),
	{ ...extension("e-firefox-linked", "extension", "prompt_succeeded", "session_g", "turn_g"), user_agent: "firefox/windows" },
	worker("w-script", "", "unknown", 1, { event: "chat_response_complete", user_agent: "other" }),
]);
for (const hash of ["w-firefox", "w-firefox-linked", "e-firefox-linked"]) assert.ok(!firefoxTestDevices.has(hash), `${hash} is a real Firefox device`);
assert.ok(firefoxTestDevices.has("w-script"));

// A known hash still marks its install, and the cap hits of tagged test devices are not health alerts.
assert.ok(findLikelyTestDevices(rows, ["e-user"]).has("w-user"));
// A script is not a user, but its cap hits still alert.
const alertTestDevices = findLikelyTestDevices(rows, [], { scripts: false });
assert.ok(!alertTestDevices.has("w-script"));
const quota = classifyQuotaRows(
	[
		{ source: "free-tier", event: "chat_quota_denied", device_hash: "w-trajectory", events: "2" },
		{ source: "free-tier", event: "chat_quota_denied", device_hash: "w-user", events: "1" },
		{ source: "free-tier", event: "chat_quota_denied", device_hash: "w-script", events: "1" },
	],
	[...alertTestDevices],
);
assert.deepEqual(quota.map((row) => row.classification), ["test_device_quota_denial", "health_quota_denial", "health_quota_denial"]);

console.log("free-tier ops report regressions passed");
