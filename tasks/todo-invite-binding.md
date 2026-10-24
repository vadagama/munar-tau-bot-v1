# Реестр: приглашение и привязка жильца

| # | Задача | Статус | Доказательство |
| --- | --- | --- | --- |
| 1 | SPEC + ADR-020 + индекс + план/реестр | готово | `docs/SPEC-invite-binding.md`, `docs/decisions/020-invite-binding.md`, коммит b56abd1 |
| 2 | Миграция invite nullable + погашение старых | готово | `20261024130000_invite_binding.sql`, коммит 3c3e8b2 |
| 3 | Домен: createInvite/acceptInvite/bindResident/revokeInvite | готово | коммит dabbb14; тесты: 70 сценарных, интеграционный REG-03/05 переписан под ADR-020 |
| 4 | Бот: /invite, /bind, /accesses, deep-link | готово | коммит 4b14b08; 349/349 модульных тестов |
| 5 | Навигация и подписи кнопок | готово | коммит 4b14b08; navigation.test.ts обновлён |
| 6 | Шаблоны (catalog + fixtures) | готово | коммит d4d2483; golden-фикстуры help-full/notices обновлены |
| 7 | API приглашений (GET/POST) | готово | коммит 93359d2 |
| 8 | Тесты сценария и навигации | готово | `npm test` 349 passed; `deno task test` 72 passed |
| 9 | Проверки: lint/typecheck/test, deno check/lint/test | готово | lint чист, typecheck 0 ошибок; read-only аудит кнопок `audit-bot-button-templates.ts` не запускался — в `.env.local` нет `DATABASE_URL` (запустить перед выпуском) |
| 10 | Доки-требования (REG-03, access-matrix, HLD, AGENTS.md), коммиты | готово | коммит 8f78486; PR — после одобрения пользователем |
