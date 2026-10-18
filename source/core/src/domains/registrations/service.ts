import { templateNotice } from "../../templates/notice.ts";
import { notifyPerson, notifyTelegram } from "./notifications.ts";
import { label, premiseLabels, stateLabels } from "../../locales/registry.ts";
import { jsonValue } from "../registry/validation.ts";
import { initialStage, reviewers } from "./routing.ts";
import type { Actor } from "../../pdp/types.ts";
import type { DbExecutor } from "../../db/client.ts";
import { ApiError } from "../../errors/api.ts";
import { registryScope, requireBuilding } from "../registry/access.ts";
import {
  getPremises,
  recordAudit,
  type RegistryDeps,
} from "../registry/service.ts";
import {
  normalizePhone,
  text,
  validateConnectionRole,
  type Row,
} from "../registry/validation.ts";
import { startTimer, ruleDeadline } from "../registry/time.ts";

export async function activeOwner(
  exec: DbExecutor,
  actor: Actor,
  premisesId: string,
): Promise<void> {
  const rows = await exec.query(
    "select id from connection where person_id=$1 and premises_id=$2 and role='owner' and status='active' for update",
    [actor.person.id, premisesId],
  );
  if (!rows.length) throw new ApiError("NOT_FOUND");
}
export async function submitRegistration(
  deps: RegistryDeps,
  actor: Actor | null,
  input: Row,
  telegramId?: string,
): Promise<Row> {
  const fullName = text(input, "full_name"),
    phone = normalizePhone(input.phone_e164);
  if (!["ru", "kk"].includes(String(input.language)))
    throw new ApiError("VALIDATION_FAILED", "Выберите ru/kk");
  if (input.consent !== true)
    throw new ApiError(
      "VALIDATION_FAILED",
      "Подтвердите согласие на обработку данных",
    );
  return deps.db.transaction(async (exec) => {
    const premises = await getPremises(exec, text(input, "premises_id"));
    if (premises.is_test !== (actor?.person.isTest ?? false))
      throw new ApiError("NOT_FOUND");
    if (premises.status !== "active")
      throw new ApiError("VALIDATION_FAILED", "Помещение архивировано");
    validateConnectionRole(String(premises.kind), input.role);
    if (!actor && !telegramId) throw new ApiError("UNAUTHENTICATED");
    const adminSubmission = input.person_id !== undefined;
    if (adminSubmission) requireBuilding(actor!, String(premises.building_id));
    const personId = adminSubmission
      ? text(input, "person_id")
      : (actor?.person.id ?? null);
    if (personId) {
      const [person] = await exec.query<Row>(
        "select id,is_test,status from person where id=$1",
        [personId],
      );
      if (
        !person ||
        person.is_test !== (actor?.person.isTest ?? false) ||
        person.status !== "active"
      )
        throw new ApiError("NOT_FOUND");
    }
    const owners = await exec.query<Row>(
      `select c.person_id from connection c join profile pr on pr.person_id=c.person_id and pr.archived_at is null join person n on n.id=c.person_id where c.premises_id=$1 and c.role='owner' and c.status='active' and n.is_test=$2`,
      [premises.id, actor?.person.isTest ?? false],
    );
    const stage =
      input.role === "tenant" && owners.length
        ? "owner"
        : await initialStage(
            exec,
            String(premises.building_id),
            actor?.person.isTest ?? false,
          );
    if (input.registration_id) {
      const [existing] = await exec.query<Row>(
        "select * from registration where id=$1 and telegram_user_id=$2 for update",
        [text(input, "registration_id"), telegramId],
      );
      if (!existing || existing.is_test !== (actor?.person.isTest ?? false))
        throw new ApiError("NOT_FOUND");
      if (
        !["pending_review", "need_clarification", "rejected"].includes(
          String(existing.state),
        ) ||
        existing.total_due_at
      )
        throw new ApiError("INVALID_TRANSITION");
      await exec.query(
        "update timer set state='canceled' where entity_id=$1 and state='pending'",
        [existing.id],
      );
      const due = await startTimer(
        exec,
        stage === "owner" ? "tenant_wait" : "registration_stage",
        String(existing.id),
        stage,
      );
      const [updated] = await exec.query<Row>(
        "update registration set draft=$2::text::jsonb,premises_id=$3,role=$4,state='pending_review',review_stage=$5,stage_due_at=$6,updated_at=now() where id=$1 returning *",
        [
          existing.id,
          JSON.stringify({
            full_name: fullName,
            phone_e164: phone,
            language: input.language,
            consent: true,
            terms_version: "registration-v1",
          }),
          premises.id,
          input.role,
          stage,
          due.toISOString(),
        ],
      );
      if (actor)
        await recordAudit(
          deps,
          exec,
          actor,
          "registration.edit",
          "registration",
          String(existing.id),
          [String(premises.building_id)],
          { state: existing.state },
          { state: "pending_review" },
        );
      return updated!;
    }
    const [row] = await exec.query<Row>(
      `insert into registration(person_id,draft,premises_id,role,source,telegram_user_id,review_stage,is_test)
      values ($1,$2::text::jsonb,$3,$4,$5,$6,$7,$8) returning *`,
      [
        personId,
        JSON.stringify({
          full_name: fullName,
          phone_e164: phone,
          language: input.language,
          consent: true,
          terms_version: "registration-v1",
        }),
        premises.id,
        input.role,
        adminSubmission ? "admin" : "bot",
        telegramId ?? null,
        stage,
        actor?.person.isTest ?? false,
      ],
    );
    const due = await startTimer(
      exec,
      stage === "owner" ? "tenant_wait" : "registration_stage",
      String(row!.id),
      stage,
    );
    await exec.query("update registration set stage_due_at=$2 where id=$1", [
      row!.id,
      due.toISOString(),
    ]);
    const premiseText = `${label(premiseLabels, premises.kind, "ru")} ${premises.number}`,
      premiseTextKk = `${label(premiseLabels, premises.kind, "kk")} ${premises.number}`;
    for (const owner of owners)
      if (stage === "owner")
        await notifyPerson(
          exec,
          String(owner.person_id),
          templateNotice("notices.registrations_service_submit_registration_1", {fullname: fullName, premisetext: premiseText, premisetextkk: premiseTextKk}),
          `${row!.id}:owner:${owner.person_id}`,
          { registrationAccess: { premisesId: String(premises.id), role: "owner" }, buildingIds: [String(premises.building_id)] },
        );
    if (stage !== "owner")
      for (const reviewer of await reviewers(
        exec,
        String(premises.building_id),
        stage,
        actor?.person.isTest ?? false,
      ))
        await notifyPerson(
          exec,
          reviewer,
          templateNotice("notices.registrations_service_submit_registration_2", {fullname: fullName, premisetext: premiseText, premisetextkk: premiseTextKk}),
          `${row!.id}:review:${reviewer}`,
          { bot: "worker", registrationAccess: { premisesId: String(premises.id), role: stage }, buildingIds: [String(premises.building_id)] },
        );
    if (actor)
      await recordAudit(
        deps,
        exec,
        actor,
        "registration.submit",
        "registration",
        String(row!.id),
        [String(premises.building_id)],
        null,
        { state: "pending_review" },
      );
    return { ...row, stage_due_at: due.toISOString() };
  });
}
export async function listRegistrations(
  deps: RegistryDeps,
  actor: Actor,
): Promise<Row[]> {
  const scope = registryScope(actor);
  const rows = await deps.db.query<Row>(
    `select r.*,p.building_id,p.kind,p.number,b.code as building_code from registration r join premises p on p.id=r.premises_id join building b on b.id=p.building_id
    where ($1::uuid[] is null or p.building_id=any($1::uuid[])) and r.is_test=$2 order by r.created_at desc`,
    [scope, actor.person.isTest],
  );
  return rows.map((row) => ({ ...row, draft: jsonValue<Row>(row.draft) }));
}
export async function editRegistration(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  input: Row,
): Promise<Row> {
  return deps.db.transaction(async (exec) => {
    const [row] = await exec.query<Row>(
      "select * from registration where id=$1 and person_id=$2 for update",
      [id, actor.person.id],
    );
    if (!row) throw new ApiError("NOT_FOUND");
    if (
      !["pending_review", "need_clarification", "rejected"].includes(
        String(row.state),
      )
    )
      throw new ApiError("INVALID_TRANSITION");
    const draft = { ...jsonValue<Row>(row.draft) };
    if (input.full_name !== undefined)
      draft.full_name = text(input, "full_name");
    if (input.phone_e164 !== undefined)
      draft.phone_e164 = normalizePhone(input.phone_e164);
    await exec.query(
      "update registration set draft=$2::text::jsonb,state='pending_review',updated_at=now() where id=$1",
      [id, JSON.stringify(draft)],
    );
    if (row.state === "rejected") {
      const premises = await getPremises(exec, String(row.premises_id));
      const stage = await initialStage(
        exec,
        String(premises.building_id),
        actor.person.isTest,
      );
      const due = await startTimer(exec, "registration_stage", id, stage);
      await exec.query(
        "update registration set review_stage=$2,stage_due_at=$3,total_due_at=null,dispute_checker_id=null where id=$1",
        [id, stage, due.toISOString()],
      );
    }
    await recordAudit(
      deps,
      exec,
      actor,
      "registration.edit",
      "registration",
      id,
      [],
      { state: row.state },
      { state: "pending_review" },
    );
    return { ...row, draft, state: "pending_review" };
  });
}

