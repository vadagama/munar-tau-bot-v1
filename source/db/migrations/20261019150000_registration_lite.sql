-- Анкета-минимум (REG-01, 19.10.2026): анкета может подаваться без помещения
-- и роли; доступ открывается после подтверждения, привязка — отдельно через /add.
alter table registration alter column premises_id drop not null;
alter table registration alter column role drop not null;
