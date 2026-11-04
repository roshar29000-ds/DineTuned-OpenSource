# Step 4D.4B — real menu extraction

This document records the backend milestone. [Step 4D.4C](REAL_MENU_FRONTEND_4D4C.md) now connects its signed extraction API to explicit document selection and a real-menu frontend view; real recommendations remain gated.

The backend now supports **verified branch → signed 4D.4A source manifest → guarded document retrieval → HTML/text-PDF parsing → evidence validation → versioned, categorized menu**. This is actual local document parsing, tested against offline website responses and real PDF files. It is not Meta inference. No live restaurant website, Google, Meta or Supabase request was made during implementation or verification.

The existing source-discovery UI and fictional demo journey are preserved. A typed frontend extraction client and authenticated relay are ready, but **the real-menu viewing experience is not wired into the UI yet**. That is 4D.4C. Real extracted menus cannot enter the existing demo-only recommendation API.

## Supported sources

| Format | Supported behavior | Important limits |
| --- | --- | --- |
| HTML JSON-LD | `Menu`, `MenuSection`, `MenuItem`, nested menu sections/graphs, item descriptions, offers and price variants | Unsupported aggregate/unit price structures remain review issues. Structured data can itself be stale or inaccurate. |
| Ordinary HTML | Menu/dish blocks, semantic headings, description/price elements, menu tables with size columns, simple priced rows | Unknown layouts, empty sections, embedded menus and detected dynamic content produce warnings. No JavaScript execution. |
| Text PDF | Multiple pages, category headings, adjacent descriptions, prices and consistent two-column layouts | Every PDF requires layout review. Complex columns, typography and unassigned text can remain incomplete. |
| Scanned PDF / menu images | Recognized as needing vision; readable pages in mixed PDFs can still be retained | **Image transcription is unsupported.** No OCR/Meta call occurs. Mock vision output never becomes an actual dish. |

Up to eight corroborated menu sources can be processed in one request. The result preserves their categories and items, merges identical records with all origins retained, and flags conflicting versions of the same dish. A selected subset, unresolved source links or extraction limits prevent a complete-source assessment.

Offline fixtures cover four fictional restaurants/layouts, explicit currencies, variants, missing prices, an 18-dish/three-page PDF and a six-dish/two-column PDF. Blank and encrypted PDFs exercise honest failure states. These tiny PDF files are intentional test assets; `api/tests/fixtures/menu_extraction/build_pdfs.py` reproduces them. They are not real restaurant menus or evidence of live-site verification.

## Contracts, prices and provenance

`ExtractedRestaurantMenu` is separate from the existing USD/demo `RestaurantMenu` contract. It includes:

- The unchanged selected `DiscoveredRestaurant`, stable Place ID, schema/parser versions and a content-derived menu version. Identical source bytes and extraction content retain the same version across retrieval times; changes produce a new version.
- Categories, stable item IDs, literal names/descriptions, availability uncertainty and item-level limitations. If no category was established, `Uncategorized` is explicitly an organizational label.
- Each retrieved document's final URL, full-byte SHA-256, retrieval timestamp, page counts, parsed pages and original source-candidate evidence. The candidate is the historical discovery snapshot; its `extraction_status: not_extracted` is intentionally separate from the new document's extraction `status`.
- Evidence references containing the source URL/hash, normalized source quote, JSON pointer or HTML locator, and PDF page/line/column where applicable. Field support is checked independently before accepting parser proposals.
- `completeness.scope: supplied_source_set`. `accounted_source_records` only means the recognized records in those documents were accounted for. **`restaurant_menu_complete` is always false**: the pipeline cannot establish every current restaurant offering. A check timestamp is not the restaurant's menu revision date.

Prices retain their printed text, variant labels, currency and exact integer minor units. Supported numeric currencies are USD, CAD, AUD, EUR, GBP, CHF, INR (two decimals), JPY/KRW (zero), and KWD/BHD (three). Decimal arithmetic preserves values such as USD 12.5 → 1250 and KWD 3.250 → 3250. No exchange conversion occurs. Bare `$`/`¥`, unsupported currencies and ambiguous separators remain unknown unless explicit source evidence establishes them; the restaurant's location does not imply USD.

