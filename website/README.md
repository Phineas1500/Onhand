# Onhand — landing site

Static landing page. No build step. This directory is self-contained:

- `index.html` — the landing page
- `privacy.html` — privacy policy URL for Chrome Web Store submission
- `support.html` — support and troubleshooting page
- `404.html` — fallback page
- `style.css` — Ramaway Dawn (auto dark via `prefers-color-scheme`, manual override via `data-theme` attribute + theme toggle in nav)
- `site.js` — Chrome Web Store URL, release metadata, analytics events, theme toggle persistence

Plus assets:

- `fonts/`        — New York + Ioskeley Mono (self-hosted, no CDN)
- `icons/`        — Onhand manicule favicon at 128/48 + source SVG
- `screenshots/`  — promo screenshot used in the hero

## Deploy

Upload the whole `website/` directory to any static host. Examples:

```sh
# Netlify
netlify deploy --prod --dir=website

# Vercel
vercel --prod website

# GitHub Pages — push website/ contents to a gh-pages branch
# Cloudflare Pages — point build output to ./website

# Or just a plain bucket:
aws s3 sync website/ s3://onhand-site/ --acl public-read
```

`404.html` is included at the root so most hosts pick it up automatically.

## What to customize

- **Store URL and live version:** `site.js`, the `ONHAND_STORE` values near the top of the file. These drive the Chrome Web Store links and the approved store version labels. Run `npm run website:sync-store` from the repository root to refresh the live store version from Google's update endpoint and bump the `site.js` cache busters, or `npm run website:check-store` to fail when the site is stale.
- **Automatic store sync:** `.github/workflows/sync-chrome-store-version.yml` runs every six hours and can be triggered manually from GitHub Actions. It commits only when the live Chrome Web Store version differs from the website.
- **Release version:** `site.js`, the `ONHAND_RELEASE.version` value near the top of the file. This drives the visible GitHub release version badges, the release ZIP filename, and the GitHub release/download URLs. Run `npm run website:sync-release` from the repository root to refresh the latest GitHub release and bump the `site.js` cache busters, or `npm run website:check-release` to fail when the site is stale.
- **Automatic release sync:** `.github/workflows/sync-github-release-version.yml` runs every six hours and can be triggered manually from GitHub Actions. It commits only when the latest GitHub release differs from the website.
- **Hero copy:** `index.html`, sections starting at `<h1 class="hero-h1">`.
- **Feature card text:** `index.html`, the four `<div class="feat">` blocks.
- **Add to Chrome link:** generated from `ONHAND_STORE.url` for elements with `data-onhand-store-link`.
- **Open Graph image:** `<meta property="og:image">` — currently the attention screenshot. Replace with a 1200×630 dedicated card when you have one.

## Analytics events

The site uses Google Analytics 4 (`G-JQ159C5BGF`) and Umami. Custom conversion events are defined in `site.js` under `ONHAND_ANALYTICS` and fired to both backends with the same event name.

| Event name | Intent | Hook attribute | GA category |
|------------|--------|----------------|-------------|
| `chrome_store_click` | Chrome Web Store install | `data-onhand-store-link` | `install` |
| `download_zip_click` | Manual ZIP download / load unpacked | `data-onhand-release-download` | `release` |
| `github_source_click` | View repo / build from source | `data-onhand-source-link` | `source` |

Tracked elements also receive `data-onhand-analytics-event` with the event name for inspection in DevTools.

Verify locally with `npm run website:verify-analytics`.

## Asset replacement

If the brand mark changes, replace `icons/onhand-128.png` and `icons/onhand-48.png` (and the SVG). The CSS uses the unicode ☞ glyph for everything *except* the favicon and the small mark in the nav, so the rest of the page picks up symbol-font rendering automatically.

The promo screenshot can be swapped in `screenshots/promo/attention-screenshot.png` at any time — the page sizes it responsively.

## License

Apache 2.0, same as the rest of the Onhand project. New York and Ioskeley Mono are bundled under their respective licenses (verify before public distribution if you're concerned).
