# Task Board

Legend: ✅ done · ⏳ in progress · ⬜ todo

## Sprint 1: Backend foundation (2026-09-25)

| Tag | Task | Status | Notes |
|---|---|---|---|
| TASK-0 | Install Node.js, Git, PostgreSQL; create `accounting_saas_dev` | ✅ | Node 24.19, Git 2.55, PostgreSQL 16.15 |
| TASK-1 | Scaffold NestJS project, tsconfig, `.env` | ✅ | NestJS 12, TypeORM 1.1, TypeScript pinned to 5.9 |
| TASK-2 | Entities + 5 migrations + Row-Level Security | ✅ | 12 tables, `app_user` role, `tenant_isolation` policies |
| TASK-3 | Tenant module: signup, slug lookup, get tenant (403 cross-tenant) | ✅ | Signup seeds company, Admin/User roles, 14-day trial, 19-account chart |
| TASK-4 | Auth module: login, refresh, me, JWT guard | ✅ | Refresh tokens can't be used as access tokens |
| TASK-5 | Accounting: chart of accounts, journal entries, void, trial balance | ✅ | Debits must equal credits (checked in satang) |
| TASK-6 | Build + migrations + smoke test (checklist Phases 6–10) | ✅ | `npm test`: 38/38 passing (47 after TASK-9) |
| TASK-7 | README, DEVELOPMENT.md, TASKS.md, first git commit | ✅ | No remote yet, so nothing pushed |
| TASK-8 | Frontend (React + Tailwind): login, chart of accounts, journal entry form, trial balance | ✅ | `web/`: Vite 8, React 19, Tailwind 4, Thai UI; also signup, journal list + void; `npm run e2e` 27/27 passing |
| TASK-9 | Role-based permissions (Admin vs User) on write endpoints | ✅ | `@Roles('Admin')` on create account + void; roles read from DB per request; UI hides Admin-only actions. `npm test` 47/47, `npm run e2e` 30/30 |
| TASK-10 | Financial statements: income statement, balance sheet | ✅ | Shared per-account balance query; current earnings shown in equity until closing entries exist; default period = fiscal year. `npm test` 56/56, `npm run e2e` 36/36 |
| TASK-11 | User management: invite users, assign roles | ✅ | One-time invite links (hashed, 7 days); change role, deactivate/reactivate; last active Admin protected; JWT guard checks active flag + roles per request. Migration 1691234567895. `npm test` 84/84, `npm run e2e` 46/46 |
| TASK-12 | Subscription & billing integration (invoices, payment gateway) | ✅ | `PaymentGateway` interface + mock gateway; invoices with VAT, payments table (migration 1691234567896); idempotent settlement; trial/unpaid → read-only (402 on writes); plan user limits; billing page + banner. `npm test` 115/115, `npm run e2e` 54/54 |
| TASK-13 | Jest unit tests + CI | ✅ | Jest (API, 49 tests) + Vitest (web, 28 tests); pure logic extracted into `journal-rules`, `statements`, `billing-math`; GitHub Actions: API / web / integration (Postgres service, smoke under pwsh, E2E in Chrome). `npm test` is now unit tests; smoke moved to `npm run test:smoke` (115/115) |
| TASK-14 | Swagger / OpenAPI docs | ✅ | Swagger UI `/api/docs`, JSON `/api/docs-json`; Nest CLI plugin builds DTO schemas + summaries from JSDoc; `@Authenticated()` documents bearer/401/402, `@Roles` documents 403; off in production unless `SWAGGER_ENABLED=true`. Unit 52/52, smoke 124/124 |
| TASK-15 | Production DB user (non-superuser member of `app_user`), rate limiting on login | ✅ | `app_system` role + RLS lookup policies (migration 1691234567897), `db/create-app-login.sql` (NOBYPASSRLS, `app_user` WITH INHERIT FALSE); startup refuses privileged roles in production; account lockout (5/15 min, `login_lockouts`); per-IP throttling on public routes; production CORS; `TRUST_PROXY`. CI runs API as `accounting_app` with `NODE_ENV=production`. Unit 79/79, smoke 129/129 (dev and prod-mode) |
| TASK-16 | Year-end closing entries (move net income to 3100 retained earnings) | ✅ | Closing entry (`kind = closing`) dated the fiscal year end zeroes revenue/expenses into 3100; closed years locked for posting and voiding; latest year can be reopened (entry voided, kept); income statement excludes closing entries; follows the company fiscal year start month. Migration 1691234567898. Unit 91/91, smoke 153/153, E2E passing |
| TASK-17 | Real payment gateway (Omise or Stripe): `PaymentGateway` implementation + signed webhook endpoint | ✅ | Omise PromptPay: `OmisePaymentGateway` (Basic auth, `source.type=promptpay`, QR from `scannable_code`), webhook that re-fetches the charge (forged events harmless), polling refresh, test-mode simulate via `mark_as_paid`/`mark_as_failed`. Built against `tools/fake-omise.cjs` (no Omise account yet); swap to real test keys via `.env`. Migration 1691234567899. CI integration runs for both mock and omise. Unit 98/98, smoke 153 (mock) / 157 (omise), E2E both |

## Backlog

| Tag | Task | Status |
|---|---|---|
| TASK-18 | Tax invoice / receipt PDF for paid invoices (company tax ID, address) | ⬜ |
