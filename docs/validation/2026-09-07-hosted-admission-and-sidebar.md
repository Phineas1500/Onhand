# Hosted admission and sidebar verification — 2026-09-07

This change adds atomic hosted request admission, preserves the reader's position
while an answer streams, and reduces repeated work during sidebar polling.

## Hosted request admission

The existing SQLite Durable Object reserves estimated spending and capacity in the
same transaction that increments device/day and turn quotas. Twenty simultaneous
requests cannot each pass a stale quota read. Denied requests consume none of those
counters. Default admission limits are four active requests, two per device, with a
$0.25 estimated reservation per model call.

Request intent survives a Worker restart. Generation IDs are saved before the first
SSE bytes are forwarded, and known terminal usage is saved before optional metadata
lookup. Failed accounting RPCs, disconnected clients, late provider IDs, and expired
leases retain recoverable state. Stop before provider headers now aborts the
connection and releases capacity promptly, retaining uncertain spending. A request's
provider deadline is four minutes and its durable lease is five minutes.

The reservation is an estimate, not a guaranteed upper price bound. See
[admission and rollout policy](../../workers/free-tier/admission.md) for unresolved
holds, UTC-day boundaries, compatibility, and the required drain of the old Worker.
No production deployment was performed for this change.

## Sidebar behavior

Scrolling up during an active answer now preserves the reading position. A
“Jump to latest” button returns to the bottom, restores following, and focuses the
conversation region for keyboard reading. A new prompt or a session switch follows
the latest answer.

Sidebar requests carry a runtime-epoch/history revision. Unchanged responses omit
only `turns` and `messages`; status, settings, tab information, and page actions still
refresh. The client merges history only when both revision and session match. A
mismatched response triggers one full refresh, and worker restarts cannot reuse an
old revision. The ordinary runtime `getState()` API still returns full state.

Due-review calculations are shared across idle polls. Learning, session, snooze,
and active-host changes invalidate the cache. Eligibility changes caused solely
by time passing, including snooze expiry, may take up to 60 seconds to appear in the
sidebar; explicit review-list requests remain fresh.

## Automated verification

Passed:

- `npm run build:extension`
- `npm run test:preflight`
- `npm run test:sidebar-regressions`, including reading position, historical DOM
  retention, citation numbering, cache merge/recovery, and stale response races.
- `npm run test:browser-runtime-regressions`, including the actual rebuilt bundle,
  preparation/Stop state changes, runtime restart, learner/snooze invalidation,
  active-host ranking, and concurrent review-cache requests.
- `npm run test:free-tier-worker-regressions`, including 20-way quota bursts,
  durable admission/retry identity, reservation settlement, accounting failures,
  late IDs, legacy imports, cancellations, and output count/token constraints.
- The hosted suite with `ONHAND_MINIFLARE_MODULE` pointing to installed Miniflare:
  actual workerd SQLite transactions/RPC, concurrent admission, restart persistence,
  real HTTP disconnect, and alarm reconciliation. OpenRouter was mocked; these
  tests spent no provider credits.
- Independent review of hosted admission and the sidebar protocol found no remaining
  blocking findings. The pre-header cancellation gap found during review was fixed
  and received a regression test.

The deterministic long-history fixture has 100 sessions with 20 concepts each and
100 saved turns. Full sidebar state was 715,946 bytes versus 20,661 bytes for an idle
response (97.1% less). Twenty-five idle calls performed no review-storage reads or
browser snapshots and took approximately 1.1 ms in that Node fixture. These are
fixture measurements, not production latency measurements.

## Live browser verification

Live checks use a disposable Helium profile and the actual unpacked extension.
The extension was reloaded from its Extensions page after rebuilding. Native panels
were opened using `chrome.sidePanel.open()` and attached after opening. A generated
HTTP PDF provides test evidence without navigating to a personal local file.
The normal browsing profile and its tabs are preserved.

Passed live checks:

- **Reading position:** trusted mouse-wheel input moved the transcript up 650px.
  Five streaming updates preserved `scrollTop=101839` exactly. A real mouse click
  on Jump returned to the bottom and focused the conversation. PageUp moved to
  `102026`; the next streaming update preserved that position. A second Jump
  resumed following through further output.
- **Native polling:** a saved 100-turn/300-citation session used 211,540 bytes for a
  full reply and 15,635 bytes for each of five unchanged polls (92.6% less). These
  were real `chrome.runtime.sendMessage` replies from the rebuilt extension.
  All 100 completed DOM entries survived idle polls. Editing the last answer
  produced a full response with a new revision, retained the preceding 99 DOM
  entries, and kept all 300 citation numbers sequential.
- **PDF annotations:** with 100 saved answers and a new answer containing three
  real highlights/notes in a generated PDF, five runtime updates preserved the
  saved entries and open Sources disclosure. Six citation clicks over two passes
  reached the correct visible notes. New-session and switch-back controls restored
  all 101 entries and their citation identities.

The streaming HTTP fixture uses synthetic runtime replies with production
`sidebar.js`; it is distinct from the native extension and PDF checks. Its initial
18.5px document body caused embedded-mode hit testing to miss a visibly painted
sidebar. Giving the test document a viewport minimum height corrected the fixture;
no synthetic scroll assignment was substituted for the wheel/keyboard checks.
The realtime native fixture uses three citations per answer to respect the existing
per-paragraph citation presentation and text-length policies.

Local artifacts (ignored `tmp/`):

- `tmp/onhand-improvements-20260907/scroll-results.json`
- `tmp/onhand-improvements-20260907/reading-position.png`
- `tmp/onhand-improvements-20260907/browser-results.json`
- `tmp/onhand-improvements-20260907/live-panel-results.json`
- `tmp/onhand-improvements-20260907/live-panel.png`

The attempt to open Extensions in the normal Helium profile was rejected by Browser
Use's URL policy. No alternate route was attempted after that rejection. The normal
profile still needs its own manual reload; the successful reload and live checks
above apply to the disposable profile. This work remains uncommitted and the hosted
Worker remains undeployed.
