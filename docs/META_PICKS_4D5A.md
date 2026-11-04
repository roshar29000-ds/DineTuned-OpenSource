# 4D.5A — Meta Personalized Picks from extracted menus

Implemented on top of `48e1131`. This is a separate, typed real-menu recommendation pipeline using the existing Standard Muse Spark SDK adapter. The old demo catalog, ranking, TasteBridge, pairing, stretch, refinements and Memory behavior remain separate and unchanged. **No Google, Meta, live restaurant or live Supabase request was made during implementation.**

## Verified flow

1. Existing authenticated source discovery and HTML/text-PDF extraction validate the branch and sources. The extraction route now adds an optional `recommendation_token`: a one-hour HMAC over the complete extraction snapshot and hashed verified user identity. It uses a domain-separated derivative of the existing local signing key. No menu cache or database write is added.
2. `POST /api/v2/real-picks/sessions` requires Supabase-verified authentication and that exact signed snapshot. Changing dishes, names, prices, sources, hashes, timestamps, menu version or owner invalidates authorization. Older unsigned and expired snapshots cannot initiate reasoning. Nothing automatically repeats discovery/extraction to recover them.
3. `real_picks/context.py` merges saved and session restrictions using the existing shared safeguards. It validates menu structure, IDs, source hashes/URLs, branch corroboration and usable prices. It sends every eligible item within the bounded context, with name, category, description, printed price, source URL/hash/page, explicit Taste DNA/Detective preferences and their stated/inferred basis, mood, appetite and protein preference. It never enriches a real dish with demo culinary attributes.
4. `MetaRealMenuProvider` uses the existing OpenAI-compatible Muse Spark transport, strict Pydantic JSON output, `minimal` reasoning, 3,072-token completion cap, timeouts, no tools/redirects/environment proxies, and zero retries. The common transport still serves the original smoke test unchanged.
5. Meta chooses culinary relevance, strength and order. Python independently validates item identity, positive preference references and exact complete menu-field quotes, rejects duplicates/unsupported claims, and assembles up to three picks. Frontend response checks bind identity, menu, request, prices and citations again.
6. `RealMenuPicks` appears **after the entire categorized menu**, using existing design tokens and controls. It shows budget targets, exact overages, source-linked explanations and uncertainty. Requests happen only on an explicit button click. Double clicks share a pending action; auth/menu/preferences changes invalidate results immediately and cancel the UI request. No pick, menu or proof is persisted to browser storage or Supabase. Mock results are conspicuously labeled.

The extraction model's legacy `recommendations_ready: false` remains unchanged: extraction alone does not authorize the old demo endpoint or certify safety. The new snapshot token and real-Picks capability are independent gates.

## Budget and quality policy

- Preserve model order within each budget tier. Take up to three `strong` or `exceptional` in-budget candidates first; fill only remaining slots with `exceptional` above-target candidates.
- A merely `strong` above-target candidate is excluded. `tentative`, duplicate, ungrounded or known-dislike-conflicted proposals never fill slots.
- Integer cents throughout; exact `max(0, printed_price - per_dish_target)` overage. No arbitrary maximum overage and no meal-budget interpretation.
- Hiding above-budget alternatives excludes them before reasoning and during independent assembly. Zero, one or two picks are valid.
- Model fit is a judgment, not a calibrated probability. Python checks the factual inputs/citations; it cannot prove a subjective culinary connection is convincing.

For example, the **offline Orchard Kitchen HTML fixture**, with a stated interest in grilled lemon chicken, mushroom rice and tomato soup, produces (mocked model order places chicken first):

| Selected dish | Printed price | Overage against $22 |
|---|---:|---:|
| Mushroom rice | $22.00 | $0.00 |
| Roasted tomato soup | $12.00 | $0.00 |
| Charred chicken | $24.00 | $2.00 |

The chicken explanation connects the saved preference to the source's complete description, “Grilled chicken, lemon and potatoes.” The Lantern Noodle fixture also supports Broth noodles at $18.25 with its original “Rice noodles and vegetable broth.” description. These fixtures test plumbing and validation, **not live restaurant facts or measured model quality**.

## Safety and honest limits

