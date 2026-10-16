# LLD-03: API и контракты

Основание: [HLD раздел 12](../hld.md), [модель процессов](../request-lifecycle.md), [матрица прав](../access-matrix.md). Реализация — функция `api` (Edge Function, ADR-003); все эндпоинты ниже указаны в документном виде `/v1/…`, при развёртывании им соответствует `/functions/v1/api/v1/…` `[согласовано 16.10.2026]`.

## 1. Общие соглашения

- **Формат:** HTTPS, JSON (UTF-8). Даты — ISO 8601 UTC. Язык сообщений об ошибках — по `Accept-Language` (ru/kk, UI-02).
- **Аутентификация:** `Authorization: Bearer <JWT Supabase>`. Сервер проверяет JWT, находит `profile` по `supabase_user_id`/`telegram_user_id` (ADR-001), собирает `Actor` (профиль, человек, действующие `staff_assignment`, связи, участие). Отсутствие профиля — 401 `NO_PROFILE` (вход не выдаёт роль). Webhook бота — отдельная аутентификация (раздел 6).
- **Проверка полномочий:** PDP на каждом вызове для чтения и записи (AUTH-01); deny-by-default; отказ — 403 с `reason` без раскрытия существования запрещённого объекта (404 для чужих ресурсов).
- **Привилегированные действия** (AUTH-03): действуют только через кабинет (JWT-сеанс), недоступны webhook-каналу бота; после пилота дополнительно подтверждение TOTP (механизм — открытая точка AQ-02). Перечень ведётся в реестре PDP.
- **Сеанс (AUTH-06):** ≤ 12 ч от старта, 30 мин бездействия; контроль в middleware по `access_session` (LLD-02, раздел 13); превышение — 401 `SESSION_EXPIRED`. Отзыв полномочий блокирует следующий запрос из открытого сеанса (ROL-04): PDP проверяет назначения при каждом вызове; отзыв роли доменом `admin` дополнительно отзывает сеансы.
- **Идемпотентность (REQ-05, OPS-01):** мутации принимают заголовок `Idempotency-Key` (uuid, клиент генерирует при первом действии). Повтор с тем же ключом возвращает сохранённый результат без повторного эффекта. Коллизия ключа с другим телом — 409 `IDEMPOTENCY_CONFLICT`.
- **Конкурентность (FLOW-01):** агрегаты несут `version`; мутации передают `expected_version`; конфликт — 409 `CONCURRENT_MODIFICATION` с актуальным состоянием и новой `version` (второй участник обновляет карточку).
- **Пагинация:** `?limit=50&cursor=…` (курсор — base64 создано_в+id); максимум `limit=100`. Сортировка фиксирована на эндпоинте и указана в описании.
- **Трассировка:** каждый запрос получает `trace_id` (сервер) и `request_id`; в логи — без персональных данных (ADR-002).
- **Ограничение темпа:** 100 запросов/мин на профиль `[согласовано 16.10.2026]`; превышение — 429 `RATE_LIMITED` с `Retry-After`.

### 1.1. Формат ошибки

```json
{
  "error": {
    "code": "INVALID_TRANSITION",
    "message": "Недопустимый переход для текущего состояния",
    "details": { "current_state": "in_work", "allowed": ["on_review", "on_hold", "need_clarification"] },
    "trace_id": "01J…"
  }
}
```

Коды: `UNAUTHENTICATED`, `NO_PROFILE`, `SESSION_EXPIRED`, `FORBIDDEN`, `PRIVILEGED_REQUIRED` (нужен кабинет/TOTP), `NOT_FOUND`, `VALIDATION_FAILED` (details: список полей), `INVALID_TRANSITION`, `CONCURRENT_MODIFICATION`, `IDEMPOTENCY_CONFLICT`, `FILE_LIMIT` (FIL-01), `RULE_LEGAL_BOUNDARY` (TIM-07), `RATE_LIMITED`, `INTERNAL`.

### 1.2. Заголовки ответов приватности

