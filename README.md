# Accounting SaaS

Multi-tenant double-entry accounting API built with NestJS, TypeORM and PostgreSQL.

- **Tenancy:** each signup creates a tenant with its own company, roles, admin user, trial subscription and a Thai SME chart of accounts.
- **Isolation:** PostgreSQL Row-Level Security. Every tenant request runs in a transaction as `app_user` with `app.tenant_id` set, so a missing `WHERE tenant_id = ...` can't leak data.
- **Auth:** JWT access and refresh tokens, bcrypt password hashes.
- **Accounting:** chart of accounts, balanced journal entries (debits must equal credits, amounts summed in satang), voiding instead of deleting, and a trial balance with an as-of date.

See [DEVELOPMENT.md](DEVELOPMENT.md) for setup and [TASKS.md](TASKS.md) for the task board.

## API (base `http://localhost:3000/api/v1`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` (no prefix) | – | Liveness + DB check |
| POST | `/tenants` | – | Sign up a tenant and admin |
| GET | `/tenants/slug/:slug` | – | Resolve a tenant by slug |
| GET | `/tenants/:id` | JWT | Tenant, company and subscription (own tenant only, else 403) |
| POST | `/auth/login` | – | `{ email, password, tenantId \| tenantSlug }` |
| POST | `/auth/refresh` | – | `{ refreshToken }` → new token pair |
| GET | `/auth/me` | JWT | Current user and roles |
| GET/POST | `/accounts` | JWT | List / create accounts |
| GET | `/journal-entries?from=&to=` | JWT | List entries with lines |
| GET | `/journal-entries/:id` | JWT | One entry |
| POST | `/journal-entries` | JWT | Post a balanced entry |
| POST | `/journal-entries/:id/void` | JWT | Void an entry |
| GET | `/reports/trial-balance?asOf=` | JWT | Trial balance |

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
