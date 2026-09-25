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

Write-Host "`nAPI docs (OpenAPI / Swagger)"
$r = Invoke-Api GET '/api/docs-json'
Check 'GET /api/docs-json -> OpenAPI 3 document' ($r.Status -eq 200 -and "$($r.Body.openapi)".StartsWith('3.')) "(got $($r.Status))"
$ops = foreach ($p in $r.Body.paths.PSObject.Properties) {
    foreach ($m in $p.Value.PSObject.Properties) { [pscustomobject]@{ Name = "$($m.Name.ToUpper()) $($p.Name)"; Op = $m.Value } }
}
Check 'documents at least 30 operations' (@($ops).Count -ge 30) "(got $(@($ops).Count))"
$noSummary = @($ops | Where-Object { -not $_.Op.summary } | ForEach-Object Name)
Check 'every operation has a summary' ($noSummary.Count -eq 0) "(missing: $($noSummary -join ', '))"
$noTag = @($ops | Where-Object { -not $_.Op.tags } | ForEach-Object Name)
Check 'every operation has a tag' ($noTag.Count -eq 0) "(missing: $($noTag -join ', '))"
Check 'bearer JWT security scheme' ($r.Body.components.securitySchemes.bearer.scheme -eq 'bearer')
$secured = @($ops | Where-Object { $_.Op.security })
$no401 = @($secured | Where-Object { -not $_.Op.responses.'401' } | ForEach-Object Name)
Check 'every secured operation documents 401' ($secured.Count -ge 20 -and $no401.Count -eq 0) "(secured $($secured.Count); missing 401: $($no401 -join ', '))"
Check 'Admin-only void documents 403' ($null -ne $r.Body.paths.'/api/v1/journal-entries/{id}/void'.post.responses.'403')
Check 'DTO schema carries validation + examples' ($r.Body.components.schemas.CreateJournalEntryDto.properties.entryDate.example -eq '2026-09-05' -and $r.Body.components.schemas.CreateJournalEntryDto.properties.lines.minItems -eq 2)
$ui = Invoke-WebRequest -Uri "$BaseUrl/api/docs" -UseBasicParsing
Check 'Swagger UI served at /api/docs' ($ui.StatusCode -eq 200 -and $ui.Content -match 'swagger-ui')

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

Write-Host "`nYear-end closing"
# FY 2025 (calendar year): sale 5,000 and misc expense 1,200 -> profit 3,800.
$r = Invoke-Api POST '/api/v1/journal-entries' @{ entryDate = '2025-06-15'; description = '2025 sale'
    lines = @(@{ accountId = $acc['1000']; debit = 5000 }, @{ accountId = $acc['4000']; credit = 5000 }) } $tokenA
$sale2025 = $r.Body.id
$r = Invoke-Api POST '/api/v1/journal-entries' @{ entryDate = '2025-11-20'; description = '2025 expense'
    lines = @(@{ accountId = $acc['5900']; debit = 1200 }, @{ accountId = $acc['1000']; credit = 1200 }) } $tokenA
Check 'post FY2025 entries' ($r.Status -eq 201 -and $sale2025)

$r = Invoke-Api GET '/api/v1/fiscal-years' $null $tokenA
$n = $r.Body.nextClosable
Check 'next closable year = FY2025 with profit 3,800 preview' ($r.Status -eq 200 -and $null -eq $r.Body.closedThrough -and $n.fiscalYearEnd -eq '2025-12-31' -and $n.canClose -eq $true -and $n.netIncome -eq 3800 -and $n.retainedEarningsAccount.code -eq '3100') "(got $($r.Body | ConvertTo-Json -Compress -Depth 5))"
$r = Invoke-Api GET '/api/v1/fiscal-years' $null $tokenB
Check 'tenant without entries has nothing to close' ($r.Status -eq 200 -and $null -eq $r.Body.nextClosable)

$r = Invoke-Api POST '/api/v1/fiscal-years/close' @{ fiscalYearEnd = '2026-12-31' } $tokenA
Check 'closing a year that has not ended -> 400' ($r.Status -eq 400 -and $r.Body.message -eq 'The fiscal year has not ended yet') "(got $($r.Status): $($r.Body.message))"
$r = Invoke-Api POST '/api/v1/fiscal-years/close' @{ fiscalYearEnd = '2025-06-30' } $tokenA
Check 'closing a date that is not a fiscal year end -> 400' ($r.Status -eq 400)

