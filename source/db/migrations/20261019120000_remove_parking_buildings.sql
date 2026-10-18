-- REG-11 (решение пользователя 19.10.2026): отдельного сооружения-паркинга нет —
-- все помещения, включая парковочные места, существуют в составе домов.
-- Демонстрационные паркинги удаляются вместе с их помещениями и связями;
-- обращения остаются без привязки к удалённому паркингу.

delete from connection c
  using premises p, building b
  where c.premises_id = p.id and p.building_id = b.id and b.kind = 'parking';

delete from invite i
  using premises p, building b
  where i.premises_id = p.id and p.building_id = b.id and b.kind = 'parking';

delete from registration r
  using premises p, building b
  where r.premises_id = p.id and p.building_id = b.id and b.kind = 'parking';

update request
  set premises_id = null, building_id = null
  where building_id in (select id from building where kind = 'parking')
     or premises_id in (
       select p.id from premises p join building b on b.id = p.building_id
       where b.kind = 'parking'
     );

delete from emergency_signal s using building b
  where s.building_id = b.id and b.kind = 'parking';

delete from duty_shift s using building b
  where s.building_id = b.id and b.kind = 'parking';

delete from incident_scope s using building b
  where s.building_id = b.id and b.kind = 'parking';

delete from publication_scope s using building b
  where s.building_id = b.id and b.kind = 'parking';

delete from staff_scope s using building b
  where s.building_id = b.id and b.kind = 'parking';

delete from premises p using building b
  where p.building_id = b.id and b.kind = 'parking';

drop table if exists building_parking;

-- Уникальность (kind, code) уходит вместе с колонкой; код здания уникален сам.
alter table building drop column if exists kind;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'building'::regclass and contype = 'u' and conname = 'building_code_key'
  ) then
    alter table building add constraint building_code_key unique (code);
  end if;
end $$;

drop type if exists building_kind;
