-- Отложенный выпуск повторно авторизует того, кто назначил публикацию.
alter table publication add column if not exists scheduled_by uuid references person(id);
create index if not exists publication_scheduler on publication(scheduled_by);
-- Причина управленческого изменения сохраняется отдельно от публичного пояснения.
alter table publication_log add column if not exists reason text check(reason is null or length(btrim(reason))>0);
