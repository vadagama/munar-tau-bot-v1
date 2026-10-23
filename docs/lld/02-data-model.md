# LLD-02: Модель данных

Основание: [HLD раздел 11](../hld.md), [модель процессов](../request-lifecycle.md), [матрица прав](../access-matrix.md). Состояния и переходы — дословно из модели процессов; здесь заданы таблицы, ключи и ограничения.

## 1. Конвенции

- Кодировка имён: `snake_case`; одна схема `public` (совместимость с Supabase Auth/Storage); прямой клиентский доступ к БД закрыт (раздел 6).
- Время: `timestamptz`, хранится в UTC; часовой пояс регламентов — Asia/Almaty (допущение HLD раздел 7).
- Деньги: `numeric(12,2)`, валюта KZT (константа v1).
- Атрибуция: каждая мутация фиксирует автора (`actor_person_id`/`actor_profile_id`) и время; история состояний — в таблицах `*_log` (append-only), аудит — `audit_log` (AUD-01).
- Тестовые данные: `is_test` на `person`/`profile`; тестовые записи исключаются из KPI-01–02 и операционных отчётов (HLD 10.8).
- Удаление: физическое удаление не применяется к бизнес-записям; `status='archived'` или специализированные состояния; удаление по запросу — через `privacy_request` (PRV-02, правила хранения — OQ-12, открыто).
- Нумерация документов: таблица `number_sequence(key, year, seq)`; форматы `[согласовано 16.10.2026]`: обращение `З-ГГ-NNNNN`, инцидент `А-ГГ-NNNNN`, общая работа `ОР-ГГ-NNNNN`, задание `Т-ГГ-NNNNN`. Номер уникален и не переиспользуется (REQ-05).
- Идентификаторы: `uuid` (v4) или `bigserial` для журналов/очередей.

## 2. Идентичность, реестр, доступ

### 2.1. person — физическое лицо

| Колонка | Тип | Ограничения / заметки |
| --- | --- | --- |
| id | uuid PK | |
| full_name | text NOT NULL | ФИО; совпадение ФИО/телефона не объединяет людей (IMP-07) |
| phone_e164 | text UNIQUE NOT NULL | E.164, нормализация до сохранения (IMP-09) |
| status | enum person_status: active, archived | архивация — по PRV-02 |
| is_test | boolean DEFAULT false | тестовая персона эмуляции |
| comment | text | служебная заметка администратора |
| created_at, updated_at | timestamptz | |

### 2.2. profile — привязка Telegram

| Колонка | Тип | Ограничения / заметки |
| --- | --- | --- |
| id | uuid PK | |
| person_id | uuid FK person UNIQUE (частично: WHERE archived_at IS NULL) | один действующий профиль на человека; перенос привязки — AUTH-04 |
| telegram_user_id | bigint UNIQUE NOT NULL | проверенный сервером идентификатор (ADR-001); username не хранится как ключ |
| supabase_user_id | uuid UNIQUE | связка с сеансом Auth |
| language | enum language: ru, kk | UI-02 |
| is_test | boolean DEFAULT false | |
| created_at, archived_at | timestamptz | |

### 2.3. building — дома

`building`: id PK, code text NOT NULL (обозначение из реестра), name text, created_at. Уникальность `code`.

Здание = дом (решение пользователя от 19.10.2026): тип `kind` и таблица `building_parking` удалены. Отдельного сооружения-паркинга в реестре нет — все помещения, включая парковочные места, существуют в составе домов (REG-11).

### 2.4. premises — помещения

| Колонка | Тип | Ограничения / заметки |
| --- | --- | --- |
| id | uuid PK | |
| building_id | uuid FK building NOT NULL | |
| kind | enum premises_kind: apartment, commercial, parking_slot, storage | |
| number | text NOT NULL | строкой (буквы/литеры) |
| entrance, floor | int NULL | необязательны |
| status | enum premises_status: active, archived | |
| created_at, updated_at | timestamptz | |

UNIQUE (building_id, kind, number) — «номер квартиры совпал с номером кладовки» — два разных объекта (REG-11, IMP-07).

### 2.5. connection — связь человека с помещением

| Колонка | Тип | Ограничения / заметки |
| --- | --- | --- |
| id | uuid PK | |
| person_id | uuid FK person NOT NULL | |
| premises_id | uuid FK premises NOT NULL | |
| role | enum connection_role: owner, tenant, resident, other | REG-12 |
| basis | enum connection_basis: initial_registry, ownership, rent, family, other | «исходный реестр ОСИ» — стартовый импорт (IMP-12) |
| status | enum connection_status: pending, active, revoked | |
| start_date, end_date | date NULL | |
| confirmed_by, confirmed_at | uuid FK person, timestamptz NULL | |
| revoked_reason | text | REG-06 |
| created_by, created_at | | |

Частичные уникальные индексы: UNIQUE (person_id, premises_id) WHERE status='active'. Несколько активных собственников одного помещения допустимы (IMP-07/08, REG-05); для подтверждения проживающего достаточно одного. Решение пользователя от 17.10.2026.

### 2.6. staff_assignment — служебные полномочия

| Колонка | Тип | Ограничения / заметки |
| --- | --- | --- |
| id | uuid PK | |
| person_id | uuid FK person NOT NULL | |
| role | enum staff_role: administrator, deputy, chairman, tech_admin, duty, doc_reviewer, finance, executor | ROL-01; роль назначается, не выбирается |
| financial_rights | boolean DEFAULT false | ROL-02b, выдаёт только председатель |
| registry_export_rights | boolean DEFAULT false | IMP-05 |
| regulations_rights | boolean DEFAULT false | TIM-03 |
| status | enum assignment_status: active, revoked | ROL-04 |
| valid_from, valid_until | timestamptz NULL | ROL-03 (временные полномочия) |
| assigned_by, revoked_by | uuid FK person | |
| created_at | timestamptz | |

