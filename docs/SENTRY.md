# Sentry

Onhand uses Sentry only for privacy-safe browser-extension error reporting.
The SDK is bundled locally in `packages/browser-extension/onhand-runtime.bundle.js`;
the extension does not load Sentry's remote loader script.

## Runtime Behavior

- Diagnostics-off users do not send automatic Sentry events.
- Diagnostics-on users may send redacted prompt/runtime exception events.
- Diagnostics-off users can still click "Send anonymized error report" after an
  Onhand error; that sends one explicit redacted Sentry event.
- Sentry events exclude prompts, page text, URLs, page titles, screenshots,
  saved sessions, transcripts, keys, request data, breadcrumbs, and default
  browser contexts.
- Error messages are redacted twice: known message shapes (such as "No visible
  text matched: …") drop their text, and every quoted span is replaced with
  `"[redacted]"`, so a new message that quotes the request or the page can't
  leak it. JSON keys and identifier-like JSON values stay, which keeps API
  error codes such as `daily_request_cap` readable. Local debug traces keep
  their quotes.
- When diagnostics are on, the runtime starts Sentry as the service worker
  starts, so its global handlers report uncaught errors and unhandled
  rejections (`kind=uncaught`). Chrome teardown errors ("No tab with id",
  "Receiving end does not exist", "The browser is shutting down" and the like)
  are dropped.
- Onhand's own pages (side panel, options, PDF viewer, snapshot viewer,
  offscreen document and microphone permission page) load
  `page-error-reporter.js` first. It forwards up to five distinct uncaught
  errors per page load to the background, which reports them as
  `kind=runtime_exception` with `message_type=page:<page>`.
- Expected conditions are not reported: aborted and busy requests, sign-in
  cancellations, the daily Onhand Free limit, page-tool target misses, and PDF
  links that return HTTP 404 or 410.
- Stack-frame URLs from the extension are normalized to
  `app:///onhand-runtime.bundle.js` so source maps can be matched without
  exposing the Chrome extension ID.

## Release Naming

The browser runtime sends:

- `release`: `onhand-extension@<manifest version>`
- `dist`: `chrome`, or `firefox` in Firefox (from 0.4.12; earlier Firefox builds
  report `chrome`)
- `environment`:
  - `test` for requests from the CLI and the eval and acceptance scripts
    (`request_source` of `cli`, `acceptance`, `agent-trajectory` or
    `prompt-eval:*`);
  - `development` for unpacked builds (`chrome.management.getSelf()` reports
    `installType: "development"`), which covers every test profile;
  - `production` otherwise.

Look at `environment:production` when judging real-user impact.

For version `0.3.8`, the release is `onhand-extension@0.3.8`.

## Alerts

Sentry now keeps issue alerts as organization workflows (the old project
rules API returns 404). Create or refresh Onhand's alerts with:

```sh
npm run sentry:alerts
npm run sentry:alerts -- --apply
```

The command defaults to dry-run. `--apply` writes these alerts, each limited to
`environment:production` (`--environment=<name>` changes that):

- `Send a notification for high priority issues`: updates the default high
  priority rule so source-map and runtime smoke events do not page/email.
- `Onhand: new extension error (non-smoke)`: emails issue owners, falling back
  to recently active members, when a new non-smoke error issue is created.
- `Onhand: regression or burst (non-smoke)`: emails on regressions, reappeared
  issues, or an issue seen more than 5 times in 1 hour.

All alerts filter to Sentry error issues and exclude:

- `kind=sentry_source_map_smoke`
- `message_type=sentry_runtime_smoke`

Alert setup uses `SENTRY_ALERT_AUTH_TOKEN` when present, then falls back to
`SENTRY_SMOKE_AUTH_TOKEN`, then `SENTRY_AUTH_TOKEN`. Use a token with Sentry
alert read/write access, for example Project read plus Alerts write/admin.
Tokens with only `event:read` and `project:read` can dry-run alert setup but
cannot apply alert changes.

Before relying on Sentry for production crash reporting, enable Sentry's
project-side setting that prevents storing client IP addresses / IP-derived
location data, or route Sentry envelopes through an Onhand-owned tunnel. The
Onhand SDK strips `event.user`, but Sentry can still derive `user.geo` from the
HTTP request unless project-side IP storage prevention is enabled.

## Source Maps

Source maps are upload-only artifacts. `npm run package:chrome` and
`npm run package:firefox` build the runtime bundle with an external source map
and write both, outside the zip, to
`<out-dir>/sentry-sourcemaps/onhand-v<version>-<browser>/` (`dist/` by
default, ignored by git). The map's sources are repo-relative paths. Uploading
from the package means the map matches the exact bundle each store serves: the
Chrome bundle carries the Onhand Free URL and the Firefox bundle is minified, so
neither matches the tracked bundle.

Required environment variables:

```sh
export SENTRY_ORG=<org-slug>
export SENTRY_PROJECT=onhand-browser-extension
export SENTRY_AUTH_TOKEN=<token-with-project-read-write-and-release-admin>
export SENTRY_SMOKE_AUTH_TOKEN=<optional-token-with-project-event-read>
export SENTRY_ALERT_AUTH_TOKEN=<optional-token-with-alert-read-write>
export SENTRY_ISSUE_AUTH_TOKEN=<optional-token-with-project-issue-read>
```

