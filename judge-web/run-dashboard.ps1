# Run the Judge Web dashboard from the correct folder so .streamlit/config.toml applies.
# Uses `python -m streamlit` so it works when the `streamlit` exe is not on PATH (common on Windows).
# Usage: .\run-dashboard.ps1
# Optional: .\run-dashboard.ps1 -Port 8502

param(
    [int]$Port = 8501
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
python -m streamlit run app.py --server.port $Port
