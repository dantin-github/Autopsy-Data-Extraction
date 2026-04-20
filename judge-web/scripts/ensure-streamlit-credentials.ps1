# One-time: create %USERPROFILE%\.streamlit\credentials.toml with a blank email so
# `streamlit run` never blocks on the terminal prompt (even if CWD is wrong).
# Safe to run multiple times (overwrites with the same content).

$ErrorActionPreference = "Stop"
$dir = Join-Path $env:USERPROFILE ".streamlit"
$path = Join-Path $dir "credentials.toml"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
@'
[general]
email = ""
'@ | Set-Content -Path $path -Encoding utf8
Write-Host "Wrote $path"
