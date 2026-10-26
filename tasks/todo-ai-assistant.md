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

- [x] ADR-021: контекст → решение → альтернативы → проверки
- [x] Условия зафиксированы: read-only пилот на вымышленных данных; запись —
  только после явного подтверждения человека в UI; реальные данные — после
  ИБ-анализа и отдельного ADR
- Зависимости: —.
- Проверка: ревью diff; индекс `docs/README.md`, строки в AGENTS.md.
- Файлы: `docs/decisions/021-*.md`, `docs/README.md`, `AGENTS.md`.

### S0.2. Миграции и домен assistant

- [x] Миграции `assistant_settings` (singleton), `assistant_user_config`
  (enabled=false по умолчанию, дневной/месячный лимит), `assistant_usage_ledger`
  (append-only, unique `operation_id`, день по Алматы)
- [x] RLS: config/ledger — владелец + privileged; settings — только privileged
- [x] SQL-репозитории `core/src/domains/assistant` + фейки в `core/testing`
- [x] `api_key_encrypted`: Vault, при отсутствии на self-hosted — AES-GCM
  (решение зафиксировать)
- Зависимости: S0.1 (порядком).
- Приёмка: миграции идемпотентны; `schema-drift` зелёный; повтор `operation_id`
  отклоняется; фейки повторяют контракт портов.
- Проверка: `npm test -w core`; `deno task check && deno task lint && deno task test`.
- Файлы: `db/migrations/<ts>_assistant_*.sql`, `db/rls.sql`,
  `core/src/domains/assistant/*`, `core/testing/*` + тесты.

### S0.3. PDP-действия и эндпоинты

- [x] PDP: `assistant.use`, `assistant.settings.read/edit` (chairman/tech_admin,
  privileged, вне эмуляции), `assistant.usage.read`
- [x] GET/PUT `/v1/assistant/settings` (PUT — причина + Idempotency-Key)
- [x] GET `/v1/assistant/settings/me`; GET `/v1/assistant/usage`
- [x] POST `/v1/assistant/runtime-token` (assistant.use + enabled, аудит выдачи)
- [x] POST `/v1/assistant/usage` (`X_ASSISTANT_SECRET`, идемпотентно по operation_id)
- Зависимости: S0.2.
- Приёмка: 403/409 по общим правилам; ключ в ответах — только маска; повтор
  usage не удваивает расход.
- Проверка: `deno task test`; `npm test -w core` (PDP).
- Файлы: `core/src/pdp/actions.ts`, `functions/api/*`,
  `core/src/domains/assistant/*` + тесты.

### S0.4. Раздел «Настройки AI-ассистента»

- [x] Страница в группе «Настройки» (по образцу `/templates`), PageLayout,
  доступ chairman/tech_admin
- [x] Блок единого токена: write-only ввод, маска `••••1234`, замена с причиной
  и Idempotency-Key
- [x] Таблица сотрудников (`ConfigurableTable`): тумблер «Включён» (выключен у
  всех по умолчанию), дневной/месячный лимит
- [x] В эмуляции раздел скрыт
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

- [x] `source/assistant`: Worker, DO `AssistantDO` (1 DO = 1 сотрудник),
  `PiHarness` в Lifecycle, `pi_*` в SQLite DO
- [x] Изоляция Pi за `ChatRuntime` (фейк в тестах); пин версий
  (`agents` 0.30.x ↔ Pi 1.4)
- [x] `wrangler.toml`; секреты Worker: `SUPABASE_URL`, JWKS, `CABINET_ORIGIN`
- [x] Скрипты lint/typecheck/test; воркспейс добавлен в CI явно; README деплоя
- Зависимости: S0.1.
- Приёмка: транскрипты переживают рестарт DO; Pi не протекает за `ChatRuntime`
  (транскрипты — собственные таблицы Pi в SQLite DO; сквозной рестарт
  проверяется на `wrangler dev` в контроле ниже, юнит-среда без DO SQLite).
