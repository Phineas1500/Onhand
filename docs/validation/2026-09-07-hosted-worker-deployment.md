# Hosted Worker deployment — September 7, 2026

Production endpoint: https://onhand-free-tier.sriram-kiron.workers.dev

Final version: `e76c9a05-c300-430e-92c7-41c67143fb01`, deployed to 100% of
traffic at `2026-09-07T22:27:40.839Z`.

## Preserved configuration and migration

- Account: `9f4de420d3767c435f2a237f622f32bc`. The ordinary Wrangler OAuth login
  pointed to a different, empty account; deployment used the verified project
  Cloudflare credentials.
- All existing bindings, secret names, and variable values were compared before
  and after deployment. The live daily request limit remains **250**, the
  shared recorded-cost cap remains **$5**, and the per-turn call cap remains 50.
  The repository's request default is 80: future deployments must reconcile
  production variables explicitly; `--keep-vars` alone does not override local
  values.
- Existing KV namespace `7b951e234331464bb18b2d62c2d80266` and Analytics Engine
  dataset `onhand_events` retained. Endpoint, preview setting, compatibility
  date (`2026-05-01`), and existing secrets retained.
- Added SQLite Durable Object namespace `93126b1f727944bb88eefa0faa23753a`,
  class `FreeTierCostLedger`, binding `FREE_TIER_COST_LEDGER`, migration
  `v1-daily-cost-ledger`.
- The initial cutover deployed the downloaded old code byte for byte with its
  shared cap temporarily zero. The pause was verified by HTTP 429, existing
  bindings were checked, recent activity was inspected, and the final legacy
  counter was read after the drain/propagation interval. Its September 7 value
  was absent, equivalent to zero. The new ledger imported zero and the original
  cap was restored. The pause lasted roughly two minutes.

## Issues found and fixed during live verification

1. **Actual network disconnects skipped the stream cancel callback.** The first
   real cancelled generation did not reach accounting even though direct
   JavaScript cancellation tests passed. The Worker now listens to incoming
   `Request.signal`, with `enable_request_signal` enabled. Network abort and
   stream cancellation share an idempotent finalizer and release the listener
   on completion.
2. **Production Analytics Engine rejected mixed IF result types.** The average
   cost and token SQL expressions used integer zero alongside a floating-point
   division. Their fallback is now `0.0`; the live report runs successfully.

The cancellation regression now opens a real HTTP connection to the Worker's
workerd socket, aborts after identified content, and requires both the correct
ledger charge and exactly one `chat_stream_cancelled` event. Normal EOF cannot
satisfy that assertion. Fixture output is bounded and cleans up. Unit coverage
also exercises simultaneous request abort and stream cancellation.

## Live verification

Harmless test prompts used an anonymous temporary device token, without the
quota-bypass header. The final deployed version passed:

| Case | Result | Provider cost |
| --- | --- | --- |
| Streamed reply | HTTP 200, expected text, terminal DONE | $0.0000138 |
| JSON reply | HTTP 200, expected text and usage | $0.0000138 |
| Cancel after initial content | Actual cancelled request and cancellation event; delayed charge reconciled by the Durable Object alarm | $0.0000058 |

The authoritative production ledger increased from **$0.0000276 to $0.000061**,
exactly the **$0.0000334** cost of those three final smoke requests. Analytics
recorded the cancellation terminal event and its subsequent
`free_tier_cost_adjustment`; sanitized live tails showed no accounting errors
or exceptions for these requests.

The known $0.0000058 charge from the earlier, deliberately failing diagnostic
cancellation was submitted to the normal ledger reconciliation mechanism using
only that generation ID. The alarm recovered it, bringing the final ledger to
**$0.0000668**, equal to all six diagnostic/smoke generations. This correction
is separate from the final three-request comparison.

Verification used a temporary secret-protected remote preview that could read
the day's ledger through its existing RPC. No administrative endpoint was
deployed to production. A narrowly fixed diagnostic-reconciliation route was
used only in that protected preview.

Cleanup completed: the anonymous test token was revoked, temporary credential
files removed, the log tail and preview stopped, and the helper listener was
confirmed closed. The production account still lists only `onhand-free-tier`.

## Validation and boundaries

- Worker deterministic regressions and real workerd/SQLite integration passed,
  including concurrency, idempotency, legacy import, restart persistence,
  admission, SSE/JSON, real HTTP cancellation, and reconciliation alarms.
- Wrangler dry-run, live deployment checks, production operations SQL, and
  `git diff --check` passed.
- The final operations report showed no unexpected provider errors, prompt
  failures, or quota denials. Its only warning was the two deliberate pause
  probes, classified as test-device quota denials.
- This verifies the hosted backend directly over HTTP. It does not substitute
  for the remaining manual extension/PDF walkthrough described in the earlier
  review report.
- The $5 recorded-cost check is not a reservation system: in-flight and delayed
  charges can exceed it. Historical lost KV charges cannot be reconstructed
  automatically. Disconnects before a generation ID/usage is available and
  background work exceeding the runtime lifetime remain recovery boundaries.
- No commit or push was performed for this deployment.

See [Cloudflare's request cancellation documentation](https://developers.cloudflare.com/workers/runtime-apis/request/)
and [Wrangler deploy options](https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy)
for the compatibility flag and variable-preservation behavior.
