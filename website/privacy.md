---
title: "Privacy Policy — Onhand"
description: "Privacy policy for Onhand, a contextual browser extension for page-grounded learning and research."
url: https://useonhand.com/privacy.html
---

# Privacy Policy

Onhand is a browser extension that helps you ask questions about the page you are reading. Sessions stay on your device, and content only goes to an AI provider when you ask Onhand to help.

Last updated: October 29, 2026

[Summary](https://useonhand.com/privacy.html#summary) [Analytics and diagnostics](https://useonhand.com/privacy.html#analytics) [Data Onhand handles](https://useonhand.com/privacy.html#data) [Local storage](https://useonhand.com/privacy.html#storage) [AI providers](https://useonhand.com/privacy.html#providers) [Retention and security](https://useonhand.com/privacy.html#retention) [Permissions](https://useonhand.com/privacy.html#permissions) [Your choices](https://useonhand.com/privacy.html#choices) [Contact](https://useonhand.com/privacy.html#contact)

## Summary

Onhand does not sell personal information and does not operate a hosted user account database. The extension stores its settings, provider configuration, anonymous free-tier token, and saved study sessions in the extension's local storage (`chrome.storage.local` and IndexedDB) on your device.

When you ask Onhand a question, the extension starts with the active page. It may rank metadata (titles and URLs) from eligible open tabs and read clearly related tabs when they can help answer your request; unrelated tabs are not read merely because they are open. The extension may send relevant page content from the active page or those related sources, your prompt, selected text, screenshots, voice input, or a generated transcript to the AI provider you configured so the model can answer in context.

## Analytics and diagnostics

The public Onhand website uses Google Analytics and Umami to understand aggregate site traffic, such as page views, referrers, browser/device information, and approximate location derived from network data.

These website analytics tools are separate from the Onhand browser extension. Onhand does not send extension prompts, page content, voice input, transcripts, saved sessions, highlights, notes, or provider credentials to Google Analytics or Umami.

The homepage's demo video is hosted on YouTube. The page shows its preview image from YouTube's image server, and the video player loads from youtube-nocookie.com only when you press play; YouTube's privacy policy covers what happens in the player.

After you install Onhand from the Chrome Web Store, it opens a welcome page on this website once. Like the rest of the site, that page uses these website analytics tools.

The extension also includes anonymous diagnostics. Diagnostics are required when you use Onhand Free because Onhand hosts the model endpoint, and are optional for other authentication modes. In Chrome and Edge they are off by default in those modes; you can turn them on with the checkbox when you first set up Onhand, or anytime in Onhand's options. Onhand may send event names, extension version, runtime revision, selected provider/model category, coarse error categories, and aggregate counts to the Onhand free-tier Worker for reliability, cost, quota, and abuse monitoring. The hosted Worker may use your request IP address for short-lived daily rate limits and may record aggregate network metadata such as country, Cloudflare data center, and user-agent family for operations. When diagnostics are enabled, Onhand may also send redacted crash and exception events to Sentry for issue grouping and stack-trace analysis. Diagnostics do not include prompts, page content, URLs, screenshots, saved sessions, transcripts, or keys. If advanced runtime inspection is used, diagnostics may record only that the constrained JavaScript tool started, succeeded, or failed; they never include the JavaScript expression or page data returned.

In Firefox, Firefox asks whether to share technical data when you install Onhand, and you can change that choice in about:addons under Onhand's Permissions and data. That choice decides whether Onhand sends diagnostics, in every mode including Onhand Free, which works either way. Firefox versions of Onhand do not include advanced runtime inspection.

If Onhand shows an error, you may also choose to send a one-time anonymized error report even when diagnostics are off. Error reports include a redacted error message and stack trace, extension version, runtime revision, selected provider/model category, coarse error category, tool activity names/states, and aggregate counts. They do not include prompts, page content, URLs, page titles, screenshots, saved sessions, transcripts, or keys. The same redacted error may be sent to Sentry so repeated failures can be grouped by release.

## Data Onhand handles

-   Questions and instructions you type into the Onhand side panel.
-   Voice input and transcripts when you start a voice call.
-   Visible page text, selected passages, headings, URLs, and page titles from the active page and any clearly related open source Onhand inspects for the request.
-   Metadata such as titles and URLs from eligible open tabs, included with each request to rank potentially relevant sources before any related tab content is read.
-   Personal communications if you choose to use Onhand on pages such as webmail, chat, or messaging apps.
-   Optional screenshots or visible-region captures used for visual grounding.
-   Highlights, margin notes, saved sessions, and replay artifacts.
-   OpenAI Codex sign-in state or provider API keys if you choose to save them.
-   An anonymous Onhand Free token, request IP-derived rate-limit counters, and aggregate location/network metadata if you choose Onhand Free or send diagnostics/error reports.

## Local storage

Onhand saves extension settings, provider configuration, sessions, highlights, notes, transcripts, and captured artifacts locally in browser extension storage. Removing the extension or clearing its extension storage removes this local data.

Onhand does not intentionally upload saved sessions to an Onhand server. Provider credentials are stored by the extension so it can make user-requested model calls. The Onhand Free anonymous token is stored locally so the hosted Worker can enforce daily usage caps without requiring an account.

## AI providers

Onhand uses the provider you configure in the extension options page. Current modes include OpenAI Codex sign-in, direct provider API key calls for OpenAI, Anthropic, Google Gemini, and OpenRouter, OpenAI GPT-Live voice (which uses your saved OpenAI platform API key), and Onhand Free.

In direct-provider modes, the extension sends the content needed for your request to the provider you configured. When that provider is OpenAI (Codex sign-in or an OpenAI API key) and you have saved an OpenAI platform API key, Onhand also sends your request text and the open page's title and URL to OpenAI's Decisions API with that key, to decide quickly how to handle the request (for example, whether it is about the open page). Page content is not included. In Onhand Free mode the same request goes to the Decisions API through Onhand's Cloudflare Worker. With any other provider, the configured model makes that decision instead. In voice calls, Onhand also sends each spoken request Live hands it, with the open page's title, the PDF page number, and recent conversation, to the Decisions API with your platform key, to recognize simple page commands such as "next page". In Onhand Free mode, the extension sends the content needed for your request to Onhand's Cloudflare Worker, which forwards the model request directly to OpenAI's official API (GPT-6 Luna). OpenAI doesn't offer its API in Hong Kong or Macau, so for requests from there the Worker sends the model request through OpenRouter to DeepSeek V4.1 Flash instead. It is restricted to US-based hosts that OpenRouter lists as not collecting prompts, and the Decisions request is skipped. The hosted Worker streams the response and enforces quota limits; it does not store prompts, page content, screenshots, transcripts, or model responses as part of normal chat handling.

Content sent to an AI provider or to Onhand Free is handled under the relevant provider's terms and privacy policy. This may include content from clearly related tabs Onhand automatically inspects for the request in any mode. Do not use Onhand with open pages whose relevant contents you do not want sent to your configured provider or, for Onhand Free, through the hosted Onhand Worker.

## Retention and security

Local sessions, highlights, notes, transcripts, screenshots, API keys, and provider settings remain in browser extension storage until you delete them or uninstall the extension.

Onhand Free stores anonymous tokens and short-lived quota or abuse counters in Cloudflare storage, including daily counters based on the request IP address for registration, diagnostics, and explicit error report rate limits. Aggregate operations events may include country, Cloudflare data center, and user-agent family. Explicit anonymized error reports are stored for up to 90 days under a report id so they can be inspected for support and reliability work. Redacted Sentry crash and exception events are retained according to the Sentry project retention settings.

Extension-to-provider and extension-to-Onhand Free requests use HTTPS. Onhand does not sell user data, use extension content for advertising, or share extension prompts, page content, screenshots, transcripts, saved sessions, or keys with website analytics services.

## Browser permissions

Onhand requests browser permissions so it can work inside the page you are reading. These permissions support the side panel, active-tab reading, page annotation, PDF support, page screenshots, navigation, and user-invoked browser tools.

The extension uses powerful browser APIs, including debugging and scripting APIs, because Onhand needs to inspect and annotate the page directly. The extension should be used only when you want this page-grounded assistance.

## Your choices

-   You choose when to open the side panel and ask Onhand a question.
-   You choose when to start or stop a voice call.
-   You choose your authentication mode: Onhand Free, OpenAI Codex sign-in, or a provider API key.
-   You can disable anonymous diagnostics unless you are using Onhand Free.
-   You can disable advanced runtime inspection to prevent model-requested JavaScript inspection on active pages.
-   You choose whether to send a one-time anonymized error report after an Onhand error.
-   You can delete saved sessions from the extension UI or by clearing extension storage.
-   You can remove provider credentials from the Onhand options page.
-   You can uninstall the extension at any time from your browser's extensions page.

## Contact

For privacy questions or support requests, open an issue in the [Onhand GitHub repository](https://github.com/Phineas1500/Onhand/issues).

Onhand

[Home](https://useonhand.com/) · [Support](https://useonhand.com/support.html) · [GitHub](https://github.com/Phineas1500/Onhand) · [Sponsor](https://github.com/sponsors/Phineas1500) · © 2026

Also on [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/onhand-ai/) · [AlternativeTo](https://alternativeto.net/software/onhand/) · [PeerPush](https://peerpush.com/p/onhand) · [Product Hunt](https://www.producthunt.com/products/onhand-2) · [EasyWithAI](https://easywithai.com/ai-research-tools/onhand/) · [SaaSHub](https://www.saashub.com/useonhand)
