# Implementation Plan: VS-1 «Доступ и аудит-скелет»

## Overview

Второй вертикальный срез (LLD-05 §1): PDP-движок (Actor, `can()`, реестр действий с флагом privileged), сеансы (`access_session`, middleware 12 ч / 30 мин бездействия, отзыв), `audit_log` с чтением по областям (AUD-02) и append-only, каркас эмуляции (тестовые персоны, `emulation_session`, транспорт симулятора), кабинет: `/v1/meta/me`, журнал, управление тестовыми персонами и сеансами эмуляции. Вход на пилоте — Telegram OIDC без TOTP (ADR-001, решение 16.10.2026).

Критерий среза (LLD-05 §1, HLD §27): сценарии входа/отзыва/эмуляции (AUTH-01, ACC-01 в части, действующей на пилоте; AUTH-02–03 — privileged кабинет-only); эмулированные действия в журнале с реальным актором и эмулируемой персоной.

## Architecture Decisions

- **Таблицы среза**: миграция `0003` создаёт `person`, `profile`, `building` (каркас — нужен FK для `staff_scope`), `staff_assignment`, `staff_scope`, `access_session`, `emulation_session`, `audit_log` (LLD-02 §2.1–2.2, 2.6, 13). Остальные таблицы реестра (premises, connection, invite, registration, import) — VS-2. LLD-05 относит person/profile к VS-2, но Actor, сеансы и аудит ссылаются на них уже в VS-1 — перенос в VS-1 зафиксирован здесь как осознанное решение.
- **Порты и репозитории**: ядро определяет интерфейсы доменов (`AdminRepo`, `AuditRepo`, `EmulationRepo`) и чистую логику; SQL-реализации — рядом (`repo.ts`), функции только связывают. Тесты — на чистой логике + in-memory фейках портов (в `core/src/testing/`); SQL проверяется при деплое (риск R3, как в VS-0).
- **Аутентификация**: verify_jwt = true на платформе + собственная проверка подписи HS256 по `SUPABASE_JWT_SECRET` (WebCrypto, без зависимостей). Поиск профиля — по `supabase_user_id` = claim `sub` (ADR-001: sub и telegram id не считаются одним полем). Неизвестный sub — 401 `NO_PROFILE`: вход не выдаёт роль, привязка supabase_user_id выполняется сидами/администрированием (точка О-1 — уточнить формат sub при настройке провайдера).
- **Сеансы (AUTH-06)**: `access_session.id` = claim `session_id` JWT (LLD-02 §13). Пределы: 12 ч от старта, 30 мин бездействия; активность — все аутентифицированные вызовы `/v1`, кроме `GET /v1/meta/*` (закрыто 16.10.2026, М-2). Превышение — 401 `SESSION_EXPIRED`. Ручной выход — `POST /v1/admin/sessions/{id}/revoke` на собственный сеанс (любой аутентифицированный) + supabase signOut в кабинете.
- **Отзыв полномочий (ROL-04)**: Actor собирается на каждый запрос из БД — отозванное назначение не попадает в Actor уже на следующем запросе. Отзыв роли через API дополнительно отзывает активные сеансы человека (LLD-03 §1).
- **PDP**: deny-by-default; реестр действий (`pdp/actions.ts`) — единственный источник требований (роли, спецправа, privileged). Председатель = все действия администратора по всему ОСИ без назначения (ROL-02a); спецправа выдаёт только председатель (ROL-02b). Оценка — детерминированная, тесты таблицей сценариев (матрица §7 в части VS-1).
- **Аудит (AUD-01/02)**: append-only (REVOKE UPDATE/DELETE всем ролям + защитный триггер; защита от инфраструктурного доступа — открытая точка Д-7). Чтение по областям: председатель — всё; администратор — записи своих домов (`scope_buildings` ⊆ область); техадмин — технические события (префикс `tech.`). Отказы PDP, privileged-действия, чтение журнала и все действия эмуляции пишутся в журнал.
- **Эмуляция (HLD 10.8)**: только техадмин, только `is_test`-персоны; эмулированный Actor строится по персоне, права оценивает PDP; privileged в эмуляции запрещены; сеанс эмуляции живёт внутри сеанса техадмина (пределы AUTH-06 считаются по сеансу техадмина); уведомления симулятора — с VS-5 (notify), inbox срезом VS-1 не создаётся.
- **CORS**: кабинет на Cloudflare Pages вызывает функции с другого origin — транспорт добавляет CORS (preflight + `Access-Control-Allow-Origin` из env `CABINET_ORIGIN`), `Cache-Control: no-store` на ответы с ПДн.
- **Вне среза** (зафиксировано): rate limit 100 req/min (нужен общий хранимый счётчик — решение позже), `Idempotency-Key` (появится с мутациями VS-3), TOTP (после пилота, AQ-02), поддержка ROL-06 (`support_access` — VS-9, контроль в PDP уже учтён реестром действий).

