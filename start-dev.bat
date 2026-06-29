@echo off
echo.
echo [94m=======================================[0m
echo [94m  Security Tools - Starting Services[0m
echo [94m=======================================[0m
echo.
echo Starting both...
echo   Backend  : http://localhost:8000
echo   Frontend : http://localhost:5173
echo.
echo (Look for colored [BACKEND] / [FRONTEND] prefixes)
echo Press Ctrl+C in the windows to stop.
echo.

start "Backend (FastAPI)" cmd /k "cd backend && py -m uvicorn app.main:app --reload --port 8000 || python -m uvicorn app.main:app --reload --port 8000"
timeout /t 3 >nul
start "Frontend (React + shadcn)" cmd /k "cd frontend && pnpm dev"

echo.
echo Done. Check the opened windows.
pause >nul