$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $scriptDir "..")
$dist = Join-Path $root "dist\index.js"
$pluginSource = Join-Path $root "studio\OpenStudioPlugin.rbxmx"
$pluginsDir = Join-Path $env:LOCALAPPDATA "Roblox\Plugins"
$pluginDestination = Join-Path $pluginsDir "OpenStudioPlugin.rbxmx"

function Write-Status($message) { Write-Host "[OpenStudio] $message" }

function Add-NodeToPath {
  foreach ($candidate in @("C:\Program Files\nodejs", "C:\Program Files (x86)\nodejs")) {
    if ((Test-Path (Join-Path $candidate "node.exe")) -and -not ($env:Path -split ';' | Where-Object { $_ -eq $candidate })) {
      $env:Path = "$candidate;$env:Path"
    }
  }
}

function Test-Node {
  Add-NodeToPath
  return $null -ne (Get-Command node -ErrorAction SilentlyContinue)
}

function Install-Node {
  Write-Status "Node.js was not found. Attempting installation..."
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
    Add-NodeToPath
    if (Test-Node) { return }
  }
  $index = (Invoke-WebRequest -Uri "https://nodejs.org/dist/latest/" -UseBasicParsing).Content
  $match = [regex]::Match($index, 'node-v[0-9]+\.[0-9]+\.[0-9]+-x64\.msi')
  if (-not $match.Success) { throw "Could not resolve Node.js installer URL." }
  $installerName = $match.Value
  $installerUrl = "https://nodejs.org/dist/latest/$installerName"
  $tempPath = Join-Path $env:TEMP $installerName
  Invoke-WebRequest -Uri $installerUrl -OutFile $tempPath -UseBasicParsing
  $msi = Start-Process -FilePath "msiexec.exe" -ArgumentList "/i `"$tempPath`" /qn /norestart" -Wait -PassThru
  if ($msi.ExitCode -ne 0 -and $msi.ExitCode -ne 3010) { throw "Node.js installer failed with exit code $($msi.ExitCode)." }
  Add-NodeToPath
  if (-not (Test-Node)) { throw "Node.js installation did not make node.exe available." }
}

function Ensure-RobloxPlugin {
  if (-not (Test-Path $pluginSource)) {
    Write-Warning "[OpenStudio] Plugin source not found: $pluginSource"
    return
  }
  New-Item -ItemType Directory -Force -Path $pluginsDir | Out-Null
  Copy-Item -Path $pluginSource -Destination $pluginDestination -Force
}

function Find-OpenCodeExecutable {
  $command = Get-Command opencode -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\OpenCode\OpenCode.exe"),
    (Join-Path $env:LOCALAPPDATA "OpenCode\OpenCode.exe"),
    (Join-Path $env:ProgramFiles "OpenCode\OpenCode.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "OpenCode\OpenCode.exe")
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
}

function Find-RobloxStudioExecutable {
  $candidates = @()
  $candidates += Get-ChildItem -Path "$env:LOCALAPPDATA\Roblox\Versions" -Recurse -Filter "RobloxStudioBeta.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending
  $candidates += Get-ChildItem -Path "C:\Program Files\Roblox", "C:\Program Files (x86)\Roblox" -Recurse -Filter "RobloxStudioBeta.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending
  return $candidates | Select-Object -First 1
}

function Find-StudioWindow {
  return Get-Process | Where-Object {
    $_.MainWindowHandle -ne 0 -and (
      $_.ProcessName -in @("RobloxStudio", "RobloxStudioBeta") -or
      $_.MainWindowTitle -match "Roblox Studio"
    )
  } | Select-Object -First 1
}

if (-not (Test-Path $dist)) {
  Write-Error "[OpenStudio] Build output not found: $dist"
  exit 1
}

Ensure-RobloxPlugin

if ($env:OPENSTUDIO_SKIP_CHECKS -ne "1") {
  $node = Get-Command node -ErrorAction SilentlyContinue
  Add-NodeToPath
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    try { Install-Node } catch {
      Write-Error "[OpenStudio] Node.js could not be installed automatically: $($_.Exception.Message)"
      exit 1
    }
  } else {
    Write-Host "[OpenStudio] Node.js found."
  }

  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Error "[OpenStudio] Node.js is still unavailable after installation."
    exit 1
  }

  $listeners = Get-NetTCPConnection -LocalPort 3777 -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -match "node") {
      Write-Host "[OpenStudio] Stopping stale Node bridge process $($proc.Id)..."
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 1
    } elseif ($proc) {
      Write-Error "[OpenStudio] Port 3777 is in use by $($proc.ProcessName) (PID $($proc.Id)). Stop it and retry."
      exit 1
    }
  }
  Start-Sleep -Seconds 1

  $portStillInUse = $false
  try {
    $client = New-Object System.Net.Sockets.TcpClient("127.0.0.1", 3777)
    $client.Close()
    $portStillInUse = $true
  } catch {
    $portStillInUse = $false
  }
  if ($portStillInUse) {
    Write-Error "[OpenStudio] Port 3777 is still in use. Please retry after closing stale processes."
    exit 1
  }

  $opencode = Get-Process | Where-Object { $_.ProcessName -match "opencode|OpenCode" }
  if (-not $opencode) {
    $ocExecutable = Find-OpenCodeExecutable
    if ($ocExecutable) {
      Write-Host "[OpenStudio] OpenCode was not running. Starting it..."
      Start-Process -FilePath $ocExecutable -WindowStyle Hidden
      Start-Sleep -Seconds 8
      $opencode = Get-Process | Where-Object { $_.ProcessName -match "opencode|OpenCode" }
    }
  }
  if (-not $opencode) {
    Write-Error "[OpenStudio] OpenCode could not be started automatically. Start OpenCode and retry."
    exit 1
  }
  Write-Host "[OpenStudio] OpenCode detected."

  $studio = Find-StudioWindow
  if (-not $studio) {
    $studioExe = Find-RobloxStudioExecutable
    if ($studioExe) {
      Write-Host "[OpenStudio] Roblox Studio was not running. Starting it..."
      Start-Process -FilePath $studioExe.FullName
      for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 1
        $studio = Find-StudioWindow
        if ($studio) { break }
      }
    }
  }
  if (-not $studio) {
    Write-Error "[OpenStudio] Roblox Studio could not be started or detected automatically. Start Studio and retry."
    exit 1
  }
  Write-Host "[OpenStudio] Roblox Studio detected."
}

Write-Host "[OpenStudio] Starting bridge..."
& node $dist @args
exit $LASTEXITCODE
PY