## Task List

### Phase 1: БД и ядро PDP

- [ ] Task 1: Миграция 0003 — идентичность, сеансы, аудит
  **Description:** `db/migrations/0003_identity_sessions_audit.sql`: enum'ы (person_status, language, staff_role, assignment_status, emulation_state), таблицы person, profile, building, staff_assignment, staff_scope, access_session, emulation_session, audit_log; индексы LLD-02 §14; RLS + revoke anon/authenticated; append-only audit_log (REVOKE + триггер). rls.sql дополнить комментариями.
  **Acceptance criteria:**
  - [ ] Миграция идемпотентна (`IF NOT EXISTS`, `DO`-блоки)
  - [ ] Состав таблиц и колонок соответствует LLD-02 §2.1–2.2, 2.6, 13
  - [ ] audit_log: UPDATE/DELETE отозваны у всех ролей + триггер-защита
  **Verification:**
  - [ ] Ревью SQL; исполнение — при деплое (R3)
  **Dependencies:** None. **Files:** `source/db/migrations/0003_*.sql`, `source/db/rls.sql`. **Scope:** M

- [ ] Task 2: core/pdp — Actor, реестр действий, can()
  **Description:** Типы Actor/ResourceRef/Decision; реестр действий VS-1 (meta, audit, admin, emulation) с флагом privileged; `can()` — роли, спецправа, область, ограничение эмуляции (privileged запрещены), правило «председатель действует по всему ОСИ» (ROL-02a), сборка Actor (действующие назначения: status=active, окно valid_from/until, область; отсутствие строк staff_scope = весь ОСИ только у chairman/tech_admin).
  **Acceptance criteria:**
  - [ ] Deny-by-default: без назначения — отказ
  - [ ] Таблица сценариев: вход не выдаёт роль; председатель/админ/техадмин/исполнитель; отзыв назначения = отказ на следующий вызов; спецправа только через председателя; privileged кабинет-only и запрещены в эмуляции
  **Verification:**
  - [ ] `npm test -w core` — зелёный
  **Dependencies:** None (параллельный поток «PDP-движок»). **Files:** `source/core/src/pdp/*`, тесты. **Scope:** M

**Checkpoint: Ядро доступа**
- [ ] pdp-тесты зелёные (чистые функции без БД)

### Phase 2: Auth, сеансы, домены

- [ ] Task 3: core/auth — JWT и политика сеансов
  **Description:** Проверка HS256 по WebCrypto (`SUPABASE_JWT_SECRET`), извлечение `sub`, `session_id`; чистая политика AUTH-06: 12 ч от старта / 30 мин бездействия (`SESSION_EXPIRED`).
  **Acceptance criteria:**
  - [ ] Поддельная подпись отклоняется; истёкший JWT отклоняется
  - [ ] Политика: истёкшие пределы детектируются, активные — нет
  **Verification:**
  - [ ] `npm test -w core` — зелёный
  **Dependencies:** Task 2 не требуется (параллельно). **Files:** `source/core/src/auth/*`, тесты. **Scope:** S

