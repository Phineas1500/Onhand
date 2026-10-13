#!/usr/bin/env node

// Checks the website's search metadata: every indexable page has a canonical
// URL and a sitemap entry, robots.txt points at the sitemap, and the
// homepage's FAQPage structured data matches the visible FAQ word for word.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { JSDOM } from "jsdom";

const WEBSITE_DIR = join(process.cwd(), "website");
const SITE_URL = "https://useonhand.com/";
const NOT_INDEXED = new Set(["404.html"]);

const squash = (value) => String(value || "").replace(/\s+/g, " ").trim();
const pageUrl = (fileName) => (fileName === "index.html" ? SITE_URL : new URL(fileName, SITE_URL).href);

const pages = (await readdir(WEBSITE_DIR)).filter((name) => name.endsWith(".html") && !NOT_INDEXED.has(name));
const sitemap = await readFile(join(WEBSITE_DIR, "sitemap.xml"), "utf8");
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);
const robots = await readFile(join(WEBSITE_DIR, "robots.txt"), "utf8");
assert.match(robots, new RegExp(`^Sitemap: ${SITE_URL}sitemap\\.xml$`, "m"), "robots.txt should point at the sitemap");

const indexed = [];
for (const fileName of pages) {
	const { document } = new JSDOM(await readFile(join(WEBSITE_DIR, fileName), "utf8")).window;
	if (/noindex/i.test(document.querySelector('meta[name="robots"]')?.content || "")) {
		assert.ok(!sitemapUrls.includes(pageUrl(fileName)), `${fileName} is noindex but listed in sitemap.xml`);
		continue;
	}
	indexed.push(pageUrl(fileName));
	assert.equal(document.querySelector('link[rel="canonical"]')?.href, pageUrl(fileName), `${fileName} needs a canonical link to itself`);
	assert.ok(sitemapUrls.includes(pageUrl(fileName)), `${fileName} is missing from sitemap.xml`);
	assert.ok(squash(document.querySelector('meta[name="description"]')?.content), `${fileName} needs a meta description`);

	for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
		const data = JSON.parse(script.textContent);
		const faq = (data["@graph"] || [data]).find((node) => node["@type"] === "FAQPage");
		if (!faq) continue;
		const visible = [...document.querySelectorAll(".faq-item")].map((item) => {
			const answer = item.querySelector("p").cloneNode(true);
			answer.querySelectorAll("a").forEach((link) => link.remove());
			return { name: squash(item.querySelector("h3").textContent), text: squash(answer.textContent) };
		});
		const structured = faq.mainEntity.map((question) => ({ name: question.name, text: question.acceptedAnswer.text }));
		assert.deepEqual(structured, visible, `${fileName} FAQPage structured data must match the visible FAQ`);
	}
}
for (const url of sitemapUrls) assert.ok(indexed.includes(url), `sitemap.xml lists ${url}, which is not an indexable page`);

console.log(`website SEO metadata ok: ${indexed.length} indexable pages`);
