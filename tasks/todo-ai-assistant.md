# AI-ассистент кабинета — реестр задач

Дата: 25.10.2026. Направление согласовано (два раунда челенжа), решения — в
[идее](../docs/ideas/ai-assistant.md). План: [plan-ai-assistant.md](plan-ai-assistant.md).
Реализация начнётся на ветке `feature/ai-assistant-s0-*` после одобрения плана;
PR на согласование, мерж — только после одобрения пользователем.

Команды — из `source/`. Пути — относительно `source/`, кроме `tasks/`,
`docs/` и `AGENTS.md`. Каждая задача — один проверяемый срез, обычно 3–5
файлов; если выходит больше — сначала разделить, не расширять молча.
Интеграционные SQL-проверки — только по отдельному явному запросу (AGENTS.md).
Пилот — только демо-стенд (Frankfurt, вымышленные данные); реальные данные —
после ИБ-анализа и отдельного ADR.

## S0. Гейт, данные и настройки

### S0.1. ADR-021 — Cloudflare Worker в стеке

- [ ] ADR-021: контекст → решение → альтернативы → проверки
- [ ] Условия зафиксированы: read-only пилот на вымышленных данных; запись —
  только после явного подтверждения человека в UI; реальные данные — после
  ИБ-анализа и отдельного ADR
- Зависимости: —.
- Проверка: ревью diff; индекс `docs/README.md`, строки в AGENTS.md.
- Файлы: `docs/decisions/021-*.md`, `docs/README.md`, `AGENTS.md`.

### S0.2. Миграции и домен assistant

- [ ] Миграции `assistant_settings` (singleton), `assistant_user_config`
  (enabled=false по умолчанию, дневной/месячный лимит), `assistant_usage_ledger`
  (append-only, unique `operation_id`, день по Алматы)
- [ ] RLS: config/ledger — владелец + privileged; settings — только privileged
- [ ] SQL-репозитории `core/src/domains/assistant` + фейки в `core/testing`
- [ ] `api_key_encrypted`: Vault, при отсутствии на self-hosted — AES-GCM
  (решение зафиксировать)
- Зависимости: S0.1 (порядком).
- Приёмка: миграции идемпотентны; `schema-drift` зелёный; повтор `operation_id`
  отклоняется; фейки повторяют контракт портов.
- Проверка: `npm test -w core`; `deno task check && deno task lint && deno task test`.
- Файлы: `db/migrations/<ts>_assistant_*.sql`, `db/rls.sql`,
  `core/src/domains/assistant/*`, `core/testing/*` + тесты.

### S0.3. PDP-действия и эндпоинты

- [ ] PDP: `assistant.use`, `assistant.settings.read/edit` (chairman/tech_admin,
  privileged, вне эмуляции), `assistant.usage.read`
- [ ] GET/PUT `/v1/assistant/settings` (PUT — причина + Idempotency-Key)
- [ ] GET `/v1/assistant/settings/me`; GET `/v1/assistant/usage`
- [ ] POST `/v1/assistant/runtime-token` (assistant.use + enabled, аудит выдачи)
- [ ] POST `/v1/assistant/usage` (`X_ASSISTANT_SECRET`, идемпотентно по operation_id)
- Зависимости: S0.2.
- Приёмка: 403/409 по общим правилам; ключ в ответах — только маска; повтор
  usage не удваивает расход.
- Проверка: `deno task test`; `npm test -w core` (PDP).
- Файлы: `core/src/pdp/actions.ts`, `functions/api/*`,
  `core/src/domains/assistant/*` + тесты.

### S0.4. Раздел «Настройки AI-ассистента»

- [ ] Страница в группе «Настройки» (по образцу `/templates`), PageLayout,
  доступ chairman/tech_admin
- [ ] Блок единого токена: write-only ввод, маска `••••1234`, замена с причиной
  и Idempotency-Key
- [ ] Таблица сотрудников (`ConfigurableTable`): тумблер «Включён» (выключен у
  всех по умолчанию), дневной/месячный лимит
- [ ] В эмуляции раздел скрыт
- Зависимости: S0.3.
- Приёмка: 409 сохраняет ввод; токен не в сборке/логах (secret-scan зелёный).
- Проверка: `npm test -w admin`; `npm run build -w admin`.
- Файлы: `admin/src/pages/assistant-settings.tsx`, навигация + тесты.

**Контроль после S0:**
- [ ] Сквозной сценарий: включение сотрудника с лимитом и токеном →
  `settings/me` возвращает enabled + остаток; выключенный получает отказ.
- [ ] Проверки воркспейсов зелёные; отклонения от идеи разобраны.

## S1. Чат-скелет

### S1.1. Воркспейс assistant — Worker + DO + PiHarness

- [ ] `source/assistant`: Worker, DO `AssistantDO` (1 DO = 1 сотрудник),
  `PiHarness` в Lifecycle, `pi_*` в SQLite DO
