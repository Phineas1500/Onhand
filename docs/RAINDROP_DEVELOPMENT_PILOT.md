# Raindrop Development Pilot

This pilot uses Raindrop Workshop as a local debugger for Onhand's real Pi
agent trajectories. It is development-only: the normal extension build excludes
the Raindrop SDK, no Raindrop write key is configured, and the runtime rejects
every Workshop endpoint except loopback HTTP.

The pinned versions (updated 2026-11-05, from Workshop `0.1.16` and adapter
`0.1.0`) are:

- Raindrop Workshop `0.1.23`
- `@raindrop-ai/pi-agent` `0.2.5`

Both are the newest releases that were at least a week old on that date;
Workshop `0.1.24` and adapter `0.2.6` had been published that day. Adapter
`0.2.x` imports `child_process` and `path` for optional Git enrichment: the
observer passes `appGit: false`, and the pilot build resolves both imports to
small browser shims.

## What is captured

When the explicit pilot build is loaded, the adapter records each Pi prompt run,
including retries, model spans, token counts, tool calls, durations, and errors.
Runs share the Onhand session ID and carry `onhand_turn_id`, provider, model,
runtime profile, extension version, and learning-mode metadata.

These traces can include prompt text, assistant output, tool arguments, tool
results, and therefore page content or URLs. Onhand's constructed prompt can
also contain titles, URLs, selections, or extracted text from unrelated open
tabs. Use a dedicated fixture-only browser profile; a second window in the
normal profile is not isolated because Onhand scans across open windows. Do not
attach a cloud write key and do not commit the Workshop database or exported
private traces.

## Reproducible local install

Use the repository-managed setup command. It selects the pinned artifact for
the current supported platform, verifies the release checksum before
decompressing it, and keeps the binary under ignored `tmp/`:

```sh
npm run raindrop:pilot:setup
```

The equivalent macOS arm64 commands are shown below for auditability.

The following installs the audited macOS arm64 binary under the ignored `tmp/`
directory instead of modifying the shell profile or agent configuration:

```sh
mkdir -p tmp/raindrop-pilot/bin tmp/raindrop-pilot/home
curl -L https://github.com/raindrop-ai/workshop/releases/download/v0.1.23/raindrop-bun-darwin-arm64.gz \
  -o tmp/raindrop-pilot/raindrop-bun-darwin-arm64.gz
shasum -a 256 tmp/raindrop-pilot/raindrop-bun-darwin-arm64.gz
# Expected: fcec201ad7605a08906f6012d2449c4df744a24943a81b31ba17c37abdc29c08
gzip -dc tmp/raindrop-pilot/raindrop-bun-darwin-arm64.gz \
  > tmp/raindrop-pilot/bin/raindrop
chmod +x tmp/raindrop-pilot/bin/raindrop
tmp/raindrop-pilot/bin/raindrop --version
```

For another platform, use the matching `0.1.23` artifact and checksum from the
official Workshop release manifest rather than reusing the arm64 artifact.

## Run the pilot

Start Workshop with an ignored, repository-local database and log:

```sh
npm run raindrop:pilot:start
npm run raindrop:pilot:status
```

In a second terminal, build the explicitly instrumented extension:

```sh
npm run build:extension:raindrop-local
```

Reload the unpacked Onhand extension from `chrome://extensions`, run a
deterministic trajectory fixture, and inspect it at
`http://127.0.0.1:5899`. The Workshop process and loopback receiver must remain
running for traces to arrive.

For an automated fixture-only browser profile, use the live trajectory runner's
isolated mode. The stable ignored profile preserves the same free-tier device
identity between runs while excluding personal tabs and browsing state:

```sh
npm run eval:agent-trajectories:live -- \
  --launch-isolated \
  --case current-page-grounded-answer \
  --case two-paper-comparison \
  --case selected-homework-workspace-research \
  --profile legacy
```

The sidebar's starter questions have their own suite, on a six-page study PDF
and a web article. Their budgets count model rounds, which drive Free latency:

