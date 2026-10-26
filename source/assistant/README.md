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
  изолята
- `src/chat-server.ts` — логика WS-сессии: auth, снапшот + дельты fan-out,
  идемпотентный submit, retry, resync; тестируется на фейках
- `src/chat-runtime.ts` — интерфейс `ChatRuntime`: Pi изолирован за ним
- `src/pi-runtime.ts` — `PiChatRuntime`: PiHarness (корневая сессия), DeepSeek
  через `deepseekProvider` (pi-ai), ключ по `POST /v1/assistant/runtime-token`
  с JWT пользователя, `settings.retry` + `afterFailedRun: "keep"`
- `src/gate.ts` — JWT Supabase (ES256 по JWKS, реюз `core/src/auth/jwt.ts`) +
  enabled через `GET /v1/assistant/settings/me` с кэшем ≤ 60 с
- `src/almaty.ts` — сутки «05:00 → 05:00» Asia/Almaty (UTC-полночь) и эпохи DO
- `src/protocol.ts` — WS-протокол панели ↔ DO

## Память 05:00→05:00 и «Очистить»

Lifecycle монополизирует `alarm()` изолята, поэтому сброс контекста сделан
эпохами (отклонение от ранней идеи с будильником): сутки 05:00→05:00 — это
номер UTC-суток, эффективная эпоха = `max(конфиг-эпоха, сегодняшний день)`,
DO адресуется именем `assistant:<profile_id>:<epoch>`. Новый день или
«Очистить» (REST `POST /v1/assistant/clear`, поднимает конфиг-эпоху) дают
новый DO с пустой историей; DO старой эпохи при сообщении отвечает
`epoch_stale`, и панель переподключается.

## Секреты Worker (не в коде и не в сборке)

| Переменная | Смысл |
| --- | --- |
| `SUPABASE_URL` | Адрес Supabase стенда — вызовы `/v1` от DO с JWT пользователя |
| `SUPABASE_JWKS` | Публичные ключи ES256 для проверки JWT (тот же формат, что инжектируется в Edge Functions) |
| `CABINET_ORIGIN` | Разрешённый Origin кабинета для WebSocket |

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
