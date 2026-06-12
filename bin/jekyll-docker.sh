#!/bin/bash
# Jekyll dev server via Docker.
# Usage: bin/jekyll-docker.sh {start|stop|restart|logs}

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PORT="${JEKYLL_PORT:-4000}"

usage() {
  echo "usage: $0 {start|stop|restart|logs}"
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "Error: docker compose or docker-compose is required" >&2
    exit 1
  fi
}

start() {
  echo "Starting at http://127.0.0.1:${PORT}/"
  compose up --build -d
  echo "Server is running in background."
  echo "View logs: $0 logs"
  echo "Open site: http://127.0.0.1:${PORT}/"
}

stop() {
  compose down
  echo "Stopped"
}

logs() {
  compose logs -f
}

case "${1:-}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; start ;;
  logs)    logs ;;
  *)       usage >&2; exit 1 ;;
esac
