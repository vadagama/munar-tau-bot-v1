# Implementation Plan: Регистрация с уточнением помещения и новый сценарий обращения

Спеки: `docs/specs/SPEC-request-flow.md`, `docs/specs/SPEC-registration-binding.md`. Идея и карта возможностей: `docs/ideas/registration-and-request-flow.md`. Статус: на ревью.

## Overview

Два независимых модуля: `request-flow` (вид и адресат при создании обращения — только бот и каталог шаблонов) и `registration-binding` (непривязанная анкета — миграция, домен, бот, кабинет). Порядок: сначала `request-flow` (меньше, без схемы), затем `registration-binding`. Задачи — вертикальные срезы, каждая оставляет систему рабочей.

Задачи этого плана живут в этом файле (конвенция проекта — `tasks/plan-*.md`); общий `tasks/plan.md` (VS-0) и `tasks/todo.md` не используются и не изменяются.

## Architecture Decisions

- Порядок фаз: `request-flow` → `registration-binding`; модули независимы, каждая фаза шипуется отдельно (отдельные ветки/PR).
- Реплики — только через каталог шаблонов (ADR-010/011), append-only, ru+kk; миграция кнопок предшествует деплою функций.
- Схема меняется только в `registration-binding`: `registration.premises_id` → nullable + CHECK на связку с `draft.premises_text`.
- Права и аудит — только сервером (PDP/`requireBuilding`, `recordAudit`, Idempotency-Key через общий конвейер API).
- Домен обращений не меняется: `createRequest`/`editRequest` уже принимают и меняют `kind` (в т.ч. для черновика — подтверждено в коде).

## Команды (все — из `source/`)

