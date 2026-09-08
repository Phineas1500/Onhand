// Reproducible headed-browser acceptance checks. Uses an isolated profile,
// generated HTTP PDFs, and synthetic answers; no provider or personal data.
// CI installs Chrome for Testing and runs this under Xvfb. Missing browsers fail.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findBrowser, pickAvailablePort, launchBrowser, openContext } from "./run-real-browser-anchoring.mjs";
import { createPerformanceState, installPerformanceFixture } from "./run-sidebar-performance.mjs";

const EXTENSION = fileURLToPath(new URL("../packages/browser-extension/", import.meta.url));
const OUTPUT = resolve(process.env.ONHAND_TEST_ARTIFACT_DIR || "tmp/browser-workflows");
const ROOT = "document.querySelector('#onhand-extension-sidebar-host').shadowRoot";
const HISTORY_ID = "ci-native-sidebar-history";
const QUOTES = [
	"Water the garden beds early in the morning to reduce evaporation.",
	"Turn the compost regularly to distribute air through the pile.",
	"Inspect the undersides of leaves during the weekly garden check.",
];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function deadline(promise, ms, label) {
	let timer;
	try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms); })]); }
	finally { clearTimeout(timer); }
}
async function waitUntil(test, label, timeout = 25000) {
	const expires = Date.now() + timeout;
	let lastError;
	while (Date.now() < expires) {
		try { const value = await test(); if (value) return value; } catch (error) { lastError = error; }
		await delay(100);
	}
	throw new Error(`Timed out: ${label}${lastError ? ` (${lastError.message})` : ""}`);
}
function checked(response) { assert.equal(response?.ok, true, JSON.stringify(response)); return response; }
async function evaluate(ctx, sid, expression) {
	const result = await deadline(ctx.cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sid), 30000, "browser evaluation");
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
	return result.result?.value;
}
async function attach(ctx, predicate) {
	const target = await waitUntil(async () => (await ctx.cdp.send("Target.getTargets")).targetInfos.find(predicate), "browser target");
	return { targetId: target.targetId, sessionId: (await ctx.cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId };
}
async function viewerForTab(ctx, tabId) {
	// Multiple restored tabs can share the same PDF URL. Resolve the actual tab
	// through Chrome's debugger inventory, then use only its own frame tree.
	const target = await ctx.driverEval(`chrome.debugger.getTargets().then(targets=>targets.find(target=>target.tabId===${Number(tabId)}&&target.type==='page'))`);
	assert.ok(target?.id, `No browser target for PDF action tab ${tabId}`);
	const page = await attach(ctx, (candidate) => candidate.targetId === target.id);
	let inspectedTrees = [];
	try {
		const viewer = await waitUntil(async () => {
			const targets = (await ctx.cdp.send("Target.getTargets")).targetInfos;
			const queue = [page];
			const visited = new Set();
			inspectedTrees = [];
			while (queue.length) {
				const current = queue.shift();
				if (visited.has(current.targetId)) continue;
				visited.add(current.targetId);
				if (/pdf-viewer\.html\?url=/.test(targets.find((candidate) => candidate.targetId === current.targetId)?.url || "")) return current;
				const tree = (await ctx.cdp.send("Page.getFrameTree", {}, current.sessionId)).frameTree;
				inspectedTrees.push({ targetId: current.targetId, tree });
				const frameIds = new Set();
				const collect = (node) => { frameIds.add(node.frame.id); for (const child of node.childFrames || []) collect(child); };
				collect(tree);
				// Native PDF guest frames can be omitted from Page.getFrameTree;
				// their CDP target inventory still identifies the exact parent.
				for (const child of targets.filter((candidate) => ["page", "iframe"].includes(candidate.type) && !visited.has(candidate.targetId) &&
					(frameIds.has(candidate.targetId) || candidate.parentId === current.targetId || frameIds.has(candidate.parentFrameId)))) {
					queue.push(await attach(ctx, (candidate) => candidate.targetId === child.targetId));
				}
			}
			return null;
		}, `Onhand PDF frame within action tab ${tabId}`);
		return { ...viewer, page };
	} catch (error) {
		await writeFile(join(OUTPUT, "pdf-frame-target-debug.json"), JSON.stringify({ tabId, target, inspectedTrees, targets: (await ctx.cdp.send("Target.getTargets")).targetInfos }, null, 2));
		throw error;
	}
}
async function screenshot(ctx, sid, name) {
	const result = await ctx.cdp.send("Page.captureScreenshot", { format: "png" }, sid);
	await writeFile(join(OUTPUT, name), Buffer.from(result.data, "base64"));
}

function generatePdf() {
	const escape = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
	const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
	for (const [index, quote] of QUOTES.entries()) {
		const content = `BT /F1 12 Tf 40 720 Td (${escape(quote)}) Tj 0 -40 Td (Garden handbook page ${index + 1}.) Tj ET`;
		objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`);
		objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
	}
	let pdf = "%PDF-1.4\n";
	const offsets = [0];
	for (const [index, object] of objects.entries()) { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
	const start = pdf.length;
	pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
	return Buffer.from(pdf, "latin1");
}
async function serveFixtures() {
	const sidebar = await readFile(join(EXTENSION, "sidebar.js"));
	const config = { turns: 100, citations: 3, updates: 5, environment: "real browser with synthetic state" };
	const harness = `(${installPerformanceFixture.toString()})(window,${JSON.stringify(createPerformanceState(100, 3))},${JSON.stringify(config)});`;
	const pdf = generatePdf();
	const server = createServer(async (request, response) => {
		try {
			const path = new URL(request.url, "http://127.0.0.1").pathname;
			let body, type;
			if (path === "/fixture.pdf") { body = pdf; type = "application/pdf"; }
			else if (path === "/streaming") {
				// The embedded host's transformed ancestor must fill the viewport
				// so a short synthetic page does not prevent wheel hit testing.
				body = '<!doctype html><html><head><meta charset="utf-8"><title>Onhand synthetic streaming QA</title><style>html,body{min-height:100vh}</style></head><body><p>Synthetic conversation; production sidebar.</p><script src="/harness.js"></script><script src="/sidebar.js"></script></body></html>';
				type = "text/html";
			} else if (path === "/harness.js") { body = harness; type = "text/javascript"; }
			else if (path === "/sidebar.js") { body = sidebar; type = "text/javascript"; }
			else if (/^\/assets\/(fonts\/[A-Za-z0-9_.-]+\.woff2|vendor\/katex\.mjs)$/.test(path)) {
				body = await readFile(join(EXTENSION, path.slice("/assets/".length)));
				type = path.endsWith(".mjs") ? "text/javascript" : "font/woff2";
			} else if (path === "/") { body = '<!doctype html><title>Generated garden handbook</title><h1>Generated garden handbook</h1><a href="/fixture.pdf">Open generated PDF</a>'; type = "text/html"; }
			else { response.writeHead(404).end(); return; }
			response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }).end(body);
		} catch { response.writeHead(500).end(); }
	});
	await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
	return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function scrollGroup(ctx, base) {
	const tab = await ctx.driverEval(`chrome.tabs.create({url:${JSON.stringify(`${base}/streaming`)},active:true})`);
	const target = await attach(ctx, (t) => t.url === `${base}/streaming`);
	const sid = target.sessionId;
	const ev = (text) => evaluate(ctx, sid, text);
	await ctx.cdp.send("Page.bringToFront", {}, sid);
	await ctx.cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sid);
	await waitUntil(() => ev("window.__onhandPerformanceFixture?.ready().then(()=>true)"), "synthetic streaming transcript");
	const geometry = () => ev(`(()=>{const s=${ROOT},b=s.querySelector('#scroll'),j=s.querySelector('#jumpToLatestButton'),r=b.getBoundingClientRect(),q=j.getBoundingClientRect();return{top:b.scrollTop,height:b.scrollHeight,client:b.clientHeight,jump:!j.hidden,focus:s.activeElement?.id,x:r.x+r.width/2,y:r.y+r.height/2,button:{x:q.x+q.width/2,y:q.y+q.height/2}}})()`);
	await ev(`${ROOT}.querySelector('#jumpToLatestButton').click()`);
	let g = await geometry();
	assert.ok(g.client > 100, "scroll wrapper leaves room for the transcript");
	await ctx.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: Math.round(g.x), y: Math.round(g.y), deltaX: 0, deltaY: -650 }, sid);
	await waitUntil(async () => (await geometry()).jump, "trusted wheel scroll");
	await delay(300);
	const readingTop = (await geometry()).top;
	for (let i = 0; i < 5; i++) {
		await ev(`(async()=>{const f=window.__onhandPerformanceFixture,s=f.getState();s.messages[1].text+=' CI streaming update ${i}.';await f.replaceState(s)})()`);
		assert.ok(Math.abs((await geometry()).top - readingTop) < 2, "streaming must preserve wheel reading position");
	}
	await screenshot(ctx, sid, "streaming-reading-position.png");
	const clickJump = async () => {
		const p = (await geometry()).button;
		await ctx.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", clickCount: 1 }, sid);
		await ctx.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", clickCount: 1 }, sid);
		await waitUntil(async () => { const x = await geometry(); return !x.jump && x.focus === "scroll" && x.height - x.client - x.top < 2; }, "Jump to latest and focus");
	};
	await clickJump();
	// Other desktop input must not determine whether this isolated test target
	// receives the keyboard event. Keep focus emulation scoped to the fixture.
	await ctx.cdp.send("Page.bringToFront", {}, sid);
	for (const type of ["keyDown", "keyUp"]) await ctx.cdp.send("Input.dispatchKeyEvent", { type, key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 }, sid);
	await waitUntil(async () => (await geometry()).jump, "keyboard reading position");
	await delay(300);
	const keyboardTop = (await geometry()).top;
	await ev("(async()=>{const f=window.__onhandPerformanceFixture,s=f.getState();s.messages[1].text+=' Keyboard preservation check.';await f.replaceState(s)})()");
	assert.ok(Math.abs((await geometry()).top - keyboardTop) < 2);
	await clickJump();
	await ev("(async()=>{const f=window.__onhandPerformanceFixture,s=f.getState();s.messages[1].text+=' Following latest output. '.repeat(100);await f.replaceState(s)})()");
	g = await geometry();
	assert.ok(g.height - g.client - g.top < 2, "jumping must resume following subsequent output");
	await ctx.driverEval(`chrome.tabs.remove(${tab.id})`);
	return { syntheticState: true, trustedWheelUpdatesPreserved: 5, keyboardPositionPreserved: true, jumpFocus: g.focus, followingResumed: true };
}

async function openNativePanel(ctx, windowId) {
	// Open through the product API and attach to the resulting native panel.
	// Never substitute direct navigation to the sidepanel.html URL.
	await evaluate(ctx, ctx.driverSessionId, `chrome.sidePanel.open({windowId:${windowId}})`);
	const target = await attach(ctx, (t) => t.type === "page" && t.url === `chrome-extension://${ctx.extId}/sidepanel.html`);
	await waitUntil(() => evaluate(ctx, target.sessionId, `Boolean(${ROOT}?.querySelector('#messages'))`), "native sidebar DOM");
	return target;
}
function panelHelpers(ctx, panel) {
	const ev = (text) => evaluate(ctx, panel.sessionId, text);
	const state = () => ev(`(()=>{const s=${ROOT};return{count:s.querySelectorAll('#messages > .onhand-entry').length,citations:[...s.querySelectorAll('#messages .onhand-cite')].map(b=>[b.textContent.trim(),b.dataset.actionKey]),name:s.querySelector('#sessionTitleInput').value,text:s.querySelector('#messages').textContent,notice:s.querySelector('.onhand-source-feedback')?.textContent}})()`);
	return { ev, state };
}
async function seedHistory(ctx) {
	checked(await ctx.sendMessage({ type: "browser-runtime:update-settings", aiProvider: "onhand-smoke", aiModel: "onhand-smoke-1", aiApiKey: "fixture", authMode: "api-key", diagnosticsEnabled: false }));
	checked(await ctx.sendMessage({ type: "sidebar:fetch-state" }));
	const fixture = createPerformanceState(100, 3);
	const now = new Date().toISOString();
	// Historical prose makes idle payloads large without inventing remote sources
	// that a later full-session restore would try to reopen.
	const turns = fixture.turns.map((turn, index) => ({ ...turn, pageActions: [],
		reply: `Saved answer ${index + 1}. ` + "This is synthetic history used to verify the live sidebar's update and persistence behavior. ".repeat(24),
	}));
	const seed = { id: HISTORY_ID, name: "CI saved conversation", createdAt: now, updatedAt: now, turns, messages: [], pageActions: [], artifactIds: [], learnerState: null };
	await ctx.driverEval(`(async()=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('onhandBrowserRuntime');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});try{await new Promise((r,j)=>{const tx=db.transaction('runtimeSessions','readwrite');tx.objectStore('runtimeSessions').put(${JSON.stringify(seed)});tx.oncomplete=r;tx.onerror=()=>j(tx.error);tx.onabort=()=>j(tx.error)})}finally{db.close()}})()`);
	checked(await ctx.sendMessage({ type: "sidebar:switch-session", sessionPath: HISTORY_ID }));
	return seed;
}
async function openPdf(ctx, base) {
	const tab = await ctx.driverEval(`chrome.tabs.create({url:${JSON.stringify(base)},active:true})`);
	const opened = checked(await ctx.tool("browser_open_pdf_in_onhand_viewer", { pdfUrl: `${base}/fixture.pdf`, tabId: tab.id, windowId: tab.windowId }));
	const viewer = await viewerForTab(ctx, opened.result.tab.id);
	await waitUntil(() => evaluate(ctx, viewer.sessionId, "document.querySelectorAll('.textLayer span').length>0"), "generated PDF text layer");
	return { tab: opened.result.tab, viewer };
}
async function assertCitationTargets(ctx, panel, viewer, actions, expectedChips) {
	const { ev, state } = panelHelpers(ctx, panel);
	for (let i = 0; i < 3; i++) {
		const annotationId = actions[i * 2].annotationId;
		await ev(`(()=>{const b=[...${ROOT}.querySelectorAll('#messages .onhand-cite')].at(-${3 - i});b.scrollIntoView({block:'center'});b.click()})()`);
		await waitUntil(() => ev(`![...${ROOT}.querySelectorAll('#messages .onhand-cite')].at(-${3 - i}).dataset.onhandActionPending`), `citation ${i + 1} activation finishes`);
		const activeViewer = await viewerForTab(ctx, actions[i * 2].tabId);
		try {
			await waitUntil(() => evaluate(ctx, activeViewer.sessionId, `(()=>{const n=document.querySelector('[data-onhand-note-for='+CSS.escape(${JSON.stringify(annotationId)})+']'),r=n?.getBoundingClientRect();return !!r&&r.bottom>0&&r.top<innerHeight&&n.textContent.includes(${JSON.stringify(`Fixture explanation ${i + 1}`)})})()`), `citation ${i + 1} reaches its PDF note`);
		} catch (error) {
			const debug = { index: i, action: actions[i * 2], viewer: activeViewer, panel: await state(), notes: await evaluate(ctx, activeViewer.sessionId, "[...document.querySelectorAll('[data-onhand-note-for]')].map(n=>({id:n.getAttribute('data-onhand-note-for'),text:n.textContent,rect:n.getBoundingClientRect().toJSON()}))") };
			await writeFile(join(OUTPUT, "citation-target-debug.json"), JSON.stringify(debug, null, 2));
			throw error;
		}
		const snapshot = await state();
		assert.deepEqual(snapshot.citations, expectedChips, "citation navigation must preserve IDs and numbering");
		assert.equal(snapshot.notice, undefined, "citation navigation must not report a hidden activation failure");
	}
}
async function connectionRecoveryGroup(ctx, panel, viewer, actions) {
	const { ev, state } = panelHelpers(ctx, panel);
	// Add a later answer so the failing citation belongs to an older entry.
	checked(await ctx.sendMessage({ type: "sidebar:realtime-record-turn", voiceTurnId: "ci-later-answer", userPrompt: "Continue after the garden answer.", reply: "A later fixture answer follows the cited voice response. ".repeat(16), pageActions: [] }));
	await waitUntil(async () => (await state()).count === 102, "later answer after the cited response");
	await ev(`(()=>{const s=${ROOT},send=chrome.runtime.sendMessage.bind(chrome.runtime);window.__ciDisconnect=false;window.__ciFailSource=false;window.__ciSourceCalls=[];chrome.runtime.sendMessage=async(message,...rest)=>{if(message?.type==='sidebar:activate-action')window.__ciSourceCalls.push({key:message.key,injectFailure:window.__ciFailSource});if(message?.type==='sidebar:fetch-state'&&window.__ciDisconnect)throw new Error('Fixture background connection unavailable');if(message?.type==='sidebar:activate-action'&&window.__ciFailSource){window.__ciFailSource=false;return{ok:false,error:'Fixture source could not be opened'}}return send(message,...rest)};window.__ciReaderNodes=[...s.querySelectorAll('#messages > .onhand-entry')];const source=s.querySelector('#messages .onhand-cite');source.scrollIntoView({block:'center'});window.__ciSource=source;return true})()`);
	await delay(200);
	const reading = () => ev(`(()=>{const s=${ROOT},b=s.querySelector('#scroll');return{top:b.scrollTop,away:b.scrollHeight-b.clientHeight-b.scrollTop>96,notice:!s.querySelector('#connectionNotice').hidden,inputDisabled:s.querySelector('#input').disabled,nodesRetained:window.__ciReaderNodes.every((n,i)=>s.querySelectorAll('#messages > .onhand-entry')[i]===n)}})()`);
	const before = await reading();
	assert.ok(before.away, "fault fixture must read an older answer above the latest output");
	await ev("window.__ciDisconnect=true");
	await waitUntil(async () => (await reading()).notice, "disconnected notice after actual polling failure");
	const offline = await reading();
	assert.equal(offline.nodesRetained, true, "disconnect must preserve the last accepted conversation DOM");
	assert.equal(offline.inputDisabled, true, "disconnect must pause new runtime actions");
	assert.ok(Math.abs(offline.top - before.top) < 2, "disconnect must preserve the reading position");
	await screenshot(ctx, panel.sessionId, "sidebar-disconnected.png");
	await ev(`window.__ciDisconnect=false;${ROOT}.querySelector('#reconnectButton').click()`);
	await waitUntil(async () => !(await reading()).notice, "manual reconnect through the real runtime");
	const reconnected = await reading();
	assert.equal(reconnected.nodesRetained, true);
	assert.equal(reconnected.inputDisabled, false);
	assert.ok(Math.abs(reconnected.top - before.top) < 2);
	// This is a separate user action, not the tail of the earlier source click's
	// in-flight work or double-click suppression window.
	await waitUntil(() => ev("!window.__ciSource.disabled&&!window.__ciSource.dataset.onhandActionPending&&Date.now()-Number(window.__ciSource.dataset.onhandActionLastActivatedAt||0)>1000"), "older source ready for a distinct activation");
	await ev("window.__ciFailSource=true;window.__ciSource.click()");
	try {
		await waitUntil(() => ev(`Boolean(${ROOT}.querySelector('.onhand-source-feedback [data-action-retry]'))`), "inline older-source failure and Retry");
	} catch (error) {
		const debug = await ev(`(()=>{const s=${ROOT},b=window.__ciSource,m=s.querySelector('#messages');return{connected:b.isConnected,disabled:b.disabled,dataset:{...b.dataset},sourceCalls:window.__ciSourceCalls,injectFailure:window.__ciFailSource,pending:[...(m.__onhandActionPendingKeys||[])],failures:[...(m.__onhandActionFailures||[])],feedback:[...s.querySelectorAll('.onhand-source-feedback')].map(n=>n.textContent)}})()`);
		await writeFile(join(OUTPUT, "source-retry-debug.json"), JSON.stringify(debug,null,2));
		throw new Error(`${error.message}: ${JSON.stringify(debug)}`);
	}
	assert.equal(await ev("window.__ciSource.nextElementSibling?.classList.contains('onhand-source-feedback')"), true, "source failure must appear next to the clicked older citation");
	assert.ok(Math.abs((await reading()).top - before.top) < 2, "inline source failure must preserve reading position");
	await screenshot(ctx, panel.sessionId, "sidebar-source-retry.png");
	await ev(`${ROOT}.querySelector('.onhand-source-feedback [data-action-retry]').click()`);
	await waitUntil(() => ev(`!${ROOT}.querySelector('.onhand-source-feedback')`), "successful source retry clears its own feedback");
	const annotationId = actions[0].annotationId;
	await waitUntil(() => evaluate(ctx, viewer.sessionId, `(()=>{const n=document.querySelector('[data-onhand-note-for='+CSS.escape(${JSON.stringify(annotationId)})+']'),r=n?.getBoundingClientRect();return !!r&&r.bottom>0&&r.top<innerHeight&&n.textContent.includes('Fixture explanation 1')})()`), "source retry reaches the actual generated PDF note");
	assert.equal((await reading()).nodesRetained, true);
	assert.ok(Math.abs((await reading()).top - before.top) < 2, "successful retry must preserve the older answer's position");
	return { controlledFetchFailure: true, disconnectedSnapshotRetained: true, readingPositionPreserved: true, realReconnect: true, olderCitationInlineFailure: true, retryReachedLivePdfNote: true };
}
async function nativeGroup(ctx, base) {
	await seedHistory(ctx);
	const { tab, viewer } = await openPdf(ctx, base);
	const actions = [];
	for (const [index, quote] of QUOTES.entries()) {
		const result = checked(await ctx.tool("browser_highlight_text", { tabId: tab.id, windowId: tab.windowId, text: quote, pageNumber: index + 1, clearExisting: false }));
		const mark = result.result.annotation;
		assert.ok(mark?.annotationId);
		checked(await ctx.tool("browser_show_note", { tabId: tab.id, annotationId: mark.annotationId, note: `Fixture explanation ${index + 1}.`, label: "Onhand QA" }));
		for (const type of ["annotation", "note"]) actions.push({ key: `${type === "note" ? "note" : "highlight"}:${mark.annotationId}`, type, annotationId: mark.annotationId, tabId: tab.id, windowId: tab.windowId, url: `${base}/fixture.pdf`, title: "Generated garden handbook", label: type === "note" ? "Note" : "Highlight", citationText: type === "note" ? `Fixture explanation ${index + 1}.` : quote, pdfAnchor: mark.pdfAnchor });
	}
	const reply = QUOTES.map((quote, index) => `${quote} ${"This extended fixture explanation checks that a complete voice answer keeps its paragraphs and source references when saved. ".repeat(7)}[[cite:${actions[index * 2].annotationId}]]`).join("\n\n");
	assert.ok(reply.length > 2000, "voice fixture must exceed the former saved-answer truncation limit");
	checked(await ctx.sendMessage({ type: "sidebar:realtime-record-turn", voiceTurnId: "ci-pdf-answer", userPrompt: "Explain the three garden practices.", reply, pageActions: actions }));
	const panel = await openNativePanel(ctx, tab.windowId);
	const { ev, state } = panelHelpers(ctx, panel);
	await waitUntil(async () => (await state()).count === 101, "101 native sidebar entries");
	const baseline = await state();
	assert.equal(baseline.citations.length, 3);
	assert.ok(baseline.citations.every((chip, index) => chip[0] === `[${index + 1}]`));
	await ev(`(()=>{window.__ciPolls=[];const send=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=async(...args)=>{const r=await send(...args);if(args[0]?.type==='sidebar:fetch-state')window.__ciPolls.push({sent:args[0].knownHistoryRevision,revision:r.historyRevision,unchanged:r.historyUnchanged,bytes:JSON.stringify(r).length,turns:Object.hasOwn(r.state||{},'turns'),messages:Object.hasOwn(r.state||{},'messages'),status:Object.hasOwn(r.state||{},'status')});return r};window.__ciNodes=[...${ROOT}.querySelectorAll('#messages > .onhand-entry')];return true})()`);
	await waitUntil(() => ev("window.__ciPolls.slice(-3).length===3&&window.__ciPolls.slice(-3).every(p=>p.unchanged)"), "three unchanged native sidebar polls");
	const idlePolls = await ev("window.__ciPolls.slice(-3)");
	assert.ok(idlePolls.every((poll) => !poll.turns && !poll.messages && poll.status && poll.sent === poll.revision));
	const full = checked(await ctx.sendMessage({ type: "sidebar:fetch-state", windowId: tab.windowId }));
	assert.equal(full.state.turns.length, 101);
	const fullBytes = JSON.stringify(full).length;
	assert.ok(idlePolls.every((poll) => poll.bytes < fullBytes / 5), "unchanged polls must omit the large conversation payload");
	assert.equal(await ev(`window.__ciNodes.every((n,i)=>${ROOT}.querySelectorAll('#messages > .onhand-entry')[i]===n)`), true);
	await ev("window.__ciPolls=[]");
	checked(await ctx.sendMessage({ type: "sidebar:realtime-record-turn", voiceTurnId: "ci-pdf-answer", userPrompt: "Explain the three garden practices.", reply: `Current history update reached the panel.\n\n${reply}`, pageActions: actions }));
	await waitUntil(async () => (await state()).text.includes("Current history update reached the panel."), "history revision invalidation");
	await waitUntil(() => ev("window.__ciPolls.some(p=>p.unchanged===false&&p.turns&&p.messages)"), "full response after history edit");
	assert.equal(await ev(`window.__ciNodes.slice(0,100).every((n,i)=>${ROOT}.querySelectorAll('#messages > .onhand-entry')[i]===n)`), true);
	await assertCitationTargets(ctx, panel, viewer, actions, baseline.citations);
	const recovery = await connectionRecoveryGroup(ctx, panel, viewer, actions);
	const expectedTurnCount = 102;
	await screenshot(ctx, panel.sessionId, "native-sidebar.png");
	// In Chromium the Onhand PDF viewer may be an out-of-process iframe;
	// screenshot the observed containing page rather than sending Page commands
	// that Chromium only accepts on a top-level target to the iframe itself.
	const pdfPage = await viewerForTab(ctx, tab.id);
	await screenshot(ctx, pdfPage.page.sessionId, "pdf-citation-note.png");
	await ev(`${ROOT}.querySelector('#headerNewSessionButton').click()`);
	await waitUntil(async () => (await state()).count === 0, "empty new session");
	await ev(`${ROOT}.querySelector('#menuButton').click()`);
	await waitUntil(() => ev(`${ROOT}.querySelector('#sessionSelect option[value="${HISTORY_ID}"]')!==null`), "saved conversation selection");
	await ev(`(()=>{const s=${ROOT}.querySelector('#sessionSelect');s.value=${JSON.stringify(HISTORY_ID)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
	await waitUntil(async () => (await state()).count === expectedTurnCount, "selected saved conversation");
	assert.deepEqual((await state()).citations, baseline.citations);
	const persisted = checked(await ctx.sendMessage({ type: "sidebar:fetch-state", windowId: tab.windowId }));
	const expectedReply = `Current history update reached the panel.\n\n${reply}`;
	assert.equal(persisted.state.turns.find((turn) => turn.id === "ci-pdf-answer")?.reply, expectedReply, "recording a voice answer must preserve its complete text and final citation");
	return { actions, expectedChips: baseline.citations, expectedReply, expectedTurnCount, historyRevision: persisted.historyRevision, result: { realNativePanel: true, generatedPdfPages: 3, citations: 3, citationClicks: 3, fullBytes, idlePolls, unchangedNodesRetained: 100, historyEditVisible: true, sessionSwitchPassed: true, savedVoiceReplyCharacters: expectedReply.length, recovery } };
}
async function restartGroup(ctx, base, previous) {
	const persisted = checked(await ctx.sendMessage({ type: "sidebar:fetch-state", knownHistoryRevision: previous.historyRevision }));
	assert.equal(persisted.historyUnchanged, false, "a new service worker must not reuse the old runtime's revision token");
	assert.notEqual(persisted.historyRevision, previous.historyRevision);
	assert.equal(persisted.state.turns.length, previous.expectedTurnCount, "browser restart must retain committed history in IndexedDB");
	const { tab } = await openPdf(ctx, base);
	// Retain the restarted source tab alongside the newly opened viewer: replay
	// must choose and prepare its actual target even when their PDF URLs match.
	const snapshot = async () => {
		const read = async (operation) => { try { return await operation(); } catch (error) { return { error: error.stack || String(error) }; } };
		const [tabs, targets, state] = await Promise.all([
			read(() => ctx.driverEval("chrome.tabs.query({})")),
			read(() => ctx.cdp.send("Target.getTargets")),
			read(() => ctx.sendMessage({ type: "sidebar:fetch-state", windowId: tab.windowId })),
		]);
		return { tabs, targets, state };
	};
	const beforeRestore = await snapshot();
	const restored = await ctx.sendMessage({ type: "sidebar:restore-session", sessionPath: HISTORY_ID });
	await writeFile(join(OUTPUT, "restart-restore-debug.json"), JSON.stringify({ fixturePdf: `${base}/fixture.pdf`, preparedTab: tab, previousActions: previous.actions, beforeRestore, restored, afterRestore: await snapshot() }, null, 2));
	checked(restored);
	assert.ok(restored.restoredPages?.length, "restoring the saved session must replay the generated PDF");
	assert.equal(restored.restoredPages.reduce((sum, page) => sum + Number(page.failedCount || page.failures?.length || 0), 0), 0, "restoring the generated PDF must not fail");
	assert.equal(restored.restoredPages.reduce((sum, page) => sum + Number(page.restoredAnnotations || 0), 0), 3, "all three generated PDF annotations must be restored");
	const state = checked(await ctx.sendMessage({ type: "sidebar:fetch-state", windowId: tab.windowId })).state;
	const turn = state.turns.find((turn) => turn.id === "ci-pdf-answer");
	assert.ok(turn);
	assert.equal(turn.reply, previous.expectedReply, "restart must preserve the full voice answer, paragraph breaks, and final citation");
	const actions = QUOTES.flatMap((_, index) => {
		const previousAction = previous.actions[index * 2];
		const highlight = turn.pageActions.find((action) => action.key === previousAction.key && action.type === "annotation");
		const note = turn.pageActions.find((action) => action.key === previous.actions[index * 2 + 1].key && action.type === "note");
		assert.ok(highlight?.annotationId && note?.annotationId, "restored citation action must retain its saved identity");
		return [highlight, note];
	});
	const viewer = await viewerForTab(ctx, actions[0].tabId);
	const panel = await openNativePanel(ctx, tab.windowId);
	const helpers = panelHelpers(ctx, panel);
	await waitUntil(async () => (await helpers.state()).count === previous.expectedTurnCount, "saved answers visible after browser and service-worker restart");
	const chips = (await helpers.state()).citations;
	assert.deepEqual(chips, previous.expectedChips, "restart and restore must preserve citation labels and action keys");
	await assertCitationTargets(ctx, panel, viewer, actions, chips);
	await screenshot(ctx, panel.sessionId, "sidebar-after-restart.png");
	return { browserAndWorkerRestarted: true, committedTurns: previous.expectedTurnCount, completeVoiceReplyPreserved: true, savedVoiceReplyCharacters: turn.reply.length, revisionReset: true, restoredCitationClicks: 3, citationIdentitiesPreserved: true };
}

let child, ctx, server, stoppingBrowser;
let cancelled = false;
const profile = await mkdtemp(join(tmpdir(), "onhand-sidebar-workflows-"));
const results = { syntheticAnswers: true, paidProviderCalls: 0, startedAt: new Date().toISOString() };
function stopBrowser() {
	if (stoppingBrowser) return stoppingBrowser;
	stoppingBrowser = (async () => {
		const currentContext = ctx;
		const currentChild = child;
		ctx = null;
		child = null;
		currentContext?.cdp.ws.close();
		if (currentChild && currentChild.exitCode === null) {
			const exited = once(currentChild, "exit");
			currentChild.kill("SIGTERM");
			await deadline(exited, 5000, "owned test browser exit").catch(async () => { currentChild.kill("SIGKILL"); await deadline(exited, 5000, "forced test browser exit"); });
		}
	})().finally(() => { stoppingBrowser = null; });
	return stoppingBrowser;
}
try {
	assert.ok(findBrowser(), "A Chromium browser is required. Set ONHAND_TEST_BROWSER to Chrome for Testing, Chromium, or Helium.");
	await mkdir(OUTPUT, { recursive: true });
	const fixtures = await serveFixtures(); server = fixtures.server;
	const port = await pickAvailablePort();
	const startBrowser = async () => {
		if (cancelled) throw new Error("Browser workflow was cancelled before launch");
		child = launchBrowser(profile, port);
		const context = await openContext(port);
		if (cancelled) { context.cdp.ws.close(); throw new Error("Browser workflow was cancelled while connecting"); }
		ctx = context;
	};
	const run = async () => {
		await startBrowser();
		results.browser = await ctx.cdp.send("Browser.getVersion");
		results.scrolling = await scrollGroup(ctx, fixtures.base);
		console.log("Real sidebar scrolling: PASS (wheel, PageUp, streaming stability, Jump to latest)");
		const native = await nativeGroup(ctx, fixtures.base); results.native = native.result;
		console.log("Native PDF sidebar: PASS (citations, history reuse, updates, session switching)");
		await stopBrowser();
		await startBrowser();
		results.restart = await restartGroup(ctx, fixtures.base, native);
		console.log("Browser/service-worker restart: PASS (saved history, revision recovery, restored PDF citations)");
	};
	await deadline(run(), 240000, "real sidebar workflows");
	results.passed = true;
} catch (error) {
	results.passed = false;
	results.error = error.stack || String(error);
	console.error(results.error);
	process.exitCode = 1;
} finally {
	cancelled = true;
	await mkdir(dirname(join(OUTPUT, "results.json")), { recursive: true });
	await writeFile(join(OUTPUT, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
	await stopBrowser().catch((error) => { console.error(error); process.exitCode = 1; });
	if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
	await rm(profile, { recursive: true, force: true });
}
