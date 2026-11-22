@echo off
cd /d "%~dp0"
echo [1/2] checking packages... (first run takes a while)
call npm install
echo [2/2] starting...
call npm run dev
pause
