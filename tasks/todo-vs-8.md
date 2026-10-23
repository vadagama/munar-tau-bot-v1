# Реестр задач VS-8

Дата: 23.10.2026. Статус: план согласован 23.10.2026 сообщением «Дальше», выполнение начато.

Спецификации согласованы; [технический план](plan-vs-8.md) связывает задачи с зависимостями и рисками.
Команды ниже выполняются из `source/`; пути — от корня репозитория.
Новые имена файлов — намеченные места реализации, они пока не созданы.
Все SQL-интеграционные тесты сохраняются; запуск только по отдельному явному запросу пользователя. 23.10.2026 пользователь разрешил прогон документов на Sydney; результаты — в `docs/vs8-acceptance.md`.
Чекбокс задачи отмечается после выполнения критериев и проверки, а не после создания файла.

## D01. Зафиксировать контракт данных и переходов VS-8

- [x] **D01 выполнена**
- Критерий: ADR описывает версии документов, историю аудитории, состояния инициатив, формулы REP и границы VS-6; решения ссылаются на согласованные спецификации.
- Критерий: Проверены ссылки, соответствие требованиям и отсутствие новых несогласованных бизнес-правил.
- Проверка: Проверка ссылок и diff; сопоставление с SPEC-documents/polls/initiatives/reports.
- Зависимости: —. Объём: M (5 основных файлов).
- Файлы: `docs/decisions/018-vs8-documents-participation-reports.md`, `docs/README.md`, `docs/lld/02-data-model.md`, `docs/lld/03-api.md`, `docs/architecture-questions.md`.

## D02. Защитить объекты документов через PDP

- [x] **D02 выполнена**
- Критерий: Новые действия используют серверный ресурс документа, область, аудиторию, назначение и исходный объект; read/manage/review различаются.
- Критерий: Отказ при чужом задании, утрате роли, финансовой аудитории, жалобе и test-несовпадении; сохранён ROL-02d.
- Проверка: npm test -w core -- src/pdp/documents.test.ts
- Зависимости: D01. Объём: M (4 основных файлов).
- Файлы: `source/core/src/pdp/actions.ts`, `source/core/src/pdp/types.ts`, `source/core/src/pdp/evaluate.ts`, `source/core/src/pdp/documents.test.ts`.

## D03. Добавить хранилище карточек и неизменяемых версий

- [x] **D03 выполнена**
- Критерий: Карточки, область, версии и история проверок имеют FK, уникальные номера версий, is_test и индексы; файлы версий не перезаписываются.
- Критерий: RLS закрывает прямой anon/authenticated доступ; миграция не меняет старые результаты.
- Проверка: Ревью миграции; сохранён интеграционный тест documents-schema (запуск только по отдельному запросу).
- Зависимости: D02. Объём: M (4 основных файлов).
- Файлы: `source/db/migrations/20261023090000_vs8_documents.sql`, `source/db/rls.sql`, `source/core/src/domains/documents/types.ts`, `source/core/tests/integration/documents-schema.test.ts`.

### Контрольная точка: Контракт документов

- [ ] Новые тесты и затронутая регрессия проходят; типы/lint проверены.
- [ ] Diff просмотрен, проверенный инкремент сохранён отдельным коммитом.
- [ ] Сценарии этапа воспроизведены; ограничения записаны, непройденные проверки не отмечены как успешные.

## D04. Реализовать подготовку и проверку версии

- [x] **D04 выполнена**
- Критерий: Создание, новая версия, submit/approve/return/needs_fix применяют FSM, назначенного проверяющего, причину, expected_version и идемпотентность.
- Критерий: Возврат создаёт новую версию при исправлении; повтор/конфликт/rollback не затирают историю и не обходят PDP.
- Проверка: npm test -w core -- src/domains/documents
- Зависимости: D03. Объём: M (5 основных файлов).
- Файлы: `source/core/src/domains/documents/service.ts`, `source/core/src/domains/documents/fsm.ts`, `source/core/src/domains/documents/service.test.ts`, `source/core/src/domains/documents/fsm.test.ts`, `source/core/tests/integration/documents.test.ts`.

## D05. Подключить приватную загрузку документов

- [x] **D05 выполнена**
- Критерий: Новый владелец attachment совместим со старыми CHECK; сервер задаёт путь и проверяет размер/mime/завершённость.
- Критерий: Скачивание проходит PDP документа и источника; подписанный экземпляр отделён от черновика, task_report файлы остаются неизменными.
- Проверка: npm test -w core -- src/domains/documents/files.test.ts src/domains/requests/files.test.ts
- Зависимости: D04. Объём: M (5 основных файлов).
- Файлы: `source/db/migrations/20261023091000_vs8_document_files.sql`, `source/core/src/domains/documents/files.ts`, `source/core/src/domains/documents/files.test.ts`, `source/core/src/domains/requests/files.ts`, `source/core/tests/integration/document-files.test.ts`.

