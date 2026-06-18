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
- Stack-frame URLs from the extension are normalized to
  `app:///onhand-runtime.bundle.js` so source maps can be matched without
  exposing the Chrome extension ID.

## Release Naming

The browser runtime sends:

- `release`: `onhand-extension@<manifest version>`
- `dist`: `chrome`
- `environment`: `production`

For version `0.3.6`, the release is `onhand-extension@0.3.6`.

## Alerts

Create or refresh the project alert rules with:

```sh
npm run sentry:alerts
npm run sentry:alerts -- --apply
```

The command defaults to dry-run. `--apply` writes these issue-alert rules:

- `Send a notification for high priority issues`: updates the default high
  priority rule so source-map and runtime smoke events do not page/email.
- `Onhand: new extension error (non-smoke)`: emails issue owners, falling back
  to recently active members, when a new non-smoke error issue is created.
- `Onhand: regression or burst (non-smoke)`: emails on regressions, reappeared
  issues, or an issue seen more than 5 times in 1 hour.

All rules filter to Sentry error issues and exclude:

- `kind=sentry_source_map_smoke`
- `message_type=sentry_runtime_smoke`

Alert setup uses `SENTRY_ALERT_AUTH_TOKEN` when present, then falls back to
`SENTRY_SMOKE_AUTH_TOKEN`, then `SENTRY_AUTH_TOKEN`. Use a token with Sentry
alert-rule read/write access, for example Project read plus Alerts write/admin.
Tokens with only `event:read` and `project:read` can dry-run rule setup but
cannot apply alert changes.

Before relying on Sentry for production crash reporting, enable Sentry's
project-side setting that prevents storing client IP addresses / IP-derived
location data, or route Sentry envelopes through an Onhand-owned tunnel. The
Onhand SDK strips `event.user`, but Sentry can still derive `user.geo` from the
HTTP request unless project-side IP storage prevention is enabled.

## Source Maps

Source maps are upload-only artifacts. They are generated under
`tmp/sentry-sourcemaps/`, uploaded to Sentry, and ignored by git. They are not
packaged into the Chrome extension.

Required environment variables:

```sh
export SENTRY_ORG=<org-slug>
export SENTRY_PROJECT=onhand-browser-extension
export SENTRY_AUTH_TOKEN=<token-with-project-read-write-and-release-admin>
export SENTRY_SMOKE_AUTH_TOKEN=<optional-token-with-project-event-read>
export SENTRY_ALERT_AUTH_TOKEN=<optional-token-with-alert-rule-read-write>
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

Dry-run the upload flow:

```sh
npm run build:extension
npm run sentry:sourcemaps -- --dry-run
```

Upload for the current manifest version:

```sh
npm run build:extension
npm run sentry:sourcemaps
npm run sentry:smoke
npm run sentry:runtime-smoke
```

The upload script builds a temporary `onhand-runtime.bundle.js` plus
`onhand-runtime.bundle.js.map`, then verifies that the temporary JS matches the
shipped `packages/browser-extension/onhand-runtime.bundle.js` after removing
the source-map comment. If that check fails, rebuild the extension before
uploading.

The smoke script sends one synthetic event with a frame at
`app:///onhand-runtime.bundle.js`, then polls Sentry until that frame resolves
to `packages/browser-extension/src/browser-runtime.ts`.

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
npm run sentry:sourcemaps -- --release=onhand-extension@0.3.6
npm run sentry:sourcemaps -- --org=ramaway --project=onhand-browser-extension
npm run sentry:sourcemaps -- --url-prefix=app:///
npm run sentry:runtime-smoke -- --timeout-ms=120000
```

## Triage Runbook

When a Sentry alert fires:

1. Confirm it is not a smoke event. Smoke events have
   `kind=sentry_source_map_smoke` or `message_type=sentry_runtime_smoke`.
2. Check `release`, `dist`, `extension_version`, and `runtime_revision` first.
   If the issue only affects a newly submitted version, treat it as a release
   regression.
3. Check `kind`:
   - `prompt_failed`: user-visible prompt failure after the runtime caught an
     error.
   - `runtime_exception`: direct runtime exception captured by diagnostics.
   - `explicit_error_report`: user clicked "Send anonymized error report" after
     a failed turn.
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
