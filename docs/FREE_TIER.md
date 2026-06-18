# Onhand Free Tier

The free tier lets users run Onhand without any API key or account. The
extension's "Onhand Free (beta)" provider talks to a small Cloudflare
Worker (`workers/free-tier/`) that proxies OpenAI-compatible chat
completions to OpenRouter with Onhand's key.

## Why this shape

- DeepSeek V4 Flash passed the Onhand behavioral matrix (anchored
  answers, learning mode with checks, citation chasing, homework
  refusal) at roughly a cent per turn measured through OpenRouter.
- Image-bearing requests route server-side to Mistral Small 3.2 because
  DeepSeek V4 Flash does not support image input. The extension treats
  that visual route as a 128K-context path and compacts image-bearing
  agent transcripts before the next model call.
- The worker pins OpenRouter routing to US hosts (`deepinfra`,
  `parasail`, `novita`, `wandb`) so free-tier pages and PDFs never
  transit PRC-hosted APIs, and so only hosts with validated tool-call
  behavior serve requests.
- Devices are identified by an anonymous token issued at first use; no
  accounts, emails, or page content are stored. The worker keeps only
  daily request counters.

## Cost controls

- client-visible model allowlist: `deepseek/deepseek-v4-flash`; requests
  whose message history contains image content are rewritten upstream to
  `mistralai/mistral-small-3.2-24b-instruct`
- `DAILY_REQUEST_CAP` (default 80 model calls ≈ 15-25 turns/day)
- `DAILY_COST_CAP_USD` (default `$5` shared hosted-model spend/day)
- `TURN_MODEL_CALL_CAP` (default 20 model calls in one Onhand UI turn)
- `HEAVY_TURN_MODEL_CALLS`, `HEAVY_TURN_COST_USD`, and
  `HEAVY_TURN_TOKENS` (warning-only ops thresholds)
- `REGISTRATIONS_PER_IP_PER_DAY` (default 5)
- `TELEMETRY_EVENTS_PER_IP_PER_DAY` (default 1000 diagnostics events/day)
- `ERROR_REPORTS_PER_IP_PER_DAY` (default 50 explicit error reports/day)
- request body capped at ~900KB, `max_tokens` clamped to 16384

The values in this repo are defaults. The deployed worker may run
different caps (set via wrangler vars), so production limits can be
tuned without a code change or a repo update.

Before changing the allowlisted model, run the product-shaped comparison in
[`FREE_TIER_MODEL_EVAL.md`](FREE_TIER_MODEL_EVAL.md). It checks model cost,
latency, browser tool behavior, anchored answers, learning-mode coaching, and
homework-refusal behavior against the current default.

After deploying, use [`FREE_TIER_OPS.md`](FREE_TIER_OPS.md) to query the
Cloudflare Analytics Engine dataset for cost, latency, failures, quota pressure,
and advanced runtime-inspection usage.

At the measured ~1¢/turn, a maxed-out free device costs roughly
$0.15-0.25/day; typical usage is far below that.

## Deploying

```sh
cd workers/free-tier
npx wrangler login
npx wrangler kv namespace create FREE_TIER_KV   # paste id into wrangler.toml
npx wrangler secret put OPENROUTER_API_KEY      # the funding key, press y
npx wrangler deploy
```

If deploy fails with Cloudflare API code `10089`, the account still needs
Analytics Engine enabled. Open the dashboard URL from Wrangler's error,
click **Create Dataset**, create `onhand_events`, then rerun
`npx wrangler deploy`. Cloudflare's docs say Workers Analytics Engine
datasets are normally created automatically after the binding exists and
the Worker first writes to them, but the account-level setup gate can
still need this one-time dashboard step.

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

## Monitoring

The worker writes optional custom metrics to the `ONHAND_ANALYTICS`
Workers Analytics Engine binding when it is configured. Missing
Analytics Engine bindings are a no-op so local development and emergency
deploys still work.

Free-tier model calls include private `X-Onhand-Turn-Id` and
`X-Onhand-Session-Id` headers from the extension to the Worker. The
Worker stores those ids in Analytics Engine so ops reports can group
model-call cost by user-visible Onhand turn. The ids are not needed in
the chat payload itself; the Worker uses OpenRouter's generation metadata
endpoint after completion to enrich the aggregate event with provider,
upstream model, request id, token count, and cost when OpenRouter exposes
those fields.

Worker-side events:

