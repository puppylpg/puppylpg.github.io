#!/bin/bash
# Local Jekyll dev server (sync repo -> WSL build dir, then serve).
# Usage: bin/jekyll-dev.sh {start|stop|restart|status|sync|help}

set -euo pipefail

if [[ -n "${JEKYLL_REPO_ROOT:-}" ]]; then
  ROOT="$(cd "$JEKYLL_REPO_ROOT" && pwd)"
else
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

if [[ ! -f "$ROOT/Gemfile" ]]; then
  echo "Error: repo root invalid ($ROOT): Gemfile not found." >&2
  echo "Set JEKYLL_REPO_ROOT or run from the project directory." >&2
  exit 1
fi
DST="${JEKYLL_DEV_DIR:-/tmp/puppylpg-build4}"
VENDOR_CACHE="${JEKYLL_VENDOR_CACHE:-/tmp/puppylpg-vendor-bundle}"
PORT="${JEKYLL_PORT:-4000}"
PIDFILE="$DST/.jekyll-dev.pid"
LOGFILE="$DST/.jekyll-dev.log"
URL="http://127.0.0.1:${PORT}/"

setup_path() {
  local gem_bin bundle_bin
  for gem_bin in "$HOME/.local/share/gem/ruby/"*/bin; do
    [[ -d "$gem_bin" ]] || continue
    export PATH="$gem_bin:$PATH"
    break
  done
  bundle_bin="$(find "$DST/vendor/bundle/ruby" -maxdepth 2 -name bundle -type f 2>/dev/null | head -1 || true)"
  if [[ -n "$bundle_bin" ]]; then
    export PATH="$(dirname "$bundle_bin"):$PATH"
  fi
  export PATH="/usr/bin:/bin:$PATH"
}

build_dir_corrupted() {
  [[ -d "$DST/etc" ]] || [[ -L "$DST/lib" ]] || [[ -d "$DST/home" ]]
}

restore_vendor_cache() {
  [[ -d "$VENDOR_CACHE" ]] || return 1
  echo "==> Restore gems from cache ($VENDOR_CACHE)"
  mkdir -p "$DST/vendor"
  rm -rf "$DST/vendor/bundle"
  cp -a "$VENDOR_CACHE" "$DST/vendor/bundle"
}

save_vendor_cache() {
  [[ -d "$DST/vendor/bundle" ]] || return 0
  echo "==> Save gems to cache ($VENDOR_CACHE)"
  rm -rf "$VENDOR_CACHE"
  cp -a "$DST/vendor/bundle" "$VENDOR_CACHE"
}

bundle_install_if_needed() {
  setup_path
  (
    cd "$DST"
    if bundle check >/dev/null 2>&1; then
      echo "==> Gems OK (bundle check)"
      return 0
    fi
    restore_vendor_cache || true
    if bundle check >/dev/null 2>&1; then
      echo "==> Gems OK (restored from cache)"
      return 0
    fi
    echo "==> bundle install (first run downloads dart-sass from GitHub; needs network)"
    local attempt
    for attempt in 1 2 3; do
      if bundle install; then
        save_vendor_cache
        bundle check
        return 0
      fi
      echo "==> bundle install failed (attempt $attempt/3), retry in 5s..." >&2
      sleep 5
    done
    echo "Error: bundle install failed. sass-embedded needs github.com — check VPN/proxy, then retry." >&2
    return 1
  )
}

sync_repo() {
  echo "==> Sync $ROOT -> $DST"
  if build_dir_corrupted; then
    echo "==> Cleaning corrupted build dir: $DST"
    rm -rf "$DST"
  fi
  mkdir -p "$DST/.bundle"
  printf '%s\n' '---' 'BUNDLE_PATH: "vendor/bundle"' >"$DST/.bundle/config"
  (
    cd "$ROOT"
    tar --exclude=vendor --exclude=_site --exclude=.git --exclude=.jekyll-cache --exclude=.bundle \
      -cf - . | tar -C "$DST" -xf -
  )
  bundle_install_if_needed
  echo "==> Sync done."
}

is_running() {
  if [[ -f "$PIDFILE" ]]; then
    local pid
    pid="$(cat "$PIDFILE")"
    if kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  pgrep -f "jekyll serve.*--port ${PORT}" >/dev/null 2>&1
}

stop_server() {
  echo "==> Stopping Jekyll on port ${PORT}..."
  if [[ -f "$PIDFILE" ]]; then
    local pid
    pid="$(cat "$PIDFILE")"
    kill "$pid" 2>/dev/null || true
    rm -f "$PIDFILE"
  fi
  pkill -f "jekyll serve.*--port ${PORT}" 2>/dev/null || true
  sleep 1
  if is_running; then
    echo "Warning: process may still be running."
    return 1
  fi
  echo "==> Stopped."
}

wait_for_server() {
  local i
  for i in $(seq 1 60); do
    if curl -sf -o /dev/null "$URL" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_server() {
  if is_running; then
    echo "Jekyll already running at ${URL}"
    echo "Use: bin/jekyll-dev.sh restart"
    return 0
  fi

  sync_repo
  setup_path
  mkdir -p "$DST"
  echo "==> Starting Jekyll at ${URL} (log: ${LOGFILE})"
  (
    cd "$DST"
    nohup bundle exec jekyll serve \
      --host 0.0.0.0 \
      --port "$PORT" \
      --force_polling \
      --livereload \
      >"$LOGFILE" 2>&1 &
    echo $! >"$PIDFILE"
  )

  if wait_for_server; then
    echo "==> Ready: ${URL}"
    echo "    Log:  tail -f ${LOGFILE}"
    echo "    Stop: bin/jekyll-dev.sh stop"
  else
    echo "Server did not respond in time. Last log lines:"
    tail -20 "$LOGFILE" 2>/dev/null || true
    return 1
  fi
}

cmd_status() {
  if is_running; then
    echo "running  ${URL}"
    if [[ -f "$PIDFILE" ]]; then
      echo "pid      $(cat "$PIDFILE")"
    fi
    echo "build    ${DST}"
    echo "log      ${LOGFILE}"
  else
    echo "stopped  (port ${PORT})"
  fi
}

cmd_help() {
  cat <<EOF
Local Jekyll dev helper

  bin/jekyll-dev.sh start     Sync repo, start server (default port ${PORT})
  bin/jekyll-dev.sh stop      Stop server
  bin/jekyll-dev.sh restart   stop + sync + start
  bin/jekyll-dev.sh status    Show running / stopped
  bin/jekyll-dev.sh sync      Sync repo + bundle install only

Environment:
  JEKYLL_DEV_DIR      Build directory (default: ${DST})
  JEKYLL_VENDOR_CACHE Cached vendor/bundle (default: ${VENDOR_CACHE})
  JEKYLL_PORT         HTTP port (default: ${PORT})

Windows (PowerShell):
  .\\bin\\jekyll-dev.ps1 start

Notes:
  - Gems run in WSL; site source is copied to \${JEKYLL_DEV_DIR} for fast builds.
  - Gems are cached at \${JEKYLL_VENDOR_CACHE} so restart does not reinstall every time.
  - Edit files in the git repo, then: restart (or sync + wait for auto-regen).
EOF
}

main() {
  local cmd="${1:-help}"
  case "$cmd" in
    start) start_server ;;
    stop) stop_server ;;
    restart) stop_server || true; start_server ;;
    status) cmd_status ;;
    sync) sync_repo ;;
    help | -h | --help) cmd_help ;;
    *)
      echo "Unknown command: $cmd" >&2
      cmd_help
      exit 1
      ;;
  esac
}

main "$@"
