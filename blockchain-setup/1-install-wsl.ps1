# FISCO BCOS - Step 1: Install WSL
# Run as Administrator: Right-click -> Run as administrator
# Restart PC after execution, then run 2-setup-fisco.sh

Write-Host "=== FISCO BCOS - Install WSL ===" -ForegroundColor Cyan
Write-Host ""

$wslCheck = wsl -l -v 2>&1
if ($LASTEXITCODE -eq 0 -and $wslCheck -notmatch "not installed") {
    Write-Host "[OK] WSL is already installed" -ForegroundColor Green
    wsl -l -v
    Write-Host ""
    Write-Host "Run in WSL: bash 2-setup-fisco.sh" -ForegroundColor Yellow
    exit 0
}

Write-Host "Enabling WSL and Virtual Machine Platform..." -ForegroundColor Yellow
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart

Write-Host ""
Write-Host "=== IMPORTANT: Restart your PC ===" -ForegroundColor Red
Write-Host "After restart:" -ForegroundColor Yellow
Write-Host "1. Open Microsoft Store, install Ubuntu 20.04 LTS" -ForegroundColor White
Write-Host "2. Launch Ubuntu, set username and password" -ForegroundColor White
Write-Host "3. Run: wsl bash ./2-setup-fisco.sh" -ForegroundColor White
Write-Host ""
Write-Host 'Or type \\wsl$ in Explorer address bar to access WSL files' -ForegroundColor Gray
Write-Host ""
