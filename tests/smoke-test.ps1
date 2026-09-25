# End-to-end smoke test for the running API (checklist Phases 8-10 + accounting).
# Usage: start the server (npm run start:dev), then: npm run test:smoke
# Runs on Windows PowerShell 5.1 and PowerShell 7 (Windows/Linux, used by CI). Each run creates fresh tenants
# with a random suffix. psql is found via $env:PSQL, PATH, or the default Windows install path.
param([string]$BaseUrl = 'http://localhost:3000')

$ErrorActionPreference = 'Stop'
$script:failures = 0
$script:passes = 0

function Invoke-Api([string]$Method, [string]$Path, $Body = $null, [string]$Token = $null) {
    $headers = @{}
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }
    $params = @{ Method = $Method; Uri = "$BaseUrl$Path"; Headers = $headers; UseBasicParsing = $true }
    if ($null -ne $Body) {
        $params['ContentType'] = 'application/json; charset=utf-8'
        $params['Body'] = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 10))
    }
    try {
        $res = Invoke-WebRequest @params
        $status = [int]$res.StatusCode
        $raw = [Text.Encoding]::UTF8.GetString($res.RawContentStream.ToArray())
    } catch {
        # PS 5.1 throws WebException, PS 7 HttpResponseException; both carry the response.
        $resp = $_.Exception.Response
        if (-not $resp) { throw }
        $status = [int]$resp.StatusCode
        # PowerShell has already drained the error stream into ErrorDetails.
        $raw = $_.ErrorDetails.Message
    }
    $json = $null
    if ($raw) { $json = $raw | ConvertFrom-Json }
    [pscustomobject]@{ Status = $status; Body = $json }
}

function Check([string]$Name, [bool]$Condition, $Detail = '') {
    if ($Condition) { $script:passes++; Write-Host "  [PASS] $Name" -ForegroundColor Green }
    else { $script:failures++; Write-Host "  [FAIL] $Name $Detail" -ForegroundColor Red }
}

$suffix = -join ((97..122) | Get-Random -Count 6 | ForEach-Object { [char]$_ })

Write-Host "`n8.2 Health check"
$r = Invoke-Api GET '/health'
Check 'GET /health -> {"status":"ok"}' ($r.Status -eq 200 -and $r.Body.status -eq 'ok')

Write-Host "`n9.1 Tenant signup"
$signupA = @{
    name = 'Test Company'; slug = "test-company-$suffix"; companyName = 'Test Company Ltd.'
    companyTaxId = '1234567890'; adminEmail = 'admin@testcompany.com'; adminFullName = 'Admin User'
    adminPassword = 'SecurePass123'
}
$r = Invoke-Api POST '/api/v1/tenants' $signupA
Check 'POST /tenants -> 201' ($r.Status -eq 201) "(got $($r.Status): $($r.Body | ConvertTo-Json -Compress))"
Check 'response has tenantId, adminId, accessToken, refreshToken' ($r.Body.tenantId -and $r.Body.adminId -and $r.Body.accessToken -and $r.Body.refreshToken)
$tenantA = $r.Body.tenantId

$r = Invoke-Api POST '/api/v1/tenants' $signupA
Check 'duplicate slug -> 409' ($r.Status -eq 409)

$bad = $signupA.Clone(); $bad.slug = "Bad Slug $suffix"; $bad.adminPassword = 'short'
$r = Invoke-Api POST '/api/v1/tenants' $bad
Check 'invalid signup payload -> 400' ($r.Status -eq 400)

Write-Host "`n9.2 Login"
$r = Invoke-Api POST '/api/v1/auth/login' @{ email = 'admin@testcompany.com'; password = 'SecurePass123'; tenantId = $tenantA }
Check 'login with tenantId -> 200' ($r.Status -eq 200 -and $r.Body.accessToken) "(got $($r.Status))"
Check 'login returns user details' ($r.Body.fullName -eq 'Admin User' -and $r.Body.tenantId -eq $tenantA)
$tokenA = $r.Body.accessToken
$refreshA = $r.Body.refreshToken

$r = Invoke-Api POST '/api/v1/auth/login' @{ email = 'admin@testcompany.com'; password = 'SecurePass123'; tenantSlug = "test-company-$suffix" }
Check 'login with tenantSlug -> 200' ($r.Status -eq 200)

$r = Invoke-Api POST '/api/v1/auth/login' @{ email = 'admin@testcompany.com'; password = 'WrongPass999'; tenantId = $tenantA }
Check 'wrong password -> 401' ($r.Status -eq 401)

