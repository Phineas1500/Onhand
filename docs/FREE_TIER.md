# Onhand Free Tier

The free tier lets users run Onhand without any API key or account. The
extension's "Onhand Free (beta)" provider talks to a small Cloudflare
Worker (`workers/free-tier/`) that proxies OpenAI-compatible chat
completions to OpenRouter with Onhand's key.

## Why this shape

- DeepSeek V4 Flash passed the Onhand behavioral matrix (anchored
  answers, learning mode with checks, citation chasing, homework
  refusal) at roughly a cent per turn measured through OpenRouter.
- The worker pins OpenRouter routing to US hosts (`deepinfra`,
  `parasail`, `novita`, `wandb`) so free-tier pages and PDFs never
  transit PRC-hosted APIs, and so only hosts with validated tool-call
  behavior serve requests.
- Devices are identified by an anonymous token issued at first use; no
  accounts, emails, or page content are stored. The worker keeps only
  daily request counters.

## Cost controls

- model allowlist: `deepseek/deepseek-v4-flash` only
- `DAILY_REQUEST_CAP` (default 80 model calls ≈ 15-25 turns/day)
- `REGISTRATIONS_PER_IP_PER_DAY` (default 5)
- request body capped at ~900KB, `max_tokens` clamped to 16384

The values in this repo are defaults. The deployed worker may run
different caps (set via wrangler vars), so production limits can be
tuned without a code change or a repo update.

At the measured ~1¢/turn, a maxed-out free device costs roughly
$0.15-0.25/day; typical usage is far below that.

## Deploying

```sh
cd workers/free-tier
npx wrangler login
npx wrangler kv namespace create FREE_TIER_KV   # paste id into wrangler.toml
npx wrangler secret put OPENROUTER_API_KEY      # the funding key
npx wrangler deploy
```

Then point the extension at the deployed URL by updating
`ONHAND_FREE_TIER_DEFAULT_BASE_URL` in
`packages/browser-extension/src/browser-runtime.ts` (and rebuild), or —
without rebuilding — set the override in extension storage:

```js
chrome.storage.local.set({ onhandFreeTierBaseUrl: "https://<your-worker>.workers.dev/v1" })
```

## Local testing

```sh
cd workers/free-tier
echo 'OPENROUTER_API_KEY=sk-or-...' > .dev.vars   # gitignored
npx wrangler dev --local --port 8787
```

Set the extension override to `http://127.0.0.1:8787/v1`, select
"Onhand Free (beta)" in options, and prompt normally. The
`tmp/onhand-qa-driver.mjs` harness automates this flow.

## Operations notes

- Rotating the OpenRouter key: `npx wrangler secret put OPENROUTER_API_KEY` again.
- Abuse response: lower `DAILY_REQUEST_CAP`, or delete a token's
  `token:<id>` KV entry to revoke it.
- The cap counter is best-effort (KV get+put), which can leak a couple
  of requests under parallel load; that is acceptable for cost control.
