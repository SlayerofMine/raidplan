#!/usr/bin/env bash
#
# RaidPlans backup (plan §5.6) — a consistent SQLite snapshot plus the uploads
# directory, written to **local block storage**. No object storage: the target
# is the free-tier Oracle ARM VM's own block volume.
#
# Run by raidplans-backup.timer (daily), or by hand. Needs the `sqlite3` CLI
# (`sudo dnf install -y sqlite`).
set -euo pipefail

# Config comes from the same env file the service reads.
ENV_FILE="${RAIDPLANS_ENV:-/etc/raidplans/env}"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

DB="${DATABASE_PATH:-/var/lib/raidplans/app.db}"
UPLOADS="${UPLOAD_DIR:-/var/lib/raidplans/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/var/lib/raidplans/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

stamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# `.backup` takes a consistent copy even while the API is mid-write (WAL-safe),
# unlike a plain `cp` which can catch a torn transaction.
sqlite3 "$DB" ".backup '$BACKUP_DIR/app-$stamp.db'"
gzip -f "$BACKUP_DIR/app-$stamp.db"

# Uploaded maps are user data the DB only references by path — snapshot them so
# a restore isn't left with every custom map broken. (Synced WoW icons are NOT
# backed up: a sync regenerates them.)
if [ -d "$UPLOADS" ]; then
  tar -czf "$BACKUP_DIR/uploads-$stamp.tar.gz" \
    -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"
fi

# Retention: drop snapshots older than the window.
find "$BACKUP_DIR" -type f -name 'app-*.db.gz' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -type f -name 'uploads-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

echo "backup ok → $BACKUP_DIR/app-$stamp.db.gz"
