# SPEC: registration-binding — анкета с непривязанным помещением

Модуль `registration-binding`; карта возможностей и контекст — `docs/ideas/registration-and-request-flow.md`. Статус: на ревью.

## Цель

Убрать тупик регистрации «Помещение не найдено. Проверьте номер или обратитесь к администратору»: житель всегда доходит до отправки анкеты. Помещение, которое не удалось указать точно (дом/тип/номер), описывается произвольным текстом и привязывается администратором в кабинете до подтверждения анкеты.

Пользователи: житель, не знающий код дома или не находящий своё помещение по номеру; администратор, рассматривающий анкеты.

Основание: правка REG-01/REG-02 (анкета содержит либо дом/тип/номер, либо произвольное описание помещения; администратор привязывает до решения). Решение о гибриде — 19.10.2026.

## Что меняется

### Схема (миграция в `source/db/migrations/`)

- `alter table registration alter column premises_id drop not null;`
- Текст помещения хранится в `draft.premises_text` (draft jsonb уже хранит full_name/phone/language); отдельная колонка не нужна.
- Обратная совместимость: существующие строки не трогаются; `premises_id is null` допустим только при непустом `draft.premises_text` (проверка CHECK).

### Бот (`source/core/src/bot/registration.ts`)

- Шаг `number`: помещение не найдено → вместо тупика новый шаг `premises_text`: приглашение описать помещение своими словами (пример: «дом 107/2, квартира 5, я второй собственник»), лимит 300 символов, команда `/requestcancel`-эквивалент — `/cancel`.
- После `premises_text` — существующий шаг `role`, далее согласие. В state: `premises_text`, `premises_id` отсутствует.
- Быстрый путь (дом → тип → номер → роль) не меняется; `/add` и приглашения (`invite_*`) не меняются.
- `/status`, `registrationLines`: для непривязанной анкеты показывается текст с пометкой «уточняется администратором» (шаблон каталога).

### Домен (`source/core/src/domains/registrations/service.ts`)

- `submitRegistration`: принимает отсутствие `premises_id` при наличии `draft.premises_text`. Для непривязанной анкеты: `review_stage='administrator'`, таймер этапа стартует как обычно; уведомление — действующим администраторам без домового сужения (область — вся ОСИ, см. открытые вопросы).
- Новое действие `bindPremises(deps, actor, id, { premises_id, reason? })`:
  - privileged-операция через общий конвейер API (PDP/requireBuilding по дому помещения, аудит `registration.bind_premises`, Idempotency-Key);
  - переводит анкету в обычный маршрут: `role='owner'` → `initialStage(building)`; `role='tenant'/'resident'` → стадия `owner` с таймером `tenant_wait` (REG-04 стартует с привязки);
  - уведомления собственникам/проверяющим — как при обычной подаче;
  - повторная привязка поверх существующего `premises_id` — запрещена (`INVALID_TRANSITION`); смена привязки до решения — через отказ/уточнение, не тихо.
- `reviewRegistration`/споры: `approve`/`reject`/`dispute` при `premises_id is null` — `INVALID_TRANSITION` «Сначала привяжите помещение»; `clarify` доступен и без привязки (не требует домовой области).
- `listRegistrations`: LEFT JOIN premises; непривязанные анкеты видны администраторам независимо от домовой области (до привязки у них нет дома) и помечены `premises_text`.

### Кабинет (`source/admin/src/pages/registrations.tsx`)

- Карточка непривязанной анкеты: текст жителя + статус «помещение не определено».
- Действие «Привязать помещение»: выбор дом → тип → номер (поиск; данные реестра), необязательная причина; после привязки — обычные решения. Кнопки/форма рядом с записью (правила PageLayout).

### Шаблоны (ADR-010/011)

- Новые ключи в `source/core/src/templates/catalog/messages-registration.ts` + `templates/fixtures/registration.json`: приглашение к текстовому вводу, пометка в статусе, уведомления о привязке. Оба языка ru/kk; существующие ключи не переименовывать (append-only).

