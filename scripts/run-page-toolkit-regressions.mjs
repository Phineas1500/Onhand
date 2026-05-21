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

async function assertHighlight({ name, html, query, expectedText, expectedFallback, options = {} }) {
	const { toolkit } = await createToolkit(html);
	const result = await toolkit.highlightText(query, { scrollIntoView: false, ...options });
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

async function assertExactSourceModeDoesNotApproximate() {
	const { toolkit } = await createToolkit(`
		<main>
			<p>The Promise object represents the eventual completion (or failure) of an asynchronous operation and its resulting value.</p>
		</main>
	`);
	await assert.rejects(
		() =>
			toolkit.highlightText("Promise represents eventual completion failure asynchronous operation resulting value", {
				scrollIntoView: false,
				exactOnly: true,
				allowApproximate: false,
			}),
		/No visible text matched/i,
	);
}

async function assertExactSourceModeReusesExistingHighlight() {
	const { dom, toolkit } = await createToolkit(`
		<main>
			<p>The convergence property is Q = QP for a stationary distribution.</p>
		</main>
	`);
	const first = await toolkit.highlightText("Q = QP", { scrollIntoView: false });
	const second = await toolkit.highlightText("Q = QP", {
		scrollIntoView: false,
		clearExisting: false,
		exactOnly: true,
		allowApproximate: false,
		reuseExisting: true,
	});
	assert.equal(second.annotationId, first.annotationId);
	assert.equal(second.reusedExisting, true);
	assert.equal(dom.window.document.querySelectorAll("[data-onhand-highlight-kind]").length, 1);
}

async function assertHighlightTextPreservesExistingAnnotationsByDefault() {
	const { dom, toolkit } = await createToolkit(`
		<main>
			<p>The Perron-Frobenius theorem identifies the largest eigenvalue.</p>
			<p>The aperiodic condition prevents fixed-cycle behavior.</p>
		</main>
	`);
	await toolkit.highlightText("Perron-Frobenius theorem", { scrollIntoView: false });
	await toolkit.highlightText("aperiodic condition", { scrollIntoView: false });
	const highlights = Array.from(dom.window.document.querySelectorAll("[data-onhand-highlight-kind]"));
	assert.equal(highlights.length, 2, "follow-up highlights should accumulate unless clearExisting=true");
	assert.match(highlights[0].textContent, /Perron-Frobenius/);
	assert.match(highlights[1].textContent, /aperiodic condition/);
}

async function assertExactMathSourceModeMatchesRenderedMathJax() {
	const { dom, toolkit } = await createToolkit(`
		<main>
			<p>
				Thus, the process converges to a unique stationary distribution.
				<script type="math/tex; mode=display" id="MathJax-Element-1">{\\bf q} = {\\bf q} {\\bf P}  .</script>
				<span class="MathJax_Display"><span class="MathJax" id="MathJax-Element-1-Frame"></span></span>
			</p>
			<p>Algorithm 1 begins after the display equation.</p>
		</main>
	`);
	const highlight = await toolkit.highlightText("q = qP", {
		scrollIntoView: false,
		exactOnly: true,
		allowApproximate: false,
	});
	assert.equal(highlight.fallback, "math-source");
	assert.equal(highlight.approximate, false);
	const highlighted = dom.window.document.querySelector("[data-onhand-highlight-kind]");
	assert.ok(highlighted?.classList.contains("MathJax_Display"), "expected rendered MathJax display to be highlighted");
	await toolkit.showNote(highlight.annotationId, "Stationary means applying the transition leaves q unchanged.", {
		scrollIntoView: false,
	});
	const note = dom.window.document.querySelector('[data-onhand-note-kind="card"]');
	assert.ok(note, "math-source highlight should support notes");
	assert.equal(note.previousElementSibling?.getAttribute("data-onhand-highlight-kind"), "block");
}

async function assertMathJaxQueueSettlesBeforeMathSourceRestore() {
	const { dom, toolkit } = await createToolkit(`
		<main>
			<p id="stationary">
				Thus, the process converges to a unique stationary distribution.
				And this unique stationary distribution $$ {\\bf q} = {\\bf q} {\\bf P}  .$$
			</p>
			<p>Algorithm 1 begins after the display equation.</p>
		</main>
	`);
	let converted = false;
	dom.window.MathJax = {
		Hub: {
			Queue(callback) {
				if (!converted) {
					converted = true;
					const paragraph = dom.window.document.getElementById("stationary");
					paragraph.innerHTML = `
						Thus, the process converges to a unique stationary distribution.
						And this unique stationary distribution
						<script type="math/tex; mode=display" id="MathJax-Element-2">{\\bf q} = {\\bf q} {\\bf P}  .</script>
						<span class="MathJax_Display"><span class="MathJax" id="MathJax-Element-2-Frame"></span></span>
					`;
				}
				dom.window.setTimeout(callback, 0);
			},
		},
	};
	const highlight = await toolkit.highlightText("q = qP", {
		scrollIntoView: false,
		exactOnly: true,
		allowApproximate: false,
	});
	assert.equal(highlight.fallback, "math-source");
	const highlighted = dom.window.document.querySelector("[data-onhand-highlight-kind]");
	assert.ok(highlighted?.classList.contains("MathJax_Display"), "expected delayed MathJax render target to be highlighted");
	assert.notEqual(highlighted?.id, "stationary", "raw TeX paragraph should not be highlighted");
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
	await assertExactSourceModeDoesNotApproximate();
	await assertExactSourceModeReusesExistingHighlight();
	await assertHighlightTextPreservesExistingAnnotationsByDefault();
	await assertExactMathSourceModeMatchesRenderedMathJax();
	await assertMathJaxQueueSettlesBeforeMathSourceRestore();

	console.log("Page toolkit regressions: PASS");
}

main().catch((error) => {
	console.error(error?.stack || error?.message || String(error));
	process.exitCode = 1;
});
