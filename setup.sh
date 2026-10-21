#!/usr/bin/env bash
set -euo pipefail

python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements-dev.txt
cp -n .env.example .env 2>/dev/null || true
python -m pytest

echo
echo "Backend is ready. Start it with:"
echo "  source .venv/bin/activate && python -m server.mcp_server"
echo
echo "In another terminal, start the web app with:"
echo "  cd web && npm install && npm run dev"
