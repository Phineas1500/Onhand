#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const DEFAULT_STORE_ID = "ogjmncmkpgdkkcibdiacmagaehjohljb";
const SITE_JS_URL = new URL("../website/site.js", import.meta.url);
const HTML_URLS = [
	new URL("../website/index.html", import.meta.url),
	new URL("../website/support.html", import.meta.url),
];
const CHECK_ONLY = process.argv.includes("--check");

function updateUrlFor(storeId) {
	return `https://clients2.google.com/service/update2/crx?response=updatecheck&prodversion=138.0.0.0&acceptformat=crx2,crx3&x=id%3D${encodeURIComponent(storeId)}%26uc`;
}

async function fetchStoreVersion(storeId) {
	const response = await fetch(updateUrlFor(storeId), {
		headers: {
			"User-Agent": "OnhandStoreVersionSync/1.0",
		},
	});

	if (!response.ok) {
		throw new Error(`Chrome Web Store update check failed: HTTP ${response.status}`);
	}

	const xml = await response.text();
	const match = xml.match(/<updatecheck\b[^>]*\bversion="([^"]+)"/);
	if (!match) {
		throw new Error(`Chrome Web Store update check did not include a version:\n${xml}`);
	}

	return match[1];
}

function readApprovedVersion(source) {
	const match = source.match(/approvedVersion:\s*'([^']+)'/);
	if (!match) {
		throw new Error("Could not find ONHAND_STORE.approvedVersion in website/site.js");
	}
	return match[1];
}

function writeApprovedVersion(source, version) {
	return source
		.replace(/approvedVersion:\s*'[^']*'/, `approvedVersion: '${version}'`)
		.replace(/pendingVersion:\s*(?:'[^']*'|null)/, "pendingVersion: null");
}

function writeScriptCacheVersion(source, version) {
	return source.replace(/site\.js\?v=[^"]*-store-live/g, `site.js?v=${version}-store-live`);
}

async function main() {
	const storeId = process.env.ONHAND_CHROME_STORE_ID || DEFAULT_STORE_ID;
	const storeVersion = await fetchStoreVersion(storeId);
	const source = await readFile(SITE_JS_URL, "utf8");
	const siteVersion = readApprovedVersion(source);
	const htmlEntries = await Promise.all(HTML_URLS.map(async (url) => {
		const source = await readFile(url, "utf8");
		const updated = writeScriptCacheVersion(source, storeVersion);
		return { url, source, updated };
	}));
	const staleHtml = htmlEntries.filter((entry) => entry.source !== entry.updated);

	if (CHECK_ONLY) {
		if (siteVersion !== storeVersion) {
			throw new Error(`website/site.js says ${siteVersion}, but the Chrome Web Store serves ${storeVersion}`);
		}
		if (staleHtml.length > 0) {
			throw new Error("website HTML still has stale site.js store-version cache busters");
		}
		console.log(`website/site.js is in sync with Chrome Web Store v${storeVersion}`);
		return;
	}

	if (siteVersion === storeVersion && staleHtml.length === 0) {
		console.log(`website files already use Chrome Web Store v${storeVersion}`);
		return;
	}

	if (siteVersion !== storeVersion) {
		await writeFile(SITE_JS_URL, writeApprovedVersion(source, storeVersion));
	}
	await Promise.all(staleHtml.map((entry) => writeFile(entry.url, entry.updated)));
	console.log(`Updated website files from v${siteVersion} to v${storeVersion}`);
}

main().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
