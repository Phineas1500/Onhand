# Hosted rollout and conversation recovery — 2026-09-08 UTC

## Changes

Voice turns now save the full prompt and answer, including paragraph breaks,
Markdown, and final citation markers. Compact model messages and the recent-turn
context retain their existing limits; saved transcript text is no longer shortened
to those model-context limits. This cannot recover text already truncated in an
older saved turn.

A failed sidebar poll preserves the most recent accepted conversation for the same
session and its reading position. A visible connection notice offers Reconnect.
Session transitions invalidate the cached conversation. New runtime actions pause
while disconnected; reading, copying, best-effort Stop, and ending an existing
voice connection remain available.

Source activation failures persist beside the clicked source with Retry. The
feedback retains the originating session, turn, and source identity through
transcript updates. Retry prevents duplicate requests, clears its feedback on
success, and becomes usable again after a disconnect resolves.

CI now runs workerd integration through a pinned Wrangler dependency, plus a
headed Chrome for Testing workflow under Xvfb. Development/CI tooling uses Node 22.
Browser tests generate their own PDF and use an isolated profile, with no paid
provider calls or personal browsing data. Failure screenshots and result JSON are
uploaded as CI artifacts.

The disposable Linux CI browser uses `--no-sandbox` for the documented
[Ubuntu AppArmor startup restriction](https://github.com/browser-actions/setup-chrome/issues/639).
That flag is confined to CI's generated fixtures; local browser launches keep
their default sandbox configuration.

## Hosted production rollout

The previous runtime batch was pushed as
`b0dd57502dc62dff1151a60253dfc5434edfcf79` and passed
[GitHub CI](https://github.com/Phineas1500/Onhand/actions/runs/34174540758).

The production Worker is
[`onhand-free-tier`](https://onhand-free-tier.sriram-kiron.workers.dev).
Its previous code and settings were backed up before deployment. All HTTP work was
paused at 00:52:43 UTC to drain the old implementation and allow KV propagation.
The current-day ledger was zero before and after the drain; no recent model calls
or accounting failures appeared in the drain checks.

At 00:59:08 UTC, version `c2ba293d-7168-4427-8638-4d0c5e21131c` went live at
100% traffic. The production API confirmed preservation of the existing KV
namespace, SQLite Durable Object namespace/class, analytics dataset, secrets,
and live limits: 250 requests per device/day, 50 calls per turn, and $5 daily cost.
Admission adds a $0.25 estimated reservation, four active requests globally, and
two per device. The existing migration tag is unchanged.

The reservation is an estimate, not a guaranteed upper price bound. Runtime logs
and traces are sampled at 10% and 1%, respectively. A private temporary remote
preview provided authenticated, read-only access to the current-day ledger;
no administrative route was added to the production Worker.

## Verification

### Production smoke and accounting

Six inexpensive model requests used a fresh temporary anonymous test credential:
two completed streams, one complete JSON response, and three canceled streams.
Two overlapping requests were admitted; a third returned HTTP 429 with
`concurrency_cap` and `Retry-After: 5`. A successful request after cancellation
confirmed that capacity was available again.

Analytics recorded each of the six generation IDs exactly once for cost purposes,
including three delayed cancellation adjustments. Their summed cost,
**$0.000118**, exactly matched the authoritative current-day Durable Object ledger.
No exceptions or accounting failures appeared in the sanitized live tail. These
small checks establish the deployed paths; they are not a production load test or
proof of a strict spending ceiling.

The temporary test token was revoked, and its KV key returned 404 on readback.
The remote preview and tail processes were stopped, and temporary credential files
were removed. The regular Helium browsing process was preserved.

### Automated regression checks

Passed locally after rebuilding:

- Extension build and preflight.
- Browser runtime regressions, including exact preservation of a 1,499-character
  voice prompt and a 2,108-character answer through durable reload/upsert, with
  model history still bounded.
- Sidebar regressions, including same-session snapshot/node/scroll recovery,
  stale session responses, local source retry identity, duplicate-request
  prevention, and Stop/End voice availability during a disconnect.
- Hosted deterministic admission/accounting regressions.
- Actual workerd SQLite integration: concurrent transactions, restart persistence,
  RPC, quota enforcement, stream/JSON accounting, HTTP disconnect, and alarms.

The first full runtime test attempt hit the sandbox's loopback restriction; the
authorized rerun with local HTTP fixtures passed. Voice validation covers transcript
recording, storage, and rendering, not a new end-to-end microphone/provider session.

### Live browser and CI

`npm run test:real-sidebar-workflows` passed in an isolated Helium profile
(Chromium 151.0.7922.169) with the rebuilt extension:

- Trusted wheel and PageUp input preserved the reading position through streaming
  updates; clicking Jump to latest restored following and keyboard focus.
- The native sidebar retained 100 completed answer nodes across unchanged polls.
  Its full response was 365,581 bytes versus 19,002 bytes for each of three idle
  responses (94.8% smaller in this fixture).
- Controlled polling failures retained all 102 answer nodes and the scroll offset.
  Reconnect used the real runtime and reenabled normal actions.
- An injected failure on an older source displayed local persistent feedback;
  Retry reached the actual PDF note and cleared the feedback without losing the
  reading position.
- A 2,956-character voice answer retained its exact text, paragraphs, and final
  citation across a full browser/service-worker restart. All 102 committed turns
  returned with a new runtime history revision.
- Three citation clicks before restart and three after session restoration reached
  the correct visible PDF notes, preserving their labels and action identities.
  New-session and switch-back controls also passed.

The test runner resolves the viewer through the citation's actual tab and observed
CDP frame ownership. Earlier broad URL matching selected the wrong duplicate PDF
after restart; fixing the harness resolved the failure without a product change.
Other harness corrections handle duplicate-click timing, screenshotting the
containing page of a PDF iframe, and desktop focus for trusted keyboard input.
Timeout cleanup prevents a late browser relaunch. A failed workerd test retries
once with fresh storage only if the attempt crossed UTC midnight.

Final independent sidebar review found no remaining substantive blockers. The new
GitHub workflow runs both regression/workerd and real-browser jobs on pushes and
pull requests. Its execution result is checked after pushing the resulting commit.

Ignored local evidence: `tmp/browser-workflows/results.json`,
`streaming-reading-position.png`, `sidebar-disconnected.png`,
`sidebar-source-retry.png`, `native-sidebar.png`, `pdf-citation-note.png`, and
`sidebar-after-restart.png` in that directory. The owned test browser, profile,
and fixture server were cleaned up after the successful run.

### Remaining boundaries

The regular Helium profile still needs a manual Onhand reload. Browser Use rejected
its internal Extensions URL, so no alternate route was used for that blocked
operation. Live checks use a fresh disposable profile that loads the rebuilt
extension at browser startup and opens the native panel through
`chrome.sidePanel.open()`. The personal local PDF was not reopened for these tests.

Automatic approval review rejected an optional `npm audit` because it would upload
dependency metadata. It was not retried; CI installs use `--no-audit`. Inspection
of existing local advisory data identified a pre-existing Undici 6.26.0 advisory;
the version is unchanged from the previous lockfile. This release is not a fresh
dependency-security audit.