## D06. Дать кабинету API документов

- [x] **D06 выполнена**
- Критерий: Маршруты списка/карточки/версий/проверки/файлов вызывают общий домен, ограничивают страницу и используют формат ApiError.
- Критерий: Повторный запрос с отозванной ролью и поддельным approved/storage_path не раскрывает данные и не меняет документ.
- Проверка: deno task check; deno task test
- Зависимости: D05. Объём: M (3 основных файлов).
- Файлы: `source/functions/api/document-handlers.ts`, `source/functions/api/document-handlers.test.ts`, `source/functions/api/handlers.ts`.

### Контрольная точка: Документы: API и файлы

- [ ] Новые тесты и затронутая регрессия проходят; типы/lint проверены.
- [ ] Diff просмотрен, проверенный инкремент сохранён отдельным коммитом.
- [ ] Сценарии этапа воспроизведены; ограничения записаны, непройденные проверки не отмечены как успешные.

## D07. Показать каталог и проверку в кабинете

- [x] **D07 выполнена**
- Критерий: Каталог, карточка, версии, загрузка и проверка работают через API и общие PageLayout/CardDrawer/ActionPanel.
- Критерий: Формы имеют loading/empty/error/409 и сохраняют ввод при конфликте; невидимое действие не заменяет серверную авторизацию.
- Проверка: npm test -w admin -- src/pages/documents.test.tsx; npm run build -w admin; браузерный сценарий.
- Зависимости: D06. Объём: M (5 основных файлов).
- Файлы: `source/admin/src/pages/documents.tsx`, `source/admin/src/pages/documents.test.tsx`, `source/admin/src/App.tsx`, `source/admin/src/layouts/app-layout.tsx`, `source/admin/src/lib/documents.ts`.

## D08. Вести обязательства по документам

- [x] **D08 выполнена**
- Критерий: Правило содержит тип, основание, этап, ответственного, проверяющего, срок и версию; без правила обязательный акт не считается готовым.
- Критерий: Обязательство после приёмки не закрывается обращением; jobs создаёт ограниченные идемпотентные напоминания без переноса срока.
- Проверка: npm test -w core -- src/domains/documents/obligations.test.ts
- Зависимости: D07. Объём: M (5 основных файлов).
- Файлы: `source/db/migrations/20261023092000_vs8_document_obligations.sql`, `source/core/src/domains/documents/obligations.ts`, `source/core/src/domains/documents/obligations.test.ts`, `source/core/src/domains/documents/jobs.ts`, `source/core/tests/integration/document-obligations.test.ts`.

### Контрольная точка: Документы: интерфейс и обязанности

- [ ] Новые тесты и затронутая регрессия проходят; типы/lint проверены.
- [ ] Diff просмотрен, проверенный инкремент сохранён отдельным коммитом.
- [ ] Сценарии этапа воспроизведены; ограничения записаны, непройденные проверки не отмечены как успешные.

## D09. Включить комплект в подтверждение результата

- [x] **D09 выполнена**
- Критерий: Состав документов формируется сервером и сохраняется вместе с отчётами; обязательный акт проверяется вместо безусловной блокировки VS-8.
- Критерий: Смена версии/needs_fix/возврат параллельно подтверждению не принимает устаревший комплект; порядок блокировок един.
- Проверка: npm test -w core -- src/domains/documents/snapshot.test.ts src/domains/tasks/reports.test.ts; интеграционный тест гонки сохраняется.
- Зависимости: D08. Объём: M (5 основных файлов).
- Файлы: `source/core/src/domains/documents/snapshot.ts`, `source/core/src/domains/documents/snapshot.test.ts`, `source/core/src/domains/tasks/results.ts`, `source/core/src/domains/requests/service.ts`, `source/core/tests/integration/document-confirmation.test.ts`.

## D10. Подключить документы к ботам и очереди обязанностей

- [x] **D10 выполнена**
- Критерий: Житель читает доступный каталог и порядок запроса в ОСИ; сотрудник видит назначенную обязанность и доступные действия проверки.
- Критерий: Кнопки/файлы/отмена формы работают ru/kk в симуляторе; nonce, версия, смена персоны и отзыв роли проверяются сервером.
- Проверка: npm test -w core -- src/bot/documents.test.ts; бот/симулятор: resident/owner/executor/doc_reviewer.
- Зависимости: D09. Объём: M (5 основных файлов).
- Файлы: `source/core/src/bot/documents.ts`, `source/core/src/bot/documents.test.ts`, `source/core/src/templates/catalog/documents.ts`, `source/core/src/bot/inbound.ts`, `source/core/src/templates/catalog/index.ts`.

### Контрольная точка: Документы: полный путь и приёмка

