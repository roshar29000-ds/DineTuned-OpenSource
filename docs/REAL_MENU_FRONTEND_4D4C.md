# Step 4D.4C — real menus in the frontend

The real restaurant journey now continues from **selected Google branch → explicit website source check → selected menu documents → explicit extraction → all recovered categories and dishes**. The frontend uses the existing signed 4D.4A source manifest and the 4D.4B extraction API. It does not generate dishes or call Meta.

## Customer experience

1. Choose an exact restaurant branch in the separate Real restaurants experience. Provide the official HTTPS website/branch URL and press **Find menu sources**. Website lookup is still manual; no paid website field is requested automatically.
2. Inspect branch, service, date and access evidence. Explicitly select one or more eligible HTML/text-PDF documents, up to eight. Nothing is preselected or extracted automatically. **Select all supported sources** includes multiple menu sections/documents where available.
3. Press **Extract selected menus**. Honest loading feedback covers actual retrieval and parsing, with no artificial waiting. Stop waiting, edit the website, change document selection or choose another restaurant to invalidate pending results. Cancellation does not guarantee the backend has stopped its current bounded fetch.
4. The recovered menu receives focus and the source chooser collapses. Browse every returned category using the category navigation. Names/descriptions are transcribed text, not generated copy. The interface deliberately uses typography rather than unverified food photographs.
5. Prices show explicit currency codes and the correct minor-unit scale, including zero-decimal JPY and three-decimal KWD. Variants retain their names and individual prices. Ranges, missing prices, ambiguous symbols and missing descriptions remain visible; no cheapest size, conversion, ingredient or dietary guarantee is inferred.
6. **Source & item notes** opens the supporting source text and PDF page links. **Sources & verification** includes retrieval dates, source hashes, menu/parser versions and extraction warnings. Original discovery notes are labeled as preceding extraction. Retrieval dates never imply that a restaurant's menu is current or complete.

**Personalized Picks remain gated for real menus.** The page explains that ingredient, dietary, allergen cross-contact and availability evidence is unverified. TasteBridge and meal pairings are not activated. Real menus never enter the fictional `RestaurantMenu`/recommendation pipeline. Existing Taste DNA, session preferences, demo Picks and private dining history are preserved.

## Errors and recovery

Blocked, unreadable, empty or mismatched sources produce an explanation and recovery options, never a demo substitute. Scanned PDFs and images explicitly need unsupported vision extraction. Mixed readable/scanned sources retain recovered items with a visible missing-page warning. Expired manifests require a deliberate new source check or branch selection; neither is repeated automatically.

Upload, camera capture, PDF preview and QR/manual links retain their existing **local preview only** behavior. Files are not uploaded or extracted by these controls. A different official link can be entered in the website field; checks still require explicit action and valid authorization. Signed source tokens and extracted menus remain in component memory, not browser storage or Supabase. Reloading intentionally clears this ephemeral restaurant/menu context; it does not clear Taste DNA or dining history.

Source and extraction jobs still share the backend limits (five/user/hour, 30/day globally). Repeated button clicks cannot start duplicate frontend jobs. Changing the source selection removes the previous menu immediately. Request IDs, branch identity, source membership, document hashes, item IDs and evidence links are checked before display. Owner/restaurant changes unmount the extraction workspace and invalidate late responses.

## Modules

- `MenuSourceDiscovery.tsx`: existing URL discovery flow, now handing its signed result to `MenuExtractionWorkspace.tsx`.
- `MenuExtractionWorkspace.tsx`: explicit document selection, abortable extraction lifecycle, errors and recovery.
- `RealRestaurantMenu.tsx` / `app/real-menu.css`: categorized presentation, literal prices, evidence disclosure, responsive styling and recommendation gating.
- `lib/menu-retrieval/extracted-presentation.ts`: presentation-only currency scaling and source-page links.
- `lib/menu-retrieval/extraction.ts`: existing typed client, strengthened to reject unrequested/missing document sets and inconsistent empty results.
- The private Next.js relay now checks Origin against the actual HTTP Host. This fixes NextURL's loopback-IP normalization rejecting legitimate `127.0.0.1` requests, while retaining scheme/port/foreign-origin rejection and ignoring untrusted forwarded hosts.

No backend extraction, ranking, eligibility, pairing, TasteBridge or database contract was changed. No dependency or migration is added.

## Offline verification

Targeted backend tests use local HTML/PDF fixtures and block external network access:

