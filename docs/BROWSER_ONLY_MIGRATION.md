# Browser-Only Onhand Migration

This document records the browser-only migration. Onhand now uses the browser extension as the product surface and runtime. The Electron launcher, localhost browser bridge, and pi-extension bridge adapter have been removed.

## Implemented On This Branch

- Added a browser-bundled Pi runtime in `packages/browser-extension/src/browser-runtime.ts`.
- Added `npm run build:extension`, which bundles the runtime to `packages/browser-extension/onhand-runtime.bundle.js`.
- Routed side-panel state, prompt, session, stop, learning-mode, and page-action messages to the in-extension runtime instead of the localhost Onhand API.
- Added extension options for OpenAI Codex OAuth and OpenAI API-key auth.
- Added browser-side OAuth for OpenAI Codex credentials, defaulting to `openai-codex` / `gpt-5.5`.
- Removed the legacy bridge options UI, token configuration, WebSocket client, Electron desktop app, localhost bridge server, pi-extension bridge adapter, tmux helper, and bridge-based smoke scripts.

## Current Topology

Onhand currently has two runtime pieces:

- `packages/browser-extension/background.js`: the browser-control implementation, side-panel message router, runtime host, tab state, `chrome.debugger`, `chrome.scripting`, annotations, screenshots, side panel open/close, and artifact operations.
- `packages/browser-extension/src/browser-runtime.ts`: the browser-bundled Pi runtime, Onhand prompt policy, session list/switch/rename/restore, event-to-UI state mapping, and browser `AgentTool` definitions.

Node is now only used for development scripts such as bundling, fixture serving, and deterministic smoke tests.

## Sitegeist Takeaways

Sitegeist is the closest known reference for this direction:

- It is a Chrome/Edge side-panel extension, not an Electron app.
- It uses Pi's lower-level browser-usable packages (`@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, and `@mariozechner/pi-web-ui`) rather than embedding `@mariozechner/pi-coding-agent` as a Node SDK.
- Its manifest includes extension-native capabilities we would need or already use: `sidePanel`, `userScripts`, `webNavigation`, `debugger`, `declarativeNetRequest`, extension-page CSP, and a sandbox page.
- It treats browser tools as extension-native tools. Navigation, debugger access, user selection, and page interaction happen directly through Chrome APIs instead of a local WebSocket relay.

The useful lesson is architectural, not code-level. Sitegeist is AGPL-3.0, so Onhand should avoid copying implementation. The migration should use the same shape: browser-hosted Pi agent core plus extension-native tools.

## Target Architecture

```text
Onhand Browser Extension
├── Side panel UI
│   ├── prompt input
│   ├── streaming answer
│   ├── session list
│   ├── page actions
│   └── settings
│
├── Runtime host
│   ├── Pi Agent from @mariozechner/pi-agent-core
│   ├── model/provider selection from @mariozechner/pi-ai
│   ├── Onhand system prompt and learning-mode prompt
│   ├── event-to-UI state reducer
│   └── stop/steer/follow-up controls
│
├── Browser tools
│   ├── tab/window state
│   ├── navigation
│   ├── readable extraction
│   ├── highlighting and notes
│   ├── screenshots
│   ├── console/network/debugger inspection
│   └── interactive element picker
│
└── Extension storage
    ├── sessions
    ├── settings
    ├── artifacts
    ├── page captures
    └── import/export payloads
```

The side panel message names remain stable where possible. `background.js` calls the in-extension runtime controller directly.

## Runtime Placement

The safest runtime host is likely the side panel or an offscreen document, not the MV3 service worker alone.

Reasons:

- Long-running streaming LLM calls and tool loops are a poor fit for a service worker that Chrome can suspend.
- The side panel is open during normal use and can hold long-lived UI state.
- An offscreen document is already used for keepalive. It can become the long-lived runtime context if we need agent execution to continue while the side panel is hidden.
- The background service worker should stay as a router for Chrome events, tab state, and APIs that naturally live there.

Current placement:

1. The runtime controller is created by the background service worker.
2. The offscreen document is kept for MV3 runtime liveness.
3. Browser API calls stay in background command handlers and are exposed to the runtime as browser `AgentTool` calls.

## Pi Package Strategy

Onhand does not browser-bundle `@mariozechner/pi-coding-agent`.

That package currently pulls in Node-oriented session/resource/settings layers, filesystem tools, TUI pieces, and extension loading behavior that are unnecessary in a browser extension. Instead:

