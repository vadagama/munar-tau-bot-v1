-- 0001_extensions.sql — расширения для фоновой обработки (LLD-04 §1–2, ADR-003).
-- pg_cron: расписание вызова функции jobs (каждую минуту).
-- pg_net: асинхронные HTTP-вызовы из SQL (cron → pg_net → jobs).
-- Идемпотентно: повторное применение не меняет состояние (expand/contract, HLD §20).

create extension if not exists pg_cron;
create extension if not exists pg_net;
