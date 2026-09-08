import assert from "node:assert/strict";

// Exercise the real runtime save path, with clone-on-read/write storage to catch
// cases where an in-memory turn looks complete but its persisted record does not.
export async function runVoiceTranscriptRegressions({ createOnhandBrowserRuntime, buildRecentConversationContext }) {
	const previousChrome = globalThis.chrome;
	let data = { onhandBrowserRuntime: { settings: { diagnosticsEnabled: false,
		experimentalModelLaneClassifier: false, modelLaneClassifierDefaultMigrated: true } } };
	globalThis.chrome = {
		runtime: { getURL: (path) => `chrome-extension://voice-test/${path}`, getManifest: () => ({ version: "test" }) },
		storage: { local: {
			async get(defaults) { return structuredClone({ ...defaults, ...data }); },
			async set(values) { Object.assign(data, structuredClone(values)); },
		} },
	};
	const host = {
		async snapshotState() { return { windows: [] }; },
		async runCommand() { return {}; }, log() {},
	};
	const citationId = "voice-source-final-paragraph";
	const userPrompt = `  Explain the following proof in detail.\n\n${"Please preserve the distinction between assumptions and conclusions. ".repeat(20)}\n\n1. Start with $x^2$.\n2. Discuss the final implication.\nUSER_TRANSCRIPT_END\n`;
	const reply = `  ## Derivation\n\n${"This paragraph explains a supported step and its assumptions. ".repeat(30)}\n\n- First step\n  - Nested explanation\n\n\`\`\`js\nconst value = 2;\n  return value;\n\`\`\`\n\n$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$\n\nThe final source supports the conclusion. [[cite:${citationId}]]\nASSISTANT_TRANSCRIPT_END\n`;
	const pageActions = [{ key: `highlight:${citationId}`, type: "annotation", annotationId: citationId,
		citationAnnotationIds: [citationId], citationText: "The final source supports the conclusion.",
		title: "Fixture PDF", url: "https://example.test/proof.pdf", pdfAnchor: { pageNumber: 9, occurrence: 2 } }];
	try {
		const runtime = createOnhandBrowserRuntime(host);
		await assert.rejects(runtime.recordRealtimeVoiceTurn({ userPrompt: " \n\t", reply: " \n" }), /needs a prompt or answer/);
		const { turn, currentSession } = await runtime.recordRealtimeVoiceTurn({ voiceTurnId: "voice-long", userPrompt, reply, pageActions,
			createdAt: "2026-09-07T12:00:00Z" });
		assert.equal(turn.userPrompt, userPrompt, "saved voice prompt must preserve all text and formatting beyond the model-context budget");
		assert.equal(turn.reply, reply, "saved voice reply must preserve Markdown, math, final paragraphs, and citation provenance");
		assert.deepEqual(turn.pageActions, pageActions);
		const sessionId = currentSession.sessionId;
		const stored = () => data.onhandBrowserSessions[sessionId];
		assert.equal(stored().turns[0].reply, reply);
		assert.equal(stored().turns[0].userPrompt, userPrompt);
		const assertBoundedMessages = (session) => {
			for (const message of session.messages) {
				const text = message.content.filter((part) => part.type === "text").map((part) => part.text).join("");
				// Existing truncate helper appends three dots after maxChars-1.
				assert.ok(text.length <= (message.role === "user" ? 262 : 702));
				assert.doesNotMatch(text, /\[\[cite:|TRANSCRIPT_END/);
			}
		};
		assertBoundedMessages(stored());
		assert.equal(stored().messages.length, 2);

		// A storage serialization + fresh runtime discards object references and
		// runtime caches; this exercises the actual persisted session reload path.
		data = JSON.parse(JSON.stringify(data));
		const restarted = createOnhandBrowserRuntime(host);
		const reloaded = await restarted.getState();
		assert.equal(reloaded.turns[0].userPrompt, userPrompt);
		assert.equal(reloaded.turns[0].reply, reply);
		assert.deepEqual(reloaded.turns[0].pageActions, pageActions);
		assert.match(reloaded.turns[0].reply, /\[\[cite:voice-source-final-paragraph\]\]/);

		const updatedPrompt = `${userPrompt}\nA follow-up clarification.\n`;
		const updatedReply = `${reply}\n### Correction\n\nPreserve this new final paragraph. [[cite:${citationId}]]\n`;
		await restarted.recordRealtimeVoiceTurn({ voiceTurnId: "voice-long", userPrompt: updatedPrompt, reply: updatedReply, pageActions,
			createdAt: "2026-09-07T12:00:00Z" });
		assert.equal(stored().turns.length, 1, "updates to a voice ID must replace its saved transcript without duplicating the turn");
		assert.equal(stored().turns[0].userPrompt, updatedPrompt);
		assert.equal(stored().turns[0].reply, updatedReply);
		assert.deepEqual(stored().turns[0].pageActions, pageActions);
		assertBoundedMessages(stored());
		data = JSON.parse(JSON.stringify(data));
		const updatedReload = await createOnhandBrowserRuntime(host).getState();
		assert.equal(updatedReload.turns[0].reply, updatedReply);

		{
			assert.equal(typeof buildRecentConversationContext, "function", "model-context verification must run with the current runtime helper");
			const turns = Array.from({ length: 7 }, (_, index) => ({ id: `voice-${index}`, userPrompt: `Prompt ${index}\n${userPrompt}`,
				reply: `Answer ${index} [[cite:${citationId}]]\n${reply}`, pending: false, error: false }));
			const context = buildRecentConversationContext({ turns });
			assert.doesNotMatch(context, /Prompt [012]\b|\[\[cite:|TRANSCRIPT_END/);
			for (const index of [3, 4, 5, 6]) assert.match(context, new RegExp(`Prompt ${index}\\b`));
			assert.ok(context.length < 4_000, "long permanent transcripts must not enlarge the four-turn model context");
		}
		console.log(`Voice transcript regressions: PASS (${userPrompt.length}-character prompt, ${reply.length}-character reply, exact formatting/citations, durable reload/upsert, bounded model history)`);
	} finally { globalThis.chrome = previousChrome; }
}
