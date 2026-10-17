-- Срез UX B: кнопки в ответах бота. Разметка клавиатуры (inline_keyboard либо
-- keyboard для reply-меню) хранится на уведомлении и передаётся Telegram как
-- reply_markup; null — обычное текстовое сообщение. Кнопки прикрепляются к
-- последней части разрезанного сообщения, дедупликация и очередь не меняются.
alter table notification add column if not exists reply_markup jsonb;
