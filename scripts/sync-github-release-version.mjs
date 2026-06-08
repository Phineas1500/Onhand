#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const DEFAULT_REPO = "Phineas1500/Onhand";
const SITE_JS_URL = new URL("../website/site.js", import.meta.url);
const HTML_URLS = [
	new URL("../website/index.html", import.meta.url),
	new URL("../website/support.html", import.meta.url),
];
const CHECK_ONLY = process.argv.includes("--check");

function normalizeVersion(version) {
	return String(version || "").trim().replace(/^v/i, "");
}

async function fetchLatestReleaseVersion(repo) {
	const headers = {
		"Accept": "application/vnd.github+json",
		"User-Agent": "OnhandGitHubReleaseVersionSync/1.0",
	};
	if (process.env.GITHUB_TOKEN) {
		headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
	}

	const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
	if (!response.ok) {
		throw new Error(`GitHub latest release check failed: HTTP ${response.status}`);
	}

	const release = await response.json();
	const version = normalizeVersion(release?.tag_name);
	if (!version) {
		throw new Error("GitHub latest release response did not include a tag_name");
	}

	return version;
}

function readReleaseVersion(source) {
	const match = source.match(/version:\s*'([^']+)'/);
	if (!match) {
		throw new Error("Could not find ONHAND_RELEASE.version in website/site.js");
	}
	return normalizeVersion(match[1]);
}

function writeReleaseVersion(source, version) {
	return source.replace(/version:\s*'[^']*'/, `version: '${version}'`);
}

function writeScriptCacheVersion(source, version) {
	return source.replace(/site\.js\?v=[^"]*-release/g, `site.js?v=${version}-release`);
}

async function main() {
	const repo = process.env.ONHAND_GITHUB_REPO || DEFAULT_REPO;
	const githubVersion = await fetchLatestReleaseVersion(repo);
	const source = await readFile(SITE_JS_URL, "utf8");
	const siteVersion = readReleaseVersion(source);
	const htmlEntries = await Promise.all(HTML_URLS.map(async (url) => {
		const source = await readFile(url, "utf8");
		const updated = writeScriptCacheVersion(source, githubVersion);
		return { url, source, updated };
	}));
	const staleHtml = htmlEntries.filter((entry) => entry.source !== entry.updated);

	if (CHECK_ONLY) {
		if (siteVersion !== githubVersion) {
			throw new Error(`website/site.js says ${siteVersion}, but GitHub latest release is ${githubVersion}`);
		}
		if (staleHtml.length > 0) {
			throw new Error("website HTML still has stale site.js release-version cache busters");
		}
		console.log(`website/site.js is in sync with GitHub release v${githubVersion}`);
		return;
	}

	if (siteVersion === githubVersion && staleHtml.length === 0) {
		console.log(`website files already use GitHub release v${githubVersion}`);
		return;
	}

	if (siteVersion !== githubVersion) {
		await writeFile(SITE_JS_URL, writeReleaseVersion(source, githubVersion));
	}
	await Promise.all(staleHtml.map((entry) => writeFile(entry.url, entry.updated)));
	console.log(`Updated website files from v${siteVersion} to v${githubVersion}`);
}

main().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
