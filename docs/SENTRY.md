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

For version `0.3.4`, the release is `onhand-extension@0.3.4`.

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
```

The upload script builds a temporary `onhand-runtime.bundle.js` plus
`onhand-runtime.bundle.js.map`, then verifies that the temporary JS matches the
shipped `packages/browser-extension/onhand-runtime.bundle.js` after removing
the source-map comment. If that check fails, rebuild the extension before
uploading.

The smoke script sends one synthetic event with a frame at
`app:///onhand-runtime.bundle.js`, then polls Sentry until that frame resolves
to `packages/browser-extension/src/browser-runtime.ts`.

Useful overrides:

```sh
npm run sentry:sourcemaps -- --release=onhand-extension@0.3.4
npm run sentry:sourcemaps -- --org=ramaway --project=onhand-browser-extension
npm run sentry:sourcemaps -- --url-prefix=app:///
```

## Sentry Project

Project slug: `onhand-browser-extension`

Public DSN used by the extension:

```text
https://f08b1742f4020abed600bca50fbb7458@o4511248777478144.ingest.us.sentry.io/4511565377110016
```
