@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0OpenStudio.ps1" %*
exit /b %errorlevel%