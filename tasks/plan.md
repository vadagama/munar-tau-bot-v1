# Implementation Plan: VS-0 «Фундамент»

## Overview

Первый вертикальный срез (LLD-05 §1): каркас монорепозитория в `source/`, минимальное ядро, три функции-заглушки Supabase Edge Functions, каркас SQL-миграций с pg_cron, SPA-каркас кабинета, CI/CD с автопроверкой секретов. Критерий среза (HLD §20): поставка пустого ядра и статики, повторяемый деплой из CI, секретов в сборке нет.

## Architecture Decisions

- **Монорепозиторий**: npm workspaces (`core`, `admin`) + Deno-проект для `functions` (ADR-003). Node 22 LTS, Deno 2.x.
- **core — чистый TypeScript** без Node/Deno-специфики в рантайме: функции — тонкий транспорт, ядро общее (LLD-01 §1). Функции импортируют `core` по относительному пути; при проблемах бандлера Supabase — переключение на npm-зависимость (риск R1).
- **Защита функций** (LLD-01 §2, LLD-03 §6): `api` — `verify_jwt=true` (Bearer JWT, в VS-1 появится проверка профиля); `jobs` — `verify_jwt=true` + свой заголовок `x-jobs-secret`; `bot-webhook` — `verify_jwt=false` + заголовок `X-Telegram-Bot-Api-Secret-Token` (секрет Telegram не является JWT).
- **Health без аутентификации** (LLD-03 §3.1): `GET /v1/meta/health` отвечает без PII.
- **Ошибки** — формат LLD-03 §1.1; коды ошибок и `ApiError` живут в `core/errors`, функции только рендерят HTTP.
- **RLS** (LLD-02 §16): в VS-0 — файл с принципами и отзывом прямого клиентского доступа; при каждой новой таблице (VS-1+) — дополнение `rls.sql`.
- **Кабинет**: React 18 + Refine v4 + Ant Design 5 + Vite; роутер react-router; вход «Войти через Telegram» — кнопка-заглушка (реальный OIDC — VS-1, ADR-001). SPA-маршрутизация для прямых ссылок (ADR-002).

## Task List

### Phase 1: Фундамент инструментария

- [ ] Task 1: Каркас монорепозитория
  **Description:** Рабочий workspace: корневой `package.json` (workspaces `core`, `admin`), `tsconfig.base.json`, ESLint (flat config), Vitest, снятие `/source/` из корневого `.gitignore`. Каркас `core` (пустой barrel).
  **Acceptance criteria:**
  - [ ] `npm install` в `source/` проходит без ошибок
  - [ ] `npm run typecheck` и `npm run lint` проходят на пустом каркасе
  - [ ] `/source/` больше не в `.gitignore`
  **Verification:**
  - [ ] Команды выше выполнены локально
  **Dependencies:** None. **Files:** `source/package.json`, `source/tsconfig.base.json`, `source/eslint.config.js`, `.gitignore`, `source/core/*`. **Scope:** M

- [ ] Task 2: Ядро: env и ошибки
  **Description:** `core/src/config` — типизированное чтение env (`requireEnv`, `optionalEnv`); `core/src/errors` — коды и `ApiError` по LLD-03 §1.1 (UNAUTHENTICATED…INTERNAL) + маппинг в {status, body}. Модульные тесты Vitest.
  **Acceptance criteria:**
  - [ ] `requireEnv` бросает ошибку конфигурации при отсутствии переменной
  - [ ] Формат тела ошибки совпадает с LLD-03 §1.1 (error.code/message/details/trace_id)
  - [ ] Неизвестная ошибка маппится в 500 INTERNAL без утечки деталей
  **Verification:**
  - [ ] `npm test -w core` — зелёный
  **Dependencies:** Task 1. **Files:** `source/core/src/config/*`, `source/core/src/errors/*`, `source/core/src/*.test.ts`. **Scope:** M

