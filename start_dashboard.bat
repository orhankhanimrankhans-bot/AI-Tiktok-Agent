@echo off
REM AI TikTok Agent Dashboard - Quick Start
REM This script installs dependencies and starts the dashboard server

cls
echo.
echo ========================================================
echo   AI TikTok Agent Dashboard - Setup & Launch
echo ========================================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.8+
    pause
    exit /b 1
)

echo [1/3] Python found: 
python --version
echo.

REM Install dependencies
echo [2/3] Installing dependencies...
echo.
pip install fastapi uvicorn websockets -q

if errorlevel 1 (
    echo [ERROR] Failed to install dependencies
    pause
    exit /b 1
)

echo [OK] Dependencies installed
echo.

REM Start dashboard server
echo [3/3] Starting dashboard server...
echo.
echo ========================================================
echo   Dashboard is starting...
echo   
echo   📊 Open browser: http://localhost:8000
echo   🔌 WebSocket: ws://localhost:8000/ws/pipeline
echo   
echo   Press Ctrl+C to stop
echo ========================================================
echo.

python dashboard_server.py

pause
