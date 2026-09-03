@echo off
chcp 65001 >nul
echo Deteniendo Companion en puerto 7823...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":7823" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    echo Companion detenido (PID: %%a).
)
echo Listo.
timeout /t 2 >nul
