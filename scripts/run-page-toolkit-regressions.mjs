import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { JSDOM } from "jsdom";

const PROJECT_ROOT = process.cwd();

async function loadPageToolkitFactory() {
	const source = await readFile(join(PROJECT_ROOT, "packages/browser-extension/background.js"), "utf8");
	const start = source.indexOf("const createPageToolkit = ");
	const end = source.indexOf("\n};\n\nasync function evaluateInTab", start);
	assert.notEqual(start, -1, "createPageToolkit declaration not found");
	assert.notEqual(end, -1, "createPageToolkit end marker not found");
	const expressionStart = source.indexOf("=", start) + 1;
	const expression = source.slice(expressionStart, end + 2).trim().replace(/;$/, "");
	return expression;
}

function installLayoutShims(window) {
	Object.defineProperty(window.HTMLElement.prototype, "innerText", {
		get() {
			return this.textContent || "";
		},
		set(value) {
			this.textContent = String(value ?? "");
		},
		configurable: true,
	});
	window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
	window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
		return {
			x: 16,
			y: 16,
			top: 16,
			left: 16,
			right: 656,
			bottom: 40,
			width: 640,
			height: 24,
			toJSON() {
				return { x: this.x, y: this.y, top: this.top, left: this.left, right: this.right, bottom: this.bottom, width: this.width, height: this.height };
			},
		};
	};
}

async function createToolkit(html) {
	const dom = new JSDOM(html, {
		url: "https://example.test/article",
		pretendToBeVisual: true,
		runScripts: "outside-only",
	});
	installLayoutShims(dom.window);
	const factoryExpression = await loadPageToolkitFactory();
	const createPageToolkit = dom.window.eval(`(${factoryExpression})`);
	return {
		dom,
		toolkit: createPageToolkit({ theme: "light" }),
	};
}

async function assertHighlight({ name, html, query, expectedText, expectedFallback }) {
	const { toolkit } = await createToolkit(html);
	const result = await toolkit.highlightText(query, { scrollIntoView: false });
	assert.match(result.matchedText, expectedText, `${name}: matched text`);
	if (expectedFallback) {
		assert.equal(result.fallback, expectedFallback, `${name}: fallback`);
	}
}

async function assertNoHighlight({ name, html, query }) {
	const { toolkit } = await createToolkit(html);
	await assert.rejects(
		() => toolkit.highlightText(query, { scrollIntoView: false }),
		/error|No visible text matched/i,
		`${name}: expected no highlight`,
	);
}

async function assertNoteDoesNotClearFloats() {
	const { dom, toolkit } = await createToolkit(`
		<main>
			<aside style="float:right;width:320px;height:520px">Floating page media</aside>
			<p>A Markov chain or Markov process is a stochastic process describing a sequence of possible events.</p>
		</main>
	`);
	const highlight = await toolkit.highlightText("Markov chain or Markov process", { scrollIntoView: false });
	await toolkit.showNote(highlight.annotationId, "The note should stay visually attached to the highlighted paragraph.", {
		scrollIntoView: false,
	});
	const note = dom.window.document.querySelector('[data-onhand-note-kind="card"]');
	assert.ok(note, "note card was not inserted");
	assert.equal(dom.window.getComputedStyle(note).clear, "none", "note cards must not clear floated page media");
	assert.equal(note.previousElementSibling?.tagName, "P", "note should be inserted directly after the highlighted paragraph");
}

async function main() {
	await assertHighlight({
		name: "curly quote exact projection",
		html: `<main><p>Use “steady state” proposals when the base sampler rejects too often.</p></main>`,
		query: `Use "steady state" proposals`,
		expectedText: /Use .steady state. proposals/,
		expectedFallback: "normalized-text",
	});

	await assertHighlight({
		name: "ellipsis exact projection",
		html: `<main><p>But sampling from P(W) still causes too many rejections… can we improve it?</p></main>`,
		query: "But sampling from P(W) still causes too many rejections... can we improve it?",
		expectedText: /too many rejections/,
		expectedFallback: "normalized-text",
	});

	await assertHighlight({
		name: "token window approximate projection",
		html: `<main><p>The Promise object represents the eventual completion (or failure) of an asynchronous operation and its resulting value.</p></main>`,
		query: "Promise represents eventual completion failure asynchronous operation resulting value",
		expectedText: /Promise object represents the eventual completion/,
	});

	await assertNoHighlight({
		name: "avoid low-coverage missing concept match",
		html: `<main><p>Markov chain Monte Carlo is used for sampling from complex probability distributions.</p></main>`,
		query: "Hamiltonian Monte Carlo specifically",
	});

	await assertNoteDoesNotClearFloats();

	console.log("Page toolkit regressions: PASS");
}

main().catch((error) => {
	console.error(error?.stack || error?.message || String(error));
	process.exitCode = 1;
});
