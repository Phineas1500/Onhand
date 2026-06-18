# Free Tier Model Eval

Use this loop before changing the model that powers Onhand Free. It measures the
things that matter for this product instead of only comparing token prices:
anchored page answers, browser tool calls, learning-mode coaching, homework
refusal, latency, token usage, provider routing, and cost.

## Quick Check

Run the no-key structural check first:

```sh
npm run eval:free-tier-models -- --dry-run
```

Run a live comparison with OpenRouter:

```sh
OPENROUTER_API_KEY=... npm run eval:free-tier-models
```

By default the runner compares:

- `deepseek/deepseek-v4-flash`
- `xiaomi/mimo-v2.5`
- `minimax/minimax-m3`
- `qwen/qwen3.7-plus`
- `deepseek/deepseek-v4-pro`

Results are written under `tmp/free-tier-model-eval/` as JSONL plus a Markdown
summary. The JSONL is the source of truth for later spreadsheet or notebook
analysis.

## Production-Shaped Run

To mirror the current free-tier routing policy for the current default, pass the
same provider allowlist used by the Worker:

```sh
OPENROUTER_API_KEY=... npm run eval:free-tier-models -- \
  --models=deepseek/deepseek-v4-flash \
  --provider-only=deepinfra,parasail,novita,wandb \
  --iterations=3
```

Run broad challenger discovery without `--provider-only`, then do a provider and
privacy review for any model that looks good. Some challenger models have a
single upstream or no overlap with the current Worker allowlist, so applying the
current allowlist to every candidate can create artificial failures.

OpenRouter uses `session_id` as a sticky routing key, so repeated iterations of
the same model/case can expose prompt-cache behavior when a provider supports it.
Treat a single run as directional; use repeated runs before deciding.

## Decision Rules

Keep the free-tier default unless a challenger clears all of these:

- Average score is meaningfully higher across anchoring, tool calling, learning,
  and refusal cases.
- Tool-call success is at least as reliable as DeepSeek V4 Flash.
- p95 latency and error rate are acceptable.
- Real reported cost does not break the daily request cap economics.
- Provider routing matches the privacy posture documented in `docs/FREE_TIER.md`.

Use `deepseek/deepseek-v4-flash` as the control. A higher-quality model should
earn its extra cost; a cheaper model should prove it does not degrade Onhand's
core behavior.

For the free-tier vision route, use
`mistralai/mistral-small-3.2-24b-instruct` as the current control. Image-capable
challengers such as `meta-llama/llama-4-maverick` must beat it on visual
grounding, browser tool-loop continuity, latency, and real OpenRouter-reported
cost before replacing the default visual route.

## Useful Commands

```sh
npm run eval:free-tier-models -- --list-cases
npm run eval:free-tier-models -- --case=browser-tool-highlight --models=deepseek/deepseek-v4-flash
npm run eval:free-tier-models -- --json --dry-run
```
