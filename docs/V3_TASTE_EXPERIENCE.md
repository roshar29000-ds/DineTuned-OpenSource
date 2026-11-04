# V3 — Taste Detective and Taste DNA

This milestone changes only `/onboarding` and `/taste`, with supporting frontend state, components, styles, and tests. The existing V2 backend, generated API contracts, restaurant search, full menu, recommendations, and feedback remain in place. No dependencies or external models were added.

## Experience

Taste Detective uses visual dish prompts, multiple selections, comparisons, suggested reasons, and contextual replies. All required responses are taps; custom allergy text is optional. It covers favorite dishes, the reasons behind them, richness versus freshness, heat, texture, ingredients to enjoy or avoid, preparation, curiosity, and separately managed dietary/allergy requirements.

Selecting ramen, curry, or aroma as a reason adds an aromatic follow-up. Removing its trigger removes the obsolete answer. Suggestions are presented for consideration, never preselected. Users can leave questions open, revisit earlier answers, edit the final review, and resume a draft after reload. Existing Taste DNA is only replaced after a successful API response and explicit publishing.

Taste DNA includes an interactive seven-axis sensory map, inspectable evidence, direct/tentative/open indicators, manual adjustments, tasting notes, curiosity, and separate essential restrictions. Unknown dimensions have open markers, not false zeroes. Manual edits are tracked individually and survive reload.

## Architecture

- `web/lib/detective/model.ts`: versioned local answer/draft records, curated visual options, branching, selection rules, and defensive restoration.
- `web/lib/detective/engine.ts`: replaceable `DetectiveEngine` interface, deterministic demo analysis, explicit evidence, contextual replies, and the V2 wire adapter. It does not rank dishes.
- `web/components/taste/`: conversation, reusable selection cards, sensory visualization, and DNA dashboard.
- `web/app/taste-v3.css`: scoped responsive styling and reduced-motion behavior.
- `web/components/AppProvider.tsx` and `web/lib/storage.ts`: additive V3 metadata under the existing `dinetuned-v2` storage key. V1/V2 migration and canonical profile validation remain intact.

Publishing calls the existing FastAPI `/api/v2/taste/profile` endpoint through the Next.js relay using the unchanged `TasteAnswers` contract. The local demo engine enriches the validated response using the existing nullable `TasteAxes` fields. This also restores nulls where the V2 categorical request requires a neutral fallback. The enriched canonical `TasteProfile` is validated before storage and later sent unchanged to the existing backend recommendation service.

Detailed interview answers remain browser-local metadata. As of [Step 4A](V3_SIGNATURE_PICKS.md), saved structured choices are also adapted into optional recommendation evidence fields for the Python ranker; the existing profile contract is unchanged. A future Python/Meta implementation can replace the analysis behind `DetectiveEngine`. No backend ranking algorithm is duplicated in the browser.

Sensory DNA and culinary curiosity represent persistent preferences. Budget, mood, and appetite remain in the existing V2 dining-constraints state. Publishing DNA preserves that context; changing it does not alter sensory axes or tasting evidence. Dietary restrictions and allergies continue to synchronize with the canonical profile. An unfinished draft does not change live restrictions. Explicit essential updates elsewhere synchronize into the draft so it cannot restore stale restrictions.

## Demo reasoning and limits

- Favorite dish names only personalize questions and suggestions. They do not imply a heat preference or ingredient tolerance.
- Selected reasons, ingredients, and some preparations provide tentative sensory clues. Explicit comparisons and direct answers take precedence.
- Numeric preference values are illustrative constants, not measured scores or probabilities. Confidence labels describe the evidence source, not predictive accuracy.
- Disliking a specific ingredient does not imply disliking its entire sensory dimension. Ingredient dislikes and preparation notes are stored but are **not hard menu exclusions**. Existing supported dietary/allergy controls remain the path for hard constraints.
- Open curiosity uses the V2 engine's neutral 0.5 fallback, explicitly labeled as unanswered. Sensory unknowns stay null.
- Food drawings are local, labeled illustrated prompts, not restaurant photos. The catalogue is deliberately small; it is not comprehensive cuisine coverage.
- No Meta integration, natural-language reasoning, learning, accounts, or server-side evidence persistence. The demo's allergy uncertainty behavior is unchanged.

## Run and inspect

Use the existing README's two-terminal setup. No additional install or keys are required. Visit `http://localhost:3000/onboarding` for the new conversation and `/taste` for saved DNA.

1. Select curry and a reason, then proceed: an aromatic detour appears. Repeat with only tacos and a non-aroma reason; the detour is absent.
2. Select mild heat and chili as an ingredient. DNA must show Heat 18 with direct evidence taking priority.
3. Leave every sensory question open. DNA must show 0/7 dimensions and open markers, not inferred medium values.
4. Reload halfway, revisit a previous answer, and edit a note from the final review.
5. Publish, inspect chart evidence, adjust a dimension, leave it unknown, and reload.
6. Change menu mood/appetite and check DNA stays the same. Budgets and allergies must survive publishing DNA.
7. Disconnect FastAPI before publishing; check the retry message retains your notes.
8. Check narrow/mobile and desktop layouts, keyboard selection/inspection, and reduced-motion preference.

## Automated checks

```bash
cd web
npm run typecheck
npm test
npm run build
```

Browser tests require a production frontend at port 3100 and a running backend, as described in README. On this Mac use:

```bash
cd web
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
```

The suite covers the V3 conversation and evidence behavior alongside existing V2 menu, budget, allergy, discovery, feedback, and recovery regressions. Mobile tests use Chromium emulation, not physical iOS or Safari.

Verified on 2026-10-24: TypeScript passed; 19 frontend unit tests passed; 51 backend tests passed; generated contracts were current; Next.js production build passed; 29 browser tests passed with one intentionally skipped duplicate viewport test. Responsive checks covered 320, 390, 768, and 1440 pixels, plus the existing V2 desktop project. Browser integration used isolated production Next.js on port 3100 and FastAPI on 8100. One existing Starlette/HTTPX deprecation warning remains in the backend suite.
