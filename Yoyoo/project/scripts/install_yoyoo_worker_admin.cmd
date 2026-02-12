@echo off
setlocal EnableExtensions EnableDelayedExpansion

net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo [Yoyoo] Requesting administrator permission...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set "PS1=%~dp0windows_yoyoo_worker_bootstrap.ps1"
if not exist "%PS1%" (
  echo [Yoyoo] ERROR: missing file: %PS1%
  pause
  exit /b 1
)

set "TOKEN="
set /p TOKEN=[Yoyoo] Input token (empty = auto-generate): 
if "%TOKEN%"=="" (
  for /f %%i in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"') do set "TOKEN=%%i"
  echo [Yoyoo] Generated token: !TOKEN!
)

echo [Yoyoo] Installing worker...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Token "%TOKEN%"
if not "%errorlevel%"=="0" (
  echo [Yoyoo] Install failed. Please keep this window and send screenshot/log.
  pause
  exit /b %errorlevel%
)

echo.
echo [Yoyoo] Install success.
echo [Yoyoo] Keep this token and send it to your Yoyoo admin:
echo !TOKEN!
echo.
pause
