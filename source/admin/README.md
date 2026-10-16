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
