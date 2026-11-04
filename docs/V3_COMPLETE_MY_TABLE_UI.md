# Step 4B.2B — Complete My Table presentation

The Picks page now places a standalone `CompleteMyTable` chapter after all primary recommendation cards and before the existing meal-preference controls. In-card TasteBridge and feedback remain intact. Future sections can follow this chapter without changing its components or the primary recommendation loop.

## Presentation

The forest-green heading introduces **Complete My Table — The little things that make a meal.** Up to three meal options show their main dish and subtotal in an accessible chooser. One composed table is visible at a time, with main/accompaniment illustrations, verified names and categories, itemized prices, portion labels, a prominent meal subtotal, and backend-authored explanations. Options are alternative meal ideas, not an order or shopping cart.

Arrow keys, Home and End switch options; Tab reaches the selected panel and its native “Why this pairing” disclosure. The disclosure contains the complete rationale, claims, evidence sources and uncertainties. Narrow screens stack the options and table composition; long names and explanations wrap. Reduced-motion preferences disable transitions and smooth scrolling.

## Data boundaries

- No Python code, generated contracts, recommendation/pairing policy or TasteBridge implementation changed.
- `web/lib/meal-combinations.ts` binds the optional pairing data to the current session's restaurant, menu version, primary dish identities and budget target. It rejects orphaned evidence and duplicate or unrelated combinations without changing primary Picks. Existing request-signature and abort handling hide the entire old selection while preferences or restaurant change.
- All culinary wording comes from validated backend rationale and claims. “Light accompaniment” / “Substantial additional dish” use the explicit menu `portion` fact. Missing or contradictory portion evidence displays “Portion not specified.”
- Prices, individual overages and subtotals are rendered through the existing `money` utility. The UI does not sum item prices, rank dishes, infer dietary eligibility or treat the per-dish target as a meal cap. Tax, tip and fees are explicitly excluded.
- The optional menu read supplies existing local `DishArt` assets for additions. Assets must match restaurant, version, item identity, category, name and price. Primary artwork can be reused directly from the response. Unavailable artwork gets a neutral plate, not a guessed food image. Illustrations are visibly labeled.
- Missing, unavailable, unsupported and stale pairing data receive concise fallbacks. A changed menu snapshot suppresses the table chapter's combinations and directs the user back to the full menu. Valid primary Picks and their feedback remain independent of optional artwork or pairing failures.

## Review manually

1. Explore a complete demo menu, then choose **Find My Personal Picks**. Scroll below the primary cards to Complete My Table.
2. Switch between meal options with touch, mouse and arrow keys. Check that names, illustrations and prices change together.
3. Expand **Why this pairing** and review the saved-preference connection, supporting menu evidence and limitations.
4. Set a low per-dish target, including a cent amount such as `$18.99`. Overages belong to individual dishes; the meal subtotal remains neutral. Toggle “Hide above-budget alternatives.”
5. Review at desktop width and 320px/390px phone widths. Check long names, disclosure focus and reduced motion.
6. Save feedback on a primary dish, revisit Memories, and return to Picks. The existing memory behavior should remain unchanged.

Run the application in separate terminals from the repository root:

```sh
cd api
.venv/bin/uvicorn app.main:app --reload --port 8000
```

```sh
cd web
npm run dev
```

The section uses the existing fictional menus and deterministic provider. There is no ordering, new meal-selection algorithm, external AI, Worth the Stretch or Make It More Me functionality. The current demo provider proposes one accompaniment; the presentation supports the contract's multiple-addition structure. Physical-device and Safari testing remain separate from Chrome mobile emulation.

## Verification

TypeScript, 16 targeted frontend unit/contract checks, one production build and the final 24-test desktop/mobile regression pass succeeded. Coverage includes 0/1/2/3 combinations, exact backend prices and overages, missing/unavailable/limited data, missing evidence, current restaurant/menu/preference identity, illustration failures, explicit/unknown portions, long copy, keyboard interaction, reduced motion, and 320px overflow. Existing primary-selection, TasteBridge, allergy, stale-request, complete-menu-first and feedback checks also passed. Actual desktop, phone and narrow-phone screenshots were reviewed; artifacts remain in ignored `web/test-results/`.

```sh
cd web
node --test --test-name-pattern='table|meal combinations|TasteBridge|Picks bind|invalid response shapes' tests/unit.cjs tests/meal-combinations.cjs
npm run typecheck
npm run build
# With the app and backend running; adjust E2E_BASE_URL to your frontend port:
PLAYWRIGHT_CHANNEL=chrome E2E_BASE_URL=http://127.0.0.1:3000 npx playwright test complete-table.spec.ts signature-picks.spec.ts tastebridge.spec.ts journey.spec.ts --grep 'Complete My Table|three, two|late responses|wrong response|unknown Taste|TasteBridge|feedback is'
```