- [ ] Task 4: core/db + домены admin/audit/emulation
  **Description:** `core/db/client.ts` — минимальный исполнитель (postgres.js, `query`/`transaction`). Домены: `admin` (сборка Actor, назначения, сеансы: списки/отзыв/отзыв сеансов человека), `audit` (append, чтение с фильтрами и фильтром области AUD-02), `emulation` (тестовые персоны с is_test и синтетическим telegram id < 0, старт/завершение сеанса эмуляции, реестр сценариев симулятора). Порты + SQL-реализации + in-memory фейки в `core/src/testing/`.
  **Acceptance criteria:**
  - [ ] Фильтр области журнала: председатель — всё; админ — свои дома; техадмин — `tech.`; прочие — отказ (тесты)
  - [ ] Отзыв роли отзывает сеансы человека; отзыв сеанса/назначения пишет аудит (тесты на логике через фейки)
  - [ ] Старт эмуляции только под is_test-профиль; активный сеанс один (новый завершает прежний)
  **Verification:**
  - [ ] `npm test -w core` — зелёный; `deno task check` — зелёный (импорты npm:postgres)
  **Dependencies:** Tasks 1–3. **Files:** `source/core/src/db/*`, `source/core/src/domains/*`, `source/core/src/testing/*`, тесты. **Scope:** L

**Checkpoint: Серверное ядро**
- [ ] core-тесты зелёные; deno check проходит

### Phase 3: Функция api

- [ ] Task 5: api — конвейер и маршруты VS-1
  **Description:** Конвейер: CORS/preflight → health → JWT → профиль (`NO_PROFILE`) → сеанс (`SESSION_EXPIRED`, touch кроме `GET /v1/meta/*`) → Actor (+эмуляция) → маршрут → PDP → обработчик → аудит отказов/privileged/чтения журнала → ответы с `no-store`. Маршруты: `GET /v1/meta/me`, `GET /v1/meta/dictionary`, `GET /v1/audit`, `GET/POST/PATCH /v1/admin/assignments`, `GET /v1/admin/persons-lookup`, `GET /v1/admin/sessions`, `POST /v1/admin/sessions/{id}/revoke`, `GET/POST /v1/emulation/persons`, `POST /v1/emulation/sessions`, `DELETE /v1/emulation/sessions/{id}`, `POST /v1/emulation/simulate` (транспорт симулятора; сценарии — с VS-2, неизвестный сценарий — 404).
  **Acceptance criteria:**
  - [ ] Без токена — 401 UNAUTHENTICATED; неизвестный sub — 401 NO_PROFILE; формат ошибок LLD-03 §1.1
  - [ ] Сценарий AUTH-01/ROL-04: отзыв назначения → следующий запрос из открытого сеанса — 403/401
  - [ ] AUTH-06: пределы сеанса — 401 SESSION_EXPIRED; `GET /v1/meta/*` не продлевает активность
  - [ ] Эмулированное чтение журнала пишет запись с реальным актором и эмулируемой персоной
  - [ ] `deno task check/lint/test` — зелёные (фейки вместо БД)
  **Verification:**
  - [ ] `deno task test` — зелёный
  **Dependencies:** Task 4. **Files:** `source/functions/api/*`. **Scope:** L

**Checkpoint: Функции**
- [ ] deno check / lint / test — зелёные

### Phase 4: Кабинет

- [ ] Task 6: admin — authProvider и Telegram-вход
  **Description:** `@supabase/supabase-js`; authProvider Refine (check/login/logout/onError/getIdentity на `/v1/meta/me`); страница входа: кнопка «Войти через Telegram» (OIDC custom-провайдер `custom:telegram`, ADR-001); без env-переменных — заглушка VS-0. REST-клиент `/v1` с Bearer-токеном и разбором ошибок LLD-03.
  **Acceptance criteria:**
  - [ ] `npm run build -w admin` и `npm run typecheck` — зелёные
  - [ ] В сборке только publishable-переменные (secret-scan)
  - [ ] 401 от API — выход на `/login`
  **Verification:**
  - [ ] build + secret-scan; рантайм OIDC проверяется при настройке среды (R3, риск LLD-05)
  **Dependencies:** Task 5 (контракт meta/me). **Files:** `source/admin/src/**`. **Scope:** M

