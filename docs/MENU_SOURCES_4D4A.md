# Step 4D.4A — real menu source discovery

This document records the source-discovery milestone. [Step 4D.4B](MENU_EXTRACTION_4D4B.md) now extends its result with an optional signed extraction permit and an authenticated HTML/text-PDF extraction API; the existing discovery UI is preserved.

The implemented path is **verified Google branch → supplied restaurant website → bounded public website checks → attributed menu candidates**. This is functional source discovery, not a simulated crawl. It makes public HTTPS GET requests only after the user presses **Find menu sources**. Automated tests replace every website response with fixtures.

## What works

- Uses the selected Place ID, restaurant name and address. A server-signed, user-bound snapshot prevents the browser from substituting an unverified branch.
- Reads ordinary HTML navigation, restaurant JSON-LD `hasMenu` links, branch/location pages, and explicitly advertised same-site sitemaps. Follows actual links, including restaurant-linked PDF/image assets on a CDN. No restaurant-specific adapter or hardcoded domain is used.
- Prioritizes matching branch menus and separates delivery, takeaway/ordering, catering, other locations, older and future-dated menu labels. Incomplete evidence remains visible rather than being converted into a confident match.
- Returns URLs, parent source links, HTML/PDF/image format, branch relevance, qualitative confidence, provenance, evidence, limitations, discovery time and content-check time. PDF/image signatures are sampled; their contents are not parsed.
- Shows candidates within the existing search experience with expandable evidence. Failed, restricted or uncorroborated checks offer the existing upload/camera/QR preview controls. These controls still do not extract dishes.
- Preserves demo menu → Picks, Taste DNA, private Memory, ranking and allergy safeguards. No database migration is needed.

**Website URL required:** Step 4D.3 deliberately does not request Google's `websiteUri`. This milestone does not expand the paid field mask, search Google/Maps, guess a domain, or run another paid lookup. The user must supply a public HTTPS URL believed to belong to the restaurant. Matching self-published name/address evidence corroborates branch relevance; it does **not** independently prove domain ownership. Missing or contradictory branch evidence cannot produce an extraction-ready candidate.

**Sources are not dishes:** `sources_found` means at least one corroborated candidate is available for subsequent extraction. It does not establish a complete menu, current prices, availability, food safety or current operating hours. Older-year labels are flagged conservatively; an undated menu is not assumed current. A website check timestamp is not a menu revision date. No real-restaurant `RestaurantMenu`, fabricated menu version, dish, price or recommendation is created.

## Modules and API

`api/app/menu_sources/` separates the provider protocol/agent (`agent.py`), contracts (`models.py`), branch proof (`identity.py`), HTML/identity parsing (`pages.py`), URL policy (`urls.py`), connection-time public-IP pinning (`network.py`), robots rules (`robots.py`), bounded fetching (`fetch.py`), atomic job limits (`limits.py`) and authenticated routing (`routes.py`).

`POST /api/v2/menu-sources/discover` requires a fresh Supabase bearer token. The Next.js relay exposes it at `/api/dinetuned/menu-sources/discover`, requiring same-origin writes. Request fields are:

| Field | Meaning |
| --- | --- |
| `request_id` | New UUID for this deliberate source check; a repeated ID is rejected without recrawling. |
| `restaurant` | Unmodified `DiscoveredRestaurant` returned by branch selection. |
| `selection_token` | Server-issued `source_discovery_token` from that selection; not a provider API credential. |
| `website_url` | User-supplied public HTTPS website or branch page. |

`MenuSourceResult` is deliberately separate from `RestaurantMenu`. Its `status` is `sources_found`, `needs_review`, `no_trustworthy_source` or `access_limited`; `menu_status` is always `sources_only`. Candidates carry `extraction_status: not_extracted`. `suitable_for_extraction` identifies a next-stage input, not an approved dining recommendation. `verified_at` is null for links whose contents were not checked. The generated TypeScript/runtime schemas preserve required identity fields while allowing older handoffs to omit the new proof.