Write-Host "`n9.3 Protected endpoint"
$r = Invoke-Api GET '/api/v1/auth/me' $null $tokenA
Check 'GET /auth/me -> 200 with Admin role' ($r.Status -eq 200 -and ($r.Body.roles -contains 'Admin'))

$r = Invoke-Api POST '/api/v1/auth/refresh' @{ refreshToken = $refreshA }
Check 'POST /auth/refresh -> new tokens' ($r.Status -eq 200 -and $r.Body.accessToken)

$r = Invoke-Api GET '/api/v1/auth/me' $null $refreshA
Check 'refresh token rejected as access token -> 401' ($r.Status -eq 401)

Write-Host "`n9.4 Tenant lookup"
$r = Invoke-Api GET "/api/v1/tenants/slug/test-company-$suffix"
Check 'GET /tenants/slug/:slug -> trialing tenant' ($r.Status -eq 200 -and $r.Body.id -eq $tenantA -and $r.Body.subscription_status -eq 'trialing')
$r = Invoke-Api GET "/api/v1/tenants/slug/does-not-exist-$suffix"
Check 'unknown slug -> 404' ($r.Status -eq 404)

Write-Host "`n10.1 JWT security"
$r = Invoke-Api GET '/api/v1/auth/me' $null 'invalid-token-here'
Check 'invalid token -> 401' ($r.Status -eq 401 -and $r.Body.message -eq 'Unauthorized')
$r = Invoke-Api GET '/api/v1/auth/me'
Check 'missing token -> 401' ($r.Status -eq 401)

Write-Host "`n10.2 Tenant isolation"
$r = Invoke-Api POST '/api/v1/tenants' @{
    name = 'Another Company'; slug = "another-company-$suffix"; companyName = 'Another Company Ltd.'
    companyTaxId = '9876543210'; adminEmail = 'admin2@another.com'; adminFullName = 'Admin 2'; adminPassword = 'SecurePass456'
}
$tenantB = $r.Body.tenantId
$tokenB = $r.Body.accessToken
Check 'second tenant created' ($r.Status -eq 201)

$r = Invoke-Api GET "/api/v1/tenants/$tenantA" $null $tokenA
Check 'tenant A reads own tenant -> 200' ($r.Status -eq 200 -and $r.Body.company.name -eq 'Test Company Ltd.')
$r = Invoke-Api GET "/api/v1/tenants/$tenantA" $null $tokenB
Check 'tenant B reads tenant A -> 403' ($r.Status -eq 403)

Write-Host "`nAccounting: chart of accounts"
$r = Invoke-Api GET '/api/v1/accounts' $null $tokenA
Check 'default chart seeded (19 accounts)' ($r.Status -eq 200 -and @($r.Body).Count -eq 19)
$acc = @{}; foreach ($a in $r.Body) { $acc[$a.code] = $a.id }

$r = Invoke-Api POST '/api/v1/accounts' @{ code = '1020'; name = 'Savings account'; type = 'asset' } $tokenA
Check 'create account -> 201' ($r.Status -eq 201)
$r = Invoke-Api POST '/api/v1/accounts' @{ code = '1020'; name = 'Dup'; type = 'asset' } $tokenA
Check 'duplicate account code -> 409' ($r.Status -eq 409)

Write-Host "`nAccounting: journal entries"
$r = Invoke-Api POST '/api/v1/journal-entries' @{
    entryDate = '2026-09-01'; description = 'Owner capital'
    lines = @(@{ accountId = $acc['1010']; debit = 100000 }, @{ accountId = $acc['3000']; credit = 100000 })
} $tokenA
Check 'post balanced entry -> 201, entryNo 1' ($r.Status -eq 201 -and $r.Body.entryNo -eq 1 -and @($r.Body.lines).Count -eq 2) "(got $($r.Status): $($r.Body | ConvertTo-Json -Compress -Depth 5))"

$r = Invoke-Api POST '/api/v1/journal-entries' @{
    entryDate = '2026-09-05'; description = 'Cash sale with VAT'; reference = 'INV-0001'
    lines = @(
        @{ accountId = $acc['1000']; debit = 10700 },
        @{ accountId = $acc['4000']; credit = 10000 },
        @{ accountId = $acc['2100']; credit = 700 }
    )
} $tokenA
Check 'post 3-line entry -> entryNo 2' ($r.Status -eq 201 -and $r.Body.entryNo -eq 2)

