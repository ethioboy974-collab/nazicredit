@echo off
cd /d "%~dp0"
if not exist "tools\cloudflared.exe" (
  echo Missing tools\cloudflared.exe
  echo Ask Codex to set up the public tunnel tool again.
  pause
  exit /b 1
)
echo Starting public link for Customer Credit Ledger...
echo Keep this window open while the store uses the public link.
echo.
tools\cloudflared.exe --no-autoupdate tunnel --url http://127.0.0.1:5500
pause
