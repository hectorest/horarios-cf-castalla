#!/usr/bin/env bash
# Marca una versión nueva: cambia el número en version.txt, en app.js y en los
# enlaces de index.html para que los navegadores descarguen los archivos nuevos.
set -euo pipefail
cd "$(dirname "$0")"
V=$(date -u +%Y%m%d%H%M%S)
echo "$V" > version.txt
sed -i -E "s/const APP_VERSION = '[^']*'/const APP_VERSION = '$V'/" app.js
sed -i -E "s/(styles\.css|config\.js|tutorial\.js|app\.js)(\?v=[0-9]+)?\"/\1?v=$V\"/g" index.html
echo "Versión $V"
