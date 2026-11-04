# Step 4C.1 — Make It More Me

The Picks page now offers four combinable one-tap directions, “Try another dish,” and reset. Selected buttons can be tapped again to remove a direction. The panel stays mounted during recomputation, announces “Tuning Your Table,” keeps keyboard focus and allows a newer choice or reset to supersede a pending request. No minimum loading duration is imposed.

Refinements are temporary in-memory intent, separate from saved Taste DNA, feedback and other meal controls. They survive a return to the same complete menu, but clear on reload, profile reset, restaurant change or menu-version change. Resetting refinements leaves budget, dietary/allergy restrictions, mood, appetite, protein preference and saved taste untouched.

## Policy and honest limits

The existing Python ranking first establishes strong taste matches and hard eligibility. The isolated `services/demo_refinements.py` adapter only orders that qualified pool:

- **Less creamy:** explicitly `Creamy`-labeled dishes receive lower priority. Missing labels remain unknown, not proof of non-creaminess or absence of dairy. This is not an allergy or dietary filter.
- **Something lighter:** favors the fixture's `light` portion annotation, not lower calories or healthier nutrition.
- **More spicy:** favors higher documented heat. Unknown heat is not described as spicy or mild.
- **More adventurous:** favors higher curated demo novelty. This is not a claim that the user has never tried a dish.

These short directional preferences have equal weight; existing taste score and ID break ties. Original taste scores and admission thresholds are unchanged. Budget tiers still come first: up to three excellent in-budget dishes, then excellent above-budget dishes only to fill remaining positions, with exact integer-cent overages. Hidden alternatives remain hidden. Refinements cannot rescue a weak taste match or bypass safety. Menu data was not expanded or invented for this milestone.

“Try another dish” explicitly sets the currently displayed primary picks aside and asks for other strong matches, possibly fewer than three. Set-aside IDs accumulate within this meal (bounded to 50). They cannot return as primary picks, stretch alternatives or pairing components. “Bring back earlier picks” clears that history while preserving flavor refinements. Reset clears both. Exhaustion returns a distinct `no_alternatives` empty state; it never introduces weak fillers.

TasteBridge is rebuilt for the selected dishes using existing saved taste evidence. Its evidence requirements remain independent: a strong recommendation may honestly have no supported bridge. Complete My Table is rebuilt from the new mains. Worth the Stretch uses the same refined qualified pool, excluding current primaries. Pairing still uses the existing culinary provider and validated prices; flavor directions do not claim to optimize the entire meal's nutrition or flavor.

## Contract and future provider boundary

`RecommendationRequest.refinements` is an optional, bounded `RefinementRequest` with typed `preferences` and real `avoid_dish_ids`. Python rejects unknown/ambiguous menu IDs and duplicate choices. The optional `RecommendationSession.refinement_result` echoes the request and supplies provider/mode, `inactive`, `applied`, `unchanged` or `no_alternatives` status, an explanation and limitations. “Unchanged” compares the order/selection with the original unrefined picks under the same current constraints, not an arbitrary earlier screen.

A future Meta culinary provider can consume this intent and replace provisional ordering/explanation at the backend boundary. Python must continue validating qualified menu identities, restrictions, evidence, output membership, duplicates, budget tiers and amounts. No culinary heuristics live in React, and no Meta, Google Places or Supabase integration is included here.

The existing request signature and abort handling invalidate all related sections while a new selection loads. Response binding now also compares the exact refinement intent; missing refinement results are accepted only when no refinement is active. Presentation guards reject set-aside IDs in primary, pairing and stretch results. All other generated API fields retain strict validation.

## Actual demo behavior

With a $30 target and saved axes `spice=.45, richness=.6, freshness=.6, crunch=.5, aromatic=.8`:

| Restaurant / direction | Resulting primary picks |
| --- | --- |
| Saigon Table / original | Lemongrass Chicken, Pho Gà, Crispy Mushroom Bánh Mì |
| Saigon Table / lighter | Crispy Mushroom Bánh Mì, Fresh Summer Rolls, Lemongrass Chicken |
| Saigon Table / spicier | Bún Bò Huế, Lemongrass Chicken, Crispy Mushroom Bánh Mì |
| Saigon Table / adventurous | Bún Bò Huế, Crispy Mushroom Bánh Mì, Crispy Tofu Bún |
| Casa Sol / less creamy | Crispy Mushroom Tacos, Chicken Tinga Bowl, Birria Tacos |

Saigon Table has no explicit creamy labels: less creamy alone honestly leaves its selection unchanged. At Casa Sol, trying another after the above less-creamy selection returns only Street Corn, with a warning that it is still labeled creamy. Trying again exhausts the strong choices and offers reset.

## Verification and manual review

Focused tests live in `api/tests/test_refinements.py`, `web/tests/refinements.cjs` and `web/tests/e2e/refinements.spec.ts`. They cover real selection changes, combinations of preferences, no evidence, unknown attributes, hard restrictions, exact budgets, unseen alternatives, reset, synchronized related sections and stale responses. Existing Picks, TasteBridge, pairing, stretch, contracts and feedback checks remain applicable.

Manually try the examples above, combine directions, remove one with the keyboard, reset, exhaust alternatives, change the budget and hide above-budget dishes. Return to the same menu to check temporary intent persists, then choose another branch to check it clears. Inspect desktop and 320px phone layouts and the evidence limitations. Reloading intentionally clears refinements.

The ranking remains deterministic demo logic. All menus and culinary annotations are fictional fixtures. No real nutrition, live model inference or personal familiarity verification is claimed. Browser mobile coverage uses Chrome emulation, not physical Safari.

### Completed verification

- 167 targeted Python tests passed: refinements, existing primary ranking, sparse profiles, stretch, TasteBridge, pairing, generated-contract consistency and OpenAPI responses.
- 27 targeted frontend unit tests passed; TypeScript passed.
- One production build passed in the isolated `.next-refinements-qa` directory.
- 24 focused desktop/mobile production browser checks passed. Desktop and 320px mobile refinement screenshots were reviewed, including selected states, disclosures and keyboard focus.
- Existing Starlette/HTTPX deprecation and test-runner color-environment warnings remain non-blocking. No unrelated full-suite run or external integration was performed.

Focused new checks can be rerun with:

```bash
cd api
.venv/bin/python -m pytest tests/test_refinements.py -q
cd ../web
node --test tests/refinements.cjs
npm run typecheck
# With the API on 8000 and the frontend on 3100:
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/e2e/refinements.spec.ts
```
