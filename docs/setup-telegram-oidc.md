# Настройка входа через Telegram OIDC (BotFather + Supabase Dashboard)

Пошаговая настройка входа сотрудников в веб-кабинет по [ADR-001](decisions/001-telegram-auth.md).
Выполняется один раз для среды; для пилотной и рабочей сред повторить с их значениями,
не переиспользуя dev-секреты.

Код кабинета уже вызывает провайдер `custom:telegram` (`source/admin/src/lib/telegram-auth.ts`,
`signInWithOAuth`) — настройка по этой инструкции закрывает риск R3 плана VS-1 (точная форма
custom-провайдера проверяется при настройке среды).

## 0. Что нужно

- Доступ к Dashboard Supabase dev-проекта (референс `fuwsmewtmxmzttwkbdex` — вымышленные
  данные, HLD §20; Dashboard → Project Settings → General).
- Telegram-аккаунт с доступом к @BotFather.
- Кабинет по HTTPS: `https://osi-admin.pages.dev` ([ADR-002](decisions/002-admin-cloudflare-pages.md)).
  Для локальной проверки — `http://localhost:5173` (`npm run dev -w admin`, публичные
  переменные в `admin/.env.local`).
- Требование ADR-001: Supabase Auth не ниже v2.196.0 (в облачных проектах версия актуальная;
  критично при переносе на self-hosted).

## 1. BotFather: Client ID, Client Secret и callback

1. Откройте **@BotFather** в Telegram и запустите его мини-апп.
2. Выберите бота (для dev допустим тот же бот, что и для webhook бота — на OIDC это не влияет).
3. Откройте раздел **Login Widget**.
4. Если OIDC-полей нет — нажмите **Switch to OpenID Connect Login**.
5. **Add a Redirect URI** → введите callback Supabase dev-проекта:

   ```
   https://fuwsmewtmxmzttwkbdex.supabase.co/auth/v1/callback
   ```

6. С этого же экрана возьмите **Client ID** и **Client Secret**. Client Secret — секрет
   провайдера: хранится только в Supabase Dashboard; не в коде, не в `.env*`, не в статической
   сборке (см. AGENTS.md, «Границы и безопасность»).

Для рабочей среды: повторить шаги 1–6 с callback рабочей среды и отдельными учётными данными.

## 2. Supabase Dashboard: провайдер и адреса возврата

1. **Authentication → Sign In / Providers → New Provider**, способ конфигурации —
   **Auto-discovery (OIDC)**.
2. Identifier: `custom:telegram` — ровно это значение использует `telegram-auth.ts`.
3. Client ID и Client Secret — из раздела 1.
4. Issuer URL: `https://oauth.telegram.org` (endpoints подтянутся через discovery).
5. Scopes: `openid`, `profile`; `phone` — только если нужен номер телефона.
6. **Email optional: включить** — Telegram не возвращает email, без этого вход не проходит.
7. Callback URL на форме (read-only) должен совпасть с URI из раздела 1 →
   **Create and enable provider**.
8. **Authentication → URL Configuration**:
   - Site URL: `https://osi-admin.pages.dev`
   - Redirect URLs: `https://osi-admin.pages.dev/**` и `http://localhost:5173/**`
     (кабинет делает `redirectTo: window.location.origin`, адрес должен быть в allow-list).

Примечания:

- PKCE включён по умолчанию — оставить включённым.
- `skip_nonce_check` не включать; если вход упадёт на проверке nonce — это точка проверки R3,
  вернуться к разбору формы провайдера.
- Облачный free-план допускает до 3 custom-провайдеров на проект.

Запасной вариант: если discovery не принимается (ошибка на шаге 7), создать провайдер того же
identifier, но типом **Manual configuration (OAuth2)** с ручными URL Telegram; форму уточнить
по документации из «Источников».

## 3. Привязка профиля (точка О-1)

Первый вход даёт 401 `NO_PROFILE` — это ожидаемо: вход не выдаёт роль (AUTH-01),
пользователь создан в `auth.users`, но ещё не связан с профилем ОСИ.

1. Выполните вход в кабинет через Telegram (раздел 2 настроен).
2. Dashboard → **Authentication → Users** → скопируйте `id` нового пользователя
   (claim `sub` его JWT).
3. Привяжите профиль по `source/db/seed/README.md`:

   ```sql
   -- Председатель (техадминистратор — telegram_user_id = 900000000002)
   update profile set supabase_user_id = '<SUB ИЗ AUTH.USERS>'
   where telegram_user_id = 900000000001;
   ```

4. Повторный вход: `/v1/meta/me` возвращает роли и пределы сеанса AUTH-06.

## 4. Проверка

По «Проверке при реализации» ADR-001 сразу после настройки:

- Назначенный сотрудник входит через Telegram и видит только разрешённые данные.
- Пользователь без привязанного профиля не получает доступа (401 `NO_PROFILE`).
- Изменение username в Telegram не меняет полномочия (привязка по `sub`, не по username).

Проверки отзыва полномочий и переноса привязки выполняются на срезах с бот-контуром
и эмуляцией (полный перечень — ADR-001).

## Источники

Проверены 2026-10-16:

- [Custom OAuth/OIDC Providers (Supabase)](https://supabase.com/docs/guides/auth/custom-oauth-providers)
- [Self-hosting: пример Telegram (Supabase)](https://supabase.com/docs/guides/self-hosting/self-hosted-custom-oauth-providers)
- [Telegram Login](https://core.telegram.org/bots/telegram-login)


## Уточнение после VS-2

Подтверждённые в боте профили и восстановленные привязки подключаются к кабинету автоматически **только** по серверной auth.identities провайдера custom:telegram: provider_id должен совпадать с проверенным Telegram ID профиля. Вход не создаёт person/profile и не выдаёт назначения. Редактируемые пользователем metadata, email, телефон и username не участвуют. Учётная запись Auth с несколькими identities не используется для автоматического первичного сопоставления. Для первого председателя по-прежнему требуется проверенная первоначальная настройка, а не самостоятельная регистрация с выбором служебной роли. Подробнее — ADR-004.
