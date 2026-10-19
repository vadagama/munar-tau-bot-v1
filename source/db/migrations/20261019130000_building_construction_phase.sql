-- REG-11: дополнительная классификация домов, без изменения прав доступа.
-- NULL сохраняет отсутствие сведений для существующих домов.
alter table building
  add column if not exists construction_phase smallint
    constraint building_construction_phase_check check (construction_phase between 1 and 5);

comment on column building.construction_phase is 'Очередь строительства по застройщику, 1–5; NULL — не указана';
