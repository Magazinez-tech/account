# Local Development Setup (Windows)

## Prerequisites (installed with winget)
```powershell
winget install OpenJS.NodeJS.LTS      # Node 24 / npm 11
winget install Git.Git
winget install PostgreSQL.PostgreSQL.16
```
psql lives in `C:\Program Files\PostgreSQL\16\bin`. Add it to PATH or call it by full path.

## First-time setup
```powershell
Copy-Item .env.example .env
# Generate a JWT secret and paste it into .env as JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npm install
createdb -U postgres accounting_saas_dev
npm run typeorm migration:run
```

## Database Access
- Host: localhost:5432
- User: postgres / postgres (dev only)
- Database: accounting_saas_dev
- Connect: `psql -U postgres -d accounting_saas_dev`

## API Server
- URL: http://localhost:3000
- API Base: http://localhost:3000/api/v1
- API docs: http://localhost:3000/api/docs (OpenAPI JSON: `/api/docs-json`)

### Documenting endpoints
The Nest CLI swagger plugin (`nest-cli.json`) reads the code at build time:
- Controllers live in `*.module.ts` files (`controllerFileNameSuffix`); the JSDoc above a handler becomes its summary.
- DTOs live in `*.dto.ts`; property types and class-validator rules become the schema, JSDoc becomes the
  description, and `@example` tags become examples. Fields validated with `@IsIn` need `@ApiProperty({ enum })`.
- Use `@Authenticated()` (not `UseGuards`) on protected controllers: it applies the JWT and role guards and
  documents bearer auth, 401 and 402. `@Roles('Admin')` also documents the 403.
- Restart `npm run start:dev` after changing `nest-cli.json`; the watcher does not reload it.

## Billing (dev)
- `.env`: `PAYMENT_PROVIDER=mock` and `APP_URL=http://localhost:5173` (defaults if unset).
- Checkout sends you to `/billing/mock-checkout/<chargeId>` in the web app; choose success or failure there.
- To test expiry, move dates into the past, e.g.
  `UPDATE subscriptions SET trial_ends_at = now() - interval '1 day' WHERE tenant_id = '...';`
  The tenant turns read-only immediately (status is derived from dates; there is no scheduler).

## Web App
```powershell
cd web
npm install
npm run dev        # http://localhost:5173; /api is proxied to :3000
```
Vite + React 19 + TypeScript + Tailwind 4 + React Router. Start the API first.

| Command (in `web/`) | What it does |
|---|---|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Typecheck and build to `web/dist/` |
| `npm run lint` | oxlint |
| `npm test` | Vitest unit tests (`src/**/*.test.ts`, jsdom) |
| `npm run e2e` | Browser smoke test in headless Edge, or `E2E_BROWSER=chrome` (API and dev server must be running). Screenshots go to `web/e2e/screenshots/` |

If the dev server serves stale code after files are rewritten outside the editor (e.g. `sed -i`), touch the file or restart `npm run dev`; the Windows file watcher can miss replaced files.

- Tokens are kept in `localStorage`. A 401 triggers one refresh with the refresh token; if that fails, the user is signed out.
- The journal form checks balance in satang in the browser too, so the submit button stays disabled until debits equal credits.

## Test Credentials
The smoke test creates fresh tenants on every run (slug `test-company-<random>`):
- Email: admin@testcompany.com
- Password: SecurePass123

## Commands
| Command | What it does |
|---|---|
| `npm run start:dev` | Dev server with hot reload |
| `npm run build` | Compile to `dist/` |
| `npm run typeorm migration:run` | Apply migrations |
| `npm run typeorm migration:show` | Migration status |
| `npm run typeorm migration:revert` | Roll back the last migration |
| `npm test` | Jest unit tests (`src/**/*.spec.ts`, no database needed) |
| `npm run test:watch` | Jest in watch mode |
| `npm run test:smoke` | End-to-end API smoke test (server must be running; uses psql for RLS/expiry checks) |

## How tenant isolation works
- `TenantDb.run(tenantId, fn)` in `src/database/tenant-db.service.ts` opens a transaction, runs
  `SET LOCAL ROLE app_user` and sets `app.tenant_id`. RLS policies on every tenant table compare
  `tenant_id` against that setting.
