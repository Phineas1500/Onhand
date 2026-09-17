import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import '../../packages/browser-extension/live-responses.js';
import '../../packages/browser-extension/live-interruptions.js';
import { uploadLiveImage, uploadLiveText } from '../../packages/browser-extension/live-responses-files.js';

export async function runManagedLiveRegressions() {
	let count = 0;
	async function check(name, run) { await run(); count++; console.log(`PASS managed Live: ${name}`); }
	function harness(overrides = {}) {
		const state = { currentSession: { sessionId: 'session' }, preferences: { liveInterruptionEnabled: Boolean(overrides.interruptions) }, activeRequestId: null };
		const sent = [], starts = [], updates = [], calls = [], finishes = [], errors = [], usages = [], stopped = [];
		let sequence = 0;
		const diagnostics = [];
		const coordinator = globalThis.OnhandLiveResponses.createCoordinator({
			getState: () => state, send: event => sent.push(event), config: async () => ({ model: 'gpt-5.6-terra', tools: [], tool_choice: 'auto' }),
			classify: overrides.classify, onDiagnostic: event => diagnostics.push(event),
			begin: async task => { starts.push(task); state.activeRequestId = task.requestId; await overrides.begin?.(task); },
			update: async task => { updates.push(task); },
			review: overrides.review || (async () => ({ ready: true })),
			tool: async task => { calls.push(task); return overrides.tool ? await overrides.tool(task) : { output: 'verified result' }; },
			image: overrides.image || (async () => ({ type: 'input_image', file_id: 'file-image-fixture', detail: 'auto' })),
			file: overrides.file || (async () => ({ type: 'input_file', file_id: `file-text-${++sequence}` })),
			finish: async task => { finishes.push(task); state.activeRequestId = null; },
			stop: async id => { stopped.push(id); }, onStatus() {}, onError: error => errors.push(error), onUsage: usage => usages.push(usage),
		}, { interruption: { debounceMs: 1, intervalMs: 1, timeoutMs: 100, ...overrides.interruptionOptions } });
		const emit = event => coordinator.handle({ event_id: `server_${++sequence}`, ...event });
		const event = (type, fields = {}, delegation_id = 'delegation') => emit({ type: 'response.event', delegation_id, event: { type, ...fields } });
		const created = (id, delegation) => event('response.created', { response: { id, output: [] } }, delegation);
		const call = (id, name = 'browser_highlight_text', args = '{}', delegation) => event('response.output_item.done', { item: { id: `item_${id}`, type: 'function_call', call_id: id, name, arguments: args } }, delegation);
		const done = (id, extra = {}, delegation) => event('response.completed', { response: { id, output: [], ...extra } }, delegation);
		const answer = (text, delegation) => event('response.output_item.done', { item: { id: 'answer', type: 'message', content: [{ type: 'output_text', text }] } }, delegation);
		emit({ type: 'session.started', session: { id: 'live' } });
		const input = (text, start_ms = 200, extra = {}) => emit({ type: 'session.input_transcript.delta', delta: text, start_ms, end_ms: start_ms + 100, ...extra });
		const delegate = (id = 'delegation', offset_ms = 100) => emit({ type: 'session.delegation.created', offset_ms, delegation: { id, target: 'responses' } });
		const context = (id = 'context', relation = 'new', delegation = 'delegation') => call(id, 'onhand_get_context', JSON.stringify({ request_relation: relation, full_request: 'Compare both models, including quality and training cost.' }), delegation);
		return { state, sent, starts, updates, calls, finishes, errors, usages, stopped, diagnostics, coordinator, emit, event, created, call, done, answer, input, delegate, context };
	}
	await check('correction supervision is opt-in and captions cannot start it when disabled', async () => {
		let checks = 0; const h = harness({ classify: async () => { checks++; return { action: 'pause' }; } });
		h.delegate(); h.created('r1'); h.context(); h.input('Actually, change the comparison.'); await delay(10);
		assert.equal(checks, 0); assert.equal(h.coordinator.snapshot().pageWorkPaused, false); h.coordinator.dispose();
	});
	await check('acknowledgments and independent questions do not pause the original task', async () => {
		const h = harness({ interruptions: true, classify: async input => ({ action: input.speech.includes('weather') ? 'unrelated' : 'continue' }) });
		h.delegate(); h.created('r1'); h.context(); h.input('Mm-hmm.'); await delay(8);
		assert.equal(h.coordinator.snapshot().pageWorkPaused, false);
		h.input(' What is the weather?', 400); await delay(8); h.call('mark'); h.done('r1'); await delay(8);
		assert.equal(h.calls.length, 2); assert.equal(h.sent.filter(e => e.type === 'response.create').length, 1);
		assert.equal(h.diagnostics.some(e => e.type === 'page_work_paused'), false); h.coordinator.dispose();
	});
	await check('correction pauses queued actions before Terra classifies it and hands off on Live delegation', async () => {
		let release; const pending = new Promise(resolve => { release = resolve; });
		const h = harness({ interruptions: true, classify: async () => ({ action: 'pause', usage: { input_tokens: 50, output_tokens: 5 } }),
			tool: async task => { if (task.callId === 'in-flight') await pending; return { output: 'actual completed action' }; } });
		h.delegate(); h.created('r1'); h.context(); h.call('in-flight'); h.call('must-skip'); h.done('r1'); await delay(8);
		h.input('Actually, only compare the German results.'); await delay(8);
		assert.equal(h.coordinator.snapshot().pageWorkPaused, true); release(); await delay(8);
		assert.equal(h.calls.length, 2); assert.equal(h.sent.some(e => e.type === 'response.create'), false);
		assert.equal(h.sent.find(e => e.item?.call_id === 'in-flight').item.output, 'actual completed action');
		h.delegate('corrected', 350); await delay(8);
		assert.equal(h.calls.some(call => call.callId === 'must-skip'), false);
		assert.match(h.sent.find(e => e.item?.call_id === 'must-skip').item.output, /not run/);
		assert.equal(h.finishes[0].superseded, true);
		h.created('r2', 'corrected'); h.context('new-context', 'continue', 'corrected'); h.done('r2', {}, 'corrected'); await delay(8);
		assert.equal(h.starts[1].requestId, h.starts[0].requestId); assert.equal(h.starts[1].revision, 2);
		assert.equal(h.coordinator.snapshot().checkInputTokens, 50);
		assert.equal(h.diagnostics.some(e => JSON.stringify(e).includes('German')), false, 'logs exclude speech');
		h.coordinator.dispose(); await delay(8);
	});
	await check('manual resume releases the pause without repeating completed page actions', async () => {
		const h = harness({ interruptions: true, classify: async () => ({ action: 'pause' }) });
		h.delegate(); h.created('r1'); h.context(); h.done('r1'); await delay(8);
		h.created('r2'); h.input('Wait, let me correct that.'); await delay(8); h.call('mark'); h.done('r2'); await delay(8);
		assert.equal(h.calls.length, 1); h.coordinator.resumePageWork(); await delay(8);
		assert.equal(h.calls.length, 2); assert.equal(h.calls.filter(c => c.callId === 'context').length, 1);
		assert.equal(h.coordinator.snapshot().pageWorkPaused, false); h.coordinator.dispose(); await delay(5);
	});
	await check('stale check decisions cannot pause a newer transcript or delegation', async () => {
		let release, count = 0; const pending = new Promise(resolve => { release = resolve; });
		const h = harness({ interruptions: true, classify: async () => { if (++count === 1) { await pending; return { action: 'pause' }; } return { action: 'continue' }; } });
		h.delegate(); h.created('r1'); h.context(); h.input('Actually'); await delay(8);
		h.input(' never mind, that was right.', 400); release(); await delay(15);
		assert.equal(h.coordinator.snapshot().pageWorkPaused, false); assert.equal(count, 2);
		assert.ok(h.diagnostics.some(e => e.type === 'check_stale')); h.coordinator.dispose();
	});
	await check('delayed original captions and duplicate events never become corrections', async () => {
		let count = 0; const h = harness({ interruptions: true, classify: async () => { count++; return { action: 'continue' }; } });
		h.delegate('delegation', 500); h.created('r1'); h.context(); h.input('Original question.', 100); await delay(8);
		assert.equal(count, 0); h.input('Okay.', 700, { event_id: 'unique-caption' }); h.input('Okay.', 700, { event_id: 'unique-caption' }); await delay(8);
		assert.equal(count, 1); h.coordinator.dispose();
	});
	await check('failed checks do not end Voice or release a confirmed pause; End releases waiters', async () => {
		let count = 0; const h = harness({ interruptions: true, classify: async () => { if (++count === 1) return { action: 'pause' }; throw new Error('provider unavailable'); } });
		h.delegate(); h.created('r1'); h.context(); h.done('r1'); await delay(8);
		h.created('r2'); h.input('Wait, I need to change that.'); await delay(8); h.call('not-started'); h.done('r2');
		h.input(' Only compare the first column.', 400); await delay(8);
		assert.equal(h.coordinator.snapshot().pageWorkPaused, true); assert.equal(h.errors.length, 0);
		h.coordinator.close(); await delay(8); assert.equal(h.calls.length, 1); assert.equal(h.finishes[0].aborted, true);
	});
	await check('classifier request has bounded data, no tools and strict structured output', async () => {
		let body; const answer = await globalThis.OnhandLiveInterruptions.classify({ request: 'Explain photosynthesis.', speech: 'Actually, only the light reactions.' }, 'fixture', async (_, init) => {
			body = JSON.parse(init.body); return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"action":"pause"}' }] }], usage: { input_tokens: 32, output_tokens: 6 } }) };
		});
		assert.equal(answer.action, 'pause'); assert.equal(body.model, 'gpt-5.6-luna'); assert.equal(body.store, false); assert.equal(body.tools, undefined);
		assert.equal(body.text.format.strict, true); assert.equal(answer.usage.input_tokens, 32);
		assert.throws(() => globalThis.OnhandLiveInterruptions.validate({ action: 'run_tools' }));
		await assert.rejects(globalThis.OnhandLiveInterruptions.classify({ request: 'Q', speech: 'x'.repeat(3001) }, 'fixture'), /Invalid/);
	});
	await check('acknowledgments cannot resume a confirmed pause but an explicit withdrawal can', async () => {
		let checks = 0;
		const h = harness({ interruptions: true, classify: async () => ({ action: ['pause', 'continue', 'resume'][checks++] }) });
		h.delegate(); h.created('r1'); h.context(); h.done('r1'); await delay(8);
		h.created('r2'); h.input('Actually, wait.'); await delay(8); h.call('mark'); h.done('r2');
		h.input(' Mm-hmm.', 400); await delay(8);
		assert.equal(h.coordinator.snapshot().pageWorkPaused, true); assert.equal(h.calls.length, 1);
		h.input(' Never mind, continue the original request.', 600); await delay(8);
		assert.equal(h.coordinator.snapshot().pageWorkPaused, false); assert.equal(h.calls.length, 2);
		h.coordinator.dispose();
	});
	await check('a correction during answer review blocks the repair continuation', async () => {
		let release; const pending = new Promise(resolve => { release = resolve; });
		const h = harness({ interruptions: true, classify: async () => ({ action: 'pause' }), review: async () => {
			await pending; return { ready: false, instruction: 'Gather more evidence.' };
		} });
		h.delegate(); h.created('r1'); h.context(); h.done('r1'); await delay(8);
		h.created('r2'); h.answer('The original draft.'); h.done('r2'); await delay(8);
		h.input('Actually, compare only German.'); await delay(8); release(); await delay(8);
		assert.equal(h.sent.filter(e => e.type === 'response.create').length, 1);
		assert.equal(h.finishes.length, 0);
		h.delegate('revised', 350); await delay(8);
		assert.equal(h.finishes[0].superseded, true);
		assert.equal(h.sent.some(e => JSON.stringify(e.item || {}).includes('Gather more evidence.')), false);
		h.coordinator.dispose();
	});
	await check('late decisions after End cannot steer or pause and timeouts never end Voice', async () => {
		let release; const pending = new Promise(resolve => { release = resolve; });
		const h = harness({ interruptions: true, classify: async () => { await pending; return { action: 'pause' }; } });
		h.delegate(); h.created('r1'); h.context(); h.input('Actually, wait.'); await delay(8);
		h.coordinator.close(); release(); await delay(8);
		assert.equal(h.sent.some(e => e.type === 'session.instructions.append'), false);
		assert.equal(h.diagnostics.some(e => e.type === 'page_work_paused'), false);
		const timed = harness({ interruptions: true, classify: () => new Promise(() => {}), interruptionOptions: { timeoutMs: 3 } });
		timed.delegate(); timed.created('r1'); timed.context(); timed.input('Actually, wait.'); await delay(12);
		assert.ok(timed.diagnostics.some(e => e.type === 'check_failed'));
		assert.equal(timed.errors.length, 0); timed.call('mark'); timed.done('r1'); await delay(8);
		assert.equal(timed.calls.length, 2); timed.coordinator.dispose();
	});
	await check('supervision has a per-call budget and ignores late decisions for retired tasks', async () => {
		let checks = 0;
		const h = harness({ interruptions: true, classify: async () => { checks++; return { action: 'continue' }; }, interruptionOptions: { maxChecks: 1 } });
		h.delegate(); h.created('r1'); h.context(); h.input('Okay.'); await delay(8);
		h.input(' Thanks.', 400); await delay(8); h.input(' Yes.', 600); await delay(8);
		assert.equal(checks, 1); assert.equal(h.diagnostics.filter(e => e.type === 'check_budget_exhausted').length, 1);
		h.coordinator.dispose();
		let release; const pending = new Promise(resolve => { release = resolve; });
		const retired = harness({ interruptions: true, classify: async () => { await pending; return { action: 'pause' }; } });
		retired.delegate(); retired.created('r1'); retired.context(); retired.input('Actually, wait.'); await delay(8);
		retired.delegate('revised', 350); retired.created('r2', 'revised'); retired.context('context2', 'continue', 'revised');
		release(); await delay(8); assert.equal(retired.diagnostics.some(e => e.type === 'page_work_paused'), false);
		retired.coordinator.dispose();
	});
	await check('empty lifecycle snapshots retain completed function calls and continue exactly once', async () => {
		const h = harness(); h.created('r1'); h.call('a'); h.call('b'); h.done('r1'); h.done('r1');
		await delay(15);
		assert.equal(h.calls.length, 2);
		const responseEvents = h.sent.filter(item => item.type.startsWith('response.'));
		assert.deepEqual(responseEvents.map(item => item.type), ['response.item.create', 'response.item.create', 'response.create']);
		assert.equal(responseEvents[0].item.call_id, 'a'); assert.equal(responseEvents[1].item.call_id, 'b');
		assert.deepEqual(Object.keys(responseEvents[2]).sort(), ['event_id', 'type']);
		h.created('r2'); h.answer('Complete answer with [[cite:mark-1]].'); h.done('r2'); await delay(15);
		assert.equal(h.starts.length, 1); assert.equal(h.finishes.length, 1);
		assert.equal(h.finishes[0].reply, 'Complete answer with [[cite:mark-1]].');
		assert.equal(h.finishes[0].modelCalls, 2);
		assert.equal(h.sent.some(item => item.type === 'session.commentary.append'), false, 'managed results return directly to Live');
		assert.equal(h.errors.length, 0); h.coordinator.dispose();
	});
	await check('arguments-done is not a function call, duplicates cannot repeat a side effect', async () => {
		const h = harness(); h.created('r1'); h.event('response.function_call_arguments.done', { arguments: '{}' });
		await delay(5); assert.equal(h.calls.length, 0);
		h.call('a'); h.call('a'); h.done('r1'); await delay(10); assert.equal(h.calls.length, 1);
		h.created('r2'); h.call('a'); h.done('r2'); await delay(10); assert.equal(h.calls.length, 1);
		h.coordinator.dispose(); await delay(5);
	});
	await check('a complete correction resumes the SAME managed delegation without waiting for Live', async () => {
		let release; const pending = new Promise(resolve => { release = resolve; });
		const h = harness({ interruptions: true, classify: async () => ({ action: 'revise' }),
			tool: async task => { if (task.callId === 'in-flight') await pending; return { output: 'Completed evidence.' }; } });
		h.delegate(); h.created('r1'); h.context(); h.call('in-flight'); h.call('stale-mark'); h.done('r1'); await delay(8);
		h.input('Actually, only English to German, in BLEU points.'); await delay(8);
		assert.equal(h.sent.some(e => e.type === 'response.create'), false, 'wait for the real receipt');
		release(); await delay(12);
		assert.equal(h.calls.some(c => c.callId === 'stale-mark'), false);
		const events = h.sent.filter(e => e.type.startsWith('response.'));
		assert.deepEqual(events.slice(-3).map(e => e.item?.call_id || e.type), ['stale-mark', 'response.item.create', 'response.create']);
		const correction = events.at(-2).item;
		assert.equal(correction.role, 'user');
		assert.match(correction.content[0].text, /quality and training cost/);
		assert.match(correction.content[0].text, /English to German/);
		assert.equal(h.finishes.length, 0); assert.equal(h.starts.length, 1);
		assert.equal(h.coordinator.snapshot().pageWorkPaused, false);
		h.created('r2');
		h.call('corrected-context', 'onhand_get_context', JSON.stringify({ request_relation: 'continue', full_request: 'Compare English to German in BLEU points and training cost.' }));
		h.done('r2'); await delay(10);
		assert.match(h.calls.at(-1).prompt, /BLEU points and training cost/);
		assert.equal(h.sent.filter(e => e.type === 'session.update').at(-1).session.delegation.responses.tool_choice, 'auto', 'restore normal tools after resolving context');
		h.created('r3'); h.answer('The revised grounded answer.'); h.done('r3'); await delay(10);
		assert.equal(h.finishes.length, 1); assert.equal(h.finishes[0].requestId, h.starts[0].requestId);
		assert.equal(h.finishes[0].reply, 'The revised grounded answer.');
		assert.equal(h.finishes[0].prompt, 'Compare English to German in BLEU points and training cost.');
		assert.equal(h.errors.length, 0); h.coordinator.dispose();
	});
	await check('partial corrections wait for meaning, then complete corrections drain old queued calls', async () => {
		let checks = 0;
		const h = harness({ interruptions: true, classify: async () => ({ action: ++checks === 1 ? 'pause' : 'revise' }) });
		h.delegate(); h.created('r1'); h.context(); h.done('r1'); await delay(8);
		h.created('r2'); h.input('Actually, focus on'); await delay(8); h.call('old-mark'); h.done('r2'); await delay(8);
		assert.equal(h.coordinator.snapshot().pageWorkPaused, true);
		assert.equal(h.sent.filter(e => e.type === 'response.create').length, 1);
		h.input(' only the smaller model.', 400); await delay(12);
		assert.equal(h.calls.some(c => c.callId === 'old-mark'), false);
		assert.equal(h.sent.filter(e => e.type === 'response.create').length, 2);
		assert.equal(h.diagnostics.filter(e => e.type === 'correction_submitted').length, 1);
		h.coordinator.dispose();
	});
	async function correctedTask({ complete = true, start = 11400, end = 15000 } = {}) {
		const h = harness({ interruptions: true, classify: async () => ({ action: 'revise' }) });
		h.delegate('delegation', 5600); h.created('initial'); h.context(); h.done('initial'); await delay(8);
		h.created('reading'); h.coordinator.noteInputActivity(true);
		h.input('Actually, only English to German and BLEU points, not percentages.', start, { end_ms: end });
		h.coordinator.noteInputActivity(false); await delay(8);
		h.call('obsolete-mark'); h.done('reading'); await delay(8);
		h.created('revised-context');
		h.call('revised-context-call', 'onhand_get_context', JSON.stringify({ request_relation: 'continue', full_request: 'Compare English to German in BLEU points, including training cost.' }));
		h.done('revised-context'); await delay(8);
		if (complete) { h.created('answer'); h.answer('Corrected answer with training cost.'); h.done('answer'); await delay(8); }
		return h;
	}
	await check('a delayed delegation for an applied correction cannot clear the completed answer or repeat actions', async () => {
		// Recorded sequence: correction audio 11400..15000; corrected task ends
		// at 52383, then a fresh delegation arrives at 52870 with offset 14800.
		const h = await correctedTask();
		const sentBefore = h.sent.length, updatesBefore = h.updates.length;
		h.delegate('delayed-correction', 14800); h.created('duplicate', 'delayed-correction');
		h.context('duplicate-context', 'continue', 'delayed-correction');
		h.call('duplicate-mark', 'browser_highlight_text', '{}', 'delayed-correction');
		h.call('duplicate-note', 'browser_show_note', '{}', 'delayed-correction');
		h.done('duplicate', {}, 'delayed-correction'); await delay(8);
		assert.equal(h.starts.length, 1); assert.equal(h.finishes.length, 1);
		assert.equal(h.finishes[0].reply, 'Corrected answer with training cost.');
		assert.equal(h.updates.length, updatesBefore); assert.equal(h.calls.length, 2);
		const sent = h.sent.slice(sentBefore);
		assert.equal(sent.filter(e => e.item?.type === 'function_call_output').length, 3, 'settle the whole duplicate batch');
		assert.ok(sent.every(e => e.type === 'response.item.create'), 'do not restart inference or redirect the correct spoken answer');
		assert.match(sent[0].item.output, /correction was already applied/);
		assert.equal(h.diagnostics.filter(e => e.type === 'duplicate_correction_delegation').length, 1);
		h.coordinator.close(); await delay(8);
		assert.equal(h.finishes.length, 1, 'End cannot replace the successful turn with an interrupted duplicate');
		assert.equal(h.errors.length, 0);
	});
	await check('delegation after the correction audio ends cannot replay a completed answer without new input', async () => {
		// 4:18 PM trial: correction 12400..16800, completion at 50334,
		// delegation at 50913 with offset 18200, then continue at 52664.
		for (const offset of [18200, 16800, 50000]) {
			const h = await correctedTask({ start: 12400, end: 16800 });
			const sentBefore = h.sent.length, updatesBefore = h.updates.length;
			h.emit({ type: 'session.output_transcript.delta', delta: 'For this comparison,', start_ms: 49200, end_ms: 49400 });
			h.coordinator.noteAudioActivity(true);
			h.delegate('replay', offset); h.created('replay-context', 'replay');
			h.context('replay-call', 'continue', 'replay'); h.done('replay-context', {}, 'replay'); await delay(8);
			assert.equal(h.starts.length, 1, `offset ${offset} must not reopen the saved answer`);
			assert.equal(h.finishes.length, 1); assert.equal(h.updates.length, updatesBefore);
			assert.ok(h.sent.slice(sentBefore).every(e => e.type === 'response.item.create'));
			assert.equal(h.diagnostics.filter(e => e.type === 'duplicate_correction_delegation').length, 1);
			assert.equal(h.diagnostics.find(e => e.type === 'correction_replay_checked').matched, true);
			h.coordinator.close(); await delay(8); assert.equal(h.finishes.length, 1);
		}
	});
	await check('duplicate correction during research preserves the active task and later genuine continuation identity', async () => {
		const h = await correctedTask({ complete: false });
		h.created('answer');
		h.delegate('duplicate', 14800); h.created('duplicate-context', 'duplicate'); h.context('dup-context', 'continue', 'duplicate'); h.done('duplicate-context', {}, 'duplicate'); await delay(8);
		h.answer('Corrected answer with training cost.'); h.done('answer'); await delay(8);
		assert.equal(h.starts.length, 1); assert.equal(h.finishes[0].superseded, false);
		h.input('Also explain the memory cost.', 18000);
		h.delegate('follow-up', 18100); h.created('follow-up-context', 'follow-up'); h.context('fresh-context', 'continue', 'follow-up'); h.done('follow-up-context', {}, 'follow-up'); await delay(8);
		assert.equal(h.starts.length, 2); assert.equal(h.starts[1].requestId, h.starts[0].requestId);
		assert.equal(h.starts[1].revision, 2, 'the ignored duplicate must not add a revision');
		assert.equal(h.calls.at(-1).callId, 'fresh-context'); assert.equal(h.errors.length, 0); h.coordinator.dispose();
	});
	await check('timing alone never suppresses independent requests or uncertain follow-ups', async () => {
		for (const variant of ['new', 'earlier-offset', 'missing-offset', 'late-caption', 'untranscribed-speech', 'ongoing-speech', 'typed']) {
			const h = await correctedTask();
			if (variant === 'late-caption') h.input(' And explain the larger model.', 15000, { end_ms: 15500 });
			if (variant === 'untranscribed-speech') { h.coordinator.noteInputActivity(true); h.coordinator.noteInputActivity(false); }
			if (variant === 'ongoing-speech') h.coordinator.noteInputActivity(true);
			if (variant === 'typed') h.coordinator.text('And explain the memory cost.');
			if (variant !== 'missing-offset') h.delegate('follow-up', variant === 'earlier-offset' ? 11000 : 18200);
			h.created('follow-up-context', 'follow-up'); h.context('fresh-context', variant === 'new' ? 'new' : 'continue', 'follow-up'); h.done('follow-up-context', {}, 'follow-up'); await delay(8);
			assert.equal(h.starts.length, 2, variant); assert.equal(h.calls.at(-1).callId, 'fresh-context', variant);
			assert.equal(h.diagnostics.some(e => e.type === 'duplicate_correction_delegation'), false, variant);
			assert.equal(h.errors.length, 0); h.coordinator.dispose();
		}
	});
	await check('a submitted correction is not considered applied before its context is resolved', async () => {
		const h = harness({ interruptions: true, classify: async () => ({ action: 'revise' }) });
		h.delegate(); h.created('initial'); h.context(); h.done('initial'); await delay(8);
		h.created('reading'); h.input('Actually, focus on the light reactions.', 400); await delay(8);
		h.call('old-mark'); h.done('reading'); await delay(8);
		h.created('in-place-context');
		h.delegate('live-correction', 450); h.created('live-context', 'live-correction');
		h.context('live-context-call', 'continue', 'live-correction'); h.done('live-context', {}, 'live-correction');
		h.done('in-place-context'); await delay(8);
		assert.equal(h.diagnostics.some(e => e.type === 'duplicate_correction_delegation'), false);
		assert.equal(h.starts.length, 2); assert.equal(h.starts[1].revision, 2);
		assert.equal(h.calls.at(-1).callId, 'live-context-call'); assert.equal(h.errors.length, 0); h.coordinator.dispose();
	});
	await check('a correction before response registration waits for the already-requested inference', async () => {
		const h = harness({ interruptions: true, classify: async () => ({ action: 'revise' }) });
		h.delegate(); h.created('r1'); h.context(); h.done('r1'); await delay(8);
		h.input('Actually, focus on the smaller model.'); await delay(8);
		assert.equal(h.sent.filter(e => e.type === 'response.create').length, 1, 'cannot start a second inference during the registration gap');
		h.created('r2'); h.call('old-mark'); h.done('r2'); await delay(8);
		assert.equal(h.calls.some(c => c.callId === 'old-mark'), false);
		assert.equal(h.sent.filter(e => e.type === 'response.create').length, 2);
		assert.equal(h.diagnostics.filter(e => e.type === 'correction_submitted').length, 1);
		h.coordinator.dispose();
	});
	await check('new fragments invalidate a ready correction before an in-flight tool returns', async () => {
		let release, checks = 0;
		const pending = new Promise(resolve => { release = resolve; });
		const h = harness({ interruptions: true, classify: async () => ({ action: ++checks === 1 ? 'revise' : 'pause' }),
			tool: async task => { if (task.callId === 'reading') await pending; return { output: 'Completed evidence.' }; } });
		h.delegate(); h.created('r1'); h.context(); h.call('reading'); h.done('r1'); await delay(8);
		h.input('Only compare the smaller model.'); await delay(8);
		h.input(' Wait, actually I meant', 400); release(); await delay(8);
		assert.equal(h.sent.some(e => e.type === 'response.create'), false);
		assert.equal(h.diagnostics.some(e => e.type === 'correction_submitted'), false);
		assert.equal(h.coordinator.snapshot().pageWorkPaused, true);
		h.coordinator.dispose();
	});
	await check('complete correction during review discards the old draft and resumes without another delegation', async () => {
		let release; const pending = new Promise(resolve => { release = resolve; });
		const h = harness({ interruptions: true, classify: async () => ({ action: 'revise' }), review: async () => { await pending; return { ready: true }; } });
		h.delegate(); h.created('r1'); h.context(); h.done('r1'); await delay(8);
		h.created('r2'); h.answer('Stale old answer.'); h.done('r2'); await delay(8);
		h.input('Actually, only compare German.'); await delay(8); release(); await delay(12);
		assert.equal(h.finishes.length, 0);
		assert.equal(h.diagnostics.filter(e => e.type === 'correction_submitted').length, 1);
		assert.equal(h.updates.at(-1).reply, '');
		h.created('r3'); h.context('updated-context', 'continue'); h.done('r3'); await delay(8);
		h.created('r4'); h.answer('Corrected answer.'); h.done('r4'); await delay(8);
		assert.equal(h.finishes[0].reply, 'Corrected answer.'); h.coordinator.dispose();
	});
	await check('missing grounding repairs the same task and replaces the uncited draft', async () => {
		const h = harness({ review: async task => ({ ready: task.reply.includes('[[cite:mark-1]]'), instruction: 'Read the mechanism and cite its highlight.' }) });
		h.created('r1'); h.answer('Uncited draft.'); h.done('r1'); await delay(15);
		assert.equal(h.finishes.length, 0);
		assert.equal(h.sent.filter(event => event.type === 'response.create').length, 1);
		assert.match(h.sent.find(event => event.item?.role === 'user').item.content[0].text, /mechanism/);
		h.created('r2'); h.call('mark'); h.done('r2'); await delay(10);
		h.created('r3'); h.answer('Grounded answer. [[cite:mark-1]]'); h.done('r3'); await delay(15);
		assert.equal(h.starts.length, 1); assert.equal(h.finishes.length, 1);
		assert.equal(h.finishes[0].reply, 'Grounded answer. [[cite:mark-1]]');
		assert.equal(h.finishes[0].modelCalls, 3);
		assert.equal(h.calls.length, 1); h.coordinator.dispose();
	});
	await check('grounding repairs stop after two attempts and honor a runtime stop', async () => {
		const h = harness({ review: async () => ({ ready: false, instruction: 'Missing evidence.' }) });
		for (let i = 0; i < 3; i++) { h.created(`r${i}`); h.answer(`Draft ${i}`); h.done(`r${i}`); await delay(10); }
		assert.equal(h.sent.filter(event => event.type === 'response.create').length, 2);
		assert.equal(h.finishes.length, 1); h.coordinator.dispose();
		const stopped = harness({ review: async () => ({ ready: false, canRetry: false, instruction: 'Do not repeat failed attempts.' }) });
		stopped.created('r1'); stopped.answer('Unresolved.'); stopped.done('r1'); await delay(10);
		assert.equal(stopped.sent.filter(event => event.type === 'response.create').length, 0);
		assert.equal(stopped.finishes.length, 1); stopped.coordinator.dispose();
	});
	await check('End during grounding review cannot start another backend response', async () => {
		let release; const pending = new Promise(resolve => { release = resolve; });
		const h = harness({ review: async () => { await pending; return { ready: false, instruction: 'Repair.' }; } });
		h.created('r1'); h.answer('Draft.'); h.done('r1'); await delay(10);
		h.coordinator.cancel(); release(); await delay(15);
		assert.equal(h.sent.filter(event => event.type === 'response.create').length, 0);
		assert.equal(h.finishes.length, 1); assert.equal(h.finishes[0].aborted, true);
	});
	await check('a continuation arriving during review supersedes repair of the old question', async () => {
		let release; const pending = new Promise(resolve => { release = resolve; });
		const h = harness({ review: async () => { await pending; return { ready: false, instruction: 'Repair.' }; } });
		h.created('r1'); h.answer('Old draft.'); h.done('r1'); await delay(10);
		h.created('r2', 'correction'); h.call('ctx', 'onhand_get_context', JSON.stringify({ request_relation: 'continue', full_request: 'The complete corrected request.' }), 'correction'); h.done('r2', {}, 'correction');
		release(); await delay(15);
		assert.equal(h.sent.some(event => event.item?.content?.[0]?.text === 'Repair.'), false);
		assert.equal(h.finishes[0].superseded, true); h.coordinator.dispose(); await delay(5);
	});
	await check('typed requests and corrections wait for all pending tool results', async () => {
		let release; const wait = new Promise(resolve => { release = resolve; });
		const h = harness({ tool: async () => { await wait; return { output: 'first result' }; } });
		h.coordinator.text('Read this page.'); await delay(5);
		assert.equal(h.sent.filter(item => item.type === 'response.create').length, 1);
		h.created('r1', 'typed-delegation'); h.call('a', undefined, undefined, 'typed-delegation'); h.done('r1', {}, 'typed-delegation'); await delay(5);
		assert.equal(h.starts[0].prompt, 'Read this page.');
		h.coordinator.text('Actually, only the second paragraph.', [{ kind: 'image', mimeType: 'image/png', data: 'fixture' }]); await delay(5);
		assert.equal(h.sent.filter(item => item.type === 'response.create').length, 1);
		release(); await delay(10);
		const items = h.sent.filter(item => item.type === 'response.item.create');
		assert.equal(items[1].item.type, 'function_call_output');
		assert.equal(items[2].item.role, 'user'); assert.equal(items[2].item.content[1].type, 'input_image');
		assert.match(items[2].item.content[0].text, /second paragraph/);
		assert.equal(h.sent.filter(item => item.type === 'response.create').length, 2);
		h.coordinator.dispose(); await delay(5);
	});
	await check('a second typed message waits for the first response to be registered', async () => {
		const h = harness();
		h.coordinator.text('First request.'); await delay(5);
		h.coordinator.text('Correction before response.created.'); await delay(5);
		assert.equal(h.sent.filter(event => event.type === 'response.create').length, 1);
		h.created('r1'); h.call('first'); h.done('r1'); await delay(10);
		assert.equal(h.sent.filter(event => event.type === 'response.create').length, 2);
		assert.ok(h.sent.some(event => event.item?.content?.[0]?.text === 'Correction before response.created.'));
		h.coordinator.dispose(); await delay(5);
	});
	await check('Stop during a tool blocks continuation and subsequent tools, preserving final usage', async () => {
		let release; const wait = new Promise(resolve => { release = resolve; });
		const h = harness({ tool: async () => { await wait; return { output: 'late result' }; } });
		h.created('r1'); h.call('a'); h.call('b'); h.done('r1'); await delay(5);
		h.coordinator.close(); release(); await delay(10);
		assert.equal(h.calls.length, 1); assert.equal(h.stopped.length, 1);
		assert.equal(h.finishes.length, 1); assert.equal(h.finishes[0].aborted, true);
		assert.equal(h.sent.some(item => item.type === 'response.create'), false);
		h.emit({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 20 } });
		assert.equal(h.usages.at(-1).seconds, 20); assert.equal(h.usages.at(-1).final, true);
	});
	await check('closing during request preparation releases the acquired lane', async () => {
		let release; const wait = new Promise(resolve => { release = resolve; });
		const h = harness({ begin: async () => await wait }); h.created('r1'); h.call('a'); h.done('r1'); await delay(5); h.coordinator.close(); release(); await delay(10);
		assert.equal(h.finishes.length, 1); assert.equal(h.finishes[0].aborted, true); assert.equal(h.calls.length, 0);
	});
	await check('an unrelated task keeps the lane; queued delegations run serially', async () => {
		const h = harness(); h.state.activeRequestId = 'other-task'; h.created('r1'); h.answer('First answer'); h.done('r1');
		h.created('r2', 'another'); h.answer('Second answer', 'another'); h.done('r2', {}, 'another');
		await delay(5); assert.equal(h.starts.length, 0);
		h.state.activeRequestId = null; h.coordinator.updateState(h.state); await delay(10);
		assert.equal(h.starts.length, 2); assert.equal(h.finishes.length, 2); assert.equal(h.stopped.length, 0);
		h.coordinator.dispose();
	});
	await check('a completed question can be revised by a semantic continuation, while new questions stay separate', async () => {
		const h = harness();
		const context = (id, relation, prompt, delegation) => h.call(id, 'onhand_get_context', JSON.stringify({ request_relation: relation, full_request: prompt }), delegation);
		h.created('r1'); context('context-1', 'new', 'Explain the diagram.'); h.done('r1'); await delay(10);
		h.created('r2'); h.answer('The initial explanation.'); h.done('r2'); await delay(10);
		const requestId = h.starts[0].requestId;
		// The real sidebar's state poll may still show the previous revision's
		// busy ID after finish resolves. Wait for that poll without spinning.
		h.state.activeRequestId = requestId;
		h.created('r3', 'continuation'); context('context-2', 'continue', 'Explain the diagram, especially how order is represented.', 'continuation');
		h.done('r3', {}, 'continuation'); await delay(10);
		assert.equal(h.starts.length, 1);
		h.state.activeRequestId = null; h.coordinator.updateState(h.state); await delay(10);
		assert.equal(h.starts[1].requestId, requestId); assert.equal(h.starts[1].revision, 2);
		h.emit({ type: 'session.input_transcript.delta', delta: 'late partial caption', start_ms: 100, end_ms: 200 });
		h.created('r4', 'continuation'); h.answer('The complete revised answer.', 'continuation'); h.done('r4', {}, 'continuation'); await delay(10);
		assert.equal(h.finishes[1].prompt, 'Explain the diagram, especially how order is represented.');
		assert.equal(h.finishes[1].reply, 'The complete revised answer.');
		h.created('r5', 'new-question'); context('context-3', 'new', 'Now compare the training costs.', 'new-question'); h.done('r5', {}, 'new-question'); await delay(10);
		assert.notEqual(h.starts[2].requestId, requestId); assert.equal(h.starts[2].revision, 1);
		h.created('late-old-response'); h.call('late-action'); h.done('late-old-response'); await delay(10);
		assert.equal(h.calls.some(call => call.callId === 'late-action'), false);
		assert.match(h.sent.find(event => event.item?.call_id === 'late-action').item.output, /Action not run/);
		h.created('late-retry'); context('context-1', 'new', 'Explain the diagram.'); h.done('late-retry'); await delay(5);
		assert.equal(h.calls.filter(call => call.callId === 'context-1').length, 1);
		assert.equal(h.sent.filter(event => event.item?.call_id === 'context-1').at(-1).item.output, 'verified result');
		assert.equal(h.errors.length, 0); h.coordinator.dispose();
	});
	await check('successive continuations classified out of order keep one identity and run only the latest revision', async () => {
		const h = harness(); h.state.activeRequestId = 'unrelated';
		h.created('r1'); h.call('old-action'); h.done('r1');
		h.created('r2', 'second'); h.created('r3', 'third');
		h.call('context-3', 'onhand_get_context', JSON.stringify({ request_relation: 'continue', full_request: 'Explain the diagram and word order, using a short example.' }), 'third');
		h.done('r3', {}, 'third');
		h.call('context-2', 'onhand_get_context', JSON.stringify({ request_relation: 'continue', full_request: 'Explain the diagram and word order.' }), 'second');
		h.done('r2', {}, 'second');
		await delay(5); assert.equal(h.starts.length, 0);
		h.state.activeRequestId = null; h.coordinator.updateState(h.state); await delay(15);
		assert.equal(h.starts.length, 1); assert.equal(h.starts[0].revision, 3);
		assert.equal(h.starts[0].requestId, h.starts[0].previous.previous.requestId);
		assert.equal(h.calls.length, 1); assert.equal(h.calls[0].callId, 'context-3');
		assert.equal(h.sent.filter(event => event.type === 'response.create').length, 1);
		assert.equal(h.sent.filter(event => event.item?.type === 'function_call_output').length, 3);
		h.created('r4', 'third'); h.answer('The complete example.', 'third'); h.done('r4', {}, 'third'); await delay(10);
		assert.equal(h.finishes[0].prompt, 'Explain the diagram and word order, using a short example.');
		assert.equal(h.errors.length, 0); h.coordinator.dispose();
	});
	await check('a continuation during a tool preserves its result, skips older pending actions, and continues only the new revision', async () => {
		let release;
		const h = harness({ tool: async task => task.callId === 'reading' ? await new Promise(resolve => { release = () => resolve({ output: 'Evidence already read.' }); }) : { output: 'Current context.' } });
		h.created('r1'); h.call('reading', 'browser_extract_content'); h.call('old-mark', 'browser_highlight_text'); h.done('r1'); await delay(10);
		h.emit({ type: 'session.input_transcript.delta', delta: 'Mm-hmm.', start_ms: 100, end_ms: 120 });
		assert.equal(h.stopped.length, 0); assert.equal(h.finishes.length, 0);
		h.created('r2', 'correction');
		h.call('context-new', 'onhand_get_context', JSON.stringify({ request_relation: 'continue', full_request: 'Explain the second section instead.' }), 'correction');
		h.done('r2', {}, 'correction'); release(); await delay(20);
		assert.equal(h.calls.some(call => call.callId === 'old-mark'), false);
		const outputs = h.sent.filter(event => event.item?.type === 'function_call_output');
		assert.equal(outputs.find(event => event.item.call_id === 'reading').item.output, 'Evidence already read.');
		assert.match(outputs.find(event => event.item.call_id === 'old-mark').item.output, /Action not run/);
		assert.equal(h.finishes[0].superseded, true);
		assert.equal(h.starts[0].requestId, h.starts[1].requestId);
		assert.equal(h.starts[1].revision, 2);
		assert.equal(h.sent.filter(event => event.type === 'response.create').length, 1);
		h.created('r3', 'correction'); h.answer('Only the corrected answer.', 'correction'); h.done('r3', {}, 'correction'); await delay(10);
		assert.equal(h.finishes.at(-1).reply, 'Only the corrected answer.');
		assert.equal(h.errors.length, 0); h.coordinator.dispose();
	});
	await check('malformed relation metadata and caption fragments alone cannot revise a task', async () => {
		const h = harness(); h.created('r1'); h.answer('First answer.'); h.done('r1'); await delay(10);
		h.created('r2', 'next'); h.call('bad-relation', 'onhand_get_context', JSON.stringify({ request_relation: 'continue', full_request: '' }), 'next'); h.done('r2', {}, 'next'); await delay(10);
		assert.notEqual(h.starts[0].requestId, h.starts[1].requestId);
		assert.equal(h.sent.some(event => event.type === 'session.instructions.append'), false);
		h.coordinator.dispose();
	});
	await check('End during a pending revision preserves interruption status and cannot start the replacement', async () => {
		let release;
		const h = harness({ begin: async () => await new Promise(resolve => { release = resolve; }) });
		h.created('r1'); h.call('old-read'); h.done('r1'); await delay(5);
		h.created('r2', 'correction'); h.call('context-new', 'onhand_get_context', JSON.stringify({ request_relation: 'continue', full_request: 'Explain the full question.' }), 'correction'); h.done('r2', {}, 'correction');
		h.coordinator.close(); release(); await delay(10);
		assert.equal(h.starts.length, 1); assert.equal(h.calls.length, 0);
		assert.equal(h.finishes.length, 1); assert.equal(h.finishes[0].aborted, true); assert.equal(h.finishes[0].superseded, false);
		assert.equal(h.sent.some(event => event.type === 'response.create'), false);
	});
	await check('backend usage is counted once per response and mode updates reach the backend', async () => {
		const h = harness(); h.created('r1'); h.answer('Answer'); h.done('r1', { usage: { input_tokens: 120, output_tokens: 15 } });
		h.done('r1', { usage: { input_tokens: 120, output_tokens: 15 } }); await delay(10);
		assert.equal(h.usages.at(-1).backendInputTokens, 120); assert.equal(h.usages.at(-1).backendOutputTokens, 15);
		h.state.preferences.learningMode = true; h.coordinator.updateState(h.state); await delay(5);
		assert.equal(h.sent.filter(item => item.type === 'session.update').length, 1);
		assert.equal(h.sent.find(item => item.type === 'session.update').session.delegation.type, 'responses');
		h.coordinator.dispose();
	});
	await check('tool images are sent as visual references before continuation', async () => {
		const h = harness({ tool: async () => ({ output: 'Captured page 1.', images: ['data:image/png;base64,cGl4ZWw='] }) });
		h.created('r1'); h.call('image', 'browser_pdf_capture_page_image'); h.done('r1'); await delay(10);
		const events = h.sent.filter(item => item.type.startsWith('response.'));
		assert.equal(events[0].item.type, 'function_call_output');
		assert.equal(events[1].item.content[1].type, 'input_image');
		assert.equal(events[1].item.content[1].file_id, 'file-image-fixture');
		assert.equal(JSON.stringify(events).includes('base64'), false);
		assert.equal(events[2].type, 'response.create');
		h.coordinator.dispose(); await delay(5);
	});
	await check('large images use expiring files without data-channel base64 and duplicate uploads', async () => {
		let uploads = 0;
		const image = 'data:image/png;base64,' + 'a'.repeat(100000);
		const h = harness({ tool: async () => ({ output: 'Captured.', images: [image, image] }), image: async () => { uploads++; return { type: 'input_image', file_id: 'file-large', detail: 'auto' }; } });
		h.created('r1'); h.call('image'); h.done('r1'); await delay(20);
		assert.equal(uploads, 1); assert.equal(h.errors.length, 0);
		assert.ok(h.coordinator.snapshot().inputBytes < 2000);
		assert.ok(h.sent.some(event => event.type === 'response.create'));
		h.coordinator.dispose(); await delay(5);
		let upload;
		const result = await uploadLiveImage('data:image/png;base64,cGl4ZWw=', 'test-key', async (url, init) => {
			upload = { url, ...init }; return { ok: true, json: async () => ({ id: 'file-test' }) };
		});
		assert.equal(result.file_id, 'file-test'); assert.equal(upload.url, 'https://api.openai.com/v1/files');
		assert.equal(upload.body.get('purpose'), 'vision'); assert.equal(upload.body.get('expires_after[seconds]'), '3600');
		assert.equal(upload.body.get('file').type, 'image/png');
		await assert.rejects(uploadLiveImage('https://example.test/image.png', 'test-key'), /Live image/);
	});
	await check('research beyond 32 KB retains evidence at the end of every source and finishes normally', async () => {
		const uploaded = [];
		const h = harness({ tool: async task => ({ output: 'é\\\"'.repeat(10000) + `\nDecisive evidence for ${task.callId}.` }), file: async text => {
			uploaded.push(text); return { type: 'input_file', file_id: `file-research-${uploaded.length}` };
		} });
		for (let i = 0; i < 18; i++) { h.created(`r${i}`); h.call(`call${i}`); h.done(`r${i}`); await delay(10); }
		assert.equal(uploaded.length, 18);
		for (let i = 0; i < uploaded.length; i++) assert.ok(uploaded[i].endsWith(`Decisive evidence for call${i}.`));
		assert.ok(h.coordinator.snapshot().inputBytes < 20000); assert.equal(h.coordinator.snapshot().sourcesPaused, false);
		h.created('final'); h.answer('Verified answer from the complete source results.'); h.done('final'); await delay(10);
		assert.equal(h.finishes[0].reply, 'Verified answer from the complete source results.');
		assert.equal(h.errors.length, 0); assert.equal(h.sent.some(event => event.type === 'session.close'), false);
		h.coordinator.dispose();
	});
	await check('source uploads preserve UTF-8, expire, and identical results reuse an attached file', async () => {
		const source = 'Full result é😀 with source URL https://example.test and [[cite:mark]].'.repeat(200);
		let uploads = 0;
		const h = harness({ tool: async () => ({ output: source }), file: async () => { uploads++; return { type: 'input_file', file_id: 'file-cached' }; } });
		for (let i = 0; i < 2; i++) { h.created(`r${i}`); h.call(`call${i}`); h.done(`r${i}`); await delay(15); }
		assert.equal(uploads, 1);
		assert.equal(h.sent.filter(event => event.item?.content?.some(part => part.file_id === 'file-cached')).length, 1);
		h.coordinator.dispose(); await delay(5);
		let body;
		const file = await uploadLiveText(source, 'test-key', async (_url, init) => { body = init.body; return { ok: true, json: async () => ({ id: 'file-source' }) }; });
		assert.equal(file.type, 'input_file'); assert.equal(body.get('purpose'), 'user_data');
		assert.equal(body.get('expires_after[seconds]'), '3600'); assert.equal(await body.get('file').text(), source);
		await assert.rejects(uploadLiveText('x'.repeat(2_000_001), 'test-key'), /2 MB/);
		await assert.rejects(uploadLiveText('reference', 'test-key', async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'Rate limited' } }) })), /Rate limited/);
	});
	await check('source delivery failure is explicit, retains a bounded excerpt, and does not repeat the action', async () => {
		const h = harness({ tool: async () => ({ output: 'é\\\"😀'.repeat(10000) }), file: async () => { throw new Error('Upload unavailable'); } });
		h.created('r1'); h.call('mark'); h.done('r1'); await delay(15);
		const result = h.sent.find(event => event.item?.type === 'function_call_output').item.output;
		assert.equal(JSON.parse(result).incomplete, true); assert.match(result, /do not repeat a mutation/);
		assert.ok(new TextEncoder().encode(result).length < 1600); assert.equal(h.calls.length, 1); assert.equal(h.errors.length, 0);
		h.coordinator.dispose(); await delay(5);
	});
	await check('near-full history pauses tools and produces an answer without closing Voice', async () => {
		const h = harness({ tool: async () => ({ output: 'Evidence. '.repeat(120) }), review: async () => ({ ready: false, instruction: 'Read more evidence.' }) });
		let i = 0;
		while (!h.coordinator.snapshot().sourcesPaused && i < 40) { h.created(`r${i}`); h.call(`call${i}`); h.done(`r${i}`); i++; await delay(10); }
		assert.equal(h.coordinator.snapshot().sourcesPaused, true); assert.equal(h.errors.length, 0);
		assert.match(h.sent.filter(event => event.item?.type === 'function_call_output').at(-1).item.output, /Action not run/);
		assert.ok(h.sent.some(event => event.type === 'session.update' && event.session.delegation.responses.tool_choice === 'none'));
		const executed = h.calls.length;
		h.created('late-tool'); h.call('late-action'); h.done('late-tool'); await delay(10);
		assert.equal(h.calls.length, executed);
		h.state.preferences.learningMode = true; h.coordinator.updateState(h.state); await delay(10);
		assert.equal(h.sent.filter(event => event.type === 'session.update').at(-1).session.delegation.responses.tool_choice, 'none');
		const continuations = h.sent.filter(event => event.type === 'response.create').length;
		h.created('final'); h.answer('Here is what the available evidence establishes; the remaining question needs more sources.'); h.done('final'); await delay(10);
		assert.equal(h.finishes[0].error, undefined); assert.ok(h.finishes[0].reply.includes('available evidence'));
		assert.equal(h.sent.filter(event => event.type === 'response.create').length, continuations, 'source pause also blocks grounding retries');
		assert.equal(h.sent.some(event => event.type === 'session.close'), false);
		h.coordinator.dispose();
	});
	await check('Stop during source upload blocks all late results and continuation', async () => {
		let release; const pending = new Promise(resolve => { release = resolve; });
		const h = harness({ tool: async () => ({ output: 'Long source '.repeat(1000) }), file: async () => { await pending; return { type: 'input_file', file_id: 'late' }; } });
		h.created('r1'); h.call('read'); h.done('r1'); await delay(10);
		h.coordinator.close(); release(); await delay(10);
		assert.equal(h.sent.some(event => event.type.startsWith('response.')), false); assert.equal(h.finishes[0].aborted, true);
	});
	await check('failed image upload returns an honest tool result and closing during upload cannot continue', async () => {
		const h = harness({ tool: async () => ({ output: 'Captured.', images: ['data:image/png;base64,cGl4ZWw='] }), image: async () => { throw new Error('Upload rejected'); } });
		h.created('r1'); h.call('image'); h.done('r1'); await delay(15);
		assert.match(h.sent.find(event => event.item?.type === 'function_call_output').item.output, /Do not claim to have inspected/);
		assert.equal(h.errors.length, 0); h.coordinator.dispose(); await delay(5);
		let release; const wait = new Promise(resolve => { release = resolve; });
		const pending = harness({ image: async () => { await wait; return { type: 'input_image', file_id: 'late' }; } });
		pending.coordinator.text('Inspect', [{ kind: 'image', mimeType: 'image/png', data: 'cGl4ZWw=' }]); await delay(10);
		pending.coordinator.close(); release(); await delay(10);
		assert.equal(pending.sent.some(event => event.type.startsWith('response.')), false);
	});

	await check('malformed tool arguments return an error without executing', async () => {
		const h = harness(); h.created('r1'); h.call('bad', 'browser_navigate', '{broken'); h.done('r1'); await delay(10);
		assert.equal(h.calls.length, 0); assert.match(h.sent.find(item => item.item?.type === 'function_call_output').item.output, /error/);
		h.coordinator.dispose(); await delay(5);
	});
	await check('command rejection ends the session and releases the managed turn', async () => {
		const h = harness(); h.created('r1'); h.call('read'); h.done('r1'); await delay(10);
		h.emit({ type: 'error', error: { message: 'Rejected response.create' } }); await delay(10);
		assert.equal(h.errors.length, 1); assert.equal(h.finishes[0].aborted, false);
		assert.equal(h.finishes[0].error, "Rejected response.create");
		assert.equal(h.coordinator.snapshot().lastError, "Rejected response.create");
		assert.equal(h.sent.filter(item => item.type === 'session.close').length, 1);
	});
	await check('an early command rejection is reported without inventing an empty saved answer', async () => {
		const h = harness(); h.created('r1'); await delay(5);
		h.emit({ type: 'error', error: { message: 'Rejected before tool dispatch' } }); await delay(10);
		assert.equal(h.errors.length, 1); assert.equal(h.starts.length, 0); assert.equal(h.finishes.length, 0);
		assert.equal(h.sent.filter(item => item.type === 'session.close').length, 1);
	});
	return count;
}
