# Accounting SaaS

[![CI](https://github.com/Magazinez-tech/account/actions/workflows/ci.yml/badge.svg)](https://github.com/Magazinez-tech/account/actions/workflows/ci.yml)

Multi-tenant double-entry accounting API built with NestJS, TypeORM and PostgreSQL.

- **Tenancy:** each signup creates a tenant with its own company, roles, admin user, trial subscription and a Thai SME chart of accounts.
- **Isolation:** PostgreSQL Row-Level Security. Every tenant request runs in a transaction as `app_user` with `app.tenant_id` set, so a missing `WHERE tenant_id = ...` can't leak data.
- **Auth:** JWT access and refresh tokens, bcrypt password hashes.
- **Roles:** `Admin` has full access. `User` can read everything and post journal entries, but gets 403 on creating accounts, voiding entries and managing users. `JwtAuthGuard` loads the user's active flag and roles from the database on every request, so deactivation and role changes apply immediately, without waiting for the token to expire.
- **Users:** admins invite people with a one-time link (7-day expiry, only a SHA-256 hash is stored), change roles, and deactivate or reactivate users. The last active Admin cannot be demoted or deactivated.
- **Billing:** plans are priced before VAT; checkout issues an invoice (VAT from `system_config.vat_rate`) and sends the admin to the payment gateway, whose result (webhook) marks it paid and extends the subscription by a month. Once a trial ends or a paid period lapses the tenant becomes read-only: reads work, writes return 402 except billing. Plan `max_users` caps active users plus open invitations. Only a mock gateway exists so far (`PAYMENT_PROVIDER=mock`); real providers implement `PaymentGateway`.
- **Accounting:** chart of accounts, balanced journal entries (debits must equal credits, amounts summed in satang), voiding instead of deleting, a trial balance, an income statement for any period, and a balance sheet as of any date. There are no closing entries yet, so the balance sheet puts profit to date under equity as current earnings.
- **Web app ([web/](web/)):** React + Tailwind UI in Thai for signup, login, chart of accounts, journal entry (live debit/credit balance check), journal list with void, trial balance, income statement, balance sheet, user management with invite links, and billing (plans, invoices, trial/read-only banner, mock checkout page).

See [DEVELOPMENT.md](DEVELOPMENT.md) for setup and [TASKS.md](TASKS.md) for the task board.

## API (base `http://localhost:3000/api/v1`)

Interactive docs: **http://localhost:3000/api/docs** (Swagger UI; click *Authorize* and paste an `accessToken`).
The OpenAPI 3 document is at `/api/docs-json`. Both are generated from the controllers, DTO validation rules and
JSDoc, so they stay in sync with the code; they are off in production unless `SWAGGER_ENABLED=true`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` (no prefix) | – | Liveness + DB check |
| POST | `/tenants` | – | Sign up a tenant and admin |
| GET | `/tenants/slug/:slug` | – | Resolve a tenant by slug |
| GET | `/tenants/:id` | JWT | Tenant, company and subscription (own tenant only, else 403) |
| POST | `/auth/login` | – | `{ email, password, tenantId \| tenantSlug }` |
| POST | `/auth/refresh` | – | `{ refreshToken }` → new token pair |
| GET | `/auth/me` | JWT | Current user and roles |
| GET | `/accounts` | JWT | List accounts |
| POST | `/accounts` | JWT, Admin | Create an account |
| GET | `/journal-entries?from=&to=` | JWT | List entries with lines |
| GET | `/journal-entries/:id` | JWT | One entry |
| POST | `/journal-entries` | JWT | Post a balanced entry |
| POST | `/journal-entries/:id/void` | JWT, Admin | Void an entry |
| GET | `/reports/trial-balance?asOf=` | JWT | Trial balance |
| GET | `/reports/income-statement?from=&to=` | JWT | Revenue, expenses, net income |
| GET | `/reports/balance-sheet?asOf=` | JWT | Assets, liabilities, equity (incl. current earnings) |
| GET | `/users` | JWT, Admin | Users with roles |
| PATCH | `/users/:id` | JWT, Admin | `{ role?, isActive? }` |
| GET | `/invitations` | JWT, Admin | Pending invitations |
| POST | `/invitations` | JWT, Admin | `{ email, fullName, role }` → one-time `token` |
| DELETE | `/invitations/:id` | JWT, Admin | Revoke an invitation |
| GET | `/invites/:token` | – | Invitation preview (email, company) |
| POST | `/invites/:token/accept` | – | `{ password }` → creates the user and returns tokens |
| GET | `/billing/status` | JWT | Subscription state (`trialing`, `active`, `past_due`, `canceled`, `expired`) and `readOnly` |
| GET | `/billing` | JWT, Admin | Status, plans with VAT, invoice history |
| POST | `/billing/checkout` | JWT, Admin | `{ planCode }` → open invoice + gateway `redirectUrl` |
| POST | `/billing/cancel`, `/billing/resume` | JWT, Admin | Stop / restart renewal (access continues to period end) |
| GET | `/billing/mock/charges/:chargeId` | – | Mock gateway only: charge details |
| POST | `/billing/mock/charges/:chargeId/complete` | – | Mock gateway only: `{ outcome: succeeded \| failed }`, stands in for the webhook |

Example journal entry:

```json
{
  "entryDate": "2026-09-05",
  "description": "Cash sale with VAT",
  "reference": "INV-0001",
  "lines": [
    { "accountId": "<1000 เงินสด>", "debit": 10700 },
    { "accountId": "<4000 รายได้จากการขาย>", "credit": 10000 },
    { "accountId": "<2100 ภาษีขาย>", "credit": 700 }
  ]
}
```