Все ответы с персональными данными: `Cache-Control: no-store`; вложения отдаются подписанными URL с коротким сроком (≤ 5 мин `[согласовано 16.10.2026]`).

## 2. Файлы

1. `POST /v1/files/upload-url` — {owner_type, owner_id, bucket(аудитория), size, mime} → PDP на запись в владельца + FIL-01 (≤ 20 МБ) → создаёт `attachment` (status=incomplete) и возвращает {attachment_id, upload_url, expires_in}.
2. Клиент кладёт файл в Storage по `upload_url`.
3. `POST /v1/files/{attachment_id}/complete` — сервер проверяет размер/доступность, ставит `status=complete` (FIL-02: ошибка загрузки не блокирует бизнес-операцию — вложение остаётся неполным и помечено).
4. `GET /v1/files/{attachment_id}/url` — выдача ссылки на скачивание после PDP по аудитории вложения (MSG-03, PAY-08, DOC-02–03); ответ {url, expires_in}.

Прямые ссылки Storage из клиента не используются; ссылка из уведомления ведёт на `/v1/files/…/url` (переход после проверки).

## 3. Перечень эндпоинтов

### 3.1. `meta` и сеансы

| Метод и путь | Назначение | Права |
| --- | --- | --- |
| GET `/v1/meta/me` | Actor: профиль, роли, области, спецправа, пределы сеанса, признак активной эмуляции | любой аутентифицированный |
| GET `/v1/meta/dictionary` | категории, urgency, справочники UI | любой |
| GET `/v1/meta/health` |health-check без персональных данных (независимая проверка OPS-02) | без аутентификации |

### 3.2. `registrations` (REG)

| Метод и путь | Назначение | Права |
| --- | --- | --- |
| POST `/v1/registrations` | подать анкету (бот/кабинет); источник фиксируется | сам пользователь; администратор — за заявителя |
| PATCH `/v1/registrations/{id}` | исправить анкету до решения | автор |
| GET `/v1/registrations` | очередь анкет и споров (фильтры state) | администратор области |
| POST `/v1/registrations/{id}/approve` | подтвердить связь (создаёт `connection`) | администратор области |
| POST `/v1/registrations/{id}/reject` · `/clarify` | отказ с причиной / вопрос уточнения | администратор области |
| POST `/v1/registrations/{id}/dispute` | зафиксировать спор о доступе | администратор/собственник (REG-05) |
| POST `/v1/registrations/invites` | создать приглашение (72 ч по TIM) | подтверждённый собственник объекта |
| POST `/v1/registrations/invites/{token}/accept` | использовать приглашение | приглашённый |
| POST `/v1/registrations/tenant-approval` | подтвердить саморегистрацию арендатора | собственник (REG-04); эскалация — REG-14 |

### 3.3. `registry` (REG, IMP)

| Метод и путь | Назначение | Права |
| --- | --- | --- |
| GET `/v1/registry/persons` · `/premises` · `/connections` | чтение реестра с фильтрами | администратор области (данные по своим домам) |
| POST/PATCH `/v1/registry/persons` · `/premises` · `/connections` | ведение реестра с историей | администратор области |
| POST `/v1/registry/imports` | загрузить Excel → `import_batch` (валидация фоном) | администратор области (IMP-01) |
| GET `/v1/registry/imports/{id}` | статус, отчёт ошибок (sheet/row/field/reason) | создатель + админы области |
| POST `/v1/registry/imports/{id}/commit` | единое сохранение после валидации (IMP-02) | создатель |
| GET `/v1/registry/imports/{id}/template-errors` | выгрузка строк с ошибками | создатель |
| POST `/v1/registry/export` | экспорт персонального реестра (priv) | председатель / админ с правом IMP-05; журналируется |

### 3.4. `requests` (REQ, SHR, MSG, FLOW)

