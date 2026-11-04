# Step 4B.3 — Worth the Stretch

The final Picks section follows Complete My Table and precedes the current meal preferences. It shows zero to two additional above-budget dishes; an empty selection adds no placeholder section.

## Selection and contracts

- `recommend.py` retains the existing primary selection: qualified within-target dishes first, then qualified above-target dishes, up to three.
- Worth the Stretch takes up to two remaining dishes from the same ordered, qualified above-target pool. It never scores again, changes thresholds, includes a primary twice, or fills with weak matches.
- The existing hard eligibility checks (diet, allergies, uncertain allergens, availability, reliable prices, unique menu identity) run before either selection. Strict Smart Menu budget filtering is unchanged.
- Hiding above-budget alternatives returns an empty stretch selection and omits the UI immediately while the new request resolves.
- Optional `worth_the_stretch` carries restaurant/menu identity, provider/mode, and `picks`. `PersonalizedDish` shares the exact dish, explanation, compatibility, budget and TasteBridge fields of primary recommendations, without their primary-only category. Older responses can omit the new field.
- `present_dish` assembles menu prices, integer-cent overages and validated TasteBridge data independently of ranking. Pairing still receives only the primary recommendations; meal totals are unchanged.

The temporary culinary fallback remains `services/recommendation_ranking.py`. There is no second scoring engine. A future Meta ranking adapter must provide evidence-validated culinary assessments at that boundary; Python must retain hard eligibility, menu identity, deterministic selection assembly and monetary validation. The response and presentation contracts can stay stable. No live model is connected in this milestone.

## Presentation integrity

The page's existing request signature and abort handling clear old results on preference changes. `sessionMatchesRequest` binds the entire response to restaurant, version, Taste DNA, session preferences and saved feedback. The new `stretchPicks` helper additionally checks the optional envelope, unique non-primary identities, eligibility results, exact budget positions and bridge identity. An inconsistent optional extension is omitted; shape-invalid core prices or fields still fail API decoding. Tolerance for missing/malformed optional TasteBridge data does not loosen any other contract.

The UI renders backend explanation and evidence verbatim, with qualitative compatibility, visible caveats, expandable evidence and the existing TasteBridge component. No culinary relationships are inferred in React. Local menu illustrations are explicitly labeled. Keyboard disclosures and reduced-motion support are included. Prices exclude tax, tip and other fees; stretch dishes are alternatives, not automatic additions to a meal subtotal.

## Reproducible demo examples

Using axes `spice=.45, richness=.6, freshness=.6, crunch=.5, aromatic=.8`, other axes unknown, no dietary restrictions or allergies, default session preferences and an **$18 per-dish target**:

| Restaurant | Additional dish | Price | Overage | Backend evidence |
| --- | --- | --- | --- | --- |
| Saigon Table | Lemongrass Chicken | $21 | $3 | Close on heat, freshness and richness. |
| Saigon Table | Bún Bò Huế | $22 | $4 | Close on aromatics, freshness and richness; more heat and less crunch than the saved settings. |
| Casa Sol | Birria Tacos | $21 | $3 | Close on aromatics, crunch and heat; less freshness than the saved setting. |

These are examples for this specific profile, not universal recommendations. Different preferences can legitimately produce fewer or no alternatives. Current fictional fixtures do not document sufficient allergy controls, so declared allergies can exclude every dish.

## Focused verification

```bash
cd api
.venv/bin/python -m pytest tests/test_stretch.py tests/test_signature_picks.py tests/test_sparse_picks.py -q
.venv/bin/python -m pytest tests/test_tastebridge.py tests/test_pairing.py tests/test_api.py::test_generated_contracts_are_current tests/test_api.py::test_openapi_documents_responses -q
```

```bash
cd web
node --test --test-name-pattern='stretch|TasteBridge|Picks bind|meal combinations|table ' tests/unit.cjs tests/meal-combinations.cjs tests/stretch.cjs
npm run typecheck
NEXT_BUILD_DIR=.next-stretch-qa DINETUNED_API_URL=http://127.0.0.1:8000 npm run build
NEXT_BUILD_DIR=.next-stretch-qa DINETUNED_API_URL=http://127.0.0.1:8000 npm run start -- --hostname 127.0.0.1 --port 3100
```

With the API and production frontend running, the new desktop/mobile tests are:

```bash
cd web
PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/e2e/worth-the-stretch.spec.ts
```

Manually inspect the section below Complete My Table, exact overages (including a $20.99 target for a $21 dish), disclosures with keyboard navigation, hide/reveal behavior, and 320px phone layout. The automated tests use real demo responses and explicit presentation fixtures for long-copy cases. Mobile coverage uses Chrome emulation, not physical Safari. Existing primary, TasteBridge, pairing and feedback regression tests remain applicable.

### Completed verification — 2026-10-27

- 62 selection/ranking/sparse-profile checks and 88 TasteBridge/pairing/contract checks passed (150 targeted Python checks total).
- 20 targeted frontend unit checks passed; TypeScript passed.
- One production build completed successfully in `.next-stretch-qa`.
- 28 focused desktop/mobile production browser checks passed, covering stretch, primary Picks, TasteBridge, table rendering/fallbacks and saved feedback. Desktop and 320px mobile screenshots were visually reviewed.
- The initial desktop layout check found TasteBridge's negative margins overflowing the unpadded stretch layout. A scoped CSS fix passed the failed checks and the final production run; primary TasteBridge styling was preserved.
- The existing Starlette/HTTPX deprecation warning remains. No live AI, paid services, physical-device Safari coverage or unrelated full-suite testing was added.