- [ ] Изоляция Pi за `ChatRuntime` (фейк в тестах); пин версий
  (`agents` 0.30.x ↔ Pi 1.4)
- [ ] `wrangler.toml`; секреты Worker: `SUPABASE_URL`, JWKS, `CABINET_ORIGIN`
- [ ] Скрипты lint/typecheck/test; воркспейс добавлен в CI явно; README деплоя
- Зависимости: S0.1.
- Приёмка: транскрипты переживают рестарт DO; Pi не протекает за `ChatRuntime`.
- Проверка: `npm run typecheck && npm test -w assistant`; CI зелёный.
- Файлы: `source/assistant/*`, `.github/workflows/ci.yml`.

### S1.2. WS-панель ассистента на главной

- [ ] Панель на HomePage рядом с «Очередь дня» (очередь не заменяет), мобильный
  полноэкранный лист
- [ ] JWT в первом WS-сообщении `{type:"auth", jwt}`, не в URL; refresh по
  `onAuthStateChange`
- [ ] Стриминг снапшот + дельты, индикатор «в работе», санитизированный Markdown
- [ ] Кнопки «Очистить контекст» и «Повторить»; `operationId = messageId`
- Референс: прототип `prototypes/dashboard-library`, страница `dashboard-browser.html` (панель на главной).
- Зависимости: S1.1, S0.3.
- Приёмка: повторная отправка сообщения не дублирует ответ; обрыв WS
  восстанавливается со снапшота; HTML из ответа не рендерится.
- Проверка: `npm test -w admin` (jsdom); `npm run build -w admin`.
- Файлы: `admin/src/pages/home.tsx`, `admin/src/assistant/*` + тесты.

### S1.3. Провайдер DeepSeek и память 05:00→05:00

- [ ] Провайдер DeepSeek за `ChatRuntime`; ключ — по `runtime-token` на старте,
  только в памяти изолята (не в `pi_*`, не в браузер)
- [ ] `settings.retry` + `afterFailedRun: "keep"` — очередь не теряется,
  «Повторить» доступно
- [ ] Alarm 05:00 Asia/Almaty → reset; «Очистить» → пересоздание DO по эпохе
  `assistant:<profile_id>:<epoch>`
- [ ] Гейт JWT + enabled (кэш ≤ 60 с) до принятия сообщения
- Зависимости: S1.1, S1.2, S0.3.
- Приёмка: сбой провайдера не теряет очередь; старая эпоха недоступна после
  очистки; выключенному — отказ.
- Проверка: `npm test -w assistant` (фейк провайдера, alarm, гейт); jsdom кнопки.
- Файлы: `source/assistant/*` (provider, gate, эпохи), панель + тесты.

**Контроль после S1 (wrangler dev, без реальных данных):**
- [ ] Сообщение → стриминговый ответ; 05:00 очищает контекст; обрыв WS
  восстанавливается со снапшота.
- [ ] Секреты не в `pi_*`/логах; отклонения разобраны.

## S2. Сущности и ссылки

### S2.1. Инструменты сущностей, виджеты и deep links

- [ ] Инструменты: `search_requests`/`get_request`, `search_tasks`/`get_task`,
  `list_incidents`/`get_incident`, `search_residents`, `list_connections`,
  `list_staff`/`get_staff` — по JWT пользователя, `replay: "safe"`
- [ ] `beforeTool` — белый список read-only реестра
- [ ] Контракт `{items, total, page}`, `page_size` ≤ 20, абсолютные `link`
- [ ] Виджеты-карточки со ссылками; чтение `?id=<uuid>` в drawer'ах
  обращений/заданий; язык профиля ru/kk
- Зависимости: S1. (Больше 5 файлов — разделить на «инструменты» и «UI».)
- Приёмка: «покажи новые обращения» → карточки-ссылки, переход по `?id=`;
  пустой разрез — «нет данных» без выдумок.
- Проверка: `npm test -w assistant`; `npm test -w admin`.
- Файлы: `source/assistant/tools/*`, `admin/src/pages/requests.tsx`,
  `admin/src/pages/tasks.tsx` + тесты.

### S2.2. Тесты на инъекцию

- [ ] Инъекция инструкций из данных не выводит за реестр и PDP
- [ ] `beforeTool` отсекает не-whitelisted вызовы при инъекции; гейты не зависят
  от содержимого сообщения
- Зависимости: S2.1.
- Проверка: `npm test -w assistant`.
- Файлы: `source/assistant/tools/*.test.ts`, fixtures.

## S3. Расход и лимиты

### S3.1. Ledger и гейт лимитов до submit

- [ ] DO → POST usage после ответа (идемпотентно по operation_id)
- [ ] Гейт до submit: день (05:00→05:00 Алматы) / месяц против лимитов;
  превышение — отказ в панели без вызова модели