$r = Invoke-Api POST '/api/v1/fiscal-years/close' @{ fiscalYearEnd = '2025-12-31' } $tokenA
$c = @($r.Body.closings)[0]
Check 'close FY2025 -> locked through 2025-12-31, profit 3,800' ($r.Status -eq 200 -and $r.Body.closedThrough -eq '2025-12-31' -and $c.netIncome -eq 3800 -and $c.entryNo) "(got $($r.Status): $($r.Body | ConvertTo-Json -Compress -Depth 5))"
Check 'next closable year moves to FY2026 (not ended yet)' ($r.Body.nextClosable.fiscalYearEnd -eq '2026-12-31' -and $r.Body.nextClosable.canClose -eq $false)
$closingId = $c.journalEntryId

$r = Invoke-Api GET "/api/v1/journal-entries/$closingId" $null $tokenA
$lines = @($r.Body.lines)
$byAcct = @{}; foreach ($l in $lines) { $byAcct[$l.accountId] = $l }
Check 'closing entry: kind closing, dated 2025-12-31' ($r.Body.kind -eq 'closing' -and $r.Body.entryDate -eq '2025-12-31')
Check 'closing entry: Dr sales 5,000 / Cr expense 1,200 / Cr retained earnings 3,800' ([decimal]$byAcct[$acc['4000']].debit -eq 5000 -and [decimal]$byAcct[$acc['5900']].credit -eq 1200 -and [decimal]$byAcct[$acc['3100']].credit -eq 3800 -and $lines.Count -eq 3)

$r = Invoke-Api GET '/api/v1/reports/income-statement?from=2025-01-01&to=2025-12-31' $null $tokenA
Check 'closed year keeps its income statement (closing excluded)' ($r.Body.revenue.total -eq 5000 -and $r.Body.netIncome -eq 3800) "(got $($r.Body.netIncome))"
$r = Invoke-Api GET '/api/v1/reports/balance-sheet?asOf=2025-12-31' $null $tokenA
$re = @($r.Body.equity.accounts) | Where-Object { $_.code -eq '3100' }
Check 'balance sheet at year end: profit in retained earnings, no current earnings' ($re.amount -eq 3800 -and $r.Body.equity.currentEarnings -eq 0 -and $r.Body.balanced -eq $true) "(got $($r.Body.equity | ConvertTo-Json -Compress -Depth 5))"
$r = Invoke-Api GET '/api/v1/reports/balance-sheet' $null $tokenA
Check 'balance sheet today: current earnings = 2026 profit only (7,000), still balanced' ($r.Body.equity.currentEarnings -eq 7000 -and $r.Body.balanced -eq $true) "(got $($r.Body.equity.currentEarnings))"
$r = Invoke-Api GET '/api/v1/reports/trial-balance' $null $tokenA
Check 'trial balance still balances after closing' ($r.Body.balanced -eq $true)

$r = Invoke-Api POST '/api/v1/journal-entries' @{ entryDate = '2025-12-15'
    lines = @(@{ accountId = $acc['1000']; debit = 100 }, @{ accountId = $acc['4000']; credit = 100 }) } $tokenA
Check 'posting into the closed year -> 400 Period is closed' ($r.Status -eq 400 -and $r.Body.message -eq 'Period is closed' -and $r.Body.closedThrough -eq '2025-12-31') "(got $($r.Status): $($r.Body.message))"
$r = Invoke-Api POST "/api/v1/journal-entries/$sale2025/void" $null $tokenA
Check 'voiding an entry in the closed year -> 400' ($r.Status -eq 400 -and $r.Body.message -eq 'Period is closed')
$r = Invoke-Api POST "/api/v1/journal-entries/$closingId/void" $null $tokenA
Check 'closing entries cannot be voided directly' ($r.Status -eq 400)
$r = Invoke-Api POST '/api/v1/fiscal-years/close' @{ fiscalYearEnd = '2025-12-31' } $tokenA
Check 'closing the same year again -> 409' ($r.Status -eq 409)

$r = Invoke-Api POST '/api/v1/fiscal-years/2024-12-31/reopen' $null $tokenA
Check 'reopening a year that is not the latest closed -> 400' ($r.Status -eq 400)
$r = Invoke-Api POST '/api/v1/fiscal-years/2025-12-31/reopen' $null $tokenA
Check 'reopen FY2025 -> unlocked' ($r.Status -eq 200 -and $null -eq $r.Body.closedThrough)
$r = Invoke-Api GET "/api/v1/journal-entries/$closingId" $null $tokenA
Check 'reopened closing entry is voided, not deleted' ($r.Status -eq 200 -and $r.Body.status -eq 'void')
$r = Invoke-Api POST '/api/v1/journal-entries' @{ entryDate = '2025-12-15'; description = 'late 2025 sale'
    lines = @(@{ accountId = $acc['1000']; debit = 100 }, @{ accountId = $acc['4000']; credit = 100 }) } $tokenA
