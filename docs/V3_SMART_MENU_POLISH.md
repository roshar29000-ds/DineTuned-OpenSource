# V3 Step 3 — Premium Smart Menu and retrieval polish

## Scope and behavior

This milestone refines the existing restaurant-to-menu journey. FastAPI remains the owner of eligibility and deterministic recommendations; its schemas, strict per-dish budget policy, dietary/allergy handling, and ranking are unchanged. Taste Detective, Taste DNA, search providers, and the Personalized Picks page are preserved. No dependencies or external integrations were added.

- The retrieval screen adds restrained brand motion and a compact mobile menu preview. Its four stages still reflect actual work reading the saved demo response. No minimum display time or artificial delay was introduced; successful retrieval automatically shows the complete categorized menu.
- The successful checks receipt is a small, collapsed **Sample menu ready / View checks** disclosure below the restaurant introduction. Evidence, actual sample excerpts, recovery previews, and local source controls remain accessible inside it.
- Failed quality checks prominently show upload, camera, and QR options alongside the recovery explanation on desktop, and directly below it on mobile. Existing local-only capabilities and explicit simulation labels remain intact. These controls do not extract menu text.
- A primary **Find My Personal Picks** action appears near the top, a secondary action follows the menu, and a fixed mobile bar provides Picks and Filters while scrolling. The bar hides while the top action is visible, sits above existing mobile navigation, and reserves page space for the end of the content.
- All actions use one availability state and one selection handler. They show the server's eligible dish count and are disabled while checks are pending, failed, mismatched, or yield zero eligible dishes. Nothing requests recommendations automatically.
- A response-binding check verifies the evaluation's branch, menu version, and current constraints before its results can enable Picks. This is response validation, not a new eligibility algorithm.
- Menu typography, dish cards, category navigation, filter summary, unavailable labels, and error/empty states are refined. Category links can restore a hidden category without removing constraints. Complete menu and matching-only views remain available.
- Desktop preferences use a compact, independently scrollable sticky sidebar. Mobile uses a native dialog with an independently scrolling body, persistent close/back controls, Escape dismissal, keyboard focus wrapping, focus restoration, and background-scroll locking. Filters are reachable from the category toolbar and mobile action bar.
- The **menu** slider uses $1 increments. Exact typed or saved values such as $18.99 remain exact, survive refresh, and are sent to FastAPI unchanged. For an exact fractional limit, the whole-dollar slider rests at the lower whole dollar until moved; its accessible value explains the exact limit above. The Picks page retains its original cent-step control.
- Dietary choices remain multi-select. Allergies stay separate and conservative. Mood and appetite remain session preferences and do not overwrite sensory Taste DNA.

## Implementation map

- `web/components/menu/MenuPicksAction.tsx`: shared button, eligibility count, and disabled-state presentation.
- `web/components/menu/MenuPreferences.tsx`: desktop sidebar and mobile dialog lifecycle/accessibility.
- `web/components/menu/RestaurantMenuView.tsx`: menu orchestration, response binding, all three CTA placements, complete/filter views.
- `web/components/menu/PreferenceControls.tsx`: optional slider increment; exact budget input unchanged.
- `web/components/menu/MenuItemCard.tsx`: unavailable and failed-check labels.
- `web/components/menu-retrieval/`: polished progress and discreet success / prominent recovery layouts.
- `web/lib/menu.ts`: validation that evaluation evidence belongs to the current branch and preferences.
- `web/app/smart-menu-v3.css`: scoped menu/retrieval styling and reduced-motion support.
- `web/tests/e2e/smart-menu-v3.spec.ts`: CTA payloads, exact budgets, stale/error responses, mobile dock, dialog keyboard behavior, and screenshots. Existing journey tests now use shared open/close filter helpers.

## Run locally

From the project root, in one terminal:

```bash
cd api
source .venv/bin/activate
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

In a second terminal:

```bash
cd web
npm run dev
```

Visit `http://localhost:3000`. Existing dependencies are sufficient. See README for first-time setup and isolated QA ports/build directories.

## Manual review

1. Complete Taste Detective if needed, search **Saigon**, and choose a specific branch. Confirm all six sample dishes appear before requesting Picks.
2. Confirm **View checks** starts collapsed. Expand it to inspect evidence or preview all four recovery states. Try a local image/PDF, camera capture, or QR source; no extraction success should be claimed.
3. Review the top CTA, dish cards, and sticky category toolbar. On mobile, scroll past the top CTA to reveal the bottom action bar above navigation. Scroll back to the top and confirm the duplicate bar hides.
4. Open Filters from the toolbar or mobile bar. Move the slider: each step is $1. Type **18.99**, refresh, and confirm the exact limit remains.
5. Select **Vegetarian + No pork**. At Saigon Table and $18.99, two dishes qualify. Browse the complete menu to restore all six while retaining constraints.
6. Add **Peanuts** or another allergy concern. No picks qualify because the fixture cannot establish allergy suitability. Every dish remains browsable in Complete menu. No button may silently relax an allergy or budget.
7. Change mood/appetite, close the sheet, and try each Picks CTA. Confirm the chosen branch, exact budget, and current filters are reflected in the existing Picks page.
8. Set budget to **$0**, or search for a nonexistent dish. Review the explanations and use **Browse the complete menu** or **Review preferences**. Controls should not imply a service failure means zero eligible dishes.
9. On mobile, check the sheet using Tab, Shift+Tab, Escape, close, and Back to menu. Focus should return to the opener and background scrolling should resume. On desktop, check the sidebar and category navigation while scrolling.

## Limits and Step 4 handoff

All restaurant data and visual dish illustrations remain explicitly fictional. Upload/camera/QR are local browser interactions, with browser-specific camera/decoder support; physical devices and Safari need manual testing. Quality checks do not establish allergy safety. Real extraction, Meta, Google Places, feedback learning, and a Picks redesign are outside this milestone.

Before changing recommendation behavior in Step 4, define the flexible-budget opt-in, maximum permitted amount, displayed price explanations, and treatment of fewer than three eligible dishes. Current constraints remain strict; allergy and dietary rules must remain separately enforced. Use the preserved exact-budget and combined-restriction tests as regression coverage when that policy is deliberately revised.

## Verification

- TypeScript (`npm run typecheck`) passed after restoring the normal generated-type references.
- One optimized production build passed using isolated output `.next-v3-menu`.
- One full frontend unit run: **28 passed**.
- One full backend run: **51 passed**, with the existing Starlette/HTTPX deprecation warning. Generated contracts are current.
- One full production browser run: **59 passed, 1 intentionally skipped** duplicate mobile viewport case. This includes the original journey, Taste Detective/DNA, search, retrieval/fallbacks, and all new Smart Menu checks on desktop and mobile.
- Targeted browser checks during development verified exact budgets, combined restrictions, allergies, response binding, mobile focus behavior, and layouts at 320, 390, 768, and 1440 pixels. Visual review covered the menu, preferences sheet, retrieval, and recovery screens.
- QA used FastAPI on 8100 and Next.js on 3100; the user's existing servers on 8000/3000 were left intact. No generated output or secrets are included in this milestone.
