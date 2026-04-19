# S3.7 smoke — same as: npm run smoke
Set-Location $PSScriptRoot\..
npm run smoke
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
