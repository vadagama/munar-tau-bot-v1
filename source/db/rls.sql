-- rls.sql — RLS как второй рубеж (LLD-02 §16, AQ-06; HLD §10.4, §15).
--
-- Принципы:
--   1) RLS включён на всех таблицах; политик для ролей anon/authenticated НЕТ —
--      прямой запрос из браузера по publishable key не возвращает ни одной строки;
--   2) весь доступ — через API с service_role (bypass RLS) внутри серверных функций;
--   3) полный доступ из шести измерений (ROL-01) строится в PDP ядра, не в RLS —
--      это защита от обхода API, а не механизм авторизации;
--   4) файл дополняется при каждой новой таблице (LLD-01 §6).
--
-- Начиная с VS-1 каждая миграция несёт собственные RLS/revoke для создаваемых
-- таблиц (деплой применяет только migrations/). Этот файл — эталон принципов и
-- средство коррекции дрейфа: повторное применение возвращает заслон.

-- Базовый заслон: без прямого клиентского доступа к объектам схемы public.
-- Примечание (hosted Supabase): USAGE на схему public платформа выдаёт
-- клиентским ролям от pg_database_owner — роль postgres без GRANT OPTION
-- этот REVOKE не применяет (warning, гранта остаётся). Данные это не
-- раскрывает: закрыты привилегии на таблицы и RLS-политик нет. На
-- self-hosted (рабочая среда, ADR-003) проверять заново.
revoke all on schema public from anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- Для будущих таблиц (по умолчанию) — тоже без прямого доступа.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Включение RLS на всех таблицах public (идемпотентно; сейчас таблиц нет — no-op,
-- при появлении доменных таблиц VS-1+ каждая попадает сюда при создании).
do $$
declare
  t record;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and rowsecurity = false
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end
$$;

-- Storage-политики: без прямого доступа; операции — только service-role (LLD-02 §16).
-- Бакеты создаются при появлении домена files (LLD-01 §3.6); приватность — по аудиториям.

-- VS-3: request/message/attachment/история включаются общим циклом выше.
-- files-resident/files-internal — private; клиентских storage.objects policy нет.
-- Выдача URL и загрузка выполняются Edge API после PDP по владельцу и аудитории.
