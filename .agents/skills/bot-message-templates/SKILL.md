---
name: bot-message-templates
description: Чтение и правка каталога шаблонов сообщений Telegram-ботов ОСИ — страница /templates кабинета (https://osi-admin.pages.dev/templates) над каталогом source/core/src/templates/catalog. Быстрый список шаблонов, структура и содержимое конкретного шаблона, правка текстов ru/kk одного или нескольких шаблонов по промпту, добавление и удаление управляющих кнопок, обновление golden-фикстур и проверки. Use when the task touches bot message templates, кнопки сообщений и reply-меню ботов, каталог templates или страницу /templates кабинета.
---

# Шаблоны сообщений ботов (кабинет /templates)

## Карта слоёв

Страница https://osi-admin.pages.dev/templates — редактор кабинета над двумя слоями:

1. **Дефолты в коде** — `source/core/src/templates/catalog/` (ADR-010/011). Единственный слой, который правит агент. Ключи стабильны, каталог объединяет оба бота (ADR-009).
2. **Переопределения в БД** — `message_template` / `message_template_version` (append-only). Правятся только из кабинета: privileged-действие `settings.templates.edit` (chairman/administrator/tech_admin), оба языка, причина, аудит, Idempotency-Key. Откат и сброс создают новые версии; UPDATE/DELETE версий запрещены триггером; сброс кнопок хранит SQL NULL, не JSON null. Агент БД напрямую не правит.

Активный текст = последняя версия БД, иначе дефолт каталога. Подписи кнопок резолвит `messageButton(store, lang, key, id)` в `source/core/src/templates/message.ts`: из `buttons_ru/buttons_kk` версии, иначе из каталога; обрезка до 64 символов (лимит Telegram).

Код страницы кабинета — `source/admin/src/pages/templates.tsx` (правки UI — навык `frontend-ui-engineering`, не этот).

## Карта каталога

| Файл (`source/core/src/templates/catalog/`) | Содержимое |
| --- | --- |
| `types.ts` | `TemplateDef`, `MessageButton { id, ru, kk, variables? }`, `MessageExample` |
| `index.ts` | Сборка `TEMPLATE_CATALOG`; новые «целые сообщения» из `messages-*.ts` перекрывают legacy-фрагменты по ключу; непоглощённые legacy получают `deprecated: true` |
| `messages-requests.ts`, `messages-registration-tasks.ts`, `messages-other.ts` | Целые сообщения сценариев; кнопки объявлены здесь: `consentButtons`, `taskButtons`, `overrides` (кнопки для legacy-ключей), `completeDefs` (варианты по состоянию задания, фильтр кнопок через `stateButton`) |
| `common.ts`, `notices.ts`, `notifications.ts`, `requests.ts`, `inbound.ts`, `help.ts`, `request-text.ts`, `request-files.ts`, `incidents.ts`, `tasks.ts`, `registration.ts`, `errors.ts`, `staff.ts` | Legacy-фрагменты и уведомления; их литералы закреплены golden-фикстурами `source/core/src/templates/fixtures/*.json` |

Структура `TemplateDef`:

```
key, section (registration|requests|tasks|incidents|help|errors|notices|common),
title, description, variables: { name, description, example }[],
ru, kk,                        // дефолтные тексты, Telegram HTML
deprecated?, scenario?, command?, legacyKeys?,
buttons?: MessageButton[],     // { id, ru, kk }
examples?: MessageExample[]    // превью на вымышленных данных
```

## Быстрый список шаблонов

Из корня репозитория:

```sh
deno run .agents/skills/bot-message-templates/list.ts --key <подстрока>
```

Печатает `key`, section, scenario/command, подписи кнопок, title. Без `--key` — весь каталог; `--section <id>` — только один раздел; `--json` — машинный вывод. Если Deno недоступен — `grep -rn "key:" source/core/src/templates/catalog/`.

## Структура и содержимое шаблона

```sh
deno run .agents/skills/bot-message-templates/list.ts --full <точный-key>
```

Печатает все поля: описание, переменные с примерами, полные тексты ru и kk, кнопки, кнопки примеров. Альтернатива: `grep -rn "<key>" source/core/src/templates/catalog/`, затем чтение определения.

## Правка текстов (одного или нескольких шаблонов)

1. Найдите шаблон(ы) списком выше, определите файл. Для пакета правок обработайте каждый ключ одним циклом и в конце дайте сводку «key: старый текст → новый» по обоим языкам.
2. Правьте дефолт в каталоге. Правила (нарушение отклоняется при сохранении и ломает тесты):
   - Оба языка обязательны: ru и kk правятся вместе.
   - Переменные `{name}` — только описанные в `variables`; новая переменная получает запись `name/description/example`; неизвестные переменные отклоняются (`validateTemplate`).
   - Telegram HTML: только `b, i, u, s, code, pre, a, tg-spoiler, blockquote`; атрибуты запрещены, кроме постоянного `href` с `http(s)://` или `tg://`; подстановка в атрибуты не поддерживается. Значения переменных — текст через `esc()`; `safeBlock` — только серверные списки.
   - Не более 4000 символов на язык.
   - Условные части — отдельные варианты шаблонов, не условия в тексте; повторяющиеся строки и история — серверные блоки.
   - Ключи, `legacyKeys`, сценарии, команды и адресаты не меняются; исторические подписи reply-меню сохраняют маршрутизацию.
3. Golden-фикстуры: если ключ закреплён (`grep -rl '"<key>"' source/core/src/templates/fixtures/`), обновите его `ru`/`kk` в JSON идентично новому дефолту. Ключи `message.*` в фикстурах не закреплены.
4. Проверки (из `source/`): точечно `npm test -w core -- templates`, затем `npm test`, `npm run lint`, `npm run typecheck`. Интеграционные тесты не запускать (см. AGENTS.md).
5. Ветка и PR — по навыку `git-workflow-and-versioning`.

## Кнопки: добавить / удалить / переименовать

- Подписи кнопок входят в версию вместе с текстом (ADR-011): в каталоге — `MessageButton { id, ru, kk }` в `buttons` шаблона; в БД — `buttons_ru/buttons_kk` (JSON-объект `id → подпись`).
- **id и действие кнопки задаёт код.** Добавление кнопки меняет не только каталог, но и обработчик в `source/core/src/bot/`: call-site вида `btn(messageButton(store, lang, key, id, vars), callbackData)`. `messageButton` бросает `Unknown message button: key/id`, если id отсутствует в каталоге, — удалять или переименовывать id можно только вместе со всеми call-sites и их тестами. Быстрый поиск мест: `grep -rn "messageButton(" source/core/src/`.
- Подпись ≤ 64 символа; переменные в подписи подставляются из `vars` call-site'а.
- Типовые места кнопок: `messages-registration-tasks.ts` (`consentButtons`, `taskButtons`, `overrides` для legacy-ключей, `stateButton` — какие кнопки у какого состояния задания), `bot/registration.ts` (язык, здание, confirm/cancel), `bot/request-text.ts` (`open_draft`), `bot/incidents.ts`, `bot/help.ts` (reply-меню: `MENU_LABELS` + `historicalButtons`).
- Коллизии подписей разных действий отклоняются под транзакционной блокировкой (сервис сохранения) — не заводите две кнопки с одинаковой подписью на одном ключе.
- Примеры в каталоге (`examples[].buttons`) обновляются вместе с кнопками: тесты сверяют превью с фактическим выводом бота (`registration-task-messages.test.ts`).
- При деплое миграция кнопок (`source/db/migrations/*_message_buttons.sql`) предшествует функциям.

## Не делать

- Не править БД-переопределения и версии напрямую — только кабинет, append-only.
- Не менять идентификаторы и действия кнопок, FSM, полномочия, адресатов и условия отправки — это код, а не каталог (ADR-010).
- Не добавлять реплики и уведомления строками в сценариях — только через каталог.
- Описания команд, словари состояний и авторский контент в каталоге не редактируются.
- Не заводить новые ключи без необходимости: сначала проверьте, что подходящего шаблона нет в списке.
