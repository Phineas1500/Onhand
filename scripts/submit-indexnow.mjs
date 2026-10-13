#!/usr/bin/env node

// Tells IndexNow (Bing, which ChatGPT search and Copilot draw on) which
// website pages changed, once the live site serves the new versions.
//
//   node scripts/submit-indexnow.mjs <before-sha> <after-sha>  pages changed between two commits
//   node scripts/submit-indexnow.mjs --all                     every page in sitemap.xml
//
// Add --dry-run to wait for the live pages and print the URLs without submitting.

import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const WEBSITE_DIR = join(process.cwd(), "website");
const SITE_URL = "https://useonhand.com/";
const INDEXNOW_URL = "https://api.indexnow.org/indexnow";
const LIVE_TIMEOUT_MS = 10 * 60 * 1000;
const LIVE_POLL_MS = 15 * 1000;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [before, after] = args.filter((arg) => !arg.startsWith("--"));

const pageUrl = (fileName) => (fileName === "index.html" ? SITE_URL : new URL(fileName, SITE_URL).href);
const fileName = (url) => (url === SITE_URL ? "index.html" : url.slice(SITE_URL.length));
const git = (...gitArgs) => execFileSync("git", gitArgs, { encoding: "utf8" });

const keyFiles = (await readdir(WEBSITE_DIR)).filter((name) => /^[0-9a-f]{32}\.txt$/.test(name));
if (keyFiles.length !== 1) throw new Error(`expected one IndexNow key file in website/, found ${keyFiles.length}`);
const key = keyFiles[0].slice(0, -".txt".length);
if ((await readFile(join(WEBSITE_DIR, keyFiles[0]), "utf8")).trim() !== key) throw new Error(`${keyFiles[0]} must contain its own key`);

const sitemap = await readFile(join(WEBSITE_DIR, "sitemap.xml"), "utf8");
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);

function changedPages() {
	if (!after) throw new Error("usage: submit-indexnow.mjs <before-sha> <after-sha> | --all [--dry-run]");
	// A new branch or a force push leaves no usable "before" commit, so fall back to the last commit alone.
	let range = `${before}..${after}`;
	try {
		execFileSync("git", ["cat-file", "-e", `${before}^{commit}`], { stdio: "ignore" });
	} catch {
		range = `${after}^..${after}`;
	}
	return git("diff", "--name-only", "--diff-filter=AMR", range, "--", "website/")
		.split("\n")
		.filter((path) => /^website\/[^/]+\.html$/.test(path))
		.map((path) => pageUrl(path.slice("website/".length)));
}

async function waitUntilLive(url) {
	const expected = await readFile(join(WEBSITE_DIR, fileName(url)), "utf8");
	const deadline = Date.now() + LIVE_TIMEOUT_MS;
	for (;;) {
		const response = await fetch(url, { cache: "no-store" }).catch(() => null);
		if (response?.ok && (await response.text()) === expected) return true;
		if (Date.now() > deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, LIVE_POLL_MS));
	}
}

const urls = (args.includes("--all") ? sitemapUrls : changedPages()).filter((url) => sitemapUrls.includes(url));
if (!urls.length) {
	console.log("No changed pages in sitemap.xml to submit.");
	process.exit(0);
}

for (const url of urls) {
	// A later push can replace a page before this one goes live; submit anyway, since Bing crawls the current version.
	if (!(await waitUntilLive(url))) console.warn(`warning: ${url} did not match the local file within 10 minutes; submitting anyway`);
}

console.log(`${dryRun ? "Would submit" : "Submitting"} ${urls.length} page(s) to IndexNow:\n${urls.join("\n")}`);
if (dryRun) process.exit(0);

const response = await fetch(INDEXNOW_URL, {
	method: "POST",
	headers: { "Content-Type": "application/json; charset=utf-8" },
	body: JSON.stringify({ host: new URL(SITE_URL).host, key, keyLocation: `${SITE_URL}${key}.txt`, urlList: urls }),
});
// 200 means accepted; 202 means accepted while IndexNow checks the key file.
if (response.status !== 200 && response.status !== 202) {
	throw new Error(`IndexNow returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
}
console.log(`IndexNow accepted the submission (HTTP ${response.status}).`);
