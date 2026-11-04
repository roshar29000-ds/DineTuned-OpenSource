# V3 Step 2 — Restaurant search and menu retrieval experience

## Scope

The `/discover` and `/restaurant/[id]` entry experiences now include premium autocomplete, explicit branch selection, honest menu preparation states, quality checks, and local menu-source fallbacks. Taste Detective, Taste DNA, FastAPI contracts, full-menu filters, and Personalized Picks remain in place. No package or external-service integration was added.

## Search

- The accessible combobox supports typing, arrow-key navigation, Enter to choose a highlighted branch, Escape, clearing, retries, and no-results states. Enter without a highlighted result never chooses a restaurant.
- Results include name, branch, cuisine, fictional address, sample dish count, and distance when requested. The existing server owns restaurant identity, filtering, and nearby ordering. A small frontend lookup supplies only explicitly fictional street-address labels because the V2 contract does not include street addresses; unknown IDs receive no invented address.
- Location is requested only after **Use my location**. Coordinates remain in component memory and are sent to the existing FastAPI demo search endpoint. They are not stored in the profile. Denial leaves name search available.
- Search is debounced and abortable. Stale responses never replace the current query's results.
- `RestaurantSearchProvider` is an adapter boundary for a future Google Places provider. Only `demoRestaurantSearch` is implemented. Live use still requires backend identity mapping, source-aware labels, and the appropriate API/security design.

## Real work behind the retrieval states

`MenuRetrievalProvider` describes abortable retrieval plus progress events. The current implementation:

1. **Finding menu:** requests the selected branch's existing FastAPI fixture.
2. **Reading menu:** reads the response body and validates the unchanged generated contract.
3. **Organizing dishes:** builds a category preview from the categories supplied by the backend.
4. **Checking accuracy:** checks branch identity, structure, declared coverage, prices, and source metadata.

There are no timed fake stages, minimum waits, simulated extraction, or remote menu requests. On a fast response, intermediate states may finish before the browser paints them. The completed checks remain inspectable under **Sample menu ready → View checks**, including real category/dish excerpts in original menu order. The loading-screen preview uses actual menu data when available, or the selected branch's actual demo-directory metadata; it never invents extracted items.

An accepted response is passed directly to the existing Smart Menu, avoiding a second fetch. Every category appears before the user can request picks. All canonical preferences remain in `AppProvider`. Arrival and progress animation respect reduced motion.

## Quality boundary

`assessMenu` produces ready, missing, incomplete, outdated, or unreliable outcomes. It checks the requested restaurant ID, unique dish/category IDs, category membership, non-empty names, declared item counts, source completeness, listed prices, and date/provenance evidence. Non-ready outcomes do not mount menu evaluation or generate recommendation sessions.

The default fixture policy requires all declared dishes and listed prices. A dated source older than 30 days needs review. An undated fictional fixture explicitly marks freshness **not applicable**, never “current.” Invalid or future dates fail closed. No quality check certifies ingredients, allergen suitability, or cross-contact safety.

`MenuEvidence` and `QualityPolicy` prepare for future server-supplied evidence. External extraction confidence is **not configured**; external sources fail closed until a separately evaluated threshold and verified source evidence are supplied. The 30-day window and price coverage are demo configuration, not validated industry thresholds. Real extraction quality enforcement must also be implemented server-side when that intelligence exists.

All fixtures are currently complete. To inspect recovery designs without falsifying their actual condition, open **View checks → Preview menu recovery states**. The missing/incomplete/outdated/unreliable scenarios are prominently labeled interface simulations. Returning to the sample menu preserves preferences and does not bypass the complete menu.

## Source fallback capabilities

- **Upload Menu:** validates a non-empty file up to 10 MB using MIME/type signatures; accepts JPEG, PNG, WebP, and PDF. Images get local previews; PDFs can be opened in the browser. File signatures are not proof of a fully valid PDF, and no pages or text are parsed.
- **Scan Menu with Camera:** uses a file input with `capture="environment"`. Supporting phones offer camera capture; other browsers offer a file chooser. Captured images are local previews only.
- **Scan QR Code:** feature-detects the browser's native `BarcodeDetector`, attempts local QR decoding, and accepts a single http/https URL without embedded credentials. Unsupported browsers provide a paste-link alternative. Recognition of a URL does not verify the site, identify a restaurant, or retrieve a menu. Opening a link requires a separate explicit click.
- No file is uploaded, sent to AI, persisted, or used to invent dishes. Object URLs are revoked on replacement/unmount. Generation guards discard late file/QR results after clearing, changing sources, or pasting a newer link.