$r = Invoke-Api POST '/api/v1/journal-entries' @{
    entryDate = '2026-09-06'; description = 'Office rent'
    lines = @(@{ accountId = $acc['5200']; debit = 15000 }, @{ accountId = $acc['1010']; credit = 15000 })
} $tokenA
$rentId = $r.Body.id
Check 'post rent entry -> entryNo 3' ($r.Status -eq 201 -and $r.Body.entryNo -eq 3)

$r = Invoke-Api POST '/api/v1/journal-entries' @{
    entryDate = '2026-09-07'; lines = @(@{ accountId = $acc['1000']; debit = 100 }, @{ accountId = $acc['4000']; credit = 90 })
} $tokenA
Check 'unbalanced entry -> 400' ($r.Status -eq 400)

$r = Invoke-Api POST '/api/v1/journal-entries' @{
    entryDate = '2026-09-07'; lines = @(@{ accountId = $acc['1000']; debit = 100; credit = 100 }, @{ accountId = $acc['4000']; credit = 0 })
} $tokenA
Check 'line with both/neither debit and credit -> 400' ($r.Status -eq 400)

$r = Invoke-Api GET '/api/v1/accounts' $null $tokenB
$accB = @($r.Body)[0].id
$r = Invoke-Api POST '/api/v1/journal-entries' @{
    entryDate = '2026-09-07'; lines = @(@{ accountId = $acc['1000']; debit = 50 }, @{ accountId = $accB; credit = 50 })
} $tokenA
Check "posting to another tenant's account -> 400" ($r.Status -eq 400)

$r = Invoke-Api GET "/api/v1/journal-entries/$rentId" $null $tokenB
Check "tenant B cannot read tenant A's entry -> 404" ($r.Status -eq 404)

$r = Invoke-Api POST "/api/v1/journal-entries/$rentId/void" $null $tokenA
Check 'void entry -> status void' ($r.Status -eq 201 -and $r.Body.status -eq 'void')

$r = Invoke-Api GET '/api/v1/journal-entries?from=2026-09-01&to=2026-09-30' $null $tokenA
Check 'list entries in range -> 3' ($r.Status -eq 200 -and @($r.Body).Count -eq 3)

Write-Host "`nAccounting: trial balance"
$r = Invoke-Api GET '/api/v1/reports/trial-balance' $null $tokenA
Check 'trial balance is balanced' ($r.Status -eq 200 -and $r.Body.balanced -eq $true)
Check 'totals = 110,700 (voided rent excluded)' ($r.Body.totalDebit -eq 110700 -and $r.Body.totalCredit -eq 110700) "(got $($r.Body.totalDebit)/$($r.Body.totalCredit))"
$r = Invoke-Api GET '/api/v1/reports/trial-balance?asOf=2026-09-01' $null $tokenA
Check 'trial balance asOf 2026-09-01 = 100,000' ($r.Body.totalDebit -eq 100000)
$r = Invoke-Api GET '/api/v1/reports/trial-balance' $null $tokenB
Check "tenant B trial balance is empty" ($r.Status -eq 200 -and @($r.Body.accounts).Count -eq 0)

Write-Host "`nAccounting: financial statements"
$r = Invoke-Api POST '/api/v1/journal-entries' @{
    entryDate = '2026-09-10'; description = 'Salaries'
    lines = @(@{ accountId = $acc['5100']; debit = 3000 }, @{ accountId = $acc['1010']; credit = 3000 })
} $tokenA
Check 'post salaries entry' ($r.Status -eq 201)

$r = Invoke-Api GET '/api/v1/reports/income-statement' $null $tokenA
Check 'income statement: revenue 10,000, expenses 3,000, net 7,000' ($r.Status -eq 200 -and $r.Body.revenue.total -eq 10000 -and $r.Body.expenses.total -eq 3000 -and $r.Body.netIncome -eq 7000) "(got $($r.Body | ConvertTo-Json -Compress -Depth 5))"
Check 'income statement excludes voided rent' (-not (@($r.Body.expenses.accounts) | Where-Object { $_.code -eq '5200' }))
$r = Invoke-Api GET '/api/v1/reports/income-statement?from=2026-09-06&to=2026-09-30' $null $tokenA
Check 'income statement 09-06..09-30: net loss 3,000' ($r.Body.revenue.total -eq 0 -and $r.Body.netIncome -eq -3000) "(got $($r.Body.netIncome))"
$r = Invoke-Api GET '/api/v1/reports/income-statement?from=2026-09-30&to=2026-09-01' $null $tokenA
Check 'income statement from > to -> 400' ($r.Status -eq 400)

