# Raindrop upstream issue drafts

These are evidence-backed drafts from Onhand's local development pilot. They
contain no private prompts, page content, tab titles, trace IDs, or user data.
Do not post them without a separate review and explicit approval.

## Draft 1: Workshop run totals double-count Pi Agent token usage

### Environment

- Raindrop Workshop `0.1.16`
- `@raindrop-ai/pi-agent` `0.1.0`
- Pi agent core `0.80.7`
- local Workshop transport, events and traces enabled

### Observed behavior

For a completed Pi run, each nested model span reports the expected input and
output token usage. The root run span also carries the sum of those tokens.
Workshop's displayed run total appears to add both levels, resulting in exactly
twice the actual input and output totals in the reproduced run.

Example with rounded, non-sensitive values:

- sum of nested model spans: about 20k input / 110 output
- root span: about 20k input / 110 output
- Workshop run total: about 40k input / 220 output

### Expected behavior

The run total should represent model usage once. Either root aggregate usage
should be treated as authoritative, or Workshop should sum leaf model spans
without adding the root's aggregate fields again.

### Suggested direction

Document the intended aggregation contract and mark aggregate versus leaf
usage explicitly in the adapter payload, or update Workshop's total function
to avoid counting both levels.

## Draft 2: Pi Agent package needs a browser-safe entry point

### Environment

- `@raindrop-ai/pi-agent` `0.1.0`
- Chrome Manifest V3 extension, bundled with esbuild for `platform: browser`

### Observed behavior

The main package entry imports Node's `async_hooks` and `os`. A browser bundle
therefore fails unless the consumer supplies scoped shims. The rest of the
subscriber path used by the pilot works in the extension with standard browser
`fetch` and `crypto` APIs.

The pilot had to alias only Raindrop-owned imports of these modules to minimal
browser implementations. These aliases are intentionally restricted to the
package importer so they do not affect Onhand or other dependencies.

### Expected behavior

Browser and MV3 consumers should have a supported import that does not require
Node built-ins, while Node and Pi Coding Agent integrations retain their
current behavior.

### Suggested direction

Publish a conditional `browser` export (or a documented `./browser` entry)
that uses a no-op/fallback async context and browser-safe host metadata. A small
browser-bundle smoke test in the package would prevent regressions.
