import { loadDialog, saveDialog } from "./dialog.ts";
import { message, messageButton, safeBlock } from "../templates/message.ts";
import { BotTemplateError } from "./bot-errors.ts";
import { t as templateText } from "../templates/store.ts";
import { esc, fmtDate, fmtDay, fmtInterval } from "./text.ts";
import type { Actor } from "../pdp/types.ts";
import type { RegistryDeps } from "../domains/registry/service.ts";
import { ApiError } from "../errors/api.ts";
import { actorForTelegram } from "./registration.ts";
import { getIncident, listIncidents } from "../domains/incidents/service.ts";
import {
  acceptSignal,
  emergencyContact,
  listSignals,
  signalEmergency,
} from "../domains/incidents/duty.ts";
import {
  getPublication,
  listPublications,
} from "../domains/publications/service.ts";
import { publicationProblem } from "../domains/publications/problems.ts";
import { type Row } from "../domains/registry/validation.ts";
import { type BotReply, btn } from "./keyboard.ts";
export const INCIDENT_COMMANDS = [
  "/emergency",
  "/danger",
  "/incidents",
  "/incident",
  "/signals",
  "/acceptsignal",
  "/publications",
  "/publication",
  "/workproblem",
];
async function incidentPlainStep(
  deps: RegistryDeps,
  telegramId: string,
  input: string,
  providedActor?: Actor,
  operationId?: string,
): Promise<BotReply> {
  const [command, id, ...args] = input.trim().split(/\s+/),
    actor = providedActor ?? await actorForTelegram(deps, telegramId),
    key = operationId ?? crypto.randomUUID(),
    L: "ru" | "kk" = actor?.profile.language ?? "ru";
  // Кнопки вместо UUID в тексте: callback_data — точная команда (лимит 64 байта).
  if (command === "/emergency" && !args.length) {
    if (!id) {
      return templateText(
        deps.templates,
        L,
        "incidents.opasnost_avariya_napishite_emergency_nomer_obrascheniya_chto",
      );
    }
    const [building] = await deps.db.query<{ id: string }>(
      "select id from building where code=$1",
      [id],
    );
    if (!building) throw new ApiError("NOT_FOUND");
    const contact = await emergencyContact(
      deps.db,
      building.id,
      actor?.person.isTest ?? false,
    );
    return message(
      deps.templates,
      L,
      `messages.incidents.contact_${contact.on_duty ? "on" : "off"}_${
        contact.phone ? "phone" : "no_phone"
      }`,
      { phone: contact.phone ?? "" },
    );
  }
  if (!actor) {
    throw new BotTemplateError(
      "FORBIDDEN",
      templateText(deps.templates, L, "incidents.podtverdite_registratsiyu"),
    );
  }
  if (command === "/incidents") {
    const items = await listIncidents(deps, actor);
    return items.length
      ? message(deps.templates, L, "messages.incidents.list", {
        items: safeBlock(
          items.map((r) => `${esc(r.number)}: ${esc(r.title)}`).join("\n"),
        ),
      })
      : templateText(deps.templates, L, "incidents.net_dostupnyh_avariy");
  }
  if (command === "/incident") {
    const [r] = await deps.db.query<{ id: string }>(
      "select id from incident where number=$1",
      [id],
    );
    if (!r) throw new ApiError("NOT_FOUND");
    const card = await getIncident(deps, actor, r.id);
    return message(
      deps.templates,
      L,
      `messages.incidents.card_${
        card.public_text != null ? "public" : "checking"
      }_${card.forecast ? "forecast" : "no_forecast"}_${
        card.next_update_at ? "update" : "no_update"
      }`,
      {
        number: card.number,
        title: card.title,
        description: card.public_text ?? "",
        forecast: card.forecast ?? "",
        next_update: fmtDate(card.next_update_at),
      },
    );
  }
  if (command === "/signals") {
    const signals = await listSignals(deps, actor);
    if (!signals.length) {
      return templateText(deps.templates, L, "incidents.net_signalov");
    }
    return {
      text: message(deps.templates, L, "messages.incidents.signals", {
        items: safeBlock(
          signals.map((s) => `${fmtDate(s.created_at)} — ${esc(s.description)}`)
            .join("\n\n"),
        ),
      }),
      buttons: signals.map((s) => [
        btn(
          messageButton(
            deps.templates,
            L,
            "messages.incidents.signals",
            "accept",
          ),
          `/acceptsignal ${s.id} ${s.version}`,
        ),
      ]),
    };
  }
  if (command === "/acceptsignal" && id) {
    await acceptSignal(
      deps,
      actor,
      id,
      { expected_version: Number(args[0]) },
      key,
    );
    return templateText(deps.templates, L, "incidents.signal_prinyat");
  }
  if (command === "/emergency" || command === "/danger") {
    const task = command === "/danger",
      [r] = await deps.db.query<{ id: string; building_id: string }>(
        task
          ? "select t.id,coalesce(r.building_id,case when cardinality(w.building_ids)=1 then w.building_ids[1] end) as building_id from task t left join request r on r.id=t.request_id left join common_work w on w.id=t.common_work_id where t.number=$1"
          : "select id,building_id from request where number=$1",
        [id],
      );
    if (!r) throw new ApiError("NOT_FOUND");
    let description = args.join(" ");
    if (task && description.includes("|")) {
      const [code, ...parts] = description.split("|");
      const [building] = await deps.db.query<{ id: string }>(
        "select id from building where code=$1",
        [code!.trim()],
      );
      if (!building) {
        throw new BotTemplateError(
          "VALIDATION_FAILED",
          templateText(deps.templates, L, "incidents.dom_ne_nayden"),
        );
      }
      r.building_id = building.id;
      description = parts.join("|").trim();
    }
    if (!r.building_id) {
      throw new BotTemplateError(
        "VALIDATION_FAILED",
        templateText(
          deps.templates,
          L,
          "incidents.danger_nomer_zadaniya_kod_doma_opisanie",
        ),
      );
    }
    const signal = await signalEmergency(deps, actor, {
      [task ? "task_id" : "request_id"]: r.id,
      building_id: r.building_id,
      description,
    }, key);
    return message(
      deps.templates,
      L,
      `messages.incidents.sent_${signal.contact.on_duty ? "on" : "off"}_${
        signal.contact.phone ? "phone" : "no_phone"
      }`,
      { phone: signal.contact.phone ?? "" },
    );
  }
  if (command === "/publications") {
    const items = (await listPublications(deps, actor)).filter((r) =>
      r.state === "published"
    );
    if (!items.length) {
      return templateText(deps.templates, L, "incidents.net_publikatsiy");
    }
    return {
      text: message(deps.templates, L, "messages.incidents.publications", {
        items: safeBlock(
          items.map((r) =>
            `${esc(r.title)}\n${fmtDay(r.published_at ?? r.created_at)}`
          ).join("\n\n"),
        ),
      }),
      buttons: items.map((p) => [
        btn(
          messageButton(
            deps.templates,
            L,
            "messages.incidents.publications",
            "open",
          ),
          `/publication ${p.id}`,
        ),
      ]),
    };
  }
  if (command === "/publication" && id) {
    const p = await getPublication(deps, actor, id);
    const template = p.kind === "outage"
      ? `messages.incidents.outage_${p.restored_at ? "restored" : "pending"}`
      : p.kind === "work_report"
      ? "messages.incidents.work_report"
      : "messages.incidents.publication";
    const reply: BotReply = {
      text: message(deps.templates, L, template, {
        title: p.title,
        body: p.body,
        interval: fmtInterval(p.planned_start, p.planned_end),
        restored_at: fmtDate(p.restored_at),
      }),
    };
    if (p.kind === "work_report") {
      reply.buttons = [[
        btn(
          messageButton(
            deps.templates,
            L,
            "messages.incidents.work_report",
            "problem",
          ),
          `/workproblem ${id}`,
        ),
      ]];
    }
    return reply;
  }
  if (command === "/workproblem" && id) {
    const p = await getPublication(deps, actor, id);
    if (p.kind !== "work_report" || p.state !== "published") {
      throw new ApiError("FORBIDDEN");
    }
    if (!args.length) {
      // Двухшаговый ввод (срез UX): кнопка задаёт публикацию, описание —
      // следующим сообщением, чтобы житель не набирал идентификатор.
      await saveIncidentState(deps, telegramId, actor, {
        scenario: "incidents",
        workproblem_id: id,
      });
      return templateText(
        deps.templates,
        L,
        "incidents.ukazhite_dom_i_opishite_problemu_odnim_soobscheniem",
      );
    }
    const text = args.join(" ");
    const [code, ...rest] = text.includes("|")
      ? text.split("|").map((x) => x.trim())
      : [text.split(/\s+/)[0], text.split(/\s+/).slice(1).join(" ")];
    return reportWorkProblem(
      deps,
      telegramId,
      actor,
      id,
      String(code ?? ""),
      rest.join(" ").trim(),
      key,
    );
  }
  // Продолжение /workproblem: дом и описание одним сообщением.
  const state = await loadDialog(deps.db, telegramId, deps.bot ?? "resident", actor.profile.id, actor.emulation?.sessionId ?? null);
  if (
    state.scenario === "incidents" && typeof state.workproblem_id === "string"
  ) {
    // Кавычки из примера подсказки не должны ломать разбор кода дома.
    const cleaned = input.trim().replace(/^[«„"']+/, "").replace(
      /[»“"']+$/,
      "",
    );
    const [code, ...rest] = cleaned.split(/\s+/);
    return reportWorkProblem(
      deps,
      telegramId,
      actor,
      state.workproblem_id,
      code ?? "",
      rest.join(" ").trim(),
      key,
    );
  }
  return templateText(
    deps.templates,
    L,
    "incidents.incidents_avarii_publications_publikatsii_emergency_opasnost_signals",
  );
}

/** Сообщение о проблеме после работ: дом из области публикации + описание. */
async function reportWorkProblem(
  deps: RegistryDeps,
  telegramId: string,
  actor: Actor,
  id: string,
  code: string,
  description: string,
  key: string,
): Promise<BotReply> {
  const L = actor.profile.language;
  const p = await getPublication(deps, actor, id);
  if (p.kind !== "work_report" || p.state !== "published") {
    throw new ApiError("FORBIDDEN");
  }
  if (!code || !description) {
    return templateText(
      deps.templates,
      L,
      "incidents.ukazhite_dom_i_opishite_problemu_odnim_soobscheniem",
    );
  }
  const [b] = await deps.db.query<{ building_id: string }>(
    "select s.building_id from publication_scope s join building b on b.id=s.building_id where s.publication_id=$1 and b.code=$2",
    [id, code],
  );
  if (!b) {
    return templateText(
      deps.templates,
      L,
      "incidents.dom_ne_vhodit_v_etu_publikatsiyu_ukazhite",
    );
  }
  const r = await publicationProblem(deps, actor, id, {
    source: "bot",
    building_id: b.building_id,
    text: description,
  }, key);
  await saveIncidentState(deps, telegramId, actor, {});
  return message(deps.templates, L, "messages.incidents.problem_sent", {
    number: r.number,
  });
}

/** Сохраняет состояние диалога инцидентов (сценарий /workproblem). */
async function saveIncidentState(
  deps: RegistryDeps,
  telegramId: string,
  actor: Actor,
  state: Row,
): Promise<void> {
  const bot = deps.bot ?? "resident";
  await loadDialog(deps.db, telegramId, bot, actor.profile.id, actor.emulation?.sessionId ?? null);
  await saveDialog(deps.db, telegramId, bot, state);
}

/**
 * Шаблоны возвращают безопасный HTML, динамический текст экранируется отдельно;
 * их callback_data резолвится как команда, подписи — безопасные строки.
 */
export async function incidentStep(
  ...args: Parameters<typeof incidentPlainStep>
): Promise<BotReply> {
  return incidentPlainStep(...args);
}