- Проверки: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build -w admin`; Deno: `deno task check && deno task lint && deno task test`
- Интеграционные: `RUN_INTEGRATION_TESTS=1 npm run test:integration` — только по явному запросу пользователя (правило 17.10.2026; пропущенное не считать пройденным)
- Миграция на dev: `npm run db:push`

## Task List

### Фаза A: request-flow — вид обращения

- [x] **Task A1: Шаг «вид обращения» в сценарии бота** (реализовано 19.10.2026; проверки: lint/typecheck/test/deno — зелёные)
  **Description:** В `/newrequest` (без черновика) первым шагом — выбор вида (Заявка на работу / Вопрос / Жалоба) кнопками из каталога + текстовые эквиваленты ru/kk; выбранное значение идёт в `inputRow.kind` черновика. После выбора — существующий шаг выбора места. Старые черновики (`kind='request'`) возобновляются без ошибок. Дополнительно (решение от обсуждения): `/editrequest` начинается с шага вида, место черновика сохраняется.
  **Acceptance criteria:**
  - [x] Диалог: вид → место → описание; в черновике сохранён выбранный `kind`
  - [x] Недопустимый ввод повторяет вопрос; старый черновик открывается без ошибок
  - [x] Новые реплики — ключами каталога на ru и kk (ключ `message.requests.kind`; golden-фикстуры не нужны — ключи `message.*` в них не закрепляются)
  **Verification:** `npm test -w core` (новые unit-тесты диалога + golden-фикстуры); `deno task check`
  **Dependencies:** нет. **Files:** `core/src/bot/requests.ts`, `core/src/templates/catalog/messages-requests.ts`, `templates/fixtures/requests.json` + тесты. **Scope:** M

- [x] **Task A2: Шаг «адресат» — Мои помещения / Общее имущество** (реализовано 19.10.2026; lint/typecheck/test/deno — зелёные)
  **Description:** После вида — кнопки «Мои помещения» (текущий список `place_options`) и «Общее имущество» (подменю: «В доме» → выбор дома списком как `askBuilding` (пагинация не нужна — ввод кода текстом работает) → текст места; «На территории» → текст места). Прежний текстовый синтаксис «дом КОД …»/«территория …» продолжает работать как альтернативный ввод. Шаг `verify` показывает вид и место. Попутно исправлен SQL поиска дома в шаге place: колонка `building.kind` удалена миграцией REG-11 (запрос падал на актуальной схеме).
  **Acceptance criteria:**
  - [x] Оба пути создают черновик с корректными `premises_id` / `building_id+location_text`
  - [x] Синтаксис-альтернатива и `/objects` работают как раньше
  - [x] В `verify` отображаются вид и место (ключи каталога)
  **Verification:** `npm test -w core`; ручной прогон сценария в симуляторе
  **Dependencies:** A1. **Files:** `core/src/bot/requests.ts`, каталог шаблонов, fixtures + тесты. **Scope:** M

- [x] **Task A3: Документация request-flow** (реализовано 19.10.2026)
  **Description:** REQ-03 (порядок создания: вид → место → описание) и раздел 6 `docs/resident-bot-ui-ux-review.md` синхронизируются с реализацией.
  **Acceptance criteria:** [x] Оба документа согласованы с кодом, ссылок на устаревший синтаксис-инструкцию в основных репликах нет (инструкция убрана из `message.requests.choose_place`, приложение-реестр дополнено шестью новыми ключами, счётчик 81)
  **Verification:** ревью diff. **Dependencies:** A2. **Files:** `docs/requirements-v1.md`, `docs/resident-bot-ui-ux-review.md`. **Scope:** XS

**Checkpoint A:** lint/typecheck/test/build + deno — зелёные; сценарий «вид → адресат → описание» работает в симуляторе; PR `request-flow` готов.

### Фаза B: registration-binding — непривязанная анкета

- [ ] **Task B1: Миграция и домен подачи без помещения**
  **Description:** Миграция (`drop not null` + CHECK «нет premises_id ⇒ непустой draft.premises_text»); `submitRegistration` принимает непривязанную анкету (`review_stage='administrator'`, таймер этапа, уведомления администраторам без домового сужения); `listRegistrations` — LEFT JOIN, непривязанные видны администраторам; `reviewRegistration`: approve/reject/dispute требуют привязки, clarify — нет; эскалации/sweep не падают на `premises_id is null`.
  **Acceptance criteria:**
  - [ ] Непривязанная анкета создаётся, видна в списке и `/status`-источниках данных
  - [ ] Решения до привязки блокируются `INVALID_TRANSITION`, уточнение работает
  - [ ] Миграция идемпотентна (`IF NOT EXISTS`-стиль), существующие строки не затронуты
  **Verification:** `npm test -w core` (in-memory); миграция — ревью SQL + `db:push` на dev по запросу
  **Dependencies:** нет (от фазы A не зависит). **Files:** миграция, `domains/registrations/service.ts`, `jobs.ts` (при необходимости) + тесты. **Scope:** M

- [ ] **Task B2: Бот — шаг «опишите помещение» и отображение статуса**
  **Description:** В мастере регистрации при «помещение не найдено» — шаг `premises_text` (приглашение, лимит 300 символов) вместо тупика; далее роль → согласие как раньше. `/status` и `registrationLines` показывают текст с пометкой «уточняется администратором» до привязки. Ключи каталога + golden.
  **Acceptance criteria:**
  - [ ] Сценарий «не найдено → текст → роль → согласие» создаёт `pending_review` без `premises_id`
  - [ ] Быстрый путь, `/add`, приглашения — без изменений
  - [ ] `/status` корректно отображает оба варианта
  **Verification:** `npm test -w core` (диалог + golden); симулятор
  **Dependencies:** B1. **Files:** `bot/registration.ts`, каталог шаблонов, fixtures + тесты. **Scope:** M

- [ ] **Task B3: Привязка помещения — домен и API**
  **Description:** `bindPremises`: privileged-действие (requireBuilding по дому помещения; маршруты этапов: owner → initialStage, tenant/resident → стадия `owner` + `tenant_wait`; уведомления; аудит `registration.bind_premises`; повторная привязка запрещена). Маршрут `POST /v1/registrations/:id/bind` в `registry-handlers.ts`.
  **Acceptance criteria:**
  - [ ] Привязка переводит анкету в обычный маршрут (для tenant стартует 48 ч собственнику)
  - [ ] Без права на дом помещения — FORBIDDEN; повторная привязка — INVALID_TRANSITION
  - [ ] Аудит записан с buildingIds; идемпотентность повторов через конвейер
  **Verification:** `npm test -w core`; интеграционный тест сохранён в git (не запускается)
  **Dependencies:** B1. **Files:** `service.ts`, `functions/api/registry-handlers.ts` + тесты. **Scope:** S

- [ ] **Task B4: Кабинет — привязка на странице «Регистрации»**
  **Description:** Карточка непривязанной анкеты: текст жителя + статус «помещение не определено»; действие «Привязать помещение» (дом → тип → номер с поиском, необязательная причина); после привязки — обычные решения.
  **Acceptance criteria:**
  - [ ] Действие видно только у непривязанных анкет; после привязки карточка в обычном виде
  - [ ] Форма рядом с записью (правила PageLayout), ошибки API показываются
  **Verification:** `npm test -w admin` (`registrations.test.tsx`); `npm run build -w admin`
  **Dependencies:** B3. **Files:** `admin/src/pages/registrations.tsx` + тест. **Scope:** S

**Checkpoint B:** все проверки зелёные; сквозной сценарий «анкета текстом → привязка → маршрут собственника → approve» пройден на dev-стенде (по запросу); интеграционные тесты написаны и закоммичены.

### Фаза C: документация и приёмка

- [ ] **Task C1: Документация registration-binding**
  **Description:** Правка REG-01/REG-02; ADR-015 «Регистрация с непривязанным помещением» (контекст → решение → альтернативы → проверки) + индекс `docs/README.md`; при необходимости строка в доменных правилах AGENTS.md.
  **Acceptance criteria:** [ ] Документы согласованы, индекс ADR обновлён
  **Verification:** ревью diff. **Dependencies:** B4. **Files:** `docs/requirements-v1.md`, `docs/decisions/015-*.md`, `docs/README.md`, `AGENTS.md`. **Scope:** S

**Checkpoint: Complete** (Definition of Done: тесты зелёные, без регрессий, поведение проверено на рантайме, документация обновлена)
- [ ] Критерии успеха обеих спек выполнены
- [ ] PR готовы к согласованию (merge — только после одобрения)

## Risks and Mitigations

| Риск | Влияние | Митигация |
| --- | --- | --- |
| Эскалации/джобы падают на непривязанных анкетах (нет дома для области) | High | Явная ветка в задаче B1 + unit-тест на null-помещение |
| Область видимости: у непривязанной анкеты нет дома — сужение по домам её скроет | Med | Пока область «вся ОСИ» — видимы всем администраторам; зафиксировать в ADR-015 как точку пересмотра |
| Новые шаги ломают симулятор/эмуляцию (кнопки, фокус) | Med | Кнопки только из каталога; прогоны simulator-тестов в каждой фазе |
| Деплой шаблонов/кнопок перед функциями | Med | Порядок деплоя — в описании PR (правило ADR-010/011) |
| Регресс старых черновиков обращений и анкет | Med | Тесты совместимости в A1/B2; `kind='request'` как дефолт |
| Правки `tasks/plan.md`/`todo.md` | — | Не трогаем: там устаревший чек-лист VS-0; задачи — в этом файле |

## Open Questions

- Подписи видов kk («Жұмысқа өтінім/Өтініш»?) — финализировать в A1 при правке каталога.
- Причина привязки — необязательна (дефолт); подтвердить в B3.
- Показ выбранного вида и места на шаге `verify` — включён в A2 (иначе малоинформативен).
- Запуск интеграционных тестов против Sydney — отдельным явным запросом после фазы B.
