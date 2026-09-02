@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js 20 或更高版本。请先安装 Node.js 后重试。
  pause
  exit /b 1
)

node scripts\prepare-local-sync.js
set "exitCode=%ERRORLEVEL%"
echo.
pause
exit /b %exitCode%