`staff_scope`: assignment_id FK, building_id FK, PK (assignment_id, building_id) — область домов; отсутствие строк у активного назначения = весь ОСИ (только для chairman/tech_admin) `[согласовано 16.10.2026]`. Председатель действует по всему ОСИ без назначения (ROL-02a). Выдача спецправ (financial/registry_export/regulations) проверяется доменом `admin` по матрице (только председатель), не триггером.

### 2.7. invite — приглашение

id PK, created_by FK person, premises_id FK, role enum connection_role, token text UNIQUE NOT NULL (генерируется сервером), expires_at timestamptz NOT NULL (72 ч по TIM, REG-03), used_at, used_by_profile FK profile, status enum invite_status {active, used, expired, revoked}. Одноразовость — уникальность used_by + статус; срок — таймер TIM.

### 2.8. registration — анкета/спор

id PK, person_id FK NULL (предварительный профиль без Telegram — REG-09), draft jsonb (данные анкеты), premises_id FK NULL, role enum connection_role, source enum reg_source {bot, admin, import}, telegram_user_id bigint NULL, state enum reg_state {pending_review, need_clarification, approved, rejected, disputed, withdrawn}, checker_id FK person NULL, dispute_of FK registration NULL (спор о доступе), decided_at, decided_reason, created_at, updated_at. История решений — `audit_log` + таймеры эскалации REG-14 (12 рабочих часов на этапе).

### 2.9. support_access, consent, privacy_request

- `support_access`: id, person_id (техадминистратор), granted_by FK (председатель), reason text, data_scope jsonb, valid_from, valid_until, revoked_at, created_at — ROL-06, AUTH-07; доступ истекает сам, продление — новое разрешение.
- `consent`: id, person_id, purpose text, terms_version text, accepted_at, withdrawn_at — PRV-01.
- `privacy_request`: id, person_id, kind enum {delete_profile, withdraw_consent, data_export}, state enum {received, reviewing, resolved}, resolution jsonb, decided_by FK person, decided_at, created_at — PRV-02–03 (решение — администратор самостоятельно).

## 3. Обращения и переписка

### 3.1. request — обращение

| Колонка | Тип | Ограничения / заметки |
| --- | --- | --- |
| id | uuid PK | |
| number | text UNIQUE NOT NULL | нумерация раздела 1 |
| kind | enum request_kind: request, question, complaint | |
| category_id | uuid FK request_category NULL | до классификации NULL |
| urgency | enum urgency: low, normal, high, critical | |
| state | enum request_state: draft, new, reviewing, need_clarification, in_work, on_hold, awaiting_confirmation, rework, closed, canceled, rejected | модель процессов раздел 3 |
| author_person_id | uuid FK person NOT NULL | для внешнего обращения — заявитель из источника |
| premises_id | uuid FK premises NULL | место проблемы; общее имущество может быть другого дома |
| building_id | uuid FK building NULL | денормализация для фильтров области |
| source | enum request_source: bot, admin, web | |
| external_applicant | text NULL | внешнее обращение (REQ-01–03) |
| assigned_admin_person_id | uuid FK person NULL | ответственный (FLOW-02) |
| prev_state | enum request_state NULL | для возврата из need_clarification/on_hold |
| clarification_question | text NULL | активный вопрос уточнения |
| clarification_due_at | timestamptz NULL | срок ответа по TIM |
| hold_reason, next_action_at | text, timestamptz NULL | отложена (FLOW-04: не обнуляет просрочку) |
| first_response_due_at, first_response_at | timestamptz NULL | 2 рабочих часа (TIM-05) |
| due_at (срок выполнения), overdue_since | timestamptz NULL | перенос — отдельная операция с историей |
| open_at (возраст от регистрации) | timestamptz | FLOW-04: не обнуляется |
| close_method | enum close_method: author, administrative NULL | WRK-07/15 |
| closed_at, closed_by | timestamptz, uuid FK person NULL | |
| cancel_request | jsonb NULL | запрос отмены после начала работ: причина, статус сохраняется |
| reject_reason, appeal_by_chairman | text, jsonb NULL | WRK-14, оспаривание |
| linked_incident_id | uuid FK incident NULL | |
| confirmation_version | int DEFAULT 0 | номер текущего снимка комплекта (3.4) |
| version | int NOT NULL | оптимистическая конкурентность (FLOW-01) |
| created_at, updated_at | timestamptz | |

Ограничение: черновик без номера (`number NULL` для draft) — частичный уникальный индекс по author для активного черновика `[согласовано 16.10.2026]` (один черновик на автора).

### 3.2. request_participant, request_category, rating

- `request_participant`: request_id FK, person_id FK, role enum participant_role {author, participant, payer}, added_by, added_at, revoked_at; PK (request_id, person_id). Совместный доступ (SHR-01–03): подтверждённый участник того же объекта; не подтверждает результат и не отменяет.
- `request_category`: id, name_ru, name_kk, sort, active — данные, OQ-02.
- `rating`: id, request_id UNIQUE, value int CHECK 1..5, comment text, created_at, withdrawn_at NULL (исключение из средней при возврате — RAT-02), person_id (автор).

### 3.3. message, attachment

`message`: id PK, request_id FK, channel enum message_channel {resident, internal} NOT NULL (неизменяемо, MSG-03), author_person_id FK NULL (системные), text text, created_at. INDEX (request_id, channel, created_at).

