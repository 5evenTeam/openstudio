@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-plugin.ps1"
if errorlevel 1 pause
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\OpenStudio.ps1" %*
if errorlevel 1 pause
exit /b %errorlevel%
