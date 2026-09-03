#!/usr/bin/env bash
echo "=== Instalando dependencias de Companion (macOS / Linux) ==="
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] python3 no está instalado. Instálalo desde https://www.python.org/ o con 'brew install python'"
    exit 1
fi

echo "[1/2] Instalando / actualizando yt-dlp..."
python3 -m pip install --upgrade yt-dlp

echo "[2/2] Verificando FFmpeg..."
if ! command -v ffmpeg &> /dev/null; then
    echo "[AVISO] ffmpeg no está instalado en el PATH."
    echo "En macOS puedes instalarlo fácilmente ejecutando: brew install ffmpeg"
else
    echo "FFmpeg detectado correctamente."
fi

echo "=== ¡Listo! Para iniciar el companion ejecuta: ./iniciar.sh ==="