- Референс: прототип `prototypes/dashboard-library`, страница `assistant-limit.html` (исчерпанный лимит).
- Зависимости: S0.2, S0.3, S1.3.
- Приёмка: лимит блокирует до окна; отключение не обнуляет расход.
- Проверка: `npm test -w assistant` + `npm test -w core`.
- Файлы: `source/assistant/*` (gate), `core/src/domains/assistant` + тесты.

### S3.2. Панель расхода

- [ ] Свой расход и остаток — включённому сотруднику; все —
  chairman/tech_admin (`assistant.usage.read`)
- [ ] Таблица по дням/месяцам; блок в настройках + мини-индикатор в панели
- Зависимости: S3.1, S0.4.
- Приёмка: чужой расход не виден (тест PDP).
- Проверка: `deno task test`; `npm test -w admin`.
- Файлы: `functions/api/*`, страница настроек + тесты.

**Контроль после S2+S3 (внутренний пилот):**
- [ ] Вопрос по сущностям → список со ссылками; карточки по `?id=` открываются.
- [ ] Расход учитывается, лимит блокирует; инъекционные тесты зелёные.
- [ ] Решение о переходе к S4a — после ревью пользователем.

## S4a. Агрегаты и таблицы

### S4a.1. Три агрегатных эндпоинта отчётного домена

- [ ] `workload_by_assignee`, `created_closed_by_day`, `overdue_by_building` —
  read-only по существующим правам `report.*`
- [ ] Фильтры: период (05:00→05:00 Алматы), дом/исполнитель; PDP-область
  повторяется перед агрегацией (образец REP-01/02/03)
- Зависимости: S0.3.
- Приёмка: компактные серии/таблицы; вне области — пусто, не ошибка.
- Проверка: `deno task test`; `npm test -w core`.
- Файлы: `core/src/domains/reports/*` (или отдельный модуль), `functions/api/*` + тесты.

### S4a.2. Инструменты агрегатов и табличный виджет

- [ ] Инструменты агрегатов (`replay: "safe"`) + AntD Table из JSON инструмента
- Зависимости: S4a.1, S2.1.
- Приёмка: «кто как загружен» → числа из API, не из памяти модели; нет данных —
  «нет данных».
- Проверка: `npm test -w assistant` + `npm test -w admin`.
- Файлы: `source/assistant/tools/*`, `admin/src/assistant/*` + тесты.

## S4b. Графики

### S4b.1. Chart-виджет на @ant-design/plots

- [ ] **Согласие пользователя на новую зависимость** + оценка бандла
- [ ] Chart-виджет из JSON инструмента (line/bar); модель не генерирует
  HTML/код графиков
- Зависимости: S4a.2.
- Приёмка: «динамика по дням» → график из JSON; HTML/script из ответа модели не
  рендерится (тест).
- Проверка: `npm test -w admin`; `npm run build -w admin`; ревью бандла.
- Файлы: `admin/package.json`, chart-виджет + тесты.

## S6. Харденинг

### S6.1. Эпохи DO, retention и наблюдаемость

- [ ] Механика эпох («Очистить») и retention `pi_*` (значение утвердить)
- [ ] Workers observability DO; счётчики tool-вызовов (`wrapTool`)
- [ ] Алерты parked-задач (`onReport` → `task_parked`), «Повторить» =
  `session.retry()`
- Зависимости: S1.3, S2.
- Проверка: `npm test -w assistant`; ревью логов `wrangler dev`.
- Файлы: `source/assistant/*`, панель + тесты.

### S6.2. kk-язык и ИБ-чеклист

- [ ] Полный kk-язык ответов и подписей виджетов (по `profile.language`)
- [ ] ИБ-чеклист до реальных данных: что уходит к DeepSeek, журналирование/
  обучение, training opt-out, резидентность, вариант vLLM в Казахстане
- Зависимости: S4b, пилот.
- Приёмка: ответы и подписи на kk; открытые пункты чеклиста перечислены явно.
- Проверка: golden-тесты языка; ревью документа.
- Файлы: `source/assistant/*`, виджеты, `docs/`.

**Контроль: Complete** (Definition of Done: тесты зелёные, без регрессий,
поведение проверено на рантайме, документация обновлена)

- [ ] Критерии сценария пилота выполнены (панель, память 05:00→05:00, сущности
  со ссылками, аналитика таблицами и графиками, лимиты и расход, восстановление)
- [ ] Метрика пилота заведена: 4 недели, ≥2 из 3–4 сотрудников с ≥2 сессиями/неделю
- [ ] PR готов к согласованию; мерж — только после одобрения пользователя

## Вне плана (резерв)

- **S5 — контур записи:** пишущие действия только после явного подтверждения
  человека в UI; non-replay инструменты; approvals в Pi Durable отсутствуют —
  отдельный ADR после пилота.
- Telegram-боты и жители — не входят (сначала опыт председателя/администратора
  в кабинете).
