import type { DbExecutor } from "../../db/client.ts";
import { invalid, type Row } from "../registry/validation.ts";
/** Общая работа блокируется раньше обращения, как в сервисе заданий. */
export async function lockRequestWorks(exec: DbExecutor, id: string) {
  await exec.query(
    "select w.id from common_work w join common_work_request l on l.common_work_id=w.id where l.request_id=$1 order by w.id for update of w",
    [id],
  );
}
/** Состав комплекта выводится из БД, клиент не может подставить чужой отчёт. */
export async function taskResultSnapshot(
  exec: DbExecutor,
  id: string,
): Promise<{ task_report_ids: string[]; task_results: Row[] }> {
  const works = await exec.query<{ id: string; state: string }>(
    "select w.id,w.state from common_work w join common_work_request l on l.common_work_id=w.id where l.request_id=$1",
    [id],
  );
  if (works.some((w) => w.state !== "completed")) {
    invalid("Связанные общие работы ещё не завершены");
  }
  const tasks = await exec.query<Row>(
    `select t.id,t.number,t.common_work_id,t.state,t.document_required,r.id as report_id,r.version as report_version,r.performed_work,r.performed_at,r.result,r.limitations
 from task t left join lateral (select * from task_report where task_id=t.id order by version desc limit 1) r on true
 where t.is_required and (t.request_id=$1 or t.common_work_id=any($2::uuid[])) order by t.id`,
    [id, works.map((w) => w.id)],
  );
  if (
    !tasks.length ||
    tasks.some((t) => t.state !== "accepted_admin" || !t.report_id)
  ) invalid("Не все необходимые задания приняты с отчётом");
  if (works.some((w) => !tasks.some((t) => t.common_work_id === w.id))) {
    invalid("У общей работы нет принятого обязательного объёма");
  }
  if (tasks.some((t) => t.document_required)) {
    invalid("Нужен обязательный акт: контур документов ещё не подключён");
  }
  return {
    task_report_ids: tasks.map((t) => String(t.report_id)),
    task_results: tasks.map((t) => ({
      task_number: t.number,
      report_id: t.report_id,
      report_version: t.report_version,
      performed_work: t.performed_work,
      performed_at: t.performed_at,
      result: t.result,
      limitations: t.limitations,
    })),
  };
}
