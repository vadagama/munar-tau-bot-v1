-- Имя в Telegram (@username) в каталогах кабинета: жители, сотрудники,
-- регистрации, приглашения. Username намеренно не используется как ключ
-- аутентификации и сопоставления (ADR-001/ADR-004) — колонки хранят
-- display-only метаданные, актуализируемые при входящих обновлениях бота
-- (best-effort, сбой синхронизации не ломает обработку обновления):
--   profile.telegram_username — текущее имя действующего профиля;
--   registration.telegram_username — снимок на момент последнего сообщения
--   пользователя в активной анкете (у ожидающих анкет профиля ещё нет).
-- Снимок обновляется и при последующих сообщениях, поэтому анкеты авторов
-- без профиля не теряют имя. Идемпотентно: IF NOT EXISTS, повторное
-- создание индекса безопасно.

alter table profile add column if not exists telegram_username text;
alter table registration add column if not exists telegram_username text;

comment on column profile.telegram_username is
  'Имя в Telegram (display-only, не ключ аутентификации и сопоставления)';
comment on column registration.telegram_username is
  'Снимок имени в Telegram автора анкеты (display-only)';

create index if not exists registration_telegram_user_idx
  on registration(telegram_user_id) where telegram_user_id is not null;
