# E2E: gen bodies -> police /login -> paste OTP -> /api/upload -> judge /login -> /api/query
# Prereq: gateway running (npm run dev). OTP from gateway log if MAIL_DRY_RUN=1, else email.
# Upload needs chain (fisco-config + gateway.pem) or /api/upload returns 503.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host '== 1) Generate e2e-upload-body.json and e2e-query-body.json ==' -ForegroundColor Cyan
node scripts/gen-e2e-upload-body.js
$q = Get-Content -Raw .\e2e-query-body.json | ConvertFrom-Json
$caseId = $q.caseId
Write-Host "caseId = $caseId`n"

Write-Host '== 2) POST /login (officer1, pwd from users.example.json) ==' -ForegroundColor Cyan
Set-Content -Path login-police-body.json -Value '{"username":"officer1","password":"1"}' -Encoding utf8
curl.exe -sS -X POST 'http://localhost:3000/login' `
  -H 'Content-Type: application/json' `
  -H 'Accept: application/json' `
  --data-binary '@login-police-body.json'
Write-Host "`n"

$otp = Read-Host 'Paste OTP (16 hex chars from mail or gateway log)'
if ([string]::IsNullOrWhiteSpace($otp)) {
  throw 'OTP empty; aborted.'
}

Write-Host "`n== 3) POST /api/upload ==" -ForegroundColor Cyan
curl.exe -sS -D - -X POST 'http://localhost:3000/api/upload' `
  -H 'Content-Type: application/json' `
  -H "X-Auth-Token: $otp" `
  --data-binary '@e2e-upload-body.json'
Write-Host "`n"

Write-Host '== 4) POST /login (judge) -> judge-cookies.txt ==' -ForegroundColor Cyan
Set-Content -Path login-judge-body.json -Value '{"username":"judge1","password":"1"}' -Encoding utf8
curl.exe -c judge-cookies.txt -sS -X POST 'http://localhost:3000/login' `
  -H 'Content-Type: application/json' `
  -H 'Accept: application/json' `
  --data-binary '@login-judge-body.json'
Write-Host "`n"

Write-Host "== 5) POST /api/query caseId=$caseId ==" -ForegroundColor Cyan
curl.exe -sS -b judge-cookies.txt -X POST 'http://localhost:3000/api/query' `
  -H 'Content-Type: application/json' `
  --data-binary '@e2e-query-body.json'
Write-Host "`n"
Write-Host 'Done. If integrity.recordHashMatch is false, check chain config and insert ok.' -ForegroundColor Yellow
