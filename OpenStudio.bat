@echo off
setlocal
set "ROOT=%~dp0"
set "DIST=%ROOT%dist\index.js"

if not exist "%DIST%" (
  echo [OpenStudio] Build output not found. Run "npm run build" first. 1>&2
  exit /b 1
)

node "%DIST%" %*
exit /b %errorlevel%
