@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File scripts\restore-migration.ps1
pause
