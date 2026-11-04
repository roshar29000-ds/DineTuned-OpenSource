# Step 4D.2B — persistent dining history and reported taste evidence

## What is implemented

The existing Picks cards now offer **Save dish**, **Select dish**, **I ordered this**, and **I tried this**. These are separate explicit actions; none implies another. Submitting a rating requires explicit confirmation that the dish was tried. Ratings retain the original free-text observations, optional 1–5 score, structured reasons, dish/restaurant names, IDs, menu version, original time and linked recommendation history. Recommendations remain demo logic; these records do not train a model or introduce new ranking logic.

When cloud identity is ready, an action is first durably queued in this browser and then sent to the private FastAPI API. Recommendation provenance is saved before its event, then feedback. There is no automatic history write merely for viewing Picks. A failed save remains clearly pending; **Retry pending cloud saves** resumes the same IDs. Retries do not replace existing rows. Different content for an existing ID is a conflict. Timestamps may differ between duplicate tabs; the original accepted action time wins. The outbox is scoped by authenticated identity. No token is stored in it.

The Memory page reads private cloud history, displays all four action states separately from ratings, and offers filters, corrections and confirmed deletions. Favourites mean dishes explicitly rated positively, not inferred preferences. Corrections are guarded by the row revision and cannot change identity/provenance. Delete a linked rating before deleting its event. Deleting an event or rating does not delete the original recommendation session, Taste DNA, or other records. Cached history remains available during a database outage in a verified guest session. Losing Auth does not silently create a replacement identity or upload records into another account.

Without cloud configuration, new dining actions remain in `dinetuned-dining-v1:local`. Existing `dinetuned-v2` feedback remains usable. **Bring existing browser memories into this account** explicitly copies old records; it does not invent consumption confirmations for old feedback. Copying is opt-in, retry-safe, and retains the browser source. A user can deliberately copy an old record again after deleting its cloud copy; deletion does not erase the separate original browser archive. No automatic legacy migration runs.

## Taste DNA restore

The verified backup API and its optimistic revision check are unchanged. There are no automatic backup writes.

**Restore cloud Taste DNA** opens a confirmation. The app rereads the cloud snapshot before applying it and rejects changed revisions/content, a changed local profile (including another tab), unsupported Detective evidence, and missing sessions. A pre-restore copy is retained in `dinetuned-v2-before-cloud-restore`; current feedback and meal preferences remain. Existing dietary restrictions and allergy notes are retained/merged, not silently removed by an older backup. A successful restore clears stale restaurant selection and temporary refinements so the complete-menu-first journey restarts. It does not update the cloud backup. The local recovery copy currently has no dedicated undo UI; do not clear browser storage to test recovery.

## New migration — prepared, NOT applied by Codex

File: `supabase/migrations/202610290001_dining_memory.sql`.

This incremental migration requires the existing `202610280001` migration. It:

- Adds nullable restaurant/dish display names and a server-maintained revision to dining events.
- Adds a server-maintained revision to dish feedback.
- Allows authenticated owners to correct event type or feedback content/rating/tags, and delete their own event/feedback rows.
- Preserves RLS, ownership, immutable provenance and existing foreign-key safeguards.
- Adds a trigger rejecting changes to original feedback context.
- Does **not** modify `taste_profiles`, reset the database, remove rows, change Meta settings, or weaken identity restrictions.

All SQL was exercised against local in-memory PostgreSQL, including both migrations in sequence and preservation of an existing Taste DNA snapshot. No migration, test record or backup write was sent to the live project. **User approval is required before applying this migration to live Supabase.** Until it is applied, new dining saves/corrections can report an error and remain pending; existing Taste DNA backup reads/writes still work.

From the repository root, preview the linked project and pending migration:

```bash
npx supabase migration list
npx supabase db push --dry-run
```

Expected: `202610280001` exists locally/remotely; only `202610290001_dining_memory.sql` is pending. Review the linked project and SQL, then request/obtain approval. Only **after approval**:

```bash
npx supabase db push
npx supabase migration list
```

