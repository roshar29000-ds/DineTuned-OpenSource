# DineTuned MVP deployment

This repository is prepared for a Next.js frontend on Vercel and a single FastAPI instance on Render. Deployment and DNS changes require the owner's approval. The Render Blueprint creates a paid Starter service and a 1 GB persistent disk; confirm the current quote in Render before creation. Google Places and live Meta dispatch remain disabled by default.

## Before creating services

1. Use the reviewed public source repository `roshar29000-ds/DineTuned-OpenSource`. Keep `api/.env`, `web/.env.local`, `.local/`, service keys, tokens, and Supabase service-role keys out of Git.
2. Confirm the existing Supabase migrations and Auth URL allowlist for `https://dinetuned.com` and `https://www.dinetuned.com`. Use the project URL and **publishable** key only. Keep the private user tables behind their existing RLS policies.
3. Rotate the previously exposed Meta API key before any live use. Do not put it into Vercel or the public frontend. The normal FastAPI real-Picks route is still disabled; a configured key does not turn on paid inference.

## Backend: Render

1. Review `render.yaml` and the current service/disk price. Deploy the Blueprint only after approving the charge. It pins Python 3.11, one API instance, and a persistent private disk at `/opt/render/project/src/.local`. The disk holds the branch-signing key and Google/source request counters.
2. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in Render environment settings. Set `ALLOWED_ORIGINS=https://dinetuned.com,https://www.dinetuned.com` if direct browser API access is used. Never set a service-role key. Leave both Google flags false.
3. The Meta ledger is under the same repository `.local` directory as the signing key and counters. **Before any production Meta dispatch**, privately copy the existing development ledger into `.local/meta/usage.json` on the disk or otherwise reconcile its entries; a new empty ledger would undercount cumulative Step 4D usage. Local accounting is not a provider-enforced cap. Compare with the Meta dashboard. The private proposal cache lives at `.local/real_picks/proposals.sqlite3` and prevents duplicate paid inference for the same authenticated guest, menu context and preferences. A failed or interrupted context is not automatically retried.
4. Confirm `GET https://<render-host>/api/v2/health` responds and `GET /api/v2/discovery/config` reports `google_enabled:false`. Do not enable paid providers as a connectivity check.

The Render disk requires one instance and sacrifices zero-downtime deploys. Do not move or replace the disk without migrating its private state. A production Meta usage ledger and signing key must survive every restart.

## Frontend: Vercel and GoDaddy

1. Import the same GitHub repository into Vercel with `web` as Root Directory and the existing `npm run build` command.
2. Set server-only `DINETUNED_API_URL=https://<render-host>` in Vercel. Set the existing public Supabase project URL and publishable key using the variable names in `web/.env.example`; do not add Google or Meta secrets to Vercel.
3. Add `dinetuned.com` and `www.dinetuned.com` to the Vercel project. Vercel will show the exact DNS records for this project. At GoDaddy, replace only conflicting `@` A/AAAA and `www` CNAME records with those exact values; preserve MX, TXT, and unrelated records. Use Vercel's dashboard to verify DNS and TLS before making the domain primary.
4. In Supabase Auth settings, update Site URL and redirect allowlist to the final HTTPS domain(s). Verify anonymous sign-in, profile backup, and dining history with a fresh test identity without altering existing private records.

## Launch gate

Run the real journey on the public domain: Taste Detective, signed exact branch, official source or clearly labeled user upload, extracted full menu, Picks, feedback, and Memory reload. One owner-approved Muse Spark technical test succeeded locally; it does **not** authorize public paid inference. The normal FastAPI route remains disabled by `DINETUNED_META_PRODUCTION_ENABLED=false`. Its production gate requires separate owner approval of a dollar cap and attempt count, an approval ID, a per-guest daily cap, the backend-only rotated `MODEL_API_KEY`, and the existing private ledger on the Render disk. The same cumulative $10 development target remains enforced until a separate policy review changes it. All approved requests require Supabase identity and signed menu verification; the proposal cache is guest-scoped and persists on disk. Never substitute fictional dishes for a real branch. Source discovery/extraction are website requests and should remain bounded by their existing server limits and site access rules.

The dedicated `/picks` page restores the selected branch, extracted menu, and existing Picks from a private guest-scoped backend table across tabs and reloads for up to 24 hours, while the original signed branch proof remains valid within its existing upload grace. Restoration is read-only: expired recommendation proof cannot start another inference. The table store must be on a persistent private Render disk (`DINETUNED_TABLE_STORE_PATH`); ephemeral storage loses this convenience snapshot on redeploy. Dining actions and ratings remain separately persisted through Supabase. Never copy signed proofs or private Taste DNA into public browser storage.

If an official branch menu cannot be corroborated, the authenticated guest can instead upload a text PDF or HTML file up to 3 MB. This path performs no website or model request and labels the document unverified; see `docs/MENU_UPLOAD_MVP.md`. Scanned images remain unsupported without approved vision processing.
