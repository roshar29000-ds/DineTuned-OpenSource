# Step 4D.1 — guarded Meta culinary provider

The backend integration code is ready for an explicitly approved developer smoke test. **No real Meta request was made during implementation.** The customer application continues to use its existing, labeled demo pipeline. No public endpoint, frontend request, environment setting, build, or ordinary development command can enable this provider. The previously unused, ungated `model_ask` adapter now raises a configuration error.

## Architecture

- `api/app/culinary/contracts.py`: `CulinaryReasoningProvider`, structured ranked proposals, factual claims, and independently validated selections. These are internal contracts; existing API and generated frontend contracts are unchanged.
- `context.py`: bounded snapshot of the existing request and menu, including saved tastes, confidence basis, explicit favorites, reported feedback, current constraints and temporary refinements. It supplies only hard-eligible items and preserves source references. Up to eight items and three feedback records; a separate serialized-byte limit also applies.
- `meta.py`: official OpenAI-compatible SDK, Standard `muse-spark-1.3`, `https://api.meta.ai/v1`, strict JSON schema, Pydantic validation, explicit `minimal` reasoning effort and a 3,072-token completion cap. The cap includes reasoning tokens and visible JSON. SDK and transport retries are zero; timeout is 30 seconds; redirects, environment proxies, streaming, storage and tools are disabled.
- `validation.py`: independently rechecks menu identity, duplicate IDs, availability, dietary/allergy rules, supported facts and TasteBridge relations. It renders validated evidence into explanations. Strong candidates retain model order within the existing in-budget-first tiers, with up to three primary picks and up to two remaining above-target options. Prices/categories come exclusively from the menu; overages use integer cents. Hide-above-target and set-aside dish IDs remain enforced.
- `demo.py`: explicit adapter for the existing deterministic ranking; no second scoring algorithm. A demo result cannot be labeled Meta.
- `api/app/usage_budget.py`: shared, durable local spending reservations and usage accounting.
- `api/scripts/meta_smoke.py`: developer-only entry point using fictional Casa Sol data and a synthetic profile. Default mode uses the SDK with an in-memory HTTP mock, never the network.

The model decides culinary order, strength and which evidence relationships matter. Python does **not** use demo taste scores to filter Meta proposals. Python does require supported personal connections; unknown or contradictory evidence can produce fewer picks. Model prose is deliberately not accepted as factual evidence: the narrow proposal graph prevents an otherwise valid citation from legitimizing invented ingredients or preparation. This limits expressiveness, but avoids treating valid JSON as proof of culinary truth. A model's `strong` judgment is still fallible, not a calibrated probability.

TasteBridge uses the existing evidence validator. Table pairing and application refinements are preserved; they are not switched to Meta in this milestone. The shared context and provider boundary are available for those later integrations. Free-text favorites are supplied to Meta but are not automatically promoted to verified sensory facts. Confidence is supplied as stated/inferred/unknown, not invented percentages.

## Credit protection

- Live use requires **both** `--live` and `--confirm-spend`, plus the user's separate explicit approval for that one request. Key presence alone grants no permission. There is no live-enable environment variable.
- Step 4D.1 permits at most **two reserved attempts in total**: the original attempt plus exactly one explicitly approved additional test. Timeouts, errors and process interruption consume attempts. The fixed local ledger enforces this across invocations. Do not delete it or switch paths to retry. Each invocation still requires both spending flags; nothing runs automatically.
- Cumulative Step 4D target: **$10**. Step 4D.1 target: **$1**. A conservative reservation must fit both before transport runs. Future milestones must register their policy while retaining the same cumulative ledger.
- Fixed ledger: `<repo>/.local/meta/usage.json`, with an adjacent `usage.lock`. Both are Git-ignored. Records contain requested/reported model, timestamps, estimated input and maximum output tokens, rate card, status, reported token counts, token-derived cost estimates and accounted USD. No credential, prompt, menu, response, or personal profile is recorded.
- An exclusive file lock and atomic, fsynced writes reserve spending before dispatch. The ledger file is private (0600). Missing-after-initialization, malformed or negative accounting blocks calls. Pending calls keep their full reservation. Failed/unknown usage also retains the full reservation; known usage is reconciled using the stored rates without assuming cache discounts. A model mismatch or exceeded usage bound blocks future calls pending review.
- Standard pricing verified **October 28, 2026**: $1.25/million input tokens, $4.25/million output tokens. The snapshot expires after **November 5, 2026** and then fails closed until reviewed. Historical ledger entries retain their own rate cards. No Contributor model, search, image, or other tool is permitted.
- Preflight covers the whole serialized text request, including JSON schema: twice its UTF-8 byte count plus 2,048 framing tokens, plus the full requested completion limit. Requests over 24,000 bytes or with unrecognized model/payload features are blocked. This deliberately pessimistic text-only estimate is **not an exact Meta tokenizer count** and must not be reused for images, tools, attachments or unbounded context. The current smoke context reserves approximately **$0.0687**; the actual token-derived estimate may be considerably lower.