| Метод и путь | Назначение | Права |
| --- | --- | --- |
| POST `/v1/requests` | создать обращение (или сохранить черновик) — см. раздел 4.1 | подтверждённый пользователь; администратор — внешнее обращение |
| GET `/v1/requests` | списки: очередь админа, мои обращения (фильтры state, дом, категория) | по PDP |
| GET `/v1/requests/{id}` | карточка: состояние, участники, задания, документы (без чужих аудиторий) | автор/участник/сотрудники с правом |
| PATCH `/v1/requests/{id}/draft` | правка черновика | автор |
| DELETE `/v1/requests/{id}/draft` | удалить черновик (не отменяет зарегистрированное) | автор |
| POST `/v1/requests/{id}/transitions` | универсальный переход — см. раздел 4.2 | по таблице переходов + PDP |
| GET `/v1/requests/{id}/messages?channel=` | переписка по каналу | resident — автор/участники; internal — только сотрудники |
| POST `/v1/requests/{id}/messages` | сообщение в канал (+ вложения attachment) | по каналу и PDP (MSG-01–03) |
| POST `/v1/requests/{id}/participants` · DELETE `…/{person}` | совместный доступ (SHR-01–03) | только автор; отзыв при прекращении связи — автоматически |
| POST `/v1/requests/{id}/rating` · PATCH | оценка в допустимом окне (RAT) | только автор |
| GET `/v1/requests/{id}/log` | история переходов и причин (FLOW-01) | по PDP |

### 3.5. `tasks` (WRK, JOB)

| Метод и путь | Назначение | Права |
| --- | --- | --- |
| POST `/v1/tasks` | создать задание (локальное/общее) + назначить | ответственный администратор |
| POST `/v1/tasks/{id}/transitions` | переходы задания (раздел 4.3): принять/отказаться/начать/приостановить/отчёт/приёмка/доработка/переназначить/отменить | по таблице + PDP |
| POST `/v1/tasks/{id}/reports` | отчёт с версиями и обязательными доказательствами (WRK-16) | назначенный исполнитель |
| GET `/v1/tasks/{id}/reports` | отчёты и версии | админ; исполнитель — свои |
| POST `/v1/visits` · PATCH `/v1/visits/{id}` | визит: предложение/подтверждение/неявка (WRK-03–05) | исполнитель/автор/участник/админ |
| POST `/v1/common-works` | создать общую работу, связать обращения | администратор |
| POST `/v1/common-works/{id}/requests` · DELETE | связать/отвязать обращение (отмена работы не отменяет обращения) | администратор |
| POST `/v1/common-works/{id}/transitions` | завершение/отмена общей работы | администратор |
| GET `/v1/job-templates` · POST/PATCH | шаблоны регулярных заданий (JOB-01–06) | администратор |

### 3.6. `incidents` (EMG)

| Метод и путь | Назначение | Права |
| --- | --- | --- |
| POST `/v1/incidents` | зарегистрировать сигнал (охват, ответственный) | администратор/дежурный |
| POST `/v1/incidents/{id}/transitions` | переходы модели процессов раздел 6 (подтвердить/не подтвердить/устранение/проверка восстановления/завершить/возобновить) | администратор/дежурный |
| PATCH `/v1/incidents/{id}` | охват, прогноз, время следующего обновления | администратор/дежурный |
| POST `/v1/incidents/{id}/requests` | связать/отвязать обращение (без слияния) | администратор |
| GET `/v1/incidents` · `/{id}` | список/карточка (жители видят только опубликованные обновления) | по PDP |

### 3.7. `documents`, `publications` (DOC, WRK-17–18, PUB, FIN)

| Метод и путь | Назначение | Права |
| --- | --- | --- |
| POST `/v1/documents` | создать документ (тип, аудитория, область) | подготовитель |
| POST `/v1/documents/{id}/versions` | новая версия (файл attachment) | подготовитель |
| POST `/v1/documents/{id}/versions/{v}/submit` · `/approve` · `/return` | направить/принять/вернуть с причиной | подготовитель / проверяющий по типу |
| POST `/v1/documents/{id}/versions/{v}/needs-fix` | отметка об ошибке проверенного (история сохраняется) | проверяющий |
| GET `/v1/documents` | чтение по аудиториям DOC-02/03 и PDP | по аудитории |
| POST `/v1/publications` | объявление/отключение/отчёт работ (область, время) | администратор |
| POST `/v1/publications/{id}/transitions` | утвердить (финотчёт — председатель, FIN-01–04), опубликовать, архивировать | по PDP |
| GET `/v1/publications` | лента по своим домам и аудитории | по PDP |

