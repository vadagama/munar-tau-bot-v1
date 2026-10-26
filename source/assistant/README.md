# AI-ассистент кабинета — Worker + Durable Objects (ADR-021)

Отдельный деплой вне Cloudflare Pages: WebSocket-гейт, Durable Object на
сотрудника и эпоху с Pi Durable (`PiHarness`) и провайдером DeepSeek. Пилот —
read-only на вымышленных данных; реальные данные — только после ИБ-анализа
и отдельного ADR.

## Структура

- `src/index.ts` — Worker: только upgrade `/ws` с Origin кабинета
  (`CABINET_ORIGIN`), адресация DO `assistant:<profile_id>:<epoch>`; гейт JWT
  выполняет сам DO первым сообщением, JWT не в URL
- `src/do.ts` — `AssistantDO`: hibernatable WebSocket (состояние в
  serializeAttachment), `Lifecycle` + `PiHarness`, ключ провайдера — в памяти
  изолята; фоновые задачи ChatServer — в `ctx.waitUntil` (defer), исходящие
  fetch — с таймаутом 15 с
- `src/chat-server.ts` — логика WS-сессии: auth, снапшот + дельты fan-out,
  идемпотентный submit, retry, resync; гейт лимитов до submit, отчёт расхода
  после ответа (`onUsage`, S3.1); финал операции — фоновым вейтером в defer:
  переживает потерю сокета и рестарт изолята; тестируется на фейках
- `src/chat-runtime.ts` — интерфейс `ChatRuntime`: Pi изолирован за ним
- `src/pi-runtime.ts` — `PiChatRuntime`: PiHarness (корневая сессия), DeepSeek
  через `deepseekProvider` (pi-ai), ключ по `POST /v1/assistant/runtime-token`
  с JWT пользователя, `settings.retry` + `afterFailedRun: "keep"`;
  устанавливает в реестр read-only реестр инструментов + guard (S2.1),
  прикладывает пул источников из tool-result записей к `WaitResult` и
  снапшоту, таблицы отчётов — только из операции ответа (старые отчёты к
  новым ответам не прилипают), считает расход операции по usage
  assistant-записей между границами submit (S3.1)
- `src/tools/api-client.ts` — клиент GET `/v1` с JWT пользователя (ADR-021:
  PDP на стороне API), язык профиля `/v1/meta/me` с кэшем на изолят
- `src/tools/entity-tools.ts` — десять read-only инструментов сущностей
  (обращения, задания, аварии, жители, связи, сотрудники): контракт
  `{items, total, page, has_more}`, `page_size` ≤ 20, абсолютные deep links
  кабинета (ADR-021), подписи состояний и отказы по языку профиля ru/kk
  (S6.2), дружелюбные отказы вместо ошибок (403 → «нет доступа», пусто →
  пустой конверт)
- `src/tools/guard.ts` — расширение `assistant-entities`: инструменты + хук
  `hook(ToolTask, beforeTool)` — всё вне белого списка read-only реестра
  блокируется, решение только по имени вызова (инъекция в данных не
  выводит за контур); секции системного промпта по языку профиля ru/kk
  (`assistant-language`, S6.2) и формата ответа (`assistant-answer-format`:
  по умолчанию аккуратный текст, таблицы — только когда данные по сути
  табличные) и метрики tool-вызовов (S6.1)
- `src/tools/tool-metrics.ts` — обёртка execute: имя/длительность/исход
  каждого вызова — в structured log без персональных данных (S6.1)
- `src/tools/sources.ts` — пул карточек-ссылок `{title, href}` из JSON-выводов
  инструментов (`pi.tool-result`) для панели; не-абсолютные пути отбрасываются
- `src/gate.ts` — JWT Supabase (ES256 по JWKS, реюз `core/src/auth/jwt.ts`) +
  enabled через `GET /v1/assistant/settings/me` с кэшем ≤ 60 с и таймаутом
  похода 10 с; гейт лимитов до submit (`checkLimits`: день 05:00→05:00 /
  месяц против лимитов, S3.1) и обновление расхода в кэше из ответа POST
  usage (`updateUsage`)
- `src/almaty.ts` — сутки «05:00 → 05:00» Asia/Almaty (UTC-полночь) и эпохи DO
- `src/protocol.ts` — WS-протокол панели ↔ DO (включая `sources` у сообщений
  ассистента и отказ `limit_exceeded`)

## Память 05:00→05:00 и «Очистить»

Lifecycle монополизирует `alarm()` изолята, поэтому сброс контекста сделан
эпохами (отклонение от ранней идеи с будильником): сутки 05:00→05:00 — это
номер UTC-суток, эффективная эпоха = `max(конфиг-эпоха, сегодняшний день)`,
DO адресуется именем `assistant:<profile_id>:<epoch>`. Новый день или
«Очистить» (REST `POST /v1/assistant/clear`, поднимает конфиг-эпоху) дают
новый DO с пустой историей; DO старой эпохи — и на хендшейке, и на живом
сокете — отвечает `epoch_stale`, и панель переподключается (S6.1: старая
история недоступна даже с валидным JWT).

