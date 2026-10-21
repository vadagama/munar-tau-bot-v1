import { templateNotice } from "../../templates/notice.ts";
import type { NoticeText } from "../../templates/notice.ts";
import { fmtDate } from "../../bot/text.ts";
import { startConfirmationTimers } from "./timers.ts";
import { cancelParentTasks } from "../tasks/cancellation.ts";
import { lockRequestWorks, taskResultSnapshot } from "../tasks/results.ts";
import { requestStateLoc } from "../../locales/requests.ts";
import type { Actor } from "../../pdp/types.ts";
import { ApiError } from "../../errors/api.ts";
import type { DbExecutor } from "../../db/client.ts";
import { recordAudit, type RegistryDeps } from "../registry/service.ts";
import { invalid, jsonValue, type Row } from "../registry/validation.ts";
import { ruleDeadline } from "../registry/time.ts";
import { notifyPerson } from "../registrations/notifications.ts";
import {
  isManager,
  type RequestRow,
  requireRequest,
  validateLocation,
} from "./access.ts";
import { checkVersion, CLOSED_STATES, nextState } from "./fsm.ts";

export function content(value: unknown, label = "текст"): string {
  if (typeof value !== "string" || !value.trim() || value.length > 10000) {
    invalid(`Заполните ${label} (до 10000 символов)`);
  }
  return value.trim();
}
function choice(value: unknown, allowed: string[], fallback: string): string {
  const v = value ?? fallback;
  if (typeof v !== "string" || !allowed.includes(v)) {
    invalid("Недопустимое значение");
  }
  return v;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map((
        [k, v],
      ) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")
    }}`;
  }
  return JSON.stringify(value) ?? "null";
}
export async function idempotent<T>(
  exec: DbExecutor,
  actor: Actor,
  endpoint: string,
  key: unknown,
  body: unknown,
  fn: () => Promise<T>,
  authorizeReplay?: (response: T) => Promise<unknown>,
): Promise<T> {
  if (typeof key !== "string" || !key.trim() || key.length > 200) {
    invalid("Нужен Idempotency-Key (до 200 символов)");
  }
  const scope = `${actor.person.id}:${endpoint}`;
  await exec.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    `${scope}:${key}`,
  ]);
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(body)),
      ),
    ),
  ).map((n) => n.toString(16).padStart(2, "0")).join("");
  const [old] = await exec.query<{ request_hash: string; response: unknown }>(
    "select request_hash,response from idempotency_key where key=$1 and endpoint=$2",
    [key, scope],
  );
  if (old) {
    if (old.request_hash !== hash) throw new ApiError("IDEMPOTENCY_CONFLICT");
    const response = jsonValue<T>(old.response);
    await authorizeReplay?.(response);
    return response;
  }
  const response = await fn();
  await exec.query(
    "insert into idempotency_key(key,endpoint,request_hash,response,status) values ($1,$2,$3,$4::text::jsonb,200)",
    [key, scope, hash, JSON.stringify(response)],
  );
  return response;
}
async function category(exec: DbExecutor, id: unknown): Promise<string | null> {
  if (!id) return null;
  if (
    typeof id !== "string" ||
    !(await exec.query(
      "select id from request_category where id=$1 and active",
      [id],
    )).length
  ) invalid("Категория недоступна");
  return id;
}
async function log(
  deps: RegistryDeps,
  exec: DbExecutor,
  actor: Actor,
  row: RequestRow,
  action: string,
  from: string | null,
  reason: string | null = null,
  details: Row = {},
): Promise<void> {
  await exec.query(
    "insert into request_log(request_id,from_state,to_state,actor_person_id,actor_role,reason,meta) values ($1,$2,$3,$4,$5,$6,$7::text::jsonb)",
    [
      row.id,
      from,
      row.state,
      actor.person.id,
      actor.assignments.map((a) => a.role).join(",") || "resident",
      reason,
      JSON.stringify({
        action,
        version: row.version,
        ...details,
        emulated_person_id: actor.emulation ? actor.person.id : null,
      }),
    ],
  );
  // Не копировать содержание жалоб/переписки в общий аудит (AUD-02).
  await recordAudit(
    deps,
    exec,
    actor,
    `request.${action}`,
    "request",
    row.id,
    row.kind !== "complaint" && row.building_id ? [row.building_id] : [],
    from ? { state: from } : null,
    { state: row.state, version: row.version },
  );
}
async function event(
  exec: DbExecutor,
  row: RequestRow,
  type: string,
): Promise<void> {
  await exec.query(
    "insert into outbox(event_type,payload,processed_at) values ($1,$2::text::jsonb,now())",
    [
      type,
      JSON.stringify({
        request_id: row.id,
        version: row.version,
        is_test: row.is_test,
      }),
    ],
  );
}
export async function inform(
  exec: DbExecutor,
  row: RequestRow,
  text: NoticeText,
  key: string,
  includeParticipants = false,
  required = true,
): Promise<void> {
  const people = new Set([row.author_person_id]);
  if (includeParticipants) {
    const rows = await exec.query<{ person_id: string }>(
      `select p.person_id from request_participant p join connection c on c.person_id=p.person_id and c.premises_id=$2 and c.status='active' where p.request_id=$1 and p.role='participant' and p.revoked_at is null`,
      [row.id, row.premises_id],
    );
    rows.forEach((r) => people.add(r.person_id));
  }
  for (const id of people) await notifyPerson(exec, id, text, `${key}:${id}`, {type:required ? "request.required" : "request.status",requestId:row.id,audience:"resident",important:required,isTest:row.is_test});
}
export async function informManagers(
  exec: DbExecutor,
  row: RequestRow,
  text: NoticeText,
  key: string,
): Promise<void> {
  const people = await exec.query<{ person_id: string }>(
    `select distinct a.person_id from staff_assignment a join person n on n.id=a.person_id
 where a.status='active' and n.status='active' and n.is_test=$1 and a.person_id is distinct from $2::uuid
 and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now())
 and (a.role='chairman' or ($3<>'chairman' and a.role in ('administrator','deputy')))`,
    [row.is_test,row.complaint_subject_person_id,row.complaint_route ?? "administrator"],
  );
  for (const p of people) {
    await notifyPerson(exec, p.person_id, text, `${key}:${p.person_id}`, {type:"request.staff",requestId:row.id,audience:"staff",isTest:row.is_test,bot:"worker"});
  }
}
async function register(
  exec: DbExecutor,
  row: RequestRow,
  attachmentIds?: string[],
): Promise<RequestRow> {
  const year = new Date().getUTCFullYear();
  const [seq] = await exec.query<{ seq: string }>(
    "insert into number_sequence(key,year,seq) values ('request',$1,1) on conflict(key,year) do update set seq=number_sequence.seq+1 returning seq",
    [year],
  );
  const due = await ruleDeadline(exec, "first_response");
  const number = `З-${String(year).slice(-2)}-${
    String(seq!.seq).padStart(5, "0")
  }`;
  const [next] = await exec.query<RequestRow>(
    "update request set state='new',number=$2,first_response_due_at=$3,first_response_start_at=$4,open_at=now(),version=version+1,updated_at=now() where id=$1 returning *",
    [row.id, number, due.due.toISOString(), due.starts.toISOString()],
  );
  await exec.query(
    "insert into timer(rule_version_id,entity_id,stage,due_at) values ($1,$2,'request_first_response',$3) on conflict(entity_id,stage) do nothing",
    [due.id, row.id, due.due.toISOString()],
  );
  const initial = crypto.randomUUID();
  await exec.query(
    "insert into message(id,request_id,channel,author_person_id,text,source) values ($1,$2,'resident',$3,$4,$5)",
    [initial, row.id, row.created_by, row.description, row.source],
  );
  await exec.query(
    "update attachment set owner_type='message',owner_id=$2 where request_id=$1 and owner_type='request' and bucket='resident' and ($3::uuid[] is null or id=any($3))",
    [row.id, initial, attachmentIds ?? null],
  );
  await exec.query(
    "insert into request_participant(request_id,person_id,role,added_by) values ($1,$2,'author',$3)",
    [row.id, row.author_person_id, row.created_by],
  );
  return next!;
}
export async function createRequest(
  deps: RegistryDeps,
  actor: Actor,
  input: Row,
  key?: string,
): Promise<Row> {
  return deps.db.transaction(async (exec) => {
    const operation = async () => {
      const authorId = typeof input.author_person_id === "string"
        ? input.author_person_id
        : actor.person.id;
      const location = await validateLocation(exec, actor, authorId, input);
      if (authorId !== actor.person.id) {
        const fake = {
          id: "",
          author_person_id: authorId,
          building_id: location.buildingId,
          state: "new",
          is_test: actor.person.isTest,
          premises_id: location.premisesId,
          complaint_subject_person_id: null,
        } as RequestRow;
        if (
          !await isManager(exec, actor, fake) ||
          !["phone", "personal", "whatsapp"].includes(String(input.source))
        ) {
          throw new ApiError(
            "FORBIDDEN",
            "Внешнее обращение создаёт администратор с указанием источника",
          );
        }
      }
      const draft = input.as_draft === true;
      if (draft && authorId !== actor.person.id) {
        invalid("Черновик сохраняет только автор");
      }
      const subject = typeof input.complaint_subject_person_id === "string"
        ? input.complaint_subject_person_id
        : null;
      const kind = choice(
        input.kind,
        ["request", "question", "complaint"],
        "request",
      );
      if (subject && kind !== "complaint") {
        invalid("Адресат конфликта указывается для жалобы");
      }
      let complaintRoute = "administrator";
      if (subject) {
        const staff = await exec.query<{ role: string }>(
          `select a.role from staff_assignment a join person n on n.id=a.person_id where a.person_id=$1 and n.is_test=$2 and a.status='active' and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now())`,
          [subject, actor.person.isTest],
        );
        if (!staff.length) {
          invalid(
            "Укажите действующего сотрудника, на которого подаётся жалоба",
          );
        }
        if (staff.some((a) => ["administrator", "deputy"].includes(a.role))) {
          complaintRoute = "chairman";
        }
      }
      const fromDraft = input.expected_draft_version !== undefined &&
        input.expected_draft_version !== null;
      let id: string = crypto.randomUUID();
      if (fromDraft) {
        if (authorId !== actor.person.id) throw new ApiError("FORBIDDEN");
        const [existing] = await exec.query<RequestRow>(
          "select * from request where author_person_id=$1 and state='draft' for update",
          [authorId],
        );
        if (!existing) {
          throw new ApiError("NOT_FOUND", "Черновик уже отправлен или удалён");
        }
        checkVersion(existing.version, input.expected_draft_version);
        id = existing.id;
      }
      if (input.attachments !== undefined) {
        if (
          !Array.isArray(input.attachments) || input.attachments.length > 10 ||
          input.attachments.some((x) => typeof x !== "string")
        ) invalid("Некорректные вложения");
        if (input.attachments.length) {
          if (!fromDraft) {
            invalid("Загрузите вложения в личный черновик до отправки");
          }
          const available = await exec.query(
            "select id from attachment where id=any($1::uuid[]) and request_id=$2 and bucket='resident' and uploaded_by=$3",
            [input.attachments, id, actor.person.id],
          );
          if (available.length !== new Set(input.attachments).size) {
            throw new ApiError("FORBIDDEN");
          }
        }
      }
      const [row] = await exec.query<RequestRow>(
        fromDraft
          ? `update request set author_person_id=$2,created_by=$3,description=$4,kind=$5,urgency=$6,category_id=$7,premises_id=$8,building_id=$9,location_text=$10,source=$11,is_test=$12,complaint_subject_person_id=$13,version=version+1,updated_at=now() where id=$1 returning *`
          : `insert into request(id,author_person_id,created_by,description,kind,urgency,category_id,premises_id,building_id,location_text,source,is_test,complaint_subject_person_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
        [
          id,
          authorId,
          actor.person.id,
          content(input.text),
          kind,
          choice(
            input.urgency,
            ["low", "normal", "high", "critical"],
            "normal",
          ),
          await category(exec, input.category_id),
          location.premisesId,
          location.buildingId,
          input.location_text ?? null,
          choice(input.source, [
            "bot",
            "admin",
            "web",
            "phone",
            "personal",
            "whatsapp",
          ], "web"),
          actor.person.isTest,
          subject,
        ],
      );
      await exec.query("update request set complaint_route=$2 where id=$1", [
        id,
        complaintRoute,
      ]);
      row!.complaint_route = complaintRoute;
      if (draft) return row!;
      const next = await register(
        exec,
        row!,
        Array.isArray(input.attachments)
          ? input.attachments as string[]
          : undefined,
      );
      await log(deps, exec, actor, next, "created", null);
      await event(exec, next, "request.created");
      await inform(
        exec,
        next,
        templateNotice("notices.requests_service_create_request_1", {next_number: next.number, detail_b: fmtDate(next.first_response_due_at)}),
        `${id}:created`,
        false,
        false,
      );
      await informManagers(
        exec,
        next,
        templateNotice("notices.requests_service_create_request_101", {next_number: next.number}),
        `${id}:queue`,
      );
      return next;
    };
    return input.as_draft === true
      ? operation()
      : idempotent(exec, actor, "requests", key, input, operation, (response) =>
        requireRequest(exec, actor, String(response.id)));
  });
}
export async function listRequests(
  deps: RegistryDeps,
  actor: Actor,
  filter: Row = {},
): Promise<Row[]> {
  // Серверная область в SQL до пагинации; поиск только по доступному описанию/номеру.
  let offset = 0;
  if (filter.cursor) {
    try {
      offset = Number(atob(String(filter.cursor)));
    } catch {
      invalid("Некорректный курсор");
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      invalid("Некорректный курсор");
    }
  }
  const chairman = actor.assignments.some((a) => a.role === "chairman");
  const scope = actor.assignments.filter((a) =>
    ["administrator", "deputy"].includes(a.role)
  ).flatMap((a) => a.scopeBuildingIds ?? []);
  const rows = await deps.db.query<RequestRow>(
    `select r.* from request r where r.is_test=$1 and
 (r.author_person_id=$2 or (r.state<>'draft' and (r.complaint_subject_person_id is distinct from $2::uuid) and ($3 or (r.complaint_route<>'chairman' and (r.building_id is null or r.building_id=any($4::uuid[]))))) or
 (r.state<>'draft' and exists(select 1 from request_participant p join connection c on c.person_id=p.person_id and c.premises_id=r.premises_id and c.status='active' where p.request_id=r.id and p.person_id=$2 and p.role='participant' and p.revoked_at is null)))
 and ($5::text is null or r.state=$5) and ($6::text is null or r.number ilike '%'||$6||'%' or r.description ilike '%'||$6||'%' or exists(select 1 from message m where m.request_id=r.id and m.channel='resident' and m.restricted_at is null and m.text ilike '%'||$6||'%'))
 and ($7::uuid is null or r.premises_id=$7) and ($8::timestamptz is null or r.created_at>=$8) and ($9::timestamptz is null or r.created_at<=$9)
 and ($11::uuid is null or r.building_id=$11)
 order by case when r.state in ('need_clarification','awaiting_confirmation') then 0 else 1 end,r.created_at desc,r.id desc limit 100 offset $10`,
    [
      actor.person.isTest,
      actor.person.id,
      chairman,
      scope,
      filter.state ?? null,
      filter.search ?? null,
      filter.premises_id ?? null,
      filter.from ?? null,
      filter.to ?? null,
      offset,
      filter.building_id ?? null,
    ],
  );
  return Promise.all(rows.map((r) => publicRequest(deps.db, actor, r)));
}
async function publicRequest(
  exec: DbExecutor,
  actor: Actor,
  row: RequestRow,
): Promise<Row> {
  if (await isManager(exec, actor, row)) return { ...row, can_manage: true };
  // Служебные поля не раскрываются автору/участникам.
  const {
    complaint_subject_person_id: _subject,
    cancel_request: cancel,
    appeal_by_chairman: appeal,
    ...rest
  } = row;
  void _subject;
  return {
    ...rest,
    cancel_request: cancel ? { pending: true } : null,
    appeal_pending: !!appeal,
    can_manage: false,
  };
}
export async function getRequest(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
): Promise<Row> {
  return deps.db.transaction(async (exec) => {
    const row = await requireRequest(exec, actor, id);
    const [place] = await exec.query<
      { label: string | null; active_author: boolean; is_apartment: boolean; author_name: string | null }
    >(
      `select
      (select full_name from person where id=$3) author_name,
      (select concat_ws(', ',b.name,case p.kind when 'apartment' then 'квартира' when 'commercial' then 'коммерческое помещение' when 'parking_slot' then 'парковочное место' when 'storage' then 'кладовка' end,p.number) from building b left join premises p on p.id=$2 where b.id=$1) label,
      case when $2::uuid is null then exists(select 1 from profile pr join person n on n.id=pr.person_id where pr.person_id=$3 and pr.archived_at is null and n.status='active') else exists(select 1 from connection where person_id=$3 and status='active' and premises_id=$2) end active_author,exists(select 1 from premises where id=$2 and kind='apartment') is_apartment`,
      [row.building_id, row.premises_id, row.author_person_id],
    );
    row.author_name = place?.author_name ?? null;
    row.place_label = place?.label || row.location_text || "Общая территория";
    row.can_act_as_author = row.author_person_id === actor.person.id &&
      !!place?.active_author;
    row.can_share = row.can_act_as_author && row.premises_id !== null &&
      place?.is_apartment &&
      row.state !== "draft";
    const manager = await isManager(exec, actor, row);
    row.can_comment = manager ||
      (!!place?.active_author && row.state !== "draft");
    const messages = await exec.query(
      `select m.id,m.channel,m.author_person_id,author.full_name as author_name,m.text,m.reply_to,m.corrects_message_id,m.restricted_at,m.created_at,
      case when m.author_person_id = r.author_person_id then 'author'
           when exists(select 1 from staff_assignment s where s.person_id = m.author_person_id and s.status = 'active') then 'staff'
           else 'participant' end as author_kind
      from message m join request r on r.id = m.request_id left join person author on author.id=m.author_person_id
      where m.request_id=$1 and ($2 or (m.channel='resident' and m.restricted_at is null)) order by m.created_at,m.id`,
      [id, manager],
    );
    const attachments = await exec.query(
      `select a.id,a.owner_type,a.owner_id,a.filename,a.size_bytes,a.mime,a.status,a.bucket from attachment a where request_id=$1 and (a.owner_type='message' or a.uploaded_by=$3) and ($2 or (bucket='resident' and (owner_type='request' or exists(select 1 from message m where m.id=a.owner_id and m.restricted_at is null)))) order by created_at`,
      [id, manager, actor.person.id],
    );
    const participants = await exec.query(
      "select person_id,role,revoked_at from request_participant where request_id=$1",
      [id],
    );
    const [confirmation] = await exec.query(
      "select version,payload,sent_at,confirmed_at from request_confirmation where request_id=$1 and version=$2",
      [id, row.confirmation_version],
    );
    const [rating] = await exec.query(
      "select value,comment,withdrawn_at from rating where request_id=$1",
      [id],
    );
    const logs = await exec.query(
      `select id,from_state,to_state,actor_person_id,at,case when $2 then reason else null end as reason,case when $2 then meta else '{}'::jsonb end as meta from request_log where request_id=$1 order by at,id`,
      [id, manager],
    );
    return {
      ...await publicRequest(exec, actor, row),
      ...(manager ? {
        tasks: await exec.query(
          `select t.id,t.number,t.state,t.due_at,a.full_name as assignee_name from task t left join person a on a.id=t.assignee_person_id where t.request_id=$1 order by t.created_at,t.id`, [id],
        ),
        delivery_failures: await exec.query(
        "select n.id,n.last_error,f.state as followup_state from notification n left join notification_followup f on f.notification_id=n.id where n.request_id=$1 and n.state='failed' and n.is_test=$2 order by n.created_at desc limit 50", [id,actor.person.isTest],
      ) } : {}),
      messages,
      attachments,
      participants,
      confirmation: confirmation
        ? { ...confirmation, payload: jsonValue(confirmation.payload) }
        : null,
      rating: rating ?? null,
      log: logs.map((l) => ({ ...l, meta: jsonValue(l.meta) })),
    };
  });
}
export async function editRequest(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
): Promise<Row> {
  return deps.db.transaction(async (exec) => {
    const row = await requireRequest(exec, actor, id, "request.read", true);
    checkVersion(row.version, input.expected_version);
    if (row.state === "draft") {
      if (row.author_person_id !== actor.person.id) {
        throw new ApiError("FORBIDDEN");
      }
      const loc = await validateLocation(exec, actor, actor.person.id, input);
      const [next] = await exec.query<RequestRow>(
        "update request set description=$2,premises_id=$3,building_id=$4,location_text=$5,kind=$6,version=version+1,updated_at=now() where id=$1 returning *",
        [
          id,
          content(input.text),
          loc.premisesId,
          loc.buildingId,
          input.location_text ?? null,
          choice(input.kind, ["request", "question", "complaint"], row.kind),
        ],
      );
      return next!;
    }
    await requireRequest(exec, actor, id, "request.manage");
    const loc =
      input.premises_id !== undefined || input.building_id !== undefined
        ? await validateLocation(exec, actor, row.author_person_id, input)
        : { premisesId: row.premises_id, buildingId: row.building_id };
    let assigned = row.assigned_admin_person_id ?? null;
    if (
      input.location_text !== undefined &&
      input.location_text !== row.location_text
    ) content(input.reason, "причину изменения места");
    if (
      loc.buildingId !== row.building_id || loc.premisesId !== row.premises_id
    ) {
      content(input.reason, "причину изменения места");
      const target = {
        ...row,
        building_id: loc.buildingId,
        premises_id: loc.premisesId,
      };
      if (!await isManager(exec, actor, target)) {
        throw new ApiError("FORBIDDEN");
      }
      await exec.query(
        "update request_participant set revoked_at=now() where request_id=$1 and role='participant' and revoked_at is null",
        [id],
      );
      assigned = input.assigned_admin_person_id ?? assigned;
      if (assigned) {
        const eligible = await exec.query(
          `select 1 from staff_assignment a join person n on n.id=a.person_id where a.person_id=$1 and n.is_test=$2 and n.status='active' and a.status='active' and a.person_id is distinct from $3::uuid and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now()) and (a.role='chairman' or ($4<>'chairman' and a.role in ('administrator','deputy')))`,
          [
            assigned,
            row.is_test,
            row.complaint_subject_person_id,
            row.complaint_route,
          ],
        );
        if (!eligible.length) {
          invalid("Укажите сопровождающего с полномочиями для нового места");
        }
      }
    }
    const [next] = await exec.query<RequestRow>(
      "update request set kind=$2,urgency=$3,category_id=$4,premises_id=$5,building_id=$6,location_text=$7,assigned_admin_person_id=$8,version=version+1,updated_at=now() where id=$1 returning *",
      [
        id,
        choice(input.kind, ["request", "question", "complaint"], row.kind),
        choice(
          input.urgency,
          ["low", "normal", "high", "critical"],
          String(row.urgency),
        ),
        input.category_id === undefined
          ? row.category_id
          : await category(exec, input.category_id),
        loc.premisesId,
        loc.buildingId,
        input.location_text ?? row.location_text,
        assigned,
      ],
    );
    const fields = [
      "kind",
      "category_id",
      "urgency",
      "premises_id",
      "building_id",
      "location_text",
      "assigned_admin_person_id",
    ];
    await log(
      deps,
      exec,
      actor,
      next!,
      "classified",
      row.state,
      typeof input.reason === "string" ? content(input.reason) : null,
      {
        before: Object.fromEntries(fields.map((k) => [k, row[k]])),
        after: Object.fromEntries(fields.map((k) => [k, next![k]])),
      },
    );
    return next!;
  });
}
export async function deleteDraft(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
): Promise<Row> {
  return deps.db.transaction(async (exec) => {
    const row = await requireRequest(exec, actor, id, "request.read", true);
    if (row.author_person_id !== actor.person.id) {
      throw new ApiError("FORBIDDEN");
    }
    if (row.state !== "draft") throw new ApiError("INVALID_TRANSITION");
    // Сохранённые файлы не публикуются; очистка Storage — отдельный retention-контур.
    await exec.query(
      "delete from request_upload_job where attachment_id in (select id from attachment where request_id=$1)",
      [id],
    );
    await exec.query("delete from attachment where request_id=$1", [id]);
    await exec.query("delete from request where id=$1", [id]);
    return { deleted: true };
  });
}
export async function transitionRequest(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
  key?: string,
): Promise<Row> {
  return deps.db.transaction((exec) => transitionRequestInTransaction(deps, exec, actor, id, input, key));
}

