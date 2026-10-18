-- Подписи кнопок версионируются атомарно с полным текстом сообщения.
alter table public.message_template_version add column if not exists buttons_ru jsonb;
alter table public.message_template_version add column if not exists buttons_kk jsonb;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='message_template_buttons_object' and conrelid='public.message_template_version'::regclass) then
 alter table public.message_template_version add constraint message_template_buttons_object check (
 (buttons_ru is null or jsonb_typeof(buttons_ru)='object') and
 (buttons_kk is null or jsonb_typeof(buttons_kk)='object'));
 end if;
end $$;
