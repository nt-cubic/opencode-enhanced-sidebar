# OpenCode Enhanced Sidebar - Windows Installer (OpenCode V2)
# Run with: powershell -ExecutionPolicy Bypass -File install.ps1

param([switch]$Force)

$ErrorActionPreference = "Stop"
$pluginName = "enhanced-sidebar"
$opencodeDir = "$env:USERPROFILE\.config\opencode"
$pluginsDir = Join-Path $opencodeDir "plugins"
$target = Join-Path $pluginsDir $pluginName
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $scriptRoot "plugins\$pluginName"

Write-Host "=== OpenCode Enhanced Sidebar Installer (V2) ===" -ForegroundColor Cyan
Write-Host ""

if (!(Test-Path (Join-Path $source "tui.tsx"))) {
    throw "Plugin source not found: $source\tui.tsx"
}

# Install the plugin directory. OpenCode V2 discovers <config>/plugins/<name>/tui.tsx
# automatically, so no opencode.jsonc / cli.json entry is required.
if (Test-Path (Join-Path $target "tui.tsx")) {
    $installed = Get-Item (Join-Path $target "tui.tsx")
    Write-Host "[INFO] Replacing existing install from $($installed.LastWriteTime)"
}
New-Item -ItemType Directory -Path $target -Force | Out-Null
Get-ChildItem -Path $source -File | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $target $_.Name) -Force
}
Write-Host "[OK] Installed plugin -> $target"

# Disable leftover V1 plugin files so V2 stops warning about them.
foreach ($legacy in @("rounds-plugin.tsx", "tool-tracker.tsx")) {
    $legacyPath = Join-Path $opencodeDir $legacy
    if (Test-Path $legacyPath) {
        $backup = "$legacyPath.v1-backup"
        Move-Item -Path $legacyPath -Destination $backup -Force
        Write-Host "[OK] Disabled legacy V1 plugin: $legacy -> $legacy.v1-backup"
    }
}

# Remove stale plugin entries that pointed at the V1 files. The rest of each
# config file (comments, unrelated entries) is preserved; only the exact
# quoted entry strings are removed.
function Remove-ConfigEntry {
    param([string]$File, [string]$Entry, [string]$Label)
    if (!(Test-Path $File)) { return }
    $text = Get-Content $File -Raw
    if (!$text.Contains($Entry)) { return }
    $quoted = [regex]::Escape('"' + $Entry + '"')
    if ($text -match (',\s*' + $quoted)) {
        $text = $text -replace (',\s*' + $quoted), ""
    } elseif ($text -match ($quoted + '\s*,')) {
        $text = $text -replace ($quoted + '\s*,'), ""
    } else {
        $text = $text -replace $quoted, ""
    }
    Set-Content -Path $File -Value $text -NoNewline -Encoding UTF8
    Write-Host "[OK] Removed stale entry '$Entry' from $Label"
}

Remove-ConfigEntry -File (Join-Path $opencodeDir "cli.json") -Entry "./rounds-plugin.tsx" -Label "cli.json"
Remove-ConfigEntry -File (Join-Path $opencodeDir "opencode.jsonc") -Entry "./tool-tracker.tsx" -Label "opencode.jsonc"
Remove-ConfigEntry -File (Join-Path $opencodeDir "opencode.json") -Entry "./tool-tracker.tsx" -Label "opencode.json"

Write-Host ""
Write-Host "=== Installation Complete ===" -ForegroundColor Green
Write-Host "Restart OpenCode to see the enhanced sidebar."
Write-Host ""
Write-Host "Installed files:"
Get-ChildItem -Path $target -File | ForEach-Object { Write-Host "  $($_.FullName)" }
Write-Host ""
Write-Host "No configuration entry is needed: OpenCode V2 auto-discovers plugins under"
Write-Host "$pluginsDir"