- `register_success`
- `register_rate_limited`
- `chat_auth_denied`
- `chat_quota_denied`
- `chat_turn_quota_denied`
- `chat_cost_quota_denied`
- `chat_request_rejected`
- `chat_upstream_response`
- `chat_stream_complete`
- `chat_stream_error`
- `chat_stream_cancelled`
- `free_tier_heavy_turn`
- `telemetry_rate_limited`
- `telemetry_rejected`
- `error_report_submitted`
- `error_report_rate_limited`
- `error_report_rejected`

Extension diagnostics go to `POST /v1/telemetry` and use the same
Analytics Engine dataset. Anonymous diagnostics are required when the
user selects Onhand Free because Onhand hosts the model endpoint; they
remain optional for other authentication modes. The payload excludes
prompts, page content, URLs, screenshots, saved sessions, transcripts,
and keys.

Extension-side events:

- `diagnostics_enabled`
- `extension_installed`
- `extension_updated`
- `options_opened`
- `settings_saved`
- `sidepanel_opened`
- `sidepanel_closed`
- `prompt_submitted`
- `prompt_succeeded`
- `prompt_failed`
- `prompt_stopped`
- `session_started`
- `session_restored`
- `session_restore_failed`

Explicit error reports go to `POST /v1/error-reports`. These reports do
not require diagnostics to be enabled; they are only sent after the user
clicks "Send anonymized error report" on a failed Onhand reply. The
extension sends a redacted error envelope only: extension version,
runtime revision, auth mode, provider/model category, coarse error kind,
redacted error message/stack, duration, tool activity names/states, and
aggregate counts. It does not send prompts, page content, URLs, titles,
screenshots, saved sessions, transcripts, or keys.

The Worker stores accepted reports in `FREE_TIER_KV` under
`error-report:<report_id>` with a 90-day TTL and writes an
`error_report_submitted` aggregate event to Analytics Engine. Use the
Cloudflare dashboard or KV listing tools to inspect keys with the
`error-report:` prefix.

Analytics Engine columns are positional. The event name is stored as the
index and `blob1`; source is `blob2`; result is `blob3`; model/provider
are `blob4`/`blob5`; country/colo/user-agent-family are
`blob6`/`blob7`/`blob8`; extension version/runtime revision/auth mode/
AI provider/AI model/device hash/error code are `blob9` through
`blob15`; Onhand turn id/session id/OpenRouter generation id/upstream
model/OpenRouter request id are `blob16` through `blob20`. Numeric fields
are timestamp, status, duration, body bytes, quota current, quota cap,
prompt tokens, completion tokens, total tokens, cost, action count, and
artifact count.

For free-tier chat events, `action count` is reused as the model-call count
inside the current Onhand turn. `chat_turn_quota_denied` stops a runaway turn
before it can keep making model calls. `chat_cost_quota_denied` stops new model
calls after the shared daily hosted-model cost cap has been reached.
`free_tier_heavy_turn` is warning-only and fires once per turn when a completion
crosses one of the configured heavy-turn thresholds.

Useful first queries:

```sql
SELECT
  blob1 AS event,
  count() AS events
FROM onhand_events
WHERE timestamp >= NOW() - INTERVAL '1' DAY
GROUP BY event
ORDER BY events DESC
```

```sql
SELECT
  blob1 AS event,
  quantileExact(0.95)(double3) AS p95_ms,
  countIf(blob3 = 'error') AS errors,
  count() AS total
FROM onhand_events
WHERE blob1 IN ('chat_upstream_response', 'chat_stream_complete')
  AND timestamp >= NOW() - INTERVAL '1' DAY
GROUP BY event
```

```sql
SELECT
  sum(double10) AS cost,
  sum(double9) AS tokens,
  count() AS completions
FROM onhand_events
WHERE blob1 = 'chat_stream_complete'
  AND timestamp >= NOW() - INTERVAL '1' DAY
```

## Operations notes

- Rotating the OpenRouter key: `npx wrangler secret put OPENROUTER_API_KEY` again.
- Abuse response: lower `DAILY_REQUEST_CAP`, or delete a token's
  `token:<id>` KV entry to revoke it.
- Cost response: lower `DAILY_COST_CAP_USD` to cap shared daily spend, or lower
  `TURN_MODEL_CALL_CAP` to stop unusually complex single turns earlier.
- The cap counters are best-effort (KV get+put), which can leak a couple
  of requests under parallel load; that is acceptable for these free-tier
  guardrails.
