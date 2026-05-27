#!/bin/bash
# Local Jekyll dev server.
# Usage: bin/jekyll-dev.sh {start|stop|restart|status}

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PORT="${JEKYLL_PORT:-4000}"
PIDFILE="/tmp/puppylpg-jekyll.pid"
LOGFILE="/tmp/puppylpg-jekyll.log"
URL="http://127.0.0.1:${PORT}/"

# macOS Homebrew Ruby (system Ruby 2.6 ships bundler 1.17, Gemfile.lock needs 2.x).
for d in /opt/homebrew/opt/ruby/bin /usr/local/opt/ruby/bin; do
  [[ -d "$d" ]] && export PATH="$d:$PATH" && break
done

is_running() {
  [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

start() {
  if is_running; then
    echo "already running at ${URL} (pid $(cat "$PIDFILE"))"
    return 0
  fi
  bundle check >/dev/null 2>&1 || bundle install
  echo "==> starting at ${URL} (log: ${LOGFILE})"
  nohup bundle exec jekyll serve --host 0.0.0.0 --port "$PORT" --livereload \
    >"$LOGFILE" 2>&1 &
  echo $! >"$PIDFILE"
  for _ in $(seq 1 60); do
    curl -sf -o /dev/null "$URL" && { echo "==> ready"; return 0; }
    sleep 1
  done
  echo "did not respond in time, see $LOGFILE" >&2
  return 1
}

stop() {
  if [[ -f "$PIDFILE" ]]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    rm -f "$PIDFILE"
  fi
  pkill -f "jekyll serve.*--port ${PORT}" 2>/dev/null || true
  echo "==> stopped"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status)
    if is_running; then echo "running ${URL} (pid $(cat "$PIDFILE"))"
    else echo "stopped (port ${PORT})"; fi ;;
  *) echo "usage: $0 {start|stop|restart|status}" >&2; exit 1 ;;
esac