$r = Invoke-Api GET '/api/v1/reports/balance-sheet' $null $tokenA
Check 'balance sheet: assets 107,700 = liabilities 700 + equity 107,000' ($r.Status -eq 200 -and $r.Body.assets.total -eq 107700 -and $r.Body.liabilities.total -eq 700 -and $r.Body.equity.total -eq 107000 -and $r.Body.balanced -eq $true) "(got $($r.Body | ConvertTo-Json -Compress -Depth 5))"
Check 'balance sheet current earnings = net income 7,000' ($r.Body.equity.currentEarnings -eq 7000)
$r = Invoke-Api GET '/api/v1/reports/balance-sheet?asOf=2026-09-05' $null $tokenA
Check 'balance sheet asOf 09-05: assets 110,700, earnings 10,000' ($r.Body.assets.total -eq 110700 -and $r.Body.equity.currentEarnings -eq 10000 -and $r.Body.balanced -eq $true)
$r = Invoke-Api GET '/api/v1/reports/balance-sheet' $null $tokenB
Check 'tenant B balance sheet is empty and balanced' ($r.Status -eq 200 -and $r.Body.assets.total -eq 0 -and $r.Body.balanced -eq $true)

Write-Host "`nUser management: invitations"
$r = Invoke-Api POST '/api/v1/invitations' @{ email = 'Clerk@TestCompany.com'; fullName = 'Clerk'; role = 'User' } $tokenA
Check 'Admin invites a User -> 201 with one-time token' ($r.Status -eq 201 -and $r.Body.token -and $r.Body.email -eq 'clerk@testcompany.com') "(got $($r.Status): $($r.Body | ConvertTo-Json -Compress))"
$firstToken = $r.Body.token
$r = Invoke-Api POST '/api/v1/invitations' @{ email = 'clerk@testcompany.com'; fullName = 'Clerk'; role = 'User' } $tokenA
$inviteToken = $r.Body.token
Check 're-invite replaces the open invitation' ($r.Status -eq 201 -and $inviteToken -ne $firstToken)
$r = Invoke-Api GET '/api/v1/invitations' $null $tokenA
Check 'one pending invitation listed (no token in list)' ($r.Status -eq 200 -and @($r.Body).Count -eq 1 -and -not $r.Body[0].token)
$r = Invoke-Api GET "/api/v1/invites/$firstToken"
Check 'replaced invite link -> 404' ($r.Status -eq 404)
$r = Invoke-Api POST '/api/v1/invitations' @{ email = 'admin@testcompany.com'; fullName = 'Dup'; role = 'User' } $tokenA
Check 'inviting an existing user -> 409' ($r.Status -eq 409)
$r = Invoke-Api POST '/api/v1/invitations' @{ email = 'x@testcompany.com'; fullName = 'X'; role = 'Owner' } $tokenA
Check 'unknown role -> 400' ($r.Status -eq 400)

$r = Invoke-Api GET "/api/v1/invites/$inviteToken"
Check 'public invite preview shows email and company' ($r.Status -eq 200 -and $r.Body.email -eq 'clerk@testcompany.com' -and $r.Body.companyName -eq 'Test Company Ltd.')
$r = Invoke-Api POST "/api/v1/invites/$inviteToken/accept" @{ password = 'short' }
Check 'accept with short password -> 400' ($r.Status -eq 400)
$r = Invoke-Api POST "/api/v1/invites/$inviteToken/accept" @{ password = 'ClerkPass123' }
Check 'accept invite -> tokens + tenant slug' ($r.Status -eq 201 -and $r.Body.accessToken -and $r.Body.tenantSlug -eq "test-company-$suffix") "(got $($r.Status))"
$tokenUser = $r.Body.accessToken
$r = Invoke-Api POST "/api/v1/invites/$inviteToken/accept" @{ password = 'ClerkPass123' }
Check 'invite link is single-use -> 404' ($r.Status -eq 404)
$r = Invoke-Api POST '/api/v1/auth/login' @{ email = 'clerk@testcompany.com'; password = 'ClerkPass123'; tenantId = $tenantA }
Check 'invited user can log in' ($r.Status -eq 200)
$r = Invoke-Api GET '/api/v1/auth/me' $null $tokenUser
Check 'invited user has roles = [User]' ($r.Status -eq 200 -and (@($r.Body.roles) -join ',') -eq 'User')
$r = Invoke-Api GET '/api/v1/invitations' $null $tokenA
Check 'accepted invitation no longer pending' (@($r.Body).Count -eq 0)

