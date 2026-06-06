#!/bin/bash
# Local Jekyll dev server.
# Usage: bin/jekyll-dev.sh {start|stop|restart}

set -euo pipefail

# 切到项目根目录
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# 端口可通过环境变量 JEKYLL_PORT 覆盖，默认 4000
PORT="${JEKYLL_PORT:-4000}"

# 要求 Ruby >= 3.0
ruby_ver=$(ruby -e 'puts RUBY_VERSION' 2>/dev/null | cut -d. -f1)
if [[ "${ruby_ver:-0}" -lt 3 ]]; then
  echo "Error: Ruby 3.0+ required, got $(ruby -e 'puts RUBY_VERSION' 2>/dev/null || echo 'unknown')"
  echo "Please set PATH to a newer Ruby before running this script"
  exit 1
fi

start() {
  # 确保依赖就绪，缺失则安装
  bundle check >/dev/null 2>&1 || bundle install
  echo "Starting at http://127.0.0.1:${PORT}/"
  # 后台启动，日志写 /tmp/jekyll.log
  nohup bundle exec jekyll serve --host 0.0.0.0 --port "$PORT" --livereload >/tmp/jekyll.log 2>&1 &
  # 轮询等待端口就绪，避免访问过早返回 404
  echo -n "Waiting for server"
  while ! nc -z 127.0.0.1 "$PORT" 2>/dev/null; do
    echo -n "."
    sleep 1
  done
  echo " ready!"
}

stop() {
  # 匹配所有 "jekyll serve" 进程并终止
  pkill -f "jekyll serve" || true
  echo "Stopped"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  *) echo "usage: $0 {start|stop|restart}" >&2; exit 1 ;;
esac