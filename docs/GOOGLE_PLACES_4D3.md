# Step 4D.3 — restaurant discovery, not menu retrieval

Historical milestone guide. The owner has since live-verified search and exact branch selection. [Step 4D.4A](MENU_SOURCES_4D4A.md) now adds signed selection proofs and source discovery from a supplied restaurant website; it does not add paid Google fields or dish extraction. Keep live Google flags disabled outside a separately approved test.

The real path is: **name/area search → explicit branch choice → Google identity → “Menu discovery coming next.”** The fictional demo is a separate source with its existing complete menu → Picks journey. There is no real menu fetch, Meta call, persistent Places-content cache or Supabase migration in this milestone.

## Enable only after approving Google spending

Implementation and automated tests need **no Google credentials**. Both backend switches default to false. Do not enable them during coding, builds or tests. Finding a key never enables a request. No Google Places requests were made to develop this milestone.

1. In Google Cloud Console, choose a dedicated development project, attach billing, and enable **Places API (New)** (`places.googleapis.com`). Do not enable the legacy Places API or other services for this task.
2. Create a dedicated server API key. Set **API restrictions → Restrict key → Places API (New)**. Use **application restrictions → IP addresses** with the backend's public outbound IP(s). For local development, use the development machine's public outbound IP, not `127.0.0.1`. A VPN/network change may require updating the allowlist. Production should use stable outbound IPs. Do not use browser-referrer restrictions for a backend key.
3. Under **APIs & Services → Places API (New) → Quotas & System Limits**, review and reduce the autocomplete and Details quotas available to your project. Start with the lowest practical limits (for example, 10 autocomplete requests/minute and 2 Details requests/minute); names and minimum values can differ by project. Also reduce daily quotas wherever Google exposes them. Confirm the enforced values in the console.
4. Under **Billing → Budgets & alerts**, create a small project-scoped Google budget (for example $5) with early alerts (10%, 50%, 90%, 100%). Alerts and free monthly allowances are **not spending caps**, and alerts can be delayed. Check actual SKU usage and billing after any live test. Google billing is separate from the Meta $10 development policy; the Meta ledger is untouched.
5. Keep Supabase anonymous auth configured in both `api/.env` and `web/.env.local` as described in [SUPABASE_4D2A.md](SUPABASE_4D2A.md). Real search requires a verified guest access token. Local-only demo mode works without Supabase.
6. Enter the following **only in `api/.env`**, using your editor. It is Git-ignored. Never paste the key into chat, a command line, source code, a screenshot, or any `NEXT_PUBLIC_*` variable:

   ```dotenv
   GOOGLE_PLACES_API_KEY=your_restricted_server_key
   GOOGLE_PLACES_ENABLED=false
   GOOGLE_PLACES_LIVE_APPROVED=false
   ```

7. Leave both flags false until the app owner explicitly approves a live Google test. Once approved, set **both** to `true` manually and restart the backend. Restart the frontend if its Supabase/backend configuration changed. No Google configuration is needed in the browser or frontend environment.

   ```sh
   cd ~/Downloads/dinetuned-starter/api
   .venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
   ```

   In another terminal:

   ```sh
   cd ~/Downloads/dinetuned-starter/web
   npm run dev -- --port 3000
   ```

   `web/.env.local` should point `DINETUNED_API_URL` at `http://127.0.0.1:8000`; no Google key belongs there.

## One deliberately approved live search

The earlier controlled attempts stopped before branch selection. A new attempt needs fresh approval. After approval and configuration, open `/discover` with the verified guest session. Choose **Real restaurants**, enter the full restaurant name and city, then press **Search Restaurants** once (or Enter). Search never runs from typing or focus alone. Confirm the returned address before selecting one exact branch. Check the network count and Google billing console. Set both flags back to false and restart the backend after the approved test.

The no-charge `/api/v2/discovery/config` endpoint reports readiness without exposing key material or contacting Google. `/sessions` creates a local session only. `/autocomplete` and `/selection` are the two potential paid operations; both require server-verified Supabase auth and atomic local reservations. There is no automatic fallback to fictional results.

## Request design and verified pricing

