#!/usr/bin/env bash
curl -s -X POST http://127.0.0.1:7823/shutdown > /dev/null 2>&1
echo "Companion detenido."