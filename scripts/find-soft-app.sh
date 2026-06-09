#!/bin/bash
# Run on VPS to find which folder serves https://soft.smtradeint.com (billing app)
# Usage: bash find-soft-app.sh

echo "=============================================="
echo " Find soft.smtradeint.com app folder on VPS"
echo "=============================================="

echo ""
echo "=== 1. Nginx config for soft.smtradeint.com ==="
for f in /etc/nginx/sites-enabled/* /etc/nginx/sites-available/*; do
  [ -f "$f" ] || continue
  if grep -q "soft.smtradeint.com" "$f" 2>/dev/null; then
    echo "--- $f ---"
    grep -E "server_name|root |proxy_pass|location /api" "$f" | head -20
  fi
done

echo ""
echo "=== 2. PM2 processes related to smtrade / soft ==="
pm2 list 2>/dev/null | grep -iE "smtrade|soft|trade" || pm2 list

echo ""
echo "=== 3. PM2 details (smtrade-soft, sm-trade-backend) ==="
for name in smtrade-soft sm-trade-backend smtrade-api; do
  if pm2 describe "$name" >/dev/null 2>&1; then
    echo "--- $name ---"
    pm2 describe "$name" 2>/dev/null | grep -E "script path|exec cwd|status|PORT"
  fi
done

echo ""
echo "=== 4. Listening API ports ==="
ss -tlnp | grep -E '3001|3002|3105' || true
for port in 3001 3002 3105; do
  R=$(curl -s --max-time 2 "http://127.0.0.1:$port/api/health" 2>/dev/null || true)
  [ -n "$R" ] && echo "Port $port: $R"
done

echo ""
echo "=== 5. Candidate folders under /var/www ==="
for dir in \
  /var/www/smtradeapp-soft \
  /var/www/smtradeapp \
  /var/www/smtrade-soft \
  /var/www/smelitehajjinvoice \
  /var/www/digiwebdex; do
  [ -d "$dir" ] || continue
  echo "--- $dir ---"
  [ -f "$dir/server/index.js" ] && echo "  HAS server/index.js (billing API)"
  [ -f "$dir/server/.env" ] && echo "  HAS server/.env: $(grep -E '^PORT=|^DB_NAME=' "$dir/server/.env" 2>/dev/null | tr '\n' ' ')"
  [ -f "$dir/backend/server.js" ] && echo "  HAS backend/server.js (website API)"
  [ -d "$dir/dist" ] && echo "  HAS dist/ (frontend build) $(ls -la "$dir/dist/index.html" 2>/dev/null | awk '{print $6,$7,$8}')"
  if [ -f "$dir/server/.env" ]; then
    (cd "$dir/server" && node -e "
      require('dotenv').config({path:'.env',override:true});
      const u=process.env.DB_USER, d=process.env.DB_NAME;
      if(!u||!d){console.log('  DB: (not configured)');process.exit(0)}
      const pool=require('./db');
      pool.query('SELECT COUNT(*) c FROM invoices').then(([r])=>{
        console.log('  DB:', u+'@'+d, '-> invoices:', r[0].c);
        process.exit(0);
      }).catch(e=>{console.log('  DB connect failed:', e.message);process.exit(0)});
    " 2>/dev/null) || echo "  DB: could not test"
  fi
done

echo ""
echo "=== 6. Which folder nginx serves as frontend? ==="
ROOT=$(grep -r "soft.smtradeint.com" /etc/nginx/sites-enabled/ /etc/nginx/sites-available/ 2>/dev/null | head -1)
NGINX_FILE=$(grep -rl "server_name soft.smtradeint.com" /etc/nginx/sites-enabled/ /etc/nginx/sites-available/ 2>/dev/null | head -1)
if [ -n "$NGINX_FILE" ]; then
  FRONT_ROOT=$(awk '/server_name soft.smtradeint.com/,/}/' "$NGINX_FILE" | grep -E '^\s*root ' | head -1 | awk '{print $2}' | tr -d ';')
  API_PROXY=$(awk '/server_name soft.smtradeint.com/,/}/' "$NGINX_FILE" | grep proxy_pass | head -1)
  echo "Nginx file: $NGINX_FILE"
  echo "Frontend root: ${FRONT_ROOT:-not found}"
  echo "API proxy: ${API_PROXY:-not found}"
fi

echo ""
echo "=============================================="
echo " SUMMARY"
echo "  soft.smtradeint.com (BILLS)  -> usually /var/www/smtradeapp-soft"
echo "  smtradeint.com (MAIN WEBSITE)-> usually /var/www/smtradeapp"
echo "=============================================="
