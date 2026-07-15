#!/usr/bin/env bash
# Switch to a new game session and bring the stack up in a safe order.
# Does NOT delete prior game_states / api_calls (kept for learning).
#
# Usage: ./scripts/new-game.sh <gameId> <playerId>
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <gameId> <playerId>" >&2
  exit 1
fi

NEW_GAME_ID="$1"
NEW_PLAYER_ID="$2"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GAME_DIR="$ROOT/game"
ENV_FILE="$ROOT/.env"
GAME_JSON="$GAME_DIR/config/game.json"
LOG_DIR="${TMPDIR:-/tmp}/ai-eng-game-stack"
mkdir -p "$LOG_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE — copy from .env.example first" >&2
  exit 1
fi

# Load existing env for gateway host/port / DATABASE_URL only.
# Do NOT let sourced GAME_ID/PLAYER_ID clobber the CLI args.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

GAME_ID="$NEW_GAME_ID"
PLAYER_ID="$NEW_PLAYER_ID"

GATEWAY_HOST="${GATEWAY_HOST:-127.0.0.1}"
GATEWAY_PORT="${GATEWAY_PORT:-3100}"
GATEWAY_BASE="http://${GATEWAY_HOST}:${GATEWAY_PORT}"
DATABASE_URL="${DATABASE_URL:-postgresql://game:game@localhost:5432/game}"

log() { printf '[new-game] %s\n' "$*"; }
fail() { printf '[new-game] ERROR: %s\n' "$*" >&2; exit 1; }

set_env_var() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

wait_http() {
  local url="$1" label="$2" attempts="${3:-40}"
  local i code
  for ((i = 1; i <= attempts; i++)); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 1 "$url" || true)"
    # 200 / 429 both mean the process behind the URL is up
    if [[ "$code" == "200" || "$code" == "429" ]]; then
      log "$label ok (HTTP $code)"
      return 0
    fi
    sleep 0.25
  done
  fail "$label not ready after ${attempts} tries (last HTTP ${code:-none}) — $url"
}

wait_pgrep() {
  local pattern="$1" label="$2" attempts="${3:-40}"
  local i
  for ((i = 1; i <= attempts; i++)); do
    if pgrep -f "$pattern" >/dev/null 2>&1; then
      log "$label process up"
      return 0
    fi
    sleep 0.25
  done
  fail "$label process did not start — see $LOG_DIR/${label}.log"
}

sql() {
  psql "$DATABASE_URL" -Atc "$1" 2>/dev/null || true
}

stop_stack() {
  log "stopping prior gateway / pollers / jobs / ui"
  pkill -f "tsx src/cli.ts gateway" 2>/dev/null || true
  pkill -f "tsx src/cli.ts pollers" 2>/dev/null || true
  pkill -f "tsx src/cli.ts jobs" 2>/dev/null || true
  pkill -f "tsx src/cli.ts start" 2>/dev/null || true
  pkill -f "vite --config ui/vite.config.ts" 2>/dev/null || true
  sleep 1
}

start_bg() {
  local name="$1"
  shift
  local logfile="$LOG_DIR/${name}.log"
  : >"$logfile"
  (
    cd "$GAME_DIR"
    # setsid detaches from the script's process group so Cursor/agent shells
    # ending do not take the stack down with them.
    setsid "$@" >>"$logfile" 2>&1 < /dev/null &
    echo $! >"$LOG_DIR/${name}.pid"
  )
  log "started $name (log $logfile)"
}

# --- 1. Write IDs ----------------------------------------------------------------
log "switching to game=$GAME_ID player=$PLAYER_ID"
set_env_var GAME_ID "$GAME_ID"
set_env_var PLAYER_ID "$PLAYER_ID"

if [[ -f "$ROOT/.env.example" ]]; then
  sed -i.bak "s|^GAME_ID=.*|GAME_ID=${GAME_ID}|" "$ROOT/.env.example"
  sed -i.bak "s|^PLAYER_ID=.*|PLAYER_ID=${PLAYER_ID}|" "$ROOT/.env.example"
  rm -f "$ROOT/.env.example.bak"
fi

if [[ -f "$GAME_DIR/src/config.ts" ]]; then
  sed -i.bak \
    -e "s/PLAYER_ID: z.string().min(1).default(\"[^\"]*\")/PLAYER_ID: z.string().min(1).default(\"${PLAYER_ID}\")/" \
    -e "s/GAME_ID: z.string().min(1).default(\"[^\"]*\")/GAME_ID: z.string().min(1).default(\"${GAME_ID}\")/" \
    "$GAME_DIR/src/config.ts"
  rm -f "$GAME_DIR/src/config.ts.bak"