Browser behavior follows [MDN's capture attribute reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture) and [BarcodeDetector availability](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector). QR decoding support varies; physical camera behavior and native QR recognition require device testing beyond Chromium emulation.

## Files and boundaries

- `web/lib/restaurants/`: search adapter, fictional-address presentation, request lifecycle.
- `web/components/restaurants/`: autocomplete and search page.
- `web/lib/menu-retrieval/`: retrieval provider, quality policy/evidence, local file and URL validation, QR adapter.
- `web/components/menu-retrieval/`: progress view, receipt, recovery states, source fallbacks.
- `web/components/menu/RestaurantMenuView.tsx`: consumes the already-validated menu; initializes responsive filters without a mobile open/close race.
- `web/lib/api.ts`: optional response-arrival callback, without changing existing callers or API payloads.
- `web/app/search-menu-v3.css`: scoped styles and responsive transitions.
- `web/tests/e2e/search-menu-v3.spec.ts`, `session-helpers.ts`, and added unit tests: search, quality, fallback, cancellation and responsive coverage.

## Run and manual testing

Use the existing two-terminal setup from README; no new install or keys are required. Visit `http://localhost:3000/discover` with a completed taste profile.

1. Type **Saigon**. Inspect both fictional addresses and branches. Press Enter without highlighting anything; the page should stay on search. Use arrows and Enter, or tap a branch, to select it.
2. Explicitly choose **Use my location**. Matching branches should reorder by distance. Declining permission should preserve search. No restaurant is selected for you.
3. Choose a venue. With network throttling you can inspect the real loading state. On a fast connection, open **View checks** to inspect the completed work; no artificial delays are added.
4. Confirm the complete menu appears, including dishes that do not meet your filters. Budget, dietary restrictions, allergies, mood, and appetite should be preserved.
5. Open **View checks → Preview menu recovery states** and inspect all four labeled scenarios. Use **Return to available sample menu** to resume browsing.
6. In a recovery preview, select an image/PDF or camera photo. Confirm the local-preview notice and that no dishes or extraction success appear. Clear the source and try another.
7. Try a QR image. Where decoding is unsupported, paste an https URL and check it. No external page opens without an explicit click. A `javascript:` URL must be rejected.
8. Try a nonexistent restaurant URL or stop the API temporarily. Confirm the recovery state offers retry and another restaurant, with no substitute menu.

Automated commands remain `npm test`, `npm run typecheck`, `npm run build`, `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`, and the backend pytest/contract checks documented in README. Browser tests run against isolated production Next.js on 3100 and FastAPI on 8100. Tests for native QR decoder results use controlled browser stubs; local image loading, file validation, URL handling, and unsupported-browser behavior run in the browser.

## Verification completed

- TypeScript and the optimized Next.js production build passed.
- Frontend unit tests: **27 passed**. Backend tests: **51 passed**; generated API contracts remain current. The existing Starlette/HTTPX deprecation warning remains.
- Full browser regression suite: **51 passed, 1 intentionally skipped** duplicate mobile viewport case, covering the original journey, V3 taste experience, and this milestone.
- After final presentation fixes, all **22 search/retrieval browser cases passed again** across desktop and mobile. Screenshots were reviewed for search, retrieval, and recovery; responsive checks cover 320, 390, 768, and 1440 pixel widths.
- Browser checks include real FastAPI communication, opt-in nearby sorting, explicit branch selection, stale-request cancellation, preserved constraints, quality failures, local sources, and QR fallback/race handling. Native camera hardware, Safari, and actual native QR recognition remain device-test limitations.
- The existing development servers were left intact; QA used separate ports and build output. No new dependency, backend contract change, Taste redesign, or Picks redesign was introduced.