### 3.8. `payments` (PAY)

| Метод и путь | Назначение | Права |
| --- | --- | --- |
| GET `/v1/payments/catalog` | каталог услуг с действующими версиями | по PDP |
| POST `/v1/payments/catalog/versions` | новая версия/изменение цен (priv) | только председатель (PAY-01) |
| POST `/v1/payments/orders` | создать заказ по обращению (снимок цены) | администратор |
| POST `/v1/payments/orders/{id}/agree` | явное согласие плательщика (PAY-04) | плательщик |
| POST `/v1/payments/orders/{id}/estimate` | смета/допрасходы (priv) | председатель/финадмин (PAY-02/04) |
| POST `/v1/payments/orders/{id}/invoice` | направить счёт в финансовую карточку бота (PAY-06) | сотрудник ОСИ |
| POST `/v1/payments/orders/{id}/payments` | отправить квитанцию (attachment) | плательщик (PAY-06) |
| POST `/v1/payments/{id}/verify` | ручная сверка: verified/rejected + причина (PAY-07) | финсотрудник; журналируется |
| POST `/v1/payments/{id}/correct` | исправление с сохранением прежней записи (PAY-10) | финсотрудник |
| POST `/v1/payments/orders/{id}/permission` | разрешение начать работу (PAY-08) | администратор |
| POST `/v1/payments/orders/{id}/cancel` | отмена: объём/расходы/возврат (PAY-09) | администратор; финподтверждения отдельно |
| GET `/v1/payments/orders/{id}` | карточка заказа; плательщику — только финансовая часть (PAY-03/08) | по PDP |

### 3.9. `polls`, `initiatives`, `moderation` (POL, IDEA, MOD)

| Метод и путь | Назначение | Права |
| --- | --- | --- |
| POST `/v1/polls` · PATCH | создать/изменить опрос (до открытия) | администратор |
| POST `/v1/polls/{id}/answer` · PATCH | ответ/изменение до завершения (один на человека) | подтверждённый житель аудитории |
| GET `/v1/polls/{id}/results` | сводка после окончания; администратору — распределение без имён | участники/админ (POL-02) |
| POST `/v1/initiatives` | подать инициативу (аудитория по связям автора) | житель (IDEA-01) |
| POST `/v1/initiatives/{id}/support` · DELETE | поддержать/отозвать | житель |
| POST `/v1/initiatives/{id}/comments` | комментарий (имя автора, без телефона) | аудитория инициативы |
| POST `/v1/initiatives/{id}/transitions` | утвердить/опубликовать/скрыть/ограничить с причиной и сроком | администратор (свои дома), председатель — расширить (IDEA-01–03) |
| POST `/v1/moderation/actions` | скрыть комментарий / ограничить публикации | администратор (MOD-01–02) |
| POST `/v1/moderation/{id}/appeal` | оспаривание модерации | автор |
| POST `/v1/moderation/appeals/{id}/resolve` | решение оспаривания | председатель (MOD-03) |

### 3.10. `reports` (REP)

| Метод и путь | Назначение | Права |
| --- | --- | --- |
| GET `/v1/reports/requests` · `/tasks` · `/incidents` · `/payments` | отчёты REP-01–04 с фильтрами периода/дома | исполнитель — свои; админ — область; председатель — ОСИ; без персональных данных |
| POST `/v1/reports/export` | Excel-выгрузка (тип, период, область) — очередью; журналируется | админ/председатель (REP-05) |
| GET `/v1/reports/exports/{id}` | статус и ссылка на файл | создатель |

