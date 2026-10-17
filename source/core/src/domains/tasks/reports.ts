import { lockCommonParents, syncCommonWork } from "./common.ts";
import type { Actor } from "../../pdp/types.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { invalid, jsonValue, type Row } from "../registry/validation.ts";
import { content, idempotent } from "../requests/service.ts";
import { checkVersion, CLOSED_STATES } from "../requests/fsm.ts";
import { requireTask, TASK_SELECT, type TaskRow } from "./access.ts";
import { nextTaskState } from "./fsm.ts";
import { dateInput, taskLog } from "./service.ts";
import {
  type EvidenceRequirement,
  validateReport,
  type WorkReport,
} from "./report.ts";

export function reportInput(input: Row): WorkReport {
  if (!Array.isArray(input.evidence) || input.evidence.length > 30) {
    invalid("Укажите доказательства по чек-листу");
  }
  const evidence = input.evidence.map((value: unknown) => {
    if (!value || typeof value !== "object") {
      invalid("Некорректное доказательство");
    }
    const r = value as Row;
    if (
      !Array.isArray(r.attachment_ids) ||
      r.attachment_ids.some((id) => typeof id !== "string")
    ) invalid("Некорректный список файлов");
    return {
      requirementId: content(r.requirement_id),
      attachmentIds: r.attachment_ids as string[],
      ...(r.missing_reason == null
        ? {}
        : { missingReason: content(r.missing_reason) }),
    };
  });
  const files = evidence.flatMap((e) => e.attachmentIds);
  if (files.length > 10 || new Set(files).size !== files.length) {
    invalid("До 10 файлов без повторов на отчёт");
  }
  if (
    typeof input.limitations !== "string" || input.limitations.length > 10000
  ) invalid("Укажите оставшиеся ограничения (или пустую строку)");
  return {
    performedWork: content(input.performed_work),
    performedAt: dateInput(input.performed_at),
    result: content(input.result),
    limitations: input.limitations.trim(),
    evidence,
  };
}
export async function submitTaskReport(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
  key: unknown,
): Promise<TaskRow> {
  return deps.db.transaction((exec) =>
    idempotent(exec, actor, `tasks:${id}:report`, key, input, async () => {
      const initial = await requireTask(exec, actor, id, "task.execute");
      const parent = initial.common_work_id
        ? await lockCommonParents(exec, initial.common_work_id)
        : (await exec.query(
          "select state from request where id=$1 for update",
          [initial.request_id],
        ))[0];
      const row = await requireTask(exec, actor, id, "task.execute", true);
      checkVersion(row.version, input.version);
      if (
        !parent ||
        (initial.request_id
          ? CLOSED_STATES.includes(String(parent.state)) ||
            parent.state === "awaiting_confirmation"
          : ["completed", "canceled"].includes(String(parent.state)))
      ) invalid("Обращение завершено или результат уже передан");
      const state = nextTaskState(row.state, "report");
      const report = reportInput(input),
        ids = report.evidence.flatMap((e) => e.attachmentIds);
      // completeFile уже сверил фактический объект Storage. Файл должен принадлежать этому исполнителю и заданию.
      const files = await exec.query<{ id: string; mime: string }>(
        "select id,mime from attachment where id=any($1::uuid[]) and task_id=$2 and owner_type='task' and task_report_id is null and uploaded_by=$3 and status='complete' for update",
        [ids, id, actor.person.id],
      );
      const requirements = jsonValue<EvidenceRequirement[]>(
        row.required_evidence,
      );
      const missing = validateReport(
        report,
        requirements,
        new Set(files.map((f) => f.id)),
      );
      for (
        const requirement of requirements.filter((r) => r.kind === "photo")
      ) {
        const evidence = report.evidence.find((e) =>
          e.requirementId === requirement.id
        );
        if (
          evidence?.attachmentIds.some((id) =>
            !files.find((f) => f.id === id)?.mime.startsWith("image/")
          )
        ) invalid("В этом пункте требуется фотография");
      }
      const [policy] = await exec.query<{ max_per_message: number }>(
        "select max_per_message from file_policy where singleton",
      );
      if (!policy || ids.length > policy.max_per_message) {
        invalid("Превышен лимит файлов по настройкам ОСИ");
      }
      const [saved] = await exec.query<{ id: string; version: number }>(
        `insert into task_report(task_id,version,performed_work,performed_at,result,limitations,evidence,missing_evidence,created_by)
      values ($1,(select coalesce(max(version),0)+1 from task_report where task_id=$1),$2,$3,$4,$5,$6::text::jsonb,$7::text::jsonb,$8) returning id,version`,
        [
          id,
          report.performedWork,
          report.performedAt,
          report.result,
          report.limitations,
          JSON.stringify(report.evidence),
          JSON.stringify(missing),
          actor.person.id,
        ],
      );
      await exec.query(
        "update attachment set task_report_id=$2 where id=any($1::uuid[])",
        [ids, saved!.id],
      );
      await exec.query(
        "update task set state=$2,version=version+1,updated_at=now() where id=$1",
        [id, state],
      );
      const [updated] = await exec.query<TaskRow>(
        `${TASK_SELECT} where t.id=$1`,
        [id],
      );
      await taskLog(deps, exec, actor, updated!, "report", row.state, null, {
        report_id: saved!.id,
        report_version: saved!.version,
      });
      if (row.common_work_id) {
        await syncCommonWork(deps, exec, actor, row.common_work_id);
      }
      return updated!;
    }, async () => {
      await requireTask(exec, actor, id, "task.execute");
    })
  );
}