fi

cat >"$GAME_JSON" <<EOF
{
  "gameId": "${GAME_ID}",
  "playerId": "${PLAYER_ID}"
}
EOF

# --- 2. Database -----------------------------------------------------------------
log "ensuring postgres + migrations"
(
  cd "$GAME_DIR"
  docker compose up -d >/dev/null
  npm run db:migrate
) || fail "database not ready"

# --- 3. Restart stack in order ---------------------------------------------------
stop_stack

start_bg gateway npm run gateway
wait_pgrep "tsx src/cli.ts gateway" gateway
wait_http "${GATEWAY_BASE}/_gateway/ui-claim-queue" "gateway" 60

start_bg pollers npm run pollers
wait_pgrep "tsx src/cli.ts pollers" pollers
# Map for the new game id (empty tiles are fine). Gateway must already be up.
wait_http "${GATEWAY_BASE}/api/v1/map?game_id=${GAME_ID}" "map for ${GAME_ID}" 40

# Wait until pollers persist a fresh map row (empty board OK). Old rows stay.
if command -v psql >/dev/null 2>&1; then
  log "waiting for fresh map row in game_states"
  MAP_OK=0
  for _ in $(seq 1 60); do
    N="$(sql "SELECT COUNT(*) FROM game_states WHERE endpoint_key='map' AND fetched_at > NOW() - INTERVAL '90 seconds';")"
    BOOT="$(sql "SELECT COUNT(*) FROM policy_events WHERE event_type='map_stream_bootstrap' AND ts > NOW() - INTERVAL '90 seconds';")"
    if [[ "${N:-0}" -ge 1 || "${BOOT:-0}" -ge 1 ]]; then
      MAP_OK=1
      log "pollers map bootstrap ok (states=$N bootstrap_events=$BOOT)"
      break
    fi
    if ! pgrep -f "tsx src/cli.ts pollers" >/dev/null 2>&1; then
      fail "pollers died — see $LOG_DIR/pollers.log"
    fi
    sleep 1
  done
  if [[ "$MAP_OK" -ne 1 ]]; then
    fail "no fresh map in game_states / no map_stream_bootstrap — see $LOG_DIR/pollers.log"
  fi
else
  log "WARN: psql not available — skipped game_states freshness check"
fi

start_bg jobs npm run jobs
wait_pgrep "tsx src/cli.ts jobs" jobs

start_bg ui npm run ui
wait_pgrep "vite --config ui/vite.config.ts" ui
wait_http "http://localhost:5173/" "ui" 40

# --- 4. Verify gates -------------------------------------------------------------
log "verifying"
MAP_CODE="$(curl -s -o /tmp/new-game-map.json -w '%{http_code}' \
  "${GATEWAY_BASE}/api/v1/map?game_id=${GAME_ID}" || true)"
if [[ "$MAP_CODE" != "200" && "$MAP_CODE" != "429" ]]; then
  fail "map probe failed HTTP $MAP_CODE"
fi
log "map probe HTTP $MAP_CODE"

PLACE_OK=0
if command -v psql >/dev/null 2>&1; then
  log "waiting for claimer place-tile"
  for _ in $(seq 1 45); do
    START="$(sql "SELECT COUNT(*) FROM policy_events WHERE source='job' AND event_type='claim_start' AND ts > NOW() - INTERVAL '2 minutes';")"
    N="$(sql "SELECT COUNT(*) FROM api_calls WHERE source='job' AND path LIKE '%place-tile%' AND ts > NOW() - INTERVAL '60 seconds';")"
    if [[ "${N:-0}" -ge 1 ]]; then
      PLACE_OK=1
      log "claimer place-tile seen ($N in last 60s)"
      break
    fi
    if [[ "${START:-0}" -ge 1 ]] && ! pgrep -f "tsx src/cli.ts jobs" >/dev/null 2>&1; then
      fail "jobs died after claim_start — see $LOG_DIR/jobs.log"
    fi
    sleep 1
  done
  if [[ "$PLACE_OK" -ne 1 ]]; then
    log "WARN: no place-tile yet — check $LOG_DIR/jobs.log (rate-limit or still seeding)"
  fi
fi

cat <<EOF

[new-game] ready
  game     $GAME_ID
  player   $PLAYER_ID
  gateway  $GATEWAY_BASE
  ui       http://localhost:5173/  (hard-refresh if the old game is still showing)
  logs     $LOG_DIR/

EOF
