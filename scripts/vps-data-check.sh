#!/bin/bash
# Run this ON THE VPS via SSH to check if invoice/bill data exists and restore if needed.
# Usage: bash scripts/vps-data-check.sh [--restore /path/to/backup.sql]

set -euo pipefail

DB_HOST="${DB_HOST:-localhost}"
DB_USER="${DB_USER:-smtrade_user}"
DB_PASS="${DB_PASSWORD:-StrongPass123!}"
DB_NAME="${DB_NAME:-smtrade_db}"
APP_DIR="${APP_DIR:-/var/www/smtradeapp}"

echo "============================================"
echo " SM Trade VPS Data Check"
echo " $(date)"
echo "============================================"

mysql_cmd() {
  mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$@" 2>/dev/null
}

echo ""
echo "=== 1. MySQL connection ==="
if mysql_cmd -e "SELECT 1" >/dev/null; then
  echo "OK: Connected to MySQL as $DB_USER"
else
  echo "FAIL: Cannot connect to MySQL. Check credentials in $APP_DIR/server/.env"
  exit 1
fi

echo ""
echo "=== 2. Invoice count in $DB_NAME ==="
INVOICE_COUNT=$(mysql_cmd -N -e "SELECT COUNT(*) FROM invoices" "$DB_NAME" || echo "ERR")
CUSTOMER_COUNT=$(mysql_cmd -N -e "SELECT COUNT(*) FROM customers" "$DB_NAME" || echo "ERR")
QUOTATION_COUNT=$(mysql_cmd -N -e "SELECT COUNT(*) FROM quotations" "$DB_NAME" || echo "ERR")
echo "Invoices:   $INVOICE_COUNT"
echo "Customers:  $CUSTOMER_COUNT"
echo "Quotations: $QUOTATION_COUNT"

if [ "$INVOICE_COUNT" != "ERR" ] && [ "$INVOICE_COUNT" -gt 0 ]; then
  echo ""
  echo "=== 3. All invoices in database ==="
  mysql_cmd -e "SELECT invoice_number, customer_name, date, total_amount, status, created_at FROM invoices ORDER BY created_at DESC" "$DB_NAME"
  echo ""
  echo "DATA EXISTS: Your $INVOICE_COUNT bills are in the database."
  echo "If they don't show in the app, the problem is API/auth — NOT lost data."
  echo "Fix: deploy latest code, pm2 restart smtrade-api, then log out and log in again."
else
  echo ""
  echo "WARNING: No invoices found in $DB_NAME!"
  echo ""
  echo "=== 3. Searching other databases for invoice data ==="
  for db in $(mysql_cmd -N -e "SHOW DATABASES" | grep -v -E '^(information_schema|performance_schema|mysql|sys)$'); do
    HAS=$(mysql_cmd -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$db' AND table_name='invoices'" 2>/dev/null || echo 0)
    if [ "$HAS" = "1" ]; then
      CNT=$(mysql_cmd -N -e "SELECT COUNT(*) FROM invoices" "$db" 2>/dev/null || echo 0)
      echo "  Database '$db': $CNT invoices"
      if [ "$CNT" -gt 0 ]; then
        echo "  >>> FOUND DATA in '$db' — backend may be pointing to wrong database!"
        mysql_cmd -e "SELECT invoice_number, customer_name, date FROM invoices LIMIT 10" "$db"
      fi
    fi
  done
fi

echo ""
echo "=== 4. Backup files on VPS ==="
FOUND_BACKUP=0
for dir in \
  "$APP_DIR/server/backups" \
  "$APP_DIR/backups" \
  "/var/backups/smtrade" \
  "/root/backups" \
  "/home/*/backups"; do
  if [ -d "$dir" ]; then
    COUNT=$(find "$dir" -maxdepth 1 -name "*.sql" 2>/dev/null | wc -l)
    if [ "$COUNT" -gt 0 ]; then
      echo "Found $COUNT backup(s) in $dir:"
      ls -lh "$dir"/*.sql 2>/dev/null | tail -10
      FOUND_BACKUP=1
    fi
  fi
done
if [ "$FOUND_BACKUP" -eq 0 ]; then
  echo "No .sql backup files found in common locations."
fi

echo ""
echo "=== 5. API backend status ==="
pm2 describe smtrade-api 2>/dev/null | grep -E 'status|exec cwd|node args' || echo "pm2 smtrade-api not found"
for port in 3002 3105 3001; do
  RESP=$(curl -s --max-time 3 "http://127.0.0.1:$port/api/health" 2>/dev/null || true)
  if [ -n "$RESP" ]; then
    echo "Port $port: $RESP"
  fi
done

# Restore mode
if [ "${1:-}" = "--restore" ] && [ -n "${2:-}" ]; then
  BACKUP_FILE="$2"
  if [ ! -f "$BACKUP_FILE" ]; then
    echo "ERROR: Backup file not found: $BACKUP_FILE"
    exit 1
  fi
  echo ""
  echo "=== RESTORING from $BACKUP_FILE ==="
  read -r -p "This will OVERWRITE $DB_NAME. Continue? [y/N] " confirm
  if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
    mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$BACKUP_FILE"
    NEW_COUNT=$(mysql_cmd -N -e "SELECT COUNT(*) FROM invoices" "$DB_NAME")
    echo "Restore complete. Invoice count: $NEW_COUNT"
    pm2 restart smtrade-api --update-env 2>/dev/null || true
  else
    echo "Restore cancelled."
  fi
fi

echo ""
echo "============================================"
echo " Done."
echo "============================================"
