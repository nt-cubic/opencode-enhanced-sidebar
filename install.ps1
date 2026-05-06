# OpenCode Enhanced Sidebar - Windows Installer
# Run with: powershell -ExecutionPolicy Bypass -File install.ps1

param([switch]$Force)

$ErrorActionPreference = "Stop"
$opencodeDir = "$env:USERPROFILE\.config\opencode"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "=== OpenCode Enhanced Sidebar Installer ===" -ForegroundColor Cyan
Write-Host ""

# Create opencode config directory
if (!(Test-Path $opencodeDir)) {
    New-Item -ItemType Directory -Path $opencodeDir -Force | Out-Null
    Write-Host "[OK] Created $opencodeDir"
}

# Copy plugin files
Write-Host "Copying plugin files..."
Copy-Item "$scriptRoot\src\rounds-plugin.tsx" "$opencodeDir\rounds-plugin.tsx" -Force
Copy-Item "$scriptRoot\src\tool-tracker.tsx" "$opencodeDir\tool-tracker.tsx" -Force
Write-Host "  [OK] round-plugin.tsx -> $opencodeDir"
Write-Host "  [OK] tool-tracker.tsx -> $opencodeDir"

# Install npm dependencies
Write-Host "Installing dependencies..."
Push-Location $opencodeDir
try {
    npm install solid-js @opentui/solid --save 2>$null
    Write-Host "  [OK] npm dependencies installed"
} catch {
    Write-Host "  [WARN] npm install had issues, but opencode may auto-install on restart"
} finally {
    Pop-Location
}

# Merge tui.json config
$tuiFile = Join-Path $opencodeDir "tui.json"
$tuiContent = '{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["./rounds-plugin.tsx"]
}'
if (Test-Path $tuiFile) {
    Write-Host "  [INFO] tui.json already exists. Add './rounds-plugin.tsx' to the 'plugin' array manually if not present."
} else {
    Set-Content -Path $tuiFile -Value $tuiContent -Encoding UTF8
    Write-Host "  [OK] Created tui.json"
}

# Merge opencode.jsonc config
$opencodeFile = Join-Path $opencodeDir "opencode.jsonc"
$ocContent = @'
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["./tool-tracker.tsx"]
}
'@
if (Test-Path $opencodeFile) {
    Write-Host "  [INFO] opencode.jsonc already exists. Add './tool-tracker.tsx' to the 'plugin' array manually if not present."
} else {
    Set-Content -Path $opencodeFile -Value $ocContent -Encoding UTF8
    Write-Host "  [OK] Created opencode.jsonc"
}

Write-Host ""
Write-Host "=== Installation Complete ===" -ForegroundColor Green
Write-Host "Restart OpenCode to see the enhanced sidebar."
Write-Host ""
Write-Host "Files installed:"
Write-Host "  $opencodeDir\rounds-plugin.tsx"
Write-Host "  $opencodeDir\tool-tracker.tsx"
Write-Host "  $opencodeDir\tui.json"
Write-Host "  $opencodeDir\opencode.jsonc"
