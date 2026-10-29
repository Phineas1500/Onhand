import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { JSDOM } from "jsdom";

const PROJECT_ROOT = process.cwd();
const WEBSITE_DIR = join(PROJECT_ROOT, "website");

const EXPECTED_EVENTS = {
	chromeStoreEvent: "chrome_store_click",
	releaseDownloadEvent: "download_zip_click",
	githubSourceEvent: "github_source_click",
	sponsorEvent: "sponsor_click",
	demoVideoEvent: "demo_video_play",
	phoneShareEvent: "phone_share_click",
};
// Phones swap the store buttons for the share button, so desktop clicks never fire it.
const DESKTOP_EVENTS = Object.fromEntries(Object.entries(EXPECTED_EVENTS).filter(([key]) => key !== "phoneShareEvent"));
const PHONE_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const WEBSITE_PAGES = (await readdir(WEBSITE_DIR)).filter((name) => name.endsWith(".html"));

async function loadPage(fileName, { userAgent = "", share } = {}) {
	const html = await readFile(join(WEBSITE_DIR, fileName), "utf8");
	const dom = new JSDOM(html, {
		url: "https://useonhand.com/",
		runScripts: "outside-only",
	});
	const { window } = dom;
	if (userAgent) Object.defineProperty(window.navigator, "userAgent", { value: userAgent, configurable: true });
	if (share) window.navigator.share = share;
	const gaEvents = [];
	const umamiEvents = [];

	window.CSS = window.CSS || {};
	window.CSS.escape = window.CSS.escape || ((value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&"));
	window.HTMLElement.prototype.scrollTo = window.HTMLElement.prototype.scrollTo || (() => {});
	window.dataLayer = window.dataLayer || [];
	window.gtag = (...args) => {
		window.dataLayer.push(args);
		if (args[0] === "event") {
			gaEvents.push({ name: args[1], data: args[2] });
		}
	};
	window.umami = {
		track(name, data) {
			umamiEvents.push({ name, data });
		},
	};
	window.document.addEventListener(
		"click",
		(event) => {
			if (event.target?.closest?.("a[href]")) event.preventDefault();
		},
		{ capture: true },
	);

	window.eval(await readFile(join(WEBSITE_DIR, "site.js"), "utf8"));

	return { window, gaEvents, umamiEvents };
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function click(node, options = {}) {
	node.dispatchEvent(new node.ownerDocument.defaultView.MouseEvent("click", {
		bubbles: true,
		cancelable: true,
		button: 0,
		...options,
	}));
}

async function verifyIndexPage() {
	const { window, gaEvents, umamiEvents } = await loadPage("index.html");
	const { document } = window;

	assert(document.querySelectorAll("[data-onhand-store-link]").length >= 3, "index should wire Chrome Store CTAs");
	assert(document.querySelectorAll("[data-onhand-release-download]").length >= 1, "index should wire ZIP download CTA");
	assert(document.querySelectorAll("[data-onhand-source-link]").length >= 3, "index should wire GitHub source CTAs");
	assert(document.querySelectorAll("[data-onhand-sponsor-link]").length >= 1, "index should wire GitHub Sponsors CTA");

	click(document.querySelector("[data-onhand-store-link]"));
	click(document.querySelector("[data-onhand-release-download]"), { ctrlKey: true });
	click(document.querySelector("[data-onhand-source-link]"));
	click(document.querySelector("[data-onhand-sponsor-link]"));
	click(document.querySelector("[data-onhand-video]"));

	for (const eventName of Object.values(DESKTOP_EVENTS)) {
		assert(
			gaEvents.some((event) => event.name === eventName),
			`GA should receive ${eventName}`,
		);
		assert(
			umamiEvents.some((event) => event.name === eventName),
			`Umami should receive ${eventName}`,
		);
	}

	const storeEvent = gaEvents.find((event) => event.name === EXPECTED_EVENTS.chromeStoreEvent);
	assert(storeEvent.data.event_category === "install", "chrome_store_click should use install category");

	const zipEvent = gaEvents.find((event) => event.name === EXPECTED_EVENTS.releaseDownloadEvent);
	assert(zipEvent.data.event_category === "release", "download_zip_click should use release category");
	assert(zipEvent.data.file_name.includes(".zip"), "download_zip_click should include ZIP filename");

	const sourceEvent = gaEvents.find((event) => event.name === EXPECTED_EVENTS.githubSourceEvent);
	assert(sourceEvent.data.event_category === "source", "github_source_click should use source category");
	assert(sourceEvent.data.link_url.includes("github.com"), "github_source_click should include repo URL");

	const sponsorEvent = gaEvents.find((event) => event.name === EXPECTED_EVENTS.sponsorEvent);
	assert(sponsorEvent.data.event_category === "support", "sponsor_click should use support category");
	assert(sponsorEvent.data.link_url.includes("github.com/sponsors"), "sponsor_click should include Sponsors URL");

	const videoEvent = gaEvents.find((event) => event.name === EXPECTED_EVENTS.demoVideoEvent);
	assert(videoEvent.data.event_category === "video", "demo_video_play should use video category");
	const player = document.querySelector("#demo-video iframe");
	assert(player?.src.startsWith("https://www.youtube-nocookie.com/embed/"), "pressing play should load the youtube-nocookie player");
	assert(!document.querySelector("[data-onhand-video]"), "the preview link should be replaced by the player");
}

async function verifyPhonePages() {
	for (const fileName of ["index.html", "chatpdf-alternative.html"]) {
		const shares = [];
		const { window, gaEvents, umamiEvents } = await loadPage(fileName, {
			userAgent: PHONE_USER_AGENT,
			share: async (data) => { shares.push(data); },
		});
		const { document } = window;
		const buttons = [...document.querySelectorAll("[data-onhand-send-to-computer]")];
		assert(buttons.length >= 2, `${fileName} should turn its install buttons into send-to-computer buttons on phones`);
		assert(buttons.every((node) => node.href.startsWith("mailto:") && !node.target), `${fileName} phone buttons should fall back to an email draft`);
		assert(!buttons.some((node) => /Add to Chrome/.test(node.textContent)), `${fileName} phone buttons should not say Add to Chrome`);
		assert(document.querySelector(".hero-ctas + .handheld-note"), `${fileName} should explain why phones get a link`);

		click(document.querySelector(".hero-ctas [data-onhand-send-to-computer]"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert(shares.length === 1 && shares[0].url.includes("utm_source=phone"), `${fileName} should share the tagged site link`);
		const event = gaEvents.find((entry) => entry.name === EXPECTED_EVENTS.phoneShareEvent);
		assert(event?.data.result === "shared" && event.data.event_category === "install", `${fileName} should record a shared phone_share_click`);
		assert(umamiEvents.some((entry) => entry.name === EXPECTED_EVENTS.phoneShareEvent), `${fileName} should send phone_share_click to Umami`);
		assert(!gaEvents.some((entry) => entry.name === EXPECTED_EVENTS.chromeStoreEvent), `${fileName} phone buttons should not count as store clicks`);
	}

	// A closed share sheet is not a failure: no email draft opens.
	const { window, gaEvents } = await loadPage("index.html", {
		userAgent: PHONE_USER_AGENT,
		share: async () => { throw new window.DOMException("closed", "AbortError"); },
	});
	click(window.document.querySelector(".hero-ctas [data-onhand-send-to-computer]"));
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert(gaEvents.find((entry) => entry.name === EXPECTED_EVENTS.phoneShareEvent)?.data.result === "cancelled", "a closed share sheet should record cancelled");
	assert(window.location.href === "https://useonhand.com/", "a closed share sheet should not open an email draft");

	// Chromebooks install extensions: keep the store buttons.
	const chromebook = await loadPage("index.html", { userAgent: "Mozilla/5.0 (X11; CrOS x86_64 15000.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36" });
	assert(!chromebook.window.document.querySelector("[data-onhand-send-to-computer]"), "Chromebooks should keep the Add to Chrome buttons");
}

async function verifySupportPage() {
	const { window, gaEvents, umamiEvents } = await loadPage("support.html");
	const { document } = window;

	assert(document.querySelector("[data-onhand-release-download]"), "support should wire ZIP download CTA");
	assert(document.querySelector("[data-onhand-source-link]"), "support should wire GitHub source CTA");
	assert(document.querySelector("[data-onhand-sponsor-link]"), "support should wire GitHub Sponsors CTA");

	click(document.querySelector("[data-onhand-release-download]"), { ctrlKey: true });
	click(document.querySelector("[data-onhand-source-link]"));
	click(document.querySelector("[data-onhand-sponsor-link]"));

	assert(
		gaEvents.some((event) => event.name === EXPECTED_EVENTS.releaseDownloadEvent),
		"support ZIP CTA should fire download_zip_click",
	);
	assert(
		umamiEvents.some((event) => event.name === EXPECTED_EVENTS.githubSourceEvent),
		"support GitHub CTA should fire github_source_click",
	);
	assert(
		gaEvents.some((event) => event.name === EXPECTED_EVENTS.sponsorEvent),
		"support Sponsor CTA should fire sponsor_click",
	);
	assert(
		umamiEvents.some((event) => event.name === EXPECTED_EVENTS.sponsorEvent),
		"support Sponsor CTA should fire sponsor_click in Umami",
	);
}

async function verifyEventNamesDocumented() {
	const readme = await readFile(join(WEBSITE_DIR, "README.md"), "utf8");
	const siteJs = await readFile(join(WEBSITE_DIR, "site.js"), "utf8");

	for (const [key, eventName] of Object.entries(EXPECTED_EVENTS)) {
		assert(siteJs.includes(`${key}: '${eventName}'`), `site.js should define ${key}`);
		assert(readme.includes(eventName), `README should document ${eventName}`);
	}
}

async function verifyAnalyticsScriptTags() {
	for (const fileName of WEBSITE_PAGES) {
		const html = await readFile(join(WEBSITE_DIR, fileName), "utf8");
		const dom = new JSDOM(html);
		const scripts = [...dom.window.document.querySelectorAll("script")];
		const inlineScripts = scripts.map((script) => script.textContent || "");
		const scriptSources = scripts.map((script) => script.getAttribute("src") || "");

		assert(
			inlineScripts.some((script) => /window\.si\s*=/.test(script)),
			`${fileName} should initialize Vercel Speed Insights inside a script tag`,
		);
		assert(
			scriptSources.includes("/_vercel/speed-insights/script.js"),
			`${fileName} should load Vercel Speed Insights script`,
		);
		assert(
			inlineScripts.some((script) => /window\.va\s*=/.test(script)),
			`${fileName} should initialize Vercel Analytics inside a script tag`,
		);
		assert(
			scriptSources.includes("/_vercel/insights/script.js"),
			`${fileName} should load Vercel Analytics script`,
		);
	}
}

async function main() {
	await verifyAnalyticsScriptTags();
	await verifyEventNamesDocumented();
	await verifyIndexPage();
	await verifyPhonePages();
	await verifySupportPage();
	console.log("website analytics verification passed");
	console.log(`events: ${Object.values(EXPECTED_EVENTS).join(", ")}`);
}

main().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
