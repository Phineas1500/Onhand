import assert from "node:assert/strict";

// Real runtime methods with deterministic storage/clock/browser metadata. The
// fixture is deliberately larger than the current conversation so idle work
// cannot accidentally scale with all saved sessions unnoticed.
export async function runSidebarPollRegressions({ createOnhandBrowserRuntime }) {
	const previousChrome = globalThis.chrome;
	const originalNow = Date.now;
	let now = Date.parse("2026-09-07T12:00:00Z");
	const DAY = 86_400_000;
	const iso = (value) => new Date(value).toISOString();
	let snoozeReads = 0;
	let snapshotCalls = 0;
	const concept = (id, label, lastSeen, url = "https://source-a.test/lesson") => ({
		conceptId: id, label, firstSeenAt: iso(lastSeen), lastSeenAt: iso(lastSeen),
		sources: [{ url, annotationId: id }],
	});
	const sessions = Object.fromEntries(Array.from({ length: 100 }, (_, index) => {
		const id = `session-${index}`;
		return [id, {
			id, name: id, createdAt: iso(now - 10 * DAY), updatedAt: iso(now),
			messages: [], turns: [], pageActions: [], artifactIds: [],
			learnerState: { mode: "learning", conceptsIntroduced: Array.from({ length: 20 }, (_, n) =>
				concept(`${id}-${n}`, `Concept ${index} ${n}`, now - 4 * DAY,
					index % 2 ? "https://source-b.test/lesson" : "https://source-a.test/lesson")), openChecks: [], responses: [] },
		}];
	}));
	sessions["session-0"].turns = Array.from({ length: 100 }, (_, index) => ({
		id: `turn-${index}`, createdAt: iso(now - DAY), userPrompt: `Question ${index}`,
		reply: "A supported answer with substantial explanatory detail. ".repeat(70),
		pageActions: Array.from({ length: 6 }, (_, source) => ({
			key: `highlight:${index}-${source}`, type: "annotation", annotationId: `${index}-${source}`,
			citationText: "A substantial source passage. ".repeat(12), url: "https://source-a.test/lesson",
		})), activities: [], pending: false,
	}));
	const data = {
		onhandBrowserRuntime: { currentSessionId: "session-0", settings: {
			learningMode: true, diagnosticsEnabled: false,
			experimentalModelLaneClassifier: false, modelLaneClassifierDefaultMigrated: true,
		} },
		onhandBrowserSessions: sessions,
		onhandReviewSnoozes: {},
	};
	globalThis.chrome = {
		runtime: { getURL: (path) => `chrome-extension://test/${path}`, getManifest: () => ({ version: "test" }) },
		storage: { local: {
			async get(defaults) {
				if (Object.hasOwn(defaults, "onhandReviewSnoozes")) snoozeReads += 1;
				return { ...defaults, ...data };
			},
			async set(values) { Object.assign(data, values); },
		} },
	};
	const host = {
		async snapshotState() {
			snapshotCalls += 1;
			return { windows: [{ id: 1, focused: true, tabs: [{ id: 7, windowId: 1, active: true, url: "https://source-a.test/lesson" }] }] };
		},
		async runCommand() { return {}; }, log() {},
	};
	Date.now = () => now;
	try {
		const runtime = createOnhandBrowserRuntime(host);
		const initial = await runtime.getSidebarState({ activeUrl: "https://source-a.test/lesson" });
		assert.equal(initial.historyUnchanged, false);
		assert.equal(initial.state.turns.length, 100);
		assert.ok(initial.state.dueReviews.every((review) => review.matchesActiveTab));
		const fullBytes = Buffer.byteLength(JSON.stringify(initial));
		snoozeReads = 0;
		snapshotCalls = 0;
		let idle;
		const started = performance.now();
		for (let index = 0; index < 25; index += 1) {
			idle = await runtime.getSidebarState({ activeUrl: "https://source-a.test/lesson", knownHistoryRevision: initial.historyRevision });
			assert.equal(idle.historyUnchanged, true);
			assert.equal(Object.hasOwn(idle.state, "turns"), false);
			assert.equal(Object.hasOwn(idle.state, "messages"), false);
			assert.ok(Object.hasOwn(idle.state, "pageActions"), "live actions must remain in partial states");
			assert.ok(Object.hasOwn(idle.state, "preferences"), "settings must remain in partial states");
		}
		const idleMs = performance.now() - started;
		const idleBytes = Buffer.byteLength(JSON.stringify(idle));
		assert.ok(idleBytes < fullBytes * 0.05, `idle response should omit history: ${idleBytes}/${fullBytes} bytes`);
		assert.equal(snoozeReads, 0, "unchanged polls must reuse due-review computation/storage work");
		assert.equal(snapshotCalls, 0, "the background's active URL must avoid duplicate browser snapshots");
		assert.equal((await runtime.getState()).turns.length, 100, "legacy callers still receive full state");
		assert.equal((await runtime.getSidebarState({ knownHistoryRevision: "unknown", activeUrl: "https://source-a.test" })).historyUnchanged, false);

		const otherTab = await runtime.getSidebarState({ activeUrl: "https://source-b.test/other", knownHistoryRevision: initial.historyRevision });
		assert.equal(otherTab.historyUnchanged, true, "tab changes do not resend conversation history");
		assert.ok(otherTab.state.dueReviews.every((review) => review.sources.some((source) => source.url.startsWith("https://source-b.test/"))));
		assert.equal(snoozeReads, 1, "new active host must rerank reviews immediately");
		const snoozedKey = otherTab.state.dueReviews[0].conceptKey;
		await runtime.snoozeReview({ conceptKey: snoozedKey, days: 3 });
		const snoozed = await runtime.getSidebarState({ activeUrl: "https://source-b.test/other" });
		assert.ok(snoozed.state.dueReviews.every((review) => review.conceptKey !== snoozedKey));
		const externalKey = snoozed.state.dueReviews[0].conceptKey;
		data.onhandReviewSnoozes[externalKey] = iso(now + DAY);
		runtime.invalidateReviewCache(); // background storage.onChanged bridge
		assert.ok((await runtime.getSidebarState({ activeUrl: "https://source-b.test" })).state.dueReviews.every((review) => review.conceptKey !== externalKey));

		await runtime.renameSession("Renamed review session");
		const renamed = await runtime.getSidebarState({ knownHistoryRevision: initial.historyRevision, activeUrl: "https://source-a.test" });
		assert.equal(renamed.historyUnchanged, false, "persisted mutations invalidate history even when array references survive");
		assert.equal(renamed.state.currentSession.sessionName, "Renamed review session");
		await runtime.switchSession("session-1");
		const switched = await runtime.getSidebarState({ knownHistoryRevision: renamed.historyRevision, activeUrl: "https://source-a.test" });
		assert.equal(switched.historyUnchanged, false);
		assert.equal(switched.state.currentSession.sessionId, "session-1");
		assert.deepEqual(switched.state.turns, []);
		await runtime.recordLearningEvent({ kind: "concept_introduced", conceptId: "new-concept", conceptLabel: "A new concept", url: "https://source-a.test/new" });
		const learned = await runtime.getSidebarState({ knownHistoryRevision: switched.historyRevision, activeUrl: "https://source-a.test" });
		assert.equal(learned.historyUnchanged, false);
		assert.ok(learned.state.learnerState.conceptsIntroduced.some((item) => item.conceptId === "new-concept"));

		const restarted = createOnhandBrowserRuntime(host);
		assert.equal((await restarted.getSidebarState({ knownHistoryRevision: learned.historyRevision, activeUrl: "https://source-a.test" })).historyUnchanged, false,
			"worker/runtime restarts must never accept a previous epoch's token");
		assert.notEqual((await restarted.getSidebarState({ activeUrl: "https://source-a.test" })).historyRevision, learned.historyRevision);

		// A fresh, one-concept runtime isolates the clock boundary and confirms
		// caches are local to one runtime rather than shared across instances.
		data.onhandBrowserRuntime.currentSessionId = "clock-session";
		data.onhandBrowserSessions = {
			"clock-session": { ...sessions["session-1"], id: "clock-session", turns: [], messages: [], learnerState: {
				mode: "learning", conceptsIntroduced: [concept("clock", "Clock concept", now - DAY + 1_000)], openChecks: [], responses: [],
			} },
		};
		const clockRuntime = createOnhandBrowserRuntime(host);
		const before = await clockRuntime.getSidebarState({ activeUrl: "https://source-a.test" });
		assert.deepEqual(before.state.dueReviews, []);
		now += 60_001;
		snoozeReads = 0;
		const concurrent = await Promise.all(Array.from({ length: 8 }, () => clockRuntime.getSidebarState({
			activeUrl: "https://source-a.test", knownHistoryRevision: before.historyRevision,
		})));
		assert.equal(snoozeReads, 1, "concurrent polls share a single expired-cache recomputation");
		assert.equal(concurrent[0].historyUnchanged, true, "time-based reviews refresh without resending history");
		assert.equal(concurrent[0].state.dueReviews[0].label, "Clock concept", "a newly due review appears within the documented one-minute TTL");
		await clockRuntime.snoozeReview({ conceptKey: "clock concept", days: 0.5 });
		assert.deepEqual((await clockRuntime.getSidebarState({ activeUrl: "https://source-a.test" })).state.dueReviews, []);
		now += DAY;
		assert.equal((await clockRuntime.getSidebarState({ activeUrl: "https://source-a.test" })).state.dueReviews[0].label, "Clock concept", "expired snoozes must reappear without user mutation");
		console.log(`Sidebar polling regressions passed: 100 sessions, 100 turns; full ${fullBytes} bytes, idle ${idleBytes} bytes; 25 idle calls ${idleMs.toFixed(1)}ms, zero review reads/browser snapshots.`);
	} finally {
		globalThis.chrome = previousChrome;
		Date.now = originalNow;
	}
}
