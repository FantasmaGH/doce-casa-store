#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/doce-casa-store}"
DATA_DIR="${DATA_DIR:-$APP_DIR/data}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

APP_DIR="$APP_DIR" DATA_DIR="$DATA_DIR" BACKUP_DIR="$BACKUP_DIR" node "$APP_DIR/scripts/backup-db.js"

if [ -d "$DATA_DIR/uploads" ]; then
  tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "$DATA_DIR" uploads
fi

if [ -d "$DATA_DIR/whatsapp-auth" ]; then
  tar -czf "$BACKUP_DIR/whatsapp-auth-$STAMP.tar.gz" -C "$DATA_DIR" whatsapp-auth
fi

find "$BACKUP_DIR" -type f -mtime +14 -delete
echo "Backup criado em $BACKUP_DIR"
