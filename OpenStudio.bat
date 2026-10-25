@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\OpenStudio.ps1" %*
exit /b %errorlevel%