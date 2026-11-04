# DineTuned V2 architecture

## One contract, one decision engine

FastAPI's Pydantic models in `api/app/schemas.py` own the domain contract. Extra fields fail validation; taste values are finite and normalized to 0–1; unknown sensory values are null; prices use integer USD cents.

`api/scripts/generate_contracts.py` emits TypeScript response types and the runtime JSON schemas used by `web/lib/validation.ts`. Regenerate after changing schemas and commit both outputs. `--check` detects drift. The lightweight validator supports the schema features used by these models; new schema features require extending the validator and its tests.

```text
React pages and reusable controls
    → same-origin Next.js relay (/api/dinetuned)
    → FastAPI (/api/v2)
    → catalog service / guided profile / eligibility
    → deterministic recommendation pipeline
```

There is no client-side catalog or ranker. Menu search is presentation-only; the menu evaluation API determines eligibility for both the complete-menu and matching views.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /api/v2/health | Actual capabilities; always demo in this milestone |
| GET | /api/v2/restaurants | Explicit name/cuisine/area query; optional coordinate sorting |
| GET | /api/v2/restaurants/{id}/menu | Entire categorized fixture with provenance and version |
| POST | /api/v2/menu/evaluate | Per-item eligibility, reasons, and counts; no truncation |
| POST | /api/v2/taste/profile | Explicit guided answers → canonical profile |
| POST | /api/v2/recommendation-sessions | Up to three distinct eligible picks with evidence |

Original health/restaurants/taste/recommendation paths remain as aliases, but now use the V2 contract. Incompatible V1 request fields receive 422 instead of being ignored. The general paid model endpoint is removed.

The relay forwards only approved paths, with no caching and a 12-second timeout. Provider secrets are never sent to the browser. Default API URL is localhost; production must configure an internal/reachable upstream.

## Domain rules

- Dietary selections combine with AND semantics and require supported evidence.
- Allergies are a distinct structure. Known conflicts and unknown ingredient/cross-contact evidence have different exclusion codes.
- A saved profile restriction is merged into the session constraints so an accidentally incomplete request cannot drop it.
- The UI synchronizes profile and dining constraints when the user explicitly changes restrictions.
- Unknown prices never qualify. Prices are per dish before tax/tip; there is no total-meal/cart budget. Smart Menu matching keeps a strict cap; Step 4A Picks uses a soft target, placing qualified within-target dishes before labeled above-target alternatives.
- Unknown sensory features do not contribute to similarity. Exploration and temporary context affect ranking only after the persistent-taste quality gate passes.
- Explanations describe low and high intensities correctly and expose their sample evidence.
- Fewer than three qualified dishes produces fewer picks; no duplicates, invented dishes, hidden overages, or relaxed dietary/allergy restrictions. See [Step 4A](V3_SIGNATURE_PICKS.md) for the exact demo policy.
- A catalog content hash versions menus. A stale recommendation request returns 409 and asks the user to revisit the full menu.
- Every fixture contains incomplete allergen evidence. Allergy-selected sessions intentionally have no qualified picks.

## State and journey

`AppProvider` waits for browser storage restoration before mounting journey screens. The V2 storage schema is validated on restore. Valid V1 profiles and meal memories migrate; the old key remains untouched until the user explicitly resets the demo.

Returning users land on search. New users complete Taste Detective before discovery/menu screens. A restaurant selection for picks is created only by the explicit action on the full-menu screen. No default restaurant is substituted.

Menu requests and evaluations use abortable fetches. Responses for previous constraints are not displayed as current. API failures block recommendation creation while preserving chosen filters.

Recommendation session responses are stateless: the backend returns an ID, timestamp, menu version, effective constraints and recommendations. It does not persist users or sessions. A refreshed picks page requests a new session from the saved menu selection.

Feedback is local and idempotent per recommendation-session/dish pair. It does not update preferences or train a model. Step 4B.1A adds menu-version provenance to new memories and forwards bounded rating metadata for TasteBridge on the next Picks visit. Free-text feedback is not sent to the provisional reasoner.

## Media

`DishArt` renders local SVG placeholders with motif/seed differences, consistent dimensions, and visible labels. No external food images are loaded. Artwork is not ingredient evidence or verified restaurant photography. Future verified assets can replace the placeholder adapter and must carry attribution/provenance.

## Future boundaries

`engines.py` declares interfaces for Taste Detective, recommendations, TasteBridge, menu intelligence, and learning. [TasteBridge's structured demo provider](V3_TASTEBRIDGE_FOUNDATION.md) sits behind a replaceable reasoning interface and independent evidence validation. The final architecture delegates culinary reasoning to Meta and retains Python validation and safeguards. No live Meta integration runs; `meta_client.py` remains dormant and is not imported by the customer API.

Before a real-user release, add authenticated storage, deployment rate limits, persistent session/feedback repositories, consent and deletion controls, source retrieval policies, verified menu evidence, and evaluated live model integration.
