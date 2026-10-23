import type { Actor } from "../../pdp/types.ts";
import { ApiError } from "../../errors/api.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { invalid, jsonValue, type Row } from "../registry/validation.ts";
import { content, idempotent } from "../requests/service.ts";
import { checkVersion } from "../requests/fsm.ts";
import {
  buildingInput,
  createCommonWork,
  managesArea,
  requireCommon,
} from "./common.ts";
import { createTask, evidenceInput } from "./service.ts";
import { documentRulesInput } from "../documents/rules.ts";
export function blueprintInput(input: Row) {
  return {
    title: content(input.title),
    instruction: content(input.instruction),
    required_evidence: evidenceInput(input.required_evidence),
    document_requirements: documentRulesInput(input.document_requirements),
  };
}
export async function listTemplates(deps: RegistryDeps, actor: Actor) {
  const rows = await deps.db.query<Row>(
    "select * from job_template where is_test=$1 order by name",
    [actor.person.isTest],
  );
  return rows.filter((r) =>
    managesArea(actor, r.buildings as string[], Boolean(r.is_test))
  );
}
export async function saveTemplate(
  deps: RegistryDeps,
  actor: Actor,
  id: string | null,
  input: Row,
  key: unknown,
): Promise<Row> {
  return deps.db.transaction((exec) =>
    idempotent(
      exec,
      actor,
      `template:${id ?? "create"}`,
      key,
      input,
      async () => {
        const buildings = await buildingInput(exec, actor, input.buildings),
          blueprint = blueprintInput(input);
        let version = 1;
        if (
          input.active !== undefined && typeof input.active !== "boolean"
        ) invalid("Некорректная активность шаблона");
        if (id) {
          const [old] = await exec.query<Row>(
            "select * from job_template where id=$1 for update",
            [id],
          );
          if (
            !old ||
            !managesArea(actor, old.buildings as string[], Boolean(old.is_test))
          ) throw new ApiError("FORBIDDEN");
          checkVersion(Number(old.version), input.version);
          content(input.reason, "причину новой версии");
          version = Number(old.version) + 1;
          await exec.query(
            "update job_template set name=$2,blueprint=$3::text::jsonb,buildings=$4,active=$5,version=$6 where id=$1",
            [
              id,
              content(input.name),
              JSON.stringify(blueprint),
              buildings,
              input.active !== false,
              version,
            ],
          );
        } else {
          const [row] = await exec.query<{ id: string }>(
            "insert into job_template(name,blueprint,buildings,is_test,created_by,active) values($1,$2::text::jsonb,$3,$4,$5,$6) returning id",
            [
              content(input.name),
              JSON.stringify(blueprint),
              buildings,
              actor.person.isTest,
              actor.person.id,
              input.active !== false,
            ],
          );
          id = row!.id;
        }
        await exec.query(
          "insert into job_template_version(template_id,version,blueprint,created_by) values($1,$2,$3::text::jsonb,$4)",
          [
            id,
            version,
            JSON.stringify({
              ...blueprint,
              name: input.name,
              buildings,
              reason: input.reason ?? null,
            }),
            actor.person.id,
          ],
        );
        await recordAudit(
          deps,
          exec,
          actor,
          "job_template.version",
          "job_template",
          id,
          buildings,
          null,
          { version },
        );
        return (await exec.query<Row>(
          "select * from job_template where id=$1",
          [id],
        ))[0]!;
      },
      async (row) => {
        const [current] = await exec.query<Row>(
          "select * from job_template where id=$1",
          [row.id],
        );
        if (
          !current ||
          !managesArea(
            actor,
            current.buildings as string[],
            Boolean(current.is_test),
          )
        ) throw new ApiError("FORBIDDEN");
      },
    )
  );
}
export async function templateVersions(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
) {
  const row = (await listTemplates(deps, actor)).find((t) => t.id === id);
  if (!row) throw new ApiError("FORBIDDEN");
  return deps.db.query(
    "select v.*,p.full_name as author_name from job_template_version v join person p on p.id=v.created_by where template_id=$1 order by version",
    [id],
  );
}
export async function runTemplate(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
  key: unknown,
): Promise<Row> {
  return deps.db.transaction((exec) =>
    idempotent(exec, actor, `template:${id}:run`, key, input, async () => {
      const [template] = await exec.query<Row>(
        "select * from job_template where id=$1 for update",
        [id],
      );
      if (
        !template ||
        !managesArea(
          actor,
          template.buildings as string[],
          Boolean(template.is_test),
        )
      ) throw new ApiError("FORBIDDEN");
      checkVersion(Number(template.version), input.version);
      if (!template.active) invalid("Шаблон выключен");
      const d = {
        ...deps,
        db: {
          ...deps.db,
          query: exec.query.bind(exec),
          transaction: <T>(fn: (e: typeof exec) => Promise<T>) => fn(exec),
        },
      };
      const blueprint = jsonValue<Row>(template.blueprint);
      const work = await createCommonWork(d, actor, {
        title: blueprint.title,
        plan: blueprint.instruction,
        due_at: input.due_at,
        building_ids: template.buildings,
      }, crypto.randomUUID());
      const task = await createTask(d, actor, {
        common_work_id: work.id,
        due_at: input.due_at,
        assignee_person_id: input.assignee_person_id,
        template_id: id,
        template_version: template.version,
      }, crypto.randomUUID());
      return { common_work_id: work.id, task_id: task.id };
    }, async (row) => {
      await requireCommon(exec, actor, String(row.common_work_id));
    })
  );
}
