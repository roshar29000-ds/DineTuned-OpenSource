# V3 Step 4B.1A — TasteBridge intelligence foundation

TasteBridge is an optional, structured explanation attached **after** Step 4A selects its 0–3 dishes. It cannot change ranking, prices, budget tiers, dietary/allergy eligibility, or selection count. The Picks layout and existing `bridge` compatibility fields remain unchanged; the new `taste_bridge` response is ready for a later presentation milestone.

## Reasoning and validation are separate

The final boundary is **Meta for culinary understanding and personalized reasoning; Python for evidence, safeguards, consistency and output validation**. No Meta API or other external service runs now. No new taste-ranking system was added.

1. `tastebridge/context.py` constructs a server-owned fact inventory from known Taste DNA dimensions, saved structured Detective choices, exact listed ingredient groups, curated dish annotations, and resolvable reported feedback. Every fact has a source, field reference, basis and applicable restaurant/menu/dish/feedback identity. Unknowns do not become neutral values. Free-text favorites and feedback notes are not parsed.
2. `TasteBridgeEngine.propose(context)` is the replaceable reasoning interface. `DemoTasteBridgeReasoner` provisionally chooses a familiar anchor and explicit fact relations. It does not rank dishes or infer new characteristics.
3. `tastebridge/validation.py` independently verifies identity, anchor membership, fact references, relations and duplicate/contradictory claims. Qualitative sensory comparisons use existing demo intensity bands, not new fit scores. Different ingredient lists cannot establish ingredient absence. Unrelated anchors, fabricated evidence, false similarities and unrestricted prose are rejected.
4. Public explanation text is rendered from validated relations. The reasoner receives a deep copy so it cannot modify the validator's authoritative evidence. Failed or unsupported reasoning returns an unavailable bridge while retaining the selected dish.

To integrate Meta later, implement the same provider interface and select it in the service composition. Meta receives evidence with stable local references and proposes anchors/relations using `BridgeProposal`. Python retains independent validation and hard safeguards; the frontend continues consuming `StructuredTasteBridge`. Newly understood culinary traits require source-backed evidence records. Arbitrary model prose is **not** made trustworthy merely by attaching a citation: this foundation deliberately publishes only the validated claim graph and its safe text projection. Richer free-form narration needs a separately evaluated semantic-validation policy before publication.

## Contract

- Request: optional `bridge_feedback` defaults to `[]`, capped at 20 reported ratings. It is independent of taste-ranking inputs. No notes or arbitrary culinary claims are accepted in this DTO.
- Recommendation: additive `taste_bridge` with schema version, provider, restaurant/menu/dish identity, anchor, shared connections, differences, explanation, referenced evidence and uncertainty.
- `grounded` means a resolved liked-dish comparison with multiple documented shared qualities; it is not a confidence probability. `limited` describes a narrower connection, including comparisons to general saved preferences. `unavailable` has an explicit reason and no invented comparison.
- Unsupported evidence, safety/identity failures, contradictory preferences, and provider failures are distinguishable.
- Existing request fields and legacy bridge fields remain. Generated TypeScript and runtime schemas come from Pydantic.

## Feedback provenance and persistence

New meal memories retain the recommendation's `menu_version`. Historical characteristics are used only when restaurant, dish and version resolve to the same available fixture snapshot. Older memories migrate with a null version and keep their original notes; no historical ingredients or preparation are assumed from them. Unknown restaurants, mismatched snapshots, future dates, contradictory ratings, and the target dish itself are not used as familiar food anchors. Negative feedback for the target suppresses its affirmative bridge, not the recommendation.

A positive rating establishes only that the user reported liking a dish, never **why**. Ratings are browser-reported, not authenticated server history. Current hard restrictions also apply to familiar dish anchors. Browser requests include bounded rating metadata without feedback prose. Picks captures this history on entry, so saving feedback does not regenerate the current session; the next visit uses the new rating. No learning or server-side persistence was added.

## Actual demo comparisons

These were produced through `/api/v2/recommendation-sessions`; the feedback scenarios use explicitly supplied sample ratings, not the user's private history.

1. **Chana Masala**, saved favorite curry + aroma 0.85 (`limited`): “You named curries among your favorites; Chana Masala belongs to that broad demo dish family. Your saved aromatic intensity preference and Chana Masala's demo profile both indicate pronounced aromatics.” No difference is invented when only those comparable facts exist.
2. **Spicy Miso Ramen**, reported liking of **Pho Gà at Saigon Table** (`grounded`): both have a broad noodle-and-broth family and little crunch in their demo profiles; the ramen's curated profile has more heat and richness and less freshness. Low crunch is not treated as proof of a soft texture. The bridge explicitly says the rating does not reveal why the user liked Pho Gà.
3. **Spicy Rigatoni**, reported liking of **Butter Chicken at Spice Garden** (`grounded`): tender textures and richness connect the dishes; pasta versus curry and higher sample heat are documented differences. No claim of identical flavor or shared unlisted ingredients is made.

## Focused verification

- 31 TasteBridge tests: genuine cross-cuisine/family comparisons, unknowns, contradictions, stale feedback, hard safeguards, unsupported claims, provider failure/mutation, and compatibility.
- 42 Step 4A recommendation regressions: sparse/detailed taste, exact budget behavior, 0–3 picks, duplicates and hard exclusions.
- 3 existing generated-contract, legacy-explanation and truthful-capability checks.
- 7 targeted frontend tests for request binding, saved evidence and feedback migration; TypeScript passed.
- One desktop browser test verifies feedback stays saved, does not trigger a new session, and sends versioned rating metadata on the next Picks visit.

No full test suite, broad browser suite or production build was run. The existing Starlette/HTTPX deprecation warning remains. Demo vocabulary and menu facts are intentionally limited; labels are not calibrated predictions, feedback is not verified dining history, and unknown ingredients/allergen safety remain unknown. There is no new Picks UI, Complete My Table, Worth the Stretch, conversational refinement or live AI integration.
