import { templateNotice } from "../../templates/notice.ts";
import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
import { can } from "../../pdp/evaluate.ts";
import { ApiError } from "../../errors/api.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { invalid, type Row } from "../registry/validation.ts";
import { content, idempotent } from "../requests/service.ts";
import { checkVersion } from "../requests/fsm.ts";
import { dateInput } from "../tasks/service.ts";
import { buildingInput, requireCommon } from "../tasks/common.ts";
import { audienceMember } from "../incidents/audience.ts";
import { queueBroadcast } from "../incidents/broadcast.ts";
import { fmtDate, fmtInterval } from "../../bot/text.ts";
import { responsibleInput } from "../incidents/service.ts";
import { validatePublicationRelease } from "./policy.ts";
export interface Publication extends Row {
  id: string;
  kind: string;
  state: string;
  title: string;
  body: string;
  version: number;
  is_test: boolean;
  requires_document: boolean;
  approved_by: string | null;
  common_work_id: string | null;
  publish_at: string | null;
  created_by: string;
}
export async function publicationScope(exec: DbExecutor, id: string) {
  const rows = await exec.query<{ building_id: string }>(
    "select building_id from publication_scope where publication_id=$1 order by building_id",
    [id],
  );
  return rows.map((r) => ({ ...r, premises_ids: [] }));
}
export async function requirePublication(
  exec: DbExecutor,
  actor: Actor,
  id: string,
  action: "publication.read" | "publication.manage" | "publication.approve" =
    "publication.read",
  lock = false,
) {
  const [row] = await exec.query<Publication>(
    `select * from publication where id=$1${lock ? " for update" : ""}`,
    [id],
  );
  if (!row) throw new ApiError("NOT_FOUND");
  const scope = await publicationScope(exec, id),
    resource = {
      publicationAccess: {
        buildingIds: scope.map((s) => s.building_id),
        isTest: row.is_test,
        published: row.state === "published",
        member: action === "publication.read" &&
          await audienceMember(exec, actor, scope),
      },
    };
  if (!can(actor, action, resource).allow) {
    throw new ApiError(
      action === "publication.read" ? "NOT_FOUND" : "FORBIDDEN",
    );
  }
  return { row, scope, resource };
}
export async function publicationLog(
  deps: RegistryDeps,
  exec: DbExecutor,
  actor: Actor,
  row: Publication,
  buildings: string[],
  action: string,
) {
  await exec.query(
    "insert into publication_log(publication_id,actor_person_id,action,version,snapshot) values($1,$2,$3,$4,$5::text::jsonb)",
    [row.id, actor.person.id, action, row.version, JSON.stringify(row)],
  );
  await recordAudit(
    deps,
    exec,
    actor,
    `publication.${action}`,
    "publication",
    row.id,
    buildings,
    null,
    { state: row.state, version: row.version, kind: row.kind },
  );
}
export async function savePublication(
  deps: RegistryDeps,
  actor: Actor,
  id: string | null,
  input: Row,
  key: unknown,
) {
  return deps.db.transaction((exec) =>
    idempotent(
      exec,
      actor,
      `publication.save:${id ?? "new"}`,
      key,
      input,
      async () => {
        const old = id
          ? (await requirePublication(
            exec,
            actor,
            id,
            "publication.manage",
            true,
          )).row
          : null;
        if (old) {
          checkVersion(old.version, input.expected_version);
          if (!["draft", "pending_approval"].includes(old.state)) {
            invalid(
              "Редактирование доступно только до публикации/планирования",
            );
          }
        }
        const buildings = await buildingInput(exec, actor, input.building_ids),
          kind = String(input.kind ?? old?.kind);
        if (
          !["announcement", "outage", "work_report", "financial_report"]
            .includes(kind)
        ) invalid("Выберите вид публикации");
        if (typeof input.requires_document !== "boolean") {
          invalid(
            "Укажите, требуется ли утверждённый документ-основание",
          );
        }
        if (kind === "work_report") {
          const work = await requireCommon(
            exec,
            actor,
            content(input.common_work_id),
          );
          if (
            work.state !== "completed" ||
            !work.building_ids.every((b) => buildings.includes(b))
          ) invalid("Нужна принятая общая работа в выбранной области");
        }
        let start: string | null = null,
          end: string | null = null,
          responsible: string | null = null,
          service: string | null = null;
        if (kind === "outage") {
          start = dateInput(input.planned_start);
          end = dateInput(input.planned_end);
          if (end <= start) invalid("Проверьте даты отключения");
          service = content(input.service);
          responsible = await responsibleInput(
            exec,
            actor,
            input.responsible_person_id,
            buildings.map((building_id) => ({ building_id })),
          );
        }
        const values = [
          content(input.title),
          content(input.body),
          kind,
          actor.person.isTest,
          input.requires_document,
          kind === "work_report" ? input.common_work_id : null,
          start,
          end,
          responsible,
          service,
        ];
        const [row] = old
          ? await exec.query<Publication>(
            "update publication set title=$1,body=$2,kind=$3,is_test=$4,requires_document=$5,common_work_id=$6,planned_start=$7,planned_end=$8,responsible_person_id=$9,service=$10,approved_by=null,approval_note=null,state='draft',version=version+1 where id=$11 returning *",
            [...values, id],
          )
          : await exec.query<Publication>(
            "insert into publication(title,body,kind,is_test,requires_document,common_work_id,planned_start,planned_end,responsible_person_id,service,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *",
            [...values, actor.person.id],
          );
        if (
          old &&
          (old.common_work_id !== input.common_work_id || old.kind !== kind)
        ) {
          await exec.query(
            "delete from publication_attachment where publication_id=$1",
            [old.id],
          );
        }
        await exec.query(
          "delete from publication_scope where publication_id=$1",
          [row!.id],
        );
        for (const building of buildings) {
          await exec.query(
            "insert into publication_scope(publication_id,building_id) values($1,$2)",
            [row!.id, building],
          );
        }
        await publicationLog(deps, exec, actor, row!, buildings, "saved");
        return row!;
      },
      (r) => requirePublication(exec, actor, r.id, "publication.manage"),
    )
  );
}
export async function releaseChecks(exec: DbExecutor, row: Publication) {
  const [work] = row.common_work_id
    ? await exec.query<{ state: string }>(
      "select state from common_work where id=$1 for update",
      [row.common_work_id],
    )
    : [];
  const invalidMedia = await exec.query(
    `select p.attachment_id from publication_attachment p join attachment a on a.id=p.attachment_id left join task t on t.id=a.task_id
 where p.publication_id=$1 and ($2<>'work_report' or t.common_work_id is distinct from $3::uuid or t.state is distinct from 'accepted_admin' or a.status<>'complete' or a.task_report_id is distinct from (select r.id from task_report r where r.task_id=t.id order by r.version desc limit 1))`,
    [row.id, row.kind, row.common_work_id],
  );
  if (invalidMedia.length) {
    invalid(
      "Выбранные медиа больше не относятся к принятому результату работы",
    );
  }
  validatePublicationRelease({
    ...row,
    documentApproved: false,
    workCompleted: work?.state === "completed",
  });
}
export async function broadcastPublication(exec: DbExecutor, row: Publication) {
  const scope = await publicationScope(exec, row.id);
  await queueBroadcast(exec, {
    key: `publication:${row.id}:${row.version}`,
    type: row.kind === "work_report" ? "work.report" : "publication",
    text: templateNotice(row.kind === "outage" ? row.restored_at ? "notices.publications_service_broadcast_publication_1_restored" : "notices.publications_service_broadcast_publication_1_pending" : "notices.publications_service_broadcast_publication_1", {row_title:row.title,row_body:row.body,interval:row.kind === "outage" ? fmtInterval(row.planned_start,row.planned_end) : "",restored_at:row.restored_at ? fmtDate(row.restored_at) : ""}),
    scope,
    isTest: row.is_test,
    publicationId: row.id,
  });
}
export async function transitionPublication(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
  key: unknown,
) {
  return deps.db.transaction((exec) =>
    idempotent(
      exec,
      actor,
      `publication.transition:${id}`,
      key,
      input,
      async () => {
        const action = content(input.action);
        const { row, scope } = await requirePublication(
          exec,
          actor,
          id,
          action === "approve" ? "publication.approve" : "publication.manage",
          true,
        );
        checkVersion(row.version, input.expected_version);
        let state = row.state, publishAt: string | null = null;
        if (
          action === "submit_approval" && row.state === "draft" &&
          row.kind === "financial_report"
        ) state = "pending_approval";
        else if (action === "approve" && row.state === "pending_approval") {
          content(input.approval_note, "основание внешнего согласования");
          await exec.query(
            "update publication set approved_by=$2,approval_note=$3 where id=$1",
            [id, actor.person.id, input.approval_note],
          );
          state = "draft";
        } else if (
          ["publish", "schedule"].includes(action) && row.state === "draft"
        ) {
          await releaseChecks(exec, row);
          if (action === "schedule") {
            publishAt = dateInput(input.publish_at);
            if (Date.parse(publishAt) <= Date.now()) {
              invalid("Выберите будущее время");
            }
            state = "scheduled";
          } else state = "published";
        } else if (
          action === "archive" && ["published", "scheduled"].includes(row.state)
        ) {
          content(input.reason);
          state = "archived";
        } else if (
          action === "restore" && row.state === "published" &&
          row.kind === "outage" && !row.restored_at
        ) {
          const restored = dateInput(input.restored_at);
          if (Date.parse(restored) > Date.now()) {
            invalid("Восстановление должно быть фактическим");
          }
          const method = content(input.restoration_method);
          await exec.query(
            "update publication set restored_at=$2,restoration_method=$3,body=$4 where id=$1",
            [id, restored, method, content(input.body, "обновление")],
          );
        } else if (
          action === "update_outage" && row.state === "published" &&
          row.kind === "outage" && !row.restored_at
        ) {
          const end = dateInput(input.planned_end);
          if (
            Date.parse(end) <= new Date(String(row.planned_start)).getTime()
          ) invalid("Конец должен быть позже начала");
          await exec.query(
            "update publication set planned_end=$2,body=$3 where id=$1",
            [id, end, content(input.body)],
          );
        } else throw new ApiError("INVALID_TRANSITION");
        const [updated] = await exec.query<Publication>(
          "update publication set state=$2,publish_at=$3,published_at=case when $2='published' then coalesce(published_at,now()) else published_at end,version=version+1 where id=$1 returning *",
          [id, state, publishAt],
        );
        await publicationLog(
          deps,
          exec,
          actor,
          updated!,
          scope.map((s) => s.building_id),
          action,
        );
        if (state === "published") await broadcastPublication(exec, updated!);
        return updated!;
      },
      () =>
        requirePublication(
          exec,
          actor,
          id,
          input.action === "approve"
            ? "publication.approve"
            : "publication.manage",
        ),
    )
  );
}
export async function listPublications(deps: RegistryDeps, actor: Actor) {
  const rows = await deps.db.query<Publication>(
    "select * from publication where is_test=$1 order by created_at desc limit 200",
    [actor.person.isTest],
  );
  const items: Row[] = [];
  for (const row of rows) {
    const scope = await publicationScope(deps.db, row.id),
      resource = {
        publicationAccess: {
          buildingIds: scope.map((s) => s.building_id),
          isTest: row.is_test,
          published: row.state === "published",
          member: await audienceMember(deps.db, actor, scope),
        },
      };
    if (can(actor, "publication.read", resource).allow) {
      items.push({
        id: row.id,
        title: row.title,
        kind: row.kind,
        state: row.state,
        version: row.version,
        body: row.body,
        building_ids: scope.map((s) => s.building_id),
        planned_start: row.planned_start,
        planned_end: row.planned_end,
        restored_at: row.restored_at,
        can_manage: can(actor, "publication.manage", resource).allow,
      });
    }
  }
  return items;
}
export async function getPublication(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
) {
  const { row, scope, resource } = await requirePublication(deps.db, actor, id);
  const files = await deps.db.query(
    "select a.id,a.filename,a.mime from publication_attachment p join attachment a on a.id=p.attachment_id where p.publication_id=$1",
    [id],
  );
  if (can(actor, "publication.manage", resource).allow) {
    return {
      ...row,
      available_files: row.common_work_id
        ? await deps.db.query(
          "select a.id,a.filename from attachment a join task t on t.id=a.task_id where t.common_work_id=$1 and t.state='accepted_admin' and a.task_report_id=(select r.id from task_report r where r.task_id=t.id order by r.version desc limit 1) and a.status='complete' and (a.mime like 'image/%' or a.mime like 'video/%')",
          [row.common_work_id],
        )
        : [],
      files,
      building_ids: scope.map((s) => s.building_id),
      history: await deps.db.query(
        "select * from publication_log where publication_id=$1 order by id",
        [id],
      ),
    };
  }
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    kind: row.kind,
    state: row.state,
    files,
    building_ids: scope.map((s) => s.building_id),
    planned_start: row.planned_start,
    planned_end: row.planned_end,
    restored_at: row.restored_at,
  };
}
