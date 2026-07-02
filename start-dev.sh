#!/bin/bash
echo "Starting Security Tools (Backend + Frontend)..."

# Backend
cd backend
python3 -m uvicorn app.main:app --reload --port 8001 || python -m uvicorn app.main:app --reload --port 8001 &
BACKEND_PID=$!
cd ..

sleep 2

# Frontend
cd frontend
pnpm dev &
FRONTEND_PID=$!
cd ..

echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo "Press Ctrl+C to stop both."

wait
