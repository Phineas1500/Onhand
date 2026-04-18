import { basename, resolve } from "node:path";

const PROJECT_ROOT = resolve(new URL("..", import.meta.url).pathname);

const PRIMARY_FIXTURES = [
	{
		id: "donald_trump",
		title: "Donald Trump Wikipedia",
		category: "Long article with infobox and dense body",
		url: "https://en.wikipedia.org/wiki/Donald_Trump",
		why: [
			"strong deep-causal explanation fixture",
			"good infobox and note-placement stress case",
			"good for multi-claim evidence selection and inline citations",
		],
		prompts: [
			"how did he win the 2024 election after losing in 2020?",
			"what changed between 2020 and 2024?",
			"use the page to support each major claim",
		],
		risks: [
			"note overlap with infobox",
			"unsupported explanation vs page-backed grounding",
			"multi-highlight and multi-note behavior",
			"current-turn reply rendering",
		],
	},
	{
		id: "shah_rukh_khan",
		title: "Shah Rukh Khan Wikipedia",
		category: "Article with infobox and narrow content column",
		url: "https://en.wikipedia.org/wiki/Shah_Rukh_Khan",
		why: [
			"best note width and wrapping stressor from prior sessions",
			"quickly exposes oversized notes and bad placement",
		],
		prompts: [
			"why did he become such a big star?",
			"what on this page best explains his rise?",
		],
		risks: [
			"note width and wrapping",
			"highlight selection quality",
			"answer-to-evidence proportionality",
		],
	},
	{
		id: "bayesian_dl",
		title: "Purdue BayesianDL Notes",
		category: "STEM notes page with math content",
		url: "https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/06BayesianDL/BayesianDL.html",
		why: [
			"strong math and LaTeX rendering fixture",
			"good Learning Mode and technical explanation fixture",
		],
		prompts: [
			"explain this section step by step",
			"what is the key intuition here?",
			"teach this in learning mode",
		],
		risks: [
			"markdown and LaTeX rendering in the side panel",
			"Learning Mode behavior",
			"STEM readability",
		],
	},
	{
		id: "sets",
		title: "Purdue Sets Notes",
		category: "Structured course notes page",
		url: "https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/12sets/sets.html",
		why: [
			"used in the observed learning-mode failure case",
			"good for connecting notes to an open homework PDF or nearby tabs",
		],
		prompts: [
			"use the notes I have open to help me understand how to solve this problem",
			"what prerequisite should I read first?",
			"explain the misconception behind this question",
		],
		risks: [
			"Learning Mode scaffolding",
			"reasoning-to-final-reply handoff",
			"multi-source tutoring behavior",
		],
	},
	{
		id: "cnns",
		title: "Purdue CNN Notes",
		category: "Jupyter-like technical page with rich DOM",
		url: "https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/07cnn/CNNs.html",
		why: [
			"good nested-list and notebook-like DOM anchoring stressor",
			"useful for annotation placement on technical content",
		],
		prompts: [
			"explain this CNN filter step",
			"why does the next layer have different channels?",
		],
		risks: [
			"annotation anchoring on notebook-style pages",
			"scrolling to annotations in long technical content",
		],
	},
	{
		id: "practice_midterm_pdf",
		title: "Practice Midterm PDF",
		category: "Stable PDF fixture",
		url: "https://cdn-uploads.piazza.com/paste/iiw7c9aoSkA/0df25398a27137b9c250be0fd7b5bce3f8bcc6425fde1b25403799364c9cd8ba/practice_midterm_2025.pdf",
		why: [
			"stable PDF-based tutoring fixture",
			"good for side panel behavior against the native PDF viewer",
		],
		prompts: [
			"use my notes to help me understand how to solve this problem",
			"what page should I read first to solve this?",
			"explain this problem setup",
		],
		risks: [
			"PDF side panel behavior",
			"switching between HTML notes and a PDF tab",
			"PDF-grounded tutoring flows",
		],
	},
	{
		id: "onhand_github_repo",
		title: "Onhand GitHub Repository",
		category: "Repository landing page with README and code-navigation chrome",
		url: "https://github.com/Phineas1500/Onhand",
		why: [
			"tests repo README grounding outside article and lecture-page layouts",
			"good for code-adjacent explanation, structure summaries, and citation placement around GitHub chrome",
		],
		prompts: [
			"what is this repo for and what are the main components?",
			"explain the structure of this repo from the README and page content",
		],
		risks: [
			"grounding on code/docs hosting UIs rather than article prose",
			"note and highlight placement around sticky repository chrome",
			"README extraction quality",
		],
	},
	{
		id: "anthropic_job_posting",
		title: "Anthropic Greenhouse Job Posting",
		category: "Public job/application page with sticky CTA and structured sections",
		url: "https://job-boards.greenhouse.io/anthropic/jobs/5183006008",
		why: [
			"tests structured commercial/public pages outside docs and articles",
			"good for sticky CTA overlap, long-form summaries, and section-based grounding",
		],
		prompts: [
			"what does this role emphasize most?",
			"what on this page would matter most to an applicant?",
		],
		risks: [
			"annotation placement near sticky apply controls",
			"grounding on sectioned marketing/careers pages",
			"answer proportionality on non-encyclopedic pages",
		],
	},
	{
		id: "reddit_thread",
		title: "Reddit Thread",
		category: "Dynamic social thread with comments and vote chrome",
		url: "https://www.reddit.com/r/BollyBlindsNGossip/comments/1snxrpq/neetu_kapoors_daadi_ki_shaadi_marks_the_acting/?share_id=BmNSk4KruTDDdJXlGn5yc&utm_medium=ios_app&utm_name=ioscss&utm_source=share&utm_term=1",
		why: [
			"tests social/threaded content with nested comments and changing page chrome",
			"good for checking grounding on discussions rather than polished prose",
		],
		prompts: [
			"what are the main reactions in this thread?",
			"summarize the dominant viewpoints on this page",
		],
		risks: [
			"highlighting/comment grounding in dynamic thread UIs",
			"reply citations on noisy conversational content",
			"annotation placement near interactive social controls",
		],
	},
];