For `npm run sentry:sourcemaps`, the token needs enough access to create/read
releases and upload project artifacts. In Sentry's token UI this usually means:

- Project: Read
- Project: Write
- Release: Admin

For `npm run sentry:smoke`, set `SENTRY_SMOKE_AUTH_TOKEN` to a separate token
that can read processed event details for the project. If
`SENTRY_SMOKE_AUTH_TOKEN` is not set, the smoke script falls back to
`SENTRY_AUTH_TOKEN`.

For `npm run sentry:issues`, set `SENTRY_ISSUE_AUTH_TOKEN` to a separate
read-only token that can list project issues. In Sentry's token UI this usually
means:

- Project: Read
- Issue & Event: Read

Upload after packaging a release, as part of every release:

```sh
npm run package:chrome
npm run package:firefox
npm run sentry:sourcemaps -- --dry-run
npm run sentry:sourcemaps
npm run sentry:smoke
npm run sentry:runtime-smoke
```

Without `--browser`, `sentry:sourcemaps` uploads every browser packaged for the
manifest version, each under its own `dist`. It first checks that the bundle
beside each map is byte-identical to the one inside the zip; if not, repackage
with `-- --force`. When the packages were written elsewhere, pass
`--packages-dir=<out-dir>`.

The smoke script sends one synthetic event with a frame at
`app:///onhand-runtime.bundle.js`, then polls Sentry until that frame resolves
to `packages/browser-extension/src/browser-runtime.ts`. It derives the frame
from the tracked bundle, which matches the Chrome package line for line, and
sends `dist=chrome`. For the minified Firefox build, pass `--dist=firefox` with
an explicit `--line` and `--column`.

The runtime smoke script sends a controlled event through the shipped Onhand
browser runtime with diagnostics enabled, then reads the processed event back
from Sentry. It fails if prompts, URLs, file paths, keys, email addresses,
Chrome extension IDs, request data, user data, or breadcrumbs survive redaction.
It tags the event with `message_type=sentry_runtime_smoke`, which the alert
rules exclude.

If `npm run sentry:runtime-smoke` fails only because the processed event
contains `user.geo`, the Onhand scrubber did its local redaction job but the
Sentry project is still storing IP-derived location metadata. Enable Sentry's
IP storage prevention setting or add an Onhand tunnel before treating Sentry as
privacy-ready.

Useful overrides:

```sh
npm run sentry:sourcemaps -- --browser=chrome
npm run sentry:sourcemaps -- --packages-dir=<package out-dir>
npm run sentry:sourcemaps -- --org=ramaway --project=onhand-browser-extension
npm run sentry:runtime-smoke -- --timeout-ms=120000
```

## Issue Health

Check unresolved non-smoke issue health with:

```sh
npm run sentry:issues
npm run sentry:issues -- --stats-period=14d
```

The command reads unresolved project issues, filters out the source-map and
runtime smoke issues used by the validation scripts, and prints the remaining
non-smoke issues with counts, affected users, last-seen time, and permalink.

The command intentionally supports the issue windows we use operationally:
`24h` for release-day checks and `14d` for broader regression triage.

If the command fails with HTTP 403, create or update `SENTRY_ISSUE_AUTH_TOKEN`
with Project Read plus Issue & Event Read access, then rerun:

```sh
npm run sentry:issues -- --token-env=SENTRY_ISSUE_AUTH_TOKEN
```

## Triage Runbook

When a Sentry alert fires:

1. Confirm it is not a smoke event. Smoke events have
   `kind=sentry_source_map_smoke` or `message_type=sentry_runtime_smoke`.
2. Check `environment` first: only `production` events come from store
   installs. Then check `release`, `dist`, `extension_version`, and
   `runtime_revision`.
   If the issue only affects a newly submitted version, treat it as a release
   regression.
3. Check `kind`:
   - `prompt_failed`: user-visible prompt failure after the runtime caught an
     error.
   - `runtime_exception`: direct runtime exception captured by diagnostics.
   - `explicit_error_report`: user clicked "Send anonymized error report" after
     a failed turn.
   - `uncaught`: an uncaught error or unhandled rejection in the service
     worker, caught by Sentry's global handlers.
   - `message_type=page:<page>` on a `runtime_exception`: an uncaught error on
     one of Onhand's pages, such as `page:sidepanel`.
4. Check provider tags (`auth_mode`, `ai_provider`, `ai_model`) to distinguish
   free-tier, direct API key, and Codex sign-in failures.
5. Check the `onhand` context counts. High `final_tool_failure_count` points to
   browser/PDF tool reliability. High `tool_step_count` with no final failures
   usually means the tool loop recovered.
6. If the issue is free-tier related, run:

```sh
npm run ops:free-tier:check
```

Privacy checks for every real issue:

- No prompts or user instructions.
- No page text, selected text, URLs, page titles, screenshots, transcripts, or
  saved session data.
- No API keys, access tokens, file URLs, local user paths, or Chrome extension
  IDs.
- No Sentry `user` identity or IP-derived `user.geo` data.
- Stack frames should use `app:///onhand-runtime.bundle.js` and resolve through
  uploaded source maps.

If any privacy check fails, stop normal triage and fix the scrubber before
using the event for debugging.

## Sentry Project

Project slug: `onhand-browser-extension`

Public DSN used by the extension:

```text
https://f08b1742f4020abed600bca50fbb7458@o4511248777478144.ingest.us.sentry.io/4511565377110016
```
