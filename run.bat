@echo off
echo Download Github modifs
git pull https://github.com/celia-bl/annotation_site.git
echo App Launching
call annotation-venv\Scripts\activate
start "Backend" cmd /k "cd backend && uvicorn main:app --reload"
start "Frontend" cmd /k "cd frontend && npm run dev"
timeout /t 2
start http://localhost:5173