- Use `@mariozechner/pi-agent-core` for the stateful agent loop, tool execution, streaming events, steering, and abort handling.
- Use `@mariozechner/pi-ai` for provider/model calls. Browser contexts must pass API keys or refreshed direct sign-in access tokens explicitly.
- Recreate the small Onhand-specific subset currently supplied by `createAgentSession`, `SessionManager`, `SettingsManager`, and `DefaultResourceLoader`.

This means Onhand owns browser session persistence rather than relying on Pi's Node filesystem-backed session manager.

## Tool Migration

The browser tool migration is complete for the current browser-grounded MVP:

1. Command handlers in `packages/browser-extension/background.js` remain the browser-control source of truth.
2. Browser `AgentTool` definitions in `packages/browser-extension/src/browser-runtime.ts` call those handlers directly.
3. Public tool names remain stable for prompt continuity.
4. Browser artifacts are stored in extension storage/IndexedDB fallback logic.
5. `packages/pi-extension` has been deleted.

## Storage Migration

Removed Node-side paths:

- `.onhand/sessions/desktop/`
- `.onhand/settings.json`
- `.onhand/artifacts/browser/`
- `~/.config/pi-browser-bridge/config.json`

Browser replacements:

- `chrome.storage.local` for small settings, provider configuration, current session metadata, and lightweight UI state.
- IndexedDB for session transcripts, artifact manifests, page captures, screenshots, and import/export bundles.
- Optional OPFS for large blob-like artifacts if IndexedDB becomes awkward for screenshots or saved HTML.

The session model should be explicit JSON records rather than Pi JSONL files:

```json
{
  "id": "session_...",
  "name": "Scaled dot-product attention",
  "createdAt": "...",
  "updatedAt": "...",
  "messages": [],
  "pageActions": [],
  "artifactIds": []
}
```

Import/export should become a first-class escape hatch because browser storage is less inspectable than the current filesystem layout.

## Authentication And Provider Calls

This is the main product/security decision.

Browser-only Onhand has two viable modes:

- Local-key mode: user stores an OpenAI API key in extension storage and the browser calls the OpenAI API directly. This fits the "no desktop component" goal but exposes keys to the extension context.
- Direct sign-in mode: user signs in through OpenAI Codex OAuth and the extension stores refresh tokens locally. This keeps the desktop app and bridge out of the loop, but the extension still holds sensitive credentials and provider login flows can change.
- Proxy mode: the extension sends requests through a small hosted or user-configured proxy that keeps API keys and refresh tokens off the client. This is safer for production, but it reintroduces a backend service.

For this branch, OpenAI Codex OAuth is the preferred path and API key mode is the fallback. A hosted auth/proxy service is still the cleaner production path if Onhand becomes broadly distributed.

## Deletion Sequence

Completed:

1. Added an extension build step and TypeScript source tree so Pi browser packages can be bundled.
2. Added a browser runtime controller with a working prompt path and no desktop dependency.
3. Ported browser tools as direct extension tools.
4. Replaced side-panel prompt/state/session messages to call the browser runtime controller.
5. Moved sessions/settings/artifacts to extension storage.
6. Removed the bridge options UI, bridge token config, WebSocket client, and localhost API calls.
7. Deleted `apps/desktop`, `packages/browser-bridge`, `packages/pi-extension`, tmux scripts, and bridge-based tests.
8. Replaced tests with extension-runtime and side-panel smoke tests.

## Acceptance Criteria

The first browser-only slice is done when:

- Loading the unpacked extension is enough to use Onhand.
- The side panel can submit a prompt without a desktop app, localhost bridge, or token.
- The agent streams an answer into the side panel.
- The agent can call a direct browser tool and leave a highlight or note on the active tab.
- Refreshing the extension preserves at least the active session transcript.
- `npm run desktop`, `npm run bridge`, bridge options, and token setup no longer exist.

## Current Smoke Coverage

- `npm run smoke:browser-runtime` runs the bundled browser runtime with a deterministic hidden provider and no desktop or bridge process. It verifies that Pi can call a browser tool and produce the final reply `Browser runtime smoke ok`.
- `npm run smoke:browser-runtime -- --real-openai` uses `OPENAI_API_KEY` with `openai/gpt-4.1-mini` to verify the same browser-runtime path against a real provider.
- Manual Chrome smoke: reload the unpacked extension, sign in with OpenAI Codex, confirm options status reports `openai-codex` / `gpt-5.5` with `authMode: "oauth"`, open a normal page, submit a side-panel prompt, and verify a real model reply.
