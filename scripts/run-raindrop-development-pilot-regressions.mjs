import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const buildScript = "scripts/build-browser-runtime.mjs";
const bundlePath = "packages/browser-extension/onhand-runtime.bundle.js";

function build(workshopUrl) {
	const env = { ...process.env };
	delete env.ONHAND_RAINDROP_WORKSHOP_URL;
	if (workshopUrl !== undefined) env.ONHAND_RAINDROP_WORKSHOP_URL = workshopUrl;
	return spawnSync(process.execPath, [buildScript], {
		cwd: process.cwd(),
		env,
		encoding: "utf8",
	});
}

function assertBuildSucceeded(result, label) {
	assert.equal(result.status, 0, `${label} build failed:\n${result.stderr || result.stdout}`);
}

let testError;
try {
	const defaultBuild = build(undefined);
	assertBuildSucceeded(defaultBuild, "default");
	const defaultBundle = readFileSync(bundlePath, "utf8");
	assert.equal(defaultBundle.includes("raindrop.pi-agent"), false, "Default build must exclude the Raindrop SDK");
	assert.equal(defaultBundle.includes("onhand_browser_turn"), false, "Default build must exclude the development observer implementation");
	assert.equal(defaultBundle.includes("http://localhost:5899/v1/"), false, "Default build must not activate a Workshop URL");

	const localBuild = build("http://localhost:5899/v1/");
	assertBuildSucceeded(localBuild, "local pilot");
	const localBundle = readFileSync(bundlePath, "utf8");
	assert.equal(localBundle.includes("raindrop.pi-agent"), true, "Local pilot build must include the Raindrop SDK");
	assert.equal(localBundle.includes("http://localhost:5899/v1/"), true, "Local pilot build must target the loopback Workshop URL");
	assert.equal(localBundle.includes('return "browser-extension"'), true, "Local pilot build must use the browser-safe OS shim");

	const unsafeBuild = build("https://api.raindrop.ai/v1/");
	assert.notEqual(unsafeBuild.status, 0, "Non-loopback Workshop URLs must be rejected");
	assert.match(`${unsafeBuild.stderr}\n${unsafeBuild.stdout}`, /must use HTTP on a loopback host/);
} catch (error) {
	testError = error;
} finally {
	const restoreBuild = build(undefined);
	if (restoreBuild.status !== 0 && !testError) {
		testError = new Error(`Could not restore the default runtime bundle:\n${restoreBuild.stderr || restoreBuild.stdout}`);
	}
}

if (testError) throw testError;
const failOpen = spawnSync(process.execPath, ["scripts/run-raindrop-observer-fail-open.mjs"], {
	cwd: process.cwd(),
	encoding: "utf8",
});
assert.equal(failOpen.status, 0, `Observer fail-open regression failed:\n${failOpen.stderr || failOpen.stdout}`);
console.log("Raindrop development pilot regressions: PASS");
