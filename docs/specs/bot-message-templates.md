# Спецификация: раздел «Шаблоны» — декларативные тексты Telegram-ботов

- Дата: 2026-10-18
- Статус: черновик на утверждение
- Намерение: [docs/intent/bot-message-templates.md](../intent/bot-message-templates.md)
- Реализация: ветвь `feature/bot-message-templates`, ADR-010 (в срезе документации)

## 1. Цель

Все тексты двух Telegram-ботов (ответы диалогов + уведомления вне диалога)
становятся именованными шаблонами: ключ, секция, переменные `{name}`,
варианты ru/kk, append-only версии. Председатель/администратор/техадмин
управляют ими в новом разделе «Шаблоны» кабинета: поиск, каталог переменных,
предпросмотр, сохранение как новая версия, откат, сброс к дефолту. Без
переопределения бот использует встроенный дефолт из кода — обновление кода
улучшает не затёртые администратором тексты.

Бизнес-правила, FSM, PDP-разрешения на операции и аудитория данных не
меняются. Меняется только источник текста.

## 2. Модель данных

По образцу `time_rule`/`time_rule_version` (append-only, активна последняя
версия) + `job_template_version` (PK `(template_id, version)`).

```sql
create table if not exists message_template (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists message_template_version (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references message_template(id),
  version integer not null check (version > 0),
  text_ru text,
  text_kk text,
  use_default boolean not null default false,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (template_id, version),
  check (use_default or (text_ru is not null and text_kk is not null))
);
```

- **Инвариант:** активная версия = `max(version)`; отдельного указателя нет.
- **Append-only:** триггер `before update or delete` с исключением — по
  образцу `protect_time_rule_version`.
- `use_default = true` — маркер «сброс к дефолту»: тексты NULL, резолвер
  использует встроенный дефолт, в истории сброс виден как версия.
- Хранятся **только переопределения**: строка в `message_template` появляется
  при первой правке. Ключи, которых нет в каталоге кода, при чтении
  игнорируются (защита от рассинхрона после удаления ключа из кода).
- RLS: включить + `revoke` для anon/authenticated в теле миграции — доступ
  только service_role через Edge API (общая конвенция).
- `is_test` не нужен: шаблоны — глобальная настройка, действуют и на тестовые
  персоны (эмуляция видит те же тексты через simulator-канал).

## 3. Каталог шаблонов

Единственный источник — код, `source/core/src/templates/catalog/` (по файлу
на домен, агрегатор `index.ts`):

```ts
export interface TemplateVar {
  name: string;         // [a-z][a-z0-9_]*
  description: string;  // для администратора
  example: string;      // пример значения для предпросмотра
}
export interface TemplateDef {
  key: string;          // "registration.welcome", "errors.FORBIDDEN"
  section: SectionId;   // registration | requests | tasks | incidents | help | errors | notices | common
  title: string;        // человекочитаемое название (ru)
  description: string;
  variables: readonly TemplateVar[];
  ru: string;           // дефолт — точная копия текущего текста
  kk: string;
}
```

**Конвенция ключей:** `<домен>.<смысл>`, латиница, snake_case после точки.
Ключ стабилен: переименование запрещено (админские переопределения ссылаются
на ключ); неактуальный ключ помечается `deprecated` в каталоге и удаляется
позже отдельным решением.

**Инвентарь миграции** (из разведки кода):

| Поверхность | Объём | Стало ключами |
| --- | --- | --- |
| Реплики бота (`pick()` в `bot/*.ts`) | 136 мест: registration 53, tasks 37, incidents 16, help 12, request-text 10, request-files 5, inbound 1, bot-errors 1 + словарь `FRIENDLY` 14 кодов | ~150 |
| Словари `locales/` (registry 17, requests 11, tasks 9+16) | — | **не переносятся** (подписи-значения переменных, не сообщения) |
| Доменные уведомления (инлайн `{ru,kk}` + 5 конструкторов `locales/notifications.ts`) | ~28 мест в 9 файлах доменов | ~30 |

