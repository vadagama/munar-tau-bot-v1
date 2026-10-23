-- Инцидент 2026-10-23: сид-заглушки председателя/техадмина созданы с фейковыми
-- telegram_user_id 9000000000NN и is_test=false при действующих ролях
-- chairman/tech_admin — все служебные уведомления уходили в реальную
-- Telegram-отправку (chat not found), исчерпывали ретраи (239 failed) и
-- порождали каскад followup-задач о сбое доставки.
--
-- Диапазон 900000000000+ зарезервирован за сид-заглушками (константа
-- TELEGRAM_PLACEHOLDER_ID_MIN в core/src/bot/bots.ts): профиль с таким id
-- обязан быть тестовым, чтобы уведомления заглушек не попадали в реальную
-- доставку. Идемпотентно: пересоздание констрейнта с тем же именем.

alter table profile drop constraint if exists profile_placeholder_telegram_id_test;

alter table profile add constraint profile_placeholder_telegram_id_test
  check (
    telegram_user_id < 900000000000
    or is_test
  );