- [ ] Новые тесты и затронутая регрессия проходят; типы/lint проверены.
- [ ] Diff просмотрен, проверенный инкремент сохранён отдельным коммитом.
- [ ] Сценарии этапа воспроизведены; ограничения записаны, непройденные проверки не отмечены как успешные.

## D11. Подключить обязательства к API, фону и кабинету

- [x] **D11 выполнена**
- Критерий: управляющий видит обязанности до/после приёмки, ответственного, срок и причины блокировки; API назначает и завершает обязанность с причиной, версией и идемпотентностью.
- Критерий: jobs обрабатывает напоминания порциями; завершённое обращение не скрывает обязанность. Источник шаблонов остаётся каталогом D10.
- Проверка: deno task check; deno task test; npm test -w admin -- src/pages/document-obligations.test.tsx; браузер: обязанность после закрытия обращения.
- Зависимости: D10. Объём: M (5 основных файлов).
- Файлы: `source/functions/api/document-handlers.ts`, `source/functions/jobs/index.ts`, `source/admin/src/pages/documents.tsx`, `source/admin/src/pages/document-obligations.tsx`, `source/admin/src/pages/document-obligations.test.tsx`.

### Контрольная точка: обязанности документов подключены

- [ ] API, jobs и кабинет работают по одному доменному правилу.
- [ ] Проверки и diff просмотрены; результат сохранён отдельным коммитом.

## F01. Хранить версии финансового комплекта

- [x] **F01 выполнена**
- Критерий: Период, дома, файл, конкретные версии оснований, раскрываемый набор и пояснение исправления сохранены отдельно от прежней версии.
- Критерий: Новая версия не наследует разрешение председателя; прежняя опубликованная версия сохраняется как заменённая.
- Проверка: npm test -w core -- src/domains/publications/financial.test.ts
- Зависимости: D11. Объём: M (4 основных файлов).
- Файлы: `source/db/migrations/20261023093000_vs8_financial_publications.sql`, `source/core/src/domains/publications/financial.ts`, `source/core/src/domains/publications/financial.test.ts`, `source/core/tests/integration/financial-publications.test.ts`.

## F02. Проверять комплект при разрешении и выпуске

- [x] **F02 выполнена**
- Критерий: Разрешение связано со снимком и действующим председателем; немедленный/отложенный выпуск повторно проверяют документы и охват.
- Критерий: Список/карточка/вложения финансовой публикации доступны собственнику области; служебные основания не раскрываются; исправление требует нового разрешения.
- Проверка: npm test -w core -- src/domains/publications
- Зависимости: F01. Объём: M (5 основных файлов).
- Файлы: `source/core/src/domains/publications/service.ts`, `source/core/src/domains/publications/policy.ts`, `source/core/src/domains/publications/policy.test.ts`, `source/core/src/domains/publications/jobs.ts`, `source/core/src/domains/publications/financial-access.test.ts`.

## F03. Вести обязанности и подтверждения FIN-04

- [x] **F03 выполнена**
- Критерий: Версия регламента задаёт форму, согласования, сроки и каналы; записи размещения имеют дату и доказательство, включая внешние каналы.
- Критерий: Нет настройки/отчёта/основания/канала — обязанность остаётся; напоминание/эскалация не меняют срок, test не доставляется наружу.
- Проверка: npm test -w core -- src/domains/publications; deno task test
- Зависимости: F02. Объём: M (5 основных файлов).
- Файлы: `source/core/src/domains/publications/obligations.ts`, `source/core/src/domains/publications/obligations.test.ts`, `source/core/src/domains/publications/financial-jobs.ts`, `source/core/src/domains/publications/financial-jobs.test.ts`, `source/functions/jobs/index.ts`.

### Контрольная точка: Финансовые комплекты и обязанности

- [ ] Новые тесты и затронутая регрессия проходят; типы/lint проверены.
- [ ] Diff просмотрен, проверенный инкремент сохранён отдельным коммитом.
- [ ] Сценарии этапа воспроизведены; ограничения записаны, непройденные проверки не отмечены как успешные.

## F04. Открыть API комплекта и размещений

- [x] **F04 выполнена**
- Критерий: API версий/оснований/разрешений/размещений использует общий домен, expected_version и Idempotency-Key.
- Критерий: URL/DTO возвращают только разрешённый комплект; сырой внутренний attachment и старая кнопка не расширяют доступ.
- Проверка: deno task test; npm test -w core -- src/domains/publications/media.test.ts
- Зависимости: F03. Объём: M (4 основных файлов).
- Файлы: `source/functions/api/publication-handlers.ts`, `source/functions/api/publication-handlers.test.ts`, `source/core/src/domains/publications/media.ts`, `source/core/src/domains/publications/media.test.ts`.

## F05. Дать кабинету путь финансового отчёта