Check 'posting into the reopened year works' ($r.Status -eq 201)
$r = Invoke-Api POST '/api/v1/fiscal-years/close' @{ fiscalYearEnd = '2025-12-31' } $tokenA
Check 'close again -> profit now 3,900' ($r.Status -eq 200 -and @($r.Body.closings)[0].netIncome -eq 3900 -and @($r.Body.closings).Count -eq 1)

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
$r = Invoke-Api POST '/api/v1/fiscal-years/2025-12-31/reopen' $null $tokenUser
Check 'User cannot reopen a fiscal year -> 403' ($r.Status -eq 403)
$r = Invoke-Api GET '/api/v1/fiscal-years' $null $tokenUser
Check 'User can see fiscal year status' ($r.Status -eq 200 -and $r.Body.closedThrough -eq '2025-12-31')

Write-Host "`nCompany profile"
$r = Invoke-Api GET '/api/v1/company' $null $tokenUser
Check 'any member reads the company profile (head office by default)' ($r.Status -eq 200 -and $r.Body.name -eq 'Test Company Ltd.' -and $r.Body.branchCode -eq '00000') "(got $($r.Status): $($r.Body | ConvertTo-Json -Compress))"
$r = Invoke-Api PATCH '/api/v1/company' @{ address = '123 Rama IV Rd, Bangkok 10500'; phone = '02-000-0000'; taxId = '0105561234567' } $tokenA
Check 'Admin updates address, phone and tax ID; other fields kept' ($r.Status -eq 200 -and $r.Body.address -eq '123 Rama IV Rd, Bangkok 10500' -and $r.Body.taxId -eq '0105561234567' -and $r.Body.name -eq 'Test Company Ltd.') "(got $($r.Status): $($r.Body | ConvertTo-Json -Compress))"
$r = Invoke-Api PATCH '/api/v1/company' @{ phone = '' } $tokenA
Check 'an empty field clears it' ($r.Status -eq 200 -and $null -eq $r.Body.phone -and $r.Body.address)
$r = Invoke-Api PATCH '/api/v1/company' @{ branchCode = '12' } $tokenA
Check 'invalid branch code -> 400' ($r.Status -eq 400)
$r = Invoke-Api PATCH '/api/v1/company' @{ phone = '1' } $tokenUser
Check 'User cannot edit the company profile -> 403' ($r.Status -eq 403)

Write-Host "`nCustomers"
$r = Invoke-Api POST '/api/v1/customers' @{ name = 'Good Customer Co., Ltd.'; taxId = '0105559999999'; branchCode = '00000'; address = '99/1 Sukhumvit Rd, Bangkok'; contactName = 'Somsri'; creditDays = 15 } $tokenUser
Check 'User adds a customer with 15 credit days -> 201' ($r.Status -eq 201 -and $r.Body.creditDays -eq 15) "(got $($r.Status): $($r.Body | ConvertTo-Json -Compress))"
$custId = $r.Body.id
$r = Invoke-Api POST '/api/v1/customers' @{ name = 'Walk-in'; taxId = '' } $tokenA
Check 'minimal customer: 30 credit days, empty tax ID stored as null' ($r.Status -eq 201 -and $r.Body.creditDays -eq 30 -and $null -eq $r.Body.taxId)
$walkInId = $r.Body.id
$r = Invoke-Api POST '/api/v1/customers' @{ name = 'Bad'; taxId = '123' } $tokenA
Check 'invalid tax ID -> 400' ($r.Status -eq 400)
$r = Invoke-Api PATCH "/api/v1/customers/$walkInId" @{ isActive = $false } $tokenA
Check 'deactivate a customer' ($r.Status -eq 200 -and $r.Body.isActive -eq $false -and $r.Body.name -eq 'Walk-in')
$r = Invoke-Api GET '/api/v1/customers' $null $tokenA
Check 'list hides inactive customers' ($r.Status -eq 200 -and @($r.Body).Count -eq 1)
$r = Invoke-Api GET '/api/v1/customers?includeInactive=true' $null $tokenA
Check 'includeInactive=true lists both' (@($r.Body).Count -eq 2)
$r = Invoke-Api GET "/api/v1/customers/$custId" $null $tokenB
Check "tenant B cannot read A's customer -> 404" ($r.Status -eq 404)

