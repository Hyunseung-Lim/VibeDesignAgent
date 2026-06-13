#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/Users/sunmyeong/Documents/VibeDesignAgent"
cd "$ROOT_DIR"

if [ ! -f ".env" ]; then
  echo "Missing .env at $ROOT_DIR/.env" >&2
  exit 1
fi

set -a
source ".env"
set +a

if [ -z "${NOTION_API_TOKEN:-}" ]; then
  echo "Missing NOTION_API_TOKEN in $ROOT_DIR/.env" >&2
  exit 1
fi

export OPENAPI_MCP_HEADERS
OPENAPI_MCP_HEADERS="$(
  node -e 'process.stdout.write(JSON.stringify({
    Authorization: `Bearer ${process.env.NOTION_API_TOKEN}`,
    "Notion-Version": "2022-06-28"
  }))'
)"

exec npx -y @notionhq/notion-mcp-server
