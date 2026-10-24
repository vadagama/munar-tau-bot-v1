-- REG-02a/UI-01: дата отзыва анкеты — самостоятельный факт анкеты наряду с decided_at.
alter table registration add column if not exists withdrawn_at timestamptz;
-- Исторические строки: updated_at трогает только триггер версии, а отозванная
-- анкета после отзыва не меняется (единственный выход — повторная регистрация,
-- которая снимает withdrawn), поэтому updated_at здесь и есть момент отзыва.
update registration set withdrawn_at = updated_at
where state = 'withdrawn' and withdrawn_at is null;
