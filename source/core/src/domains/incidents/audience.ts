import type { DbExecutor } from "../../db/client.ts";
import type { Actor } from "../../pdp/types.ts";
import { invalid, type Row } from "../registry/validation.ts";
export interface AudienceScope {
  building_id: string;
  premises_ids: string[];
}
export interface IncidentScope extends AudienceScope {
  id: string;
  zone: string;
  service: string;
  recovered_at: string | null;
}
export async function audienceMember(
  exec: DbExecutor,
  actor: Actor,
  scope: AudienceScope[],
): Promise<boolean> {
  const [row] = await exec.query<{ ok: boolean }>(
    `select exists(select 1 from connection c join premises p on p.id=c.premises_id
    where c.person_id=$1 and c.status='active' and p.is_test=$2 and exists(select 1 from jsonb_array_elements($3::text::jsonb) s
    where p.building_id=(s->>'building_id')::uuid and (jsonb_array_length(s->'premises_ids')=0 or s->'premises_ids' ? p.id::text))) as ok`,
    [actor.person.id, actor.person.isTest, JSON.stringify(scope)],
  );
  return row?.ok ?? false;
}
export async function validateScope(
  exec: DbExecutor,
  actor: Actor,
  input: unknown,
): Promise<Omit<IncidentScope, "id" | "recovered_at">[]> {
  if (!Array.isArray(input) || !input.length || input.length > 100) {
    invalid("Укажите непустой охват (до 100 зон)");
  }
  const result: Omit<IncidentScope, "id" | "recovered_at">[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") invalid("Некорректная зона");
    const row = item as Row;
    if (
      typeof row.building_id !== "string" || typeof row.service !== "string" ||
      !row.service.trim() || row.service.length > 300
    ) invalid("Укажите объект и услугу");
    const zone = row.zone ?? "", ids = row.premises_ids ?? [];
    if (
      typeof zone !== "string" || zone.length > 300 || !Array.isArray(ids) ||
      ids.length > 1000 || ids.some((id) => typeof id !== "string") ||
      new Set(ids).size !== ids.length
    ) invalid("Некорректные помещения зоны");
    if (zone.trim() && !ids.length) {
      invalid("Для зоны укажите конкретные помещения");
    }
    if (
      !(await exec.query("select id from building where id=$1", [
        row.building_id,
      ])).length
    ) invalid("Объект не найден");
    if (
      ids.length &&
      (await exec.query(
          "select id from premises where id=any($1::uuid[]) and building_id=$2 and is_test=$3",
          [ids, row.building_id, actor.person.isTest],
        )).length !== ids.length
    ) invalid("Помещения не принадлежат объекту или режиму");
    const service = row.service.trim();
    if (
      result.some((s) =>
        s.building_id === row.building_id && s.zone === zone.trim() &&
        s.service === service
      )
    ) invalid("Зона повторяется");
    result.push({
      building_id: row.building_id,
      service: row.service.trim(),
      zone: zone.trim(),
      premises_ids: ids as string[],
    });
  }
  return result;
}