Write-Host "`nQuotations"
$qBody = @{
    customerId = $custId; docDate = '2026-09-10'; dueDate = '2026-10-10'; reference = 'PO-77'; discount = 1000
    lines = @(
        @{ description = 'Website design'; quantity = 1; unit = 'job'; unitPrice = 25000 },
        @{ description = 'Hosting'; quantity = 12; unit = 'month'; unitPrice = 500 }
    )
}
$r = Invoke-Api POST '/api/v1/quotations' $qBody $tokenUser
$q = $r.Body
Check 'User creates draft QT-2026-0001; issuer is the signed-in user' ($r.Status -eq 201 -and $q.docNo -eq 'QT-2026-0001' -and $q.status -eq 'draft' -and $q.createdByName -eq 'Clerk') "(got $($r.Status): $($r.Body | ConvertTo-Json -Compress -Depth 5))"
Check 'totals: 31,000 - 1,000 discount + VAT 7% 2,100 = 32,100' ($q.subtotal -eq 31000 -and $q.discount -eq 1000 -and $q.vatAmount -eq 2100 -and $q.total -eq 32100 -and @($q.lines)[1].amount -eq 6000 -and $q.vatRate -eq 7)
Check "customer's details copied onto the quotation" ($q.customer.name -eq 'Good Customer Co., Ltd.' -and $q.customer.taxId -eq '0105559999999' -and $q.customer.branchCode -eq '00000')
$qId = $q.id
$noVat = $qBody.Clone(); $noVat.vat = $false; $noVat.discount = 0
$r = Invoke-Api POST '/api/v1/quotations' $noVat $tokenA
Check 'next number QT-2026-0002; without VAT total = 31,000' ($r.Status -eq 201 -and $r.Body.docNo -eq 'QT-2026-0002' -and $r.Body.vatAmount -eq 0 -and $r.Body.total -eq 31000)
$q2Id = $r.Body.id
$bad = $qBody.Clone(); $bad.discount = 40000
$r = Invoke-Api POST '/api/v1/quotations' $bad $tokenA
Check 'discount over the subtotal -> 400' ($r.Status -eq 400 -and $r.Body.message -eq 'Discount exceeds the subtotal')
$bad = $qBody.Clone(); $bad.customerId = $walkInId
$r = Invoke-Api POST '/api/v1/quotations' $bad $tokenA
Check 'inactive customer -> 400' ($r.Status -eq 400 -and $r.Body.message -eq 'Customer is inactive')
$r = Invoke-Api POST '/api/v1/quotations' $qBody $tokenB
Check "tenant B cannot quote A's customer -> 400" ($r.Status -eq 400 -and $r.Body.message -eq 'Customer not found')
$bad = $qBody.Clone(); $bad.lines = @()
$r = Invoke-Api POST '/api/v1/quotations' $bad $tokenA
Check 'no lines -> 400' ($r.Status -eq 400)
$bad = $qBody.Clone(); $bad.dueDate = '2026-09-01'
$r = Invoke-Api POST '/api/v1/quotations' $bad $tokenA
Check 'valid-until before the date -> 400' ($r.Status -eq 400)

$edit = $qBody.Clone(); $edit.lines = @(@{ description = 'Website design'; quantity = 1; unit = 'job'; unitPrice = 30000 })
$r = Invoke-Api PUT "/api/v1/quotations/$qId" $edit $tokenUser
Check 'edit the draft: 30,000 - 1,000 + VAT 2,030 = 31,030, number kept' ($r.Status -eq 200 -and $r.Body.total -eq 31030 -and @($r.Body.lines).Count -eq 1 -and $r.Body.docNo -eq 'QT-2026-0001') "(got $($r.Status): $($r.Body.total))"
$r = Invoke-Api POST "/api/v1/quotations/$qId/status" @{ status = 'accepted' } $tokenUser
Check 'draft -> accepted is not allowed -> 400' ($r.Status -eq 400)
$r = Invoke-Api POST "/api/v1/quotations/$qId/status" @{ status = 'sent' } $tokenUser
Check 'draft -> sent' ($r.Status -eq 200 -and $r.Body.status -eq 'sent')
$r = Invoke-Api PUT "/api/v1/quotations/$qId" $edit $tokenUser
Check 'a sent quotation cannot be edited -> 400' ($r.Status -eq 400)
$r = Invoke-Api POST "/api/v1/quotations/$qId/billing-note" @{} $tokenUser
Check 'a sent (not accepted) quotation cannot be billed -> 400' ($r.Status -eq 400)
$r = Invoke-Api POST "/api/v1/quotations/$qId/status" @{ status = 'accepted' } $tokenUser
Check 'sent -> accepted' ($r.Status -eq 200 -and $r.Body.status -eq 'accepted')
$r = Invoke-Api POST "/api/v1/quotations/$q2Id/status" @{ status = 'sent' } $tokenA
$r = Invoke-Api POST "/api/v1/quotations/$q2Id/status" @{ status = 'rejected' } $tokenA
Check 'sent -> rejected' ($r.Status -eq 200 -and $r.Body.status -eq 'rejected')
$r = Invoke-Api GET '/api/v1/quotations?status=accepted' $null $tokenA
Check 'list filtered by status' ($r.Status -eq 200 -and @($r.Body).Count -eq 1 -and @($r.Body)[0].docNo -eq 'QT-2026-0001')
$r = Invoke-Api POST "/api/v1/quotations/$q2Id/void" $null $tokenUser
Check 'User cannot void a quotation -> 403' ($r.Status -eq 403)
$r = Invoke-Api POST "/api/v1/quotations/$q2Id/void" $null $tokenA
Check 'Admin voids the rejected quotation' ($r.Status -eq 200 -and $r.Body.status -eq 'void')