### 3.11. `regulations` (TIM) — priv

| Метод и путь | Назначение | Права |
| --- | --- | --- |
| GET `/v1/regulations/rules` | реестр правил, версии, активная версия | чтение — админы с правом; значения видимы PDP |
| POST `/v1/regulations/rules/{key}/versions` | новая версия (params) | председатель/админ с правом/техадмин (TIM-03); правовое — за границей отклоняется (TIM-07, `RULE_LEGAL_BOUNDARY`) |
| POST `/v1/regulations/rules/{key}/activate` | активировать версию (запущенные таймеры не меняются — TIM-04) | те же |
| GET `/v1/regulations/timers` | активные таймеры (диагностика) | те же |

### 3.12. `notifications` (NTF)

| Метод и путь | Назначение | Права |
| --- | --- | --- |
| GET `/v1/notifications/mine` | история уведомлений пользователя | сам |
| PUT `/v1/notifications/prefs` | настройки по типам событий | сам |
| GET `/v1/notifications/delivery-errors` | ошибки важной доставки (NTF-02) | администратор |

### 3.13. `audit` (AUD)

| Метод и путь | Назначение | Права |
| --- | --- | --- |
| GET `/v1/audit` | журнал с фильтрами (entity, actor, период); область — по AUD-02 | председатель — всё; админ — свои дома; техадмин — технические события + поддержка ROL-06 |

### 3.14. `admin` (ROL, AUTH) — priv

| Метод и путь | Назначение | Права |
| --- | --- | --- |
| GET/POST/PATCH `/v1/admin/assignments` | назначить/изменить/отозвать роль, область, спецправа, срок (ROL-02–04) | по матрице: спецправа — только председатель |
| GET `/v1/admin/sessions` · POST `/v1/admin/sessions/{id}/revoke` | сеансы и отзыв (AUTH-06) | председатель/техадмин |
| POST `/v1/admin/telegram-link` | перенос привязки Telegram при восстановлении (AUTH-04) | техадмин (аварийное восстановление председателя) / председатель; журналируется, прежние сеансы отзываются |
| GET/POST `/v1/admin/support-access` | разрешение/отзыв поддержки с причиной и сроком (ROL-06) | председатель |

### 3.15. `ops`, `privacy` (OPS-03, PRV)

| Метод и путь | Назначение | Права |
| --- | --- | --- |
| POST `/v1/ops/backups` | зарегистрировать копию (результат, состав) | техадмин |
| GET `/v1/ops/backups` · `/v1/ops/status` | реестр копий, возраст последней полной | техадмин; напоминание — фоном (LLD-04) |
| POST `/v1/privacy/requests` | запрос удаления/отзыва согласия | пользователь |
| GET `/v1/privacy/requests` · POST `/{id}/resolve` | рассмотрение (решение — админ самостоятельно, PRV-02) | администратор |

### 3.16. `emulation` (пилот, HLD 10.8)

| Метод и путь | Назначение | Права |
| --- | --- | --- |
| GET/POST `/v1/emulation/persons` | тестовые персоны (is_test) с ролями и областью | техадмин |
| POST `/v1/emulation/sessions` | старт эмулированного сеанса (эмулируемая персона — тестовая) | техадмин |
| DELETE `/v1/emulation/sessions/{id}` | завершить сеанс | техадмин |
| POST `/v1/emulation/simulate` | шаг диалога бота: {scenario, input} — исполняет тот же сценарный модуль | техадмин |
| GET `/v1/emulation/inbox` | «входящие» симулятора (уведомления тестовых персон) | техадмин |

Правила: PDP оценивает права эмулируемой роли; привилегированные действия в эмуляции недоступны; все действия журналируются с реальным актором и эмулируемой персоной; уведомления не покидают симулятор.

## 4. Детальные контракты ключевых операций

### 4.1. Создание обращения (REQ-01–05)

`POST /v1/requests` с `Idempotency-Key`:

