import type { Actor } from "../../pdp/types.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { invalid, type Row } from "../registry/validation.ts";
import { content, idempotent } from "../requests/service.ts";
import { requireRequest } from "../requests/access.ts";
import { checkVersion, CLOSED_STATES } from "../requests/fsm.ts";
import { requireCommon } from "../tasks/common.ts";
import { type IncidentRow, requireIncident } from "./access.ts";
import { incidentLog } from "./service.ts";
export async function linkIncident(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
  key: unknown,
) {
  return deps.db.transaction((exec) =>
    idempotent(exec, actor, `incident-link:${id}`, key, input, async () => {
      const { row, scope } = await requireIncident(
        exec,
        actor,
        id,
        "incident.link",
        true,
      );
      checkVersion(row.version, input.expected_version);
      const reason = content(input.reason),
        target = content(input.target_id),
        kind = input.kind;
      // Единый порядок блокировок: инцидент → общие работы → обращения.
      await exec.query(
        "select id from common_work where incident_id=$1 or id=$2::uuid order by id for update",
        [id, kind === "common_work" ? target : null],
      );
      await exec.query(
        "select r.id from request r where r.id in(select request_id from incident_request where incident_id=$1) or r.id=$2::uuid order by r.id for update",
        [id, kind === "request" ? target : null],
      );
      if (kind === "common_work") {
        const work = await requireCommon(exec, actor, target, true);
        if (
          work.is_test !== row.is_test ||
          !work.building_ids.every((b) =>
            scope.some((s) => s.building_id === b)
          )
        ) invalid("Общая работа за пределами охвата");
        if (work.incident_id && work.incident_id !== id) {
          invalid("Работа уже относится к другому инциденту");
        }
        await exec.query(
          "update common_work set incident_id=$2,version=version+1 where id=$1",
          [target, input.unlink ? null : id],
        );
      } else if (kind === "request") {
        const request = await requireRequest(
          exec,
          actor,
          target,
          "request.manage",
          true,
        );
        if (
          request.is_test !== row.is_test ||
          !scope.some((s) =>
            s.building_id === request.building_id &&
            (!s.premises_ids.length ||
              s.premises_ids.includes(String(request.premises_id)))
          )
        ) invalid("Обращение за пределами охвата");
        if (input.unlink) {
          content(input.next_route, "дальнейший маршрут");
          if (!request.assigned_admin_person_id) {
            invalid("До отсоединения назначьте ответственного обращению");
          }
          await exec.query(
            "delete from incident_request where incident_id=$1 and request_id=$2",
            [id, target],
          );
        } else {
          if (
            input.place_verified !== true || input.cause_verified !== true ||
            CLOSED_STATES.includes(request.state)
          ) invalid("Проверьте место и причину открытого обращения");
          await exec.query(
            "insert into incident_request(incident_id,request_id,linked_by) values($1,$2,$3) on conflict do nothing",
            [id, target, actor.person.id],
          );
        }
      } else invalid("Выберите обращение или общую работу");
      const pairs = await exec.query<
        { common_work_id: string; request_id: string; state: string }
      >(
        "select w.id as common_work_id,l.request_id,w.state from common_work w join incident_request l on l.incident_id=w.incident_id join request r on r.id=l.request_id and r.building_id=any(w.building_ids) and r.kind='request' where w.incident_id=$1 order by w.id,l.request_id",
        [id],
      );
      for (const pair of pairs) {
        const request = await requireRequest(
          exec,
          actor,
          pair.request_id,
          "request.manage",
          true,
        );
        const existing = await exec.query(
          "select request_id from common_work_request where common_work_id=$1 and request_id=$2",
          [pair.common_work_id, pair.request_id],
        );
        if (existing.length) continue;
        if (["completed", "canceled"].includes(pair.state)) {
          invalid("Перед добавлением нового объёма возобновите общую работу");
        }
        if (
          CLOSED_STATES.includes(request.state) ||
          request.state === "awaiting_confirmation"
        ) {
          invalid(
            "Отзовите ожидающий результат перед изменением объёма инцидента",
          );
        }
        const added = await exec.query(
          "insert into common_work_request(common_work_id,request_id) values($1,$2) on conflict do nothing returning request_id",
          [pair.common_work_id, pair.request_id],
        );
        if (added.length) {
          await exec.query(
            "insert into incident_work_request(incident_id,common_work_id,request_id) values($1,$2,$3) on conflict do nothing",
            [id, pair.common_work_id, pair.request_id],
          );
          await exec.query(
            "update request set work_execution_required=true,work_started_at=case when exists(select 1 from task where common_work_id=$2 and started_at is not null) then coalesce(work_started_at,now()) else work_started_at end,version=version+1 where id=$1",
            [pair.request_id, pair.common_work_id],
          );
        }
      }
      if (input.unlink) {
        const removed = await exec.query<
          { common_work_id: string; request_id: string }
        >(
          "delete from incident_work_request where incident_id=$1 and (($2='request' and request_id=$3) or ($2='common_work' and common_work_id=$3)) returning common_work_id,request_id",
          [id, kind, target],
        );
        for (const pair of removed) {
          const request = await requireRequest(
            exec,
            actor,
            pair.request_id,
            "request.manage",
            true,
          );
          if (
            request.state === "awaiting_confirmation" ||
            CLOSED_STATES.includes(request.state)
          ) {
            invalid("Сначала отзовите ожидающий результат");
          }
          await exec.query(
            "delete from common_work_request where common_work_id=$1 and request_id=$2",
            [pair.common_work_id, pair.request_id],
          );
          await exec.query("update request set version=version+1 where id=$1", [
            pair.request_id,
          ]);
        }
      }
      const [updated] = await exec.query<IncidentRow>(
        "update incident set version=version+1 where id=$1 returning *",
        [id],
      );
      await incidentLog(deps, exec, actor, updated!, scope, row.state, reason, {
        kind,
        target_id: target,
        unlink: input.unlink === true,
        next_route: input.next_route,
      });
      return updated!;
    }, () => requireIncident(exec, actor, id, "incident.link"))
  );
}
