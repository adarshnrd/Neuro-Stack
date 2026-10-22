# Project NeuroStack Startup Script
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Starting Project NeuroStack (Frontend + Backend)" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path ".env")) {
    Write-Host "[ERROR] .env file not found!" -ForegroundColor Red
    Write-Host "Please copy .env.example to .env and configure your keys." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path "node_modules")) {
    Write-Host "[*] Installing dependencies..." -ForegroundColor Yellow
    npm install
}

Write-Host "[*] Starting NeuroStack unified server..." -ForegroundColor Green
Write-Host "[*] Backend API:  http://localhost:3000/api" -ForegroundColor Gray
Write-Host "[*] Frontend UI:   http://localhost:3000/app" -ForegroundColor Gray
Write-Host "[*] Folder Agent:  http://localhost:3000/folder" -ForegroundColor Gray
Write-Host ""

Start-Process "http://localhost:3000/app"
npm run dev