- Проверка: `npm run typecheck && npm test -w assistant` — зелёные;
  `wrangler deploy --dry-run` зелёный; CI — прогон добавлен (node-джоба).
- Файлы: `source/assistant/*`, `.github/workflows/ci.yml`.

### S1.2. WS-панель ассистента на главной

- [x] Панель на HomePage перед сеткой виджетов (очередь не заменяет);
  сворачиваемая карточка, мобильные стили сетки
- [x] JWT в первом WS-сообщении `{type:"auth", jwt}`, не в URL; свежий токен
  перечитывается перед каждым подключением, refresh — по `onAuthStateChange`
- [x] Стриминг снапшот + дельты, индикатор «Готовлю ответ», санитизированный
  Markdown (перенос прототипа, HTML не рендерится)
- [x] Кнопки «Очистить контекст» и «Повторить»; `operationId = messageId` —
  повтор того же id гасится идемпотентностью сервера, «Повторить» после
  завершённого сбоя идёт с новым id
- Референс: прототип `prototypes/dashboard-library`, страница `dashboard-browser.html` (панель на главной).
- Зависимости: S1.1, S0.3.
- Приёмка: повторная отправка сообщения не дублирует ответ; обрыв WS
  восстанавливается со снапшота; HTML из ответа не рендерится — покрыто
  jsdom-тестами с фейковым WebSocket.
- Проверка: `npm test -w admin` (jsdom) — зелёные; `npm run build -w admin` —
  зелёная; secret-scan admin/dist чист.
- Файлы: `admin/src/pages/home.tsx`, `admin/src/assistant/*` + тесты,
  `admin/src/lib/env.ts` (`VITE_ASSISTANT_WS_URL`).

### S1.3. Провайдер DeepSeek и память 05:00→05:00

- [x] Провайдер DeepSeek за `ChatRuntime` (`deepseekProvider` pi-ai, не
  `openaiProvider` — каталог и совместимости DeepSeek уже в pi-ai 1.4); ключ —
  по `runtime-token` на старте сессии, ленивый resolve при запросе модели,
  только в памяти изолята (не в `pi_*`, не в браузер, JWT тоже в памяти)
- [x] `settings.retry` + `afterFailedRun: "keep"` — очередь не теряется,
  «Повторить» доступно
- [x] Отклонение от плана: alarm 05:00 заменён эпохами — Lifecycle
  монополизирует `alarm()` DO (доки agents 0.30.x), поэтому сброс сделан
  адресацией: сутки 05:00→05:00 = номер UTC-суток (Алматы UTC+5 без DST),
  эффективная эпоха = max(config.epoch, UTC-день), «Очистить» =
  `POST /v1/assistant/clear` (bump конфиг-эпохи, аудит
  `assistant.session.cleared`) → новый DO с пустой историей; старая эпоха
  отвечает `epoch_stale`, панель переподключается. Миграция
  `assistant_user_config.epoch`.
- [x] Гейт JWT + enabled (кэш ≤ 60 с) до принятия сообщения — `gate.ts`
  (реюз `core/src/auth/jwt.ts` по SUPABASE_JWKS) + `checkEpoch` на каждом
  сообщении
- Зависимости: S1.1, S1.2, S0.3.
- Приёмка: сбой провайдера не теряет очередь (afterFailedRun keep, тест
  unanswered в ChatServer); старая эпоха недоступна после очистки (gate
  checkEpoch + панель, миграция epoch); выключенному — отказ (гейт, тест).
- Проверка: `npm test -w assistant` (гейт, дни, ChatServer) — зелёные;
  `npm test -w core` + deno check/lint/test (эпохи) — зелёные; jsdom кнопки
  «Очистить»/«Повторить» — зелёные.
- Файлы: `source/assistant/*` (pi-runtime, gate, almaty, эпохи),
  `core/src/domains/assistant/*` (epoch, clear), `functions/api/*` (роут
  clear), панель + тесты.

