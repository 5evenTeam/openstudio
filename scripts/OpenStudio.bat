@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0OpenStudio.ps1" %*
if errorlevel 1 pause
exit /b %errorlevel%