- [ ] **F05 выполнена**
- Критерий: Форма выбирает версии документов, основания и раскрываемый комплект; председатель видит точный комплект до разрешения.
- Критерий: Видны версии, пояснение, замена, незавершённые каналы и ошибки регламента; 409 сохраняет введённое.
- Проверка: npm test -w admin -- src/pages/publications.test.tsx src/pages/financial-publication.test.tsx; браузерный цикл.
- Зависимости: F04. Объём: M (4 основных файлов).
- Файлы: `source/admin/src/pages/publications.tsx`, `source/admin/src/pages/publications.test.tsx`, `source/admin/src/pages/financial-publication.tsx`, `source/admin/src/pages/financial-publication.test.tsx`.

## F06. Уведомлять собственника и ответственных

- [ ] **F06 выполнена**
- Критерий: Уведомления о публикации/исправлении и обязанностях идут через каталог, по конкретной версии и действующему доступу.
- Критерий: Утрата собственности до доставки исключает финансовый комплект; очередь не подменяет подтверждение размещения во внешнем канале.
- Проверка: npm test -w core -- src/domains/publications/financial-notices.test.ts; simulator ru/kk.
- Зависимости: F05. Объём: M (5 основных файлов).
- Файлы: `source/core/src/templates/catalog/financial-publications.ts`, `source/core/src/templates/catalog/index.ts`, `source/core/src/domains/publications/financial-notices.ts`, `source/core/src/domains/publications/financial-notices.test.ts`, `source/core/src/domains/notifications/delivery.ts`.

### Контрольная точка: Финансовые публикации: полный путь

- [ ] Новые тесты и затронутая регрессия проходят; типы/lint проверены.
- [ ] Diff просмотрен, проверенный инкремент сохранён отдельным коммитом.
- [ ] Сценарии этапа воспроизведены; ограничения записаны, непройденные проверки не отмечены как успешные.

## P01. Сохранять историю права участия

- [ ] **P01 выполнена**
- Критерий: История интервалов покрывает изменение/отзыв/архивирование/каскадное удаление связей и помещений, start/end даты и is_test.
- Критерий: Расчёт на closes_at отличает отзыв до и после срока; миграция не выдумывает историю до внедрения.
- Проверка: npm test -w core -- src/domains/polls/audience.test.ts; SQL-интеграция сохранена для отдельного запуска.
- Зависимости: F06. Объём: M (4 основных файлов).
- Файлы: `source/db/migrations/20261023094000_vs8_audience_history.sql`, `source/core/src/domains/polls/audience.ts`, `source/core/src/domains/polls/audience.test.ts`, `source/core/tests/integration/poll-audience-history.test.ts`.

## P02. Добавить опросы и личный ответ

- [ ] **P02 выполнена**
- Критерий: Сохраняются черновик/открытый опрос, стабильные ключи вариантов, уникальный личный ответ и версии; права проверяются через PDP.
- Критерий: После открытия параметры неизменны; ответ до срока меняется без роста участников, исключённый голос не восстанавливается сам.
- Проверка: npm test -w core -- src/domains/polls src/pdp/polls.test.ts
- Зависимости: P01. Объём: M (5 основных файлов).
- Файлы: `source/db/migrations/20261023095000_vs8_polls.sql`, `source/core/src/domains/polls/service.ts`, `source/core/src/domains/polls/service.test.ts`, `source/core/src/pdp/polls.ts`, `source/core/src/pdp/polls.test.ts`.

## P03. Зафиксировать итоги и отмену

- [ ] **P03 выполнена**
- Критерий: Закрытие использует историю на closes_at, создаёт один неизменяемый итог; новые ответы по истёкшему сроку запрещены независимо от jobs.
- Критерий: Отмена с причиной сохраняет историю/ответы, скрывает любое распределение, уведомляет участников и не переносит ответы.
- Проверка: npm test -w core -- src/domains/polls; тест двух соединений сохранён.
- Зависимости: P02. Объём: M (5 основных файлов).
- Файлы: `source/core/src/domains/polls/jobs.ts`, `source/core/src/domains/polls/results.ts`, `source/core/src/domains/polls/results.test.ts`, `source/core/src/domains/polls/jobs.test.ts`, `source/core/tests/integration/polls.test.ts`.

### Контрольная точка: Опросы: время, аудитория и итоги

- [ ] Новые тесты и затронутая регрессия проходят; типы/lint проверены.
- [ ] Diff просмотрен, проверенный инкремент сохранён отдельным коммитом.
- [ ] Сценарии этапа воспроизведены; ограничения записаны, непройденные проверки не отмечены как успешные.

## P04. Связать действия опросов с PDP и API

