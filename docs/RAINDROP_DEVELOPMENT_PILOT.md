# Raindrop Development Pilot

This pilot uses Raindrop Workshop as a local debugger for Onhand's real Pi
agent trajectories. It is development-only: the normal extension build excludes
the Raindrop SDK, no Raindrop write key is configured, and the runtime rejects
every Workshop endpoint except loopback HTTP.

The initial pinned versions are:

- Raindrop Workshop `0.1.16`
- `@raindrop-ai/pi-agent` `0.1.0`

## What is captured

When the explicit pilot build is loaded, the adapter records each Pi prompt run,
including retries, model spans, token counts, tool calls, durations, and errors.
Runs share the Onhand session ID and carry `onhand_turn_id`, provider, model,
runtime profile, extension version, and learning-mode metadata.

These traces can include prompt text, assistant output, tool arguments, tool
results, and therefore page content or URLs. Onhand's constructed prompt can
also contain titles, URLs, selections, or extracted text from unrelated open
tabs. Use a dedicated fixture-only browser window or profile with unrelated
tabs closed; loading a safe active page is not sufficient by itself. Do not
attach a cloud write key and do not commit the Workshop database or exported
private traces.

## Reproducible local install

The following installs the audited macOS arm64 binary under the ignored `tmp/`
directory instead of modifying the shell profile or agent configuration:

```sh
mkdir -p tmp/raindrop-pilot/bin tmp/raindrop-pilot/home
curl -L https://github.com/raindrop-ai/workshop/releases/download/v0.1.16/raindrop-bun-darwin-arm64.gz \
  -o tmp/raindrop-pilot/raindrop-bun-darwin-arm64.gz
shasum -a 256 tmp/raindrop-pilot/raindrop-bun-darwin-arm64.gz
# Expected: 7ef29da7e0a8f6ba340ddd5ba3338c07e49dd1a68c112580822551f28fc7f695
gzip -dc tmp/raindrop-pilot/raindrop-bun-darwin-arm64.gz \
  > tmp/raindrop-pilot/bin/raindrop
chmod +x tmp/raindrop-pilot/bin/raindrop
tmp/raindrop-pilot/bin/raindrop --version
```

For another platform, use the matching `0.1.16` artifact and checksum from the
official Workshop release manifest rather than reusing the arm64 artifact.

## Run the pilot

Start Workshop with an ignored, repository-local database:

```sh
HOME="$PWD/tmp/raindrop-pilot/home" \
RAINDROP_WORKSHOP_PORT=5899 \
RAINDROP_WORKSHOP_BIND_HOST=127.0.0.1 \
RAINDROP_WORKSHOP_DB_PATH="$PWD/tmp/raindrop-pilot/workshop.db" \
  tmp/raindrop-pilot/bin/raindrop workshop serve
```

In a second terminal, build the explicitly instrumented extension:

```sh
npm run build:extension:raindrop-local
```

Reload the unpacked Onhand extension from `chrome://extensions`, run a
deterministic trajectory fixture, and inspect it at
`http://127.0.0.1:5899`. The Workshop process and loopback receiver must remain
running for traces to arrive.

Workshop `0.1.16` with `@raindrop-ai/pi-agent` `0.1.0` currently reports token
usage on both the run root and its nested model spans. The Workshop run-total
therefore double-counts input and output tokens. Use the individual model-span
values for analysis until the upstream adapter or Workshop aggregation changes.

Run the build-boundary regression whenever this integration changes:

```sh
npm run test:raindrop-pilot
```

That test proves the default build excludes the SDK, the explicit pilot build
includes it, an external endpoint is rejected, and the generated runtime is
restored to the default non-instrumented build afterward.

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

## Stop and clean up

Stop a foreground Workshop with `Ctrl-C`. To return the unpacked extension to
its normal build, run:

```sh
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
