# Onhand — landing site

Static landing page. No build step. This directory is self-contained:

- `index.html` — the landing page
- `privacy.html` — privacy policy URL for Chrome Web Store submission
- `support.html` — support and troubleshooting page
- `404.html` — fallback page
- `style.css` — Ramaway Dawn (auto dark via `prefers-color-scheme`, manual override via `data-theme` attribute + theme toggle in nav)
- `site.js` — theme toggle persistence, copy-install-button

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

- **Version badge:** `index.html`, the `<span class="tag">v0.2.0 · early access</span>` near the top of the hero.
- **Hero copy:** `index.html`, sections starting at `<h1 class="hero-h1">`.
- **Feature card text:** `index.html`, the four `<div class="feat">` blocks.
- **Add to Chrome link:** currently anchors to `#install` (since the store listing isn't live yet). When the Chrome Web Store listing ships, swap the two `href="#install"` instances on `.btn-primary` and `.nav-cta` for the Web Store URL.
- **Open Graph image:** `<meta property="og:image">` — currently the attention screenshot. Replace with a 1200×630 dedicated card when you have one.

## Asset replacement

If the brand mark changes, replace `icons/onhand-128.png` and `icons/onhand-48.png` (and the SVG). The CSS uses the unicode ☞ glyph for everything *except* the favicon and the small mark in the nav, so the rest of the page picks up symbol-font rendering automatically.

The promo screenshot can be swapped in `screenshots/promo/attention-screenshot.png` at any time — the page sizes it responsively.

## License

Apache 2.0, same as the rest of the Onhand project. New York and Ioskeley Mono are bundled under their respective licenses (verify before public distribution if you're concerned).
