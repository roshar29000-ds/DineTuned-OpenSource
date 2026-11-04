# Local real-provider MVP validation

The owner-approved local phase uses the existing FastAPI + Next.js servers. The
backend binds to `127.0.0.1`; Google and Meta keys remain only in ignored
`api/.env`. A missing approval variable keeps a provider disabled. The former
one-use Google grant is retained in its database but is no longer selected by
the local environment; ordinary per-guest and global rate limits still apply.

`DINETUNED_VALIDATION_PHASE_ENABLED=true` adds a locked, private ledger at
`.local/validation-spend/usage.sqlite3`. Every Google Autocomplete, Place
Details, Muse Spark, and Muse Image transport reserves a conservative upper
estimate before dispatch. Pending and failed requests continue to count.
The owner authorized $3 of *additional* estimated usage for this phase; a
$0.25 buffer makes the local preflight limit $2.75. The older $10 Meta ledger,
its prior entries, per-provider limits, request idempotency, and image cache
remain separate and active. The local ledger cannot enforce provider billing
or account for requests made elsewhere; check Google Cloud and Meta dashboards.

`DINETUNED_LOCAL_TECHNICAL_TEST=true` is limited to loopback requests. When
both No beef and No pork are selected, a request copy treats uncertain dietary
ingredients as unverified for the explicitly approved model evaluation.
Items explicitly naming beef or pork are excluded, allergies remain hard,
and saved Taste DNA is unchanged. A visible notice appears before and after
Picks. This is not a dietary-safe ordering recommendation. Other guests keep
the normal strict dietary policy. Disable this flag outside the local test.

The verified live browser path used a Google branch selection, a signed upload
of the user-supplied, USD-confirmed Girl & the Goat text PDF, 23 extracted
items, Muse Spark Picks, and cached Muse Image illustrations. The upload is
not independently verified as an official or current restaurant menu. When
official source discovery is inconclusive, the user must supply a menu; the
app does not invent one. A signed authorization must be refreshed before a
new extraction or new inference after expiry. Existing results remain
browsable from the private guest table without another model request.

To review locally, open `http://localhost:3000`, finish Taste Detective or
use the existing guest profile, search for the exact branch, upload the PDF
through the in-app recovery flow, inspect the complete menu, then select
**Find My Personal Picks**. The dedicated `/picks` page, images, refinements,
and Memory use the same authenticated guest. The optional `live-mvp.spec.ts`
test is skipped unless `DINETUNED_LIVE_MVP_TEST=approved` is set for that
one invocation; it has no automatic retries and must only be used under a
fresh owner authorization and remaining budget.