export async function reviewRegistration(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  decision: "approve" | "reject" | "clarify" | "dispute",
  input: Row,
  asOwner = false,
): Promise<Row> {
  // approve не требует основания (диалог кабинета без полей); остальные решения валидирует text().
  const reason =
    decision === "approve" &&
    (input.reason === undefined ||
      input.reason === null ||
      String(input.reason).trim() === "")
      ? null
      : text(input, "reason");
  return deps.db.transaction(async (exec) => {
    const [row] = await exec.query<Row>(
      "select * from registration where id=$1 for update",
      [id],
    );
    if (!row || row.is_test !== actor.person.isTest)
      throw new ApiError("NOT_FOUND");
    const premises = await getPremises(exec, String(row.premises_id));
    if (premises.is_test !== actor.person.isTest)
      throw new ApiError("NOT_FOUND");
    if (asOwner) {
      await activeOwner(exec, actor, String(premises.id));
      if (
        decision !== "dispute" &&
        (row.role !== "tenant" || row.review_stage !== "owner")
      )
        throw new ApiError("FORBIDDEN");
    } else {
      requireBuilding(actor, String(premises.building_id));
      if (row.total_due_at && row.dispute_checker_id === actor.person.id)
        throw new ApiError(
          "FORBIDDEN",
          "Спор о собственных действиях передаётся председателю (CMP-02)",
        );
      const chairman = actor.assignments.some((a) => a.role === "chairman");
      if (decision !== "dispute") {
        if (row.review_stage === "owner")
          throw new ApiError(
            "FORBIDDEN",
            "Анкета ожидает решения собственника (48 часов)",
          );
        if (
          !chairman &&
          !actor.assignments.some((a) => a.role === row.review_stage)
        )
          throw new ApiError(
            "FORBIDDEN",
            "Анкета передана другому уровню рассмотрения",
          );
      }
    }
    if (decision === "dispute") {
      if (row.role === "owner")
        throw new ApiError(
          "FORBIDDEN",
          "Собственники не оспаривают статус друг друга через доступ проживающего",
        );
      const [connection] = await exec.query<Row>(
        "select id from connection where id=$1 and status='active' for update",
        [row.connection_id],
      );
      if (!connection)
        throw new ApiError(
          "INVALID_TRANSITION",
          "Первоначальная связь уже прекращена",
        );
      if (row.state !== "approved")
        throw new ApiError(
          "INVALID_TRANSITION",
          "Оспаривается подтверждённый доступ",
        );
      const stage =
        !asOwner && row.checker_id === actor.person.id
          ? "chairman"
          : await initialStage(
              exec,
              String(premises.building_id),
              actor?.person.isTest ?? false,
            );
      const due = await startTimer(
        exec,
        "registration_stage",
        id,
        `dispute:${stage}`,
      );
      const total = await startTimer(
        exec,
        "dispute_total",
        id,
        "dispute:total",
      );
      await exec.query(
        "update registration set state='disputed',review_stage=$2,stage_due_at=$3,total_due_at=$4,decided_reason=$5,dispute_checker_id=checker_id where id=$1",
        [id, stage, due.toISOString(), total.toISOString(), reason],
      );
      await recordAudit(
        deps,
        exec,
        actor,
        "registration.dispute",
        "registration",
        id,
        [String(premises.building_id)],
        { state: row.state },
        { state: "disputed" },
        reason ?? undefined,
      );
      // Возражение не отзывает доступ (REG-05).
      return { ...row, state: "disputed" };
    }
    if (
      !["pending_review", "need_clarification", "disputed"].includes(
        String(row.state),
      )
    )
      throw new ApiError("INVALID_TRANSITION");
    let personId = row.person_id;
    if (decision === "approve") {
      const draft = jsonValue<Row>(row.draft);
      if (personId) {
        const [person] = await exec.query<Row>(
          "select id,is_test,status from person where id=$1 for update",
          [personId],
        );
        if (
          !person ||
          person.is_test !== actor.person.isTest ||
          person.status !== "active"
        )
          throw new ApiError("NOT_FOUND");
      }
      if (input.person_id) {
        if (asOwner)
          throw new ApiError(
            "FORBIDDEN",
            "Связывание с реестром выполняет администратор",
          );
        const [matched] = await exec.query<Row>(
          "select * from person where id=$1 for update",
          [text(input, "person_id")],
        );
        if (!matched || matched.is_test !== actor.person.isTest)
          throw new ApiError("NOT_FOUND");
        // Явно выбранная карточка проверяется по связи с этим помещением.
        const links = await exec.query(
          "select id from connection where person_id=$1 and premises_id=$2 and status<>'revoked'",
          [matched.id, premises.id],
        );
        if (!links.length)
          throw new ApiError(
            "VALIDATION_FAILED",
            "Карточка не связана с помещением; сначала проверьте реестр",
          );
        personId = matched.id;
      }
      if (!personId) {
        try {
          const [person] = await exec.query<Row>(
            "insert into person(full_name,phone_e164,is_test) values ($1,$2,$3) returning id",
            [draft.full_name, draft.phone_e164, actor.person.isTest],
          );
          personId = person!.id;
        } catch (error) {
          if ((error as { code?: string }).code === "23505")
            throw new ApiError(
              "VALIDATION_FAILED",
              "В реестре уже есть карточка с этим телефоном — обновите страницу и привяжите её",
            );
          throw error;
        }
      }
      if (row.telegram_user_id) {
        const existing = await exec.query<Row>(
          "select * from profile where (person_id=$1 or telegram_user_id=$2) and archived_at is null for update",
          [personId, row.telegram_user_id],
        );
        if (
          existing.some(
            (p) =>
              p.person_id !== personId ||
              String(p.telegram_user_id) !== String(row.telegram_user_id),
          )
        )
          throw new ApiError(
            "VALIDATION_FAILED",
            "Перенос Telegram выполняется отдельной процедурой восстановления",
          );
        if (!existing.length)
          await exec.query(
            "insert into profile(person_id,telegram_user_id,language,is_test) values ($1,$2,$3,$4)",
            [
              personId,
              row.telegram_user_id,
              draft.language,
              actor.person.isTest,
            ],
          );
      }
      const [active] = await exec.query<Row>(
        "select role from connection where person_id=$1 and premises_id=$2 and status='active'",
        [personId, premises.id],
      );
      if (active && active.role !== row.role)
        throw new ApiError(
          "VALIDATION_FAILED",
          "Изменение роли оформляется отдельно через реестр",
        );
      await exec.query(
        "update connection set status='active',confirmed_by=$3,confirmed_at=now() where person_id=$1 and premises_id=$2 and status='pending' and role=$4",
        [personId, premises.id, actor.person.id, row.role],
      );
      await exec.query(
        `insert into connection(person_id,premises_id,role,basis,status,confirmed_by,confirmed_at,created_by)
        select $1,$2,$3,$4,'active',$5,now(),$5 where not exists(select 1 from connection where person_id=$1 and premises_id=$2 and status='active')`,
        [
          personId,
          premises.id,
          row.role,
          row.role === "owner"
            ? "ownership"
            : row.role === "tenant"
              ? "rent"
              : "family",
          actor.person.id,
        ],
      );
    }
    if (decision === "approve")
      await exec.query(
        "update registration set connection_id=(select id from connection where person_id=$2 and premises_id=$3 and status='active') where id=$1",
        [id, personId, premises.id],
      );
    if (decision === "reject" && row.total_due_at)
      await exec.query(
        "update connection set status='revoked',revoked_reason=$2,end_date=current_date where id=$1 and status='active' and role<>'owner'",
        [row.connection_id, reason],
      );
    const state =
      decision === "approve"
        ? "approved"
        : decision === "reject"
          ? "rejected"
          : "need_clarification";
    await exec.query(
      "update registration set state=$2,person_id=$3,checker_id=$4,decided_at=now(),decided_reason=$5,updated_at=now() where id=$1",
      [id, state, personId, actor.person.id, reason],
    );
    if (decision !== "clarify")
      await exec.query(
        "update timer set state='canceled' where entity_id=$1 and state='pending'",
        [id],
      );
    await notifyTelegram(
      exec,
      row.telegram_user_id,
      templateNotice(decision === "clarify" ? "notices.registrations_service_review_registration_3_clarify" : "notices.registrations_service_review_registration_3", {state_ru:label(stateLabels,state,"ru"),state_kk:label(stateLabels,state,"kk"),reason:reason ? " "+reason : ""}),
      `${id}:${state}:${row.updated_at}`,
    );
    await recordAudit(
      deps,
      exec,
      actor,
      `registration.${decision}`,
      "registration",
      id,
      [String(premises.building_id)],
      { state: row.state },
      { state, person_id: personId },
      reason ?? undefined,
    );
    return { ...row, state, person_id: personId };
  });
}

