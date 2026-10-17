import type { Actor } from "../../pdp/types.ts";
import { ApiError } from "../../errors/api.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { invalid, type Row } from "../registry/validation.ts";
import { idempotent, transitionRequest } from "../requests/service.ts";
import { requireRequest } from "../requests/access.ts";
import { checkVersion, CLOSED_STATES } from "../requests/fsm.ts";
import { requireIncident } from "./access.ts";
/** EMG-07: отдельный результат каждого обращения, без подтверждения за автора. */
export async function distributeRecovery(
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
      `incident.distribute:${id}`,
      key,
      input,
      async () => {
        const { row } = await requireIncident(
          exec,
          actor,
          id,
          "incident.link",
          true,
        );
        checkVersion(row.version, input.expected_version);
        if (row.state !== "completed" || !row.public_text) {
          invalid("Сначала проверьте полное восстановление и опубликуйте итог");
        }
        const works = await exec.query<
          { id: string; state: string; building_ids: string[] }
        >(
          "select id,state,building_ids from common_work where incident_id=$1 order by id for update",
          [id],
        );
        const linked = await exec.query<{ request_id: string }>(
          "select request_id from incident_request where incident_id=$1 order by request_id",
          [id],
        );
        const result: Row[] = [];
        const d = {
          ...deps,
          db: {
            ...deps.db,
            query: exec.query.bind(exec),
            transaction: <T>(fn: (e: typeof exec) => Promise<T>) => fn(exec),
          },
        };
        for (const link of linked) {
          await exec.query("savepoint incident_result");
          try {
            const request = await requireRequest(
              exec,
              actor,
              link.request_id,
              "request.manage",
            );
            if (
              CLOSED_STATES.includes(request.state) ||
              request.state === "awaiting_confirmation"
            ) {
              result.push({ id: request.id, state: request.state });
              await exec.query("release savepoint incident_result");
              continue;
            }
            const applicableWorks = works.filter((w) =>
              request.kind === "request" && request.building_id !== null &&
              w.building_ids.includes(request.building_id)
            );
            if (applicableWorks.some((w) => w.state !== "completed")) {
              invalid("Общая работа инцидента ещё не завершена");
            }
            for (const work of applicableWorks) {
              const existing = await exec.query(
                "select request_id from common_work_request where common_work_id=$1 and request_id=$2",
                [work.id, request.id],
              );
              if (!existing.length) {
                invalid(
                  "Для обращения не определён обязательный объём общей работы инцидента",
                );
              }
            }
            const updated = await transitionRequest(d, actor, request.id, {
              action: "submit_result",
              expected_version: request.version,
              payload: { confirmation_payload: { summary: row.public_text } },
            }, `incident:${id}:${row.version}:${request.id}`);
            result.push({ id: request.id, state: updated.state });
            await exec.query("release savepoint incident_result");
          } catch (error) {
            await exec.query("rollback to savepoint incident_result");
            if (
              !(error instanceof ApiError) ||
              !["VALIDATION_FAILED", "INVALID_TRANSITION", "FORBIDDEN"]
                .includes(error.code)
            ) throw error;
            if (error.code === "FORBIDDEN") {
              result.push({
                id: link.request_id,
                reason: "Доступ к обращению ограничен",
              });
              continue;
            }
            const request = await requireRequest(
              exec,
              actor,
              link.request_id,
              "request.manage",
            );
            await exec.query(
              "insert into request_log(request_id,from_state,to_state,actor_person_id,actor_role,reason,meta) values($1,$2,$2,$3,'administrator',$4,$5::text::jsonb)",
              [
                request.id,
                request.state,
                actor.person.id,
                error.message,
                JSON.stringify({
                  action: "incident.result_pending",
                  incident_id: id,
                  incident_version: row.version,
                }),
              ],
            );
            result.push({
              id: request.id,
              state: request.state,
              reason: error.message,
            });
          }
        }
        return { items: result };
      },
      () => requireIncident(exec, actor, id, "incident.link"),
    )
  );
}