**Checkpoint: Foundation**
- [ ] install / lint / typecheck / test — зелёные
- [ ] Коммит(ы) в `feature/vs-0-foundation`

### Phase 2: БД и функции-заглушки

- [ ] Task 3: Схема БД: миграции и RLS
  **Description:** `db/migrations/0001_extensions.sql` (pg_cron, pg_net); `0002_schedule.sql` — шаблон регистрации cron-задания вызова `jobs` (значения — из секретов среды, заполняется при деплое, LLD-04 §2); `db/rls.sql` — принципы LLD-02 §16 + отзыв прямого клиентского доступа; `db/seed/README.md`.
  **Acceptance criteria:**
  - [ ] Миграции нумерованные, применимы повторно идемпотентно (`IF NOT EXISTS`)
  - [ ] `rls.sql` отражает «политик для anon/authenticated нет — прямой запрос не возвращает строк»
  **Verification:**
  - [ ] Ревью SQL на соответствие LLD-02 §16 / LLD-04 §2 (исполнение — при первом деплое, R3)
  **Dependencies:** Task 1. **Files:** `source/db/migrations/*`, `source/db/rls.sql`, `source/db/seed/README.md`. **Scope:** S

- [ ] Task 4: Функции-заглушки
  **Description:** `functions/deno.json` (lint/check-конфиг), `supabase/config.toml` (verify_jwt по функции), заглушки: `api` (роутер: health 200, остальное — 401/404 в формате ошибок), `bot-webhook` (проверка secret-token: не совпал — 401, тело не читается; совпал — 200), `jobs` (`x-jobs-secret`, health, processed=0). Секреты — только из env (Deno.env).
  **Acceptance criteria:**
  - [ ] `deno check` и `deno lint` на `functions/` без ошибок
  - [ ] Функции не содержат бизнес-правил; только транспорт + вызов core
  - [ ] В коде нет литеральных секретов
  **Verification:**
  - [ ] `deno task check`, `deno task lint` — зелёные
  **Dependencies:** Task 2. **Files:** `source/functions/**`, `source/supabase/config.toml`. **Scope:** M

- [ ] Task 5: Smoke-тесты заглушек (Deno test)
  **Description:** Тесты transport-слоя: api — health без auth; api — 404 на неизвестный путь в формате ошибки; bot-webhook — 401 без/с неверным секретом, 200 с верным; jobs — 401 без секрета, 200 с верным.
  **Acceptance criteria:**
  - [ ] `deno test` — зелёный; заглушки покрыты по веткам защиты
  **Verification:**
  - [ ] `deno task test` — зелёный
  **Dependencies:** Task 4. **Files:** `source/functions/**/*.test.ts`. **Scope:** S

**Checkpoint: Серверное ядро**
- [ ] deno check / lint / test — зелёные; миграции и rls.sql готовы

### Phase 3: Кабинет

