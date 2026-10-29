// Onhand Free usage classification shared by the ops report
// (scripts/run-free-tier-ops-report.mjs) and the weekly digest Worker
// (workers/weekly-digest). Keep it free of Node APIs: the Worker bundles it.

// Device-level usage rows: one row per device, source, event, turn and session.
export function usageDevicesSql({ dataset, days }) {
	return `
SELECT
  blob14 AS device_hash,
  if(blob2 = '', 'unknown', blob2) AS source,
  blob1 AS event,
  if(blob11 = '', 'unknown', blob11) AS auth_mode,
  if(blob12 = '', 'unknown', blob12) AS ai_provider,
  if(blob13 = '', 'unknown', blob13) AS ai_model,
  if(blob16 = '', 'unknown', blob16) AS turn_id,
  blob17 AS session_id,
  if(blob8 = '', 'unknown', blob8) AS user_agent,
  blob9 AS extension_version,
  blob6 AS country,
  SUM(_sample_interval) AS events,
  MIN(timestamp) AS first_seen,
  MAX(timestamp) AS last_seen
FROM ${dataset}
WHERE timestamp >= NOW() - INTERVAL '${days}' DAY
  AND blob14 != ''
  AND blob1 IN (
    'chat_stream_complete',
    'chat_response_complete',
    'chat_quota_denied',
    'chat_turn_quota_denied',
    'chat_cost_quota_denied',
    'prompt_submitted',
    'prompt_succeeded',
    'prompt_failed',
    'prompt_stopped',
    'session_started',
    'register_success',
    'extension_installed',
    'extension_updated',
    'sidepanel_opened',
    'decisions_response'
  )
GROUP BY device_hash, source, event, auth_mode, ai_provider, ai_model, turn_id, session_id, user_agent, extension_version, country
ORDER BY device_hash, source, event`;
}

export function rowSource(row) {
	return String(row?.source || "unknown");
}

export function rowDeviceHash(row) {
	return String(row?.device_hash || row?.deviceHash || "");
}

export function rowTurnId(row) {
	return String(row?.turn_id || row?.turnId || "");
}

export function rowSessionId(row) {
	return String(row?.session_id || row?.sessionId || "");
}

export function rowAiProvider(row) {
	return String(row?.ai_provider || row?.aiProvider || "");
}

export function rowAiModel(row) {
	return String(row?.ai_model || row?.aiModel || "");
}

export function isFreeTierUsageRow(row) {
	const source = rowSource(row);
	const event = String(row?.event || "");
	if (source === "free-tier" && (["chat_stream_complete", "chat_response_complete"].includes(event) || isQuotaDenial(row))) return true;
	if (source === "extension" && rowAiProvider(row) === "onhand-free") {
		// Install and update events count installs that have not asked anything yet.
		return [
			"prompt_submitted",
			"prompt_succeeded",
			"prompt_failed",
			"prompt_stopped",
			"session_started",
			"register_success",
			"extension_installed",
			"extension_updated",
			"sidepanel_opened",
		].includes(event);
	}
	return false;
}

export function isWorkerChatCompletionUsageRow(row) {
	return rowSource(row) === "free-tier" && ["chat_stream_complete", "chat_response_complete"].includes(String(row?.event || ""));
}

export function isExtensionPromptSucceededUsageRow(row) {
	return rowSource(row) === "extension" && rowAiProvider(row) === "onhand-free" && String(row?.event || "") === "prompt_succeeded";
}

export function isLikelyTestUsageRow(row, testDeviceHashes = []) {
	if (rowHasKnownTestDevice(row, testDeviceHashes)) return true;
	if (isProbeDiagnosticRow(row)) return true;
	// Debug-CLI asks tag their turns (cli, acceptance, agent-trajectory, prompt-eval:<variant>).
	if (/(^|[-_:])(cli|acceptance|bypass|smoke|test|trajectory|eval|probe)([-_:]|$)/i.test(rowSource(row))) return true;
	if (/codex-smoke|acceptance|probe/i.test(rowAiModel(row))) return true;
	return false;
}

// The extension always calls the Worker from a browser; scripts and curl show up as "other".
export function isScriptWorkerRow(row) {
	return rowSource(row) === "free-tier" && String(row?.user_agent || "") === "other";
}

// Until the Worker learned Pi's User-Agent, Firefox chat calls were logged as
// "other". The same install's Decisions and extension calls carry the real
// browser, and any such row means the install is not a script.
export function isBrowserRow(row) {
	return !["", "other", "unknown"].includes(String(row?.user_agent || ""));
}