export async function createInvite(
  deps: RegistryDeps,
  actor: Actor,
  input: Row,
): Promise<Row> {
  return deps.db.transaction(async (exec) => {
    const premises = await getPremises(exec, text(input, "premises_id"));
    await activeOwner(exec, actor, String(premises.id));
    validateConnectionRole(String(premises.kind), input.role);
    if (input.role === "owner")
      throw new ApiError("FORBIDDEN", "Приглашение не выдаёт собственность");
    const deadline = await ruleDeadline(exec, "invite_expiry");
    const token =
      crypto.randomUUID().replaceAll("-", "") +
      crypto.randomUUID().replaceAll("-", "");
    const [row] = await exec.query<Row>(
      "insert into invite(created_by,premises_id,role,token,expires_at) values ($1,$2,$3,$4,$5) returning *",
      [
        actor.person.id,
        premises.id,
        input.role,
        token,
        deadline.due.toISOString(),
      ],
    );
    await exec.query(
      "insert into timer(rule_version_id,entity_id,stage,due_at) values ($1,$2,'invite',$3)",
      [deadline.id, row!.id, deadline.due.toISOString()],
    );
    await recordAudit(
      deps,
      exec,
      actor,
      "registration.invite.create",
      "invite",
      String(row!.id),
      [String(premises.building_id)],
      null,
      { role: input.role, expires_at: deadline.due.toISOString() },
    );
    return row!;
  });
}
export async function acceptInvite(
  deps: RegistryDeps,
  actor: Actor,
  token: string,
): Promise<Row> {
  return deps.db.transaction(async (exec) => {
    const [invite] = await exec.query<Row>(
      "select * from invite where token=$1 for update",
      [token],
    );
    if (
      !invite ||
      invite.status !== "active" ||
      new Date(String(invite.expires_at)) <= new Date()
    )
      throw new ApiError(
        "INVALID_TRANSITION",
        "Приглашение использовано, отозвано или истекло",
      );
    const owner = await exec.query(
      "select id from connection where person_id=$1 and premises_id=$2 and role='owner' and status='active' for update",
      [invite.created_by, invite.premises_id],
    );
    if (!owner.length)
      throw new ApiError("INVALID_TRANSITION", "Связь собственника прекращена");
    const premises = await getPremises(exec, String(invite.premises_id));
    const [creator] = await exec.query<Row>(
      "select is_test from person where id=$1",
      [invite.created_by],
    );
    if (creator?.is_test !== actor.person.isTest)
      throw new ApiError("NOT_FOUND");
    const existing = await exec.query(
      "select id from connection where person_id=$1 and premises_id=$2 and status='active' for update",
      [actor.person.id, invite.premises_id],
    );
    if (existing.length)
      throw new ApiError(
        "INVALID_TRANSITION",
        "У вас уже есть действующая связь с помещением",
      );
    const [connection] = await exec.query<Row>(
      `insert into connection(person_id,premises_id,role,basis,status,confirmed_by,confirmed_at,created_by)
      values ($1,$2,$3,$4,'active',$5,now(),$5) returning id`,
      [
        actor.person.id,
        invite.premises_id,
        invite.role,
        invite.role === "tenant" ? "rent" : "family",
        invite.created_by,
      ],
    );
    await exec.query(
      "update invite set status='used',used_at=now(),used_by_profile=$2 where id=$1",
      [invite.id, actor.profile.id],
    );
    const [profile] = await exec.query<Row>(
      "select pr.telegram_user_id,n.phone_e164 from profile pr join person n on n.id=pr.person_id where pr.id=$1",
      [actor.profile.id],
    );
    const [registration] = await exec.query<Row>(
      `insert into registration(person_id,draft,premises_id,role,source,telegram_user_id,state,checker_id,decided_at,decided_reason,is_test,connection_id)
      values ($1,$2::text::jsonb,$3,$4,'bot',$5,'approved',$6,now(),'Приглашение собственника',$7,$8) returning id`,
      [
        actor.person.id,
        JSON.stringify({
          full_name: actor.person.fullName,
          phone_e164: profile!.phone_e164,
          language: actor.profile.language,
          consent: true,
        }),
        invite.premises_id,
        invite.role,
        profile!.telegram_user_id,
        invite.created_by,
        actor.person.isTest,
        connection!.id,
      ],
    );
    for (const reviewer of await reviewers(
      exec,
      String(premises.building_id),
      "administrator",
      actor.person.isTest,
    ))
      await notifyPerson(
        exec,
        reviewer,
        templateNotice("notices.registrations_service_accept_invite_4", {actor_person_fullname: actor.person.fullName, detail_b: label(premiseLabels, premises.kind, "ru"), premises_number: premises.number, detail_d: label(premiseLabels, premises.kind, "kk")}),
        `${invite.id}:admin:${reviewer}`,
        { bot: "worker", registrationAccess: { premisesId: String(premises.id), role: "administrator" }, buildingIds: [String(premises.building_id)] },
      );
    await notifyPerson(
      exec,
      String(invite.created_by),
      templateNotice("notices.registrations_service_accept_invite_5", {}),
      `${invite.id}:accepted`,
      { registrationAccess: { premisesId: String(premises.id), role: "owner" }, buildingIds: [String(premises.building_id)] },
    );
    await recordAudit(
      deps,
      exec,
      actor,
      "registration.invite.accept",
      "invite",
      String(invite.id),
      [String(premises.building_id)],
      null,
      { status: "used" },
    );
    return {
      status: "active",
      premises_id: invite.premises_id,
      registration_id: registration!.id,
    };
  });
}

