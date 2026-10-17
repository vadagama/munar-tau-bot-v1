# Кабинет ОСИ (admin)

SPA для администраторов и председателя ОСИ: Vite + React + Refine v4 + Ant Design 5.
Статика раздаётся с Cloudflare Pages без серверных функций (ADR-002).

## Команды (из `source/`)

```bash
npm install              # установка всех workspaces
npm run dev -w admin     # dev-сервер Vite
npm run build -w admin   # production-сборка в admin/dist
npm run preview -w admin # локальный просмотр сборки (SPA-fallback включён)
```

## Переменные среды

Только публичные значения, допустимые в браузере и в статической сборке (ADR-002).
Создайте файл `admin/.env.local` (в git не попадает — см. корневой `.gitignore`):

```bash
VITE_SUPABASE_URL=https://YOUR-SUPABASE-HOST
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLISHABLE-KEY
# Регион облачной БД; для текущего стенда — eu-central-1. Для self-hosted оставить пустым.
VITE_SUPABASE_FUNCTION_REGION=eu-central-1
```

Локальная интеграция с облачным бэкендом: функция api допускает только origin
кабинета (секрет `CABINET_ORIGIN`), поэтому из браузера под localhost прод
напрямую недоступен — CORS. Обход: задайте `ADMIN_UPSTREAM_URL = адрес
Supabase-проекта` (в `admin/.env.local` или в окружении) и
`VITE_SUPABASE_URL = http://localhost:5173` — dev-сервер Vite проксирует
`/auth/v1` и `/functions/v1` на прод, браузер ходит на свой origin. redirect
`http://localhost:5173` уже есть в allow-list Supabase Auth стенда.

```bash
VITE_SUPABASE_URL=http://localhost:5173 \
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
VITE_SUPABASE_FUNCTION_REGION=eu-central-1 \
ADMIN_UPSTREAM_URL=https://YOUR-SUPABASE-HOST \
npm run dev -w admin
```

Запрещено помещать сюда секреты: service-role key, токен бота, OIDC Client Secret.
Они живут только в секретах среды на сервере (см. `AGENTS.md`, «Границы и безопасность»).
Сборка проверяется автоматикой на отсутствие секретов (Task 7, VS-0).

## Маршруты

- `/login` — вход через Telegram (OIDC custom-провайдер, ADR-001). Без
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` — заглушка с пояснением
- `/` — главная: идентичность, роли с областями, пределы сеанса AUTH-06, выход
  (отзыв собственного сеанса + supabase signOut)
- `/audit` — журнал действий (AUD-01/02): фильтры entity/actor/период, курсорная
  пагинация; область записей фильтрует сервер (председатель — всё,
  администратор — свои дома, техадмин — технические события). Меню — для
  chairman/administrator/tech_admin
- `/emulation` — эмуляция ролей (пилот, HLD 10.8): тестовые персоны (is_test),
  старт/завершение сеанса; создание персон — техадмин, роли персонам назначает
  председатель. В режиме эмуляции вверху баннер с именем персоны и пометкой
  журналирования (действия пишутся в журнал с реальным актором и персоной)

Защита маршрутов: `<Authenticated>` Refine проверяет сессию Supabase; профиль,
роли и область при каждом запросе проверяет функция api (PDP на сервере).
401 от API — автоматический выход на `/login`.

Прямые ссылки на маршруты работают: Cloudflare Pages раздаёт `index.html`
на неизвестные пути (SPA-fallback).

## Слои кода

- `src/lib/env.ts` — публичные переменные среды (VITE_*); без env — режим заглушки
- `src/lib/supabase.ts` — клиент Supabase Auth (ADR-001)
- `src/lib/api.ts` — REST-клиент `/v1`: Bearer, разбор ошибок LLD-03 §1.1
- `src/lib/telegram-auth.ts` — изолированный вызов Telegram OIDC (риск R3:
  точная форма custom-провайдера проверяется при настройке среды)
- `src/lib/auth-provider.ts` — authProvider Refine (login/check/logout/getIdentity)
- `src/lib/identity.ts` — хук идентичности и флаги ролей для меню
- `src/pages/` — вход, главная, журнал, эмуляция; `src/layouts/` — каркас с баннером

## VS-2: реестр и регистрация

- `/registry` — здания/паркинги, четыре типа помещений, предварительные карточки и связи. «Восстановить Telegram» требует анкету с нового аккаунта и основание проверки; прежние сеансы отзываются.
- `/registrations` — очередь анкет/споров, фильтр состояний, подтверждение, уточнение, отказ. Явный выбор проверенной карточки сохраняет её ID; автоматического объединения по телефону нет.
- `/invites` — приглашения в пределах домов, без раскрытия токенов.
- `/registry-import` — XLSX-шаблон, загрузка, полный отчёт с подсвеченным Excel, атомарный commit, экспорт со спецправом IMP-05.
- `/time-rules` — версии сроков регистрации; право TIM-03 проверяет сервер.

Тестовый домен определяется по person.is_test, а не только по наличию эмуляции. В симуляторе выберите сценарий `registration`: это тот же модуль, который обрабатывает webhook. Работа с настоящим Telegram OIDC и доставкой требует настроенных внешних провайдера/бота; воспроизводимые тесты используют вымышленные данные.

Регион передаётся только вызовам прикладного API через `forceFunctionRegion`;
адрес Supabase Auth не меняется. После изменения переменной пересоберите кабинет.
При недоступности выбранного региона автоматического перенаправления нет: смените
регион или очистите переменную и пересоберите. Замеры — ADR-005.
