#!/bin/bash
# Emergency fix when soft.smtradeint.com returns 502 on /api/*
# Run: bash scripts/vps-fix-backend.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/smtradeapp-soft}"
SERVER_DIR="$APP_DIR/server"
PORT="${PORT:-3002}"

echo "=== SM Trade SOFT backend fix ==="
echo "App: $APP_DIR"

if [ ! -f "$SERVER_DIR/index.js" ]; then
  echo "ERROR: $SERVER_DIR/index.js not found"
  exit 1
fi

cd "$SERVER_DIR"
echo "=== npm install (server) ==="
npm install

echo "=== Test node startup ==="
if ! node -e "require('./auth'); require('./db'); console.log('modules OK')"; then
  echo "Module load failed — try: npm rebuild bcrypt"
  npm rebuild bcrypt || true
fi

echo "=== Stop old process ==="
pm2 delete smtrade-soft 2>/dev/null || true

echo "=== Start backend on port $PORT ==="
cd "$SERVER_DIR"
pm2 start index.js --name smtrade-soft --update-env
pm2 save

sleep 3
echo "=== Health check ==="
curl -s "http://127.0.0.1:$PORT/api/health" || echo "FAILED — run: pm2 logs smtrade-soft --lines 50"
echo ""
pm2 status smtrade-soft