/** Приглашение позволяет создать новую привязку после согласия; совпадение телефона требует ручной проверки. */
export async function acceptInviteForNewTelegram(
  deps: RegistryDeps,
  telegramId: string,
  token: string,
  input: Row,
): Promise<Row> {
  if (input.consent !== true)
    throw new ApiError("VALIDATION_FAILED", "Требуется согласие");
  return deps.db.transaction(async (exec) => {
    const [invite] = await exec.query<Row>(
      "select * from invite where token=$1 and status='active' and expires_at>now() for update",
      [token],
    );
    if (!invite)
      throw new ApiError("INVALID_TRANSITION", "Приглашение недействительно");
    const [person] = await exec.query<Row>(
      "insert into person(full_name,phone_e164) values ($1,$2) returning *",
      [text(input, "full_name"), normalizePhone(input.phone_e164)],
    );
    const [profile] = await exec.query<Row>(
      "insert into profile(person_id,telegram_user_id,language) values ($1,$2,$3) returning *",
      [person!.id, telegramId, input.language],
    );
    const actor: Actor = {
      person: {
        id: String(person!.id),
        fullName: String(person!.full_name),
        status: "active",
        isTest: false,
      },
      profile: {
        id: String(profile!.id),
        personId: String(person!.id),
        language: input.language as "ru" | "kk",
        isTest: false,
      },
      assignments: [],
      emulation: null,
    };
    const scoped = {
      ...deps,
      db: {
        ...deps.db,
        query: exec.query.bind(exec),
        transaction: <T>(fn: (e: DbExecutor) => Promise<T>) => fn(exec),
      },
    };
    return acceptInvite(scoped, actor, token);
  });
}
export async function revokeOwnConnection(
  deps: RegistryDeps,
  actor: Actor,
  id: string,
  reason: string,
): Promise<void> {
  if (!reason.trim())
    throw new ApiError("VALIDATION_FAILED", "Укажите причину");
  await deps.db.transaction(async (exec) => {
    const [row] = await exec.query<Row>(
      "select * from connection where id=$1 for update",
      [id],
    );
    if (!row) throw new ApiError("NOT_FOUND");
    await activeOwner(exec, actor, String(row.premises_id));
    if (
      row.role === "owner" ||
      row.confirmed_by !== actor.person.id ||
      row.status !== "active"
    )
      throw new ApiError(
        "FORBIDDEN",
        "Можно отозвать только свой подтверждённый доступ проживающего",
      );
    const premises = await getPremises(exec, String(row.premises_id));
    await exec.query(
      "update connection set status='revoked',revoked_reason=$2,end_date=current_date where id=$1",
      [id, reason],
    );
    await notifyPerson(
      exec,
      String(row.person_id),
      templateNotice("notices.registrations_service_revoke_own_connection_6", {reason: reason}),
      `${id}:revoked`,
    );
    await recordAudit(
      deps,
      exec,
      actor,
      "connection.revoke",
      "connection",
      id,
      [String(premises.building_id)],
      { status: "active" },
      { status: "revoked" },
      reason,
    );
  });
}

