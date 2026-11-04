# DineTuned frontend V2

The frontend now requires the FastAPI service. It no longer contains its own restaurant catalog or recommendation algorithm.

From `web/`:

```bash
npm ci
npm run dev
```

The default backend is `http://127.0.0.1:8000`, reached through the server-side Next.js relay. Set `DINETUNED_API_URL` in `.env.local` only when changing that upstream. No client-side API key is used.

Run `npm test`, `npm run typecheck`, and `npm run build`. For browser tests, start a production frontend on port 3100 and the backend on port 8000, then run `npm run test:e2e`. On this Mac use `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`.

Generated contracts live in `lib/generated`. Regenerate with `python scripts/generate_contracts.py` from `api/`; do not edit generated files manually.

The menu always starts complete. Filtering can narrow the visible dishes, and **Complete menu** restores visibility without removing restrictions from recommendations. Allergy information is separate and unverified. Images are labeled local placeholders.

See the root [README](../README.md) for setup, limitations, and manual acceptance tests.
