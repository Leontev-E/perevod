#!/usr/bin/env bash
# Pull the latest code and rebuild. Your .env and /data (settings, lessons) are kept.
set -euo pipefail
cd "$(dirname "$0")"

if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi

echo "→ Pulling latest code…"
git pull --ff-only || echo "• git pull skipped (not a git checkout)"
echo "→ Rebuilding…"
$DC build
echo "→ Restarting…"
$DC up -d
echo "✓ Updated. Logs: $DC logs -f"
