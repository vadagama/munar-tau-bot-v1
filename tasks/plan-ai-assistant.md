# Implementation Plan: AI-ассистент кабинета на Pi Durable

Статус: на ревью. Направление и решения согласованы с пользователем 25.10.2026 (два раунда челенжа) — единственный источник решений: `docs/ideas/ai-assistant.md` (таблица «Согласованные решения»). Задачи ниже — детализация идеи в срезы; план ждёт одобрения, реализация — на ветке `feature/ai-assistant-s0-*` после одобрения, PR на согласование. ADR-021 пишется задачей S0.1 до кода.

UX-референс для задач UI — интерактивный прототип [`prototypes/dashboard-library`](../prototypes/dashboard-library/README.md) (снимок 25.10.2026): `dashboard-browser.html` — панель ассистента на главной (S1.2), `assistant-limit.html` — состояние исчерпанного лимита (S3.1). Заглушки API, демонстрационные роли и ограничения демо-сервера в production не переносятся; детали и запуск — в идее, раздел «UX-прототип».

## Сценарий пилота (финальный, согласован с пользователем)

- **Кто:** председатель и администратор. Исполнители не включаются — их сцена read-only не покрывает.
- **Где:** только демо-стенд (Frankfurt, вымышленные данные). Реальные данные не подключаются до ИБ-анализа и отдельного ADR.
- **Модель:** DeepSeek (OpenAI-совместимый API), единый токен ОСИ (BYOK отклонён); конкретная модель — выбор в S1 по качеству ru/kk.
- **Включение:** у всех выключен по умолчанию; включается сотруднику в разделе «Настройки AI-ассистента» с дневным/месячным лимитом токенов.
- **Память:** контекст «05:00 → 05:00» Asia/Almaty; «Очистить» — полное пересоздание DO (история удаляется).
- **Вопросы пилота:** свободные «кто что делает / кто как загружен», списки обращений/заданий/аварий с карточками-ссылками, аналитика: загрузка по исполнителям, создано/закрыто по дням, просрочки по домам.
- **Метрика:** 4 недели. Ассистент остаётся, если ≥2 из 3–4 пилотных сотрудников имеют ≥2 сессии/неделю; иначе разбор «ценность или интерфейс» и выключение.

## Architecture Decisions

- **Безопасность структурная, не промптовая:** инструменты агента ходят только в существующий `/v1` с JWT самого пользователя через полный конвейер (JWT → профиль → сеанс → Actor → PDP → аудит). БД агенту недоступна принципиально; нехватка разрезов — новые read-only агрегатные эндпоинты.
- **Ядро:** Pi Durable (`PiHarness`) в Durable Object — один DO на сотрудника; память диалога в SQLite DO (`pi_*`). Pi изолирован за интерфейсом `ChatRuntime`; версии пин (`agents` 0.30.x ↔ Pi 1.4); fallback не строим (beta, изоляция достаточна).
- **Роль настроек:** `assistant.settings.edit` = chairman + tech_admin, privileged, вне эмуляции, причина + Idempotency-Key. Per-user лимиты — контроль бюджета ОСИ при едином токене.
- **Аналитика:** доступ по существующему PDP (`report.*`), без новых ограничений; **фиксированные** агрегаты (3 шт.), не универсальный SQL-инструмент.
- **Вывод аналитики:** виджеты клиента из JSON инструментов (таблица S4a, график S4b на `@ant-design/plots`). **Модель не генерирует HTML** — ответ модели считается недоверенным вводом (XSS); числа только из API.
- **Графики/таблицы в HTML не рендерим** — решение пользователя 25.10.2026 после аргумента XSS; фиксируем как ограничение, не обсуждаем повторно.
- **Память дня:** reset по alarm в DO в 05:00 Asia/Almaty + ручная очистка = пересоздание DO по эпохе `assistant:<profile_id>:<epoch>`. Долгосрочной памяти нет.
- **Контур записи (будущее):** каждое пишущее действие — только после явного подтверждения человека в UI; фиксируется в ADR-021. Срез S5 — резерв под этот контур, в план не входит.
- **Эмуляция:** ассистент выключен в эмулированных сеансах.

## Команды (все — из `source/`)

