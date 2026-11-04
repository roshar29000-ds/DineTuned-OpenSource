# Step 4D.2A — private memory and anonymous identity

This guide covers the original foundation. [Step 4D.2B](SUPABASE_4D2B.md) now adds dining-history synchronization and explicit Taste DNA restore, with a second migration that requires review and approval before live application. Always review **all** pending migrations in the dry-run below.

This adds an optional Supabase Auth/PostgreSQL foundation to the existing Next.js + FastAPI application. It makes **no Meta requests**, changes no Meta spending settings, and does not ingest restaurant menus or create another taste-learning engine.

## What works

- With no Supabase configuration, all existing browser Taste DNA, Detective drafts, feedback, menu filters and demo recommendations continue working. The Memory page says **Local-only mode**.
- When configured, the browser creates an anonymous Supabase Auth identity once, or restores the existing session. The official SDK handles session persistence and refresh. Initialization is shared within a tab and uses Web Locks across supported browsers. Each identity is verified with Auth; a local ID/JWT decode is never proof of access.
- Session storage uses a separate, project-specific key. `dinetuned-v2` and the legacy browser data are never removed or automatically imported. A remembered guest whose session disappears gets a recovery message, not a silently created replacement identity. A changed account also pauses cloud access rather than merging data.
- The Memory page can explicitly create or update a **private Taste DNA snapshot**, including saved Detective answers, structured evidence and manual-edit provenance. It checks the current cloud revision first. Creation cannot overwrite a previous backup, and revision conflicts require a refresh. No cloud read automatically replaces local Taste DNA.
- Dining events, feedback and recommendation history have protected, typed read/append APIs and repositories. Their existing UI remains local in this milestone; automatic synchronization and restoration belong to 4D.2B. All persisted history is labeled `user_reported`, not validated Meta inference or proof a meal was ordered/eaten.

## Project setup

1. Create a Supabase project. Choose its region and retain the database password securely.
2. In **Project Settings → API Keys**, copy the project **publishable** key (`sb_publishable_…`). Find the HTTPS project URL in the project Connect/API settings. Neither the legacy `service_role` key nor an `sb_secret_…` key is accepted by this application. Legacy JWT-style anon keys are also intentionally unsupported; use the current publishable key.
3. In **Authentication → Sign In / Providers**, enable **Anonymous Sign-Ins**. Set the site URL to `http://localhost:3000` for local work, and the actual HTTPS origin for deployment. Only add redirect URLs you control. No email login/OAuth upgrade UI is implemented yet.
4. Review Auth rate limits. For an internet-facing launch, enable Supabase-supported CAPTCHA/Turnstile and add the challenge-token UI before opening anonymous signup broadly. CAPTCHA-enabled signup currently fails gracefully into local use because that UI is not implemented in 4D.2A. Do not disable production abuse controls merely to make a test pass; a controlled private hackathon project can exercise the current guest flow under its configured Auth limits.
5. Apply the reviewed migration below before trying a cloud backup.

The current client allows `https://<project-ref>.supabase.co` or local Supabase at `http://127.0.0.1:54321` / `http://localhost:54321`. Custom domains require a deliberate configuration review. Anonymous signed-in users use the **authenticated** database role; the unauthenticated **anon** role is denied access to all four private tables.

## Environment configuration

Private, Git-ignored placeholder files `api/.env` and `web/.env.local` are created only when absent. Existing files are never replaced. Fill these variables into **both** files:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

The frontend server also supports the existing optional upstream setting:

```dotenv
DINETUNED_API_URL=http://127.0.0.1:8000
```

Restart both development services after changing environment values. Leave both Supabase values empty for local-only mode. A partial/invalid configuration produces an error, not a false claim of cloud persistence.

**Do not use `NEXT_PUBLIC_` secret variables.** Next.js reads server-only configuration and exposes only a validated URL/publishable key through `/api/identity/config`. An accidentally supplied secret/service-role key is rejected before it reaches a browser bundle or response. FastAPI uses the same publishable key plus the user's verified bearer token, so database RLS is never bypassed. No database password, service-role key or Supabase secret key is needed by the application.

## Apply migrations safely

The additive migration is `supabase/migrations/202610280001_private_memory.sql`. It is transactional and creates new tables, indexes, RLS policies and private trigger functions. It contains no data deletion, truncation, user import, or destructive reset. Existing table-name collisions intentionally fail rather than modifying unknown tables. Review the target project and take an appropriate backup if it already contains data.