```bash
cd ~/Downloads/dinetuned-starter/api
.venv/bin/python -m pytest tests/test_menu_extraction.py tests/test_menu_sources.py tests/test_discovery.py tests/test_persistence.py tests/test_dining_memory.py tests/test_signature_picks.py -q
.venv/bin/python scripts/generate_contracts.py --check
```

```bash
cd ~/Downloads/dinetuned-starter/web
node --test tests/menu-extraction.cjs tests/menu-sources.cjs tests/places.cjs tests/identity.cjs tests/dining-memory.cjs tests/database.cjs
npm run typecheck
npm run build
```

Browser coverage uses a dedicated **test-only** FastAPI app. It runs production source/extraction routes, signature validation, HTML/PDF parsers and assembly with mock website/Auth transports. Outbound connections are blocked. Signing keys, guest identities and rate-limit state are temporary fixtures; the real `.local` state, Meta ledger and live Supabase are not used. The app requires an explicit environment flag and is never imported by production. Never deploy this fixture app.

Terminal 1:

```bash
cd ~/Downloads/dinetuned-starter/api
DINETUNED_OFFLINE_BROWSER=1 .venv/bin/python -m uvicorn browser_menu_app:app --app-dir tests --host 127.0.0.1 --port 8126
```

Terminal 2 (isolated production frontend):

```bash
cd ~/Downloads/dinetuned-starter/web
export NEXT_BUILD_DIR=.next-real-menu-build
export DINETUNED_API_URL=http://127.0.0.1:8126
export GOOGLE_PLACES_ENABLED=false GOOGLE_PLACES_LIVE_APPROVED=false
export GOOGLE_PLACES_API_KEY='' MODEL_API_KEY='' SUPABASE_URL='' SUPABASE_PUBLISHABLE_KEY=''
npm run build
npm run start -- --hostname 127.0.0.1 --port 3126
```

Terminal 3:

```bash
cd ~/Downloads/dinetuned-starter/web
PLAYWRIGHT_CHANNEL=chrome E2E_BASE_URL=http://127.0.0.1:3126 E2E_API_URL=http://127.0.0.1:8126 npx playwright test tests/e2e/real-menu.spec.ts tests/e2e/menu-sources.spec.ts tests/e2e/journey.spec.ts
```

Google discovery and browser Supabase Auth are mocked. Source checks/extraction travel through the real Next.js relay to fixture-backed FastAPI. Cases include 13 items across two HTML documents, all 18 dishes on three PDF pages, currency/size variants, source subsets, scanned/empty fallback, local PDF preview, expired/invalid responses, duplicate clicks, cancellation and stale results. Desktop and 320px mobile viewports cover keyboard use, overflow and reduced motion; mobile uses Chrome emulation, not physical Safari. The existing fictional menu journey is also exercised.

Verification passed: 203 targeted Python tests, 53 distinct frontend/local database checks, generated contracts, TypeScript and the final production build. The focused browser matrix passed 45 cases; one existing mobile duplicate of the desktop multi-viewport test was intentionally skipped. Desktop and 320px screenshots were reviewed. Browser testing found and fixed the real loopback Origin-check bug; test selectors were scoped to distinguish visible prices from evidence quotes and our alerts from Next.js's route announcer. The existing Starlette/HTTPX deprecation warning remains non-blocking.

The standard application still starts with the [README commands](../README.md#run-locally). Keep the actual `api/.env` Google live flags false until a separately approved test. No live website or paid API calls are authorized by this documentation.

## Before 4D.5 personalization

- Obtain explicit approval for a small real-site acceptance check, then compare recovered items, categories, prices and omissions to official sources. No live restaurant extraction was verified in this milestone.
- Establish current menu identity/version, trustworthy fixed/selected-variant prices and currency compatibility, dish availability and the ingredient/allergen evidence needed for hard safeguards. A successful extraction alone does not satisfy these checks.
- Connect the existing replaceable Meta culinary provider to validated real menus, preserving evidence references and incomplete-menu limitations. Reuse the $10 cumulative ledger, explicit spend approval and disabled-by-default paid calls.
- Keep unknown ingredients/allergens conservative and allow fewer or zero eligible recommendations. Preserve full-menu-first navigation and current budget policy.
- Real uploaded/scanned-menu extraction remains a separately scoped capability. Automatic website discovery, persistent real-menu caching and cross-currency budget conversion are not implemented here.