Ranges, variants, market prices, price qualifiers, unusually high/low prices and conflicting prices are retained for review rather than replaced with invented amounts or the cheapest option. `budget_usable` only indicates an unambiguous single printed amount; it does not certify availability, tax treatment, safety or recommendation eligibility. `basis: as_printed` makes no tax/tip assumptions. Mixed sold-out/unknown/available variants do not establish that an entire dish is unavailable.

No ingredient list, dietary classification, sensory feature or allergy guarantee is inferred from extraction. Ingredients/dietary arrays stay empty; allergen and cross-contact information remain unknown. Current availability is unverified unless the source explicitly lists all offers unavailable. **`recommendations_ready` remains false**. Existing strict demo dietary/allergy rules and flexible Picks budgets are unchanged.

## Authenticated handoff

1. Existing branch selection provides `handoff.restaurant` and a user-bound `handoff.source_discovery_token`.
2. An explicitly requested 4D.4A check returns `MenuSourceResult` with a new optional `extraction_token`. The server signs the entire manifest and selected identity for the authenticated user; clients cannot substitute URLs, evidence or confidence. Older manifests without a token cannot trigger extraction.
3. A deliberate `POST /api/v2/menu-extraction/extract` accepts the following body and a current Supabase bearer token:

```ts
{
  request_id: crypto.randomUUID(),
  restaurant: handoff.restaurant,
  selection_token: handoff.source_discovery_token,
  sources: sourceResult, // Unmodified server-issued discovery result and permit.
  candidate_ids: []      // All suitable sources, up to eight; or explicit eligible IDs.
}
```

Use the same-origin `/api/dinetuned/menu-extraction/extract` relay from the frontend. `web/lib/menu-retrieval/extraction.ts` already sends this request with fresh auth, supports cancellation, checks response identity/evidence relationships and never retries automatically. It does not start requests on import or activate recommendations.

Both branch and source proofs expire after one hour. Expired/altered manifests, another user's proof, unknown candidate IDs and unsuitable sources fail before crawling. A retry needs a deliberate new request UUID; duplicate job IDs are rejected. Re-checking expired sources is a new website action requiring approval in this development workflow. Selecting a fresh live Google branch is separately billable and also requires explicit approval; nothing automatically repeats that lookup.

The response is `extracted`, `needs_review` or `unavailable`, with structured issues and a possibly empty menu. This is not a promise of completeness. Encrypted/malformed PDFs, inaccessible documents, wrong branches and unsupported images return limitations rather than a fictional substitute.

## Safety and resource bounds

Extraction reuses 4D.4A's public-IP-pinned transport, HTTPS/443 URL checks, redirect/origin limits, robots/no-follow/no-AI restrictions and per-site pacing. No user bearer tokens, cookies or provider keys reach restaurant websites. The linking page and branch evidence are rechecked; contradictory identities, changed links and detected conflicting PDF addresses fail closed. Self-published name/address evidence corroborates relevance, not legal ownership of a supplied domain. Undated documents are not certified current.

- Up to 20 HTTP attempts including robots/redirects, 8 MB total received, 750 KB per HTML document, 512 KB robots and 2 MB per complete binary document. Compressed responses remain unsupported. Unlike discovery's signature sampling, extraction requires complete bounded documents.
- A 35-second fetch work budget is checked between operations/chunks, with existing bounded HTTP/DNS operations. Parsing/authentication add time; this is not an exact total wall-clock promise. The relay allows 90 seconds.
- PDF reading runs in a separate process without inherited credentials or network access: 24 pages, 120,000 extracted characters, bounded decoder output, four seconds CPU and seven seconds parent timeout. Linux also enforces a 768 MB address-space limit. Some macOS versions reject process memory limits; those retain the other bounds but **do not guarantee a hard memory cap**. Use a Linux/container memory limit for production document parsing.
- Source discovery and extraction share the existing atomic SQLite job caps: five/user/hour, 30/day globally, one active/user, two active globally. Failures count. There is no automatic retry, paid fallback or separate budget bypass.