$r = Invoke-Api POST '/api/v1/invitations' @{ email = 'temp@testcompany.com'; fullName = 'Temp'; role = 'User' } $tokenA
$tempId = $r.Body.id; $tempToken = $r.Body.token
$r = Invoke-Api DELETE "/api/v1/invitations/$tempId" $null $tokenA
Check 'revoke invitation -> 204' ($r.Status -eq 204)
$r = Invoke-Api GET "/api/v1/invites/$tempToken"
Check 'revoked invite link -> 404' ($r.Status -eq 404)
$r = Invoke-Api DELETE "/api/v1/invitations/$tempId" $null $tokenA
Check 'revoke twice -> 404' ($r.Status -eq 404)

Write-Host "`nRole-based permissions (User role)"
$r = Invoke-Api GET '/api/v1/accounts' $null $tokenUser
Check 'User can list accounts' ($r.Status -eq 200)
$r = Invoke-Api GET '/api/v1/reports/trial-balance' $null $tokenUser
Check 'User can read trial balance' ($r.Status -eq 200)
$r = Invoke-Api POST '/api/v1/journal-entries' @{
    entryDate = '2026-09-08'; description = 'Utilities'
    lines = @(@{ accountId = $acc['5300']; debit = 1200 }, @{ accountId = $acc['1000']; credit = 1200 })
} $tokenUser
Check 'User can post a journal entry' ($r.Status -eq 201)
$userEntryId = $r.Body.id

$r = Invoke-Api POST '/api/v1/accounts' @{ code = '1030'; name = 'Petty cash'; type = 'asset' } $tokenUser
Check 'User cannot create an account -> 403' ($r.Status -eq 403 -and $r.Body.message -eq 'Requires role: Admin') "(got $($r.Status))"
$r = Invoke-Api POST "/api/v1/journal-entries/$userEntryId/void" $null $tokenUser
Check 'User cannot void an entry -> 403' ($r.Status -eq 403) "(got $($r.Status))"
$r = Invoke-Api GET "/api/v1/journal-entries/$userEntryId" $null $tokenA
Check 'entry is still posted after the denied void' ($r.Body.status -eq 'posted')
$r = Invoke-Api POST "/api/v1/journal-entries/$userEntryId/void" $null $tokenA
Check 'Admin can void the entry' ($r.Status -eq 201 -and $r.Body.status -eq 'void')
$r = Invoke-Api GET '/api/v1/users' $null $tokenUser
Check 'User cannot list users -> 403' ($r.Status -eq 403)
$r = Invoke-Api POST '/api/v1/invitations' @{ email = 'y@testcompany.com'; fullName = 'Y'; role = 'Admin' } $tokenUser
Check 'User cannot invite -> 403' ($r.Status -eq 403)

Write-Host "`nUser management: roles and deactivation"
$r = Invoke-Api GET '/api/v1/users' $null $tokenA
Check 'Admin lists 2 users' ($r.Status -eq 200 -and @($r.Body).Count -eq 2)
$adminId = (@($r.Body) | Where-Object { $_.email -eq 'admin@testcompany.com' }).id
$clerkId = (@($r.Body) | Where-Object { $_.email -eq 'clerk@testcompany.com' }).id

$r = Invoke-Api PATCH "/api/v1/users/$clerkId" @{ role = 'Admin' } $tokenA
Check 'promote clerk to Admin' ($r.Status -eq 200 -and (@($r.Body.roles) -join ',') -eq 'Admin')
$r = Invoke-Api POST '/api/v1/accounts' @{ code = '1030'; name = 'Petty cash'; type = 'asset' } $tokenUser
Check 'new role applies to the same token' ($r.Status -eq 201) "(got $($r.Status))"
$r = Invoke-Api PATCH "/api/v1/users/$clerkId" @{ role = 'User' } $tokenA
Check 'demote clerk back to User' ($r.Status -eq 200 -and (@($r.Body.roles) -join ',') -eq 'User')

$r = Invoke-Api PATCH "/api/v1/users/$adminId" @{ role = 'User' } $tokenA
Check 'last Admin cannot demote themself -> 400' ($r.Status -eq 400)
$r = Invoke-Api GET '/api/v1/auth/me' $null $tokenA
Check 'Admin role unchanged after the rejected demotion' ((@($r.Body.roles) -join ',') -eq 'Admin')
$r = Invoke-Api PATCH "/api/v1/users/$adminId" @{ isActive = $false } $tokenA
Check 'cannot deactivate yourself -> 400' ($r.Status -eq 400)