`attachment`: id PK, owner_type enum attachment_owner {message, task_report, document_version, payment, request}, owner_id uuid, bucket enum bucket_audience {resident, internal, finance, service} NOT NULL, storage_path text NOT NULL, size_bytes int CHECK ≤ 20 МБ (FIL-01), mime text, status enum attachment_status {complete, incomplete} (FIL-02), uploaded_by, created_at. INDEX (owner_type, owner_id).

Лимит «≤ 10 файлов на сообщение» — проверка домена `requests` при добавлении (FIL-01).

### 3.4. request_log, request_confirmation

- `request_log`: id bigserial, request_id, from_state, to_state, actor_person_id, actor_role text, reason text, meta jsonb, at timestamptz — все переходы FLOW-01 (append-only: UPDATE/DELETE отозваны, раздел 6).
- `request_confirmation`: id, request_id, version int, snapshot jsonb (отчёт: версии task_report, document_version, формулировка для жителя), created_by, created_at, decided_at, decision enum {confirmed_by_author, returned_by_author, admin_closed, withdrawn} NULL — снимок комплекта при передаче автору; подтверждение относится только к своей версии (модель процессов раздел 7).

## 4. Задания, общая работа

### 4.1. task — задание

| Колонка | Тип | Ограничения / заметки |
| --- | --- | --- |
| id | uuid PK | |
| number | text UNIQUE NOT NULL | |
| request_id | uuid FK request NULL | локальное задание |
| common_work_id | uuid FK common_work NULL | общее задание; ровно один из двух NOT NULL |
| title, instruction | text | объём, инструкция |
| assignee_person_id | uuid FK person NULL | |
| state | enum task_state: created, awaiting_acceptance, accepted, in_progress, suspended, on_review, rework, accepted_admin, canceled | модель процессов раздел 5 |
| prev_state | enum task_state NULL | возврат из suspended |
| suspend_reason, resume_conditions | text, jsonb | приостановка (сохраняется отдельное событие «Нет доступа») |
| due_at | timestamptz NULL | срок задания |
| depends_on_task_id | uuid FK task NULL | зависимости |
| required_evidence | jsonb NOT NULL DEFAULT '[]' | чек-лист обязательных доказательств (WRK-16) |
| start_conditions | jsonb NULL | условия старта (платная услуга — PAY) |
| is_required | boolean DEFAULT true | отменённое обязательное — не считается выполненным |
| template_id | uuid FK job_template NULL | происхождение из шаблона (JOB) |
| version | int NOT NULL | |
| created_by, created_at, updated_at | | |

### 4.2. task_log, task_report, visit, job_template

- `task_log`: id, task_id, from_state, to_state, actor, reason, meta jsonb, at — FLOW-01, включая переназначения (история назначений сохраняется) и возвраты.
- `task_report`: id, task_id, version int, text text, evidence jsonb (ссылки attachment), created_by, created_at. Отчёты версионные, не удаляются (WRK-16); приёмка/доработка — в состоянии task.
- `visit`: id, task_id FK, proposed_at, status enum visit_status {proposed, confirmed, missed, rescheduled}, confirmed_by_person, confirmed_by_kind enum {author, participant, executor, admin}, note, created_at — WRK-03–05.
- `job_template`: id, name, schedule jsonb (cron-выражение/интервал + календарь), blueprint jsonb (заготовка задания: title, instruction, required_evidence, assignee-правило), buildings jsonb NULL, active boolean, version int, created_by — JOB-01–06; изменение действующего шаблона — новая версия, запущенные периоды живут прежней.

### 4.3. common_work

id PK, number UNIQUE, title, state enum cw_state {planned, in_progress, on_review, completed, canceled}, incident_id FK NULL, created_by, created_at, completed_at NULL (прежняя дата сохраняется в истории при возврате задания), version int.
`common_work_request`: common_work_id FK, request_id FK, PK (common_work_id, request_id).

## 5. Аварии

- `incident`: id PK, number UNIQUE, state enum incident_state {signal_check, confirmed, not_confirmed, mitigation, recovery_check, completed} — модель процессов раздел 6; place text, forecast text, next_update_at timestamptz NULL, first_signal_at timestamptz, responsible_person_id FK, created_by, created_at, version int.
- `incident_scope`: incident_id FK, building_id FK, zone text NULL, PK (incident_id, building_id, zone) — охват для адресных рассылок (EMG-06).
- `incident_log`: id, incident_id, from_state, to_state, actor, reason, meta jsonb (основание, что восстановлено, способ проверки), at — все события сохраняются, включая подряд идущие проверки.

## 6. Документы и публикации

VS-8 (23.10.2026): [ADR-018](../decisions/018-vs8-documents-participation-reports.md)
и [спецификации](../../VS8-CAPABILITY-MAP.md) уточняют версии, историю проверок
и обязанности. Сокращённые состояния инициатив раздела 8 заменяются раздельными
состояниями публикации, этапами IDEA-03 и отдельной модерацией. История аудитории
сохраняет интервалы связей для расчёта на момент окончания опроса.

