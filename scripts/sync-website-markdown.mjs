#!/usr/bin/env node

// Writes a Markdown copy of every website page next to its HTML
// (index.html -> index.md). website/vercel.json serves the copy when a request
// asks for text/markdown, so AI agents get the page's text without the layout,
// scripts and interactive demo. Run with --check to fail when a page changed
// without its Markdown being regenerated.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const DEFAULT_ROOT = process.cwd();
const SITE_URL = "https://useonhand.com/";
// The not-found page has nothing an agent would ask for by name.
const SKIPPED_PAGES = new Set(["404.html"]);
const LATEST_RELEASE_URL = "https://github.com/Phineas1500/Onhand/releases/latest";

// Not page content: chrome around it, the homepage's scripted demo panel,
// decorative manicules and icons, section eyebrows, captions, and anything the
// page itself keeps hidden.
const REMOVE_SELECTOR = [
	"script",
	"style",
	"noscript",
	"template",
	"svg",
	"nav",
	"button",
	"[hidden]",
	"[aria-hidden='true']",
	"section.shot",
	".mc",
	".big-mc",
	".ico",
	".section-eyebrow",
	".shot-cap",
	".code-block > .head",
].join(", ");

export function markdownFileName(htmlFileName) {
	return htmlFileName.replace(/\.html$/, ".md");
}

function pageUrl(htmlFileName) {
	return htmlFileName === "index.html" ? SITE_URL : new URL(htmlFileName, SITE_URL).href;
}

function frontMatterValue(value) {
	return JSON.stringify(String(value || "").replace(/\s+/g, " ").trim());
}

function createTurndown() {
	const turndown = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		bulletListMarker: "-",
		emDelimiter: "*",
	});
	turndown.use(gfm);
	return turndown;
}

export function renderPageMarkdown(html, pageUrl, turndown = createTurndown()) {
	const { document } = new JSDOM(html, { url: pageUrl }).window;
	const title = document.querySelector("title")?.textContent;
	const description = document.querySelector('meta[name="description"]')?.content;

	for (const element of document.querySelectorAll(REMOVE_SELECTOR)) element.remove();
	// site.js fills these in the browser; give agents stable text instead.
	for (const element of document.querySelectorAll("[data-onhand-store-version]")) element.textContent = "the latest version";
	for (const link of document.querySelectorAll("[data-onhand-release-download], [data-onhand-release-notes]")) {
		link.setAttribute("href", LATEST_RELEASE_URL);
	}
	for (const link of document.querySelectorAll("[data-onhand-video]")) {
		const label = link.getAttribute("data-onhand-video-title") || "Watch the demo video";
		link.textContent = `Watch the demo video: ${label}`;
	}
	for (const link of document.querySelectorAll("a[href]")) {
		const href = link.getAttribute("href");
		if (!href || href === "#") link.removeAttribute("href");
		else link.setAttribute("href", link.href);
	}
	for (const image of document.querySelectorAll("img[src]")) image.setAttribute("src", image.src);
	// Turndown fences only <pre><code>; the terminal block styles spans in a bare <pre>.
	for (const pre of document.querySelectorAll("pre")) {
		if (pre.querySelector("code")) continue;
		const code = document.createElement("code");
		code.textContent = pre.textContent;
		pre.replaceChildren(code);
	}

	const body = document.querySelector("main") || document.body;
	const footer = document.querySelector("body > footer");
	const content = [body, footer && body !== document.body ? footer : null]
		.filter(Boolean)
		.map((element) => turndown.turndown(element.innerHTML))
		.join("\n\n");

	return [
		"---",
		`title: ${frontMatterValue(title)}`,
		`description: ${frontMatterValue(description)}`,
		`url: ${pageUrl}`,
		"---",
		"",
		content
			// Tool-category headings lead with an icon glyph (⌕, ✎, ◔).
			.replace(/^(#{1,6}) [^\p{L}\p{N}\s*[_`]+\s+/gmu, "$1 ")
			.replace(/\n{3,}/g, "\n\n")
			.trim(),
		"",
	].join("\n");
}

export async function syncWebsiteMarkdown({ root = DEFAULT_ROOT, check = false } = {}) {
	const websiteDir = join(root, "website");
	const pages = (await readdir(websiteDir)).filter((name) => name.endsWith(".html") && !SKIPPED_PAGES.has(name)).sort();
	const turndown = createTurndown();
	const stale = [];
	for (const fileName of pages) {
		const html = await readFile(join(websiteDir, fileName), "utf8");
		const next = renderPageMarkdown(html, pageUrl(fileName), turndown);
		const markdownPath = join(websiteDir, markdownFileName(fileName));
		const current = await readFile(markdownPath, "utf8").catch(() => null);
		if (current === next) continue;
		stale.push(markdownFileName(fileName));
		if (!check) await writeFile(markdownPath, next, "utf8");
	}
	if (check && stale.length) {
		throw new Error(`Markdown copies are out of date: ${stale.join(", ")}. Run npm run website:sync-markdown.`);
	}
	return { pages: pages.length, changed: stale };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const check = process.argv.includes("--check");
	syncWebsiteMarkdown({ check }).then((result) => {
		const verb = check ? "Checked" : result.changed.length ? `Updated ${result.changed.length} of` : "Already current:";
		console.log(`${verb} ${result.pages} Markdown page copies.`);
	}).catch((error) => {
		console.error(error?.stack || error?.message || String(error));
		process.exitCode = 1;
	});
}
