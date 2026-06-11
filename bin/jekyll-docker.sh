#!/bin/bash
# Jekyll dev server via Docker.
# Usage: bin/jekyll-docker.sh {start|stop|restart|logs}

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PORT="${JEKYLL_PORT:-4000}"

usage() {
  echo "usage: $0 {start|stop|restart|logs}"
}

start() {
  echo "Starting at http://127.0.0.1:${PORT}/"
  docker compose up --build -d
  echo "Server is running in background."
  echo "View logs: $0 logs"
  echo "Open site: http://127.0.0.1:${PORT}/"
}

stop() {
  docker compose down
  echo "Stopped"
}

logs() {
  docker compose logs -f
}

case "${1:-}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; start ;;
  logs)    logs ;;
  *)       usage >&2; exit 1 ;;
esac