- `document`: id PK, title, kind {work_report, act, invoice, receipt, decision_basis, instruction, financial_report, other}, audience {resident, owner, staff, finance, service}, document_number, document_date, parties, request_id FK NULL, task_id FK NULL (не более одного источника), prepared_by/reviewer_id FK person, published_version_id, is_test, version, created_by, created_at. Invoice/receipt имеют финансовую аудиторию.
- `document_scope`: document_id FK, building_id FK, PK (document_id, building_id).
- `document_version`: id PK, document_id FK, version int, attachment_id FK attachment, signed_attachment_id FK attachment отдельно, signature_method/signature_basis, task_report_id FK, state {draft, on_review, returned, approved, needs_fix}, prepared_by, reviewed_by FK person, review_comment, reviewed_at, created_at, was_published. Содержание и файлы версии неизменяемы; переходы проверки записываются в append-only `document_log` (WRK-17–18, FIN-02–03).
- `document_obligation`: ровно один request_id/task_id, kind, phase {before_acceptance, after_acceptance}, basis, prepared_by, reviewer_id, signed_required, rule_version_id FK, rule_snapshot, due_at, document_version_id FK, completed_at, reminded_at, escalated_at, version, is_test. Условия и срок неизменяемы; передача меняет сотрудников с аудитом, `needs_fix` открывает обязанность повторно. RLS закрывает все пять таблиц документов от прямого клиента.
- `job_template.blueprint.document_requirements`: до 20 требований kind/phase/basis/prepared_by/reviewer_id/signed_required без длительностей. При создании/явной смене методички они применяются в той же транзакции задания. Снимок обязанности включает identity версии методички и TIM. Планировщик использует сохранённую методичку, старые обязанности не удаляются.
- `publication`: id PK, kind enum pub_kind {announcement, outage, work_report, financial_report}, title, body text, requires_document, common_work_id FK NULL, financial_version_id FK NULL, state enum pub_state {draft, pending_approval, scheduled, published, archived}, publish_at timestamptz NULL, scheduled_by FK person NULL, created_by, approved_by FK person NULL (разрешение на публикацию — FIN-01–04), approval_note, created_at, version int. Плановый выпуск повторно авторизует scheduled_by (для прежних записей — created_by); причина управленческого действия сохраняется в publication_log.reason и аудите.
- `publication_scope`: publication_id FK, building_id FK, PK (publication_id, building_id).
- `publication_document`: конкретные версии оснований обычной публикации; менять набор можно только до выпуска. При выпуске проверяются PDP документа/источника, файлы, состояние и охват; связь не раскрывает внутренний файл читателю публикации.
- FIN VS-8: `financial_rule`/`financial_rule_version` — версионный регламент; `financial_obligation` — снимок формы/периода/домов/ответственных/срока и активного выпуска; `financial_publication_version` — неизменяемые title/body/период/область/комплект и пояснение исправления; `financial_publication_approval` — append-only разрешение председателя на снимок; `financial_package_document` — конкретные версии с кодами и признаком раскрытия. Разрешение и активная версия привязаны составными FK к тому же выпуску и обязанности. Новый период — отдельная публикация; исправление сохраняет исходную обязанность, прежняя опубликованная версия получает replaced_at только при выпуске новой.
- `financial_placement` хранит отдельные доказательства размещения версии по каналам, `financial_issue` — ошибки оснований опубликованного комплекта. Они не подменяются доставкой outbox. Обязанность сохраняет версии финансового регламента и TIM, параметры и первоначальный due_at; отсчёт начинается с локальной полуночи после включительной даты периода в Алматы. Передача ответственных не меняет условия. Только пригодная текущая выпущенная версия с доказательствами всех исходных каналов завершает обязанность; исторические факты не меняют завершённость новой версии. needs_fix активного комплекта однократно открывает ту же обязанность с прежним сроком. Сервисы, API, кабинет и сценарии ботов подключены.
- `broadcast.financial_version_id` с составным FK `(publication_id,financial_version_id)` сохраняет точную версию финансового уведомления. При наличии версии публикация обязательна. `financialVersionId` проходит в outbox, digest item и notification.event_ref; повторная авторизация проверяет опубликованность этой версии, режим и актуальную собственность в её домах. Каталог бота отбирает опубликованные финансовые снимки с PDP до пагинации и не зависит от текущего черновика publication.
- FIN не выставляет глобальные флаги публикации документов. Раскрытая версия доступна через опубликованный выпуск только при действующей подтверждённой собственности в его домах; собственная аудитория и PDP источника документа проверяются отдельно. Назначение на задание не расширяет финансовую видимость версий. Служебные основания не входят в публичный DTO; их ошибка представлена общим предупреждением.

- POL VS-8 P01: `audience_history_meta.starts_at` фиксирует начало наблюдений; `audience_connection_event` хранит append-only снимки connection/person/premises/building/mode/active-profile и полуоткрытые сроки действия. FK к удаляемому реестру нет. Триггеры охватывают архив/восстановление, перенос, режим и удаление; штатное каскадное удаление реестра сохраняет историю. Сервер объединяет интервалы всех подходящих связей, сохраняя разрыв при потере последней. Общий транзакционный gate и единая отметка атомарного изменения — ADR-019. Схема опросов и фиксация итогов реализованы в P02/P03.

- POL P02: `poll` хранит черновик/открытые параметры и версию; `poll_answer` имеет PK `(poll_id,person_id)` и версию личного ответа; `poll_answer_log` — закрытая append-only история выбора/исключения. После открытия параметры защищены guard; дата/время записи и право в момент ответа сверяются одной отметкой PostgreSQL. Личный выбор не копируется в audit_log. Результаты и отмена реализованы в P03.

- POL P03: `poll_result` — неизменяемый итог с точным as_of=closes_at, числом и распределением; `poll_result_participant` — закрытый состав для чтения сводки после переезда. Deferred constraint требует завершённого согласованного снимка. История считается слева от конца открытого периода, без пересчёта по позднему реестру. Индивидуальный ответ и состав не входят в публичные результаты, журнал ошибок доставки или followup.

## 7. Платные услуги