Frontend components are `MenuSourceDiscovery.tsx`, `lib/menu-retrieval/source-discovery.ts` and `app/menu-sources.css`, integrated into `PlacesSearch.tsx`. Requests are explicit, abortable and never automatically retried. Editing the URL, changing the user or restaurant, and unmounting invalidate pending responses. Returned restaurant/request identity must match before any candidates appear.

## Access and resource safeguards

- Supabase verifies the user server-side. The snapshot proof binds the full selected restaurant payload to that user. It has a one-hour normal lifetime. An explicit source-discovery request may accept that same signed snapshot for up to six hours after selection, so a tab kept open during menu review does not require another paid Places lookup. All other proof checks retain the one-hour expiry; changed branches, owners, or signatures are rejected. No extra Google request is needed to issue or verify it.
- HTTPS/443 only; no URL credentials, signed links, IP-literal hosts, local hosts, encoded traversal, Google/Maps/photo endpoints or Meta endpoints. Each connection resolves DNS with a bounded resolver, rejects non-public/mixed/transition addresses, and connects to the checked literal IP while retaining the original Host and TLS verification name. Redirects undergo the same checks. Cross-domain redirects are refused; explicitly linked menu assets are a separate, checked source.
- Exact-branch corroboration accepts matching Restaurant/LocalBusiness JSON-LD, one matching `<address>` block, or one visible full street/city/postcode beside a restaurant-named page. A page listing multiple street addresses does not gain exact-branch status from a footer. Generic menu labels, a branch-looking URL, and a user-supplied domain alone never make a source eligible.
- Robots allow/disallow precedence, wildcard/end rules, crawl delays and request rates are respected. Missing robots (404/410) permits checking; restricted/unavailable robots fails closed. No login, CAPTCHA, paywall or access-control bypass. `nofollow`, `noai`, and challenge responses are honored. No JavaScript execution, platform scraping, cookies, forwarded user tokens or API keys are sent to websites.
- Up to 12 outbound request attempts, including robots and redirects; at most 8 visited links, depth 3, 3 origins and 12 reported candidates. There is a 22-second elapsed work budget checked between operations/chunks, a maximum 4-second HTTP-operation timeout and a 2-second DNS timeout. These are bounded operations, not a promise of an exact wall-clock deadline. The relay timeout is 45 seconds to allow authentication and cleanup.
- Maximum 2 MB received per job; 750 KB HTML, 512 KB robots, and 8 KB PDF/image signature samples. Compressed responses are refused rather than expanded. Default per-origin pacing is 0.4 seconds; larger published delays are honored or the job stops. These waits respect sites rather than simulate processing.
- SQLite reservations enforce 5 jobs/user/hour, 30 jobs/day globally, 1 active job/user and 2 active jobs globally. Failures consume reservations; there are no automatic retries. Repeated UUIDs return 409; exceeded limits return 429.

Local state is Git-ignored: `.local/menu-sources/selection.key` (random 32-byte signing key, mode 0600) and `.local/menu-sources/requests.sqlite3` (UUIDs, hashed owners, timestamps/status only). No Google content or website bodies are persisted there. Keep this directory on a durable volume for a single backend deployment; all workers must share it. Separate replicas with separate disks do not share limits or proof keys. Use shared infrastructure before scaling. Add network-level egress restrictions in production as defense in depth; application validation alone cannot control custom network routing. Do not delete local state to bypass limits.

Candidates and selected identity remain ephemeral React state and `private, no-store` API responses. They are not added to browser storage, Supabase, Taste DNA or recommendation history. Avoid request/response-body logging at proxies and observability services.

## Running and manual verification

Keep both values in `api/.env` false:

```dotenv
GOOGLE_PLACES_ENABLED=false
GOOGLE_PLACES_LIVE_APPROVED=false
```

No new API key or environment variable is needed. Preserve existing Supabase credentials and data. Restart the backend after configuration/code changes:

