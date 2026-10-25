-- Вид обращения «Экстренная ситуация» (25.10.2026): аварийная служба убрана из
-- интерфейса бота, экстренные сообщения оформляются отдельным видом обращения.
alter table request drop constraint if exists request_kind_check;
alter table request add constraint request_kind_check
  check(kind in ('request','question','complaint','emergency'));