/** REG-10/AUTH-03: перенос только на Telegram из серверной анкеты после ручной проверки в кабинете. */
export async function recoverTelegram(
  deps: RegistryDeps,
  actor: Actor,
  personId: string,
  input: Row,
): Promise<Row> {
  const reason = text(input, "verified_basis"),
    registrationId = text(input, "registration_id");
  return deps.db.transaction(async (exec) => {
    const [person] = await exec.query<Row>(
      "select * from person where id=$1 for update",
      [personId],
    );
    if (!person || person.is_test !== actor.person.isTest)
      throw new ApiError("NOT_FOUND");
    if (actor.emulation) throw new ApiError("FORBIDDEN");
    const previous = await exec.query<Row>(
      "select id,telegram_user_id from profile where person_id=$1 and archived_at is null for update",
      [personId],
    );
    if (!previous.length)
      throw new ApiError(
        "VALIDATION_FAILED",
        "Нет действующей привязки для восстановления",
      );
    const buildings = await exec.query<{ building_id: string }>(
      "select distinct p.building_id from connection c join premises p on p.id=c.premises_id where c.person_id=$1",
      [personId],
    );
    const roles = await exec.query<{ role: string }>(
      "select role from staff_assignment where person_id=$1 and status='active'",
      [personId],
    );
    const targetPrivileged = roles.some(
      (r) => r.role === "chairman" || r.role === "tech_admin",
    );
    const technical = actor.assignments.some((a) => a.role === "tech_admin");
    if (targetPrivileged) {
      if (!technical || actor.person.id === personId)
        throw new ApiError(
          "FORBIDDEN",
          "Восстановление привилегированного аккаунта выполняет другой технический администратор",
        );
    } else {
      if (
        !actor.assignments.some(
          (a) => a.role === "chairman" || a.role === "administrator",
        )
      )
        throw new ApiError("FORBIDDEN");
      if (
        !buildings.length &&
        !actor.assignments.some((a) => a.role === "chairman")
      )
        throw new ApiError("NOT_FOUND");
      for (const b of buildings) requireBuilding(actor, b.building_id);
    }
    const [registration] = await exec.query<Row>(
      "select * from registration where id=$1 and state in ('pending_review','need_clarification') and telegram_user_id is not null for update",
      [registrationId],
    );
    if (!registration || registration.is_test !== actor.person.isTest)
      throw new ApiError("NOT_FOUND");
    const linked = await exec.query(
      "select id from connection where person_id=$1 and premises_id=$2",
      [personId, registration.premises_id],
    );
    if (!linked.length)
      throw new ApiError(
        "VALIDATION_FAILED",
        "Анкета должна относиться к проверяемому помещению человека",
      );
    const taken = await exec.query(
      "select id from profile where telegram_user_id=$1 and archived_at is null",
      [registration.telegram_user_id],
    );
    if (taken.length)
      throw new ApiError(
        "VALIDATION_FAILED",
        "Новый Telegram уже привязан; требуется отдельная проверка",
      );
    await exec.query(
      "update access_session set revoked_at=now(),revoked_reason='Telegram recovery' where profile_id in (select id from profile where person_id=$1) and revoked_at is null",
      [personId],
    );
    await exec.query(
      "update notification set state='failed',last_error='PROFILE_RECOVERED' where telegram_user_id=any($1::bigint[]) and state='queued'",
      [previous.map((p) => String(p.telegram_user_id))],
    );
    await exec.query(
      "update emulation_session set state='ended',ended_at=now() where tech_admin_profile_id=any($1::uuid[]) and state='active'",
      [previous.map((p) => String(p.id))],
    );
    await exec.query(
      "update profile set archived_at=now() where person_id=$1 and archived_at is null",
      [personId],
    );
    const draft = jsonValue<Row>(registration.draft);
    const [profile] = await exec.query<Row>(
      "insert into profile(person_id,telegram_user_id,language,is_test) values ($1,$2,$3,$4) returning id",
      [personId, registration.telegram_user_id, draft.language, person.is_test],
    );
    await exec.query(
      "update registration set person_id=$2,state='approved',checker_id=$3,decided_at=now(),decided_reason=$4 where id=$1",
      [registrationId, personId, actor.person.id, reason],
    );
    await exec.query(
      "update timer set state='canceled' where entity_id=$1 and state='pending'",
      [registrationId],
    );
    await recordAudit(
      deps,
      exec,
      actor,
      "registry.telegram.recovery",
      "person",
      personId,
      buildings.map((b) => b.building_id),
      null,
      { profile_id: profile!.id, registration_id: registrationId },
      reason,
    );
    return { person_id: personId, profile_id: profile!.id };
  });
}
