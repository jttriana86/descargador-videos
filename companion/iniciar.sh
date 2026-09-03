#!/usr/bin/env bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if curl -s http://127.0.0.1:7823/health > /dev/null 2>&1; then
    echo "El companion ya está activo en http://127.0.0.1:7823"
    exit 0
fi

echo "Iniciando Companion en segundo plano..."
nohup python3 companion.py > companion.log 2>&1 &
echo "Companion iniciado en segundo plano (PID: $!)."