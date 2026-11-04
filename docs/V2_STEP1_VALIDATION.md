# V2 Step 1 validation — 2026-10-24

## Final checks

- Backend: 51 pytest tests passed; generated contract drift check passed.
- Frontend: 9 Node unit tests passed; TypeScript passed with no emit.
- Production: Next.js 15.5.28 build passed without compilation warnings.
- Browser: 19 Playwright tests passed; 1 intentionally skipped duplicate viewport check.
- Real integration: Next.js production server on 3100 relayed requests to FastAPI on 8100.
- Responsive checks: 320px, 390px mobile emulation, 768px, 1280px desktop, and 1440px widths; no menu horizontal overflow.
- npm dependency install audit: zero vulnerabilities after the PostCSS 8.5.23 override. No force audit fix or Next.js major upgrade.
- Python environment: pip check reported no broken requirements.

## Browser behaviors verified

New-user onboarding through full menu and picks; returning-user search; no default restaurant on a direct picks visit; exact $18.99 budget retained through refresh; combined vegetarian/no-pork restrictions; complete-menu restoration without dropping constraints; unknown allergy exclusions; invalid venue and API error recovery; feedback persistence/idempotence; reset before navigation; explicit nearby ordering without automatic venue selection; responsive menu and filter controls.

Desktop/mobile menu screenshots are generated under web/test-results and deliberately excluded from Git.

## Boundaries

Browser checks used the installed Google Chrome. Mobile coverage is Chromium device emulation, not physical iOS or Safari. Playwright's bundled Chromium does not support this Mac's OS version. No live Meta, real restaurant, or live ingestion calls were made.

The Python test environment reports one Starlette/HTTPX deprecation warning. Pytest output capture is disabled because this workstation's native readline extension otherwise crashes on import. Neither condition caused a failing test.

Menus, imagery, and ranking remain clearly labeled demo behavior. All fixture allergy metadata is incomplete, so an allergy-selected session intentionally has no eligible picks. There is no database, authentication, advanced AI, real food photography, or feedback learning in Step 1.