## Retention истории (S6.1)

История старой эпохи (`pi_*`-таблицы SQLite DO) стирается teardown-задачей
Lifecycle на следующей границе суток 05:00 + `ASSISTANT_RETENTION_DAYS`
суток хранения (по умолчанию 7 — предложено, утвердить у владельца
продукта). Стирание: `disableAlarms` → `dispose` рантайма →
`storage.deleteAll()` → закрытие сокетов; ленивый fallback стирает старую
эпоху при первом обращении, если задача не успела. Событие — structured log
`assistant_teardown` (observability).

## Наблюдаемость (S6.1)

`wrangler.toml` включает `[observability]`: structured-логи изолята —
`{"event":"tool_call", tool, ms, ok}` по каждому вызову инструмента и отчёты
Pi (`assistant_pi_report`: parked/faulted/failed — тип и kind задачи без
текстов ошибок и персональных данных). Парковка задачи (`task_parked`)
доставляется панели живым статусом, после переподключения — статусами после
снапшота; «Повторить» шлёт `{type:"retry"}` → `session.retry()`.

## Доставка done и watchdog тишины (инцидент 26.10.2026)

Финал операции (`done`) доставляет фоновый вейтер, живущий в `defer` (в DO —
`ctx.waitUntil`), а не обработчик WS-сообщения: потеря сокета или вытеснение
изолята больше не теряет ответ. Вейтер один на операцию (дедупликация при
resync), `done` рассылается всем аутентифицированным сокетам; запаркованная
операция вейтера не держит — ждёт «Повторить». После рестарта изолята
переподписка идёт на хендшейке и при resync: статусы `pending()` дополняются
вейтерами.

Клиент страхует сервер watchdog-ом busy-тишины (admin/src/assistant):
пока в панели есть queued/running, а от сервера нет трафика дольше 45 с,
хук сам отправляет `resync` (самоограничение — один на окно тишины).

Исходящие fetch DO ограничены по времени (15 с: runtime-token,
/v1-инструменты, POST usage), поход гейта в settings/me — 10 с: зависший
вызов не держит сессию и не живёт в waitUntil вечно.

## Секреты Worker (не в коде и не в сборке)

| Переменная | Смысл |
| --- | --- |
| `SUPABASE_URL` | Адрес Supabase стенда — вызовы `/v1` от DO с JWT пользователя |
| `SUPABASE_JWKS` | Публичные ключи ES256 для проверки JWT (тот же формат, что инжектируется в Edge Functions) |
| `CABINET_ORIGIN` | Разрешённый Origin кабинета для WebSocket |
| `X_ASSISTANT_SECRET` | Сервисный секрет учёта расхода: DO шлёт `POST /v1/assistant/usage` после каждого ответа (S3.1) |
| `ASSISTANT_RETENTION_DAYS` | Сутки хранения истории прошлой эпохи (S6.1), по умолчанию 7 |

Установка: `npx wrangler secret put SUPABASE_URL` (и аналогично остальные) из
этого каталога. Ключ провайдера модели в Worker не хранится: DO получает его
по `POST /v1/assistant/runtime-token` с JWT пользователя на старте сессии и
держит только в памяти изолята (не в `pi_*`, не в логах). JWT пользователя
также живёт только в памяти изолята.

Модель берётся из настроек (`model_id` в runtime-token): идентификатор ищется
в каталоге pi-ai провайдера DeepSeek; неизвестный идентификатор замещается
каталожным дефолтом (`deepseek-flash` в `agents` 0.30.x ↔ Pi 1.4).

Ограничение холодного подъёма: изолят, разбуженный задачей Pi до auth
пользователя, ещё не имеет JWT — модель уйдёт unanswered (`no_model`), очередь
сохранится (`afterFailedRun: keep`), ответ появится после переподключения
панели и «Повторить».

## Локальный запуск

```sh
npx wrangler dev
```

Без реальных данных: ассистент выключен сервером для всех по умолчанию
(ADR-021), платных запросов запуск не делает.

## Подключение кабинета

Панель на главной (admin/src/assistant) подключается к Worker по переменной
сборки кабинета `VITE_ASSISTANT_WS_URL` (только `wss://…`, для локальной
отладки `ws://…`), например:

```sh
VITE_ASSISTANT_WS_URL=wss://munar-assistant.<account>.workers.dev
```

Без переменной панель не подключается (ассистент «не настроен в сборке»);
доступ по-прежнему определяет сервер: settings/me (enabled + эпоха) и гейт DO.

## Деплой

```sh
npx wrangler deploy
```

Миграция DO-классов объявлена в `wrangler.toml` (`new_sqlite_classes`).

## Проверки

```sh
npm run typecheck -w assistant
npm test -w assistant
```

Пин версий стека: `agents` 0.30.x ↔ `@earendil-works/pi-*` 1.4.x — менять
только парой (beta-API Pi меняется).
