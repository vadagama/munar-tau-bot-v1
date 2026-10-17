# Лендинг жителей ЖК «Мунар Тау»

Публичная информационная страница: переход в Telegram, QR-код, возможности бота
и порядок регистрации (REG-01/02/04, REQ-03/06). Отдельный npm workspace,
статический HTML/CSS без клиентского JavaScript, Auth, API и переменных среды.
Решение — [ADR-007](../../docs/decisions/007-resident-landing.md).

## Локально

Все команды из `source/`, Node ≥ 22:

```sh
npm ci
npm run build -w landing
npm run preview -w landing
sh tools/scripts/check-build-secrets.sh landing/dist
```

Страница: `http://127.0.0.1:4174`. `npm run dev -w landing` также собирает и
запускает страницу; после изменения исходников повторите сборку.
Ссылка бота задаётся в `build.mjs`: HTML и QR генерируются из одного значения.

## Отдельный Cloudflare Pages

Создайте отдельный Pages-проект, например `munar-tau-residents`, подключив этот
репозиторий. Проект кабинета `osi-admin` для лендинга не использовать.

| Настройка | Значение |
| --- | --- |
| Framework preset | None |
| Production branch | main |
| Root directory | source |
| Build command | npm run build -w landing |
| Build output directory | landing/dist |
| Node version | 22 или выше |

Cloudflare устанавливает зависимости из общего `package-lock.json`.
Для предварительного просмотра выберите ветку PR. Секреты и Vite-переменные
кабинета лендингу не нужны. `_headers` входит в сборку; применяет его Pages.
CI собирает лендинг и проверяет артефакт на секреты; публикация отдельного
проекта настраивается независимо от существующей джобы деплоя кабинета.

При Direct Upload из `source/` после сборки:

```sh
npx wrangler@^4 pages deploy landing/dist --project-name munar-tau-residents
```

Нужны авторизация Cloudflare и заранее созданный отдельный Pages-проект.
Документация: [Static HTML на Pages](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/).

## Дизайн и проверка

Информационная структура вдохновлена `welcome.myshagal.ru`; тексты и фирменный
знак собственные. Весь контент — один белый скруглённый блок. Фон — та же
визуализация ЖК, что используется на текущем экране входа кабинета (из карточки
novostroyki-almaty.kz), с затемнением 35%; хранится локально, без внешних запросов.

Проверить ширины 320, 768, 1024, 1440 px: без горизонтальной прокрутки,
читаемый текст, видимый фокус ссылок, корректные переходы в Telegram.
QR должен декодироваться в ту же ссылку, что и кнопки. Страница работает без JS.
