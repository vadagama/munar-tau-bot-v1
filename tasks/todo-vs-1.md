# VS-1 «Доступ и аудит-скелет» — задачи

План с критериями: [tasks/plan-vs-1.md](plan-vs-1.md). Ветвь: `feature/vs-1-access-audit`. Основание: LLD-05 §1 (VS-1), HLD §27, ADR-001, LLD-02 §2/13/16–17, LLD-03 §1/3.

## Phase 1: БД и ядро PDP

- [ ] Task 1: Миграция 0003 — person, profile, building (каркас), staff_assignment, staff_scope, access_session, emulation_session, audit_log; RLS + append-only
- [ ] Task 2: core/pdp — Actor, реестр действий (privileged), can(), сборка Actor; сценарные тесты (матрица §7 в части VS-1)

## Checkpoint: Ядро доступа

- [ ] pdp-тесты зелёные

## Phase 2: Auth, сеансы, домены

- [ ] Task 3: core/auth — JWT HS256 (WebCrypto) + политика сеансов AUTH-06 (12 ч / 30 мин)
- [ ] Task 4: core/db + домены admin (Actor, назначения, сеансы), audit (append + чтение по областям AUD-02), emulation (персоны is_test, сеансы, реестр сценариев); порты + SQL + in-memory фейки

## Checkpoint: Серверное ядро

- [ ] core-тесты зелёные; deno check зелёный

## Phase 3: Функция api

- [ ] Task 5: конвейер (CORS → JWT → профиль → сеанс → Actor → PDP → обработчик → аудит) + маршруты meta/audit/admin/emulation; тесты сценариев AUTH-01/ROL-04/AUTH-06/эмуляции

## Checkpoint: Функции

- [ ] deno check / lint / test — зелёные

## Phase 4: Кабинет

- [ ] Task 6: supabase-js + authProvider Refine + вход Telegram OIDC + REST-клиент /v1
- [ ] Task 7: журнал, эмуляция (персоны и сеансы), баннер эмуляции, главная с идентичностью и выходом

## Checkpoint: Кабинет

- [ ] build / typecheck / secret-scan зелёные

## Phase 5: Сиды, документация, приёмка

- [ ] Task 8: seed identity_dev.sql + порядок привязки supabase_user_id
- [ ] Task 9: AGENTS.md, admin/README, отметки задач; полный прогон проверок

## Checkpoint: Complete

- [ ] Критерий среза: вход/отзыв/эмуляция (AUTH-01, ACC-01 в части пилота; privileged кабинет-only); эмулированные действия в журнале с реальным актором и персоной
