#!/bin/bash
# VibeDesignAgent daily Firestore backup.
# Writes a dated snapshot to exports/daily/YYYY-MM-DD/ (Firestore JSON only —
# presentation images and Stitch HTML are skipped to keep the nightly run
# fast and free of external API calls). Old snapshots are pruned after
# KEEP_DAYS days (default 30 — covers the full ~3-week study with margin).
# Installed via launchd, see scripts/com.vibedesign.daily-export.plist.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STAMP="$(date +%Y-%m-%d)"
OUT_DIR="exports/daily/$STAMP"
LOG_DIR="exports/daily/logs"
KEEP_DAYS="${KEEP_DAYS:-30}"
PYTHON="$ROOT/.venv/bin/python"

mkdir -p "$OUT_DIR" "$LOG_DIR"

{
  echo "[daily-export] start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  EXPORT_OUTPUT_DIR="$OUT_DIR" EXPORT_SKIP_ASSETS=1 "$PYTHON" scripts/export_sessions.py
  echo "[daily-export] done $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >>"$LOG_DIR/$STAMP.log" 2>&1

# Prune dated snapshot folders and logs older than KEEP_DAYS.
find exports/daily -mindepth 1 -maxdepth 1 -type d -name '20??-??-??' -mtime +"$KEEP_DAYS" -exec rm -rf {} +
find "$LOG_DIR" -type f -name '20??-??-??.log' -mtime +"$KEEP_DAYS" -delete
