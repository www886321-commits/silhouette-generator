#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1

if command -v node >/dev/null 2>&1; then
  node local-server.mjs --start
elif command -v python3 >/dev/null 2>&1; then
  python3 local-server.py --start
else
  echo "未找到 Node.js 或 Python 3。请让 AI Agent 按照 AGENT-INSTALL.md 安装。"
  exit 1
fi