- [ ] Task 7: admin — журнал, эмуляция, баннер режима
  **Description:** Страницы: журнал (таблица с фильтрами entity/actor/период), эмуляция (тестовые персоны + создание, старт/завершение сеанса), баннер эмуляции в layout, главная — идентичность и пределы сеанса, выход.
  **Acceptance criteria:**
  - [ ] Баннер режима эмуляции с именем персоны и пометкой журналирования
  - [ ] Сборка и typecheck зелёные
  **Verification:**
  - [ ] `npm run build -w admin`, `npm run typecheck`
  **Dependencies:** Task 6. **Files:** `source/admin/src/**`. **Scope:** M

**Checkpoint: Кабинет**
- [ ] build/typecheck/secret-scan зелёные

### Phase 5: Сиды, документация, приёмка

- [ ] Task 8: Сиды dev-среды
  **Description:** `db/seed/identity_dev.sql`: председатель/техадмин (placeholders supabase_user_id — заполнить после первого OIDC-входа), тестовые персоны (is_test) с ролями; README с порядком привязки supabase_user_id (точка О-1).
  **Acceptance criteria:**
  - [ ] Сид идемпотентен; инструкция привязки воспроизводима
  **Verification:**
  - [ ] Ревью SQL; исполнение — при деплое (R3)
  **Dependencies:** Task 1. **Files:** `source/db/seed/*`. **Scope:** S

- [ ] Task 9: Документация и приёмка
  **Description:** AGENTS.md (статус, структура, команды — без изменений команд), admin/README (маршруты), tasks/todo-vs-1.md — отметки; прогон критерия среза: сценарии входа/отзыва/эмуляции покрыты тестами; эмулированные действия в журнале (тест); DoD — lint/typecheck/test/build, deno check/lint/test, secret-scan.
  **Acceptance criteria:**
  - [ ] Все чекпоинты закрыты; локальные проверки зелёные
  - [ ] Критерий среза LLD-05 §1 VS-1 выполнен (в объёме, проверяемом без среды — R3)
  **Verification:**
  - [ ] Полный прогон команд из AGENTS.md
  **Dependencies:** Tasks 1–8. **Files:** `AGENTS.md`, `source/admin/README.md`, `tasks/todo-vs-1.md`. **Scope:** S

**Checkpoint: Complete**
- [ ] Критерий среза выполнен; готов к PR

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Формат `sub` custom-провайдера Telegram неизвестен до настройки среды (R3) | Привязка профиля | Поиск только по `supabase_user_id`; привязка — сидами/администрированием; точка О-1 в плане; проверить в dev при первой настройке OIDC |
| Клиентский вызов OIDC (signInWithOAuth c `custom:telegram`) не проверен без среды | Вход в кабинет | Изолировано в одном модуле (`api/telegram-auth.ts`); заглушка без env; проверка в dev (LLD-05: риски self-hosted Auth ≥ v2.196.0) |
| SQL-слой не покрыт автотестами (нет БД в CI) | Дефекты в рантайме | Порты + чистая логика покрыты тестами; SQL тонкий; проверка при деплое; интеграционные тесты — после появления среды |
| CORS между Pages и Functions | Кабинет не работает | CORS в конвейере с явным allowlist origin (env `CABINET_ORIGIN`) |
| Смешение тестовых и реальных данных эмуляции | Целостность KPI/отчётов | is_test на person/profile, синтетические telegram id < 0; создание персон — только is_test |

## Open Questions

- О-1: Привязка `supabase_user_id` ↔ profile: формат `sub` при custom OIDC `custom:telegram` — уточнить при настройке провайдера (ADR-001, R3); процедура привязки — сиды/администрирование до VS-2 (регистрация создаёт profile с telegram_user_id).
- О-2: Состав «технических событий» журнала для техадмина — стартовый префикс `tech.`; расширить по мере срезов (AUD-02).
- О-3: Rate limit (LLD-03 §1, 100 req/min) — нужен общий счётчик (pg/redis); решение и срез — при проектировании эксплуатации; в VS-1 не имитируется.
