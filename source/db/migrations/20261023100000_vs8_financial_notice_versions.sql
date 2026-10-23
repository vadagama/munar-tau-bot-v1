-- FIN-01…04: рассылка сохраняет точную выпущенную версию и её область.
alter table broadcast add column if not exists financial_version_id uuid;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='broadcast_financial_version_fk' and conrelid='broadcast'::regclass) then
  alter table broadcast add constraint broadcast_financial_version_fk foreign key(publication_id,financial_version_id)
   references financial_publication_version(publication_id,id);
 end if;
 if not exists(select 1 from pg_constraint where conname='broadcast_financial_publication_required' and conrelid='broadcast'::regclass) then
  alter table broadcast add constraint broadcast_financial_publication_required check(financial_version_id is null or publication_id is not null);
 end if;
end $$;
create index if not exists broadcast_financial_version on broadcast(financial_version_id) where financial_version_id is not null;