$r = Invoke-Api PATCH "/api/v1/users/$clerkId" @{ isActive = $false } $tokenA
Check 'deactivate clerk' ($r.Status -eq 200 -and $r.Body.isActive -eq $false)
$r = Invoke-Api GET '/api/v1/accounts' $null $tokenUser
Check "deactivated user's existing token -> 401" ($r.Status -eq 401)
$r = Invoke-Api POST '/api/v1/auth/login' @{ email = 'clerk@testcompany.com'; password = 'ClerkPass123'; tenantId = $tenantA }
Check 'deactivated user cannot log in -> 401' ($r.Status -eq 401)
$r = Invoke-Api PATCH "/api/v1/users/$clerkId" @{ isActive = $true } $tokenA
$r = Invoke-Api GET '/api/v1/accounts' $null $tokenUser
Check 'reactivated user works again' ($r.Status -eq 200)

$r = Invoke-Api PATCH "/api/v1/users/$clerkId" @{ role = 'Admin' } $tokenB
Check "tenant B admin cannot change tenant A's user -> 404" ($r.Status -eq 404)

$pgBin = $env:PSQL
if (-not $pgBin) { $pgBin = (Get-Command psql -ErrorAction SilentlyContinue).Source }
if (-not $pgBin -and (Test-Path 'C:\Program Files\PostgreSQL\16\bin\psql.exe')) { $pgBin = 'C:\Program Files\PostgreSQL\16\bin\psql.exe' }
if (-not $env:PGPASSWORD) { $env:PGPASSWORD = 'postgres' }

function Invoke-Sql([string]$Sql) {
    & $pgBin -U postgres -h localhost -d accounting_saas_dev -q -c $Sql | Out-Null
}

Write-Host "`nBilling: plans, checkout, mock gateway"
$r = Invoke-Api GET '/api/v1/billing/status' $null $tokenUser
Check 'any member sees billing status: trialing starter' ($r.Status -eq 200 -and $r.Body.status -eq 'trialing' -and $r.Body.readOnly -eq $false -and $r.Body.plan.code -eq 'starter') "(got $($r.Body | ConvertTo-Json -Compress))"
$r = Invoke-Api GET '/api/v1/billing' $null $tokenUser
Check 'User cannot open billing overview -> 403' ($r.Status -eq 403)
$r = Invoke-Api GET '/api/v1/billing' $null $tokenA
$pro = @($r.Body.plans) | Where-Object { $_.code -eq 'pro' }
Check 'overview lists 3 plans, VAT 7%' ($r.Status -eq 200 -and @($r.Body.plans).Count -eq 3 -and $r.Body.vatRate -eq 7)
Check 'Pro = 790 + VAT 55.30 = 845.30' ($pro.priceMonthly -eq 790 -and $pro.vatAmount -eq 55.3 -and $pro.total -eq 845.3) "(got $($pro | ConvertTo-Json -Compress))"

$r = Invoke-Api POST '/api/v1/billing/checkout' @{ planCode = 'gold' } $tokenA
Check 'unknown plan -> 400' ($r.Status -eq 400)
$r = Invoke-Api POST '/api/v1/billing/checkout' @{ planCode = 'pro' } $tokenUser
Check 'User cannot check out -> 403' ($r.Status -eq 403)

$r = Invoke-Api POST '/api/v1/billing/checkout' @{ planCode = 'pro' } $tokenA
Check 'checkout Pro -> invoice INV-000001 and gateway redirect' ($r.Status -eq 201 -and $r.Body.invoiceNo -eq 'INV-000001' -and $r.Body.amount -eq 845.3 -and $r.Body.redirectUrl -match '/billing/mock-checkout/mock_chrg_') "(got $($r.Body | ConvertTo-Json -Compress))"
$charge1 = ($r.Body.redirectUrl -split '/billing/mock-checkout/')[1].Split('?')[0]

$r = Invoke-Api GET "/api/v1/billing/mock/charges/$charge1"
Check 'mock gateway shows the charge amount' ($r.Status -eq 200 -and $r.Body.amount -eq 845.3 -and $r.Body.status -eq 'pending')
$r = Invoke-Api GET '/api/v1/billing/mock/charges/mock_chrg_doesnotexist'
Check 'unknown charge -> 404' ($r.Status -eq 404)

