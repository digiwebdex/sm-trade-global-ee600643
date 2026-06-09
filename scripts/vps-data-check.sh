#!/bin/bash
# Run ON THE VPS for soft.smtradeint.com billing app (NOT smtradeint.com website).
# Usage:
#   bash scripts/vps-data-check.sh
#   bash scripts/vps-data-check.sh --restore /path/to/backup.sql

set -euo pipefail

# Billing software lives here (soft.smtradeint.com)
APP_DIR="${APP_DIR:-/var/www/smtradeapp-soft}"
ENV_FILE="$APP_DIR/server/.env"

echo "============================================"
echo " SM Trade SOFT (Bills) — VPS Data Check"
echo " App:  $APP_DIR"
echo " Site: https://soft.smtradeint.com"
echo " $(date)"
echo "============================================"

# Load DB credentials from server/.env (repo defaults are often wrong on VPS)
if [ -f "$ENV_FILE" ]; then
  echo "Loading credentials from $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "WARNING: $ENV_FILE not found — using defaults"
fi

DB_HOST="${DB_HOST:-localhost}"
DB_USER="${DB_USER:-smtrade_user}"
DB_PASS="${DB_PASSWORD:-}"
DB_NAME="${DB_NAME:-smtrade_db}"

if [ -z "$DB_PASS" ]; then
  echo ""
  echo "No DB password in .env. Try root MySQL instead:"
  echo "  sudo mysql -e \"SHOW DATABASES;\""
  echo "  sudo mysql smtrade_db -e \"SELECT COUNT(*) FROM invoices;\""
  echo ""
fi

mysql_cmd() {
  if [ -n "$DB_PASS" ]; then
    mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$@" 2>/dev/null
  else
    return 1
  fi
}

mysql_root_cmd() {
  sudo mysql "$@" 2>/dev/null
}

echo ""
echo "=== 1. MySQL connection ==="
CONNECTED=0
if [ -n "$DB_PASS" ] && mysql_cmd -e "SELECT 1" >/dev/null; then
  echo "OK: Connected as $DB_USER@$DB_HOST"
  CONNECTED=1
elif mysql_root_cmd -e "SELECT 1" >/dev/null; then
  echo "OK: Connected via sudo mysql (root)"
  mysql_cmd() { mysql_root_cmd "$@"; }
  CONNECTED=1
else
  echo "FAIL: Cannot connect. Run manually:"
  echo "  cat $ENV_FILE"
  echo "  sudo mysql -e \"SHOW DATABASES;\""
fi

if [ "$CONNECTED" -eq 1 ]; then
  echo ""
  echo "=== 2. Invoice count in $DB_NAME ==="
  INVOICE_COUNT=$(mysql_cmd -N -e "SELECT COUNT(*) FROM invoices" "$DB_NAME" 2>/dev/null || echo "ERR")
  CUSTOMER_COUNT=$(mysql_cmd -N -e "SELECT COUNT(*) FROM customers" "$DB_NAME" 2>/dev/null || echo "ERR")
  QUOTATION_COUNT=$(mysql_cmd -N -e "SELECT COUNT(*) FROM quotations" "$DB_NAME" 2>/dev/null || echo "ERR")
  echo "Invoices:   $INVOICE_COUNT"
  echo "Customers:  $CUSTOMER_COUNT"
  echo "Quotations: $QUOTATION_COUNT"

  if [ "$INVOICE_COUNT" != "ERR" ] && [ "$INVOICE_COUNT" -gt 0 ] 2>/dev/null; then
    echo ""
    echo "=== 3. All bills in database ==="
    mysql_cmd -e "SELECT invoice_number, customer_name, date, total_amount, status, created_at FROM invoices ORDER BY created_at DESC" "$DB_NAME"
    echo ""
    echo ">>> DATA EXISTS: $INVOICE_COUNT bills found. Data is NOT lost."
    echo ">>> Fix app: deploy latest code + pm2 restart smtrade-soft + re-login."
  else
    echo ""
    echo "WARNING: No invoices in $DB_NAME!"
    echo ""
    echo "=== 3. Search ALL databases for invoice tables ==="
    for db in $(mysql_cmd -N -e "SHOW DATABASES" | grep -v -E '^(information_schema|performance_schema|mysql|sys)$'); do
      HAS=$(mysql_cmd -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$db' AND table_name='invoices'" 2>/dev/null || echo 0)
      if [ "$HAS" = "1" ]; then
        CNT=$(mysql_cmd -N -e "SELECT COUNT(*) FROM invoices" "$db" 2>/dev/null || echo 0)
        echo "  $db: $CNT invoices"
        if [ "$CNT" -gt 0 ] 2>/dev/null; then
          mysql_cmd -e "SELECT invoice_number, customer_name, date FROM invoices LIMIT 10" "$db"
        fi
      fi
    done
  fi
fi

echo ""
echo "=== 4. Backup .sql files ==="
FOUND=0
for dir in "$APP_DIR/server/backups" "$APP_DIR/backups" /var/backups /root; do
  [ -d "$dir" ] || continue
  while IFS= read -r f; do
    echo "  $f ($(du -h "$f" | cut -f1))"
    FOUND=1
  done < <(find "$dir" -maxdepth 2 -name "*.sql" 2>/dev/null | head -20)
done
[ "$FOUND" -eq 0 ] && echo "  No .sql backups found."

echo ""
echo "=== 5. PM2 + API (soft.smtradeint.com) ==="
pm2 describe smtrade-soft 2>/dev/null | grep -E 'status|exec cwd|script' || echo "  smtrade-soft: not in pm2"
pm2 describe sm-trade-backend 2>/dev/null | grep -E 'status|exec cwd|script' || true
for port in 3002 3105; do
  R=$(curl -s --max-time 2 "http://127.0.0.1:$port/api/health" 2>/dev/null || true)
  [ -n "$R" ] && echo "  Port $port: $R"
done

if [ "${1:-}" = "--restore" ] && [ -n "${2:-}" ]; then
  BACKUP_FILE="$2"
  [ -f "$BACKUP_FILE" ] || { echo "File not found: $BACKUP_FILE"; exit 1; }
  read -r -p "Restore $BACKUP_FILE into $DB_NAME? [y/N] " c
  if [ "$c" = "y" ] || [ "$c" = "Y" ]; then
    if [ -n "$DB_PASS" ]; then
      mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$BACKUP_FILE"
    else
      sudo mysql "$DB_NAME" < "$BACKUP_FILE"
    fi
    echo "Done. Invoices: $(mysql_cmd -N -e "SELECT COUNT(*) FROM invoices" "$DB_NAME")"
    pm2 restart smtrade-soft --update-env 2>/dev/null || true
  fi
fi

echo ""
echo "============================================"
