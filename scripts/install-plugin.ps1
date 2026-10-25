param(
  [switch]$NoRobloxInstall,
  [string]$SourcePath
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $SourcePath) { $SourcePath = Join-Path $root "studio\\OpenStudioPlugin.rbxmx" }

if (-not (Test-Path $SourcePath)) {
  Write-Error "Plugin file not found: $SourcePath"
  Write-Host "Run 'npm run build' first or pass -SourcePath."
  exit 1
}

Write-Host "[OpenStudio] Source plugin: $SourcePath"

if (-not $NoRobloxInstall) {
  $pluginsDir = Join-Path $env:LOCALAPPDATA "Roblox\\Plugins"
  New-Item -ItemType Directory -Force -Path $pluginsDir | Out-Null
  $destination = Join-Path $pluginsDir "OpenStudioPlugin.rbxmx"
  Copy-Item -Path $SourcePath -Destination $destination -Force
  Write-Host "[OpenStudio] Copied plugin to: $destination"
  Write-Host "[OpenStudio] Roblox Studio will load it after you restart Studio or create a new plugin window."
} else {
  Write-Host "[OpenStudio] Skipping Roblox plugin installation."
}

Write-Host ""
Write-Host "[OpenStudio] Next steps:"
Write-Host "1. Open Roblox Studio and start OpenCode with OpenStudio MCP configured."
Write-Host "2. Run openstudio_connect from OpenCode."
Write-Host "3. Verify with openstudio_status."
exit 0