- `service_catalog_item`: id PK, key text (стабильный код услуги), name, unit text, price numeric(12,2), terms text, version int, effective_from date, active boolean, approved_by FK person (только председатель, PAY-01), approved_at. Изменение цены — новая версия; согласованная цена заказа не меняется задним числом (PAY-02).
- `payment_order`: id PK, request_id FK NOT NULL, catalog_item_id FK NULL, agreed_snapshot jsonb NOT NULL (цена/объём/условия на момент согласования), agreed_price numeric(12,2), payer_person_id FK NOT NULL (назначенный плательщик, PAY-03), author_person_id FK, payer_consent_at timestamptz NULL (явное согласие до выполнения, PAY-04), work_permission enum work_permission {not_required, pending, granted} (PAY-08: исполнитель видит только это), state enum order_state {draft, price_agreed, estimate_approved, awaiting_payment, payment_checking, paid, discrepancy, refund_pending, closed, canceled}, cancel_reason jsonb NULL (объём/расходы при отмене — PAY-09), created_by, created_at, version int.
- `estimate`: id PK, order_id FK, version int, items jsonb (позиции), amount numeric(12,2), approved_by FK (председатель или финадминистратор, PAY-02/04), approved_at, payer_consent_at, created_at.
- `payment`: id PK, order_id FK, amount numeric(12,2), receipt_attachment_id FK attachment (квитанция; повторное использование исключено — частичный уникальный индекс WHERE state NOT IN (rejected, refunded)), state enum payment_state {submitted, verified, rejected, refunded} — ручная сверка (PAY-07): verified_by, verified_at, discrepancy_reason text NULL, correction_of FK payment NULL (исправление с сохранением прежней записи, PAY-10), created_at.

Статус работы и статус расчётов независимы (PAY-08): работа — `request.state`, деньги — `payment_order.state`; автоматического перехода между ветвями нет (модель процессов раздел 7).

## 8. Опросы, инициативы, модерация

- `poll`: id UUID PK, question text, options jsonb `[{key,label}]`, building_ids uuid[], state text {draft, open, closed, canceled}, closes_at/opened_at/closed_at/canceled_at timestamptz, cancel_reason, is_test, created_by, created_at, version. После открытия параметры неизменяемы; в момент открытия сравнение срока и opened_at используют одну серверную отметку.
- `poll_answer`: PK (poll_id, person_id), option_key, version, answered_at, excluded_at; один актуальный личный ответ. `poll_answer_log` хранит закрытую append-only историю ответов и исключений, одно исключение на версию. Участие определяется непрерывностью истории аудитории, восстановление связи не возвращает прежний ответ. `poll_result` хранит неизменяемый итог; `poll_result_participant` — закрытый состав. `poll_reconciliation` содержит только poll_id и checked_at для ротации фоновых порций, не меняет версию карточки.
- `initiative`: id PK, author_person_id FK, title/body/location_text; requested_building_ids и approved_building_ids раздельно. publication_state {submitted,published,rejected}; stage {collecting,assessing,planned,implementing,completed,rejected,deferred}, до публикации NULL. План хранит основание/ответственного/срок, обязательность решения и конкретную проверенную версию со снимком. support_closed_at/final_support_count фиксируются при конечном этапе completed/rejected; completed_at — только при реализации. initiative_log append-only хранит переходы и причины.
- `initiative_support`: PK (initiative_id,person_id), version, supported_at, withdrawn_at, excluded_at. Закрытая initiative_support_log фиксирует поддержку/отзыв/исключение. Число поддержки до конца следует непрерывной истории аудитории, после конечного этапа — сохранённому итогу; восстановление связи не возвращает прежнюю поддержку. Сервис изменения поддержки подключается I02.
- `initiative_comment`: id PK, initiative_id FK, author_person_id FK, text, hidden_at, hidden_by, hidden_reason — имя автора из профиля, без телефона/номера помещения (IDEA-02).
- `moderation_action`: id PK, action enum mod_action {hide_comment, restrict_publication}, target_type, target_id, reason text, until_at, by_person_id, created_at — без редактирования чужого текста (MOD-01–02); оспаривание — MOD-03 (председатель) в `audit_log`+status.

## 9. Регламенты времени (TIM)

- `time_rule`: id PK, key text UNIQUE (см. список ниже), kind enum rule_kind {operational, legal}, source text NULL (для legal — TIM-07), active_version_id FK NULL.
- `time_rule_version`: id PK, rule_id FK, version int, params jsonb NOT NULL, effective_from timestamptz, effective_to timestamptz NULL, created_by, approved_by NULL; UNIQUE (rule_id, version).
- `timer`: id PK, subject_type text, subject_id uuid, rule_key text, rule_version_id FK (запущенный срок живёт по прежней версии — TIM-04), due_at timestamptz, payload jsonb, state enum timer_state {scheduled, fired, canceled}, fired_at, canceled_at; INDEX (state, due_at).

Стартовые значения реестра (согласованы 16.10.2026):

| Ключ | Значение | Основание |
| --- | --- | --- |
| work_schedule | ежедневно 08:00–20:00 Asia/Almaty | согласовано (TIM-05) |
| first_response | 2 рабочих часа | TIM-05 |
| escalation_step | 12 рабочих часов на каждом этапе (администратор → заместитель → председатель) | REG-14 |
| owner_response | 48 календарных часов (саморегистрация арендатора) | согласовано 16.10.2026 |
| author_reminder | 48 календарных часов (напоминание автору после отчёта) | согласовано 16.10.2026 |
| invite_ttl | 72 календарных часа | REG-03/13 |
| reopen_window | 7 календарных дней | модель процессов, по умолчанию |
| digest_time | конец смены (следует за work_schedule) | NTF-01, согласовано |
| backup_age_alert | 24 часа `[согласовано 16.10.2026]` | OPS-03/RPO |
| clarification_response, dispute_total, прочие | не заполнены — OQ-04/05, правило не включается без значения | TIM, OQ-04 |

