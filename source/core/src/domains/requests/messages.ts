import { recordReportResponse } from "../reports/history.ts";
import { templateNotice } from "../../templates/notice.ts";
import type { Actor } from "../../pdp/types.ts";
import { ApiError } from "../../errors/api.ts";
import type { RegistryDeps } from "../registry/service.ts";
import { recordAudit } from "../registry/service.ts";
import { invalid, type Row } from "../registry/validation.ts";
import { isManager, requireRequest } from "./access.ts";
import {
  content,
  idempotent,
  inform,
  informManagers,
  transitionRequest,
} from "./service.ts";

export async function addMessage(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
  key: string | undefined,
): Promise<Row> {
  return deps.db.transaction((exec) =>
    idempotent(
      exec,
      actor,
      `requests/${id}/messages`,
      key,
      input,
      async () => {
        const channel = input.channel ?? "resident";
        if (!["resident", "internal"].includes(String(channel))) {
          invalid("Неизвестный канал");
        }
        const row = await requireRequest(
          exec,
          actor,
          id,
          channel === "internal" ? "request.internal" : "request.comment",
          true,
        );
        const ids = input.attachments ?? [];
        const [policy] = await exec.query<{ max_per_message: number }>(
          "select max_per_message from file_policy where singleton",
        );
        if (!policy) invalid("Не настроены ограничения вложений");
        if (
          !Array.isArray(ids) || ids.length > policy.max_per_message ||
          ids.some((x) => typeof x !== "string") ||
          new Set(ids).size !== ids.length
        ) throw new ApiError("FILE_LIMIT");
        if (!input.text && !ids.length) invalid("Добавьте текст или вложение");
        for (const field of ["reply_to", "corrects_message_id"]) {
          if (input[field]) {
            const [m] = await exec.query(
              "select id from message where id=$1 and request_id=$2 and channel=$3 and restricted_at is null",
              [input[field], id, channel],
            );
            if (!m) {
              invalid(
                "Ссылка должна вести на доступное сообщение того же канала",
              );
            }
          }
        }
        const messageId = crypto.randomUUID();
        await exec.query(
          "insert into message(id,request_id,channel,author_person_id,text,reply_to,corrects_message_id,source) values ($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            messageId,
            id,
            channel,
            actor.person.id,
            input.text ? content(input.text) : "",
            input.reply_to ?? null,
            input.corrects_message_id ?? null,
            input.source ?? "web",
          ],
        );
        if (ids.length) {
          const attached = await exec.query(
            `update attachment set owner_type='message',owner_id=$1 where id=any($2::uuid[]) and request_id=$3 and uploaded_by=$4 and bucket=$5 and owner_type='request' returning id`,
            [messageId, ids, id, actor.person.id, channel],
          );
          if (attached.length !== ids.length) {
            invalid(
              "Вложение недоступно, принадлежит другому каналу или уже отправлено",
            );
          }
        }
        if (
          channel === "resident" && row.state === "need_clarification" &&
          !await isManager(exec, actor, row)
        ) {
          const db = {
            ...deps.db,
            query: exec.query.bind(exec),
            transaction: <T>(fn: (e: typeof exec) => Promise<T>) => fn(exec),
          };
          await transitionRequest({ ...deps, db }, actor, id, {
            action: "answer_clarification",
            expected_version: row.version,
            payload: {
              answer: input.text || "Приложены материалы",
              existing_message_id: messageId,
              source: input.source ?? "web",
            },
          });
        }
        if (channel === "resident") {
          if (await isManager(exec, actor, row)) {
            if(typeof input.text==="string"&&input.text.trim())await recordReportResponse(exec,id,messageId);
            await exec.query(
              "update request set first_response_at=coalesce(first_response_at,now()) where id=$1",
              [id],
            );
          }
          await exec.query("update timer set state='canceled',canceled_at=now() where entity_id=$1 and stage='request_first_response' and state='pending' and exists(select 1 from request where id=$1 and first_response_at is not null)",[id]);
          await inform(
            exec,
            row,
            templateNotice("notices.requests_messages_add_message_1", {row_number: row.number}),
            `${id}:message:${messageId}`,
            true,
          );
          await informManagers(
            exec,
            row,
            templateNotice("notices.requests_messages_add_message_101", {row_number: row.number}),
            `${messageId}:admin`,
          );
        }
        await recordAudit(
          deps,
          exec,
          actor,
          "request.message",
          "request",
          id,
          row.kind !== "complaint" && row.building_id ? [row.building_id] : [],
          null,
          { message_id: messageId, channel },
        );
        return { id: messageId, request_id: id, channel };
      },
      () =>
        requireRequest(
          exec,
          actor,
          id,
          input.channel === "internal" ? "request.internal" : "request.comment",
        ),
    )
  );
}
export async function restrictMessage(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  messageId: string,
  input: Row,
): Promise<Row> {
  return deps.db.transaction(async (exec) => {
    const row = await requireRequest(exec, actor, id, "request.manage", true);
    const reason = content(input.reason, "причину ограничения");
    const rows = await exec.query(
      "update message set restricted_at=now(),restricted_by=$3,restricted_reason=$4 where id=$1 and request_id=$2 returning id",
      [messageId, id, actor.person.id, reason],
    );
    if (!rows.length) throw new ApiError("NOT_FOUND");
    await recordAudit(
      deps,
      exec,
      actor,
      "request.message_restricted",
      "request",
      id,
      row.kind !== "complaint" && row.building_id ? [row.building_id] : [],
      null,
      { message_id: messageId },
    );
    return { restricted: true };
  });
}
export async function shareRequest(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  personId: string,
  revoke = false,
): Promise<Row> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      personId,
    )
  ) invalid("Укажите корректный идентификатор участника");
  return deps.db.transaction(async (exec) => {
    const row = await requireRequest(exec, actor, id, "request.author", true);
    if (
      row.state === "draft" || !row.premises_id ||
      personId === row.author_person_id
    ) invalid("Совместный доступ — конкретному жителю той же квартиры");
    if (!revoke) {
      const links = await exec.query(
        `select c.person_id from connection c join person n on n.id=c.person_id join premises room on room.id=c.premises_id
    where room.kind='apartment' and c.premises_id=$1 and c.status='active' and n.is_test=$3 and n.status='active' and c.person_id=any($2::uuid[]) and exists(select 1 from profile p where p.person_id=c.person_id and p.archived_at is null) for update of c`,
        [row.premises_id, [row.author_person_id, personId], row.is_test],
      );
      if (links.length !== 2) {
        throw new ApiError(
          "FORBIDDEN",
          "Нужны действующие связи автора и участника с одной квартирой",
        );
      }
      await exec.query(
        "insert into request_participant(request_id,person_id,role,added_by) values ($1,$2,'participant',$3) on conflict(request_id,person_id) do update set revoked_at=null,added_by=excluded.added_by,added_at=now() where request_participant.role='participant'",
        [id, personId, actor.person.id],
      );
    } else {await exec.query(
        "update request_participant set revoked_at=now() where request_id=$1 and person_id=$2 and role='participant'",
        [id, personId],
      );}
    await recordAudit(
      deps,
      exec,
      actor,
      revoke ? "request.share_revoked" : "request.shared",
      "request",
      id,
      row.kind !== "complaint" && row.building_id ? [row.building_id] : [],
      null,
      { person_id: personId },
    );
    return { person_id: personId, revoked: revoke };
  });
}
export async function rateRequest(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
): Promise<Row> {
  return deps.db.transaction(async (exec) => {
    const row = await requireRequest(exec, actor, id, "request.author", true);
    if (row.state !== "closed" || row.close_method !== "author") {
      throw new ApiError(
        "INVALID_TRANSITION",
        "Оценка доступна после подтверждения автором",
      );
    }
    if (Date.now() - new Date(String(row.closed_at)).getTime() > 7 * 86400000) {
      throw new ApiError("INVALID_TRANSITION", "Окно оценки 7 дней истекло");
    }
    if (
      !Number.isInteger(input.value) || Number(input.value) < 1 ||
      Number(input.value) > 5
    ) invalid("Оценка от 1 до 5");
    const comment = input.comment ? content(input.comment) : null;
    await exec.query(
      "insert into rating_log(request_id,person_id,value,comment,confirmation_version) values ($1,$2,$3,$4,$5)",
      [id, actor.person.id, input.value, comment, row.confirmation_version],
    );
    const [rating] = await exec.query(
      "insert into rating(request_id,person_id,value,comment,confirmation_version) values ($1,$2,$3,$4,$5) on conflict(request_id) do update set value=excluded.value,comment=excluded.comment,confirmation_version=excluded.confirmation_version,withdrawn_at=null,updated_at=now() returning value,comment",
      [id, actor.person.id, input.value, comment, row.confirmation_version],
    );
    if (Number(input.value) <= 2) {
      await informManagers(
        exec,
        row,
        templateNotice("notices.requests_messages_rate_request_102", {row_number: row.number}),
        `${id}:rating:${crypto.randomUUID()}`,
      );
    }
    await recordAudit(
      deps,
      exec,
      actor,
      "request.rated",
      "request",
      id,
      row.kind !== "complaint" && row.building_id ? [row.building_id] : [],
      null,
      { value: input.value },
    );
    return rating!;
  });
}
