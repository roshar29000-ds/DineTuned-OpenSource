# Step 4B.1B — TasteBridge in Personalized Picks

The reusable `TasteBridge` component replaces the previous personal-note block inside each editorial dish card. A familiar anchor leads visually to the selected dish, followed by the first validated shared quality and, when available, a meaningful difference. Saved preferences are explicitly presented as a starting point rather than an invented favorite dish. Partial connections are labeled.

“Explore the connection” opens the complete backend explanation, shared qualities, differences, numbered evidence links, source provenance and uncertainties. Native disclosure controls support keyboard interaction. Sources distinguish Taste DNA, Taste Detective, curated fictional menus and reported dining memories; inferred preferences remain labeled. The display never calculates culinary relationships or confidence percentages.

The forest/ivory/bronze treatment uses local CSS and a small decorative SVG. Narrow phones switch the connection to a vertical thread. Motion is disabled under the user's reduced-motion preference. Existing illustration captions, exact budget overages, recommendation evidence, and feedback controls remain available. The existing ranking explanation now lives under “Evidence & unknowns.”

## Optional data and validation

`web/lib/tastebridge.ts` checks the presentation contract and reference integrity. Malformed or older optional bridge data becomes `null`; missing citations, wrong target references, uncited provenance and unsupported schema versions cannot render a comparison. Explicit unavailable states receive concise explanations for insufficient evidence, conflicting preferences, restrictions, rejected proposals or provider failure.

The normalization changes **only** `recommendations[*].taste_bridge` before the complete generated `RecommendationSession` decoder runs. It does not default, coerce or remove any other fields. Invalid prices, allergies, restrictions, profiles, budgets, missing fields and unexpected fields continue to fail validation. Existing request/session identity checks and stale-response handling remain in place. A broken optional comparison does not change selected dishes or their safety/budget policy.

Culinary validation remains in Python. Client checks protect rendering integrity; they do not verify culinary truth or interpret free text. A future validated provider can use the existing structured contract without changing the presentation.

## Verification and manual review

Focused unit tests cover optional response handling and unchanged core validation, plus actual demo evidence and malformed reference graphs. The JSON test fixture is an actual backend session narrowed to the ramen recommendation for isolated contract assertions.

The focused browser group covers real saved-memory and preference comparisons, disclosure keyboard controls, linked evidence, reduced motion, narrow screens, all fallback reasons, invalid core data, zero-to-three layouts, exact overages, hard allergy exclusion, stale requests, menu-first navigation, sparse Detective answers and feedback persistence. Screenshots are written to the ignored `web/test-results/` directory.

Verified: 10 targeted frontend unit tests, 31 backend TasteBridge tests, TypeScript, production build and 18 desktop/mobile browser scenarios. The first browser run found mobile overflow from the rotated disclosure icon; reserving 5 pixels for its rotation resolved it. Only the affected disclosure/fallback scenarios were rerun on both viewports after the fix. Desktop and mobile screenshots were reviewed, including the narrow 320-pixel connection layout. Chrome desktop and mobile emulation were used; Safari and physical-device testing remain outside this milestone. The backend run reports an existing Starlette/HTTPX deprecation warning.

Manually review the connection inside each Picks card, expand its explanation and follow a numbered source. Test a saved dining memory across restaurants, a profile without memories, and a narrow phone viewport. A memory only supports a familiar-dish anchor when its menu snapshot and supporting qualities are available; otherwise a partial preference bridge or honest fallback is expected.

No models, external APIs, ranking changes, additional Step 4B features or new dependencies are included.