- [ ] **P04 выполнена**
- Критерий: PDP и маршруты списка/карточки/черновика/открытия/отмены/личного ответа/итогов подключены к общему конвейеру.
- Критерий: Администратор не получает персональные ответы; чужая личность из тела и попытка early-close отклоняются.
- Проверка: deno task check; deno task test
- Зависимости: P03. Объём: M (5 основных файлов).
- Файлы: `source/core/src/pdp/actions.ts`, `source/core/src/pdp/types.ts`, `source/core/src/pdp/evaluate.ts`, `source/functions/api/poll-handlers.ts`, `source/functions/api/poll-handlers.test.ts`.

## P05. Дать кабинету управление опросами

- [ ] **P05 выполнена**
- Критерий: Есть черновик, публикация, отмена с причиной и агрегаты; опубликованные параметры недоступны для изменения.
- Критерий: Число участников и распределение не сопровождаются именами/ответами людей; отменённая карточка не показывает результаты.
- Проверка: npm test -w admin -- src/pages/polls.test.tsx; браузер: публикация/отмена/сводка.
- Зависимости: P04. Объём: M (5 основных файлов).
- Файлы: `source/admin/src/pages/polls.tsx`, `source/admin/src/pages/polls.test.tsx`, `source/admin/src/App.tsx`, `source/admin/src/layouts/app-layout.tsx`, `source/functions/api/handlers.ts`.

### Контрольная точка: Опросы: API и кабинет

- [ ] Новые тесты и затронутая регрессия проходят; типы/lint проверены.
- [ ] Diff просмотрен, проверенный инкремент сохранён отдельным коммитом.
- [ ] Сценарии этапа воспроизведены; ограничения записаны, непройденные проверки не отмечены как успешные.

## P06. Дать жителю кнопочное голосование

- [ ] **P06 выполнена**
- Критерий: Житель видит информационный характер, варианты кнопками, личный выбор/изменение и доступный итог после окончания.
- Критерий: Смена персоны/сценария, устаревшая форма и утрата связи не позволяют повторно использовать чужой или исключённый ответ.
- Проверка: npm test -w core -- src/bot/polls.test.ts; simulator ru/kk и несколько помещений.
- Зависимости: P05. Объём: M (5 основных файлов).
- Файлы: `source/core/src/bot/polls.ts`, `source/core/src/bot/polls.test.ts`, `source/core/src/templates/catalog/polls.ts`, `source/core/src/templates/catalog/index.ts`, `source/core/src/bot/inbound.ts`.

## P07. Подключить фон и проверки приватности опросов

- [ ] **P07 выполнена**
- Критерий: Фон закрывает/исключает порциями и уведомляет об отмене с причиной; очередь повторно проверяет адресата и режим.
- Критерий: Аудит, ошибки, уведомления и экспорт не выдают индивидуальный выбор; тестовая доставка только simulator.
- Проверка: npm test -w core -- src/domains/polls; deno task test; negative privacy scenarios.
- Зависимости: P06. Объём: M (5 основных файлов).
- Файлы: `source/functions/jobs/index.ts`, `source/core/src/domains/polls/notices.ts`, `source/core/src/domains/polls/notices.test.ts`, `source/core/src/domains/notifications/delivery.ts`, `source/core/tests/integration/poll-privacy.test.ts`.

### Контрольная точка: Опросы: полный путь и приватность

- [ ] Новые тесты и затронутая регрессия проходят; типы/lint проверены.
- [ ] Diff просмотрен, проверенный инкремент сохранён отдельным коммитом.
- [ ] Сценарии этапа воспроизведены; ограничения записаны, непройденные проверки не отмечены как успешные.

## I01. Хранить инициативу с двумя состояниями

- [ ] **I01 выполнена**
- Критерий: Запрошенная/утверждённая аудитории разделены; публикация и этап IDEA-03 не смешаны с ограничением автора.
- Критерий: Планирование требует основания, ответственного, срока и проверенного решения при необходимости; отказ/отложение имеют причину.
- Проверка: npm test -w core -- src/domains/initiatives
- Зависимости: P07. Объём: M (5 основных файлов).
- Файлы: `source/db/migrations/20261023100000_vs8_initiatives.sql`, `source/core/src/domains/initiatives/service.ts`, `source/core/src/domains/initiatives/fsm.ts`, `source/core/src/domains/initiatives/fsm.test.ts`, `source/core/src/domains/initiatives/service.test.ts`.

## I02. Защитить доступ и поддержку

- [ ] **I02 выполнена**
- Критерий: Автор не выбирает чужие дома; утверждающий не расширяет полномочия; поддержку можно отозвать, на человека она одна.
- Критерий: Потеря аудитории прекращает поддержку, восстановление требует нового действия; старый опубликованный текст автор не переписывает.
- Проверка: npm test -w core -- src/pdp/initiatives.test.ts src/domains/initiatives/support.test.ts
- Зависимости: I01. Объём: M (5 основных файлов).
- Файлы: `source/core/src/pdp/initiatives.ts`, `source/core/src/pdp/initiatives.test.ts`, `source/core/src/domains/initiatives/support.ts`, `source/core/src/domains/initiatives/support.test.ts`, `source/core/tests/integration/initiatives.test.ts`.