const SECONDARY_FIXTURES = [
	{
		id: "personal_computer",
		title: "Personal Computer Wikipedia",
		url: "https://en.wikipedia.org/wiki/Personal_computer",
		bestFor: "multi-highlight factual comparison without heavy political content",
	},
	{
		id: "steve_wozniak",
		title: "Steve Wozniak Wikipedia",
		url: "https://en.wikipedia.org/wiki/Steve_Wozniak",
		bestFor: "how-much-did-X-contribute questions and deeper-section lookup",
	},
	{
		id: "graph_representations",
		title: "Purdue Graph Representations Notes",
		url: "https://www.cs.purdue.edu/homes/ribeirob/courses/Spring2026/lectures/13GNNs/Graph_Representations_part1.html",
		bestFor: "cross-tab technical synthesis with other Purdue notes",
	},
];

const SCENARIO_MAP = {
	sidepanel_ui: {
		label: "Side panel / annotation UI regressions",
		fixtures: ["donald_trump", "shah_rukh_khan"],
	},
	learning_mode: {
		label: "Learning Mode / tutoring regressions",
		fixtures: ["sets", "bayesian_dl", "practice_midterm_pdf"],
	},
	dom_anchoring: {
		label: "DOM anchoring regressions",
		fixtures: ["cnns", "onhand_github_repo"],
	},
	pdf: {
		label: "PDF behavior regressions",
		fixtures: ["practice_midterm_pdf"],
	},
	multi_tab: {
		label: "Multi-tab synthesis regressions",
		fixtures: ["sets", "bayesian_dl", "cnns", "practice_midterm_pdf"],
	},
	repo_docs: {
		label: "Repository and docs-hosting page regressions",
		fixtures: ["onhand_github_repo"],
	},
	sticky_cta: {
		label: "Sticky CTA / structured public page regressions",
		fixtures: ["anthropic_job_posting"],
	},
	social_threads: {
		label: "Dynamic social-thread regressions",
		fixtures: ["reddit_thread"],
	},
};

const STANDARD_PROMPTS = [
	"why did he become such a big star?",
	"how did he win the 2024 election after losing in 2020?",
	"use the notes I have open to help me understand how to solve this problem",
	"teach this in learning mode",
	"what prerequisite concept should I read first?",
	"compare what these two tabs are saying",
	"what is this repo for and what are the main components?",
	"what does this role emphasize most?",
	"what are the main reactions in this thread?",
];

function parseArgs(argv) {
	const args = {
		json: false,
		filter: "",
	};

	for (const value of argv) {
		if (value === "--json") {
			args.json = true;
			continue;
		}
		if (!args.filter) {
			args.filter = String(value || "").trim().toLowerCase();
		}
	}

	return args;
}

