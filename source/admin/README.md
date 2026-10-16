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

- `/login` — страница входа (заглушка VS-0, кнопка Telegram заблокирована до VS-1, AUTH-01)
- `/` — защищённый layout (каркас VS-0; реальная серверная проверка прав — PDP — с VS-1)

Прямые ссылки на маршруты работают: Cloudflare Pages раздаёт `index.html`
на неизвестные пути (SPA-fallback).
