# План: приглашение и привязка жильца (REG-03/13, ADR-020)

Дата: 24.10.2026. Спека — [SPEC-invite-binding.md](../docs/SPEC-invite-binding.md),
решение — [ADR-020](../docs/decisions/020-invite-binding.md).
Реестр хода — [todo-invite-binding.md](todo-invite-binding.md).

## Срезы

1. **Документы** — SPEC, ADR-020, индекс в `docs/README.md`, план/реестр.
2. **Миграция** — `invite.premises_id/role` nullable; активные приглашения
   старого типа гасятся. Файл `source/db/migrations/20261024130000_invite_binding.sql`.
3. **Домен** (`source/core/src/domains/registrations/service.ts`):
   `createInvite(deps, actor)` без помещения/роли (актор — действующий
   собственник ≥ 1 помещения); `acceptInvite` — только пометка used +
   уведомление инициатору (уведомление через `notifyTelegram`, кнопка
   «Привязать» → `/bind <person-uuid>`); `acceptInviteForNewTelegram` —
   person+profile+approved-анкета без помещения; новые `bindResident`
   (проверки: свой приглашённый, не сам, нет активной связи, роль ≠ owner)
   и `revokeInvite` (своё активное, без причины). Аудит: `connection.bind`,
   `registration.invite.revoke`; убрать уведомления `_4`/`_5`.
4. **Бот** (`source/core/src/bot/registration.ts`): `/invite` одним нажатием
   (+ отказ не-собственнику), убрать мёртвую ветку выбора помещения/роли и
   `/accept`; `/bind` — шаги человек/помещение/роль (state.bind_options,
   state.bind_premises); `/accesses` — секция приглашений +
   `/revokeinvite`; deep-link: при акторе — consume без мастера.
5. **Навигация** — строка меню `[invite, bind, accesses]`; подписи кнопок
   (`bot.controls`: invite/bind/accesses), правка help жителя.
6. **Шаблоны** — новые ключи (bind-флоу, секция «Отправленные приглашения»,
   ответы deep-link, notice о регистрации жильца); правка `invite`;
   удаление устаревших notices `_4`/`_5`; golden-фикстуры (help-full, notices).
7. **API** — `GET /v1/registrations/invites` без потери приглашений без
   помещения (LEFT JOIN); `POST` под новую сигнатуру.
8. **Тесты** — harness: новые префиксы SQL (insert invite/connection/person/
   profile, bind-списки, invites-секция); сценарии: /invite, /bind (успех,
   пусто, уже привязан, не мой приглашённый), /accesses с приглашениями,
   /revokeinvite, deep-link оба пути; navigation golden; фиксирует
   удаление старых веток.
9. **Проверки** — `npm test -w core -- templates`, `npm test`, `npm run lint`,
   `npm run typecheck`, `deno task check` (в `source/`); read-only аудит
   `audit-bot-button-templates.ts`.
10. **Доки-требования** — REG-03, access-matrix, HLD (модель Invite),
    сборка коммитов по срезам, PR.

## Решения (согласованы 24.10.2026)

- Привязка сразу активна, подтверждения жильцом нет.
- Администраторов о привязках не уведомлять — только аудит.
- Активные приглашения старого типа гасятся миграцией; совместимости нет.
- Username не хранится и не вводится: идентификация — через свою ссылку
  или кнопку уведомления.