**Контроль после S1 (wrangler dev, без реальных данных):**
- [ ] Сообщение → стриминговый ответ; 05:00 очищает контекст; обрыв WS
  восстанавливается со снапшота.
- [ ] Секреты не в `pi_*`/логах; отклонения разобраны (alarm → эпохи
  зафиксировано выше; холодный подъём изолята без JWT — ограничение описано
  в README воркспейса).

## S2. Сущности и ссылки

### S2.1. Инструменты сущностей, виджеты и deep links

- [x] Инструменты: `search_requests`/`get_request`, `search_tasks`/`get_task`,
  `list_incidents`/`get_incident`, `search_residents`, `list_connections`,
  `list_staff`/`get_staff` — по JWT пользователя, `replay: "safe"`
- [x] `beforeTool` — белый список read-only реестра
- [x] Контракт `{items, total, page}` (плюс `has_more`), `page_size` ≤ 20,
  абсолютные `link`
- [x] Виджеты-карточки со ссылками; чтение `?id=<uuid>` в drawer'ах
  обращений/заданий; язык профиля ru/kk
- Зависимости: S1. (Больше 5 файлов — разделить на «инструменты» и «UI».)
- Приёмка: «покажи новые обращения» → карточки-ссылки, переход по `?id=`;
  пустой разрез — «нет данных» без выдумок.
- Проверка: `npm test -w assistant`; `npm test -w admin`.
- Файлы: `source/assistant/tools/*`, `admin/src/pages/requests.tsx`,
  `admin/src/pages/tasks.tsx` + тесты.
- Отклонения (реализация): инструменты в `source/assistant/src/tools/*` (не
  `source/assistant/tools/*`) — под include tsconfig/vitest воркспейса; deep
  links уже реализованы в кабинетных страницах (ADR-021, главная/доски:
  `?request=`, `?task=`, `?incident=`, `?entity=` + `entity_page=1`), поэтому
  чтение `?id=` не делалось — инструменты отдают готовые абсолютные ссылки
  существующего формата, allow-list AssistantMarkdown расширен на
  `/users/residents` (карточка жителя реестра); источники — из JSON-выводов
  инструментов (записи `pi.tool-result`): `WaitResult.sources` → `done` и
  снапшот, upsert-путь S1 не менялся; kk-подписи состояний аварий —
  предварительные, выверка в S6.2.

### S2.2. Тесты на инъекцию

- [x] Инъекция инструкций из данных не выводит за реестр и PDP
- [x] `beforeTool` отсекает не-whitelisted вызовы при инъекции; гейты не зависят
  от содержимого сообщения
- Зависимости: S2.1.
- Проверка: `npm test -w assistant`.
- Файлы: `source/assistant/src/tools/guard.test.ts`,
  `source/assistant/src/tools/injection.test.ts` (фикстуры — в самих тестах).

## S3. Расход и лимиты

### S3.1. Ledger и гейт лимитов до submit

- [x] DO → POST usage после ответа (идемпотентно по operation_id)
- [x] Гейт до submit: день (05:00→05:00 Алматы) / месяц против лимитов;
  превышение — отказ в панели без вызова модели
- Референс: прототип `prototypes/dashboard-library`, страница `assistant-limit.html` (исчерпанный лимит).
- Зависимости: S0.2, S0.3, S1.3.
- Приёмка: лимит блокирует до окна; отключение не обнуляет расход.
- Проверка: `npm test -w assistant` + `npm test -w core`.
- Файлы: `source/assistant/*` (gate), `core/src/domains/assistant` + тесты.

### S3.2. Панель расхода

- [x] Свой расход и остаток — включённому сотруднику; все —
  chairman/tech_admin (`assistant.usage.read`)
- [x] Таблица по дням/месяцам; блок в настройках + мини-индикатор в панели
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
