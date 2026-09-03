@echo off
chcp 65001 >nul
title Instalador de Companion — Descargador de Videos
echo =========================================================
echo    Instalando dependencias para el Companion
echo =========================================================
echo.

echo [1/3] Verificando Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python no está instalado o no está en el PATH.
    echo Por favor instala Python desde https://www.python.org/downloads/
    echo y asegúrate de marcar "Add python.exe to PATH".
    echo.
    pause
    exit /b 1
)
python --version
echo Python detectado correctamente.
echo.

echo [2/3] Instalando / actualizando yt-dlp...
python -m pip install --upgrade yt-dlp
if %errorlevel% neq 0 (
    echo [ADVERTENCIA] Falló pip install directo, intentando con flags de usuario...
    python -m pip install --user --upgrade yt-dlp
)
echo yt-dlp instalado correctamente.
echo.

echo [3/3] Verificando FFmpeg...
ffmpeg -version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ADVERTENCIA] ffmpeg no está en el PATH del sistema.
    echo Si lo tienes en otra carpeta o winget, revisa que esté accesible.
) else (
    echo FFmpeg detectado correctamente.
)
echo.

echo =========================================================
echo  ¡Instalación completada con éxito!
echo  Ahora puedes ejecutar "iniciar-silencioso.vbs" o "iniciar.bat".
echo =========================================================
echo.
pause