Official documentation reviewed for this implementation:

- [Autocomplete (New)](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete): POST `https://places.googleapis.com/v1/places:autocomplete`. Mask: `suggestions.placePrediction.placeId`, `.structuredFormat.mainText.text`, `.structuredFormat.secondaryText.text`, `.types`, `.distanceMeters`. Session UUIDs are shared through the selection. Nearby is a 25 km **bias**, not a restriction. With no location, or an explicitly typed area, a worldwide rectangle avoids Google's implicit server-IP bias. An area is included in the search text; no extra geocoding call is made. Food-type checks retain cuisine-specific restaurant types; unrelated places are excluded.
- [Place Details (New)](https://developers.google.com/maps/documentation/places/web-service/place-details): GET `https://places.googleapis.com/v1/places/{id}`, with the same session token. Mask: `id,displayName,formattedAddress,location,businessStatus,types,attributions`. `displayName` and `businessStatus` require Pro fields; they are needed to verify the chosen business name and show closures. No reviews, ratings, photos, opening hours, phone number or website is requested.
- [Session pricing](https://developers.google.com/maps/documentation/places/web-service/session-pricing): currently, a session ending in non-Essentials Details, including Pro fields, charges the terminating Details request at **Enterprise + Atmosphere**, regardless of the fields requested. Completed-session autocomplete is covered by session pricing; abandoned sessions can incur per-request autocomplete charges. Do not estimate this flow using standalone Pro pricing alone.
- [Current price list](https://developers.google.com/maps/billing-and-pricing/pricing): the standard first paid tier lists Autocomplete Requests at **$2.83/1,000**, standalone Details Pro at **$17/1,000**, and Details Enterprise + Atmosphere at **$25/1,000**. Actual costs depend on billing region, pricing changes and contract terms. Do not assume any free allowance when budgeting.

The conservative illustration for the default daily application limits is `50 × $0.00283 + 5 × $0.025 = $0.2665`, deliberately counting all autocomplete calls even if some are covered by session pricing. This is a planning estimate, **not provider billing or a guaranteed financial cap**. It excludes tax, external use, other instances, other APIs and future pricing changes.

## Durable local controls

`api/app/discovery/limits.py` reserves before network dispatch, in an SQLite `BEGIN IMMEDIATE` transaction. Counters survive restarts and work across processes using the same file. Failed, cancelled and timed-out requests remain counted. Details consumes the token before the one attempt; failed Details cannot reuse it. No SDK or application retries; HTTP redirects are disabled. Timeout is 6 seconds, connection timeout 3 seconds.

| Operation | Per guest/minute | Per guest/UTC day | All guests/UTC day |
|---|---:|---:|---:|
| Local session creation (not paid) | 3 | 10 | 20 |
| Autocomplete | 12 | 40 | 50 |
| Details | 2 | 3 | 5 |

A session expires after **5 minutes**, permits at most **8** autocomplete requests and **one** selection, and is bound to the verified identity. Only IDs actually returned in that session can be selected. The frontend requires at least 3 characters and an explicit **Search Restaurants** or Enter action. It cancels stale work and requires a deliberate restart after errors or expiry. Limits are deliberately small for development.

State is stored at `.local/google-places/usage.sqlite3` (already covered by `.gitignore`). It contains hashed identities/tokens, counters, expiry times and temporary place IDs—not names, addresses, coordinates, search queries or credentials. Two days of counters are retained; expired sessions/IDs are purged on subsequent operations. **Do not delete this file to bypass limits.** Back it with durable storage when deploying. Separate containers/files do not share a global cap: deploy one backend with a persistent volume for this milestone or implement a central limiter before scaling. Failures to open/lock the file block Google dispatch.

## Session lifecycle fix — October 31, 2026

The controlled test's local ledger recorded 10 session reservations and 10 autocomplete reservations, with no Details requests. The frontend recreated its credentials callback and Places client on each same-user Supabase auth notification. Supabase can emit `SIGNED_IN` when a tab becomes visible; the unchanged query then ran again with a new session. Reservations are not proof of successful or billed Google calls.

- The verified identity now owns stable credentials, Memory repository and Places client. Same-user re-verification preserves them and the selected branch. Tokens are read fresh for each request; server-side Supabase verification and signed branch proofs are unchanged.
- Identical normalized queries share an in-flight operation and its result/error within the active five-minute session. Remounting the search component or refreshing auth does not create a session or replay a request. Results are ephemeral, never written to browser storage, Supabase or a persistent cache, and released on expiry/reset/identity change.
- Cancelling a component subscription suppresses its result without reissuing the shared operation. Issued HTTP requests have a 15-second timeout; context/identity resets abort them. A cancellation cannot undo an already reserved or billable request.
- Details has a synchronous single-attempt guard per session token, including failures and repeated clicks. A consumed session does not automatically rerun the same query. A new search requires a deliberate submit; failed or expired searches require deliberate recovery.
- Auth loss or actual identity changes revoke old credentials, abort pending Places work and discard results. Recovery cannot silently replay text from the old client: edit the input or press **Start a new search**. The existing identity marker still prevents automatic account merging or replacement guests.

Offline coverage includes visibility events, `SIGNED_IN`/`TOKEN_REFRESHED`/`USER_UPDATED`, fresh rotated tokens, component remounts, rapid clicks, edits during debounce, stale responses, failed requests, expiry, identity changes, and Memory backup/reload behavior. Browser tests use mocked Supabase/Google responses and isolated fixture servers; they do not validate live provider billing or quotas.

Verification: 38 backend discovery tests, 42 targeted frontend checks, and 26 desktop/mobile browser cases passed (including focused reruns after fixes). TypeScript and the final production build passed. No live provider calls were made.

Both live flags remain false. The existing request limits, Google counters and Meta ledger are unchanged. Do not reset counters to resume the interrupted test. A new live test still requires explicit approval.

## Slow-typing request guard — October 31, 2026

A later controlled attempt recorded two local sessions and four Autocomplete reservations for one intended restaurant search. The ledger intentionally does not store search text, so the exact input sequence cannot be reconstructed. Mocked browser reproduction showed that pausing after a partial name and then finishing it triggered separate debounced Autocomplete requests. That intermediate guard still allowed a completed result to disappear when the mutable input context changed. Search is now explicit: typing, pasting, focus, auth refreshes and remounts make no Google request. The submitted name, area, location, and returned branches stay in the guest-owned search client; edited inputs are labeled while the previous results remain visible. The city field sits above the inline results. Only **Search Restaurants** or Enter submits a new context. Rapid duplicate submissions and branch clicks are coalesced. A full browser reload intentionally clears Google result content, in keeping with ephemeral Places storage; it does not replay a search. No Google calls, counter resets or Meta calls were made for this fix.

## One-use live test guard — October 31, 2026 (Chicago)

A subsequent live attempt reached the **three search sessions per guest per minute** limit after three sessions and three Autocomplete reservations. The fourth session was rejected before Google dispatch. The browser's in-memory one-search guard survives same-page remounts and auth refreshes, but a full page reload creates a new client. The Next.js development server had also logged full reloads; the request log cannot prove which reload or interaction initiated each live request.

For the **next separately approved test**, `api/.env` contains a stable, Git-ignored `GOOGLE_PLACES_TEST_RUN_ID` (UUID), with both Google live flags still false. When the flags are explicitly enabled, this ID activates an additional server-side grant in the same durable SQLite file as the existing limits. A transaction permits **one session, one Autocomplete, and one Details request for a Place ID returned in that session**. Failed or timed-out provider calls still spend the applicable allowance. Concurrent requests, browser reloads, backend restarts, and UTC-day changes cannot renew that ID. The grant does not reset or replace the normal per-guest/global limits. A missing ID leaves ordinary production search behavior unchanged; an invalid ID fails closed. Only create a new ID after a *new* approval. All automated tests use temporary SQLite databases and mocked Google responses; the existing usage file was not modified by development tests.

Use a stable frontend instead of `next dev` for the controlled test: stop the dev server, run `cd web && npm run build && npm run start -- --port 3000`, and keep the same browser origin and guest session. Before enabling Google, confirm the search field is empty and inspect the read-only local counters. After approval, set `GOOGLE_PLACES_ENABLED=true` and `GOOGLE_PLACES_LIVE_APPROVED=true` in `api/.env`, restart FastAPI, enter the city first, paste the complete restaurant name, then press **Search Restaurants** once. **Stop before selecting** and verify exactly one new session and one Autocomplete reservation; select only the matching branch within five minutes. Immediately set both flags back to false and restart FastAPI. If the page reloads, the provider fails, or the grant is spent, stop without retrying or rotating the ID. Local reservations do not prove actual Google billing; check Google Cloud usage separately. Do not use a separate SQLite file or multiple backend instances for this local test.

## Attribution, content retention and handoff

[Google policies](https://developers.google.com/maps/documentation/places/web-service/policies) require attribution and restrict content storage; place IDs have a storage exception. The UI shows the official Google Maps asset with provider content, and displays returned third-party attribution. The original unmodified logo was downloaded from Google's attribution asset bundle and is recorded in `web/public/brand/README.md`.

Names, addresses, status and coordinates remain ephemeral in React; API responses are `private, no-store`. They are not written to browser storage, Supabase, recommendation history or application logs. Only place IDs enter the temporary server allowlist. Reloading clears the selection and never auto-fetches it again. Deployments must also avoid request/response-body logging by reverse proxies or observability tools. Review EEA terms if applicable. Public `/privacy` and `/terms` pages describe the implemented data flow and link the Google policies; the owner should review these notices and provide their production operator/contact details before public deployment. [Google key-security guidance](https://developers.google.com/maps/api-security-best-practices) supports restricting backend keys and monitoring usage.

`MenuDiscoveryHandoff` is generated into TypeScript from Pydantic. It contains provider, stable place ID, display name, optional address/coordinates, reported business status, retrieval timestamp/source, attribution and limitations, plus `menu_status: "not_retrieved"`. It intentionally has no invented menu version, dish, price or live-menu promise. Missing optional metadata is explicit; mismatched IDs, unknown dining types and malformed responses are rejected. A temporarily/permanently closed location is clearly labeled, never presented as currently open (even OPERATIONAL does not imply open now).

The backend protocol `RestaurantDiscoveryProvider` has Google and existing-catalog adapters. The legacy demo API and all recommendation, TasteBridge, pairing, feedback and Taste DNA contracts remain unchanged. In Step 4D.4 the next agent can consume this typed identity, but must revalidate provenance server-side, honor provider terms, and implement authorized source discovery separately. The handoff is not a security credential or proof of a retrievable menu.

## Offline verification

```sh
cd ~/Downloads/dinetuned-starter/api
.venv/bin/python -m pytest tests/test_discovery.py tests/test_persistence.py tests/test_dining_memory.py tests/test_signature_picks.py -q
.venv/bin/python scripts/generate_contracts.py --check
cd ../web
node --test tests/places.cjs tests/identity.cjs tests/dining-memory.cjs
npm run typecheck
```

Browser tests in `tests/e2e/places.spec.ts` intercept every Places and Supabase call. Run against isolated QA servers with `SUPABASE_URL='' SUPABASE_PUBLISHABLE_KEY='' GOOGLE_PLACES_ENABLED=false GOOGLE_PLACES_LIVE_APPROVED=false GOOGLE_PLACES_API_KEY='' MODEL_API_KEY=''`, a separate `DINETUNED_API_URL`, and a separate `NEXT_BUILD_DIR` so live user sessions/data are never involved. Existing demo and Memory regressions continue to use their established fixtures. No test needs real Google or Meta access.

Implementation verification: 102 focused Python regression tests plus 3 additional limiter tests passed; 37 frontend/database checks passed, including local PostgreSQL owner isolation. The focused desktop/mobile pass passed 26 tests; an additional mobile run verified the corrected 320px screenshot capture. Desktop, phone and narrow-phone screenshots were reviewed. Generated-contract checks, TypeScript and one production build passed. The existing FastAPI/Starlette test-client deprecation warning remains non-blocking. No live Supabase data or Meta usage ledger was changed. Actual Google access, key restrictions, quota settings and live response quality remain to be verified after approval.