Using the official Supabase CLI from the repository root:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
```

Enter credentials through the CLI's secure prompts; do not put passwords in committed files or shell command arguments. Review the dry-run before pushing. `.temp/` linking metadata is ignored by Git. **Never run `supabase db reset` against existing data.** These commands were not executed against a live project during this milestone.

Alternatively, run the complete reviewed SQL file once in the project's SQL Editor. Record that deployment and reconcile CLI migration history before later CLI deployments; do not blindly replay a manually applied migration. Avoid changing the immutable contents of an already deployed migration—subsequent schema changes need a new migration file.

## Data boundaries and access control

| Table | Purpose | Authenticated access |
| --- | --- | --- |
| `taste_profiles` | One versioned DNA/evidence/Detective snapshot per user | Read, create, update the `document` column of own row |
| `recommendation_history` | Session, restaurant, menu version, dish IDs/prices, reported provider | Read/append own records |
| `dining_events` | Saved, selected, ordered or tasted events with menu provenance | Read/append own records |
| `dish_feedback` | Existing feedback shape, optional 1–5 rating and structured tags | Read/append own records |

All tables have stable UUIDs, server timestamps, explicit RLS, forced RLS, owner indexes and no grants to `anon`. `user_id` defaults to `auth.uid()`; `WITH CHECK` rejects another owner's ID. Composite foreign keys prevent cross-user references. Profile revision/timestamp triggers protect update consistency. Other histories are append-only and there is no delete endpoint or automatic guest cleanup. Auth user deletion/retention needs a separate deliberate policy; nothing here deletes existing users.

Backend auth calls Supabase `/auth/v1/user` for each private request, then passes the **same user JWT** to PostgREST. A request body cannot set ownership. A frontend `user_id` query/header is not used for authorization. Rows returned by storage are independently checked for the verified owner. Errors are sanitized; tokens and profiles are not logged. Responses are private/no-store and the Next.js relay forwards bearer credentials only on an explicit memory-route allowlist, never on existing public recommendation/menu routes.

Session tokens use the SDK's browser storage, not HttpOnly server cookies. This fits the existing client-rendered app; keep XSS protections and HTTPS in place. No user data is rendered into a shared static server page. Clearing browser storage, losing an anonymous refresh token, or changing devices can make a guest's cloud records inaccessible until an account upgrade/recovery flow exists. Local data is not an account recovery credential.

Shared restaurant/menu caching is intentionally absent. Future shared catalog tables must have separate policies and immutable menu-version references; they must never contain private profiles or dining history. Current history records preserve reported provenance, including honest null restaurant/menu information for legacy feedback. They must not be treated as verified model output or ingredient evidence.

## Typed interfaces and routes

Python models/repository/auth adapters live in `api/app/persistence/`. TypeScript types and runtime validators are generated through the existing contract generator. `web/lib/memory-repository.ts` supplies the typed frontend interface; `web/lib/identity/` and `IdentityProvider` handle sessions separately from `AppProvider`'s local state.

All these routes require `Authorization: Bearer <user access token>`:

- `GET /api/v2/memory/identity` — server-verified Auth identity.
- `GET /api/v2/memory/profile`, `POST /api/v2/memory/profile` — read / create-or-replace with an explicit expected revision (`null` means create-only).
- `GET/POST /api/v2/memory/events`, `/feedback`, `/history` — bounded history reads and validated append operations. Reads accept an `offset` and return at most 50 records; writes use stable client UUIDs and reject duplicates rather than silently overwriting.

The browser accesses the same routes through `/api/dinetuned/memory/*`. There are no service-role operations, live model routes, automatic cloud imports, or automatic database writes on startup.

## Run and test connectivity

```bash
# Terminal 1, from the repository root:
cd api
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

```bash
# Terminal 2, from the repository root:
cd web
npm ci
npm run dev
```

Open `http://localhost:3000/memory`. In unconfigured mode, confirm the **Local-only mode** label and your existing diary. With Auth and migrations configured, the page should show a guest identity and either no backup or a saved backup. That profile read exercises Auth **and** the database, not just a health endpoint. Complete Taste Detective if needed, then deliberately choose **Back up Taste DNA**. Reload and confirm the same guest identity/backup; your local profile and diary should be unchanged. Use a separate private browser window to verify it sees no other guest's backup. Do not share access/refresh tokens in screenshots or logs.

Missing migrations, expired/invalid tokens, disabled anonymous sign-in, unsupported keys and unavailable services should leave local data available with a clear error. After an uncertain save, refresh cloud status before retrying. A revision conflict must not overwrite either local data or a newer cloud backup.

## Offline verification and limits

```bash
cd api
.venv/bin/python -m pytest tests/test_persistence.py tests/test_api.py -q
.venv/bin/python scripts/generate_contracts.py --check
cd ../web
node --test tests/identity.cjs tests/database.cjs tests/unit.cjs
npm run typecheck
```

Database tests execute the actual migration in in-memory PostgreSQL via the dev-only PGlite dependency. They simulate Supabase's `auth.uid()`/roles to exercise real RLS, grants, cross-user reads/writes/foreign keys, timestamps, revisions and constraints. This proves SQL behavior in the embedded engine; it does not prove a hosted project's settings or Auth service. Python HTTP calls and browser Auth/API responses are mocked; automated tests make no Meta or live Supabase requests. The focused browser spec is `tests/e2e/identity.spec.ts` and also blocks external traffic.

Supabase credentials were unavailable, so no hosted migration, anonymous signup, live database write or live connectivity check was performed. Runtime additions are the official Supabase JS SDK; PGlite is test-only. No Python database dependency or framework migration was required.

## Remaining for 4D.2B

Live Supabase setup/verification; explicit restore and conflict-resolution UI; historical browser-data migration and retry/idempotency UX; automatic event/feedback/history synchronization; account upgrade/linking and recovery; CAPTCHA UI for public anonymous signup; deletion/retention controls; richer server-origin provenance before using cloud histories in personalized reasoning. No new taste-memory algorithm or Meta integration was started.

Official references: [Anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous), [API key types](https://supabase.com/docs/guides/getting-started/api-keys), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [server-verified user lookup](https://supabase.com/docs/reference/javascript/auth-getuser), [migration workflow](https://supabase.com/docs/guides/deployment/database-migrations).
