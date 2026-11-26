#!/usr/bin/env bash
# Tonnetz Lite — macOS / Linux launcher.
set -euo pipefail
cd "$(dirname "$0")"

for py in python3 python; do
  if command -v "$py" >/dev/null 2>&1 && "$py" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 8) else 1)' >/dev/null 2>&1; then
    exec "$py" serve.py "$@"
  fi
done

echo "未找到 Python 3.8+。" >&2
echo "可安装 Python 3，或在本目录运行任意静态服务器，例如：" >&2
echo "  python3 -m http.server 8850 --bind 127.0.0.1" >&2
exit 1
