const DEFAULT_RUN_ID = `chrome-acceptance-${new Date().toISOString().slice(0, 10)}`;

const suites = {
	fixture: {
		label: "Local fixture matrix",
		setup: [
			"npm run build:browser-runtime",
			"reload the unpacked Chrome extension from packages/browser-extension/",
			"confirm extension options show authMode oauth, aiProvider openai-codex, and aiModel gpt-5.5",
			"npm run serve:fixture",
			"open http://127.0.0.1:8765/ in Chrome",
			"start a fresh Onhand side-panel session named Chrome acceptance {runId}",
		],
		cases: [
			{
				id: "fixture-read",
				title: "Fixture read/extract/selection",
				url: "http://127.0.0.1:8765/",
				prompt:
					"CHROME ACCEPTANCE FIXTURE READ {runId}: Use browser_get_visible_text, browser_extract_content, browser_get_viewport_headings, browser_get_scroll_state, and browser_get_selection on this page. Answer only a compact checklist with PASS/FAIL for each, include page title and the exact phrase Alpha smoke content if available, and do not include [object Object].",
				expected: [
					"PASS for visible text, extract content, headings, scroll state, and selection",
					"page title is Onhand Port Smoke Fixture",
					"answer includes Alpha smoke content",
					"answer does not include [object Object]",
				],
			},
			{
				id: "fixture-interact",
				title: "Fixture label/click interaction",
				url: "http://127.0.0.1:8765/",
				prompt:
					'CHROME ACCEPTANCE FIXTURE INTERACT {runId}: Use browser_type_by_label to replace Demo field with "chrome acceptance typed", then use browser_click_text to click Demo button, then use browser_run_js to return document.querySelector("#result")?.textContent. Answer only: CHROME_ACCEPTANCE_INTERACT <result>.',
				expected: ["answer is CHROME_ACCEPTANCE_INTERACT Demo button clicked"],
			},
			{
				id: "fixture-debug",
				title: "Fixture selector/debug ports",
				url: "http://127.0.0.1:8765/",
				prompt:
					'CHROME ACCEPTANCE FIXTURE DEBUG {runId}: Use browser_wait_for_selector for #cssButton, browser_click on selector #cssButton, browser_type on selector #cssInput with text "chrome selector typed" and clear true, browser_collect_console with expression console.log("chrome-acceptance-console-check"), browser_get_dom with maxChars 800, browser_capture_screenshot as png, and browser_run_js to return { cssInput: document.querySelector("#cssInput")?.value, bodyHasAlpha: document.body.innerText.includes("Alpha smoke content") }. Answer with a compact PASS/FAIL checklist and the JS result.',
				expected: [
					"PASS for wait, click, type, console, DOM, screenshot, and JS",
					"console output includes chrome-acceptance-console-check",
					"JS result has cssInput chrome selector typed and bodyHasAlpha true",
				],
			},
			{
				id: "fixture-artifact",
				title: "Fixture artifact persistence",
				url: "http://127.0.0.1:8765/",
				prompt:
					'CHROME ACCEPTANCE FIXTURE ARTIFACT {runId}: Use browser_capture_state with persist true, includeHtml true, includeScreenshot true, and label "chrome acceptance artifact {runId}". Then use browser_list_artifacts with query "chrome acceptance artifact". Answer only: CHROME_ACCEPTANCE_ARTIFACT <saved artifact id> - <page title>.',
				expected: [
					"answer starts with CHROME_ACCEPTANCE_ARTIFACT artifact_",
					"answer includes Onhand Port Smoke Fixture",
				],
			},
			{
				id: "fixture-network",
				title: "Fixture no-cache network reload",
				url: "http://127.0.0.1:8765/",
				prompt:
					'CHROME ACCEPTANCE FIXTURE NETWORK {runId}: Use browser_collect_network with reload true, ignoreCache true, durationMs 1500, maxEntries 12, onlyFailures false, and matchUrlContains "127.0.0.1:8765". Then use browser_click_text to click "Fetch fixture JSON". Then use browser_run_js to return { status: document.querySelector("#networkStatus")?.textContent ?? null }. Answer compact PASS/FAIL for browser_collect_network, browser_click_text, and browser_run_js; include one collected URL/status plus the JS result.',
				expected: [
					"PASS for network, click, and JS",
					"one collected URL is http://127.0.0.1:8765/ with status 200",
					"JS result status is Network loaded: fixture-json",
				],
			},
		],
	},
	"real-pages": {
		label: "Real page matrix",
		setup: [
			"reload the unpacked Chrome extension if the runtime bundle changed",
			"confirm extension options show authMode oauth, aiProvider openai-codex, and aiModel gpt-5.5",
			"start a fresh Onhand side-panel session named Chrome real-page acceptance {runId}",
			"run each case in Chrome, not Helium",
		],
		cases: [
			{
				id: "real-static-article",
				title: "Static article grounding",
				url: "https://en.wikipedia.org/wiki/Personal_computer",
				prompt:
					'CHROME ACCEPTANCE STATIC ARTICLE {runId}: Use browser_get_visible_text, browser_extract_content, browser_get_viewport_headings, and browser_get_selection on this page. Answer only a compact PASS/FAIL checklist; include the page title, whether "personal computer" appears, at least two visible headings, and do not include [object Object].',
				expected: [
					"PASS for visible text, extract content, headings, and selection",
					"page title identifies Personal computer",
					"answer includes personal computer",
					"answer does not include [object Object]",
				],
			},
			{
				id: "real-form-page",
				title: "App-like form interaction without submit",
				url: "https://the-internet.herokuapp.com/login",
				prompt:
					'CHROME ACCEPTANCE FORM PAGE {runId}: Use browser_wait_for_selector for #username, browser_type on selector #username with text "chrome_acceptance_user" and clear true, browser_type on selector #password with text "chrome_acceptance_pass" and clear true, browser_get_dom with maxChars 1200, and browser_run_js to return { username: document.querySelector("#username")?.value, passwordLength: document.querySelector("#password")?.value.length, hasLoginButton: !!document.querySelector("button[type=submit]") }. Do not submit the form. Answer with a compact PASS/FAIL checklist and the JS result.',
				expected: [
					"PASS for wait, username type, password type, DOM, and JS",
					"JS result username is chrome_acceptance_user",
					"JS result passwordLength is 22",
					"JS result hasLoginButton is true",
				],
			},
			{
				id: "real-client-routed-page",
				title: "Client-routed docs page with network reload",
				url: "https://react.dev/learn",
				prompt:
					'CHROME ACCEPTANCE ROUTED PAGE {runId}: Use browser_collect_network with reload true, ignoreCache true, durationMs 2000, maxEntries 20, onlyFailures false, and matchUrlContains "react.dev". Then use browser_get_viewport_headings, browser_get_dom with maxChars 1200, and browser_run_js to return { title: document.title, pathname: location.pathname, hasLearnContent: document.body.innerText.includes("Learn React") || document.body.innerText.includes("Quick Start") }. Answer compact PASS/FAIL for browser_collect_network, browser_get_viewport_headings, browser_get_dom, and browser_run_js; include one collected URL/status plus the JS result.',
				expected: [
					"PASS for network reload, headings, DOM, and JS",
					"one collected URL is on react.dev with a successful status",
					"JS result pathname is /learn",
					"JS result hasLearnContent is true",
				],
			},
		],
	},
};

