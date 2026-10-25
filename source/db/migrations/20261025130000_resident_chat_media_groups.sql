-- Медиа из Telegram-переписки (скрепка, 25.10.2026): файлы одного альбома
-- (media_group_id) публикуются одним сообщением после загрузки;
-- caption хранит подпись первого файла группы.
alter table request_upload_job add column if not exists media_group_id text;
alter table request_upload_job add column if not exists caption text;
comment on column request_upload_job.media_group_id is
  'Telegram media_group_id альбома жителя: файлы группы уходят одним сообщением после загрузки';
comment on column request_upload_job.caption is
  'Подпись к медиа из Telegram; при флаше альбома берётся первая непустая';
create index if not exists request_upload_job_media_group
  on request_upload_job(person_id, media_group_id) where media_group_id is not null;
