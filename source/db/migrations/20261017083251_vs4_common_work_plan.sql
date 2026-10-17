-- WRK-12: план и срок общей работы сообщаются при связывании обращения.
alter table common_work add column if not exists plan text;
alter table common_work add column if not exists due_at timestamptz;

-- Обязательный акт не разрешает передачу результата до контура документов VS-8.
alter table task add column if not exists document_required boolean not null default false;
