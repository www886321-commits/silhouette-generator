#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if command -v node >/dev/null 2>&1; then
  node local-server.mjs --stop
else
  python3 local-server.py --stop
fi