- [ ] Task 6: SPA-каркас кабинета
  **Description:** `admin/`: Vite + React + TS + Refine v4 + AntD 5, react-router, SPA-маршрутизация (прямые ссылки не дают 404 — проверка dev-сервером), страница входа с кнопкой «Войти через Telegram» (заглушка, блокирована до VS-1), пустой защищённый layout. Env: только `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (публичные по ADR-002).
  **Acceptance criteria:**
  - [ ] `npm run build -w admin` — успешен, артефакт в `admin/dist`
  - [ ] Маршрут `/login` открывается по прямой ссылке (SPA-fallback)
  - [ ] В `admin/dist` нет ничего кроме publishable-переменных
  **Verification:**
  - [ ] Сборка + локальный `vite preview`, ручная проверка маршрутов
  **Dependencies:** Task 1. **Files:** `source/admin/**`. **Scope:** L

**Checkpoint: Кабинет**
- [ ] Сборка зелёная, маршруты работают

### Phase 4: CI/CD

- [ ] Task 7: CI-конвейер
  **Description:** `.github/workflows/ci.yml` (PR и push main): job node — install → lint → typecheck → vitest → build admin; job deno — check → lint → test; шаг автопроверки секретов в `admin/dist` (скрипт `tools/scripts/check-build-secrets.sh`: паттерны service-role, bot token, private key, `sb_secret_`).
  **Acceptance criteria:**
  - [ ] CI на PR зелёный (все джобы)
  - [ ] Подмена секрета в тестовой сборке ловится secret-scan
  **Verification:**
  - [ ] Прогон workflow на PR
  **Dependencies:** Tasks 1–6. **Files:** `.github/workflows/ci.yml`, `source/tools/scripts/*`. **Scope:** M

- [ ] Task 8: Деплой из CI (условный)
  **Description:** Job deploy (только push main, после CI): `supabase db push` → `supabase functions deploy` → `wrangler pages deploy`. Шаги выполняются только при наличии секретов (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, DB URL, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CF_PAGES_PROJECT`); иначе job завершается успехом с предупреждением (деплой ещё не настроен).
  **Acceptance criteria:**
  - [ ] При отсутствии секретов CI зелёный с явным предупреждением
  - [ ] При наличии секретов деплой повторяем из CI (критерий среза)
  **Verification:**
  - [ ] Прогон на push main; реальный деплой — после настройки секретов (R3)
  **Dependencies:** Task 7. **Files:** `.github/workflows/ci.yml`. **Scope:** S

**Checkpoint: CI**
- [ ] PR-проверки зелёные, механизм деплоя готов

### Phase 5: Документация и приёмка

- [ ] Task 9: AGENTS.md — команды и структура
  **Description:** Заполнить раздел «Команды» (install, lint, typecheck, test, build, миграции, локальный запуск функций, деплой, настройка секретов CI); обновить раздел «Структура» (source/ наполнен); статус VS-0.
  **Acceptance criteria:**
  - [ ] Все команды из плана воспроизводимы из AGENTS.md
  **Verification:**
  - [ ] Прогон команд по документу
  **Dependencies:** Tasks 1–8. **Files:** `AGENTS.md`. **Scope:** S

- [ ] Task 10: Приёмка среза
  **Description:** Прогон критерия LLD-05 VS-0 / HLD §20: сборка ядра и статики повторяема, secret-scan чист, DoD LLD-05 §4 (документы обновлены, тесты проходят).
  **Acceptance criteria:**
  - [ ] Все чекпоинты закрыты
  - [ ] В сборке нет секретов (скрипт + CI)
  **Verification:**
  - [ ] Финальный прогон CI + локальные команды
  **Dependencies:** Task 9. **Files:** —. **Scope:** S

**Checkpoint: Complete**
- [ ] Критерий среза выполнен; готов к MR

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| R1: Бандлер Supabase может не включить импорты `core` за пределами `functions/` | Средний | Каркас проверяется `deno check`; при первом реальном деплое — перейти на npm-зависимость или copy-шаг сборки (зафиксировать в AGENTS.md) |
| R2: Расширения pg_cron/pg_net различаются Cloud vs self-hosted | Низкий | Идемпотентные миграции; сверка при первом деплое (риски плана LLD-05) |
| R3: Секреты/проекты (Supabase, Cloudflare) ещё не настроены | Средний | Деплой-джоба условная; настройка документируется в AGENTS.md — не блокирует CI и разработку |
| R4: Конфликт версий Refine/AntD/React | Низкий | Фиксация стабильных версий (Refine 4.x, AntD 5.x, React 18), lock-файл в коммите |

## Open Questions

- Проект Supabase `dev` и Cloudflare Pages: созданы? Секреты GitHub внести после этого среза или в процессе VS-0?
- `x-jobs-secret` и секрет webhook Telegram: генерировать при настройке среды `dev` (вне репозитория).
