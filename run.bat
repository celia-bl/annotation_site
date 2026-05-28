@echo off
start uvicorn main:app --reload
timeout /t 2
start npm run dev
