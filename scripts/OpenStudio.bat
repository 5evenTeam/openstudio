@echo off
setlocal
set "ROOT=%~dp0.."
set "DIST=%ROOT%\dist\index.js"

if not exist "%DIST%" (
  echo [OpenStudio] Build output not found. Run "npm run build" first. 1>&2
  exit /b 1
)

if not "%OPENSTUDIO_SKIP_CHECKS%"=="1" (
  where node >nul 2>&1
  if errorlevel 1 (
    echo [OpenStudio] Node.js was not found in PATH. 1>&2
    exit /b 1
  )

  powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient('127.0.0.1',3777)).Close(); exit 0 } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 (
    echo [OpenStudio] Port 3777 is already in use. The bridge may already be running. 1>&2
    exit /b 1
  )

  powershell -NoProfile -Command "if (Get-Process | Where-Object { $_.ProcessName -like '*opencode*' }) { exit 0 } else { exit 1 }" >nul 2>&1
  if errorlevel 1 (
    echo [OpenStudio] OpenCode does not appear to be running. Start OpenCode first. 1>&2
    exit /b 1
  )

  powershell -NoProfile -Command "if (Get-Process | Where-Object { $_.ProcessName -like '*Studio*' }) { exit 0 } else { exit 1 }" >nul 2>&1
  if errorlevel 1 (
    echo [OpenStudio] Roblox Studio does not appear to be running. Start Roblox Studio first. 1>&2
    exit /b 1
  )
)

node "%DIST%" %*
exit /b %errorlevel%
