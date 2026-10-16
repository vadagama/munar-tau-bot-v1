#!/bin/sh
# Обёртка запуска Supabase MCP для Zed (context_servers).
# SUPABASE_ACCESS_TOKEN читается из source/.env.local — секреты не хранятся в settings.json.
# Базовый каталог source/ фиксируем абсолютно: скрипт лежит в source/tools/scripts.
BASE=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)

if [ ! -f "$BASE/.env.local" ]; then
  echo "supabase-mcp-wrapper: не найден $BASE/.env.local" >&2
  exit 1
fi

set -a
. "$BASE/.env.local"
set +a

if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  echo "supabase-mcp-wrapper: SUPABASE_ACCESS_TOKEN пуст — заполните его в $BASE/.env.local" >&2
fi

exec /Users/olegkrasnov/.local/bin/npx -y @supabase/mcp-server-supabase@latest --project-ref fuwsmewtmxmzttwkbdex
