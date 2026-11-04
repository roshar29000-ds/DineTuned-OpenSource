# Step 4B.2A — Complete My Table intelligence

Personalized Picks now includes an additive `meal_combinations` result. Primary recommendations, their ranking, exact overages, TasteBridge, menu eligibility and feedback behavior are unchanged. No pairing UI or external service is connected.

## Reasoning and validation boundaries

- `api/app/pairing/context.py` constructs trusted evidence from the current restaurant/menu snapshot and request. It resolves actual primary dishes, excludes ambiguous identities, applies the existing dietary/allergy safeguards, requires listed prices and availability, and retains saved/session evidence. Explicit dislikes and negative item feedback also prevent pairing those items.
- `reasoning.py` implements the provisional `DemoMealPairingReasoner`. It proposes one supported accompaniment per primary, up to three combinations. It favors unused alternatives, a supported saved preference, then a within-target accompaniment. It uses exact listed ingredients/preparations, documented texture relationships, or sensory contrasts; a category name alone cannot justify a pairing. Mood can prioritize which documented contrast is considered. There is no aggregate culinary score or invented confidence.
- `validation.py` independently checks proposals against the trusted context: restaurant/version, primary membership, valid categories and items, hard eligibility, availability, duplicate items, exact quoted prices, integer-cent totals and evidence references/relations. Every addition needs a supported connection to its primary. Unsupported prose and invented evidence are rejected. Display explanations are compiled from the validated claim graph.
- `service.py` gives the provider a deep copy of the context, validates proposals individually, removes duplicate meals and repeated mains, and returns an explicit available/limited/unavailable state. Provider failure or rejected proposals cannot change primary picks.

The `MealPairingEngine.propose(context)` protocol is the replacement point for a future Meta adapter. Meta will interpret culinary harmony and personal taste, then propose current menu IDs, quoted prices and evidence-linked relationships. Python will retain the checks above and publish the same `MealCombinationResult` contract. This does not require a new frontend response shape. New relationship kinds should only be introduced together with independently checkable evidence semantics; provider prose is not accepted as proof.

## Pricing and contracts

Each combination contains restaurant and menu identity, the actual primary and additions with verified names/categories/prices, per-item budget positions, a subtotal, rationale, claims, provenance and uncertainties. Provider name and demo/model mode are explicit at the result level.

The target remains **per dish**, never a meal cap. Above-target components are allowed when the existing `include_over_budget` option permits them, with exact overages. Hiding above-budget alternatives also excludes such additions; it does not alter primary selection. Subtotals are sums of integer cents and exclude tax, tip and other fees. Unknown prices prevent a combination; no total is fabricated. The contract permits one to three additions, although today's demo provider proposes one.

`RecommendationSession.meal_combinations` is nullable and explicitly response-optional. The generator supports this deliberate additive-field marker without making other fields optional. Updated clients can still decode older responses that omit it. API and generated frontend contracts should ship together; historical compiled clients with strict unknown-field rejection are not independently upgraded by the backend. Runtime array minimum lengths are now enforced as well. Existing request payloads need no new fields.

## Actual API examples

Generated from the existing unchanged fixtures at a **$20 per-dish target**:

| Restaurant | Primary | Addition | Subtotal, before tax/tip/fees |
| --- | --- | --- | --- |
| Saigon Table | Pho Gà — $18 | Crispy Mushroom Bánh Mì — $16 | **$34** |
| Sora Kitchen | Spicy Miso Ramen — $22 ($2 over target) | Vegetable Gyoza — $13 | **$35** |
| Luna Trattoria | Basil Pesto Gnocchi — $23 ($3 over target) | Burrata & Tomatoes — $17 | **$40** |

The Saigon example cites higher documented crunch in the bánh mì and a shared gentle-heat direction with saved preferences. Sora cites more crunch in gyoza than ramen and the saved aromatic preference. Luna cites basil explicitly listed in both dishes and the saved gentle-heat preference. These are supported provisional relationships, not guarantees of enjoyment.

Reproduction profile axes (other axes unknown): Saigon uses `spice=.2, richness=.6, aromatic=.85`; Sora uses `spice=.6, richness=.9, crunch=.2, aromatic=.85`; Luna uses `spice=.2, richness=.85, crunch=.2, aromatic=.85`. Use each current menu version from `GET /api/v2/restaurants/{id}/menu` in a normal `POST /api/v2/recommendation-sessions` request with `constraints.max_price_minor=2000` and inspect `meal_combinations`.

## Verification

- 55 focused pairing tests cover all six demo branches, zero-to-three combinations, exact cents/multiple additions, soft per-dish targets, combined restrictions, unknown/conflicting allergens and cross-contact, missing categories/attributes/prices, stale or duplicate identities, unsupported claims, unknown preferences, provider failures and mutation isolation.
- 73 existing TasteBridge, Signature Picks and sparse-profile regressions passed unchanged.
- Generated-contract drift and OpenAPI response checks passed (130 unique Python checks in total).
- Nine targeted frontend contract/regression tests and TypeScript passed. Actual API responses for the three examples also passed the frontend runtime decoder and existing request/session identity checks.
- No browser suite or production build was run for this backend-only milestone. An existing Starlette/HTTPX deprecation warning remains.

Targeted commands from the repository root:

```sh
cd api
.venv/bin/python -m pytest tests/test_pairing.py tests/test_tastebridge.py tests/test_signature_picks.py tests/test_sparse_picks.py tests/test_api.py::test_generated_contracts_are_current tests/test_api.py::test_openapi_documents_responses -q
.venv/bin/python scripts/generate_contracts.py --check
cd ../web
node --test --test-name-pattern='meal combinations|TasteBridge|Picks bind|invalid response shapes' tests/unit.cjs
npm run typecheck
```

## Limits

The fixtures contain Small plates but no drinks or desserts. Only explicitly recognized category semantics can supply additions; future ingestion must establish verified roles for additional categories. Some primary picks therefore have no supported combination, and a single available accompaniment may recur across different mains. For example, Saigon's vegan/dairy-free Crispy Tofu Bún has no eligible small plate and remains a primary pick without a combination.

Production fixture allergen information remains partial. Declared allergies still exclude those dishes; tests of documented controls use test-only menu copies. Free-text favorites/feedback are not interpreted, and unknown taste dimensions remain unknown. Richer culinary composition and general understanding belong to the future Meta provider, not this provisional rule set.