function fixtureMatches(fixture, filter) {
	if (!filter) return true;
	const haystack = [
		fixture.id,
		fixture.title,
		fixture.category,
		fixture.url,
		...(fixture.why || []),
		...(fixture.prompts || []),
		...(fixture.risks || []),
		fixture.bestFor || "",
	]
		.join("\n")
		.toLowerCase();
	return haystack.includes(filter);
}

function pickFixtureMap() {
	return new Map([...PRIMARY_FIXTURES, ...SECONDARY_FIXTURES].map((fixture) => [fixture.id, fixture]));
}

function buildReport(filter) {
	const primaryFixtures = PRIMARY_FIXTURES.filter((fixture) => fixtureMatches(fixture, filter));
	const secondaryFixtures = SECONDARY_FIXTURES.filter((fixture) => fixtureMatches(fixture, filter));
	const fixtureMap = pickFixtureMap();
	const scenarios = Object.entries(SCENARIO_MAP)
		.map(([id, scenario]) => ({
			id,
			label: scenario.label,
			fixtures: scenario.fixtures
				.map((fixtureId) => fixtureMap.get(fixtureId))
				.filter(Boolean)
				.filter((fixture) => fixtureMatches(fixture, filter)),
		}))
		.filter((scenario) => scenario.fixtures.length > 0);

	return {
		projectRoot: PROJECT_ROOT,
		document: "docs/TEST_FIXTURES.md",
		filter: filter || null,
		primaryFixtures,
		secondaryFixtures,
		scenarios,
		standardPrompts: STANDARD_PROMPTS.filter((prompt) => !filter || prompt.toLowerCase().includes(filter)),
	};
}

function printFixtureDetails(fixture) {
	console.log(`- ${fixture.title}`);
	console.log(`  ID: ${fixture.id}`);
	if (fixture.category) console.log(`  Category: ${fixture.category}`);
	console.log(`  URL: ${fixture.url}`);
	if (Array.isArray(fixture.why) && fixture.why.length) {
		console.log("  Why:");
		for (const item of fixture.why) console.log(`    - ${item}`);
	}
	if (Array.isArray(fixture.prompts) && fixture.prompts.length) {
		console.log("  Best prompts:");
		for (const item of fixture.prompts) console.log(`    - ${item}`);
	}
	if (Array.isArray(fixture.risks) && fixture.risks.length) {
		console.log("  Risks covered:");
		for (const item of fixture.risks) console.log(`    - ${item}`);
	}
	if (fixture.bestFor) {
		console.log(`  Best for: ${fixture.bestFor}`);
	}
}

function printHumanReadable(report) {
	console.log(`Fixture document: ${resolve(PROJECT_ROOT, report.document)}`);
	if (report.filter) {
		console.log(`Filter: ${report.filter}`);
	}
	console.log("");

	console.log("Primary fixtures:");
	if (!report.primaryFixtures.length) {
		console.log("- (none matched)");
	} else {
		for (const fixture of report.primaryFixtures) {
			printFixtureDetails(fixture);
			console.log("");
		}
	}

	console.log("Secondary fixtures:");
	if (!report.secondaryFixtures.length) {
		console.log("- (none matched)");
	} else {
		for (const fixture of report.secondaryFixtures) {
			printFixtureDetails(fixture);
			console.log("");
		}
	}

	console.log("Scenario map:");
	if (!report.scenarios.length) {
		console.log("- (none matched)");
	} else {
		for (const scenario of report.scenarios) {
			const names = scenario.fixtures.map((fixture) => fixture.title).join(", ");
			console.log(`- ${scenario.label}: ${names}`);
		}
	}

	console.log("");
	console.log("Standard prompts:");
	if (!report.standardPrompts.length) {
		console.log("- (none matched)");
	} else {
		for (const prompt of report.standardPrompts) {
			console.log(`- ${prompt}`);
		}
	}

	console.log("");
	const filteredExample = report.filter ? `npm run test:fixtures -- ${report.filter}` : "npm run test:fixtures";
	console.log(`Tip: run "${filteredExample}" or use "node ./scripts/show-test-fixtures.mjs --json" for machine-readable output.`);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const report = buildReport(args.filter);
	if (args.json) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}
	printHumanReadable(report);
}

await main();
