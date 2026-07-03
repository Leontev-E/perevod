#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Perevod — one-command installer
#  AI landing-page localizer · BoostClicks (Евгений Леонтьев)
#
#  Usage on any Docker host:
#      git clone https://github.com/Leontev-E/perevod.git
#      cd perevod && ./install.sh
#
#  Re-run any time to rebuild & restart. It never overwrites your .env.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

cyan()  { printf "\033[36m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*" >&2; }

cd "$(dirname "$0")"

cyan "╭──────────────────────────────────────────────╮"
cyan "│  Perevod · installer                         │"
cyan "│  AI landing localizer by BoostClicks         │"
cyan "╰──────────────────────────────────────────────╯"

# ── 1. Docker present? ───────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  red "Docker is not installed."
  yellow "Install it first:  curl -fsSL https://get.docker.com | sh"
  exit 1
fi

# docker compose v2 (plugin) or v1 (standalone)?
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  red "docker compose is not available."
  yellow "Install the Compose plugin:  https://docs.docker.com/compose/install/"
  exit 1
fi
green "✓ Docker & Compose found ($DC)"

# ── 2. Create .env with strong random secrets (only if missing) ──────────────
rand() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "${1:-24}"
  else head -c "$((${1:-24}*2))" /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-"$((${1:-24}*2))"
  fi
}

if [ ! -f .env ]; then
  cp .env.example .env
  APP_PASSWORD="$(rand 8)"          # 16 hex chars
  SESSION_SECRET="$(rand 32)"       # 64 hex chars
  # portable in-place edit (GNU & BSD sed)
  sed -i.bak "s|^APP_PASSWORD=.*|APP_PASSWORD=${APP_PASSWORD}|"     .env
  sed -i.bak "s|^SESSION_SECRET=.*|SESSION_SECRET=${SESSION_SECRET}|" .env
  rm -f .env.bak
  green "✓ Generated .env with a random password & session secret"
  NEW_ENV=1
else
  yellow "• .env already exists — keeping it"
  NEW_ENV=0
fi

WEB_PORT="$(grep -E '^WEB_PORT=' .env | cut -d= -f2 | tr -d ' ' || true)"
WEB_PORT="${WEB_PORT:-8070}"
APP_PASSWORD="$(grep -E '^APP_PASSWORD=' .env | cut -d= -f2- | tr -d ' ' || true)"

# ── 3. Build & start ─────────────────────────────────────────────────────────
cyan "→ Building image (first run downloads Node + Chromium, ~2–4 min)…"
$DC build
cyan "→ Starting container…"
$DC up -d

# ── 4. Wait for health ───────────────────────────────────────────────────────
printf "→ Waiting for the app to come up"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${WEB_PORT}/health" >/dev/null 2>&1; then ok=1; break; fi
  printf "."; sleep 1
done
echo
if [ "${ok:-0}" != "1" ]; then
  red "The app did not answer on port ${WEB_PORT}. Check logs:  $DC logs -f"
  exit 1
fi

# best-effort public IP for the hint
IP="$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo 'SERVER_IP')"

green   "╭──────────────────────────────────────────────────────────────╮"
green   "│  ✓ Perevod is running                                        │"
green   "╰──────────────────────────────────────────────────────────────╯"
echo
cyan    "  URL:       http://${IP}:${WEB_PORT}    (local: http://localhost:${WEB_PORT})"
cyan    "  Password:  ${APP_PASSWORD}"
echo
yellow  "  Next: open the app → log in → ⚙ Settings → paste your kie.ai API key."
yellow  "  Get a key at https://kie.ai → API Keys."
echo
echo    "  Logs:   $DC logs -f"
echo    "  Stop:   $DC down"
echo    "  Update: ./update.sh"
[ "$NEW_ENV" = "1" ] && yellow "  (Your password is stored in ./.env — keep it safe.)"