$r = Invoke-Api POST "/api/v1/billing/mock/charges/$charge1/complete" @{ outcome = 'failed'; failureMessage = 'Card declined' }
Check 'declined payment -> failed' ($r.Status -eq 200 -and $r.Body.status -eq 'failed')
$r = Invoke-Api GET '/api/v1/billing' $null $tokenA
Check 'after decline: still trialing, invoice open' ($r.Body.status -eq 'trialing' -and $r.Body.invoices[0].status -eq 'open' -and $r.Body.invoices[0].paymentStatus -eq 'failed')

$r = Invoke-Api POST '/api/v1/billing/checkout' @{ planCode = 'pro' } $tokenA
Check 'retry checkout -> INV-000002' ($r.Body.invoiceNo -eq 'INV-000002')
$charge2 = ($r.Body.redirectUrl -split '/billing/mock-checkout/')[1].Split('?')[0]
$r = Invoke-Api POST "/api/v1/billing/mock/charges/$charge2/complete" @{ outcome = 'succeeded' }
Check 'successful payment -> succeeded' ($r.Status -eq 200 -and $r.Body.status -eq 'succeeded' -and -not $r.Body.alreadySettled)
$r = Invoke-Api POST "/api/v1/billing/mock/charges/$charge2/complete" @{ outcome = 'succeeded' }
Check 'repeated webhook is idempotent' ($r.Status -eq 200 -and $r.Body.alreadySettled -eq $true)

$r = Invoke-Api GET '/api/v1/billing' $null $tokenA
$periodEnd = [datetime]$r.Body.currentPeriodEnd
Check 'subscription active on Pro' ($r.Body.status -eq 'active' -and $r.Body.plan.code -eq 'pro' -and $r.Body.readOnly -eq $false)
Check 'period ends in ~1 month' (($periodEnd - (Get-Date)).TotalDays -gt 27 -and ($periodEnd - (Get-Date)).TotalDays -lt 32) "(got $periodEnd)"
Check 'INV-000002 paid, INV-000001 voided' (($r.Body.invoices | Where-Object { $_.invoiceNo -eq 'INV-000002' }).status -eq 'paid' -and ($r.Body.invoices | Where-Object { $_.invoiceNo -eq 'INV-000001' }).status -eq 'void')

$r = Invoke-Api POST '/api/v1/billing/checkout' @{ planCode = 'pro' } $tokenA
$charge3 = ($r.Body.redirectUrl -split '/billing/mock-checkout/')[1].Split('?')[0]
$r = Invoke-Api POST "/api/v1/billing/mock/charges/$charge3/complete" @{ outcome = 'succeeded' }
$r = Invoke-Api GET '/api/v1/billing/status' $null $tokenA
Check 'paying early extends from the current period end' ([math]::Abs((([datetime]$r.Body.currentPeriodEnd) - $periodEnd.AddMonths(1)).TotalDays) -lt 2) "(got $($r.Body.currentPeriodEnd), expected ~$($periodEnd.AddMonths(1)))"

$r = Invoke-Api POST '/api/v1/billing/cancel' $null $tokenA
Check 'cancel -> active until period end' ($r.Status -eq 200 -and $r.Body.status -eq 'active' -and $r.Body.cancelAtPeriodEnd -eq $true)
$r = Invoke-Api POST '/api/v1/billing/resume' $null $tokenA
Check 'resume -> renewal back on' ($r.Status -eq 200 -and $r.Body.cancelAtPeriodEnd -eq $false)

Write-Host "`nBilling: plan limits and read-only mode"
# Tenant B is on the Starter trial (3 users): 1 admin + 2 open invitations fill it.
$r = Invoke-Api POST '/api/v1/invitations' @{ email = 'b1@another.com'; fullName = 'B One'; role = 'User' } $tokenB
$r = Invoke-Api POST '/api/v1/invitations' @{ email = 'b2@another.com'; fullName = 'B Two'; role = 'User' } $tokenB
Check 'Starter: invites up to 3 seats' ($r.Status -eq 201)
$r = Invoke-Api POST '/api/v1/invitations' @{ email = 'b3@another.com'; fullName = 'B Three'; role = 'User' } $tokenB
Check 'Starter: 4th seat -> 403 plan limit' ($r.Status -eq 403 -and $r.Body.message -eq 'Plan user limit reached') "(got $($r.Status): $($r.Body.message))"