Write-Host "`nBilling notes"
$r = Invoke-Api POST "/api/v1/quotations/$qId/billing-note" @{ docDate = '2026-09-20' } $tokenUser
$bn = $r.Body
Check 'bill the accepted quotation: draft BN-2026-0001, due = date + 15 credit days' ($r.Status -eq 201 -and $bn.docNo -eq 'BN-2026-0001' -and $bn.status -eq 'draft' -and $bn.dueDate -eq '2026-10-05' -and $bn.total -eq 31030 -and $bn.quotation.docNo -eq 'QT-2026-0001') "(got $($r.Status): $($r.Body | ConvertTo-Json -Compress -Depth 5))"
$bnId = $bn.id
$r = Invoke-Api POST "/api/v1/quotations/$qId/billing-note" @{} $tokenUser
Check 'billing the same quotation again -> 409' ($r.Status -eq 409)
$r = Invoke-Api GET "/api/v1/quotations/$qId" $null $tokenA
Check 'quotation links to its billing note' ($r.Body.billingNote.docNo -eq 'BN-2026-0001')
$r = Invoke-Api POST "/api/v1/quotations/$qId/void" $null $tokenA
Check 'cannot void a quotation with a live billing note -> 400' ($r.Status -eq 400)

$r = Invoke-Api POST "/api/v1/billing-notes/$bnId/payment" @{ paidDate = '2026-09-28' } $tokenUser
Check 'a draft cannot be paid -> 400' ($r.Status -eq 400)
$r = Invoke-Api POST "/api/v1/billing-notes/$bnId/issue" $null $tokenUser
Check 'issue -> issued, journal entry posted' ($r.Status -eq 200 -and $r.Body.status -eq 'issued' -and $r.Body.journalEntry.entryNo -and $r.Body.revenueAccount.code -eq '4000') "(got $($r.Status): $($r.Body | ConvertTo-Json -Compress -Depth 5))"
$issueEntryId = $r.Body.journalEntry.id
$r = Invoke-Api GET "/api/v1/journal-entries/$issueEntryId" $null $tokenA
$byAcct = @{}; foreach ($l in @($r.Body.lines)) { $byAcct[$l.accountId] = $l }
Check 'issue entry: kind sales, dated the note, ref BN-2026-0001' ($r.Body.kind -eq 'sales' -and $r.Body.entryDate -eq '2026-09-20' -and $r.Body.reference -eq 'BN-2026-0001')
Check 'issue entry: Dr AR 31,030 / Cr sales 29,000 / Cr output VAT 2,030' ([decimal]$byAcct[$acc['1100']].debit -eq 31030 -and [decimal]$byAcct[$acc['4000']].credit -eq 29000 -and [decimal]$byAcct[$acc['2100']].credit -eq 2030)
$r = Invoke-Api POST "/api/v1/journal-entries/$issueEntryId/void" $null $tokenA
Check 'billing note entries cannot be voided from the journal -> 400' ($r.Status -eq 400)
$r = Invoke-Api POST "/api/v1/billing-notes/$bnId/issue" $null $tokenUser
Check 'issuing twice -> 400' ($r.Status -eq 400)
$r = Invoke-Api POST "/api/v1/billing-notes/$bnId/payment" @{ paidDate = '2026-09-19' } $tokenUser
Check 'payment dated before the note -> 400' ($r.Status -eq 400)
$r = Invoke-Api POST "/api/v1/billing-notes/$bnId/payment" @{ paidDate = '2026-09-28'; accountId = $acc['4000'] } $tokenUser
Check 'payment into a non-asset account -> 400' ($r.Status -eq 400)
$r = Invoke-Api POST "/api/v1/billing-notes/$bnId/payment" @{ paidDate = '2026-09-28' } $tokenUser
Check 'receive payment -> paid into 1010 by default' ($r.Status -eq 200 -and $r.Body.status -eq 'paid' -and $r.Body.paidDate -eq '2026-09-28' -and $r.Body.paymentAccount.code -eq '1010') "(got $($r.Status): $($r.Body | ConvertTo-Json -Compress -Depth 5))"
$r = Invoke-Api GET "/api/v1/journal-entries/$($r.Body.paymentJournalEntry.id)" $null $tokenA
$byAcct = @{}; foreach ($l in @($r.Body.lines)) { $byAcct[$l.accountId] = $l }
Check 'payment entry: Dr bank 31,030 / Cr AR 31,030 on the payment date' ($r.Body.kind -eq 'sales' -and $r.Body.entryDate -eq '2026-09-28' -and [decimal]$byAcct[$acc['1010']].debit -eq 31030 -and [decimal]$byAcct[$acc['1100']].credit -eq 31030)
$r = Invoke-Api GET '/api/v1/reports/trial-balance' $null $tokenA
$ar = @($r.Body.accounts) | Where-Object { $_.code -eq '1100' }
Check 'trial balance balanced; AR back to zero' ($r.Body.balanced -eq $true -and $null -eq $ar) "(got $($ar | ConvertTo-Json -Compress))"
$r = Invoke-Api POST "/api/v1/billing-notes/$bnId/void" $null $tokenA
Check 'a paid billing note cannot be voided -> 400' ($r.Status -eq 400)

