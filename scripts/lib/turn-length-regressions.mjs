import assert from "node:assert/strict";

// Two Onhand Free turns on 2026-11-19 kept reading until the service refused
// their 51st model call, and the user got an error with no answer. Ordinary
// turns use far fewer calls (median 4, largest 18 of 267 real Free turns), so a
// turn is now told to answer after 30 calls, and past 40 its next call goes out
// with tools switched off.
export async function runTurnLengthRegressions({ installChromeStorageStub }) {
	installChromeStorageStub();
	const { __browserRuntimeTest: test } = await import("../../packages/browser-extension/onhand-runtime.bundle.js");
	const guard = (commandName, request) => test.buildTurnLengthAnswerNowGuardResultForTest(`browser_${commandName}`, commandName, request);

	// Ordinary turns are left alone.
	for (const modelCallCount of [0, 1, 18, 30]) {
		assert.equal(guard("extract_content", { modelCallCount }), null, `${modelCallCount} model calls is an ordinary turn`);
	}
	assert.equal(guard("navigate", {}), null);
	assert.equal(guard("navigate", null), null);

	// Past 30 calls, page work is refused and the model is told to answer.
	const blocked = guard("extract_content", { modelCallCount: 31 });
	assert.equal(blocked.guardrail.kind, "turn_length_answer_now");
	assert.equal(blocked.guardrail.blockedTool, "browser_extract_content");
	assert.equal(blocked.guardrail.blockedCommand, "extract_content");
	assert.match(blocked.guardrail.message, /Answer the user's question now from what you have already read/);
	assert.match(blocked.guardrail.message, /say in one short sentence what is left/);
	assert.doesNotMatch(blocked.guardrail.message, /\d/, "the message carries no count the model could repeat to the user");
	for (const commandName of ["navigate", "get_visible_text", "pdf_read_pages", "pdf_search", "search_linked_pdf_corpus", "click", "type", "run_js", "open_pdf_in_onhand_viewer"]) {
		assert.equal(guard(commandName, { modelCallCount: 31 })?.guardrail?.kind, "turn_length_answer_now", `${commandName} is refused in a long turn`);
	}
	// Marking text that was already read is how the answer shows its sources.
	for (const commandName of ["highlight_text", "show_note", "scroll_to_annotation"]) {
		assert.equal(guard(commandName, { modelCallCount: 39 }), null, `${commandName} stays available`);
	}
	// Planning and evidence checks are model calls of the same turn: the
	// service counts them, so the turn does too.
	assert.equal(guard("navigate", { modelCallCount: 20, internalModelCallCount: 10 }), null);
	assert.equal(guard("navigate", { modelCallCount: 20, internalModelCallCount: 11 })?.guardrail?.kind, "turn_length_answer_now");
	assert.equal(guard("navigate", { modelCallCount: 45, aborted: true }), null, "a stopped turn is not steered");

	// Past 40 calls, the next model call cannot use tools at all.
	const context = { systemPrompt: "You are Onhand.", messages: [{ role: "user", content: "question" }], tools: [{ name: "browser_navigate" }] };
	const options = { reasoning: "low", signal: "kept" };
	assert.equal(test.turnLengthFinalAnswerStreamArgsForTest({ modelCallCount: 40 }, context, options), null, "the 40th call is an ordinary call");
	assert.equal(test.turnLengthFinalAnswerStreamArgsForTest({ modelCallCount: 12, internalModelCallCount: 3 }, context, options), null);
	const final = test.turnLengthFinalAnswerStreamArgsForTest({ modelCallCount: 41 }, context, options);
	assert.equal(final.options.toolChoice, "none", "the call is sent with tools switched off");
	assert.equal(final.options.reasoning, "low", "the call's other options are kept");
	assert.equal(final.options.signal, "kept");
	assert.ok(final.context.systemPrompt.startsWith("You are Onhand.\n\n"), "the instruction is added after the turn's own prompt");
	assert.match(final.context.systemPrompt, /Write the final answer to the user's question now/);
	assert.match(final.context.systemPrompt, /never mention internal budgets, guardrails, or tool limits/);
	assert.equal(final.context.messages, context.messages, "the conversation is unchanged");
	assert.equal(final.context.tools, context.tools, "the tool list is unchanged, so the cached prompt prefix still matches");
	assert.equal(context.systemPrompt, "You are Onhand.", "the turn's own context is not modified");
	assert.equal(options.toolChoice, undefined, "the turn's own options are not modified");
	assert.equal(test.turnLengthFinalAnswerStreamArgsForTest({ modelCallCount: 30, internalModelCallCount: 11 }, context, options)?.options?.toolChoice, "none");
	assert.equal(test.turnLengthFinalAnswerStreamArgsForTest({ modelCallCount: 41 }, { messages: [] }, {}).context.systemPrompt.startsWith("This turn has taken too many steps"), true, "a turn without a system prompt still gets the instruction");

	// Retries that ask for more page work are skipped once tools are off.
	assert.equal(test.turnLengthToolsAreOffForTest({ modelCallCount: 39 }), false);
	assert.equal(test.turnLengthToolsAreOffForTest({ modelCallCount: 40 }), true, "after 40 calls the next one has no tools");
	assert.equal(test.turnLengthToolsAreOffForTest({ modelCallCount: 35, internalModelCallCount: 5 }), true);
	assert.equal(test.turnLengthToolsAreOffForTest({}), false);

	// Telemetry names these apart from the mark budgets, with no text.
	const refused = (toolName, kind) => ({ toolName, state: "error", error: `Guardrail blocked ${toolName}: private page words`, duration_ms: 3, resultDetails: { guardrail: { kind } } });
	const reasons = test.summarizeToolReliabilityForTest([], [], [
		refused("browser_extract_content", "turn_length_answer_now"),
		refused("browser_extract_content", "turn_length_answer_now"),
		refused("browser_navigate", "turn_length_answer_now"),
		refused("browser_highlight_text", "weak_highlight"),
	]).tool_failure_reasons;
	assert.equal(reasons, "extract_content:turn_limit*2,navigate:turn_limit*1,highlight_text:guard*1");

	// A long turn's refusals are steering, not page failures: they must not
	// also trip the repeated-failure limit.
	const steering = Array.from({ length: 8 }, () => refused("browser_extract_content", "turn_length_answer_now"));
	assert.equal(test.buildRepeatedToolFailureAnswerNowGuardResultForTest("browser_navigate", "navigate", { toolTraces: steering }), null);

	console.log("Long turns are told to answer, then lose tools passed");
}
