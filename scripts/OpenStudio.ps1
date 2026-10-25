$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $scriptDir "..")
$dist = Join-Path $root "dist\index.js"

function Add-NodeToPath {
  foreach ($candidate in @("C:\Program Files\nodejs", "C:\Program Files (x86)\nodejs")) {
    if ((Test-Path (Join-Path $candidate "node.exe")) -and -not ($env:Path -split ';' | Where-Object { $_ -eq $candidate })) {
      $env:Path = "$candidate;$env:Path"
    }
  }
}

function Test-Node {
  Add-NodeToPath
  $node = Get-Command node -ErrorAction SilentlyContinue
  return $null -ne $node
}

function Install-Node {
  Write-Host "[OpenStudio] Node.js was not found. Attempting installation..."

  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Host "[OpenStudio] Using winget..."
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements | Out-Host
    Add-NodeToPath
    if (Test-Node) { return }
  }

  Write-Host "[OpenStudio] Downloading Node.js LTS installer..."
  $indexUrl = "https://nodejs.org/dist/latest/"
  $index = (Invoke-WebRequest -Uri $indexUrl -UseBasicParsing).Content
  $match = [regex]::Match($index, 'node-v[0-9]+\.[0-9]+\.[0-9]+-x64\.msi')
  if (-not $match.Success) { throw "Could not resolve Node.js installer URL." }
  $installerName = $match.Value
  $installerUrl = "https://nodejs.org/dist/latest/$installerName"
  $tempPath = Join-Path $env:TEMP $installerName
  Invoke-WebRequest -Uri $installerUrl -OutFile $tempPath -UseBasicParsing
  Write-Host "[OpenStudio] Installing Node.js..."
  $msi = Start-Process -FilePath "msiexec.exe" -ArgumentList "/i `"$tempPath`" /qn /norestart" -Wait -PassThru
  if ($msi.ExitCode -ne 0 -and $msi.ExitCode -ne 3010) { throw "Node.js installer failed with exit code $($msi.ExitCode)." }
  Add-NodeToPath
  if (-not (Test-Node)) { throw "Node.js installation did not make node.exe available." }
}

if (-not (Test-Path $dist)) {
  Write-Error "[OpenStudio] Build output not found. Run 'npm run build' first."
  exit 1
}

if ($env:OPENSTUDIO_SKIP_CHECKS -ne "1") {
  if (-not (Test-Node)) {
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

  # Clear a stale OpenStudio bridge if one is listening on the default port.
  $listeners = Get-NetTCPConnection -LocalPort 3777 -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($proc) {
      if ($proc.ProcessName -match "node") {
        Write-Host "[OpenStudio] Stopping stale Node bridge process $($proc.Id)..."
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      } else {
        Write-Error "[OpenStudio] Port 3777 is in use by $($proc.ProcessName) (PID $($proc.Id)). Stop it and retry."
        exit 1
      }
    }
  }
  Start-Sleep -Seconds 1

  $healthToken = $env:OPENSTUDIO_TOKEN
  if ([string]::IsNullOrWhiteSpace($healthToken)) { $healthToken = 'openstudio-local-dev-token' }

  $healthOk = $false
  try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3777/health' -Headers @{ 'X-OpenStudio-Token' = $healthToken } -TimeoutSec 2 -UseBasicParsing
    if ($response.Content -like '*"bridge"*running*') { $healthOk = $true }
  } catch {
    $healthOk = $false
  }

  if ($healthOk) {
    Write-Host '[OpenStudio] Detected an existing OpenStudio bridge; stopping it for a clean restart...'
    $listeners = Get-NetTCPConnection -LocalPort 3777 -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
      try { Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop } catch {}
    }
    Start-Sleep -Seconds 2
  }

  $portInUse = $false
  try {
    $client = New-Object System.Net.Sockets.TcpClient("127.0.0.1", 3777)
    $client.Close()
    $portInUse = $true
  } catch {
    $portInUse = $false
  }
  if ($portInUse) {
    Write-Error "[OpenStudio] Port 3777 is already in use. The bridge may already be running."
    exit 1
  }

  $opencode = Get-Process | Where-Object { $_.ProcessName -match "opencode|OpenCode" }
  if (-not $opencode) {
    Write-Error "[OpenStudio] OpenCode does not appear to be running. Start OpenCode first (desktop or terminal)."
    exit 1
  } else {
    Write-Host "[OpenStudio] OpenCode detected."
  }

  $studio = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -in @("RobloxStudio", "RobloxStudioBeta") -or $_.MainWindowTitle -match "Roblox Studio") }
  if (-not $studio) {
    Write-Error "[OpenStudio] Roblox Studio does not appear to be running. Start Roblox Studio first."
    exit 1
  } else {
    Write-Host "[OpenStudio] Roblox Studio detected."
  }
}

Write-Host "[OpenStudio] Starting bridge..."
& node $dist @args
exit $LASTEXITCODE