- `TenantDb.system` skips RLS. Use it only for lookups that happen before the tenant is known
  (slug lookup, slug availability).
- Foreign-key checks ignore RLS. Services must check that referenced rows (accounts, parent accounts)
  belong to the tenant, as `AccountingService` does.
- The `postgres` superuser bypasses RLS, so in development the app only gets isolation through
  `SET ROLE app_user` (the API logs a warning at startup). Production uses a least-privilege role; see below.

## Production deployment checklist
1. **Migrations run as the owner** (e.g. `postgres`): `npm run migration:run`. They create the NOLOGIN roles
   `app_user` (tenant transactions, RLS) and `app_system` (the few lookups before the tenant is known).
2. **Create the API's login role** once, as a superuser (PostgreSQL 16+):
   ```powershell
   psql -U postgres -d <db> -v login=accounting_app -v password='<strong password>' -f db/create-app-login.sql
   ```
   It is not a superuser and has no BYPASSRLS. It inherits `app_system` and may `SET ROLE app_user` without
   inheriting its privileges, so a query outside `TenantDb.run` gets *permission denied* on tenant tables.
3. **Run the API** with `NODE_ENV=production`, `DB_USERNAME=accounting_app`, a strong `JWT_SECRET`, and `APP_URL`
   (or `CORS_ORIGINS`). At startup the API refuses a superuser/BYPASSRLS role or one that can't use `app_user`.
4. **Behind a load balancer** set `TRUST_PROXY` (e.g. `1`) so rate limits see client IPs.

| Protection | Where | Default |
|---|---|---|
| Account lockout | `LoginLockoutService`, table `login_lockouts` (shared by all instances) | 5 failures / 15 min → locked 15 min (`LOGIN_MAX_FAILURES`, `LOGIN_LOCKOUT_MINUTES`) |
| Per-IP limits | `@RateLimit` + `@nestjs/throttler` (in memory, per instance) | login 30/min, refresh 60/min, signup 10/10 min, slug & invite links 60/min |
| CORS | `corsOptions` | production: `APP_URL` / `CORS_ORIGINS` only |
| API docs | `swaggerEnabled` | off in production unless `SWAGGER_ENABLED=true` |

For local development `.env` can set `RATE_LIMIT_SCALE=20` so test suites can run back to back; leave it unset
in production. CI runs the integration job exactly like production (least-privilege role, `NODE_ENV=production`,
real limits).

## Tests and CI
| Layer | Where | Runs |
|---|---|---|
| API unit (Jest) | `src/**/*.spec.ts` | Pure logic: satang math, double-entry rules, statements, billing dates/VAT, subscription access, JWT and role guards |
| Web unit (Vitest) | `web/src/**/*.test.ts` | Amount parsing/formatting, fiscal-year dates, API client (token refresh, Thai error messages) |
| API smoke (PowerShell) | `tests/smoke-test.ps1` | Every endpoint against a real database, incl. RLS and subscription expiry |
| Browser E2E (Playwright) | `web/e2e/smoke.mjs` | Signup → journal → reports → invite → billing through the UI |

GitHub Actions (`.github/workflows/ci.yml`) runs on every push to `main` and every PR:
1. **API**: `npm ci`, build, unit tests.
2. **Web**: lint, unit tests, build.
3. **Integration** (after 1 and 2): PostgreSQL 16 service container, migrations, API (`start:prod`) and Vite
   in the background, then the smoke test under `pwsh` and the browser E2E in Chrome. On failure, screenshots
   and server logs are uploaded as the `integration-artifacts` artifact.

Jest runs with `--experimental-vm-modules` because NestJS 12 ships as ES modules.

## Troubleshooting
**Port 3000 in use**
```powershell
Get-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess
Stop-Process -Id <PID>
# or set PORT=3001 in .env
```
**PostgreSQL not running**
```powershell
Get-Service postgresql*
Start-Service postgresql-x64-16
```
**npm install errors**
```powershell
npm cache clean --force
Remove-Item -Recurse -Force node_modules, package-lock.json
npm install
```
