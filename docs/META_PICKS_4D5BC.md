# 4D.5B–C: Real-menu TasteBridge, meal ideas and refinements

This extends the signed extracted-menu Picks path from 4D.5A. The normal application still reports real-menu Meta dispatch as disabled. No Google, Meta, restaurant website or live Supabase request is needed for the offline fixture journey. The existing Meta ledger, $10 cumulative target, 4D.5A zero-attempt policy and Google rate limits are unchanged.

## One bounded reasoning request

`RealCulinaryProposal` now carries ranked candidates and optional meal pairings in one strict Muse Spark JSON response. The same candidate's validated preference ID and **complete** source-menu quote provide a limited TasteBridge. Extra exceptional above-budget candidates become Worth the Stretch only after the primary in-budget-first, up-to-three selection, and only if distinct from all primary picks. The model proposes pairing IDs; Python resolves every item from the signed menu, applies the same hard safety and price eligibility, rejects repeated or unknown items, and adds exact integer-cent subtotals. Pairing prose is assembled from the selected source text; culinary harmony remains a model judgment, not a verified restaurant fact.

TasteBridge deliberately does not assert shared ingredients or preparation for a familiar dish when Taste DNA contains only its name. The UI labels this a limited source-linked connection. No uncertain ingredient, price, diet or allergen detail is filled in. The present extraction format cannot certify dietary suitability or cross-contact, so an active restriction or allergy still excludes all unknown-safety dishes, including meal additions and stretch picks.

## Temporary refinements and memory

The existing `RefinementRequest` is included in the typed real-menu request and model context. Less creamy, lighter, spicier and adventurous choices are temporary; they require a fresh explicit **Tune My Table** click. `avoid_dish_ids` removes earlier dishes before the model call and is rechecked after it. Reset clears the temporary choices without changing Taste DNA. If no strong alternatives remain, the normal zero-pick response is shown. Changing restaurant, menu, budget, restrictions, refinements or auth identity invalidates visible results and aborts the old request.

The authenticated backend reads up to four current feedback records and two dining events through the existing user-scoped Supabase repository. Ratings/notes are identified as **user reports**, with conflicting ratings treated as neutral. Saved, selected and ordered events are context only; they never become positive taste anchors or proof of eating. Confirmed negative feedback for the same restaurant, menu version and dish excludes that dish. No new database table, Taste DNA overwrite or learning algorithm was added. If cloud memory is unavailable, Picks can still use current Taste DNA and the response states the memory limitation.

Real Picks reuse the existing dining journal for explicit save, select, order, try and rate actions. The menu ID, restaurant, menu version and reported provider enter recommendation history; event IDs remain stable across duplicate clicks/retries. A rating requires explicit tried confirmation. Memory retains its existing correction/deletion and cloud-error behavior. Mock provider records remain labeled as mocked provenance. A new request is needed for corrected feedback to affect a later recommendation.

## Validation and remaining limits

- Server reconstructs the trusted source context, IDs, citations, exact prices, budget overages, restrictions and menu version before publishing each section. Bad optional pairings are dropped without suppressing valid primary picks.
- Browser validation checks that all returned primary/stretch/pairing dishes, prices, citations, totals and refinements match the currently selected extracted menu. Older 4D.5A responses with no optional sections remain readable.
- Real-menu imagery is not fabricated. Menu descriptions and availability remain source-limited; tax, tip and fees are excluded from subtotal.
- The extended JSON response is still subject to the existing 24 KB request and 3,072 output-token limits. A real-menu Muse Spark call and its culinary quality have not been live evaluated. The Girl & the Goat branch-to-menu journey also remains unverified against the live site.
- Production remains disabled until a separately approved one-attempt cost allowance and deliberate invocation are reviewed. Public paid dispatch needs consent and idempotency controls. No Meta or Google spending limits were changed here.

Focused offline checks: `api/tests/test_real_picks.py`, `api/tests/test_meta_culinary.py`, `api/tests/test_usage_budget.py`, `web/tests/real-picks.cjs`, generated-contract check, TypeScript, production build, and desktop/mobile real-menu browser fixtures. Browser fixtures block external connections and use a mocked Muse Spark response.

Final verification: 150 focused Python tests, 19 frontend dining-memory/real-Picks checks, TypeScript and the production build passed. Six affected desktop/mobile browser cases passed; the two changed lighter-refinement cases were rechecked against the production build. No real provider request or ledger update occurred.