$standalone = @{ customerId = $custId; docDate = '2025-06-01'; vat = $false; revenueAccountId = $acc['4100']
    lines = @(@{ description = 'Consulting'; quantity = 2.5; unit = 'hour'; unitPrice = 1000 }) }
$r = Invoke-Api POST '/api/v1/billing-notes' $standalone $tokenUser
Check 'standalone billing note (no quotation): BN-2025-0001, 2,500 without VAT' ($r.Status -eq 201 -and $r.Body.docNo -eq 'BN-2025-0001' -and $r.Body.total -eq 2500 -and $null -eq $r.Body.quotation -and $r.Body.revenueAccount.code -eq '4100') "(got $($r.Status): $($r.Body | ConvertTo-Json -Compress -Depth 5))"
$bn2Id = $r.Body.id
$r = Invoke-Api POST "/api/v1/billing-notes/$bn2Id/issue" $null $tokenUser
Check 'issuing into the closed year -> 400 Period is closed' ($r.Status -eq 400 -and $r.Body.message -eq 'Period is closed')
$standalone.docDate = '2026-09-21'
$r = Invoke-Api PUT "/api/v1/billing-notes/$bn2Id" $standalone $tokenUser
Check 'redate the draft (number kept), then issue' ($r.Status -eq 200 -and $r.Body.docNo -eq 'BN-2025-0001' -and (Invoke-Api POST "/api/v1/billing-notes/$bn2Id/issue" $null $tokenUser).Status -eq 200)
$r = Invoke-Api GET '/api/v1/billing-notes?status=issued' $null $tokenA
Check 'list issued billing notes' ($r.Status -eq 200 -and @($r.Body).Count -eq 1 -and @($r.Body)[0].id -eq $bn2Id)
$r = Invoke-Api POST "/api/v1/billing-notes/$bn2Id/void" $null $tokenUser
Check 'User cannot void a billing note -> 403' ($r.Status -eq 403)
$r = Invoke-Api POST "/api/v1/billing-notes/$bn2Id/void" $null $tokenA
$voidEntry = $r.Body.journalEntry.id
Check 'Admin voids the issued note' ($r.Status -eq 200 -and $r.Body.status -eq 'void')
$r = Invoke-Api GET "/api/v1/journal-entries/$voidEntry" $null $tokenA
Check "the voided note's journal entry is void too" ($r.Body.status -eq 'void')
$r = Invoke-Api GET "/api/v1/billing-notes/$bnId" $null $tokenB
Check "tenant B cannot read A's billing note -> 404" ($r.Status -eq 404)

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

Write-Host "`nBilling: plans, checkout, payment gateway"
$r = Invoke-Api GET '/api/v1/billing/status' $null $tokenUser
Check 'any member sees billing status: trialing starter' ($r.Status -eq 200 -and $r.Body.status -eq 'trialing' -and $r.Body.readOnly -eq $false -and $r.Body.plan.code -eq 'starter') "(got $($r.Body | ConvertTo-Json -Compress))"
$r = Invoke-Api GET '/api/v1/billing' $null $tokenUser
Check 'User cannot open billing overview -> 403' ($r.Status -eq 403)
$r = Invoke-Api GET '/api/v1/billing' $null $tokenA
$gateway = $r.Body.gateway.provider
Write-Host "  (payment gateway: $gateway)"
$pro = @($r.Body.plans) | Where-Object { $_.code -eq 'pro' }
Check 'overview lists 3 plans, VAT 7%' ($r.Status -eq 200 -and @($r.Body.plans).Count -eq 3 -and $r.Body.vatRate -eq 7)
Check 'Pro = 790 + VAT 55.30 = 845.30' ($pro.priceMonthly -eq 790 -and $pro.vatAmount -eq 55.3 -and $pro.total -eq 845.3) "(got $($pro | ConvertTo-Json -Compress))"

