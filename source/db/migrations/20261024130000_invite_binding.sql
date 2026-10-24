-- ADR-020: приглашение только регистрирует жильца; помещение и роль
-- собственник выбирает при привязке (/bind). Активные приглашения старого
-- типа (с помещением) гасятся — обратной совместимости ссылок нет.
alter table invite alter column premises_id drop not null;
alter table invite alter column role drop not null;
update invite set status = 'expired' where status = 'active' and premises_id is not null;
