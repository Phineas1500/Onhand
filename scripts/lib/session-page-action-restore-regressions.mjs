import assert from "node:assert/strict";

export async function runSessionPageActionRestoreRegressions({ createOnhandBrowserRuntime }) {
	const previousChrome = globalThis.chrome;
	try {
		for (const pdf of [true, false]) {
			let data = { onhandBrowserRuntime: { settings: { diagnosticsEnabled: false,
				experimentalModelLaneClassifier: false, modelLaneClassifierDefaultMigrated: true } } };
			globalThis.chrome = {
				runtime: { getURL: (path) => `chrome-extension://restore-test/${path}`, getManifest: () => ({ version: "test" }) },
				storage: { local: {
					async get(defaults) { return structuredClone({ ...defaults, ...data }); },
					async set(values) { Object.assign(data, structuredClone(values)); },
				} },
			};
			const url = pdf ? "https://example.test/garden.pdf" : "https://example.test/garden";
			const viewerUrl = `chrome-extension://restore-test/pdf-viewer.html?url=${encodeURIComponent(url)}`;
			// After restart the saved tab is native again. A different ready viewer
			// for the same PDF must not change which tab the saved action restores.
			const tabs = [{ id: 7, windowId: 3, active: !pdf, title: "Garden handbook", url },
				...(pdf ? [{ id: 8, windowId: 3, active: true, title: "Garden handbook", url: viewerUrl }] : [])];
			const calls = [];
			const ready = new Set(pdf ? [8] : [7]);
			const host = {
				async snapshotState() { return { windows: [{ id: 3, focused: true, tabs: structuredClone(tabs) }] }; },
				async runCommand(name, args = {}) {
					calls.push({ name, args: structuredClone(args) });
					const tab = tabs.find((entry) => entry.id === args.tabId) || tabs[0];
					if (name === "open_pdf_in_onhand_viewer") {
						assert.equal(args.newTab, false, "handoff must keep the selected source tab");
						ready.add(tab.id);
					}
					if (name === "wait_for_selector" && !ready.has(tab.id)) throw new Error("PDF text layer is not ready");
					if (name === "clear_annotations" && !ready.has(tab.id)) throw new Error("Native PDF cannot clear Onhand annotations");
					if (name === "highlight_text") {
						if (!ready.has(tab.id)) throw new Error("No visible text matched in the native PDF viewer");
						return { tab, annotation: { annotationId: `restored-${args.pdfAnchor?.pageNumber || args.text.at(-1)}`,
							matchedText: args.text, ...(args.pdfAnchor ? { pdfAnchor: args.pdfAnchor } : {}) } };
					}
					return { tab, ok: true };
				},
				log() {},
			};
			const actions = [1, 2, 3].flatMap((page) => {
				const annotationId = `saved-${page}`;
				const common = { annotationId, tabId: 7, windowId: 3, title: "Garden handbook", url,
					...(pdf ? { pdfAnchor: { surface: "pdf", viewer: "onhand-pdf-viewer", pageNumber: page, occurrence: 2,
						document: { url, pdfUrl: url, viewerUrl }, textQuote: { exact: `Garden practice ${page}` } } } : {}) };
				return [{ ...common, key: `highlight:${annotationId}`, type: "annotation", label: "Highlight", citationText: `Garden practice ${page}` },
					{ ...common, key: `note:${annotationId}`, type: "note", label: "Note", citationText: `Explanation ${page}` }];
			});
			const original = createOnhandBrowserRuntime(host);
			const saved = await original.recordRealtimeVoiceTurn({ voiceTurnId: "saved-answer", userPrompt: "Explain the garden practices.",
				reply: "Saved PDF citations [[cite:saved-1]] [[cite:saved-2]] [[cite:saved-3]]", pageActions: actions });
			const sessionId = saved.currentSession.sessionId;
			assert.deepEqual(data.onhandBrowserSessions[sessionId].artifactIds, [], "fixture must exercise page-actions-only restore");
			data = JSON.parse(JSON.stringify(data));
			const restarted = createOnhandBrowserRuntime(host);
			calls.length = 0;
			const result = await restarted.restoreSession(sessionId);
			assert.equal(result.restoredPages.length, 1);
			assert.equal(result.restoredPages[0].tabId, 7, "preserve the saved source-tab match even when a second viewer is ready");
			assert.equal(result.restoredPages[0].restoredAnnotations, 3, "all page-action highlights must survive a native-PDF restart");
			assert.equal(result.restoredPages[0].restoredNotes, 3);
			assert.equal(result.restoredPages[0].failedCount, 0);
			const handoffs = calls.filter((call) => call.name === "open_pdf_in_onhand_viewer");
			const waits = calls.filter((call) => call.name === "wait_for_selector");
			const highlights = calls.filter((call) => call.name === "highlight_text");
			assert.equal(handoffs.length, pdf ? 1 : 0, "handoff once per PDF group and never for an ordinary web page");
			assert.equal(waits.length, pdf ? 1 : 0);
			assert.equal(highlights.length, 3);
			assert.equal(calls.some((call) => ["navigate", "reopen_onhand_pdf_viewer"].includes(call.name)), false);
			assert.ok(calls.filter((call) => ["open_pdf_in_onhand_viewer", "wait_for_selector", "clear_annotations", "highlight_text", "show_note"].includes(call.name))
				.every((call) => call.args.tabId === 7), "do not modify the second ready viewer");
			if (pdf) {
				const openIndex = calls.indexOf(handoffs[0]);
				const waitIndex = calls.indexOf(waits[0]);
				assert.ok(openIndex < waitIndex && waitIndex < calls.findIndex((call) => call.name === "clear_annotations"));
				assert.ok(waitIndex < calls.indexOf(highlights[0]));
				assert.deepEqual(highlights.map((call) => call.args.pdfAnchor), actions.filter((action) => action.type === "annotation").map((action) => action.pdfAnchor));
			}
			const restoredActions = data.onhandBrowserSessions[sessionId].turns[0].pageActions;
			for (const action of restoredActions) {
				assert.equal(action.tabId, 7);
				assert.ok(action.annotationId.startsWith("restored-"));
				assert.ok(action.citationAnnotationIds.includes(action.key.split(":")[1]), "rebound annotations must retain their original citation aliases");
			}
		}
		console.log("Session page-action restore regressions: PASS (native PDF handoff/readiness, saved tab ownership, three pages/notes, citation aliases, ordinary web unchanged)");
	} finally { globalThis.chrome = previousChrome; }
}