if ($pgBin) {
    Invoke-Sql "UPDATE subscriptions SET trial_ends_at = now() - interval '1 day' WHERE tenant_id = '$tenantB'"
    $r = Invoke-Api GET '/api/v1/billing/status' $null $tokenB
    Check 'trial over -> expired, read-only' ($r.Body.status -eq 'expired' -and $r.Body.readOnly -eq $true)
    $r = Invoke-Api GET '/api/v1/accounts' $null $tokenB
    Check 'read-only: reads still work' ($r.Status -eq 200)
    $r = Invoke-Api POST '/api/v1/accounts' @{ code = '1099'; name = 'Blocked'; type = 'asset' } $tokenB
    Check 'read-only: writes -> 402' ($r.Status -eq 402 -and $r.Body.message -eq 'Subscription inactive') "(got $($r.Status))"

    Invoke-Sql "UPDATE subscriptions SET current_period_end = now() - interval '1 day' WHERE tenant_id = '$tenantA'"
    $r = Invoke-Api GET '/api/v1/billing/status' $null $tokenA
    Check 'unpaid period over -> past_due, read-only' ($r.Body.status -eq 'past_due' -and $r.Body.readOnly -eq $true)
    $r = Invoke-Api POST '/api/v1/journal-entries' @{
        entryDate = '2026-09-20'; lines = @(@{ accountId = $acc['1000']; debit = 10 }, @{ accountId = $acc['4000']; credit = 10 })
    } $tokenA
    Check 'past_due: posting an entry -> 402' ($r.Status -eq 402)
    $r = Invoke-Api POST '/api/v1/billing/checkout' @{ planCode = 'starter' } $tokenA
    Check 'past_due: checkout still allowed' ($r.Status -eq 201) "(got $($r.Status))"
    $charge4 = ($r.Body.redirectUrl -split '/billing/mock-checkout/')[1].Split('?')[0]
    $r = Invoke-Api POST "/api/v1/billing/mock/charges/$charge4/complete" @{ outcome = 'succeeded' }
    $r = Invoke-Api GET '/api/v1/billing/status' $null $tokenA
    $days = (([datetime]$r.Body.currentPeriodEnd) - (Get-Date)).TotalDays
    Check 'paying after lapse: active on Starter, new period from today' ($r.Body.status -eq 'active' -and $r.Body.plan.code -eq 'starter' -and $days -gt 27 -and $days -lt 32) "(got $($r.Body | ConvertTo-Json -Compress))"
    $r = Invoke-Api POST '/api/v1/journal-entries' @{
        entryDate = '2026-09-20'; lines = @(@{ accountId = $acc['1000']; debit = 10 }, @{ accountId = $acc['4000']; credit = 10 })
    } $tokenA
    Check 'writes work again after paying' ($r.Status -eq 201)

    Invoke-Sql "UPDATE subscriptions SET canceled_at = now(), current_period_end = now() - interval '1 minute' WHERE tenant_id = '$tenantA'"
    $r = Invoke-Api GET '/api/v1/billing/status' $null $tokenA
    Check 'canceled and period over -> canceled, read-only' ($r.Body.status -eq 'canceled' -and $r.Body.readOnly -eq $true)
} else {
    Write-Host '  [SKIP] psql not found' -ForegroundColor Yellow
}

Write-Host "`n10.3 Row-Level Security (direct SQL as app_user)"
if ($pgBin) {
    $noRls = & $pgBin -U postgres -h localhost -d accounting_saas_dev -tA -c "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename <> 'typeorm_migrations' AND NOT rowsecurity"
    Check 'RLS enabled on every app table' ($noRls.Trim() -eq '0') "($noRls tables without RLS)"
    $sql = "BEGIN; SET LOCAL ROLE app_user; SELECT set_config('app.tenant_id', '$tenantB', true); SELECT count(*) FROM journal_entries WHERE tenant_id = '$tenantA'; ROLLBACK;"
    $leak = (& $pgBin -U postgres -h localhost -d accounting_saas_dev -tA -c $sql | Where-Object { $_ -match '^\d+$' } | Select-Object -Last 1)
    Check "app_user scoped to B sees 0 of A's journal entries" ($leak -eq '0') "(saw $leak)"
    $none = (& $pgBin -U postgres -h localhost -d accounting_saas_dev -tA -c "BEGIN; SET LOCAL ROLE app_user; SELECT count(*) FROM users; ROLLBACK;" | Where-Object { $_ -match '^\d+$' } | Select-Object -Last 1)
    Check 'app_user without tenant context sees 0 users' ($none -eq '0') "(saw $none)"
} else {
    Write-Host '  [SKIP] psql not found' -ForegroundColor Yellow
}

Write-Host "`n$($script:passes) passed, $($script:failures) failed"
if ($script:failures -gt 0) { exit 1 }