- Current extraction certifies neither dietary suitability nor complete allergens/cross-contact controls. Any active dietary restriction or allergy therefore produces exclusions until a separate evidence-backed safety capability exists. A dish sounding vegan, or omitting an allergen from its description, is not verification. No restaurant safety guarantees are made.
- Explicitly unavailable dishes are excluded. Other source listings retain `availability: unverified`; every pick warns that current stock must be confirmed. This milestone does not establish real-time availability.
- Only one fixed, unambiguous, budget-usable USD price qualifies. Missing prices, ranges, unselected size variants, conflicting prices, other currencies and unverified sources are excluded. The full menu continues displaying those records accurately; no currency conversion or cheapest-variant guess is made.
- All selections are scoped to supplied sources. Partial menus remain labeled partial; no complete/current-menu promise is added. PDF layout review warnings and original page references remain attached.
- Input is limited to 60 eligible items AND the existing 24,000-byte total Meta request bound, including schema. Oversized requests fail before dispatch; no silent first-N sampling or automatic multi-call chunking.
- Model explanations use validated evidence connections rendered by Python. Quotes must equal a complete item name or description (up to 500 characters), preventing selective removal of qualifiers/negations. Unsupported arbitrary generated prose is not published. This constrains expressiveness; independent validation does not establish that the model's culinary interpretation is correct.
- Insufficient positive taste evidence, no eligible dishes, no strong matches, stale identity, malformed/truncated responses, timeout and provider unavailability have distinct outcomes. No real request falls back to fictional dishes.
- No new TasteBridge, Complete My Table, Worth the Stretch, refinement intelligence, feedback interpretation or learning is enabled for real menus.

## Live dispatch and credit protection

`GET /api/v2/real-picks/config` reports disabled in the normal application. Its provider dependency is `DisabledRealProvider`. No frontend flag, supplied key or environment value can activate paid dispatch. Offline tests inject `MetaRealMenuProvider` with an explicit `httpx.MockTransport`; they never reserve real credits.

The shared spending policy registers `4D.5A` with a $1 ceiling and **one developer-only live attempt** after a separate owner approval. The one-shot runner still requires both explicit live/spending flags and one verified guest identity; the normal FastAPI route remains disabled. The adapter cannot borrow the old 4D.1 allowance. The cumulative $10 ceiling, old entries and two-attempt 4D.1 allowance remain unchanged. No rates, maximum output limits, retries or historical accounting were relaxed.

A future controlled live test needs separate explicit approval, an authorized one-attempt milestone allowance, a current signed real extraction and authenticated user context, and a deliberate developer-only invocation. Public app activation additionally needs a reviewed per-user consent/idempotency/dispatch gate; the default dependency must not simply be replaced with an unrestricted live provider. Recheck the existing pricing snapshot before its November 5 expiry. The local ledger is **not a Meta-enforced billing cap** and does not observe external key usage; check the provider dashboard.

## Modules and contracts

- `api/app/real_picks/{models,authorization,context,provider,validation,pipeline,routes}.py`
- Shared `culinary/meta.py` transport and `services/eligibility.py` safeguards; existing demo consumers retain behavior.
- Extraction's optional signed snapshot; generated TypeScript/runtime contracts.
- `/api/v2/real-picks/config`, `/api/v2/real-picks/sessions`; private, same-origin Next.js relay, bounded request body and timeouts.
- `web/lib/real-picks.ts`, `RealMenuPicks.tsx`, existing real-menu integration and narrowly reusable budget/allergy controls.

## Offline verification

```sh
cd ~/Downloads/dinetuned-starter/api
.venv/bin/python -m pytest tests/test_real_picks.py tests/test_meta_culinary.py tests/test_usage_budget.py tests/test_signature_picks.py tests/test_menu_extraction.py -q
.venv/bin/python scripts/generate_contracts.py --check
cd ../web
node --test tests/real-picks.cjs tests/menu-extraction.cjs tests/identity.cjs tests/dining-memory.cjs
npm run typecheck
```

Browser tests use `api/tests/browser_menu_app.py` with `DINETUNED_OFFLINE_BROWSER=1`, isolated localhost ports 8126/3126, all provider keys blank, and `tests/e2e/real-menu.spec.ts`. This test server prohibits external network connections. The new cases explicitly mock the capability response; the pipeline still traverses real API routes, snapshot verification, local HTML extraction, the SDK's mocked transport and Python output validation. Tests do not enable the normal application or use live guests.

Final verification: **216 Python tests**, **39 frontend checks**, generated contracts, TypeScript and the production build passed. **20 desktop/mobile browser cases** passed, including a focused rerun of the four new cases after correcting assertions to use the existing exact-currency formatter. Existing FastAPI/Starlette test-client deprecation and terminal color warnings are non-blocking.

Final resume review: the focused **96-test** backend safety/budget/real-Picks pass, the same **39 frontend checks**, TypeScript and contract drift check passed again. The prior production build had no newer application sources; no rebuild or full browser rerun was needed. The browser run record contained no failed tests. Temporary milestone QA build/browser outputs were removed; tracked build configuration was restored before commit. Google flags, the existing spending limits, the Google counter database and Meta ledger were preserved.

## Live verification remaining

The Girl & the Goat branch-to-menu live journey is still unverified. After separate approval, validate actual official-source extraction/coverage, then evaluate real Muse Spark relevance, response length and factual connections on that signed menu. Validate unsupported/zero-pick outcomes with real safety evidence rather than weakening safeguards. No 4D.5B features or external integrations are included here.
