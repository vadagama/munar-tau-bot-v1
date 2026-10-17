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
export async function incidentStep(
  deps: RegistryDeps,
  telegramId: string,
  input: string,
  providedActor?: Actor,
  operationId?: string,
): Promise<string> {
  const [command, id, ...args] = input.trim().split(/\s+/),
    actor = providedActor ?? await actorForTelegram(deps, telegramId),
    key = operationId ?? crypto.randomUUID();
  if (command === "/emergency" && !args.length) {
    if (!id) {
      return "Авария / Апат: /emergency КОД_ДОМА — аварийный телефон; /emergency НОМЕР_ОБРАЩЕНИЯ описание — сообщить об опасности. Сигнал не подтверждает выезд / Сигнал шығуды растамайды.";
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
    return `${
      contact.phone ?? "Телефон ещё не настроен / Телефон әлі бапталмаған"
    }\n${contact.notice}`;
  }
  if (!actor) {
    throw new ApiError(
      "FORBIDDEN",
      "Подтвердите регистрацию / Тіркелуді растаңыз",
    );
  }
  if (command === "/incidents") {
    return (await listIncidents(deps, actor)).map((r) =>
      `${r.number}: ${r.title}`
    ).join("\n") || "Нет доступных аварий / Қолжетімді апаттар жоқ";
  }
  if (command === "/incident") {
    const [r] = await deps.db.query<{ id: string }>(
      "select id from incident where number=$1",
      [id],
    );
    if (!r) throw new ApiError("NOT_FOUND");
    const card = await getIncident(deps, actor, r.id);
    return `${card.number}: ${card.title}\n${
      card.public_text ?? "Сигнал проверяется / Сигнал тексерілуде"
    }\n${card.forecast}`;
  }
  if (command === "/signals") {
    return (await listSignals(deps, actor)).map((s) =>
      `${s.id} • ${s.description}\n/acceptsignal ${s.id} ${s.version}`
    ).join("\n\n") || "Нет сигналов / Сигналдар жоқ";
  }
  if (command === "/acceptsignal" && id) {
    await acceptSignal(
      deps,
      actor,
      id,
      { expected_version: Number(args[0]) },
      key,
    );
    return "Принято / Қабылданды";
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
        throw new ApiError("VALIDATION_FAILED", "Дом не найден / Үй табылмады");
      }
      r.building_id = building.id;
      description = parts.join("|").trim();
    }
    if (!r.building_id) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "/danger НОМЕР_ЗАДАНИЯ КОД_ДОМА | описание / сипаттама",
      );
    }
    const signal = await signalEmergency(deps, actor, {
      [task ? "task_id" : "request_id"]: r.id,
      building_id: r.building_id,
      description,
    }, key);
    return `Сигнал / Сигнал: ${signal.id}\n${
      signal.contact.phone ?? ""
    }\n${signal.contact.notice}`;
  }
  if (command === "/publications") {
    return (await listPublications(deps, actor)).filter((r) =>
      r.state === "published"
    ).map((r) => `${r.title}\n/publication ${r.id}`).join("\n\n") ||
      "Нет публикаций / Жарияланымдар жоқ";
  }
  if (command === "/publication" && id) {
    const p = await getPublication(deps, actor, id);
    return `${p.title}\n${p.body}${
      p.kind === "work_report"
        ? `\n/workproblem ${id} КОД_ДОМА | описание / сипаттама`
        : ""
    }`;
  }
  if (command === "/workproblem" && id) {
    const p = await getPublication(deps, actor, id);
    if (p.kind !== "work_report" || p.state !== "published") {
      throw new ApiError("FORBIDDEN");
    }
    const [code, ...text] = args.join(" ").split("|");
    const [b] = await deps.db.query<{ building_id: string }>(
      "select s.building_id from publication_scope s join building b on b.id=s.building_id where s.publication_id=$1 and b.code=$2",
      [id, code?.trim()],
    );
    if (!b) throw new ApiError("VALIDATION_FAILED", "Дом вне публикации");
    const r = await publicationProblem(deps, actor, id, {
      source: "bot",
      building_id: b.building_id,
      text: text.join("|").trim(),
    }, key);
    return `${r.number}: зарегистрировано / тіркелді`;
  }
  return "/incidents — аварии / апаттар; /publications — публикации / жарияланымдар; /emergency — опасность / қауіп; /signals — сигналы / сигналдар";
}