```sh
npm run eval:agent-trajectories:live -- \
  --launch-isolated --free-tier \
  --suite evals/agent-trajectories/starter-questions.json \
  --case starter-pdf-summarize-highlight --case starter-pdf-hardest-part \
  --case starter-pdf-quiz --case starter-web-main-idea --case starter-web-highlight
```

This launches Helium/Chromium with only the unpacked Onhand extension and the
fixture workspace. Set `ONHAND_TEST_BROWSER` or pass `--browser <path>` if the
browser is not in a standard location. Use `--keep-browser` only for visual
inspection.

Workshop `0.1.16` with adapter `0.1.0` double-counted run-total tokens. With
`0.1.23` and `0.2.5` the run totals equal the sum of the model spans. A model
span's input tokens exclude cached prompt tokens; the cached counts are in its
`gen_ai.usage.cache_read_input_tokens` and `cache_write_input_tokens`
attributes. Onhand's ~16k-token system prompt and tools are cached after the
first call of a turn, so most calls show single-digit uncached input.

Run the build-boundary regression whenever this integration changes:

```sh
npm run test:raindrop-pilot
```

That test proves the default build excludes the SDK, the explicit pilot build
includes it, an external endpoint is rejected, an unavailable Workshop remains
fail-open without blocking or rejecting the Pi agent lifecycle, and the
generated runtime is restored to the default non-instrumented build afterward.

## Initial validation

On 2026-07-22, the instrumented extension was reloaded in Helium and exercised
against the deterministic calibration fixture with GPT-5.6:

- A page-grounded answer produced a completed 3.9-second run with model input,
  output, token usage, and Onhand session/turn metadata. It also revealed that
  the correct prose answer used zero browser tools, so it did not satisfy the
  fixture's required evidence-annotation contract.
- An explicit highlight request produced an 8.6-second run with two
  `browser_highlight_text` spans. Workshop displayed each tool's arguments,
  result, error status, and duration (1.1 seconds and 0.9 seconds), along with
  the three model turns surrounding those calls.
- The run-total token double-count and unrelated-open-tab capture described
  above were both visible immediately. These are pilot constraints, not
  production-ready metrics or privacy behavior.

This demonstrates incremental value over the normalized trajectory report:
Workshop makes raw model/tool nesting and payloads fast to inspect, while the
existing evaluator remains the authoritative pass/fail and cross-model scoring
layer.

The isolated free-tier matrix and prioritized product findings are recorded in
`docs/RAINDROP_PILOT_FINDINGS_2026-07-22.md`.

## Stop and clean up

Stop the repository-managed Workshop and return the unpacked extension to its
normal build:

```sh
npm run raindrop:pilot:stop
npm run build:extension
```

Then reload the extension again. Delete `tmp/raindrop-pilot/` if the local
database or binary is no longer needed.

## Promotion boundary

This pilot is not production observability and does not change Onhand's privacy
policy. Before any production or cloud Raindrop integration, separately review
data minimization, redaction, consent, retention, deletion, subprocess and
vendor disclosures, CSP/host permissions, operational cost, and whether the
privacy policy needs to change. Promote only if local traces uncover actionable
issues that Onhand's normalized trajectory evaluator and existing diagnostics
do not already reveal efficiently.

## Known pilot gaps

- The observer covers Onhand's main user-facing Pi agent. The separate internal
  structured tutor/planner agent and the realtime voice transport are not yet
  traced independently.
- Timed cancellation can be exercised with `--cancel-after-ms <n>`. A
  deterministic provider/transport retry injector still needs a dedicated
  fixture; tool-level recovery loops are visible in Workshop today.
- Workshop traces are intentionally raw and local. There is no automated
  redaction, export, or aggregate comparison pipeline, so the normalized
  trajectory report remains the authoritative cross-model result.
- The two Raindrop integration issues found during the pilot are recorded as
  local upstream drafts in `docs/RAINDROP_UPSTREAM_ISSUE_DRAFTS.md`. Posting
  them is a separate external action.
