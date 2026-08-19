# AI TikTok Agent Dashboard - Quick Start (PowerShell)
# Run this script to install dependencies and start the dashboard

Clear-Host
Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  AI TikTok Agent Dashboard - Setup & Launch" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# Check if Python is installed
try {
    $pythonVersion = python --version 2>$null
    Write-Host "[1/3] Python found: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Python not found. Please install Python 3.8+" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""

# Install dependencies
Write-Host "[2/3] Installing dependencies..." -ForegroundColor Yellow
Write-Host ""

pip install fastapi uvicorn websockets -q

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to install dependencies" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[OK] Dependencies installed" -ForegroundColor Green
Write-Host ""

# Start dashboard server
Write-Host "[3/3] Starting dashboard server..." -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  Dashboard is starting..." -ForegroundColor Green
Write-Host "  " -ForegroundColor Green
Write-Host "  📊 Open browser: http://localhost:8000" -ForegroundColor Cyan
Write-Host "  🔌 WebSocket: ws://localhost:8000/ws/pipeline" -ForegroundColor Cyan
Write-Host "  " -ForegroundColor Green
Write-Host "  Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""

python dashboard_server.py

Read-Host "Press Enter to exit"
