@echo off
chcp 65001 >nul
title Companion — Descargador de Videos
cd /d "%~dp0"
python companion.py
if %errorlevel% neq 0 (
    echo.
    echo El companion se cerró con un error.
    pause
)