- Проверки: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build -w admin`; Deno: `deno task check && deno task lint && deno task test`
- Новый воркспейс `assistant` добавить в CI явно (правило AGENTS.md: node-джоба гоняет только `core`)
- Интеграционные: `RUN_INTEGRATION_TESTS=1 npm run test:integration` — только по явному запросу пользователя (правило 17.10.2026; пропущенное не считать пройденным)
- Миграция на dev: `npm run db:push`
- Локальный запуск Worker: `npx wrangler dev` в `source/assistant` (без реальных данных)

## Task List

### Фаза S0: гейт, данные и настройки

- [ ] **Task S0.1: ADR-021 — Cloudflare Worker в стеке**
  **Description:** ADR «AI-ассистент на Cloudflare Worker + Durable Objects (Pi Durable)»: контекст (Pi Durable требует JS-runtime с SQLite изолята и alarm; Edge Functions изолятны — свой harness вопреки ADR-003), решение (новый воркспейс `source/assistant`, отдельный деплой wrangler вне Pages, секреты Worker), альтернативы (Edge Functions, LLM-вызовы из браузера, прямой доступ к БД, модель рисует HTML — по таблице «Альтернативы» идеи), проверки при реализации. Условия в ADR: пилот read-only на вымышленных данных; контур записи — только после явного подтверждения человека в UI; реальные данные — только после ИБ-анализа и отдельного ADR. Обновить индекс ADR и технологический стек в AGENTS.md.
  **Acceptance criteria:**
  - [ ] ADR-021 в `docs/decisions/` (контекст → решение → альтернативы → проверки)
  - [ ] Индекс `docs/README.md` обновлён; строки в AGENTS.md (стек/границы) внесены
  **Verification:** ревью diff. **Dependencies:** нет. **Files:** `docs/decisions/021-*.md`, `docs/README.md`, `AGENTS.md`. **Scope:** S

- [ ] **Task S0.2: Миграции и домен assistant**
  **Description:** Миграции: `assistant_settings` (singleton: provider, base_url, model_id, api_key_encrypted, version), `assistant_user_config` (profile_id PK, enabled по умолчанию false, daily_token_limit, monthly_token_limit, version), `assistant_usage_ledger` (append-only, unique `operation_id`, prompt/completion tokens, day по Алматы). RLS: config и ledger — владелец + privileged; settings — только privileged. SQL-репозитории в `core/src/domains/assistant` (порты + сервисы + SQL по образцу других доменов) + in-memory фейки в `core/testing`. `api_key_encrypted` — Supabase Vault; при отсутствии на self-hosted — AES-GCM с ключом в секретах функций (выбор зафиксировать в ADR-021 или заметкой к S0.2).
  **Acceptance criteria:**
  - [ ] Миграции идемпотентны; `schema-drift` проходит
  - [ ] RLS: config/ledger видны владельцу и privileged; settings — только privileged
  - [ ] Ledger append-only: повтор `operation_id` отклоняется уникальным индексом
  - [ ] Фейки повторяют контракт портов домена
  **Verification:** `npm test -w core`; `deno task check && deno task lint && deno task test`; SQL — ревью. **Dependencies:** S0.1 (порядком, не блокирует код). **Files:** `db/migrations/<ts>_assistant_*.sql`, `db/rls.sql`, `core/src/domains/assistant/*`, `core/testing/*` + тесты. **Scope:** M

- [ ] **Task S0.3: PDP-действия и эндпоинты**
  **Description:** Действия PDP: `assistant.use` (включённым сотрудникам), `assistant.settings.read`/`assistant.settings.edit` (chairman/tech_admin, privileged, вне эмуляции), `assistant.usage.read` (свой расход; все — privileged). Эндпоинты functions/api по общему конвейеру: GET/PUT `/v1/assistant/settings` (PUT — причина + Idempotency-Key), GET `/v1/assistant/settings/me`, GET `/v1/assistant/usage`, POST `/v1/assistant/runtime-token` (`assistant.use` + enabled; аудит выдачи), POST `/v1/assistant/usage` (сервисный секрет `X_ASSISTANT_SECRET` по образцу `X_JOBS_SECRET`; идемпотентно по `operation_id`). Ключ провайдера никогда не отдаётся в кабинет — только маска.
  **Acceptance criteria:**
  - [ ] PUT settings: privileged, вне эмуляции, причина/Idempotency-Key обязательны; 403/409 по общим правилам
  - [ ] runtime-token выдаёт ключ только enabled-профилю с `assistant.use` и пишет аудит-событие
  - [ ] Повтор POST usage с тем же `operation_id` не удваивает расход
  - [ ] В ответах settings ключ представлен маской, не значением
  **Verification:** `deno task test`; `npm test -w core` (PDP). **Dependencies:** S0.2. **Files:** `core/src/pdp/actions.ts`, `functions/api/*`, `core/src/domains/assistant/*` + тесты. **Scope:** M

- [ ] **Task S0.4: Раздел «Настройки AI-ассистента»**
  **Description:** Страница в группе «Настройки» навигации (по образцу `/templates`), доступ chairman/tech_admin, по общему `PageLayout`: блок единого токена (провайдер, модель, ключ — ввод write-only, отображение маской `••••1234`, замена с причиной и Idempotency-Key) + таблица сотрудников (`staff.read`, `ConfigurableTable`) с тумблером «Включён» (по умолчанию выключен у всех — натуральный kill switch) и дневным/месячным лимитом токенов. Отключение сотрудника закрывает его WS на следующем сообщении; расход не обнуляется. В эмуляции раздел недоступен.
  **Acceptance criteria:**
  - [ ] Тумблер и лимиты сохраняются через PUT с причиной и Idempotency-Key; 409 сохраняет ввод
  - [ ] Токен не отображается и не попадает в сборку/логи (secret-scan зелёный)
  - [ ] В эмуляции раздел скрыт
  **Verification:** `npm test -w admin`; `npm run build -w admin`. **Dependencies:** S0.3. **Files:** `admin/src/pages/assistant-settings.tsx` (имя целевое), навигация + тесты. **Scope:** M

**Checkpoint S0:** проверки зелёные; сквозной сценарий «администратор (председатель) включает сотрудника с лимитом и задаёт токен → GET `/v1/assistant/settings/me` у сотрудника возвращает enabled + остаток; выключенный сотрудник получает отказ» работает на стенде.

### Фаза S1: чат-скелет

- [ ] **Task S1.1: Воркспейс assistant — Worker + DO + PiHarness**
  **Description:** Новый npm-воркспейс `source/assistant`: Cloudflare Worker с Durable Object `AssistantDO` (один на сотрудника, `getByName(profile_id)`), `PiHarness` в Lifecycle, хранение в `pi_*` SQLite DO. Pi изолирован за интерфейсом `ChatRuntime` (фейк в тестах). Пин версий (`agents` 0.30.x ↔ Pi 1.4). `wrangler.toml`: имя, DO-биндинг, совместимости; секреты Worker — `SUPABASE_URL`, JWKS (публичный), `CABINET_ORIGIN`. Скрипты lint/typecheck/test воркспейса; прогон добавить в CI явно (node-джоба гоняет только `core`). Деплой — отдельный `npx wrangler deploy`, задокументировать в README воркспейса.
  **Acceptance criteria:**
  - [ ] DO создаётся и перезапускается, транскрипты в `pi_*`-таблицах переживают рестарт
  - [ ] Pi не протекает за `ChatRuntime`; тесты идут на фейке
  - [ ] CI гоняет новый воркспейс; lint/typecheck зелёные
  **Verification:** `npm run typecheck && npm test -w assistant`; CI зелёный. **Dependencies:** S0.1. **Files:** `source/assistant/*` (worker, do, runtime, wrangler.toml, README), `.github/workflows/ci.yml`. **Scope:** L (инфраструктурный каркас; при росте > 5 файлов — разбить на DO и ChatRuntime)

- [ ] **Task S1.2: WS-панель ассистента на главной**
  **Description:** Панель на HomePage рядом с «Очередь дня» (очередь не заменяет): сворачиваемая панель, на мобильном — полноэкранный лист. WS к Worker: JWT в первом сообщении `{type:"auth", jwt}`, не в URL; обновление токена по `onAuthStateChange`. Стриминг: снапшот + дельты; индикатор «в работе»; ответ — санитизированный Markdown (HTML из ответа не рендерится). Кнопка: «Повторить» после сбоя (кнопку «Очистить контекст» убрали — решение владельца 26.10.2026; POST /v1/assistant/clear сохранён). Макет по прототипу home-assistant: подсказка, чипы примеров запросов (заполняют поле ввода), форма «В DeepSeek отправятся…» + «Спросить», ответы под формой с временем и развёрнутым текстом сбоя. `operationId = messageId` — повторы клиента гасятся идемпотентностью. UX-референс — `dashboard-browser.html` из прототипа `prototypes/dashboard-library`.  
  **Acceptance criteria:**
  - [ ] Сообщение уходит по WS, ответ стримится; повторная отправка того же сообщения не дублирует ответ
  - [ ] JWT не в URL; истёкший токен → reconnect с новым по onAuthStateChange
  - [ ] Обрыв WS → переподключение и восстановление со снапшота; HTML/скрипт из ответа не рендерится
  **Verification:** `npm test -w admin` (jsdom: подключение, стриминг, восстановление со снапшота, санитизация); `npm run build -w admin`. **Dependencies:** S1.1, S0.3 (`settings/me` для гейта). **Files:** `admin/src/pages/home.tsx`, `admin/src/assistant/*` + тесты. **Scope:** M

- [ ] **Task S1.3: Провайдер DeepSeek и память 05:00→05:00**
  **Description:** Провайдер DeepSeek (OpenAI-совместимый) за `ChatRuntime`: ключ — из API по `runtime-token` на старте, держится в памяти изолята, в SQLite (`pi_*`) не пишется, в браузер не отдаётся. `settings.retry` (maxRetries, backoff), `afterFailedRun: "keep"` — очередь не теряется, «Повторить» доступно. Alarm 05:00 Asia/Almaty → `reset()` контекста; кнопка «Очистить» → пересоздание DO по эпохе `assistant:<profile_id>:<epoch>`. Гейт: DO проверяет JWT + enabled (кэш ≤ 60 с) до принятия сообщения.
  **Acceptance criteria:**
  - [ ] Ответ модели приходит в панель; сбой провайдера не теряет очередь, «Повторить» работает
  - [ ] Alarm 05:00 Almaty сбрасывает контекст; «Очистить» пересоздаёт DO — старая история недоступна
  - [ ] Выключенному сотруднику ассистент недоступен; ключ отсутствует в `pi_*` и логах
  **Verification:** `npm test -w assistant` (фейк провайдера, alarm, гейт); jsdom-тест кнопки. **Dependencies:** S1.1, S1.2, S0.3. **Files:** `source/assistant/*` (provider, gate, эпохи), панель (кнопка) + тесты. **Scope:** M

**Checkpoint S1:** на локальном `wrangler dev` (без реальных данных): включённый председатель открывает панель → сообщение → стриминговый ответ; после 05:00 контекст чист; после обрыва WS история восстанавливается со снапшота; выключенный сотрудник получает отказ.

### Фаза S2: сущности и ссылки

- [ ] **Task S2.1: Инструменты сущностей, виджеты и deep links**
  **Description:** Read-only инструменты с `replay: "safe"`: `search_requests`/`get_request` (`request.read`), `search_tasks`/`get_task` (`task.read`), `list_incidents`/`get_incident` (`incident.read`), `search_residents`, `list_connections` (`registry.read`), `list_staff`/`get_staff` (`staff.read`). Адаптер ходит в `/v1` с актуальным JWT пользователя; хук `beforeTool` блокирует всё вне read-only реестра. List-контракт `{items, total, page}`, жёсткий `page_size` ≤ 20, абсолютные `link`. Виджеты клиента: карточки-ссылки с характеристиками. Deep links: чтение `?id=<uuid>` в drawer'ах обращений/заданий (сейчас из URL читается только `/requests?state=new`). Тексты — язык профиля (ru/kk).
  **Acceptance criteria:**
  - [ ] «Покажи новые обращения» → список карточек-ссылок; переход открывает карточку по `?id=`
  - [ ] `beforeTool` блокирует вызов вне белого списка (тест)
  - [ ] На пустом разрезе — «нет данных», без выдумок; `page_size` > 20 невозможен
  **Verification:** `npm test -w assistant` (адаптеры с фейками API), `npm test -w admin` (deep link, виджеты). **Dependencies:** S1. **Files:** `source/assistant/tools/*`, `admin/src/pages/requests.tsx`, `admin/src/pages/tasks.tsx` (чтение `?id=`) + тесты. **Scope:** L — при реализации разбить на «инструменты» и «UI + deep links», если выходит больше 5 файлов на задачу

- [ ] **Task S2.2: Тесты на инъекцию**
  **Description:** Набор тестов безопасности read-only контура: инъекция инструкций через данные (название обращения/комментарий вида «ignore instructions…») не выводит агента за реестр и PDP; `beforeTool` отсекает не-whitelisted вызовы при любой инъекции; гейты не зависят от содержимого сообщения; «нет данных» на пустых разрезах.
  **Acceptance criteria:**
  - [ ] Инъекция из данных не приводит к tool-вызовам вне реестра
  - [ ] Гейты (JWT/enabled/лимиты) проверяются до submit и до содержимого
  **Verification:** `npm test -w assistant`. **Dependencies:** S2.1. **Files:** `source/assistant/tools/*.test.ts`, fixtures. **Scope:** S

### Фаза S3: расход и лимиты

- [ ] **Task S3.1: Ledger и гейт лимитов до submit**
  **Description:** После каждого ответа DO отправляет POST `/v1/assistant/usage` (`operation_id`, prompt/completion, model) — идемпотентно. Гейт **до** submit: сумма за день/месяц (границы по Asia/Almaty, день 05:00→05:00) против `daily_token_limit`/`monthly_token_limit`; превышение → отказ с понятным сообщением в панели без вызова модели (вид отказа — референс `assistant-limit.html` из прототипа). Отключение сотрудника расход не обнуляет.
  **Acceptance criteria:**
  - [ ] Повтор POST usage с тем же `operation_id` не удваивает сумму (интеграционно — по явному запросу)
  - [ ] Достигнутый лимит блокирует новое сообщение до окна (05:00 / месяц); пользователь видит причину
  - [ ] Гейт выполняется до submit, а не после ответа модели
  **Verification:** `npm test -w assistant` + `npm test -w core` (суммы, окна). **Dependencies:** S0.2, S0.3, S1.3. **Files:** `source/assistant/*` (gate), `core/src/domains/assistant` + тесты. **Scope:** M

- [ ] **Task S3.2: Панель расхода**
  **Description:** GET `/v1/assistant/usage` в кабинете: свой расход и остаток — включённому сотруднику (`assistant.use`); все сотрудники — chairman/tech_admin (`assistant.usage.read`). Таблица по дням/месяцам, остаток лимита; блок в «Настройках AI-ассистента» и остаток дневного лимита в шапке панели пользователя («Осталось N из M» вместо мини-индикатора — решение владельца 26.10.2026).
  **Acceptance criteria:**
  - [ ] Пользователь видит свой расход и остаток; админ — всех; чужой расход не виден (тест PDP)
  **Verification:** `deno task test`; `npm test -w admin`. **Dependencies:** S3.1, S0.4. **Files:** `functions/api/*`, страница настроек + тесты. **Scope:** S

**Checkpoint S2+S3 (внутренний пилот):** сквозной сценарий на стенде: включённый сотрудник спрашивает по сущностям — получает список со ссылками и карточки по `?id=`; расход учитывается, лимит блокирует; инъекционные тесты зелёные. Решение о переходе к S4a — после ревью пользователем.

### Фаза S4a: агрегаты и таблицы

- [ ] **Task S4a.1: Три агрегатных эндпоинта отчётного домена**
  **Description:** Read-only агрегаты по правам `report.*` (существующим, без новых ограничений): `workload_by_assignee`, `created_closed_by_day`, `overdue_by_building`. Фильтры: период (день 05:00→05:00 Алматы), при необходимости дом/исполнитель. PDP-область повторяется перед агрегацией (по образцу REP-01/02/03: фильтрация до агрегации, исторические снимки — из логов).
  **Acceptance criteria:**
  - [ ] Каждый эндпоинт возвращает компактные серии/таблицы для виджетов
  - [ ] Доступ по существующим `report.*`; вне области — пусто, не ошибка
  **Verification:** `deno task test`; `npm test -w core`. **Dependencies:** S0.3. **Files:** `core/src/domains/reports/*` (или отдельный модуль — решить по структуре), `functions/api/*` + тесты. **Scope:** M

- [ ] **Task S4a.2: Инструменты агрегатов и табличный виджет**
  **Description:** Инструменты `workload_by_assignee`/`created_closed_by_day`/`overdue_by_building` (read-only, `replay: "safe"`) + табличный виджет в панели (AntD Table из JSON-контракта инструмента).
  **Acceptance criteria:**
  - [ ] «Кто как загружен» → таблица с числами из API (не из памяти модели)
  - [ ] Нет данных за период → «нет данных»
  **Verification:** `npm test -w assistant` + `npm test -w admin`. **Dependencies:** S4a.1, S2.1. **Files:** `source/assistant/tools/*`, виджет в `admin/src/assistant/*` + тесты. **Scope:** S

### Фаза S4b: графики

- [ ] **Task S4b.1: Chart-виджет на @ant-design/plots**
  **Description:** Новая зависимость `@ant-design/plots` — **требует отдельного согласования пользователя перед установкой** (оценка размера бандла до установки). Chart-виджет из JSON инструмента (line/bar по типу данных). Модель не генерирует HTML и код графиков — только вызывает инструмент; HTML/скрипт в ответе модели не рендерится (санитизация, тест).
  **Acceptance criteria:**
  - [ ] «Динамика обращений по дням» → график из JSON инструмента
  - [ ] Попытка HTML/script в ответе модели не рендерится (тест)
  **Verification:** `npm test -w admin`; `npm run build -w admin`; ревью бандла. **Dependencies:** S4a.2. **Files:** `admin/package.json`, chart-виджет + тесты. **Scope:** S

### Фаза S6: харденинг

- [ ] **Task S6.1: Эпохи DO, retention и наблюдаемость**
  **Description:** Уточнить механику эпох (пересоздание DO при «Очистить»), retention истории в `pi_*` (сколько дней хранить), Workers observability для DO, счётчики tool-вызовов (`wrapTool` с таймингом), алерты parked-задач (`onReport` → `task_parked` в UI/логи, кнопка «Повторить» = `session.retry()`).
  **Acceptance criteria:**
  - [ ] Очистка создаёт новую эпоху, старая история недоступна; retention применяется
  - [ ] Parked-задача видна в UI с «Повторить»
  **Verification:** `npm test -w assistant`; ревью логов `wrangler dev`. **Dependencies:** S1.3, S2. **Files:** `source/assistant/*`, панель + тесты. **Scope:** M

- [ ] **Task S6.2: kk-язык и ИБ-чеклист**
  **Description:** Полный kk-язык ответов и подписей виджетов (по `profile.language`, как в ботах). ИБ-чеклист перед реальными данными: что уходит к DeepSeek, журналирование и обучение на данных, training opt-out, резидентность, вариант собственного vLLM в Казахстане; документ для ИБ-анализа с перечнем открытых пунктов.
  **Acceptance criteria:**
  - [ ] Ответы и подписи виджетов на kk
  - [ ] ИБ-чеклист задокументирован, открытые пункты перечислены явно
  **Verification:** тесты языка (golden); ревью документа. **Dependencies:** S4b, пилот. **Files:** `source/assistant/*` (промпты/инструменты), виджеты, `docs/`. **Scope:** M

### S5 — резерв (в план не входит)

Контур записи (пишущие действия после явного подтверждения человека, non-replay инструменты, approvals) — отдельный ADR после пилота. Номер среза S5 закреплён за этим будущим срезом.

**Checkpoint: Complete** (Definition of Done: тесты зелёные, без регрессий, поведение проверено на рантайме, документация обновлена)

- [ ] Критерии сценария пилота выполнены (панель на главной, память 05:00→05:00, сущности со ссылками, аналитика таблицами и графиками, лимиты и расход, восстановление после сбоев)
- [ ] PR готов к согласованию (merge — только после одобрения пользователя)

## Risks and Mitigations

| Риск | Влияние | Митигация |
| --- | --- | --- |
| Pi Durable/PiHarness — beta, API меняется | Среднее | Пин версий (`agents` 0.30.x ↔ Pi 1.4), изоляция за `ChatRuntime`; fallback заранее не строим |
| Персональные данные у DeepSeek (КНР) | Комплаенс | Пилот только на вымышленных данных демо-стенда; ИБ-анализ + ADR до реальных данных (S6.2) |
| Стоимость токенов | Бюджет ОСИ | Единый токен, per-user лимиты, kill switch (тумблер), ledger, гейт до submit |
| Cloudflare outage | Ассистент недоступен | Кабинет не блокируется; организационная компенсация — как OPS-01 |
| Deep links `?id=` конфликтуют с фильтрами существующих страниц | Низкое | Чтение `?id=` только при отсутствии конфликта; jsdom-тесты обеих страниц |
| Новая зависимость `@ant-design/plots` | Бандл/поддержка | Отдельное согласование в S4b; оценка размера бандла до установки |

## Open Questions

- Конкретная модель DeepSeek (`deepseek-chat` / `deepseek-reasoner`) — выбрать в S1 по качеству ru/kk и скорости.
- Объём и порядок ИБ-анализа после пилота (журналирование DeepSeek, training opt-out, резидентность, vLLM в Казахстане) — предмет S6.2.
- Размещение агрегатного модуля: отчётный домен или отдельный assistant-домен — решить в S4a.1 по фактической структуре `core/src/domains`.
- Значение retention истории в `pi_*` (S6.1) — предложить при реализации, утвердить у пользователя.