## Команды

Из `source/`:

- Проверки: `npm run lint && npm run typecheck && npm test`; `deno task check && deno task lint && deno task test`
- Миграция на dev-стенд: `npm run db:push`
- Интеграционные: `RUN_INTEGRATION_TESTS=1 npm run test:integration` — **только по явному запросу пользователя** (правило от 17.10.2026; пропущенные проверки не считать пройденными)

## Структура (что трогаем)

- `source/db/migrations/` — новая миграция
- `source/core/src/bot/registration.ts` (+ `registration.test.ts`, `registration-task-messages.test.ts`)
- `source/core/src/domains/registrations/service.ts` (+ `service.test.ts` in-memory; интеграционный тест — в git, не запускается автоматически)
- `source/functions/api/registry-handlers.ts` — маршрут `POST /v1/registrations/:id/bind`
- `source/admin/src/pages/registrations.tsx` (+ `registrations.test.tsx`)
- `source/core/src/templates/catalog/messages-registration.ts`, `templates/fixtures/registration.json`
- `docs/requirements-v1.md` (REG-01/REG-02), `docs/decisions/015-*.md` (новый ADR) + индекс `docs/README.md`

## Code Style (существенные ограничения)

- Реплики — только через каталог: `message(deps.templates, L, "message.registration.premises_text", …)`; весь пользовательский текст через `esc()`; ответы одним языком по `profile.language`.
- Права — сервером (PDP/`requireBuilding`); мутации — в `deps.db.transaction`; аудит `recordAudit` с buildingIds.
- Таймеры — через `startTimer` с ключами каталога TIM; никаких локальных сроков.

## Testing Strategy

- Unit (Vitest): сценарий «не найдено → текст → роль → согласие» создаёт `pending_review` c `draft.premises_text` и без `premises_id`; `bindPremises` — маршруты этапов (owner/tenant), права, аудит, повторная привязка; review до привязки — `INVALID_TRANSITION`; `clarify` без привязки работает.
- Golden-фикстуры каталога: новые ключи на ru и kk, кнопки, переменные.
- Integration (сохраняется в git, запуск ручной): миграция идемпотентна; непривязанные видны администраторам; аудит append-only; approve после привязки создаёт связь как раньше.
- Кабинет: `registrations.test.tsx` — карточка непривязанной анкеты и действие привязки.

## Boundaries

- Always: шаблоны через каталог (ru+kk); `esc()` пользовательского текста; серверные проверки прав; аудит и Idempotency-Key на привязке; тесты рядом с изменениями.
- Ask first: видимость непривязанных анкет при появлении домовых областей; поведение при попытке привязки после начала спора; добавление обязательной причины привязки.
- Never: подтверждение/отклонение анкеты без привязанного помещения; обход PDP; переименование существующих ключей шаблонов; автозапуск интеграционных тестов; правка правил в обход AGENTS.md.

## Success Criteria

1. E2E: анкета с текстом отправляется → `pending_review`, `/status` показывает текст с пометкой; администратор видит карточку, привязывает помещение; для tenant стартует стадия собственника (48 ч); `approve` создаёт связь, как раньше.
2. Быстрый путь, `/add`, приглашения, споры — без поведенческих изменений.
3. `npm run lint/typecheck/test` и deno-проверки зелёные; новые unit/golden-тесты зелёные; интеграционные написаны и сохранены (не запускались — ручной режим).
4. REG-01/REG-02 обновлены, ADR-015 создан и добавлен в индекс.

## Open Questions

- Видимость непривязанных анкет «всем администраторам» — норм пока область «вся ОСИ»; пересмотреть при вводе домовых областей.
- Причина привязки — необязательная (дефолт). Нужно ли обязательной?
- Формулировки приглашения и пометки ru/kk — финализировать при правке каталога.