## I03. Реализовать комментарии, ограничения и оспаривание

- [ ] **I03 выполнена**
- Критерий: Скрытие сохраняет оригинал/причину; ограничение имеет срок и истекает серверно; одно открытое оспаривание на действие.
- Критерий: Председатель оставляет/сокращает/снимает решение с историей; обращения, документы и собственные платежи ограничение не блокирует.
- Проверка: npm test -w core -- src/domains/initiatives
- Зависимости: I02. Объём: M (5 основных файлов).
- Файлы: `source/core/src/domains/initiatives/moderation.ts`, `source/core/src/domains/initiatives/moderation.test.ts`, `source/core/src/domains/initiatives/comments.ts`, `source/core/src/domains/initiatives/comments.test.ts`, `source/core/tests/integration/moderation.test.ts`.

### Контрольная точка: Инициативы: домен и модерация

- [ ] Новые тесты и затронутая регрессия проходят; типы/lint проверены.
- [ ] Diff просмотрен, проверенный инкремент сохранён отдельным коммитом.
- [ ] Сценарии этапа воспроизведены; ограничения записаны, непройденные проверки не отмечены как успешные.

## I04. Подключить инициативы к серверному конвейеру

- [ ] **I04 выполнена**
- Критерий: Маршруты инициатив, комментариев, поддержки и оспариваний вызывают общий домен и выдаются по PDP.
- Критерий: Чужой скрытый оригинал/телефон/помещение не входят в DTO; повтор решения и stale version дают предсказуемый результат.
- Проверка: deno task check; deno task test
- Зависимости: I03. Объём: M (5 основных файлов).
- Файлы: `source/core/src/pdp/actions.ts`, `source/core/src/pdp/types.ts`, `source/core/src/pdp/evaluate.ts`, `source/functions/api/initiative-handlers.ts`, `source/functions/api/initiative-handlers.test.ts`.

## I05. Дать кабинету рассмотрение и модерацию

- [ ] **I05 выполнена**
- Критерий: Управляющий видит очередь, область, историю и этапы; председатель рассматривает оспаривание конкретного действия.
- Критерий: Форма planned требует комплект; модерация требует причину/срок, 409 не теряет ввод.
- Проверка: npm test -w admin -- src/pages/initiatives.test.tsx; браузерный путь жителя/модератора/председателя.
- Зависимости: I04. Объём: M (5 основных файлов).
- Файлы: `source/admin/src/pages/initiatives.tsx`, `source/admin/src/pages/initiatives.test.tsx`, `source/admin/src/App.tsx`, `source/admin/src/layouts/app-layout.tsx`, `source/functions/api/handlers.ts`.

### Контрольная точка: Инициативы: API и кабинет

- [ ] Новые тесты и затронутая регрессия проходят; типы/lint проверены.
- [ ] Diff просмотрен, проверенный инкремент сохранён отдельным коммитом.
- [ ] Сценарии этапа воспроизведены; ограничения записаны, непройденные проверки не отмечены как успешные.

## I06. Дать жителю инициативы в боте

- [ ] **I06 выполнена**
- Критерий: Подача, аудитория, поддержка/отзыв, комментарий и оспаривание доступны кнопками; новый сценарий закрывает временную форму.
- Критерий: Имя комментария доступно только аудитории, без телефона/помещения; текст экранируется, ru/kk и simulator работают одинаково.
- Проверка: npm test -w core -- src/bot/initiatives.test.ts; simulator: подача/отказ/поддержка/оспаривание.
- Зависимости: I05. Объём: M (5 основных файлов).
- Файлы: `source/core/src/bot/initiatives.ts`, `source/core/src/bot/initiatives.test.ts`, `source/core/src/templates/catalog/initiatives.ts`, `source/core/src/templates/catalog/index.ts`, `source/core/src/bot/inbound.ts`.

## I07. Добавить фото и доставку инициатив

- [ ] **I07 выполнена**
- Критерий: Фото сохраняются приватно с владельцем/аудиторией инициативы и лимитами; уведомления о решении/модерации в одной транзакции.
- Критерий: Тестовый файл не становится реальным, скрытое/чужое медиа не скачивается по UUID; утрата доступа до доставки учитывается.
- Проверка: npm test -w core -- src/domains/initiatives; regression privacy/files.
- Зависимости: I06. Объём: M (5 основных файлов).
- Файлы: `source/core/src/domains/initiatives/files.ts`, `source/core/src/domains/initiatives/files.test.ts`, `source/core/src/domains/initiatives/notices.ts`, `source/core/src/domains/initiatives/notices.test.ts`, `source/core/src/domains/notifications/delivery.ts`.