**This ledger is not a Meta-enforced spending cap.** It cannot observe requests made elsewhere, stop external use of the key, guarantee provider billing, or recover history deleted together with its lock. Check the Meta dashboard and any available provider spending controls. “Reported usage” means provider token counts; the USD amount remains a local estimate, never verified billing. A failed request may still be charged. Do not automatically retry.

## Offline check — no key required

```bash
cd ~/Downloads/dinetuned-starter/api
.venv/bin/python scripts/meta_smoke.py
```

Output is headed **MOCKED/OFFLINE**. The mock goes through the SDK request/response path, Pydantic contract and independent validators. Synthetic token counts are explicitly labeled, no budget is spent or reserved, and the real ledger remains unchanged. Its recommendations demonstrate plumbing, not measured Meta intelligence.

## Secure key setup and ONE approved live request

**The original attempt has now been used.** The recorded real response consumed 4,992 input tokens and 1,536 completion tokens, including 1,534 reasoning tokens. Its **$0.012768 local cost estimate remains in the ledger**, leaving **$9.987232** of the cumulative target and **$0.987232** of the milestone target. These are local estimates, not verified billing. The original generic `invalid_response` handling did not identify truncation separately.

The repair uses Meta's documented `minimal` reasoning setting and doubles the shared reasoning/JSON cap to 3,072. Even if reasoning uses the previously observed 1,534 tokens, that leaves 1,538 tokens of headroom. The extra output reservation is $0.006528. This does not guarantee a complete response: `finish_reason=length` now raises `output_truncated`, reports token counts when known, and rejects even parseable JSON without retrying. Other model, schema, evidence and safety checks remain mandatory. The CLI shows reasoning effort and finish reason without logging reasoning text.

**The user has now authorized a one-slot allowance extension.** The total Step 4D.1 allowance is two attempts, leaving exactly one available after the recorded first attempt. Both dollar limits and every existing ledger entry are retained. Attempt three is blocked, even if either earlier attempt fails. Do not reset the ledger or relabel a request as another milestone. This allowance change did not execute a live call; the command below remains a deliberate manual action requiring both flags.

Do this **only after separately approving one live request**. The following is for the project's zsh shell; hidden input keeps the key out of command history. The CLI reads process environment only and does not automatically load `.env` files.

```zsh
cd ~/Downloads/dinetuned-starter/api
read -rs 'MODEL_API_KEY?Meta API key: '
printf '\n'
export MODEL_API_KEY
```

The one live command, not executed during this milestone:

```zsh
.venv/bin/python scripts/meta_smoke.py --live --confirm-spend
```

Afterward:

```zsh
unset MODEL_API_KEY
```

Do not put the key in frontend configuration, shell arguments, source, screenshots or logs. Optional backend configuration uses `META_MODEL` and `META_MODEL_BASE_URL`; only the verified Standard model and official HTTPS origin are allowed. Unsupported settings fail before a network request. No automatic fallback disguises mock/demo output as Meta.

The live command prints **REAL META**, requested model, validation outcome, menu IDs/names, grounded explanations, reported usage when available, estimated USD and remaining cumulative budget. Unknown usage retains the reservation. Success, failure or interruption of the remaining attempt exhausts this milestone's two-attempt allowance; inspect the dashboard and ledger rather than rerunning.

## Focused verification

```bash
cd ~/Downloads/dinetuned-starter/api
.venv/bin/python -m pytest tests/test_meta_culinary.py tests/test_usage_budget.py tests/test_api.py tests/test_signature_picks.py tests/test_tastebridge.py tests/test_refinements.py tests/test_stretch.py tests/test_pairing.py -q
.venv/bin/python scripts/generate_contracts.py --check
cd ../web
npm run typecheck
```

All pytest network transports and socket connections are denied by an autouse fixture. Provider tests inject `httpx.MockTransport`, use synthetic keys and isolated temporary ledgers. They cover SDK configuration, valid and malformed outputs, invented/duplicate IDs, unsupported claims, safety, budget tiers, zero-to-three results, errors/timeouts/no retries, unknown usage, cumulative/milestone limits, simultaneous reservations and crash persistence.

## Remaining for 4D.2

The original live request reached Meta, but a complete, validated live culinary response has not yet been obtained. Minimal reasoning is a hint, not a separate reasoning-token cap; truncation can still occur and fails without retry. Menus and sensory annotations are still fictional. Arbitrary culinary prose cannot yet be independently verified; published explanations remain limited to the supported evidence vocabulary. Cross-process locking uses POSIX `flock` (macOS/Linux), not Windows. Larger menu contexts, authenticated live application access, privacy/consent, richer reasoning evaluation and provider-backed pairing/refinement need separate milestones and spending approval. No Meta, Supabase or Places integration is exposed to customers here.

Official references: [API overview](https://dev.meta.ai/docs/overview), [structured output](https://dev.meta.ai/docs/structured-output), [chat schemas and usage](https://dev.meta.ai/docs/api-reference/chat-completions/schemas), [reasoning tokens](https://dev.meta.ai/docs/reasoning), [pricing](https://dev.meta.ai/docs/pricing-rate-limits), [token counting](https://dev.meta.ai/docs/token-counting).
