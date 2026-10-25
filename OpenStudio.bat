@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-plugin.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\OpenStudio.ps1" %*
exit /b %errorlevel%
