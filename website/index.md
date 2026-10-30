---
title: "Onhand: AI reading assistant for webpages and PDFs"
description: "Onhand is a free AI Chrome extension for reading webpages, PDFs and research papers. Ask a question and it highlights the answer right on the page."
url: https://useonhand.com/
---

# A reading companion that *points.*

Onhand is an AI Chrome extension for reading webpages and PDFs. Ask about the page you're reading, and it highlights the answer, leaves a note in the margin, and explains it in the side panel.

[Add to Chrome](https://chromewebstore.google.com/detail/ogjmncmkpgdkkcibdiacmagaehjohljb) [View on GitHub ↗](https://github.com/Phineas1500/Onhand)

Free to start. No account needed. Open source. Also on [Firefox](https://addons.mozilla.org/firefox/addon/onhand-ai/) and [Edge](https://microsoftedge.microsoft.com/addons/detail/icbhigkjjhkcheejmdfkfhiljnkommoj).

> The **manicule**, a small pointing hand in the margin, has meant *"look here, this part matters"* in books since the twelfth century. Onhand brings the gesture back, with the model holding the pen.

## Four ways it helps you read.

Onhand stays out of the way until you ask.

### Points to the answer

Highlights the exact phrase or paragraph that answers your question and scrolls it into view.

### Leaves a note in the margin

Adds a sentence or two beside the highlight, so you can keep reading without losing your place.

### Picks up where you left off

Every session is saved with its highlights, notes, and answers. Come back tomorrow and reopen it as you left it.

### Talk it through

Turn on Voice in Onhand's options (it needs an OpenAI API key), then press Voice in the side panel and talk about what you're reading. Onhand answers aloud and marks the page as it goes. [Watch an early voice demo ↗](https://useonhand.com/videos/onhand-realtime-audio.mp4)

## Watch it fact-check a textbook.

A real session: Onhand checks a physics textbook's account of the Tacoma Narrows Bridge collapse, highlights the claim that doesn't hold up, and finds the 1991 paper on why so many textbooks get it wrong.

[Watch the demo video: Fact-checking my physics textbook with AI (Tacoma Narrows Bridge)](https://www.youtube.com/watch?v=bdaY4gJIGsY)

## Up and running in a minute.

1.  **Add Onhand to Chrome** from the Chrome Web Store.
2.  **Pin it**, open any page, and click the Onhand icon.
3.  Pick how it runs in the panel: Onhand Free (no account needed), your ChatGPT plan, or your own API key. Then ask a question.

[Add to Chrome](https://chromewebstore.google.com/detail/ogjmncmkpgdkkcibdiacmagaehjohljb)

Or [download the ZIP](https://github.com/Phineas1500/Onhand/releases/latest), unzip it, and load it from `chrome://extensions` with developer mode on. [Release notes ↗](https://github.com/Phineas1500/Onhand/releases/latest)

On Firefox or Edge? Get Onhand from [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/onhand-ai/) or [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/icbhigkjjhkcheejmdfkfhiljnkommoj).

Build from source

```
# Clone and build
$ git clone https://github.com/Phineas1500/Onhand
$ cd Onhand
$ npm ci
$ npm run build:extension
# Verify the build
$ npm run smoke:browser-runtime
Browser runtime smoke: PASS
# Then load packages/browser-extension unpacked from chrome://extensions
```

**Open source under Apache 2.0.** Sessions stay on your device, and your API keys are stored only in your browser. Onhand Free sends requests through Onhand's server to OpenAI, with anonymous diagnostics for reliability and abuse prevention. [Privacy details](https://useonhand.com/privacy.html)

## Small, auditable tools.

Onhand works through a fixed set of browser tools: reading and searching pages, working with PDFs, highlighting, and clicking or typing when you ask. Each one is a single operation on a specific tab, and the side panel shows every step. The [Onhand constitution](https://github.com/Phineas1500/Onhand/blob/main/docs/ONHAND_CONSTITUTION.md) explains the principles behind them.

See all 37 tools

##### Read & search

-   browser\_extract\_content
-   browser\_get\_visible\_text
-   browser\_get\_selection
-   browser\_get\_viewport\_headings
-   browser\_get\_scroll\_state
-   browser\_get\_visible\_region\_image
-   browser\_get\_dom
-   browser\_textbook\_search
-   browser\_find\_citation

##### PDF research

-   browser\_search\_linked\_pdf\_corpus
-   browser\_pdf\_search
-   browser\_pdf\_read\_pages
-   browser\_pdf\_jump\_to\_page
-   browser\_pdf\_capture\_page\_image
-   browser\_pdf\_find\_citation
-   browser\_open\_pdf\_in\_onhand\_viewer

##### Annotate & navigate

-   browser\_highlight\_text
-   browser\_show\_note
-   browser\_scroll\_to\_annotation
-   browser\_clear\_annotations
-   browser\_list\_tabs
-   browser\_activate\_tab
-   browser\_navigate

##### Act & interact

-   browser\_click
-   browser\_type
-   browser\_click\_text
-   browser\_type\_by\_label
-   browser\_find\_elements
-   browser\_wait\_for\_selector
-   browser\_pick\_elements

##### Debug & capture

-   browser\_capture\_screenshot
-   browser\_capture\_state
-   browser\_list\_artifacts
-   browser\_restore\_state
-   browser\_collect\_console
-   browser\_collect\_network
-   browser\_run\_js (optional, constrained)

## Common questions.

### Is Onhand free?

Yes. Onhand is free and open source under Apache 2.0. Onhand Free needs no account or API key and has a daily limit. For more, sign in with your ChatGPT plan or use your own OpenAI, Anthropic, Google Gemini or OpenRouter API key.

### Does Onhand work with PDFs and research papers?

Yes. Onhand opens PDFs in its own viewer, so it can highlight passages and leave notes on them the same way it does on webpages. Ask what a reference like \[14\] says, and Onhand looks up the cited paper, opens it, and answers from it.

### How is Onhand different from ChatGPT?

With a chatbot, you paste text in and read the answer somewhere else. Onhand works on the page you already have open: it highlights the passages it used and leaves short notes beside them, so you can check each point against the source.

### Can Onhand help me study?

Turn on Learning in the side panel and Onhand tutors instead of handing you the answer: it asks guiding questions, points to hints on the page, and quizzes you on what you're reading.

### Does it work on every website?

It works on articles, docs, course pages and PDFs. Chrome doesn't let extensions read its own pages, such as the Chrome Web Store or the new tab page.

### What does Onhand send, and where?

Onhand starts with the page you ask about and may read clearly related open tabs. It sends your question and the relevant page content to the AI provider you chose; with Onhand Free, that goes through Onhand's server to OpenAI. Saved sessions stay in your browser. [Privacy details](https://useonhand.com/privacy.html)

Guides: [Chat with a PDF in Chrome](https://useonhand.com/chat-with-pdf-chrome.html) · [AI research paper reader](https://useonhand.com/ai-research-paper-reader.html) · [AI study quizzes](https://useonhand.com/ai-study-quiz-extension.html)  
Compare: [ChatPDF](https://useonhand.com/chatpdf-alternative.html) · [NotebookLM](https://useonhand.com/notebooklm-alternative.html) · [Sider](https://useonhand.com/sider-alternative.html) · [SciSpace](https://useonhand.com/scispace-alternative.html) · [Sidenote](https://useonhand.com/sidenote-alternative.html)

Onhand

[GitHub](https://github.com/Phineas1500/Onhand) · [Docs](https://github.com/Phineas1500/Onhand/tree/main/docs) · [Sponsor](https://github.com/sponsors/Phineas1500) · [Apache 2.0](https://github.com/Phineas1500/Onhand/blob/main/LICENSE) · [Privacy](https://useonhand.com/privacy.html) · [Support](https://useonhand.com/support.html) · themed on *Rosé Pine Dawn* · © 2026

Also on [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/onhand-ai/) · [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/icbhigkjjhkcheejmdfkfhiljnkommoj) · [AlternativeTo](https://alternativeto.net/software/onhand/) · [PeerPush](https://peerpush.com/p/onhand) · [Product Hunt](https://www.producthunt.com/products/onhand-2) · [EasyWithAI](https://easywithai.com/ai-research-tools/onhand/) · [SaaSHub](https://www.saashub.com/useonhand)
