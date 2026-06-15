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
npm run ops:free-tier:check
npm run ops:free-tier -- --dry-run --print-sql
npm run ops:free-tier -- --days=1
npm run ops:free-tier -- --days=14 --limit=50
npm run ops:free-tier -- --json
```

Use `npm run ops:free-tier:check` as the normal daily/local check after a
free-tier smoke test. It runs a 1-day report, writes the usual JSON and
Markdown artifacts, and exits non-zero only for critical checks. Warning checks
still print in the report but do not fail the command.

Default critical checks:

- average daily free-tier cost above `$1`
- prompt failures above `0`
- provider stream errors above `0`
- free-tier quota/cost denials above `0`
- final unrecovered tool failures above `0`
- `browser_run_js` failures above `0`

Default warning checks:

- average completion cost above `$0.01`
- recovered tool failures above `5`
- `browser_run_js` invocations above `10`
- heavy-turn guardrail events above `5`

Override thresholds with flags such as `--max-daily-cost=2`,
`--max-avg-cost=0.02`, or `--max-heavy-turns=10`. The same values can be set
through `FREE_TIER_ALERT_MAX_*` environment variables; run
`npm run ops:free-tier -- --help` for the exact names.

## What To Watch

- `chat_stream_complete` volume: normal successful free-tier model calls.
- `chat_stream_error`, `chat_request_rejected`, `chat_quota_denied`,
  `chat_turn_quota_denied`, and `chat_cost_quota_denied`: user-visible failure
  pressure.
- `total_cost` and `avg_cost`: whether DeepSeek V4 Flash is staying within the
  intended free-tier economics.
- `Turn Costs`: model-call count, tokens, cost, and streamed duration grouped
  by the Onhand UI turn id; older completions before turn attribution show as
  `unknown`.
- `Guardrail Events`: heavy-turn warnings plus per-turn and shared daily cost
  cap denials. `free_tier_heavy_turn` is warning-only; the two
  `*_quota_denied` rows are user-visible stops.
- `p95_ms`: whether OpenRouter/provider routing is creating slow responses.
- `quota_and_rejections`: abuse pressure or overly strict caps.
- `browser_run_js_*`: constrained advanced runtime-inspection usage. Unexpected
  growth here means prompts or tool gating need another review.

The Worker records Analytics Engine fields as documented in `docs/FREE_TIER.md`.
The ops script uses `_sample_interval` in aggregates because Workers Analytics
Engine can sample high-volume datasets.
