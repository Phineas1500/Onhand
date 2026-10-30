---
title: "Support — Onhand"
description: "Support, setup, and troubleshooting for the Onhand browser extension."
url: https://useonhand.com/support.html
---

# Support

Setup, common browser issues, and where to report bugs.

[Install](https://useonhand.com/support.html#install) [Sign in](https://useonhand.com/support.html#auth) [Voice](https://useonhand.com/support.html#voice) [PDFs](https://useonhand.com/support.html#pdfs) [Report a bug](https://useonhand.com/support.html#report) [Support development](https://useonhand.com/support.html#development)

## Install Onhand

Onhand is live on the Chrome Web Store. The store currently serves **the latest version** and updates through Chrome.

1.  Open the [Chrome Web Store listing](https://chromewebstore.google.com/detail/ogjmncmkpgdkkcibdiacmagaehjohljb).
2.  Click **Add to Chrome** and confirm the install prompt. A [welcome page](https://useonhand.com/welcome.html) opens with these steps.
3.  Pin Onhand: click the puzzle-piece Extensions button at the top right of Chrome, then the pin next to Onhand.
4.  Open a normal web page and click the Onhand icon, or press `Ctrl+Shift+Space` (`⌘+Shift+Space` on a Mac), to open the side panel.
5.  Pick how Onhand runs in the panel: Onhand Free, ChatGPT sign-in, or a provider API key.

If you prefer a manual install or need a specific release artifact, download the latest ZIP from [GitHub releases](https://github.com/Phineas1500/Onhand/releases/latest), unzip it, and load it from `chrome://extensions` with developer mode enabled.

## Sign in or add a key

The side panel asks the first time you use Onhand. You can change it anytime on the Onhand options page:

-   **Onhand Free:** no account or API key. Daily usage is capped and anonymous diagnostics are required.
-   **ChatGPT sign-in:** sign in with your ChatGPT Plus or Pro account instead of using an API key.
-   **Provider API key:** use your own OpenAI, Anthropic, Gemini, or OpenRouter key. An OpenAI platform API key also enables Voice.

If Onhand says credentials are missing, open the options page and choose Onhand Free, sign in again, or paste your key. Options save as you change them, so you can ask again right away.

## Voice

Press **Voice** in the side panel to talk with Onhand. It answers aloud and hands questions about the page to your chosen model. Voice needs an OpenAI platform API key, and your browser and macOS both need microphone access.

-   If Chrome never reaches listening, check the site microphone permission and macOS Privacy & Security settings.
-   If Voice cannot start, confirm Voice is enabled and an OpenAI platform API key is saved in Onhand options.
-   If voice works in one Chromium browser but not another, switch the microphone device in that browser and reload the extension.

## PDFs and visual pages

Onhand works best when it can read page text directly. For PDFs, use the Onhand PDF viewer path when available. For equations, charts, and diagrams, Onhand may use a visible-region capture to ground the answer.

## Report a bug

Please open a GitHub issue with the browser, page type, what you asked Onhand to do, and any visible error message.

If a failed Onhand reply shows **Send anonymized error report**, click it and include the returned report id in your issue. The report excludes prompts, page content, URLs, screenshots, transcripts, saved sessions, and keys.

[Open a GitHub issue ↗](https://github.com/Phineas1500/Onhand/issues/new)

## Support development

If Onhand is useful to you, GitHub Sponsors helps support ongoing development and the hosted Onhand Free path.

[Support on GitHub Sponsors ↗](https://github.com/sponsors/Phineas1500)

Onhand

[Home](https://useonhand.com/) · [Privacy](https://useonhand.com/privacy.html) · [GitHub](https://github.com/Phineas1500/Onhand) · [Sponsor](https://github.com/sponsors/Phineas1500) · © 2026

Also on [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/onhand-ai/) · [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/icbhigkjjhkcheejmdfkfhiljnkommoj) · [AlternativeTo](https://alternativeto.net/software/onhand/) · [PeerPush](https://peerpush.com/p/onhand) · [Product Hunt](https://www.producthunt.com/products/onhand-2) · [EasyWithAI](https://easywithai.com/ai-research-tools/onhand/) · [SaaSHub](https://www.saashub.com/useonhand)