Do not use reset or migration-repair commands to bypass a mismatch. Stop and investigate unexpected migrations or existing-column/policy errors. The immutable first migration is unchanged. Credentials remain in Git-ignored local environment files as described in [4D.2A](SUPABASE_4D2A.md).

## Private API and architecture

All routes below `/api/v2/memory` require a bearer token independently verified by Supabase Auth. Python uses that same user token for PostgREST; no service-role key is used. The Next.js relay allowlists resource/method combinations and rejects cross-origin writes.

Existing GET/POST `events`, `feedback`, and `history` now support the UI. New routes:

- `PATCH /events/{uuid}` — `expected_revision`, `event_type`.
- `PATCH /feedback/{uuid}` — `expected_revision`, `liked`, `note`, nullable `rating`, `tags`.
- `DELETE /events/{uuid}?expected_revision=N` and `/feedback/{uuid}?expected_revision=N` — explicit deletion; retrying an already absent record succeeds without disclosing another owner's records.
- `GET /evidence?restaurant_id=…&offset=0` — optional restaurant filter; up to 50 original reports with their linked event/recommendation, explicit consumption status and uncertainty. Evidence is labelled `uninterpreted_user_reports`. A missing or conflicting link is not treated as proof of consumption or provenance.

`api/app/persistence/` owns authentication, models and repository validation. Generated TypeScript contracts remain the single frontend API schema. `web/lib/memory/journal.ts` is the durable outbox/cache; `DiningMemoryProvider`, `DishExperience`, and `DiningDiary` connect it to existing UI. `web/lib/memory/restore.ts` implements the narrow, explicit restore operation. The historical evidence endpoint is ready for a future Meta provider, but is not connected to one. Existing local structured TasteBridge feedback remains intact; corrections/deletions reconcile existing browser mirrors when refreshed.

## Offline validation

```bash
cd api
.venv/bin/python -m pytest tests/test_dining_memory.py tests/test_persistence.py tests/test_api.py -q
.venv/bin/python scripts/generate_contracts.py --check
cd ../web
npm run typecheck
node --test tests/dining-memory.cjs tests/identity.cjs tests/database.cjs tests/unit.cjs
```

Focused Playwright tests are `tests/e2e/dining-memory.spec.ts`, `identity.spec.ts`, plus affected signature-Picks regressions. Auth and private memory traffic are mocked; no test should target your live account. Start dedicated QA servers with `SUPABASE_URL= SUPABASE_PUBLISHABLE_KEY= MODEL_API_KEY=` to prevent local environment credentials being loaded for tests. PGlite runs actual SQL/RLS in memory. The normal user services and browser storage are not used for tests.

## Manual live verification (after migration approval/application)

1. Use the same browser/guest session. Confirm existing Taste DNA backup revision 1 and timestamp are unchanged.
2. Explore a complete menu, open Picks, save/select a dish, and check Memory shows interest only. Explicitly confirm ordering/trying only if true; use a clearly identified personal test record if needed.
3. Submit a confirmed rating with a note and structured observation. Reload Memory; check names, menu provenance, rating and cloud status.
4. Correct the note and verify its revision advances. Delete the rating after confirmation, then its event if desired. Your Taste DNA backup should be unchanged.
5. Simulate an offline connection only in a test browser/session; verify pending status, then deliberately retry. There should be one record per action, not duplicate records.
6. Test **Cancel restore** first. Restore only if you actually want to replace local Taste DNA. Confirm the cloud revision remains unchanged and retained allergies remain visible.
7. A separate private browser should see none of your guest's records. Do not clear the original guest's browser storage.

## Limits and next work

No hosted deployment verification was performed in this implementation task. Account upgrades/recovery and public-signup CAPTCHA remain from 4D.2A. Explicit user reports are not restaurant-attested facts. The diary fetches bounded pages (50 at a time, up to the API's 10,000 offset); very large histories need a dedicated cursor/feed. Pending conflicting writes require review rather than silent replacement. Local browser archives and recovery copies have no account-level retention/deletion policy yet.

Real Meta-based feedback interpretation, relevant-history selection, and culinary reranking remain separate approved work. There were zero Meta calls and the cumulative credit ledger was preserved. No restaurant discovery or menu ingestion was implemented.