# Finishes the pending charge of a checkout the way the active gateway allows: the mock gateway's
# callback, or (Omise) the test-mode simulate endpoint, which goes through Omise's mark_as_paid/failed.
function Complete-Payment($Checkout, [string]$Outcome) {
    if ($gateway -eq 'mock') {
        Invoke-Api POST "/api/v1/billing/mock/charges/$($Checkout.chargeId)/complete" @{ outcome = $Outcome; failureMessage = 'Card declined' } | Out-Null
    } else {
        Invoke-Api POST "/api/v1/billing/invoices/$($Checkout.invoiceId)/simulate" @{ outcome = $Outcome } $tokenA | Out-Null
    }
}

$r = Invoke-Api POST '/api/v1/billing/checkout' @{ planCode = 'gold' } $tokenA
Check 'unknown plan -> 400' ($r.Status -eq 400)
$r = Invoke-Api POST '/api/v1/billing/checkout' @{ planCode = 'pro' } $tokenUser
Check 'User cannot check out -> 403' ($r.Status -eq 403)

$r = Invoke-Api POST '/api/v1/billing/checkout' @{ planCode = 'pro' } $tokenA
$checkout1 = $r.Body
Check 'checkout Pro -> invoice INV-000001 for 845.30 with a charge id' ($r.Status -eq 201 -and $r.Body.invoiceNo -eq 'INV-000001' -and $r.Body.amount -eq 845.3 -and $r.Body.chargeId) "(got $($r.Body | ConvertTo-Json -Compress))"
if ($gateway -eq 'mock') {
    Check 'mock: customer is redirected to the hosted page' ($r.Body.payment.type -eq 'redirect' -and $r.Body.redirectUrl -match '/billing/mock-checkout/mock_chrg_')
    $r = Invoke-Api GET "/api/v1/billing/mock/charges/$($checkout1.chargeId)"
    Check 'mock gateway shows the charge amount' ($r.Status -eq 200 -and $r.Body.amount -eq 845.3 -and $r.Body.status -eq 'pending')
    $r = Invoke-Api GET '/api/v1/billing/mock/charges/mock_chrg_doesnotexist'
    Check 'unknown charge -> 404' ($r.Status -eq 404)
} else {
    Check 'omise: PromptPay QR returned' ($r.Body.payment.type -eq 'qr' -and $r.Body.payment.imageUrl -and $r.Body.chargeId -match '^chrg_')
    $qr = Invoke-WebRequest -Uri $r.Body.payment.imageUrl -UseBasicParsing
    Check 'omise: QR image is downloadable' ($qr.StatusCode -eq 200)
    $r = Invoke-Api GET '/api/v1/billing' $null $tokenA
    Check 'omise: open invoice keeps its QR for a page reload' ($r.Body.invoices[0].paymentAction.type -eq 'qr')
    $r = Invoke-Api POST "/api/v1/billing/invoices/$($checkout1.invoiceId)/refresh" $null $tokenA
    Check 'omise: refresh while unpaid -> still pending' ($r.Status -eq 200 -and $r.Body.paymentStatus -eq 'pending' -and $r.Body.invoiceStatus -eq 'open')
    # A forged "paid" event: the API re-reads the charge from Omise, which still says pending.
    $forged = @{ object = 'event'; key = 'charge.complete'; data = @{ object = 'charge'; id = $checkout1.chargeId; status = 'successful' } }
    $r = Invoke-Api POST '/api/v1/billing/webhooks/omise' $forged
    Check 'omise: forged webhook does not mark anything paid' ($r.Status -eq 200 -and $r.Body.status -eq 'pending')
    $r = Invoke-Api POST '/api/v1/billing/webhooks/omise' @{ object = 'event'; key = 'charge.complete'; data = @{ object = 'charge'; id = 'chrg_test_unknown' } }
    Check 'omise: webhook for an unknown charge is acknowledged and ignored' ($r.Status -eq 200 -and $r.Body.handled -eq $false)
}

