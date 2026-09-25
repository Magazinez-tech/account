# Accounting SaaS

[![CI](https://github.com/Magazinez-tech/account/actions/workflows/ci.yml/badge.svg)](https://github.com/Magazinez-tech/account/actions/workflows/ci.yml)

Multi-tenant double-entry accounting API built with NestJS, TypeORM and PostgreSQL.

- **Tenancy:** each signup creates a tenant with its own company, roles, admin user, trial subscription and a Thai SME chart of accounts.
- **Isolation:** PostgreSQL Row-Level Security. Every tenant request runs in a transaction as `app_user` with `app.tenant_id` set, so a missing `WHERE tenant_id = ...` can't leak data. In production the API connects as a least-privilege role (no superuser, no BYPASSRLS) and refuses to start otherwise; see [DEVELOPMENT.md](DEVELOPMENT.md#production-deployment-checklist).
- **Abuse protection:** accounts lock for 15 minutes after 5 failed sign-ins (shared across instances via PostgreSQL); public endpoints have per-IP rate limits (429 with `Retry-After`); production CORS allows only the app's origin.
- **Auth:** JWT access and refresh tokens, bcrypt password hashes.
- **Roles:** `Admin` has full access. `User` can read everything and post journal entries, but gets 403 on creating accounts, voiding entries and managing users. `JwtAuthGuard` loads the user's active flag and roles from the database on every request, so deactivation and role changes apply immediately, without waiting for the token to expire.
- **Users:** admins invite people with a one-time link (7-day expiry, only a SHA-256 hash is stored), change roles, and deactivate or reactivate users. The last active Admin cannot be demoted or deactivated.
- **Billing:** plans are priced before VAT; checkout issues an invoice (VAT from `system_config.vat_rate`) and sends the admin to the payment gateway, whose result (webhook) marks it paid and extends the subscription by a month. Once a trial ends or a paid period lapses the tenant becomes read-only: reads work, writes return 402 except billing. Plan `max_users` caps active users plus open invitations. Gateways: `mock` (hosted mock page, default) and `omise` (PromptPay QR through Omise / Opn Payments; the webhook payload is never trusted, the charge is re-read from Omise). Development and CI run the Omise integration against `tools/fake-omise.cjs`.
- **Accounting:** chart of accounts, balanced journal entries (debits must equal credits, amounts summed in satang), voiding instead of deleting, a trial balance, an income statement for any period, and a balance sheet as of any date. Year-end closing posts a closing entry that moves revenue and expenses into 3100 retained earnings and locks the fiscal year (no new or voided entries dated in it); the latest closed year can be reopened. Profit not yet closed shows on the balance sheet as current earnings.
- **Sales documents:** company profile (legal name, tax ID, branch, address, contacts) printed as the issuer; customers with tax ID, branch and credit terms; quotations (`QT-<year>-<seq>`: draft → sent → accepted / rejected) and billing notes (`BN-<year>-<seq>`), made from an accepted quotation or from scratch. Prices exclude VAT, the discount comes off before VAT, and the signed-in user who created a document is printed as its issuer. Issuing a billing note posts Dr 1100 AR / Cr revenue / Cr 2100 output VAT; recording payment posts Dr cash or bank / Cr AR. These entries (kind `sales`) are reversed only by voiding the note, and respect the year-end period lock. Documents print to A4 (or PDF via the browser) with the amount in Thai words.
- **Web app ([web/](web/)):** React + Tailwind UI in Thai for signup, login, quotations, billing notes, customers, company profile, chart of accounts, journal entry (live debit/credit balance check), journal list with void, trial balance, income statement, balance sheet, year-end closing, user management with invite links, and billing (plans, invoices, trial/read-only banner, mock checkout page).

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
| GET | `/fiscal-years` | JWT | Closed years, lock date, next closable year with a preview |
| POST | `/fiscal-years/close` | JWT, Admin | `{ fiscalYearEnd }` → closing entry + lock |
| POST | `/fiscal-years/:fiscalYearEnd/reopen` | JWT, Admin | Reopen the latest closed year (closing entry voided) |
| GET | `/company` | JWT | Company profile (issuer details on documents) |
| PATCH | `/company` | JWT, Admin | `{ name?, taxId?, branchCode?, address?, phone?, email?, website? }` |
| GET | `/customers?includeInactive=` | JWT | Customers by name |
| GET / POST / PATCH | `/customers`, `/customers/:id` | JWT | One customer / add / change or deactivate (`isActive: false`) |
| GET | `/quotations?status=&customerId=` | JWT | Quotations with their billing note |
| GET / POST / PUT | `/quotations`, `/quotations/:id` | JWT | One quotation / create draft / replace a draft |
| POST | `/quotations/:id/status` | JWT | `{ status: sent | accepted | rejected | draft }` |
| POST | `/quotations/:id/billing-note` | JWT | Draft billing note from an accepted quotation (once) |
| POST | `/quotations/:id/void` | JWT, Admin | Cancel a quotation |
| GET | `/billing-notes?status=&customerId=` | JWT | Billing notes |
| GET / POST / PUT | `/billing-notes`, `/billing-notes/:id` | JWT | One note / create draft / replace a draft |
| POST | `/billing-notes/:id/issue` | JWT | Post the receivable (Dr AR / Cr revenue, output VAT) |
| POST | `/billing-notes/:id/payment` | JWT | `{ paidDate, accountId? }` → Dr cash or bank / Cr AR |
| POST | `/billing-notes/:id/void` | JWT, Admin | Cancel a draft or issued note (its entry is voided) |
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
| POST | `/billing/invoices/:id/refresh` | JWT, Admin | Re-check the invoice's payment with the gateway (QR polling) |
| POST | `/billing/invoices/:id/simulate` | JWT, Admin | Test mode only: `{ outcome }` via Omise `mark_as_paid` / `mark_as_failed` |
| POST | `/billing/webhooks/omise` | – | Omise events; the charge is re-fetched from Omise before settling |
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