Правовые правила (`kind='legal'`) изменяются только процедурой обновления правового регламента: сервер отклоняет обычную правку за границей (модель процессов раздел 8, сценарий 11).

## 10. Уведомления

- `notification`: id PK, recipient_person_id FK, event_type text, event_ref jsonb, dedup_key text UNIQUE (идемпотентность at-least-once), channel enum notif_channel {telegram, simulator}, state enum notif_state {queued, sent, failed}, attempts int, last_error text, sent_at, created_at — NTF-02; ошибки важной доставки видны администратору.
- `notification_pref`: person_id FK, event_type text, enabled boolean, PK (person_id, event_type) — настройки; обязательное согласование остаётся видимым в карточке (FLOW-03).

## 11. Импорт реестра

- `import_batch`: id PK, file_path text (Storage), state enum import_state {uploaded, validating, validation_failed, validated, committing, committed, failed}, stats jsonb (число строк по листам), errors jsonb `[согласовано 16.10.2026]` (список: sheet, row, field, code, message — IMP-02), created_by, created_at, committed_at.
- `import_mapping`: batch_id FK, sheet text, external_ref text (ID строки шаблона), entity_type text, entity_id uuid, PK (batch_id, sheet, external_ref) — постоянные идентификаторы присваиваются при импорте и сохраняются в выгрузке (IMP-04, IMP-08).

Шаблон IMP-06: листы «Здания», «Помещения», «Лица», «Связи»; одна строка связи = один человек + одно помещение; стартовый импорт — собственники-физлица, поля ФИО + уникальный телефон, основание `initial_registry`; доступ не выдаётся автоматически (IMP-03, REG-01).

## 12. Бот

- `bot_inbound`: update_id bigint PRIMARY KEY (идемпотентность Telegram, REQ-05), payload jsonb, received_at, processed_at NULL, status enum {received, processed, error}, error text.
- `bot_dialog`: profile_id FK profile PRIMARY KEY, state text (ключ шага сценария), context jsonb, updated_at — состояние диалогов в PostgreSQL (ADR-003: диалог продолжается после завершения вызова функции).

## 13. Служебные таблицы

- `outbox`: id bigserial PK, event_type text, payload jsonb, created_at, processed_at NULL, attempts int — события HLD 12.2 (request.created, task.assigned/reported, timer.fired, incident.confirmed/updated, payment.confirmed, digest.daily) `[согласовано 16.10.2026]`: полный реестр событий — LLD-03, раздел 5 (уточняется по мере срезов, Д-6).
- `job_queue`: id bigserial PK, kind text, payload jsonb, run_after timestamptz, state enum job_state {queued, running, done, failed, dead}, locked_by text NULL, locked_at, attempts int, max_attempts int, last_error text, dedup_key text NULL UNIQUE (защита от дублей задач), created_at, finished_at.
- `idempotency_key`: key text, endpoint text, request_hash text, response jsonb, status int, created_at; PK (key, endpoint) — REQ-05/OPS-01.
- `access_session`: id uuid PK (= session_id из JWT `[согласовано 16.10.2026]`), profile_id FK, started_at, last_activity_at, last_activity_kind text, revoked_at NULL, revoked_reason text — контроль AUTH-06 (12 ч / 30 мин бездействия) и отзыв (ROL-04). Активность `[согласовано 16.10.2026]` (закрывает М-2/AQ-03): все аутентифицированные вызовы `/v1`, кроме `GET /v1/meta/*`; обновление токенов Auth не проходит через API и активность не создаёт.
- `emulation_session`: id PK, tech_admin_profile_id FK, emulated_profile_id FK (только is_test=true), started_at, ended_at, state enum {active, ended} — HLD 10.8; аудит ссылается на session.
- `audit_log`: id bigserial PK, at timestamptz, actor_person_id FK NULL (NULL — система), actor_profile_id, emulation_session_id FK NULL, emulated_person_id FK NULL (реальный актор + эмулируемая персона, AUD-01), action text, entity_type text, entity_id uuid, before jsonb, after jsonb, reason text, scope_buildings jsonb (тег области чтения AUD-02), meta jsonb. Append-only (раздел 6).
- `ops_backup_registry`: id PK, kind enum backup_kind {full, pre_update}, created_by FK person, location text, size_bytes bigint, checksum text, result enum backup_result {ok, failed, not_verified}, note, created_at — OPS-03: копия без файлов не считается полной (флаг files_included boolean).
- `number_sequence`: key text, year int, seq bigint, PK (key, year).

## 14. Индексы (ключевые)

| Таблица | Индекс | Для чего |
| --- | --- | --- |
| connection | (person_id), (premises_id) WHERE status='active' | PDP: сборка Actor |
| staff_assignment | (person_id) WHERE status='active' | PDP |
| request | (state), (assigned_admin_person_id, state), (building_id, state), (author_person_id) | очереди кабинета, области |
| message | (request_id, channel, created_at) | переписка |
| task | (assignee_person_id, state), (request_id), (common_work_id) | бот исполнителя, карточка |
| timer | (state, due_at) | свип TIM |
| notification | (state, created_at), (recipient_person_id, created_at) | диспетчер, история |
| job_queue | (state, run_after) | слив очереди |
| outbox | (processed_at) WHERE processed_at IS NULL | обработчик событий |
| audit_log | (entity_type, entity_id, at), (actor_person_id, at), (at DESC) | чтение по областям AUD-02 |
| poll_answer | (poll_id, excluded) | подсчёт без исключённых |