Complete-Payment $checkout1 'failed'
$r = Invoke-Api GET '/api/v1/billing' $null $tokenA
Check 'after a declined payment: still trialing, invoice open, payment failed' ($r.Body.status -eq 'trialing' -and $r.Body.invoices[0].status -eq 'open' -and $r.Body.invoices[0].paymentStatus -eq 'failed')

$r = Invoke-Api POST '/api/v1/billing/checkout' @{ planCode = 'pro' } $tokenA
$checkout2 = $r.Body
Check 'retry checkout -> INV-000002' ($r.Body.invoiceNo -eq 'INV-000002')
Complete-Payment $checkout2 'succeeded'
$r = Invoke-Api GET '/api/v1/billing' $null $tokenA
Check 'successful payment -> INV-000002 paid' (($r.Body.invoices | Where-Object { $_.invoiceNo -eq 'INV-000002' }).paymentStatus -eq 'succeeded')
# Providers retry webhooks: settling the same charge again must change nothing.
if ($gateway -eq 'mock') {
    $r = Invoke-Api POST "/api/v1/billing/mock/charges/$($checkout2.chargeId)/complete" @{ outcome = 'succeeded' }
    Check 'repeated webhook is idempotent' ($r.Status -eq 200 -and $r.Body.alreadySettled -eq $true)
} else {
    $r = Invoke-Api POST '/api/v1/billing/webhooks/omise' @{ object = 'event'; key = 'charge.complete'; data = @{ object = 'charge'; id = $checkout2.chargeId } }
    Check 'repeated webhook is idempotent' ($r.Status -eq 200 -and $r.Body.status -eq 'succeeded')
    $r = Invoke-Api POST "/api/v1/billing/invoices/$($checkout2.invoiceId)/simulate" @{ outcome = 'succeeded' } $tokenA
    Check 'omise: simulating an already paid charge -> 409' ($r.Status -eq 409)
}

$r = Invoke-Api GET '/api/v1/billing' $null $tokenA
$periodEnd = [datetime]$r.Body.currentPeriodEnd
Check 'subscription active on Pro' ($r.Body.status -eq 'active' -and $r.Body.plan.code -eq 'pro' -and $r.Body.readOnly -eq $false)
Check 'period ends in ~1 month' (($periodEnd - (Get-Date)).TotalDays -gt 27 -and ($periodEnd - (Get-Date)).TotalDays -lt 32) "(got $periodEnd)"
Check 'INV-000002 paid, INV-000001 voided' (($r.Body.invoices | Where-Object { $_.invoiceNo -eq 'INV-000002' }).status -eq 'paid' -and ($r.Body.invoices | Where-Object { $_.invoiceNo -eq 'INV-000001' }).status -eq 'void')

$r = Invoke-Api POST '/api/v1/billing/checkout' @{ planCode = 'pro' } $tokenA
Complete-Payment $r.Body 'succeeded'
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
    Complete-Payment $r.Body 'succeeded'
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

Write-Host "`nLogin lockout (per account)"
# Tenant B's admin has no failed logins yet (the clerk's deactivated-login attempt above already counted as one).
$badLogin = @{ email = 'admin2@another.com'; password = 'WrongPass!'; tenantId = $tenantB }
$codes = 1..5 | ForEach-Object { (Invoke-Api POST '/api/v1/auth/login' $badLogin).Status }
Check '5 wrong passwords -> 401 each' (($codes | Where-Object { $_ -eq 401 }).Count -eq 5) "(got $($codes -join ','))"
$r = Invoke-Api POST '/api/v1/auth/login' @{ email = 'admin2@another.com'; password = 'SecurePass456'; tenantId = $tenantB }
Check 'locked: even the right password -> 429 with retryAfter' ($r.Status -eq 429 -and $r.Body.message -eq 'Too many failed login attempts' -and $r.Body.retryAfter -gt 800) "(got $($r.Status): $($r.Body | ConvertTo-Json -Compress))"
$r = Invoke-Api POST '/api/v1/auth/login' @{ email = 'admin@testcompany.com'; password = 'SecurePass123'; tenantId = $tenantA }
Check 'other accounts are unaffected' ($r.Status -eq 200)
$r = Invoke-Api GET '/api/v1/accounts' $null $tokenB
Check "the locked user's existing session still works" ($r.Status -eq 200)
$ghost = @{ email = 'nobody@testcompany.com'; password = 'x'; tenantId = $tenantA }
$codes = 1..6 | ForEach-Object { (Invoke-Api POST '/api/v1/auth/login' $ghost).Status }
Check 'unknown emails lock the same way (no account enumeration)' (($codes -join ',') -eq '401,401,401,401,401,429') "(got $($codes -join ','))"

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
