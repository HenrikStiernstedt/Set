@echo off
setlocal
cd /d "%~dp0"

start "Set Gallery API" cmd /k "npm run server:watch"
start "Set Gallery Vite" cmd /k "npm run dev"