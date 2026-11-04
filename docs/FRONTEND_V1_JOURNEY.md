> Historical V1 snapshot. Current behavior and setup are documented in the root README and docs/ARCHITECTURE.md.

# DineTuned frontend V1 interactive journey

## Journey

Welcome -> Taste Detective -> Taste DNA -> Discover -> Restaurant -> Picks -> Memories.

The frontend implements demo-only simulated preference choices and local browser memory. Meta models are **not** being called by these screens yet.

- **Taste Detective**: user lists favorite dishes, selects comfort/fresh flavor style, heat, texture, diet; prompt changes depending on earlier answers; derived taste profile saved in localStorage. This is a **guided simulation**, not ML active-learning.
- **Taste DNA**: editable profile attributes. Sliders affect the picks.
- **Discover**: fictional restaurant catalog, cuisine filters and search.
- **Restaurant**: fictional menus, category filters and price limit.
- **Picks**: deterministic scoring, mood/budget updates, distinct recommendation categories, TasteBridge preview explanations. No actual taste-prediction validity claim.
- **Memories**: meal rating and optional comment saved locally. This does not yet retrain any AI model.
- **How it works**: transparent integration statuses and demo data provenance.

## Demo user test

1. Navigate to `/onboarding` and enter `I love butter chicken, spicy ramen, and crispy tacos. I avoid overly sweet sauces.`
2. Select rich & comforting, bring the heat, crunchy, and no preference (adjust to preference).
3. Complete onboarding, see Taste DNA, drag a slider and note changed value.
4. Browse fictional `Saigon Table`, choose a budget of $25, find three picks.
5. Change mood to light & fresh and inspect the ranking.
6. Expand TasteBridge insight and log one rating.
7. Open Memories and confirm rating is saved. Refresh and confirm memory remains.
8. Go to How It Works and check actual integration status.

## Next engineering milestone

Test server-side Meta credentials, replace guided onboarding with Muse Spark + quantified active-learning policy, and connect menu parsing; then deploy, instrument and evaluate.