The source permit uses a purpose-derived key from the existing ignored `.local/menu-sources/selection.key`; no new secret is configured. Existing request-limit state is preserved. Raw website/PDF bodies are processed in memory, not stored in Supabase or a permanent cache. Responses are private/no-store. Avoid body logging at reverse proxies. Shared deployment state and network egress controls remain production requirements described in [4D.4A](MENU_SOURCES_4D4A.md).

The Meta usage ledger and $10 policy are untouched. No database migration, Taste DNA overwrite or dining-history change is involved. Keep `GOOGLE_PLACES_ENABLED=false` and `GOOGLE_PLACES_LIVE_APPROVED=false` in `api/.env`. No Google or Meta key is required for extraction. Supabase authentication remains required at the public endpoint.

## Modules and offline verification

`api/app/menu_extraction/` contains contracts (`models.py`), signed authorization (`authorization.py`), literal HTML/PDF readers (`html.py`, `pdf.py`, `pdf_worker.py`, `parsing.py`), monetary transcription (`prices.py`), independent assembly/evidence checks (`validation.py`), orchestration (`pipeline.py`), the unavailable/mock vision interface (`vision.py`) and the authenticated route (`routes.py`). Pydantic generates the frontend TypeScript and runtime schemas through the existing script.

Install the updated backend requirements in the existing virtual environment if needed; Beautiful Soup and pypdf are now explicit dependencies pinned by `constraints.txt`. Preserve existing local environment files. Run both services using the [README commands](../README.md#run-locally). Ordinary startup/builds do not fetch restaurant menus. Do not make a live source/extraction request without separate explicit approval.

From the repository root:

```bash
cd api
.venv/bin/python -m pytest tests/test_menu_extraction.py tests/test_menu_sources.py tests/test_discovery.py tests/test_persistence.py tests/test_dining_memory.py tests/test_signature_picks.py -q
.venv/bin/python scripts/generate_contracts.py --check
```

```bash
cd web
node --test tests/menu-extraction.cjs tests/menu-sources.cjs tests/places.cjs tests/identity.cjs tests/dining-memory.cjs tests/database.cjs
npm run typecheck
npm run build
```

Backend tests prohibit external sockets/DNS/HTTP and use mock websites/authentication. PDF parsing uses local files. Frontend tests mock fetch; database isolation tests run in local PGlite, not the live Supabase project. Contract checks include stale identity, duplicate IDs, malformed prices and broken evidence. No new visual UI is introduced, so this milestone does not add browser interaction tests.

Final verification: **203 targeted Python tests and 49 frontend/local database checks passed**, generated contracts are current, TypeScript and the production build passed, and `pip check` found no broken requirements. The existing Starlette/HTTPX test-client deprecation warning is non-blocking. Google live flags remained false and the Meta ledger checksum was unchanged. No live restaurant extraction, browser UI integration or provider-billing verification is claimed by these offline results.

## Remaining validation and 4D.4C scope

Real-restaurant extraction has not been live-tested. It needs separately approved checks against several official HTML and text-PDF sources, with human comparison of source dishes, categories, descriptions, variants, currencies and omissions. JavaScript-only sites, complex PDF layouts, ambiguous currencies and sources lacking corroborated branch evidence may yield partial or unavailable menus. There is no universal completeness or freshness guarantee.

Recommended 4D.4C frontend integration:

1. Add an explicit extraction action after trustworthy source discovery, with real request progress, cancellation and stale restaurant/request protection.
2. Render the entire extracted categorized menu, retaining source/page links, price variants and currencies, unknown prices, unavailable items and concise incompleteness notices. Keep technical evidence expandable.
3. Keep real and fictional menus separate. Gate filters and recommendation actions on actual verified price, ingredient/allergen and availability evidence; do not fabricate demo annotations or bypass the menu-first journey.
4. Add focused desktop/mobile tests for partial results, errors, source switching and unsupported images before approved real-site acceptance tests.

Scanned-menu support is a separate follow-up: implement a real Meta vision adapter behind `MenuVisionProvider`, validate transcriptions and page evidence independently, and reuse the existing cost ledger/preflight and explicit per-call approval. The current mock interface is not a working OCR implementation. Real-menu culinary recommendations require a subsequent verified provider integration; this milestone does not enable them.
