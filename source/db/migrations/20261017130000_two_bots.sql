-- ADR-009: два Telegram-бота — жители и сотрудники ОСИ.
-- Канал-бот фиксируется при постановке в очередь: у ботов независимые нумерации
-- update_id и file_id, отправка выбирает токен по колонке bot. Значение по
-- умолчанию 'resident' — существующие записи относятся к боту жителей.

alter table bot_inbound add column if not exists bot text not null default 'resident' check (bot in ('resident','worker'));
alter table notification add column if not exists bot text not null default 'resident' check (bot in ('resident','worker'));
alter table notification_digest_item add column if not exists bot text not null default 'resident' check (bot in ('resident','worker'));
alter table request_upload_job add column if not exists bot text not null default 'resident' check (bot in ('resident','worker'));

-- update_id у двух ботов независимы: прежний ключ update_id терял бы обновления
-- при дедупликации (коллизии между ботами). Составной ключ bot+update_id.
alter table bot_inbound drop constraint if exists bot_inbound_pkey;
alter table bot_inbound drop constraint if exists bot_inbound_bot_pkey;
alter table bot_inbound add constraint bot_inbound_bot_pkey primary key (bot, update_id);
