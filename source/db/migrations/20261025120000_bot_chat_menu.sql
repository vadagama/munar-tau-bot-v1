-- Нативное меню команд чата жителя (REG-01/02, 25.10.2026): воркер доставки
-- приводит chat-область меню к состоянию регистрации. Флаг не в state (jsonb) —
-- его пишут транзакции вебхука под FOR UPDATE, здесь риск lost-update.
alter table bot_dialog_channel add column if not exists menu_registered boolean;
comment on column bot_dialog_channel.menu_registered is
  'true — chat-области меню жителя уже выставлены без «Регистрации» (действующий профиль); null/false — применён полный список или синк ещё не выполнялся';