/** Составные операции используют уже открытую транзакцию. */
export async function transitionRequestInTransaction(
  deps: RegistryDeps,
  exec: DbExecutor,
  actor: Actor,
  id: string,
  input: Row,
  key?: string,
): Promise<Row> {
    const operation = async () => {
      const action = content(input.action, "действие");
      const authorActions = [
        "submit",
        "answer_clarification",
        "confirm_result",
        "return_result",
        "reopen",
        "cancel_request",
        "appeal_reject",
      ];
      const permission = action === "answer_clarification"
        ? "request.comment"
        : authorActions.includes(action)
        ? "request.author"
        : "request.manage";
      if (["submit_result", "confirm_result", "admin_close"].includes(action)) {
        await lockRequestWorks(exec, id);
      }
      const row = await requireRequest(exec, actor, id, permission, true);
      checkVersion(row.version, input.expected_version);
      let state = nextState(row.state, action);
      const p = input.payload && typeof input.payload === "object" &&
          !Array.isArray(input.payload)
        ? input.payload as Row
        : {};
      const reason = typeof input.reason === "string"
        ? input.reason.trim()
        : null;
      const needReason = [
        "ask_clarification",
        "resolve_clarification",
        "hold",
        "resume",
        "return_result",
        "reopen",
        "admin_close",
        "withdraw_report",
        "cancel_request",
        "approve_cancel",
        "reject_cancel",
        "reject",
        "appeal_reject",
        "uphold_appeal",
      ].includes(action);
      if (needReason) content(reason, "причину");
      if (
        action === "uphold_appeal" &&
        !actor.assignments.some((a) => a.role === "chairman")
      ) throw new ApiError("FORBIDDEN");
      if (action === "submit") {
        await validateLocation(exec, actor, row.author_person_id, row);
        const next = await register(exec, row);
        await log(deps, exec, actor, next, "submitted", row.state);
        await event(exec, next, "request.created");
        await inform(
          exec,
          next,
          templateNotice("notices.requests_service_transition_request_2", {next_number: next.number, detail_b: fmtDate(next.first_response_due_at)}),
          `${id}:created`,
          false,
          false,
        );
        await informManagers(
          exec,
          next,
          templateNotice("notices.requests_service_transition_request_102", {next_number: next.number}),
          `${id}:queue`,
        );
        return next;
      }
      if (["start_work", "plan_rework"].includes(action)) {
        content(p.plan, "план/ответственного за подготовку ответа");
      }
      const needsWork = row.kind === "request" ||
        row.work_execution_required === true;
      const workSnapshot = needsWork &&
          ["submit_result", "confirm_result", "admin_close"].includes(action)
        ? await taskResultSnapshot(exec, id)
        : { task_report_ids: [], task_results: [] };
      if (needsWork && ["confirm_result", "admin_close"].includes(action)) {
        const [active] = await exec.query(
          "select payload from request_confirmation where request_id=$1 and version=$2 and superseded_at is null",
          [id, row.confirmation_version],
        );
        const saved = active
          ? jsonValue<Row>(active.payload).task_report_ids
          : undefined;
        if (
          !Array.isArray(saved) ||
          JSON.stringify([...saved].sort()) !==
            JSON.stringify([...workSnapshot.task_report_ids].sort())
        ) {
          throw new ApiError(
            "CONCURRENT_MODIFICATION",
            "Комплект результата изменился: отзовите и передайте результат заново",
          );
        }
      }
      let confirmation = row.confirmation_version;
      if (action === "submit_result") {
        const payload = p.confirmation_payload as Row | undefined;
        content(payload?.summary, "итоговый ответ жителю");
        if (
          (payload?.document_version_ids as unknown[] | undefined)?.length
        ) invalid("Контур обязательных документов ещё не подключён");
        if (
          payload?.task_report_ids !== undefined &&
          (!Array.isArray(payload.task_report_ids) ||
            JSON.stringify([...payload.task_report_ids].sort()) !==
              JSON.stringify(
                [...(workSnapshot.task_report_ids as string[])].sort(),
              ))
        ) invalid("Состав отчётов не совпадает с принятым объёмом");
        confirmation++;
        const wait = await ruleDeadline(exec, "request_admin_close_wait");
        await exec.query(
          "insert into request_confirmation(request_id,version,payload,admin_close_after) values ($1,$2,$3::text::jsonb,$4)",
          [
            id,
            confirmation,
            JSON.stringify({
              summary: payload!.summary,
              document_version_ids: [],
              ...workSnapshot,
            }),
            wait.due.toISOString(),
          ],
        );
      }
      if (action === "submit_result") await startConfirmationTimers(exec,id,confirmation);
      if (action === "confirm_result") {
        if (p.confirmation_version !== row.confirmation_version) {
          throw new ApiError(
            "CONCURRENT_MODIFICATION",
            "Версия результата устарела",
          );
        }
        const rows = await exec.query(
          "update request_confirmation set confirmed_at=now(),confirmed_by=$3 where request_id=$1 and version=$2 and superseded_at is null and confirmed_at is null returning version",
          [id, confirmation, actor.person.id],
        );
        if (!rows.length) throw new ApiError("CONCURRENT_MODIFICATION");
      }
      if (action === "reopen") {
        if (
          !row.reopen_until ||
          new Date(String(row.reopen_until)).getTime() < Date.now()
        ) {
          throw new ApiError(
            "INVALID_TRANSITION",
            "Окно повторного открытия истекло: создайте связанное обращение",
          );
        }
      }
      if (action === "admin_close") {
        const [snap] = await exec.query<{ admin_close_after: string }>(
          "select admin_close_after from request_confirmation where request_id=$1 and version=$2",
          [id, confirmation],
        );
        const deadline = snap?.admin_close_after
          ? new Date(snap.admin_close_after)
          : null;
        const [active] = await exec.query(
          "select 1 from connection where person_id=$1 and status='active' and ($2::uuid is null or premises_id=$2)",
          [row.author_person_id, row.premises_id],
        );
        if (active && (!deadline || deadline.getTime() > Date.now())) {
          throw new ApiError(
            "INVALID_TRANSITION",
            "Срок ожидания автора ещё не истёк",
          );
        }
        content(p.verification_method, "способ проверки");
        content(p.verification_materials, "материалы проверки");
      }
      if (action === "hold") {
        content(p.responsible_person_id, "ответственного");
        const eligible = await exec.query(
          `select 1 from staff_assignment a join person n on n.id=a.person_id where a.person_id=$1 and n.is_test=$2 and n.status='active' and a.status='active' and a.role in ('chairman','administrator','deputy') and (a.valid_from is null or a.valid_from<=now()) and (a.valid_until is null or a.valid_until>now())`,
          [p.responsible_person_id, row.is_test],
        );
        if (
          !eligible.length ||
          p.responsible_person_id === row.complaint_subject_person_id
        ) invalid("Ответственный не имеет доступа к обращению");
        if (
          typeof p.next_action_at !== "string" ||
          !Number.isFinite(Date.parse(p.next_action_at)) ||
          Date.parse(p.next_action_at) <= Date.now()
        ) invalid("Нужна будущая дата следующего действия");
      }
      if (action === "cancel_request" && !row.work_started_at) {
        state = "canceled";
      }
      if (
        ["approve_cancel", "reject_cancel"].includes(action) &&
        !row.cancel_request
      ) throw new ApiError("INVALID_TRANSITION", "Нет запроса отмены");
      if (action === "approve_cancel" && row.work_started_at) {
        content(
          p.stop_resolution,
          "основание остановки и урегулирования обязательств",
        );
      }
      if (action === "reject" && row.work_started_at) {
        content(p.stop_resolution, "остановку начатых работ и обязательства");
      }
      if (action === "reject") content(p.route, "дальнейший маршрут");
      if (action === "uphold_appeal" && !row.appeal_by_chairman) {
        throw new ApiError("INVALID_TRANSITION", "Нет оспаривания автора");
      }
      if (["return_result", "reopen", "withdraw_report"].includes(action)) {
        await exec.query(
          "update request_confirmation set superseded_at=now() where request_id=$1 and version=$2",
          [id, confirmation],
        );
        await exec.query(
          "update rating set withdrawn_at=now() where request_id=$1",
          [id],
        );
      }
      if (["canceled", "rejected"].includes(state)) {
        await cancelParentTasks(
          deps,
          exec,
          actor,
          "request",
          id,
          reason ?? "Обращение прекращено",
        );
      }
      const reopenUntil = state === "closed"
        ? (await ruleDeadline(exec, "request_reopen")).due.toISOString()
        : null;
      const [next] = await exec.query<RequestRow>(
        `update request set state=$2,version=version+1,updated_at=now(),confirmation_version=$3,
    assigned_admin_person_id=case when $4='start_review' then $5 when $4='hold' then $10::uuid else assigned_admin_person_id end,
    prev_state=case when $4 in ('hold','ask_clarification') then state else prev_state end,
    clarification_question=case when $4='ask_clarification' then $6 else clarification_question end,
    hold_reason=case when $4='hold' then $6 else hold_reason end,
    next_action_at=case when $4='hold' then $7::timestamptz when $4='resume' then null else next_action_at end,
    next_action_reminded_at=case when $4='hold' then null else next_action_reminded_at end,
    reopen_until=case when $2='closed' then $9::timestamptz else reopen_until end,
    work_execution_required=work_execution_required or ($4 in ('start_work','plan_rework') and kind='request'),
    work_started_at=case when $4 in ('start_work','plan_rework') then coalesce(work_started_at,now()) else work_started_at end,
    close_method=case when $4='confirm_result' then 'author' when $4='admin_close' then 'administrative' else close_method end,
    closed_at=case when $2='closed' then now() else closed_at end,closed_by=case when $2='closed' then $5 else closed_by end,
    cancel_request=case when $4='cancel_request' and $2<>'canceled' then $8::text::jsonb when $4 in ('approve_cancel','reject_cancel') then null else cancel_request end,
    reject_reason=case when $4='reject' then $6 else reject_reason end,
    appeal_by_chairman=case when $4='appeal_reject' then $8::text::jsonb when $4='uphold_appeal' then null else appeal_by_chairman end
    where id=$1 returning *`,
        [
          id,
          state,
          confirmation,
          action,
          actor.person.id,
          action === "ask_clarification"
            ? content(p.question ?? reason)
            : reason,
          p.next_action_at ?? null,
          JSON.stringify({ reason, payload: p, actor: actor.person.id }),
          reopenUntil,
          p.responsible_person_id ?? null,
        ],
      );
      if (
        [
          "ask_clarification",
          "answer_clarification",
          "submit_result",
          "start_work",
          "plan_rework",
          "reject",
        ].includes(action)
      ) {
        const text = action === "submit_result"
          ? String((p.confirmation_payload as Row).summary)
          : action === "ask_clarification"
          ? content(p.question ?? reason, "конкретный вопрос")
          : action === "answer_clarification"
          ? content(p.answer ?? reason, "ответ")
          : action === "reject"
          ? `${reason}\n${p.route}`
          : String(p.plan);
        const previous = p.existing_message_id
          ? await exec.query(
            "select id from message where id=$1 and request_id=$2 and author_person_id=$3 and channel='resident' and created_at >= $4",
            [p.existing_message_id, id, actor.person.id, row.updated_at],
          )
          : [];
        if (p.existing_message_id && !previous.length) {
          invalid("Недоступное сообщение ответа");
        }
        if (!previous.length) {
          await exec.query(
            "insert into message(request_id,channel,author_person_id,text,source) values ($1,'resident',$2,$3,$4)",
            [id, actor.person.id, text, p.source ?? "web"],
          );
        }
        if (action !== "answer_clarification") {
          await exec.query(
            "update request set first_response_at=coalesce(first_response_at,now()) where id=$1",
            [id],
          );
          await exec.query("update timer set state='canceled',canceled_at=now() where entity_id=$1 and stage='request_first_response' and state='pending'",[id]);
        }
      }
      if (state !== "awaiting_confirmation") await exec.query("update timer set state='canceled',canceled_at=now() where entity_id=$1 and state='pending' and (stage like 'request_author_reminder:%' or stage like 'request_admin_check:%')",[id]);
      if (CLOSED_STATES.includes(state)) {
        await exec.query(
          "update timer set state='canceled',canceled_at=now() where entity_id=$1 and state='pending' and stage like 'request_%'",
          [id],
        );
      }
      await log(deps, exec, actor, next!, action, row.state, reason, {
        payload: p,
      });
      await event(exec, next!, "request.state_changed");
      const st = requestStateLoc(state);
      await inform(
        exec,
        next!,
        templateNotice("notices.requests_service_transition_request_3", {row_number: row.number, st_ru: st.ru, st_kk: st.kk}),
        `${id}:state:${next!.version}`,
        true,
        ["ask_clarification","submit_result","reject","cancel_request","approve_cancel","reject_cancel"].includes(action),
      );
      await informManagers(
        exec,
        next!,
        templateNotice("notices.requests_service_transition_request_103", {row_number: row.number, st_ru: st.ru, st_kk: st.kk}),
        `${id}:managers:${next!.version}`,
      );
      return publicRequest(exec, actor, next!);
    };
    return input.action === "submit"
      ? idempotent(
        exec,
        actor,
        `requests/${id}/submit`,
        key,
        input,
        operation,
        () => requireRequest(exec, actor, id, "request.author"),
      )
      : operation();
}
