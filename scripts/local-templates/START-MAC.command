#!/bin/zsh
cd "$(dirname "$0")" || exit 1

if command -v node >/dev/null 2>&1; then
  node local-server.mjs --start
elif command -v python3 >/dev/null 2>&1; then
  python3 local-server.py --start
else
  echo "这台 Mac 尚未安装 Node.js 或 Python 3。"
  echo "请把整个工具包交给 AI Agent，并让它按照 AGENT-INSTALL.md 安装。"
  read "?按回车键关闭..."
  exit 1
fi
