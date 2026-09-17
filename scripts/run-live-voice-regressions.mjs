import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import '../packages/browser-extension/live-voice.js';
const api = globalThis.OnhandLiveVoice;
let count = 0;
function harness({ submit } = {}) {
  const state = { currentSession: { sessionId: 'onhand-session' }, preferences: { learningMode: false }, turns: [], activeRequestId: null };
  const sent = [], submitted = [], stopped = [], errors = [], captions = [], usages = [];
  let eventId = 0, audioTime = 0;
  const coordinator = api.createCoordinator({
    getState: () => state, send: e => sent.push(e),
    submit: async task => {
      submitted.push(task); state.activeRequestId = task.requestId;
      return submit ? await submit(task) : { requestId: task.requestId };
    },
    stop: async id => { stopped.push(id); }, onStatus() {}, onError: e => errors.push(e),
    onTranscript: e => captions.push(e), onUsage: e => usages.push(e),
  }, { settleMs: 2 });
  const emit = event => coordinator.handle({ event_id: `server-${++eventId}`, ...event });
  const input = (delta, extra = {}) => emit({ type: 'session.input_transcript.delta', delta, start_ms: audioTime, end_ms: audioTime += 100, ...extra });
  const delegate = (id, offset = audioTime) => emit({ type: 'session.delegation.created', offset_ms: offset, delegation: { id, target: 'client' } });
  const finish = (task, reply) => {
    state.activeRequestId = null;
    state.turns.push({ id: task.requestId, reply, pending: false, error: false });
    coordinator.updateState(state);
  };
  const spoken = () => sent.filter(e => e.type === 'session.commentary.append');
  emit({ type: 'session.started', session: { id: 'live-session' } });
  return { coordinator, state, sent, submitted, stopped, errors, captions, usages, emit, input, delegate, finish, spoken };
}
async function check(name, run) { await run(); count++; console.log(`PASS ${name}`); }
await check('session setup preserves backend independence and compact role-labelled history', () => {
  const config = api.sessionConfig({ turns: [{ userPrompt: 'Question', reply: 'Verified answer' }], preferences: { learningMode: true } });
  assert.equal(config.model, 'gpt-live-1'); assert.deepEqual(config.delegation, { type: 'client' });
  assert.equal(config.store, false); assert.equal(config.audio.output.voice, 'marin');
  assert.equal(config.input[1].content[0].type, 'output_text');
  assert.equal(config.tools, undefined); assert.equal(config.audio.input, undefined);
});
await check('delegation arriving before captions waits and then uses the full streamed text', async () => {
  const h = harness(); h.delegate('item-first', 300); await delay(10);
  assert.equal(h.submitted.length, 0);
  h.input('Explain '); h.input('this equation.'); await delay(10);
  assert.equal(h.submitted.length, 1); assert.equal(h.submitted[0].prompt, 'Explain this equation.');
  assert.equal(h.submitted[0].delegationId, 'item-first');
  h.finish(h.submitted[0], 'The second term is zero.');
  assert.equal(h.spoken()[0].delegation_id, 'item-first');
  assert.equal(h.spoken()[0].content, 'The second term is zero.'); h.coordinator.dispose();
});
await check('duplicate events and repeated delegation IDs cannot start duplicate actions', async () => {
  const h = harness(); h.input('Highlight the definition.', { event_id: 'same-event' });
  h.input('Highlight the definition.', { event_id: 'same-event' });
  h.delegate('item-once'); h.delegate('item-once'); await delay(10);
  assert.equal(h.submitted.length, 1); assert.equal(h.captions.length, 1);
  h.coordinator.dispose();
});
await check('speech continues during work and a listening acknowledgment does not abort it', async () => {
  const h = harness(); h.input('Explain the first paragraph.'); h.delegate('item-question'); await delay(10);
  h.input(' Mm-hmm.'); h.emit({ type: 'session.output_transcript.delta', delta: 'I am checking the passage.', start_ms: 1100, end_ms: 2000 });
  await delay(10); assert.equal(h.stopped.length, 0); assert.equal(h.submitted.length, 1);
  assert.equal(h.captions.at(-1).role, 'assistant'); h.coordinator.dispose();
});
await check('correction aborts the owned task, waits for finalization, and suppresses its stale answer', async () => {
  const h = harness(); h.input('Explain the first paragraph.'); h.delegate('item-old'); await delay(10);
  const old = h.submitted[0];
  h.input('Actually, explain the second paragraph.'); h.delegate('item-new'); await delay(10);
  assert.deepEqual(h.stopped, [old.requestId]); assert.equal(h.submitted.length, 1);
  h.finish(old, 'STALE FIRST PARAGRAPH'); await delay(10);
  assert.equal(h.submitted.length, 2); assert.equal(h.spoken().length, 0);
  const next = h.submitted[1]; assert.match(next.prompt, /second paragraph/);
  h.finish(next, 'The second paragraph defines the term.');
  assert.equal(h.spoken().length, 1); assert.equal(h.spoken()[0].delegation_id, 'item-new'); h.coordinator.dispose();
});
await check('a correction during asynchronous preparation can cancel before submit returns', async () => {
  let resolve;
  const h = harness({ submit: task => new Promise(r => { resolve = () => r({ requestId: task.requestId }); }) });
  h.input('Read the whole PDF.'); h.delegate('item-preparing'); await delay(10);
  const old = h.submitted[0];
  h.input('Actually, only read its introduction.'); h.delegate('item-revised'); await delay(10);
  assert.deepEqual(h.stopped, [old.requestId]);
  resolve(); await delay(2); h.finish(old, 'Old result'); await delay(5);
  assert.equal(h.submitted.length, 2); assert.equal(h.spoken().length, 0);
  resolve(); h.coordinator.dispose();
});
await check('an unrelated typed task retains the execution lane', async () => {
  const h = harness(); h.state.activeRequestId = 'another-client';
  h.coordinator.updateState(h.state); h.input('Explain this.'); h.delegate('item-waiting'); await delay(10);
  assert.equal(h.submitted.length, 0); assert.equal(h.stopped.length, 0);
  h.state.activeRequestId = null; h.coordinator.updateState(h.state); await delay(5);
  assert.equal(h.submitted.length, 1); h.coordinator.dispose();
});
await check('typed corrections carry user data, attachments, and a nullable delegation ID', async () => {
  const h = harness(); h.coordinator.text('Use x = 4.', [{ type: 'image', data: 'fixture' }]); await delay(5);
  assert.equal(h.submitted[0].attachments.length, 1);
  assert.equal(h.submitted[0].sessionId, 'onhand-session');
  assert.equal(h.sent.some(e => e.type === 'session.instructions.append' && e.content.includes('x = 4')), false);
  h.finish(h.submitted[0], 'The value is four.'); assert.equal(h.spoken()[0].delegation_id, null);
  h.coordinator.dispose();
});
await check('mode updates use Live instructions and unchanged UI state does not flood context', () => {
  const h = harness(); const before = h.sent.length;
  h.coordinator.updateState(h.state); assert.equal(h.sent.length, before);
  h.state.preferences.learningMode = true; h.coordinator.updateState(h.state);
  assert.match(h.sent.find(e => e.type === 'session.instructions.append').content, /ON/);
  assert.equal(h.sent.some(e => e.type === 'session.update'), false); h.coordinator.dispose();
});
await check('voice End drains final cumulative usage and never speaks a late backend result', async () => {
  const h = harness(); h.coordinator.text('Explain this.'); await delay(5); const task = h.submitted[0];
  h.emit({ type: 'session.usage.updated', usage: { seconds: 12 } });
  h.emit({ type: 'session.usage.updated', usage: { seconds: 16 } });
  h.coordinator.close(); h.finish(task, 'Should not be spoken.');
  assert.equal(h.spoken().length, 0); assert.equal(h.coordinator.snapshot().seconds, 16);
  h.emit({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 18 } });
  assert.equal(h.coordinator.snapshot().finalUsage, true); assert.equal(h.usages.at(-1).seconds, 18);
  assert.equal(h.sent.filter(e => e.type === 'session.close').length, 1);
  assert.equal(h.stopped.length, 0, 'Ending speech does not cancel independently running work');
});
await check('Stop cancels work without announcing the partial answer', async () => {
  const h = harness(); h.coordinator.text('Explain this.'); await delay(5);
  h.coordinator.cancel(); h.finish(h.submitted[0], 'Incomplete answer');
  assert.equal(h.spoken().length, 0); h.coordinator.dispose();
});
await check('all append content fits the byte bound even for multilingual output', () => {
  for (const reply of ['a'.repeat(9000), '解释这个公式。'.repeat(500), '🦉'.repeat(600)]) {
    assert.ok(new TextEncoder().encode(api.compact(reply)).length <= 480);
    assert.ok(new TextEncoder().encode(api.speechResult({ reply })).length <= 480);
  }
});
await check('spoken results preserve complete qualifications and exclude citation IDs', () => {
  const opening = 'This association is present. However, the study cannot establish causation.';
  assert.equal(api.speechResult({ reply: `## Result\n\n${opening} [[cite:private-annotation-id]]\n\n${'More detail. '.repeat(80)}` }), opening);
  assert.doesNotMatch(api.speechResult({ reply: 'A long unbroken paragraph. '.repeat(80) }), /^A long/);
});
await check('old notices cannot claim future speech or repeat already consumed work', async () => {
  const h = harness(); h.delegate('empty-old', 10);
  h.input('Explain the new figure.', { start_ms: 200, end_ms: 400 }); await delay(10);
  assert.equal(h.submitted.length, 0);
  h.delegate('current', 500); await delay(10);
  assert.equal(h.submitted.length, 1);
  h.delegate('late-duplicate', 500);
  h.input('Actually the next figure.', { start_ms: 600, end_ms: 800 }); await delay(10);
  assert.equal(h.stopped.length, 0); assert.equal(h.coordinator.snapshot().pendingDelegations, 0);
  h.delegate('next', 900); await delay(10);
  assert.equal(h.stopped.length, 1); h.coordinator.dispose();
});
await check('direct speech becomes one revisable answer with intact fragments and no model request', () => {
  const updates = [], journal = api.createTranscriptJournal(turns => updates.push(turns));
  const user = { id: 'u', role: 'user', text: 'Explain BLEU points.', start_ms: 0, end_ms: 10 };
  journal.append(user);
  journal.append({ id: 'a', role: 'assistant', text: 'Big scores 28.4', start_ms: 20, end_ms: 30 });
  journal.append({ id: 'b', role: 'assistant', text: ', versus 27.3. A 1.1 point gain.', start_ms: 30, end_ms: 40 });
  journal.append(user);
  assert.equal(journal.snapshot().length, 1);
  assert.equal(journal.snapshot()[0].reply, 'Big scores 28.4, versus 27.3. A 1.1 point gain.');
  assert.equal(updates[0][0].id, updates.at(-1)[0].id);
  journal.append({ id: 'u2', role: 'user', text: 'Repeat that.', start_ms: 45, end_ms: 50 });
  journal.append({ id: 'a2', role: 'assistant', text: '1.1 BLEU points.', start_ms: 55, end_ms: 60 });
  assert.equal(journal.snapshot().length, 2);
});
await check('late delegation retracts only its caption answer; reordered captions retain follow-ups', () => {
  const journal = api.createTranscriptJournal(() => {});
  journal.append({ id: 'a', role: 'assistant', text: 'Checking.', start_ms: 20, end_ms: 30 });
  journal.append({ id: 'u', role: 'user', text: 'Read the table.', start_ms: 0, end_ms: 10 });
  journal.append({ id: 'u2', role: 'user', text: 'Only German.', start_ms: 40, end_ms: 50 });
  journal.append({ id: 'a2', role: 'assistant', text: '1.1 points.', start_ms: 60, end_ms: 70 });
  journal.delegate({ delegation: { id: 'd' }, offset_ms: 15 });
  assert.deepEqual(journal.snapshot().map(turn => turn.id), ['u2']);
  journal.append({ id: 'late-a', role: 'assistant', text: ' It says 1.1.', start_ms: 31, end_ms: 35 });
  assert.deepEqual(journal.snapshot().map(turn => turn.reply), ['1.1 points.']);
});
await check('delegation before captions and typed backend turns cannot produce duplicate cards', () => {
  const journal = api.createTranscriptJournal(() => {});
  journal.delegate({ delegation: { id: 'd' }, offset_ms: 15 });
  journal.append({ id: 'u', role: 'user', text: 'Read this.', start_ms: 0, end_ms: 10 });
  journal.append({ id: 'a', role: 'assistant', text: 'Here is the result.', start_ms: 20, end_ms: 30 });
  journal.append({ id: 'typed', role: 'user', typed: true, text: 'Highlight it.' });
  journal.append({ id: 'b', role: 'assistant', text: 'Highlighted.', start_ms: 40, end_ms: 50 });
  assert.deepEqual(journal.snapshot(), []);
});
await check('overlapping backchannels do not split an unfinished question into saved answers', () => {
  const journal = api.createTranscriptJournal(() => {});
  journal.append({ id: 'u', role: 'user', text: 'Explain ', start_ms: 0, end_ms: 20 });
  journal.append({ id: 'ack', role: 'assistant', text: 'Mm-hmm.', start_ms: 10, end_ms: 15 });
  journal.append({ id: 'u2', role: 'user', text: 'the difference.', start_ms: 21, end_ms: 30 });
  journal.append({ id: 'a', role: 'assistant', text: 'It is 1.1 points.', start_ms: 40, end_ms: 50 });
  assert.equal(journal.snapshot()[0].userPrompt, 'Explain the difference.');
  assert.equal(journal.snapshot()[0].reply, 'It is 1.1 points.');
});
await check('input captions during continuous output cannot capture the tail of a delegated answer', () => {
  const journal = api.createTranscriptJournal(() => {});
  journal.append({ id: 'u', role: 'user', text: 'Explain the chart.', start_ms: 0, end_ms: 10 });
  journal.delegate({ delegation: { id: 'd' }, offset_ms: 15 });
  journal.append({ id: 'ack', role: 'assistant', text: 'Checking.', start_ms: 20, end_ms: 30 });
  // Include both arrival orders: input can arrive before the output it overlaps.
  journal.append({ id: 'fragment', role: 'user', text: 'a rising curve', start_ms: 100, end_ms: 120 });
  journal.append({ id: 'a2', role: 'assistant', text: ' rises as temperature increases.', start_ms: 120, end_ms: 160 });
  journal.append({ id: 'a1', role: 'assistant', text: 'The curve', start_ms: 110, end_ms: 120 });
  assert.deepEqual(journal.snapshot(), [], 'continuous speech that started during input is not a new answer');
  journal.append({ id: 'u2', role: 'user', text: 'Repeat the trend.', start_ms: 170, end_ms: 180 });
  journal.append({ id: 'a3', role: 'assistant', text: 'It rises.', start_ms: 190, end_ms: 210 });
  assert.deepEqual(journal.snapshot().map(turn => turn.userPrompt), ['Repeat the trend.']);
});
await check('a user fragment inside an answer never reparents its remaining captions', () => {
  const journal = api.createTranscriptJournal(() => {});
  journal.append({ id: 'u', role: 'user', text: 'Explain it.', start_ms: 0, end_ms: 10 });
  journal.append({ id: 'a1', role: 'assistant', text: 'The answer ', start_ms: 20, end_ms: 40 });
  journal.append({ id: 'fragment', role: 'user', text: 'background speech', start_ms: 30, end_ms: 35 });
  journal.append({ id: 'a2', role: 'assistant', text: 'is forty-two.', start_ms: 40, end_ms: 60 });
  assert.deepEqual(journal.snapshot().map(turn => [turn.userPrompt, turn.reply]), [['Explain it.', 'The answer is forty-two.']]);
  // A genuine interruption with a separate answer remains saveable.
  journal.append({ id: 'u2', role: 'user', text: 'Why?', start_ms: 55, end_ms: 70 });
  journal.append({ id: 'a3', role: 'assistant', text: 'Here is why.', start_ms: 80, end_ms: 100 });
  assert.equal(journal.snapshot().at(-1).userPrompt, 'Why?');
  assert.equal(journal.snapshot().at(-1).reply, 'Here is why.');
});
console.log(`${count} Live voice regression checks passed.`);

const { runManagedLiveRegressions } = await import("./lib/live-responses-regressions.mjs");
await runManagedLiveRegressions();
