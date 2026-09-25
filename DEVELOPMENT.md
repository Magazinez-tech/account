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
| `npm test` | End-to-end smoke test (server must be running) |

## How tenant isolation works
- `TenantDb.run(tenantId, fn)` in `src/database/tenant-db.service.ts` opens a transaction, runs
  `SET LOCAL ROLE app_user` and sets `app.tenant_id`. RLS policies on every tenant table compare
  `tenant_id` against that setting.
- `TenantDb.system` skips RLS. Use it only for lookups that happen before the tenant is known
  (slug lookup, slug availability).
- Foreign-key checks ignore RLS. Services must check that referenced rows (accounts, parent accounts)
  belong to the tenant, as `AccountingService` does.
- The `postgres` superuser bypasses RLS, so the app only gets isolation through `SET ROLE app_user`.
  In production, connect as a non-superuser that is a member of `app_user`.

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
