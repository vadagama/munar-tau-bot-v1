-- Эпохи DO ассистента (ADR-021, план S1.3): «Очистить контекст» поднимает
-- конфиг-эпоху сотрудника, панель переподключается к новому DO
-- assistant:<profile_id>:<epoch> с пустой историей (сессии Pi удалить нельзя).
-- Эффективная эпоха = max(config.epoch, номер UTC-суток) — граница дня
-- 05:00 → 05:00 Asia/Almaty = полночь UTC. Колонку не трогает PUT конфигов
-- (upsertUserConfig): эпоху меняет только очистка сеанса.
alter table public.assistant_user_config
  add column if not exists epoch int not null default 1;