```json
{
  "kind": "request", "category_id": null, "urgency": "normal",
  "premises_id": "uuid|null", "building_id": "uuid|null",
  "text": "…", "attachments": ["attachment_id"],
  "as_draft": false, "expected_draft_version": null
}
```

- Эффект (одна транзакция): черновик → new (или создание сразу new), номер, `first_response_due_at` по TIM (2 рабочих часа), события `request.created`, `timer` напоминаний; участник author.
- Повтор с тем же `Idempotency-Key` → тот же номер, новых событий нет (REQ-05, OPS-01).
- Ответ: `{id, number, state, first_response_due_at, version}` + вне графика — предупреждение отсутствия немедленной обработки и аварийный телефон (TIM-05, EMG-02).

### 4.2. Переходы обращения — `POST /v1/requests/{id}/transitions`

```json
{ "action": "submit_result", "expected_version": 7, "reason": null,
  "payload": { "confirmation_payload": { "summary": "…", "document_version_ids": [], "task_report_ids": [] } } }
```

Соответствие действий модели процессов (раздел 4; каждое — валидируется FSM и PDP, пишет `request_log`, события — outbox):

| Action | Переход | Кто |
| --- | --- | --- |
| `submit` | draft → new | автор/админ |
| `start_review` | new → reviewing | админ |
| `ask_clarification` | new/reviewing/in_work/rework → need_clarification | админ |
| `answer_clarification` | need_clarification → reviewing (ответ сохранён с источником) | автор/участник |
| `resolve_clarification` | need_clarification → reviewing (снятие) | админ |
| `start_work` | reviewing → in_work (план/задания; платная — условия старта) | админ |
| `hold` · `resume` | → on_hold → reviewing (причина, дата следующего действия) | админ |
| `submit_result` | reviewing/in_work → awaiting_confirmation (комплект и снимок) | админ |
| `confirm_result` | awaiting_confirmation → closed (метод author) | автор |
| `return_result` | awaiting_confirmation → rework | автор |
| `admin_close` | awaiting_confirmation → closed (метод administrative, WRK-07/15) | админ |
| `withdraw_report` | awaiting_confirmation → in_work (отзыв ошибочного отчёта) | админ |
| `reopen` | closed → rework (в окне, по умолчанию 7 дней) | автор |
| `plan_rework` | rework → in_work | админ |
| `cancel_request` · `approve_cancel` · `reject_cancel` | запрос/согласование отмены (до начала работ — сразу canceled) | автор / админ |
| `reject` | открытое → rejected (основание) | админ |
| `appeal_reject` · `uphold_appeal` | оспаривание; rejected → reviewing | автор / председатель |

Ошибки: 409 `INVALID_TRANSITION` (details: текущее состояние и допустимые действия), 409 `CONCURRENT_MODIFICATION` (version), 403 `FORBIDDEN`. Устаревшее подтверждение не принимается: `confirm_result` проверяет `confirmation_version` снимка (модель процессов, сценарий 3).

### 4.3. Переходы задания (`tasks/{id}/transitions`) — модель процессов раздел 5

`assign` → awaiting_acceptance (админ) · `accept`/`decline` (исполнитель) · `start` (условия старта, платная — work_permission=granted) · `suspend`/`resume` (админ или запрос исполнителя; отдельное событие «Нет доступа») · `submit_report` (версия отчёта + доказательства) · `accept_report` / `return_for_rework` (админ; замечания) · `reassign` (→ created, история сохраняется) · `cancel` (обязательное — требуется замена или явное изменение объёма).

### 4.4. Инцидент (`incidents/{id}/transitions`) — модель процессов раздел 6

`register_signal` (создание) · `confirm` · `mark_unconfirmed` · `start_mitigation` (фактическое начало) · `report_recovery` (что восстановлено, зоны) · `fail_check` (→ mitigation) · `complete` (весь заявленный охват; частичное восстановление не проходит) · `reopen` (ошибочное завершение). Каждый переход сохраняет основание и уведомляет соответствующую аудиторию по `incident_scope` (EMG-06).

