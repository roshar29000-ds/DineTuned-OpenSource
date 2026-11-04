# V3 Step 4A — Signature Personalized Picks

Picks now uses an editorial hero, lead dish spread and count-aware 0–3 layouts, exact overage badges, qualitative compatibility, evidence/unknowns disclosures, and the existing feedback flow. The full-menu-first journey and strict Smart Menu filtering remain intact. No Meta models, external imagery, live restaurants, or menu extraction are connected.

## Selection policy

1. Merge persistent dietary/allergy requirements with meal requirements. Exclude unsupported dietary evidence, allergen conflicts, uncertain ingredient/cross-contact information, unavailable dishes, unknown prices, and duplicate dish identities.
2. Compare shared known sensory dimensions. Inferred dimensions have lower weight. Saved dish families, textures, cooking methods and explicitly listed ingredients provide additional evidence. Mentioned disliked ingredients disqualify a primary pick; missing mentions never prove absence. Legacy free-text favorites are retained but not interpreted.
3. Apply a quality threshold **before** price and session bonuses. With at least two shared dimensions, at least two must be within 0.30 and weighted closeness must reach 720/1000 (the existing alternative route is 750 plus two feature clues). As of the focused zero-pick fix, one shared dimension needs 750 plus **one independent saved feature connection**; e.g. aroma plus favorite curry. A texture note and its crunch value cannot count twice. No shared dimensions still needs three feature clues. Any known dimension differing by 0.70 or more fails. These tunable demo heuristics are not validated predictions.
4. Rank qualified dishes by integer points: sensory closeness, feature evidence, mood, appetite, protein preference and exploration. Tie-break by dish ID. Session cravings cannot rescue a weak persistent-taste match.
5. Take up to three qualified within-target dishes first, then fill remaining slots with qualified above-target dishes. Integer cents determine boundaries and exact overages; no maximum overage is imposed. Hiding alternatives may return fewer picks or zero without changing safeguards.

`eligible_count` and per-item `/menu/evaluate` eligibility **remain strict**, including price. New `recommendation_candidate_count` counts dishes with no exclusion other than budget, enabling the explicit Picks action when only above-target candidates remain. It does not relabel those dishes as strict menu matches.

## Architecture

- `api/app/services/recommendation_ranking.py`: deterministic quality gate, score, grounded evidence, differences and unknowns.
- `api/app/recommend.py`: hard safeguards, budget tiers, unique selection, session identity; legacy bridge/category fields retained for compatibility.
- `api/app/schemas.py`: additive structured notes, meal options, dish features, compatibility and budget position. New request inputs have defaults. Python-generated frontend types and runtime schemas stay synchronized.
- `api/app/data/catalog.json`: conservative curated feature annotations, never extracted facts. Their content changes the menu version; older saved selections must revisit the menu.
- `web/lib/recommendations.ts`: saved-note adapter and response identity checks, without client ranking.
- `web/app/picks/page.tsx`, `web/components/recommendations/RecommendationCard.tsx`, `web/app/picks-v3.css`: presentation and existing feedback integration.
- `recommendationOptions`: temporary protein preference and visibility, separate from persistent Taste DNA. Old browser state migrates with defaults.

Abortable Picks requests bind branch, menu version, profile, notes, all constraints and options. Mismatched responses and incorrect overages are rejected. Changing restaurants clears the previous menu-review selection. Stale menu requests retain the existing backend 409 behavior.

## Run and manually review

No dependencies were added. From the repository root, use separate terminals:

```bash
cd api
source .venv/bin/activate
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

```bash
cd web
npm run dev
```

Open http://localhost:3000. Complete/revisit Taste Detective, select a restaurant, browse the full menu, then press **Find My Personal Picks**.

- Review the lead spread, illustrations, dish reasons and evidence/unknowns on mobile and desktop.
- At Saigon Table, try a mild, moderately rich, crisp profile with $18.99 and Vegetarian + No pork. A qualifying $19 tofu dish displays **$0.01 above**. The strict menu filter still excludes it. Actual pick count depends on saved taste; weaker matches are not filler.
- Hide above-target alternatives, refresh, then try a $0 target. Reveal alternatives again; safety requirements stay unchanged.
- Change budget, mood, appetite and protein; revisit the menu for diets/allergies. Switch branches and confirm a new menu action is required.
- Select an allergy: all current fixtures have incomplete allergy/cross-contact evidence, so no picks are offered. The complete menu stays browsable.
- Save dish feedback and inspect Memories; no training takes place.

## Verification and limits

Verified on 2026-10-25:

- Python API and recommendation tests: **75 passed**. Existing Starlette/HTTPX deprecation warning remains.
- Frontend unit tests: **31 passed**; TypeScript and generated-contract checks passed.
- Next.js production build passed with no added dependencies.
- Production browser regressions (`journey`, `smart-menu-v3`, `signature-picks`): **35 passed, 1 intentional skip**. The skipped mobile case repeats the extra viewport matrix already run in the desktop project.

Coverage includes API contracts, cent boundaries, no arbitrary overage cap, combined restrictions, unknown allergens, quality admission, 0–3 picks, deterministic ordering, duplicate rejection, structured evidence, state migration, stale responses, feedback and responsive browser flows.

Browser checks use desktop Chrome and mobile viewport emulation, not Safari or physical devices. Exhaustive final Step 4 QA is deferred. The catalogue is a small fictional fixture; scores are uncalibrated and are never shown as percentages. Food drawings remain clearly labeled placeholders. Full TasteBridge, My Table, Worth the Stretch, conversational refinements, persistence and learning remain later milestones.

## Focused zero-pick fix

The former evidence-count gate rejected an aroma 0.85 + favorite curry profile at Spice Garden even though Chana Masala and Butter Chicken passed safeguards and scored 940/900 for the known dimension. It demanded two additional feature clues instead of allowing one independent saved preference to support the sensory match. Score thresholds, detailed-profile behavior, hard eligibility, and budget tiering are unchanged. Sparse matches disclose limited taste coverage; unknowns remain null.

Candidate rejections now distinguish insufficient shared evidence from weak/conflicting taste matches. Sessions with insufficient evidence suggest unanswered dimensions that the menu can compare. Hard exclusions and hidden above-budget alternatives retain their separate states.

Verification for this fix: 42 targeted Python recommendation tests, 4 targeted frontend unit tests, TypeScript, and 2 desktop browser cases (sparse and detailed onboarding-to-Picks journeys). No full test suite or production build was run. The sparse browser case used actual Taste Detective controls, saved/reloaded DNA, and the running local API, asserting the transmitted profile/notes and two rendered picks. The user's existing Chrome tab could not be read because Apple Events JavaScript access was disabled; it is not claimed to have been inspected.

Actual fixture examples: aroma 0.85 + curry → Chana Masala and Butter Chicken; richness 0.87 + pasta → Basil Pesto Gnocchi and Spicy Rigatoni; richness 0.87 + ramen → Spicy Miso Ramen. At a $17.99 target, Chana Masala's $18 price shows exactly $0.01 over; dietary and allergy exclusions still take priority. These are deterministic demo connections, not calibrated predictions or live Meta reasoning.