### Контрольная точка: Инициативы: полный путь

- [ ] Новые тесты и затронутая регрессия проходят; типы/lint проверены.
- [ ] Diff просмотрен, проверенный инкремент сохранён отдельным коммитом.
- [ ] Сценарии этапа воспроизведены; ограничения записаны, непройденные проверки не отмечены как успешные.

## R01. Зафиксировать чистые формулы времени и KPI

- [ ] **R01 выполнена**
- Критерий: Формулы SPEC-reports различают поток/срез/размер выборки, календарное/рабочее время, RAT-04 и KPI-01/02; даты Asia/Almaty.
- Критерий: Пустой знаменатель — null, конец месяца задан, тест и пилотные обращения исключены; старая версия графика не заменяется текущей.
- Проверка: npm test -w core -- src/domains/reports
- Зависимости: I07. Объём: M (4 основных файлов).
- Файлы: `source/core/src/domains/reports/contracts.ts`, `source/core/src/domains/reports/contracts.test.ts`, `source/core/src/domains/reports/durations.ts`, `source/core/src/domains/reports/durations.test.ts`.

## R02. Сохранять события циклов и достижения KPI

- [ ] **R02 выполнена**
- Критерий: Регистрация/возврат/ожидание/закрытие сохраняют границы циклов атомарно с переходом; прежние закрытия неизменны.
- Критерий: Факт достижения KPI-01 датирован; недостающие прежние события обозначены как отсутствие данных, не вымышлены.
- Проверка: npm test -w core -- src/domains/reports/history.test.ts; integration cycles сохранён.
- Зависимости: R01. Объём: M (5 основных файлов).
- Файлы: `source/db/migrations/20261023101000_vs8_report_history.sql`, `source/core/src/domains/reports/history.ts`, `source/core/src/domains/reports/history.test.ts`, `source/core/src/domains/requests/service.ts`, `source/core/tests/integration/report-cycles.test.ts`.

## R03. Получать ролевые операционные выборки

- [ ] **R03 выполнена**
- Критерий: REP-01/02/03 фильтруют область до агрегации; адресные обращения попадают в общую очередь, не в выбранный дом.
- Критерий: Счётчики/строки/фильтры используют один доступ, не раскрывают жалобы/финансы/переписку; без VS-6 нет фиктивной платёжной сводки.
- Проверка: npm test -w core -- src/domains/reports src/pdp/reports.test.ts
- Зависимости: R02. Объём: M (5 основных файлов).
- Файлы: `source/core/src/domains/reports/queries.ts`, `source/core/src/domains/reports/service.ts`, `source/core/src/domains/reports/access.test.ts`, `source/core/src/pdp/reports.ts`, `source/core/src/pdp/reports.test.ts`.

### Контрольная точка: Отчётность: формулы и права

- [ ] Новые тесты и затронутая регрессия проходят; типы/lint проверены.
- [ ] Diff просмотрен, проверенный инкремент сохранён отдельным коммитом.
- [ ] Сценарии этапа воспроизведены; ограничения записаны, непройденные проверки не отмечены как успешные.

## R04. Формировать безопасный Excel через очередь

- [ ] **R04 выполнена**
- Критерий: Очередь хранит намерение/фильтры/область/as_of, формирует приватный файл с разрешёнными колонками и аудитом; повторы ограничены.
- Критерий: Отзыв области до формирования/скачивания запрещает весь экспорт; нет телефонов/переписки/вложений и формул из пользовательского текста.
- Проверка: npm test -w core -- src/domains/reports/export.test.ts src/domains/reports/jobs.test.ts; ExcelJS повторно читает результат.
- Зависимости: R03. Объём: M (5 основных файлов).
- Файлы: `source/db/migrations/20261023102000_vs8_report_exports.sql`, `source/core/src/domains/reports/export.ts`, `source/core/src/domains/reports/export.test.ts`, `source/core/src/domains/reports/jobs.ts`, `source/core/src/domains/reports/jobs.test.ts`.

## R05. Открыть API отчётов и jobs экспорта

- [ ] **R05 выполнена**
- Критерий: API выдаёт отдельно flows/snapshot/durations/sample_sizes/as_of; статусы/URL экспортов доступны только создателю с текущими правами.
- Критерий: Jobs обрабатывает ограниченную порцию, не блокирует доставку уведомлений; ошибки API не раскрывают чужую очередь.
- Проверка: deno task check; deno task test
- Зависимости: R04. Объём: M (5 основных файлов).
- Файлы: `source/core/src/pdp/actions.ts`, `source/core/src/pdp/evaluate.ts`, `source/functions/api/report-handlers.ts`, `source/functions/api/report-handlers.test.ts`, `source/functions/jobs/index.ts`.

### Контрольная точка: Отчётность: очередь и API

