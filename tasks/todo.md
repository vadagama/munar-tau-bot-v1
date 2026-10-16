# VS-0 «Фундамент» — задачи

План с критериями: [tasks/plan.md](plan.md). Ветвь: `feature/vs-0-foundation`. Основание: LLD-05 §1, HLD §20.

## Phase 1: Фундамент инструментария

- [x] Task 1: Каркас монорепозитория — workspaces (core, admin), tsconfig.base, ESLint, Vitest, /source/ вне .gitignore
- [x] Task 2: Ядро: config/env + errors (LLD-03 §1.1) + модульные тесты

## Checkpoint: Foundation

- [x] install / lint / typecheck / test — зелёные

## Phase 2: БД и функции-заглушки

- [x] Task 3: db/ — миграции 0001 extensions, 0002 cron-шаблон; rls.sql (LLD-02 §16); seed/
- [x] Task 4: functions/ — deno.json, supabase/config.toml, заглушки api / bot-webhook / jobs
- [x] Task 5: Deno smoke-тесты заглушек (ветки защиты и health)

## Checkpoint: Серверное ядро

- [x] deno check / lint / test — зелёные

## Phase 3: Кабинет

- [x] Task 6: admin/ — Vite + React + Refine + AntD, SPA-маршрутизация, login-заглушка

## Checkpoint: Кабинет

- [x] vite build зелёный; /login по прямой ссылке открывается (vite preview + curl, SPA-fallback)

## Phase 4: CI/CD

- [x] Task 7: .github/workflows/ci.yml — lint → typecheck → test → build + secret-scan dist
- [x] Task 8: deploy job (push main) — supabase db push / functions deploy / wrangler pages deploy; условно по секретам

## Checkpoint: CI

- [x] PR-проверки зелёные (PR #2: node-джоба и deno-джоба ✓, deploy-джоба пропущена по условию)

## Phase 5: Документация и приёмка

- [x] Task 9: AGENTS.md — раздел «Команды», структура, статус
- [x] Task 10: Приёмка по критерию среза (HLD §20) и DoD LLD-05 §4

## Checkpoint: Complete

- [x] Критерий VS-0 выполнен; готов к MR
