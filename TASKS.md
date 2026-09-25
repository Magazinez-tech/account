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
| TASK-6 | Build + migrations + smoke test (checklist Phases 6–10) | ✅ | `npm test`: 38/38 passing |
| TASK-7 | README, DEVELOPMENT.md, TASKS.md, first git commit | ✅ | No remote yet, so nothing pushed |

## Backlog

| Tag | Task | Status |
|---|---|---|
| TASK-8 | Frontend (React + Tailwind): login, chart of accounts, journal entry form, trial balance | ⬜ |
| TASK-9 | Role-based permissions (Admin vs User) on write endpoints | ⬜ |
| TASK-10 | Financial statements: income statement, balance sheet | ⬜ |
| TASK-11 | User management: invite users, assign roles | ⬜ |
| TASK-12 | Subscription & billing integration (invoices, payment gateway) | ⬜ |
| TASK-13 | Jest unit tests + CI | ⬜ |
| TASK-14 | Swagger / OpenAPI docs | ⬜ |
| TASK-15 | Production DB user (non-superuser member of `app_user`), rate limiting on login | ⬜ |