- [ ] Новые тесты и затронутая регрессия проходят; типы/lint проверены.
- [ ] Diff просмотрен, проверенный инкремент сохранён отдельным коммитом.
- [ ] Сценарии этапа воспроизведены; ограничения записаны, непройденные проверки не отмечены как успешные.

## R06. Показать ролевые панели в кабинете

- [ ] **R06 выполнена**
- Критерий: Роли видят свои показатели, фильтры и переходы; календарные/рабочие длительности, отсутствие данных и выборки различимы.
- Критерий: Экспорт показывает статус/ошибку/доступное скачивание, конфликт и потерю полномочий; финансовый источник VS-6 явно недоступен.
- Проверка: npm test -w admin -- src/pages/reports.test.tsx; браузер: фильтры/пусто/отзыв прав/экспорт.
- Зависимости: R05. Объём: M (5 основных файлов).
- Файлы: `source/admin/src/pages/reports.tsx`, `source/admin/src/pages/reports.test.tsx`, `source/admin/src/App.tsx`, `source/admin/src/layouts/app-layout.tsx`, `source/functions/api/handlers.ts`.

## R07. Дать жителю опубликованные работы, сотруднику свою сводку

- [ ] **R07 выполнена**
- Критерий: REP-04 использует только разрешённые опубликованные данные дома/ОСИ; сотрудник получает свою работу и доступные переходы.
- Критерий: Кнопки/сводки ru/kk не раскрывают управленческий отчёт жителю, смена персоны не сохраняет чужую карточку.
- Проверка: npm test -w core -- src/bot/reports.test.ts; simulator: resident/executor/chairman.
- Зависимости: R06. Объём: M (5 основных файлов).
- Файлы: `source/core/src/bot/reports.ts`, `source/core/src/bot/reports.test.ts`, `source/core/src/templates/catalog/reports.ts`, `source/core/src/templates/catalog/index.ts`, `source/core/src/bot/inbound.ts`.

### Контрольная точка: Отчётность: полный путь

- [ ] Новые тесты и затронутая регрессия проходят; типы/lint проверены.
- [ ] Diff просмотрен, проверенный инкремент сохранён отдельным коммитом.
- [ ] Сценарии этапа воспроизведены; ограничения записаны, непройденные проверки не отмечены как успешные.

## Q01. Завершить интеграцию очередей и документацию контракта

- [ ] **Q01 выполнена**
- Критерий: Все готовые разделы доступны из меню/справки с кнопками, возвратом и изоляцией диалогов; документы и фон описаны по факту реализации.
- Критерий: Списки/очереди ограничены, новые таймеры зарегистрированы в существующем контракте TIM без переписывания запущенных версий.
- Проверка: npm test; deno task test; ручная сверка меню двух ботов и очередей.
- Зависимости: R07. Объём: M (5 основных файлов).
- Файлы: `source/core/src/bot/help.ts`, `source/core/src/bot/navigation.ts`, `source/core/src/templates/catalog/bot-ui.ts`, `docs/lld/04-background-tasks.md`, `docs/request-lifecycle.md`.

## Q02. Собрать доказательства приёмки VS-8

- [ ] **Q02 выполнена**
- Критерий: Зафиксированы сценарии требований, результаты всех локальных quality gates, браузера/симулятора и независимого review.
- Критерий: Интеграционные/миграционные проверки не объявлены пройденными без запуска; неизвестные ограничения и неподготовленные регламенты явно указаны.
- Проверка: npm run typecheck; npm run lint; npm test; npm run build; deno task check/lint/test; secret-scan обеих сборок.
- Зависимости: Q01. Объём: M (4 основных файлов).
- Файлы: `docs/vs8-acceptance.md`, `AGENTS.md`, `docs/README.md`, `tasks/todo-vs-8.md`.

## Q03. Подготовить PR и оставить на согласование

- [ ] **Q03 выполнена**
- Критерий: Ветка синхронизирована с актуальным main, diff содержит только VS-8, коммиты атомарны; PR с ID требований, проверками и ограничениями прикреплён к чату.
- Критерий: Нет автоматического merge, изменения облачной БД или выпуска; объём PR оценён и при необходимости предложено разделение по готовым контурам.
- Проверка: git diff --check; просмотр diff относительно origin/main; проверка CI созданного PR без merge.
- Зависимости: Q02. Объём: S (2 основных файлов).
- Файлы: `tasks/plan-vs-8.md`, `docs/vs8-acceptance.md`.

### Контрольная точка: VS-8: итоговая готовность

- [ ] Новые тесты и затронутая регрессия проходят; типы/lint проверены.
- [ ] Diff просмотрен, проверенный инкремент сохранён отдельным коммитом.
- [ ] Сценарии этапа воспроизведены; ограничения записаны, непройденные проверки не отмечены как успешные.
