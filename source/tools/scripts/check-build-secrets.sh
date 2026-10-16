#!/usr/bin/env sh
# Проверка артефактов сборки на утечку секретов (Task 7 VS-0; HLD §15, ADR-002,
# AGENTS.md «Границы и безопасность»: в браузере допустим только publishable key).
#
# Использование: sh tools/scripts/check-build-secrets.sh <путь...>
#   например: sh tools/scripts/check-build-secrets.sh admin/dist
# Выход: 0 — секретов не найдено; 1 — найдено совпадение (CI падает).
set -eu

if [ "$#" -eq 0 ]; then
  echo "Ошибка: укажите путь для сканирования, например: $0 admin/dist" >&2
  exit 2
fi

for dir in "$@"; do
  if [ ! -d "$dir" ]; then
    echo "Ошибка: каталог '$dir' не найден (сначала выполните сборку)" >&2
    exit 2
  fi
done

# Паттерны:
#   sb_secret_+тело        — ключи Supabase нового формата (secret/api);
#                            тело [A-Za-z0-9]{20,} отсекает литерал "sb_secret_"
#                            из кода @supabase/supabase-js (проверка формата
#                            ключа в рантайме — не секрет)
#   service_role           — упоминание сервисной роли (ключ/заголовок)
#   c2VydmljZV9yb2xl       — base64("service_role"), как в JWT-полезной нагрузке
#   bot<цифры>:<токен>     — Telegram bot token в форме URL/строки
#   PRIVATE KEY            — блок приватного ключа
patterns='sb_secret_[A-Za-z0-9]{20,}|service_role|c2VydmljZV9yb2xl|bot[0-9]{5,}:[A-Za-z0-9_-]{30,}|BEGIN [A-Z ]*PRIVATE KEY'

found=0
for dir in "$@"; do
  matches=$(grep -rEIn "$patterns" "$dir" || true)
  if [ -n "$matches" ]; then
    found=1
    echo "НАЙДЕНЫ совпадения с паттернами секретов в '$dir':" >&2
    echo "$matches" >&2
  fi
done

if [ "$found" -ne 0 ]; then
  echo "Сборка содержит возможные секреты — публикация запрещена." >&2
  exit 1
fi

echo "Секретов не найдено: $*"
