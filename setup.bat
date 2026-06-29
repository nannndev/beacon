@echo off
echo ========================================
echo   Security Tools - Full Setup
echo ========================================
echo.

echo [1/3] Installing root dependencies...
call pnpm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install root deps
    pause
    exit /b 1
)

echo.
echo [2/3] Installing frontend dependencies...
cd frontend
call pnpm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install frontend
    pause
    exit /b 1
)
cd ..

echo.
echo [3/3] Installing backend dependencies...
cd backend
call py -m pip install -r requirements.txt || python -m pip install -r requirements.txt || echo "Python not found in PATH. Install Python and add to PATH, or run manually: py -m pip install -r requirements.txt"
if %errorlevel% neq 0 (
    echo ERROR: Failed to install backend
    pause
    exit /b 1
)
cd ..

echo.
echo ========================================
echo   Setup completed successfully!
echo ========================================
echo.
echo Next step: Run "pnpm dev" or double-click start-dev.bat
pause