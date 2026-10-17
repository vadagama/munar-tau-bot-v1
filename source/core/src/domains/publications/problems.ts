import type { Actor } from "../../pdp/types.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { content, createRequest, idempotent } from "../requests/service.ts";
import { requireRequest } from "../requests/access.ts";
import { requirePublication } from "./service.ts";
import { invalid, type Row } from "../registry/validation.ts";
export async function publicationProblem(
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
      `publication.problem:${id}`,
      key,
      input,
      async () => {
        const { row, scope } = await requirePublication(exec, actor, id);
        if (
          row.kind !== "work_report" || row.state !== "published" ||
          !scope.some((s) => s.building_id === input.building_id)
        ) invalid("Выберите объект опубликованной работы");
        const d = {
          ...deps,
          db: {
            ...deps.db,
            query: exec.query.bind(exec),
            transaction: <T>(fn: (e: typeof exec) => Promise<T>) => fn(exec),
          },
        };
        const request = await createRequest(d, actor, {
          kind: "request",
          source: input.source ?? "web",
          building_id: input.building_id,
          premises_id: input.premises_id,
          location_text: input.location_text ??
            `Опубликованная работа: ${row.title}`,
          text: content(input.text),
        });
        await exec.query(
          "insert into publication_request(publication_id,request_id) values($1,$2)",
          [id, request.id],
        );
        return request;
      },
      async (r) => {
        await requirePublication(exec, actor, id);
        await requireRequest(exec, actor, String(r.id));
      },
    )
  );
}
