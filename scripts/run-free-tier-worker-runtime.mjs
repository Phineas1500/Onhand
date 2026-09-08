// Development/CI integration tests require Node 22+ through pinned Wrangler.
// Keep resolution tied to Wrangler's lockfile instead of a user's npx cache.
import { createRequire } from "node:module";
import { runLocalWorkerRegressions } from "../workers/free-tier/tests/runtime-regressions.mjs";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
await runLocalWorkerRegressions(wranglerRequire.resolve("miniflare"));
