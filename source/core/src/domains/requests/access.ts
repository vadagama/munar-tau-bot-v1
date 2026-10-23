import type { Actor } from "../../pdp/types.ts";
import { can } from "../../pdp/evaluate.ts";
import type { DbExecutor } from "../../db/client.ts";
import type { ActionKey } from "../../pdp/actions.ts";
import { ApiError } from "../../errors/api.ts";
import type { Row } from "../registry/validation.ts";
export interface RequestRow extends Row {
  id: string;
  author_person_id: string;
  building_id: string | null;
  premises_id: string | null;
  state: import("./fsm.ts").RequestState;
  is_test: boolean;
  version: number;
  kind: string;
  complaint_subject_person_id: string | null;
  confirmation_version: number;
}
export interface RequestLinks { participant: boolean; active_author: boolean }
/** Одни условия для карточки и пакетной проверки списка. Аргументы — SQL-выражения сервера. */
export function requestLinkColumns(id = "$1", person = "$2", premises = "$3", author = "$4") {
  return `exists(select 1 from request_participant p join connection c on c.person_id=p.person_id and c.premises_id=${premises} and c.status='active'
 where p.request_id=${id} and p.person_id=${person} and p.role='participant' and p.revoked_at is null) as participant,
 case when ${premises}::uuid is null then
   exists(select 1 from profile pr join person n on n.id=pr.person_id where pr.person_id=${author} and pr.archived_at is null and n.status='active')
 else
   exists(select 1 from connection c where c.person_id=${author} and c.status='active' and c.premises_id=${premises})
 end as active_author`;
}
export async function requestAccess(
  exec: DbExecutor,
  actor: Actor,
  row: RequestRow,
  knownLinks?: RequestLinks,
) {
  const links = knownLinks ?? (await exec.query<RequestLinks>(
    `select ${requestLinkColumns()}`,
    [row.id, actor.person.id, row.premises_id, row.author_person_id],
  ))[0];
  return {
    chairmanOnly: row.complaint_route === "chairman",
    authorId: row.author_person_id,
    buildingId: row.building_id,
    state: row.state,
    isTest: row.is_test,
    participant: links?.participant ?? false,
    activeAuthor: links?.active_author ?? false,
    complaintSubjectId: row.complaint_subject_person_id,
  };
}
export async function requireRequest(
  exec: DbExecutor,
  actor: Actor,
  id: string,
  action: ActionKey = "request.read",
  lock = false,
): Promise<RequestRow> {
  const [row] = await exec.query<RequestRow>(
    `select * from request where id=$1${lock ? " for update" : ""}`,
    [id],
  );
  if (!row) throw new ApiError("NOT_FOUND");
  const access = await requestAccess(exec, actor, row);
  if (!can(actor, action, { requestAccess: access }).allow) {
    throw new ApiError(action === "request.read" ? "NOT_FOUND" : "FORBIDDEN");
  }
  return row;
}
export function isManager(
  exec: DbExecutor,
  actor: Actor,
  row: RequestRow,
): Promise<boolean> {
  void exec;
  // Полномочия Actor собраны заново для этого запроса. Связь/участие не дают
  // права обработчика, поэтому не делаем отдельный SQL-запрос для каждой строки.
  return Promise.resolve(
    can(actor, "request.manage", {
      requestAccess: {
        authorId: row.author_person_id,
        buildingId: row.building_id,
        state: row.state,
        isTest: row.is_test,
        participant: false,
        activeAuthor: false,
        complaintSubjectId: row.complaint_subject_person_id,
        chairmanOnly: row.complaint_route === "chairman",
      },
    }).allow,
  );
}
export async function validateLocation(
  exec: DbExecutor,
  actor: Actor,
  authorId: string,
  input: Row,
): Promise<{ buildingId: string | null; premisesId: string | null }> {
  const premisesId = typeof input.premises_id === "string"
    ? input.premises_id
    : null;
  let buildingId = typeof input.building_id === "string"
    ? input.building_id
    : null;
  if (premisesId) {
    const [p] = await exec.query<{ building_id: string; is_test: boolean }>(
      "select building_id,is_test from premises where id=$1 and status='active'",
      [premisesId],
    );
    if (
      !p || p.is_test !== actor.person.isTest ||
      (buildingId && buildingId !== p.building_id)
    ) throw new ApiError("VALIDATION_FAILED", "Некорректное помещение");
    buildingId = p.building_id;
  }
  // Привязанное помещение требует действующую связь заявителя; адресное
  // обращение (REG-01, premises_id IS NULL) — достаточно действующего профиля.
  const [connection] = premisesId
    ? await exec.query(
        `select 1 from connection c join person n on n.id=c.person_id where c.person_id=$1 and c.status='active' and n.status='active' and n.is_test=$3 and c.premises_id=$2`,
        [authorId, premisesId, actor.person.isTest],
      )
    : await exec.query(
        `select 1 from profile pr join person n on n.id=pr.person_id where pr.person_id=$1 and pr.archived_at is null and n.status='active' and n.is_test=$2`,
        [authorId, actor.person.isTest],
      );
  if (!connection) {
    throw new ApiError(
      "FORBIDDEN",
      premisesId
        ? "Нужна действующая подтверждённая связь заявителя"
        : "Нужен действующий профиль заявителя",
    );
  }
  if (
    !premisesId &&
    (typeof input.location_text !== "string" || !input.location_text.trim())
  ) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Опишите место на общем имуществе/территории",
    );
  }
  if (
    buildingId &&
    !(await exec.query("select id from building where id=$1", [buildingId]))
      .length
  ) throw new ApiError("VALIDATION_FAILED", "Дом не найден");
  return { buildingId, premisesId };
}
