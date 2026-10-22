@echo off
setlocal
echo ========================================================
echo   Starting Project NeuroStack (Frontend + Backend)
echo ========================================================
echo.

if not exist ".env" (
    echo [ERROR] .env file not found!
    echo Please copy .env.example to .env and configure your keys.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [*] Installing dependencies...
    call npm install
)

echo [*] Starting NeuroStack unified server (Express + Handlebars UI)...
echo [*] Backend API:  http://localhost:3000/api
echo [*] Frontend UI:   http://localhost:3000/app
echo [*] Folder Agent:  http://localhost:3000/folder
echo.

timeout /t 2 /nobreak >nul
start "" "http://localhost:3000/app"
call npm run dev