```bash
cd ~/Downloads/dinetuned-starter/api
source .venv/bin/activate
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

In a second terminal:

```bash
cd ~/Downloads/dinetuned-starter/web
npm run dev
```

The no-charge discovery configuration endpoint must report Google disabled. Existing fictional demo browsing still works. A **new live Google selection remains a separate billable action requiring explicit approval**; this milestone does not authorize one. Old/pre-milestone selections have no signed proof, and reloading intentionally clears ephemeral Places data. The app explains that a fresh verified selection is needed; it never repeats a paid lookup automatically.

After a separately approved selection, a current signed handoff can be checked with Google disabled: enter the restaurant's official HTTPS site, press **Find menu sources**, inspect source links, branch evidence, dates and limitations. An address mismatch, blocked robots, inaccessible website or missing menu must produce an honest review/fallback. No Picks button or fictional substitute menu should appear. Check keyboard activation, narrow phones, the evidence disclosures, and changing the URL/restaurant during a pending check. No live public-website or Google verification was performed during implementation.

## Offline verification

```bash
cd ~/Downloads/dinetuned-starter/api
.venv/bin/python -m pytest tests/test_menu_sources.py tests/test_discovery.py tests/test_persistence.py tests/test_dining_memory.py tests/test_signature_picks.py -q
.venv/bin/python scripts/generate_contracts.py --check
```

```bash
cd ~/Downloads/dinetuned-starter/web
node --test tests/menu-sources.cjs tests/places.cjs tests/identity.cjs tests/dining-memory.cjs tests/database.cjs
npm run typecheck
```

Browser coverage lives in `tests/e2e/menu-sources.spec.ts`. It mocks Google, website-source discovery and Supabase responses, uses three fictional source-site fixtures in backend tests, and covers keyboard use, 320px phones, fallbacks, old proofs, wrong identities and delayed requests. Backend tests block sockets, DNS and live HTTP transports by default. Production transport tests replace the underlying connection rather than opening sockets.

Implementation verification passed: 151 targeted Python tests (46 source-discovery cases plus discovery/Memory/Picks regressions), 43 frontend/local PostgreSQL checks, generated-contract verification, TypeScript, and one production build. All 20 selected desktop/mobile browser cases passed after updating the older feedback journey test to honor the existing explicit tried-dish confirmation and separate event/rating records. Final desktop and 320px screenshots were reviewed. Mobile coverage uses Chrome emulation, not a physical phone/Safari. The existing Starlette/HTTPX test-client deprecation warning remains non-blocking.

For browser QA use isolated backend/frontend ports with `SUPABASE_URL='' SUPABASE_PUBLISHABLE_KEY='' GOOGLE_PLACES_ENABLED=false GOOGLE_PLACES_LIVE_APPROVED=false GOOGLE_PLACES_API_KEY='' MODEL_API_KEY=''` on **both** servers. Set the frontend's `DINETUNED_API_URL` to the isolated backend and use a separate `NEXT_BUILD_DIR`. Then:

```bash
PLAYWRIGHT_CHANNEL=chrome E2E_BASE_URL=http://127.0.0.1:3124 npx playwright test tests/e2e/menu-sources.spec.ts
```

## Remaining for 4D.4B and later

1. Obtain an official website seed automatically through a separately approved, policy-compliant provider; do not silently add paid Places fields.
2. Retrieve and extract HTML/PDF contents with source references, versioning, completeness/freshness checks, verified prices/currency and exact-branch reconciliation. Binary signatures alone are insufficient.
3. Add approved Meta vision parsing only under the existing spending controls; keep model output separate from deterministic identity, provenance and safety validation.
4. Assemble a verified complete menu before enabling real Personalized Picks. Preserve the full-menu-first journey and hard safeguards.
5. Handle JavaScript-only sites and menus without explicit address evidence through authorized sources or supplied files, without claiming successful extraction.

No Meta/Google/other paid API calls, database writes/migrations, real menu parsing or culinary reasoning are part of this implementation. The existing Meta usage ledger and $10 policy are unchanged.

Implementation references: [RFC 9309 robots rules](https://www.rfc-editor.org/rfc/rfc9309.html), [HTTP Core custom network backends](https://www.encode.io/httpcore/network-backends/), [Schema.org Restaurant](https://schema.org/Restaurant), and [hasMenu](https://schema.org/hasMenu). The crawler is deliberately stricter than general-purpose crawling for redirects, formats and access failures.