// The Worker hashes the Free token and the extension hashes its diagnostics
// client id, so one install appears under two device hashes. Turns and sessions
// carry the same ids on both sides; link hashes that share one into an install.
export function linkDeviceInstalls(rows) {
	const parent = new Map();
	const find = (hash) => {
		let root = hash;
		while (parent.get(root) !== root) root = parent.get(root);
		for (let next = hash; next !== root; ) {
			const up = parent.get(next);
			parent.set(next, root);
			next = up;
		}
		return root;
	};
	const ownerById = new Map();
	for (const row of Array.isArray(rows) ? rows : []) {
		const deviceHash = rowDeviceHash(row);
		if (!deviceHash) continue;
		if (!parent.has(deviceHash)) parent.set(deviceHash, deviceHash);
		for (const id of [`session:${rowSessionId(row)}`, `turn:${rowTurnId(row)}`]) {
			if (isUnknownIdentifier(id.slice(id.indexOf(":") + 1))) continue;
			const owner = ownerById.get(id);
			if (!owner) ownerById.set(id, deviceHash);
			else if (find(owner) !== find(deviceHash)) parent.set(find(deviceHash), find(owner));
		}
	}
	return find;
}

// Scripts are not users, but an unknown script hitting caps still deserves an
// alert, so health classification passes { scripts: false }.
export function findLikelyTestDevices(rows, testDeviceHashes = [], { scripts = true } = {}) {
	const allRows = Array.isArray(rows) ? rows : [];
	const installOf = linkDeviceInstalls(allRows);
	const testInstalls = new Set();
	const scriptInstalls = new Set();
	const browserInstalls = new Set();
	for (const row of allRows) {
		const deviceHash = rowDeviceHash(row);
		if (!deviceHash) continue;
		if (isLikelyTestUsageRow(row, testDeviceHashes)) testInstalls.add(installOf(deviceHash));
		if (scripts && isScriptWorkerRow(row)) scriptInstalls.add(installOf(deviceHash));
		if (isBrowserRow(row)) browserInstalls.add(installOf(deviceHash));
	}
	for (const install of scriptInstalls) if (!browserInstalls.has(install)) testInstalls.add(install);
	const testDevices = new Set(testDeviceHashes || []);
	for (const row of allRows) {
		const deviceHash = rowDeviceHash(row);
		if (deviceHash && testInstalls.has(installOf(deviceHash))) testDevices.add(deviceHash);
	}
	return testDevices;
}

export function isUnknownIdentifier(value) {
	const text = String(value || "").trim().toLowerCase();
	return !text || text === "-" || text === "unknown";
}

export function rowHasKnownTestDevice(row, testDeviceHashes = []) {
	return new Set(testDeviceHashes || []).has(rowDeviceHash(row));
}

export function isProbeDiagnosticRow(row) {
	const text = `${rowTurnId(row)} ${rowSessionId(row)}`.toLowerCase();
	return /\bprobe\b|codex-free-tier-probe|free-tier-probe|image-probe|probe-image/.test(text);
}

export function isQuotaDenial(row) {
	return String(row?.event || "").endsWith("_quota_denied");
}

// Real (non-test) Onhand Free installs and what each did, for the weekly
// digest. Linked Worker and extension hashes count as one install.
export function summarizeRealInstalls(rows, testDeviceHashes = []) {
	const allRows = Array.isArray(rows) ? rows : [];
	const testDevices = findLikelyTestDevices(allRows, testDeviceHashes);
	const installOf = linkDeviceInstalls(allRows);
	const installs = new Map();
	const testInstalls = new Set();
	let testAnswers = 0;
	for (const row of allRows) {
		if (!isFreeTierUsageRow(row)) continue;
		const hash = rowDeviceHash(row);
		if (!hash) continue;
		const id = installOf(hash);
		const events = Number(row.events) || 0;
		if (testDevices.has(hash)) {
			testInstalls.add(id);
			if (isWorkerChatCompletionUsageRow(row)) testAnswers += events;
			continue;
		}
		const install = installs.get(id) || { id, firstSeen: "", lastSeen: "", answers: 0, questions: 0, os: new Set(), countries: new Set(), versions: new Set(), events: new Set() };
		if (!install.firstSeen || String(row.first_seen) < install.firstSeen) install.firstSeen = String(row.first_seen || "");
		if (String(row.last_seen || "") > install.lastSeen) install.lastSeen = String(row.last_seen || "");
		if (isWorkerChatCompletionUsageRow(row)) install.answers += events;
		if (isExtensionPromptSucceededUsageRow(row)) install.questions += events;
		const os = String(row.user_agent || "").split("/")[1];
		if (os) install.os.add(os);
		if (row.country) install.countries.add(String(row.country));
		if (row.extension_version) install.versions.add(String(row.extension_version));
		install.events.add(String(row.event || ""));
		installs.set(id, install);
	}
	return {
		installs: [...installs.values()].sort((a, b) => a.firstSeen.localeCompare(b.firstSeen)),
		testInstalls: testInstalls.size,
		testAnswers,
	};
}
