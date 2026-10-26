# AI-ассистент кабинета — Worker + Durable Objects (ADR-021)

Отдельный деплой вне Cloudflare Pages: WebSocket-гейт, Durable Object на
сотрудника с Pi Durable (`PiHarness`) и провайдером DeepSeek. Пилот —
read-only на вымышленных данных; реальные данные — только после ИБ-анализа
и отдельного ADR.

## Структура

- `src/index.ts` — Worker: точка входа, проверка Origin кабинета, передача
  upgrade-запроса WebSocket в DO
- `src/do.ts` — `AssistantDO`: hibernatable WebSocket, гейт JWT/enabled,
  `PiHarness` в Lifecycle, память диалога в SQLite DO (`pi_*`)
- `src/chat-runtime.ts` — интерфейс `ChatRuntime`: Pi изолирован за ним,
  тесты идут на фейке
- `src/pi-runtime.ts` — реализация `ChatRuntime` на PiHarness
- `src/gate.ts` — проверка JWT Supabase (ES256 по JWKS, реюз
  `core/src/auth/jwt.ts`) и enabled-флага с кэшем ≤ 60 с
- `src/almaty.ts` — граница суток «05:00 → 05:00» Asia/Almaty (UTC-полночь)
- `src/protocol.ts` — WS-протокол панели ↔ DO

## Секреты Worker (не в коде и не в сборке)

| Переменная | Смысл |
| --- | --- |
| `SUPABASE_URL` | Адрес Supabase стенда — вызовы `/v1` от DO с JWT пользователя |
| `SUPABASE_JWKS` | Публичные ключи ES256 для проверки JWT (тот же формат, что инжектируется в Edge Functions) |
| `CABINET_ORIGIN` | Разрешённый Origin кабинета для WebSocket |

Установка: `npx wrangler secret put SUPABASE_URL` (и аналогично остальные) из
этого каталога. Ключ провайдера модели в Worker не хранится: DO получает его
по `POST /v1/assistant/runtime-token` с JWT пользователя на старте сессии и
держит только в памяти изолята (не в `pi_*`, не в логах).

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
