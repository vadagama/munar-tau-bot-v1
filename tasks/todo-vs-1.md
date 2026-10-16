# VS-1 «Доступ и аудит-скелет» — задачи

План с критериями: [tasks/plan-vs-1.md](plan-vs-1.md). Ветвь: `feature/vs-1-access-audit`. Основание: LLD-05 §1 (VS-1), HLD §27, ADR-001, LLD-02 §2/13/16–17, LLD-03 §1/3.

## Phase 1: БД и ядро PDP

- [x] Task 1: Миграция 0003 — person, profile, building (каркас), staff_assignment, staff_scope, access_session, emulation_session, audit_log; RLS + append-only
- [x] Task 2: core/pdp — Actor, реестр действий (privileged), can(), сборка Actor; сценарные тесты (матрица §7 в части VS-1)

## Checkpoint: Ядро доступа

- [x] pdp-тесты зелёные

## Phase 2: Auth, сеансы, домены

- [x] Task 3: core/auth — JWT HS256 (WebCrypto) + политика сеансов AUTH-06 (12 ч / 30 мин)
- [x] Task 4: core/db + домены admin (Actor, назначения, сеансы), audit (append + чтение по областям AUD-02), emulation (персоны is_test, сеансы, реестр сценариев); порты + SQL + in-memory фейки

## Checkpoint: Серверное ядро

- [x] core-тесты зелёные (138); deno check зелёный

## Phase 3: Функция api

- [x] Task 5: конвейер (CORS → JWT → профиль → сеанс → Actor → PDP → обработчик → аудит) + маршруты meta/audit/admin/emulation; тесты сценариев AUTH-01/ROL-04/AUTH-06/эмуляции (34)

## Checkpoint: Функции

- [x] deno check / lint / test — зелёные (34 теста)

## Phase 4: Кабинет

- [x] Task 6: supabase-js + authProvider Refine + вход Telegram OIDC + REST-клиент /v1
- [x] Task 7: журнал, эмуляция (персоны и сеансы), баннер эмуляции, главная с идентичностью и выходом

## Checkpoint: Кабинет

- [x] build / typecheck / secret-scan зелёные

## Phase 5: Сиды, документация, приёмка

- [x] Task 8: seed identity_dev.sql + порядок привязки supabase_user_id
- [x] Task 9: AGENTS.md, admin/README, отметки задач; полный прогон проверок

## Checkpoint: Complete

- [x] Критерий среза: вход/отзыв/эмуляция (AUTH-01, ACC-01 в части пилота; privileged кабинет-only); эмулированные действия в журнале с реальным актором и персоной — покрыты тестами (core 138, functions 34); рантайм-проверка OIDC/БД — при деплое (R3)