### 4.5. Финансовая карточка плательщика (PAY-03/06)

`GET /v1/payments/orders/{id}` для плательщика возвращает только: услугу, объём, согласованную цену/смету, платежи, возвраты, статус; переписка обращения не раскрывается. Отправка квитанции — `POST …/payments` (attachment в `files-finance`); уведомления — только плательщику (FLOW-03).

## 5. События outbox (реестр)

Публикуются в транзакции бизнес-изменения; потребители — `jobs` (LLD-04):

| Событие | Источник | Назначение |
| --- | --- | --- |
| `request.created` | requests | номер/срок автору; очередь админу (REQ-03, WRK-01) |
| `request.state_changed` | requests (все переходы) | уведомления по FLOW-03 (автору/сотрудникам, без внутренней переписки) |
| `task.assigned` · `task.reported` | tasks | исполнителю/админу (WRK-02, WRK-06) |
| `visit.proposed` · `visit.confirmed` | tasks | стороны визита (WRK-03–05) |
| `registration.approved` · `registration.escalated` | registrations | доступ подтверждён; эскалация REG-14 |
| `incident.confirmed` · `incident.updated` · `incident.completed` | incidents | адресные рассылки по `incident_scope` без дублирования (EMG-06) |
| `payment.invoice_sent` · `payment.submitted` · `payment.confirmed` · `payment.rejected` | payments | плательщику/финсотруднику (PAY-06–07) |
| `document.submitted` · `document.approved` · `document.returned` | documents | проверяющему/подготовителю (WRK-17–18) |
| `publication.published` | publications | дайджест NTF-01; немедленные — EMG |
| `digest.daily` | планировщик | сводка 20:00 ALMT (следует за концом смены), пустые не отправляются |
| `timer.fired` | планировщик | напоминания, эскалации, передачи (TIM) |
| `backup.overdue` | ops-контроль | только основному техадминистратору (OPS-03) |
| `import.completed` · `import.failed` | registry | создателю импорта |

Доставка уведомлений — at-least-once с дедупликацией по `notification.dedup_key` (NTF-02); согласование видно в карточке независимо от уведомлений (FLOW-03).

## 6. Webhook бота: `POST /functions/v1/bot-webhook`

- Проверка заголовка `X-Telegram-Bot-Api-Secret-Token` (не совпал — 401, тело не читается).
- Запись `bot_inbound(update_id)` — повтор доставки игнорируется (возврат 200 без эффекта, REQ-05).
- Лёгкие шаги (ответ меню, валидация) — синхронно; тяжёлые (создание обращения с файлами, отправка отчётов, рассылки) — задачи в `job_queue`; ответ Telegram — 200 как можно быстрее (≤ 10 с `[согласовано 16.10.2026]`).
- Ошибка обработки — `status=error` и повтор по очереди; Telegram не получает 5xx повторно (защита от пинг-понга) `[согласовано 16.10.2026]`.
- Диалог: `bot_dialog` читается/пишется в транзакции шага; прерванный вызов функции продолжается следующим обновлением/тиком (ADR-003).
- Привилегированных API-операций у бота нет (AUTH-03): сценарии бота вызывают те же домены с Actor = житель/исполнитель.

## 7. Открытые точки решения

| # | Точка | Влияние | Когда блокирует |
| --- | --- | --- | --- |
| А-1 | Маппинг пути `/v1` на функцию `api` (одна функция-роутер против функции на группу) | развёртывание, CORS | закрыто 16.10.2026: одна функция `api`-роутер, путь `/functions/v1/api/v1/…` |
| А-2 | Срок жизни подписанных URL (5 мин) и лимит темпа API | files, UX | закрыто 16.10.2026: 5 мин и 100 запросов/мин на профиль |
| А-3 | Перечень уведомлений по типам событий и обязательные (OQ-11) | templates, prefs | до VS-5 |
| А-4 | Формулы отчётов и знаменатель KPI (OQ-15) | reports | до VS-8 |