## 15. Хранилище файлов (Storage)

Бакеты по аудиториям (HLD 10.6), все приватные, выдача — только короткоживущие подписанные URL после PDP:

| Бакет | Аудитория | Пример содержимого |
| --- | --- | --- |
| `files-resident` | «Жителю» | вложения сообщений жителю, опубликованные документы |
| `files-internal` | «Внутреннее» | внутренняя переписка, служебные отчёты |
| `files-finance` | финансовая | счета, квитанции, финансовые отчёты (PAY-08) |
| `files-service` | служебная | инструкции исполнителям, документы назначенных заданий (DOC-03) |

Путь: `{bucket}/{yyyy}/{mm}/{owner_type}/{owner_id}/{uuid}.{ext}`; прямая ссылка на внутреннее вложение жителем — запрещена (модель процессов раздел 8): URL генерирует только `files` после проверки аудитории. Загрузка: `POST /v1/files/upload-url` → подписанный upload-URL → подтверждение создания `attachment` с проверками FIL-01.

## 16. RLS — второй рубеж (AQ-06)

- RLS включён на всех таблицах; политик для ролей `anon`/`authenticated` нет — прямой запрос из браузера по publishable key не возвращает ни одной строки; весь доступ — через API с `service_role` (bypass RLS) внутри серверных функций.
- Такой состав RLS сознательно минимален: полная модель (шесть измерений ROL-01) не строится в RLS (HLD 10.4) — это защита от обхода API, а не механизм авторизации.
- Storage-политики: без прямого доступа; операции — только service-role.

## 17. Согласованность

- Изменения состояния — транзакция с `SELECT ... FOR UPDATE` + проверкой состояния (FLOW-01); `version` для 409.
- События — outbox в той же транзакции; доставка at-least-once, дедуп `notification.dedup_key`.
- Идемпотентность: `bot_inbound.update_id`, `idempotency_key`, `import_batch` (повтор коммита невозможен по состоянию).
- Журналы `*_log` и `audit_log` — append-only: `REVOKE UPDATE, DELETE` у всех ролей, включая service-role, для `audit_log` `[согласовано 16.10.2026]` (AQ-07: защита от инфраструктурного администратора требует отдельного решения — не закрыть этим, точка Д-7).

## 18. Открытые точки решения

| # | Точка | Влияние | Когда блокирует |
| --- | --- | --- | --- |
| Д-1 | Форматы номеров (раздел 1) | contracts API, UI | закрыто 16.10.2026: приняты форматы раздела 1 |
| Д-2 | Перечень категорий обращений (OQ-02) | seed `request_category` | до включения классификации |
| Д-3 | Состав персональных данных и сроки хранения (OQ-12) | `person`, `consent`, retention-процедуры | до работы с реальными данными |
| Д-4 | Финансовые правила частичных оплат/возвратов (OQ-07) | `payment`, `payment_order` | до VS-6; схема хранит платежи по отдельности — правила не меняют структуру |
| Д-5 | Опросы: отзыв связи, аудитория инициатив (OQ-10) | `poll_answer.excluded`, аудитории | до VS-8 |
| Д-6 | Полный реестр событий outbox (раздел 13) | контракты | уточняется в LLD-03/04 по мере срезов |
| Д-7 | Защита журнала от инфраструктурного доступа (AQ-07) | раздел 16–17 | до запуска с реальными данными |


## Уточнения реализации VS-2 (17.10.2026)

[ADR-004](../decisions/004-vs2-registration-bootstrap.md) уточняет минимальный контур VS-2 по отношению к полной модели последующих срезов:

- `person.data_source`, `processing_basis` сохраняют источник и основание REG-09; изменение телефона сохраняет ID и профиль (IMP-13).
- `premises.is_test` и `registration.is_test` разделяют тестовые объекты/анкеты ещё до привязки человека. Здания общие, их структура недоступна для записи из эмуляции.
- `registration.connection_id` указывает на конкретную выданную связь. Спор не может отозвать позднейшую другую связь либо собственность. `dispute_checker_id` сохраняет автора оспариваемого решения; `review_stage`, `stage_due_at`, `total_due_at`, `overdue_at` обеспечивают REG-14 без потери общего срока при уточнении.
- `bot_dialog` имеет ключ проверенного Telegram до появления profile; nullable `profile_id` сохраняется после привязки. `state` содержит шаг и контекст JSONB. `bot_inbound` фиксирует обработанный update в одной транзакции с эффектами и ответом.
- `import_batch.payload/errors/preview` — снимок листов, полный отчёт и предварительные счётчики. Состояния VS-2: uploaded, validating, ready, invalid, committed. `import_mapping` использует ключ `(batch_id,entity_type,source_key)`. Исходный файл не хранится; загрузка через JSON/base64, результат/отчёт — XLSX в таком же конверте.
- `notification` до регистрации допускает Telegram без person; после — recipient_person_id. Каналы telegram/simulator, состояния queued/sending/sent/failed, lease на отправку, next_attempt_at, attempts и last_error. Полный общий outbox и fanout добавляются в последующих срезах.
- Начальные TIM-ключи реализации: invite_expiry ↔ invite_ttl, tenant_wait ↔ owner_response, registration_stage ↔ escalation_step, dispute_total. Параметры длительности и графика редактируются независимо в новой версии. Общий срок dispute_total — согласованные 36 рабочих часов (REG-14); прежняя строка таблицы с «не заполнен» к нему больше не применяется.


## Уточнения VS-3 (17.10.2026)

Физическая схема — миграция `20261017060759_vs3_requests_messaging.sql`:

