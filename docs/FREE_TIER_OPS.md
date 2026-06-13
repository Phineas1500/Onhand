# Free Tier Ops

Use this report after deploying the free-tier Worker to check whether Onhand Free
is healthy, cheap, and abuse-resistant.

## Required Access

Create a Cloudflare API token with `Account | Account Analytics | Read`, then
run:

```sh
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npm run ops:free-tier
```

The report queries the `onhand_events` Workers Analytics Engine dataset and
writes JSON plus Markdown under `tmp/free-tier-ops/`.

## Useful Commands

```sh
npm run ops:free-tier -- --dry-run --print-sql
npm run ops:free-tier -- --days=1
npm run ops:free-tier -- --days=14 --limit=50
npm run ops:free-tier -- --json
```

## What To Watch

- `chat_stream_complete` volume: normal successful free-tier model calls.
- `chat_stream_error`, `chat_request_rejected`, and `chat_quota_denied`: user
  visible failure pressure.
- `total_cost` and `avg_cost`: whether DeepSeek V4 Flash is staying within the
  intended free-tier economics.
- `Turn Costs`: model-call count, tokens, cost, and streamed duration grouped
  by the Onhand UI turn id; older completions before turn attribution show as
  `unknown`.
- `p95_ms`: whether OpenRouter/provider routing is creating slow responses.
- `quota_and_rejections`: abuse pressure or overly strict caps.
- `browser_run_js_*`: constrained advanced runtime-inspection usage. Unexpected
  growth here means prompts or tool gating need another review.

The Worker records Analytics Engine fields as documented in `docs/FREE_TIER.md`.
The ops script uses `_sample_interval` in aggregates because Workers Analytics
Engine can sample high-volume datasets.