Составные реплики (списки, карточки, собираемые `join`'ом) собираются из
нескольких ключей-фрагментов + кодовой склейки. `/help` — набор ключей по
разделам справки.

**Не входят:** подписи кнопок (`InlineButton`, reply-меню, `entryMarkup`),
описания команд в меню Telegram (`set-bot-commands.ts`), словари-подписи
(`stateLabels` и т.п.), хранимые администратором тексты (`public_text`
инцидента VS-7, категории обращений, методички заданий).

## 4. Движок рендера и валидация

`source/core/src/templates/engine.ts` — чистые функции, без зависимостей:

- **Переменные:** `{name}`, имя `[a-z][a-z0-9_]*`. Значение всегда через
  `esc()` (и `<`, `&` — значения пользовательские). Даты/числа форматирует
  код до подстановки (`fmtDate`). Неизвестный токен остаётся в тексте как
  есть; фигурные скобки, не совпадающие с шаблоном переменной, проходят
  буквально. Эмодзи и `\n` — обычный текст, без обработки.
- **HTML:** разрешённые теги Telegram — `b, i, u, s, code, pre, a, tg-spoiler,
  blockquote`; `a href` — только `http(s)://` или `tg://`. Проверка тегов —
  regex-валидатор (баланс + белый список), **без новых зависимостей**.
- **Валидация при сохранении** (ошибка = блокирует):
  - `{token}` по грамматике, не найденный в `variables` ключа — ошибка
    (защита от опечаток);
  - запрещённый/разбалансированный тег — ошибка;
  - поле длиннее 4000 символов — ошибка (разрез длинных сообщений остаётся,
    но отдельный ключ такой длины — признак ошибки);
  - `text_kk` пуст при заполненном ru (и наоборот) — ошибка, оба языка
    обязательны (как `name_ru`/`name_kk` в категориях).
- **Страховка доставки:** существующий каскад `telegramSendMessage`
  (HTML → без parse_mode с разметкой → совсем без разметки) остаётся —
  битая разметка не теряет сообщение.

## 5. Интеграция

### 5.1 Переопределения в рантайме

`TemplateStore` — снимок активных переопределений, один запрос
(`select … where use_default = false` по активным версиям; таблица мала —
десятки строк):

- **Реплики бота:** загружается один раз на входящее обновление в
  `processInbound` и передаётся в сценарии через deps. Резолв:
  `t(store, lang, key, vars)` → переопределение или дефолт каталога.
- **Уведомления:** загружается один раз на батч в `dispatchNotices`.
- Кэшировать между вызовами нельзя (переопределение должно применяться
  сразу); один лишний маленький SELECT на вебхук/тик — приемлемо.

### 5.2 Реплики бота (поверхность 1)

Сценарии перестают писать литералы: `pick(lang, "…", "…")` →
`t(store, lang, "key", { vars })`. Помощники (`help.ts`, `request-text.ts`,
`bot-errors.ts`) принимают store параметром. `botErrorText` берёт дружелюбные
тексты кодов из каталога (секция `errors`) — это пилот среза 1.

### 5.3 Уведомления вне диалога (поверхность 2)

Точка рендера — **материализация** (консистентно с VS-5: «диспетчер
материализует уведомления», язык получателя выбирается там же):

- Домены кладут в outbox ссылку вместо готового текста:
  `notifyPerson(exec, personId, { template: "notices.task_assigned",
  vars: { number, title } }, key, options)`.
- `dispatchNotices`: если в payload `template` — резолв текста по языку
  получателя через TemplateStore батча; дальше без изменений (разрез частей,
  `entryMarkup`, дайджест, `notification.text` хранит одноязычный текст).
- **Обратная совместимость:** payload со старым полем `text: {ru,kk}`
  обрабатывается как раньше — ожидающие в очереди строки не ломаются при
  деплое.
- `notifyTelegram` (синхронные ответы webhook) продолжает принимать готовый
  `BotReply` — сценарии уже отрендерили через store.

## 6. PDP и аудит

`source/core/src/pdp/actions.ts`:

```ts
| "settings.templates.read"  // privileged: false, roles: [chairman, administrator, tech_admin]
| "settings.templates.edit"  // privileged: true,  roles: [chairman, administrator, tech_admin]
```

`privileged: true` — кабинет-only, в эмуляции запрещено (по образцу
`registry.rules.edit`). Чтение — не privileged (симметрично
`registry.rules.read`).

Аудит при каждом изменении: `action: "settings.templates.edit"`,
`entity_type: "message_template"`, `entity_id`, `after` (версия, тексты/
`use_default`, `reason`), автор и эмуляционный контекст проставляет
`buildAuditInput`. Отказы в доступе пишет конвейер API (существующее
поведение).

## 7. REST API

Маршруты в `source/functions/api/template-handlers.ts` (`TEMPLATE_ROUTES`
→ `ROUTES`), по образцу `job-templates`:

| Метод | Путь | Действие | Ответ |
| --- | --- | --- | --- |
| GET | `/v1/templates` | `settings.templates.read` | `{items}` — каталог ⊕ текущее состояние: `{key, section, title, description, variables, default_ru, default_kk, overridden, active: {version, text_ru, text_kk, use_default, created_at, reason} \| null}` |
| GET | `/v1/templates/:key/versions` | `settings.templates.read` | `{items}` — история версий, новые сверху |
| POST | `/v1/templates/:key` | `settings.templates.edit` | `201 {version}`; тело: `{text_ru, text_kk, reason, base_version?}` \| `{rollback_to: N, reason, base_version?}` \| `{use_default: true, reason, base_version?}` |
| POST | `/v1/templates/preview` | `settings.templates.read` | `{ru, kk}` — отрендеренный HTML с примерами переменных каталога, если vars не переданы |

- `base_version` — оптимистическая блокировка: если активная версия не
  совпала, `409 CONCURRENT_MODIFICATION`.
- POST требует `idempotency-key` (конвенция проекта).
- Ошибки валидации — `VALIDATION_FAILED` с перечнем проблем в `details`.
- Ключ, отсутствующий в каталоге кода, — `404 NOT_FOUND` (сохранять
  переопределения для неизвестных ключей нельзя).

## 8. Кабинет: страница «Шаблоны»

`source/admin/src/pages/templates.tsx` + тест; маршрут `/templates` в
`App.tsx`; пункт меню в `app-layout.tsx` для ролей
`chairman/administrator/tech_admin` (хелпер `canSeeTemplates` в
`lib/identity.ts`); сервер PDP проверяет независимо от меню.

Каркас по конвенциям проекта (AntD, `apiFetch`, Alert для ошибок, busy-флаги,
idempotency-key на изменение формы):

- **Список:** таблица (Название, Секция, Статус «Настроен/По умолчанию»,
  Изменена) с фильтром по секции (Select) и поиском (клиентский, ~200 строк);
  группировка секций — `Collapse` по образцу пресетов job-templates.
- **Редактор** (Drawer/Modal при выборе строки):
  - название, описание, статус;
  - два `TextArea` (ru/kk), предзаполнены активным переопределением или
    дефолтом; счётчик длины;
  - таблица переменных ключа: имя `{number}`, описание, пример, кнопка
    «Вставить» (в позицию курсора активного поля);
  - предпросмотр ru/kk: рендер через `POST /v1/templates/preview`, вывод в
    блоке как в Telegram (только разрешённые теги + экранированные значения —
    доверенный HTML);
  - причина изменения (обязательное поле reason, как у версий регламентов);
  - сохранение: POST c `base_version`; оба поля обязательны (ru и kk,
    подтверждено 2026-10-18); сброс к дефолту (если настроен);
    откат: в истории версии кнопка «Сделать активной» → POST `rollback_to`.
- **История версий:** разворачиваемые строки/список: версия, дата, автор,
  причина, признак «сброс к дефолту».
- UI кабинета — на русском (весь кабинет нелокализован); редактируемые
  тексты — пара полей ru/kk.

## 9. Технологии и команды

Новых зависимостей нет: валидация HTML — regex, движок — собственный.
Node ≥ 22, Deno 2. Команды — из AGENTS.md, из `source/`:

```
Линт:            npm run lint
Тайпчек:         npm run typecheck
Модульные тесты: npm test
Функции:         deno task check && deno task lint && deno task test
Сборка кабинета: npm run build -w admin
Миграции:        npm run db:push   (проверка на Sydney; Frankfurt не обновляется)
Интеграционные:  RUN_INTEGRATION_TESTS=1 npm run test:integration — только по явному запросу пользователя
```

## 10. Структура кода

```
source/core/src/templates/
  engine.ts            — render, validate (чистые)
  store.ts             — TemplateStore: загрузка активных переопределений, t()
  service.ts           — list/get/save/rollback/reset, аудит, PDP
  catalog/index.ts     — агрегатор
  catalog/errors.ts    — пилот среза 1 (14 кодов)
  catalog/registration.ts | requests.ts | tasks.ts | incidents.ts | help.ts | notices.ts | common.ts
  engine.test.ts | service.test.ts | store.test.ts (рядом)
source/functions/api/template-handlers.ts
source/admin/src/pages/templates.tsx | templates.test.tsx
source/db/migrations/20261018HHMMSS_bot_message_templates.sql
```

Миграция несёт: таблицы + check + append-only-триггер + RLS/revoke (do-блок).

## 11. Code Style

Как в проекте: комментарии по-русски, импорты с `.ts`, даты без ICU.

```ts
// catalog/requests.ts
export const requestCreated: TemplateDef = {
  key: "requests.created_ack",
  section: "requests",
  title: "Обращение принято",
  description: "Подтверждение после успешной отправки обращения",
  variables: [{ name: "number", description: "Номер обращения", example: "З-26-00001" }],
  ru: "✅ Обращение <b>{number}</b> принято. Администратор ответит в этом чате.",
  kk: "✅ <b>{number}</b> өтініш қабылданды. Әкімші осы чатта жауап береді.",
};

// сценарий бота: вместо pick(lang, "…", "…")
return t(store, L, "requests.created_ack", { number: req.number });

// домен: ссылка на шаблон в outbox вместо готового текста
notifyPerson(exec, personId, { template: "notices.task_assigned", vars: { number, title } }, key, opts);
```

## 12. Тестирование

- **Unit (Vitest, core):**
  - `engine.test.ts` — подстановка, экранирование `&<>` в значениях, эмодзи и
    `\n` без искажений, неизвестный токен остаётся, валидация: белый список
    тегов, баланс, неизвестная переменная, схема `href`, лимит длины;
  - `service.test.ts` (in-memory фейки из `testing/`) — сохранение = версия+1,
    `base_version` конфликт → 409, `rollback_to` копирует текст, `use_default`
    сбрасывает, PDP/`can()` проверяется, аудит добавляется;
  - **golden-тесты**: отрендеренный дефолт ключа == прежний литерал (полный
    словарь `errors`, выборочно registration/help) — гарантия отсутствия
    регрессии текстов при миграции.
- **Кабинет** (`templates.test.tsx`, Vitest + Testing Library, мок `apiFetch`):
  список рендерится, редактор открывается, сохранение шлёт POST с телом
  `{text_ru, text_kk, reason, base_version}`, откат — `{rollback_to, reason}`.
- **Функции (Deno):** check/lint/test; smoke регистрации маршрутов.
- **Интеграционные** (только по явному запросу): применение миграции,
  append-only-триггер (UPDATE/DELETE → исключение), SQL-репозиторий и
  TemplateStore против БД, RLS-заслон.

## 13. Границы

- **Всегда:** значения переменных через `esc()`; PDP на каждом эндпоинте;
  аудит на каждом изменении; append-only версий; оба языка при сохранении
  (кроме сброса); `idempotency-key` на POST; миграция идемпотентная.
- **Спросить сначала:** изменение схемы сверх спеки; новые зависимости;
  добавление секций каталога с новой семантикой рендера.
- **Никогда:** секреты в коде/логах; правка подписей кнопок и описаний команд
  меню через шаблоны; автоматическое удаление переопределений; кэш
  переопределений между вызовами; изменение бизнес-правил/FSM при переносе
  текстов.

## 14. Критерии приёмки

1. Раздел «Шаблоны» виден ролям chairman/administrator/tech_admin; прочим —
   нет (меню) и `403` (API); из эмуляции редактирование недоступно.
2. Полный цикл: найти → отредактировать ru и kk (с эмодзи и `{переменными}`)
   → увидеть предпросмотр → сохранить (новая версия) → откатиться к старой →
   сбросить к дефолту; история версий с автором и причиной.
3. Все реплики поверхностей 1–2 рендерятся через каталог; прямых
   `pick(lang, "литерал")` вне каталога в `bot/*.ts` не осталось
   (grep-проверка + golden-тесты); доменные уведомления уходят как
   `{template, vars}`.
4. Без переопределений исходящие тексты совпадают с прежними (golden);
   переопределение применяется к следующей реплике/материализации без
   рестарта.
5. Валидация отклоняет неизвестные переменные и запрещённые теги; битая
   разметка не теряет сообщение (каскад доставки).
6. Версии append-only (триггер в БД); откат создаёт новую версию; каждое
   изменение — запись в `audit_log`.
7. `npm run lint && npm run typecheck && npm test` и
   `deno task check/lint/test` — зелёные; интеграционные — по явному запросу.

## 15. Порядок сборки (вертикальные срезы)

| Срез | Содержимое | Результат |
| --- | --- | --- |
| С1 «Пилот: ошибки» | движок + валидация + магазин + миграция + PDP + API + страница кабинета; каталог — секция `errors` (14 кодов), `botErrorText` через каталог | сквозная вертикаль: правка текста ошибки в кабинете меняет ответ бота |
| С2 «Реплики бота» | перенос ~136 мест: registration → tasks → incidents → help → request-text → request-files → inbound/прочее | поверхность 1 полностью на шаблонах |
| С3 «Уведомления» | outbox `{template, vars}`, рендер в `dispatchNotices`, ~28 мест + 5 конструкторов `locales/notifications.ts` | поверхность 2 полностью на шаблонах |
| С4 «Документация» | ADR-010 (дефолты в коде, переопределения в БД, рендер в материализации), hld.md (модель данных, API), access-matrix.md (действия), AGENTS.md | документация — источник истины |

Зависимости: С2 и С3 зависят от С1 и могут идти параллельно; С4 — параллельно
С2/С3.

## 16. Решения по открытым вопросам (подтверждены 2026-10-18)

1. **Откат** — подтверждено: «Сделать активной» создаёт новую версию-копию
   выбранной старой; инвариант «активна последняя» сохраняется, откат виден
   в истории с автором и причиной.
2. **Обязательность kk** — подтверждено: сохранение требует оба языка
   (text_ru и text_kk непустые, кроме версии-сброса `use_default`).
3. **Тестовая отправка** («прислать себе как сообщение бота») — вне срезов
   1–4; отдельное решение после пилота.