function parseArgs(argv) {
	const args = {
		json: false,
		runId: DEFAULT_RUN_ID,
		suite: "all",
	};
	for (const value of argv) {
		if (value === "--json") {
			args.json = true;
			continue;
		}
		if (value.startsWith("--run-id=")) {
			args.runId = value.slice("--run-id=".length) || args.runId;
			continue;
		}
		if (value.startsWith("--suite=")) {
			args.suite = value.slice("--suite=".length) || args.suite;
			continue;
		}
		if (value === "--help" || value === "-h") {
			printHelp();
			process.exit(0);
		}
		throw new Error(`Unknown option: ${value}`);
	}
	return args;
}

function selectedSuites(name) {
	if (name === "all") return [suites.fixture, suites["real-pages"]];
	if (suites[name]) return [suites[name]];
	throw new Error(`Unknown suite: ${name}. Expected all, fixture, or real-pages.`);
}

function hydrate(value, runId) {
	return value.replaceAll("{runId}", runId);
}

function buildPlan(args) {
	return {
		runId: args.runId,
		suites: selectedSuites(args.suite).map((suite) => ({
			...suite,
			setup: suite.setup.map((line) => hydrate(line, args.runId)),
			cases: suite.cases.map((testCase) => ({
				...testCase,
				prompt: hydrate(testCase.prompt, args.runId),
				expected: testCase.expected.map((line) => hydrate(line, args.runId)),
			})),
		})),
	};
}

function printHelp() {
	console.log("Usage: npm run acceptance:chrome -- [--suite=all|fixture|real-pages] [--run-id=<id>] [--json]");
}

function printPlan(plan) {
	console.log(`# Chrome Acceptance Gate: ${plan.runId}`);
	console.log("");
	console.log("Use Chrome with the Codex Chrome Extension and OpenAI Codex OAuth. Record PASS/FAIL results in the PR or handoff.");
	for (const suite of plan.suites) {
		console.log("");
		console.log(`## ${suite.label}`);
		console.log("");
		console.log("Setup:");
		for (const line of suite.setup) console.log(`- ${line}`);
		for (const testCase of suite.cases) {
			console.log("");
			console.log(`### ${testCase.id}: ${testCase.title}`);
			console.log(`URL: ${testCase.url}`);
			console.log("");
			console.log("Prompt:");
			console.log(testCase.prompt);
			console.log("");
			console.log("Expected:");
			for (const line of testCase.expected) console.log(`- ${line}`);
		}
	}
}

const args = parseArgs(process.argv.slice(2));
const plan = buildPlan(args);

if (args.json) {
	console.log(JSON.stringify(plan, null, 2));
} else {
	printPlan(plan);
}
