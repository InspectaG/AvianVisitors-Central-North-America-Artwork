#!/usr/bin/env bash
set -u

DB="${AVIAN_MIRROR_DB:-/home/birdnet/BirdNET-Pi/scripts/birds.db}"
ENV_FILE="${AVIAN_MIRROR_ENV:-/home/birdnet/.avian-visitors-mirror.env}"
EXPORT="${AVIAN_MIRROR_EXPORT:-/home/birdnet/BirdNET-Pi/scripts/avian-mirror-export.py}"
OUT="${AVIAN_MIRROR_OUT:-/tmp/avian-visitors-last-snapshot.json}"
DEBOUNCE_SECONDS="${AVIAN_MIRROR_DEBOUNCE_SECONDS:-20}"
LOCK_FILE="${AVIAN_MIRROR_LOCK:-/tmp/avian-visitors-mirror-push.lock}"
WATCH_LOCK="${AVIAN_MIRROR_WATCH_LOCK:-/tmp/avian-visitors-watch-push.lock}"

log() {
  printf '%s avian-mirror-watch: %s\n' "$(date -Is)" "$*"
}

push_snapshot() {
  (
    if ! flock -n 9; then
      log "push already running; skipped"
      exit 0
    fi
    if [ ! -r "$ENV_FILE" ]; then
      log "missing env file: $ENV_FILE"
      exit 1
    fi
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
    log "posting updated snapshot"
    /usr/bin/python3 "$EXPORT" --out "$OUT" --post
  ) 9>"$LOCK_FILE"
}

schedule_push() {
  if [ -n "${pending_pid:-}" ] && kill -0 "$pending_pid" 2>/dev/null; then
    return
  fi
  (
    sleep "$DEBOUNCE_SECONDS"
    push_snapshot
  ) &
  pending_pid=$!
}

poll_fallback() {
  log "inotifywait unavailable; falling back to polling"
  local last_state=""
  while true; do
    local state=""
    if [ -e "$DB" ]; then
      state="$(stat -c '%Y:%s' "$DB" 2>/dev/null || stat -f '%m:%z' "$DB" 2>/dev/null || true)"
    fi
    if [ -n "$state" ] && [ "$state" != "$last_state" ]; then
      last_state="$state"
      schedule_push
    fi
    sleep 10
  done
}

main() {
  exec 8>"$WATCH_LOCK"
  if ! flock -n 8; then
    log "watcher already running; exiting"
    exit 0
  fi

  if [ ! -e "$DB" ]; then
    log "database not found yet: $DB"
  fi

  local db_dir
  db_dir="$(dirname "$DB")"
  if ! command -v inotifywait >/dev/null 2>&1; then
    poll_fallback
    return
  fi

  log "watching $DB"
  inotifywait -m -q -e modify,close_write,moved_to,create,delete "$db_dir" |
    while read -r _dir _events file; do
      case "$file" in
        birds.db|birds.db-wal|birds.db-journal)
          schedule_push
          ;;
      esac
    done
}

main "$@"