- `request`: исходное description, created_by отдельно от автора, location_text,
  is_test, complaint_subject_person_id/complaint_route, work_started_at и неизменяемый
  по классификации work_execution_required; reopen_until и следующий reminder.
- `request_confirmation`: составной PK (request_id, version), неизменяемый payload,
  sent_at, confirmed_at/by, superseded_at, зафиксированный admin_close_after.
  Вид решения и материалы проверки сохраняются в append-only request_log.
- `message`: reply_to/corrects_message_id; ограничение ошибочного раскрытия отдельными
  restricted_at/by/reason, без изменения текста/канала/авторства.
- `attachment`: request_id для серверной проверки области, filename, upload_expires_at;
  пути генерирует сервер. Неполное вложение можно отправить с сообщением и дозагрузить.
- `rating_log` хранит каждую редакцию; rating содержит последнюю оценку текущего
  подтверждения и withdrawn_at после возврата. request_log/rating_log — append-only.
- `request_upload_job`: устойчивый перенос Telegram-файлов, lease/attempts/state;
  `file_policy`: настраиваемое сужение согласованных лимитов и форматов.
- `idempotency_key`: endpoint включает person_id, тело хешируется канонически;
  `api_rate_limit`: одна строка на профиль для общего лимита 100 запросов/мин.
- Новые таблицы закрыты RLS и revoke; содержимое переписки не дублируется в audit_log.

### Реализация независимого TIM/NTF в VS-5

- `time_rule`: `kind`, источник/редакция/дата/область правового основания и `legal_limits`. `time_rule_version`: автор, причина, неизменяемый `legal_basis`; UPDATE/DELETE запрещены. Начатый `timer` сохраняет версию, получает `canceled_at`; состояния совместимы с VS-2: pending/fired/canceled.
- `work_schedule` задаёт общий график будущих рабочих сроков. Изменение графика атомарно создаёт версии операционных рабочих правил. Правовые правила сохраняют собственный документированный способ отсчёта.
- `outbox`: уникальный непустой `dedup_key`, attempts/next_attempt_at/last_error. Обрабатываются только новые события `notification.requested`; исторические события VS-3 не переигрываются.
- `notification`: важность, приоритет, request_id, аудитория, is_test, lease_token и состояние canceled. В event_ref сохраняются область домов и контекст регистрации для повторной авторизации. Ошибки подготовки после пяти попыток тоже отражаются как failed.
- `notification_pref`: настройки по персоне и разрешённому типу события; обязательные события не настраиваются. `notification_followup`: одна задача контакта на notification, явный результат и сотрудник, зафиксировавший его.
- `notification_digest_item` и `notification_digest_run`: непотреблённые элементы, локальный день, неизменная отсечка состава, номер порции и окончание запуска. Все новые таблицы закрыты для anon/authenticated и обслуживаются серверным PDP.

Общий целевой `job_queue` и интеграция с заданиями не объявляются реализованными этим независимым этапом. Существующие предметные очереди VS-2/VS-3 продолжают работу до завершения интеграции VS-4/VS-5.

### Уточнение реализации VS-4: доказательства (17.10.2026)

`attachment` поддерживает `owner_type=task`, `task_id` и `task_report_id`; для такого
вложения `request_id` пуст, owner_id совпадает с task_id, bucket только internal.
Триггер запрещает изменение/удаление файла после включения в неизменяемый отчёт.
`task.rework_due_at` хранит срок доработки отдельно от исходного `due_at`.
В `task_log.meta` фиксируются версия отчёта, решения по отсутствующим доказательствам,
ожидаемое исправление и разбор зависимостей при возврате принятого задания.
События визита сохраняют исходные интервалы; факт неявки и решение администратора
записываются отдельно, без автоматического подтверждения нарушения.


### Уточнение реализации VS-4: общий объём (17.10.2026)

`common_work.plan` и `due_at` фиксируют план и срок, `common_work_log.meta` —
прежнюю дату завершения при возврате и незавершённые локальные задания заявителей.
`task.document_required` обозначает обязательность акта; VS-8 заменяет прежний безусловный запрет проверкой настроенного обязательства и актуальной одобренной версии акта.
Версия шаблона копируется в task вместе с инструкцией/чек-листом, job_template_version
неизменяема. Явное обновление методички сохраняет прежний снимок в task_log.

События found_problem/problem_linked в task_log сохраняют место, описание,
проверенные фото и решение о связанном задании. Запрос остановки — отдельное событие
request_pause, которое не меняет состояние. Отмена родителя сохраняет is_required;
явная замена снимает обязательность старого задания с записью was_required и
replacement_task_id, переносит неначатые зависимости. Отмена не считается выполнением.

В request_confirmation.payload записываются task_report_ids и task_results:
номер задания, версия отчёта, выполненный объём, время, результат и ограничения.
Это персональный неизменяемый снимок; подтверждение одного обращения не закрывает
другие обращения общей работы. Внутренние файлы отчётов не входят в публичный снимок.

### Реализация расписаний VS-5

`job_schedule` хранит одну текущую версионируемую настройку на шаблон. `job_queue` хранит неизменный снимок параметров запуска, устойчивый ключ, попытки и безопасный код ошибки. `job_run` связывает дату/версию расписания, версию шаблона, очередь и созданное задание; `missed_at` сохраняет пропуск. Все три таблицы закрыты RLS от прямого клиентского доступа. `task` дополнен `acceptance_version`, `acceptance_due_at`, `overdue_at`, `next_action_notified_at`; `notification.task_id` позволяет повторно проверить область перед доставкой. Личное сообщение о снятии назначения содержит только прежний факт и номер, без ссылки/текущих сведений задания.
