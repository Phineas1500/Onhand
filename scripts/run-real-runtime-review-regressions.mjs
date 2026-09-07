// Browser-native IndexedDB and runtime lifecycle regressions. Uses a disposable
// extension profile and its bundled smoke model; no provider calls or personal data.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findBrowser, pickAvailablePort, launchBrowser, openContext } from "./run-real-browser-anchoring.mjs";

async function runBrowserCases() {
	const { createOnhandBrowserRuntime, __browserRuntimeTest: test } = await import(chrome.runtime.getURL("onhand-runtime.bundle.js"));
	const check = (condition, message) => {
		if (!condition) throw new Error(message);
	};
	const request = (req) => new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	const store = test.withRuntimeStoreForTest;
	const session = (id, artifactIds = []) => ({
		id,
		name: id,
		createdAt: "2026-09-07T00:00:00Z",
		updatedAt: "2026-09-07T00:00:00Z",
		messages: [],
		turns: [],
		pageActions: [],
		artifactIds,
	});
	const artifact = (id, sessionId, day) => ({
		id,
		sessionId,
		createdAt: `2026-09-${String(day).padStart(2, "0")}T00:00:00Z`,
		label: id,
		outerHTML: "<p>Disposable review fixture</p>",
		screenshotDataUrl: "data:image/png;base64,Zml4dHVyZQ==",
		page: { title: id, url: "https://example.test/fixture", annotations: [] },
	});
	await store("runtimeSessions", "readwrite", (s) => request(s.put(session("review-commit"))));
	check(
		(await store("runtimeSessions", "readonly", (s) => request(s.get("review-commit"))))?.id === "review-commit",
		"Committed session did not persist",
	);
	let rejected = false;
	try {
		await store("runtimeSessions", "readwrite", (s, tx) => new Promise((resolve, reject) => {
			const req = s.put(session("review-abort"));
			req.onerror = () => reject(req.error);
			req.onsuccess = () => {
				resolve("request succeeded");
				tx.abort();
			};
		}));
	} catch {
		rejected = true;
	}
	check(rejected, "Request success followed by transaction abort must reject the save");
	check(
		!(await store("runtimeSessions", "readonly", (s) => request(s.get("review-abort")))),
		"Aborted save must not persist",
	);

	await store("runtimeSessions", "readwrite", async (s) => {
		await request(s.put(session("review-delete", ["review-owned", "review-shared"])));
		await request(s.put(session("review-keep", ["review-shared"])));
	});
	await store("browserArtifacts", "readwrite", async (s) => {
		await request(s.put(artifact("review-owned", "review-delete", 1)));
		await request(s.put(artifact("review-unlisted", "review-delete", 2)));
		await request(s.put(artifact("review-shared", "review-delete", 3)));
		await request(s.put(artifact("review-survivor", "review-keep", 4)));
	});
	await test.deleteSessionRecordsForTest(["review-delete"]);
	check(
		!(await store("runtimeSessions", "readonly", (s) => request(s.get("review-delete")))),
		"Deleted session retained",
	);
	const kept = await store("browserArtifacts", "readonly", (s) => request(s.getAll()));
	check(!kept.some((x) => ["review-owned", "review-unlisted"].includes(x.id)), "Deleted-session snapshots retained");
	check(
		kept.some((x) => x.id === "review-shared") && kept.some((x) => x.id === "review-survivor"),
		"Shared/surviving snapshots lost",
	);
	const originalGetAll = IDBObjectStore.prototype.getAll;
	IDBObjectStore.prototype.getAll = function (...args) {
		if (this.name === "browserArtifacts") throw new Error("Unbounded artifact getAll");
		return originalGetAll.apply(this, args);
	};
	try {
		const latest = await test.listBrowserArtifactsForTest({ limit: 1 });
		check(latest.length === 1 && latest[0].id === "review-survivor", "Latest limited artifact query incorrect");
		const found = await test.listBrowserArtifactsForTest({ limit: 1, query: "review-shared" });
		check(found.length === 1 && found[0].id === "review-shared", "Filtered artifact query incorrect");
	} finally {
		IDBObjectStore.prototype.getAll = originalGetAll;
	}

	const tab = { id: 7, windowId: 3, active: true, title: "Review fixture", url: "https://example.test/fixture" };
	let pauseSelection = false, releaseSelection, enteredSelection;
	let reached, gate;
	const host = {
		async snapshotState() {
			return { windows: [{ id: 3, focused: true, tabs: [tab] }] };
		},
		async runCommand(name, args = {}) {
			if (name === "get_selection") {
				if (pauseSelection) {
					enteredSelection();
					await gate;
				}
				return { selection: { text: "", hasSelection: false } };
			}
			if (name === "get_visible_text") return { tab, visible: { text: "Alpha smoke content explains the review fixture." } };
			if (name === "extract_content") {
				return {
					tab,
					content: {
						text: "Alpha smoke content explains the review fixture.",
						markdown: "Alpha smoke content explains the review fixture.",
					},
				};
			}
			if (name === "capture_state") return { tab, page: { title: tab.title, url: tab.url, annotations: [], annotationCount: 0 } };
			return { tab, ok: true };
		},
		log() {},
		notifyAuthProgress() {},
	};
	const runtime = createOnhandBrowserRuntime(host);
	await runtime.updateSettings({
		aiProvider: "onhand-smoke",
		aiModel: "onhand-smoke-1",
		aiApiKey: "fixture",
		authMode: "api-key",
		diagnosticsEnabled: false,
		experimentalModelLaneClassifier: false,
	});
	pauseSelection = true;
	reached = new Promise((r) => enteredSelection = r);
	gate = new Promise((r) => releaseSelection = r);
	const submitting = runtime.submitPrompt({ prompt: "Summarize this fixture.", targetWindowId: 3 });
	await reached;
	check(Boolean((await runtime.getState()).activeRequestId), "Preparation did not publish a pending request");
	check((await runtime.stop()).stopped === true, "Stop during preparation was rejected");
	releaseSelection();
	await submitting;
	pauseSelection = false;
	const waitIdle = async (rt) => {
		for (let i = 0; i < 100; i++) {
			const s = await rt.getState();
			if (!s.activeRequestId) return s;
			await new Promise((r) => setTimeout(r, 20));
		}
		throw new Error("Runtime did not settle");
	};
	const stopped = await waitIdle(runtime);
	check(
		stopped.turns.at(-1)?.aborted || /stopp|cancel/i.test(stopped.status + " " + (stopped.turns.at(-1)?.reply || "")),
		"Stopped preparation was not recorded as cancelled",
	);
	await runtime.submitPrompt({ prompt: "A follow-up after stopping.", targetWindowId: 3 });
	const after = await waitIdle(runtime);
	check(after.turns.some((t) => t.userPrompt === "A follow-up after stopping."), "Cancellation prevented the next request");

	const cold = createOnhandBrowserRuntime(host);
	const get = chrome.storage.local.get.bind(chrome.storage.local);
	let releaseStorage;
	const storageGate = new Promise((r) => releaseStorage = r);
	chrome.storage.local.get = async (...args) => {
		await storageGate;
		return get(...args);
	};
	let duplicateRejected = false;
	try {
		const first = cold.submitPrompt({ prompt: "First concurrent fixture prompt.", targetWindowId: 3 });
		await new Promise((r) => setTimeout(r, 20));
		try {
			await cold.submitPrompt({ prompt: "Second concurrent fixture prompt.", targetWindowId: 3 });
		} catch {
			duplicateRejected = true;
		}
		releaseStorage();
		await first;
	} finally {
		releaseStorage();
		chrome.storage.local.get = get;
	}
	check(duplicateRejected, "Cold concurrent submit must be rejected");
	const complete = await waitIdle(cold);
	check(complete.turns.some((t) => t.userPrompt === "First concurrent fixture prompt."), "First concurrent prompt was lost");
	check(!complete.turns.some((t) => t.userPrompt === "Second concurrent fixture prompt."), "Rejected concurrent prompt was persisted");
	return {
		indexedDbCommit: true,
		indexedDbAbort: true,
		snapshotDeletion: true,
		sharedSnapshotPreserved: true,
		limitedListing: true,
		stopDuringPreparation: true,
		followUpAfterStop: true,
		concurrentSubmission: true,
	};
}

if (!findBrowser()) throw new Error("No Chromium browser found. Set ONHAND_TEST_BROWSER.");
const profile = await mkdtemp(join(tmpdir(), "onhand-runtime-review-"));
let child, ctx;
const timeout = setTimeout(() => {
	child?.kill("SIGKILL");
	console.error("Real-browser runtime review: FAIL (timeout)");
	process.exit(1);
}, 120000);
try {
	child = launchBrowser(profile, await pickAvailablePort());
	ctx = await openContext(Number(child.spawnargs.find((x) => x.startsWith("--remote-debugging-port=")).split("=")[1]));
	const results = await ctx.driverEval(`(${runBrowserCases.toString()})()`);
	assert.equal(Object.values(results).every(Boolean), true);
	console.log("Real-browser runtime review: PASS", JSON.stringify(results));
} finally {
	clearTimeout(timeout);
	ctx?.cdp.ws.close();
	if (child && child.exitCode === null && child.signalCode === null) {
		const exited = new Promise((r) => child.once("exit", r));
		child.kill("SIGKILL");
		await exited;
	}
	await rm(profile, { recursive: true, force: true });
}
